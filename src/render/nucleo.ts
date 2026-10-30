// O nucleo (nucleo/, C++ em wasm) no editor: a cena que leva o documento do Spine ao nucleo,
// calcula a pose com a mesma conta do PoseSim (src/core/sim.ts), inclusive o atalho do
// checkpoint, e deixa a pose ser lida (NucleoPose) por clique, arrasto, gizmos e caixas, sem
// nenhum esqueleto do spine-core. O carregamento do modulo e o desenhista WebGL2 (o mesmo do
// palco e da demo, com a semantica do jogo) estao em desenhista.ts.
import { importarSpine, importarAnimacao } from "../boneco/spine.ts";
import { STEP, type Sequence } from "../core/sim.ts";
import { Desenhista, carregarNucleo, ortho, type PaginaGL } from "./desenhista.ts";
import type { Blend, BoneView, Local, PartKind, PartView, PoseView, SlotView } from "./pose.ts";

export { Desenhista, carregarNucleo, ortho, type PaginaGL };

// ---- a cena do editor

type Info = {
  nome: string;
  paginas: { arquivo: string; largura: number; altura: number; pma: boolean; relevo?: string }[];
  fisica: boolean;
  ossos: { nome: string; pai: number }[];
  slots: { nome: string; osso: number; blend: number }[];
  partes: { nome: string; tipo: number; slot: number; vertices: number; contorno: number; pesada: boolean; fechado: boolean }[];
  animacoes: { nome: string; duracao: number }[];
};

// campos do osso que mudam direto no setup do nucleo (os mesmos do patch.ts)
const OSSO_SETUP = new Set(["x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY", "length"]);

const corDe = (hex: string | undefined): [number, number, number, number] => {
  const s = hex ?? "ffffffff";
  const c = (i: number) => (s.length >= i + 2 ? parseInt(s.slice(i, i + 2), 16) / 255 : 1);
  return [c(0), c(2), c(4), c(6)];
};

// na ordem dos enums TipoParte e Blend do nucleo (modelo.h)
const TIPOS: PartKind[] = ["region", "mesh", "linkedmesh", "clipping", "path", "point", "boundingbox"];
const BLENDS: Blend[] = ["normal", "additive", "multiply", "multiply", "screen"];

// o checkpoint do poseAt: o ultimo passo inteiro (done) de uma conta (key)
type Checkpoint = { key: string; done: number; cut: boolean };

export class NucleoCena {
  readonly N: any;
  readonly desenhista: Desenhista;
  modelo = -1;
  private inst = -1;
  // instancia da cebola (pose direta, sem fisica)
  private fantasma = -1;
  info: Info | null = null;
  private anims = new Map<string, number>();
  // texturas por arquivo da pagina (sobrevivem a recarga do modelo)
  private texturas = new Map<string, WebGLTexture>();
  private paginas: PaginaGL[] = [];
  // mascara de slots escondidos, na memoria do wasm (um byte por slot do nucleo)
  private mascara = 0;
  private nMascara = 0;
  private ck: Checkpoint | null = null;
  // a pose para ler (refeita a cada carga do modelo)
  pose: NucleoPose | null = null;
  // desliga o atalho do checkpoint (para medir e conferir que da o mesmo)
  atalhos = true;
  // contadores (tools/bench.ts): recargas do modelo inteiro, remendos diretos e quantos
  // poseAt continuaram do checkpoint
  stats = { cargas: 0, remendos: 0, cargaMs: 0, checkpoints: 0 };

  private constructor(N: any, gl: WebGL2RenderingContext) {
    this.N = N;
    this.desenhista = new Desenhista(gl);
  }

