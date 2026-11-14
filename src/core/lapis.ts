// O lapis do ambiente Desenhar: o traco a mao livre vira uma forma vetorial (src/core/desenho.ts)
// com poucos pontos e largura que varia ao longo do caminho. Tres etapas, todas puras:
//  1. estabilizar: a ponta segue a caneta com atraso (some o tremor da mao), e chega nela ao soltar;
//  2. ajustar: os pontos viram curvas de Bezier dentro de uma tolerancia (Schneider), com os cantos
//     vivos preservados e a pressao guardada em cada ponto (press);
//  3. contorno: o traco de largura variavel (largura do traco x press do ponto, afinando nas
//     pontas por taper) vira um poligono preenchido, igual no canvas do editor e no SVG.
import { cubicAt, type DrawPoint, type DrawShape, type Seg, type Vec } from "./desenho.ts";

// x, y, pressao (0 a 1; sem ela vale 1) e tempo em ms (sem ele, 120 amostras por segundo)
export type Amostra = [number, number, number?, number?];

// ---- 1. estabilizar

const PASSO_MS = 1000 / 120;

// forca 0 a 1: 0 segue a caneta ponto a ponto; 1 atrasa perto de meio segundo
const atraso = (forca: number) => 0.45 * Math.max(0, Math.min(1, forca)) ** 2;

export class Estabilizador {
  private pos: [number, number, number] | null = null;
  private alvo: [number, number, number] = [0, 0, 1];
  private t = 0;
  forca: number;
  constructor(forca: number) {
    this.forca = forca;
  }

  // a ponta depois de mais uma amostra da caneta
  mover(a: Amostra): Amostra {
    const p = a[2] ?? 1;
    const t = a[3] ?? this.t + PASSO_MS;
    if (!this.pos) {
      this.pos = [a[0], a[1], p];
      this.alvo = [a[0], a[1], p];
      this.t = t;
      return [a[0], a[1], p, t];
    }
    const dt = Math.max(0, Math.min(100, t - this.t)) / 1000;
    this.t = t;
    this.alvo = [a[0], a[1], p];
    const tau = atraso(this.forca);
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    // a pressao assenta mais depressa que a posicao (senao a ponta engrossa atrasada)
    const kp = tau > 0 ? 1 - Math.exp(-dt / (tau * 0.4 + 0.012)) : 1 - Math.exp(-dt / 0.012);
    this.pos = [this.pos[0] + (a[0] - this.pos[0]) * k, this.pos[1] + (a[1] - this.pos[1]) * k, this.pos[2] + (p - this.pos[2]) * kp];
    return [this.pos[0], this.pos[1], this.pos[2], t];
  }

  // ao soltar: o caminho que falta ate a caneta (o traco termina onde a mao parou)
  soltar(): Amostra[] {
    const out: Amostra[] = [];
    if (!this.pos) return out;
    let [x, y] = this.pos;
    const p = this.pos[2];
    for (let i = 0; i < 32 && Math.hypot(this.alvo[0] - x, this.alvo[1] - y) > 0.5; i++) {
      x += (this.alvo[0] - x) * 0.4;
      y += (this.alvo[1] - y) * 0.4;
      this.t += PASSO_MS;
      out.push([x, y, p, this.t]);
    }
    if (Math.hypot(this.alvo[0] - this.pos[0], this.alvo[1] - this.pos[1]) > 1e-6) out.push([this.alvo[0], this.alvo[1], p, this.t + PASSO_MS]);
    this.pos = null;
    return out;
  }
}

export function estabilizar(pontos: Amostra[], forca: number): Amostra[] {
  if (forca <= 0 || pontos.length < 2) return pontos.map((a) => [a[0], a[1], a[2] ?? 1, a[3]] as Amostra);
  const e = new Estabilizador(forca);
  const out = pontos.map((a) => e.mover(a));
  out.push(...e.soltar());
  return out;
}

// ---- 2. ajustar (Schneider, "An algorithm for automatically fitting digitized curves")

interface P {
  x: number;
  y: number;
  w: number;
}
type V = [number, number];

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const unit = (a: V): V => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};
const v = (p: P): V => [p.x, p.y];

type Bez = [V, V, V, V];

function chordParams(d: P[], a: number, b: number): number[] {
  const u = [0];
  for (let i = a + 1; i <= b; i++) u.push(u[u.length - 1] + Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y));
  const total = u[u.length - 1] || 1;
  return u.map((x) => x / total);
}

