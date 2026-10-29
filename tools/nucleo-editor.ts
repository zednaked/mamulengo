// Conferencia do modo "nucleo" do viewer do editor contra o modo "spine" (spine-webgl, como o
// editor do Spine), no editor de verdade: sobe um editor proprio com os personagens CC0
// (tests/assets) e um Chromium headless (SwiftShader), e pela ponte renderiza os mesmos
// instantes de cada animacao nos dois modos, com o mesmo enquadramento (o personagem
// inteiro). Tambem as emendas (A e depois B com mix, enfileirada e interrompida) e o remendo
// direto do arrasto (osso e slot na setup e uma chave: o remendado tem de sair igual ao
// recarregado, sem recarga).
//
//   npx tsx tools/nucleo-editor.ts [--port 5207] [--editor] [--quadros 8] [--tol 1.5] [--out dir] [--bench] [--n 10]
//
// --editor usa o editor ja aberto na porta (com os personagens nas raizes dele). A tolerancia
// e a do palco: % dos pixels com diferenca acima de 8/255 (o palco mede de 0 a 1,1% so nas
// bordas). --bench mede tambem o custo (tools/bench.ts) nos dois modos.
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
const port = Number(opt("port", "5207"));
const quadros = Number(opt("quadros", "8"));
const tol = Number(opt("tol", "1.5"));
const out = resolve(opt("out", join(tmpdir(), "mamulengo-nucleo-editor")));
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

if (!argv.includes("--editor")) {
  const env = { ...process.env, MAMULENGO_ROOTS: join(REPO, "tests/assets"), MAMULENGO_PORT: String(port), MAMULENGO_ESTAVEL: "1" };
  kids.push(spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: REPO, env, detached: true, stdio: ["ignore", openSync(join(out, "vite.log"), "w"), openSync(join(out, "vite.log"), "a")] }));
  await waitHttp(`http://localhost:${port}/`, 60_000);
  const profile = mkdtempSync(join(tmpdir(), "nucleo-editor-chromium-"));
  kids.push(
    spawn(
      "chromium",
      ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1400,900", `--user-data-dir=${profile}`, "--no-first-run", "--remote-debugging-port=0", `http://localhost:${port}/?acompanhar=0&runtime=spine`],
      { detached: true, stdio: ["ignore", openSync(join(out, "chromium.log"), "w"), openSync(join(out, "chromium.log"), "a")] },
    ),
  );
}

// ---- ponte (como o MCP): o editor da pagina executa
const ws = new WebSocket(`ws://localhost:${port}/__mamulengo`);
await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
let editors = 0;
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === "status") editors = m.editors;
});
ws.send(JSON.stringify({ t: "hello", role: "agent", name: "nucleo-editor" }));
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
const exec = async (cmd: string, args: any = {}) => (await call("exec", { calls: [{ cmd, args }] })).results[0];

// ---- comparacao de imagens

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

// ---- casos

type Caso = { nome: string; animation: string | null; times: number[]; sequence?: any };
const linhas: any[] = [];
const bench: any[] = [];
let falhas = 0;

