// Uma tela feita de um .boneco so (docs/NUCLEO.md "Tela"): o boneco inteiro na janela, com a arte
// base encaixada como o bloco `tela` pede (caber, cobrir, largura, altura) e os ossos ancorados nos
// cantos, nas bordas e no centro da janela. A conta e do nucleo (mm_janela, mm_vista); aqui so a
// carga, o relogio e o desenho. Os estados da tela sao animacoes, e o codigo do jogo acha as pecas
// pelo nome dos ossos.
//
//   const tela = await TelaBoneco.abrir(gl, N, desenhista, "telas/inicio.boneco");
//   tela.tocar("entra", false); tela.enfileirar("parado", true);
//   a cada quadro: tela.avancar(dt); tela.desenhar(larguraPx, alturaPx);
//   tela.ponto("botao")  // onde o osso esta na janela, em pixels (para o toque)
//   tela.idioma = "ar"; tela.texto("saldo", "R$ 100,00"); tela.texto("saldo", { valor: 100 })
//   (os textos: docs/NUCLEO.md "Texto", desenhados pelo navegador em src/tela/textos.ts)
//
// Os papeis (docs/NUCLEO.md "Papeis", docs/BACKEND.md "Papeis"): o codigo do jogo acha cada elemento
// pelo nome que a pessoa deu no editor (o manifesto, query.roles, lista todos):
//   tela.ligarPonteiro(canvas);                         // mouse e dedo -> estados e toques
//   tela.botao("jogar").aoTocar(() => ...); tela.botao("jogar").desligar(); .ligar(); .desligado
//   tela.toque("fundo", () => ...);                     // a area de toque (sem estados)
//   tela.texto("placar", "1.300");                      // o texto do codigo (ou qualquer texto pelo slot)
//   tela.estado("desktop"); tela.estado("desktop", { reverso: true })   // um estado da tela
//   tela.estado("pula", { trilha: 2, depois: "respira" })  // e, quando acabar, "respira" em laco
//   tela.soltar(2); tela.ritmo([2, 3], 0)               // soltar uma trilha; pausar trilhas (0) e voltar (1)
//   tela.aoApertar("pular", () => ...)   // na hora do apertar (pular num jogo)
//   tela.distancia("corpo", "moeda1")                    // entre dois ossos, em unidades da arte base
//   tela.mexer("copo", { x: 120, rotacao: -10 }); tela.parte("digito_0", "num_7")   // o codigo mexe
//   tela.aoEvento("pisca", (e) => ...); tela.aoTerminar("entra", () => ...)
//   tela.areaDe("jogar")                                 // a area em pixels da janela (testes, dicas)
import type { Desenhista, PaginaGL } from "../render/desenhista.ts";
import { ortho } from "../render/desenhista.ts";
import { textoDoBoneco } from "./tela.ts";
import { TextosBoneco } from "./textos.ts";
import { traducoesDoCsv, juntarTraducoes } from "../core/texto.ts";

export type Vista = { escala: number; x: number; y: number; largura: number; altura: number };
export type TipoPapel = "botao" | "toque" | "texto";
export type EstadoBotao = "normal" | "em_cima" | "apertado" | "desligado";
export const ESTADOS_BOTAO: EstadoBotao[] = ["normal", "em_cima", "apertado", "desligado"];
type InfoPapel = { nome: string; tipo: TipoPapel; osso: number; slot: number; estados: number[]; trilha: number; mix: number; desligado: boolean };
export type Retangulo = { x: number; y: number; largura: number; altura: number };

// um botao pelo nome (tela.botao("jogar")): o toque, desligar e o estado mostrado
export class Botao {
  constructor(
    private tela: TelaBoneco,
    readonly nome: string,
    readonly k: number,
  ) {}
  aoTocar(fn: () => void) {
    this.tela.aoTocar(this.nome, fn);
    return this;
  }
  // desligado: mostra o estado desligado e nao toca
  desligar(desligado = true) {
    this.tela.desligarPapel(this.k, desligado);
    return this;
  }
  ligar() {
    return this.desligar(false);
  }
  get desligado(): boolean {
    return this.tela.papelDesligado(this.k);
  }
  get estado(): EstadoBotao | null {
    return this.tela.estadoPapel(this.k);
  }
  // mostra um estado (o apertado num atalho de teclado); o ponteiro muda de novo quando anda
  mostrar(estado: EstadoBotao) {
    this.tela.mostrarPapel(this.k, estado);
    return this;
  }
  get area(): Retangulo | null {
    return this.tela.areaDe(this.nome);
  }
}