function gerar(d: P[], a: number, b: number, u: number[], t1: V, t2: V): Bez {
  const p0 = v(d[a]),
    p3 = v(d[b]);
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i],
      s = 1 - t;
    const b0 = s * s * s,
      b1 = 3 * s * s * t,
      b2 = 3 * s * t * t,
      b3 = t * t * t;
    const a1 = mul(t1, b1),
      a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(v(d[a + i]), add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0;
  const seg = len(sub(p3, p0));
  // alcas degeneradas (ou para tras): a regra de um terco da corda
  if (al < seg * 1e-6 || ar < seg * 1e-6 || al > seg * 4 || ar > seg * 4) al = ar = seg / 3;
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

const bz = (b: Bez, t: number): V => cubicAt(b[0], b[1], b[2], b[3], t);

function reparam(d: P[], a: number, u: number[], b: Bez): number[] {
  return u.map((t, i) => {
    const p = v(d[a + i]);
    // um passo de Newton em (B(t) - p) . B'(t) = 0
    const s = 1 - t;
    const q = bz(b, t);
    const d1: V = add(add(mul(sub(b[1], b[0]), 3 * s * s), mul(sub(b[2], b[1]), 6 * s * t)), mul(sub(b[3], b[2]), 3 * t * t));
    const d2: V = add(mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6 * s), mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6 * t));
    const num = dot(sub(q, p), d1);
    const den = dot(d1, d1) + dot(sub(q, p), d2);
    return Math.abs(den) < 1e-12 ? t : Math.max(0, Math.min(1, t - num / den));
  });
}

// maior erro de posicao (ao quadrado) e de largura, e onde cada um acontece
function erro(d: P[], a: number, b: number, u: number[], bez: Bez): { e: number; em: number; w: number; wm: number } {
  let e = 0,
    em = (a + b) >> 1,
    w = 0,
    wm = em;
  for (let i = 1; i < u.length - 1; i++) {
    const q = bz(bez, u[i]);
    const dd = (q[0] - d[a + i].x) ** 2 + (q[1] - d[a + i].y) ** 2;
    if (dd > e) (e = dd), (em = a + i);
    const dw = Math.abs(d[a].w + (d[b].w - d[a].w) * u[i] - d[a + i].w);
    if (dw > w) (w = dw), (wm = a + i);
  }
  return { e, em, w, wm };
}

const TOL_W = 0.07;

function trecho(d: P[], a: number, b: number, t1: V, t2: V, tol: number, out: Bez[], fundo = 0) {
  if (b - a === 1) {
    const seg = len(sub(v(d[b]), v(d[a]))) / 3;
    out.push([v(d[a]), add(v(d[a]), mul(t1, seg)), add(v(d[b]), mul(t2, seg)), v(d[b])]);
    return;
  }
  let u = chordParams(d, a, b);
  let bez = gerar(d, a, b, u, t1, t2);
  let r = erro(d, a, b, u, bez);
  const t2q = tol * tol;
  if (r.e > t2q && r.e < t2q * 16) {
    for (let i = 0; i < 4 && r.e > t2q; i++) {
      u = reparam(d, a, u, bez);
      bez = gerar(d, a, b, u, t1, t2);
      r = erro(d, a, b, u, bez);
    }
  }
  if ((r.e <= t2q && r.w <= TOL_W) || fundo > 40) {
    out.push(bez);
    return;
  }
  const m = r.e > t2q ? r.em : r.wm;
  // tangente no ponto de corte: a direcao entre os vizinhos
  const tc = unit(sub(v(d[Math.max(a, m - 1)]), v(d[Math.min(b, m + 1)])));
  const tm: V = len(tc) ? tc : unit(sub(v(d[a]), v(d[b])));
  trecho(d, a, m, t1, tm, tol, out, fundo + 1);
  trecho(d, m, b, mul(tm, -1), t2, tol, out, fundo + 1);
}

