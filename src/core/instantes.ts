// A pose em instantes: o que as medidas (query.*, ficha, transicao, recorte) e os comandos que
// convertem "na tela" em valores locais leem. Duas implementacoes com a mesma interface:
//
// - spine-core (modos "godot" e "spine"): um SkeletonData lido uma vez por medidor e o PoseSim
//   (src/core/sim.ts). No modo "godot" a conta simula o jogo de hoje (spine-godot): a gravidade
//   das fisicas de rotacao invertida (godotGravity) e o mix do spine-godot (likeSpineGodot). No
//   modo "spine", o spine-core puro (o editor do Spine);
// - nucleo (modo "nucleo"): o documento vira .boneco (importarSpine, que ja escreve a gravidade
//   no sentido do jogo) e entra no wasm; a pose vem do mm_medir, com a mesma conta do poseAt do
//   editor (NucleoCena). Nada do spine-core.
//
// Por instante: o mundo e a pose local de cada osso (e o setup), e, se pedidos, a parte, a cor e
// os vertices de cada slot e a ordem de desenho. Tambem a emenda (A e B na fila ou no corte, com
// mix), os eventos de usuario ate um instante, a caixa da pose direta (skeleton.bounds) e a pose
// com alguns locais trocados (pose.follow). O modo vem de usarMedidas (o editor segue o seletor
// "desenho"; em Node o padrao e "godot").
import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  BoundingBoxAttachment,
  ClippingAttachment,
  MeshAttachment,
  MixFrom,
  PathAttachment,
  Physics,
  PointAttachment,
  RegionAttachment,
  Skeleton,
  SkeletonJson,
  TextureAtlas,
  Vector2,
  type AttachmentLoader,
  type SkeletonData,
} from "@esotericsoftware/spine-core";
import { importarSpine } from "../boneco/spine.ts";
import type { SpineJson } from "./format.ts";
import { bonesOnly, godotGravity, nullLoader } from "./pose.ts";
import { PoseSim, STEP, likeSpineGodot, type Sequence } from "./sim.ts";

export type ModoMedidas = "godot" | "spine" | "nucleo";

export interface LocalQ {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
}

export interface OssoQ {
  name: string;
  index: number;
  parent: OssoQ | null;
  length: number;
  active: boolean;
  // mundo (y para cima)
  a: number;
  b: number;
  c: number;
  d: number;
  worldX: number;
  worldY: number;
  // pose local (animada, antes das restricoes) e o setup
  local: LocalQ;
  setup: LocalQ;
}

export interface SlotQ {
  name: string;
  index: number;
  bone: OssoQ;
  // nome da parte mostrada (null: nenhuma)
  attachment: string | null;
  color: { r: number; g: number; b: number; a: number };
  // vertices em mundo da parte (regiao: 4 cantos; malha), com `vertices` pedido; senao null
  vertices: number[] | null;
}

export class Quadro {
  readonly t: number;
  readonly bones: OssoQ[];
  // vazios sem `slots` pedido
  readonly slots: SlotQ[];
  readonly drawOrder: SlotQ[];
  private ossoPorNome: Map<string, OssoQ>;
  private slotPorNome: Map<string, SlotQ> | null = null;
  constructor(t: number, bones: OssoQ[], slots: SlotQ[], drawOrder: SlotQ[]) {
    this.t = t;
    this.bones = bones;
    this.slots = slots;
    this.drawOrder = drawOrder;
    this.ossoPorNome = new Map(bones.map((b) => [b.name, b]));
  }
  findBone(name: string): OssoQ | null {
    return this.ossoPorNome.get(name) ?? null;
  }
  findSlot(name: string): SlotQ | null {
    this.slotPorNome ??= new Map(this.slots.map((s) => [s.name, s]));
    return this.slotPorNome.get(name) ?? null;
  }
}

export interface EventoQ {
  name: string;
  // tempo da chave na animacao e o instante (da sequencia) em que saiu
  keyTime: number;
  time: number;
  anim: string;
}

export interface Pedido {
  // a animacao em loop (padrao: sim, como o editor toca)
  loop?: boolean;
  // parte, cor e ordem de desenho
  slots?: boolean;
  // vertices em mundo das regioes e malhas (implica slots)
  vertices?: boolean;
}

