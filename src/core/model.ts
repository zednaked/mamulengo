// Helpers de leitura sobre o JSON do Spine 4.3 e o conhecimento do formato
// (defaults, timelines, curvas). Nada aqui muta o documento.
import type { SpineJson } from "./format.ts";
import type { Path } from "./ops.ts";

export const BONE_DEFAULTS = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, length: 0 } as const;

export function bones(doc: SpineJson): any[] {
  return doc.bones ?? [];
}
export function slots(doc: SpineJson): any[] {
  return doc.slots ?? [];
}
export function skins(doc: SpineJson): any[] {
  return doc.skins ?? [];
}
export function animations(doc: SpineJson): Record<string, any> {
  return doc.animations ?? {};
}

export function boneIndex(doc: SpineJson, name: string): number {
  return bones(doc).findIndex((b) => b.name === name);
}
export function slotIndex(doc: SpineJson, name: string): number {
  return slots(doc).findIndex((s) => s.name === name);
}
export function skinIndex(doc: SpineJson, name: string): number {
  return skins(doc).findIndex((s) => s.name === name);
}

export function requireBone(doc: SpineJson, name: string): number {
  const i = boneIndex(doc, name);
  if (i < 0) throw new Error(`osso nao existe: "${name}". Ossos: ${listNames(bones(doc))}`);
  return i;
}
export function requireSlot(doc: SpineJson, name: string): number {
  const i = slotIndex(doc, name);
  if (i < 0) throw new Error(`slot nao existe: "${name}". Slots: ${listNames(slots(doc))}`);
  return i;
}
export function requireSkin(doc: SpineJson, name: string): number {
  const i = skinIndex(doc, name);
  if (i < 0) throw new Error(`skin nao existe: "${name}". Skins: ${listNames(skins(doc))}`);
  return i;
}
export function requireAnimation(doc: SpineJson, name: string): any {
  const a = animations(doc)[name];
  if (!a) throw new Error(`animacao nao existe: "${name}". Animacoes: ${Object.keys(animations(doc)).join(", ") || "(nenhuma)"} (crie com animation.create; as receitas criam sozinhas)`);
  return a;
}

function listNames(a: any[]): string {
  const n = a.map((x) => x.name);
  return n.length > 30 ? n.slice(0, 30).join(", ") + ` ... (+${n.length - 30})` : n.join(", ");
}

export function childrenOf(doc: SpineJson, bone: string): string[] {
  return bones(doc)
    .filter((b) => b.parent === bone)
    .map((b) => b.name);
}

export function descendants(doc: SpineJson, bone: string): Set<string> {
  const out = new Set<string>();
  const walk = (n: string) => {
    for (const c of childrenOf(doc, n)) if (!out.has(c)) out.add(c), walk(c);
  };
  walk(bone);
  return out;
}

// --- constraints: 4.3 usa "constraints" com "type"; exports antigos usam ik/transform/path/physics no topo
export type ConstraintType = "ik" | "transform" | "path" | "physics" | "slider";
export const CONSTRAINT_TYPES: ConstraintType[] = ["ik", "transform", "path", "physics", "slider"];

export function constraints(doc: SpineJson): { type: ConstraintType; c: any; path: Path }[] {
  const out: { type: ConstraintType; c: any; path: Path }[] = [];
  (doc.constraints ?? []).forEach((c: any, i: number) => out.push({ type: (c.type ?? "ik") as ConstraintType, c, path: ["constraints", i] }));
  for (const t of CONSTRAINT_TYPES)
    if (Array.isArray(doc[t])) doc[t].forEach((c: any, i: number) => out.push({ type: t, c, path: [t, i] }));
  return out;
}

// --- timelines

export const BONE_TIMELINES = ["rotate", "translate", "translatex", "translatey", "scale", "scalex", "scaley", "shear", "shearx", "sheary", "inherit"] as const;
export const SLOT_TIMELINES = ["attachment", "rgba", "rgb", "alpha", "rgba2", "rgb2"] as const;
export type BoneTimeline = (typeof BONE_TIMELINES)[number];
export type SlotTimeline = (typeof SLOT_TIMELINES)[number];