const assets = (await call("assets")).filter((a: any) => a.id.startsWith(join(REPO, "tests/assets")));
if (!assets.length) throw new Error("nenhum personagem de tests/assets nas raizes do editor");
for (const a of assets) {
  const { info } = await call("discard").then(() => call("open", { id: a.id }));
  const anims: { name: string; duration: number }[] = info.animations;
  const s = info.size;
  // enquadramento: o retangulo do cabecalho com folga (o mesmo nos dois modos)
  let rect: number[];
  if (s?.width > 0 && s?.height > 0) {
    const m = 0.08 * Math.max(s.width, s.height);
    const lado = Math.max(s.width, s.height) + 2 * m;
    rect = [s.x + s.width / 2 - lado / 2, s.y + s.height / 2 - lado / 2, lado, lado];
  } else rect = [-400, -100, 800, 800];
  const casos: Caso[] = [{ nome: "setup", animation: null, times: [0] }];
  for (const an of anims) {
    const d = an.duration;
    casos.push({ nome: an.name, animation: an.name, times: d > 0 ? Array.from({ length: quadros + 1 }, (_, k) => +((d * k) / quadros).toFixed(4)) : [0] });
  }
  const comDur = anims.filter((x) => x.duration > 0);
  if (comDur.length >= 2) {
    const [A, B] = comDur;
    const total = A.duration + B.duration;
    const ts = Array.from({ length: quadros + 1 }, (_, k) => +((total * k) / quadros).toFixed(4));
    casos.push({ nome: `${A.name} > ${B.name} (fila, mix 0.2)`, animation: A.name, times: ts, sequence: { next: B.name, mix: 0.2 } });
    casos.push({ nome: `${A.name} > ${B.name} (corte em ${(A.duration / 2).toFixed(2)}, mix 0.2)`, animation: A.name, times: ts, sequence: { next: B.name, mix: 0.2, at: +(A.duration / 2).toFixed(4) } });
  }
  const arvore: string[] = String(await exec("query.tree", {})).split("\n");
  const raiz = arvore[0].trim().split(/\s+/)[0];
  const imagens: Record<string, Record<string, string[]>> = {};
  for (const runtime of ["spine", "nucleo"]) {
    const st = await call("view", { runtime });
    if (runtime === "nucleo" && !st.view.nucleo?.drawing) throw new Error(`${a.name}: o nucleo nao esta desenhando: ${st.view.nucleoError}`);
    imagens[runtime] = {};
    for (const c of casos) {
      // enquadra o personagem inteiro em todos os instantes do caso (pelo esqueleto do
      // spine-core, que e o mesmo nos dois modos)
      const r = await call("render", { animation: c.animation, times: c.times, focus: { bones: [raiz], margin: 0.06 }, size: [LADO, LADO], background: [0.169, 0.145, 0.192], sequence: c.sequence ?? null });
      imagens[runtime][c.nome] = r.images;
    }
  }
  for (const c of casos) {
    let pior = { pct: 0, pior: 0, t: 0 };
    let soma = 0;
    c.times.forEach((t, i) => {
      const A = png(imagens.spine[c.nome][i]),
        B = png(imagens.nucleo[c.nome][i]);
      const d = diff(A, B);
      soma += d.pct;
      if (d.pct >= pior.pct) pior = { ...d, t };
      if (d.pct > tol || i === Math.floor(c.times.length / 2)) salvaPar(`${a.name}-${c.nome.replace(/[^\w.-]+/g, "_")}-${t}`, A, B);
    });
    const ok = pior.pct <= tol;
    if (!ok) falhas++;
    linhas.push({ personagem: a.name, caso: c.nome, quadros: c.times.length, "media %": +(soma / c.times.length).toFixed(3), "pior %": +pior.pct.toFixed(3), "no t": pior.t, "pior canal": pior.pior, ok: ok ? "ok" : "FALHA" });
  }

  // remendo do arrasto no modo nucleo: osso e slot da setup e uma chave de animacao mudados
  // direto no modelo do nucleo tem de desenhar igual ao modelo relido do documento inteiro
  await call("view", { runtime: "nucleo", animation: anims[0]?.name ?? null, time: 0 });
  // o segundo osso da arvore (um filho da raiz) e o primeiro slot que aparecer nela
  const tree = arvore;
  const bone = tree[1]?.trim().split(/\s+/)[0] ?? null;
  const slotName = tree.map((l) => l.match(/<([^,>]+)/)?.[1]).find(Boolean) ?? null;
  const calls: any[] = [];
  if (bone) calls.push({ cmd: "bone.set", args: { bone, rotation: 17, x: 12 } });
  if (slotName) calls.push({ cmd: "slot.set", args: { slot: slotName, color: "ff8060b0" } });
  const t = anims[0]?.duration ? +(anims[0].duration / 3).toFixed(4) : 0;
  if (bone && anims[0]) calls.push({ cmd: "key.set", args: { anim: anims[0].name, target: { bone }, timeline: "rotate", time: t, value: 25 } });
  const antes = (await call("render", { animation: anims[0]?.name ?? null, times: [t], rect, size: [LADO, LADO] })).images[0];
  const n0 = (await call("state")).view.nucleo;
  await call("exec", { calls, label: "remendo" });
  const remendado = (await call("render", { animation: anims[0]?.name ?? null, times: [t], rect, size: [LADO, LADO] })).images[0];
  const n1 = (await call("state")).view.nucleo;
  // o remendo nao pode ter relido o .boneco inteiro
  const direto = n0 && n1 && n1.drawing && n1.cargas === n0.cargas && n1.remendos > n0.remendos;
  await call("view", { runtime: "spine" });
  await call("view", { runtime: "nucleo" });
  const relido = (await call("render", { animation: anims[0]?.name ?? null, times: [t], rect, size: [LADO, LADO] })).images[0];
  const dr = diff(png(remendado), png(relido));
  // e a edicao apareceu
  const mudou = diff(png(antes), png(remendado)).pct > 0;
  const okR = dr.pior === 0 && !!direto && mudou;
  if (!okR) falhas++;
  linhas.push({ personagem: a.name, caso: `remendo ${direto ? "direto" : "COM RECARGA"}${mudou ? "" : " SEM EFEITO"}: ${bone ?? "-"}, ${slotName ?? "-"} e chave = recarregar`, quadros: 1, "media %": +dr.pct.toFixed(3), "pior %": +dr.pct.toFixed(3), "no t": t, "pior canal": dr.pior, ok: okR ? "ok" : "FALHA" });
  await call("discard");

  if (argv.includes("--bench")) {
    const n = Number(opt("n", "10"));
    const an = comDur[0]?.name;
    for (const runtime of ["spine", "nucleo"]) bench.push({ personagem: a.name, ...(await call("bench", { runtime, animation: an, n })) });
  }
}
await call("view", { runtime: "spine" }).catch(() => {});
ws.close();

console.table(linhas);
if (bench.length)
  console.table(
    bench.map(({ personagem, runtime, animation, slots, rebuildMs, poseAtEndMs, poseAtColdMs, frameMs, nucleoPoseMs, nucleoDrawMs, dragStepMs, setupStepMs, rebuildsInDrag, nucleoReloadsInDrag, fps }) => ({
      personagem,
      runtime,
      animation,
      slots,
      rebuildMs,
      poseAtEndMs,
      poseAtColdMs,
      frameMs,
      nucleoPoseMs,
      nucleoDrawMs,
      dragStepMs,
      setupStepMs,
      rebuildsInDrag,
      nucleoReloadsInDrag,
      fps,
    })),
  );
console.log(falhas ? `${falhas} caso(s) fora da tolerancia (${tol}%); pares spine | nucleo em ${out}` : `todos dentro da tolerancia (${tol}% dos pixels acima de 8/255)`);
stop();
process.exit(falhas ? 1 : 0);
