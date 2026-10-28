// Oraculo do nucleo: pose de um .boneco pelo runtime de referencia (o mesmo que o jogo usa
// hoje), como caixa-preta. O nucleo novo (nucleo/) tem de dar os mesmos numeros, sem ler
// este codigo nem o do runtime de referencia: so a especificacao (docs/NUCLEO.md) e a saida.
//
//   npx tsx tools/oraculo.ts <x.boneco> <animacao|-> <t1,t2,...|fps:30> [--saida pose.json]
//
// Saida (o contrato do nucleo-pose, docs/NUCLEO.md):
//   { "quadros": [ { "t": 0.5,
//       "ossos": { "<nome>": [a, b, c, d, x, y] },              matriz de mundo, y para cima
//       "slots": [ { "nome", "parte": "<nome>|null", "cor": [r, g, b, a] } ],   na ordem de desenho
//       "vertices": { "<slot>": [x0, y0, x1, y1, ...] } } ] }    regiao e malha visiveis, mundo
// "-" no lugar da animacao: a pose de setup.
import { readFileSync, writeFileSync } from "node:fs";
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, MeshAttachment, RegionAttachment, Skeleton, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-core";
import { exportarSpine } from "../src/boneco/spine.ts";
import { godotGravity } from "../src/core/pose.ts";
import { PoseSim } from "../src/core/sim.ts";
import { animDuration } from "../src/core/ficha.ts";

export function oraculo(boneco: any, anim: string | null, tempos: number[]) {
  const e = exportarSpine(boneco);
  const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(e.atlas))).readSkeletonData(godotGravity(e.json));
  const sk = new Skeleton(data);
  const sim = new PoseSim(sk, new AnimationState(new AnimationStateData(data)));
  const quadros: any[] = [];
  for (const t of tempos) {
    sim.poseAt(anim, true, t);
    const ossos: Record<string, number[]> = {};
    for (const b of sk.bones) {
      const p = b.appliedPose;
      ossos[b.data.name] = [p.a, p.b, p.c, p.d, p.worldX, p.worldY];
    }
    const slots: any[] = [];
    const vertices: Record<string, number[]> = {};
    for (const s of sk.drawOrder.appliedPose) {
      const a = s.appliedPose.attachment;
      const c = s.appliedPose.color;
      slots.push({ nome: s.data.name, parte: a ? a.name : null, cor: [c.r, c.g, c.b, c.a] });
      if (!s.bone.active) continue;
      if (a instanceof RegionAttachment) {
        const v = new Array(8).fill(0);
        a.computeWorldVertices(s, a.getOffsets(s.appliedPose), v, 0, 2);
        vertices[s.data.name] = v;
      } else if (a instanceof MeshAttachment) {
        const v = new Array(a.worldVerticesLength).fill(0);
        a.computeWorldVertices(sk, s, 0, a.worldVerticesLength, v, 0, 2);
        vertices[s.data.name] = v;
      }
    }
    quadros.push({ t, ossos, slots, vertices });
  }
  return { quadros };
}

export function tempos(boneco: any, anim: string | null, spec: string): number[] {
  if (!spec.startsWith("fps:")) return spec.split(",").map(Number);
  const fps = Number(spec.slice(4));
  // a duracao pelas chaves do JSON do Spine (no .boneco o tempo da chave e "tempo")
  const d = anim ? animDuration(exportarSpine(boneco).json.animations?.[anim]) : 0;
  const n = Math.max(1, Math.round(d * fps));
  return Array.from({ length: n + 1 }, (_, i) => (i / n) * d);
}

if (process.argv[1]?.endsWith("oraculo.ts")) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--saida");
  const saida = i >= 0 ? args.splice(i, 2)[1] : null;
  const [arq, anim, ts] = args;
  if (!arq || !anim || !ts) {
    console.error("uso: oraculo.ts <x.boneco> <animacao|-> <t1,t2,...|fps:30> [--saida pose.json]");
    process.exit(2);
  }
  const b = JSON.parse(readFileSync(arq, "utf8"));
  const a = anim === "-" ? null : anim;
  const out = JSON.stringify(oraculo(b, a, tempos(b, a, ts)));
  if (saida) writeFileSync(saida, out);
  else process.stdout.write(out + "\n");
}
