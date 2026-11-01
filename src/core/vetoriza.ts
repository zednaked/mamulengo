// Vetorizar uma imagem de cores chapadas (o draw.trace): cada cor vira uma camada de formas com
// curvas Bezier, da maior area para a menor (a primeira cobre toda a parte opaca, contorno pelo
// alfa; cada camada seguinte cobre os pixels dela e das cores de cima, sem fresta entre elas).
// Contorno abaixo do pixel (marching squares sobre a mistura das cores), furos pela contencao,
// cantos onde a direcao vira forte no contorno suavizado, e curvas ajustadas pelo metodo de
// Schneider ("An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems, 1990).
// Puro: roda no editor, no servidor e nos testes.
import type { DrawPoint } from "./desenho.ts";

type V = [number, number];

export interface TraceOptions {
  // cores rrggbb das camadas, de baixo para cima (padrao: as dominantes, da maior area para a menor)
  colors?: string[];
  // erro maximo da curva, em pixels
  tolerance?: number;
  // angulo (graus) a partir do qual a virada no contorno e um canto
  corner?: number;
  // menor area (px quadrados) de um pedaco
  minArea?: number;
}

export interface TraceShape {
  color: string;
  points: DrawPoint[];
  holes: DrawPoint[][];
}

export interface TraceResult {
  colors: string[];
  shapes: TraceShape[];
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const rgbHex = (r: number, g: number, b: number) => hex2(r) + hex2(g) + hex2(b);
const parseHex = (c: string): V3 => [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
type V3 = [number, number, number];

// as cores dominantes: os pixels opacos, juntando cores vizinhas, as que somam ao menos 1,5% da
// parte opaca (no minimo 12 pixels), da maior para a menor
export function dominantColors(img: { width: number; height: number; data: ArrayLike<number> }, max = 8): string[] {
  const count = new Map<string, number>();
  let opacos = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    if (img.data[i * 4 + 3] < 250) continue;
    opacos++;
    const k = rgbHex(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const lista = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const out: { c: string; n: number }[] = [];
  for (const [c, n] of lista) {
    const p = parseHex(c);
    const perto = out.find((o) => {
      const q = parseHex(o.c);
      return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < 14 ** 2;
    });
    if (perto) perto.n += n;
    else out.push({ c, n });
  }
  const minimo = Math.max(12, opacos * 0.015);
  return out
    .filter((o) => o.n >= minimo)
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((o) => o.c);
}

// ---- campo de cada camada

function fields(img: { width: number; height: number; data: ArrayLike<number> }, colors: string[]): Float32Array[] {
  const W = img.width,
    H = img.height,
    n = W * H;
  const pal = colors.map(parseHex);
  const K = pal.length;
  // quanto de cada cor ha em cada pixel: as duas mais perto, misturadas pela projecao
  const memb = new Float32Array(n * K);
  const alfa = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3] / 255;
    alfa[i] = a;
    if (a <= 0) continue;
    const px: V3 = [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]];
    let b1 = 0,
      d1 = Infinity,
      b2 = 0,
      d2 = Infinity;
    for (let k = 0; k < K; k++) {
      const d = (px[0] - pal[k][0]) ** 2 + (px[1] - pal[k][1]) ** 2 + (px[2] - pal[k][2]) ** 2;
      if (d < d1) (b2 = b1), (d2 = d1), (b1 = k), (d1 = d);
      else if (d < d2) (b2 = k), (d2 = d);
    }
    let t = 0;
    if (K > 1 && d1 < 60 ** 2) {
      const s = [pal[b2][0] - pal[b1][0], pal[b2][1] - pal[b1][1], pal[b2][2] - pal[b1][2]];
      const ss = s[0] * s[0] + s[1] * s[1] + s[2] * s[2];
      if (ss > 0) t = Math.max(0, Math.min(1, ((px[0] - pal[b1][0]) * s[0] + (px[1] - pal[b1][1]) * s[1] + (px[2] - pal[b1][2]) * s[2]) / ss));
    }
    memb[i * K + b1] += 1 - t;
    if (K > 1) memb[i * K + b2] += t;
  }
  const out: Float32Array[] = [];
  for (let k = 0; k < K; k++) {
    const f = new Float32Array(n);
    if (k === 0) f.set(alfa);
    else
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = k; j < K; j++) s += memb[i * K + j];
        f[i] = s * alfa[i];
      }
    out.push(k === 0 ? f : blur(f, W, H, 0.35));
  }
  return out;
}

