// Comandos de animacao: criar/remover animacoes, chaves e curvas.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { animations, channels, effectFields, fieldsAt, hasFields, requireAnimation } from "../model.ts";
import { boneWorld, invert, skeletonAt } from "../pose.ts";
import { CurveArg, Target, editKeys, findKey, getKeys, keyFields, presetShape, removeEmpty, round, timeOf, timelinePath, writeShape } from "./timeline.ts";

const AnimName = z.string().min(1).describe("Nome da animacao (ex: 2.idle)");

defineCommand({
  name: "animation.create",
  group: "animation",
  summary: "Cria uma animacao vazia. A duracao e definida pela ultima chave.",
  params: z.object({ name: AnimName }),
  label: (p) => `nova animacao ${p.name}`,
  run({ e }, p) {
    if (animations(e.json)[p.name]) throw new Error(`animacao ja existe: ${p.name}`);
    e.set(["animations", p.name], {});
    return { created: p.name };
  },
});

defineCommand({
  name: "animation.delete",
  group: "animation",
  summary: "Remove uma animacao.",
  params: z.object({ name: AnimName }),
  label: (p) => `remove animacao ${p.name}`,
  run({ e }, p) {
    requireAnimation(e.json, p.name);
    e.set(["animations", p.name], undefined);
    return { deleted: p.name };
  },
});

defineCommand({
  name: "animation.rename",
  group: "animation",
  summary: "Renomeia uma animacao mantendo a posicao dela na lista.",
  params: z.object({ name: AnimName, to: AnimName }),
  label: (p) => `renomeia ${p.name} -> ${p.to}`,
  run({ e }, p) {
    requireAnimation(e.json, p.name);
    if (animations(e.json)[p.to]) throw new Error(`animacao ja existe: ${p.to}`);
    e.apply({ op: "rename", path: ["animations"], from: p.name, to: p.to });
    return { renamed: p.to };
  },
});

defineCommand({
  name: "animation.duplicate",
  group: "animation",
  summary: "Copia uma animacao com outro nome (bom para variacoes: idle -> idle_break).",
  params: z.object({ name: AnimName, to: AnimName }),
  label: (p) => `duplica ${p.name} -> ${p.to}`,
  run({ e }, p) {
    const a = requireAnimation(e.json, p.name);
    if (animations(e.json)[p.to]) throw new Error(`animacao ja existe: ${p.to}`);
    e.set(["animations", p.to], a);
    return { created: p.to };
  },
});

const KeyValue = z
  .object({
    value: z.number().optional().describe("rotate (graus), alpha, translatex, scalex, mix de physics etc."),
    x: z.number().optional().describe("translate/scale/shear X"),
    y: z.number().optional().describe("translate/scale/shear Y"),
    color: z.string().regex(/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).optional().describe("rgba/rgb: hex rrggbb[aa]"),
    light: z.string().optional(),
    dark: z.string().optional(),
    name: z.string().nullable().optional().describe("attachment: nome do attachment a mostrar, null esconde"),
    offset: z.number().int().optional().describe("deform: indice do primeiro valor em vertices"),
    vertices: z.array(z.number()).optional().describe("deform: deslocamentos (x,y) por vertice a partir de offset"),
    inherit: z.enum(["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"]).optional(),
    mixRotate: z.number().optional(),
    mixX: z.number().optional(),
    mixY: z.number().optional(),
    mixScaleX: z.number().optional(),
    mixScaleY: z.number().optional(),
    mixShearY: z.number().optional(),
    mix: z.number().optional(),
    softness: z.number().optional(),
    mode: z.string().optional(),
    index: z.number().int().optional(),
    delay: z.number().optional(),
    count: z.number().int().min(1).optional().describe("burst: quantas particulas nascem de uma vez"),
    width: z.number().min(0).optional().describe("outline: largura em pixels da textura"),
    strength: z.number().min(0).optional().describe("glow e tint: forca (tint de 0 a 1); physics strength usa value"),
    radius: z.number().min(0).optional().describe("glow: raio em pixels da textura"),
    edge: z.number().min(0).max(1).optional().describe("dissolve: largura da borda colorida (0 a 1)"),
    grain: z.number().min(1).optional().describe("dissolve: tamanho dos pedacos, em pixels da textura (padrao 8)"),
    limit: z.number().min(0).optional().describe("smear: esticada maxima, em pixels do mundo (padrao 60)"),
    fade: z.number().min(0).max(1).optional().describe("smear: quanto a ponta esticada fica transparente (0 a 1, padrao 0.5)"),
    copies: z.number().min(0).max(16).optional().describe("trail: quantas copias (0 desliga)"),
    interval: z.number().min(0).optional().describe("trail: segundos entre uma copia e a seguinte (padrao 0.05)"),
    alpha: z.number().min(0).max(1).optional().describe("trail: alfa da copia mais nova (0 a 1, padrao 0.5)"),
    height: z.number().optional().describe("light: altura da luz sobre o plano (negativa: rasante por tras)"),
    animation: z.string().optional().describe("instance: a animacao do filho"),
    start: z.number().optional().describe("instance: o tempo do filho na chave"),
    speed: z.number().optional().describe("instance: velocidade do filho"),
    loop: z.boolean().optional().describe("instance: repetir (false para no fim)"),
  })
  .partial();

