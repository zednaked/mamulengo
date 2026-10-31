// Comandos de setup pose: ossos, slots, attachments.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { BONE_DEFAULTS, EFFECTS, boneIndex, bones, descendants, requireBone, requireSkin, requireSlot, skins, slotIndex, slots } from "../model.ts";
import { round } from "./timeline.ts";
import type { Editor } from "../document.ts";
import { apply, applyLinear, boneWorld, invert, skeletonAt, type Affine } from "../pose.ts";
import { withBoneOrder } from "../boneorder.ts";
import { comMedidor } from "../instantes.ts";

const BoneProps = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  rotation: z.number().optional().describe("graus, relativo ao pai"),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  shearX: z.number().optional(),
  shearY: z.number().optional(),
  length: z.number().min(0).optional(),
  inherit: z.enum(["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"]).optional(),
  color: z.string().optional().describe("cor do osso no editor, hex rrggbbaa"),
  icon: z.string().optional(),
});

// ordem de campos que o exportador usa num osso
const BONE_ORDER = ["name", "parent", "length", "rotation", "x", "y", "scaleX", "scaleY", "shearX", "shearY", "inherit", "skin", "color", "icon", "iconSize", "iconRotation"];

function setFields(e: Editor, path: (string | number)[], cur: any, props: Record<string, any>, defaults: Record<string, any>) {
  for (const [k, v0] of Object.entries(props)) {
    if (v0 === undefined) continue;
    const v = typeof v0 === "number" ? round(v0) : v0;
    const want = defaults[k] !== undefined && v === defaults[k] ? undefined : v;
    if (cur[k] !== want) e.set([...path, k], want);
  }
}

defineCommand({
  name: "bone.add",
  group: "bone",
  summary: "Cria um osso filho de outro, na setup pose. Coordenadas relativas ao pai.",
  params: z.object({
    name: z.string().min(1),
    parent: z.string().default("root"),
    at: z.tuple([z.number(), z.number()]).optional().describe("posicao da base do osso no MUNDO (pixels, y para cima); substitui x/y"),
    toward: z.tuple([z.number(), z.number()]).optional().describe("ponta do osso no MUNDO: define rotation e length"),
    ...BoneProps.shape,
  }),
  label: (p) => `novo osso ${p.name}`,
  run({ e }, p) {
    if (boneIndex(e.json, p.name) >= 0) throw new Error(`osso ja existe: ${p.name}`);
    // coordenadas de mundo -> locais ao pai (na setup pose)
    if ((p.at || p.toward) && bones(e.json).length) {
      requireBone(e.json, p.parent);
      const W = boneWorld(skeletonAt(e.json, null, 0), p.parent);
      const inv = invert(W);
      const base = p.at ?? apply(W, p.x ?? 0, p.y ?? 0);
      const [lx, ly] = apply(inv, base[0], base[1]);
      p.x = lx;
      p.y = ly;
      if (p.toward) {
        const [tx, ty] = apply(inv, p.toward[0], p.toward[1]);
        p.rotation = (Math.atan2(ty - ly, tx - lx) * 180) / Math.PI;
        // comprimento no espaco local do pai (com escala do pai)
        p.length = Math.hypot(tx - lx, ty - ly);
      }
    }
    const list = bones(e.json);
    let at = list.length;
    if (list.length) {
      // ossos ficam depois do pai e de todos os descendentes dele (o runtime exige pai antes do filho)
      const pi = requireBone(e.json, p.parent);
      const desc = descendants(e.json, p.parent);
      at = pi + 1;
      for (let i = pi + 1; i < list.length; i++) if (desc.has(list[i].name)) at = i + 1;
    }
    const b: any = { name: p.name };
    if (list.length) b.parent = p.parent;
    for (const k of BONE_ORDER) {
      const v = (p as any)[k];
      if (k === "name" || k === "parent" || v === undefined) continue;
      const def = (BONE_DEFAULTS as any)[k];
      if (def !== undefined && v === def) continue;
      if (k === "inherit" && v === "normal") continue;
      b[k] = typeof v === "number" ? round(v) : v;
    }
    withBoneOrder(e, () => e.insert(["bones"], at, b));
    return { index: at };
  },
});

