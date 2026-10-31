// Instancias (so do Mamulengo; docs/NUCLEO.md "Instancias"): um .boneco dentro deste, preso a um
// slot (lugar na ordem de desenho, cor e efeitos) e a um osso, em `instances` no topo do JSON do
// editor, onde o spine-core nao le. As timelines vao pelo key.set com o alvo {instance: nome}
// (timeline instance: animation, start, speed, loop, em degrau).
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { constraints, requireBone, requireSlot } from "../model.ts";
import { round } from "./timeline.ts";
import { exportarSpine, importarSpine } from "../../boneco/spine.ts";
import { parseAtlas } from "../atlas-text.ts";

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
    "Cria ou muda uma instancia (so do Mamulengo, para .boneco; o Spine nao tem): outro .boneco (boneco: caminho relativo a este arquivo) desenhado no lugar do slot na ordem de desenho, com a cor e os efeitos do slot, preso ao osso (padrao: o do slot) em x, y, rotation, scaleX, scaleY. animation e skin sao do filho (sem animation: a pose de setup); o tempo do filho e start + speed x relogio; loop false para no fim. Para trocar o que ele toca: key.set com target {instance: nome}, timeline instance {animation, start, speed, loop, mix} (em degrau; da chave em diante o tempo e start + speed x (t - tempo da chave); com mix, a animacao anterior continua e se mistura com a nova por mix segundos). Slot com alfa 0: a instancia nem e calculada.",
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
    mix: z.number().min(0).optional().describe("segundos de mistura quando uma chave troca a animacao do filho"),
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
    for (const f of ["start", "speed", "mix", "x", "y", "rotation", "scaleX", "scaleY"] as const) if (p[f] !== undefined) novo[f] = round(p[f]!);
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

// ---- extrair: ossos viram um .boneco novo, instanciado no lugar

// vertices com pesos (malha, caminho, recorte, caixa): por vertice, n e n x (osso, x, y, peso);
// troca o indice do osso por map[indice] (-1: o osso nao existe do outro lado)
function pesos(a: any): number | null {
  if (!Array.isArray(a?.vertices)) return null;
  const n = a.type === "mesh" ? (a.uvs?.length ?? 0) / 2 : (a.vertexCount ?? 0);
  return n && a.vertices.length !== n * 2 ? n : null;
}
function ossosDosPesos(a: any): number[] {
  const out: number[] = [];
  const v = a.vertices;
  for (let i = 0; i < v.length; ) {
    const k = v[i++];
    for (let j = 0; j < k; j++, i += 4) out.push(v[i]);
  }
  return out;
}
function remapeiaPesos(a: any, map: Map<number, number>): any {
  const v = [...a.vertices];
  for (let i = 0; i < v.length; ) {
    const k = v[i++];
    for (let j = 0; j < k; j++, i += 4) v[i] = map.get(v[i])!;
  }
  return { ...a, vertices: v };
}
// os nomes que uma restricao usa (ossos, alvo, fonte, slot)
const usaDe = (c: any): string[] => [...(c.bones ?? []), c.target, c.source, c.bone, c.slot].filter((x) => typeof x === "string");

