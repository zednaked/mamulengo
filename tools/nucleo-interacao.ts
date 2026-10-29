// Conferencia da interacao no modo "nucleo" (etapa B: o viewer sem o esqueleto do spine-core)
// contra o modo "spine", no editor de verdade com mouse de verdade: sobe um editor proprio com
// os personagens CC0 (tests/assets) e um Chromium headless (SwiftShader) e, pelo protocolo de
// depuracao do Chromium, clica e arrasta no viewport como uma pessoa. Em cada personagem e nos
// dois modos:
//
// - clique (escolher parte e osso) numa grade de pontos sobre a caixa do personagem, na pose base e no
//   meio de uma animacao, e com os ossos a mostra no meio de cada osso;
// - arrasto de osso (mover, girar, esticar) na pose base e com a animacao aberta (vira chave);
// - edicao de malha: arrastar um ponto, criar um no contorno e pintar peso.
//
// Compara o que foi escolhido, o documento depois de cada edicao (numeros) e a imagem (o
// mesmo enquadramento nos dois modos). Confere tambem que, no modo "nucleo", nenhum
// esqueleto do spine-core foi lido ou posado (SkeletonJson.readSkeletonData e
// Skeleton.updateWorldTransform contados na pagina).
//
//   npx tsx tools/nucleo-interacao.ts [--port 5208] [--grade 14] [--tol 1.5] [--out dir]
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import WebSocket from "ws";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const port = Number(opt("port", "5208"));
const portaCdp = port + 1000;
const grade = Number(opt("grade", "14"));
const tol = Number(opt("tol", "1.5"));
const out = resolve(opt("out", join(tmpdir(), "mamulengo-nucleo-interacao")));
const LADO = 480;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const kids: ChildProcess[] = [];
const stop = () => {
  for (const k of kids)
    try {
      if (k.pid) process.kill(-k.pid, "SIGTERM");
    } catch {}
};
process.on("exit", stop);
process.on("SIGINT", () => (stop(), process.exit(130)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms: number) {
  for (let t = 0; t < ms; t += 500) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`nao respondeu: ${url}`);
}

const env = { ...process.env, MAMULENGO_ROOTS: join(REPO, "tests/assets"), MAMULENGO_PORT: String(port), MAMULENGO_ESTAVEL: "1" };
kids.push(spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: REPO, env, detached: true, stdio: ["ignore", openSync(join(out, "vite.log"), "w"), openSync(join(out, "vite.log"), "a")] }));
await waitHttp(`http://localhost:${port}/`, 60_000);
const profile = mkdtempSync(join(tmpdir(), "nucleo-interacao-chromium-"));
kids.push(
  spawn(
    "chromium",
    ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1400,900", `--user-data-dir=${profile}`, "--no-first-run", `--remote-debugging-port=${portaCdp}`, `http://localhost:${port}/?acompanhar=0&runtime=spine`],
    { detached: true, stdio: ["ignore", openSync(join(out, "chromium.log"), "w"), openSync(join(out, "chromium.log"), "a")] },
  ),
);

// ---- ponte (como o MCP)
const ws = new WebSocket(`ws://localhost:${port}/__mamulengo`);
await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
let editors = 0;
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === "status") editors = m.editors;
});
ws.send(JSON.stringify({ t: "hello", role: "agent", name: "nucleo-interacao" }));
for (let t = 0; !editors; t += 250) {
  if (t > 60_000) throw new Error("o editor nao conectou na ponte");
  await sleep(250);
}
let seq = 0;
const call = (method: string, params: any = {}) =>
  new Promise<any>((ok, fail) => {
    const id = String(++seq);
    const h = (raw: any) => {
      const r = JSON.parse(String(raw));
      if (r.t !== "reply" || r.id !== id) return;
      ws.off("message", h);
      r.ok ? ok(r.result) : fail(new Error(`${method}: ${r.error}`));
    };
    ws.on("message", h);
    ws.send(JSON.stringify({ t: "call", id, method, params }));
  });

