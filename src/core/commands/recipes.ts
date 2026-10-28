// Receitas: movimentos prontos com nome, do tipo que os jogos usam o tempo todo.
// Cada uma vira chaves comuns (key.set), entao da para ajustar depois na timeline.
import { z } from "zod";
import { animDuration as animDurationOf } from "../ficha.ts";
import { defineCommand, type CommandCtx } from "./registry.ts";
import { requireBone, requireSlot } from "../model.ts";

const Anim = z.string().describe("animacao (criada se nao existir)");

function ensureAnim(ctx: CommandCtx, anim: string) {
  if (!ctx.e.json.animations?.[anim]) ctx.run("animation.create", { name: anim });
}

const key = (ctx: CommandCtx, args: Record<string, any>) => ctx.run("key.set", args);

// tempos de um ciclo: inicio, meio, fim (loop fecha no mesmo valor)
const cycle = (start: number, period: number) => [start, start + period / 2, start + period];

defineCommand({
  name: "recipe.breathe",
  group: "recipe",
  summary: "Respirar: o osso infla e desinfla (escala) num ciclo suave que fecha o loop. Bom para corpo, barriga, peito.",
  params: z.object({ anim: Anim, bone: z.string(), amount: z.number().default(0.04).describe("quanto infla (0.04 = 4%)"), period: z.number().positive().default(2), start: z.number().min(0).default(0) }),
  label: (p) => `respirar ${p.bone}`,
  run(ctx, p) {
    requireBone(ctx.e.json, p.bone);
    ensureAnim(ctx, p.anim);
    const [a, b, c] = cycle(p.start, p.period);
    const T = { bone: p.bone };
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: a, x: 1, y: 1, curve: "suave" });
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: b, x: 1 + p.amount, y: 1 - p.amount * 0.6, curve: "suave" });
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: c, x: 1, y: 1 });
    return { keys: 3 };
  },
});

defineCommand({
  name: "recipe.sway",
  group: "recipe",
  summary:
    'Balancar: o osso gira para um lado e para o outro (cabeca, cauda, folha, placa). phase atrasa o balanco (0..1) para encadear ossos. cycles: quantos ciclos (ou "fim": repete ate o fim da animacao, para folhas com periodo menor que a duracao).',
  params: z.object({
    anim: Anim,
    bone: z.string(),
    angle: z.number().default(6),
    period: z.number().positive().default(2),
    phase: z.number().min(0).max(1).default(0),
    start: z.number().min(0).default(0),
    cycles: z.union([z.number().int().min(1).max(200), z.literal("fim")]).default(1),
  }),
  label: (p) => `balancar ${p.bone}`,
  run(ctx, p) {
    requireBone(ctx.e.json, p.bone);
    ensureAnim(ctx, p.anim);
    const T = { bone: p.bone };
    // "fim": tantos ciclos quantos cabem ate o fim da animacao (pelo menos um)
    const dur = animDurationOf(ctx.e.json.animations?.[p.anim]);
    const n = p.cycles === "fim" ? Math.max(1, Math.floor((dur - p.start) / p.period + 1e-6)) : p.cycles;
    // 4 chaves por ciclo: 0, +a, 0, -a, 0 com atraso de fase (sem atraso: comeca no centro)
    const q = p.period / 4;
    const shift = p.phase * p.period;
    // com fase, o ciclo e reamostrado para comecar e terminar no mesmo valor
    const at = (t: number) => {
      const u = (((t - p.start - shift) % p.period) + p.period) % p.period;
      return p.angle * Math.sin((u / p.period) * Math.PI * 2);
    };
    const last = 4 * n;
    for (let i = 0; i <= last; i++) {
      const t = p.start + i * q;
      const v = shift > 0 ? at(t) : [0, p.angle, 0, -p.angle][i % 4];
      key(ctx, { anim: p.anim, target: T, timeline: "rotate", time: t, value: v, ...(i < last || shift > 0 ? { curve: "suave" } : {}) });
    }
    return { keys: last + 1, cycles: n };
  },
});

defineCommand({
  name: "recipe.bounce",
  group: "recipe",
  summary: "Quicar: sobe e desce com amassado (squash) no chao e esticado (stretch) no ar. Bom para simbolos e personagens pulando.",
  params: z.object({ anim: Anim, bone: z.string(), height: z.number().default(40), squash: z.number().default(0.15), period: z.number().positive().default(0.8), start: z.number().min(0).default(0) }),
  label: (p) => `quicar ${p.bone}`,
  run(ctx, p) {
    requireBone(ctx.e.json, p.bone);
    ensureAnim(ctx, p.anim);
    const T = { bone: p.bone };
    const t0 = p.start,
      t1 = p.start + p.period * 0.15,
      t2 = p.start + p.period * 0.5,
      t3 = p.start + p.period * 0.85,
      t4 = p.start + p.period;
    // posicao: no chao, sobe desacelerando, desce acelerando
    key(ctx, { anim: p.anim, target: T, timeline: "translate", time: t0, x: 0, y: 0, curve: "sai-rapido" });
    key(ctx, { anim: p.anim, target: T, timeline: "translate", time: t2, x: 0, y: p.height, curve: "entra-rapido" });
    key(ctx, { anim: p.anim, target: T, timeline: "translate", time: t4, x: 0, y: 0 });
    // forma: amassa no chao, estica subindo/descendo, normal no alto
    const sq = { x: 1 + p.squash, y: 1 - p.squash };
    const st = { x: 1 - p.squash * 0.5, y: 1 + p.squash * 0.5 };
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: t0, ...sq, curve: "sai-rapido" });
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: t1, ...st, curve: "suave" });
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: t2, x: 1, y: 1, curve: "suave" });
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: t3, ...st, curve: "entra-rapido" });
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: t4, ...sq });
    return { keys: 8 };
  },
});

