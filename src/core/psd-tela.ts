// O PSD chegando como tela (docs/LAYOUT-PSD.md): le a estrutura do PSD (grupos, camadas, textos e
// pixels) e propoe, cada item com o porque, a arte base, as ancoras de cada elemento, os papeis
// (botoes com os estados pelas camadas, toques, textos do codigo), as partes de texto (texto, fonte,
// tamanho, cor, alinhamento) e as nove-fatias. A proposta vira duas coisas:
//   1. o mapa da importacao comum (src/core/psd-ler.ts): as tags que fazem cada grupo um osso, juntam
//      os estados de um botao num slot e tiram as camadas de texto (viram partes de texto);
//   2. os comandos que montam a tela no documento importado (psdLayoutCalls: screen.set, font.add,
//      text.set, anchor.set, slice.set, role.set), que o comando psd.layout executa.
// Nada aqui grava arquivo: quem le o disco e src/core/psd-importar.ts (criarTelaDePsd) e o comando.
//
// Coordenadas: "px" sao pixels do PSD (origem no canto de cima, y para baixo), como em psd.ts.
import { readPsd, type Layer } from "ag-psd";
import type { Call } from "./commands/registry.ts";
import { parseTags, type Rect, type Tag } from "./psd.ts";
import { checkMapa, initCanvas, type PsdMapa } from "./psd-ler.ts";
import { roleFromName, type StateName } from "./papeis.ts";
import { slots } from "./model.ts";
import { apply, boneWorld, invert, skeletonAt } from "./pose.ts";

export type Ancora = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
export type Esticar = "none" | "x" | "y" | "xy";
export type Encaixe = "contain" | "cover" | "width" | "height";
export const ANCORAS: Ancora[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
const ANCORA_XY: Record<Ancora, [number, number]> = { "top-left": [0, 0], top: [0.5, 0], "top-right": [1, 0], left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5], "bottom-left": [0, 1], bottom: [0.5, 1], "bottom-right": [1, 1] };

// O mapa externo da tela (<psd>.tela.json ao lado do PSD; docs/LAYOUT-PSD.md "Mapa externo"): o que o
// PSD do cliente nao diz pelos nomes, sem regravar o arquivo. Os campos da importacao comum (camadas,
// ossos, esconder; docs/RIGAR.md) continuam valendo. Chave de camada: o nome limpo, o nome como esta
// no PSD ou o caminho "grupo/camada".
export interface MapaTela extends PsdMapa {
  arte?: Rect; // a arte base em px do PSD (padrao: o documento inteiro)
  encaixe?: Encaixe;
  nomes?: Record<string, string>; // camada -> o nome na convencao, como se o designer tivesse renomeado ("play": "btn_play")
  ancoras?: Record<string, Ancora | { ancora: Ancora; esticar?: Esticar; cobrir?: boolean } | null>; // null: sem ancora; cobrir: cresce por igual ate cobrir a janela
  // blocos que andam juntos (o palco): um osso novo com a ancora, pai das camadas que casam (as que
  // tem ancora propria no mapa, por nome exato, ficam fora); ponto: onde o osso fica (px do PSD; padrao
  // o ponto da ancora na arte); cobrir: o bloco cresce por igual, em volta do ponto, ate cobrir a janela
  blocos?: Record<string, { ancora: Ancora; camadas: string[]; ponto?: [number, number]; cobrir?: boolean }>;
  fatias?: Record<string, number[] | null>; // camada -> [m] ou [esquerda, cima, direita, baixo]; null: sem
  // camada de texto -> chave (null: texto livre) e a fonte do projeto. Numa camada de IMAGEM (o texto
  // rasterizado), a imagem vira texto: texto (o do arquivo), tamanho, cor, alinhar, caixa (px do PSD;
  // padrao a tinta com folga), contorno e papel (o nome do texto do codigo, como txt_)
  textos?: Record<string, TextoDoMapa>;
  idioma?: string; // o idioma dos textos do PSD na tabela de idiomas (padrao pt)
}

export interface TextoDoMapa {
  chave?: string | null;
  fonte?: string;
  texto?: string;
  tamanho?: number;
  cor?: string;
  alinhar?: "left" | "center" | "right";
  caixa?: Rect;
  contorno?: { largura: number; cor: string };
  papel?: string;
}

// ---- a proposta

interface ItemBase {
  id: string;
  camada: string; // caminho no PSD ("grupo/camada"), para mostrar
  ligado: boolean;
  porque: string;
}
export interface ItemAncora extends ItemBase {
  tipo: "ancora";
  osso: string;
  ancora: Ancora;
  esticar: Esticar;
  rect: Rect;
  cobre?: boolean; // cobrir sem deformar (anchor.set cover)
  bloco?: { ponto: [number, number]; membros: string[] }; // osso novo (ponto em px do PSD), pai dos ossos membros
}
export interface ItemBotao extends ItemBase {
  tipo: "botao";
  nome: string;
  osso: string;
  slot: string | null; // o slot das imagens dos estados (null: o botao sem imagens por estado)
  estados: Partial<Record<StateName, string>>; // estado -> a parte (attachment) no slot
}
export interface ItemToque extends ItemBase {
  tipo: "toque";
  nome: string;
  osso: string;
}
export interface ItemTexto extends ItemBase {
  tipo: "texto";
  slot: string;
  osso: string;
  ossoNovo?: { pai: string; at: [number, number] }; // texto solto no topo: o osso dele (px)
  texto: string;
  chave: string | null; // null: texto livre
  doCodigo: string | null; // o nome do papel de texto do codigo (txt_), ou null
  fonte: string | null; // o nome da fonte no PSD (PostScript)
  arquivoFonte: string | null; // achado entre as fontes conhecidas
  tamanho: number; // px
  cor: string; // rrggbb
  alinhar: "left" | "center" | "right";
  caixa: Rect; // px
  quebra: boolean; // texto de paragrafo (caixa): quebra nas palavras
  abaixo: string | null; // o slot logo abaixo na ordem de desenho
  contorno?: { largura: number; cor: string };
  sombra?: { cor: string; x: number; y: number };
}
export interface ItemFatias extends ItemBase {
  tipo: "fatias";
  slot: string;
  partes: string[]; // as partes do slot (os estados de um botao recebem as mesmas margens)
  margens: [number, number, number, number]; // esquerda, cima, direita, baixo (px da imagem)
  tamanho: [number, number];
  acompanha?: { slot: string; respiro: [number, number] };
  origem: "nome" | "mapa" | "imagem";
}
export type ItemTela = ItemAncora | ItemBotao | ItemToque | ItemTexto | ItemFatias;

export interface PropostaTela {
  arquivo: string;
  tamanho: [number, number]; // o documento (px)
  origem: [number, number]; // px do PSD que vira (0,0) no mundo (camada [origin] ou o meio da borda de baixo)
  arte: { rect: Rect; encaixe: Encaixe; porque: string };
  itens: ItemTela[];
  tags: Record<string, string>; // camada (caminho como esta no PSD) -> tags para a importacao comum
  esconder: string[]; // camadas que entram escondidas (os estados que nao sao o normal)
  idioma: string; // o idioma dos textos do PSD (as chaves novas entram na tabela com ele)
  pareceTela: boolean; // o nome do arquivo ou as camadas dizem que e uma tela (btn_, txt_, 9_...)
  fontes: { nome: string; arquivo: string | null }[]; // as fontes dos textos e o arquivo achado
  avisos: string[];
}

// fontes que quem chama achou no disco (o arquivo e os nomes de dentro dele)
export interface FonteConhecida {
  arquivo: string;
  nomes: string[];
}

// ---- nomes

