// Quadro a quadro (o atelie, src/app/Atelie.svelte): uma camada de quadros e um slot cujas imagens
// sao desenhos (src/core/desenho.ts), um por quadro, e a timeline `attachment` do slot em cada
// animacao diz qual quadro aparece em que instante. Assim o desenho ilustrado entra no meio da
// animacao de ossos (um smear, um impacto, uma expressao) e toca em qualquer runtime, porque no
// arquivo e so troca de imagem. Na Pose base a camada fica vazia: so aparece onde ha chave.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { skins, slotIndex } from "../model.ts";
import { drawingsOf } from "../desenho.ts";
import { usesOfImage } from "../psd.ts";

const EPS = 1e-4;
const r4 = (t: number) => Math.round(t * 10000) / 10000;

interface Chave {
  time: number;
  name: string | null;
}

// as chaves de imagem do slot na animacao, em ordem
export function chavesDoSlot(json: any, anim: string, slot: string): Chave[] {
  const ks: any[] = json.animations?.[anim]?.slots?.[slot]?.attachment ?? [];
  return ks.map((k) => ({ time: k.time ?? 0, name: k.name ?? null })).sort((a, b) => a.time - b.time);
}

// os quadros (imagens desenhadas) de um slot: nome da parte -> imagem
export function quadrosDoSlot(json: any, slot: string): { name: string; image: string; a: any }[] {
  const out: { name: string; image: string; a: any }[] = [];
  const ds = drawingsOf(json);
  for (const sk of skins(json))
    for (const [name, a] of Object.entries<any>(sk.attachments?.[slot] ?? {})) {
      if ((a.type ?? "region") !== "region") continue;
      const image = a.path ?? name;
      if (ds[image] && !out.some((q) => q.name === name)) out.push({ name, image, a });
    }
  return out;
}

// camada de quadros: slot que so tem imagens desenhadas e fica vazio na Pose base
export function camadasDeQuadros(json: any): string[] {
  return (json.slots ?? [])
    .filter((s: any) => {
      const qs = quadrosDoSlot(json, s.name);
      const total = skins(json).reduce((n, sk) => n + Object.keys(sk.attachments?.[s.name] ?? {}).length, 0);
      return qs.length > 0 && qs.length === total && !s.attachment;
    })
    .map((s: any) => s.name);
}

// o quadro a mostra no instante t (a ultima chave ate t), e ate quando
export function quadroEm(chaves: Chave[], t: number): { index: number; name: string | null; from: number; to: number | null } | null {
  let i = -1;
  for (let k = 0; k < chaves.length; k++) if (chaves[k].time <= t + EPS) i = k;
  if (i < 0) return null;
  return { index: i, name: chaves[i].name, from: chaves[i].time, to: chaves[i + 1]?.time ?? null };
}

const Vec = z.tuple([z.number(), z.number()]);