// tangente de saida em a (olhando alguns pontos a frente) e de chegada em b
function tangente(d: P[], i: number, dir: 1 | -1, lim: number, alcance: number): V {
  const p = v(d[i]);
  let j = i;
  let acc = 0;
  while (j !== lim && acc < alcance) {
    acc += Math.hypot(d[j + dir].x - d[j].x, d[j + dir].y - d[j].y);
    j += dir;
  }
  return unit(sub(v(d[j]), p));
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// os pontos do traco viram um contorno aberto de curvas. tol: o quanto a curva pode se afastar
// dos pontos, em pixels (maior = mais liso e com menos pontos). Canto vivo (mudanca de direcao
// acima de `canto` graus) vira ponto de canto. press sai em cada ponto quando variavel = true.
export function ajustar(pontos: Amostra[], tol = 1, opts: { canto?: number; variavel?: boolean } = {}): DrawPoint[] {
  // tira os repetidos (a caneta parada manda o mesmo ponto varias vezes)
  const d: P[] = [];
  for (const a of pontos) {
    const q = { x: a[0], y: a[1], w: a[2] ?? 1 };
    const l = d[d.length - 1];
    if (l && Math.hypot(q.x - l.x, q.y - l.y) < 0.35) {
      l.w = Math.max(l.w, q.w);
      continue;
    }
    d.push(q);
  }
  const ponto = (p: P): DrawPoint => ({ x: r3(p.x), y: r3(p.y), ...(opts.variavel ? { press: r3(p.w) } : {}) });
  if (d.length === 0) return [];
  if (d.length === 1) return [ponto(d[0])];
  // cantos: a direcao medida a uma distancia de alguns pixels para cada lado
  const alcance = Math.max(3, tol * 3);
  const cos = Math.cos(((opts.canto ?? 55) * Math.PI) / 180);
  const cortes = [0];
  // de cada sequencia de pontos em quina, fica o mais agudo
  let melhor = -1,
    agudo = -2;
  for (let i = 1; i < d.length - 1; i++) {
    const a = tangente(d, i, -1, 0, alcance),
      b = tangente(d, i, 1, d.length - 1, alcance);
    // a e b apontam para fora do ponto: reta = -1; canto = produto alto
    const q = dot(a, b);
    if (q > -cos) {
      if (q > agudo) (agudo = q), (melhor = i);
    } else if (melhor >= 0) {
      cortes.push(melhor);
      melhor = -1;
      agudo = -2;
    }
  }
  if (melhor >= 0) cortes.push(melhor);
  cortes.push(d.length - 1);
  const bez: Bez[] = [];
  for (let k = 0; k + 1 < cortes.length; k++) {
    const a = cortes[k],
      b = cortes[k + 1];
    if (b <= a) continue;
    trecho(d, a, b, tangente(d, a, 1, b, alcance), tangente(d, b, -1, a, alcance), Math.max(0.05, tol), bez);
  }
  // as curvas viram pontos com alcas; largura pelo ponto de origem mais perto
  const wEm = (q: V) => {
    let best = d[0],
      bd = Infinity;
    for (const p of d) {
      const dd = (p.x - q[0]) ** 2 + (p.y - q[1]) ** 2;
      if (dd < bd) (bd = dd), (best = p);
    }
    return best.w;
  };
  const out: DrawPoint[] = [];
  bez.forEach((b, i) => {
    if (i === 0) out.push(ponto({ x: b[0][0], y: b[0][1], w: wEm(b[0]) }));
    const ant = out[out.length - 1];
    const o = sub(b[1], b[0]),
      e = sub(b[2], b[3]);
    // trecho reto (as alcas em cima da corda) fica sem alcas
    const reto = Math.abs(o[0] * (b[3][1] - b[0][1]) - o[1] * (b[3][0] - b[0][0])) < 1e-3 && Math.abs(e[0] * (b[3][1] - b[0][1]) - e[1] * (b[3][0] - b[0][0])) < 1e-3;
    if (!reto) ant.out = [r3(o[0]), r3(o[1])];
    const q = ponto({ x: b[3][0], y: b[3][1], w: wEm(b[3]) });
    if (!reto) q.in = [r3(e[0]), r3(e[1])];
    out.push(q);
  });
  return out;
}

// ---- 3. contorno do traco de largura variavel

export const tracoVariavel = (s: Pick<DrawShape, "points" | "stroke">) => !!s.stroke && (!!s.stroke.taper?.some((x) => x > 0) || s.points.some((p) => p.press !== undefined));

interface Am {
  x: number;
  y: number;
  h: number;
}

// o caminho amostrado, com a meia largura em cada amostra
function amostras(s: Pick<DrawShape, "points" | "closed" | "stroke">, passo: number): Am[] {
  const pts = s.points;
  const n = pts.length;
  const larg = (s.stroke?.width ?? 0) / 2;
  const out: Am[] = [];
  if (!n) return out;
  const w = (p: DrawPoint) => Math.max(0, p.press ?? 1);
  out.push({ x: pts[0].x, y: pts[0].y, h: larg * w(pts[0]) });
  const segs = s.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n];
    const p0: Vec = [a.x, a.y],
      p1: Vec = [a.x + (a.out?.[0] ?? 0), a.y + (a.out?.[1] ?? 0)],
      p2: Vec = [b.x + (b.in?.[0] ?? 0), b.y + (b.in?.[1] ?? 0)],
      p3: Vec = [b.x, b.y];
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const k = Math.max(1, Math.min(400, Math.ceil(l / passo)));
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      const q = cubicAt(p0, p1, p2, p3, t);
      // a largura passa de um ponto ao outro suave (sem quina na espessura)
      const e = t * t * (3 - 2 * t);
      out.push({ x: q[0], y: q[1], h: larg * (w(a) + (w(b) - w(a)) * e) });
    }
  }
  // amostras em cima uma da outra nao tem direcao
  const limpo: Am[] = [];
  for (const a of out) {
    const l = limpo[limpo.length - 1];
    if (l && Math.hypot(a.x - l.x, a.y - l.y) < 1e-4) continue;
    limpo.push(a);
  }
  if (s.closed && limpo.length > 2) {
    const f = limpo[0],
      l = limpo[limpo.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-3) limpo.pop();
  }
  // afinar nas pontas (so no traco aberto)
  const tp = s.stroke?.taper;
  if (!s.closed && tp && (tp[0] > 0 || tp[1] > 0) && limpo.length > 1) {
    const acc = [0];
    for (let i = 1; i < limpo.length; i++) acc.push(acc[i - 1] + Math.hypot(limpo[i].x - limpo[i - 1].x, limpo[i].y - limpo[i - 1].y));
    const total = acc[acc.length - 1];
    // traco curto: as duas pontas dividem o comprimento
    const soma = tp[0] + tp[1];
    const k = soma > total ? total / soma : 1;
    const ti = tp[0] * k,
      to = tp[1] * k;
    const ponta = (u: number) => Math.sin((Math.max(0, Math.min(1, u)) * Math.PI) / 2);
    limpo.forEach((a, i) => {
      if (ti > 0) a.h *= ponta(acc[i] / ti);
      if (to > 0) a.h *= ponta((total - acc[i]) / to);
    });
  }
  return limpo;
}

