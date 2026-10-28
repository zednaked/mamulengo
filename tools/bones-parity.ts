// Compara numericamente a pose do Godot (json do harness) com a do spine-core no
// mesmo instante, com a mesma simulacao em passos fixos.
//   npx tsx tools/bones-parity.ts <-data.tres> <dir do parity> [--anim nome]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, Physics, Skeleton, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-core";
import { parseSkeletonDataTres } from "../server/godot.ts";

const [tres, dir] = process.argv.slice(2);
const only = process.argv.includes("--anim") ? process.argv[process.argv.indexOf("--anim") + 1] : null;
const a = parseSkeletonDataTres(tres)!;
// --neggrav: em vez de inverter o esqueleto, nega so a gravidade da fisica
const NEGGRAV = process.argv.includes("--neggrav");
const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(readFileSync(a.atlas, "utf8")))).readSkeletonData(readFileSync(a.skeleton, "utf8"));
if (NEGGRAV) for (const c of data.constraints as any[]) if (c.setupPose && "gravity" in c.setupPose) c.setupPose.gravity = -c.setupPose.gravity;
// 1/64: fracao binaria exata em float32 e float64. Com 1/60, tres passos somam
// exatamente o passo de fisica de 20 fps (0.05) e o spine-cpp (float) e o spine-ts
// (double) decidem de lados opostos se a fisica anda naquele frame.
const STEP = 1 / 64;

const FLIP = process.argv.includes("--flip");
// --ydown: como runtimes que desenham com y para baixo (Skeleton.yDown global)
const YDOWN = process.argv.includes("--ydown");
if (YDOWN) (Skeleton as any).yDown = true;
function poseAt(anim: string, t: number) {
  const sk = new Skeleton(data);
  // --flip: simula como o spine-godot (esqueleto com scaleY -1)
  if (FLIP) sk.scaleY = -1;
  const st = new AnimationState(new AnimationStateData(data));
  sk.setupPose();
  st.setAnimation(0, anim, true).mixDuration = 0;
  sk.updateWorldTransform(Physics.reset);
  const step = (d: number) => {
    st.update(d);
    st.apply(sk);
    sk.update(d);
    sk.updateWorldTransform(Physics.update);
  };
  step(0);
  let done = 0;
  while (done + STEP <= t + 1e-9) (step(STEP), (done += STEP));
  if (t - done > 0) step(t - done);
  return { sk, st };
}

// --who: procura a animacao/tempo do spine-core que melhor explica a pose do Godot
if (process.argv.includes("--who")) {
  const f = process.argv[process.argv.indexOf("--who") + 1];
  const g = JSON.parse(readFileSync(f, "utf8"));
  const res: [number, string, number][] = [];
  for (const an of data.animations)
    for (let t = 0; t <= an.duration + 1e-6; t += 1 / 30) {
      const { sk } = poseAt(an.name, t);
      let sum = 0;
      for (const b of sk.bones) {
        const gb = g.bones[b.data.name];
        if (gb) sum += Math.hypot(b.appliedPose.worldX - gb[0], b.appliedPose.worldY + gb[1]);
      }
      res.push([sum / sk.bones.length, an.name, +t.toFixed(3)]);
    }
  res.sort((x, y) => x[0] - y[0]);
  console.log(res.slice(0, 5));
  process.exit(0);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && /_\d{3}\.json$/.test(f));
for (const f of files.sort()) {
  const prefix = f.replace(/_\d{3}\.json$/, "");
  const anim = data.animations.find((x) => x.name.replace(/[^\w.-]+/g, "_") === prefix)?.name;
  if (!anim || (only && anim !== only)) continue;
  const g = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const { sk, st } = poseAt(anim, g.t);
  if (process.argv.includes("--dump")) for (const n of ["root", "body", "head", "braco_e"]) { const p = sk.findBone(n)?.appliedPose; if (p) console.log("core ", n, [p.worldX, p.worldY, p.a, p.b, p.c, p.d].map((x) => +x.toFixed(3))); }
  const watch = process.argv.includes("--bone") ? process.argv[process.argv.indexOf("--bone") + 1] : null;
  if (watch) {
    const p = sk.findBone(watch)!.appliedPose;
    const gb = g.bones[watch];
    console.log(`t=${g.t.toFixed(4)} ${watch} core=(${p.worldX.toFixed(3)}, ${p.worldY.toFixed(3)}, a=${p.a.toFixed(4)}) godot=(${gb[0].toFixed(3)}, ${(-gb[1]).toFixed(3)}, a=${gb[2].toFixed(4)})`);
    continue;
  }
  let worst = { name: "", d: 0 };
  let sum = 0,
    n = 0;
  for (const b of sk.bones) {
    const gb0 = g.bones[b.data.name];
    if (!gb0) continue;
    // o spine-godot desenha com y para baixo invertendo o esqueleto (scaleY -1)
    const gb = [gb0[0], -gb0[1], gb0[2], gb0[3], -gb0[4], -gb0[5]];
    const p = b.appliedPose;
    const py = FLIP || YDOWN ? -p.worldY : p.worldY;
    const d = Math.hypot(p.worldX - gb[0], py - gb[1]);
    sum += d;
    n++;
    if (d > worst.d) worst = { name: b.data.name, d };
  }
  if (process.argv.includes("--list")) {
    const devs = sk.bones.map((b) => { const gb0 = g.bones[b.data.name]; const p = b.appliedPose; const py = FLIP || YDOWN ? -p.worldY : p.worldY; return [b.data.name, gb0 ? Math.hypot(p.worldX - gb0[0], py + gb0[1]) : 0] as [string, number]; }).filter((x) => x[1] > 0.5).sort((a, b) => b[1] - a[1]);
    console.log("ossos com desvio > 0.5px:", devs.slice(0, 12).map(([n, d]) => `${n} ${d.toFixed(1)}`).join(", "));
  }
  const slotDiff = sk.slots.filter((s) => (s.appliedPose.attachment?.name ?? null) !== (g.slots[s.data.name] ?? null)).map((s) => `${s.data.name}: core=${s.appliedPose.attachment?.name ?? "-"} godot=${g.slots[s.data.name] ?? "-"}`);
  console.log(`${anim} t=${g.t} trackTime godot=${g.trackTime.toFixed(4)} core=${(st.tracks[0]?.trackTime ?? -1).toFixed(4)} | desvio medio ${(sum / n).toFixed(3)}px, pior ${worst.name} ${worst.d.toFixed(2)}px | slots diferentes: ${slotDiff.length}${slotDiff.length ? " ex: " + slotDiff.slice(0, 3).join("; ") : ""}`);
}