defineCommand({
  name: "recipe.popin",
  group: "recipe",
  summary: "Entrar estourando (popup, ganho, simbolo aparecendo): escala de 0 a um pouco mais que 1 e assenta. Pode antes esconder com alpha.",
  params: z.object({ anim: Anim, bone: z.string(), duration: z.number().positive().default(0.4), overshoot: z.number().default(0.15), start: z.number().min(0).default(0), slot: z.string().optional().describe("se dado, tambem faz fade-in da cor") }),
  label: (p) => `entrar ${p.bone}`,
  run(ctx, p) {
    requireBone(ctx.e.json, p.bone);
    ensureAnim(ctx, p.anim);
    const T = { bone: p.bone };
    const t0 = p.start,
      t1 = p.start + p.duration * 0.6,
      t2 = p.start + p.duration;
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: t0, x: 0, y: 0, curve: "sai-rapido" });
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: t1, x: 1 + p.overshoot, y: 1 + p.overshoot, curve: "suave" });
    key(ctx, { anim: p.anim, target: T, timeline: "scale", time: t2, x: 1, y: 1 });
    if (p.slot) {
      requireSlot(ctx.e.json, p.slot);
      key(ctx, { anim: p.anim, target: { slot: p.slot }, timeline: "rgba", time: t0, color: "ffffff00", curve: "sai-rapido" });
      key(ctx, { anim: p.anim, target: { slot: p.slot }, timeline: "rgba", time: t1, color: "ffffffff" });
    }
    return { ok: true };
  },
});

defineCommand({
  name: "recipe.pulse",
  group: "recipe",
  summary: "Pulsar: o slot acende e apaga (alpha) num ciclo. Otimo com blend aditivo para brilhos.",
  params: z.object({ anim: Anim, slot: z.string(), min: z.number().min(0).max(1).default(0), max: z.number().min(0).max(1).default(1), period: z.number().positive().default(1), start: z.number().min(0).default(0), color: z.string().default("ffffff").describe("rgb do tint") }),
  label: (p) => `pulsar ${p.slot}`,
  run(ctx, p) {
    requireSlot(ctx.e.json, p.slot);
    ensureAnim(ctx, p.anim);
    const hex = (a: number) => p.color.slice(0, 6) + Math.round(a * 255).toString(16).padStart(2, "0");
    const [a, b, c] = cycle(p.start, p.period);
    const T = { slot: p.slot };
    key(ctx, { anim: p.anim, target: T, timeline: "rgba", time: a, color: hex(p.min), curve: "suave" });
    key(ctx, { anim: p.anim, target: T, timeline: "rgba", time: b, color: hex(p.max), curve: "suave" });
    key(ctx, { anim: p.anim, target: T, timeline: "rgba", time: c, color: hex(p.min) });
    return { keys: 3 };
  },
});

defineCommand({
  name: "recipe.blink",
  group: "recipe",
  summary: "Piscar: troca a imagem do slot para 'closed' por um instante (olhos). Dois attachments no slot: aberto e fechado.",
  params: z.object({ anim: Anim, slot: z.string(), open: z.string(), closed: z.string(), at: z.number().min(0).default(1), duration: z.number().positive().default(0.12) }),
  label: (p) => `piscar ${p.slot}`,
  run(ctx, p) {
    requireSlot(ctx.e.json, p.slot);
    ensureAnim(ctx, p.anim);
    const T = { slot: p.slot };
    key(ctx, { anim: p.anim, target: T, timeline: "attachment", time: p.at, name: p.closed });
    key(ctx, { anim: p.anim, target: T, timeline: "attachment", time: p.at + p.duration, name: p.open });
    return { keys: 2 };
  },
});

defineCommand({
  name: "recipe.flipbook",
  group: "recipe",
  summary: "Flipbook: troca as imagens do slot em sequencia (fogo, moedas girando, explosao). frames = nomes dos attachments na ordem.",
  params: z.object({ anim: Anim, slot: z.string(), frames: z.array(z.string()).min(1), fps: z.number().positive().default(24), start: z.number().min(0).default(0), loop: z.boolean().default(true).describe("false: some no fim (attachment null)") }),
  label: (p) => `flipbook ${p.slot}`,
  run(ctx, p) {
    requireSlot(ctx.e.json, p.slot);
    ensureAnim(ctx, p.anim);
    const T = { slot: p.slot };
    p.frames.forEach((f, i) => key(ctx, { anim: p.anim, target: T, timeline: "attachment", time: p.start + i / p.fps, name: f }));
    if (!p.loop) key(ctx, { anim: p.anim, target: T, timeline: "attachment", time: p.start + p.frames.length / p.fps, name: null });
    return { keys: p.frames.length + (p.loop ? 0 : 1) };
  },
});

defineCommand({
  name: "recipe.shake",
  group: "recipe",
  summary: "Tremer: chacoalhada rapida que diminui (impacto, susto, ganho grande).",
  params: z.object({ anim: Anim, bone: z.string(), strength: z.number().default(8), duration: z.number().positive().default(0.4), start: z.number().min(0).default(0) }),
  label: (p) => `tremer ${p.bone}`,
  run(ctx, p) {
    requireBone(ctx.e.json, p.bone);
    ensureAnim(ctx, p.anim);
    const T = { bone: p.bone };
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const decay = 1 - i / n;
      const s = i % 2 ? 1 : -1;
      key(ctx, { anim: p.anim, target: T, timeline: "translate", time: p.start + (p.duration * i) / n, x: i === n ? 0 : s * p.strength * decay, y: i === n ? 0 : -s * p.strength * 0.4 * decay });
    }
    return { keys: n + 1 };
  },
});