export interface Medidor {
  readonly modo: ModoMedidas;
  readonly fisica: boolean;
  duracao(anim: string): number;
  // a pose de uma animacao (null: setup) em cada instante, com a conta do poseAt do editor.
  // Instantes crescentes continuam do ultimo passo inteiro (o mesmo resultado, mais rapido)
  poses(anim: string | null, times: number[], o?: Pedido): Quadro[];
  // a emenda A -> B (src/core/sim.ts Sequence) em cada instante da sequencia
  sequencia(anim: string, seq: Sequence, times: number[], o?: Omit<Pedido, "loop">): Quadro[];
  // eventos de usuario da animacao (ou da emenda) de 0 ate `ate`, em passos de 1/64
  eventos(anim: string, ate: number, o?: { loop?: boolean; seq?: Sequence | null }): EventoQ[];
  // caixa [x0, y0, x1, y1] das regioes e malhas na pose direta (a animacao no tempo sobre o
  // setup, sem relogio; null: o setup); null se nada
  caixa(anim: string | null, t: number, loop?: boolean): [number, number, number, number] | null;
  // a ultima pose medida com a pose local de alguns ossos trocada: o mundo recalculado sem
  // andar a fisica (pose.follow). A pose medida nao muda
  reposar(mudas: { bone: string; local: Partial<LocalQ> }[]): Quadro;
  liberar(): void;
}

// ---- o modo atual

let modoAtual: ModoMedidas = "godot";
let moduloNucleo: any = null;
// contadores (tools/nucleo-medidas.ts e bench): medidores abertos por modo e recusas do nucleo
export const estatisticas = { spine: 0, nucleo: 0, recusas: 0, ultimaRecusa: "" };

// o modo das medidas (o editor segue o seletor "desenho"); "nucleo" precisa do modulo wasm ja
// carregado (carregarNucleo em src/render/desenhista.ts)
export function usarMedidas(modo: ModoMedidas, nucleo?: any) {
  if (nucleo) moduloNucleo = nucleo;
  if (modo === "nucleo" && !moduloNucleo) throw new Error("medidas no modo nucleo: carregue o nucleo antes (carregarNucleo)");
  modoAtual = modo;
}

export function modoMedidas(): ModoMedidas {
  return modoAtual;
}

// Abre um medidor do documento (atlas texto opcional: sem ele, os vertices das regioes do
// spine-core nao saem certos; os ossos e as malhas sim). Se o nucleo recusa o documento, as
// medidas caem no spine-core (modo "spine"), como o viewer cai no spine-webgl.
// `leve`: so o que mexe nos ossos (sem imagens nem timelines de imagem): os comandos que so
// precisam do mundo dos ossos (skeletonAt) leem bem menos.
export function abrirMedidor(json: SpineJson, atlas?: string | null, modo: ModoMedidas = modoAtual, o: { leve?: boolean } = {}): Medidor {
  if (o.leve) {
    json = esqueletoLeve(json);
    atlas = null;
  }
  if (modo === "nucleo") {
    if (!moduloNucleo) throw new Error("medidas no modo nucleo: carregue o nucleo antes (carregarNucleo)");
    try {
      const m = new NucleoMedidor(moduloNucleo, json, atlas ?? "");
      estatisticas.nucleo++;
      return m;
    } catch (e: any) {
      estatisticas.recusas++;
      estatisticas.ultimaRecusa = String(e?.message ?? e);
      modo = "spine";
    }
  }
  estatisticas.spine++;
  return new SpineMedidor(json, atlas ?? null, modo);
}

// so os ossos e as cores (esqueletoLeve): o que as medidas de movimento leem
export function abrirLeve(json: SpineJson): Medidor {
  return abrirMedidor(json, null, modoAtual, { leve: true });
}

// abre, usa e solta
export function comMedidor<T>(json: SpineJson, atlas: string | null | undefined, f: (m: Medidor) => T, o: { leve?: boolean } = {}): T {
  const m = abrirMedidor(json, atlas, modoAtual, o);
  try {
    return f(m);
  } finally {
    m.liberar();
  }
}

