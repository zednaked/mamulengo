// Pintar um mosaico no viewport (docs/NUCLEO.md "Mosaico"; comandos mosaic.*): pincel, borracha,
// retangulo, balde e a ferramenta de celula (cor, altura, giro, espelho, efeitos pelo painel). A
// grade aparece por cima; o clique acha a celula pela conta inversa do desenho do nucleo (osso do
// slot, depois a grade, o losango ou a perspectiva forcada). Um traco e um passo de desfazer: cada
// etapa manda todas as celulas tocadas ate ali, com o mesmo merge.
import { Color } from "@esotericsoftware/spine-webgl";
import type { Viewer } from "../render/viewer.ts";
import { app } from "./state.svelte.ts";
import { cursor } from "./interact.ts";
import { mosaics } from "../core/commands/mosaic.ts";

export type MosaicTool = "brush" | "erase" | "rect" | "fill" | "cell";
export type MosaicEdit = { name: string; tool: MosaicTool; image: number; cell: [number, number] | null };

export function startMosaicEdit(name: string, tool: MosaicTool = "brush"): boolean {
  const j: any = app.doc?.json;
  const m = j ? mosaics(j).find((x) => x.name === name) : null;
  if (!m) return false;
  app.meshEdit = null;
  app.drawEdit = null;
  app.mosaicEdit = { name, tool, image: m.palette?.length ? 0 : -1, cell: null };
  app.select({ slot: m.slot, bone: j.slots.find((s: any) => s.name === m.slot)?.bone });
  return true;
}

export function stopMosaicEdit() {
  app.mosaicEdit = null;
  traco = null;
}

// ---- a geometria (a mesma conta do nucleo: nucleo/src/desenho.cpp, "mosaicos")

type H = number[];
// a homografia do quadrado 0..1 (u para a direita, v para cima) para os cantos (baixo-esquerda,
// cima-esquerda, cima-direita, baixo-direita), como nucleo/src/leitor.cpp
function homografia(q: number[]): H | null {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [q[0], q[1], q[6], q[7], q[4], q[5], q[2], q[3]];
  const sx = x0 - x1 + x2 - x3,
    sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dy1 = y1 - y2,
    dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) return null;
  const g = (sx * dy2 - dx2 * sy) / den,
    h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
const aplica = (h: H, u: number, v: number) => {
  const z = h[6] * u + h[7] * v + h[8];
  return [(h[0] * u + h[1] * v + h[2]) / z, (h[3] * u + h[4] * v + h[5]) / z];
};
function inversa(h: H): H {
  const [a, b, c, d, e, f, g, i, k] = h;
  const A = e * k - f * i,
    B = -(d * k - f * g),
    C = d * i - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * k - c * i) / det, (b * f - c * e) / det, B / det, (a * k - c * g) / det, -(a * f - c * d) / det, C / det, -(a * i - b * g) / det, (a * e - b * d) / det];
}

// o mosaico com a conta pronta: grade continua (coluna, linha; a celula (c, r) vai de c a c+1 e de
// r a r+1) <-> espaco do esqueleto
function geometria(v: Viewer, m: any) {
  const j: any = app.doc!.json;
  const bone = j.slots.find((s: any) => s.name === m.slot)?.bone;
  const b = bone ? v.pose?.findBone(bone) : null;
  if (!b) return null;
  const [cw, ch] = m.cell;
  const iso = m.shape === "iso";
  const H = !iso && m.corners ? homografia(m.corners) : null;
  const Hi = H ? inversa(H) : null;
  const x = m.x ?? 0,
    y = m.y ?? 0;
  const local = (gc: number, gr: number): number[] => {
    if (iso) {
      const c = gc - 0.5,
        r = gr - 0.5;
      return [((c - r) * cw) / 2 + x, (-(c + r) * ch) / 2 + y];
    }
    if (H) return aplica(H, gc / m.columns, 1 - gr / m.rows);
    return [gc * cw + x, -gr * ch + y];
  };
  const paraEsqueleto = (gc: number, gr: number) => {
    const [lx, ly] = local(gc, gr);
    return [b.a * lx + b.b * ly + b.worldX, b.c * lx + b.d * ly + b.worldY];
  };
  const det = b.a * b.d - b.b * b.c || 1e-12;
  const daGrade = (sx: number, sy: number): [number, number] => {
    const px = sx - b.worldX,
      py = sy - b.worldY;
    const lx = (b.d * px - b.b * py) / det,
      ly = (-b.c * px + b.a * py) / det;
    if (iso) {
      const a = (lx - x) / (cw / 2),
        bb = -(ly - y) / (ch / 2);
      return [(a + bb) / 2 + 0.5, (bb - a) / 2 + 0.5];
    }
    if (Hi) {
      const [u, vv] = aplica(Hi, lx, ly);
      return [u * m.columns, (1 - vv) * m.rows];
    }
    return [(lx - x) / cw, -(ly - y) / ch];
  };
  return { paraEsqueleto, daGrade };
}

