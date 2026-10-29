// O nucleo (nucleo/, C++ em wasm) no editor: a cena que leva o documento do Spine ao nucleo e
// calcula a pose com a mesma conta do PoseSim (src/core/sim.ts). O carregamento do modulo e o
// desenhista WebGL2 (o mesmo do palco e da demo, com a semantica do jogo) estao em desenhista.ts.
import { importarSpine, importarAnimacao } from "../boneco/spine.ts";
import { STEP, type Sequence } from "../core/sim.ts";
import { Desenhista, carregarNucleo, ortho, type PaginaGL } from "./desenhista.ts";

export { Desenhista, carregarNucleo, ortho, type PaginaGL };

// ---- a cena do editor

type Info = { nome: string; paginas: { arquivo: string; largura: number; altura: number; pma: boolean }[]; fisica: boolean; slots: string[]; animacoes: { nome: string; duracao: number }[] };

// campos do osso que mudam direto no setup do nucleo (os mesmos do patch.ts)
const OSSO_SETUP = new Set(["x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY", "length"]);

const corDe = (hex: string | undefined): [number, number, number, number] => {
  const s = hex ?? "ffffffff";
  const c = (i: number) => (s.length >= i + 2 ? parseInt(s.slice(i, i + 2), 16) / 255 : 1);
  return [c(0), c(2), c(4), c(6)];
};