defineCommand({
  name: "key.set",
  group: "key",
  summary:
    "Cria ou atualiza uma chave. Valores relativos a setup pose: rotate soma graus, translate soma x/y NO ESPACO DO OSSO PAI (use space:'world' para dar x/y na tela), scale multiplica. Campos omitidos de uma chave existente ficam como estao; curvas vizinhas mantem o formato. Ex: {anim:'2.idle', target:{bone:'head'}, timeline:'rotate', time:0.5, value:8, curve:'suave'}",
  params: z.object({
    anim: AnimName,
    target: Target,
    timeline: z.string().describe("rotate, translate, scale, shear, attachment, rgba, alpha, deform, ...; efeitos do slot (so .boneco): outline {color, width}, glow {color, strength, radius}, dissolve {value 0-1, color, edge, grain}, tint {color, strength 0-1}, smear {strength, limit, fade}, trail {copies, interval, alpha}"),
    time: z.number().min(0).describe("segundos"),
    curve: CurveArg.optional(),
    space: z.enum(["parent", "world"]).default("parent").describe("translate: x/y no espaco do pai (padrao) ou na tela (world)"),
    ...KeyValue.shape,
  }),
  label: (p) => `chave ${p.timeline} ${"bone" in p.target ? p.target.bone : "slot" in p.target ? p.target.slot : "constraint" in p.target ? p.target.constraint : "particles" in p.target ? p.target.particles : "light" in p.target ? `luz ${p.target.light}` : "ambient" in p.target ? "ambiente" : "instance" in p.target ? `instancia ${p.target.instance}` : p.target.deform.attachment} @${p.time}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const { path, kind } = timelinePath(e.json, p.anim, p.target, p.timeline);
    const t = round(p.time);
    if (p.space === "world" && "bone" in p.target && /^translate/.test(p.timeline)) {
      // deslocamento na tela -> espaco do pai no instante (sem a propria chave)
      const parent = e.json.bones.find((b: any) => b.name === (p.target as any).bone)?.parent;
      if (parent) {
        const W = boneWorld(skeletonAt(e.json, p.anim, t), parent);
        const inv = invert(W);
        const [lx, ly] = [inv.a * (p.x ?? 0) + inv.b * (p.y ?? 0), inv.c * (p.x ?? 0) + inv.d * (p.y ?? 0)];
        p.x = lx;
        p.y = ly;
      }
    }
    let index = -1;
    editKeys(e, path, kind, (keys) => {
      const i = findKey(keys, t);
      if (i >= 0) {
        index = i;
        return {
          apply: () => {
            const k = keys[i];
            const fields = keyFields(kind, p);
            // efeitos e luzes: a chave fica completa (sem tirar o que e igual ao padrao)
            if (hasFields(kind)) {
              for (const [f, v] of Object.entries(fields)) if (JSON.stringify(k[f]) !== JSON.stringify(v)) e.set([...path, i, f], v);
              return;
            }
            // canais numericos: valor igual ao default sai da chave, como no export
            for (const c of channels(kind)) {
              if ((p as any)[c.key] === undefined) continue;
              const v = round((p as any)[c.key]);
              const want = v === c.def ? undefined : v;
              if (k[c.key] !== want) e.set([...path, i, c.key], want);
            }
            for (const [f, v] of Object.entries(fields)) if (!channels(kind).some((c) => c.key === f) && JSON.stringify(k[f]) !== JSON.stringify(v)) e.set([...path, i, f], v);
          },
        };
      }
      let at = keys.findIndex((k) => timeOf(k) > t);
      if (at < 0) at = keys.length;
      index = at;
      return {
        // a chave nova herda a curva do segmento onde caiu
        remap: (j) => (j >= at ? j + 1 : j),
        inherit: { to: at, from: at - 1 },
        apply: () => {
          if (!keys.length) e.set(path, []);
          const k: any = {};
          if (t !== 0) k.time = t;
          // efeito ou luz: os campos que nao vieram sao os daquele instante
          if (hasFields(kind)) Object.assign(k, effectFields(kind, fieldsAt(e.json, p.anim, p.target, kind, t)));
          Object.assign(k, keyFields(kind, p));
          e.insert(path, at, k);
        },
      };
    });
    if (p.curve !== undefined) setCurve(e, path, kind, index, p.curve);
    return { index, time: t };
  },
});

function setCurve(e: any, path: any, kind: string, index: number, curve: z.infer<typeof CurveArg>) {
  const keys = getKeys(e.json, path);
  if (!keys[index]) return;
  const want = writeShape(kind, keys, index, presetShape(curve));
  if (JSON.stringify(want) !== JSON.stringify(keys[index].curve)) e.set([...path, index, "curve"], want);
}

defineCommand({
  name: "curve.set",
  group: "key",
  summary: "Muda a curva que sai de uma chave ate a proxima: preset (suave, elastico, antecipa, stepped, linear...) ou bezier [x1,y1,x2,y2].",
  params: z.object({ anim: AnimName, target: Target, timeline: z.string(), time: z.number().min(0), curve: CurveArg }),
  label: (p) => `curva ${p.timeline} @${p.time} = ${Array.isArray(p.curve) ? "bezier" : p.curve}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const { path, kind } = timelinePath(e.json, p.anim, p.target, p.timeline);
    const i = findKey(getKeys(e.json, path), p.time);
    if (i < 0) throw new Error(`nao ha chave em ${p.time}s nessa timeline. Tempos: ${getKeys(e.json, path).map(timeOf).join(", ")}`);
    setCurve(e, path, kind, i, p.curve);
    return { index: i };
  },
});

