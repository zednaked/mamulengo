// A tela: a interface de um jogo como dados (docs/BACKEND.md, "Layout"). Uma lista de desenho ja
// resolvida - imagem (com recorte e repeticao), caixa (fundo com borda e cantos), texto (com a chave
// de traducao), boneco e area de toque -, cada elemento com nome e a transformacao final na tela
// de desenho. Desenha tudo num passo WebGL2 so: as imagens em lotes por textura, os textos e as
// caixas montados pelo Canvas 2D do navegador (o que da arabe e devanagari certos sem nenhum byte
// de montador de texto) num atlas so, e os bonecos pelo nucleo, intercalados na ordem.
//
//   const tela = new Tela(gl, N, desenhista, dados, urlBase);
//   await tela.carregar();
//   tela.idioma = "en";
//   tela.texto("Placar/Pontos", "Pontos: 95");
//   tela.avancar(dt); tela.desenhar(larguraPx, alturaPx);
//   tela.tocado(xPx, yPx)  // o nome da area de toque de cima, ou null
import { Desenhista, type PaginaGL } from "../render/desenhista.ts";

export type Xf = [number, number, number, number, number, number]; // a b c d e f: X = a x + c y + e
type Base = { nome: string; xf: Xf; z?: number; cor?: string; visivel?: boolean };
export type Estilo = {
  tipo: string;
  cor?: string;
  desenhar_centro?: boolean;
  borda?: number[];
  cor_borda?: string;
  cantos?: number[];
  expandir?: number[];
};
export type ElementoTela =
  | (Base & { tipo: "imagem"; img: string; dst: number[]; src: number[]; repetir?: boolean; espelho?: [boolean, boolean] })
  | (Base & { tipo: "caixa"; ret: number[]; estilo: Estilo })
  | (Base & {
      tipo: "texto";
      ret: number[];
      chave?: string;
      texto: string;
      fontes: string[];
      tamanho: number;
      cor_fonte: string;
      contorno?: [number, string];
      sombra?: [string, number, number, number];
      alinhar?: number[];
      quebra?: number;
    })
  | (Base & { tipo: "boneco"; arquivo: string; animacao: string; tempo: number; loop: boolean })
  | (Base & { tipo: "toque"; ret: number[] });
// uma imagem: um arquivo, ou um gradiente gerado aqui (o GradientTexture2D do Godot)
export type Gradiente = { w: number; h: number; cores: number[]; offsets: number[]; preenchimento: number; de: [number, number]; para: [number, number] };
export type Imagem = { arquivo: string; mip?: boolean; gradiente?: Gradiente };
// os pixels de um gradiente como o Godot gera (gradient_texture.cpp): centro do pixel, linear, radial
// ou quadrado, interpolado em sRGB entre os pontos
export function pixelsDoGradiente(g: Gradiente): Uint8ClampedArray {
  const px = new Uint8ClampedArray(g.w * g.h * 4);
  const n = g.offsets.length;
  const [fx, fy] = g.de, [tx, ty] = g.para;
  const dx = tx - fx, dy = ty - fy, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const u = (x + 0.5) / g.w - fx, v = (y + 0.5) / g.h - fy;
      let t = g.preenchimento === 1 ? Math.hypot(u, v) / d : g.preenchimento === 2 ? Math.max(Math.abs(u), Math.abs(v)) / Math.max(Math.abs(dx), Math.abs(dy)) : (u * dx + v * dy) / d2;
      t = Math.max(0, Math.min(1, t));
      let c: number[];
      if (t <= g.offsets[0]) c = g.cores.slice(0, 4);
      else if (t >= g.offsets[n - 1]) c = g.cores.slice((n - 1) * 4, n * 4);
      else {
        let k = 0;
        while (k < n - 2 && t > g.offsets[k + 1]) k++;
        const a = (t - g.offsets[k]) / (g.offsets[k + 1] - g.offsets[k]);
        c = [0, 1, 2, 3].map((i) => g.cores[k * 4 + i] + (g.cores[(k + 1) * 4 + i] - g.cores[k * 4 + i]) * a);
      }
      const o = (y * g.w + x) * 4;
      for (let i = 0; i < 4; i++) px[o + i] = Math.round(c[i] * 255);
    }
  return px;
}
// um no da arvore do Godot: a transformacao e o z do layout, o tamanho e as ancoras (Control), e o estado
// que o codigo muda (escondido, cor, nova transformacao, novo z)
export type No = { xf?: Xf; z?: number; tam?: number[]; anc?: number[]; oculto?: boolean; cor?: string | number[]; mover?: Xf; zNovo?: number; recorte?: number[]; corta?: boolean };
const inversa = (m: Xf): Xf => {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
};
// um boneco na tela: o relogio dele (na velocidade dele) e a fila da trilha 0, para encadear como o Spine
type Boneco = { mix: number; inst: number; modelo: number; paginas: PaginaGL[]; duracao: Record<string, number>; relogio: number; vel: number; fila: { anim: string; loop: boolean; inicio: number }[] };
export type DadosTela = {
  versao: 1;
  tamanho: [number, number];
  fundo?: string;
  fontes: Record<string, string>; // nome -> arquivo (relativo a tela)
  imagens: Record<string, Imagem>;
  // estado proprio dos nos (escondido, cor do modulate): os filhos herdam, e o codigo muda pelo nome
  nos?: Record<string, No>;
  elementos: ElementoTela[];
  // outros layouts do mesmo jogo (o Godot noutra fase): o que muda, por indice de elemento e por no
  estados?: Record<string, { elementos: Record<string, Partial<Record<"xf" | "ret" | "dst" | "src", number[]>>>; nos: Record<string, Partial<No>> }>;
};