// O documento so com o que mexe nos ossos: ossos, slots, restricoes, as partes de caminho (a
// restricao de caminho precisa delas) e as animacoes sem as timelines de imagem e de deformar
// (as de cor ficam: a transparencia conta na emenda).
export function esqueletoLeve(doc: SpineJson): SpineJson {
  const caminhos = new Set<string>();
  const skins = ((doc as any).skins ?? []).map((sk: any) => {
    const attachments: Record<string, any> = {};
    for (const [slot, m] of Object.entries<any>(sk.attachments ?? {})) {
      const so = Object.fromEntries(Object.entries<any>(m).filter(([, a]) => a?.type === "path"));
      if (Object.keys(so).length) {
        attachments[slot] = so;
        for (const n of Object.keys(so)) caminhos.add(`${slot}\u0000${n}`);
      }
    }
    return { ...sk, attachments };
  });
  const anims: Record<string, any> = {};
  for (const [n, a] of Object.entries<any>(doc.animations ?? {})) {
    const { attachments, slots, drawOrder, events, ...resto } = a;
    void attachments;
    void drawOrder;
    void events;
    let cores: Record<string, any> | undefined;
    for (const [sn, tls] of Object.entries<any>(slots ?? {})) {
      const c = Object.fromEntries(Object.entries<any>(tls).filter(([k]) => /^(rgba|rgb|alpha|rgba2|rgb2)$/.test(k)));
      if (Object.keys(c).length) (cores ??= {})[sn] = c;
    }
    anims[n] = { ...resto, ...(cores ? { slots: cores } : {}) };
  }
  return {
    ...doc,
    slots: (doc.slots ?? []).map((s: any) => {
      const { attachment, ...r } = s;
      return attachment && caminhos.has(`${s.name}\u0000${attachment}`) ? s : r;
    }),
    skins,
    animations: anims,
  } as SpineJson;
}

// ---- spine-core (modos "godot" e "spine")

// partes sem textura: a geometria vem do JSON; com o atlas, as regioes e malhas acham a imagem
// (os cantos da regiao dependem do recorte do atlas); a que falta no atlas fica sem imagem
function loaderMedidas(atlas: string | null): AttachmentLoader {
  const semImagem: AttachmentLoader = {
    newRegionAttachment: (_s, _p, name, _path, seq) => {
      const r = new RegionAttachment(name, seq);
      r.updateSequence = () => {};
      return r;
    },
    newMeshAttachment: (_s, _p, name, _path, seq) => {
      const m = new MeshAttachment(name, seq);
      m.updateSequence = () => {};
      return m;
    },
    newBoundingBoxAttachment: (_s, _p, name) => new BoundingBoxAttachment(name),
    newPathAttachment: (_s, _p, name) => new PathAttachment(name),
    newPointAttachment: (_s, _p, name) => new PointAttachment(name),
    newClippingAttachment: (_s, _p, name) => new ClippingAttachment(name),
  };
  if (!atlas) return semImagem;
  let al: AtlasAttachmentLoader;
  try {
    al = new AtlasAttachmentLoader(new TextureAtlas(atlas));
  } catch {
    return semImagem;
  }
  return {
    ...semImagem,
    newRegionAttachment: (s, p, name, path, seq) => {
      try {
        return al.newRegionAttachment(s, p, name, path, seq);
      } catch {
        return semImagem.newRegionAttachment(s, p, name, path, seq);
      }
    },
    newMeshAttachment: (s, p, name, path, seq) => {
      try {
        return al.newMeshAttachment(s, p, name, path, seq);
      } catch {
        return semImagem.newMeshAttachment(s, p, name, path, seq);
      }
    },
  };
}

class SpineMedidor implements Medidor {
  readonly modo: ModoMedidas;
  readonly fisica: boolean;
  private data: SkeletonData;
  private sk: Skeleton;
  private st: AnimationState;
  private sim: PoseSim;
  // a pose local da ultima medida (reposar volta a ela)
  private ultimo: Quadro | null = null;

