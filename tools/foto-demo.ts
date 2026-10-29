// Fotos da demo ao vivo num Chromium headless (CDP), para conferir e para a imagem de previa.
//
//   npx tsx tools/foto-demo.ts social <url> [docs/media/social.png]
//       a previa de 1280 x 640 (<url>?social=1: quadro fixo, reprodutivel)
//   npx tsx tools/foto-demo.ts foto <url> <saida.png> [--celular] [--arrastar] [--cem] [--lang pt] [--segundos 4] [--gpu] [--um 3]
//       desktop 1440 x 900 ou celular 390 x 844 (toque); --arrastar pega o ciclope e o sacode
//       (foto no meio do arrasto); --cem liga as 100 copias. Escreve o fps e o custo medidos.
//
// Sirva a demo antes: npm run build:demo && python -m http.server -d dist-demo 8765
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return d;
  return args.splice(i, 2)[1];
};
const celular = flag("celular"),
  arrastar = flag("arrastar"),
  cem = flag("cem"),
  gpu = flag("gpu");
const lang = opt("lang", "");
const um = Number(opt("um", "0")); // 1..6: so esse personagem (a ficha do elenco), grande
const segundos = Number(opt("segundos", "4"));
const [acao, base, saidaArg] = args;
if (!["social", "foto"].includes(acao) || !base) {
  console.error("uso: foto-demo.ts social <url> [saida.png] | foto <url> <saida.png> [--celular] [--arrastar] [--cem] [--lang pt]");
  process.exit(2);
}
const social = acao === "social";
const saida = saidaArg ?? (social ? "docs/media/social.png" : "demo.png");
const [w, h, dpr] = social ? [1280, 640, 1] : celular ? [390, 844, 3] : [1440, 900, 1];
const url = new URL(base);
if (social) url.searchParams.set("social", "1");
if (lang) url.searchParams.set("lang", lang);

const perfil = mkdtempSync(join(tmpdir(), "foto-demo-"));
// SwiftShader: o mesmo resultado em qualquer maquina (a previa sai igual); --gpu usa a placa de
// video, para medir o fps de verdade (o SwiftShader desenha na CPU)
const gl = gpu ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=gl"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const chrome = spawn("chromium", ["--headless=new", `--user-data-dir=${perfil}`, "--remote-debugging-port=0", ...gl, "--hide-scrollbars", `--window-size=${w},${h}`, "--font-render-hinting=none", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise<string>((ok, falha) => {
  let b = "";
  chrome.stderr.on("data", (d) => {
    b += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(b);
    if (m) ok(m[1]);
  });
  chrome.once("exit", () => falha(new Error(`o chromium saiu: ${b.slice(-400)}`)));
});
const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.once("open", ok));
let id = 0;
const pend = new Map<number, (x: any) => void>();
const logs: string[] = [];
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pend.has(m.id)) pend.get(m.id)!(m.result ?? m.error);
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push(`ERRO ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
});
const send = (method: string, params: any = {}, sessionId?: string) =>
  new Promise<any>((ok) => {
    const i = ++id;
    pend.set(i, ok);
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: s } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Runtime.enable", {}, s);
await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: celular }, s);
if (celular) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, s);
await send("Page.navigate", { url: url.href }, s);
const avaliar = async (expr: string) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s))?.result?.value;
for (let i = 0; i < 100 && !(await avaliar("document.body?.dataset.pronto === '1'")); i++) await espera(100);

async function foto(arq: string) {
  const r = await send("Page.captureScreenshot", { format: "png" }, s);
  writeFileSync(arq, Buffer.from(r.data, "base64"));
  console.log(arq);
}

if (social) {
  await espera(300);
  await foto(saida);
} else {
  if (um) await avaliar(`document.querySelectorAll("#personagens .ficha")[${um}].click()`);
  if (cem) await avaliar("document.getElementById('copias').click()");
  await espera(segundos * 1000);
  if (arrastar) {
    // pega o ciclope pelo meio do corpo e sacode de um lado para o outro
    const p = await avaliar("(() => { const a = __demo.atores().find((x) => x.nome === 'monstro2'); return __demo.telaDe(a.origem.x, a.origem.y + 120); })()");
    const toque = async (type: string, x: number, y: number) =>
      celular
        ? send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] }, s)
        : send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 }, s);
    const [ini, mov, fim] = celular ? ["touchStart", "touchMove", "touchEnd"] : ["mousePressed", "mouseMoved", "mouseReleased"];
    await toque(ini, p.x, p.y);
    const amp = celular ? 70 : 160;
    for (let i = 1; i <= 40; i++) {
      await toque(mov, p.x + Math.sin(i / 3) * amp, p.y - Math.min(i, 12) * 6);
      await espera(16);
    }
    await foto(saida.replace(/\.png$/, "-arrasto.png"));
    await toque(fim, p.x + Math.sin(40 / 3) * amp, p.y - 72);
    await espera(250);
    await foto(saida.replace(/\.png$/, "-solto.png"));
    await espera(1500);
  }
  await foto(saida);
  const placa = "(() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; })()";
  console.log("medido:", JSON.stringify(await avaliar("__demo.estat()")), "placa:", await avaliar(placa));
}
if (logs.length) console.log(logs.slice(-10).join("\n"));
ws.close();
chrome.kill();
await new Promise((ok) => chrome.once("exit", ok));
rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