// ---- Chromium (CDP): mouse de verdade e avaliar na pagina
await waitHttp(`http://localhost:${portaCdp}/json`, 30_000);
const tabs = await (await fetch(`http://localhost:${portaCdp}/json`)).json();
const cdp = new WebSocket(tabs.find((t: any) => t.type === "page").webSocketDebuggerUrl);
await new Promise((ok, fail) => (cdp.once("open", ok), cdp.once("error", fail)));
let cid = 0;
const send = (method: string, params: any = {}) =>
  new Promise<any>((ok, fail) => {
    const my = ++cid;
    const h = (raw: any) => {
      const m = JSON.parse(String(raw));
      if (m.id !== my) return;
      cdp.off("message", h);
      m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result);
    };
    cdp.on("message", h);
    cdp.send(JSON.stringify({ id: my, method, params }));
  });
// avalia uma expressao na pagina (com `v` = viewer e `app` = estado do editor)
async function ev<T = any>(js: string): Promise<T> {
  // o resultado volta como texto JSON (os objetos do estado do Svelte sao Proxy, que o CDP nao copia)
  const r = await send("Runtime.evaluate", { expression: `(async () => { const app = window.mamulengo, v = app.viewer; return JSON.stringify(await (async () => { ${js} })() ?? null); })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`na pagina: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return JSON.parse(r.result.value) as T;
}
const mouse = (type: string, x: number, y: number, buttons = 1, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1, modifiers });
async function click(p: number[]) {
  await mouse("mouseMoved", p[0], p[1], 0);
  await mouse("mousePressed", p[0], p[1]);
  await mouse("mouseReleased", p[0], p[1]);
}
async function arrasta(a: number[], b: number[], passos = 8, modifiers = 0) {
  await mouse("mouseMoved", a[0], a[1], 0);
  await mouse("mousePressed", a[0], a[1], 1, modifiers);
  for (let i = 1; i <= passos; i++) await mouse("mouseMoved", a[0] + ((b[0] - a[0]) * i) / passos, a[1] + ((b[1] - a[1]) * i) / passos, 1, modifiers);
  await mouse("mouseReleased", b[0], b[1], 1, modifiers);
  // o viewer le o documento no proximo quadro
  await ev("v.sync(); v.draw();");
}
// mundo (visual, y para cima) -> tela (px CSS da pagina)
const tela = (x: number, y: number) => ev<number[]>(`const p = v.worldToScreen(${x}, ${y}); return [p.x, p.y];`);

// o guia de primeira vez cobre o viewport (perfil novo do Chromium): fecha e nao volta
await ev(`localStorage.setItem("mamulengo.onboarded", "1"); document.querySelector(".back")?.click();`);

// contadores do spine-core na pagina: o mesmo modulo que o editor usa (a URL do vite)
await ev(`
  if (window.__spine) return;
  const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\.vite\\/deps\\/@esotericsoftware_spine-(webgl|core)\\.js/.test(n));
  if (!urls.length) throw new Error("modulo do spine-core nao achado");
  // por quem pediu: os comandos e a ficha (etapa C) a parte do resto (viewer e interacao)
  const c = (window.__spine = { lidos: 0, posados: 0, lidosC: 0, posadosC: 0, pilhas: {} });
  const deC = () => {
    const p = new Error().stack;
    if (/core\\/commands\\/|core\\/ficha\\.ts/.test(p)) return true;
    const k = p.split("\\n").slice(2, 7).map((l) => l.trim().replace(/https?:[^)]*\\/src\\//, "").replace(/\\?[^:]*/, "")).join(" < ");
    c.pilhas[k] = (c.pilhas[k] ?? 0) + 1;
    return false;
  };
  for (const u of urls) {
    const m = await import(u);
    const P = m.Skeleton.prototype, J = m.SkeletonJson.prototype;
    if (!P.__contado) {
      const f = P.updateWorldTransform;
      P.updateWorldTransform = function (...a) { if (deC()) c.posadosC++; else c.posados++; return f.apply(this, a); };
      P.__contado = true;
    }
    if (!J.__contado) {
      const g = J.readSkeletonData;
      J.readSkeletonData = function (...a) { if (deC()) c.lidosC++; else c.lidos++; return g.apply(this, a); };
      J.__contado = true;
    }
  }
`);
type Contagem = { lidos: number; posados: number; lidosC: number; posadosC: number };
const contadores = () => ev<Contagem>("const { pilhas, ...c } = window.__spine; return c;");

// ---- comparacoes

const png = (url: string) => PNG.sync.read(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
function diff(a: PNG, b: PNG) {
  let n = 0,
    pior = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > 8) n++;
    pior = Math.max(pior, d);
  }
  return { pct: (100 * n) / (a.width * a.height), pior };
}
function salvaPar(nome: string, a: PNG, b: PNG) {
  const o = new PNG({ width: a.width * 2, height: a.height });
  for (let y = 0; y < a.height; y++) {
    a.data.copy(o.data, y * o.width * 4, y * a.width * 4, (y + 1) * a.width * 4);
    b.data.copy(o.data, (y * o.width + a.width) * 4, y * a.width * 4, (y + 1) * a.width * 4);
  }
  writeFileSync(join(out, `${nome}.png`), PNG.sync.write(o));
}
// maior diferenca entre numeros de dois JSON (estrutura diferente: Infinity)
function difNum(a: any, b: any, onde = "", pior = { d: 0, onde: "" }): { d: number; onde: string } {
  if (typeof a === "number" && typeof b === "number") {
    const d = Math.abs(a - b);
    if (d > pior.d) Object.assign(pior, { d, onde });
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of ks) {
      if (!(k in a) || !(k in b)) {
        // valor padrao que um modo escreveu e o outro nao (ex.: y 0)
        const x = a[k] ?? 0,
          y = b[k] ?? 0;
        if (typeof x === "number" && typeof y === "number") difNum(x, y, `${onde}.${k}`, pior);
        else Object.assign(pior, { d: Infinity, onde: `${onde}.${k}` });
      } else difNum(a[k], b[k], `${onde}.${k}`, pior);
    }
  } else if (a !== b) Object.assign(pior, { d: Infinity, onde });
  return pior;
}