defineCommand({
  name: "bone.set",
  group: "bone",
  summary:
    "Muda propriedades do osso na setup pose (x, y, rotation, scaleX, scaleY, shearX, shearY, length, inherit, color). at/toward reposicionam pelo MUNDO (filhos e imagens vao junto).",
  params: z.preprocess(
    (v: any) => (v && v.bone === undefined && v.name !== undefined ? { ...v, bone: v.name, name: undefined } : v),
    z.object({
      bone: z.string(),
      at: z.tuple([z.number(), z.number()]).optional().describe("base do osso no MUNDO"),
      toward: z.tuple([z.number(), z.number()]).optional().describe("ponta do osso no MUNDO (rotation e length)"),
      ...BoneProps.shape,
    }),
  ),
  label: (p) => `osso ${p.bone}`,
  run({ e }, p) {
    const i = requireBone(e.json, p.bone);
    if (p.at || p.toward) {
      const cur = bones(e.json)[i];
      const sk = skeletonAt(e.json, null, 0);
      const W = cur.parent ? boneWorld(sk, cur.parent) : { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };
      const inv = invert(W);
      const base = p.at ?? [boneWorld(sk, p.bone).x, boneWorld(sk, p.bone).y];
      const [lx, ly] = apply(inv, base[0], base[1]);
      p.x = lx;
      p.y = ly;
      if (p.toward) {
        const [tx, ty] = apply(inv, p.toward[0], p.toward[1]);
        p.rotation = (Math.atan2(ty - ly, tx - lx) * 180) / Math.PI;
        p.length = Math.hypot(tx - lx, ty - ly);
      }
    }
    const { bone, at, toward, ...props } = p;
    void at;
    void toward;
    setFields(e, ["bones", i], bones(e.json)[i], props, { ...BONE_DEFAULTS, inherit: "normal" });
    return { index: i };
  },
});

defineCommand({
  name: "bone.reparent",
  group: "bone",
  summary: "Troca o pai de um osso. keepWorld=true mantem o osso parado na tela (recalcula x/y/rotation locais).",
  params: z.object({ bone: z.string(), parent: z.string(), keepWorld: z.boolean().default(true) }),
  label: (p) => `pai de ${p.bone} = ${p.parent}`,
  run({ e }, p) {
    const i = requireBone(e.json, p.bone);
    requireBone(e.json, p.parent);
    if (p.bone === p.parent || descendants(e.json, p.bone).has(p.parent)) throw new Error("o novo pai nao pode ser o proprio osso nem um descendente");
    const list = bones(e.json);
    const moving = [p.bone, ...descendants(e.json, p.bone)];
    const movingSet = new Set(moving);
    if (p.keepWorld) {
      const w = worldSetup(e.json);
      const me = w.get(p.bone)!;
      const par = w.get(p.parent)!;
      const local = toLocal(par, me);
      setFields(e, ["bones", i], list[i], { x: local.x, y: local.y, rotation: local.rotation, scaleX: local.scaleX, scaleY: local.scaleY }, BONE_DEFAULTS);
    }
    e.set(["bones", i, "parent"], p.parent);
    // reordena: o bloco que se move vai para depois do novo pai e seus descendentes
    // (indices de osso nas malhas com pesos sao remapeados)
    return withBoneOrder(e, () => {
    const block = list.filter((b) => movingSet.has(b.name)).map((b) => structuredClone(b));
    for (let n = list.length - 1; n >= 0; n--) if (movingSet.has(bones(e.json)[n].name)) e.remove(["bones"], n);
    const now = bones(e.json);
    const pi = now.findIndex((b) => b.name === p.parent);
    const pdesc = descendants(e.json, p.parent);
    let at = pi + 1;
    for (let n = pi + 1; n < now.length; n++) if (pdesc.has(now[n].name)) at = n + 1;
    block.forEach((b, k) => e.insert(["bones"], at + k, b));
    return { index: at };
    });
  },
});

