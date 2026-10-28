// Edicao de varias chaves de uma vez (timeline do editor): mover, apagar, copiar e
// colar. Cada chamada e uma acao de desfazer, mesmo mexendo em varias timelines.
// Alem das timelines de alvos, aceitam as chaves da animacao inteira: eventos
// (timeline "events") e ordem de desenho (timeline "drawOrder"), sem target.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import type { Editor } from "../document.ts";
import type { SpineJson } from "../format.ts";
import type { Path } from "../ops.ts";
import type { Bezier } from "../model.ts";
import { requireAnimation } from "../model.ts";
import { Target, editKeys, findKey, getKeys, readShape, removeEmpty, round, timeOf, timelinePath, writeShape } from "./timeline.ts";

const EPS = 1e-4;
const WHOLE = ["events", "drawOrder"];

export const KeyRef = z.object({
  target: Target.optional().describe("alvo da timeline; omitido em events e drawOrder"),
  timeline: z.string().describe("rotate, translate, scale, attachment, rgba, deform, ... ou 'events' / 'drawOrder' (da animacao, sem target)"),
  time: z.number().min(0).describe("tempo atual da chave, em segundos"),
  name: z.string().optional().describe("events: so o evento com esse nome (sem nome, todos naquele instante)"),
});
export type KeyRef = z.infer<typeof KeyRef>;

const Shape = z.union([z.literal("stepped"), z.array(z.tuple([z.number(), z.number(), z.number(), z.number()]))]).nullable();

// Caminho e tipo (null = sem curvas) da timeline de uma referencia.
function resolve(json: SpineJson, anim: string, r: { target?: Target; timeline: string }): { path: Path; kind: string | null; id: string } {
  if (WHOLE.includes(r.timeline)) return { path: ["animations", anim, r.timeline], kind: null, id: r.timeline };
  if (!r.target) throw new Error(`timeline ${r.timeline} precisa de target`);
  const { path, kind } = timelinePath(json, anim, r.target, r.timeline);
  return { path, kind, id: JSON.stringify(path) };
}

// Agrupa as referencias por timeline e acha os indices das chaves pedidas.
function groups(json: SpineJson, anim: string, refs: KeyRef[]) {
  const out = new Map<string, { path: Path; kind: string | null; idx: Set<number>; ref: KeyRef }>();
  for (const r of refs) {
    const { path, kind, id } = resolve(json, anim, r);
    const keys = getKeys(json, path);
    const hits = keys.map((_, i) => i).filter((i) => Math.abs(timeOf(keys[i]) - r.time) < EPS && (r.timeline !== "events" || !r.name || keys[i].name === r.name));
    if (!hits.length) throw new Error(`nao ha chave ${r.timeline} em ${r.time}s. Tempos: ${keys.map(timeOf).join(", ") || "(nenhum)"}`);
    let g = out.get(id);
    if (!g) out.set(id, (g = { path, kind, idx: new Set(), ref: r }));
    hits.forEach((i) => g!.idx.add(i));
  }
  return [...out.values()];
}

// chave com o tempo primeiro, como o exportador do Spine escreve
function withTime(k: any, t: number) {
  const { time: _, ...rest } = k;
  return t ? { time: t, ...rest } : rest;
}

function moveIn(e: Editor, path: Path, kind: string | null, idx: Set<number>, delta: number) {
  const keys = getKeys(e.json, path);
  const times = keys.map((k, i) => (idx.has(i) ? round(timeOf(k) + delta) : timeOf(k)));
  times.forEach((t, i) => {
    if (t < -1e-6) throw new Error(`a chave em ${timeOf(keys[i])}s iria para antes de 0`);
  });
  // ordem nova (estavel): a chave i vai para a posicao pos[i]
  const order = keys.map((_, i) => i).sort((a, b) => times[a] - times[b] || a - b);
  if (kind !== null || path[path.length - 1] === "drawOrder")
    for (let n = 1; n < order.length; n++)
      if (Math.abs(times[order[n]] - times[order[n - 1]]) < EPS) throw new Error(`ja existe chave em ${times[order[n]]}s (${path.slice(2).join("/")})`);
  const pos: number[] = [];
  order.forEach((old, n) => (pos[old] = n));
  const apply = () => {
    if (order.every((old, n) => old === n)) {
      for (const i of idx) e.set([...path, i], withTime(keys[i], Math.max(0, times[i])));
    } else
      e.set(
        path,
        order.map((i) => (idx.has(i) ? withTime(keys[i], Math.max(0, times[i])) : structuredClone(keys[i]))),
      );
  };
  if (kind === null) apply();
  else editKeys(e, path, kind, () => ({ remap: (i) => pos[i], apply }));
}

function deleteIn(e: Editor, path: Path, kind: string | null, idx: Set<number>) {
  const keys = getKeys(e.json, path);
  if (idx.size >= keys.length) {
    if (kind === null) e.set(path, undefined);
    else removeEmpty(e, path);
    return;
  }
  const gone = [...idx].sort((a, b) => b - a);
  const apply = () => gone.forEach((i) => e.remove(path, i));
  if (kind === null) return apply();
  editKeys(e, path, kind, () => ({ remap: (i) => (idx.has(i) ? -1 : i - gone.filter((g) => g < i).length), apply }));
}

