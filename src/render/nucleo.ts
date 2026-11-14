// O nucleo (nucleo/, C++ em wasm) no editor: a cena que leva o documento do Spine ao nucleo,
// calcula a pose com a mesma conta do PoseSim (src/core/sim.ts), inclusive o atalho do
// checkpoint, e deixa a pose ser lida (NucleoPose) por clique, arrasto, gizmos e caixas, sem
// nenhum esqueleto do spine-core. O carregamento do modulo e o desenhista WebGL2 (o mesmo do
// palco e da demo, com a semantica do jogo) estao em desenhista.ts.
import { importarSpine, importarAnimacao } from "../boneco/spine.ts";
import { STEP, type Sequence } from "../core/sim.ts";
import { Desenhista, carregarNucleo, ortho, type PaginaGL } from "./desenhista.ts";
import type { Blend, BoneView, Local, PartKind, PartView, PoseView, SlotView } from "./pose.ts";
import { TextosBoneco } from "../tela/textos.ts";

export { Desenhista, carregarNucleo, ortho, type PaginaGL };

// ---- a cena do editor

type Info = {
  nome: string;
  paginas: { arquivo: string; largura: number; altura: number; pma: boolean; relevo?: string }[];
  fisica: boolean;
  ossos: { nome: string; pai: number }[];
  slots: { nome: string; osso: number; blend: number }[];
  papeis?: { nome: string; tipo: string; osso: number; slot: number; estados: number[]; trilha: number; mix: number; desligado: boolean }[];
  partes: { nome: string; tipo: number; slot: number; vertices: number; contorno: number; pesada: boolean; fechado: boolean }[];
  animacoes: { nome: string; duracao: number }[];
  textos?: { nome: string; parte: number; slot: number }[];
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
const BLENDS: Blend[] = ["normal", "additive", "multiply", "multiply", "screen", "overlay", "softLight", "darken", "lighten", "difference", "colorDodge"];

// o checkpoint do poseAt: o ultimo passo inteiro (done) de uma conta (key)
type Checkpoint = { key: string; done: number; cut: boolean };

// a grade de checkpoints (com fisica, sem sequencia): um a cada GRADE passos (0,25 s) da conta
// atual. Editar uma animacao so muda a pose depois da chave anterior a mexida: a fisica continua
// da vaga mais perto antes dela, em vez de refazer desde 0
const GRADE = 16;
type Grade = { key: string; vagas: Set<number> };

// as timelines de osso tocadas numa animacao, se todos os caminhos sao dentro delas
// (["animations", anim, "bones", osso, timeline, ...]: uma chave, ou a timeline inteira, como ao
// inserir uma chave) e elas existem com chaves; senao null
function timelinesDeOsso(an: any, paths: (string | number)[][], anim: string): [string, string][] | null {
  const out = new Map<string, [string, string]>();
  for (const p of paths) {
    if (p[1] !== anim) continue;
    if (p[2] !== "bones" || typeof p[3] !== "string" || typeof p[4] !== "string" || (p.length > 5 && typeof p[5] !== "number")) return null;
    const keys = an.bones?.[p[3]]?.[p[4]];
    if (!Array.isArray(keys) || !keys.length) return null;
    out.set(`${p[3]}\u0000${p[4]}`, [p[3], p[4]]);
  }
  return out.size ? [...out.values()] : null;
}

// o instante a partir do qual a pose de uma animacao pode ter mudado, pelos caminhos tocados
// (["animations", nome, ..., indice da chave, ...]): a chave antes da primeira mexida (as chaves
// antes dela, e a curva entre elas, ficam iguais). Sem chave no caminho, desde 0
function inicioDaMudanca(anim: any, paths: (string | number)[][]): number {
  let ini = Infinity;
  for (const p of paths) {
    let no = anim,
      t = 0;
    for (let j = 2; j < p.length; j++) {
      const k = p[j];
      if (typeof k === "number") {
        // no Spine, a chave em 0 nao escreve o time
        if (Array.isArray(no) && k > 0) t = typeof no[k - 1]?.time === "number" ? no[k - 1].time : 0;
        break;
      }
      no = no?.[k];
    }
    ini = Math.min(ini, t);
    if (ini === 0) break;
  }
  return ini === Infinity ? 0 : ini;
}

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
  // os textos (docs/NUCLEO.md "Texto"): as letras pelo navegador, numa pagina depois das do boneco.
  // urlFonte: o arquivo da fonte (relativo ao documento) -> url; o idioma mostrado
  textos: TextosBoneco | null = null;
  urlFonte: ((arquivo: string) => string) | null = null;
  idioma = "";
  // os textos foram relidos (o editor refaz o aviso de estouro; tambem o evento "mamulengo-textos")
  aoTextos: (() => void) | null = null;
  // mascara de slots escondidos, na memoria do wasm (um byte por slot do nucleo)
  private mascara = 0;
  private nMascara = 0;
  private ck: Checkpoint | null = null;
  private grade: Grade | null = null;
  // a pose para ler (refeita a cada carga do modelo)
  pose: NucleoPose | null = null;
  // desliga o atalho do checkpoint (para medir e conferir que da o mesmo)
  atalhos = true;
  // contadores (tools/bench.ts): recargas do modelo inteiro, remendos diretos, quantos poseAt
  // continuaram de um checkpoint, e nos remendos de animacao, as timelines de osso trocadas
  // sozinhas e as animacoes relidas inteiras
  stats = { cargas: 0, remendos: 0, cargaMs: 0, checkpoints: 0, timelines: 0, animacoes: 0 };

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

  // troca so um retangulo de uma pagina ja carregada (a pintura ao vivo: um remendo por quadro em
  // vez da pagina inteira); false se a pagina nao tem textura aqui
  remendaTextura(arquivo: string, x: number, y: number, w: number, h: number, rgba: Uint8ClampedArray): boolean {
    const gl = this.desenhista.gl;
    const t = this.texturas.get(arquivo);
    if (!t) return false;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return true;
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
    // a pagina dos textos logo depois das do desenho
    if (this.textos && this.info?.textos?.length) this.paginas.push(this.textos.pagina);
  }

  // os textos do modelo novo: as fontes que faltam chegam depois (refaz as letras com elas)
  private lerTextos() {
    if (!this.info?.textos?.length) return;
    this.textos ??= TextosBoneco.novo(this.desenhista, this.N);
    if (this.idioma) this.textos.idioma = this.idioma;
    const url = this.urlFonte ?? ((a: string) => a);
    // quem mostra o aviso de estouro refaz a conta (o modelo novo, as fontes que chegaram)
    void this.textos.ler(this.modelo, "", url).then(() => {
      this.aoTextos?.();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("mamulengo-textos"));
    });
  }
  usarIdioma(i: string) {
    this.idioma = i;
    if (this.textos) this.textos.idioma = i;
  }
  // pixels da tela por unidade do mundo, pela projecao e o viewport atual
  private prepararTextos(inst: number, proj: Float32Array | number[]) {
    if (!this.textos || !this.info?.textos?.length) return;
    const vp = this.desenhista.gl.getParameter(this.desenhista.gl.VIEWPORT) as Int32Array;
    this.textos.preparar(inst, Math.hypot(proj[0], proj[1]) * vp[2] * 0.5);
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
    this.aplicaJanela();
    this.aplicaSkin();
    this.ck = null;
    this.grade = null;
    this.lerInfo();
    this.lerTextos();
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

  // a janela da tela (docs/NUCLEO.md "Tela"): o tamanho em pixels de quem mostra o boneco inteiro;
  // null e a arte base. Vale nas duas instancias e a cada recarga do modelo
  tamJanela: [number, number] | null = null;
  janela(t: [number, number] | null) {
    this.tamJanela = t;
    this.aplicaJanela();
    this.invalidar();
  }
  private aplicaJanela() {
    if (!this.N._mm_janela) return;
    const [w, h] = this.tamJanela ?? [0, 0];
    for (const i of [this.inst, this.fantasma]) if (i >= 0) this.N._mm_janela(i, w, h);
  }
  // nove-fatias (docs/NUCLEO.md "Nove-fatias"): a grade da regiao fatiada que o slot mostra agora:
  // o tamanho L x A em que foi feita (o do texto acompanhado inclusive) e o esticar da janela
  fatiaDoSlot(slot: number): { largura: number; altura: number; ex: number; ey: number; nx: number; ny: number } | null {
    if (this.inst < 0 || !this.N._mm_fatias || !this.info) return null;
    const p = this.N._mm_pose_slots(this.inst) / 8;
    const parte = this.N.HEAPF64[p + slot * 5];
    if (!(parte >= 0)) return null;
    const n = this.N._mm_fatias(this.inst);
    const v = this.N.HEAPF64.subarray(this.N._mm_saida() / 8, this.N._mm_saida() / 8 + n);
    for (let k = 0; k + 6 < n; k += 7) if (v[k] === parte) return { nx: v[k + 1], ny: v[k + 2], largura: v[k + 3], altura: v[k + 4], ex: v[k + 5], ey: v[k + 6] };
    return null;
  }

  // a vista: escala (pixels por unidade), x, y (canto de baixo e da esquerda), largura e altura
  vista(): { escala: number; x: number; y: number; largura: number; altura: number } | null {
    if (this.inst < 0 || !this.N._mm_vista) return null;
    const p = this.N._mm_vista(this.inst) / 8;
    const v = this.N.HEAPF64.subarray(p, p + 5);
    return { escala: v[0], x: v[1], y: v[2], largura: v[3], altura: v[4] };
  }

  // a skin mostrada (null: a padrao); vale nas duas instancias e a cada recarga do modelo
  skin: string | null = null;
  usarSkin(nome: string | null) {
    this.skin = nome;
    this.aplicaSkin();
    this.ck = null;
    this.grade = null;
    if (this.inst >= 0) this.N._mm_reiniciar(this.inst);
    this.mudou();
  }
  private aplicaSkin() {
    if (this.inst < 0 || !this.N._mm_skin) return;
    const N = this.N;
    const p = N.stringToNewUTF8(this.skin ?? "default"),
      d = N.stringToNewUTF8("default");
    // skin que nao existe (apagada, desfeita): a padrao
    for (const i of [this.inst, this.fantasma]) if (i >= 0 && N._mm_skin(i, p) < 0) N._mm_skin(i, d);
    N._free(p);
    N._free(d);
  }

  temAnimacao(anim: string) {
    return this.anims.has(anim);
  }

  duracao(anim: string): number {
    const i = this.anims.get(anim);
    return i === undefined ? 0 : this.info!.animacoes[i].duracao;
  }

  // o estado mudou por fora: esquece os checkpoints (o atual e a grade)
  invalidar() {
    this.ck = null;
    this.grade = null;
  }

  // so o checkpoint do quadro atual (o remendo ja tirou da grade o que a edicao mudou)
  invalidarAtual() {
    this.ck = null;
  }

  // a vaga valida mais perto antes de t (instante < t, como o retoma), restaurada; ou null
  private daGrade(key: string, t: number): number | null {
    const g = this.grade;
    if (!this.atalhos || !g || g.key !== key) return null;
    let melhor = -1;
    for (const v of g.vagas) if (v * GRADE * STEP < t - 1e-9 && v > melhor) melhor = v;
    if (melhor < 0 || !this.N._mm_restaurar_de(this.inst, melhor)) return null;
    this.stats.checkpoints++;
    return melhor * GRADE * STEP;
  }

  // depois de um passo inteiro: guarda a vaga se o instante cai na grade e ela falta
  private naGrade(key: string, done: number) {
    if (!this.atalhos) return;
    const n = Math.round(done / STEP);
    if (n % GRADE) return;
    if (!this.grade || this.grade.key !== key) this.grade = { key, vagas: new Set() };
    const v = n / GRADE;
    if (this.grade.vagas.has(v)) return;
    this.N._mm_guardar_em(this.inst, v);
    this.grade.vagas.add(v);
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
    const vaga = fisica && !ck ? this.daGrade(key, t) : null;
    if (ck) done = ck.done;
    else if (vaga !== null) done = vaga;
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
      if (fisica) this.naGrade(key, done);
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

  // ---- papeis (docs/NUCLEO.md "Papeis"): a area de cada um e "jogar a tela" (os botoes pelo ponteiro)
  papeis(): { nome: string; tipo: string; osso: number; slot: number; estados: number[]; trilha: number; mix: number; desligado: boolean }[] {
    return this.info?.papeis ?? [];
  }
  papel(nome: string): number {
    return this.papeis().findIndex((p) => p.nome === nome);
  }
  // os triangulos da area no mundo (6 numeros cada)
  papelArea(k: number): number[] {
    if (this.inst < 0 || !this.N._mm_papel_area || k < 0) return [];
    const n = this.N._mm_papel_area(this.inst, k);
    const p = this.N._mm_saida() / 8;
    return Array.from(this.N.HEAPF64.subarray(p, p + n));
  }
  // a caixa do que o papel mostra agora, no espaco do osso: [x do meio, y do meio, largura, altura]
  papelCaixaNoOsso(nome: string): number[] | null {
    const k = this.papel(nome);
    const t = this.papelArea(k);
    if (!t.length) return null;
    const q = this.N._mm_pose_ossos(this.inst) / 8 + this.papeis()[k].osso * 14;
    const [a, b, c, d, x, y] = Array.from(this.N.HEAPF64.subarray(q, q + 6)) as number[];
    const det = a * d - b * c || 1e-12;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 2) {
      const dx = t[i] - x,
        dy = t[i + 1] - y;
      const lx = (d * dx - b * dy) / det,
        ly = (-c * dx + a * dy) / det;
      (x0 = Math.min(x0, lx)), (x1 = Math.max(x1, lx)), (y0 = Math.min(y0, ly)), (y1 = Math.max(y1, ly));
    }
    const r = (v: number) => Math.round(v * 10) / 10;
    return [r((x0 + x1) / 2), r((y0 + y1) / 2), r(x1 - x0), r(y1 - y0)];
  }
  // comeca a tela: personagem novo, a animacao em laco na trilha 0 (ou nada) e os botoes no estado
  // inicial; depois, passo(dt) a cada quadro
  telaComecar(anim: string | null): boolean {
    if (this.inst < 0 || !this.N._mm_papeis_iniciar || !this.papeis().length) return false;
    this.ck = null;
    this.grade = null;
    this.N._mm_reiniciar(this.inst);
    const a = anim ? this.anims.get(anim) : undefined;
    if (a !== undefined) this.N._mm_estado_tocar(this.inst, 0, a, 1, 0);
    this.N._mm_papeis_iniciar(this.inst);
    this.passoN(0);
    this.mudou();
    return true;
  }
  // o ponteiro no mundo: 0 anda, 1 aperta, 2 solta, 3 solta (dedo), 4 sai; o papel sob ele e os tocados
  telaPonteiro(tipo: number, x: number, y: number): { sobre: number; toques: number[] } {
    if (this.inst < 0) return { sobre: -1, toques: [] };
    const sobre = this.N._mm_papeis_ponteiro(this.inst, tipo, x, y);
    const n = this.N._mm_papeis_toques(this.inst);
    const p = this.N._mm_saida() / 8;
    return { sobre, toques: Array.from(this.N.HEAPF64.subarray(p, p + n)) as number[] };
  }
  papelDesligar(k: number, desligado: boolean) {
    if (this.inst >= 0) this.N._mm_papel_desligar(this.inst, k, desligado ? 1 : 0);
  }
  papelDesligado(k: number): boolean {
    return this.inst >= 0 && this.N._mm_papel_desligado(this.inst, k) === 1;
  }
  papelEstado(k: number): number {
    return this.inst >= 0 ? this.N._mm_papel_estado(this.inst, k) : -1;
  }

  // ---- o palco (docs/PALCO.md): o jogo no lugar da animacao, em passos de 1/60 s
  temPalco = false;
  palcoComecar(): boolean {
    if (this.inst < 0 || !this.N._mm_palco) return false;
    this.ck = null;
    this.grade = null;
    this.temPalco = !!this.N._mm_palco(this.inst);
    this.mudou();
    return this.temPalco;
  }
  palcoPasso(teclas: number, n = 1) {
    if (this.inst < 0) return;
    this.N._mm_palco_passo(this.inst, teclas, n, 1 / 60);
    this.mudou();
  }
  // a caixa do que a instancia (indice na lista do modelo) desenha agora: [x0, y0, x1, y1]
  caixaInstancia(i: number): number[] | null {
    if (this.inst < 0 || !this.N._mm_caixa_instancia || !this.N._mm_caixa_instancia(this.inst, i)) return null;
    const p = this.N._mm_saida() / 8;
    return [...this.N.HEAPF64.subarray(p, p + 4)];
  }
  palcoEstado(): any {
    return this.inst < 0 ? null : JSON.parse(this.N.UTF8ToString(this.N._mm_palco_estado(this.inst)));
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
    const durAntes = new Map([...anims].map((a) => [a, this.duracao(a)]));
    // o instante a partir do qual cada animacao mudou, quando o nucleo comparou as chaves
    const inicios = new Map<string, number>();
    for (const a of anims) {
      const an = json.animations?.[a];
      if (!an) return false;
      // so chaves de timelines de osso que ja existem: troca cada uma, sem reler a animacao
      const tls = timelinesDeOsso(an, paths, a);
      if (tls) {
        let ini = Infinity;
        for (const [osso, tl] of tls) {
          const t = this.trocaTimelineOsso(json, a, osso, tl);
          if (t < 0) {
            ini = -1;
            break;
          }
          ini = Math.min(ini, t);
        }
        if (ini >= 0) {
          this.stats.timelines += tls.length;
          inicios.set(a, ini);
          continue;
        }
      }
      this.stats.animacoes++;
      const texto = JSON.stringify(importarAnimacao(json, a));
      const ok = comNome(a, (pn) => comNome(texto, (pt) => N._mm_trocar_animacao(m, pn, pt)));
      if (!ok) return false;
    }
    if (anims.size) this.lerInfo();
    // a grade: setup de osso ou slot muda tudo; animacao, so depois da chave anterior a mexida
    if (ossos.size || slots.size || !this.grade) this.grade = null;
    else {
      const g = this.grade;
      for (const a of anims) {
        if (g.key.startsWith("seq|") || g.key.split("|")[0] !== String(this.anims.get(a))) continue;
        let ini =
          inicios.get(a) ??
          inicioDaMudanca(
            json.animations[a],
            paths.filter((p) => p[1] === a),
          );
        // a duracao mudou: o laco (e o fim) mudam dali em diante
        const d0 = durAntes.get(a)!,
          d1 = this.duracao(a);
        if (Math.abs(d1 - d0) > 1e-9) ini = Math.min(ini, d0, d1);
        for (const v of [...g.vagas]) if (v * GRADE * STEP > ini + 1e-9) g.vagas.delete(v);
      }
    }
    this.stats.remendos++;
    return true;
  }

  // uma timeline de osso do Spine levada ao .boneco e trocada no nucleo: o instante a partir do
  // qual a pose mudou (o nucleo compara as chaves velhas e novas), ou -1: nao deu (quem chama
  // troca a animacao inteira, que tambem desfaz uma troca que tenha dado pela metade)
  private trocaTimelineOsso(json: any, anim: string, osso: string, tl: string): number {
    const N = this.N;
    if (!N._mm_trocar_timeline_osso) return -1;
    const chaves = json.animations[anim].bones[osso][tl];
    const mini = { bones: [], constraints: json.constraints, physics: json.physics, animations: { [anim]: { bones: { [osso]: { [tl]: chaves } } } } };
    const ossos = importarSpine(mini, "", "").animacoes[anim]?.ossos?.[osso] ?? {};
    const nomes = Object.keys(ossos);
    if (nomes.length !== 1) return -1;
    const ps = [anim, osso, nomes[0], JSON.stringify(ossos[nomes[0]])].map((x) => N.stringToNewUTF8(x));
    try {
      return N._mm_trocar_timeline_osso(this.modelo, ...ps);
    } finally {
      for (const p of ps) N._free(p);
    }
  }

  // desenha a pose atual; `esconder(i)` diz se o slot i esta escondido (olho)
  desenhar(proj: Float32Array | number[], esconder?: ((i: number) => boolean) | null) {
    const N = this.N,
      i = this.inst;
    if (i < 0) return { lotes: 0, chamadas: 0, vertices: 0 };
    this.prepararTextos(i, proj);
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
    this.prepararTextos(this.fantasma, proj);
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