export class TelaBoneco {
  readonly animacoes: Record<string, number>; // nome -> duracao
  readonly papeis: InfoPapel[];
  private ossos = new Map<string, number>();
  private nomesAnim: string[];
  private nomesEvento: string[];
  private aoToque = new Map<string, (() => void)[]>();
  private aoAperto = new Map<string, (() => void)[]>();
  private aoEventoFn = new Map<string, ((e: { nome: string; animacao: string; trilha: number }) => void)[]>();
  private aoFim = new Map<string, (() => void)[]>();
  private janela: [number, number] = [0, 0];
  private constructor(
    private gl: WebGL2RenderingContext,
    private N: any,
    private desenhista: Desenhista,
    private modelo: number,
    readonly inst: number,
    private paginas: PaginaGL[],
    info: any,
    readonly textos: TextosBoneco | null,
  ) {
    this.animacoes = Object.fromEntries((info.animacoes ?? []).map((a: { nome: string; duracao: number }) => [a.nome, a.duracao]));
    this.nomesAnim = (info.animacoes ?? []).map((a: { nome: string }) => a.nome);
    this.nomesEvento = info.eventos ?? [];
    (info.ossos ?? []).forEach((o: { nome: string }, i: number) => this.ossos.set(o.nome, i));
    this.papeis = info.papeis ?? [];
    this.slotNomes = (info.slots ?? []).map((s: { nome: string }) => s.nome);
    // os botoes no estado inicial e os eventos de animacao guardados para o jogo
    if (this.papeis.length) N._mm_papeis_iniciar(inst);
    N._mm_eventos_ligar(inst, 1);
  }
  private slotNomes: string[];