// transformacao de mundo na setup pose (somente para operacoes de edicao; o render usa o runtime)
interface W {
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
  y: number;
}
export function worldSetup(doc: any): Map<string, W> {
  const out = new Map<string, W>();
  for (const b of bones(doc)) {
    const rot = ((b.rotation ?? 0) * Math.PI) / 180;
    const shx = ((b.shearX ?? 0) * Math.PI) / 180;
    const shy = ((b.shearY ?? 0) * Math.PI) / 180;
    const sx = b.scaleX ?? 1;
    const sy = b.scaleY ?? 1;
    const la = Math.cos(rot + shx) * sx;
    const lb = Math.cos(rot + Math.PI / 2 + shy) * sy;
    const lc = Math.sin(rot + shx) * sx;
    const ld = Math.sin(rot + Math.PI / 2 + shy) * sy;
    const x = b.x ?? 0;
    const y = b.y ?? 0;
    const p = b.parent ? out.get(b.parent) : null;
    if (!p) out.set(b.name, { a: la, b: lb, c: lc, d: ld, x, y });
    else
      out.set(b.name, {
        a: p.a * la + p.b * lc,
        b: p.a * lb + p.b * ld,
        c: p.c * la + p.d * lc,
        d: p.c * lb + p.d * ld,
        x: p.a * x + p.b * y + p.x,
        y: p.c * x + p.d * y + p.y,
      });
  }
  return out;
}

function toLocal(parent: W, child: W) {
  const det = parent.a * parent.d - parent.b * parent.c;
  const ia = parent.d / det,
    ib = -parent.b / det,
    ic = -parent.c / det,
    id = parent.a / det;
  const dx = child.x - parent.x,
    dy = child.y - parent.y;
  const la = ia * child.a + ib * child.c;
  const lc = ic * child.a + id * child.c;
  const lb = ia * child.b + ib * child.d;
  const ld = ic * child.b + id * child.d;
  const rotation = (Math.atan2(lc, la) * 180) / Math.PI;
  const scaleX = Math.hypot(la, lc);
  const scaleY = (la * ld - lb * lc) / scaleX;
  return { x: ia * dx + ib * dy, y: ic * dx + id * dy, rotation, scaleX, scaleY };
}

const SLOT_ORDER = ["name", "bone", "color", "dark", "attachment", "blend", "visible"];

defineCommand({
  name: "slot.add",
  group: "slot",
  summary: "Cria um slot preso a um osso. Slots definem a ordem de desenho (o primeiro fica atras). index opcional para posicionar.",
  params: z.object({
    name: z.string().min(1),
    bone: z.string(),
    attachment: z.string().optional().describe("attachment visivel na setup pose"),
    color: z.string().optional(),
    blend: z.enum(["normal", "additive", "multiply", "screen"]).optional(),
    index: z.number().int().min(0).optional().describe("posicao na ordem de desenho; padrao: na frente de todos"),
    above: z.string().optional().describe("alternativa a index: fica logo na frente deste slot"),
    below: z.string().optional().describe("alternativa a index: fica logo atras deste slot"),
  }),
  label: (p) => `novo slot ${p.name}`,
  run({ e }, p) {
    if (slotIndex(e.json, p.name) >= 0) throw new Error(`slot ja existe: ${p.name}`);
    requireBone(e.json, p.bone);
    let at = slots(e.json).length;
    if (p.index !== undefined) at = Math.min(p.index, at);
    else if (p.above) at = requireSlot(e.json, p.above) + 1;
    else if (p.below) at = requireSlot(e.json, p.below);
    const s: any = {};
    for (const k of SLOT_ORDER) {
      const v = (p as any)[k];
      if (v === undefined || (k === "blend" && v === "normal")) continue;
      s[k] = v;
    }
    if (!e.json.slots) e.set(["slots"], []);
    e.insert(["slots"], at, s);
    return { index: at };
  },
});

defineCommand({
  name: "slot.set",
  group: "slot",
  summary:
    "Muda propriedades do slot na setup pose: bone, attachment (null esconde), color, dark, blend, visible, depth (so .boneco: a camada para a luz). Trocar o bone mantem as imagens no mesmo lugar da tela (keepWorld, padrao true): regioes, malhas sem peso e seus deforms, pontos, caixas e recortes sao recalculados no osso novo.",
  params: z.object({
    slot: z.string(),
    bone: z.string().optional(),
    keepWorld: z.boolean().default(true),
    attachment: z.string().nullable().optional(),
    color: z.string().optional(),
    dark: z.string().nullable().optional(),
    blend: z.enum(["normal", "additive", "multiply", "screen"]).optional(),
    visible: z.boolean().optional(),
    depth: z.number().optional().describe("so .boneco: a camada do slot para a luz, em px (positiva para perto de quem assiste; a instancia soma a dela nos slots do filho)"),
  }),
  label: (p) => `slot ${p.slot}`,
  run({ e }, p) {
    const i = requireSlot(e.json, p.slot);
    if (p.bone) requireBone(e.json, p.bone);
    const { slot, keepWorld, ...props } = p;
    const cur = slots(e.json)[i];
    if (p.bone && p.bone !== cur.bone && keepWorld) rebaseSlot(e, slot, cur.bone, p.bone);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined) continue;
      const want = v === null || (k === "blend" && v === "normal") || (k === "visible" && v === true) || (k === "depth" && v === 0) || (k === "color" && /^ffffffff?$/i.test(v as string)) ? undefined : v;
      if (cur[k] !== want) e.set(["slots", i, k], want);
    }
    return { index: i };
  },
});