  constructor(json: SpineJson, atlas: string | null, modo: ModoMedidas) {
    this.modo = modo;
    const doc = modo === "godot" ? godotGravity(json) : json;
    let data: SkeletonData;
    try {
      data = new SkeletonJson(loaderMedidas(atlas)).readSkeletonData(doc);
    } catch {
      // documento que o runtime nao le inteiro (no meio de uma edicao): so ossos e restricoes
      data = new SkeletonJson(nullLoader).readSkeletonData(bonesOnly(doc));
    }
    this.data = data;
    this.sk = new Skeleton(data);
    this.st = new AnimationState(new AnimationStateData(data));
    if (modo === "godot") likeSpineGodot(this.st);
    this.sim = new PoseSim(this.sk, this.st);
    this.fisica = this.sk.physics.length > 0;
  }

  duracao(anim: string) {
    return this.data.findAnimation(anim)?.duration ?? 0;
  }

  private quadro(t: number, o: Pedido = {}): Quadro {
    const sk = this.sk;
    const bones: OssoQ[] = sk.bones.map((b, i) => {
      const p = b.appliedPose,
        l = b.pose,
        s = b.data.setupPose;
      return {
        name: b.data.name,
        index: i,
        parent: null,
        length: b.data.length,
        active: b.active,
        a: p.a,
        b: p.b,
        c: p.c,
        d: p.d,
        worldX: p.worldX,
        worldY: p.worldY,
        local: { x: l.x, y: l.y, rotation: l.rotation, scaleX: l.scaleX, scaleY: l.scaleY, shearX: l.shearX, shearY: l.shearY },
        setup: { x: s.x, y: s.y, rotation: s.rotation, scaleX: s.scaleX, scaleY: s.scaleY, shearX: s.shearX, shearY: s.shearY },
      };
    });
    sk.bones.forEach((b, i) => (bones[i].parent = b.parent ? bones[b.parent.data.index] : null));
    let slots: SlotQ[] = [],
      order: SlotQ[] = [];
    if (o.slots || o.vertices) {
      slots = sk.slots.map((s, i) => {
        const att: any = s.appliedPose.attachment;
        const c = s.appliedPose.color;
        let vertices: number[] | null = null;
        if (o.vertices) {
          if (att instanceof RegionAttachment) {
            // regiao sem o atlas (sem os cantos recortados): sem vertices
            const off = (att as any).sequence?.offsets ? att.getOffsets(s.appliedPose) : null;
            vertices = off ? new Array(8).fill(0) : [];
            if (off) att.computeWorldVertices(s, off, vertices, 0, 2);
          } else if (att instanceof MeshAttachment) {
            vertices = new Array(att.worldVerticesLength).fill(0);
            att.computeWorldVertices(sk, s, 0, att.worldVerticesLength, vertices, 0, 2);
          } else vertices = [];
        }
        return { name: s.data.name, index: i, bone: bones[s.bone.data.index], attachment: att?.name ?? null, color: { r: c.r, g: c.g, b: c.b, a: c.a }, vertices };
      });
      order = sk.drawOrder.appliedPose.map((s) => slots[s.data.index]);
    }
    return new Quadro(t, bones, slots, order);
  }

  poses(anim: string | null, times: number[], o: Pedido = {}) {
    const a = anim && this.data.findAnimation(anim) ? anim : null;
    const out = times.map((t) => {
      this.sim.poseAt(a, o.loop ?? true, t);
      return this.quadro(t, o);
    });
    this.ultimo = out[out.length - 1] ?? null;
    return out;
  }

  sequencia(anim: string, seq: Sequence, times: number[], o: Omit<Pedido, "loop"> = {}) {
    const out = times.map((t) => {
      this.sim.poseAt(anim, !!seq.loop, t, seq);
      return this.quadro(t, o);
    });
    this.ultimo = out[out.length - 1] ?? null;
    return out;
  }

