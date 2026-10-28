// Constraints do Spine 4.3: ik, transform, physics, path, slider. Ficam no array
// "constraints" (com "type"); a ordem do array e a ordem de aplicacao.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { constraints, requireBone, requireSlot, skins, slots, type ConstraintType } from "../model.ts";
import { round } from "./timeline.ts";
import { boneWorld, skeletonAt } from "../pose.ts";
import type { Editor } from "../document.ts";

const Name = z.string().min(1);

function addConstraint(e: Editor, c: Record<string, any>, at?: number) {
  if (constraints(e.json).some((x) => x.c.name === c.name)) throw new Error(`ja existe constraint com nome ${c.name}`);
  if (!e.json.constraints) e.set(["constraints"], []);
  const n = e.json.constraints.length;
  e.insert(["constraints"], at === undefined ? n : Math.min(at, n), c);
}

function findC(e: Editor, name: string) {
  const c = constraints(e.json).find((x) => x.c.name === name);
  if (!c) throw new Error(`constraint nao existe: ${name}. Existem: ${constraints(e.json).map((x) => `${x.c.name}(${x.type})`).join(", ") || "(nenhuma)"}`);
  return c;
}

// escreve so o que difere do default (como o exportador)
function clean(obj: Record<string, any>, defaults: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (k in defaults && defaults[k] === v) continue;
    out[k] = typeof v === "number" ? round(v) : v;
  }
  return out;
}

const IK_DEFAULTS = { mix: 1, softness: 0, bendPositive: true, compress: false, stretch: false, uniform: false };
const IkProps = z.object({
  mix: z.number().min(0).max(1).optional(),
  softness: z.number().min(0).optional(),
  bendPositive: z.boolean().optional().describe("lado para onde o 'cotovelo' dobra; no ik.create, omitido = o lado em que ele ja esta na pose de setup"),
  compress: z.boolean().optional(),
  stretch: z.boolean().optional(),
  uniform: z.boolean().optional(),
});

defineCommand({
  name: "ik.create",
  group: "constraint",
  summary: "IK: 1 ou 2 ossos (ex: braco e antebraco) que apontam/alcancam o osso alvo. Mexer o alvo dobra a cadeia.",
  params: z.object({ name: Name, bones: z.array(z.string()).min(1).max(2), target: z.string(), index: z.number().int().optional(), ...IkProps.shape }),
  label: (p) => `IK ${p.name}`,
  run({ e }, p) {
    p.bones.forEach((b) => requireBone(e.json, b));
    requireBone(e.json, p.target);
    if (p.bones.includes(p.target)) throw new Error("o alvo nao pode estar na cadeia");
    const { name, bones, target, index, ...props } = p;
    // sem bendPositive: dobra para o lado em que o cotovelo ja esta desenhado (senao
    // metade dos bracos vira do avesso ao ligar a IK)
    let inferred: boolean | undefined;
    if (bones.length === 2 && props.bendPositive === undefined) {
      const sk = skeletonAt(e.json, null, 0);
      const [p0, p1] = bones.map((b) => boneWorld(sk, b));
      const len = e.json.bones.find((b: any) => b.name === bones[1])?.length ?? 0;
      const tip = [p1.x + p1.a * len, p1.y + p1.c * len];
      const cross = (p1.x - p0.x) * (tip[1] - p1.y) - (p1.y - p0.y) * (tip[0] - p1.x);
      if (len > 0 && Math.abs(cross) > 1e-6) props.bendPositive = inferred = cross > 0;
    }
    addConstraint(e, { type: "ik", name, bones, target, ...clean(props, IK_DEFAULTS) }, index);
    return inferred === undefined ? { created: name } : { created: name, bendPositive: inferred, note: "lado da dobra tirado da pose de setup" };
  },
});

// propriedades "from -> to" do transform constraint 4.3
const TPROPS = ["rotate", "x", "y", "scaleX", "scaleY", "shearY"] as const;
const TRANSFORM_DEFAULTS = { mixRotate: 1, mixX: 1, mixY: 1, mixScaleX: 1, mixScaleY: 1, mixShearY: 1, rotation: 0, x: 0, y: 0, scaleX: 0, scaleY: 0, shearY: 0, localSource: false, localTarget: false, additive: false, clamp: false };

