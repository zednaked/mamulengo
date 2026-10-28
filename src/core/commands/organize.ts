// Ordem de desenho animada, eventos e skins.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { requireAnimation, requireBone, requireSkin, requireSlot, skins, slots } from "../model.ts";
import { findKey, round, timeOf } from "./timeline.ts";

// --- draw order

// Codifica uma ordem de desenho (nomes de slots, de tras para frente) nos offsets do
// formato: slots que nao mudaram ocupam as posicoes livres na ordem original, entao a
// codificacao minima marca como "mudou" quem esta fora da maior subsequencia crescente.
export function encodeDrawOrder(setupNames: string[], order: string[]): { slot: string; offset: number }[] {
  const index = new Map(setupNames.map((n, i) => [n, i]));
  const seq = order.map((n) => {
    const i = index.get(n);
    if (i === undefined) throw new Error(`slot nao existe: ${n}`);
    return i;
  });
  if (new Set(seq).size !== setupNames.length || seq.length !== setupNames.length) throw new Error(`a ordem precisa listar todos os ${setupNames.length} slots exatamente uma vez`);
  // LIS (n log n) com reconstrucao
  const tails: number[] = [],
    tailIdx: number[] = [],
    prev = new Array(seq.length).fill(-1);
  seq.forEach((v, i) => {
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      tails[m] < v ? (lo = m + 1) : (hi = m);
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo ? tailIdx[lo - 1] : -1;
  });
  const keep = new Set<number>();
  for (let i = tailIdx[tails.length - 1]; i >= 0; i = prev[i]) keep.add(i);
  const changes: { slot: string; offset: number; orig: number }[] = [];
  seq.forEach((orig, pos) => {
    if (!keep.has(pos)) changes.push({ slot: setupNames[orig], offset: pos - orig, orig });
  });
  return changes.sort((a, b) => a.orig - b.orig).map(({ slot, offset }) => ({ slot, offset }));
}

// Decodifica como o runtime (readDrawOrder), para conferir.
export function decodeDrawOrder(setupNames: string[], offsets: { slot: string; offset: number }[]): string[] {
  const n = setupNames.length;
  const order = new Array(n).fill(-1);
  const unchanged: number[] = [];
  let orig = 0;
  for (const o of offsets) {
    const idx = setupNames.indexOf(o.slot);
    while (orig !== idx) unchanged.push(orig++);
    order[orig + o.offset] = orig++;
  }
  while (orig < n) unchanged.push(orig++);
  for (let i = n - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged.pop()!;
  return order.map((i) => setupNames[i]);
}

defineCommand({
  name: "draworder.key",
  group: "key",
  summary:
    "Chave de ordem de desenho num instante. Passe a ordem completa (order, de tras para frente) ou so movimentos (front: slots que vao para a frente de tudo; above: {slot: outro} poe slot logo na frente de outro). reset=true volta a ordem de setup.",
  params: z.object({
    anim: z.string(),
    time: z.number().min(0),
    order: z.array(z.string()).optional(),
    front: z.array(z.string()).optional(),
    back: z.array(z.string()).optional(),
    above: z.record(z.string(), z.string()).optional(),
    reset: z.boolean().optional(),
  }),
  label: (p) => `ordem de desenho @${p.time}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const setup = slots(e.json).map((s) => s.name);
    let order = p.order;
    if (!order && !p.reset) {
      order = [...setup];
      const move = (n: string, to: number) => {
        requireSlot(e.json, n);
        order!.splice(order!.indexOf(n), 1);
        order!.splice(to, 0, n);
      };
      for (const n of p.back ?? []) move(n, 0);
      for (const n of p.front ?? []) move(n, order.length - 1);
      for (const [n, ref] of Object.entries(p.above ?? {})) {
        requireSlot(e.json, ref);
        order.splice(order.indexOf(n), 1);
        order.splice(order.indexOf(ref) + 1, 0, n);
      }
    }
    const key: any = {};
    const t = round(p.time);
    if (t) key.time = t;
    if (!p.reset) {
      const offsets = encodeDrawOrder(setup, order!);
      if (offsets.length) key.offsets = offsets;
    }
    const path = ["animations", p.anim, "drawOrder"];
    const keys: any[] = e.json.animations[p.anim].drawOrder ?? [];
    const i = findKey(keys, t);
    if (!keys.length) e.set(path, []);
    if (i >= 0) e.set([...path, i], key);
    else {
      let at = keys.findIndex((k) => timeOf(k) > t);
      if (at < 0) at = keys.length;
      e.insert(path, at, key);
    }
    return { offsets: key.offsets?.length ?? 0 };
  },
});

defineCommand({
  name: "draworder.delete",
  group: "key",
  summary: "Remove a chave de ordem de desenho no instante.",
  params: z.object({ anim: z.string(), time: z.number().min(0) }),
  label: (p) => `apaga ordem @${p.time}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const keys: any[] = e.json.animations[p.anim].drawOrder ?? [];
    const i = findKey(keys, p.time);
    if (i < 0) throw new Error(`nao ha chave de ordem em ${p.time}s. Tempos: ${keys.map(timeOf).join(", ")}`);
    if (keys.length === 1) e.set(["animations", p.anim, "drawOrder"], undefined);
    else e.remove(["animations", p.anim, "drawOrder"], i);
    return { deleted: i };
  },
});