function blur(f: Float32Array, W: number, H: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const ker: number[] = [];
  let s = 0;
  for (let i = -r; i <= r; i++) s += ker[ker.push(Math.exp(-(i * i) / (2 * sigma * sigma))) - 1];
  for (let i = 0; i < ker.length; i++) ker[i] /= s;
  const tmp = new Float32Array(f.length),
    out = new Float32Array(f.length);
  // borda: o que esta fora da imagem e vazio
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i;
        if (xx >= 0 && xx < W) v += f[y * W + xx] * ker[i + r];
      }
      tmp[y * W + x] = v;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i;
        if (yy >= 0 && yy < H) v += tmp[yy * W + x] * ker[i + r];
      }
      out[y * W + x] = v;
    }
  return out;
}

// ---- marching squares: os contornos fechados do nivel 0.5, em pixels da imagem (o centro do
// pixel (i, j) fica em (i + 0.5, j + 0.5)); a borda conta como vazia, entao todo contorno fecha

export function contours(f: Float32Array, W: number, H: number, level = 0.5): V[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : f[y * W + x]);
  // amostras em (x, y) para x em -1..W, y em -1..H; celula (x, y) entre as amostras x..x+1, y..y+1
  const edgeKey = (x: number, y: number, h: boolean) => ((y + 1) * (W + 2) + (x + 1)) * 2 + (h ? 0 : 1);
  const pt = new Map<number, V>();
  const point = (x: number, y: number, h: boolean): number => {
    const k = edgeKey(x, y, h);
    if (!pt.has(k)) {
      const a = at(x, y),
        b = h ? at(x + 1, y) : at(x, y + 1);
      const t = Math.abs(b - a) < 1e-9 ? 0.5 : (level - a) / (b - a);
      pt.set(k, h ? [x + t + 0.5, y + 0.5] : [x + 0.5, y + t + 0.5]);
    }
    return k;
  };
  // segmentos orientados (dentro a esquerda), ligados de ponta a ponta
  const next = new Map<number, number>();
  for (let y = -1; y < H; y++)
    for (let x = -1; x < W; x++) {
      const tl = at(x, y) >= level,
        tr = at(x + 1, y) >= level,
        br = at(x + 1, y + 1) >= level,
        bl = at(x, y + 1) >= level;
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = () => point(x, y, true),
        B = () => point(x, y + 1, true),
        L = () => point(x, y, false),
        R = () => point(x + 1, y, false);
      const seg = (a: number, b: number) => next.set(a, b);
      const centro = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= level;
      switch (c) {
        case 1: seg(L(), B()); break;
        case 2: seg(B(), R()); break;
        case 3: seg(L(), R()); break;
        case 4: seg(R(), T()); break;
        case 5: if (centro) (seg(L(), T()), seg(R(), B())); else (seg(L(), B()), seg(R(), T())); break;
        case 6: seg(B(), T()); break;
        case 7: seg(L(), T()); break;
        case 8: seg(T(), L()); break;
        case 9: seg(T(), B()); break;
        case 10: if (centro) (seg(T(), R()), seg(B(), L())); else (seg(T(), L()), seg(B(), R())); break;
        case 11: seg(T(), R()); break;
        case 12: seg(R(), L()); break;
        case 13: seg(R(), B()); break;
        case 14: seg(B(), L()); break;
      }
    }
  const out: V[][] = [];
  const usado = new Set<number>();
  for (const start of next.keys()) {
    if (usado.has(start)) continue;
    const loop: V[] = [];
    let k: number | undefined = start;
    while (k !== undefined && !usado.has(k)) {
      usado.add(k);
      loop.push(pt.get(k)!);
      k = next.get(k);
    }
    if (loop.length >= 3) out.push(loop);
  }
  return out;
}

