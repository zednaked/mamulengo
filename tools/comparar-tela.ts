// Compara uma pagina com uma foto de referencia (a tela do jogo no Godot, por exemplo), pixel a
// pixel e elemento a elemento: diz o erro de cada elemento da tela (.tela.json) e o deslocamento
// que mais o aproxima - o que separa "fora do lugar" (deslocamento != 0) de "desenhado diferente".
//
//   npx tsx tools/comparar-tela.ts <pasta servida> <caminho da pagina> <referencia.png> <tela.json> <saida/>
//       [--espera 1500] [--lista 20]
//
// Grava saida/pagina.png (a captura), saida/diferenca.png (|a - b| x 4) e saida/relatorio.json.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { PNG } from "pngjs";
import WebSocket from "ws";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const espera = Number(opt("espera", "1500"));
const lista = Number(opt("lista", "20"));
const avaliar = opt("avaliar", "");
// --redimensionar 700x1370: a pagina abre nesse tamanho e muda para o da referencia antes da foto
const redim = opt("redimensionar", ""); // uma expressao da pagina para imprimir na hora da foto
const [raiz, pagina, refArq, telaArq, saida] = args;
if (!saida) {
  console.error("uso: tools/comparar-tela.ts <pasta> <pagina> <referencia.png> <tela.json> <saida/> [--espera ms] [--lista N]");
  process.exit(2);
}
mkdirSync(saida, { recursive: true });
const ref = PNG.sync.read(readFileSync(refArq));
const [W, H] = [ref.width, ref.height];

// ---- um servidor de arquivos para a pasta
const TIPOS: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ttf": "font/ttf", ".otf": "font/otf", ".boneco": "application/json" };
const srv = createServer((q, r) => {
  const c = normalize(join(raiz, decodeURIComponent(new URL(q.url!, "http://x").pathname)));
  if (!c.startsWith(normalize(raiz)) || !existsSync(c) || statSync(c).isDirectory()) return r.writeHead(404).end();
  r.writeHead(200, { "content-type": TIPOS[extname(c).toLowerCase()] ?? "application/octet-stream" }).end(readFileSync(c));
});
await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
const porta = (srv.address() as any).port;