  static async criar(gl: WebGLRenderingContext | WebGL2RenderingContext): Promise<NucleoCena> {
    if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) throw new Error("o desenho pelo nucleo precisa de WebGL2");
    return new NucleoCena(await carregarNucleo(), gl);
  }

  // texturas das paginas, por arquivo (cada pagina com os texels do arquivo, sem pre-multiplicar)
  poeTextura(arquivo: string, img: TexImageSource, filtro?: { min: number; mag: number }) {
    const gl = this.desenhista.gl;
    const velha = this.texturas.get(arquivo);
    if (velha) gl.deleteTexture(velha);
    this.texturas.set(arquivo, this.desenhista.textura(img, filtro));
    this.ligaPaginas();
  }

  limparTexturas() {
    for (const t of this.texturas.values()) this.desenhista.gl.deleteTexture(t);
    this.texturas.clear();
    this.paginas = [];
  }

  private ligaPaginas() {
    // pagina sem textura (ainda nao carregada) fica de fora do desenho
    // o relevo (docs/NUCLEO.md "Luzes") e uma textura como as outras, pelo nome do arquivo
    this.paginas = (this.info?.paginas ?? []).map((p) => ({ tex: this.texturas.get(p.arquivo) as WebGLTexture, pma: p.pma, relevo: p.relevo ? (this.texturas.get(p.relevo) ?? null) : null }));
  }

  private lerInfo() {
    const N = this.N;
    this.info = JSON.parse(N.UTF8ToString(N._mm_info(this.modelo))) as Info;
    this.anims = new Map(this.info.animacoes.map((a, i) => [a.nome, i]));
  }

  // instancias (docs/NUCLEO.md "Instancias"): o texto de um arquivo que elas pedem, pelo caminho
  // normalizado (o leitor pede os filhos ja assim)
  registrarArquivo(caminho: string, texto: string) {
    const N = this.N;
    const c = N.stringToNewUTF8(caminho);
    const t = N.stringToNewUTF8(texto);
    N._mm_arquivo(c, t);
    N._free(c);
    N._free(t);
  }

  // as paginas do desenho (as dos filhos das instancias inclusive) ainda sem textura
  paginasSemTextura(): string[] {
    const faltam = new Set<string>();
    for (const p of this.info?.paginas ?? []) {
      if (!this.texturas.has(p.arquivo)) faltam.add(p.arquivo);
      if (p.relevo && !this.texturas.has(p.relevo)) faltam.add(p.relevo);
    }
    return [...faltam];
  }

  // Le o documento (JSON do Spine e atlas texto) como .boneco; troca o modelo e as instancias.
  // `caminho`: o do arquivo, para as instancias acharem os filhos (registrarArquivo)
  carregar(json: any, atlas: string, nome: string, caminho = "") {
    const N = this.N;
    const t0 = performance.now();
    const b = importarSpine(json, atlas, nome);
    const p = N.stringToNewUTF8(JSON.stringify(b));
    const c = N.stringToNewUTF8(caminho);
    const m = N._mm_carregar_de(p, c);
    N._free(p);
    N._free(c);
    if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
    if (this.modelo >= 0) N._mm_liberar_modelo(this.modelo);
    this.modelo = m;
    N._mm_limpar_instancias();
    this.inst = N._mm_instancia(m);
    this.fantasma = N._mm_instancia(m);
    this.ck = null;
    this.lerInfo();
    this.ligaPaginas();
    const n = this.info!.slots.length;
    if (n > this.nMascara) {
      if (this.mascara) N._free(this.mascara);
      this.mascara = N._malloc(Math.max(1, n));
      this.nMascara = n;
    }
    N._mm_reiniciar(this.inst);
    this.pose = new NucleoPose(this, this.inst, json);
    this.stats.cargas++;
    this.stats.cargaMs = performance.now() - t0;
  }

  temAnimacao(anim: string) {
    return this.anims.has(anim);
  }

  duracao(anim: string): number {
    const i = this.anims.get(anim);
    return i === undefined ? 0 : this.info!.animacoes[i].duracao;
  }

  // o estado mudou por fora (tocando com passo livre, o modelo remendado): esquece o checkpoint
  invalidar() {
    this.ck = null;
  }

  private mudou() {
    this.pose?.mudou();
  }

  private passoN(d: number) {
    this.N._mm_passo(this.inst, d);
  }

  private comecar(a: number, loop: boolean) {
    const N = this.N,
      i = this.inst;
    N._mm_reiniciar(i);
    N._mm_estado_tocar(i, 0, a, loop ? 1 : 0, 0);
  }

  // continua do checkpoint se a conta e a mesma e o tempo so andou (como o PoseSim: t igual
  // ao checkpoint refaz, porque a pose desenhada e a do passo parcial)
  private retoma(key: string, t: number): Checkpoint | null {
    const ck = this.ck;
    this.ck = null;
    if (!this.atalhos || !ck || ck.key !== key || !(t > ck.done) || !this.N._mm_restaurar(this.inst)) return null;
    this.stats.checkpoints++;
    return ck;
  }

  private guarda(key: string, done: number, cut: boolean) {
    this.N._mm_guardar(this.inst);
    this.ck = { key, done, cut };
  }

  // Pose no instante t com a conta do PoseSim: personagem novo (setup, fisica reiniciada),
  // um quadro em 0 e passos de 1/64 desde 0 (sem fisica nem sequencia, um passo so ate t).
  // Com fisica ou sequencia, quando o tempo so avanca, continua do ultimo passo inteiro.
  // Sequencia: A e B na fila com o mix (B entra quando faltar o mix para A acabar) ou B
  // interrompendo A no instante `at`.
  poseAt(anim: string | null, loop: boolean, t: number, seq?: Sequence | null) {
    if (this.inst < 0) return;
    this.mudou();
    const a = anim ? this.anims.get(anim) : undefined;
    if (a === undefined) {
      this.ck = null;
      this.N._mm_reiniciar(this.inst);
      return;
    }
    if (seq) return this.sequencia(a, seq, t);
    const fisica = this.info!.fisica;
    const key = `${a}|${loop}`;
    let done = 0;
    const ck = fisica ? this.retoma(key, t) : ((this.ck = null), null);
    if (ck) done = ck.done;
    else {
      this.comecar(a, loop);
      this.passoN(0);
      if (!fisica && this.atalhos) {
        if (t > 0) this.passoN(t);
        return;
      }
    }
    while (done + STEP <= t + 1e-9) {
      this.passoN(STEP);
      done += STEP;
    }
    if (fisica) this.guarda(key, done, false);
    if (t - done > 0) this.passoN(t - done);
  }

  private sequencia(a: number, seq: Sequence, t: number) {
    const N = this.N,
      i = this.inst;
    const b = this.anims.get(seq.next);
    const mix = Math.max(0, seq.mix);
    const bLoop = (seq.nextLoop ?? true) ? 1 : 0;
    const at = b === undefined ? null : seq.at != null ? Math.max(0, seq.at) : null;
    const key = `seq|${a}|${JSON.stringify([seq.next, seq.mix, at, !!seq.loop, seq.nextLoop ?? true])}`;
    let done = 0,
      cut = false;
    const ck = this.retoma(key, t);
    if (ck) {
      done = ck.done;
      cut = ck.cut;
    } else {
      this.comecar(a, !!seq.loop);
      if (at === null && b !== undefined) N._mm_estado_enfileirar(i, 0, b, bLoop, Math.max(this.info!.animacoes[a].duracao - mix, 0), mix);
      this.passoN(0);
      if (at === 0) {
        N._mm_estado_tocar(i, 0, b, bLoop, mix);
        cut = true;
      }
    }
    if (at !== null && !cut) {
      if (t + 1e-9 < at) return this.avanca(done, t, key, false);
      while (done + STEP <= at + 1e-9) {
        this.passoN(STEP);
        done += STEP;
      }
      if (at - done > 0) this.passoN(at - done);
      N._mm_estado_tocar(i, 0, b, bLoop, mix);
      cut = true;
      // os passos recomecam do instante da troca
      done = at;
    }
    this.avanca(done, t, key, cut);
  }

  private avanca(done: number, t: number, key: string, cut: boolean) {
    while (done + STEP <= t + 1e-9) {
      this.passoN(STEP);
      done += STEP;
    }
    this.guarda(key, done, cut);
    if (t - done > 0) this.passoN(t - done);
  }

  // um quadro de tamanho livre (tocando), como o viewer faz com o AnimationState
  passo(d: number) {
    if (this.inst < 0) return;
    this.ck = null;
    this.mudou();
    this.passoN(d);
  }

  // Remenda o modelo sem reler o .boneco: setup de osso (transformacao e comprimento), cor e
  // parte do setup de slot e animacoes trocadas. Devolve false se a mudanca e estrutural (o
  // modelo pode ter ficado pela metade: quem chama recarrega tudo).
  remendar(json: any, paths: (string | number)[][]): boolean {
    const N = this.N,
      m = this.modelo;
    if (m < 0) return false;
    this.ck = null;
    this.mudou();
    const ossos = new Set<number>(),
      slots = new Set<number>(),
      anims = new Set<string>();
    for (const p of paths) {
      if (p[0] === "animations" && typeof p[1] === "string" && p.length >= 3) anims.add(p[1]);
      else if (p[0] === "bones" && typeof p[1] === "number" && p.length === 3 && OSSO_SETUP.has(p[2] as string)) ossos.add(p[1]);
      else if (p[0] === "slots" && typeof p[1] === "number" && p.length === 3 && (p[2] === "color" || p[2] === "attachment")) slots.add(p[1]);
      else return false;
    }
    const comNome = (nome: string, f: (p: number) => number) => {
      const p = N.stringToNewUTF8(nome);
      try {
        return f(p);
      } finally {
        N._free(p);
      }
    };
    for (const i of ossos) {
      const o = json.bones?.[i];
      if (!o) return false;
      const k = comNome(o.name, (p) => N._mm_osso(m, p));
      if (k < 0) return false;
      N._mm_osso_setup(m, k, o.x ?? 0, o.y ?? 0, o.rotation ?? 0, o.scaleX ?? 1, o.scaleY ?? 1, o.shearX ?? 0, o.shearY ?? 0, o.length ?? 0);
    }
    for (const i of slots) {
      const s = json.slots?.[i];
      if (!s) return false;
      const k = comNome(s.name, (p) => N._mm_slot(m, p));
      if (k < 0) return false;
      const [r, g, b, a] = corDe(s.color);
      if (!comNome(s.attachment ?? "", (p) => N._mm_slot_setup(m, k, r, g, b, a, p))) return false;
    }
    for (const a of anims) {
      const an = json.animations?.[a];
      if (!an) return false;
      const texto = JSON.stringify(importarAnimacao(json, a));
      const ok = comNome(a, (pn) => comNome(texto, (pt) => N._mm_trocar_animacao(m, pn, pt)));
      if (!ok) return false;
    }
    if (anims.size) this.lerInfo();
    this.stats.remendos++;
    return true;
  }

  // desenha a pose atual; `esconder(i)` diz se o slot i esta escondido (olho)
  desenhar(proj: Float32Array | number[], esconder?: ((i: number) => boolean) | null) {
    const N = this.N,
      i = this.inst;
    if (i < 0) return { lotes: 0, chamadas: 0, vertices: 0 };
    N._mm_limpar_desenho();
    this.desenharInst(i, esconder);
    return this.desenhista.desenhar(N, this.paginas, proj);
  }

  private desenharInst(i: number, esconder?: ((i: number) => boolean) | null) {
    const N = this.N;
    if (!esconder) return N._mm_desenhar(i);
    const mask = N.HEAPU8.subarray(this.mascara, this.mascara + this.nMascara);
    for (let s = 0; s < this.info!.slots.length; s++) mask[s] = esconder(s) ? 1 : 0;
    N._mm_desenhar_escondendo(i, this.mascara);
  }

  // Cebola: a animacao no tempo t pela pose direta (sem fisica), tingida e com transparencia
  // (a cor do esqueleto multiplicando a de cada vertice, como o spine-webgl faz com
  // skeleton.color)
  desenharFantasma(anim: string, t: number, loop: boolean, cor: [number, number, number, number], proj: Float32Array | number[], esconder?: ((i: number) => boolean) | null) {
    const N = this.N,
      a = this.anims.get(anim);
    if (this.fantasma < 0 || a === undefined) return;
    N._mm_pose_direta(this.fantasma, a, t, loop ? 1 : 0);
    N._mm_limpar_desenho();
    this.desenharInst(this.fantasma, esconder);
    const nv = N._mm_num_vertices();
    const v = N.HEAPF32.subarray(N._mm_vertices() / 4, N._mm_vertices() / 4 + nv * 8);
    for (let k = 0; k < nv * 8; k += 8) {
      v[k + 4] *= cor[0];
      v[k + 5] *= cor[1];
      v[k + 6] *= cor[2];
      v[k + 7] *= cor[3];
    }
    this.desenhista.desenhar(N, this.paginas, proj);
  }

  // a pose de uma animacao em varios instantes (crescentes) de uma vez, com a conta do poseAt:
  // por instante, o mundo [a, b, c, d, x, y] de cada osso. A instancia principal fica na pose do
  // ultimo instante (quem chama repoe a dele)
  simular(anim: string | null, loop: boolean, instantes: number[]): Float64Array[] {
    const N = this.N;
    const a = anim ? (this.anims.get(anim) ?? -1) : -1;
    this.ck = null;
    this.mudou();
    const p = N._malloc(Math.max(8, instantes.length * 8));
    try {
      N.HEAPF64.set(instantes, p / 8);
      const n = N._mm_simular(this.inst, a, loop ? 1 : 0, p, instantes.length);
      const out = N.HEAPF64.slice(N._mm_saida() / 8, N._mm_saida() / 8 + n) as Float64Array;
      const k = this.info!.ossos.length * 6;
      return instantes.map((_, j) => out.subarray(j * k, (j + 1) * k));
    } finally {
      N._free(p);
    }
  }

  liberar() {
    this.limparTexturas();
    if (this.modelo >= 0) this.N._mm_liberar_modelo(this.modelo);
    this.N._mm_limpar_instancias();
    if (this.mascara) this.N._free(this.mascara);
    this.modelo = this.inst = this.fantasma = -1;
    this.mascara = this.nMascara = 0;
    this.pose = null;
    this.ck = null;
  }
}