const area = (p: V[]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

function inside(pt: V, poly: V[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[i],
      [x2, y2] = poly[j];
    if (y1 > pt[1] !== y2 > pt[1] && pt[0] < ((x2 - x1) * (pt[1] - y1)) / (y2 - y1) + x1) c = !c;
  }
  return c;
}

// ---- ajuste de cubicas

type Cubic = [V, V, V, V];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const unit = (a: V): V => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : a;
};

function bez(c: Cubic, t: number): V {
  const u = 1 - t;
  return [u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0], u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1]];
}
function bezD(c: Cubic, t: number): V {
  const u = 1 - t;
  return add(add(mul(sub(c[1], c[0]), 3 * u * u), mul(sub(c[2], c[1]), 6 * u * t)), mul(sub(c[3], c[2]), 3 * t * t));
}
function bezDD(c: Cubic, t: number): V {
  return add(mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * (1 - t)), mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t));
}

function chord(p: V[]): number[] {
  const u = [0];
  for (let i = 1; i < p.length; i++) u.push(u[i - 1] + len(sub(p[i], p[i - 1])));
  const T = u[u.length - 1] || 1;
  return u.map((x) => x / T);
}

function generate(p: V[], u: number[], t1: V, t2: V): Cubic {
  const first = p[0],
    last = p[p.length - 1];
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  for (let i = 0; i < p.length; i++) {
    const t = u[i],
      v = 1 - t;
    const a1 = mul(t1, 3 * v * v * t),
      a2 = mul(t2, 3 * v * t * t);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const base = bez([first, first, last, last], t);
    const d = sub(p[i], base);
    x0 += dot(a1, d);
    x1 += dot(a2, d);
  }
  const det = c00 * c11 - c01 * c01;
  const seg = len(sub(last, first));
  let al1 = 0,
    al2 = 0;
  if (Math.abs(det) > 1e-12) {
    al1 = (x0 * c11 - x1 * c01) / det;
    al2 = (c00 * x1 - c01 * x0) / det;
  }
  if (al1 < 1e-6 * seg || al2 < 1e-6 * seg) al1 = al2 = seg / 3;
  return [first, add(first, mul(t1, al1)), add(last, mul(t2, al2)), last];
}

function fit(p: V[], t1: V, t2: V, tol: number, depth = 0): Cubic[] {
  if (p.length === 2) {
    const d = len(sub(p[1], p[0])) / 3;
    return [[p[0], add(p[0], mul(t1, d)), add(p[1], mul(t2, d)), p[1]]];
  }
  let u = chord(p);
  let c = generate(p, u, t1, t2);
  const maxErr = () => {
    let m = 0,
      k = 1;
    for (let i = 1; i < p.length - 1; i++) {
      const e = len(sub(bez(c, u[i]), p[i]));
      if (e > m) (m = e), (k = i);
    }
    return { m, k };
  };
  let e = maxErr();
  for (let it = 0; it < 6 && e.m > tol; it++) {
    // Newton: o parametro de cada ponto vai para o ponto mais perto da curva
    u = u.map((t, i) => {
      const d = sub(bez(c, t), p[i]),
        d1 = bezD(c, t),
        d2 = bezDD(c, t);
      const den = dot(d1, d1) + dot(d, d2);
      return Math.max(0, Math.min(1, Math.abs(den) > 1e-12 ? t - dot(d, d1) / den : t));
    });
    c = generate(p, u, t1, t2);
    e = maxErr();
  }
  if (e.m <= tol || depth > 12) return [c];
  const k = Math.max(1, Math.min(p.length - 2, e.k));
  const j = Math.min(3, k, p.length - 1 - k);
  const tc = unit(sub(p[k - j], p[k + j]));
  return [...fit(p.slice(0, k + 1), t1, tc, tol, depth + 1), ...fit(p.slice(k), mul(tc, -1), t2, tol, depth + 1)];
}