defineCommand({
  name: "slot.effect",
  group: "slot",
  summary:
    "Efeito do slot na setup pose (so do Mamulengo, para personagens .boneco; o Spine nao tem): outline (contorno: color, width em pixels da textura), glow (halo: color, strength, radius), dissolve (sumir em pedacos: value 0-1, color e edge da borda, grain o tamanho dos pedacos em pixels da textura), tint (tingir: color, strength 0-1), smear (borrar: estica a traseira da imagem pela velocidade; strength em segundos de movimento, 0 desliga, ~0.03 a 0.1; limit a esticada maxima em pixels do mundo; fade 0-1 quanto a ponta fica transparente), trail (rastro: copias de quadros anteriores por tras da imagem; copies 0 a 16, interval em segundos entre elas, alpha 0-1 da mais nova). Campos omitidos ficam como estao; off:true tira o efeito. Para animar, key.set com timeline outline/glow/dissolve/tint/smear/trail no {slot}.",
  params: z.object({
    slot: z.string(),
    effect: z.enum(["outline", "glow", "dissolve", "tint", "smear", "trail"]),
    color: z.string().regex(/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).optional().describe("hex rrggbb[aa]"),
    width: z.number().min(0).optional(),
    strength: z.number().min(0).optional(),
    radius: z.number().min(0).optional(),
    value: z.number().min(0).max(1).optional(),
    edge: z.number().min(0).max(1).optional(),
    grain: z.number().min(1).optional(),
    limit: z.number().min(0).optional(),
    fade: z.number().min(0).max(1).optional(),
    copies: z.number().min(0).max(16).optional(),
    interval: z.number().min(0).optional(),
    alpha: z.number().min(0).max(1).optional(),
    off: z.boolean().optional(),
  }),
  label: (p) => `efeito ${p.effect} em ${p.slot}${p.off ? " (tira)" : ""}`,
  run({ e }, p) {
    const i = requireSlot(e.json, p.slot);
    const cur = slots(e.json)[i].effects ?? {};
    if (p.off) {
      const { [p.effect]: _, ...resto } = cur;
      e.set(["slots", i, "effects"], Object.keys(resto).length ? resto : undefined);
      return { index: i, effects: resto };
    }
    const campos = EFFECTS[p.effect].map(([f]) => f);
    const novo: Record<string, any> = { ...(cur[p.effect] ?? {}) };
    for (const f of campos) if ((p as any)[f] !== undefined) novo[f] = f === "color" ? (p as any)[f].toLowerCase() : round((p as any)[f]);
    for (const k of Object.keys((p as any))) if (!campos.includes(k) && ["color", "width", "strength", "radius", "value", "edge", "grain", "limit", "fade", "copies", "interval", "alpha"].includes(k)) throw new Error(`${p.effect} nao tem ${k}; campos: ${campos.join(", ")}`);
    const tudo = { ...cur, [p.effect]: novo };
    if (JSON.stringify(cur) !== JSON.stringify(tudo)) e.set(["slots", i, "effects"], tudo);
    return { index: i, effects: tudo };
  },
});

const mul = (m: Affine, n: Affine): Affine => ({ a: m.a * n.a + m.b * n.c, b: m.a * n.b + m.b * n.d, c: m.c * n.a + m.d * n.c, d: m.c * n.b + m.d * n.d, x: m.a * n.x + m.b * n.y + m.x, y: m.c * n.x + m.d * n.y + m.y });

