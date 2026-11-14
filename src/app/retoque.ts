// Balde e laco do Atelie. Rodam no editor (sem o pintor): o balde enche a tinta por baixo das
// linhas, olhando o desenho inteiro (pintura mais formas vetoriais); o laco escolhe um pedaco, que
// se move, estica (por canto ou por lado; passando do outro lado, espelha) e gira, com a tinta e as
// formas que estao inteiras dentro dele, ou se apaga. Se o pedaco sai da folha, a folha cresce.
// Os pixels e o desfazer ficam em src/app/pinturas.ts; quem chama e src/app/drawedit.ts.
import { app } from "./state.svelte.ts";
import { drawingsOf, flatten, shapeBounds, type DrawStroke, type Drawing, type Vec } from "../core/desenho.ts";
import { drawDrawing } from "./desenho.ts";
import { remendou } from "./pintura.ts";

type Ret = [number, number, number, number];
// afim [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (a ordem do setTransform)
export type Afim = [number, number, number, number, number, number];
const leva = (m: Afim, p: Vec): Vec => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const gira = (ang: number, v: Vec): Vec => [Math.cos(ang) * v[0] - Math.sin(ang) * v[1], Math.sin(ang) * v[0] + Math.cos(ang) * v[1]];

// o tamanho maximo de uma folha que cresce: o pintor (o ProCraft) devolve a imagem ate 2048 de lado,
// com a margem que deixa a pincelada passar da borda
export const FOLHA_MAX = 2048;
// quanto a folha precisa crescer para caber a caixa [x0, y0, x1, y1] (com folga), ou null
export function crescimento(w: number, h: number, c: [number, number, number, number], folga = 24): [l: number, t: number, r: number, b: number] | null {
  let l = c[0] < 0 ? Math.ceil(-c[0] + folga) : 0,
    t = c[1] < 0 ? Math.ceil(-c[1] + folga) : 0,
    r = c[2] > w ? Math.ceil(c[2] - w + folga) : 0,
    b = c[3] > h ? Math.ceil(c[3] - h + folga) : 0;
  if (!l && !t && !r && !b) return null;
  // nao passa do maximo: corta o que sobra igualmente dos dois lados
  const sobraX = w + l + r - FOLHA_MAX,
    sobraY = h + t + b - FOLHA_MAX;
  if (sobraX > 0) (l = Math.max(0, l - Math.ceil(sobraX / 2))), (r = Math.max(0, FOLHA_MAX - w - l));
  if (sobraY > 0) (t = Math.max(0, t - Math.ceil(sobraY / 2))), (b = Math.max(0, FOLHA_MAX - h - t));
  return l || t || r || b ? [l, t, r, b] : null;
}

function dentro(pts: Vec[], x: number, y: number): boolean {
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}
const caixaDe = (pts: Vec[]): Ret => {
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
};
// o retangulo em pixels inteiros, com folga, dentro da folha (null: nada)
function recorte(r: Ret, w: number, h: number, folga = 2): Ret | null {
  const x0 = Math.max(0, Math.floor(r[0]) - folga),
    y0 = Math.max(0, Math.floor(r[1]) - folga),
    x1 = Math.min(w, Math.ceil(r[0] + r[2]) + folga),
    y1 = Math.min(h, Math.ceil(r[1] + r[3]) + folga);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}
const une = (a: Ret, b: Ret): Ret => {
  const x = Math.min(a[0], b[0]),
    y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
};
function caminho(g: OffscreenCanvasRenderingContext2D, pts: Vec[]) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
}

const desenho = (image: string): Drawing | null => (app.doc && drawingsOf(app.doc.json)[image]) || null;
function mostra(image: string, ret?: Ret) {
  if (!app.doc) return;
  remendou();
  app.desenhos.pintar(app.doc, app.viewer, image, ret);
}

// ---- o balde