  // a mesma conta do PoseSim, sempre em passos de 1/64 desde 0 e sem o checkpoint
  eventos(anim: string, ate: number, o: { loop?: boolean; seq?: Sequence | null } = {}): EventoQ[] {
    const { sk, st } = this;
    const out: EventoQ[] = [];
    let agora = 0;
    const lis = { event: (e: any, ev: any) => out.push({ name: ev.data.name, keyTime: ev.time, time: agora, anim: e.animation?.name ?? "" }) };
    const passo = (d: number) => {
      agora += d;
      st.update(d);
      st.apply(sk);
      sk.update(d);
      sk.updateWorldTransform(Physics.update);
    };
    this.sim.invalidate();
    sk.setupPose();
    sk.time = 0;
    st.clearTracks();
    st.addListener(lis);
    try {
      const seq = o.seq ?? null;
      const a = st.setAnimation(0, anim, seq ? !!seq.loop : (o.loop ?? true));
      a.mixDuration = 0;
      const at = seq && seq.at != null ? Math.max(0, seq.at) : null;
      const interromper = () => {
        const e = st.setAnimation(0, seq!.next, seq!.nextLoop ?? true);
        e.mixDuration = Math.max(0, seq!.mix);
      };
      if (seq && at === null) {
        const b = st.addAnimation(0, seq.next, seq.nextLoop ?? true, 0);
        b.mixDuration = Math.max(0, seq.mix);
        b.delay = Math.max(a.animationEnd - a.animationStart - b.mixDuration, 0);
      }
      sk.updateWorldTransform(Physics.reset);
      passo(0);
      let done = 0,
        cut = at === 0;
      if (cut) interromper();
      if (at !== null && !cut && ate + 1e-9 >= at) {
        while (done + STEP <= at + 1e-9) {
          passo(STEP);
          done += STEP;
        }
        if (at - done > 0) passo(at - done);
        interromper();
        done = at;
        agora = at;
      }
      while (done + STEP <= ate + 1e-9) {
        passo(STEP);
        done += STEP;
      }
      if (ate - done > 0) passo(ate - done);
    } finally {
      st.removeListener(lis);
    }
    return out;
  }

  caixa(anim: string | null, t: number, loop = false): [number, number, number, number] | null {
    const sk = this.sk;
    this.sim.invalidate();
    sk.setupPose();
    const a = anim ? this.data.findAnimation(anim) : null;
    if (a) {
      a.apply(sk, 0, t, loop, [], 1, MixFrom.setup, false, false, false);
      sk.updateWorldTransform(Physics.pose);
    } else sk.updateWorldTransform(Physics.reset);
    const off = new Vector2(),
      size = new Vector2();
    sk.getBounds(off, size, []);
    if (!isFinite(size.x) || size.x <= 0) return null;
    return [off.x, off.y, off.x + size.x, off.y + size.y];
  }

  reposar(mudas: { bone: string; local: Partial<LocalQ> }[]): Quadro {
    const sk = this.sk;
    const guardado: [any, LocalQ][] = [];
    for (const m of mudas) {
      const b = sk.findBone(m.bone);
      if (!b) throw new Error(`osso nao existe: ${m.bone}`);
      const p = b.pose as any;
      guardado.push([p, { x: p.x, y: p.y, rotation: p.rotation, scaleX: p.scaleX, scaleY: p.scaleY, shearX: p.shearX, shearY: p.shearY }]);
      Object.assign(p, m.local);
    }
    sk.updateWorldTransform(Physics.pose);
    const q = this.quadro(this.ultimo?.t ?? 0);
    for (const [p, l] of guardado) Object.assign(p, l);
    return q;
  }

  liberar() {}
}

// ---- nucleo (modo "nucleo")

type InfoN = {
  fisica: boolean;
  ossos: { nome: string; pai: number }[];
  slots: { nome: string; osso: number }[];
  partes: { nome: string }[];
  animacoes: { nome: string; duracao: number }[];
  eventos: string[];
};

class NucleoMedidor implements Medidor {
  readonly modo: ModoMedidas = "nucleo";
  readonly fisica: boolean;
  private modelo: number;
  private inst: number;
  private info: InfoN;
  private anims: Map<string, number>;
  private setup: LocalQ[];
  private comprimentos: number[];
  private ultimo: Quadro | null = null;
  private N: any;