function arco(out: Vec[], cx: number, cy: number, r: number, a0: number, a1: number) {
  // de a0 a a1 pelo caminho dado (a1 ja vem com o sentido certo), passos de ~17 graus
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 0.3));
  for (let i = 1; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
}

// os aneis do traco (preencher com a regra nonzero): aberto = um anel (um lado indo, a ponta,
// o outro voltando, a outra ponta); fechado = dois (por fora e por dentro, em sentidos opostos)
export function contornoDoTraco(s: Pick<DrawShape, "points" | "closed" | "stroke">, passo = 1): Vec[][] {
  const am = amostras(s, passo);
  const n = am.length;
  if (!n || !s.stroke) return [];
  if (n === 1) {
    const r = am[0].h;
    if (r <= 0) return [];
    const c: Vec[] = [];
    for (let i = 0; i < 16; i++) c.push([am[0].x + Math.cos((i * Math.PI) / 8) * r, am[0].y + Math.sin((i * Math.PI) / 8) * r]);
    return [c];
  }
  const fechado = !!s.closed && n > 2;
  const dir = (i: number): V => unit([am[(i + 1) % n].x - am[i].x, am[(i + 1) % n].y - am[i].y]);
  const esq: Vec[] = [],
    dirt: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = am[i];
    const temAntes = fechado || i > 0,
      temDepois = fechado || i < n - 1;
    const d1 = temDepois ? dir(i) : dir(i - 1);
    const d0 = temAntes ? dir((i - 1 + n) % n) : d1;
    const cr = d0[0] * d1[1] - d0[1] * d1[0];
    const cs = d0[0] * d1[0] + d0[1] * d1[1];
    const n0: V = [-d0[1], d0[0]],
      n1: V = [-d1[1], d1[0]];
    if (cs > 0.96) {
      // quase reto: a normal media
      const m = unit([n0[0] + n1[0], n0[1] + n1[1]]);
      esq.push([a.x + m[0] * a.h, a.y + m[1] * a.h]);
      dirt.push([a.x - m[0] * a.h, a.y - m[1] * a.h]);
      continue;
    }
    // quina: por fora um arco redondo, por dentro os dois pontos (a dobra fica coberta)
    const ang = Math.atan2(cr, cs);
    const a0e = Math.atan2(n0[1], n0[0]);
    esq.push([a.x + n0[0] * a.h, a.y + n0[1] * a.h]);
    if (cr < 0) arco(esq, a.x, a.y, a.h, a0e, a0e + ang);
    esq.push([a.x + n1[0] * a.h, a.y + n1[1] * a.h]);
    dirt.push([a.x - n0[0] * a.h, a.y - n0[1] * a.h]);
    if (cr > 0) arco(dirt, a.x, a.y, a.h, a0e + Math.PI, a0e + Math.PI + ang);
    dirt.push([a.x - n1[0] * a.h, a.y - n1[1] * a.h]);
  }
  if (fechado) return [esq, dirt.reverse()];
  const anel: Vec[] = [...esq];
  const redonda = (s.stroke.cap ?? "round") === "round";
  const quadrada = s.stroke.cap === "square";
  // ponta do fim: da esquerda, pela frente, ate a direita
  {
    const a = am[n - 1];
    const d = dir(n - 2);
    const an = Math.atan2(d[0], -d[1]);
    if (redonda && a.h > 0.2) arco(anel, a.x, a.y, a.h, an, an - Math.PI);
    else if (quadrada) anel.push([a.x - d[1] * a.h + d[0] * a.h, a.y + d[0] * a.h + d[1] * a.h], [a.x + d[1] * a.h + d[0] * a.h, a.y - d[0] * a.h + d[1] * a.h]);
  }
  for (let i = dirt.length - 1; i >= 0; i--) anel.push(dirt[i]);
  {
    const a = am[0];
    const d = dir(0);
    const an = Math.atan2(-d[0], d[1]);
    if (redonda && a.h > 0.2) arco(anel, a.x, a.y, a.h, an, an - Math.PI);
    else if (quadrada) anel.push([a.x + d[1] * a.h - d[0] * a.h, a.y - d[0] * a.h - d[1] * a.h], [a.x - d[1] * a.h - d[0] * a.h, a.y + d[0] * a.h - d[1] * a.h]);
  }
  return [anel];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function segsDoTraco(s: Pick<DrawShape, "points" | "closed" | "stroke">, passo = 1): Seg[] {
  const out: Seg[] = [];
  for (const anel of contornoDoTraco(s, passo)) {
    if (anel.length < 3) continue;
    anel.forEach((p, i) => out.push([i ? "L" : "M", r2(p[0]), r2(p[1])]));
    out.push(["Z"]);
  }
  return out;
}

