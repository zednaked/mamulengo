// As letras dos textos de um .boneco (docs/NUCLEO.md "Texto"), desenhadas pelo navegador. O nucleo
// guarda o que cada texto e e onde fica (a caixa no osso), mas nao tem fonte nem montador de texto;
// aqui o Canvas 2D monta as linhas com o shaping do navegador (arabe da direita para a esquerda,
// devanagari com os conjuntos), num atlas so (a pagina dos textos, depois das paginas do boneco), e
// entrega a cada instancia o retangulo e o uv de cada texto (mm_texto_imagem). Dai em diante o
// texto e uma regiao como as outras: cor do slot, ordem de desenho, recorte, efeitos, animacao.
//
//   const textos = await TextosBoneco.criar(desenhista, N, modelo, urlDaPasta);
//   textos.idioma = "ar";                         // tudo troca na hora
//   textos.texto("saldo", "R$ 100,00");           // texto livre pelo nome da parte
//   textos.texto("saldo", { valor: "R$ 100,00" }); // parametros da chave ("Saldo {valor}")
//   a cada quadro, antes do mm_desenhar: textos.preparar(inst, pixelsPorUnidade) (a imagem e a
//   medida de cada texto: a regiao com nove-fatias que acompanha um texto cresce com ele)
//   paginas do desenhista: [...paginasDoBoneco, textos.pagina]
import type { Desenhista, PaginaGL } from "../render/desenhista.ts";
import { RTL, diagramar, textoNoIdioma, type Diagrama, type Medidor, type Traducoes } from "../core/texto.ts";

const ATLAS = 2048;
const ALINHAR = ["left", "center", "right"] as const;
const ALINHAR_V = ["top", "middle", "bottom"] as const;
const ESTOURO = ["shrink", "wrap", "clip", "none"] as const;

// um texto como o nucleo o le (mm_textos)
export type DadosTexto = {
  nome: string;
  parte: number;
  slot: number;
  texto: string;
  chave: string;
  familia: string;
  tamanho: number;
  minimo: number;
  cor: string;
  alinhar: number;
  alinhar_v: number;
  estouro: number;
  largura: number;
  altura: number;
  linha: number;
  cor_linha: string;
  sombra: [string, number, number] | null;
};
type InfoTextos = { fontes: { nome: string; arquivo: string }[]; idiomas: string[]; traducoes: Record<string, string[]>; textos: DadosTexto[] };

// a parte no formato da diagramacao (o mesmo do JSON do editor)
export const caixaDe = (t: DadosTexto) => ({
  width: t.largura,
  height: t.altura,
  size: t.tamanho,
  minSize: t.minimo,
  align: ALINHAR[t.alinhar],
  valign: ALINHAR_V[t.alinhar_v],
  overflow: ESTOURO[t.estouro],
});

const css = (h: string) => {
  const n = (k: number) => parseInt(h.slice(k, k + 2), 16);
  return `rgba(${n(0)},${n(2)},${n(4)},${h.length >= 8 ? n(6) / 255 : 1})`;
};

// as fontes do projeto no navegador, por arquivo (uma vez por pagina, divididas entre bonecos)
const fontesCarregadas = new Map<string, Promise<string | null>>();
let nFontes = 0;
export function carregarFonte(url: string): Promise<string | null> {
  let p = fontesCarregadas.get(url);
  if (!p) {
    const familia = `mm-fonte-${nFontes++}`;
    p = new FontFace(familia, `url(${JSON.stringify(url)})`)
      .load()
      .then((f) => (document.fonts.add(f), familia))
      .catch((e) => (console.warn(`fonte ${url}: ${e?.message ?? e}`), null));
    fontesCarregadas.set(url, p);
  }
  return p;
}

// o medidor pelo Canvas 2D (o shaping do navegador), com a pilha de fontes e a direcao do idioma
export function medidorCanvas(ctx: CanvasRenderingContext2D, pilha: string, rtl: boolean): Medidor {
  ctx.direction = rtl ? "rtl" : "ltr";
  let atual = -1;
  const fonte = (px: number) => {
    if (px !== atual) (ctx.font = `${px}px ${pilha}`), (atual = px);
  };
  return {
    largura(t, px) {
      fonte(px);
      return ctx.measureText(t).width;
    },
    metricas(px) {
      fonte(px);
      const m = ctx.measureText("Hg");
      return { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent };
    },
  };
}

