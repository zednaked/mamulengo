// A pagina dos desenhos no editor: as formas de `drawings` (src/core/desenho.ts) viram a pagina
// <personagem>-desenhos.png do atlas, desenhada aqui num canvas. Cada mudanca nas formas redesenha
// a pagina e troca so a textura dela; imagem nova ou de outro tamanho muda o arranjo, e ai o atlas
// inteiro e recarregado. Ao salvar, a pagina vai para o disco ao lado do personagem.
import type { Document } from "../core/document.ts";
import type { Viewer } from "../render/viewer.ts";
import { segsDoTraco, tracoVariavel } from "../core/lapis.ts";
import { atlasWithDrawings, drawingPageName, drawingsOf, layoutDrawings, layoutKey, shapeOutline, stripPage, trace, type DrawLayout, type DrawShape, type Drawing } from "../core/desenho.ts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const css = (c: string) => "#" + c;

// o caminho da forma com os furos (preenche e recorta par-impar)
export function shapePath(s: DrawShape): Path2D {
  const p = new Path2D();
  trace(p, shapeOutline(s));
  return p;
}

// uma forma no contexto (ja na escala da imagem): preenchimento, depois o traco
function drawShape(g: Ctx, s: DrawShape, w: number, h: number, scale: number, ox: number, oy: number) {
  if (s.hidden || !s.points.length) return;
  const path = shapePath(s);
  if (s.fill) {
    g.fillStyle = css(s.fill);
    g.fill(path, s.rule ?? "evenodd");
  }
  const st = s.stroke;
  if (!st || st.width <= 0) return;
  // o lapis: a largura muda ao longo do caminho, e o traco e um poligono preenchido
  if (tracoVariavel(s)) {
    const p = new Path2D();
    trace(p, segsDoTraco(s, Math.max(0.25, 1 / scale)));
    g.fillStyle = css(st.color);
    g.fill(p, "nonzero");
    return;
  }
  const style = (c: Ctx, width: number) => {
    c.strokeStyle = css(st.color);
    c.lineWidth = width;
    c.lineJoin = st.join ?? "miter";
    c.lineCap = st.cap ?? "butt";
    c.miterLimit = 4;
  };
  // por dentro e por fora so valem no contorno fechado (como no Figma, o aberto fica no centro)
  const align = s.closed ? (st.align ?? "center") : "center";
  if (align === "center") {
    style(g, st.width);
    g.stroke(path);
  } else if (align === "inside") {
    g.save();
    g.clip(path, s.rule ?? "evenodd");
    style(g, st.width * 2);
    g.stroke(path);
    g.restore();
  } else {
    // por fora: traco dobrado num canvas a parte, com o miolo apagado
    const c = new OffscreenCanvas(Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)));
    const t = c.getContext("2d")!;
    t.scale(scale, scale);
    style(t, st.width * 2);
    t.stroke(path);
    t.globalCompositeOperation = "destination-out";
    t.fill(path, s.rule ?? "evenodd");
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(c, ox, oy);
    g.restore();
  }
}

// o desenho inteiro em g, com a origem da imagem em (ox, oy) da pagina e scale pixels por pixel
// (base: a pintura do desenho, por baixo das formas)
export function drawDrawing(g: Ctx, d: Drawing, ox: number, oy: number, scale: number, base?: CanvasImageSource | null) {
  g.save();
  g.beginPath();
  g.rect(ox, oy, Math.ceil(d.width * scale), Math.ceil(d.height * scale));
  g.clip();
  g.setTransform(scale, 0, 0, scale, ox, oy);
  if (base) g.drawImage(base, 0, 0, d.width, d.height);
  for (const s of d.shapes) drawShape(g, s, d.width, d.height, scale, ox, oy);
  g.restore();
}

export type BaseDe = (image: string, d: Drawing) => CanvasImageSource | null;

export function renderPage(drawings: Record<string, Drawing>, layout: DrawLayout, base?: BaseDe): OffscreenCanvas {
  const c = new OffscreenCanvas(layout.width, layout.height);
  const g = c.getContext("2d")!;
  for (const r of layout.regions) {
    const d = drawings[r.name];
    if (d) drawDrawing(g, d, r.x, r.y, r.hd, base?.(r.name, d));
  }
  return c;
}

// pixels de uma imagem desenhada em 1x (malha automatica pelo alpha)
export function drawingPixels(d: Drawing): { width: number; height: number; data: Uint8ClampedArray } {
  const w = Math.max(1, Math.ceil(d.width)),
    h = Math.max(1, Math.ceil(d.height));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d")!;
  drawDrawing(g, d, 0, 0, 1);
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data };
}

export class Desenhos {
  page = "";
  layout: DrawLayout | null = null;
  private key = "";
  private canvas: OffscreenCanvas | null = null;
  private agendado = 0;
  private recarregar: (() => Promise<void>) | null = null;
  // a pintura de cada desenho, por baixo das formas (src/app/pinturas.ts)
  base: BaseDe | undefined;
  private subindo = 0;
  private sujo: [number, number, number, number] | null = null;