// ---- a pose do nucleo para ler (src/render/pose.ts)

const OSSO = 14;

class NBone implements BoneView {
  parent: NBone | null = null;
  constructor(
    private p: NucleoPose,
    readonly name: string,
    readonly index: number,
  ) {}
  private o(k: number) {
    return this.p.ossos()[this.index * OSSO + k];
  }
  get length() {
    return this.p.setups()[this.index * 8 + 7];
  }
  get worldLength() {
    return this.o(6);
  }
  get active() {
    return true;
  }
  get a() {
    return this.o(0);
  }
  get b() {
    return this.o(1);
  }
  get c() {
    return this.o(2);
  }
  get d() {
    return this.o(3);
  }
  get worldX() {
    return this.o(4);
  }
  get worldY() {
    return this.o(5);
  }
  get local(): Local {
    const v = this.p.ossos(),
      k = this.index * OSSO;
    return { x: v[k + 7], y: v[k + 8], rotation: v[k + 9], scaleX: v[k + 10], scaleY: v[k + 11], shearX: v[k + 12], shearY: v[k + 13] };
  }
  get setup(): Local {
    const v = this.p.setups(),
      k = this.index * 8;
    return { x: v[k], y: v[k + 1], rotation: v[k + 2], scaleX: v[k + 3], scaleY: v[k + 4], shearX: v[k + 5], shearY: v[k + 6] };
  }
}