// cor do Godot (rrggbbaa) -> rgba 0..1
function rgba(h?: string): [number, number, number, number] {
  if (!h) return [1, 1, 1, 1];
  const n = (k: number) => parseInt(h.slice(k, k + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
}
const css = (h?: string, mult: number[] = [1, 1, 1, 1]) => {
  const c = rgba(h);
  return `rgba(${Math.round(c[0] * mult[0] * 255)},${Math.round(c[1] * mult[1] * 255)},${Math.round(c[2] * mult[2] * 255)},${c[3] * mult[3]})`;
};
const mult = (a: Xf, b: Xf): Xf => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const IDIOMAS_RTL = /^(ar|he|fa|ur|ps|sd|ug|yi|dv|ckb)(_|-|$)/;

const VS = `#version 300 es
in vec2 pos; in vec2 uv; in vec4 cor;
uniform vec2 tela;
out vec2 vuv; out vec4 vcor;
void main() { vuv = uv; vcor = cor; gl_Position = vec4(pos.x / tela.x * 2.0 - 1.0, 1.0 - pos.y / tela.y * 2.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float;
in vec2 vuv; in vec4 vcor; uniform sampler2D tex; out vec4 saida;
void main() { saida = texture(tex, vuv) * vcor; }`;

// um pedaco do atlas de textos e caixas: onde esta e com que folga em volta do retangulo
type Pedaco = { x: number; y: number; w: number; h: number; k: number; folga: number; chave: string; pedido: number }; // pedido: a escala pedida (k pode ser menor, no limite do atlas)
const ATLAS = 2048;

export class Tela {
  static medir = false; // tempos da carga no console
  idioma = "pt";
  // deslocamento do texto em pixels de desenho (calibrado contra o Godot)
  ajusteTexto: [number, number] = [-0.5, 0]; // medido: o Godot arredonda a posicao dos glifos
  traducoes: Record<string, Record<string, string>> = {};
  readonly elementos: ElementoTela[];
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buf: WebGLBuffer;
  private uTela: WebGLUniformLocation;
  private vert = new Float32Array(8 * 6 * 512);
  private nv = 0;
  private texAtual: WebGLTexture | null = null;
  private texturas = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  private bonecos = new Map<ElementoTela, Boneco>();
  private atlas: WebGLTexture;
  private pedacos = new Map<ElementoTela, Pedaco>();
  private prateleira = { x: 0, y: 0, h: 0 };
  private rasc = document.createElement("canvas");
  private porNome = new Map<string, ElementoTela>();
  private nos: Record<string, No>;
  private efeito = new Map<ElementoTela, number[] | null>(); // cor final herdada, ou null (escondido)
  // o movimento acumulado dos nos de cima (so de quem tem): o xf do elemento pode mudar a qualquer hora
  private moverDe = new Map<ElementoTela, Xf>();
  private ordem: ElementoTela[] = []; // a ordem de desenho (z final, depois a do layout)
  private cadeias = new Map<ElementoTela, string[]>();
  private kVisto = new Map<ElementoTela, number>();
  private recorteDe = new Map<ElementoTela, number[]>();
  private sujo = true;
  private escala = 1;
  private origem: [number, number] = [0, 0];

  constructor(
    private gl: WebGL2RenderingContext,
    private N: any,
    private desenhista: Desenhista,
    readonly dados: DadosTela,
    private base: string, // url da pasta da tela (com / no fim)
  ) {
    this.elementos = dados.elementos;
    this.nos = dados.nos ?? {};
    // os estados apontam para os elementos (o indice muda quando o codigo clona ou adiciona)
    for (const [nome, est] of Object.entries(dados.estados ?? {}))
      this.estadosEl.set(nome, new Map(Object.entries(est.elementos).map(([i, m]) => [this.elementos[Number(i)], m])));
    for (const e of this.elementos) this.porNome.set(e.tipo === "toque" ? "toque:" + e.nome : e.nome, e);
    const sh = (t: number, s: string) => {
      const o = gl.createShader(t)!;
      gl.shaderSource(o, s);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? "shader");
      return o;
    };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.prog);
    this.uTela = gl.getUniformLocation(this.prog, "tela")!;
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const at = (n: string, k: number, o: number) => {
      const l = gl.getAttribLocation(this.prog, n);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, k, gl.FLOAT, false, 32, o);
    };
    at("pos", 2, 0);
    at("uv", 2, 8);
    at("cor", 4, 16);
    gl.bindVertexArray(null);
    this.atlas = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ATLAS, ATLAS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // imagens, fontes e bonecos; depois disso a tela desenha
  // progresso: chamado a cada arquivo pronto (para a barra do shell)
  // progresso: chamado a cada arquivo pronto (para a barra do shell). adiar: os bonecos que podem vir
  // depois do primeiro quadro (escondidos no comeco); carregarAdiados() os traz.
  private adiados: ElementoTela[] = [];
  private imagensAdiadas: [string, Imagem][] = [];
  async carregar(progresso?: (feitos: number, total: number) => void, adiar?: (e: ElementoTela) => boolean) {
    if (this.sujo) this.recalcular();
    // fonte de uma escrita so (arabe, devanagari) so no idioma dela; a troca de idioma traz a que faltar
    const fontes = Object.keys(this.dados.fontes).filter((n) => this.fonteServe(n)).map((n) => this.carregarFonte(n));
    // imagem que so aparece em elemento escondido tambem pode vir depois
    const usada = new Map<string, ElementoTela[]>();
    for (const e of this.elementos) if (e.tipo === "imagem") (usada.get(e.img) ?? usada.set(e.img, []).get(e.img)!).push(e);
    const imagens = Object.entries(this.dados.imagens).map(([k, im]) => {
      const els = usada.get(k) ?? [];
      if (adiar && els.length && els.every((e) => adiar(e))) return void this.imagensAdiadas.push([k, im]);
      return this.carregarImagem(k, im);
    }).filter((p): p is Promise<void> => !!p);
    const bonecos = this.elementos.map(async (e) => {
      if (e.tipo !== "boneco") return;
      if (adiar?.(e)) return void this.adiados.push(e);
      await this.carregarBoneco(e);
    });
    if (Tela.medir) {
      const t0 = performance.now();
      const fim = (n: string, ps: Promise<unknown>[]) => Promise.all(ps).then(() => console.log(`carga ${n}: ${(performance.now() - t0).toFixed(0)}ms (${ps.length})`));
      fim("fontes", fontes), fim("imagens", imagens), fim("bonecos", bonecos);
    }
    const todos = [...fontes, ...imagens, ...bonecos];
    let feitos = 0;
    if (progresso) for (const p of todos) p.then(() => progresso(++feitos, todos.length));
    await Promise.all(todos);
  }

  private async carregarImagem(k: string, im: Imagem) {
    const { gl } = this;
    let fonte: Blob | ImageData;
    if (im.gradiente) fonte = new ImageData(pixelsDoGradiente(im.gradiente) as Uint8ClampedArray<ArrayBuffer>, im.gradiente.w, im.gradiente.h);
    else fonte = await (await fetch(new URL(im.arquivo, this.base).href)).blob();
    const bmp = await createImageBitmap(fonte, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    const rep = this.elementos.some((e) => e.tipo === "imagem" && e.img === k && e.repetir);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, rep ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, rep ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    if (im.mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, im.mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.texturas.set(k, { tex, w: bmp.width, h: bmp.height });
    bmp.close();
  }

  private async carregarBoneco(e: ElementoTela) {
    if (e.tipo !== "boneco") return;
    const { N } = this;
    const url = new URL(e.arquivo, this.base).href;
    const texto = await (await fetch(url)).text();
    const caminho = "/" + e.arquivo.replace(/^(\.\.\/)+/, "");
    const modelo = this.comTexto(texto, (pt) => this.comTexto(caminho, (pc) => N._mm_carregar_de(pt, pc)));
    if (modelo < 0) throw new Error(`${e.arquivo}: ${N.UTF8ToString(N._mm_erro())}`);
    const info = JSON.parse(N.UTF8ToString(N._mm_info(modelo)));
    const dir = url.slice(0, url.lastIndexOf("/") + 1);
    const paginas: PaginaGL[] = await Promise.all(
      info.paginas.map(async (pg: { arquivo: string; pma: boolean }) => {
        const img = await createImageBitmap(await (await fetch(dir + pg.arquivo)).blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
        return { tex: this.desenhista.textura(img), pma: pg.pma, relevo: null };
      }),
    );
    const inst = N._mm_instancia(modelo);
    const anim = this.comTexto(e.animacao, (p) => N._mm_animacao(modelo, p));
    // com trilhas, como o AnimationState: o jogo encadeia (troca, depois parada em loop)
    N._mm_reiniciar(inst);
    if (anim >= 0) N._mm_estado_tocar(inst, 0, anim, e.loop ? 1 : 0, 0);
    N._mm_passo(inst, e.tempo);
    this.bonecos.set(e, { mix: Number(/"mix"\s*:\s*\{\s*"padrao"\s*:\s*([\d.]+)/.exec(texto)?.[1] ?? 0), inst, modelo, paginas, relogio: e.tempo, vel: 1, fila: [{ anim: e.animacao, loop: e.loop, inicio: 0 }], duracao: Object.fromEntries((info.animacoes ?? []).map((a: { nome: string; duracao: number }) => [a.nome, a.duracao])) });
  }
  // o elemento esta escondido agora (ele ou algum no de cima)?
  escondido(e: ElementoTela) {
    if (this.sujo) this.recalcular();
    return !this.efeito.get(e);
  }
  // os bonecos adiados, depois do primeiro quadro (um de cada vez, para nao brigar com o quadro)
  async carregarAdiados() {
    for (const [k, im] of this.imagensAdiadas.splice(0)) if (!this.texturas.has(k)) await this.carregarImagem(k, im);
    for (const e of this.adiados.splice(0)) await this.carregarBoneco(e);
  }
  // as fontes de uma escrita so: o nome diz a escrita, o idioma diz se ela aparece
  private static ESCRITAS: [RegExp, RegExp][] = [
    [/arabic/i, /^(ar|fa|ur|ps|sd|ug|ckb)(_|-|$)/],
    [/devanagari/i, /^(hi|mr|ne|sa)(_|-|$)/],
    [/hebrew/i, /^(he|yi)(_|-|$)/],
  ];
  private fonteServe(nome: string) {
    for (const [f, l] of Tela.ESCRITAS) if (f.test(nome)) return l.test(this.idioma);
    return true;
  }
  private fontesProntas = new Map<string, Promise<void>>();
  private carregarFonte(nome: string) {
    let p = this.fontesProntas.get(nome);
    if (!p) {
      p = new FontFace(nome, `url(${new URL(this.dados.fontes[nome], this.base).href})`).load().then((f) => void document.fonts.add(f));
      this.fontesProntas.set(nome, p);
    }
    return p;
  }

  private comTexto<T>(s: string, f: (p: number) => T): T {
    const p = this.N.stringToNewUTF8(s);
    try {
      return f(p);
    } finally {
      this.N._free(p);
    }
  }

  // ---- o que o codigo do jogo usa
  elemento(nome: string): ElementoTela | undefined {
    return this.porNome.get(nome) ?? this.elementos.find((e) => e.nome.endsWith("/" + nome) && e.tipo !== "toque");
  }
  texto(nome: string, valor: string) {
    const e = this.elemento(nome);
    if (e?.tipo !== "texto" || (e.texto === valor && !e.chave)) return;
    e.texto = valor;
    e.chave = undefined;
    this.pedacos.delete(e);
  }
  // mostrar ou esconder um no (e o que esta embaixo dele), como o visible do Godot
  // o codigo mudou o tamanho, a fonte ou o contorno de um texto (ou caixa): redesenha
  refazer(nome: string) {
    const e = this.elemento(nome);
    if (e) this.pedacos.delete(e);
  }
  mostrar(no: string, sim: boolean) {
    (this.nos[no] ??= {}).oculto = !sim;
    this.sujo = true;
  }
  visivel(no: string) {
    return !this.nos[no]?.oculto;
  }
  // a cor (modulate) de um no, herdada pelos filhos; "ffffffff" desfaz. Em numeros pode passar de 1,
  // como o modulate do Godot (para desfazer a cor de um pai)
  cor(no: string, rrggbbaa: string | number[]) {
    (this.nos[no] ??= {}).cor = rrggbbaa;
    this.sujo = true;
  }
  // garante uma imagem carregada (para elemento criado pelo codigo); o arquivo e relativo a tela
  async carregarArquivo(chave: string, arquivo: string, mip = false): Promise<[number, number]> {
    if (!this.texturas.has(chave)) {
      this.dados.imagens[chave] ??= { arquivo, mip };
      await this.carregarImagem(chave, this.dados.imagens[chave]);
    }
    const t = this.texturas.get(chave)!;
    return [t.w, t.h];
  }
  // troca a imagem de um elemento; a nova vem do mesmo lugar das outras (carrega na primeira vez)
  async imagem(nome: string, chave: string, arquivo?: string) {
    const e = this.elemento(nome);
    if (e?.tipo !== "imagem") return;
    if (!this.texturas.has(chave)) {
      if (!arquivo) arquivo = this.dados.imagens[chave]?.arquivo;
      if (!arquivo) throw new Error(`imagem ${chave} desconhecida`);
      this.dados.imagens[chave] ??= { arquivo };
      await this.carregarImagem(chave, this.dados.imagens[chave]);
    }
    e.img = chave;
  }
  // o boneco de um elemento, para o jogo tocar e encadear animacoes
  boneco(nome: string) {
    const e = this.elemento(nome);
    const b = e && this.bonecos.get(e);
    if (!b) return null;
    const { N } = this;
    const anim = (a: string) => this.comTexto(a, (p) => N._mm_animacao(b.modelo, p));
    // a entrada atual: a ultima da fila que ja comecou
    const atual = () => {
      let k = 0;
      for (let i = 0; i < b.fila.length; i++) if (b.fila[i].inicio <= b.relogio + 1e-9) k = i;
      return k;
    };
    // quando a ultima da fila termina (em loop: a proxima volta completa), no relogio do boneco
    const fimDaUltima = () => {
      const u = b.fila[b.fila.length - 1];
      const d = b.duracao[u.anim] ?? 0;
      if (!u.loop || d <= 0) return u.inicio + d;
      const T = Math.max(0, b.relogio - u.inicio);
      return u.inicio + d * (Math.floor(T / d) + 1);
    };
    return {
      duracao: (a: string) => b.duracao[a] ?? 0,
      tem: (a: string) => a in b.duracao,
      // a velocidade do relogio do boneco (time_scale)
      set velocidade(v: number) {
        b.vel = v;
      },
      // set_animation: troca ja (mix em segundos)
      // sem mix, o padrao do arquivo do boneco (como o AnimationStateData)
      tocar: (a: string, loop = true, mix = b.mix) => {
        b.fila = [{ anim: a, loop, inicio: b.relogio }];
        N._mm_estado_tocar(b.inst, 0, anim(a), loop ? 1 : 0, mix);
      },
      // add_animation: quando a anterior acabar (em loop, na proxima volta) menos o mix, mais o atraso.
      // Devolve em quantos segundos de verdade ela comeca.
      encadear: (a: string, loop = true, atraso = 0, mix = b.mix) => {
        const anterior = b.fila[b.fila.length - 1];
        const inicio = Math.max(fimDaUltima() - mix + atraso, b.relogio);
        b.fila.push({ anim: a, loop, inicio });
        N._mm_estado_enfileirar(b.inst, 0, anim(a), loop ? 1 : 0, inicio - anterior.inicio, mix);
        return (inicio - b.relogio) / b.vel;
      },
      // do zero, ja no instante t da animacao (o contador entra no segundo certo)
      posicionar: (a: string, t: number, loop = false) => {
        N._mm_reiniciar(b.inst);
        N._mm_estado_tocar(b.inst, 0, anim(a), loop ? 1 : 0, 0);
        N._mm_passo(b.inst, t);
        b.fila = [{ anim: a, loop, inicio: b.relogio - t }];
      },
      // a animacao que esta tocando agora
      get atual() {
        return b.fila[atual()].anim;
      },
      // ao contrario, do fim para o comeco (play_reverso)
      tocarReverso: (a: string, mix = b.mix) => {
        b.fila = [{ anim: a, loop: false, inicio: b.relogio }];
        N._mm_estado_tocar_reverso(b.inst, 0, anim(a), mix);
      },
      // em quantos segundos de verdade a entrada atual termina (Infinity em loop)
      fimDaAtual: () => {
        const i = atual();
        const en = b.fila[i];
        if (en.loop) return Infinity;
        return (en.inicio + (b.duracao[en.anim] ?? 0) - b.relogio) / b.vel;
      },
      // slots: esconder no desenho, e tingir (null tira), como o esconder e o pintar do jogo
      esconder: (slots: string[], sim = true) => {
        for (const sl of slots) {
          const k = this.comTexto(sl, (p) => N._mm_slot(b.modelo, p));
          if (k >= 0) N._mm_slot_esconder(b.inst, k, sim ? 1 : 0);
        }
      },
      pintar: (slot: string, cor: number[] | null) => {
        const k = this.comTexto(slot, (p) => N._mm_slot(b.modelo, p));
        if (k >= 0) N._mm_slot_tinta(b.inst, k, ...(cor ?? [1, 1, 1, -1]));
      },
      // o osso no mundo, ja em unidades da tela (o xf do elemento, com y para baixo)
      osso: (nomeOsso: string): Xf | null => {
        const k = this.comTexto(nomeOsso, (p) => N._mm_osso(b.modelo, p));
        if (k < 0) return null;
        const o = N._mm_pose_ossos(b.inst) / 8 + k * 14;
        const H = N.HEAPF64;
        // o nucleo guarda por linhas (x = a x + b y): aqui e por colunas
        return mult(mult(this.xfDe(e), [1, 0, 0, -1, 0, 0]), [H[o], H[o + 2], H[o + 1], H[o + 3], H[o + 4], H[o + 5]]);
      },
    };
  }

  // tira um no (e o que esta embaixo) da tela: o queue_free de um clone
  remover(no: string) {
    const sob = (n: string) => n === no || n.startsWith(no + "/");
    for (let i = this.elementos.length - 1; i >= 0; i--) {
      const e = this.elementos[i];
      if (!sob(e.nome)) continue;
      const b = this.bonecos.get(e);
      if (b) this.N._mm_liberar_instancia(b.inst), this.bonecos.delete(e);
      if (this.porNome.get(e.tipo === "toque" ? "toque:" + e.nome : e.nome) === e) this.porNome.delete(e.tipo === "toque" ? "toque:" + e.nome : e.nome);
      this.pedacos.delete(e);
      this.elementos.splice(i, 1);
    }
    for (const n of Object.keys(this.nos)) if (sob(n)) delete this.nos[n];
    for (const c of this.copias.keys()) if (sob(c)) this.copias.delete(c);
    this.sujo = true;
  }
  // as copias feitas pelo jogo (novo -> molde): na janela nova, a geometria vem do molde de novo
  private copias = new Map<string, string>();

  // duplica um no e o que esta embaixo dele com outro nome (o duplicate() do Godot): os elementos
  // entram logo depois dos originais, os bonecos ganham instancia propria
  clonar(no: string, novo: string) {
    const troca = (n: string) => novo + n.slice(no.length);
    const sob = (n: string) => n === no || n.startsWith(no + "/");
    let ultimo = -1;
    const copias: ElementoTela[] = [];
    this.elementos.forEach((e, i) => {
      if (!sob(e.nome)) return;
      ultimo = i;
      copias.push({ ...structuredClone(e), nome: troca(e.nome) } as ElementoTela);
    });
    for (const [n, v] of Object.entries(this.nos)) if (sob(n)) this.nos[troca(n)] = structuredClone(v);
    if (ultimo < 0) return;
    this.copias.set(novo, no);
    this.elementos.splice(ultimo + 1, 0, ...copias);
    copias.forEach((c) => {
      if (!this.porNome.has(c.nome)) this.porNome.set(c.tipo === "toque" ? "toque:" + c.nome : c.nome, c);
      const orig = this.elementos.find((x) => x.nome === no + c.nome.slice(novo.length) && x.tipo === c.tipo);
      const b = orig && this.bonecos.get(orig);
      if (c.tipo === "boneco" && b) {
        const inst = this.N._mm_instancia(b.modelo);
        this.N._mm_reiniciar(inst);
        this.bonecos.set(c, { ...b, inst, relogio: 0, fila: [{ anim: "", loop: false, inicio: 0 }] });
      }
    });
    this.cadeias.clear();
    this.sujo = true;
  }

  // a mesma tela noutro tamanho (a janela mudou): so a geometria muda. Os elementos casam pelo nome; os
  // criados pelo jogo e o estado que o jogo pos nos nos (escondido, cor, movimento) ficam.
  aplicarLayout(d: DadosTela) {
    const chave = (e: ElementoTela, k: number) => `${e.tipo}|${e.nome}|${k}`;
    const contar = (lista: ElementoTela[]) => {
      const c = new Map<string, number>();
      return lista.map((e) => {
        const k = c.get(e.tipo + e.nome) ?? 0;
        c.set(e.tipo + e.nome, k + 1);
        return chave(e, k);
      });
    };
    const meus = new Map(contar(this.elementos).map((k, i) => [k, this.elementos[i]]));
    const deles = contar(d.elementos);
    const porIndice = new Map<number, ElementoTela>();
    d.elementos.forEach((novo, i) => {
      const e = meus.get(deles[i]) as Record<string, any> | undefined;
      if (!e) return;
      porIndice.set(i, e as ElementoTela);
      const n = novo as Record<string, any>;
      for (const c of ["xf", "ret", "dst", "src", "tamanho", "contorno"]) if (c in n) e[c] = n[c];
      this.pedacos.delete(e as ElementoTela);
    });
    for (const [nome, n] of Object.entries(d.nos ?? {})) {
      const meu = (this.nos[nome] ??= {});
      meu.xf = n.xf;
      meu.tam = n.tam;
      meu.anc = n.anc;
      meu.z = n.z;
    }
    // as copias: a geometria do molde na janela nova (o estado que o jogo pos nelas fica)
    for (const [novo, molde] of this.copias) {
      const sob = (n: string) => n === novo || n.startsWith(novo + "/");
      const doMolde = (n: string) => molde + n.slice(novo.length);
      const vistos = new Map<string, number>();
      for (const e of this.elementos) {
        if (!sob(e.nome)) continue;
        const k = vistos.get(e.tipo + e.nome) ?? 0;
        vistos.set(e.tipo + e.nome, k + 1);
        const m = this.elementos.filter((x) => x.tipo === e.tipo && x.nome === doMolde(e.nome))[k] as Record<string, any> | undefined;
        if (!m) continue;
        for (const c of ["xf", "ret", "dst", "src", "tamanho", "contorno"]) if (c in m) (e as Record<string, any>)[c] = structuredClone(m[c]);
        this.pedacos.delete(e);
      }
      for (const [n, v] of Object.entries(this.nos)) {
        if (!sob(n)) continue;
        const m = this.nos[doMolde(n)];
        if (m) (v.xf = m.xf), (v.tam = m.tam), (v.anc = m.anc), (v.z = m.z);
      }
    }
    this.dados.tamanho = d.tamanho;
    // os estados da nova janela (o jogo reaplica o t de cada um)
    this.dados.estados = d.estados;
    this.estadosEl.clear();
    for (const [nome, est] of Object.entries(d.estados ?? {}))
      this.estadosEl.set(nome, new Map(Object.entries(est.elementos).flatMap(([i, m]) => (porIndice.has(Number(i)) ? [[porIndice.get(Number(i))!, m] as const] : []))));
    this.baseE.clear();
    this.baseN.clear();
    this.baseT.clear();
    this.uE.clear();
    this.uN.clear();
    this.sujo = true;
  }

  // um elemento novo, criado pelo codigo (por cima de tudo, como z alto)
  // (apos: entra logo depois do que esta embaixo desse no, na ordem de desenho)
  adicionar(e: ElementoTela, apos?: string) {
    let i = -1;
    if (apos) this.elementos.forEach((x, k) => (x.nome === apos || x.nome.startsWith(apos + "/")) && (i = k));
    // sem z proprio, o do vizinho (ou o mais alto, no fim): senao a reordenacao por z o manda para o fundo
    if (e.z === undefined) e.z = i >= 0 ? this.elementos[i].z : Math.max(0, ...this.elementos.map((x) => x.z ?? 0));
    if (i >= 0) this.elementos.splice(i + 1, 0, e);
    else this.elementos.push(e);
    if (!this.porNome.has(e.nome)) this.porNome.set(e.tipo === "toque" ? "toque:" + e.nome : e.nome, e);
    this.sujo = true;
    return e;
  }
  // um ponto do canvas (pixels) em unidades da tela, as mesmas do xf dos elementos
  paraTela(x: number, y: number): [number, number] {
    return [(x - this.origem[0]) / this.escala, (y - this.origem[1]) / this.escala];
  }

  // ---- mexer num no inteiro, como o codigo do Godot mexe num Control: os filhos seguem
  no(nome: string): No | undefined {
    return this.nos[nome];
  }
  // posicao (canto, no espaco do pai), escala e pivo, como position/scale/pivot_offset do Control
  colocar(nome: string, pos: [number, number], escala: [number, number] = [1, 1], pivo: [number, number] = [0, 0]) {
    const n = this.nos[nome];
    if (!n?.xf) return;
    const i = nome.lastIndexOf("/");
    const pai = (i > 0 && this.nos[nome.slice(0, i)]?.xf) || ([1, 0, 0, 1, 0, 0] as Xf);
    const local: Xf = [escala[0], 0, 0, escala[1], pos[0] + pivo[0] - escala[0] * pivo[0], pos[1] + pivo[1] - escala[1] * pivo[1]];
    // a diferenca para o layout: aplicada a tudo o que esta embaixo
    n.mover = mult(mult(pai, local), inversa(n.xf));
    this.sujo = true;
  }
  // ---- layouts: entre o da captura (t = 0) e outro estado (t = 1), cada numero em linha reta. porNo da
  // um t proprio a um no e ao que esta embaixo dele (o mais de dentro manda). Visibilidade e cor dos
  // estados ficam com o codigo do jogo.
  private estadosEl = new Map<string, Map<ElementoTela, Partial<Record<"xf" | "ret" | "dst" | "src", number[]>>>>();
  // o layout da captura (o de antes de qualquer estado) e o quanto cada estado esta aplicado; os estados
  // somam as diferencas (um painel aberto durante outro modo de jogo)
  private baseE = new Map<ElementoTela, Record<string, number[]>>();
  private baseN = new Map<string, Xf>();
  private baseT = new Map<string, number[]>();
  private uE = new Map<string, Map<ElementoTela, number>>();
  private uN = new Map<string, Map<string, number>>();
  estado(nome: string, t: number, porNo: Record<string, number> = {}) {
    const est = this.dados.estados?.[nome];
    const els = this.estadosEl.get(nome);
    if (!est || !els) return;
    const tDe = (n: string) => {
      let p = n;
      for (;;) {
        if (p in porNo) return porNo[p];
        const i = p.lastIndexOf("/");
        if (i < 0) return t;
        p = p.slice(0, i);
      }
    };
    const uE = this.uE.get(nome) ?? new Map();
    const uN = this.uN.get(nome) ?? new Map();
    this.uE.set(nome, uE);
    this.uN.set(nome, uN);
    for (const el of els.keys()) {
      if (!this.baseE.has(el)) {
        const e = el as Record<string, any>;
        this.baseE.set(el, Object.fromEntries(["xf", "ret", "dst", "src"].filter((k) => e[k]).map((k) => [k, [...e[k]]])));
      }
      uE.set(el, tDe(el.nome));
    }
    for (const n of Object.keys(est.nos)) {
      if (!this.nos[n]?.xf) continue;
      if (!this.baseN.has(n)) this.baseN.set(n, [...this.nos[n].xf!] as Xf);
      uN.set(n, tDe(n));
    }
    // recompoe o que este estado toca, com todos os estados
    for (const el of els.keys()) {
      const e = el as Record<string, any>;
      const b = this.baseE.get(el)!;
      for (const k of ["xf", "dst", "src"]) {
        if (!b[k]) continue;
        const v = [...b[k]];
        let mexeu = false;
        for (const [outro, mapa] of this.estadosEl) {
          const m = mapa.get(el)?.[k as "xf"];
          const u = this.uE.get(outro)?.get(el);
          if (!m || !u) continue;
          for (let i = 0; i < v.length; i++) v[i] += (m[i] - b[k][i]) * u;
          mexeu = true;
        }
        if (!mexeu && JSON.stringify(e[k]) === JSON.stringify(b[k])) continue;
        if (k !== "xf" && JSON.stringify(v) !== JSON.stringify(e[k])) this.pedacos.delete(el);
        e[k] = v;
      }
      // tamanho de texto e caixa: troca inteiro na metade (a letra nao se refaz a cada quadro)
      if (b.ret) {
        let r = b.ret;
        for (const [outro, mapa] of this.estadosEl) {
          const m = mapa.get(el)?.ret;
          if (m && (this.uE.get(outro)?.get(el) ?? 0) >= 0.5) r = m;
        }
        if (JSON.stringify(r) !== JSON.stringify(e.ret)) (e.ret = [...r]), this.pedacos.delete(el);
      }
    }
    for (const n of Object.keys(est.nos)) {
      const b = this.baseN.get(n);
      if (!b) continue;
      const v = [...b] as Xf;
      for (const [outro, u] of this.uN) {
        const m = this.dados.estados?.[outro]?.nos[n]?.xf;
        const k = u.get(n);
        if (m && k) for (let i = 0; i < 6; i++) v[i] += (m[i] - b[i]) * k;
      }
      this.nos[n].xf = v;
      // o tamanho do no tambem (o codigo arruma filhos por ele)
      const bt = this.baseT.get(n) ?? this.nos[n].tam;
      if (bt && !this.baseT.has(n)) this.baseT.set(n, [...bt]);
      if (bt) {
        const tv = [...bt];
        for (const [outro, u] of this.uN) {
          const m = this.dados.estados?.[outro]?.nos[n]?.tam;
          const k = u.get(n);
          if (m && k) for (let i = 0; i < tv.length; i++) tv[i] += (m[i] - bt[i]) * k;
        }
        this.nos[n].tam = tv;
      }
    }
    this.sujo = true;
  }
  // recorta o que esta embaixo de um no a um retangulo da tela (clip_contents); null tira
  recortar(nome: string, ret: number[] | null) {
    (this.nos[nome] ??= {}).recorte = ret ?? undefined;
    this.sujo = true;
  }
  // transforma um no (e o que esta embaixo) na tela, alem do layout: xf global aplicado sobre o
  // layout da captura (null tira)
  transformar(nome: string, xf: Xf | null) {
    const n = this.nos[nome];
    if (!n) return;
    n.mover = xf ?? undefined;
    this.sujo = true;
  }
  // desloca um no (e o que esta embaixo) na tela, alem do layout
  deslocar(nome: string, dx: number, dy: number) {
    const n = this.nos[nome];
    if (!n) return;
    n.mover = dx || dy ? [1, 0, 0, 1, dx, dy] : undefined;
    this.sujo = true;
  }

  // a posicao do no no layout, no espaco do pai
  posicaoOriginal(nome: string): [number, number] {
    const n = this.nos[nome];
    const i = nome.lastIndexOf("/");
    const pai = this.nos[nome.slice(0, i)]?.xf;
    if (!n?.xf) return [0, 0];
    const l = pai ? mult(inversa(pai), n.xf) : n.xf;
    return [l[4], l[5]];
  }
  // z_index do no (relativo ao pai, como no Godot)
  z(nome: string, z: number) {
    const n = this.nos[nome];
    if (!n) return;
    const i = nome.lastIndexOf("/");
    n.zNovo = (this.nos[nome.slice(0, i)]?.z ?? 0) + z;
    this.sujo = true;
  }

  // a cor final de cada elemento (o produto das cores dos nos de cima e a propria; null se escondido),
  // a transformacao com os nos movidos e a ordem de desenho
  private recalcular() {
    this.efeito.clear();
    this.moverDe.clear();
    this.recorteDe.clear();
    const z = new Map<ElementoTela, number>();
    let mudouZ = false;
    for (const e of this.elementos) {
      let c = rgba(e.cor);
      let vis = e.visivel !== false;
      let mov: Xf | null = null;
      let dz = 0;
      let cadeia = this.cadeias.get(e);
      if (!cadeia) {
        cadeia = [];
        let p = "";
        for (const parte of e.nome.split("/")) cadeia.push((p = p ? p + "/" + parte : parte));
        this.cadeias.set(e, cadeia);
      }
      // de dentro para fora: cada no movido leva o que ja foi composto
      for (let k = cadeia.length - 1; k >= 0; k--) {
        const n = this.nos[cadeia[k]];
        if (!n) continue;
        if (n.oculto) {
          vis = false;
          break;
        }
        if (n.cor) {
          const m = typeof n.cor === "string" ? rgba(n.cor) : n.cor;
          c = [c[0] * m[0], c[1] * m[1], c[2] * m[2], c[3] * m[3]];
        }
        if (n.mover) mov = mov ? mult(n.mover, mov) : n.mover;
        if (!this.recorteDe.has(e)) {
          if (n.recorte) this.recorteDe.set(e, n.recorte);
          // clip_contents do Godot: o retangulo do no como ele esta agora (os estados mudam xf e tamanho)
          else if (n.corta && n.xf && n.tam) this.recorteDe.set(e, [n.xf[4], n.xf[5], n.tam[0] * n.xf[0], n.tam[1] * n.xf[3]]);
        }
        if (n.zNovo !== undefined && n.z !== undefined) dz += n.zNovo - n.z;
      }
      this.efeito.set(e, vis && c[3] > 0 ? c : null);
      if (mov) this.moverDe.set(e, mov);
      z.set(e, (e.z ?? 0) + dz);
      if (dz) mudouZ = true;
    }
    const base = new Map(this.elementos.map((e, i) => [e, i]));
    this.ordem = mudouZ ? [...this.elementos].sort((a, b) => z.get(a)! - z.get(b)! || base.get(a)! - base.get(b)!) : this.elementos;
    this.sujo = false;
  }
  private final(e: ElementoTela): Xf {
    const m = this.moverDe.get(e);
    return m ? mult(m, e.xf) : e.xf;
  }
  // a transformacao final de um elemento (com os nos movidos)
  xfDe(e: ElementoTela): Xf {
    if (this.sujo) this.recalcular();
    return this.final(e);
  }
  avancar(dt: number) {
    for (const [e, b] of this.bonecos)
      if (this.efeito.get(e) !== null || this.sujo) {
        this.N._mm_passo(b.inst, dt * b.vel);
        b.relogio += dt * b.vel;
      }
  }
  // o nome da area de toque mais de cima no ponto (pixels da tela)
  tocado(x: number, y: number): string | null {
    if (this.sujo) this.recalcular();
    const lx = (x - this.origem[0]) / this.escala,
      ly = (y - this.origem[1]) / this.escala;
    for (let i = this.ordem.length - 1; i >= 0; i--) {
      const e = this.ordem[i];
      if (e.tipo !== "toque" || !this.efeito.get(e)) continue;
      const [a, b, c, d, ex, fy] = this.final(e);
      const det = a * d - b * c;
      const px = (d * (lx - ex) - c * (ly - fy)) / det,
        py = (-b * (lx - ex) + a * (ly - fy)) / det;
      if (px >= e.ret[0] && py >= e.ret[1] && px < e.ret[0] + e.ret[2] && py < e.ret[1] + e.ret[3]) return e.nome;
    }
    return null;
  }
  textoDe(e: Extract<ElementoTela, { tipo: "texto" }>) {
    return (e.chave && this.traducoes[this.idioma]?.[e.chave]) || e.texto;
  }
  set lingua(i: string) {
    this.idioma = i;
    this.pedacos.clear();
    // a escrita nova chega e o texto se refaz com ela
    const faltam = Object.keys(this.dados.fontes).filter((n) => this.fonteServe(n) && !this.fontesProntas.has(n));
    if (faltam.length) Promise.all(faltam.map((n) => this.carregarFonte(n))).then(() => this.pedacos.clear());
  }

  // ---- desenho: a tela inteira cabendo em w x h pixels, no meio
  desenhar(w: number, h: number) {
    const { gl } = this;
    const [dw, dh] = this.dados.tamanho;
    const s = Math.min(w / dw, h / dh);
    this.escala = s;
    this.origem = [(w - dw * s) / 2, (h - dh * s) / 2];
    const tela: Xf = [s, 0, 0, s, this.origem[0], this.origem[1]];
    this.comecar(w, h);
    if (this.sujo) this.recalcular();
    let recorte: number[] | undefined;
    for (const e of this.ordem) {
      if (e.tipo === "toque") continue;
      const cor = this.efeito.get(e);
      if (!cor) continue;
      const r = this.recorteDe.get(e);
      if (r !== recorte) {
        this.descarregar();
        recorte = r;
        if (r) {
          gl.enable(gl.SCISSOR_TEST);
          const x0 = Math.round(this.origem[0] + r[0] * s), y0 = Math.round(this.origem[1] + r[1] * s);
          const x1 = Math.round(this.origem[0] + (r[0] + r[2]) * s), y1 = Math.round(this.origem[1] + (r[1] + r[3]) * s);
          gl.scissor(x0, h - y1, x1 - x0, y1 - y0);
        } else gl.disable(gl.SCISSOR_TEST);
      }
      const xf = mult(tela, this.final(e));
      if (e.tipo === "imagem") {
        const t = this.texturas.get(e.img);
        if (!t) continue;
        let [x, y, ww, hh] = e.dst;
        let [u0, v0, su, sv] = e.src;
        let u1 = (u0 + su) / t.w,
          v1 = (v0 + sv) / t.h;
        u0 /= t.w;
        v0 /= t.h;
        if (e.repetir) (u0 = 0), (v0 = 0), (u1 = ww / t.w), (v1 = hh / t.h);
        if (e.espelho?.[0]) [u0, u1] = [u1, u0];
        if (e.espelho?.[1]) [v0, v1] = [v1, v0];
        this.quad(t.tex, xf, x, y, ww, hh, u0, v0, u1, v1, cor);
      } else if (e.tipo === "texto" || e.tipo === "caixa") {
        const k = Math.hypot(xf[0], xf[1]);
        let p = this.pedacos.get(e);
        // escala mudando (animacao): usa o que ja esta no atlas; parou noutra escala, refaz nitido
        const antes = this.kVisto.get(e);
        this.kVisto.set(e, k);
        // e crescendo muito alem da imagem (preso num osso que nunca para), refaz a cada 15%
        if (!p || (Math.abs(p.pedido - k) > 1e-3 && antes !== undefined && Math.abs(antes - k) < 1e-4) || k > p.pedido * 1.15) p = this.montar(e, k);
        if (!p) continue;
        const f = p.folga;
        // o tamanho em unidades locais e o da escala em que a imagem foi feita (p.k): com a escala
        // mudando, a imagem antiga estica no mesmo lugar, sem escorregar para o canto
        this.quad(this.atlas, xf, e.ret[0] - f, e.ret[1] - f, p.w / p.k, p.h / p.k, p.x / ATLAS, p.y / ATLAS, (p.x + p.w) / ATLAS, (p.y + p.h) / ATLAS, cor);
      } else if (e.tipo === "boneco") {
        const b = this.bonecos.get(e);
        if (!b) continue;
        this.descarregar();
        gl.bindVertexArray(null);
        // o boneco tem y para cima; na tela, para baixo
        const m = mult(xf, [1, 0, 0, -1, 0, 0]);
        this.N._mm_limpar_desenho();
        this.N._mm_desenhar(b.inst);
        this.desenhista.desenhar(this.N, b.paginas, [2 * m[0] / w, -2 * m[1] / h, 0, 0, 2 * m[2] / w, -2 * m[3] / h, 0, 0, 0, 0, 1, 0, (2 * m[4]) / w - 1, 1 - (2 * m[5]) / h, 0, 1], cor);
        this.comecar(w, h);
      }
    }
    this.descarregar();
    gl.disable(gl.SCISSOR_TEST);
  }

  private comecar(w: number, h: number) {
    const { gl } = this;
    gl.useProgram(this.prog);
    gl.uniform2f(this.uTela, w, h);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    this.texAtual = null;
  }

  private quad(tex: WebGLTexture, m: Xf, x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, c: number[]) {
    if (tex !== this.texAtual) this.descarregar(), (this.texAtual = tex);
    if (this.nv + 6 > this.vert.length / 8) this.descarregar();
    const p = (px: number, py: number, u: number, v: number) => {
      const o = this.nv++ * 8;
      const V = this.vert;
      V[o] = m[0] * px + m[2] * py + m[4];
      V[o + 1] = m[1] * px + m[3] * py + m[5];
      V[o + 2] = u;
      V[o + 3] = v;
      // cor premultiplicada
      V[o + 4] = c[0] * c[3];
      V[o + 5] = c[1] * c[3];
      V[o + 6] = c[2] * c[3];
      V[o + 7] = c[3];
    };
    p(x, y, u0, v0), p(x + w, y, u1, v0), p(x + w, y + h, u1, v1);
    p(x, y, u0, v0), p(x + w, y + h, u1, v1), p(x, y + h, u0, v1);
  }

  private descarregar() {
    if (!this.nv || !this.texAtual) return void (this.nv = 0);
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.texAtual);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.vert.subarray(0, this.nv * 8), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, this.nv);
    this.nv = 0;
  }

  // ---- o atlas: texto e caixa desenhados pelo Canvas 2D na escala da tela
  private montar(e: ElementoTela, k: number): Pedaco | undefined {
    if (e.tipo !== "texto" && e.tipo !== "caixa") return;
    const folga = e.tipo === "texto" ? Math.ceil(Math.max(e.contorno?.[0] ?? 0, e.sombra?.[3] ?? 0) + Math.abs(e.sombra?.[1] ?? 0) + Math.abs(e.sombra?.[2] ?? 0) + e.tamanho * 0.3) : Math.ceil(Math.max(0, ...(e.estilo.expandir ?? [0])) + 2);
    const pedido = k;
    // maior que o atlas (uma faixa de ponta a ponta): feita numa escala menor, o desenho estica
    k = Math.min(k, (ATLAS - 4) / (e.ret[2] + 2 * folga), (ATLAS - 4) / (e.ret[3] + 2 * folga));
    const w = Math.ceil((e.ret[2] + 2 * folga) * k),
      h = Math.ceil((e.ret[3] + 2 * folga) * k);
    if (w + 2 > ATLAS || h + 2 > ATLAS) return;
    // a imagem vai com uma moldura transparente de 1 px: ao subir, ela apaga o que sobrou de pedacos
    // antigos em volta (o atlas recomeca por cima), e o filtro linear na borda nao puxa o vizinho
    const cv = this.rasc;
    cv.width = w + 2;
    cv.height = h + 2;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(k, 0, 0, k, folga * k + 1, folga * k + 1);
    if (e.tipo === "texto") this.escrever(ctx, e);
    else caixa(ctx, e.ret[2], e.ret[3], e.estilo);
    // a prateleira: cabe na linha, senao desce; o atlas cheio recomeca (os outros remontam)
    const s = this.prateleira;
    if (s.x + w + 2 > ATLAS) (s.x = 0), (s.y += s.h), (s.h = 0);
    if (s.y + h + 2 > ATLAS) (s.x = 0), (s.y = 0), (s.h = 0), this.pedacos.clear();
    const p: Pedaco = { x: s.x + 1, y: s.y + 1, w, h, k, folga, chave: "", pedido };
    const [ux, uy] = [s.x, s.y];
    s.x += w + 2;
    s.h = Math.max(s.h, h + 2);
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, ux, uy, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.pedacos.set(e, p);
    return p;
  }

  // como o Label do Godot: linhas de ascendente + descendente, alinhamento inteiro, sombra, contorno
  // e o preenchimento por cima
  private escrever(ctx: CanvasRenderingContext2D, e: Extract<ElementoTela, { tipo: "texto" }>) {
    const txt = this.textoDe(e);
    ctx.font = `${e.tamanho}px ${e.fontes.map((f) => `"${f}"`).join(",")}`;
    // como o Godot: no idioma da direita para a esquerda o paragrafo inteiro e RTL (ate uma linha so
    // de numeros), e o alinhamento fica o declarado
    ctx.direction = IDIOMAS_RTL.test(this.idioma) ? "rtl" : "ltr";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const m0 = ctx.measureText("Hg");
    // o FreeType arredonda as medidas da fonte para fora (ascendente para cima, descendente para baixo)
    const asc = Math.ceil(m0.fontBoundingBoxAscent - 1e-3),
      dsc = Math.ceil(m0.fontBoundingBoxDescent - 1e-3);
    const espaco = 3; // line_spacing do tema padrao
    const [w, h] = [e.ret[2], e.ret[3]];
    let linhas = txt.split("\n");
    if (e.quebra) linhas = linhas.flatMap((l) => quebrar(ctx, l, w));
    const total = linhas.length * (asc + dsc + espaco) - espaco;
    const [ah, av] = e.alinhar ?? [0, 0];
    let y = av === 1 ? Math.trunc((h - total) / 2) : av === 2 ? h - total : 0;
    const [cc, cn] = [e.contorno?.[0] ?? 0, e.contorno?.[1]];
    const sombra = e.sombra && rgba(e.sombra[0])[3] > 0 ? e.sombra : null;
    ctx.lineJoin = "round";
    for (const l of linhas) {
      const lw = ctx.measureText(l).width;
      const x = ah === 1 ? Math.trunc((w - lw) / 2) : ah === 2 ? w - lw : 0;
      const bx = x + this.ajusteTexto[0]; // textAlign "left" e a borda esquerda nas duas direcoes
      const by = y + asc + this.ajusteTexto[1];
      if (sombra) {
        ctx.fillStyle = css(sombra[0]);
        if (sombra[3] > 0) (ctx.strokeStyle = ctx.fillStyle), (ctx.lineWidth = sombra[3] / 2), ctx.strokeText(l, bx + sombra[1], by + sombra[2]);
        ctx.fillText(l, bx + sombra[1], by + sombra[2]);
      }
      if (cc > 0 && rgba(cn)[3] > 0) {
        ctx.strokeStyle = css(cn);
        // o FreeType do Godot passa o contorno com raio de outline_size / 4 (text_server_adv: size.y * 16 em 26.6)
        ctx.lineWidth = cc / 2;
        ctx.strokeText(l, bx, by);
      }
      ctx.fillStyle = css(e.cor_fonte);
      ctx.fillText(l, bx, by);
      y += asc + dsc + espaco;
    }
  }
}

function quebrar(ctx: CanvasRenderingContext2D, l: string, w: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of l.split(" ")) {
    const t = cur ? cur + " " + p : p;
    if (cur && ctx.measureText(t).width > w) out.push(cur), (cur = p);
    else cur = t;
  }
  out.push(cur);
  return out;
}

// StyleBoxFlat: borda por dentro, cantos arredondados, margens de expansao
function caixa(ctx: CanvasRenderingContext2D, w: number, h: number, s: Estilo) {
  if (s.tipo !== "StyleBoxFlat") return;
  const [el, et, er, eb] = s.expandir ?? [0, 0, 0, 0];
  const x = -el,
    y = -et,
    ww = w + el + er,
    hh = h + et + eb;
  const r = (s.cantos ?? [0, 0, 0, 0]).map((v) => Math.min(v, ww / 2, hh / 2));
  const [bl, bt, br, bb] = s.borda ?? [0, 0, 0, 0];
  if (bl || bt || br || bb) {
    ctx.fillStyle = css(s.cor_borda);
    ctx.beginPath();
    ctx.roundRect(x, y, ww, hh, r);
    ctx.fill();
    // o miolo sai inteiro (com a cor da borda translucida sobrava um veu por dentro)
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.roundRect(x + bl, y + bt, ww - bl - br, hh - bt - bb, r.map((v) => Math.max(0, v - Math.max(bl, bt))));
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  if (s.desenhar_centro !== false) {
    ctx.fillStyle = css(s.cor);
    ctx.beginPath();
    ctx.roundRect(x + bl, y + bt, ww - bl - br, hh - bt - bb, r.map((v) => Math.max(0, v - Math.max(bl, bt))));
    ctx.fill();
  }
}