  constructor(N: any, json: SpineJson, atlas: string) {
    this.N = N;
    const b = importarSpine(json, atlas, (json as any).skeleton?.name ?? "medidas");
    const p = N.stringToNewUTF8(JSON.stringify(b));
    const m = N._mm_carregar(p);
    N._free(p);
    if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
    this.modelo = m;
    this.info = JSON.parse(N.UTF8ToString(N._mm_info(m)));
    this.anims = new Map(this.info.animacoes.map((a, i) => [a.nome, i]));
    this.fisica = this.info.fisica;
    this.inst = N._mm_instancia(m);
    const nb = this.info.ossos.length;
    const s = N._mm_setup_ossos(m) / 8;
    const v = N.HEAPF64.subarray(s, s + nb * 8);
    this.setup = [];
    this.comprimentos = [];
    for (let k = 0; k < nb; k++) {
      const o = k * 8;
      this.setup.push({ x: v[o], y: v[o + 1], rotation: v[o + 2], scaleX: v[o + 3], scaleY: v[o + 4], shearX: v[o + 5], shearY: v[o + 6] });
      this.comprimentos.push(v[o + 7]);
    }
  }

  duracao(anim: string) {
    const i = this.anims.get(anim);
    return i === undefined ? 0 : this.info.animacoes[i].duracao;
  }

  private ossos(): OssoQ[] {
    const bones: OssoQ[] = this.info.ossos.map((o, i) => ({
      name: o.nome,
      index: i,
      parent: null,
      length: this.comprimentos[i],
      active: true,
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      worldX: 0,
      worldY: 0,
      local: this.setup[i],
      setup: this.setup[i],
    }));
    this.info.ossos.forEach((o, i) => (bones[i].parent = o.pai >= 0 ? bones[o.pai] : null));
    return bones;
  }

  // le a saida do mm_medir (formato no nucleo_web.cpp)
  private ler(times: number[], o: Pedido): Quadro[] {
    const N = this.N;
    const n = N._mm_saida() / 8;
    const h: Float64Array = N.HEAPF64;
    const nb = this.info.ossos.length,
      ns = this.info.slots.length;
    let k = n;
    return times.map((t) => {
      const bones = this.ossos();
      for (const b of bones) {
        b.a = h[k];
        b.b = h[k + 1];
        b.c = h[k + 2];
        b.d = h[k + 3];
        b.worldX = h[k + 4];
        b.worldY = h[k + 5];
        b.local = { x: h[k + 6], y: h[k + 7], rotation: h[k + 8], scaleX: h[k + 9], scaleY: h[k + 10], shearX: h[k + 11], shearY: h[k + 12] };
        k += 13;
      }
      let slots: SlotQ[] = [],
        order: SlotQ[] = [];
      if (o.slots || o.vertices) {
        slots = this.info.slots.map((s, i) => {
          const parte = h[k];
          const r = { name: s.nome, index: i, bone: bones[s.osso], attachment: parte >= 0 ? this.info.partes[parte].nome : null, color: { r: h[k + 1], g: h[k + 2], b: h[k + 3], a: h[k + 4] }, vertices: null as number[] | null };
          k += 5;
          return r;
        });
        for (let j = 0; j < ns; j++) order.push(slots[h[k + j]]);
        k += ns;
      }
      if (o.vertices)
        for (let j = 0; j < ns; j++) {
          const c = h[k];
          slots[j].vertices = Array.from(h.subarray(k + 1, k + 1 + c));
          k += 1 + c;
        }
      void nb;
      return new Quadro(t, bones, slots, order);
    });
  }

  private medir(anim: number, loop: boolean, seq: Sequence | null, times: number[], o: Pedido) {
    const N = this.N;
    const prox = seq ? (this.anims.get(seq.next) ?? -1) : -1;
    const corte = seq && seq.at != null ? Math.max(0, seq.at) : -1;
    const p = N._malloc(Math.max(8, times.length * 8));
    try {
      N.HEAPF64.set(times, p / 8);
      N._mm_medir(this.inst, anim, loop ? 1 : 0, prox, seq ? Math.max(0, seq.mix) : 0, corte, (seq?.nextLoop ?? true) ? 1 : 0, p, times.length, (o.slots || o.vertices ? 1 : 0) | (o.vertices ? 2 : 0));
    } finally {
      N._free(p);
    }
    const out = this.ler(times, o);
    this.ultimo = out[out.length - 1] ?? null;
    return out;
  }