// um contorno fechado em pontos do desenho
function toPoints(p: V[], tol: number, cornerRad: number): DrawPoint[] {
  const n = p.length;
  // suaviza ao longo do contorno (o serrilhado dos pixels nao vira calombo nem canto)
  const sigma = 1.2,
    r = 4;
  const sm: V[] = p.map((_, i) => {
    let x = 0,
      y = 0,
      s = 0;
    for (let k = -r; k <= r; k++) {
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      const q = p[(i + k + n) % n];
      x += q[0] * w;
      y += q[1] * w;
      s += w;
    }
    return [x / s, y / s];
  });
  const w = Math.max(3, Math.min(6, Math.floor(n / 24)));
  const cantos: { ang: number; i: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = unit(sub(sm[i], sm[(i - w + n) % n])),
      b = unit(sub(sm[(i + w) % n], sm[i]));
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    if (ang > cornerRad) cantos.push({ ang, i });
  }
  let marcas: number[] = [];
  for (const c of cantos.sort((a, b) => b.ang - a.ang)) if (marcas.every((j) => Math.min(Math.abs(c.i - j), n - Math.abs(c.i - j)) > 2 * w)) marcas.push(c.i);
  marcas.sort((a, b) => a - b);
  const lisa = !marcas.length;
  if (lisa) marcas = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4)];
  const segs: Cubic[] = [];
  for (let m = 0; m < marcas.length; m++) {
    const a = marcas[m],
      b = m + 1 < marcas.length ? marcas[m + 1] : marcas[0] + n;
    const pts: V[] = [];
    for (let k = a; k <= b; k++) pts.push(sm[k % n]);
    if (pts.length < 2) continue;
    let t1: V, t2: V;
    if (lisa) {
      t1 = unit(sub(sm[(a + 3) % n], sm[(a - 3 + n) % n]));
      t2 = mul(unit(sub(sm[(b + 3) % n], sm[(b - 3 + n) % n])), -1);
    } else {
      pts[0] = p[a % n];
      pts[pts.length - 1] = p[b % n];
      const j = Math.min(4, pts.length - 1);
      t1 = unit(sub(pts[j], pts[0]));
      t2 = unit(sub(pts[pts.length - 1 - j], pts[pts.length - 1]));
    }
    segs.push(...fit(pts, t1, t2, tol));
  }
  const rnd = (v: number) => Math.round(v * 100) / 100;
  return segs.map((c, k) => {
    const q: DrawPoint = { x: rnd(c[0][0]), y: rnd(c[0][1]) };
    const o = sub(c[1], c[0]);
    if (len(o) > 0.05) q.out = [rnd(o[0]), rnd(o[1])];
    const prev = segs[(k - 1 + segs.length) % segs.length];
    const i = sub(prev[2], prev[3]);
    if (len(i) > 0.05) q.in = [rnd(i[0]), rnd(i[1])];
    return q;
  });
}

export function traceImage(img: { width: number; height: number; data: ArrayLike<number> }, o: TraceOptions = {}): TraceResult {
  const colors = (o.colors?.length ? o.colors : dominantColors(img)).map((c) => c.replace("#", "").slice(0, 6).toLowerCase());
  if (!colors.length) throw new Error("a imagem nao tem parte opaca");
  const tol = o.tolerance ?? 0.6;
  const cornerRad = ((o.corner ?? 55) * Math.PI) / 180;
  const minArea = o.minArea ?? 10;
  const shapes: TraceShape[] = [];
  fields(img, colors).forEach((f, k) => {
    const cs = contours(f, img.width, img.height).filter((c) => c.length >= 6 && Math.abs(area(c)) >= minArea);
    // profundidade: dentro de quantos outros; impar e furo do contorno de profundidade logo acima
    const prof = cs.map((c, i) => cs.reduce((s, o, j) => s + (j !== i && inside(c[0], o) ? 1 : 0), 0));
    cs.forEach((c, i) => {
      if (prof[i] % 2) return;
      const furos = cs.filter((h, j) => prof[j] === prof[i] + 1 && inside(h[0], c));
      shapes.push({ color: colors[k], points: toPoints(c, tol, cornerRad), holes: furos.map((h) => toPoints(h, tol, cornerRad)) });
    });
  });
  return { colors, shapes };
}