defineCommand({
  name: "frame.add",
  group: "drawing",
  summary:
    "Quadro a quadro: poe um quadro novo (um desenho vazio, ou copia de outro) na camada de quadros `layer`, a mostra a partir de `time` na animacao. A camada e um slot proprio, vazio na Pose base, cujas imagens trocam pela timeline attachment: o desenho ilustrado entra no meio da animacao de ossos. Camada nova pede bone (o osso que ela segue) e width/height; os quadros seguintes herdam tamanho e lugar do ultimo. copy: nome de um quadro, ou 'previous' (o que estava a mostra em time). until: instante em que o quadro some (chave vazia), se nao houver outro quadro antes. Desenhe nele com draw.* (image = o nome devolvido em frame).",
  params: z.object({
    layer: z.string().min(1).describe("a camada de quadros (o slot)"),
    anim: z.string(),
    time: z.number().min(0),
    bone: z.string().optional().describe("camada nova: o osso que ela segue"),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    hd: z.number().min(0.05).max(8).optional(),
    world: z.object({ center: Vec, rotation: z.number().default(0) }).optional().describe("camada nova: o centro do quadro no mundo (Pose base)"),
    copy: z.string().optional().describe("copia as formas de um quadro (o nome), ou 'previous'"),
    until: z.number().min(0).optional(),
    front: z.boolean().default(true).describe("camada nova: na frente de tudo (false: atras)"),
  }),
  label: (p) => `quadro em ${p.layer} @${p.time}`,
  run({ e, run }, p) {
    if (!e.json.animations?.[p.anim]) throw new Error(`a animacao ${p.anim} nao existe`);
    const nova = slotIndex(e.json, p.layer) < 0;
    if (nova) {
      if (!p.bone) throw new Error(`a camada ${p.layer} nao existe: diga o bone que ela segue para criar`);
      run("slot.add", { name: p.layer, bone: p.bone });
      if (!p.front) run("slot.order", { slot: p.layer, index: 0 });
    }
    const quadros = quadrosDoSlot(e.json, p.layer);
    const chaves = chavesDoSlot(e.json, p.anim, p.layer);
    const aqui = chaves.find((k) => Math.abs(k.time - p.time) < EPS);
    if (aqui?.name) throw new Error(`ja ha o quadro ${aqui.name} em ${p.time}s na camada ${p.layer}: desenhe nele, ou tire com frame.remove`);
    // modelo de tamanho e lugar: o quadro a mostra antes, senao o ultimo criado
    const antes = quadroEm(chaves, p.time);
    const modelo = quadros.find((q) => q.name === antes?.name) ?? quadros[quadros.length - 1];
    const origem = p.copy === "previous" ? (antes?.name ? quadros.find((q) => q.name === antes.name) : undefined) : p.copy ? quadros.find((q) => q.name === p.copy) : undefined;
    if (p.copy && !origem) throw new Error(p.copy === "previous" ? `nao ha quadro a mostra antes de ${p.time}s para copiar` : `o quadro ${p.copy} nao existe em ${p.layer}. Quadros: ${quadros.map((q) => q.name).join(", ") || "(nenhum)"}`);
    const base = origem ?? modelo;
    const ds = drawingsOf(e.json);
    const w = p.width ?? (base ? ds[base.image].width : 512),
      h = p.height ?? (base ? ds[base.image].height : 512);
    let n = quadros.length + 1;
    const ocupado = (x: string) => !!ds[x] || quadros.some((q) => q.name === x);
    while (ocupado(`${p.layer}_${n}`)) n++;
    const name = `${p.layer}_${n}`;
    run("draw.create", { image: name, width: w, height: h, hd: p.hd ?? (base ? ds[base.image].hd : undefined) });
    const lugar = p.world ? { world: p.world } : base ? { x: base.a.x, y: base.a.y, rotation: base.a.rotation, scaleX: base.a.scaleX, scaleY: base.a.scaleY } : {};
    const naBase = e.json.slots[slotIndex(e.json, p.layer)].attachment;
    run("attachment.region", { slot: p.layer, name, width: w, height: h, ...lugar });
    // a camada continua vazia na Pose base (a primeira imagem de um slot entra a mostra)
    if (!naBase) run("slot.set", { slot: p.layer, attachment: null });
    if (origem) e.set(["drawings", name, "shapes"], structuredClone(ds[origem.image].shapes));
    // a pintura do quadro copiado vem junto (o mesmo estado dos pixels; o editor copia os pixels)
    if (origem && ds[origem.image].raster) e.set(["drawings", name, "raster"], structuredClone(ds[origem.image].raster));
    run("key.set", { anim: p.anim, target: { slot: p.layer }, timeline: "attachment", time: r4(p.time), name });
    if (p.until !== undefined && p.until > p.time + EPS) {
      const depois = chavesDoSlot(e.json, p.anim, p.layer).find((k) => k.time > p.time + EPS && k.time <= p.until! + EPS);
      if (!depois) run("key.set", { anim: p.anim, target: { slot: p.layer }, timeline: "attachment", time: r4(p.until), name: null });
    }
    return { frame: name, layer: p.layer, time: r4(p.time), created: nova ? p.layer : undefined, copied: origem?.name };
  },
});