// Leva as imagens de um slot do osso antigo para o novo sem mexer nelas na tela
// (setup pose). Malha com pesos ja e independente do osso do slot.
function rebaseSlot(e: Editor, slot: string, from: string, to: string) {
  const sk = skeletonAt(e.json, null, 0);
  const T = mul(invert(boneWorld(sk, to)), boneWorld(sk, from)); // local antigo -> local novo
  const pts = (v: number[]) => {
    const out = [...v];
    for (let k = 0; k + 1 < out.length; k += 2) [out[k], out[k + 1]] = apply(T, out[k], out[k + 1]).map(round) as [number, number];
    return out;
  };
  skins(e.json).forEach((sk2, si) => {
    for (const [name, a] of Object.entries<any>(sk2.attachments?.[slot] ?? {})) {
      const base = ["skins", si, "attachments", slot, name];
      const type = a.type ?? "region";
      if (type === "region") {
        const r = ((a.rotation ?? 0) * Math.PI) / 180;
        const L: Affine = { a: Math.cos(r) * (a.scaleX ?? 1), b: -Math.sin(r) * (a.scaleY ?? 1), c: Math.sin(r) * (a.scaleX ?? 1), d: Math.cos(r) * (a.scaleY ?? 1), x: a.x ?? 0, y: a.y ?? 0 };
        const M = mul(T, L);
        const sx = Math.hypot(M.a, M.c);
        e.set([...base, "x"], round(M.x));
        e.set([...base, "y"], round(M.y));
        e.set([...base, "rotation"], round((Math.atan2(M.c, M.a) * 180) / Math.PI));
        e.set([...base, "scaleX"], round(sx));
        e.set([...base, "scaleY"], round((M.a * M.d - M.b * M.c) / sx));
      } else if (type === "point") {
        const [x, y] = apply(T, a.x ?? 0, a.y ?? 0);
        e.set([...base, "x"], round(x));
        e.set([...base, "y"], round(y));
        e.set([...base, "rotation"], round((a.rotation ?? 0) + (Math.atan2(T.c, T.a) * 180) / Math.PI));
      } else if (Array.isArray(a.vertices) && a.vertices.length === (a.uvs?.length ?? (a.vertexCount ?? 0) * 2)) {
        // malha, caixa, recorte ou path sem pesos: vertices no espaco do osso
        e.set([...base, "vertices"], pts(a.vertices));
      }
    }
  });
  // deforms de malhas sem peso: deslocamentos sao vetores (sem translacao)
  for (const [an, anim] of Object.entries<any>(e.json.animations ?? {}))
    for (const [skin, slotsMap] of Object.entries<any>(anim.attachments ?? {}))
      for (const [att, tls] of Object.entries<any>(slotsMap?.[slot] ?? {}))
        {
          // so malha sem pesos: com pesos o deform e por osso de peso, nao do slot
          const m = skins(e.json).find((x) => x.name === skin)?.attachments?.[slot]?.[att];
          if (!m || m.vertices?.length !== m.uvs?.length) continue;
          (tls.deform ?? []).forEach((k: any, ki: number) => {
            if (!k.vertices?.length) return;
            // offset impar: o primeiro valor e o y de um vertice; alinha com um x de enchimento
            const odd = (k.offset ?? 0) % 2 === 1;
            const v = odd ? [0, ...k.vertices] : [...k.vertices];
            if (v.length % 2) v.push(0);
            for (let j = 0; j + 1 < v.length; j += 2) [v[j], v[j + 1]] = applyLinear(T, v[j], v[j + 1]).map(round) as [number, number];
            const outV = v.slice(odd ? 1 : 0, (odd ? 1 : 0) + k.vertices.length);
            e.set(["animations", an, "attachments", skin, slot, att, "deform", ki, "vertices"], outV);
          });
        }
}

defineCommand({
  name: "slot.order",
  group: "slot",
  summary: "Move um slot na ordem de desenho da setup pose (index 0 = mais atras).",
  params: z.object({ slot: z.string(), index: z.number().int().min(0) }),
  label: (p) => `ordem ${p.slot} -> ${p.index}`,
  run({ e }, p) {
    const i = requireSlot(e.json, p.slot);
    const n = slots(e.json).length;
    const to = Math.min(p.index, n - 1);
    if (to === i) return { index: i };
    // timelines de drawOrder guardam offsets relativos a ordem de setup; mudar a ordem
    // de setup sem refazer os offsets mudaria as animacoes
    const anims = Object.entries(e.json.animations ?? {}).filter(([, a]: any) => a.drawOrder?.length);
    if (anims.length) throw new Error(`as animacoes ${anims.map(([n]) => n).join(", ")} tem timeline de drawOrder; reordenar a setup quebraria os offsets (ainda nao suportado)`);
    const s = structuredClone(slots(e.json)[i]);
    e.remove(["slots"], i);
    e.insert(["slots"], to, s);
    return { index: to };
  },
});

