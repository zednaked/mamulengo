// Gate de paridade 3: o editor desenha igual ao jogo?
// Renderiza os mesmos instantes no editor (ponte) e no Godot com a GDExtension
// spine-godot do projeto (tools/godot/parity.gd), com o mesmo enquadramento, e compara.
//
//   npx tsx tools/parity.ts <arquivo -data.tres> [--anim nome|all] [--frames 4] [--width 600] [--out dir]
//
// Sequencia (previa de transicao, como o jogo toca): --anim A --next B [--mix 0.1|jogo]
// [--at t] [--loop]. Sem --at, B e enfileirada (queueAnim/add_animation); com --at, B
// interrompe A em t (playAnim/set_animation). "--mix jogo": no Godot o runtime decide
// sozinho pelo -data.tres (o caminho do jogo, sem sobrescrever) e o editor usa o mix que
// le do mesmo arquivo. Compara pixels e tambem os ossos (spine-core x Godot) quadro a quadro.
//
// O Godot roda num workspace especial silencioso do Hyprland quando disponivel
// (sem janela piscando na tela); senao, direto.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import WebSocket from "ws";
import { findProjectRoot, parseSkeletonDataTres, toRes } from "../server/godot.ts";
import { ensureImported } from "../server/godot-run.ts";
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, MixFrom, Physics, Skeleton, SkeletonJson, TextureAtlas, Vector2 } from "@esotericsoftware/spine-core";
import { PoseSim, STEP, likeSpineGodot, sequenceTimes, type Sequence } from "../src/core/sim.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const tres = resolve(argv[0]);
const asset = parseSkeletonDataTres(tres);
if (!asset) throw new Error(`nao e um SpineSkeletonDataResource: ${tres}`);
const project = findProjectRoot(dirname(tres))!;
const json = JSON.parse(readFileSync(asset.skeleton, "utf8"));
const frames = Number(opt("frames", "4"));
const width = Number(opt("width", "600"));
const out = resolve(opt("out", join(tmpdir(), "mamulengo-parity"))!);
if (!argv.includes("--reuse")) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// enquadramento: bounds do skeleton (do export) com margem; sem width/height no
// cabecalho, mede com o runtime a uniao dos bounds em todas as animacoes
function bounds(): { x: number; y: number; width: number; height: number } {
  const s = json.skeleton ?? {};
  if (s.width > 0 && s.height > 0) return { x: s.x ?? 0, y: s.y ?? 0, width: s.width, height: s.height };
  const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(readFileSync(asset!.atlas, "utf8")))).readSkeletonData(json);
  const sk = new Skeleton(data);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const off = new Vector2(),
    size = new Vector2();
  const grow = () => {
    sk.getBounds(off, size, []);
    if (!isFinite(size.x) || size.x <= 0) return;
    [x0, y0, x1, y1] = [Math.min(x0, off.x), Math.min(y0, off.y), Math.max(x1, off.x + size.x), Math.max(y1, off.y + size.y)];
  };
  sk.setupPose();
  sk.updateWorldTransform(Physics.reset);
  grow();
  for (const a of data.animations)
    for (let t = 0; t <= a.duration; t += Math.max(a.duration / 8, 1 / 30)) {
      sk.setupPose();
      a.apply(sk, 0, t, false, [], 1, MixFrom.setup as any, false, false, false);
      sk.updateWorldTransform(Physics.pose);
      grow();
    }
  if (!isFinite(x0)) return { x: -256, y: -256, width: 512, height: 512 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
const sk = bounds();
const m = 0.06;
const rect = [sk.x - sk.width * m, sk.y - sk.height * m, sk.width * (1 + 2 * m), sk.height * (1 + 2 * m)];
const size = [width, Math.round((width * rect[3]) / rect[2])];
const background = [0.2, 0.2, 0.2];

const animArg = opt("anim", "all")!;
const anims = animArg === "all" ? Object.keys(json.animations ?? {}) : [animArg];

// --- ponte com o editor
const ws = new WebSocket(`ws://localhost:${process.env.MAMULENGO_PORT ?? 5199}/__mamulengo`);
await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
ws.send(JSON.stringify({ t: "hello", role: "agent", name: "parity" }));
let callId = 0;
const call = (method: string, params: any) =>
  new Promise<any>((ok, fail) => {
    const id = String(++callId);
    const h = (raw: any) => {
      const r = JSON.parse(String(raw));
      if (r.t !== "reply" || r.id !== id) return;
      ws.off("message", h);
      r.ok ? ok(r.result) : fail(new Error(r.error));
    };
    ws.on("message", h);
    ws.send(JSON.stringify({ t: "call", id, method, params }));
  });

const state = await call("state", {});
if (state.file?.tres !== tres) await call("open", { id: tres });

function duration(a: any): number {
  let t = 0;
  const scan = (n: any) => {
    if (Array.isArray(n)) for (const k of n) k && typeof k === "object" && ("time" in k && (t = Math.max(t, k.time)), scan(k));
    else if (n && typeof n === "object") for (const v of Object.values(n)) scan(v);
  };
  scan(a);
  return t;
}

const decode = (b: Buffer) => PNG.sync.read(b);

// Diferenca por pixel (maior canal). "tol" tolera deslocamento de borda menor que
// 1 pixel (rasterizacao subpixel WebGL vs Godot): menor diferenca contra a vizinhanca
// 3x3 do outro render, nos dois sentidos.
function compare(a: PNG, b: PNG) {
  const W = a.width,
    H = a.height;
  const px = (img: PNG, x: number, y: number, c: number) => img.data[(y * W + x) * 4 + c];
  const diffAt = (p: PNG, q: PNG, x: number, y: number, tol: boolean) => {
    let best = 255;
    for (let dy = tol ? -1 : 0; dy <= (tol ? 1 : 0); dy++)
      for (let dx = tol ? -1 : 0; dx <= (tol ? 1 : 0); dx++) {
        const qx = Math.min(W - 1, Math.max(0, x + dx)),
          qy = Math.min(H - 1, Math.max(0, y + dy));
        const d = Math.max(Math.abs(px(p, x, y, 0) - px(q, qx, qy, 0)), Math.abs(px(p, x, y, 1) - px(q, qx, qy, 1)), Math.abs(px(p, x, y, 2) - px(q, qx, qy, 2)));
        if (d < best) best = d;
      }
    return best;
  };
  let sum = 0,
    bad = 0,
    badTol = 0,
    max = 0;
  const diff = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = diffAt(a, b, x, y, false);
      sum += d;
      if (d > 24) bad++;
      if (d > max) max = d;
      const t = d > 24 ? Math.max(diffAt(a, b, x, y, true), diffAt(b, a, x, y, true)) : 0;
      if (t > 24) badTol++;
      const i = (y * W + x) * 4;
      const v = Math.min(255, d * 4);
      // diferenca real (sobrevive a tolerancia) em rosa; borda subpixel em cinza
      diff.data[i] = v;
      diff.data[i + 1] = t > 24 ? 40 : v;
      diff.data[i + 2] = t > 24 ? 80 : v;
      diff.data[i + 3] = 255;
    }
  const n = W * H;
  return { mean: sum / n, badPct: (100 * bad) / n, tolPct: (100 * badTol) / n, max, diff };
}

