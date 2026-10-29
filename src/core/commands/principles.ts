// Principios de animacao como comandos: antecipacao, overshoot e sobreposicao
// (follow-through). Operam sobre chaves que ja existem, entao servem para "dar vida"
// a um movimento simples feito na mao ou por uma receita.
import { z } from "zod";
import { defineCommand, type CommandCtx } from "./registry.ts";
import { channels, keyValues, requireAnimation, requireBone } from "../model.ts";
import { Target, findKey, getKeys, round, timeOf, timelinePath } from "./timeline.ts";
import { animDuration, poseAt, wrapDeg } from "../ficha.ts";

const NUMERIC = new Set(["rotate", "translate", "translatex", "translatey", "scale", "scalex", "scaley", "shear", "shearx", "sheary"]);

function valuesArgs(timeline: string, vals: number[]): Record<string, number> {
  const ch = channels(timeline);
  return Object.fromEntries(ch.map((c, i) => [c.key, round(vals[i])]));
}

function keyAt(ctx: CommandCtx, p: { anim: string; target: any; timeline: string }, time: number, vals: number[], curve?: string) {
  return ctx.run("key.set", { anim: p.anim, target: p.target, timeline: p.timeline, time: round(time), ...valuesArgs(p.timeline, vals), ...(curve ? { curve } : {}) });
}

const Base = { anim: z.string(), target: Target, timeline: z.string().describe("rotate, translate, scale, shear..."), time: z.number().min(0).describe("tempo da chave do movimento principal") };

defineCommand({
  name: "anim.anticipate",
  group: "key",
  summary:
    "Antecipacao: antes da chave em `time`, insere um pequeno recuo no sentido contrario do movimento (como agachar antes de pular). amount = fracao do movimento (0.15 a 0.3); lead = quanto antes (s).",
  params: z.object({ ...Base, amount: z.number().min(0).max(1).default(0.2), lead: z.number().positive().default(0.12) }),
  label: (p) => `antecipacao ${p.timeline} @${p.time}`,
  run(ctx, p) {
    requireAnimation(ctx.e.json, p.anim);
    if (!NUMERIC.has(p.timeline)) throw new Error(`antecipacao vale para timelines numericas (rotate, translate, scale, shear), nao ${p.timeline}`);
    const { path, kind } = timelinePath(ctx.e.json, p.anim, p.target, p.timeline);
    const keys = getKeys(ctx.e.json, path);
    const i = findKey(keys, p.time);
    if (i < 1) throw new Error("precisa de uma chave em `time` e de uma chave anterior (o ponto de partida)");
    const a = keyValues(kind, keys[i - 1]),
      b = keyValues(kind, keys[i]);
    const t = Math.max(timeOf(keys[i - 1]) + 0.01, p.time - p.lead);
    // escala: o recuo e relativo (amassa antes de esticar)
    const pre = a.map((v, k) => v - (b[k] - v) * p.amount);
    keyAt(ctx, p, t, pre, "sai-rapido");
    return { inserted: round(t) };
  },
});

defineCommand({
  name: "anim.overshoot",
  group: "key",
  summary:
    "Overshoot: depois da chave em `time`, passa um pouco do ponto e volta (assentamento elastico). amount = fracao do movimento que passa (0.1 a 0.3); settle = tempo ate assentar (s).",
  params: z.object({ ...Base, amount: z.number().min(0).max(1).default(0.15), settle: z.number().positive().default(0.2) }),
  label: (p) => `overshoot ${p.timeline} @${p.time}`,
  run(ctx, p) {
    requireAnimation(ctx.e.json, p.anim);
    if (!NUMERIC.has(p.timeline)) throw new Error(`overshoot vale para timelines numericas, nao ${p.timeline}`);
    const { path, kind } = timelinePath(ctx.e.json, p.anim, p.target, p.timeline);
    const keys = getKeys(ctx.e.json, path);
    const i = findKey(keys, p.time);
    if (i < 1) throw new Error("precisa de uma chave em `time` e de uma chave anterior");
    const a = keyValues(kind, keys[i - 1]),
      b = keyValues(kind, keys[i]);
    const next = keys[i + 1];
    const room = next ? timeOf(next) - p.time : Infinity;
    const settle = Math.min(p.settle, room * 0.9);
    if (settle < 0.04) throw new Error("nao ha espaco ate a proxima chave para assentar");
    const over = b.map((v, k) => v + (v - a[k]) * p.amount);
    // a chave original passa a ser o pico (passa do ponto); o assentamento vem depois
    keyAt(ctx, p, p.time, over, "suave");
    keyAt(ctx, p, p.time + settle, b, next ? "suave" : undefined);
    return { peak: round(p.time), settle: round(p.time + settle) };
  },
});