class NSlot implements SlotView {
  constructor(
    private p: NucleoPose,
    readonly name: string,
    readonly index: number,
    readonly bone: BoneView,
    readonly blend: Blend,
  ) {}
  get partIndex() {
    return this.p.slotsBuf()[this.index * 5];
  }
  get part(): PartView | null {
    const k = this.partIndex;
    return k >= 0 ? this.p.parts[k] : null;
  }
  get color() {
    const v = this.p.slotsBuf(),
      k = this.index * 5;
    return { r: v[k + 1], g: v[k + 2], b: v[k + 3], a: v[k + 4] };
  }
}

// Le a pose da instancia principal do nucleo: ossos, setup e slots sao copiados da memoria do
// wasm uma vez por pose (na primeira leitura depois de mudar); vertices, triangulos e pesos
// sao pedidos na hora.
export class NucleoPose implements PoseView {
  readonly bones: NBone[];
  readonly slots: NSlot[];
  readonly parts: PartView[];
  private byBone = new Map<string, NBone>();
  private bySlot = new Map<string, NSlot>();
  private bufO: Float64Array | null = null;
  private bufS: Float64Array | null = null;
  private bufSlots: Float64Array | null = null;
  private tri = new Map<number, Float64Array>();
  private pesos = new Map<number, [number, number][][] | null>();