// ---- estilos prontos (o painel e o comando usam os mesmos)

export interface EstiloLapis {
  // o quanto a pressao muda a largura, 0 a 1
  pressao: number;
  // a largura minima (pressao zero), em fracao da largura
  minimo: number;
  // afinar no comeco e no fim, em multiplos da largura
  afinar: [number, number];
  // pressao -> largura: acima de 1 pede mais forca para engrossar
  curva: number;
}

export const ESTILOS: Record<string, EstiloLapis & { rotulo: string }> = {
  uniforme: { rotulo: "Uniforme", pressao: 0, minimo: 1, afinar: [0, 0], curva: 1 },
  lapis: { rotulo: "Lápis", pressao: 0.6, minimo: 0.35, afinar: [1.5, 2.5], curva: 1 },
  nanquim: { rotulo: "Nanquim", pressao: 1, minimo: 0.08, afinar: [4, 7], curva: 1.4 },
  pincel: { rotulo: "Pincel", pressao: 1, minimo: 0.03, afinar: [8, 14], curva: 1.9 },
  marcador: { rotulo: "Marcador", pressao: 0.15, minimo: 0.8, afinar: [0, 0], curva: 1 },
};

// a largura (fracao) que uma pressao da no estilo
export const larguraDaPressao = (p: number, e: Pick<EstiloLapis, "pressao" | "minimo" | "curva">) => {
  const c = Math.max(0, Math.min(1, p)) ** e.curva;
  const comPressao = e.minimo + (1 - e.minimo) * c;
  return 1 - e.pressao * (1 - comPressao);
};