defineCommand({
  name: "anim.overlap",
  group: "key",
  summary:
    "Sobreposicao (follow-through): copia a rotacao de um osso para a cadeia de filhos com atraso crescente e amplitude amortecida, como rabo, orelha, cabelo ou dedos arrastando atras. chain na ordem do pai para a ponta.",
  params: z.object({
    anim: z.string(),
    from: z.string().describe("osso que lidera (precisa ter chaves de rotate)"),
    chain: z.array(z.string()).min(1),
    delay: z.number().min(0).default(0.06).describe("atraso por elo (s)"),
    damping: z.number().min(0).max(2).default(0.7).describe("amplitude por elo (1 = igual)"),
  }),
  label: (p) => `sobreposicao ${p.from} -> ${p.chain.join(",")}`,
  run(ctx, p) {
    requireAnimation(ctx.e.json, p.anim);
    requireBone(ctx.e.json, p.from);
    p.chain.forEach((b) => requireBone(ctx.e.json, b));
    const src = getKeys(ctx.e.json, ["animations", p.anim, "bones", p.from, "rotate"]);
    if (!src.length) throw new Error(`${p.from} nao tem chaves de rotate em ${p.anim}`);
    const dur = Math.max(...src.map(timeOf));
    let made = 0;
    p.chain.forEach((b, n) => {
      const k = n + 1;
      const amp = Math.pow(p.damping, k);
      // substitui o rotate do elo pela copia atrasada
      if (getKeys(ctx.e.json, ["animations", p.anim, "bones", b, "rotate"]).length) ctx.run("timeline.delete", { anim: p.anim, target: { bone: b }, timeline: "rotate" });
      for (const key of src) {
        const t = timeOf(key) + p.delay * k;
        // o que passa do fim volta ao comeco (animacao em loop)
        const tt = dur > 0 && t > dur ? t - dur : t;
        ctx.run("key.set", { anim: p.anim, target: { bone: b }, timeline: "rotate", time: round(tt), value: round((key.value ?? 0) * amp), curve: key.curve === "stepped" ? "stepped" : "suave" });
        made++;
      }
    });
    return { keys: made };
  },
});

defineCommand({
  name: "anim.match",
  group: "key",
  summary:
    "Faz a animacao comecar e/ou terminar na pose de entrada de outra (like), para emendar sem salto quando o jogo toca uma depois da outra (ex: win termina como o idle comeca). Grava chaves so nos canais que diferem. at: inicio, fim ou ambos. Confira depois com a regra termina_como da ficha.",
  params: z.object({ anim: z.string(), like: z.string(), at: z.enum(["inicio", "fim", "ambos"]).default("fim"), tol: z.number().min(0).default(0.05) }),
  label: (p) => `${p.anim} emenda com ${p.like}`,
  run(ctx, p) {
    const a = requireAnimation(ctx.e.json, p.anim);
    requireAnimation(ctx.e.json, p.like);
    const dur = animDuration(a);
    // pose local de entrada de like, relativa ao setup
    const sk = poseAt(ctx.e.json, p.like, 0);
    const times = p.at === "inicio" ? [0] : p.at === "fim" ? [dur] : [0, dur];
    let keys = 0;
    for (const b of sk.bones) {
      const name = b.name;
      const q = b.local,
        s = b.setup;
      const want = {
        rotate: [wrapDeg(q.rotation - s.rotation)],
        translate: [q.x - s.x, q.y - s.y],
        scale: [q.scaleX / (s.scaleX || 1), q.scaleY / (s.scaleY || 1)],
        shear: [q.shearX - s.shearX, q.shearY - s.shearY],
      };
      const rest = { rotate: [0], translate: [0, 0], scale: [1, 1], shear: [0, 0] };
      for (const t of times) {
        // pose atual da animacao naquele instante, para nao gravar o que ja bate
        const now = poseAt(ctx.e.json, p.anim, t).findBone(name)!.local;
        const have = {
          rotate: [wrapDeg(now.rotation - s.rotation)],
          translate: [now.x - s.x, now.y - s.y],
          scale: [now.scaleX / (s.scaleX || 1), now.scaleY / (s.scaleY || 1)],
          shear: [now.shearX - s.shearX, now.shearY - s.shearY],
        };
        for (const tl of ["rotate", "translate", "scale", "shear"] as const) {
          const w = want[tl],
            h = have[tl];
          const off = w.some((v, i) => Math.abs(v - h[i]) > p.tol * (tl === "scale" ? 0.02 : 1));
          const animated = !!a.bones?.[name]?.[tl];
          if (!off || (!animated && w.every((v, i) => Math.abs(v - rest[tl][i]) < 1e-6))) continue;
          const kv = (v: number[]) => (tl === "rotate" ? { value: round(v[0]) } : { x: round(v[0]), y: round(v[1]) });
          // canal sem chaves: uma chave so seguraria o valor na animacao inteira; a outra
          // ponta fica com o valor de antes
          if (!a.bones?.[name]?.[tl] && times.length === 1 && dur > 0) {
            const other = t === 0 ? dur : 0;
            ctx.run("key.set", { anim: p.anim, target: { bone: name }, timeline: tl, time: round(other), ...kv(h), curve: "suave" });
            keys++;
          }
          ctx.run("key.set", { anim: p.anim, target: { bone: name }, timeline: tl, time: round(t), ...kv(w), ...(t === 0 ? { curve: "suave" } : {}) });
          keys++;
        }
      }
    }
    return { keys, at: times.map(round) };
  },
});
