// Pose de video (docs/ANIMAR.md, "Pose de video"): os pontos do corpo de cada quadro (MediaPipe Pose,
// 33 por quadro) viram chaves nos ossos, com as correcoes de src/core/rotoscopia.ts. O detector roda
// no navegador (o botao na referencia de video, ou a ponte poseFromVideo); este comando recebe os
// pontos, de onde vierem.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { animations, bones } from "../model.ts";
import { boneWorld, skeletonAt } from "../pose.ts";
import { mapaPorNomes, rotoscopia, SEGMENTOS, type Segmento } from "../rotoscopia.ts";

const SEGS = ["quadril", ...Object.keys(SEGMENTOS)] as [string, ...string[]];

defineCommand({
  name: "pose.fromLandmarks",
  group: "animation",
  summary:
    "Rotoscopia: os pontos do corpo de cada quadro de um video (MediaPipe Pose: 33 pontos [x, y, z?, visibilidade?] em pixels do video, y para baixo; null = sem pessoa) viram chaves de rotacao nos ossos e de deslocamento no quadril, na animacao anim (criada se falta). Corrige esquerda e direita trocadas, suaviza o tremor (smooth 0 a 1), trava o pe no chao por IK no contato (lockFeet), passa so os angulos (as proporcoes do rig ficam; o deslocamento na escala da perna do rig) e deixa so as batidas (reduce). map: segmento -> osso (quadril, tronco, cabeca, braco_e, antebraco_e, coxa_e, canela_e, pe_e e os _d); sem ele, pelos nomes dos ossos. flip: a pessoa olha para o outro lado do rig. As timelines desses ossos na animacao sao substituidas.",
  params: z.object({
    anim: z.string().min(1),
    frames: z.array(z.object({ t: z.number(), points: z.array(z.array(z.number())).nullable() })).min(2),
    map: z.record(z.enum(SEGS), z.string()).optional(),
    flip: z.boolean().optional(),
    smooth: z.number().min(0).max(1).optional(),
    lockFeet: z.boolean().optional(),
    reduce: z.boolean().optional(),
    translate: z.enum(["xy", "y", "none"]).optional(),
    start: z.number().min(0).optional().describe("instante da primeira chave na animacao"),
  }),
  label: (p) => `pose do video em ${p.anim}`,
  run(ctx, p) {
    const { e } = ctx;
    const nomes = bones(e.json).map((b: any) => b.name);
    const mapa = { ...mapaPorNomes(nomes), ...(p.map ?? {}) } as Partial<Record<Segmento, string>>;
    for (const [s, o] of Object.entries(mapa)) if (o && !nomes.includes(o)) throw new Error(`map: osso não existe: ${o} (${s})`);
    if (!Object.keys(mapa).some((s) => s !== "quadril")) throw new Error(`nenhum osso reconhecido: diga map (segmentos: ${SEGS.join(", ")})`);
    const sk = skeletonAt(e.json, null, 0);
    const pais = new Map(bones(e.json).map((b: any) => [b.name, b.parent ?? null]));
    const r = rotoscopia(
      p.frames.map((f) => ({ t: f.t, pontos: f.points as any })),
      { mundo: (o) => boneWorld(sk, o), pai: (o) => pais.get(o) ?? null },
      { mapa, espelhar: p.flip, suave: p.smooth, travarPes: p.lockFeet, reduzir: p.reduce, translacao: p.translate === "none" ? "nenhuma" : p.translate, inicio: p.start },
    );
    if (!animations(e.json)[p.anim]) ctx.run("animation.create", { name: p.anim });
    for (const [osso, tls] of Object.entries(r.chaves)) for (const [tl, keys] of Object.entries(tls)) e.set(["animations", p.anim, "bones", osso, tl], keys);
    return r.relatorio;
  },
});
