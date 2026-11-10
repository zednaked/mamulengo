// Capturas de uma pagina em varios tamanhos de janela, num Chromium sem tela (a tela de exemplo:
// exemplos/coelho). Cada tamanho abre a pagina de novo; `--redimensionar` abre no primeiro tamanho e
// muda a janela para cada um dos outros na mesma pagina (o caminho do aoRedimensionar). Escreve
// <saida>/<nome>.png e, com --ossos, a posicao na janela dos ossos pedidos (window.tela.ponto).
//
//   npm run dev  (ou MAMULENGO_PORT=5277 npx vite)
//   npx tsx tools/tela-capturas.ts http://localhost:5277/exemplos/coelho/?quadro=1.5 exemplos/coelho/capturas \
//     celular-9x16=1080x1920 tablet-3x4=1536x2048 desktop-16x9=1920x1080 [--redimensionar] [--ossos botao,placar]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const args = process.argv.slice(2);
const redimensionar = args.includes("--redimensionar");
const ossos = args.includes("--ossos") ? args[args.indexOf("--ossos") + 1].split(",") : [];
const livres = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--ossos");
const [url, saida, ...tams] = livres;
if (!url || !saida || !tams.length) throw new Error("uso: tela-capturas.ts <url> <saida> nome=LxA ... [--redimensionar] [--ossos a,b]");
const janelas = tams.map((t) => {
  const [nome, d] = t.split("=");
  const [w, h] = d.split("x").map(Number);
  return { nome, w, h };
});
mkdirSync(saida, { recursive: true });

const prof = mkdtempSync(join(tmpdir(), "tela-capturas-"));
// o navegador morre junto com este processo (setpriv --pdeathsig)
const chrome = spawn("setpriv", ["--pdeathsig", "KILL", "chromium", `--user-data-dir=${prof}`, "--remote-debugging-port=0", "--no-first-run", "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
  if (m.id && pend.has(m.id)) pend.get(m.id)!(m.error ? { erro: m.error } : m.result);
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("ERRO: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const cmd = (method: string, params: any = {}, sessionId?: string): Promise<any> =>
  new Promise((ok) => {
    const id = ++seq;
    pend.set(id, ok);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const avaliar = async (s: string, e: string) => (await cmd("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, s))?.result?.value;

async function abrir(w: number, h: number) {
  const { targetId } = await cmd("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  await cmd("Runtime.enable", {}, s);
  await cmd("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, s);
  await cmd("Page.navigate", { url }, s);
  await pronta(s);
  return { s, targetId };
}
async function pronta(s: string) {
  const t0 = Date.now();
  for (;;) {
    if (await avaliar(s, "window.pronto === true")) return;
    if (Date.now() - t0 > 30000 || logs.some((l) => l.startsWith("ERRO"))) throw new Error("a pagina nao desenhou\n" + logs.join("\n"));
    await new Promise((ok) => setTimeout(ok, 100));
  }
}
async function capturar(s: string, nome: string) {
  // dois quadros depois do tamanho novo
  await avaliar(s, "new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))");
  const shot = await cmd("Page.captureScreenshot", { format: "png" }, s);
  writeFileSync(join(saida, `${nome}.png`), Buffer.from(shot.data, "base64"));
  const pos = ossos.length ? await avaliar(s, `JSON.stringify(Object.fromEntries(${JSON.stringify(ossos)}.map((o) => [o, window.tela.ponto(o).map((x) => Math.round(x))])))`) : "";
  console.log(`${nome}.png${pos ? " " + pos : ""}`);
}

try {
  if (redimensionar) {
    const { s } = await abrir(janelas[0].w, janelas[0].h);
    for (const j of janelas) {
      await cmd("Emulation.setDeviceMetricsOverride", { width: j.w, height: j.h, deviceScaleFactor: 1, mobile: false }, s);
      await new Promise((ok) => setTimeout(ok, 1200));
      await capturar(s, j.nome);
    }
  } else
    for (const j of janelas) {
      const { s, targetId } = await abrir(j.w, j.h);
      await capturar(s, j.nome);
      await cmd("Target.closeTarget", { targetId });
    }
} finally {
  ws.close();
  chrome.kill("SIGKILL");
  await new Promise((ok) => setTimeout(ok, 300));
  rmSync(prof, { recursive: true, force: true, maxRetries: 5 });
}
if (logs.length) console.log(logs.join("\n"));
