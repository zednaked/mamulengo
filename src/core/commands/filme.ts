// Filme (docs/FILME.md): a camera (um osso marcado em skeleton.camera, que a exportacao e o
// tools/quadro.ts seguem), chaves de camera com corte seco, tremor, transicoes prontas (preto,
// branco, flash) e planos que mostram e escondem grupos de partes. Tudo vira ossos, partes e chaves
// comuns: o .boneco continua tocando em qualquer lugar.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { boneIndex, requireAnimation, requireBone, slots } from "../model.ts";
import { findKey, getKeys, round, timeOf, timelinePath } from "./timeline.ts";

const Vec = z.tuple([z.number(), z.number()]);

// o osso que a camera segue (o do tremor) e o que anda (o pai dele)
function camera(json: any): { leaf: string; move: string } {
  const leaf = json.skeleton?.camera;
  if (!leaf || boneIndex(json, leaf) < 0) throw new Error("sem camera: rode camera.set antes");
  const b = json.bones.find((x: any) => x.name === leaf);
  return { leaf, move: leaf.endsWith("_tremor") && b.parent ? b.parent : leaf };
}

defineCommand({
  name: "camera.set",
  group: "skeleton",
  summary:
    "Marca a camera do filme: cria o osso bone (padrao camera, filho de parent) e um filho bone_tremor (o que camera.shake sacode), e grava skeleton.camera. width x height e o tamanho do quadro (o do esqueleto; padrao: o atual). A exportacao e o tools/quadro.ts passam a filmar pelo osso: o quadro e width x height vezes a escala do mundo dele (0,5 aproxima duas vezes), girado com ele. O que for preso ao osso da camera cobre o quadro em qualquer zoom.",
  params: z.object({ bone: z.string().optional(), parent: z.string().optional(), width: z.number().positive().optional(), height: z.number().positive().optional(), x: z.number().optional(), y: z.number().optional() }),
  label: () => "camera do filme",
  run({ e, run }, p) {
    const nome = p.bone ?? "camera";
    const pai = p.parent ?? e.json.bones[0].name;
    requireBone(e.json, pai);
    if (boneIndex(e.json, nome) < 0) run("bone.add", { name: nome, parent: pai, x: p.x ?? 0, y: p.y ?? 0 });
    const tremor = `${nome}_tremor`;
    if (boneIndex(e.json, tremor) < 0) run("bone.add", { name: tremor, parent: nome });
    const sk = { ...(e.json.skeleton ?? {}) };
    sk.camera = tremor;
    if (p.width) (sk.width = p.width), (sk.x = -p.width / 2);
    if (p.height) (sk.height = p.height), (sk.y = -p.height / 2);
    e.set(["skeleton"], sk);
    return { camera: tremor, moves: nome, width: sk.width, height: sk.height };
  },
});

defineCommand({
  name: "camera.key",
  group: "key",
  summary:
    "Chave da camera no instante: x, y (centro do quadro, no pai da camera), zoom (2 aproxima duas vezes; vira a escala 1/zoom do osso) e rotation (graus). curve: a curva ate a proxima chave. cut: true faz um corte seco (a chave anterior de cada canal vira degrau, e o quadro pula para este no instante).",
  params: z.object({ anim: z.string(), time: z.number().min(0), x: z.number().optional(), y: z.number().optional(), zoom: z.number().positive().optional(), rotation: z.number().optional(), curve: z.string().optional(), cut: z.boolean().optional() }),
  label: (p) => `camera @${p.time}${p.cut ? " (corte)" : ""}`,
  run({ e, run }, p) {
    requireAnimation(e.json, p.anim);
    const { move } = camera(e.json);
    const alvo = { bone: move };
    const canais: [string, any][] = [];
    if (p.x !== undefined || p.y !== undefined) canais.push(["translate", { x: p.x ?? 0, y: p.y ?? 0 }]);
    if (p.zoom !== undefined) canais.push(["scale", { x: round(1 / p.zoom), y: round(1 / p.zoom) }]);
    if (p.rotation !== undefined) canais.push(["rotate", { value: p.rotation }]);
    if (!canais.length) throw new Error("diga x/y, zoom ou rotation");
    for (const [tl, v] of canais) {
      run("key.set", { anim: p.anim, target: alvo, timeline: tl, time: p.time, ...v, ...(p.curve ? { curve: p.curve } : {}) });
      if (p.cut) {
        // a chave anterior vira degrau: o quadro fica parado ate o instante e pula
        const { path } = timelinePath(e.json, p.anim, alvo, tl);
        const ks = getKeys(e.json, path);
        const i = findKey(ks, p.time);
        if (i > 0) run("curve.set", { anim: p.anim, target: alvo, timeline: tl, time: timeOf(ks[i - 1]), curve: "stepped" });
      }
    }
    return { bone: move, channels: canais.map((c) => c[0]) };
  },
});