defineCommand({
  name: "key.delete",
  group: "key",
  summary: "Remove a chave no tempo dado. Se a timeline ficar vazia, ela some.",
  params: z.object({ anim: AnimName, target: Target, timeline: z.string(), time: z.number().min(0) }),
  label: (p) => `apaga chave ${p.timeline} @${p.time}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const { path, kind } = timelinePath(e.json, p.anim, p.target, p.timeline);
    const keys = getKeys(e.json, path);
    const i = findKey(keys, p.time);
    if (i < 0) throw new Error(`nao ha chave em ${p.time}s. Tempos: ${keys.map(timeOf).join(", ")}`);
    if (keys.length === 1) {
      removeEmpty(e, path);
      return { deleted: i, timelineRemoved: true };
    }
    editKeys(e, path, kind, () => ({ remap: (j) => (j === i ? -1 : j > i ? j - 1 : j), apply: () => e.remove(path, i) }));
    return { deleted: i };
  },
});

defineCommand({
  name: "key.move",
  group: "key",
  summary: "Move uma chave para outro tempo (as curvas acompanham).",
  params: z.object({ anim: AnimName, target: Target, timeline: z.string(), time: z.number().min(0), to: z.number().min(0) }),
  label: (p) => `move chave ${p.timeline} ${p.time} -> ${p.to}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const { path, kind } = timelinePath(e.json, p.anim, p.target, p.timeline);
    const keys = getKeys(e.json, path);
    const i = findKey(keys, p.time);
    if (i < 0) throw new Error(`nao ha chave em ${p.time}s. Tempos: ${keys.map(timeOf).join(", ")}`);
    const to = round(p.to);
    if (findKey(keys, to) >= 0 && findKey(keys, to) !== i) throw new Error(`ja existe chave em ${to}s`);
    let j = keys.findIndex((k, n) => n !== i && timeOf(k) > to);
    if (j < 0) j = keys.length;
    const dest = j > i ? j - 1 : j;
    // permutacao: a chave i vai para dest, as do meio deslizam
    const remap = (n: number) => (n === i ? dest : i < dest && n > i && n <= dest ? n - 1 : dest < i && n >= dest && n < i ? n + 1 : n);
    editKeys(e, path, kind, () => ({
      remap,
      apply: () => {
        if (dest !== i) {
          const k = structuredClone(keys[i]);
          e.remove(path, i);
          e.insert(path, dest, k);
        }
        e.set([...path, dest, "time"], to === 0 ? undefined : to);
      },
    }));
    return { index: dest };
  },
});

defineCommand({
  name: "timeline.delete",
  group: "key",
  summary: "Apaga uma timeline inteira (todas as chaves) de um alvo numa animacao. Bom para refazer do zero.",
  params: z.object({ anim: AnimName, target: Target, timeline: z.string() }),
  label: (p) => `apaga timeline ${p.timeline}`,
  run({ e }, p) {
    requireAnimation(e.json, p.anim);
    const { path } = timelinePath(e.json, p.anim, p.target, p.timeline);
    if (!getKeys(e.json, path).length) return { deleted: 0 };
    const n = getKeys(e.json, path).length;
    removeEmpty(e, path);
    return { deleted: n };
  },
});
