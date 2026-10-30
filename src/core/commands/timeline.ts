// Edicao de timelines: localizar a timeline de um alvo, inserir/atualizar chaves
// e manter as curvas bezier (que o formato guarda em coordenadas absolutas)
// com o mesmo formato quando valores ou tempos mudam.
import { z } from "zod";
import type { Editor } from "../document.ts";
import type { SpineJson } from "../format.ts";
import type { Path } from "../ops.ts";
import { channels, constraints, denormalize, hasFields, isEffect, keyValues, normalize, requireBone, requireSlot, CURVE_PRESETS, EFFECT_NAMES, type Bezier } from "../model.ts";

export const Target = z
  .union([
    z.object({ bone: z.string() }),
    z.object({ slot: z.string() }),
    z.object({ constraint: z.string() }),
    z.object({ deform: z.object({ slot: z.string(), attachment: z.string(), skin: z.string().default("default") }) }),
    z.object({ particles: z.string() }),
    z.object({ light: z.string() }),
    z.object({ ambient: z.literal(true) }),
  ])
  .describe('Quem a timeline anima: {"bone":"head"}, {"slot":"eye"}, {"constraint":"hair_physics"}, {"deform":{"slot":"body","attachment":"body"}}, {"particles":"faiscas"} (rate, burst), {"light":"chave"} (timeline light: color, strength, radius, height) ou {"ambient":true} (timeline ambient: color, strength)');
export type Target = z.infer<typeof Target>;

export const TIMELINE_NAMES = {
  bone: ["rotate", "translate", "translatex", "translatey", "scale", "scalex", "scaley", "shear", "shearx", "sheary", "inherit"],
  slot: ["attachment", "rgba", "rgb", "alpha", "rgba2", "rgb2", ...EFFECT_NAMES],
  deform: ["deform", "sequence"],
  ik: ["ik"],
  transform: ["transform"],
  path: ["position", "spacing", "mix"],
  physics: ["inertia", "strength", "damping", "mass", "wind", "gravity", "mix", "reset"],
  slider: ["time", "mix"],
  particles: ["rate", "burst"],
} as const;

export const CurveArg = z
  .union([z.enum(Object.keys(CURVE_PRESETS) as [string, ...string[]]), z.tuple([z.number(), z.number(), z.number(), z.number()])])
  .describe("Curva ate a proxima chave: nome de preset (suave, elastico, antecipa, ...) ou bezier normalizada [x1,y1,x2,y2] como no CSS cubic-bezier");