defineCommand({
  name: "transform.create",
  group: "constraint",
  summary:
    "Transform constraint: os ossos copiam (no todo ou em parte, mix 0..1) rotacao/posicao/escala do osso fonte. copy escolhe o que copiar; offsets (rotation, x, y...) somam. Para mapeamentos avancados use properties no formato 4.3.",
  params: z.object({
    name: Name,
    source: z.string(),
    bones: z.array(z.string()).min(1),
    copy: z.array(z.enum(TPROPS)).default(["rotate", "x", "y", "scaleX", "scaleY", "shearY"]),
    properties: z.record(z.string(), z.any()).optional().describe('formato 4.3 cru: {"x":{"offset":0,"to":{"x":{"max":100}}}}'),
    mixRotate: z.number().optional(),
    mixX: z.number().optional(),
    mixY: z.number().optional(),
    mixScaleX: z.number().optional(),
    mixScaleY: z.number().optional(),
    mixShearY: z.number().optional(),
    rotation: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    localSource: z.boolean().optional(),
    localTarget: z.boolean().optional(),
    additive: z.boolean().optional(),
    clamp: z.boolean().optional(),
    index: z.number().int().optional(),
  }),
  label: (p) => `transform ${p.name}`,
  run({ e }, p) {
    requireBone(e.json, p.source);
    p.bones.forEach((b) => requireBone(e.json, b));
    const { name, source, bones, copy, properties, index, ...rest } = p;
    const props = properties ?? Object.fromEntries(copy.map((k) => [k, { to: { [k]: {} } }]));
    const c: any = { type: "transform", name, source, bones, ...clean(rest, TRANSFORM_DEFAULTS), properties: props };
    addConstraint(e, c, index);
    return { created: name };
  },
});

const PHYS_DEFAULTS = { x: 0, y: 0, rotate: 0, scaleX: 0, shearX: 0, inertia: 0.5, strength: 100, damping: 0.85, mass: 1, wind: 0, gravity: 0, mix: 1, fps: 60, limit: 5000 };
const PhysProps = z.object({
  x: z.number().min(0).max(1).optional().describe("quanto a fisica move em x (0..1)"),
  y: z.number().min(0).max(1).optional(),
  rotate: z.number().min(0).max(1).optional().describe("quanto a fisica gira (balanco de cabelo, orelha)"),
  scaleX: z.number().min(0).max(1).optional(),
  shearX: z.number().min(0).max(1).optional(),
  inertia: z.number().optional().describe("0..1: quanto o osso 'fica para tras'"),
  strength: z.number().optional().describe("forca da mola de volta (maior = mais duro)"),
  damping: z.number().optional().describe("0..1: amortecimento (menor = balanca mais)"),
  mass: z.number().optional(),
  wind: z.number().optional(),
  gravity: z.number().optional(),
  mix: z.number().optional(),
  fps: z.number().optional().describe("passo da simulacao; o corpus usa 20 ou 60"),
  limit: z.number().optional(),
  length: z.number().positive().optional().describe("comprimento do osso para a fisica de rotacao (sem: estimado pelas imagens do osso)"),
});

// A fisica de rotacao/escala/shear balanca a ponta do osso (origem + comprimento). Com
// comprimento 0 nao ha ponta e o osso gira voltas inteiras: estima pela maior imagem dele.
function estimateLength(doc: any, bone: string): number {
  let best = 0;
  for (const sl of slots(doc).filter((s) => s.bone === bone))
    for (const sk of skins(doc))
      for (const a of Object.values<any>(sk.attachments?.[sl.name] ?? {})) {
        if (a.type === undefined || a.type === "region") best = Math.max(best, Math.max(a.width ?? 0, a.height ?? 0) * Math.max(Math.abs(a.scaleX ?? 1), Math.abs(a.scaleY ?? 1)));
        else if (a.type === "mesh" && a.vertices?.length === a.uvs?.length) {
          const v = a.vertices;
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let i = 0; i < v.length; i += 2) (x0 = Math.min(x0, v[i])), (x1 = Math.max(x1, v[i])), (y0 = Math.min(y0, v[i + 1])), (y1 = Math.max(y1, v[i + 1]));
          best = Math.max(best, x1 - x0, y1 - y0);
        } else if (a.type === "mesh") best = Math.max(best, a.width ?? 0, a.height ?? 0);
      }
  return Math.round(best * 0.7) || 50;
}