// --- eventos

const EventProps = z.object({ int: z.number().int().optional(), float: z.number().optional(), string: z.string().optional(), audio: z.string().optional(), volume: z.number().optional(), balance: z.number().optional() });

defineCommand({
  name: "event.create",
  group: "animation",
  summary: "Cria um evento (ex: 'som_pulo', 'spawn_moedas') com valores padrao; o jogo recebe no sinal animation_event.",
  params: z.object({ name: z.string().min(1), ...EventProps.shape }),
  label: (p) => `evento ${p.name}`,
  run({ e }, p) {
    if (e.json.events?.[p.name]) throw new Error(`evento ja existe: ${p.name}`);
    const { name, ...props } = p;
    const ev: any = {};
    for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== 0 && v !== "") ev[k] = v;
    if (!e.json.events) e.set(["events"], {});
    e.set(["events", name], ev);
    return { created: name };
  },
});

defineCommand({
  name: "event.key",
  group: "key",
  summary: "Dispara um evento num instante da animacao (valores opcionais sobrescrevem os padroes).",
  params: z.object({ anim: z.string(), time: z.number().min(0), name: z.string(), ...EventProps.shape }),
  label: (p) => `evento ${p.name} @${p.time}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    if (!e.json.events?.[p.name]) throw new Error(`evento nao existe: ${p.name}. Crie com event.create. Existem: ${Object.keys(e.json.events ?? {}).join(", ") || "(nenhum)"}`);
    const { anim, time, name, ...vals } = p;
    const key: any = {};
    const t = round(time);
    if (t) key.time = t;
    key.name = name;
    for (const [k, v] of Object.entries(vals)) if (v !== undefined) key[k] = v;
    const path = ["animations", anim, "events"];
    const keys: any[] = e.json.animations[anim].events ?? [];
    if (!keys.length) e.set(path, []);
    let at = keys.findIndex((k) => timeOf(k) > t);
    if (at < 0) at = keys.length;
    e.insert(path, at, key);
    return { index: at };
  },
});

defineCommand({
  name: "event.unkey",
  group: "key",
  summary: "Remove o disparo do evento no instante.",
  params: z.object({ anim: z.string(), time: z.number().min(0), name: z.string() }),
  label: (p) => `remove evento ${p.name} @${p.time}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const keys: any[] = e.json.animations[p.anim].events ?? [];
    const i = keys.findIndex((k) => k.name === p.name && Math.abs(timeOf(k) - p.time) < 1e-4);
    if (i < 0) throw new Error(`evento ${p.name} nao dispara em ${p.time}s`);
    if (keys.length === 1) e.set(["animations", p.anim, "events"], undefined);
    else e.remove(["animations", p.anim, "events"], i);
    return { deleted: i };
  },
});

// --- skins

defineCommand({
  name: "skin.create",
  group: "skin",
  summary: "Cria uma skin (variacao de visual: outra cor, outra roupa). copyFrom duplica os attachments de outra skin.",
  params: z.object({ name: z.string().min(1), copyFrom: z.string().optional() }),
  label: (p) => `skin ${p.name}`,
  run({ e }, p) {
    if (skins(e.json).some((s) => s.name === p.name)) throw new Error(`skin ja existe: ${p.name}`);
    const src = p.copyFrom ? skins(e.json)[requireSkin(e.json, p.copyFrom)] : null;
    const s: any = { name: p.name, attachments: src ? structuredClone(src.attachments) : {} };
    for (const k of ["bones", "ik", "transform", "path", "physics", "slider"]) if (src?.[k]) s[k] = structuredClone(src[k]);
    if (!e.json.skins) e.set(["skins"], []);
    e.insert(["skins"], skins(e.json).length, s);
    return { created: p.name };
  },
});

defineCommand({
  name: "skin.delete",
  group: "skin",
  summary: "Remove uma skin (nao a default) e os deforms dela.",
  params: z.object({ name: z.string() }),
  label: (p) => `remove skin ${p.name}`,
  run({ e }, p) {
    if (p.name === "default") throw new Error("a skin default nao pode ser removida");
    const i = requireSkin(e.json, p.name);
    e.remove(["skins"], i);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {})) if (a.attachments?.[p.name]) e.set(["animations", an, "attachments", p.name], undefined);
    return { deleted: p.name };
  },
});

defineCommand({
  name: "skin.require",
  group: "skin",
  summary: "Marca ossos/constraints como exclusivos de uma skin (so ficam ativos com ela). bones/constraints substituem as listas.",
  params: z.object({ skin: z.string(), bones: z.array(z.string()).optional(), ik: z.array(z.string()).optional(), transform: z.array(z.string()).optional(), physics: z.array(z.string()).optional(), path: z.array(z.string()).optional() }),
  label: (p) => `exclusivos de ${p.skin}`,
  run({ e }, p) {
    const i = requireSkin(e.json, p.skin);
    for (const k of ["bones", "ik", "transform", "physics", "path"] as const) {
      const v = p[k];
      if (!v) continue;
      if (k === "bones") v.forEach((b) => requireBone(e.json, b));
      e.set(["skins", i, k], v.length ? v : undefined);
      // o osso precisa saber que depende de skin
      if (k === "bones") for (const b of v) e.set(["bones", e.json.bones.findIndex((x: any) => x.name === b), "skin"], true);
    }
    return { ok: true };
  },
});