defineCommand({
  name: "instance.extract",
  group: "bone",
  summary:
    "Leva um osso e os descendentes (com os slots presos neles, as partes, as restricoes e particulas de dentro e as timelines de cada animacao) para um .boneco novo, e poe no lugar uma instancia dele, num slot novo na posicao do primeiro slot que saiu; cada animacao que mexia nessas partes ganha uma chave que toca a de mesmo nome no filho, no mesmo tempo (a pose fica igual). O arquivo do filho sai pronto no resultado (`arquivo`), e o editor grava ao lado deste. Recusa o que liga dentro e fora (restricao, particula, luz ou malha de fora com pesos nesses ossos). Slots de dentro intercalados com slots de fora na ordem de desenho passam a desenhar juntos (aviso).",
  params: z.object({
    bone: z.string(),
    name: z.string().min(1).optional().describe("nome da instancia e do slot dela (padrao: o do osso)"),
    boneco: z.string().min(1).describe("arquivo do filho, relativo a este (ex: braco.boneco)"),
  }),
  label: (p) => `extrai ${p.bone} para ${p.boneco}`,
  run(ctx, p) {
    const { e } = ctx;
    const json: any = e.json;
    requireBone(json, p.bone);
    const ossos: any[] = json.bones;
    const raiz = ossos.find((b) => b.name === p.bone);
    if (!raiz.parent) throw new Error("o osso raiz nao pode ser extraido: escolha um osso abaixo dele");
    const nome = p.name ?? p.bone;
    if (instances(json).some((x) => x.name === nome)) throw new Error(`instancia ja existe: ${nome}`);
    // a subarvore, na ordem do arquivo (o pai antes dos filhos)
    const dentro = new Set<string>([p.bone]);
    for (const b of ossos) if (b.parent && dentro.has(b.parent)) dentro.add(b.name);
    const slotsDentro = new Set<string>((json.slots ?? []).filter((s: any) => dentro.has(s.bone)).map((s: any) => s.name));
    const dentroOuSlot = (x: string) => dentro.has(x) || slotsDentro.has(x);
    // o slot da instancia: o nome pode ser o de um slot que sai junto
    if ((json.slots ?? []).some((s: any) => s.name === nome && !slotsDentro.has(s.name))) throw new Error(`ja existe um slot ${nome}: de outro nome a instancia (name)`);
    // o que liga dentro e fora
    // as restricoes (no 4.3 numa lista so, `constraints`; nas antigas, uma lista por tipo)
    const movidas: { c: any; path: (string | number)[] }[] = [];
    for (const { c, path } of constraints(json)) {
      const usa = usaDe(c);
      const n = usa.filter(dentroOuSlot).length;
      if (n && n < usa.length) throw new Error(`a restricao ${c.name} liga ossos de dentro e de fora de ${p.bone}`);
      if (n) movidas.push({ c, path });
    }
    const particulas = (json.particles ?? []).filter((x: any) => dentro.has(x.bone) || slotsDentro.has(x.slot));
    for (const x of particulas)
      if (!dentro.has(x.bone ?? (json.slots.find((s: any) => s.name === x.slot)?.bone)) || !slotsDentro.has(x.slot) || (x.toBone && !dentro.has(x.toBone)) || (x.behind && !slotsDentro.has(x.behind)))
        throw new Error(`o emissor ${x.name} liga partes de dentro e de fora de ${p.bone}`);
    for (const l of json.lights ?? []) if (dentro.has(l.bone)) throw new Error(`a luz ${l.name} esta presa em ${l.bone}: mova a luz para fora antes (as luzes ficam na cena)`);
    const filhas = instances(json).filter((x) => slotsDentro.has(x.slot));
    for (const x of filhas) if (x.bone && !dentro.has(x.bone)) throw new Error(`a instancia ${x.name} liga partes de dentro e de fora de ${p.bone}`);
    const indice = new Map<string, number>(ossos.map((b, i) => [b.name, i]));
    const novoIndice = new Map<number, number>();
    [...dentro].forEach((b, k) => novoIndice.set(indice.get(b)!, k));
    for (const [sl, atts] of (json.skins ?? []).flatMap((s: any) => Object.entries<any>(s.attachments ?? {})))
      for (const a of Object.values<any>(atts)) {
        if (!pesos(a)) continue;
        const usa = ossosDosPesos(a).map((i) => ossos[i]?.name);
        if (slotsDentro.has(sl) ? usa.some((b) => !dentro.has(b)) : usa.some((b) => dentro.has(b)))
          throw new Error(`a malha do slot ${sl} tem pesos em ossos de dentro e de fora de ${p.bone}`);
      }
    // ---- o filho, no formato do editor
    const pega = (o: any, sel: (k: string) => boolean) => (o ? Object.fromEntries(Object.entries(o).filter(([k]) => sel(k))) : {});
    const filho: any = {
      skeleton: { ...(json.skeleton ?? {}) },
      bones: ossos.filter((b) => dentro.has(b.name)).map((b) => (b.name === p.bone ? (({ parent: _, ...r }) => r)(b) : b)),
      slots: (json.slots ?? []).filter((s: any) => slotsDentro.has(s.name)),
      skins: (json.skins ?? []).map((s: any) => {
        const atts = pega(s.attachments, (k) => slotsDentro.has(k));
        for (const [sl, porNome] of Object.entries<any>(atts))
          atts[sl] = Object.fromEntries(Object.entries<any>(porNome).map(([n, a]) => [n, pesos(a) ? remapeiaPesos(a, novoIndice) : a]));
        const out: any = { name: s.name, attachments: atts };
        if (s.bones) out.bones = s.bones.filter((b: string) => dentro.has(b));
        for (const t of ["constraints", "ik", "transform", "path", "physics", "slider"]) if (s[t]) out[t] = s[t].filter((n: string) => movidas.some((m) => m.c.name === n));
        return out;
      }),
      animations: {},
    };
    delete filho.skeleton.hash;
    for (const { c, path } of movidas) (filho[path[0]] ??= []).push(c);
    if (particulas.length) filho.particles = particulas;
    if (filhas.length) filho.instances = filhas;
    const nomesRest = new Set(movidas.map((m) => m.c.name));
    const nomesPart = new Set(particulas.map((x: any) => x.name));
    const nomesInst = new Set(filhas.map((x) => x.name));
    const comConteudo: string[] = [];
    const avisos: string[] = [];
    for (const [an, a] of Object.entries<any>(json.animations ?? {})) {
      const b: any = {};
      const poe = (k: string, v: any) => v && Object.keys(v).length && (b[k] = v);
      poe("bones", pega(a.bones, (k) => dentro.has(k)));
      poe("slots", pega(a.slots, (k) => slotsDentro.has(k)));
      poe("effects", pega(a.effects, (k) => slotsDentro.has(k)));
      if (a.attachments) {
        const at = Object.fromEntries(Object.entries<any>(a.attachments).map(([sk, sl]) => [sk, pega(sl, (k) => slotsDentro.has(k))]).filter(([, sl]) => Object.keys(sl).length));
        poe("attachments", at);
      }
      poe("particles", pega(a.particles, (k) => nomesPart.has(k)));
      poe("instances", pega(a.instances, (k) => nomesInst.has(k)));
      for (const t of ["ik", "transform", "path", "physics", "slider"]) poe(t, pega(a[t], (k) => nomesRest.has(k)));
      if (a.drawOrder?.some((k: any) => k.offsets?.some((o: any) => slotsDentro.has(o.slot)))) avisos.push(`animacao ${an}: a ordem de desenho dos slots extraidos ficou de fora`);
      if (Object.keys(b).length) {
        filho.animations[an] = b;
        comConteudo.push(an);
      }
    }
    // slots de dentro intercalados com os de fora
    const ordem = (json.slots ?? []).map((s: any) => s.name);
    const pos = ordem.map((n: string, i: number) => (slotsDentro.has(n) ? i : -1)).filter((i: number) => i >= 0);
    if (pos.length && pos[pos.length - 1] - pos[0] + 1 !== pos.length) avisos.push("os slots extraidos estavam intercalados com outros na ordem de desenho: agora desenham juntos, no lugar do primeiro");
    const nomeArq = p.boneco.split("/").pop()!.replace(/\.boneco$/, "");
    const texto = JSON.stringify(importarSpine(filho, ctx.doc.atlas.text, nomeArq), null, 1) + "\n";
    // ---- o pai: tira a subarvore (bone.delete leva slots, restricoes, particulas, timelines e
    // remapeia os pesos) e poe o slot com a instancia onde estava o primeiro slot
    const lugar = pos.length ? pos[0] : ordem.length;
    // a duracao de cada animacao antes de tirar as timelines (a ultima chave de todas)
    const duracoes: Record<string, number> = {};
    for (const [an, a] of Object.entries<any>(json.animations ?? {})) {
      let d = 0;
      const junta = (o: any): void => {
        if (Array.isArray(o)) o.forEach(junta);
        else if (o && typeof o === "object") {
          if (typeof o.time === "number") d = Math.max(d, o.time);
          Object.values(o).forEach(junta);
        }
      };
      junta(a);
      duracoes[an] = d;
    }
    const ossoInst = raiz.parent;
    // o drawOrder das animacoes com os slots de dentro: tira os deslocamentos deles
    for (const [an, a] of Object.entries<any>(json.animations ?? {}))
      (a.drawOrder ?? []).forEach((k: any, i: number) => {
        if (k.offsets?.some((o: any) => slotsDentro.has(o.slot))) e.set(["animations", an, "drawOrder", i, "offsets"], k.offsets.filter((o: any) => !slotsDentro.has(o.slot)));
      });
    ctx.run("bone.delete", { bone: p.bone });
    e.set(["slots"], [...(e.json as any).slots.slice(0, lugar), { name: nome, bone: ossoInst }, ...(e.json as any).slots.slice(lugar)]);
    ctx.run("instance.set", { name: nome, slot: nome, bone: ossoInst, boneco: p.boneco });
    for (const an of comConteudo) {
      ctx.run("key.set", { anim: an, target: { instance: nome }, timeline: "instance", time: 0, animation: an, start: 0, loop: false });
      // a duracao e a ultima chave de todas: se ela era das timelines que sairam, a animacao do pai
      // encurtaria (e o laco daria a volta antes). Uma chave no fim original guarda a duracao
      if (duracoes[an] > 0) ctx.run("key.set", { anim: an, target: { instance: nome }, timeline: "instance", time: duracoes[an], animation: an, start: duracoes[an], loop: false });
    }
    return { instance: nome, slot: nome, animacoes: comConteudo, avisos, arquivo: { caminho: p.boneco, texto } };
  },
});