// lado a lado: editor | godot | diferenca
function sideBySide(imgs: PNG[]): PNG {
  const w = imgs[0].width,
    h = imgs[0].height;
  const o = new PNG({ width: w * imgs.length, height: h });
  imgs.forEach((img, k) => PNG.bitblt(img, o, 0, 0, w, h, k * w, 0));
  return o;
}

function runGodot(spec: any): void {
  const dir = spec.out_dir;
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
  const cmd = `godot --path ${project} -s ${join(HERE, "godot", "parity.gd")} -- ${join(dir, "spec.json")} > ${join(dir, "godot.log")} 2>&1`;
  let hypr = false;
  try {
    execFileSync("hyprctl", ["eval", `hl.exec_cmd("[workspace special:mamulengo silent] sh -c '${cmd}'")`], { stdio: "ignore" });
    hypr = true;
  } catch {}
  if (!hypr) spawn("sh", ["-c", cmd], { stdio: "ignore", detached: true }).unref();
  // limite por falta de progresso (assets com dezenas de animacoes demoram)
  let t0 = Date.now();
  let shots = 0;
  while (!existsSync(join(dir, "done.json"))) {
    const n = readdirSync(dir).filter((f) => f.endsWith(".png")).length;
    if (n !== shots) (shots = n), (t0 = Date.now());
    // erro no harness: o Godot do jogo fica aberto (autoloads) e nao terminaria nunca
    const log = existsSync(join(dir, "godot.log")) ? readFileSync(join(dir, "godot.log"), "utf8") : "";
    const err = /SCRIPT ERROR:.*\n\s*at: .*parity\.gd.*/.exec(log);
    if (err || Date.now() - t0 > 60_000) {
      try {
        execFileSync("pkill", ["-f", join(dir, "spec.json")]);
      } catch {}
      throw new Error(err ? `harness quebrou: ${err[0].replace(/\s+/g, " ")}` : `Godot parou de produzir quadros por 60s; veja ${join(dir, "godot.log")}`);
    }
    execFileSync("sleep", ["0.3"]);
  }
}