// enche a partir do ponto (u, w) da imagem: a regiao de cor parecida no desenho inteiro (tinta mais
// formas), com `limiar` de 0 a 1. A cor entra na tinta, por baixo das linhas. Devolve se pintou.
export function balde(image: string, u: number, w: number, corHex: string, limiar: number): boolean {
  const d = desenho(image);
  if (!d) return false;
  soltar();
  const t = app.pinturas.de(image, d);
  const W = t.w,
    H = t.h;
  const sx = Math.floor(u),
    sy = Math.floor(w);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return false;
  const junto = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true })!;
  drawDrawing(junto, d, 0, 0, 1, t.canvas);
  const C = junto.getImageData(0, 0, W, H).data;
  const tol = Math.max(1, limiar * 255);
  const s0 = (sy * W + sx) * 4;
  const a0 = C[s0 + 3],
    r0 = (C[s0] * a0) / 255,
    g0 = (C[s0 + 1] * a0) / 255,
    b0 = (C[s0 + 2] * a0) / 255;
  const parecido = (i: number) => {
    const o = i * 4,
      a = C[o + 3];
    return Math.abs(a - a0) <= tol && Math.abs((C[o] * a) / 255 - r0) <= tol && Math.abs((C[o + 1] * a) / 255 - g0) <= tol && Math.abs((C[o + 2] * a) / 255 - b0) <= tol;
  };
  // 1: a regiao; 2 e 3: duas voltas de borda (a cor entra por baixo da beirada da linha)
  const m = new Uint8Array(W * H);
  const pilha = new Int32Array(W * H);
  let n = 0;
  pilha[n++] = sy * W + sx;
  m[sy * W + sx] = 1;
  while (n) {
    const i = pilha[--n];
    const x = i % W;
    const viz = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
    for (const k of viz) {
      if (k < 0 || k >= W * H || m[k] || !parecido(k)) continue;
      m[k] = 1;
      pilha[n++] = k;
    }
  }
  for (const volta of [2, 3]) {
    for (let i = 0; i < W * H; i++) {
      if (m[i] || parecido(i)) continue;
      const x = i % W;
      const de = volta - 1;
      if ((x > 0 && m[i - 1] === de) || (x < W - 1 && m[i + 1] === de) || (i >= W && m[i - W] === de) || (i < W * H - W && m[i + W] === de)) m[i] = volta;
    }
  }
  // dentro da selecao, se houver uma nesta imagem
  const s = sel?.image === image ? sel.pontos : null;
  const P = t.g.getImageData(0, 0, W, H);
  const antes = new ImageData(new Uint8ClampedArray(P.data), W, H);
  const p = P.data;
  const fr = parseInt(corHex.slice(0, 2), 16),
    fg = parseInt(corHex.slice(2, 4), 16),
    fb = parseInt(corHex.slice(4, 6), 16),
    fa = corHex.length >= 8 ? parseInt(corHex.slice(6, 8), 16) / 255 : 1;
  // em cima do vazio a cor entra por baixo do que ja ha; em cima de tinta, troca a cor dela
  const troca = a0 >= 24 && p[s0 + 3] >= 24;
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (!m[i]) continue;
    const x = i % W,
      y = (i - x) / W;
    if (s && !dentro(s, x + 0.5, y + 0.5)) continue;
    const o = i * 4;
    if (m[i] === 1 && troca) {
      p[o] = fr;
      p[o + 1] = fg;
      p[o + 2] = fb;
      p[o + 3] = Math.round(fa * 255);
    } else {
      const pa = p[o + 3] / 255;
      const k = fa * (1 - pa);
      const oa = pa + k;
      if (oa <= 0) continue;
      p[o] = Math.round((p[o] * pa + fr * k) / oa);
      p[o + 1] = Math.round((p[o + 1] * pa + fg * k) / oa);
      p[o + 2] = Math.round((p[o + 2] * pa + fb * k) / oa);
      p[o + 3] = Math.round(oa * 255);
    }
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < x0) return false;
  t.g.putImageData(P, 0, 0);
  const ret: Ret = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  const rev = app.pinturas.registrar(image, d, antes, ret);
  mostra(image, ret);
  app.run({ cmd: "paint.set", args: { image, rev } }, "balde");
  return true;
}

// ---- o laco: a selecao e o pedaco solto