defineCommand({
  name: "frame.end",
  group: "drawing",
  summary: "Quadro a quadro: a camada fica vazia a partir de time (o quadro que estava a mostra some ali). Com time em cima de uma chave vazia, tira a chave (o quadro anterior volta a durar ate o proximo).",
  params: z.object({ layer: z.string(), anim: z.string(), time: z.number().min(0) }),
  label: (p) => `fim do quadro em ${p.layer} @${p.time}`,
  run({ e, run }, p) {
    const chaves = chavesDoSlot(e.json, p.anim, p.layer);
    const aqui = chaves.find((k) => Math.abs(k.time - p.time) < EPS);
    const T = { anim: p.anim, target: { slot: p.layer }, timeline: "attachment" };
    if (aqui && aqui.name === null) {
      run("key.delete", { ...T, time: aqui.time });
      return { removed: true };
    }
    if (aqui) throw new Error(`ha o quadro ${aqui.name} em ${p.time}s: para tirar o quadro use frame.remove`);
    run("key.set", { ...T, time: r4(p.time), name: null });
    return { ended: r4(p.time) };
  },
});

defineCommand({
  name: "frame.move",
  group: "drawing",
  summary: "Quadro a quadro: muda o instante em que um quadro (ou um fim) entra: da chave em time para to. Recusa se ja houver chave em to; com swap: true, os dois trocam de lugar.",
  params: z.object({ layer: z.string(), anim: z.string(), time: z.number().min(0), to: z.number().min(0), swap: z.boolean().optional() }),
  label: (p) => `quadro de ${p.layer} @${p.time} -> ${p.to}`,
  run({ e, run }, p) {
    const chaves = chavesDoSlot(e.json, p.anim, p.layer);
    const k = chaves.find((c) => Math.abs(c.time - p.time) < EPS);
    if (!k) throw new Error(`nao ha quadro em ${p.time}s na camada ${p.layer}. Tempos: ${chaves.map((c) => c.time).join(", ") || "(nenhum)"}`);
    if (Math.abs(p.to - p.time) < EPS) return { time: k.time };
    const T = { anim: p.anim, target: { slot: p.layer }, timeline: "attachment" };
    const la = chaves.find((c) => Math.abs(c.time - p.to) < EPS);
    if (la && p.swap) {
      run("key.set", { ...T, time: la.time, name: k.name });
      run("key.set", { ...T, time: k.time, name: la.name });
      return { frame: k.name, time: la.time, swapped: la.name };
    }
    if (la) throw new Error(`ja ha uma chave em ${p.to}s na camada ${p.layer} (swap: true troca os dois de lugar)`);
    run("key.delete", { ...T, time: k.time });
    run("key.set", { ...T, time: r4(p.to), name: k.name });
    return { frame: k.name, time: r4(p.to) };
  },
});