  // ao abrir: o atlas do documento passa a ter a pagina dos desenhos certa (ou nenhuma)
  preparar(doc: Document) {
    this.page = doc.file.atlas ? drawingPageName(doc.file.atlas) : "";
    this.layout = layoutDrawings(drawingsOf(doc.json));
    this.key = layoutKey(this.layout);
    doc.atlas = { ...doc.atlas, text: atlasWithDrawings(doc.atlas.text, this.page, this.layout) };
    this.canvas = this.layout ? renderPage(drawingsOf(doc.json), this.layout, this.base) : null;
  }

  // a imagem da pagina dos desenhos, para o viewer (as outras paginas vem do servidor)
  async bitmap(page: string): Promise<ImageBitmap | null> {
    if (!this.page || page !== this.page || !this.canvas) return null;
    return createImageBitmap(this.canvas, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }

  // as formas mudaram: redesenha no proximo quadro (um arrasto vira um redesenho por quadro)
  agendar(doc: Document, viewer: Viewer | null, recarregar: () => Promise<void>) {
    this.recarregar = recarregar;
    if (this.agendado) return;
    this.agendado = requestAnimationFrame(() => {
      this.agendado = 0;
      void this.atualizar(doc, viewer);
    });
  }

  // a pintura de uma imagem mudou (um remendo do pintor): so o retangulo dela e redesenhado, e a
  // pagina sobe para a placa uma vez por quadro
  // (ret: o que mudou, em pixels da imagem; sem ele, a imagem inteira)
  pintar(doc: Document, viewer: Viewer | null, image: string, ret?: [number, number, number, number]) {
    const r = this.layout?.regions.find((x) => x.name === image);
    const d = drawingsOf(doc.json)[image];
    if (!r || !d || !this.canvas) return;
    const g = this.canvas.getContext("2d", { willReadFrequently: true })!;
    // o retangulo na pagina (a imagem pode estar em outra escala), com um pixel de folga
    const [ix, iy, iw, ih] = ret ?? [0, 0, d.width, d.height];
    const x0 = Math.max(r.x, Math.floor(r.x + ix * r.hd) - 1),
      y0 = Math.max(r.y, Math.floor(r.y + iy * r.hd) - 1),
      x1 = Math.min(r.x + r.w, Math.ceil(r.x + (ix + iw) * r.hd) + 1),
      y1 = Math.min(r.y + r.h, Math.ceil(r.y + (iy + ih) * r.hd) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    g.clearRect(x0, y0, x1 - x0, y1 - y0);
    drawDrawing(g, d, r.x, r.y, r.hd, this.base?.(image, d));
    g.restore();
    if (!viewer) return;
    // junta os remendos ate o proximo quadro e manda so esse retangulo para a placa
    const s = this.sujo;
    this.sujo = s ? [Math.min(s[0], x0), Math.min(s[1], y0), Math.max(s[2], x1), Math.max(s[3], y1)] : [x0, y0, x1, y1];
    if (this.subindo) return;
    this.subindo = requestAnimationFrame(() => {
      this.subindo = 0;
      const q = this.sujo;
      this.sujo = null;
      if (!this.canvas || !q) return;
      const dados = this.canvas.getContext("2d")!.getImageData(q[0], q[1], q[2] - q[0], q[3] - q[1]).data;
      if (!viewer.remendarPagina(this.page, q[0], q[1], q[2] - q[0], q[3] - q[1], dados)) void viewer.trocarPagina(this.page, this.canvas);
    });
  }

  private async atualizar(doc: Document, viewer: Viewer | null) {
    const drawings = drawingsOf(doc.json);
    const layout = layoutDrawings(drawings);
    const key = layoutKey(layout);
    this.layout = layout;
    this.canvas = layout ? renderPage(drawings, layout, this.base) : null;
    if (key !== this.key) {
      // arranjo novo: o atlas muda e o viewer rele tudo
      this.key = key;
      doc.atlas = { ...doc.atlas, text: atlasWithDrawings(doc.atlas.text, this.page, layout) };
      await this.recarregar?.();
      return;
    }
    if (viewer && this.canvas) await viewer.trocarPagina(this.page, this.canvas);
  }

  // ao salvar: a pagina (PNG) vai para o disco; devolve o texto do atlas para gravar
  async png(doc: Document): Promise<Blob | null> {
    const layout = layoutDrawings(drawingsOf(doc.json));
    if (!layout) return null;
    return renderPage(drawingsOf(doc.json), layout, this.base).convertToBlob({ type: "image/png" });
  }

  // o atlas do documento sem nenhum desenho (para saber se so a pagina dos desenhos mudou)
  semDesenhos(text: string) {
    return this.page ? stripPage(text, this.page) : text;
  }
}