  constructor(
    private cena: NucleoCena,
    private inst: number,
    json: any,
  ) {
    const info = cena.info!;
    // a imagem de cada parte vem do documento (o caminho da parte no atlas, ou o nome)
    const imagem = (slot: string | undefined, nome: string) => {
      for (const sk of json?.skins ?? []) {
        const a = slot ? sk.attachments?.[slot]?.[nome] : null;
        if (a) return a.path ?? a.name ?? nome;
      }
      return nome;
    };
    this.bones = info.ossos.map((o, i) => new NBone(this, o.nome, i));
    info.ossos.forEach((o, i) => (this.bones[i].parent = o.pai >= 0 ? this.bones[o.pai] : null));
    for (const b of this.bones) this.byBone.set(b.name, b);
    this.slots = info.slots.map((s, i) => new NSlot(this, s.nome, i, this.bones[s.osso], BLENDS[s.blend] ?? "normal"));
    for (const s of this.slots) this.bySlot.set(s.name, s);
    this.parts = info.partes.map((p) => ({ name: p.nome, kind: TIPOS[p.tipo] ?? "region", hull: p.contorno, weighted: p.pesada, closed: p.fechado, image: imagem(info.slots[p.slot]?.nome, p.nome) }));
  }

  // a pose (ou o setup do modelo) mudou: a proxima leitura copia de novo
  mudou() {
    this.bufO = this.bufS = this.bufSlots = null;
  }