const RegionProps = z.object({
  path: z.string().optional().describe("nome da regiao no atlas, se diferente do nome do attachment"),
  x: z.number().optional(),
  y: z.number().optional(),
  rotation: z.number().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  color: z.string().optional(),
});
const REGION_DEFAULTS = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
const REGION_ORDER = ["name", "path", "x", "y", "scaleX", "scaleY", "rotation", "width", "height", "color"];

defineCommand({
  name: "attachment.region",
  group: "attachment",
  summary: "Cria ou atualiza um attachment de imagem (region) num slot. width/height padrao = tamanho da imagem no atlas. x/y/rotation posicionam a imagem relativa ao osso do slot.",
  params: z.object({
    slot: z.string(),
    name: z.string(),
    skin: z.string().default("default"),
    world: z
      .object({
        center: z.tuple([z.number(), z.number()]),
        rotation: z.number().default(0),
        scale: z.tuple([z.number(), z.number()]).default([1, 1]),
        size: z.tuple([z.number(), z.number()]).optional().describe("tamanho na tela em pixels (alternativa a scale)"),
      })
      .optional()
      .describe("posiciona a imagem pelo MUNDO (centro, rotacao, escala ou tamanho na tela), como num PSD; substitui x/y/rotation/scale"),
    ...RegionProps.shape,
  }),
  label: (p) => `region ${p.slot}/${p.name}`,
  run({ e, assets }, p) {
    const sIdx = requireSlot(e.json, p.slot);
    // tamanho padrao (o da imagem no atlas) antes de converter size -> scale
    if (p.width === undefined || p.height === undefined) {
      const r = assets?.region(p.path ?? p.name);
      if (r) {
        p.width ??= r.width;
        p.height ??= r.height;
      }
    }
    if (p.world?.size) {
      if (!p.width || !p.height) throw new Error("world.size precisa do tamanho original da imagem (width/height ou a regiao no atlas)");
      p.world.scale = [p.world.size[0] / p.width, p.world.size[1] / p.height];
    }
    if (p.world) {
      // mundo -> local ao osso do slot (setup pose): centro, angulo e escala
      const W = boneWorld(skeletonAt(e.json, null, 0), slots(e.json)[sIdx].bone);
      const inv = invert(W);
      const [lx, ly] = apply(inv, p.world.center[0], p.world.center[1]);
      const r = (p.world.rotation * Math.PI) / 180;
      // eixo x da imagem no mundo, levado ao local do osso
      const ax = [Math.cos(r) * p.world.scale[0], Math.sin(r) * p.world.scale[0]];
      const ay = [-Math.sin(r) * p.world.scale[1], Math.cos(r) * p.world.scale[1]];
      const lax = [inv.a * ax[0] + inv.b * ax[1], inv.c * ax[0] + inv.d * ax[1]];
      const lay = [inv.a * ay[0] + inv.b * ay[1], inv.c * ay[0] + inv.d * ay[1]];
      p.x = lx;
      p.y = ly;
      p.rotation = (Math.atan2(lax[1], lax[0]) * 180) / Math.PI;
      p.scaleX = Math.hypot(lax[0], lax[1]);
      // escala y com sinal (espelhamento)
      p.scaleY = (lax[0] * lay[1] - lax[1] * lay[0]) / p.scaleX;
    }
    // tamanho padrao: o da imagem no atlas
    if (p.width === undefined || p.height === undefined) {
      const r = assets?.region(p.path ?? p.name);
      if (r) {
        p.width ??= r.width;
        p.height ??= r.height;
      }
    }
    let si = skins(e.json).findIndex((s) => s.name === p.skin);
    if (si < 0) {
      if (!e.json.skins) e.set(["skins"], []);
      si = skins(e.json).length;
      e.insert(["skins"], si, { name: p.skin, attachments: {} });
    }
    const path = ["skins", si, "attachments", p.slot, p.name];
    const cur = skins(e.json)[si].attachments?.[p.slot]?.[p.name];
    if (cur && (cur.type ?? "region") !== "region") throw new Error(`${p.slot}/${p.name} ja existe e e ${cur.type}`);
    const { slot, name, skin, world, ...props } = p;
    void world;
    if (!cur) {
      if (props.width === undefined || props.height === undefined) throw new Error(`regiao "${p.path ?? p.name}" nao esta no atlas; passe width e height ou adicione a imagem (mamulengo_add_images)`);
      const a: any = {};
      for (const k of REGION_ORDER) {
        const v = (props as any)[k];
        if (v === undefined || ((REGION_DEFAULTS as any)[k] !== undefined && v === (REGION_DEFAULTS as any)[k])) continue;
        a[k] = typeof v === "number" ? round(v) : v;
      }
      e.set(path, a);
      // slot ainda sem imagem na setup pose: passa a mostrar esta
      if (!slots(e.json)[sIdx].attachment && p.skin === "default") e.set(["slots", sIdx, "attachment"], p.name);
    } else setFields(e, path, cur, props, REGION_DEFAULTS);
    return { skin: p.skin, slot: p.slot, name: p.name, visible: slots(e.json)[sIdx].attachment === p.name };
  },
});