defineCommand({
  name: "physics.create",
  group: "constraint",
  summary:
    "Fisica num osso (balanco secundario: cabelo, orelha, tecido, rabo). Escolha os canais (rotate, x, y...) de 0 a 1 e o comportamento (inertia, strength, damping, gravity). Presets: use physics.preset.",
  params: z.object({ name: Name, bone: z.string(), index: z.number().int().optional(), ...PhysProps.shape }),
  label: (p) => `fisica ${p.name}`,
  run({ e }, p) {
    requireBone(e.json, p.bone);
    const { name, bone, index, length, ...props } = p;
    if (!["x", "y", "rotate", "scaleX", "shearX"].some((k) => (props as any)[k])) (props as any).rotate = 1;
    const bi = requireBone(e.json, bone);
    let setLength: number | undefined;
    if (["rotate", "scaleX", "shearX"].some((k) => (props as any)[k]) && (length !== undefined || !e.json.bones[bi].length)) {
      setLength = round(length ?? estimateLength(e.json, bone));
      e.set(["bones", bi, "length"], setLength);
    }
    addConstraint(e, { type: "physics", name, bone, ...clean(props, PHYS_DEFAULTS) }, index);
    return { created: name, ...(setLength !== undefined ? { length: setLength } : {}) };
  },
});

// presets com nome (valores tirados do que o corpus usa)
const PHYS_PRESETS: Record<string, Record<string, number>> = {
  cabelo: { rotate: 1, inertia: 0.5, strength: 80, damping: 0.75, fps: 60 },
  orelha: { rotate: 1, inertia: 0.6, strength: 120, damping: 0.8, fps: 60 },
  tecido: { x: 1, y: 1, inertia: 0.5, strength: 100, damping: 0.85, fps: 20 },
  mola: { rotate: 1, inertia: 0.8, strength: 60, damping: 0.6, fps: 60 },
  rigido: { rotate: 1, inertia: 0.3, strength: 250, damping: 0.95, fps: 60 },
  // sem gravidade: numa fisica de rotacao o spine-godot puxa para o lado contrario do
  // editor do Spine e a peca fica torta no fim (um pingente, medido); a mola mole basta
  pendurado: { rotate: 1, inertia: 0.5, strength: 40, damping: 0.85, fps: 60 },
};

defineCommand({
  name: "physics.preset",
  group: "constraint",
  summary: `Fisica pronta num osso: ${Object.keys(PHYS_PRESETS).join(", ")}.`,
  params: z.object({ bone: z.string(), preset: z.enum(Object.keys(PHYS_PRESETS) as [string, ...string[]]), name: z.string().optional(), length: z.number().positive().optional() }),
  label: (p) => `fisica ${p.preset} em ${p.bone}`,
  run(ctx, p) {
    return ctx.run("physics.create", { name: p.name ?? `${p.bone}_fisica`, bone: p.bone, length: p.length, ...PHYS_PRESETS[p.preset] });
  },
});

const PATH_DEFAULTS = { positionMode: "percent", spacingMode: "length", rotateMode: "tangent", rotation: 0, position: 0, spacing: 0, mixRotate: 1, mixX: 1, mixY: 1 };

defineCommand({
  name: "pathc.create",
  group: "constraint",
  summary: "Path constraint: os ossos seguem/sao distribuidos ao longo de um path attachment do slot alvo (position 0..1 anima o percurso).",
  params: z.object({
    name: Name,
    bones: z.array(z.string()).min(1),
    target: z.string().describe("slot com o path attachment"),
    positionMode: z.enum(["fixed", "percent"]).optional(),
    spacingMode: z.enum(["length", "fixed", "percent", "proportional"]).optional(),
    rotateMode: z.enum(["tangent", "chain", "chainScale"]).optional(),
    rotation: z.number().optional(),
    position: z.number().optional(),
    spacing: z.number().optional(),
    mixRotate: z.number().optional(),
    mixX: z.number().optional(),
    mixY: z.number().optional(),
    index: z.number().int().optional(),
  }),
  label: (p) => `path ${p.name}`,
  run({ e }, p) {
    p.bones.forEach((b) => requireBone(e.json, b));
    requireSlot(e.json, p.target);
    const { name, bones, target, index, ...props } = p;
    // no 4.3 o slot do path vai em "slot" (o 4.2 usava "target"; o runtime 4.3 nao le)
    addConstraint(e, { type: "path", name, slot: target, bones, ...clean(props, PATH_DEFAULTS) }, index);
    return { created: name };
  },
});

