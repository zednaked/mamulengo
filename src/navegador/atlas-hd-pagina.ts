// Arte HD no editor pelo navegador, a parte da pagina: o service worker nao decodifica SVG, entao
// cada imagem e rasterizada aqui, pelo proprio navegador, e a pagina nova volta ao service worker
// (atlas-hd.ts) para gravar. O plano e o mesmo da ferramenta (src/core/atlas-hd.ts); muda o
// rasterizador (o do navegador no lugar do rsvg-convert e do magick) e a pagina sai em PNG sem
// perda (<pagina>-hd.png; o navegador nao grava WebP sem perda).
//
// Como na ferramenta: os objetos de cada imagem desenhados sozinhos (o resto do SVG vira <defs>,
// so referencia), numa escala que deixa a parte pelo menos 1,5 vez maior que o retangulo, sem o
// transparente em volta e reduzidos ao retangulo. Sem objeto (ou girada/cortada no atlas): a
// pagina original ampliada.
import { arquivoHd, ID_PARTE, svgDaParte, type ParteHd, type PlanoHd } from "../core/atlas-hd.ts";
import { codificarPng } from "./png.ts";

const SVGNS = "http://www.w3.org/2000/svg";
const arquivo = (p: string) => `/api/file?p=${encodeURIComponent(p)}`;

async function postar(url: string, body: BodyInit) {
  const r = await fetch(url, { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}

// o documento com os grupos pedidos no fim e todo o resto dentro de <defs> (nao desenha, mas os
// <use>, gradientes e filtros continuam achando)
function soAsPartes(svg: string, grupos: string[][]): SVGSVGElement {
  let texto = svg;
  grupos.forEach((ids, i) => (texto = svgDaParte(texto, ids, `${ID_PARTE}_${i}`)));
  const doc = new DOMParser().parseFromString(texto, "image/svg+xml");
  const raiz = doc.documentElement as unknown as SVGSVGElement;
  if (raiz.localName !== "svg" || doc.querySelector("parsererror")) throw new Error("o SVG nao abriu (arquivo com erro?)");
  const defs = doc.createElementNS(SVGNS, "defs");
  const partes = new Set(grupos.map((_, i) => `${ID_PARTE}_${i}`));
  for (const n of [...raiz.childNodes]) if (!(n instanceof Element && partes.has(n.getAttribute("id") ?? ""))) defs.appendChild(n);
  raiz.insertBefore(defs, raiz.firstChild);
  return raiz;
}

// a caixa de cada parte, nas unidades do SVG (o documento entra na pagina, escondido, so para medir)
function medir(svg: string, grupos: string[][]): DOMRect[] {
  const raiz = document.importNode(soAsPartes(svg, grupos), true);
  const caixa = document.createElement("div");
  caixa.style.cssText = "position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
  caixa.appendChild(raiz);
  document.body.appendChild(caixa);
  try {
    return grupos.map((_, i) => (raiz.querySelector(`[id="${ID_PARTE}_${i}"]`) as SVGGElement).getBBox());
  } finally {
    caixa.remove();
  }
}

// a parte rasterizada pelo navegador, sem o transparente em volta
async function rasterizar(svg: string, ids: string[], bb: DOMRect, w: number, h: number) {
  // folga para contorno e filtro (que a caixa geometrica nao conta); o corte tira a sobra
  const folga = Math.max(bb.width, bb.height) * 0.25 + 2;
  const zoom = Math.max(1, (w / Math.max(bb.width, 1e-6)) * 1.5, (h / Math.max(bb.height, 1e-6)) * 1.5);
  const [vx, vy, vw, vh] = [bb.x - folga, bb.y - folga, bb.width + 2 * folga, bb.height + 2 * folga];
  const [cw, ch] = [Math.ceil(vw * zoom), Math.ceil(vh * zoom)];
  const raiz = soAsPartes(svg, [ids]);
  for (const a of ["x", "y"]) raiz.removeAttribute(a);
  raiz.setAttribute("width", String(cw));
  raiz.setAttribute("height", String(ch));
  raiz.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  raiz.setAttribute("preserveAspectRatio", "none");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(raiz)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(cw, ch);
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, cw, ch);
    // o corte: as linhas e colunas sem nada (como o -trim do magick)
    const d = g.getImageData(0, 0, cw, ch).data;
    let [x0, y0, x1, y1] = [cw, ch, -1, -1];
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++)
        if (d[(y * cw + x) * 4 + 3]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    return { c, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// a pagina nova inteira, em RGBA
export async function montarPaginaHd(svg: string, plano: PlanoHd, original: () => Promise<Blob | null>): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const doVetor = plano.partes.filter((p) => p.ids.length);
  const caixas = doVetor.length ? medir(svg, doVetor.map((p) => p.ids)) : [];
  const [lg, al] = plano.tamanho;
  const c = new OffscreenCanvas(lg, al);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  let pagina: Blob | null | undefined;
  const daPagina = async (p: ParteHd) => {
    pagina ??= await original();
    if (!pagina) throw new Error(`a página original (${plano.arquivo}) não abriu`);
    const [ox, oy, rw, rh] = p.recorte;
    const bm = await createImageBitmap(pagina, ox, oy, rw, rh);
    g.drawImage(bm, p.ret[0], p.ret[1], p.ampliada[0], p.ampliada[1]);
    bm.close();
  };
  for (const p of plano.partes) {
    const [x, y, w, h] = p.ret;
    if (!p.ids.length) {
      await daPagina(p);
      continue;
    }
    const r = await rasterizar(svg, p.ids, caixas[doVetor.indexOf(p)], w, h);
    // objeto que nao desenha nada: o retangulo fica vazio, como na ferramenta
    if (r) g.drawImage(r.c, r.x, r.y, r.w, r.h, x, y, w, h);
  }
  const d = g.getImageData(0, 0, lg, al);
  return { data: d.data, width: lg, height: al };
}

// a arte HD do .boneco: plano no service worker, pagina aqui, gravacao no service worker
export async function arteHdNoNavegador(boneco: string, svg: Blob | null, fator: number, id: string, pagina = 0) {
  const q = `boneco=${encodeURIComponent(boneco)}&fator=${fator}&id=${encodeURIComponent(id)}&pagina=${pagina}`;
  const { plano, svg: svgPath, original } = (await postar(`/api/atlas-hd/plano?${q}`, svg ?? new Blob([]))) as { plano: PlanoHd; svg: string; original: string };
  const texto = await fetch(arquivo(svgPath)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`não li ${svgPath}`))));
  const rgba = await montarPaginaHd(texto, plano, () => fetch(arquivo(original)).then((r) => (r.ok ? r.blob() : null)));
  const png = await codificarPng(rgba.data, rgba.width, rgba.height);
  return postar(`/api/atlas-hd/gravar?${q}&arquivo=${encodeURIComponent(arquivoHd(plano.arquivo, "png"))}`, new Blob([png as BlobPart], { type: "image/png" }));
}