// Caminho da timeline (array de chaves) de um alvo, e o nome logico usado para canais/curvas.
export function timelinePath(doc: SpineJson, anim: string, target: Target, timeline: string): { path: Path; kind: string } {
  const base: Path = ["animations", anim];
  if ("bone" in target) {
    requireBone(doc, target.bone);
    if (!(TIMELINE_NAMES.bone as readonly string[]).includes(timeline)) throw new Error(`timeline de osso invalida: ${timeline}. Use ${TIMELINE_NAMES.bone.join(", ")}`);
    return { path: [...base, "bones", target.bone, timeline], kind: timeline };
  }
  if ("slot" in target) {
    requireSlot(doc, target.slot);
    if (!(TIMELINE_NAMES.slot as readonly string[]).includes(timeline)) throw new Error(`timeline de slot invalida: ${timeline}. Use ${TIMELINE_NAMES.slot.join(", ")}`);
    // efeitos (outline, glow, dissolve, tint): fora de `slots`, onde o spine-core nao le
    if (isEffect(timeline)) return { path: [...base, "effects", target.slot, timeline], kind: timeline };
    return { path: [...base, "slots", target.slot, timeline], kind: timeline };
  }
  if ("deform" in target) {
    const d = target.deform;
    requireSlot(doc, d.slot);
    if (timeline !== "deform" && timeline !== "sequence") throw new Error("timeline de attachment: deform ou sequence");
    return { path: [...base, "attachments", d.skin, d.slot, d.attachment, timeline], kind: timeline };
  }
  // luzes (so do Mamulengo; docs/NUCLEO.md "Luzes"): fora do que o spine-core le
  if ("light" in target) {
    if (!(doc as any).lights?.some((l: any) => l.name === target.light)) throw new Error(`luz nao existe: "${target.light}"`);
    if (timeline !== "light") throw new Error(`timeline de luz: light (color, strength, radius, height)`);
    return { path: [...base, "lights", target.light], kind: "light" };
  }
  if ("ambient" in target) {
    if (timeline !== "ambient") throw new Error(`timeline da luz ambiente: ambient (color, strength)`);
    return { path: [...base, "ambient"], kind: "ambient" };
  }
  if ("particles" in target) {
    if (!(doc as any).particles?.some((p: any) => p.name === target.particles)) throw new Error(`emissor de particulas nao existe: "${target.particles}"`);
    if (!(TIMELINE_NAMES.particles as readonly string[]).includes(timeline)) throw new Error(`timeline de particulas invalida: ${timeline}. Use rate ou burst`);
    return { path: [...base, "particles", target.particles, timeline], kind: timeline };
  }
  const c = constraints(doc).find((x) => x.c.name === target.constraint);
  if (!c) throw new Error(`constraint nao existe: "${target.constraint}". Constraints: ${constraints(doc).map((x) => x.c.name).join(", ") || "(nenhuma)"}`);
  if (c.type === "ik" || c.type === "transform") return { path: [...base, c.type, target.constraint], kind: c.type };
  const allowed = TIMELINE_NAMES[c.type] as readonly string[];
  if (!allowed.includes(timeline)) throw new Error(`timeline de ${c.type} invalida: ${timeline}. Use ${allowed.join(", ")}`);
  return { path: [...base, c.type, target.constraint, timeline], kind: c.type === "path" && timeline === "mix" ? "pathmix" : timeline };
}

export function getKeys(doc: SpineJson, path: Path): any[] {
  let n: any = doc;
  for (const k of path) n = n?.[k];
  return Array.isArray(n) ? n : [];
}

const EPS = 1e-4;
export const timeOf = (k: any) => k?.time ?? 0;

export function findKey(keys: any[], time: number): number {
  return keys.findIndex((k) => Math.abs(timeOf(k) - time) < EPS);
}

// Curva da chave i (segmento i -> i+1) normalizada por canal; null = linear, "stepped" = degrau.
// A ultima chave nao tem segmento; se o usuario escolheu uma curva antes de criar a
// proxima chave, ela fica guardada relativa a um segmento unitario (t..t+1, v..v+1)
// e vira a curva real quando a proxima chave nascer. O runtime ignora curva na ultima chave.
function segment(kind: string, keys: any[], i: number) {
  const k = keys[i];
  const next = keys[i + 1];
  const v0 = kind === "deform" ? [0] : keyValues(kind, k);
  const t0 = timeOf(k);
  if (!next) return { t0, v0, t1: t0 + 1, v1: v0.map((v) => v + 1) };
  return { t0, v0, t1: timeOf(next), v1: kind === "deform" ? [1] : keyValues(kind, next) };
}

export function readShape(kind: string, keys: any[], i: number): Bezier[] | "stepped" | null {
  const c = keys[i]?.curve;
  if (c === undefined) return null;
  if (c === "stepped") return "stepped";
  const { t0, v0, t1, v1 } = segment(kind, keys, i);
  const out: Bezier[] = [];
  for (let ch = 0; ch * 4 < c.length; ch++) out.push(normalize(c.slice(ch * 4, ch * 4 + 4), t0, v0[ch] ?? 0, t1, v1[ch] ?? 1));
  return out;
}

export function writeShape(kind: string, keys: any[], i: number, shape: Bezier[] | "stepped" | null): any {
  if (shape === null) return undefined;
  if (shape === "stepped") return "stepped";
  const { t0, v0, t1, v1 } = segment(kind, keys, i);
  const out: number[] = [];
  for (let ch = 0; ch < Math.max(1, v0.length); ch++) {
    const sh = shape[Math.min(ch, shape.length - 1)];
    out.push(...denormalize(sh, t0, v0[ch], t1, v1[ch]).map(round));
  }
  return out;
}