export class NucleoCena {
  readonly N: any;
  readonly desenhista: Desenhista;
  modelo = -1;
  private inst = -1;
  info: Info | null = null;
  private anims = new Map<string, number>();
  // texturas por arquivo da pagina (sobrevivem a recarga do modelo)
  private texturas = new Map<string, WebGLTexture>();
  private paginas: PaginaGL[] = [];
  // mascara de slots escondidos, na memoria do wasm (um byte por slot do nucleo)
  private mascara = 0;
  private nMascara = 0;
  // indice do slot do nucleo para cada slot do esqueleto do spine-core (mesma ordem, conferida)
  slotDoSpine: number[] = [];
  // contadores (tools/bench.ts): recargas do modelo inteiro e remendos diretos
  stats = { cargas: 0, remendos: 0, cargaMs: 0 };

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
    this.paginas = (this.info?.paginas ?? []).map((p) => ({ tex: this.texturas.get(p.arquivo) as WebGLTexture, pma: p.pma }));
  }

  private lerInfo() {
    const N = this.N;
    this.info = JSON.parse(N.UTF8ToString(N._mm_info(this.modelo))) as Info;
    this.anims = new Map(this.info.animacoes.map((a, i) => [a.nome, i]));
  }

  // Le o documento (JSON do Spine e atlas texto) como .boneco; troca o modelo e a instancia.
  // `slotsSpine`: os nomes dos slots do esqueleto do spine-core, para a mascara do olho.
  carregar(json: any, atlas: string, nome: string, slotsSpine: string[]) {
    const N = this.N;
    const t0 = performance.now();
    const b = importarSpine(json, atlas, nome);
    const p = N.stringToNewUTF8(JSON.stringify(b));
    const m = N._mm_carregar(p);
    N._free(p);
    if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
    if (this.modelo >= 0) N._mm_liberar_modelo(this.modelo);
    this.modelo = m;
    N._mm_limpar_instancias();
    this.inst = N._mm_instancia(m);
    this.lerInfo();
    this.ligaPaginas();
    const idx = new Map(this.info!.slots.map((s, i) => [s, i]));
    this.slotDoSpine = slotsSpine.map((s) => idx.get(s) ?? -1);
    const n = this.info!.slots.length;
    if (n > this.nMascara) {
      if (this.mascara) N._free(this.mascara);
      this.mascara = N._malloc(Math.max(1, n));
      this.nMascara = n;
    }
    N._mm_reiniciar(this.inst);
    this.stats.cargas++;
    this.stats.cargaMs = performance.now() - t0;
  }

  duracao(anim: string): number {
    const i = this.anims.get(anim);
    return i === undefined ? 0 : this.info!.animacoes[i].duracao;
  }

  // Pose no instante t com a conta do PoseSim: personagem novo (setup, fisica reiniciada),
  // um quadro em 0 e passos de 1/64 desde 0 (sem fisica nem sequencia, um passo so ate t).
  // Sequencia: A e B na fila com o mix (B entra quando faltar o mix para A acabar) ou B
  // interrompendo A no instante `at`.
  poseAt(anim: string | null, loop: boolean, t: number, seq?: Sequence | null) {
    const N = this.N,
      i = this.inst;
    if (i < 0) return;
    N._mm_reiniciar(i);
    const a = anim ? this.anims.get(anim) : undefined;
    if (a === undefined) return;
    if (seq) return this.sequencia(a, seq, t);
    N._mm_estado_tocar(i, 0, a, loop ? 1 : 0, 0);
    N._mm_passo(i, 0);
    if (!this.info!.fisica) {
      if (t > 0) N._mm_passo(i, t);
      return;
    }
    this.anda(0, t);
  }

  private anda(done: number, t: number): number {
    const N = this.N,
      i = this.inst;
    while (done + STEP <= t + 1e-9) {
      N._mm_passo(i, STEP);
      done += STEP;
    }
    if (t - done > 0) N._mm_passo(i, t - done);
    return t;
  }

  private sequencia(a: number, seq: Sequence, t: number) {
    const N = this.N,
      i = this.inst;
    const b = this.anims.get(seq.next);
    const mix = Math.max(0, seq.mix);
    const bLoop = (seq.nextLoop ?? true) ? 1 : 0;
    N._mm_estado_tocar(i, 0, a, seq.loop ? 1 : 0, 0);
    const at = seq.at != null ? Math.max(0, seq.at) : null;
    if (at === null && b !== undefined) N._mm_estado_enfileirar(i, 0, b, bLoop, Math.max(this.info!.animacoes[a].duracao - mix, 0), mix);
    N._mm_passo(i, 0);
    if (at === null || b === undefined) return void this.anda(0, t);
    if (at === 0) {
      N._mm_estado_tocar(i, 0, b, bLoop, mix);
      return void this.anda(0, t);
    }
    if (t + 1e-9 < at) return void this.anda(0, t);
    let done = 0;
    while (done + STEP <= at + 1e-9) {
      N._mm_passo(i, STEP);
      done += STEP;
    }
    if (at - done > 0) N._mm_passo(i, at - done);
    N._mm_estado_tocar(i, 0, b, bLoop, mix);
    // os passos recomecam do instante da troca
    let d = at;
    while (d + STEP <= t + 1e-9) {
      N._mm_passo(i, STEP);
      d += STEP;
    }
    if (t - d > 0) N._mm_passo(i, t - d);
  }

  // um quadro de tamanho livre (tocando), como o viewer faz com o AnimationState
  passo(d: number) {
    if (this.inst >= 0) this.N._mm_passo(this.inst, d);
  }

  // Remenda o modelo sem reler o .boneco: setup de osso (transformacao e comprimento), cor e
  // parte do setup de slot e animacoes trocadas. Devolve false se a mudanca e estrutural (o
  // modelo pode ter ficado pela metade: quem chama recarrega tudo).
  remendar(json: any, paths: (string | number)[][]): boolean {
    const N = this.N,
      m = this.modelo;
    if (m < 0) return false;
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

  // desenha a pose atual; `esconder(i)` diz se o slot i do spine-core esta escondido (olho)
  desenhar(proj: Float32Array | number[], esconder?: ((i: number) => boolean) | null) {
    const N = this.N,
      i = this.inst;
    if (i < 0) return { lotes: 0, chamadas: 0, vertices: 0 };
    N._mm_limpar_desenho();
    if (esconder) {
      const mask = N.HEAPU8.subarray(this.mascara, this.mascara + this.nMascara);
      mask.fill(0);
      this.slotDoSpine.forEach((k, s) => {
        if (k >= 0 && esconder(s)) mask[k] = 1;
      });
      N._mm_desenhar_escondendo(i, this.mascara);
    } else N._mm_desenhar(i);
    return this.desenhista.desenhar(N, this.paginas, proj);
  }

  liberar() {
    this.limparTexturas();
    if (this.modelo >= 0) this.N._mm_liberar_modelo(this.modelo);
    this.N._mm_limpar_instancias();
    if (this.mascara) this.N._free(this.mascara);
    this.modelo = this.inst = -1;
    this.mascara = this.nMascara = 0;
  }
}