defineCommand({
  name: "slider.create",
  group: "constraint",
  summary: "Slider (4.3): uma propriedade de um osso (ou time) dirige uma animacao inteira. animation = a animacao controlada.",
  params: z.object({
    name: Name,
    animation: z.string(),
    bone: z.string().optional().describe("osso cuja propriedade dirige o slider (sem: anima-se 'time')"),
    property: z.enum(["rotate", "x", "y", "scaleX", "scaleY", "shearY"]).optional(),
    from: z.number().optional(),
    to: z.number().optional(),
    scale: z.number().optional(),
    max: z.number().optional(),
    local: z.boolean().optional(),
    additive: z.boolean().optional(),
    loop: z.boolean().optional(),
    mix: z.number().optional(),
    time: z.number().optional(),
    index: z.number().int().optional(),
  }),
  label: (p) => `slider ${p.name}`,
  run({ e }, p) {
    if (!e.json.animations?.[p.animation]) throw new Error(`animacao nao existe: ${p.animation}`);
    if (p.bone) requireBone(e.json, p.bone);
    const { name, index, ...props } = p;
    addConstraint(e, { type: "slider", name, ...clean(props, { from: 0, to: 0, scale: 1, max: 0, local: false, additive: false, loop: false, mix: 1, time: 0 }) }, index);
    return { created: name };
  },
});

defineCommand({
  name: "constraint.set",
  group: "constraint",
  summary: "Muda propriedades de uma constraint existente (qualquer campo do formato: mix, softness, inertia, strength, bones, target...). null remove o campo.",
  params: z.object({ name: z.string(), props: z.record(z.string(), z.any()) }),
  label: (p) => `constraint ${p.name}`,
  run({ e }, p) {
    const c = findC(e, p.name);
    for (const [k, v] of Object.entries(p.props)) {
      if (k === "name" || k === "type") throw new Error("use constraint.rename para nome; tipo nao muda");
      if ((k === "bone" || k === "target" || k === "source" || k === "slot") && typeof v === "string") (c.type === "path" && (k === "target" || k === "slot") ? requireSlot : requireBone)(e.json, v);
      if (k === "bones" && Array.isArray(v)) v.forEach((b: string) => requireBone(e.json, b));
      e.set([...c.path, k], v === null ? undefined : typeof v === "number" ? round(v) : v);
    }
    return { ok: true };
  },
});

defineCommand({
  name: "constraint.delete",
  group: "constraint",
  summary: "Remove uma constraint e as timelines dela.",
  params: z.object({ name: z.string() }),
  label: (p) => `remove constraint ${p.name}`,
  run({ e }, p) {
    const c = findC(e, p.name);
    e.remove(c.path.slice(0, -1), c.path[c.path.length - 1] as number);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {})) {
      const sec = c.type as ConstraintType;
      if (a[sec]?.[p.name] !== undefined) e.set(["animations", an, sec, p.name], undefined);
    }
    for (const [si, s] of (e.json.skins ?? []).entries()) {
      const list = s[c.type];
      if (Array.isArray(list) && list.includes(p.name))
        e.set(
          ["skins", si, c.type],
          list.filter((n: string) => n !== p.name),
        );
    }
    return { deleted: p.name };
  },
});

defineCommand({
  name: "constraint.order",
  group: "constraint",
  summary: "Muda a ordem de aplicacao de uma constraint (index no array constraints). A ordem importa quando uma depende da outra.",
  params: z.object({ name: z.string(), index: z.number().int().min(0) }),
  label: (p) => `ordem ${p.name} -> ${p.index}`,
  run({ e }, p) {
    const c = findC(e, p.name);
    if (c.path[0] !== "constraints") throw new Error("constraint em formato antigo (fora de 'constraints'); reexporte no 4.3");
    const i = c.path[1] as number;
    const v = structuredClone(c.c);
    e.remove(["constraints"], i);
    e.insert(["constraints"], Math.min(p.index, e.json.constraints.length), v);
    return { index: Math.min(p.index, e.json.constraints.length - 1) };
  },
});