  // le o .boneco (texto ou binario) e as paginas ao lado dele
  static async abrir(gl: WebGL2RenderingContext, N: any, desenhista: Desenhista, url: string): Promise<TelaBoneco> {
    const abs = new URL(url, location.href).href;
    const texto = textoDoBoneco(N, new Uint8Array(await (await fetch(abs)).arrayBuffer()), url);
    // as instancias (docs/NUCLEO.md "Instancias"): os .boneco dos filhos (e os dos netos), pelo caminho
    // que o leitor pede (relativo ao do pai), entregues antes de carregar
    const caminho = "/" + abs.slice(abs.lastIndexOf("/") + 1);
    const filhos = (t: string, de: string) => {
      try {
        return ((JSON.parse(t).instancias ?? []) as { boneco?: unknown }[]).filter((i) => typeof i.boneco === "string").map((i) => new URL(i.boneco as string, "http://x" + de).pathname);
      } catch {
        return [];
      }
    };
    const fila = filhos(texto, caminho);
    const vistos = new Set<string>();
    N._mm_limpar_arquivos();
    while (fila.length) {
      const c = fila.shift()!;
      if (vistos.has(c)) continue;
      vistos.add(c);
      const t = textoDoBoneco(N, new Uint8Array(await (await fetch(new URL("." + c, abs).href)).arrayBuffer()), c);
      const pc = N.stringToNewUTF8(c),
        pt = N.stringToNewUTF8(t);
      N._mm_arquivo(pc, pt);
      N._free(pc);
      N._free(pt);
      fila.push(...filhos(t, c));
    }
    const p = N.stringToNewUTF8(texto),
      pc = N.stringToNewUTF8(caminho);
    const modelo = N._mm_carregar_de(p, pc);
    N._free(p);
    N._free(pc);
    N._mm_limpar_arquivos();
    if (modelo < 0) throw new Error(`${url}: ${N.UTF8ToString(N._mm_erro())}`);
    const info = JSON.parse(N.UTF8ToString(N._mm_info(modelo)));
    const dir = abs.slice(0, abs.lastIndexOf("/") + 1);
    // a mesma pagina pedida por mais de um boneco (o corpo e os bracos do personagem, duas instancias do
    // mesmo filho) baixa e sobe uma vez so
    const texturas = new Map<string, Promise<WebGLTexture>>();
    const textura = (arquivo: string) => {
      if (!texturas.has(arquivo))
        texturas.set(arquivo, (async () => desenhista.textura(await createImageBitmap(await (await fetch(dir + arquivo)).blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" })))());
      return texturas.get(arquivo)!;
    };
    const paginas: PaginaGL[] = await Promise.all(info.paginas.map(async (pg: { arquivo: string; pma: boolean }) => ({ tex: await textura(pg.arquivo), pma: pg.pma, relevo: null })));
    const inst = N._mm_instancia(modelo);
    N._mm_reiniciar(inst);
    // os textos (docs/NUCLEO.md "Texto"): as fontes ao lado do .boneco, a pagina dos textos depois
    // das paginas do boneco
    const textos = info.textos?.length ? await TextosBoneco.criar(desenhista, N, modelo, dir) : null;
    return new TelaBoneco(gl, N, desenhista, modelo, inst, textos ? [...paginas, textos.pagina] : paginas, info, textos);
  }

  private anim(nome: string) {
    const p = this.N.stringToNewUTF8(nome);
    try {
      const a = this.N._mm_animacao(this.modelo, p);
      if (a < 0) throw new Error(`animacao desconhecida: ${nome}`);
      return a;
    } finally {
      this.N._free(p);
    }
  }
  // um estado da tela (uma animacao) na trilha, com mix em segundos
  tocar(nome: string, loop = false, trilha = 0, mix = 0) {
    this.N._mm_estado_tocar(this.inst, trilha, this.anim(nome), loop ? 1 : 0, mix);
  }
  // o estado tocado de tras para a frente (sair do jeito que entrou)
  tocarReverso(nome: string, trilha = 0, mix = 0) {
    this.N._mm_estado_tocar_reverso(this.inst, trilha, this.anim(nome), mix);
  }
  enfileirar(nome: string, loop = false, trilha = 0, atraso = 0, mix = 0) {
    this.N._mm_estado_enfileirar(this.inst, trilha, this.anim(nome), loop ? 1 : 0, atraso, mix);
  }
  avancar(dt: number) {
    this.N._mm_passo(this.inst, dt);
    this.lerEventos();
  }

  // ---- papeis (docs/NUCLEO.md "Papeis"): o codigo acha pelo nome

  private papel(nome: string, tipo?: TipoPapel): number {
    const k = this.papeis.findIndex((p) => p.nome === nome);
    if (k < 0) throw new Error(`papel desconhecido: ${nome} (os papeis: ${this.papeis.map((p) => p.nome).join(", ") || "nenhum"})`);
    if (tipo && this.papeis[k].tipo !== tipo) throw new Error(`${nome} e ${this.papeis[k].tipo}, nao ${tipo}`);
    return k;
  }
  botao(nome: string): Botao {
    return new Botao(this, nome, this.papel(nome, "botao"));
  }
  // a area de toque (sem estados): o fn a cada toque; devolve o retangulo de agora em pixels
  toque(nome: string, fn?: () => void): Retangulo | null {
    this.papel(nome, "toque");
    if (fn) this.aoTocar(nome, fn);
    return this.areaDe(nome);
  }
  aoTocar(nome: string, fn: () => void) {
    this.papel(nome);
    this.aoToque.set(nome, [...(this.aoToque.get(nome) ?? []), fn]);
  }
  // na hora em que o ponteiro aperta o papel (o toque de aoTocar e no soltar): o pulo de um jogo nao
  // espera o dedo subir. Botao desligado nao chama
  aoApertar(nome: string, fn: () => void) {
    this.papel(nome);
    this.aoAperto.set(nome, [...(this.aoAperto.get(nome) ?? []), fn]);
  }
  desligarPapel(k: number, desligado: boolean) {
    this.N._mm_papel_desligar(this.inst, k, desligado ? 1 : 0);
  }
  papelDesligado(k: number): boolean {
    return this.N._mm_papel_desligado(this.inst, k) === 1;
  }
  estadoPapel(k: number): EstadoBotao | null {
    return ESTADOS_BOTAO[this.N._mm_papel_estado(this.inst, k)] ?? null;
  }
  mostrarPapel(k: number, estado: EstadoBotao) {
    this.N._mm_papel_mostrar(this.inst, k, ESTADOS_BOTAO.indexOf(estado));
  }
  // pixels da janela (y para baixo) -> mundo do boneco (y para cima)
  paraMundo(px: number, py: number): [number, number] {
    const v = this.vista;
    return [v.x + px / v.escala, v.y + v.altura - py / v.escala];
  }
  // o papel sob o ponto (pixels da janela; null nenhum)
  papelEm(px: number, py: number): string | null {
    const [x, y] = this.paraMundo(px, py);
    const k = this.N._mm_papel_no_ponto(this.inst, x, y);
    return k >= 0 ? this.papeis[k].nome : null;
  }
  // a caixa da area em pixels da janela (null: nada aparece)
  areaDe(nome: string): Retangulo | null {
    const n = this.N._mm_papel_area(this.inst, this.papel(nome));
    if (!n) return null;
    // copia antes da vista (que tambem escreve em mm_saida)
    const t = Array.from(this.N.HEAPF64.subarray(this.N._mm_saida() / 8, this.N._mm_saida() / 8 + n)) as number[];
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const v = this.vista;
    for (let i = 0; i < n; i += 2) {
      const px = (t[i] - v.x) * v.escala,
        py = (v.y + v.altura - t[i + 1]) * v.escala;
      (x0 = Math.min(x0, px)), (x1 = Math.max(x1, px)), (y0 = Math.min(y0, py)), (y1 = Math.max(y1, py));
    }
    return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
  }
  // o ponteiro em pixels da janela: anda, aperta, solta (dedo: sem "em cima" depois) ou sai.
  // Devolve o papel sob o ponteiro (o cursor de mao); os toques chamam os aoTocar na hora
  ponteiro(tipo: "anda" | "aperta" | "solta" | "sai", px = 0, py = 0, dedo = false): string | null {
    const [x, y] = this.paraMundo(px, py);
    const t = tipo === "anda" ? 0 : tipo === "aperta" ? 1 : tipo === "solta" ? (dedo ? 3 : 2) : 4;
    const k = this.N._mm_papeis_ponteiro(this.inst, t, x, y);
    if (tipo === "aperta" && k >= 0 && !this.papelDesligado(k)) for (const fn of this.aoAperto.get(this.papeis[k].nome) ?? []) fn();
    const n = this.N._mm_papeis_toques(this.inst);
    const tocados = Array.from(this.N.HEAPF64.subarray(this.N._mm_saida() / 8, this.N._mm_saida() / 8 + n)) as number[];
    for (const j of tocados) for (const fn of this.aoToque.get(this.papeis[j].nome) ?? []) fn();
    return k >= 0 ? this.papeis[k].nome : null;
  }
  // liga o mouse e o dedo do canvas aos papeis (o canvas cobre a janela da tela); devolve o desligar
  ligarPonteiro(canvas: HTMLCanvasElement): () => void {
    const px = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height];
    };
    const cursor = (nome: string | null) => {
      const k = nome ? this.papeis.findIndex((p) => p.nome === nome) : -1;
      canvas.style.cursor = k >= 0 && !this.papelDesligado(k) ? "pointer" : "";
    };
    const anda = (e: PointerEvent) => cursor(this.ponteiro("anda", ...px(e)));
    const aperta = (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      cursor(this.ponteiro("aperta", ...px(e)));
    };
    const solta = (e: PointerEvent) => cursor(this.ponteiro("solta", ...px(e), e.pointerType === "touch"));
    const sai = () => cursor(this.ponteiro("sai"));
    canvas.addEventListener("pointermove", anda);
    canvas.addEventListener("pointerdown", aperta);
    canvas.addEventListener("pointerup", solta);
    canvas.addEventListener("pointerleave", sai);
    canvas.addEventListener("pointercancel", sai);
    return () => {
      canvas.removeEventListener("pointermove", anda);
      canvas.removeEventListener("pointerdown", aperta);
      canvas.removeEventListener("pointerup", solta);
      canvas.removeEventListener("pointerleave", sai);
      canvas.removeEventListener("pointercancel", sai);
    };
  }

  // ---- estados da tela e eventos de animacao
  // um estado da tela (uma animacao que nao e de botao): na trilha 1 por padrao, sem laco. depois: a
  // animacao que entra em laco quando esta acabar (com o mesmo mix), como voltar ao "respira"
  estado(nome: string, o: { loop?: boolean; trilha?: number; mix?: number; reverso?: boolean; depois?: string } = {}) {
    const trilha = o.trilha ?? 1;
    if (o.reverso) this.tocarReverso(nome, trilha, o.mix ?? 0);
    else this.tocar(nome, o.loop ?? false, trilha, o.mix ?? 0);
    // a fila conta o atraso do inicio desta: entra no fim dela menos o mix
    if (o.depois && !o.loop) this.enfileirar(o.depois, true, trilha, Math.max(1e-4, this.animacoes[nome] - (o.mix ?? 0)), o.mix ?? 0);
  }
  // solta a trilha (a animacao vazia, com mix): o que ela animava volta ao das trilhas de baixo
  soltar(trilha: number, mix = 0.1) {
    this.N._mm_estado_vazio(this.inst, trilha, mix);
  }
  // o ritmo das trilhas: 0 pausa, 1 normal (a pausa do jogo para so as trilhas do jogo; os botoes e a
  // tela de pausa continuam). Vale para o que a trilha toca agora e a fila dela
  ritmo(trilhas: number | number[], escala: number) {
    for (const t of Array.isArray(trilhas) ? trilhas : [trilhas]) this.N._mm_estado_ritmo(this.inst, t, escala);
  }
  // o nome da animacao que a trilha toca agora (null: nada)
  tocando(trilha: number): string | null {
    const a = this.N._mm_estado_atual(this.inst, trilha);
    return a >= 0 ? (this.nomesAnim[a] ?? null) : null;
  }
  aoEvento(nome: string, fn: (e: { nome: string; animacao: string; trilha: number }) => void) {
    if (!this.nomesEvento.includes(nome)) throw new Error(`evento desconhecido: ${nome}`);
    this.aoEventoFn.set(nome, [...(this.aoEventoFn.get(nome) ?? []), fn]);
  }
  // quando a animacao completa (o fim, ou cada volta do laco)
  aoTerminar(animacao: string, fn: () => void) {
    this.anim(animacao);
    this.aoFim.set(animacao, [...(this.aoFim.get(animacao) ?? []), fn]);
  }
  private lerEventos() {
    const n = this.N._mm_eventos(this.inst);
    if (!n) return;
    const ev = Array.from(this.N.HEAPF64.subarray(this.N._mm_saida() / 8, this.N._mm_saida() / 8 + n)) as number[];
    for (let i = 0; i < n; i += 4) {
      const [tipo, trilha, a, e] = ev.slice(i, i + 4);
      const animacao = this.nomesAnim[a] ?? "";
      if (tipo === 3) for (const fn of this.aoFim.get(animacao) ?? []) fn();
      if (tipo === 4) {
        const nome = this.nomesEvento[e];
        for (const fn of this.aoEventoFn.get(nome) ?? []) fn({ nome, animacao, trilha });
      }
    }
  }

  // a janela em pixels: os ossos ancorados vao para o lugar no proximo calculo do mundo
  redimensionar(w: number, h: number) {
    if (w === this.janela[0] && h === this.janela[1]) return;
    this.janela = [w, h];
    this.N._mm_janela(this.inst, w, h);
    // o mundo refeito agora (sem andar o relogio), para o ponto() e o desenho ja verem a janela nova
    this.N._mm_passo(this.inst, 0);
  }
  get vista(): Vista {
    const p = this.N._mm_vista(this.inst) / 8;
    const v = this.N.HEAPF64.subarray(p, p + 5);
    return { escala: v[0], x: v[1], y: v[2], largura: v[3], altura: v[4] };
  }
  // o osso no mundo -> pixels da janela (y para baixo)
  ponto(osso: string, x = 0, y = 0): [number, number] {
    const i = this.ossos.get(osso);
    if (i === undefined) throw new Error(`osso desconhecido: ${osso}`);
    const q = this.N._mm_pose_ossos(this.inst) / 8 + i * 14;
    const m = this.N.HEAPF64.subarray(q, q + 6);
    const wx = m[0] * x + m[1] * y + m[4],
      wy = m[2] * x + m[3] * y + m[5];
    const v = this.vista;
    return [(wx - v.x) * v.escala, (v.y + v.altura - wy) * v.escala];
  }

  // ---- o codigo mexe nas pecas (o que uma chave de animacao faria): fica ate uma animacao mexer nelas
  // a pose local do osso (x, y para cima, rotacao em graus, escalas), so os campos dados; os outros
  // ficam como estao. A correcao da tela (ancoras) soma por cima, como numa animacao
  mexer(osso: string, p: { x?: number; y?: number; rotacao?: number; escala_x?: number; escala_y?: number }) {
    const i = this.ossos.get(osso);
    if (i === undefined) throw new Error(`osso desconhecido: ${osso}`);
    const q = this.N._mm_pose_ossos(this.inst) / 8 + i * 14 + 7;
    const l = Array.from(this.N.HEAPF64.subarray(q, q + 5)) as number[];
    this.N._mm_osso_local(this.inst, i, p.x ?? l[0], p.y ?? l[1], p.rotacao ?? l[2], p.escala_x ?? l[3], p.escala_y ?? l[4]);
  }
  // troca a parte (attachment) de um slot pelo nome (null tira): os algarismos de um placar de imagens
  parte(slot: string, parte: string | null) {
    const k = this.slotNomes.indexOf(slot);
    if (k < 0) throw new Error(`slot desconhecido: ${slot}`);
    const p = this.N.stringToNewUTF8(parte ?? "");
    try {
      if (!this.N._mm_slot_parte(this.inst, k, p)) throw new Error(`o slot ${slot} nao tem a parte ${parte}`);
    } finally {
      this.N._free(p);
    }
  }

  // o osso no mundo, em unidades da arte base (y para cima): nao depende da janela
  posicao(osso: string, x = 0, y = 0): [number, number] {
    const i = this.ossos.get(osso);
    if (i === undefined) throw new Error(`osso desconhecido: ${osso}`);
    const q = this.N._mm_pose_ossos(this.inst) / 8 + i * 14;
    const m = this.N.HEAPF64.subarray(q, q + 6);
    return [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
  }
  // a distancia entre dois ossos, em unidades da arte base (pegar uma moeda: perto o bastante)
  distancia(a: string, b: string): number {
    const [p, q] = [this.posicao(a), this.posicao(b)];
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  }

  // ---- textos (docs/NUCLEO.md "Texto"): o idioma de todos e o valor de um pelo nome da parte
  get idioma() {
    return this.textos?.idioma ?? "";
  }
  set idioma(i: string) {
    if (this.textos) this.textos.idioma = i;
  }
  // texto livre (troca a chave), ou os parametros da chave ("Saldo {valor}"); null volta ao do arquivo
  // nome: o do papel de texto, o da parte ou o do slot
  texto(nome: string, valor: string | Record<string, string | number> | null) {
    if (!this.textos) throw new Error("esta tela nao tem textos");
    const p = this.papeis.find((x) => x.nome === nome && x.tipo === "texto");
    this.textos.texto(p ? this.slotNomes[p.slot] : nome, valor);
  }
  // o texto que aparece agora (o idioma, a chave e o que o codigo pos), pelo nome
  textoMostrado(nome: string): string {
    if (!this.textos) return "";
    const p = this.papeis.find((x) => x.nome === nome && x.tipo === "texto");
    return this.textos.mostradoPorNome(p ? this.slotNomes[p.slot] : nome);
  }
  // a tabela do jogo (o translations.csv do Godot) por cima da do arquivo
  traducoesCsv(csv: string) {
    if (!this.textos) return;
    this.textos.traducoes = juntarTraducoes(this.textos.traducoes, traducoesDoCsv(csv));
    this.textos.versao++;
  }

  // desenha a janela inteira (w x h pixels de desenho) no framebuffer atual
  desenhar(w: number, h: number) {
    this.redimensionar(w, h);
    const v = this.vista;
    this.textos?.preparar(this.inst, v.escala);
    this.N._mm_limpar_desenho();
    this.N._mm_desenhar(this.inst);
    this.desenhista.desenhar(this.N, this.paginas, ortho(v.x + v.largura / 2, v.y + v.altura / 2, v.escala, w, h));
  }

  liberar() {
    this.N._mm_liberar_instancia(this.inst);
    this.N._mm_liberar_modelo(this.modelo);
    for (const t of new Set(this.paginas.map((p) => p.tex))) this.gl.deleteTexture(t);
  }
}