function mosaicoAtual(): { m: any; i: number } | null {
  const me = app.mosaicEdit;
  const j: any = app.doc?.json;
  if (!me || !j) return null;
  const i = mosaics(j).findIndex((x) => x.name === me.name);
  return i < 0 ? null : { m: mosaics(j)[i], i };
}

export function celulaEm(v: Viewer, sx: number, sy: number): [number, number] | null {
  const a = mosaicoAtual();
  const g = a && geometria(v, a.m);
  if (!a || !g) return null;
  const [gc, gr] = g.daGrade(sx, sy);
  const c = Math.floor(gc),
    r = Math.floor(gr);
  return c >= 0 && r >= 0 && c < a.m.columns && r < a.m.rows ? [c, r] : null;
}

// ---- o gesto

let traco: { merge: string; cells: Map<number, [number, number]>; de: [number, number] | null } | null = null;
export const mosaicDragging = () => !!traco;

function pinta(v: Viewer, sx: number, sy: number) {
  const me = app.mosaicEdit!;
  const a = mosaicoAtual();
  const at = celulaEm(v, sx, sy);
  if (!a || !at || !traco) return;
  const image = me.tool === "erase" ? null : me.image;
  if (image !== null && image < 0) return app.toast("Escolha uma imagem da paleta (ou acrescente uma).");
  if (me.tool === "rect") {
    traco.de ??= at;
    app.run({ cmd: "mosaic.paint", args: { name: me.name, image, at: traco.de, to: at } }, `pinta ${me.name}`, traco.merge, true);
    return;
  }
  const k = at[1] * a.m.columns + at[0];
  if (traco.cells.has(k)) return;
  traco.cells.set(k, at);
  app.run({ cmd: "mosaic.paint", args: { name: me.name, image, cells: [...traco.cells.values()] } }, `pinta ${me.name}`, traco.merge, true);
}

export function mosaicDown(v: Viewer, w: { x: number; y: number }): boolean {
  const me = app.mosaicEdit;
  if (!me) return false;
  const at = celulaEm(v, w.x, w.y);
  if (me.tool === "cell") {
    me.cell = at;
    return false;
  }
  if (!at) return false;
  if (me.tool === "fill") {
    app.run({ cmd: "mosaic.paint", args: { name: me.name, image: me.image < 0 ? null : me.image, at, flood: true } }, `balde em ${me.name}`);
    return false;
  }
  traco = { merge: `mosaico${Date.now()}`, cells: new Map(), de: null };
  pinta(v, w.x, w.y);
  return true;
}

export function mosaicMove(v: Viewer, w: { x: number; y: number }) {
  if (traco) pinta(v, w.x, w.y);
}

export function mosaicUp() {
  traco = null;
}

// ---- por cima do desenho: a grade, a celula sob o cursor e a escolhida

export function drawMosaicEdit(v: Viewer) {
  const a = mosaicoAtual();
  const g = a && geometria(v, a.m);
  if (!a || !g) return;
  const s = v.scene;
  const fy = v.flip ? -1 : 1;
  const linha = (c0: number, r0: number, c1: number, r1: number, cor: Color) => {
    const [x0, y0] = g.paraEsqueleto(c0, r0),
      [x1, y1] = g.paraEsqueleto(c1, r1);
    s.line(x0, y0 * fy, x1, y1 * fy, cor);
  };
  const fraca = new Color(1, 1, 1, 0.18),
    borda = new Color(1, 0.35, 0.75, 0.9);
  const { columns: C, rows: R } = a.m;
  // a grade toda e cara de ver numa grade enorme: linhas de 1 em 1 ate 128, depois a borda
  if (C <= 128 && R <= 128) {
    for (let c = 1; c < C; c++) linha(c, 0, c, R, fraca);
    for (let r = 1; r < R; r++) linha(0, r, C, r, fraca);
  }
  linha(0, 0, C, 0, borda);
  linha(C, 0, C, R, borda);
  linha(C, R, 0, R, borda);
  linha(0, R, 0, 0, borda);
  const caixa = (c: number, r: number, cor: Color, c1 = c, r1 = r) => {
    linha(c, r, c1 + 1, r, cor);
    linha(c1 + 1, r, c1 + 1, r1 + 1, cor);
    linha(c1 + 1, r1 + 1, c, r1 + 1, cor);
    linha(c, r1 + 1, c, r, cor);
  };
  const me = app.mosaicEdit!;
  if (me.cell) caixa(me.cell[0], me.cell[1], new Color(1, 0.82, 0.3, 1));
  if (cursor.inside) {
    const p = v.flip ? { x: cursor.x, y: -cursor.y } : cursor;
    const at = celulaEm(v, p.x, p.y);
    if (at) {
      const cor = me.tool === "erase" ? new Color(1, 0.3, 0.3, 1) : new Color(0.4, 1, 0.6, 1);
      if (me.tool === "rect" && traco?.de) caixa(Math.min(traco.de[0], at[0]), Math.min(traco.de[1], at[1]), cor, Math.max(traco.de[0], at[0]), Math.max(traco.de[1], at[1]));
      else caixa(at[0], at[1], cor);
    }
  }
}