const ESTADOS: [RegExp, StateName][] = [
  [/^(normal|idle|up|on|padrao|base)$/i, "normal"],
  [/^(em[_ -]?cima|hover|over|foco|focus|sobre)$/i, "hover"],
  [/^(apertado|pressed|press|down|clicado|pressionado)$/i, "pressed"],
  [/^(desligado|disabled|off|inativo|bloqueado|desativado)$/i, "disabled"],
];
export const NOME_DO_ESTADO: Record<StateName, string> = { normal: "normal", hover: "em_cima", pressed: "apertado", disabled: "desligado" };
export function estadoDoNome(n: string): StateName | null {
  for (const [re, s] of ESTADOS) if (re.test(n.trim())) return s;
  return null;
}
// "btn_jogar_apertado" -> base "btn_jogar", estado pressed
function separaEstado(n: string): { base: string; estado: StateName } | null {
  const m = n.match(/^(.+?)[ _\-.]+([a-z]+(?:[_ -]cima)?)$/i);
  if (!m) return null;
  const e = estadoDoNome(m[2]);
  return e ? { base: m[1], estado: e } : null;
}
const FATIA_PREFIXO = /^(9|fatia|slice|9s)[_\-. ](.+)$/i;
const NOME_TELA = /(^|[^a-z])(tela|ui|hud|menu|screen|interface|layout|mockup)([^a-z]|$)/i;

// nome de osso ou slot: minusculas, sem acento, _ no lugar do resto
export function slug(s: string): string {
  const t = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return t || "camada";
}
// chave da tabela de idiomas: maiusculas, sem acento ("Missões" -> MISSOES)
export function chaveDe(s: string): string {
  return slug(s).toUpperCase().slice(0, 40);
}

// nomes de dentro de uma fonte TrueType/OpenType (tabela name: familia, nome completo, PostScript)
export function nomesDaFonte(b: Uint8Array): string[] {
  try {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = v.getUint16(4);
    let off = -1;
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      if (String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) === "name") off = v.getUint32(o + 8);
    }
    if (off < 0) return [];
    const count = v.getUint16(off + 2),
      strs = off + v.getUint16(off + 4);
    const out = new Set<string>();
    for (let i = 0; i < count; i++) {
      const r = off + 6 + i * 12;
      const plat = v.getUint16(r),
        id = v.getUint16(r + 6),
        len = v.getUint16(r + 8),
        o = strs + v.getUint16(r + 10);
      if (![1, 4, 6].includes(id)) continue;
      let s = "";
      if (plat === 3 || plat === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(v.getUint16(o + k));
      else for (let k = 0; k < len; k++) s += String.fromCharCode(b[o + k]);
      if (s.trim()) out.add(s.trim());
    }
    return [...out];
  } catch {
    return [];
  }
}
const normFonte = (s: string) => s.toLowerCase().replace(/\.(ttf|otf|woff2?)$/, "").replace(/[^a-z0-9]/g, "");
function achaFonte(nome: string, conhecidas: FonteConhecida[]): string | null {
  const k = normFonte(nome);
  for (const f of conhecidas) if (f.nomes.some((n) => normFonte(n) === k)) return f.arquivo;
  for (const f of conhecidas) if (normFonte(f.arquivo.slice(f.arquivo.lastIndexOf("/") + 1)) === k) return f.arquivo;
  // "KenneyFuture-Bold" acha "kenney-future.ttf" (o estilo no fim do nome)
  const semEstilo = normFonte(nome.replace(/[-_ ](regular|bold|medium|light|black|italic|semibold|heavy)$/i, ""));
  for (const f of conhecidas) if (f.nomes.some((n) => normFonte(n) === semEstilo) || normFonte(f.arquivo.slice(f.arquivo.lastIndexOf("/") + 1)) === semEstilo) return f.arquivo;
  return null;
}

// ---- a arvore

interface No {
  layer: Layer;
  pai: No | null;
  grupo: boolean;
  bruto: string; // o nome como esta no PSD
  limpo: string; // sem as tags
  tags: Tag[];
  caminho: string; // "grupo/camada" com os nomes como estao no PSD
  efetivo: string; // o nome na convencao (o do mapa.nomes, sem o prefixo 9_)
  renomeado: boolean;
  fatiasNome: number[] | true | null; // 9_x, [9] ou [9:...]
  oculta: boolean; // ela ou uma pasta acima escondida
  rect: Rect | null;
  filhos: No[];
  texto: any | null;
  pixels: { w: number; h: number; d: Uint8ClampedArray; x: number; y: number } | null;
  // decidido pela proposta
  osso?: string; // o osso que este no cria (grupo ou camada com [bone])
  slot?: string; // folha: o slot onde a imagem cai
  parte?: string; // folha: o nome da parte no slot
  extra: string[]; // tags somadas pelo mapa
}

const tagOf = (n: No, k: string) => n.tags.find((t) => t.key === k);
const temTag = (n: No, k: string) => !!tagOf(n, k) || n.extra.some((e) => e.startsWith(`[${k}`));
const union = (rs: Rect[]): Rect | null => {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r[0])),
    y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])),
    y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const hex2 = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, "0");
const corHex = (c: any): string | null => (c && typeof c.r === "number" ? hex2(c.r) + hex2(c.g) + hex2(c.b) : null);

// recorte da transparencia (retangulo da tinta em px do PSD)
function tinta(l: Layer): { rect: Rect; pixels: No["pixels"] } | null {
  const img = l.imageData;
  const x = l.left ?? 0,
    y = l.top ?? 0;
  if (!img || !img.width || !img.height) {
    const w = (l.right ?? 0) - x,
      h = (l.bottom ?? 0) - y;
    return w > 0 && h > 0 ? { rect: [x, y, w, h], pixels: null } : null;
  }
  const d = img.data as Uint8ClampedArray;
  let [x0, y0, x1, y1] = [img.width, img.height, -1, -1];
  for (let yy = 0; yy < img.height; yy++)
    for (let xx = 0; xx < img.width; xx++)
      if (d[(yy * img.width + xx) * 4 + 3] > 0) {
        if (xx < x0) x0 = xx;
        if (xx > x1) x1 = xx;
        if (yy < y0) y0 = yy;
        if (yy > y1) y1 = yy;
      }
  if (x1 < 0) return null;
  return { rect: [x + x0, y + y0, x1 - x0 + 1, y1 - y0 + 1], pixels: { w: img.width, h: img.height, d, x, y } };
}

// ---- nove-fatias pela imagem: a maior faixa de linhas (e de colunas) iguais no meio da imagem e o
// miolo que estica; o que sobra de cada lado sao as margens (cantos arredondados, bordas iguais)
export function margensPelaImagem(px: { w: number; h: number; d: Uint8ClampedArray }, rect: Rect, ox: number, oy: number): [number, number, number, number] | null {
  const [rx, ry, w, h] = rect;
  if (w < 16 || h < 16) return null;
  const at = (x: number, y: number) => ((y + ry - oy) * px.w + (x + rx - ox)) * 4;
  const igual = (a: number, b: number) => {
    for (let c = 0; c < 4; c++) if (Math.abs(px.d[a + c] - px.d[b + c]) > 3) return false;
    return true;
  };
  // a maior sequencia de linhas (ou colunas) iguais a primeira dela (comparar com a primeira, e nao
  // com a vizinha, nao deixa um degrade suave passar por igual); ela tem de passar pelo meio da imagem
  // (o miolo que estica fica no meio: faixa encostada numa borda e transparencia ou desenho)
  const faixa = (n: number, mesma: (i: number, j: number) => boolean): [number, number] | null => {
    let melhor: [number, number] | null = null,
      ini = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && mesma(i, ini)) continue;
      if (!melhor || i - 1 - ini > melhor[1] - melhor[0]) melhor = [ini, i - 1];
      ini = i;
    }
    if (!melhor || melhor[1] - melhor[0] + 1 < Math.max(3, n * 0.2)) return null;
    const meio = (n - 1) / 2;
    if (melhor[0] > meio || melhor[1] < meio) return null;
    return melhor;
  };
  const linhas = faixa(h, (y, y0) => {
    for (let x = 0; x < w; x++) if (!igual(at(x, y), at(x, y0))) return false;
    return true;
  });
  const colunas = faixa(w, (x, x0) => {
    for (let y = 0; y < h; y++) if (!igual(at(x, y), at(x0, y))) return false;
    return true;
  });
  if (!linhas && !colunas) return null;
  const m: [number, number, number, number] = [colunas ? colunas[0] : 0, linhas ? linhas[0] : 0, colunas ? w - 1 - colunas[1] : 0, linhas ? h - 1 - linhas[1] : 0];
  // sem borda nenhuma (gradiente, cor lisa): nao e nove-fatias
  if (m.every((v) => v === 0)) return null;
  // um eixo sem faixa: a imagem inteira vira as duas margens desse eixo (nao estica nele)
  return m;
}