defineCommand({
  name: "keys.move",
  group: "key",
  summary:
    "Move varias chaves juntas por delta segundos (uma acao de desfazer). As curvas acompanham. Ex: {anim:'1.idle', delta:0.1, keys:[{target:{bone:'head'}, timeline:'rotate', time:0.5}, {timeline:'events', time:0.5}]}",
  params: z.object({ anim: z.string(), keys: z.array(KeyRef).min(1), delta: z.number() }),
  label: (p) => `move ${p.keys.length} chave(s) ${p.delta >= 0 ? "+" : ""}${round(p.delta)}s`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const gs = groups(e.json, p.anim, p.keys);
    if (Math.abs(p.delta) < 1e-9) return { moved: 0 };
    for (const g of gs) moveIn(e, g.path, g.kind, g.idx, p.delta);
    return { moved: gs.reduce((n, g) => n + g.idx.size, 0) };
  },
});

defineCommand({
  name: "keys.delete",
  group: "key",
  summary: "Apaga varias chaves (de timelines diferentes, eventos, ordem de desenho) numa acao. Timelines que ficam vazias somem.",
  params: z.object({ anim: z.string(), keys: z.array(KeyRef).min(1) }),
  label: (p) => `apaga ${p.keys.length} chave(s)`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const gs = groups(e.json, p.anim, p.keys);
    for (const g of gs) deleteIn(e, g.path, g.kind, g.idx);
    return { deleted: gs.reduce((n, g) => n + g.idx.size, 0) };
  },
});

export const ClipItem = z.object({
  target: Target.optional(),
  timeline: z.string(),
  offset: z.number().min(0).describe("segundos depois do instante de colar"),
  key: z.record(z.string(), z.any()).describe("campos da chave sem time e curve (como no .spine-json)"),
  curve: Shape.optional().describe("formato da curva que sai da chave: null linear, 'stepped' ou bezier normalizada por canal [[x1,y1,x2,y2], ...]"),
});
export type ClipItem = z.infer<typeof ClipItem>;

defineCommand({
  name: "keys.copy",
  group: "key",
  readonly: true,
  summary: "Le chaves para colar depois com keys.paste (em outro instante, outra animacao ou outro osso: troque o target). Curvas saem normalizadas, entao continuam iguais onde forem coladas.",
  params: z.object({ anim: z.string(), keys: z.array(KeyRef).min(1) }),
  run({ doc }, p) {
    requireAnimation(doc.json, p.anim);
    const gs = groups(doc.json, p.anim, p.keys);
    const raw: (ClipItem & { time: number })[] = [];
    for (const g of gs) {
      const keys = getKeys(doc.json, g.path);
      const ref = g.ref;
      for (const i of [...g.idx].sort((a, b) => a - b)) {
        const { time: _, curve: __, ...key } = keys[i];
        const curve = g.kind === null ? null : readShape(g.kind, keys, i);
        raw.push({ ...(ref.target ? { target: ref.target } : {}), timeline: ref.timeline, time: timeOf(keys[i]), offset: 0, key: structuredClone(key), curve });
      }
    }
    const t0 = Math.min(...raw.map((r) => r.time));
    return { time: t0, items: raw.map(({ time, ...r }) => ({ ...r, offset: round(time - t0) })) };
  },
});

defineCommand({
  name: "keys.paste",
  group: "key",
  summary:
    "Cola chaves (os items de keys.copy) a partir de time, numa animacao. Chave ja existente no mesmo instante e substituida. Para colar em outro osso/slot, troque o target dos items.",
  params: z.object({ anim: z.string(), time: z.number().min(0), items: z.array(ClipItem).min(1) }),
  label: (p) => `cola ${p.items.length} chave(s) @${round(p.time)}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const out: { timeline: string; time: number }[] = [];
    for (const it of p.items) {
      const { path, kind } = resolve(e.json, p.anim, it);
      const t = round(p.time + it.offset);
      const k = withTime(it.key, t);
      delete k.curve;
      const keys = getKeys(e.json, path);
      if (kind === null) {
        const events = it.timeline === "events";
        const i = keys.findIndex((x) => Math.abs(timeOf(x) - t) < EPS && (!events || x.name === k.name));
        if (!keys.length) e.set(path, []);
        if (i >= 0) e.set([...path, i], k);
        else {
          let at = keys.findIndex((x) => timeOf(x) > t);
          if (at < 0) at = keys.length;
          e.insert(path, at, k);
        }
      } else {
        editKeys(e, path, kind, (keys) => {
          const i = findKey(keys, t);
          if (i >= 0) return { apply: () => e.set([...path, i], k) };
          let at = keys.findIndex((x) => timeOf(x) > t);
          if (at < 0) at = keys.length;
          return {
            remap: (j) => (j >= at ? j + 1 : j),
            apply: () => {
              if (!keys.length) e.set(path, []);
              e.insert(path, at, k);
            },
          };
        });
        // curva da chave colada: mesmo formato que tinha na origem
        const after = getKeys(e.json, path);
        const i = findKey(after, t);
        const w = writeShape(kind, after, i, (it.curve ?? null) as Bezier[] | "stepped" | null);
        if (JSON.stringify(w) !== JSON.stringify(after[i].curve)) e.set([...path, i, "curve"], w);
      }
      out.push({ timeline: it.timeline, time: t });
    }
    return { pasted: out };
  },
});