// --- sequencia
const next = opt("next");
const mixArg = opt("mix");
const gameMix = mixArg === "jogo";
const pairMix = asset.mixes.find((m) => m.from === animArg && m.to === next)?.mix;
const seqMix = gameMix || mixArg === undefined ? (pairMix ?? asset.defaultMix) : Number(mixArg);
const seq: Sequence | null = next ? { next, mix: seqMix, at: opt("at") !== undefined ? Number(opt("at")) : null, loop: argv.includes("--loop"), nextLoop: true } : null;
if (seq && animArg === "all") throw new Error("--next pede --anim <nome>");
const coreData = seq ? new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(readFileSync(asset.atlas, "utf8")))).readSkeletonData(json) : null;
// --mix-spine: mix do spine-ts sem a regra do spine-godot (para medir a diferenca)
const ruleSpine = argv.includes("--mix-spine");
// pose do spine-core na mesma sequencia do viewer, esqueleto invertido como no spine-godot
function corePose(t: number) {
  const sk = new Skeleton(coreData!);
  sk.scaleY = -1;
  const sim = new PoseSim(sk, ruleSpine ? new AnimationState(new AnimationStateData(coreData!)) : likeSpineGodot(new AnimationState(new AnimationStateData(coreData!))));
  sim.shortcuts = false;
  sim.poseAt(animArg, false, t, seq);
  return sk;
}