  private get N() {
    return this.cena.N;
  }

  ossos(): Float64Array {
    if (!this.bufO) {
      const p = this.N._mm_pose_ossos(this.inst) / 8;
      this.bufO = this.N.HEAPF64.slice(p, p + this.bones.length * OSSO);
    }
    return this.bufO!;
  }
  setups(): Float64Array {
    if (!this.bufS) {
      const p = this.N._mm_setup_ossos(this.cena.modelo) / 8;
      this.bufS = this.N.HEAPF64.slice(p, p + this.bones.length * 8);
    }
    return this.bufS!;
  }
  slotsBuf(): Float64Array {
    if (!this.bufSlots) {
      const n = this.slots.length;
      const p = this.N._mm_pose_slots(this.inst) / 8;
      this.bufSlots = this.N.HEAPF64.slice(p, p + n * 6);
    }
    return this.bufSlots!;
  }

  findBone(name: string) {
    return this.byBone.get(name) ?? null;
  }
  findSlot(name: string) {
    return this.bySlot.get(name) ?? null;
  }
  drawOrder() {
    const v = this.slotsBuf(),
      n = this.slots.length;
    const out: NSlot[] = new Array(n);
    for (let k = 0; k < n; k++) out[k] = this.slots[v[n * 5 + k]];
    return out;
  }
  vertices(slot: SlotView, out: number[]): number {
    const N = this.N;
    const n = N._mm_vertices_slot(this.inst, slot.index);
    if (!n) return 0;
    const p = N._mm_saida() / 8;
    const h = N.HEAPF64;
    if (out.length < n) out.length = n;
    for (let k = 0; k < n; k++) out[k] = h[p + k];
    return n;
  }
  triangles(slot: SlotView) {
    const k = (slot as NSlot).partIndex;
    if (k < 0) return null;
    const kind = this.parts[k].kind;
    if (kind !== "region" && kind !== "mesh" && kind !== "linkedmesh") return null;
    let t = this.tri.get(k);
    if (!t) {
      const N = this.N;
      const n = N._mm_parte_triangulos(this.cena.modelo, k);
      t = N.HEAPF64.slice(N._mm_saida() / 8, N._mm_saida() / 8 + n) as Float64Array;
      this.tri.set(k, t);
    }
    return t;
  }
  weights(slot: SlotView) {
    const k = (slot as NSlot).partIndex;
    if (k < 0 || !this.parts[k].weighted) return null;
    if (!this.pesos.has(k)) {
      const N = this.N;
      const n = N._mm_parte_pesos(this.cena.modelo, k);
      const v = N.HEAPF64.subarray(N._mm_saida() / 8, N._mm_saida() / 8 + n);
      const out: [number, number][][] = [];
      for (let i = 0; i < n; ) {
        const c = v[i++];
        const w: [number, number][] = [];
        for (let j = 0; j < c; j++, i += 2) w.push([v[i], v[i + 1]]);
        out.push(w);
      }
      this.pesos.set(k, out);
    }
    return this.pesos.get(k)!;
  }
  bounds() {
    const N = this.N;
    if (!N._mm_caixa(this.inst)) return null;
    const p = N._mm_saida() / 8;
    const [x0, y0, x1, y1] = N.HEAPF64.subarray(p, p + 4);
    if (!(x1 > x0) || !(y1 > y0)) return null;
    return [x0, y0, x1 - x0, y1 - y0];
  }
}

// caminhos como o leitor do nucleo (normalizar_caminho, diretorio): "a/b/../c" -> "a/c"
export function normalizarCaminho(c: string): string {
  const abs = c.startsWith("/");
  const out: string[] = [];
  for (const p of c.split("/")) {
    if (p === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
    } else if (p && p !== ".") out.push(p);
  }
  return (abs ? "/" : "") + out.join("/") + (c.endsWith("/") && out.length ? "/" : "");
}
export const diretorio = (c: string) => c.slice(0, c.lastIndexOf("/") + 1);