  poses(anim: string | null, times: number[], o: Pedido = {}) {
    const a = anim ? (this.anims.get(anim) ?? -1) : -1;
    return this.medir(a, o.loop ?? true, null, times, o);
  }

  sequencia(anim: string, seq: Sequence, times: number[], o: Omit<Pedido, "loop"> = {}) {
    const a = this.anims.get(anim);
    if (a === undefined) throw new Error(`animacao nao existe: ${anim}`);
    if (!this.anims.has(seq.next)) throw new Error(`animacao nao existe: ${seq.next}`);
    return this.medir(a, !!seq.loop, seq, times, o);
  }

  eventos(anim: string, ate: number, o: { loop?: boolean; seq?: Sequence | null } = {}): EventoQ[] {
    const N = this.N;
    const a = this.anims.get(anim);
    if (a === undefined) return [];
    const seq = o.seq ?? null;
    const prox = seq ? (this.anims.get(seq.next) ?? -1) : -1;
    const corte = seq && seq.at != null ? Math.max(0, seq.at) : -1;
    const n = N._mm_medir_eventos(this.inst, a, (seq ? !!seq.loop : (o.loop ?? true)) ? 1 : 0, prox, seq ? Math.max(0, seq.mix) : 0, corte, (seq?.nextLoop ?? true) ? 1 : 0, ate);
    const p = N._mm_saida() / 8;
    const v: Float64Array = N.HEAPF64.subarray(p, p + n);
    const out: EventoQ[] = [];
    for (let k = 0; k < n; k += 4) out.push({ name: this.info.eventos[v[k]] ?? "", keyTime: v[k + 1], time: v[k + 2], anim: this.info.animacoes[v[k + 3]]?.nome ?? "" });
    return out;
  }

  caixa(anim: string | null, t: number, loop = false): [number, number, number, number] | null {
    const N = this.N;
    const a = anim ? (this.anims.get(anim) ?? -1) : -1;
    const ok = N._mm_caixa_direta(this.inst, a, t, loop ? 1 : 0);
    this.ultimo = null;
    if (!ok) return null;
    const p = N._mm_saida() / 8;
    const [x0, y0, x1, y1] = N.HEAPF64.subarray(p, p + 4);
    return [x0, y0, x1, y1];
  }

  reposar(mudas: { bone: string; local: Partial<LocalQ> }[]): Quadro {
    const N = this.N;
    const base = this.ultimo;
    if (!base) throw new Error("reposar: mede uma pose antes");
    const p = N._malloc(Math.max(8, mudas.length * 64));
    try {
      const v = N.HEAPF64.subarray(p / 8, p / 8 + mudas.length * 8);
      mudas.forEach((m, k) => {
        const b = base.findBone(m.bone);
        if (!b) throw new Error(`osso nao existe: ${m.bone}`);
        const l = { ...b.local, ...m.local };
        v.set([b.index, l.x, l.y, l.rotation, l.scaleX, l.scaleY, l.shearX, l.shearY], k * 8);
      });
      N._mm_reposar(this.inst, p, mudas.length);
    } finally {
      N._free(p);
    }
    const s = N._mm_saida() / 8;
    const h: Float64Array = N.HEAPF64;
    const bones = this.ossos();
    const mudou = new Map(mudas.map((m) => [m.bone, m.local]));
    bones.forEach((b, i) => {
      const k = s + i * 6;
      b.a = h[k];
      b.b = h[k + 1];
      b.c = h[k + 2];
      b.d = h[k + 3];
      b.worldX = h[k + 4];
      b.worldY = h[k + 5];
      b.local = { ...base.bones[i].local, ...(mudou.get(b.name) ?? {}) };
    });
    return new Quadro(base.t, bones, [], []);
  }

  liberar() {
    const N = this.N;
    if (this.inst >= 0) N._mm_liberar_instancia(this.inst);
    if (this.modelo >= 0) N._mm_liberar_modelo(this.modelo);
    this.inst = this.modelo = -1;
  }
}
