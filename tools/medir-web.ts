// Mede uma pagina web com animacao (um jogo Godot exportado para a web, a demo, o palco): intervalo
// entre quadros (de todos os documentos, iframes incluidos), ocupacao da thread principal, tamanho
// do canvas e a placa de video. Roda num Chromium proprio ou no Chrome de um celular:
//
//   npx tsx tools/medir-web.ts <url> <saida.json> [segundos=30] [--aquecer 5] [--janela] [--lento N]
//                              [--dpr N] [--gl] [--perfil] [--cdp http://127.0.0.1:9222]
//
//   --aquecer N  segundos depois do load antes de medir (a carga trava o laco de proposito)
//   --janela     Chromium com janela (a placa de video de verdade); sem ele, headless
//   --lento N    CPU N vezes mais lenta (aproxima um celular no desktop)
//   --dpr N      densidade de pixels emulada: mostra quanto o tamanho do canvas pesa
//   --gl         conta as chamadas WebGL por quadro (o embrulho custa um pouco)
//   --perfil     5 s de perfil de CPU somado por funcao (e o .cpuprofile ao lado da saida)
//   --cdp URL    usa um navegador ja aberto. Num celular Android com depuracao USB e o Chrome
//                aberto:  adb forward tcp:9222 localabstract:chrome_devtools_remote
//                e, para uma pagina servida neste computador na porta P:  adb reverse tcp:P tcp:P
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args.splice(i, 1).length > 0;
};
const cdp = opt("cdp", "");
const lento = Number(opt("lento", "1"));
const dpr = Number(opt("dpr", "0"));
const aquecer = Number(opt("aquecer", "5"));
const janela = flag("janela");
const contarGl = flag("gl");
const perfil = flag("perfil");
const [url, saida, secs = "30"] = args;
if (!url || !saida) {
  console.error("uso: tools/medir-web.ts <url> <saida.json> [segundos] [--aquecer 5] [--janela] [--lento N] [--dpr N] [--gl] [--perfil] [--cdp URL]");
  process.exit(2);
}