defineCommand({
  name: "attachment.delete",
  group: "attachment",
  summary: "Remove um attachment de um slot (e as timelines de deform dele).",
  params: z.object({ slot: z.string(), name: z.string(), skin: z.string().default("default") }),
  label: (p) => `remove ${p.slot}/${p.name}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    const atts = skins(e.json)[si].attachments?.[p.slot];
    if (!atts?.[p.name]) throw new Error(`attachment nao existe: ${p.slot}/${p.name}`);
    const linked = Object.entries(atts).filter(([, a]: any) => a.type === "linkedmesh" && a.source === p.name && !a.slot);
    if (linked.length) throw new Error(`linked meshes dependem dele: ${linked.map(([n]) => n).join(", ")}`);
    e.set(["skins", si, "attachments", p.slot, p.name], undefined);
    if (Object.keys(skins(e.json)[si].attachments[p.slot]).length === 0) e.set(["skins", si, "attachments", p.slot], undefined);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {}))
      if (a.attachments?.[p.skin]?.[p.slot]?.[p.name]) e.set(["animations", an, "attachments", p.skin, p.slot, p.name], undefined);
    return { deleted: `${p.slot}/${p.name}` };
  },
});

// Bounds do cabecalho (skeleton.x/y/width/height): o export do Spine sempre grava;
// asset criado pelo editor nao tem, e as ferramentas que enquadram pelo cabecalho
// (compare-anim, parity) ficam sem moldura. Medido pelo runtime com o atlas aberto.
defineCommand({
  name: "skeleton.bounds",
  group: "skeleton",
  summary: "Mede e grava os bounds do cabecalho (x, y, width, height) como o export do Spine: pela setup pose, ou a uniao com as animacoes (animations=true).",
  params: z.object({ animations: z.boolean().default(false).describe("inclui a pose de cada animacao (amostrada)") }),
  label: () => "bounds do esqueleto",
  run({ e, doc }, p) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (c: [number, number, number, number] | null) => {
      if (!c || !(c[2] > c[0])) return;
      [x0, y0, x1, y1] = [Math.min(x0, c[0]), Math.min(y0, c[1]), Math.max(x1, c[2]), Math.max(y1, c[3])];
    };
    // a pose de setup e, com animations, a pose direta de cada animacao (sem relogio)
    comMedidor(e.json, doc.atlas.text, (m) => {
      grow(m.caixa(null, 0));
      if (p.animations)
        for (const a of Object.keys(e.json.animations ?? {})) {
          const d = m.duracao(a);
          for (let t = 0; t <= d + 1e-9; t += Math.max(d / 8, 1 / 30)) grow(m.caixa(a, t));
        }
    });
    if (!isFinite(x0)) throw new Error("nada visivel para medir");
    const b = { x: round(x0), y: round(y0), width: round(x1 - x0), height: round(y1 - y0) };
    for (const [k, v] of Object.entries(b)) e.set(["skeleton", k], v);
    return b;
  },
});