interface Selecao {
  image: string;
  pontos: Vec[];
}
// o pedaco tirado do lugar: a tinta recortada e as formas inteiras dentro do laco, andando juntas.
// A transformacao: p -> c0 + desl + R(ang) S(sx, sy) (p - c0), com c0 o centro da caixa do laco
interface Solto {
  image: string;
  pontos0: Vec[];
  c0: Vec;
  meia: Vec;
  antes: ImageData | null;
  fundo: OffscreenCanvas | null;
  peca: OffscreenCanvas | null;
  formas: number[];
  // o traco de cada forma como era (a largura acompanha a escala)
  tracos: (DrawStroke | undefined)[];
  desl: Vec;
  ang: number;
  sx: number;
  sy: number;
  // as formas ja foram mexidas (um passo de desfazer que cada arrasto refaz por inteiro: o merge
  // do documento desfaz o anterior e aplica o novo, entao os comandos levam do lugar original)
  vetor: boolean;
  merge: string;
}
type Pega = { tipo: "mover" } | { tipo: "gira" } | { tipo: "canto" | "lado"; i: number };
interface Gesto {
  pega: Pega;
  de: Vec;
  desl0: Vec;
  ang0: number;
  sx0: number;
  sy0: number;
  andou: boolean;
}
let sel: Selecao | null = null;
let laco: Vec[] | null = null;
let solto: Solto | null = null;
let gesto: Gesto | null = null;
let seq = 0;
// depois de mexer nas formas a imagem pode precisar crescer (src/app/drawedit.ts liga)
export const ganchos = { vetorMudou: () => {} };

export const selecao = () => sel;
// a folha cresceu l para a esquerda e t para cima: a selecao anda junto (o que ela marca fica no lugar)
export function deslocarSelecao(image: string, l: number, t: number) {
  if (sel?.image === image && (l || t)) sel = { image, pontos: sel.pontos.map((p) => [p[0] + l, p[1] + t] as Vec) };
}
export const lacando = () => laco;
export const retocando = () => laco !== null || gesto !== null;
export const temSolto = () => solto !== null;