// ---- o Chromium sem janela, no tamanho exato da referencia, densidade 1
const prof = mkdtempSync(join(tmpdir(), "comparar-tela-"));
const chrome = spawn("chromium", [`--user-data-dir=${prof}`, "--remote-debugging-port=0", "--no-first-run", "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise<string>((ok) => {
  let b = "";
  chrome.stderr!.on("data", (d) => {
    b += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(b);
    if (m) ok(m[1]);
  });
});
const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.once("open", ok));
let seq = 0;
const pend = new Map<number, (x: any) => void>();
const logs: string[] = [];
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pend.has(m.id)) pend.get(m.id)!(m.error ? Promise.reject(new Error(JSON.stringify(m.error))) : m.result);
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("ERRO: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const cmd = (method: string, params: any = {}, sessionId?: string): Promise<any> =>
  new Promise((ok) => {
    const id = ++seq;
    pend.set(id, ok);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const { targetId } = await cmd("Target.createTarget", { url: "about:blank" });
const { sessionId: s } = await cmd("Target.attachToTarget", { targetId, flatten: true });
await cmd("Runtime.enable", {}, s);
const [W0, H0] = redim ? redim.split("x").map(Number) : [W, H];
await cmd("Emulation.setDeviceMetricsOverride", { width: W0, height: H0, deviceScaleFactor: 1, mobile: false }, s);
await cmd("Page.navigate", { url: `http://127.0.0.1:${porta}/${pagina.replace(/^\//, "")}` }, s);
const t0 = Date.now();
for (;;) {
  const r = await cmd("Runtime.evaluate", { expression: "(window.__quadros > 0 && document.fonts.status === 'loaded')", returnByValue: true }, s);
  if (r?.result?.value) break;
  if (Date.now() - t0 > 30000 || logs.some((l) => l.startsWith("ERRO"))) {
    console.error("a pagina nao desenhou\n" + logs.join("\n"));
    process.exit(1);
  }
  await new Promise((ok) => setTimeout(ok, 100));
}
if (redim) {
  await new Promise((ok) => setTimeout(ok, 800));
  await cmd("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false }, s);
}
await new Promise((ok) => setTimeout(ok, espera));
if (avaliar) console.log("avaliar:", JSON.stringify((await cmd("Runtime.evaluate", { expression: avaliar, returnByValue: true }, s))?.result?.value));
const shot = await cmd("Page.captureScreenshot", { format: "png" }, s);
ws.close();
chrome.kill();
srv.close();
await new Promise((ok) => setTimeout(ok, 300));
rmSync(prof, { recursive: true, force: true, maxRetries: 5 });
const pag = PNG.sync.read(Buffer.from(shot.data, "base64"));
writeFileSync(join(saida, "pagina.png"), PNG.sync.write(pag));
if (pag.width !== W || pag.height !== H) throw new Error(`a captura saiu ${pag.width}x${pag.height}, a referencia e ${W}x${H}`);

// ---- a diferenca
const dif = new PNG({ width: W, height: H });
const d = new Float32Array(W * H);
let soma = 0,
  ruins = 0,
  quad = 0;
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  const e = (Math.abs(pag.data[o] - ref.data[o]) + Math.abs(pag.data[o + 1] - ref.data[o + 1]) + Math.abs(pag.data[o + 2] - ref.data[o + 2])) / 3;
  d[i] = e;
  soma += e;
  quad += e * e;
  if (e > 32) ruins++;
  const v = Math.min(255, e * 4);
  dif.data[o] = v;
  dif.data[o + 1] = v * 0.3;
  dif.data[o + 2] = 0;
  dif.data[o + 3] = 255;
}
writeFileSync(join(saida, "diferenca.png"), PNG.sync.write(dif));

// ---- elemento a elemento: a caixa na tela e o erro dentro; o melhor deslocamento ate 4 px
type El = { nome: string; tipo: string; xf: number[]; ret?: number[]; dst?: number[] };
const tela = JSON.parse(readFileSync(telaArq, "utf8"));
const caixa = (e: El) => {
  const r = e.dst ?? e.ret;
  if (!r) return null;
  const [a, b, c, dd, ex, fy] = e.xf;
  const pts = [
    [r[0], r[1]],
    [r[0] + r[2], r[1]],
    [r[0], r[1] + r[3]],
    [r[0] + r[2], r[1] + r[3]],
  ].map(([x, y]) => [a * x + c * y + ex, b * x + dd * y + fy]);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))),
    y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))),
    x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0])))),
    y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1]))));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
};
const erroEm = ([x0, y0, x1, y1]: number[], dx: number, dy: number) => {
  let s = 0,
    n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const xr = x + dx,
        yr = y + dy;
      if (xr < 0 || yr < 0 || xr >= W || yr >= H) continue;
      const o = (y * W + x) * 4,
        p = (yr * W + xr) * 4;
      s += (Math.abs(pag.data[o] - ref.data[p]) + Math.abs(pag.data[o + 1] - ref.data[p + 1]) + Math.abs(pag.data[o + 2] - ref.data[p + 2])) / 3;
      n++;
    }
  return n ? s / n : 0;
};
// o que esta escondido (o no ou algum de cima) nao conta
const escondido = (nome: string) => {
  let p = "";
  for (const parte of nome.split("/")) if (tela.nos?.[(p = p ? p + "/" + parte : parte)]?.oculto) return true;
  return false;
};
const els = (tela.elementos as El[])
  .filter((e) => (e.tipo === "texto" || e.tipo === "imagem" || e.tipo === "caixa") && !escondido(e.nome))
  .map((e) => {
    const cx = caixa(e);
    return cx ? { nome: e.nome, tipo: e.tipo, caixa: cx, erro: erroEm(cx, 0, 0) } : null;
  })
  .filter((x): x is NonNullable<typeof x> => !!x)
  .sort((a, b) => b.erro - a.erro);
const piores = els.slice(0, lista).map((e) => {
  let melhor = { dx: 0, dy: 0, erro: e.erro };
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const v = erroEm(e.caixa, dx, dy);
      if (v < melhor.erro - 0.05) melhor = { dx, dy, erro: v };
    }
  return { ...e, erro: +e.erro.toFixed(2), deslocar: [melhor.dx, melhor.dy], erroDeslocado: +melhor.erro.toFixed(2) };
});
const rel = {
  tamanho: [W, H],
  erroMedio: +(soma / (W * H)).toFixed(3),
  psnr: +(10 * Math.log10((255 * 255) / Math.max(1e-9, quad / (W * H)))).toFixed(2),
  pixelsRuins: +((100 * ruins) / (W * H)).toFixed(3) + "%",
  piores,
  console: logs.slice(0, 30),
};
writeFileSync(join(saida, "relatorio.json"), JSON.stringify(rel, null, 1));
console.log(`erro medio ${rel.erroMedio}  psnr ${rel.psnr} dB  pixels ruins (>32) ${rel.pixelsRuins}`);
for (const p of piores) console.log(`${p.erro.toFixed(1).padStart(6)}  ${p.tipo.padEnd(6)} ${p.nome.slice(-48).padEnd(48)} ${p.deslocar[0] || p.deslocar[1] ? `melhor em (${p.deslocar}) -> ${p.erroDeslocado}` : ""}`);
if (logs.length) console.log("console:\n  " + logs.slice(0, 10).join("\n  "));