// Canais numericos de cada timeline, na ordem em que a curva bezier os guarda.
export function channels(timeline: string): { key: string; def: number }[] {
  switch (timeline) {
    case "rotate":
    case "translatex":
    case "translatey":
    case "shearx":
    case "sheary":
    case "alpha":
      return [{ key: "value", def: 0 }];
    case "scalex":
    case "scaley":
      return [{ key: "value", def: 1 }];
    case "translate":
    case "shear":
      return [
        { key: "x", def: 0 },
        { key: "y", def: 0 },
      ];
    case "scale":
      return [
        { key: "x", def: 1 },
        { key: "y", def: 1 },
      ];
    // cores: canais r,g,b,a (0..1) dentro de "color"
    case "rgba":
      return ["r", "g", "b", "a"].map((key) => ({ key, def: 1 }));
    case "rgb":
      return ["r", "g", "b"].map((key) => ({ key, def: 1 }));
    case "rgba2":
      return ["r", "g", "b", "a", "r2", "g2", "b2"].map((key) => ({ key, def: 1 }));
    case "rgb2":
      return ["r", "g", "b", "r2", "g2", "b2"].map((key) => ({ key, def: 1 }));
    // constraints
    case "ik":
      return [
        { key: "mix", def: 1 },
        { key: "softness", def: 0 },
      ];
    case "transform":
      return ["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"].map((key) => ({ key, def: 1 }));
    case "position":
    case "spacing":
    case "time":
      return [{ key: "value", def: 0 }];
    case "pathmix":
      return ["mixRotate", "mixX", "mixY"].map((key) => ({ key, def: 1 }));
    // deform: o "valor" e 0..1 entre os vertices de uma chave e da outra
    case "deform":
    case "sequence":
    case "slider":
    case "inertia":
    case "strength":
    case "damping":
    case "mass":
    case "wind":
    case "gravity":
    case "mix":
      return [{ key: "value", def: timeline === "mix" ? 1 : 0 }];
    // particulas: a taxa sem padrao fixo (o do emissor), entao a chave sempre guarda o valor
    case "rate":
      return [{ key: "value", def: NaN }];
    default:
      // efeitos: os campos numericos (a cor vai em keyFields, como no rgba)
      if (isEffect(timeline)) return EFFECTS[timeline].filter(([f]) => f !== "color").map(([key, def]) => ({ key, def: def[0] }));
      return [];
  }
}