// ---- roteiro de um personagem num modo: devolve o que foi escolhido, os documentos e imagens

type Resultado = { picks: string[]; docs: Record<string, any>; imagens: Record<string, string>; spine: Contagem; pilhas: any; viewer: any; edicoes: string[] };

async function roteiro(asset: any, runtime: "spine" | "nucleo", cam: any, rect: number[], alvo: number[]): Promise<Resultado> {
  await call("discard");
  await call("open", { id: asset.id });
  await call("view", { runtime, playing: false, showBones: false, showMeshes: false });
  const st = await call("state");
  if (runtime === "nucleo" && !st.view.nucleo?.drawing) throw new Error(`${asset.name}: o nucleo nao esta desenhando: ${st.view.nucleoError}`);
  const c0 = await contadores();
  await ev("window.__spine.pilhas = {};");
  const r: Resultado = { picks: [], docs: {}, imagens: {}, spine: { lidos: 0, posados: 0, lidosC: 0, posadosC: 0 }, pilhas: null, viewer: null, edicoes: [] };
  const poe = (js = "") => ev(`app.tool = "move"; Object.assign(v.cam, ${JSON.stringify(cam)}); v.view.playing = false; ${js} v.sync(); v.draw();`);
  const anim: string = (await ev<string[]>("return v.animationNames();"))[0];
  const dur: number = await ev(`return v.animDuration(${JSON.stringify(anim)});`);
  const meio = +(dur / 3).toFixed(4);
  const imagem = async (nome: string, animation: string | null, t: number) => {
    r.imagens[nome] = (await call("render", { animation, times: [t], rect, size: [LADO, LADO], background: [0.169, 0.145, 0.192] })).images[0];
    await poe();
  };

  // 1. clique: grade sobre o personagem, na pose base e no meio da animacao
  for (const [nome, js] of [
    ["base", `app.mode = "setup";`],
    ["anim", `app.mode = "animate"; v.setAnimation(${JSON.stringify(anim)}); app.play.animation = ${JSON.stringify(anim)}; v.seek(${meio});`],
  ] as const) {
    await poe(js + " v.view.showBones = false;");
    for (let i = 0; i < grade; i++)
      for (let j = 0; j < grade; j++) {
        const x = alvo[0] + (alvo[2] * (i + 0.5)) / grade,
          y = alvo[1] + (alvo[3] * (j + 0.5)) / grade;
        await ev("app.select({});");
        await click(await tela(x, y));
        const s = await ev<any>("return app.selection;");
        r.picks.push(`${nome} ${i},${j}: ${s.slot ?? "-"}/${s.bone ?? "-"}`);
      }
    // ossos a mostra: clique no meio de cada osso (pickBone)
    await poe("v.view.showBones = true;");
    const meios = await ev<[string, number, number][]>("return v.pose.bones.map((b) => [b.name, b.worldX + b.a * b.length / 2, b.worldY + b.c * b.length / 2]);");
    for (const [b, x, y] of meios) {
      await ev("app.select({});");
      await click(await tela(x, y));
      const s = await ev<any>("return app.selection;");
      r.picks.push(`${nome} osso ${b}: ${s.slot ?? "-"}/${s.bone ?? "-"}`);
    }
    await poe("v.view.showBones = false;");
  }

  // 2. arrasto de osso: um membro (osso com comprimento a 3 niveis da raiz, ou o mais fundo),
  // mover, girar e esticar; na pose base e na animacao
  const osso: string = await ev(`const fundo = (b) => (b.parent ? 1 + fundo(b.parent) : 0);
    const c = v.pose.bones.filter((b) => b.length > 0).sort((a, b) => Math.abs(fundo(a) - 3) - Math.abs(fundo(b) - 3));
    return (c[0] ?? v.pose.bones[1]).name;`);
  for (const [nome, js] of [
    ["base", `app.mode = "setup";`],
    ["anim", `app.mode = "animate"; v.setAnimation(${JSON.stringify(anim)}); app.play.animation = ${JSON.stringify(anim)}; v.seek(${meio});`],
  ] as const) {
    for (const tool of ["move", "rotate", "scale"]) {
      await poe(js + ` app.select({ bone: ${JSON.stringify(osso)} });`);
      await ev(`app.tool = "${tool}";`);
      const o = await ev<number[]>(`const b = v.pose.findBone(${JSON.stringify(osso)}); const p = v.worldToScreen(b.worldX, b.worldY); return [p.x, p.y];`);
      // perto da origem (menos de 60 px: arrasta sem escolher de novo)
      const a = tool === "move" ? [o[0] + 6, o[1] + 4] : [o[0] + 40, o[1]];
      const b = tool === "move" ? [o[0] + 36, o[1] - 18] : tool === "rotate" ? [o[0] + 12, o[1] - 38] : [o[0] + 58, o[1]];
      await arrasta(a, b);
    }
    r.docs[`osso ${nome}`] = await ev(`const j = app.doc.json; return { setup: j.bones.find((b) => b.name === ${JSON.stringify(osso)}), chaves: j.animations[${JSON.stringify(anim)}]?.bones?.[${JSON.stringify(osso)}] ?? null };`);
    await imagem(`osso ${nome}`, nome === "base" ? null : anim, nome === "base" ? 0 : meio);
  }

  // cebola e desenho de depuracao (ossos, malhas, caixas), no meio da animacao: o viewer
  // renderiza com eles ligados (o render da ponte desliga os gizmos)
  const tela2 = async (nome: string, js: string) => {
    await poe(`app.mode = "animate"; v.setAnimation(${JSON.stringify(anim)}); app.play.animation = ${JSON.stringify(anim)}; v.seek(${meio}); app.select({});`);
    r.imagens[nome] = await ev(`v.view.background = [0.169, 0.145, 0.192]; ${js} v.view.playing = false; const c = v.renderRect(${JSON.stringify(rect)}, [${LADO}, ${LADO}]).toDataURL("image/png"); v.onion.enabled = false; v.view.showBones = v.view.showMeshes = v.view.showBounds = false; return c;`);
  };
  await tela2("cebola", "v.onion.enabled = true;");
  await tela2("depuracao", "v.view.showBones = v.view.showMeshes = v.view.showBounds = true;");

  // 3. malha (na pose base): arrastar o ponto 0, criar um ponto no contorno, pintar peso
  const malha = await ev<any>(`
    app.mode = "setup";
    for (const sk of app.doc.json.skins) for (const [slot, as] of Object.entries(sk.attachments)) for (const [nome, a] of Object.entries(as))
      if (a.type === "mesh") return { slot, nome, skin: sk.name, bone: app.doc.json.slots.find((s) => s.name === slot).bone };
    return null;`);
  if (malha) {
    await poe(`app.mode = "setup"; app.select({ slot: ${JSON.stringify(malha.slot)}, bone: ${JSON.stringify(malha.bone)} });
      app.meshEdit = { slot: ${JSON.stringify(malha.slot)}, attachment: ${JSON.stringify(malha.nome)}, skin: ${JSON.stringify(malha.skin)}, tab: "points", vertex: null, bone: ${JSON.stringify(malha.bone)}, paint: "add", strength: 0.5, stretch: false };`);
    await sleep(50);
    const vs = await ev<number[]>(`const s = v.pose.findSlot(${JSON.stringify(malha.slot)}); const o = []; const n = v.pose.vertices(s, o); return o.slice(0, n);`);
    const p0 = await tela(vs[0], vs[1]);
    await arrasta(p0, [p0[0] + 14, p0[1] + 9]);
    const vs2 = await ev<number[]>(`const s = v.pose.findSlot(${JSON.stringify(malha.slot)}); const o = []; const n = v.pose.vertices(s, o); return o.slice(0, n);`);
    // meio da aresta do contorno entre os pontos 1 e 2
    await click(await tela((vs2[2] + vs2[4]) / 2, (vs2[3] + vs2[5]) / 2));
    await ev("v.sync(); v.draw();");
    // pesos: um traco do primeiro ponto ao centro da malha
    const n = vs2.length / 2;
    let cx = 0,
      cy = 0;
    for (let k = 0; k < n; k++) (cx += vs2[2 * k] / n), (cy += vs2[2 * k + 1] / n);
    await ev(`app.meshEdit.tab = "weights";`);
    await arrasta(await tela(vs2[0], vs2[1]), await tela(cx, cy), 10);
    await ev(`app.meshEdit = null;`);
    r.docs.malha = await ev(`for (const sk of app.doc.json.skins) { const a = sk.attachments?.[${JSON.stringify(malha.slot)}]?.[${JSON.stringify(malha.nome)}]; if (a) return a; } return null;`);
    await imagem("malha", null, 0);
    // e a malha editada numa pose animada (pesos novos puxando)
    await imagem("malha anim", anim, meio);
  }
  const c1 = await contadores();
  r.pilhas = await ev("return window.__spine.pilhas;");
  r.edicoes = await ev("return app.doc.history().map((h) => h.label);");
  r.spine = { lidos: c1.lidos - c0.lidos, posados: c1.posados - c0.posados, lidosC: c1.lidosC - c0.lidosC, posadosC: c1.posadosC - c0.posadosC };
  r.viewer = (await call("state")).view.spineCore;
  return r;
}