defineCommand({
  name: "frame.remove",
  group: "drawing",
  summary: "Quadro a quadro: tira o quadro que entra em time (a chave); o desenho dele e apagado junto quando nenhuma outra chave, de nenhuma animacao, o usa (keep: true guarda o desenho).",
  params: z.object({ layer: z.string(), anim: z.string(), time: z.number().min(0), keep: z.boolean().optional() }),
  label: (p) => `tira o quadro de ${p.layer} @${p.time}`,
  run({ e, run }, p) {
    const chaves = chavesDoSlot(e.json, p.anim, p.layer);
    const k = chaves.find((c) => Math.abs(c.time - p.time) < EPS);
    if (!k) throw new Error(`nao ha quadro em ${p.time}s na camada ${p.layer}. Tempos: ${chaves.map((c) => c.time).join(", ") || "(nenhum)"}`);
    run("key.delete", { anim: p.anim, target: { slot: p.layer }, timeline: "attachment", time: k.time });
    if (!k.name || p.keep) return { removed: k.name, drawing: "kept" };
    const usado = Object.keys(e.json.animations ?? {}).some((an) => chavesDoSlot(e.json, an, p.layer).some((c) => c.name === k.name));
    if (usado) return { removed: k.name, drawing: "kept" };
    const q = quadrosDoSlot(e.json, p.layer).find((x) => x.name === k.name);
    if (!q) return { removed: k.name, drawing: "kept" };
    run("attachment.delete", { slot: p.layer, name: q.name });
    if (!usesOfImage(e.json, q.image).length) run("draw.remove", { image: q.image });
    return { removed: k.name, drawing: "deleted" };
  },
});

defineCommand({
  name: "frame.show",
  group: "drawing",
  summary: "Quadro a quadro: mostra de novo um quadro ja desenhado a partir de time (a mesma imagem em outro instante: um ciclo, um segurar). frame = nome do quadro.",
  params: z.object({ layer: z.string(), anim: z.string(), time: z.number().min(0), frame: z.string() }),
  label: (p) => `mostra ${p.frame} @${p.time}`,
  run({ e, run }, p) {
    if (!e.json.animations?.[p.anim]) throw new Error(`a animacao ${p.anim} nao existe`);
    const qs = quadrosDoSlot(e.json, p.layer);
    if (!qs.some((q) => q.name === p.frame)) throw new Error(`o quadro ${p.frame} nao existe em ${p.layer}. Quadros: ${qs.map((q) => q.name).join(", ") || "(nenhum)"}`);
    run("key.set", { anim: p.anim, target: { slot: p.layer }, timeline: "attachment", time: r4(p.time), name: p.frame });
    return { frame: p.frame, time: r4(p.time) };
  },
});

defineCommand({
  name: "query.frames",
  group: "query",
  readonly: true,
  summary: "Quadro a quadro: as camadas de quadros e, numa animacao, a ficha de exposicao de cada uma (que quadro entra em que instante, ate quando, e quantas formas tem), mais os quadros desenhados que a animacao nao usa.",
  params: z.object({ anim: z.string().optional(), layer: z.string().optional() }),
  run({ doc }, p) {
    const j = doc.json as any;
    const camadas = (p.layer ? [p.layer] : camadasDeQuadros(j)).map((slot) => {
      const qs = quadrosDoSlot(j, slot);
      const ds = drawingsOf(j);
      const chaves = p.anim ? chavesDoSlot(j, p.anim, slot) : [];
      const dur = p.anim ? duracao(j, p.anim) : 0;
      return {
        layer: slot,
        bone: j.slots.find((s: any) => s.name === slot)?.bone,
        size: qs[0] ? [ds[qs[0].image].width, ds[qs[0].image].height] : null,
        frames: chaves.map((k, i) => ({ time: k.time, until: chaves[i + 1]?.time ?? dur, frame: k.name, shapes: k.name ? (ds[qs.find((q) => q.name === k.name)?.image ?? ""]?.shapes.length ?? 0) : 0 })),
        unused: qs.filter((q) => !chaves.some((k) => k.name === q.name)).map((q) => q.name),
      };
    });
    return { anim: p.anim, layers: camadas };
  },
});

// duracao de uma animacao: o tempo da ultima chave de qualquer timeline
export function duracao(json: any, anim: string): number {
  let m = 0;
  const anda = (o: any) => {
    if (Array.isArray(o)) {
      for (const k of o) if (k && typeof k === "object") (typeof k.time === "number" && (m = Math.max(m, k.time)), anda(k));
    } else if (o && typeof o === "object") for (const v of Object.values(o)) anda(v);
  };
  anda(json.animations?.[anim]);
  return m;
}