export function parseColor(hex: string | undefined): number[] {
  const h = (hex ?? "ffffffff").padEnd(8, "f");
  return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
export function formatColor(rgba: number[], withAlpha = true): string {
  const c = rgba.slice(0, withAlpha ? 4 : 3).map((v) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return c.join("");
}

// ---- efeitos (so do Mamulengo; docs/NUCLEO.md "Efeitos"): no JSON do editor, `effects` no
// slot (setup) e `animations.<a>.effects.<slot>.<efeito>` (chaves), onde o spine-core nao le

// campos de cada efeito na ordem dos canais, com o padrao (a cor ocupa 4 canais)
export const EFFECTS: Record<string, [string, number[]][]> = {
  outline: [["color", [1, 1, 1, 1]], ["width", [0]]],
  glow: [["color", [1, 1, 1, 1]], ["strength", [0]], ["radius", [8]]],
  dissolve: [["value", [0]], ["color", [1, 0.5, 0, 1]], ["edge", [0.05]], ["grain", [8]]],
  tint: [["color", [1, 1, 1, 1]], ["strength", [0]]],
  // so mexe nos vertices (docs/NUCLEO.md "Borrar"): strength em segundos de movimento, limit em
  // pixels do mundo, fade de 0 a 1
  smear: [["strength", [0]], ["limit", [60]], ["fade", [0.5]]],
  // so geometria (docs/NUCLEO.md "Rastro"): copies (0 desliga, ate 16), interval em segundos,
  // alpha da copia mais nova (0 a 1)
  trail: [["copies", [0]], ["interval", [0.05]], ["alpha", [0.5]]],
};
export const EFFECT_NAMES = Object.keys(EFFECTS);
export const isEffect = (timeline: string) => timeline in EFFECTS;

// valores de um efeito (canal a canal) a partir de um objeto com os campos; o que falta vem de `base`
export function effectValues(effect: string, o: any, base?: number[]): number[] {
  const out: number[] = [];
  for (const [f, def] of EFFECTS[effect]) {
    const at = out.length;
    if (o?.[f] === undefined) out.push(...(base ? base.slice(at, at + def.length) : def));
    else if (f === "color") out.push(...parseColor(o[f]));
    else out.push(o[f]);
  }
  return out;
}

// os campos de um efeito a partir dos valores
export function effectFields(effect: string, v: number[]): Record<string, any> {
  const out: Record<string, any> = {};
  let c = 0;
  for (const [f, def] of EFFECTS[effect]) {
    out[f] = f === "color" ? formatColor(v.slice(c, c + 4)) : v[c];
    c += def.length;
  }
  return out;
}

// valores de um efeito no tempo t (chaves lineares ou degrau, como no nucleo; as curvas
// bezier sao aproximadas pela reta, que basta para preencher uma chave nova)
export function effectAt(doc: any, anim: string | null, slot: string, effect: string, t: number): number[] {
  const setup = effectValues(effect, doc.slots?.find((s: any) => s.name === slot)?.effects?.[effect]);
  const keys: any[] = (anim && doc.animations?.[anim]?.effects?.[slot]?.[effect]) || [];
  if (!keys.length || t < (keys[0].time ?? 0)) return setup;
  let prev = setup;
  const vals = keys.map((k) => (prev = effectValues(effect, k, prev)));
  let i = keys.length - 1;
  while (i > 0 && (keys[i].time ?? 0) > t) i--;
  if (i === keys.length - 1 || keys[i].curve === "stepped") return vals[i];
  const t0 = keys[i].time ?? 0,
    t1 = keys[i + 1].time ?? 0;
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return vals[i].map((v, c) => v + (vals[i + 1][c] - v) * f);
}

// Valores numericos de uma chave, canal a canal (cores viram 0..1).
export function keyValues(timeline: string, key: any): number[] {
  if (isEffect(timeline)) return effectValues(timeline, key);
  if (timeline === "rgba" || timeline === "rgb") return parseColor(key.color).slice(0, timeline === "rgb" ? 3 : 4);
  if (timeline === "rgba2" || timeline === "rgb2") {
    const light = parseColor(key.light);
    const dark = parseColor(key.dark);
    return [...light.slice(0, timeline === "rgba2" ? 4 : 3), ...dark.slice(0, 3)];
  }
  if (timeline === "deform") return [0];
  return channels(timeline).map((c) => key[c.key] ?? c.def);
}

// --- curvas
// No JSON, "curve" e "stepped" ou um array com 4 numeros por canal:
// cx1, cy1, cx2, cy2 em coordenadas ABSOLUTAS (tempo, valor). Sem "curve" = linear.
// A ferramenta pensa em curvas normalizadas (0..1 em tempo e valor, como no CSS);
// as funcoes abaixo convertem nos dois sentidos.

export type Bezier = [number, number, number, number];
export type CurveShape = "linear" | "stepped" | Bezier | Bezier[];

export function denormalize(c: Bezier, t0: number, v0: number, t1: number, v1: number): Bezier {
  const dt = t1 - t0;
  const dv = v1 - v0;
  return [t0 + c[0] * dt, v0 + c[1] * dv, t0 + c[2] * dt, v0 + c[3] * dv];
}

export function normalize(abs: number[], t0: number, v0: number, t1: number, v1: number): Bezier {
  const dt = t1 - t0 || 1;
  const dv = v1 - v0;
  // segmento plano: o desvio em valor nao tem escala; trata como linear em valor
  const ny = (y: number, lin: number) => (Math.abs(dv) < 1e-9 ? lin : (y - v0) / dv);
  return [(abs[0] - t0) / dt, ny(abs[1], 1 / 3), (abs[2] - t0) / dt, ny(abs[3], 2 / 3)];
}

// Presets com nome de sensacao, para quem nao quer pensar em tangente.
export const CURVE_PRESETS: Record<string, Bezier | "linear" | "stepped"> = {
  linear: "linear",
  stepped: "stepped",
  // entra e sai devagar (o "padrao" do Spine quando voce arrasta as alcas)
  suave: [0.25, 0, 0.75, 1],
  "sai-rapido": [0, 0, 0.58, 1], // ease-out
  "entra-rapido": [0.42, 0, 1, 1], // ease-in
  macio: [0.45, 0, 0.55, 1],
  forte: [0.7, 0, 0.3, 1],
  // passa do ponto e volta (precisa de chave seguinte para assentar)
  elastico: [0.34, 1.56, 0.64, 1],
  antecipa: [0.36, 0, 0.66, -0.56],
  batida: [0.12, 0, 0.39, 0],
};

export function curvePresetNames(): string[] {
  return Object.keys(CURVE_PRESETS);
}