const afimDe = (s: Solto): Afim => {
  const c = Math.cos(s.ang),
    n = Math.sin(s.ang);
  const a = c * s.sx,
    b = n * s.sx,
    cc = -n * s.sy,
    d = c * s.sy;
  const C: Vec = [s.c0[0] + s.desl[0], s.c0[1] + s.desl[1]];
  return [a, b, cc, d, C[0] - (a * s.c0[0] + cc * s.c0[1]), C[1] - (b * s.c0[0] + d * s.c0[1])];
};
// os cantos (0 em cima a esquerda, no sentido do relogio) e os meios dos lados (0 em cima, 1 a
// direita, 2 embaixo, 3 a esquerda), em coordenadas da caixa (centro 0)
const CANTOS: Vec[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const LADOS: Vec[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// o pedaco solto, para quem desenha por cima (o que passa da folha aparece antes de ela crescer)
export function pecaSolta(): { image: string; peca: OffscreenCanvas; m: Afim } | null {
  return solto?.peca ? { image: solto.image, peca: solto.peca, m: afimDe(solto) } : null;
}

// a selecao como esta agora (com o pedaco solto, ja no lugar novo)
export function contornoDaSelecao(): Vec[] | null {
  if (!sel) return null;
  if (!solto) return sel.pontos;
  const m = afimDe(solto);
  return solto.pontos0.map((p) => leva(m, p));
}
// a caixa da selecao: os cantos, os meios dos lados e a alca de girar (acima do meio de cima)
export function caixaDaSelecao(k: number): { cantos: Vec[]; lados: Vec[]; gira: Vec; centro: Vec } | null {
  if (!sel) return null;
  const base = solto ? solto.pontos0 : sel.pontos;
  const [x, y, w, h] = caixaDe(base);
  const c0: Vec = [x + w / 2, y + h / 2];
  const m: Afim = solto ? afimDe(solto) : [1, 0, 0, 1, 0, 0];
  const em = (v: Vec) => leva(m, [c0[0] + (v[0] * w) / 2, c0[1] + (v[1] * h) / 2]);
  const cantos = CANTOS.map(em),
    lados = LADOS.map(em);
  const centro = leva(m, c0);
  const topo = lados[0];
  let dx = topo[0] - centro[0],
    dy = topo[1] - centro[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) (dx = 0), (dy = -1);
  else (dx /= l), (dy /= l);
  return { cantos, lados, gira: [topo[0] + dx * (26 / k), topo[1] + dy * (26 / k)], centro };
}

function formasDentro(d: Drawing, pts: Vec[]): number[] {
  const out: number[] = [];
  d.shapes.forEach((s, i) => {
    if (s.hidden || !s.points.length) return;
    const fl = flatten(s, 6);
    if (fl.length && fl.every((p) => dentro(pts, p[0], p[1]))) out.push(i);
  });
  return out;
}

// tira o pedaco do lugar (no primeiro arrasto)
function levantar(): Solto | null {
  if (!sel) return null;
  const d = desenho(sel.image);
  if (!d) return null;
  const formas = formasDentro(d, sel.pontos);
  const [x, y, w, h] = caixaDe(sel.pontos);
  const s: Solto = {
    image: sel.image,
    pontos0: sel.pontos,
    c0: [x + w / 2, y + h / 2],
    meia: [Math.max(w, 1) / 2, Math.max(h, 1) / 2],
    antes: null,
    fundo: null,
    peca: null,
    formas,
    tracos: formas.map((i) => structuredClone(d.shapes[i].stroke)),
    desl: [0, 0],
    ang: 0,
    sx: 1,
    sy: 1,
    vetor: false,
    merge: `laco${++seq}`,
  };
  if (app.pinturas.tem(sel.image)) {
    const t = app.pinturas.de(sel.image, d);
    s.antes = t.g.getImageData(0, 0, t.w, t.h);
    const peca = new OffscreenCanvas(t.w, t.h);
    const gp = peca.getContext("2d")!;
    caminho(gp, sel.pontos);
    gp.clip();
    gp.drawImage(t.canvas, 0, 0);
    const fundo = new OffscreenCanvas(t.w, t.h);
    const gf = fundo.getContext("2d")!;
    gf.drawImage(t.canvas, 0, 0);
    gf.globalCompositeOperation = "destination-out";
    caminho(gf, sel.pontos);
    gf.fill();
    s.peca = peca;
    s.fundo = fundo;
  }
  return s;
}

// a tinta com o pedaco no lugar de agora, numa folha deslocada de (ox, oy)
function redesenhar(s: Solto, g: OffscreenCanvasRenderingContext2D, w: number, h: number, ox = 0, oy = 0) {
  if (!s.fundo || !s.peca) return;
  const m = afimDe(s);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.drawImage(s.fundo, ox, oy);
  g.setTransform(m[0], m[1], m[2], m[3], m[4] + ox, m[5] + oy);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(s.peca, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// o pedaco no lugar de agora: a tinta redesenhada e as formas levadas ate la
function assentar(s: Solto) {
  const d = desenho(s.image);
  if (!d) return;
  if (s.fundo && s.peca) {
    const t = app.pinturas.de(s.image, d);
    redesenhar(s, t.g, t.w, t.h);
    mostra(s.image);
  }
  const calls = comandosDasFormas(s);
  if (calls.length && app.run(calls, "transforma a seleção", s.merge)) s.vetor = true;
}

// as formas levadas do lugar original pela transformacao inteira
function comandosDasFormas(s: Solto): any[] {
  if (!s.formas.length) return [];
  const calls: any[] = [];
  const parado = Math.abs(s.sx - 1) < 1e-6 && Math.abs(s.sy - 1) < 1e-6 && Math.abs(s.ang) < 1e-6;
  if (!parado) calls.push({ cmd: "draw.transform", args: { image: s.image, shapes: s.formas, rotation: (s.ang * 180) / Math.PI, scale: [s.sx, s.sy], about: s.c0 } });
  if (Math.abs(s.desl[0]) > 1e-6 || Math.abs(s.desl[1]) > 1e-6) calls.push({ cmd: "draw.move", args: { image: s.image, shapes: s.formas, dx: s.desl[0], dy: s.desl[1] } });
  // a largura do traco acompanha a escala
  const k = Math.sqrt(Math.abs(s.sx * s.sy));
  if (Math.abs(k - 1) > 1e-6)
    s.formas.forEach((i, n) => {
      const st = s.tracos[n];
      if (st) calls.push({ cmd: "draw.set", args: { image: s.image, shape: i, stroke: { width: Math.max(0.1, st.width * k), ...(st.taper ? { taper: [st.taper[0] * k, st.taper[1] * k] } : {}) } } });
    });
  return calls;
}

const parado = (s: Solto) => Math.abs(s.sx - 1) < 1e-9 && Math.abs(s.sy - 1) < 1e-9 && Math.abs(s.ang) < 1e-9 && Math.abs(s.desl[0]) < 1e-9 && Math.abs(s.desl[1]) < 1e-9;

// o pedaco fica onde esta (um passo de desfazer, com a folha crescendo se ele saiu dela); a selecao
// continua, no lugar novo
export function soltar() {
  const s = solto;
  solto = null;
  gesto = null;
  if (!s) return;
  const d = desenho(s.image);
  const m = afimDe(s);
  const novo = s.pontos0.map((p) => leva(m, p));
  if (sel?.image === s.image) sel = { image: s.image, pontos: novo };
  if (!d || parado(s)) return;
  // o passo final leva as formas e a tinta juntas (o merge troca o passo dos arrastos por este)
  const calls = s.vetor ? comandosDasFormas(s) : [];
  const [nx, ny, nw, nh] = caixaDe(novo);
  const cresce = crescimento(d.width, d.height, [nx, ny, nx + nw, ny + nh]);
  if (cresce) {
    const [l, tp, r, b] = cresce;
    let revCresce: string;
    if (s.antes) {
      // a folha cresce com os pixels de antes do laco; depois o pedaco entra no lugar novo
      const t = app.pinturas.de(s.image, d);
      t.g.putImageData(s.antes, 0, 0);
      revCresce = app.pinturas.crescer(s.image, d, l, tp, r, b);
      const antesGrande = t.g.getImageData(0, 0, t.w, t.h);
      redesenhar(s, t.g, t.w, t.h, l, tp);
      const ret = recorte(une(caixaDe(s.pontos0.map((p) => [p[0] + l, p[1] + tp] as Vec)), [nx + l, ny + tp, nw, nh]), t.w, t.h, 3) ?? [0, 0, t.w, t.h];
      const rev = app.pinturas.registrar(s.image, { width: t.w, height: t.h } as Drawing, antesGrande, ret);
      calls.push({ cmd: "paint.grow", args: { image: s.image, left: l, top: tp, right: r, bottom: b, rev: revCresce } }, { cmd: "paint.set", args: { image: s.image, rev } });
    } else if (d.raster) {
      revCresce = app.pinturas.crescer(s.image, d, l, tp, r, b);
      calls.push({ cmd: "paint.grow", args: { image: s.image, left: l, top: tp, right: r, bottom: b, rev: revCresce } });
    }
    if (sel?.image === s.image) sel = { image: s.image, pontos: novo.map((p) => [p[0] + l, p[1] + tp] as Vec) };
  } else if (s.antes) {
    const t = app.pinturas.de(s.image, d);
    const ret = recorte(une(caixaDe(s.pontos0), caixaDe(novo)), t.w, t.h, 3);
    if (ret) calls.push({ cmd: "paint.set", args: { image: s.image, rev: app.pinturas.registrar(s.image, d, s.antes, ret) } });
  }
  if (calls.length) app.run(calls, "transforma a seleção", s.merge);
  if (cresce || s.antes) mostra(s.image);
  if (s.vetor) ganchos.vetorMudou();
}

// o pedaco volta para onde estava
export function desistir() {
  const s = solto;
  solto = null;
  gesto = null;
  if (!s) return;
  const d = desenho(s.image);
  if (d && s.antes) {
    app.pinturas.de(s.image, d).g.putImageData(s.antes, 0, 0);
    mostra(s.image);
  }
  if (s.vetor) app.undo();
}

export function semSelecao() {
  soltar();
  sel = null;
  laco = null;
}

// espelha o pedaco escolhido (na horizontal ou na vertical da caixa), sem tirar do lugar
export function espelhar(vertical: boolean) {
  if (!sel) return;
  solto ??= levantar();
  if (!solto) return;
  if (vertical) solto.sy = -solto.sy;
  else solto.sx = -solto.sx;
  assentar(solto);
}

// tudo o que ha no quadro (tinta e formas), como uma selecao
export function selecionarTudo(image: string): boolean {
  const d = desenho(image);
  if (!d) return false;
  soltar();
  let c: Ret | null = null;
  const soma = (r: Ret) => (c = c ? une(c, r) : r);
  if (app.pinturas.tem(image)) {
    const t = app.pinturas.de(image, d);
    const px = t.g.getImageData(0, 0, t.w, t.h).data;
    let x0 = t.w,
      y0 = t.h,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++)
        if (px[(y * t.w + x) * 4 + 3] > 2) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 >= x0) soma([x0, y0, x1 - x0 + 1, y1 - y0 + 1]);
  }
  for (const s of d.shapes) {
    if (s.hidden) continue;
    const b = shapeBounds(s);
    const g = (s.stroke?.width ?? 0) / 2;
    if (b) soma([b[0] - g, b[1] - g, b[2] - b[0] + g * 2, b[3] - b[1] + g * 2]);
  }
  if (!c) return false;
  const [x, y, w, h] = c as Ret;
  sel = { image, pontos: [[x - 3, y - 3], [x + w + 3, y - 3], [x + w + 3, y + h + 3], [x - 3, y + h + 3]] };
  return true;
}

// apaga o que esta dentro da selecao (tinta e formas inteiras)
export function apagarSelecao(): boolean {
  if (solto) desistir();
  if (!sel) return false;
  const d = desenho(sel.image);
  if (!d) return false;
  const calls: any[] = [];
  if (app.pinturas.tem(sel.image)) {
    const t = app.pinturas.de(sel.image, d);
    const ret = recorte(caixaDe(sel.pontos), t.w, t.h);
    if (ret) {
      const antes = t.g.getImageData(0, 0, t.w, t.h);
      t.g.save();
      t.g.globalCompositeOperation = "destination-out";
      caminho(t.g, sel.pontos);
      t.g.fill();
      t.g.restore();
      const rev = app.pinturas.registrar(sel.image, d, antes, ret);
      mostra(sel.image, ret);
      calls.push({ cmd: "paint.set", args: { image: sel.image, rev } });
    }
  }
  for (const i of formasDentro(d, sel.pontos).reverse()) calls.push({ cmd: "draw.remove", args: { image: sel.image, shape: i } });
  if (!calls.length) return false;
  app.run(calls, "apaga a seleção");
  return true;
}

// ---- os gestos (pontos em pixels da imagem; k = pixels de tela por pixel da imagem)

export function lacoDown(image: string, u: number, w: number, k: number) {
  if (sel && sel.image !== image) semSelecao();
  const cx = caixaDaSelecao(k);
  if (sel && cx) {
    const perto = (p: Vec, r: number) => Math.hypot(p[0] - u, p[1] - w) <= r / k;
    const canto = cx.cantos.findIndex((c) => perto(c, 11));
    const lado = cx.lados.findIndex((c) => perto(c, 10));
    const pega: Pega | null = perto(cx.gira, 11) ? { tipo: "gira" } : canto >= 0 ? { tipo: "canto", i: canto } : lado >= 0 ? { tipo: "lado", i: lado } : dentro(cx.cantos, u, w) ? { tipo: "mover" } : null;
    if (pega) {
      solto ??= levantar();
      if (solto) gesto = { pega, de: [u, w], desl0: [...solto.desl], ang0: solto.ang, sx0: solto.sx, sy0: solto.sy, andou: false };
      return;
    }
    // fora da selecao: ela fica como esta e o laco recomeca
    semSelecao();
  }
  laco = [[u, w]];
}

// mods: shift (mover reto, girar de 15 em 15, esticar por igual), alt (esticar a partir do centro)
export function lacoMove(u: number, w: number, k: number, shift: boolean, alt = false) {
  if (laco) {
    const ult = laco[laco.length - 1];
    if (Math.hypot(u - ult[0], w - ult[1]) >= 1.5 / k) laco.push([u, w]);
    return;
  }
  const g = gesto;
  const s = solto;
  if (!g || !s) return;
  if (!g.andou && Math.hypot(u - g.de[0], w - g.de[1]) < 2 / k) return;
  g.andou = true;
  const C0: Vec = [s.c0[0] + g.desl0[0], s.c0[1] + g.desl0[1]];
  if (g.pega.tipo === "mover") {
    let dx = u - g.de[0],
      dy = w - g.de[1];
    if (shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    s.desl = [g.desl0[0] + dx, g.desl0[1] + dy];
  } else if (g.pega.tipo === "gira") {
    let a = Math.atan2(w - C0[1], u - C0[0]) - Math.atan2(g.de[1] - C0[1], g.de[0] - C0[0]);
    if (shift) a = Math.round((g.ang0 + a) / (Math.PI / 12)) * (Math.PI / 12) - g.ang0;
    s.ang = g.ang0 + a;
  } else {
    // o ponto pego (vi) e o que fica parado (vo, o oposto; com Alt, o centro), em coordenadas da
    // caixa sem escala
    const unit = (g.pega.tipo === "canto" ? CANTOS : LADOS)[g.pega.i];
    const vi: Vec = [unit[0] * s.meia[0], unit[1] * s.meia[1]];
    const vo: Vec = alt ? [0, 0] : [-vi[0], -vi[1]];
    const fixo = (sx: number, sy: number): Vec => {
      const r = gira(g.ang0, [vo[0] * sx, vo[1] * sy]);
      return [C0[0] + r[0], C0[1] + r[1]];
    };
    const Q = fixo(g.sx0, g.sy0);
    const loc = gira(-g.ang0, [u - Q[0], w - Q[1]]);
    const dvx = vi[0] - vo[0],
      dvy = vi[1] - vo[1];
    let sx = Math.abs(dvx) > 1e-9 ? loc[0] / dvx : g.sx0,
      sy = Math.abs(dvy) > 1e-9 ? loc[1] / dvy : g.sy0;
    // Shift (ou um canto com o Shift): por igual, pela projecao no eixo do canto
    if (shift && g.pega.tipo === "canto") {
      const ex = g.sx0 * dvx,
        ey = g.sy0 * dvy;
      const f = (loc[0] * ex + loc[1] * ey) / (ex * ex + ey * ey || 1);
      sx = g.sx0 * f;
      sy = g.sy0 * f;
    }
    // nao deixa achatar a zero (passar do outro lado espelha)
    const piso = 0.02;
    if (Math.abs(sx) < piso) sx = sx < 0 ? -piso : piso;
    if (Math.abs(sy) < piso) sy = sy < 0 ? -piso : piso;
    s.sx = sx;
    s.sy = sy;
    s.ang = g.ang0;
    // o ponto fixo continua onde estava
    const r = gira(g.ang0, [vo[0] * sx, vo[1] * sy]);
    s.desl = [Q[0] - r[0] - s.c0[0], Q[1] - r[1] - s.c0[1]];
  }
  assentar(s);
}

export function lacoUp(image: string) {
  if (laco) {
    const pts = laco;
    laco = null;
    const c = pts.length >= 3 ? caixaDe(pts) : null;
    sel = c && c[2] > 3 && c[3] > 3 ? { image, pontos: pts } : null;
    return;
  }
  gesto = null;
}

// ao sair do desenho (ou trocar de quadro): o pedaco solto assenta e a selecao some
export function limparRetoque() {
  if (solto) soltar();
  sel = null;
  laco = null;
  gesto = null;
}