defineCommand({
  name: "camera.shake",
  group: "recipe",
  summary:
    "Tremor de camera (aterrissagem, explosao, impacto): sacode o osso do tremor por duration segundos a partir de time, strength pixels no comeco, decaindo, frequency vezes por segundo (padrao 18); rotation graus de giro junto (padrao 0). Deterministico (seed). Compoe com as chaves da camera.",
  params: z.object({ anim: z.string(), time: z.number().min(0), duration: z.number().positive(), strength: z.number().positive(), frequency: z.number().positive().optional(), rotation: z.number().optional(), seed: z.number().int().optional() }),
  label: (p) => `tremor @${p.time}`,
  run({ e, run }, p) {
    requireAnimation(e.json, p.anim);
    const { leaf } = camera(e.json);
    const f = p.frequency ?? 18;
    const n = Math.max(2, Math.round(p.duration * f));
    let s = (p.seed ?? 7) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    const alvo = { bone: leaf };
    for (let k = 0; k <= n; k++) {
      const t = round(p.time + (k / n) * p.duration);
      const amp = k === n ? 0 : p.strength * Math.exp((-3 * k) / n);
      run("key.set", { anim: p.anim, target: alvo, timeline: "translate", time: t, x: round(rnd() * amp), y: round(rnd() * amp), curve: "suave" });
      if (p.rotation) run("key.set", { anim: p.anim, target: alvo, timeline: "rotate", time: t, value: round(rnd() * (k === n ? 0 : p.rotation * Math.exp((-3 * k) / n))), curve: "suave" });
    }
    // parado antes do tremor (a chave anterior fica onde estava, se houver)
    if (p.time > 0) {
      const { path } = timelinePath(e.json, p.anim, alvo, "translate");
      if (findKey(getKeys(e.json, path), 0) < 0) run("key.set", { anim: p.anim, target: alvo, timeline: "translate", time: 0, x: 0, y: 0 });
    }
    return { keys: n + 1 };
  },
});

// a cortina de uma cor presa a camera, na frente de tudo (criada uma vez por cor)
function cortina(e: any, run: (n: string, a: unknown) => any, cor: "preto" | "branco"): string {
  const nome = `filme_${cor}`;
  if (slots(e.json).some((s: any) => s.name === nome)) return nome;
  const { leaf } = camera(e.json);
  const w = (e.json.skeleton?.width ?? 1280) + 80,
    h = (e.json.skeleton?.height ?? 720) + 80;
  run("draw.create", { image: nome, width: w, height: h, slot: nome, bone: leaf, x: 0, y: 0, hd: 0.25 });
  run("draw.shape", { image: nome, name: "cor", rect: [0, 0, w, h], fill: cor === "preto" ? "000000ff" : "ffffffff" });
  // na frente de tudo na setup, e transparente
  run("slot.order", { slot: nome, index: slots(e.json).length - 1 });
  run("slot.set", { slot: nome, color: cor === "preto" ? "00000000" : "ffffff00" });
  return nome;
}