type Feito = { assinatura: string; ret: [number, number, number, number]; uv: [number, number, number, number]; diagrama: Diagrama };

export class TextosBoneco {
  readonly pagina: PaginaGL;
  textos: DadosTexto[] = [];
  traducoes: Traducoes = { languages: [], strings: {} };
  private _idioma = "";
  private familias = new Map<string, string>(); // nome da fonte no projeto -> familia no navegador
  private valores = new Map<string, { texto?: string; params?: Record<string, string | number> }>();
  private feitos: (Feito | null)[] = [];
  private aplicado = new Map<number, string[]>(); // instancia -> assinatura entregue por texto
  private prateleira = { x: 0, y: 0, h: 0 };
  private rasc = document.createElement("canvas");
  private ctx = this.rasc.getContext("2d", { willReadFrequently: false })!;
  private slotOsso: number[] = [];
  private slotNome: string[] = [];
  // mudou algo fora (fonte carregada): refaz tudo no proximo preparar
  versao = 0;

  private constructor(
    private desenhista: Desenhista,
    private N: any,
  ) {
    const gl = desenhista.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ATLAS, ATLAS);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.pagina = { tex, pma: true, relevo: null };
  }

  // sem ler ainda (o editor le a cada recarga do modelo: ler())
  static novo(desenhista: Desenhista, N: any): TextosBoneco {
    return new TextosBoneco(desenhista, N);
  }
  // os textos do modelo (mm_textos) e as fontes, pela pasta do .boneco (url com / no fim)
  static async criar(desenhista: Desenhista, N: any, modelo: number, base: string, urlFonte?: (arquivo: string) => string): Promise<TextosBoneco> {
    const t = new TextosBoneco(desenhista, N);
    await t.ler(modelo, base, urlFonte);
    return t;
  }

  // o modelo foi trocado (o editor rele a cada edicao): os textos novos, as fontes que faltam; o
  // que ja estava no atlas e reaproveitado (a assinatura diz se mudou)
  async ler(modelo: number, base: string, urlFonte?: (arquivo: string) => string) {
    const N = this.N;
    const info = JSON.parse(N.UTF8ToString(N._mm_textos(modelo))) as InfoTextos;
    const minfo = JSON.parse(N.UTF8ToString(N._mm_info(modelo)));
    this.slotOsso = minfo.slots.map((s: { osso: number }) => s.osso);
    this.slotNome = minfo.slots.map((s: { nome: string }) => s.nome);
    this.textos = info.textos;
    this.feitos.length = this.textos.length;
    this.aplicado.clear();
    if (info.idiomas.length || !this.traducoes.languages.length) this.traducoes = { languages: info.idiomas, strings: info.traducoes };
    if (!this._idioma) this._idioma = info.idiomas[0] ?? "pt";
    const url = urlFonte ?? ((a: string) => new URL(a, base).href);
    const esperar: Promise<unknown>[] = [];
    const novas = new Map<string, string>();
    for (const f of info.fontes) {
      const pronta = carregarFonte(url(f.arquivo)).then((fam) => {
        if (fam) novas.set(f.nome, fam);
      });
      esperar.push(pronta);
    }
    await Promise.all(esperar);
    const familias = new Map(info.fontes.filter((f) => novas.has(f.nome)).map((f) => [f.nome, novas.get(f.nome)!]));
    // so as fontes mudando refazem tudo (o resto, a assinatura de cada texto diz)
    if (JSON.stringify([...familias]) !== JSON.stringify([...this.familias])) {
      this.familias = familias;
      this.versao++;
    }
  }

  get idioma() {
    return this._idioma;
  }
  set idioma(i: string) {
    this._idioma = i;
  }
  // o texto de uma parte (pelo nome da parte ou do slot): texto livre, ou os parametros da chave
  texto(nome: string, valor: string | Record<string, string | number> | null) {
    const t = this.achar(nome);
    if (!t) throw new Error(`texto desconhecido: ${nome}`);
    if (valor === null) this.valores.delete(t.nome);
    else if (typeof valor === "string") this.valores.set(t.nome, { texto: valor });
    else this.valores.set(t.nome, { params: { ...(this.valores.get(t.nome)?.params ?? {}), ...valor } });
  }
  mostradoPorNome(nome: string): string {
    const t = this.achar(nome);
    if (!t) throw new Error(`texto desconhecido: ${nome}`);
    return this.mostrado(t);
  }
  private achar(nome: string): DadosTexto | undefined {
    return this.textos.find((t) => t.nome === nome) ?? this.textos.find((t) => this.slotNome[t.slot] === nome);
  }
  // o texto que a parte mostra agora (com o idioma, a chave e o que o codigo pos)
  mostrado(t: DadosTexto, idioma = this._idioma): string {
    const v = this.valores.get(t.nome);
    if (v?.texto !== undefined) return v.texto;
    return textoNoIdioma({ string: t.texto, key: t.chave || undefined }, this.traducoes, idioma, v?.params);
  }

  // a pilha de fontes: a da parte, depois as outras do projeto (o arabe e o devanagari caem na
  // fonte que tem as letras) e a do sistema
  pilha(t: DadosTexto): string {
    const nomes = [t.familia, ...[...this.familias.keys()].filter((n) => n !== t.familia)];
    const fams = nomes.map((n) => this.familias.get(n)).filter((f): f is string => !!f);
    return [...fams.map((f) => JSON.stringify(f)), "sans-serif"].join(",");
  }

  // a diagramacao de um texto num idioma (para o aviso de estouro do editor)
  diagramar(t: DadosTexto, idioma = this._idioma): Diagrama {
    const m = medidorCanvas(this.ctx, this.pilha(t), RTL.test(idioma));
    return diagramar(this.mostrado(t, idioma), caixaDe(t), m);
  }

  // os que estouram a caixa, por idioma (todos os da tabela, ou os pedidos)
  estouros(idiomas = this.traducoes.languages.length ? this.traducoes.languages : [this._idioma]) {
    const out: { nome: string; idioma: string; texto: string; px: number; quanto: [number, number] }[] = [];
    for (const t of this.textos)
      for (const i of idiomas) {
        const d = this.diagramar(t, i);
        if (d.estoura) out.push({ nome: t.nome, idioma: i, texto: this.mostrado(t, i), px: d.px, quanto: d.quanto.map((v) => Math.round(v * 10) / 10) as [number, number] });
      }
    return out;
  }

  // antes do desenho: a imagem de cada texto na escala em que ele aparece (pixels da tela por
  // unidade do mundo, vezes a escala do osso) e o lugar dela entregue a instancia
  preparar(inst: number, pxPorUnidade: number) {
    const N = this.N;
    if (!this.textos.length) return;
    const q = N._mm_pose_ossos(inst) / 8;
    const H = N.HEAPF64;
    let entregues = this.aplicado.get(inst);
    if (!entregues) this.aplicado.set(inst, (entregues = []));
    let pagina = false;
    this.textos.forEach((t, k) => {
      const o = q + (this.slotOsso[t.slot] ?? 0) * 14;
      const esc = Math.sqrt(Math.abs(H[o] * H[o + 3] - H[o + 1] * H[o + 2]));
      // a escala em degraus de 2^(1/4): animando a escala, refaz no maximo a cada 19%
      const kk = Math.max(0.05, pxPorUnidade * (esc || 1));
      const k4 = Math.pow(2, Math.ceil(Math.log2(kk) * 4) / 4);
      const txt = this.mostrado(t);
      const ass = `${this.versao}|${this._idioma}|${k4}|${txt}|${JSON.stringify(t)}`;
      let f = this.feitos[k];
      if (!f || f.assinatura !== ass) {
        f = this.rasterizar(t, txt, k4, ass);
        this.feitos[k] = f;
        if (!f) return;
      }
      if (entregues![k] !== f.assinatura + f.uv.join()) {
        entregues![k] = f.assinatura + f.uv.join();
        N._mm_texto_imagem(inst, k, ...f.ret, ...f.uv);
        // quanto o texto ocupa: a regiao com nove-fatias que acompanha o slot dele cresce junto
        // (docs/NUCLEO.md "Nove-fatias")
        N._mm_texto_medida?.(inst, k, f.diagrama.usado[2], f.diagrama.usado[3]);
        pagina = true;
      }
    });
    if (pagina) N._mm_pagina_textos(inst, ATLAS, ATLAS);
  }
  // uma instancia nova (ou liberada): entrega tudo de novo no proximo preparar
  esquecer(inst: number) {
    this.aplicado.delete(inst);
  }

  private rasterizar(t: DadosTexto, txt: string, k: number, assinatura: string): Feito | null {
    const ctx = this.ctx;
    const rtl = RTL.test(this._idioma);
    const pilha = this.pilha(t);
    const d = diagramar(txt, caixaDe(t), medidorCanvas(ctx, pilha, rtl));
    const W = t.largura,
      Hh = t.altura;
    const cortar = t.estouro === 2;
    // o retangulo da imagem (da caixa: x, y para baixo): a caixa e o que o texto ocupa, com folga
    // para o contorno e a sombra
    const folga = t.linha + 2 + (t.sombra ? Math.max(Math.abs(t.sombra[1]), Math.abs(t.sombra[2])) : 0);
    let [x0, y0, x1, y1] = [0, 0, W, Hh];
    if (!cortar) {
      x0 = Math.min(x0, d.usado[0] - folga);
      y0 = Math.min(y0, d.usado[1] - d.px * 0.25 - folga);
      x1 = Math.max(x1, d.usado[0] + d.usado[2] + folga);
      y1 = Math.max(y1, d.usado[1] + d.usado[3] + d.px * 0.25 + folga);
    }
    // nao passa do atlas: a escala cai (a imagem estica)
    k = Math.min(k, (ATLAS - 4) / (x1 - x0), (ATLAS - 4) / (y1 - y0));
    const w = Math.ceil((x1 - x0) * k),
      h = Math.ceil((y1 - y0) * k);
    if (w < 1 || h < 1) return null;
    const cv = this.rasc;
    cv.width = w + 2;
    cv.height = h + 2;
    ctx.setTransform(k, 0, 0, k, 1 - x0 * k, 1 - y0 * k);
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${d.px}px ${pilha}`;
    ctx.lineJoin = "round";
    if (cortar) {
      ctx.beginPath();
      ctx.rect(0, 0, W, Hh);
      ctx.clip();
    }
    for (const l of d.linhas) {
      if (t.sombra) {
        const [c, sx, sy] = t.sombra;
        if (t.linha > 0) (ctx.strokeStyle = css(c)), (ctx.lineWidth = t.linha * 2), ctx.strokeText(l.texto, l.x + sx, l.y + sy);
        ctx.fillStyle = css(c);
        ctx.fillText(l.texto, l.x + sx, l.y + sy);
      }
      if (t.linha > 0) {
        ctx.strokeStyle = css(t.cor_linha);
        ctx.lineWidth = t.linha * 2;
        ctx.strokeText(l.texto, l.x, l.y);
      }
      ctx.fillStyle = css(t.cor);
      ctx.fillText(l.texto, l.x, l.y);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // a prateleira: cabe na linha, senao desce; o atlas cheio recomeca (os outros se refazem)
    const s = this.prateleira;
    if (s.x + w + 2 > ATLAS) (s.x = 0), (s.y += s.h), (s.h = 0);
    if (s.y + h + 2 > ATLAS) {
      (s.x = 0), (s.y = 0), (s.h = 0);
      this.feitos.fill(null);
    }
    const [ux, uy] = [s.x, s.y];
    s.x += w + 2;
    s.h = Math.max(s.h, h + 2);
    const gl = this.desenhista.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.pagina.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, ux, uy, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // o retangulo pedido (sem a moldura de 1 px) em unidades: os pixels arredondados para cima
    const rw = w / k,
      rh = h / k;
    return {
      assinatura,
      diagrama: d,
      // na caixa do nucleo: o meio na origem, y para cima (esquerda, baixo, direita, cima)
      ret: [x0 - W / 2, Hh / 2 - (y0 + rh), x0 + rw - W / 2, Hh / 2 - y0],
      uv: [(ux + 1) / ATLAS, (uy + 1) / ATLAS, (ux + 1 + w) / ATLAS, (uy + 1 + h) / ATLAS],
    };
  }

  liberar() {
    this.desenhista.gl.deleteTexture(this.pagina.tex);
  }
}