// ---- casos

const linhas: any[] = [];
let falhas = 0;
const assets = (await call("assets")).filter((a: any) => a.id.startsWith(join(REPO, "tests/assets")));
if (!assets.length) throw new Error("nenhum personagem de tests/assets nas raizes do editor");
for (const a of assets) {
  const { info } = await call("discard").then(() => call("open", { id: a.id }));
  const s = info.size;
  let rect: number[];
  if (s?.width > 0 && s?.height > 0) {
    const m = 0.08 * Math.max(s.width, s.height);
    const lado = Math.max(s.width, s.height) + 2 * m;
    rect = [s.x + s.width / 2 - lado / 2, s.y + s.height / 2 - lado / 2, lado, lado];
  } else rect = [-400, -100, 800, 800];
  // a mesma camera nos dois modos: o retangulo inteiro na tela
  const cam = await ev(`const r = ${JSON.stringify(rect)}; v.frameRect(r, 1.05); return { ...v.cam };`);
  // a grade dos cliques cobre a caixa do personagem na pose base (a mesma nos dois modos)
  const alvo = await ev<number[]>(`app.mode = "setup"; return v.currentBounds();`);
  const R: Record<string, Resultado> = {};
  for (const runtime of ["spine", "nucleo"] as const) R[runtime] = await roteiro(a, runtime, cam, rect, alvo);
  const S = R.spine,
    N = R.nucleo;
  // escolhas
  const dif = S.picks.filter((p, i) => p !== N.picks[i]);
  const okP = dif.length <= Math.ceil(S.picks.length * 0.01);
  if (!okP) falhas++;
  writeFileSync(join(out, `${a.name}-picks.txt`), S.picks.map((p, i) => `${p === N.picks[i] ? " " : "*"} ${p}  |  ${N.picks[i]}`).join("\n"));
  const comParte = S.picks.filter((p) => !p.endsWith(": -/-")).length;
  linhas.push({ personagem: a.name, caso: `clique (${S.picks.length}, ${comParte} acertam algo)`, diferencas: dif.length, "pior numero": "", "imagem %": "", ok: okP ? "ok" : "FALHA" });
  if (dif.length) console.log(`${a.name}: escolhas diferentes\n  ${dif.slice(0, 8).join("\n  ")}`);
  // as edicoes aconteceram (3 arrastos na Pose base, 3 com a animacao, 3 na malha) e iguais
  const okE = S.edicoes.length >= 9 && JSON.stringify(S.edicoes) === JSON.stringify(N.edicoes);
  if (!okE) falhas++;
  linhas.push({ personagem: a.name, caso: `edicoes: ${N.edicoes.join(", ")}`, diferencas: okE ? 0 : JSON.stringify(S.edicoes), "pior numero": "", "imagem %": "", ok: okE ? "ok" : "FALHA" });
  // documentos e imagens
  for (const k of Object.keys(S.docs)) {
    const d = difNum(S.docs[k], N.docs[k]);
    const ok = d.d < 0.01;
    if (!ok) falhas++;
    linhas.push({ personagem: a.name, caso: `documento: ${k}`, diferencas: d.d ? d.onde : 0, "pior numero": d.d === Infinity ? "estrutura" : +d.d.toExponential(2), "imagem %": "", ok: ok ? "ok" : "FALHA" });
  }
  for (const k of Object.keys(S.imagens)) {
    const A = png(S.imagens[k]),
      B = png(N.imagens[k]);
    const d = diff(A, B);
    salvaPar(`${a.name}-${k.replace(/[^\w.-]+/g, "_")}`, A, B);
    const ok = d.pct <= tol;
    if (!ok) falhas++;
    linhas.push({ personagem: a.name, caso: `imagem: ${k}`, diferencas: "", "pior numero": d.pior, "imagem %": +d.pct.toFixed(3), ok: ok ? "ok" : "FALHA" });
  }
  // nenhum esqueleto do spine-core no modo nucleo (e o contador funciona: o modo spine conta)
  const okS = N.spine.lidos === 0 && N.spine.posados === 0 && !N.viewer.skeleton && !N.viewer.data && S.spine.posados > 0;
  if (!okS) {
    falhas++;
    console.log(`${a.name}: spine-core no modo nucleo, de onde:`, JSON.stringify(N.pilhas, null, 1));
  }
  linhas.push({ personagem: a.name, caso: `spine-core no viewer e na interacao (modo nucleo): ${N.spine.lidos} leituras, ${N.spine.posados} poses (modo spine: ${S.spine.lidos}, ${S.spine.posados})`, diferencas: "", "pior numero": "", "imagem %": "", ok: okS ? "ok" : "FALHA" });
  linhas.push({ personagem: a.name, caso: `spine-core nos comandos e na ficha (etapa C), modo nucleo: ${N.spine.lidosC} leituras, ${N.spine.posadosC} poses`, diferencas: "", "pior numero": "", "imagem %": "", ok: "(anotado)" });
  await call("discard");
}
await call("view", { runtime: "spine" }).catch(() => {});
ws.close();
cdp.close();
console.table(linhas);
console.log(falhas ? `${falhas} caso(s) com diferenca; detalhes e pares spine | nucleo em ${out}` : `interacao igual nos dois modos (pares spine | nucleo em ${out})`);
stop();
process.exit(falhas ? 1 : 0);