// arredonda como o exportador (float32 com ate ~7 digitos significativos)
export function round(x: number): number {
  return Number(Math.fround(x).toPrecision(7));
}

export function presetShape(c: z.infer<typeof CurveArg>): Bezier[] | "stepped" | null {
  if (Array.isArray(c)) return [c as Bezier];
  const p = CURVE_PRESETS[c];
  if (p === "linear") return null;
  if (p === "stepped") return "stepped";
  return [p];
}

// Muda chaves de uma timeline preservando o formato das curvas.
// change devolve: apply (faz as ops), remap (indice antigo -> novo, -1 se a chave
// sumiu) e opcionalmente uma chave nova que herda a curva do segmento onde caiu.
export interface KeyChange {
  apply: () => void;
  remap?: (old: number) => number;
  inherit?: { to: number; from: number };
}

export function editKeys(e: Editor, path: Path, kind: string, change: (keys: any[]) => KeyChange) {
  const keys = getKeys(e.json, path);
  const shapes = keys.map((_, i) => readShape(kind, keys, i));
  const { apply, remap = (i: number) => i, inherit } = change(keys);
  apply();
  const after = getKeys(e.json, path);
  const want: (Bezier[] | "stepped" | null)[] = after.map(() => null);
  shapes.forEach((sh, i) => {
    const j = remap(i);
    if (j >= 0 && j < after.length) want[j] = sh;
  });
  if (inherit && inherit.from >= 0) want[inherit.to] = shapes[inherit.from] ?? null;
  after.forEach((k, i) => {
    const w = writeShape(kind, after, i, want[i]);
    if (JSON.stringify(w) !== JSON.stringify(k.curve)) e.set([...path, i, "curve"], w);
  });
}

// Campos de valor de uma chave a partir dos argumentos, omitindo defaults como o exportador.
export function keyFields(kind: string, a: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if (kind === "attachment") {
    out.name = a.name ?? null;
    return out;
  }
  if (kind === "rgba" || kind === "rgb") {
    if (a.color !== undefined) out.color = a.color;
    return out;
  }
  if (hasFields(kind)) {
    // efeitos e luzes: a chave guarda todos os campos (o que falta herdaria da anterior)
    if (a.color !== undefined) out.color = a.color;
    for (const c of channels(kind)) if (a[c.key] !== undefined) out[c.key] = round(a[c.key]);
    return out;
  }
  if (kind === "rgba2" || kind === "rgb2") {
    if (a.light !== undefined) out.light = a.light;
    if (a.dark !== undefined) out.dark = a.dark;
    return out;
  }
  if (kind === "deform") {
    if (a.offset) out.offset = a.offset;
    if (a.vertices) out.vertices = a.vertices.map(round);
    return out;
  }
  if (kind === "inherit") {
    if (a.inherit && a.inherit !== "normal") out.inherit = a.inherit;
    return out;
  }
  if (kind === "sequence") {
    for (const f of ["mode", "index", "delay"]) if (a[f] !== undefined) out[f] = a[f];
    return out;
  }
  if (kind === "reset") return out;
  if (kind === "burst") {
    out.count = Math.max(1, Math.round(a.count ?? 1));
    return out;
  }
  for (const c of channels(kind)) {
    const v = a[c.key];
    if (v !== undefined && v !== c.def) out[c.key] = round(v);
  }
  return out;
}

export function removeEmpty(e: Editor, path: (string | number)[]) {
  // apaga a timeline e sobe removendo objetos que ficaram vazios (ate a animacao)
  e.set(path, undefined);
  for (let n = path.length - 1; n > 2; n--) {
    const p = path.slice(0, n);
    let o: any = e.json;
    for (const k of p) o = o?.[k];
    if (o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 0) e.set(p, undefined);
    else break;
  }
}
