// Particulas (so do Mamulengo; docs/NUCLEO.md "Particulas"): emissores em `particles` no topo do
// JSON do editor, onde o spine-core nao le. As timelines (rate e burst) vao pelo key.set com o
// alvo {particles: nome}.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { requireBone, requireSlot, skins, slots } from "../model.ts";
import { round } from "./timeline.ts";

const Par = z.union([z.number(), z.tuple([z.number(), z.number()])]);
const Cor = z.string().regex(/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const emitters = (json: any): any[] => json.particles ?? [];
export function requireEmitter(json: any, name: string): number {
  const i = emitters(json).findIndex((p) => p.name === name);
  if (i < 0) throw new Error(`emissor de particulas nao existe: "${name}". Emissores: ${emitters(json).map((p) => p.name).join(", ") || "(nenhum)"}`);
  return i;
}

// imagem que a parte mostrada no slot usa (o padrao de um emissor novo)
function imageOfSlot(json: any, slot: string): string | null {
  const s = slots(json).find((x) => x.name === slot);
  if (!s?.attachment) return null;
  for (const sk of skins(json)) {
    const a = sk.attachments?.[slot]?.[s.attachment];
    if (a) return a.path ?? s.attachment;
  }
  return null;
}

defineCommand({
  name: "particles.set",
  group: "slot",
  summary:
    "Cria ou muda um emissor de particulas (so do Mamulengo, para .boneco; o Spine nao tem). Nascem do osso (padrao: o do slot) no ponto x,y; desenham logo depois da parte do slot, com a cor e o blend dele. image: nome de imagem do atlas (padrao: a do slot). rate por segundo; life, speed, scale, spin aceitam numero ou [inicio/min, fim/max]; angle e spread em graus no espaco do osso; gravity px/s2 para baixo; drag por segundo; color [nascimento, fim] em hex. Para animar: key.set com target {particles: nome}, timeline rate {value} ou burst {count} (nascem de uma vez). Fogo: color com varios tons, blend additive e wave. Raio: type lightning entre bone e toBone (ou length), com segments, jitter, width, refresh, branches; rate e a intensidade 0 a 1.",
  params: z.object({
    name: z.string().min(1),
    slot: z.string().optional(),
    bone: z.string().optional(),
    image: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    rate: z.number().min(0).optional(),
    life: Par.optional(),
    speed: Par.optional(),
    angle: z.number().optional(),
    spread: z.number().optional(),
    gravity: z.number().optional(),
    drag: z.number().min(0).optional(),
    scale: Par.optional(),
    spin: Par.optional(),
    color: z.array(Cor).min(1).optional().describe("tons espalhados pela vida (o primeiro no nascimento, o ultimo no fim); no raio, so o primeiro"),
    blend: z.enum(["normal", "additive", "multiply", "screen"]).optional().describe("o do emissor (fogo e brilho: additive); sem ele, o do slot"),
    wave: z.tuple([z.number(), z.number()]).optional().describe("balanco lateral: [amplitude px, frequencia Hz] (a chama treme)"),
    max: z.number().int().min(1).optional(),
    seed: z.number().int().min(0).optional(),
    // raio
    type: z.enum(["particles", "lightning", "orbit"]).optional().describe("lightning: um raio (linha quebrada refeita a cada refresh s); orbit: particulas girando em volta do osso, passando atras (slot behind) e na frente (slot); nos dois, rate vira a intensidade 0 a 1"),
    toBone: z.string().optional().describe("raio: osso do fim (com toX, toY); sem ele, length na direcao angle"),
    toX: z.number().optional(),
    toY: z.number().optional(),
    length: z.number().positive().optional(),
    segments: z.number().int().min(2).optional(),
    jitter: z.number().min(0).optional().describe("raio: quanto os pontos fogem para os lados, em fracao do comprimento"),
    width: z.number().positive().optional().describe("raio: largura em px"),
    refresh: z.number().positive().optional().describe("raio: segundos entre um desenho e o seguinte"),
    branches: z.number().int().min(0).optional(),
    // orbita
    behind: z.string().optional().describe("orbita: slot onde desenham as que passam atras (as da frente desenham no slot)"),
    radii: z.tuple([z.number(), z.number()]).optional().describe("orbita: raios da elipse na tela [largura, altura] em px"),
    period: z.number().optional().describe("orbita: segundos por volta (negativo gira ao contrario)"),
    count: z.number().int().min(0).optional().describe("orbita: quantas particulas"),
    band: z.number().min(0).optional().describe("orbita: quanto fogem para cima ou para baixo da elipse, px"),
    tilt: z.number().optional().describe("orbita: inclinacao da elipse em graus"),
    depth: z.number().min(0).optional().describe("orbita: quanto a da frente cresce e a de tras encolhe"),
  }),
  label: (p) => `particulas ${p.name}`,
  run({ e }, p) {
    const lista = emitters(e.json);
    const i = lista.findIndex((x) => x.name === p.name);
    if (p.slot) requireSlot(e.json, p.slot);
    if (p.bone) requireBone(e.json, p.bone);
    if (p.toBone) requireBone(e.json, p.toBone);
    const { name, scale, type, ...campos } = p;
    const novo: any = i >= 0 ? { ...lista[i] } : { name };
    if (i < 0) {
      if (!p.slot) throw new Error("emissor novo: diga o slot (lugar na ordem de desenho)");
      novo.image = p.image ?? imageOfSlot(e.json, p.slot);
      if (!novo.image) throw new Error(`o slot ${p.slot} nao mostra imagem: diga image`);
    }
    const num = (v: any) => (Array.isArray(v) ? v.map(round) : typeof v === "number" ? round(v) : v);
    for (const [k, v] of Object.entries(campos)) if (v !== undefined) novo[k] = num(v);
    // a escala do emissor fica "escala" nos dois formatos (scale e a timeline escalar)
    if (scale !== undefined) novo.escala = num(scale);
    if (type === "lightning" || type === "orbit") novo.type = type;
    else if (type === "particles") delete novo.type;
    if (p.behind) requireSlot(e.json, p.behind);
    if ((novo.type === "orbit") && !novo.behind) throw new Error("orbita: diga behind (o slot onde desenham as que passam atras)");
    if (i < 0) e.set(["particles"], [...lista, novo]);
    else if (JSON.stringify(novo) !== JSON.stringify(lista[i])) e.set(["particles", i], novo);
    return { index: i < 0 ? lista.length : i, emitter: novo };
  },
});

defineCommand({
  name: "particles.delete",
  group: "slot",
  summary: "Apaga um emissor de particulas e as timelines dele.",
  params: z.object({ name: z.string() }),
  label: (p) => `apaga particulas ${p.name}`,
  run({ e }, p) {
    const i = requireEmitter(e.json, p.name);
    const resto = emitters(e.json).filter((_, k) => k !== i);
    e.set(["particles"], resto.length ? resto : undefined);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {}))
      if (a.particles?.[p.name]) {
        const { [p.name]: _, ...outros } = a.particles;
        e.set(["animations", an, "particles"], Object.keys(outros).length ? outros : undefined);
      }
    return { deleted: p.name };
  },
});

defineCommand({
  name: "particles.rename",
  group: "slot",
  summary: "Renomeia um emissor de particulas (e as timelines dele).",
  params: z.object({ name: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia particulas ${p.name} -> ${p.to}`,
  run({ e }, p) {
    const i = requireEmitter(e.json, p.name);
    if (emitters(e.json).some((x) => x.name === p.to)) throw new Error(`emissor ja existe: ${p.to}`);
    e.set(["particles", i, "name"], p.to);
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {}))
      if (a.particles?.[p.name]) e.apply({ op: "rename", path: ["animations", an, "particles"], from: p.name, to: p.to });
    return { renamed: p.to };
  },
});
