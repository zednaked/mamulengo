// Instancias (so do Mamulengo; docs/NUCLEO.md "Instancias"): um .boneco dentro deste, preso a um
// slot (lugar na ordem de desenho, cor e efeitos) e a um osso, em `instances` no topo do JSON do
// editor, onde o spine-core nao le. As timelines vao pelo key.set com o alvo {instance: nome}
// (timeline instance: animation, start, speed, loop, em degrau).
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { requireBone, requireSlot } from "../model.ts";
import { round } from "./timeline.ts";

export const instances = (json: any): any[] => json.instances ?? [];
export function requireInstance(json: any, name: string): number {
  const i = instances(json).findIndex((x) => x.name === name);
  if (i < 0) throw new Error(`instancia nao existe: "${name}". Instancias: ${instances(json).map((x) => x.name).join(", ") || "(nenhuma)"}`);
  return i;
}

defineCommand({
  name: "instance.set",
  group: "bone",
  summary:
    "Cria ou muda uma instancia (so do Mamulengo, para .boneco; o Spine nao tem): outro .boneco (boneco: caminho relativo a este arquivo) desenhado no lugar do slot na ordem de desenho, com a cor e os efeitos do slot, preso ao osso (padrao: o do slot) em x, y, rotation, scaleX, scaleY. animation e skin sao do filho (sem animation: a pose de setup); o tempo do filho e start + speed x relogio; loop false para no fim. Para trocar o que ele toca: key.set com target {instance: nome}, timeline instance {animation, start, speed, loop} (em degrau; da chave em diante o tempo e start + speed x (t - tempo da chave)). Slot com alfa 0: a instancia nem e calculada.",
  params: z.object({
    name: z.string().min(1),
    slot: z.string().optional(),
    bone: z.string().optional(),
    boneco: z.string().optional().describe("o .boneco do filho, relativo a este"),
    animation: z.string().nullable().optional(),
    skin: z.string().nullable().optional(),
    start: z.number().optional(),
    speed: z.number().optional(),
    loop: z.boolean().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    rotation: z.number().optional(),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
  }),
  label: (p) => `instancia ${p.name}`,
  run({ e }, p) {
    const lista = instances(e.json);
    const i = lista.findIndex((x) => x.name === p.name);
    if (i < 0 && (!p.slot || !p.boneco)) throw new Error("instancia nova: diga slot e boneco");
    if (p.slot) requireSlot(e.json, p.slot);
    if (p.bone) requireBone(e.json, p.bone);
    const novo: Record<string, any> = { ...(i >= 0 ? lista[i] : { name: p.name }) };
    for (const f of ["slot", "bone", "boneco"] as const) if (p[f] !== undefined) novo[f] = p[f];
    for (const f of ["animation", "skin"] as const) {
      if (p[f] === null) delete novo[f];
      else if (p[f] !== undefined) novo[f] = p[f];
    }
    for (const f of ["start", "speed", "x", "y", "rotation", "scaleX", "scaleY"] as const) if (p[f] !== undefined) novo[f] = round(p[f]!);
    if (p.loop !== undefined) {
      if (p.loop) delete novo.loop;
      else novo.loop = false;
    }
    if (i < 0) e.set(["instances"], [...lista, novo]);
    else if (JSON.stringify(novo) !== JSON.stringify(lista[i])) e.set(["instances", i], novo);
    return { index: i < 0 ? lista.length : i, instance: novo };
  },
});

defineCommand({
  name: "instance.delete",
  group: "bone",
  summary: "Apaga uma instancia e as timelines dela.",
  params: z.object({ name: z.string() }),
  label: (p) => `apaga instancia ${p.name}`,
  run({ e }, p) {
    const i = requireInstance(e.json, p.name);
    const resto = instances(e.json).filter((_, k) => k !== i);
    e.set(["instances"], resto.length ? resto : undefined);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {}))
      if (a.instances?.[p.name]) {
        const { [p.name]: _, ...outras } = a.instances;
        e.set(["animations", an, "instances"], Object.keys(outras).length ? outras : undefined);
      }
    return { deleted: p.name };
  },
});

defineCommand({
  name: "instance.rename",
  group: "bone",
  summary: "Renomeia uma instancia (e as timelines dela).",
  params: z.object({ name: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia instancia ${p.name} -> ${p.to}`,
  run({ e }, p) {
    const i = requireInstance(e.json, p.name);
    if (instances(e.json).some((x) => x.name === p.to)) throw new Error(`instancia ja existe: ${p.to}`);
    e.set(["instances", i, "name"], p.to);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {}))
      if (a.instances?.[p.name]) e.apply({ op: "rename", path: ["animations", an, "instances"], from: p.name, to: p.to });
    return { renamed: p.to };
  },
});
