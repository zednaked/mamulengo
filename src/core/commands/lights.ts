// Luzes (so do Mamulengo; docs/NUCLEO.md "Luzes"): pontos de luz presos a ossos em `lights` e a
// luz ambiente em `ambient`, no topo do JSON do editor, onde o spine-core nao le. Iluminam as
// paginas que tem relevo (tools/relevo.ts). As timelines vao pelo key.set com o alvo {light: nome}
// (timeline light) ou {ambient: true} (timeline ambient).
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { bones, requireBone } from "../model.ts";
import { round } from "./timeline.ts";

const Cor = z.string().regex(/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const lights = (json: any): any[] => json.lights ?? [];
export function requireLight(json: any, name: string): number {
  const i = lights(json).findIndex((l) => l.name === name);
  if (i < 0) throw new Error(`luz nao existe: "${name}". Luzes: ${lights(json).map((l) => l.name).join(", ") || "(nenhuma)"}`);
  return i;
}

defineCommand({
  name: "light.set",
  group: "bone",
  summary:
    "Cria ou muda uma luz (so do Mamulengo, para .boneco; o Spine nao tem). Fica presa ao osso (padrao: a raiz) no ponto x,y e ilumina as paginas com relevo (tools/relevo.ts gera o relevo a partir das imagens): color em hex, strength (1), radius em pixels do mundo (300: a luz some nessa distancia), height acima do plano (80; negativa: rasante por tras, contraluz). Varias luzes somam com a ambiente (ambient.set). Para animar: key.set com target {light: nome}, timeline light {color, strength, radius, height, depth}; a posicao anda com o osso. depth (camada): a luz atenua pela distancia em 3D ate a camada de cada slot e, atras dele, vira contraluz.",
  params: z.object({
    name: z.string().min(1),
    bone: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    color: Cor.optional(),
    strength: z.number().min(0).optional(),
    radius: z.number().min(0).optional(),
    height: z.number().optional(),
    depth: z.number().optional().describe("a camada da luz, em px (positiva para perto de quem assiste): ilumina mais os slots da mesma profundidade (slot.set depth)"),
  }),
  label: (p) => `luz ${p.name}`,
  run({ e }, p) {
    if (p.bone) requireBone(e.json, p.bone);
    const lista = lights(e.json);
    const i = lista.findIndex((l) => l.name === p.name);
    const novo: Record<string, any> = { ...(i >= 0 ? lista[i] : { name: p.name, bone: bones(e.json)[0]?.name }) };
    if (p.bone) novo.bone = p.bone;
    for (const f of ["x", "y", "strength", "radius", "height", "depth"] as const) if (p[f] !== undefined) novo[f] = round(p[f]!);
    if (p.color) novo.color = p.color.toLowerCase();
    if (i < 0) e.set(["lights"], [...lista, novo]);
    else if (JSON.stringify(novo) !== JSON.stringify(lista[i])) e.set(["lights", i], novo);
    return { index: i < 0 ? lista.length : i, light: novo };
  },
});

defineCommand({
  name: "light.delete",
  group: "bone",
  summary: "Apaga uma luz e as timelines dela.",
  params: z.object({ name: z.string() }),
  label: (p) => `apaga luz ${p.name}`,
  run({ e }, p) {
    const i = requireLight(e.json, p.name);
    const resto = lights(e.json).filter((_, k) => k !== i);
    e.set(["lights"], resto.length ? resto : undefined);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {}))
      if (a.lights?.[p.name]) {
        const { [p.name]: _, ...outras } = a.lights;
        e.set(["animations", an, "lights"], Object.keys(outras).length ? outras : undefined);
      }
    return { deleted: p.name };
  },
});

defineCommand({
  name: "light.rename",
  group: "bone",
  summary: "Renomeia uma luz (e as timelines dela).",
  params: z.object({ name: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia luz ${p.name} -> ${p.to}`,
  run({ e }, p) {
    const i = requireLight(e.json, p.name);
    if (lights(e.json).some((l) => l.name === p.to)) throw new Error(`luz ja existe: ${p.to}`);
    e.set(["lights", i, "name"], p.to);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {}))
      if (a.lights?.[p.name]) e.apply({ op: "rename", path: ["animations", an, "lights"], from: p.name, to: p.to });
    return { renamed: p.to };
  },
});

defineCommand({
  name: "ambient.set",
  group: "bone",
  summary:
    "A luz ambiente (so do Mamulengo): a luz que chega em tudo que tem relevo, somada as luzes. color em hex e strength (padrao branco e 1: as cores como sao; abaixo de 1, o que nenhuma luz alcanca escurece). off:true volta ao padrao. Para animar: key.set com target {ambient: true}, timeline ambient {color, strength}.",
  params: z.object({ color: Cor.optional(), strength: z.number().min(0).optional(), off: z.boolean().optional() }),
  label: () => "luz ambiente",
  run({ e }, p) {
    if (p.off) {
      e.set(["ambient"], undefined);
      return { ambient: null };
    }
    const novo: Record<string, any> = { ...((e.json as any).ambient ?? {}) };
    if (p.color) novo.color = p.color.toLowerCase();
    if (p.strength !== undefined) novo.strength = round(p.strength);
    if (JSON.stringify(novo) !== JSON.stringify((e.json as any).ambient)) e.set(["ambient"], novo);
    return { ambient: novo };
  },
});