// ---- a proposta

export interface OpcoesTela {
  mapa?: MapaTela | null;
  fontes?: FonteConhecida[];
}

export function lerTela(buf: Uint8Array, file: string, opts: OpcoesTela = {}): PropostaTela {
  initCanvas();
  const mapaBruto: any = opts.mapa ?? {};
  const { arte: mArte, encaixe: mEncaixe, nomes: mNomes, ancoras: mAncoras, fatias: mFatias, textos: mTextos, idioma: mIdioma, blocos: mBlocos, ...resto } = mapaBruto;
  for (const k of Object.keys(resto)) if (k.startsWith("_")) delete resto[k]; // "_nota": comentario
  checkMapa(resto); // os campos da importacao comum
  const psd = readPsd(buf, { useImageData: true, skipThumbnail: true, skipCompositeImageData: true });
  const W = psd.width,
    H = psd.height;
  const avisos: string[] = [];
  const arquivo = file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);

  // chaves do mapa: caminho bruto, caminho limpo, nome bruto ou nome limpo
  const usadas = new Set<string>();
  const chaveNo = (n: No, m: Record<string, any> | undefined): string | null => {
    if (!m) return null;
    const limpoCaminho = (x: No | null): string => (x ? (x.pai ? limpoCaminho(x.pai) + "/" : "") + x.limpo : "");
    for (const k of [n.caminho, limpoCaminho(n), n.bruto, n.limpo])
      if (k && Object.prototype.hasOwnProperty.call(m, k)) {
        usadas.add(k);
        return k;
      }
    // com * : varias camadas de uma vez ("moeda_*", "[bone:ui]/*"); vale a primeira que casa
    for (const k of Object.keys(m)) {
      if (!k.includes("*")) continue;
      const re = new RegExp("^" + k.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      if ([n.caminho, limpoCaminho(n), n.bruto, n.limpo].some((x) => re.test(x))) {
        usadas.add(k);
        return k;
      }
    }
    return null;
  };
  const esconderMapa = new Set<string>(resto.esconder ?? []);

  let origem: [number, number] = [W / 2, H];
  const monta = (ls: Layer[] | undefined, pai: No | null): No[] => {
    const out: No[] = [];
    // de baixo para cima (a ordem do ag-psd)
    for (const l of ls ?? []) {
      const bruto = l.name ?? "";
      const { clean, tags } = parseTags(bruto);
      const n: No = { layer: l, pai, grupo: l.children !== undefined, bruto, limpo: clean, tags, caminho: (pai ? pai.caminho + "/" : "") + bruto, efetivo: clean, renomeado: false, fatiasNome: null, oculta: !!l.hidden || !!pai?.oculta, rect: null, filhos: [], texto: null, pixels: null, extra: [] };
      const kc = chaveNo(n, resto.camadas);
      if (kc) n.tags = [...n.tags, ...parseTags(resto.camadas[kc]).tags];
      if (esconderMapa.size && chaveNo(n, Object.fromEntries([...esconderMapa].map((k) => [k, 1])))) n.oculta = true;
      if (tagOf(n, "ignore") || (l as any).adjustment) continue;
      if (tagOf(n, "origin")) {
        const t = tinta(l);
        if (t) origem = [t.rect[0] + t.rect[2] / 2, t.rect[1] + t.rect[3] / 2];
        continue;
      }
      const kn = chaveNo(n, mNomes);
      if (kn) {
        n.efetivo = parseTags(mNomes[kn]).clean;
        n.renomeado = true;
      }
      const t9 = tagOf(n, "9");
      const mf = n.efetivo.match(FATIA_PREFIXO);
      if (mf) {
        n.efetivo = mf[2];
        n.fatiasNome = true;
      }
      if (t9) n.fatiasNome = t9.value ? t9.value.split(/[ ,;x]+/).map(Number).filter((v) => Number.isFinite(v)) : true;
      if (n.grupo) {
        n.filhos = monta(l.children, n);
        if (!n.filhos.length) continue;
        const vis = n.filhos.filter((f) => !f.oculta && f.rect);
        n.rect = union((vis.length ? vis : n.filhos).map((f) => f.rect!).filter(Boolean));
        if (!n.rect) continue;
      } else {
        if (l.clipping) continue; // presa: entra assada na de baixo
        if (l.text) n.texto = l.text;
        const t = tinta(l);
        if (!t) continue;
        n.rect = t.rect;
        n.pixels = t.pixels;
        // a imagem de texto (rasterizado) que o mapa diz que e texto: vira uma camada de texto
        const kt = !l.text ? chaveNo(n, mTextos) : null;
        if (kt) {
          const mt: TextoDoMapa = mTextos[kt] ?? {};
          const cor = /^#?[0-9a-f]{6}/i.test(mt.cor ?? "") ? (mt.cor as string).replace("#", "") : "ffffff";
          n.texto = {
            text: mt.texto ?? "",
            style: { fontSize: mt.tamanho ?? Math.round(t.rect[3] * 0.8), ...(mt.fonte ? { font: { name: mt.fonte } } : {}), fillColor: { r: parseInt(cor.slice(0, 2), 16), g: parseInt(cor.slice(2, 4), 16), b: parseInt(cor.slice(4, 6), 16) } },
            paragraphStyle: { justification: mt.alinhar ?? "center" },
            daImagem: true,
          };
        }
      }
      out.push(n);
    }
    return out;
  };
  const raiz = monta(psd.children, null);

  // ---- a arte base
  let arteRect: Rect = [0, 0, W, H];
  let porqueArte = `o tamanho do documento (${W} x ${H} px)`;
  if (mArte) {
    if (!Array.isArray(mArte) || mArte.length !== 4 || !(mArte[2] > 0 && mArte[3] > 0)) throw new Error("mapa da tela: arte e [x, y, largura, altura] em px do PSD");
    arteRect = [mArte[0], mArte[1], mArte[2], mArte[3]];
    porqueArte = `o mapa: ${mArte[2]} x ${mArte[3]} px a partir de (${mArte[0]}, ${mArte[1]}) no PSD de ${W} x ${H}`;
  }
  const encaixe: Encaixe = mEncaixe ?? "contain";
  const [AX, AY, AW, AH] = arteRect;

  // ---- todos os nos, de baixo para cima
  const todos: No[] = [];
  const percorre = (ns: No[]) => ns.forEach((n) => (todos.push(n), percorre(n.filhos)));
  percorre(raiz);
  const ossos = new Set<string>();
  const nomeOsso = (base: string) => {
    let n = slug(base),
      i = 2;
    while (ossos.has(n)) n = `${slug(base)}_${i++}`;
    ossos.add(n);
    return n;
  };
  // ossos que o PSD (ou o mapa) ja traz ([bone:x])
  const ossosDeTag = new Set<string>();
  for (const n of todos) {
    const b = tagOf(n, "bone");
    if (b) {
      n.osso = b.value ?? n.limpo;
      ossos.add(n.osso);
      ossosDeTag.add(n.osso);
    }
  }
  const temTagsDeMontagem = (n: No) => ["bone", "slot", "merge", "skin", "folder"].some((k) => tagOf(n, k));
  const daOsso = (n: No) => {
    if (n.osso) return n.osso;
    // a camada "fundo" e as lampadas que o mapa pos em [bone:fundo]: o mesmo osso
    n.osso = ossosDeTag.has(slug(n.efetivo)) ? slug(n.efetivo) : nomeOsso(n.efetivo);
    n.extra.push(`[bone:${n.osso}]`);
    return n.osso;
  };

  // ---- botoes: o grupo btn_x com camadas normal, apertado..., ou as irmas x, x_apertado, x_desligado
  const botoes: { nome: string; no: No; slot: string | null; estados: Partial<Record<StateName, No>>; porque: string }[] = [];
  const estadoDe = new Set<No>(); // camadas que sao estado de um botao (nao sao elemento sozinhas)
  const papelDe = (n: No) => roleFromName(n.efetivo);
  for (const g of todos.filter((n) => n.grupo)) {
    const r = papelDe(g);
    if (r?.type !== "button") continue;
    const est: Partial<Record<StateName, No>> = {};
    for (const f of g.filhos) {
      if (f.texto) continue;
      const e = estadoDoNome(f.efetivo) ?? separaEstado(f.efetivo)?.estado ?? null;
      if (e && !est[e]) est[e] = f;
    }
    botoes.push({ nome: r.name, no: g, slot: Object.keys(est).length ? "?" : null, estados: est, porque: Object.keys(est).length ? `grupo ${g.efetivo} com as camadas ${Object.values(est).map((f) => f!.efetivo).join(", ")}` : `o nome ${g.efetivo} (btn_)` });
  }
  // irmas: base e base_estado no mesmo pai
  const porPai = new Map<No | null, No[]>();
  for (const n of todos) porPai.set(n.pai, [...(porPai.get(n.pai) ?? []), n]);
  for (const [, irmas] of porPai) {
    const grupos = new Map<string, Partial<Record<StateName, No>>>();
    for (const n of irmas) {
      if (n.texto || botoes.some((b) => b.no === n)) continue;
      const s = separaEstado(n.efetivo);
      if (s) grupos.set(s.base, { ...(grupos.get(s.base) ?? {}), [s.estado]: n });
    }
    for (const [base, est] of grupos) {
      // a base pelo nome na convencao ou pelo do PSD (o mapa renomeou "play" para "btn_play"; a irma
      // continua "play_off")
      const baseNo = irmas.find((n) => (n.efetivo === base || n.limpo === base) && !n.texto);
      if (baseNo && !est.normal) est.normal = baseNo;
      const r = roleFromName(baseNo?.efetivo ?? base);
      const outros = (Object.keys(est) as StateName[]).filter((s) => s !== "normal");
      if (!est.normal || (!outros.length && r?.type !== "button")) continue;
      if (r && r.type !== "button") continue;
      for (const s of Object.values(est)) estadoDe.add(s!);
      estadoDe.delete(est.normal);
      botoes.push({ nome: r?.name ?? slug(base), no: est.normal, slot: "?", estados: est, porque: `camadas irmas ${Object.values(est).map((f) => f!.efetivo).join(", ")}${r ? "" : " (os sufixos de estado; o nome nao tem btn_)"}` });
    }
  }
  // os btn_ soltos (camada sem estados): o botao com as poses padrao
  for (const n of todos) {
    const r = papelDe(n);
    if (r?.type !== "button" || n.grupo || estadoDe.has(n) || botoes.some((b) => b.no === n || Object.values(b.estados).includes(n))) continue;
    if (n.pai && botoes.some((b) => b.no === n.pai)) continue;
    botoes.push({ nome: r.name, no: n, slot: null, estados: {}, porque: `o nome ${n.efetivo} (btn_)` });
  }

  // ---- os elementos: as camadas e grupos de cima; grupo que so organiza (cobre boa parte da arte,
  // com varios filhos e sem papel) passa a ancora para os filhos
  const cobre = (r: Rect, k: number) => r[2] >= AW * k && r[3] >= AH * k;
  const ehBloco = (n: No) => /^(palco|stage|bloco_.+|block_.+)$/i.test(n.efetivo);
  const ehRecipiente = (n: No) => n.grupo && !ehBloco(n) && n.filhos.length >= 2 && !papelDe(n) && !botoes.some((b) => b.no === n) && !!n.rect && cobre(n.rect, 0.6) && !n.filhos.some((f) => f.rect && cobre(f.rect, 0.95) && n.filhos.length === 1);
  const recipientes: No[] = [];
  const elementos = (ns: No[]): No[] =>
    ns.flatMap((n) => {
      if (estadoDe.has(n) || n.texto) return n.texto ? [] : [];
      if (ehRecipiente(n)) {
        recipientes.push(n);
        return elementos(n.filhos);
      }
      return [n];
    });
  const els = elementos(raiz);
  // textos soltos no topo (ou num recipiente) tambem sao elementos, com o osso deles
  const textosSoltos = new Set(todos.filter((n) => n.texto && (!n.pai || recipientes.includes(n.pai))));

  // ---- os ossos: todo grupo vira osso (o que se move junto), menos os de montagem (estado de
  // botao, [slot], [merge]); camada de cima, papel e botao tambem
  for (const n of todos) if (n.grupo && !temTagsDeMontagem(n) && !estadoDe.has(n) && !botoes.some((b) => Object.values(b.estados).includes(n) && b.no !== n)) daOsso(n);
  // todo elemento tem osso (o grupo [slot:x] de cima tambem: ganha [bone] alem do [slot])
  for (const n of els) daOsso(n);
  for (const b of botoes) daOsso(b.no);
  for (const n of todos) if (!n.grupo && !n.texto && papelDe(n)?.type === "touch") daOsso(n);

  // ---- slots dos botoes com estados
  const esconder: string[] = [];
  for (const b of botoes) {
    if (b.slot !== "?") continue;
    const slot = b.no.osso!;
    b.slot = slot;
    const viaGrupo = b.no.grupo && Object.values(b.estados).every((s) => s!.pai === b.no);
    for (const [e, s] of Object.entries(b.estados) as [StateName, No][]) {
      if (s === b.no && !viaGrupo) {
        s.extra.push(`[slot:${slot}]`);
        continue;
      }
      if (!viaGrupo && !temTag(s, "bone")) s.extra.push(`[bone:${slot}]`);
      s.extra.push(`[slot:${slot}]`);
      if (viaGrupo) s.extra.push(`[path:${slot}_${slug(s.limpo)}]`);
      if (s.grupo) s.extra.push("[merge]");
      if (e !== "normal" && !s.oculta) esconder.push(s.caminho);
      if (e === "normal" && s.oculta) avisos.push(`o estado normal do botao ${b.nome} (${s.caminho}) esta escondido no PSD: o botao comeca sem imagem`);
    }
  }

  // ---- slot e parte de cada folha (como a importacao comum faz, com as tags somadas)
  const tagSomada = (n: No, k: string): Tag | undefined => tagOf(n, k) ?? n.extra.map((e) => parseTags(e).tags[0]).find((t) => t?.key === k);
  const slotDaFolha = (n: No): string => {
    for (let x: No | null = n; x; x = x.pai) {
      const t = tagSomada(x, "slot");
      if (t) return t.value ?? x.limpo;
      if (x !== n && tagSomada(x, "merge")) break;
    }
    return n.limpo.replace(/\.png$/i, "").replace(/[\\:"*?<>|]/g, "");
  };
  // folhas que viram imagem: as dentro de [merge] nao contam sozinhas
  const dentroDeMerge = (n: No) => {
    for (let x = n.pai; x; x = x.pai) if (tagSomada(x, "merge")) return true;
    return false;
  };
  const ehImagem = (n: No) => (n.grupo ? !!tagSomada(n, "merge") : !n.texto && !dentroDeMerge(n));
  // nomes repetidos (duas "Camada 1" em grupos diferentes): o slot e a imagem ganham o osso na frente
  const contagem = new Map<string, number>();
  for (const n of todos) if (ehImagem(n) && !tagSomada(n, "slot") && !tagSomada(n, "path")) contagem.set(n.limpo, (contagem.get(n.limpo) ?? 0) + 1);
  const ossoAcima = (n: No): string => {
    for (let x = n.pai; x; x = x.pai) {
      const t = tagSomada(x, "bone");
      if (t) return t.value ?? x.limpo;
    }
    return "root";
  };
  for (const n of todos) {
    if (!ehImagem(n)) continue;
    if ((contagem.get(n.limpo) ?? 0) > 1 && !tagSomada(n, "slot")) {
      const nome = `${slug(ossoAcima(n) === "root" ? "camada" : ossoAcima(n))}_${slug(n.limpo)}`;
      n.extra.push(`[slot:${nome}]`, `[path:${nome}]`);
    }
    n.slot = slotDaFolha(n);
    n.parte = n.limpo.replace(/\.png$/i, "").replace(/[\\:"*?<>|]/g, "");
  }
  const slotsUsados = new Set(todos.filter((n) => n.slot).map((n) => n.slot!));

  // ---- itens
  const itens: ItemTela[] = [];

  // ancoras
  const ancoraDe = (r: Rect): { ancora: Ancora; esticar: Esticar; porque: string; cobre?: boolean } => {
    const fx = (r[0] + r[2] / 2 - AX) / AW,
      fy = (r[1] + r[3] / 2 - AY) / AH;
    const tol = 0.05;
    const cobreX = r[0] <= AX + AW * tol && r[0] + r[2] >= AX + AW * (1 - tol),
      cobreY = r[1] <= AY + AH * tol && r[1] + r[3] >= AY + AH * (1 - tol);
    const onde = `centro em ${pct(fx)} da largura e ${pct(fy)} da altura`;
    // a arte que ja sangra para fora da arte base (o fundo maior que a tela) nao estica: a sobra aparece
    // nas janelas de outra proporcao sem deformar
    const sangraX = r[2] >= AW * 1.15,
      sangraY = r[3] >= AH * 1.15;
    if (cobreX && cobreY && sangraX && sangraY) return { ancora: "center", esticar: "none", cobre: true, porque: `cobre a arte e sangra para fora (${r[2]} x ${r[3]} px, a arte ${AW} x ${AH}): fundo, no meio, cresce por igual ate cobrir a janela (sem deformar)` };
    if (cobreX && cobreY) return { ancora: "center", esticar: "xy", porque: `cobre a arte inteira (${r[2]} x ${r[3]} px): fundo, estica nos dois eixos` };
    const v = fy < 1 / 3 ? "top" : fy > 2 / 3 ? "bottom" : "";
    const h = fx < 1 / 3 ? "left" : fx > 2 / 3 ? "right" : "";
    const nomeV = { top: "perto do topo", bottom: "perto do rodape", "": "no meio da altura" }[v];
    const nomeH = { left: "a esquerda", right: "a direita", "": "no meio da largura" }[h];
    if (r[2] >= AW * 0.9) return { ancora: (v || "center") as Ancora, esticar: sangraX ? "none" : "x", porque: `faixa de largura total (${pct(r[2] / AW)} da arte), ${nomeV}: ${sangraX ? "sangra para os lados, sem esticar" : "estica em x"}` };
    if (r[3] >= AH * 0.9) return { ancora: (h || "center") as Ancora, esticar: sangraY ? "none" : "y", porque: `faixa de altura total (${pct(r[3] / AH)} da arte), ${nomeH}: ${sangraY ? "sangra para cima e para baixo, sem esticar" : "estica em y"}` };
    const a = (v && h ? `${v}-${h}` : v || h || "center") as Ancora;
    return { ancora: a, esticar: "none", porque: `${onde}: ${v && h ? "no canto" : v || h ? `${nomeV}${h ? ", " + nomeH : ""}`.replace("no meio da altura, ", "") : "no meio"}` };
  };
  for (const n of [...els, ...textosSoltos]) {
    if (!n.rect) continue;
    const osso = n.texto ? `${slug(n.efetivo)}_osso` : n.osso!;
    const k = chaveNo(n, mAncoras);
    let p = ancoraDe(n.rect);
    let ligado = true;
    if (k) {
      const v = mAncoras![k];
      if (v === null) ligado = false;
      else if (typeof v === "string") p = { ancora: v as Ancora, esticar: "none", porque: "o mapa" };
      else p = { ancora: v.ancora, esticar: v.esticar ?? "none", porque: "o mapa", ...(v.cobrir ? { cobre: true } : {}) };
      if (p.cobre && p.esticar !== "none") throw new Error(`mapa da tela: ${k} cobre e estica (cobrir sem deformar nao estica)`);
      if (p.ancora && !ANCORAS.includes(p.ancora)) throw new Error(`mapa da tela: ancora desconhecida "${p.ancora}" em ${k} (use ${ANCORAS.join(", ")})`);
    }
    if (n.texto) n.osso = osso;
    // duas camadas no mesmo osso (o mapa juntou): uma ancora so, pela uniao
    const ja = itens.find((i) => i.id === `ancora:${osso}`) as ItemAncora | undefined;
    if (ja) {
      ja.rect = union([ja.rect, n.rect])!;
      if (!k && !ja.porque.startsWith("o mapa")) Object.assign(ja, (({ ancora, esticar, porque }) => ({ ancora, esticar, porque: `${porque} (${ja.camada} e ${n.caminho} no mesmo osso)` }))(ancoraDe(ja.rect)));
      continue;
    }
    itens.push({ id: `ancora:${osso}`, tipo: "ancora", camada: n.caminho, ligado, porque: p.porque, osso, ancora: p.ancora, esticar: p.esticar, rect: n.rect, ...(p.cobre ? { cobre: true } : {}) });
  }
  // os blocos do mapa (o palco): os elementos que casam saem das ancoras proprias e viram filhos de
  // um osso novo, ancorado (os com ancora propria no mapa, por nome exato, ficam fora)
  const emBloco = new Set<string>(); // um elemento fica no primeiro bloco que o pega
  for (const [nome, b] of Object.entries((mBlocos ?? {}) as NonNullable<MapaTela["blocos"]>)) {
    if (!ANCORAS.includes(b.ancora)) throw new Error(`mapa da tela: bloco ${nome} com ancora desconhecida "${b.ancora}" (use ${ANCORAS.join(", ")})`);
    if (!Array.isArray(b.camadas) || !b.camadas.length) throw new Error(`mapa da tela: bloco ${nome} sem camadas`);
    const padroes = Object.fromEntries(b.camadas.map((c) => [c, 1]));
    const exatos = Object.keys(mAncoras ?? {}).filter((k) => !k.includes("*"));
    const blocoNome = slug(nome);
    if (ossos.has(blocoNome)) throw new Error(`mapa da tela: o bloco ${nome} tem o nome de um osso que ja existe`);
    const membros: string[] = [];
    const rects: Rect[] = [];
    const camadas: string[] = [];
    for (const n of [...els, ...textosSoltos]) {
      if (!n.rect || !chaveNo(n, padroes)) continue;
      const exato = chaveNo(n, Object.fromEntries(exatos.map((k) => [k, 1])));
      if (exato) continue;
      const osso = n.texto ? n.osso ?? `${slug(n.efetivo)}_osso` : n.osso!;
      if (membros.includes(osso) || emBloco.has(osso)) continue;
      emBloco.add(osso);
      const k = itens.findIndex((i) => i.id === `ancora:${osso}`);
      if (k >= 0) itens.splice(k, 1);
      membros.push(osso);
      rects.push(n.rect);
      camadas.push(n.caminho);
    }
    for (const c of b.camadas) usadas.add(c);
    if (!membros.length) {
      avisos.push(`mapa da tela: o bloco ${nome} nao pegou nenhuma camada`);
      continue;
    }
    ossos.add(blocoNome);
    const [fx, fy] = ANCORA_XY[b.ancora];
    const ponto: [number, number] = b.ponto ?? [AX + fx * AW, AY + fy * AH];
    itens.push({
      id: `ancora:${blocoNome}`,
      tipo: "ancora",
      camada: camadas.length > 3 ? `${camadas.slice(0, 3).join(", ")} e mais ${camadas.length - 3}` : camadas.join(", "),
      ligado: true,
      porque: `o mapa: bloco de ${membros.length} elemento${membros.length > 1 ? "s" : ""} que anda junto${b.cobrir ? ", cresce por igual ate cobrir a janela" : ""}`,
      osso: blocoNome,
      ancora: b.ancora,
      esticar: "none",
      rect: union(rects)!,
      ...(b.cobrir ? { cobre: true } : {}),
      bloco: { ponto, membros },
    });
  }

  // botoes e toques
  for (const b of botoes) {
    const est: Partial<Record<StateName, string>> = {};
    if (b.slot) for (const [e, s] of Object.entries(b.estados) as [StateName, No][]) est[e] = s.parte ?? s.limpo;
    itens.push({ id: `botao:${b.nome}`, tipo: "botao", camada: b.no.caminho, ligado: true, porque: b.porque, nome: b.nome, osso: b.no.osso!, slot: b.slot, estados: est });
  }
  for (const n of todos) {
    const r = papelDe(n);
    if (r?.type !== "touch" || n.texto) continue;
    itens.push({ id: `toque:${r.name}`, tipo: "toque", camada: n.caminho, ligado: true, porque: `o nome ${n.efetivo} (toque_)`, nome: r.name, osso: daOsso(n) });
  }

  // textos: a ordem de desenho decide o "abaixo"
  const ordem = todos.filter((n) => ehImagem(n) || n.texto);
  const fontesVistas = new Map<string, string | null>();
  const nomesTexto = new Set<string>();
  for (const n of ordem) {
    if (!n.texto) continue;
    const t = n.texto;
    const st = t.style ?? {};
    const tf: number[] = t.transform ?? [1, 0, 0, 1, 0, 0];
    const escala = Math.sqrt(tf[2] * tf[2] + tf[3] * tf[3]) || 1;
    const tamanho = r1((st.fontSize ?? 24) * escala);
    const fonte: string | null = st.font?.name ?? null;
    const kt = chaveNo(n, mTextos);
    const mt = kt ? mTextos![kt] : undefined;
    let arquivoFonte: string | null = null;
    if (fonte) {
      if (!fontesVistas.has(fonte)) fontesVistas.set(fonte, achaFonte(mt?.fonte ?? fonte, opts.fontes ?? []));
      arquivoFonte = fontesVistas.get(fonte)!;
    }
    const just = String(t.paragraphStyle?.justification ?? "left");
    const alinhar: ItemTexto["alinhar"] = just.includes("center") ? "center" : just.includes("right") ? "right" : "left";
    const conteudo = String(t.text ?? "").replace(/\r\n?/g, "\n").replace(/\u0003/g, "\n");
    const r = papelDe(n);
    const doCodigo = t.daImagem && mt?.papel ? mt.papel : r?.type === "text" ? r.name : null;
    // a chave: o nome da camada quando ela foi renomeada (o Photoshop da ao texto o nome do conteudo)
    const renomeado = n.renomeado || (n.limpo.trim() !== conteudo.trim() && n.limpo.trim() !== conteudo.trim().slice(0, n.limpo.trim().length));
    let chave: string | null = doCodigo ? null : chaveDe(renomeado ? n.efetivo : conteudo);
    if (mt && mt.chave !== undefined) chave = mt.chave;
    let slot = doCodigo ? n.efetivo : slug(n.efetivo);
    for (let i = 2; slotsUsados.has(slot) || nomesTexto.has(slot); i++) slot = `${doCodigo ? n.efetivo : slug(n.efetivo)}_${i}`;
    nomesTexto.add(slot);
    // a caixa: a de paragrafo do PSD, ou a tinta com folga para as traducoes (meia letra de cada lado,
    // e a altura de uma linha)
    const tr = n.rect!;
    let caixa: Rect;
    const quebra = t.shapeType === "box" && Array.isArray(t.boxBounds);
    if (quebra) {
      const [bl, bt, br, bb] = t.boxBounds;
      caixa = [r1(tf[4] + bl), r1(tf[5] + bt), r1(br - bl), r1(bb - bt)];
    } else {
      const folga = Math.max(tamanho, tr[2] * 0.3);
      const w = r1(tr[2] + folga * 2),
        h = r1(Math.max(tr[3], tamanho * 1.3));
      const cy = tr[1] + tr[3] / 2;
      const x0 = alinhar === "left" ? tr[0] - tamanho * 0.1 : alinhar === "right" ? tr[0] + tr[2] + tamanho * 0.1 - w : tr[0] + tr[2] / 2 - w / 2;
      caixa = [r1(x0), r1(cy - h / 2), w, h];
    }
    if (t.daImagem && mt?.caixa) caixa = mt.caixa.map(r1) as Rect;
    const fx: any = n.layer.effects;
    const stroke = fx && !fx.disabled ? fx.stroke?.find?.((s: any) => s.enabled !== false) : null;
    const shadow = fx && !fx.disabled ? fx.dropShadow?.find?.((s: any) => s.enabled !== false) : null;
    const contorno = stroke ? { largura: r1(stroke.size?.value ?? 2), cor: corHex(stroke.color) ?? "000000" } : t.daImagem && mt?.contorno ? { largura: mt.contorno.largura, cor: mt.contorno.cor.replace("#", "") } : undefined;
    let sombra: ItemTexto["sombra"];
    if (shadow) {
      const d = shadow.distance?.value ?? 3,
        ang = ((shadow.angle ?? 120) * Math.PI) / 180;
      sombra = { cor: corHex(shadow.color) ?? "000000", x: r1(-Math.cos(ang) * d), y: r1(Math.sin(ang) * d) };
    }
    // o osso: o grupo acima, ou o osso proprio (texto solto)
    let osso = ossoAcima(n);
    let ossoNovo: ItemTexto["ossoNovo"];
    if (textosSoltos.has(n)) {
      ossoNovo = { pai: osso, at: [tr[0] + tr[2] / 2, tr[1] + tr[3] / 2] };
      osso = n.osso!;
    }
    const i = ordem.indexOf(n);
    let abaixo: string | null = null;
    for (let k = i - 1; k >= 0 && !abaixo; k--) {
      const b = ordem[k];
      if (b.texto) abaixo = (itens.find((x) => x.tipo === "texto" && x.camada === b.caminho) as ItemTexto | undefined)?.slot ?? null;
      else abaixo = b.slot ?? null;
    }
    const partes: string[] = [];
    partes.push(doCodigo ? `txt_ (o jogo troca: tela.texto("${doCodigo}", ...))` : chave ? `chave ${chave} (${renomeado ? "o nome da camada" : "o texto"})` : "texto livre (o mapa)");
    partes.push(fonte ? (arquivoFonte ? `fonte ${fonte}` : `fonte ${fonte} FALTA`) : "sem fonte no PSD");
    partes.push(`${tamanho} px, ${alinhar}`);
    itens.push({
      id: `texto:${slot}`,
      tipo: "texto",
      camada: n.caminho,
      ligado: true,
      porque: `${t.daImagem ? "imagem de texto que o mapa faz texto" : "camada de texto"} "${conteudo.length > 24 ? conteudo.slice(0, 24) + "..." : conteudo}": ${partes.join(", ")}`,
      slot,
      osso,
      ...(ossoNovo ? { ossoNovo } : {}),
      texto: conteudo,
      chave,
      doCodigo,
      fonte,
      arquivoFonte,
      tamanho,
      cor: corHex(st.fillColor) ?? "000000",
      alinhar,
      caixa,
      quebra,
      abaixo,
      ...(contorno ? { contorno } : {}),
      ...(sombra ? { sombra } : {}),
    });
  }
  for (const [f, a] of fontesVistas) if (!a) avisos.push(`fonte ${f} nao encontrada: ponha o arquivo (.ttf, .otf) ao lado do PSD, numa pasta fontes/ ao lado dele ou em fontes/ na pasta da tela; ate la os textos com ela usam a fonte padrao`);
  // txt_ que e imagem (texto rasterizado): nao vira texto
  for (const n of todos) if (!n.texto && papelDe(n)?.type === "text") avisos.push(`${n.caminho} chama txt_ mas e imagem (texto rasterizado): ficou imagem; mande a camada de texto do Photoshop para virar texto do codigo`);

  // nove-fatias: pelo nome (9_x, [9], [9:m]), pelo mapa, ou pela imagem (bordas iguais)
  const estiraDoElemento = (n: No): Esticar => {
    for (let x: No | null = n; x; x = x.pai) {
      const a = itens.find((i) => i.tipo === "ancora" && i.osso === x!.osso) as ItemAncora | undefined;
      if (a) return a.esticar;
    }
    return "none";
  };
  const feitos = new Set<string>();
  for (const n of todos) {
    if (!ehImagem(n) || !n.rect || !n.slot) continue;
    const b = botoes.find((b) => b.slot === n.slot);
    if (b && b.estados.normal !== n) continue; // os estados seguem o normal
    if (feitos.has(n.slot)) continue;
    const km = chaveNo(n, mFatias);
    const viaMapa = km ? mFatias![km] : undefined;
    if (viaMapa === null) continue;
    let margens: [number, number, number, number] | null = null;
    let origemF: ItemFatias["origem"] = "imagem";
    const quatro = (v: number[]): [number, number, number, number] => (v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : [v[0], v[1], v[2] ?? v[0], v[3] ?? v[1]]);
    if (viaMapa) {
      margens = quatro(viaMapa);
      origemF = "mapa";
    } else if (Array.isArray(n.fatiasNome) && n.fatiasNome.length) {
      margens = quatro(n.fatiasNome);
      origemF = "nome";
    }
    const pelaImagem = n.pixels ? margensPelaImagem(n.pixels, n.rect, n.pixels.x, n.pixels.y) : null;
    if (!margens && n.fatiasNome) {
      origemF = "nome";
      margens = pelaImagem ?? (() => {
        const m = Math.round(Math.min(n.rect![2], n.rect![3]) / 4);
        return [m, m, m, m] as [number, number, number, number];
      })();
    }
    if (!margens && pelaImagem && !n.grupo) margens = pelaImagem;
    if (!margens) continue;
    feitos.add(n.slot);
    // o texto que a caixa acompanha: o unico texto do mesmo osso (o JOGAR do botao)
    const osso = ossoAcima(n) === "root" ? n.osso : ossoAcima(n);
    // o texto em cima da imagem (o meio dele dentro dela), se for um so: o JOGAR do botao, o MISSOES do titulo
    const dentro = (t: ItemTexto) => {
      const r = todos.find((x) => x.caminho === t.camada)!.rect!;
      const cx = r[0] + r[2] / 2,
        cy = r[1] + r[3] / 2;
      return cx > n.rect![0] && cx < n.rect![0] + n.rect![2] && cy > n.rect![1] && cy < n.rect![1] + n.rect![3];
    };
    const textos = (itens.filter((i) => i.tipo === "texto" && i.osso === osso) as ItemTexto[]).filter(dentro);
    let acompanha: ItemFatias["acompanha"];
    if (textos.length === 1) {
      const t = textos[0];
      const tn = todos.find((x) => x.caminho === t.camada)!;
      acompanha = { slot: t.slot, respiro: [r1(Math.max(0, (n.rect[2] - tn.rect![2]) / 2)), r1(Math.max(0, (n.rect[3] - tn.rect![3]) / 2))] };
    }
    const estica = estiraDoElemento(n);
    // pela imagem so entra ligada se a caixa vai mudar de tamanho: o texto que ela acompanha, ou a
    // ancora que estica num eixo em que ha margem (a grama de bordas so em cima nao precisa)
    const esticaComMargem = (estica.includes("x") && margens[0] + margens[2] > 0) || (estica.includes("y") && margens[1] + margens[3] > 0);
    const ligado = origemF !== "imagem" || esticaComMargem || !!acompanha;
    const partes = b ? Object.values(b.estados).map((s) => s!.parte!) : [n.parte!];
    const desc = `margens ${margens.join(", ")}`;
    const porque =
      origemF === "mapa"
        ? `o mapa: ${desc}`
        : origemF === "nome"
          ? `o nome ${n.bruto} (${Array.isArray(n.fatiasNome) ? "margens no nome" : pelaImagem ? "margens pela imagem" : "sem bordas iguais na imagem: um quarto do lado menor"}): ${desc}`
          : `bordas iguais na imagem (${desc})${ligado ? (acompanha ? `; acompanha o texto ${acompanha.slot}` : `; o elemento estica em ${estica}`) : "; ligue se for esticar"}`;
    itens.push({ id: `fatias:${n.slot}`, tipo: "fatias", camada: n.caminho, ligado, porque, slot: n.slot, partes, margens, tamanho: [n.rect[2], n.rect[3]], ...(acompanha ? { acompanha } : {}), origem: origemF });
  }

  // ---- as tags da importacao comum
  const tags: Record<string, string> = {};
  for (const n of todos) if (n.extra.length) tags[n.caminho] = [...new Set(n.extra)].join(" ");
  // chaves do mapa que nao casaram
  for (const m of [mNomes, mAncoras, mFatias, mTextos]) for (const k of Object.keys(m ?? {})) if (!usadas.has(k)) avisos.push(`mapa da tela: nenhuma camada chamada "${k}" (chave ignorada)`);

  const pareceTela = NOME_TELA.test(arquivo) || botoes.length > 0 || itens.some((i) => i.tipo === "texto" || (i.tipo === "fatias" && i.origem !== "imagem") || i.tipo === "toque");
  return {
    arquivo,
    tamanho: [W, H],
    origem,
    arte: { rect: arteRect, encaixe, porque: porqueArte },
    itens,
    tags,
    esconder,
    idioma: typeof mIdioma === "string" && mIdioma ? mIdioma : "pt",
    pareceTela,
    fontes: [...fontesVistas].map(([nome, arquivo]) => ({ nome, arquivo })),
    avisos,
  };
}

// ---- escolhas da pessoa: desligar, ligar e trocar itens (o editor e a ponte)

export interface EscolhasTela {
  off?: string[];
  on?: string[];
  change?: Record<string, any>; // id -> campos novos (ancora, esticar, nome, chave, margens...)
  art?: Rect;
  fit?: Encaixe;
}
export function aplicarEscolhas(p: PropostaTela, e: EscolhasTela = {}): PropostaTela {
  const ids = new Set(p.itens.map((i) => i.id));
  for (const id of [...(e.off ?? []), ...(e.on ?? []), ...Object.keys(e.change ?? {})]) if (!ids.has(id)) throw new Error(`item da proposta desconhecido: ${id} (os ids: ${[...ids].slice(0, 12).join(", ")}${ids.size > 12 ? "..." : ""})`);
  const itens = p.itens.map((i) => {
    let x: any = { ...i };
    if (e.off?.includes(i.id)) x.ligado = false;
    if (e.on?.includes(i.id)) x.ligado = true;
    const c = e.change?.[i.id];
    if (c) {
      if ("ancora" in c && !ANCORAS.includes(c.ancora)) throw new Error(`${i.id}: ancora desconhecida "${c.ancora}" (use ${ANCORAS.join(", ")})`);
      x = { ...x, ...c, porque: `${x.porque} (trocado)` };
    }
    return x as ItemTela;
  });
  return { ...p, itens, arte: { ...p.arte, ...(e.art ? { rect: e.art, porque: "trocado" } : {}), ...(e.fit ? { encaixe: e.fit } : {}) } };
}

// o mapa da importacao comum: as tags da proposta mais o mapa de quem chama; textos ligados saem
// (viram partes de texto), os desligados entram como imagem
export function mapaDaTela(p: PropostaTela, base?: PsdMapa | null): PsdMapa {
  const camadas: Record<string, string> = { ...p.tags };
  for (const i of p.itens) if (i.tipo === "texto" && i.ligado) camadas[i.camada] = ((camadas[i.camada] ?? "") + " [ignore]").trim();
  for (const [k, v] of Object.entries(base?.camadas ?? {})) camadas[k] = ((camadas[k] ?? "") + " " + v).trim();
  const out: PsdMapa = {};
  if (Object.keys(camadas).length) out.camadas = camadas;
  if (base?.ossos) out.ossos = base.ossos;
  const esc = [...new Set([...p.esconder, ...(base?.esconder ?? [])])];
  if (esc.length) out.esconder = esc;
  return out;
}

// ---- os comandos que montam a tela no documento importado com mapaDaTela

export function psdLayoutCalls(json: any, p: PropostaTela, o: { fonts?: Record<string, string> } = {}): { calls: Call[]; avisos: string[] } {
  const calls: Call[] = [];
  const avisos: string[] = [];
  const [ox, oy] = p.origem;
  const mundo = (x: number, y: number): [number, number] => [r1(x - ox), r1(oy - y)];
  const [ax, ay, aw, ah] = p.arte.rect;
  const ossos = new Set((json.bones ?? []).map((b: any) => b.name));
  const slotsDoc = new Set(slots(json).map((s: any) => s.name));
  const on = <T extends ItemTela["tipo"]>(t: T) => p.itens.filter((i) => i.tipo === t && i.ligado) as Extract<ItemTela, { tipo: T }>[];

  const [bx, by] = mundo(ax, ay + ah);
  calls.push({ cmd: "screen.set", args: { art: [bx, by, aw, ah], fit: p.arte.encaixe } });

  // as fontes usadas (a primeira vira a padrao)
  const nomeFonte = new Map<string, string>();
  for (const t of on("texto")) {
    if (!t.fonte || nomeFonte.has(t.fonte)) continue;
    const arq = o.fonts?.[t.fonte];
    if (!arq) continue;
    const nome = slug(t.fonte);
    nomeFonte.set(t.fonte, nome);
    calls.push({ cmd: "font.add", args: { name: nome, file: arq } });
  }

  // os ossos dos textos soltos (o resto veio da importacao)
  const novos = new Map<string, [number, number]>();
  for (const t of on("texto"))
    if (t.ossoNovo && !ossos.has(t.osso)) {
      const pai = ossos.has(t.ossoNovo.pai) ? t.ossoNovo.pai : "root";
      calls.push({ cmd: "bone.add", args: { name: t.osso, parent: pai, at: mundo(...t.ossoNovo.at) } });
      ossos.add(t.osso);
      novos.set(t.osso, mundo(...t.ossoNovo.at));
    }
  // o osso de um grupo que so tinha o texto (a imagem de texto que o mapa fez texto): a importacao nao
  // cria grupo vazio; o osso nasce aqui, no meio da caixa
  for (const t of on("texto"))
    if (!ossos.has(t.osso)) {
      const at = mundo(t.caixa[0] + t.caixa[2] / 2, t.caixa[1] + t.caixa[3] / 2);
      calls.push({ cmd: "bone.add", args: { name: t.osso, parent: "root", at } });
      ossos.add(t.osso);
      novos.set(t.osso, at);
    }
  // os textos: a caixa no osso (os ossos da importacao nao giram nem escalam: local = mundo - osso)
  const sk = skeletonAt(json, null, 0);
  const local = (osso: string, x: number, y: number): [number, number] => {
    if (novos.has(osso)) return [r1(x - novos.get(osso)![0]), r1(y - novos.get(osso)![1])];
    try {
      const m = invert(boneWorld(sk, osso));
      const [lx, ly] = apply(m, x, y);
      return [r1(lx), r1(ly)];
    } catch {
      return [x, y];
    }
  };
  // as chaves novas entram na tabela de idiomas com o texto do PSD no idioma dele
  const tabela = json.translations?.strings ?? {};
  const chaves = new Set<string>();
  for (const t of on("texto"))
    if (t.chave && !tabela[t.chave] && !chaves.has(t.chave)) {
      chaves.add(t.chave);
      calls.push({ cmd: "i18n.set", args: { key: t.chave, values: { [p.idioma ?? "pt"]: t.texto } } });
    }
  const textosFeitos = new Set<string>();
  for (const t of on("texto")) {
    if (!ossos.has(t.osso)) {
      avisos.push(`texto ${t.slot}: o osso ${t.osso} nao existe (importe com o mapa da proposta); ficou de fora`);
      continue;
    }
    const [cx, cy] = mundo(t.caixa[0] + t.caixa[2] / 2, t.caixa[1] + t.caixa[3] / 2);
    const [lx, ly] = local(t.osso, cx, cy);
    const fonte = t.fonte ? nomeFonte.get(t.fonte) : undefined;
    calls.push({
      cmd: "text.set",
      args: {
        slot: t.slot,
        ...(slotsDoc.has(t.slot) ? {} : { bone: t.osso, ...(t.abaixo && (slotsDoc.has(t.abaixo) || textosFeitos.has(t.abaixo)) ? { above: t.abaixo } : {}) }),
        ...(t.chave ? { key: t.chave } : {}),
        text: t.texto,
        ...(fonte ? { font: fonte } : {}),
        size: t.tamanho,
        minSize: r1(t.tamanho * 0.6),
        width: t.caixa[2],
        height: t.caixa[3],
        x: lx,
        y: ly,
        color: t.cor,
        align: t.alinhar,
        ...(t.quebra ? { overflow: "wrap", valign: "top" } : {}),
        ...(t.contorno ? { outline: { width: t.contorno.largura, color: t.contorno.cor } } : {}),
        ...(t.sombra ? { shadow: { color: t.sombra.cor, x: t.sombra.x, y: t.sombra.y } } : {}),
      },
    });
    slotsDoc.add(t.slot);
    textosFeitos.add(t.slot);
  }

  // os blocos (o palco): o osso novo e os membros como filhos dele, no mesmo lugar
  for (const a of on("ancora")) {
    if (!a.bloco || ossos.has(a.osso)) continue;
    calls.push({ cmd: "bone.add", args: { name: a.osso, parent: "root", at: mundo(...a.bloco.ponto) } });
    ossos.add(a.osso);
    for (const m of a.bloco.membros) if (ossos.has(m)) calls.push({ cmd: "bone.reparent", args: { bone: m, parent: a.osso, keepWorld: true } });
  }
  // as ancoras
  for (const a of on("ancora")) {
    if (!ossos.has(a.osso)) {
      avisos.push(`ancora de ${a.camada}: o osso ${a.osso} nao existe; ficou de fora`);
      continue;
    }
    calls.push({ cmd: "anchor.set", args: { bone: a.osso, anchor: a.ancora, ...(a.esticar !== "none" ? { stretch: a.esticar } : {}), ...(a.cobre ? { cover: true } : {}) } });
  }

  // as nove-fatias (depois dos textos que elas acompanham)
  const textosOk = new Set(on("texto").map((t) => t.slot));
  for (const f of on("fatias")) {
    if (!slotsDoc.has(f.slot)) {
      avisos.push(`nove-fatias de ${f.camada}: o slot ${f.slot} nao existe; ficou de fora`);
      continue;
    }
    for (const parte of f.partes)
      calls.push({
        cmd: "slice.set",
        args: { slot: f.slot, name: parte, left: f.margens[0], top: f.margens[1], right: f.margens[2], bottom: f.margens[3], ...(f.acompanha && textosOk.has(f.acompanha.slot) ? { fitText: { slot: f.acompanha.slot, padding: f.acompanha.respiro } } : {}) },
      });
  }

  // os papeis: botoes (os estados pelas imagens; os que faltam, as poses padrao com a imagem normal),
  // toques e textos do codigo
  for (const b of on("botao")) {
    if (!ossos.has(b.osso)) {
      avisos.push(`botao ${b.nome}: o osso ${b.osso} nao existe; ficou de fora`);
      continue;
    }
    calls.push({ cmd: "psd.buttonStates", args: { name: b.nome, bone: b.osso, slot: b.slot, states: b.estados } });
  }
  for (const t of on("toque")) if (ossos.has(t.osso)) calls.push({ cmd: "role.set", args: { name: t.nome, type: "touch", bone: t.osso } });
  for (const t of on("texto")) if (t.doCodigo && slotsDoc.has(t.slot)) calls.push({ cmd: "role.set", args: { name: t.doCodigo, type: "text", slot: t.slot } });
  return { calls, avisos };
}

// ---- a proposta em linhas (a ponte, o MCP e o relatorio)
export function resumoTela(p: PropostaTela): string[] {
  const out: string[] = [];
  const [x, y, w, h] = p.arte.rect;
  out.push(`arte base ${w} x ${h} px${x || y ? ` em (${x}, ${y})` : ""}, encaixe ${p.arte.encaixe}: ${p.arte.porque}`);
  for (const i of p.itens) {
    const m = i.ligado ? "[x]" : "[ ]";
    const o =
      i.tipo === "ancora"
        ? `${i.osso} -> ${i.ancora}${i.esticar !== "none" ? ` estica ${i.esticar}` : ""}${i.cobre ? " cobre" : ""}${i.bloco ? ` (bloco: ${i.bloco.membros.length})` : ""}`
        : i.tipo === "botao"
          ? `botao ${i.nome} (osso ${i.osso}${i.slot ? `, estados ${Object.entries(i.estados).map(([e, a]) => `${NOME_DO_ESTADO[e as StateName]}=${a}`).join(" ")}` : ", estados padrao"})`
          : i.tipo === "toque"
            ? `toque ${i.nome} (osso ${i.osso})`
            : i.tipo === "texto"
              ? `texto ${i.slot}${i.doCodigo ? ` (do codigo: ${i.doCodigo})` : i.chave ? ` chave ${i.chave}` : ""}`
              : `nove-fatias ${i.slot} [${i.margens.join(", ")}]${i.acompanha ? ` acompanha ${i.acompanha.slot}` : ""}`;
    out.push(`${m} ${i.id.padEnd(22)} ${o}  <- ${i.camada}: ${i.porque}`);
  }
  for (const a of p.avisos) out.push(`Atencao: ${a}`);
  return out;
}