// ---- embutir: o caminho de volta (os ossos do filho entram no pai)

const normaliza = (c: string) => {
  const out: string[] = [];
  for (const x of c.split("/")) {
    if (x === "..") out.length && out[out.length - 1] !== ".." ? out.pop() : out.push("..");
    else if (x && x !== ".") out.push(x);
  }
  return (c.startsWith("/") ? "/" : "") + out.join("/");
};
const pasta = (c: string) => c.slice(0, c.lastIndexOf("/") + 1);
const duracao = (a: any) => {
  let d = 0;
  const junta = (o: any): void => {
    if (Array.isArray(o)) o.forEach(junta);
    else if (o && typeof o === "object") {
      if (typeof o.time === "number") d = Math.max(d, o.time);
      Object.values(o).forEach(junta);
    }
  };
  junta(a);
  return d;
};

defineCommand({
  name: "instance.inline",
  group: "bone",
  summary:
    "O caminho de volta do instance.extract: os ossos, slots, partes, restricoes, particulas e timelines do .boneco filho entram neste, no lugar da instancia (os ossos raiz do filho sob o osso dela; se ela tem posicao, giro ou escala, um osso com o nome dela faz essa ponte). Cada animacao em que a instancia toca uma animacao do filho desde o 0, na velocidade 1, recebe as timelines dela. Recusa: nomes que ja existem aqui, paginas do filho fora do atlas deste, e tempos que nao da para copiar exatos (outro inicio ou velocidade, repetir com a animacao daqui mais longa que a do filho).",
  params: z.object({ name: z.string() }),
  label: (p) => `embute ${p.name}`,
  async prepare({ doc, assets }, p) {
    const inst = instances(doc.json).find((x) => x.name === p.name);
    if (!inst) throw new Error(`instancia nao existe: "${p.name}"`);
    const base = doc.file.tres ?? doc.file.skeleton;
    if (!base) throw new Error("o documento nao tem arquivo: nao ha onde achar o filho");
    if (!assets?.text) throw new Error("este ambiente nao le arquivos (o editor e as ferramentas leem)");
    const caminho = normaliza(pasta(base) + inst.boneco);
    const texto = await assets.text(caminho);
    if (texto === null) throw new Error(`nao achei ${caminho}`);
    return { texto };
  },
  run(ctx, p) {
    const { e } = ctx;
    const json: any = e.json;
    const ii = requireInstance(json, p.name);
    const inst = instances(json)[ii];
    const filhoB = JSON.parse(ctx.prepared.texto);
    const { json: f, atlas: fAtlas } = exportarSpine(filhoB);
    const avisos: string[] = [];
    // as paginas e regioes do filho tem de estar no atlas deste (o mesmo arquivo, visto daqui)
    const prefixo = pasta(inst.boneco);
    const nossas = parseAtlas(ctx.doc.atlas.text);
    for (const pg of parseAtlas(fAtlas).pages)
      if (!nossas.pages.some((x) => x.name === normaliza(prefixo + pg.name))) throw new Error(`a pagina ${pg.name} do filho nao esta no atlas deste (embuta so filhos com as mesmas paginas)`);
    for (const r of parseAtlas(fAtlas).regions) if (!nossas.regions.some((x) => x.name === r.name)) throw new Error(`a regiao ${r.name} do filho nao esta no atlas deste`);
    // nomes que ja existem aqui (o slot da instancia sai)
    const choca = (lista: any[] | undefined, nomes: any[] | undefined, oQue: string, fora?: string) => {
      for (const x of nomes ?? []) if ((lista ?? []).some((y: any) => y.name === x.name && y.name !== fora)) throw new Error(`${oQue} ${x.name} do filho ja existe aqui: renomeie antes de embutir`);
    };
    choca(json.bones, f.bones, "o osso");
    choca(json.slots, f.slots, "o slot", inst.slot);
    choca(constraints(json).map((c) => c.c), constraints(f).map((c) => c.c), "a restricao");
    choca(json.particles, f.particles, "o emissor");
    choca(instances(json), f.instances, "a instancia", p.name);
    // os tempos: em cada animacao, a instancia tem de tocar uma animacao do filho desde o 0, na
    // velocidade 1 (as chaves seguintes so podem continuar a mesma)
    const plano: [string, string][] = [];
    if (inst.animation && Object.values<any>(json.animations ?? {}).some((a) => !a.instances?.[p.name]))
      throw new Error("a instancia toca uma animacao pelo relogio fora das chaves: nao da para copiar exato");
    for (const [an, a] of Object.entries<any>(json.animations ?? {})) {
      const ks: any[] = a.instances?.[p.name] ?? [];
      if (!ks.length) continue;
      const fa = ks[0].animation ?? inst.animation;
      const ok = (ks[0].time ?? 0) === 0 && (ks[0].start ?? inst.start ?? 0) === 0 && (ks[0].speed ?? inst.speed ?? 1) === 1 && ks.every((k) => (k.animation ?? fa) === fa && (k.speed ?? 1) === 1 && Math.abs((k.start ?? 0) - (k.time ?? 0)) < 1e-6);
      if (!ok) throw new Error(`animacao ${an}: a instancia nao toca uma animacao do filho desde o 0 na velocidade 1`);
      if (!fa) continue;
      if (!f.animations?.[fa]) throw new Error(`animacao ${an}: o filho nao tem a animacao ${fa}`);
      const repete = (ks[ks.length - 1].loop ?? inst.loop ?? true) !== false;
      if (repete && duracao(a) > duracao(f.animations[fa]) + 1e-6) throw new Error(`animacao ${an}: a instancia repete ${fa}, mais curta que ${an}`);
      plano.push([an, fa]);
    }
    // ---- os ossos: os raiz do filho sob o osso da instancia (ou sob uma ponte com a posicao dela)
    const ossoInst = inst.bone ?? json.slots.find((s: any) => s.name === inst.slot).bone;
    const ponte = ["x", "y", "rotation"].some((k) => (inst[k] ?? 0) !== 0) || (inst.scaleX ?? 1) !== 1 || (inst.scaleY ?? 1) !== 1;
    if (ponte && json.bones.some((b: any) => b.name === p.name)) throw new Error(`a instancia tem posicao e ja existe um osso ${p.name} para a ponte`);
    const ossos = [...json.bones];
    if (ponte) ossos.push({ name: p.name, parent: ossoInst, ...Object.fromEntries(["x", "y", "rotation", "scaleX", "scaleY"].filter((k) => inst[k] !== undefined).map((k) => [k, inst[k]])) });
    const desloc = ossos.length;
    for (const b of f.bones) ossos.push(b.parent ? b : { ...b, parent: ponte ? p.name : ossoInst });
    e.set(["bones"], ossos);
    // as malhas com pesos do filho: os indices dos ossos andam
    const mapa = new Map<number, number>(f.bones.map((_: any, i: number) => [i, desloc + i]));
    // ---- slots no lugar do slot da instancia; partes por skin
    const pos = json.slots.findIndex((s: any) => s.name === inst.slot);
    const slotInst = json.slots[pos];
    if (slotInst?.color && slotInst.color !== "ffffffff") avisos.push(`a cor do slot ${inst.slot} tingia o filho e ficou de fora`);
    e.set(["slots"], [...json.slots.slice(0, pos), ...f.slots, ...json.slots.slice(pos + 1)]);
    const skins = [...(json.skins ?? [])];
    for (const fs of f.skins ?? []) {
      const atts = Object.fromEntries(Object.entries<any>(fs.attachments ?? {}).map(([sl, porNome]) => [sl, Object.fromEntries(Object.entries<any>(porNome).map(([n, a]) => [n, pesos(a) ? remapeiaPesos(a, mapa) : a]))]));
      const k = skins.findIndex((s: any) => s.name === fs.name);
      if (k < 0) skins.push({ ...fs, attachments: atts });
      else skins[k] = { ...skins[k], attachments: { ...(skins[k].attachments ?? {}), ...atts } };
    }
    // as partes do slot da instancia (ele nao tinha imagem: saem com ele)
    for (const s of skins) if (s.attachments?.[inst.slot] && !f.slots.some((x: any) => x.name === inst.slot)) delete s.attachments[inst.slot];
    e.set(["skins"], skins);
    for (const { c, path } of constraints(f)) e.set([path[0]], [...(e.json as any)[path[0]] ?? [], c]);
    if (f.particles?.length) e.set(["particles"], [...(json.particles ?? []), ...f.particles]);
    // ---- animacoes
    for (const [an, fa] of plano) {
      const src = f.animations[fa];
      for (const [k, v] of Object.entries<any>(src)) {
        if (k === "drawOrder" || k === "events") {
          avisos.push(`animacao ${fa} do filho: ${k === "drawOrder" ? "a ordem de desenho" : "os eventos"} ficaram de fora`);
          continue;
        }
        if (k === "attachments") {
          for (const [sk, sls] of Object.entries<any>(v)) for (const [sl, x] of Object.entries<any>(sls)) e.set(["animations", an, "attachments", sk, sl], x);
          continue;
        }
        for (const [nome, tl] of Object.entries<any>(v)) e.set(["animations", an, k, nome], tl);
      }
    }
    // ---- a instancia e as timelines dela saem (e as instancias do filho entram)
    const resto = instances(e.json).filter((x) => x.name !== p.name);
    const todas = [...resto, ...(f.instances ?? []).map((x: any) => ({ ...x, boneco: normaliza(prefixo + x.boneco) }))];
    e.set(["instances"], todas.length ? todas : undefined);
    for (const [an, a] of Object.entries<any>((e.json as any).animations ?? {}))
      if (a.instances?.[p.name]) {
        const { [p.name]: _, ...outras } = a.instances;
        e.set(["animations", an, "instances"], Object.keys(outras).length ? outras : undefined);
      }
    if (f.lights?.length) avisos.push("as luzes do filho ficaram de fora (as luzes ficam na cena)");
    return { inlined: p.name, ossos: f.bones.length, slots: f.slots.length, animacoes: plano.map(([an]) => an), avisos };
  },
});