// o navegador: o do --cdp ou um Chromium com perfil novo
const prof = cdp ? "" : mkdtempSync(join(tmpdir(), "medir-web-"));
const chrome = cdp
  ? null
  : spawn("chromium", [`--user-data-dir=${prof}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--window-size=540,1000", "--autoplay-policy=no-user-gesture-required", ...(janela ? [] : ["--headless=new"]), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
// o Chrome do Android devolve o endereco sem a porta do forward: vale o caminho, com o host do --cdp
const wsUrl = cdp
  ? `ws://${new URL(cdp).host}${new URL(((await (await fetch(`${cdp}/json/version`)).json()) as any).webSocketDebuggerUrl).pathname}`
  : await new Promise<string>((ok) => {
      let b = "";
      chrome!.stderr!.on("data", (d) => {
        b += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(b);
        if (m) ok(m[1]);
      });
    });
const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.once("open", ok));
// o navegador sumiu no meio (celular desconectado do adb): sai com erro em vez de esperar para sempre
let terminou = false;
ws.on("close", () => {
  if (terminou) return;
  console.error("a conexao com o navegador caiu (no celular: confira adb devices e refaca o forward e o reverse)");
  process.exit(1);
});
let seq = 0;
const pend = new Map<number, (x: any) => void>();
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pend.has(m.id)) pend.get(m.id)!(m.result ?? m.error);
});
const send = (method: string, params: any = {}, sessionId?: string) =>
  new Promise<any>((ok) => {
    const i = ++seq;
    pend.set(i, ok);
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// roda em todo documento (a pagina e os iframes): os quadros e, com --gl, as chamadas WebGL
const SONDA = `(() => {
  const m = (window.__med = { quadros: [] });
  let ult = 0;
  const q = (t) => { if (ult) m.quadros.push([Date.now(), t - ult]); ult = t; if (m.quadros.length > 20000) m.quadros.shift(); requestAnimationFrame(q); };
  requestAnimationFrame(q);
  if (${JSON.stringify(contarGl)} && window.WebGL2RenderingContext) {
    const cont = (m.gl = { quadros: 0, chamadas: {} });
    const P = WebGL2RenderingContext.prototype;
    for (const k of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "bufferData", "bufferSubData", "texSubImage2D", "texImage2D", "useProgram", "bindTexture", "getParameter", "readPixels", "bindFramebuffer"]) {
      const orig = P[k];
      if (orig) P[k] = function (...a) { cont.chamadas[k] = (cont.chamadas[k] || 0) + 1; return orig.apply(this, a); };
    }
    const fq = () => { cont.quadros++; requestAnimationFrame(fq); };
    requestAnimationFrame(fq);
  }
})();`;

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Page.addScriptToEvaluateOnNewDocument", { source: SONDA }, sessionId);
if (lento > 1) await send("Emulation.setCPUThrottlingRate", { rate: lento }, sessionId);
if (dpr) await send("Emulation.setDeviceMetricsOverride", { width: 0, height: 0, deviceScaleFactor: dpr, mobile: true }, sessionId);
const t0 = Date.now();
await send("Page.navigate", { url }, sessionId);
const ev = async (expr: string) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
while (Date.now() - t0 < 120000 && (await ev("document.readyState")) !== "complete") await espera(100);
const carga = Date.now() - t0;
await espera(aquecer * 1000);

// ocupacao da thread principal no intervalo (TaskDuration e ScriptDuration do CDP)
await send("Performance.enable", {}, sessionId);
const met = async () => Object.fromEntries((await send("Performance.getMetrics", {}, sessionId)).metrics.map((m: any) => [m.name, m.value]));
const m0 = await met();
const desde = Date.now();
await ev(`(() => { for (const w of [window, ...[...document.querySelectorAll("iframe")].map((i) => { try { return i.contentWindow; } catch { return null; } })]) { const g = w && w.__med && w.__med.gl; if (g) { g.quadros = 0; g.chamadas = {}; } } })()`);
await espera(+secs * 1000);
const m1 = await met();

let topo: any[] | null = null;
if (perfil) {
  await send("Profiler.enable", {}, sessionId);
  await send("Profiler.setSamplingInterval", { interval: 200 }, sessionId);
  await send("Profiler.start", {}, sessionId);
  await espera(5000);
  const { profile } = await send("Profiler.stop", {}, sessionId);
  writeFileSync(saida.replace(/\.json$/, ".cpuprofile"), JSON.stringify(profile));
  const proprio = new Map<number, number>();
  (profile.samples as number[]).forEach((id, i) => proprio.set(id, (proprio.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const soma = new Map<string, number>();
  let total = 0;
  for (const n of profile.nodes) {
    const t = proprio.get(n.id) ?? 0;
    total += t;
    const nome = `${n.callFrame.functionName || "(anonima)"} ${n.callFrame.url ? n.callFrame.url.split("/").pop() : ""}`.trim();
    soma.set(nome, (soma.get(nome) ?? 0) + t);
  }
  topo = [...soma].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([nome, t]) => ({ nome, ms_por_s: +(t / 1000 / 5).toFixed(2), fracao: +(t / total).toFixed(4) }));
}
const dur = m1.Timestamp - m0.Timestamp;
const ocupacao = { segundos: +dur.toFixed(2), tarefas: +((m1.TaskDuration - m0.TaskDuration) / dur).toFixed(4), script: +((m1.ScriptDuration - m0.ScriptDuration) / dur).toFixed(4) };

// o documento que tem o canvas maior (o jogo pode estar num iframe do mesmo dominio)
const dados = await ev(`(() => {
  const docs = [window, ...[...document.querySelectorAll("iframe")].map((i) => { try { return i.contentWindow; } catch { return null; } }).filter(Boolean)];
  const area = (w) => { try { const c = w.document.querySelector("canvas"); return c ? c.width * c.height : 0; } catch { return 0; } };
  const w = docs.sort((a, b) => area(b) - area(a))[0];
  const q = (w.__med?.quadros ?? []).filter(([em]) => em > ${desde}).map(([, dt]) => dt);
  const s = [...q].sort((a, b) => a - b);
  const p = (x) => (s.length ? +s[Math.min(s.length - 1, Math.floor(x * s.length))].toFixed(2) : null);
  const c = w.document.querySelector("canvas");
  let gl = null;
  try { const g = c && (c.getContext("webgl2") || c.getContext("webgl")); const d = g && g.getExtension("WEBGL_debug_renderer_info"); gl = d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; } catch {}
  const g0 = w.__med?.gl;
  const chamadas_gl = g0 ? Object.fromEntries(Object.entries(g0.chamadas).map(([k, v]) => [k, +(v / Math.max(1, g0.quadros)).toFixed(1)])) : null;
  return { quadros: { n: q.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: s.length ? +s[s.length - 1].toFixed(2) : null, acima_25ms: q.filter((x) => x > 25).length }, canvas: c ? [c.width, c.height] : null, dpr: w.devicePixelRatio, gl, chamadas_gl_por_quadro: chamadas_gl };
})()`);
const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
writeFileSync(saida.replace(/\.json$/, ".png"), Buffer.from(shot.data, "base64"));
const out = { url, quando: new Date().toISOString(), carga_ms: carga, lento, dpr_emulado: dpr || null, ocupacao, perfil: topo, ...dados };
writeFileSync(saida, JSON.stringify(out, null, 1));
const q = dados.quadros;
console.log(`quadros p50 ${q.p50} p95 ${q.p95} max ${q.max} (${q.acima_25ms} acima de 25 ms em ${secs} s); thread principal ${(ocupacao.tarefas * 100).toFixed(1)}% (script ${(ocupacao.script * 100).toFixed(1)}%); canvas ${dados.canvas?.join(" x ")} a ${(+dados.dpr).toFixed(2)}x; ${dados.gl}`);

await send("Target.closeTarget", { targetId });
terminou = true;
ws.close();
if (chrome) {
  chrome.kill();
  await new Promise((ok) => chrome.once("exit", ok));
  rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