defineCommand({
  name: "shot.transition",
  group: "recipe",
  summary:
    "Transicao pronta no instante time (o corte acontece em time): preto (escurece ate time e abre depois), branco (o mesmo em branco), flash (branco cheio em time e some), corte_preto (um quadro preto seco). duration: o tempo total (padrao 0,6 s; flash 0,4). A cortina e uma parte presa a camera, na frente de tudo (camera.set antes).",
  params: z.object({ anim: z.string(), time: z.number().min(0), kind: z.enum(["preto", "branco", "flash", "corte_preto"]), duration: z.number().positive().optional() }),
  label: (p) => `transicao ${p.kind} @${p.time}`,
  run({ e, run }, p) {
    requireAnimation(e.json, p.anim);
    const cor = p.kind === "preto" || p.kind === "corte_preto" ? "preto" : "branco";
    const slot = cortina(e, run, cor);
    const base = cor === "preto" ? "000000" : "ffffff";
    const k = (t: number, a: number, curve?: string) => run("key.set", { anim: p.anim, target: { slot }, timeline: "rgba", time: round(Math.max(0, t)), color: base + Math.round(a * 255).toString(16).padStart(2, "0"), ...(curve ? { curve } : {}) });
    const t = p.time;
    if (p.kind === "flash") {
      const d = p.duration ?? 0.4;
      if (t > 0.04) k(t - 0.034, 0, "stepped");
      k(t, 1, "sai-rapido");
      k(t + d, 0);
    } else if (p.kind === "corte_preto") {
      if (t > 0.04) k(t - 0.034, 0, "stepped");
      k(t, 1, "stepped");
      k(t + (p.duration ?? 0.1), 0, "stepped");
    } else {
      const d = (p.duration ?? 0.6) / 2;
      k(t - d, 0, "suave");
      k(t, 1, "suave");
      k(t + d, 0);
    }
    return { slot };
  },
});

defineCommand({
  name: "shot.show",
  group: "recipe",
  summary:
    "Plano: no instante, mostra (alfa 1) as partes de show e esconde (alfa 0) as de hide, num corte seco (chave em degrau). Nomes aceitam * (cidade_* todas as partes da cidade). A cor da parte (RGB) fica a do setup. Instancias em partes escondidas nem sao calculadas.",
  params: z.object({ anim: z.string(), time: z.number().min(0), show: z.array(z.string()).optional(), hide: z.array(z.string()).optional() }),
  label: (p) => `plano @${p.time}`,
  run({ e, run }, p) {
    requireAnimation(e.json, p.anim);
    const todos = slots(e.json);
    const casa = (pad: string) => {
      const re = new RegExp("^" + pad.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      const l = todos.filter((s: any) => re.test(s.name));
      if (!l.length) throw new Error(`nenhuma parte casa com ${pad}`);
      return l;
    };
    let n = 0;
    for (const [lista, a] of [[p.show ?? [], 1], [p.hide ?? [], 0]] as const)
      for (const pad of lista)
        for (const s of casa(pad)) {
          const rgb = String(s.color ?? "ffffffff").slice(0, 6);
          run("key.set", { anim: p.anim, target: { slot: s.name }, timeline: "rgba", time: p.time, color: rgb + (a ? "ff" : "00"), curve: "stepped" });
          // o degrau tambem na chave de antes (o valor anterior segura ate aqui)
          const { path } = timelinePath(e.json, p.anim, { slot: s.name }, "rgba");
          const ks = getKeys(e.json, path);
          const i = findKey(ks, p.time);
          if (i > 0) run("curve.set", { anim: p.anim, target: { slot: s.name }, timeline: "rgba", time: timeOf(ks[i - 1]), curve: "stepped" });
          n++;
        }
    return { keys: n };
  },
});

export { Vec };