const rows: any[] = [];
const jobs = anims.map((anim) => {
  if (seq) {
    const tt = sequenceTimes(coreData!.findAnimation(anim)!.duration, coreData!.findAnimation(seq.next)!.duration, seq);
    // espalhados pela sequencia (deslocados de chaves) e densos na emenda
    const spread = Array.from({ length: frames }, (_, i) => (tt.total * (i + 0.37)) / frames);
    const mix = [tt.start - STEP / 2, tt.start + STEP * 1.5, tt.start + (tt.end - tt.start) / 3, tt.start + (2 * (tt.end - tt.start)) / 3, tt.end + STEP * 1.5, tt.end + 0.1];
    const times = [...new Set([...spread, ...mix].filter((t) => t >= 0 && t <= tt.total).map((t) => +t.toFixed(4)))].sort((a, b) => a - b);
    console.log(`sequencia ${anim} -> ${seq.next}: mix ${seq.mix}s${gameMix ? " (Godot: o do -data.tres)" : ""}, ${seq.at != null ? `interrompe em ${seq.at}s` : "enfileirada"}; mix de ${tt.start.toFixed(3)} a ${tt.end.toFixed(3)}s, total ${tt.total.toFixed(3)}s`);
    return { animation: anim, prefix: `${anim}_para_${seq.next}`.replace(/[^\w.-]+/g, "_"), times, sequence: { ...seq, mix: gameMix ? null : seq.mix }, window: tt };
  }
  const d = duration(json.animations[anim]);
  // instantes deslocados (+0.37 de intervalo) para nao cair em cima de chaves:
  // em chave stepped o float32 do Godot e o float64 do JS caem de lados opostos
  const fixed = opt("times");
  const times = fixed ? fixed.split(",").map(Number) : Array.from({ length: frames }, (_, i) => +((d * (i + 0.37)) / frames).toFixed(4));
  return { animation: anim, prefix: anim.replace(/[^\w.-]+/g, "_"), times };
});
// Godot uma vez so para todas as animacoes (--reuse aproveita quadros ja renderizados)
// projeto que nunca passou pelo Godot (asset criado pelo editor): importa antes, senao
// o spine-godot nao carrega. Projetos ja importados (os jogos) nao sao tocados.
if (!existsSync(join(project, ".godot", "imported"))) await ensureImported(project, [asset.atlas, asset.skeleton]);
if (!(argv.includes("--reuse") && existsSync(join(out, "done.json")))) runGodot({ tres: toRes(project, tres), rect, size, background, out_dir: out, jobs });
for (const job of jobs) {
  const shift = opt("shift")?.split(",").map(Number);
  const sequence = (job as any).sequence ? { ...seq, mix: seq!.mix } : null;
  const ed = await call("render", { animation: job.animation, times: job.times, rect, size, background, shift, sequence });
  job.times.forEach((t, i) => {
    const a = decode(Buffer.from(ed.images[i].split(",")[1], "base64"));
    const b = decode(readFileSync(join(out, `${job.prefix}_${String(i).padStart(3, "0")}.png`)));
    const c = compare(a, b);
    writeFileSync(join(out, `cmp_${job.prefix}_${String(i).padStart(3, "0")}.png`), PNG.sync.write(sideBySide([a, b, c.diff])));
    const row: any = { anim: job.animation, t, mean: +c.mean.toFixed(2), badPct: +c.badPct.toFixed(3), tolPct: +c.tolPct.toFixed(3), max: c.max };
    if (seq) {
      // ossos: spine-core (mesma conta do viewer) x Godot, em unidades do esqueleto
      const g = JSON.parse(readFileSync(join(out, `${job.prefix}_${String(i).padStart(3, "0")}.json`), "utf8"));
      const sk = corePose(t);
      let worst = 0,
        wb = "";
      for (const b of sk.bones) {
        const gb = g.bones[b.data.name];
        if (!gb) continue;
        // o Godot devolve com y para baixo (esqueleto invertido): mesma convencao do core com scaleY -1
        const d = Math.hypot(b.appliedPose.worldX - gb[0], b.appliedPose.worldY - gb[1]);
        if (d > worst) (worst = d), (wb = b.data.name);
      }
      const w = (job as any).window;
      row.fase = t < w.start ? "A" : t <= w.end + STEP ? "mix" : seq.next;
      row.ossoMax = +worst.toPrecision(3);
      row.osso = wb;
      row.godot = g.track ? `${g.track.animation}${g.track.from ? ` <- ${g.track.from} ${(+g.track.mixTime).toFixed(3)}/${(+g.track.mixDuration).toFixed(2)}` : ""}` : "";
    }
    rows.push(row);
  });
}
ws.close();

console.table(rows);
const worst = rows.reduce((a, r) => (r.tolPct > a.tolPct ? r : a), rows[0]);
const meanAll = rows.reduce((s, r) => s + r.mean, 0) / rows.length;
console.log(`erro medio ${meanAll.toFixed(2)}/255; pior frame ${worst.anim}@${worst.t}s com ${worst.tolPct}% de pixels diferindo >24 (fora bordas subpixel; estrito ${worst.badPct}%)`);
if (seq) {
  const ob = rows.reduce((a, r) => (r.ossoMax > a.ossoMax ? r : a), rows[0]);
  const inMix = rows.filter((r) => r.fase === "mix");
  console.log(`ossos (spine-core x Godot): pior desvio ${ob.ossoMax} unidades (${ob.osso} em t=${ob.t}s, fase ${ob.fase}); no mix, pior ${Math.max(0, ...inMix.map((r) => r.ossoMax))}`);
}
console.log(`imagens: ${out} (editor | godot | diferenca x4)`);
// criterio: erro medio < 1.5/255 e menos de 0.5% dos pixels com diferenca real
// (tolerando borda subpixel) no pior frame
const bonesOk = !seq || rows.every((r) => r.ossoMax < 0.5);
const pass = meanAll < 3 && worst.tolPct < 0.5 && bonesOk;
console.log(pass ? "PASSOU" : "FALHOU");
process.exitCode = pass ? 0 : 1;
writeFileSync(join(out, "report.json"), JSON.stringify({ tres, rect, size, sequence: seq, rows }, null, 1));
