// Geometria para malhas: contorno a partir do alpha, simplificacao, pontos internos,
// triangulacao (Delaunay restrita ao contorno). Puro, sem DOM.

export type Pt = [number, number];

// Contorno externo da maior regiao opaca (alpha > limiar), em pixels da imagem
// (origem no canto superior esquerdo). Marching squares sobre uma mascara dilatada
// em `pad` px, para o contorno ficar por fora dos pixels visiveis.
export function alphaContour(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, opts: { threshold?: number; pad?: number; stride?: number } = {}): Pt[] {
  const th = opts.threshold ?? 8;
  const pad = opts.pad ?? 2;
  const stride = opts.stride ?? 4; // alpha esta a cada `stride` bytes (RGBA = 4)
  // mascara com borda de 1 celula vazia em volta
  const W = w + 2,
    H = h + 2;
  let m = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[(y * w + x) * stride + (stride - 1)] > th) m[(y + 1) * W + x + 1] = 1;
  // dilatacao quadrada
  for (let k = 0; k < pad; k++) {
    const n = new Uint8Array(m);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++)
        if (!m[y * W + x] && (m[y * W + x - 1] || m[y * W + x + 1] || m[(y - 1) * W + x] || m[(y + 1) * W + x])) n[y * W + x] = 1;
    m = n;
  }
  // fecha buracos internos: so o contorno externo interessa (flood fill do vazio de fora)
  const outside = new Uint8Array(W * H);
  const stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W,
      y = (i / W) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!outside[j] && !m[j]) (outside[j] = 1), stack.push(j);
    }
  }
  for (let i = 0; i < W * H; i++) m[i] = outside[i] ? 0 : 1;
  // arestas orientadas entre celula cheia e vazia (cheia a esquerda), em cantos de
  // pixel; encadeadas em lacos. Fica o maior laco (o contorno externo).
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
  const out = new Map<number, number[]>(); // vertice -> proximos vertices
  const key = (x: number, y: number) => y * (W + 1) + x;
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const k = key(x1, y1);
    const l = out.get(k);
    l ? l.push(key(x2, y2)) : out.set(k, [key(x2, y2)]);
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!filled(x, y)) continue;
      // y para baixo: andando com a celula a esquerda
      if (!filled(x, y - 1)) add(x + 1, y, x, y); // topo, da direita para a esquerda
      if (!filled(x - 1, y)) add(x, y, x, y + 1); // esquerda, para baixo
      if (!filled(x, y + 1)) add(x, y + 1, x + 1, y + 1); // base, para a direita
      if (!filled(x + 1, y)) add(x + 1, y + 1, x + 1, y); // direita, para cima
    }
  const vx = (k: number) => k % (W + 1),
    vy = (k: number) => (k / (W + 1)) | 0;
  let best: number[] = [];
  while (out.size) {
    const [startK] = out.keys();
    const loop: number[] = [startK];
    let cur = startK,
      prevDir = -1;
    for (;;) {
      const nexts = out.get(cur);
      if (!nexts || !nexts.length) break;
      // em sela, vira a esquerda em relacao a direcao de chegada
      let pick = 0;
      if (nexts.length > 1 && prevDir >= 0) {
        let bestTurn = -Infinity;
        nexts.forEach((n, i) => {
          const d = Math.atan2(vy(n) - vy(cur), vx(n) - vx(cur));
          let turn = prevDir - d;
          while (turn <= -Math.PI) turn += 2 * Math.PI;
          while (turn > Math.PI) turn -= 2 * Math.PI;
          if (turn > bestTurn) (bestTurn = turn), (pick = i);
        });
      }
      const nk = nexts.splice(pick, 1)[0];
      if (!nexts.length) out.delete(cur);
      prevDir = Math.atan2(vy(nk) - vy(cur), vx(nk) - vx(cur));
      cur = nk;
      if (cur === startK) break;
      loop.push(cur);
    }
    if (loop.length > best.length) best = loop;
  }
  // remove pontos colineares e volta para coordenadas da imagem (tira a borda de 1)
  const pts: Pt[] = [];
  for (let i = 0; i < best.length; i++) {
    const a = best[(i + best.length - 1) % best.length],
      b = best[i],
      c = best[(i + 1) % best.length];
    const col = (vx(b) - vx(a)) * (vy(c) - vy(b)) - (vy(b) - vy(a)) * (vx(c) - vx(b)) === 0;
    if (!col) pts.push([Math.max(0, Math.min(w, vx(b) - 1)), Math.max(0, Math.min(h, vy(b) - 1))]);
  }
  return pts;
}

// Douglas-Peucker em poligono fechado.
export function simplify(poly: Pt[], tolerance: number): Pt[] {
  if (poly.length < 4) return poly;
  // parte no ponto mais distante do primeiro para fechar bem
  let far = 0,
    fd = -1;
  poly.forEach((p, i) => {
    const d = (p[0] - poly[0][0]) ** 2 + (p[1] - poly[0][1]) ** 2;
    if (d > fd) (fd = d), (far = i);
  });
  const dp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let idx = -1,
      dmax = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = segDist(pts[i], a, b);
      if (d > dmax) (dmax = d), (idx = i);
    }
    if (dmax <= tolerance) return [a, b];
    const l = dp(pts.slice(0, idx + 1)),
      r = dp(pts.slice(idx));
    return [...l.slice(0, -1), ...r];
  };
  const left = dp(poly.slice(0, far + 1));
  const right = dp([...poly.slice(far), poly[0]]);
  return [...left.slice(0, -1), ...right.slice(0, -1)];
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function polygonArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i],
      [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function pointInPolygon(x: number, y: number, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i],
      [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Pontos internos em grade (para a malha dobrar bem), afastados do contorno.
export function interiorGrid(hull: Pt[], spacing: number): Pt[] {
  const xs = hull.map((p) => p[0]),
    ys = hull.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out: Pt[] = [];
  for (let y = y0 + spacing / 2; y < y1; y += spacing)
    for (let x = x0 + spacing / 2; x < x1; x += spacing) {
      if (!pointInPolygon(x, y, hull)) continue;
      let near = false;
      for (let i = 0; i < hull.length && !near; i++) if (segDist([x, y], hull[i], hull[(i + 1) % hull.length]) < spacing * 0.45) near = true;
      if (!near) out.push([x, y]);
    }
  return out;
}

// Meio das faixas mais estreitas que a grade, varrendo linhas horizontais e verticais a
// cada meio espacamento: cada trecho de dentro mais fino que a grade ganha o ponto do meio.
export function thinMidpoints(hull: Pt[], spacing: number): Pt[] {
  const out: Pt[] = [];
  const xs = hull.map((p) => p[0]),
    ys = hull.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = spacing / 2;
  const spans = (c: number, axis: 0 | 1): [number, number][] => {
    const hits: number[] = [];
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i],
        b = hull[(i + 1) % hull.length];
      const o = 1 - axis;
      if ((a[o] <= c && b[o] > c) || (b[o] <= c && a[o] > c)) hits.push(a[axis] + ((c - a[o]) / (b[o] - a[o])) * (b[axis] - a[axis]));
    }
    hits.sort((p, q) => p - q);
    const r: [number, number][] = [];
    for (let i = 0; i + 1 < hits.length; i += 2) r.push([hits[i], hits[i + 1]]);
    return r;
  };
  // linhas horizontais: faixas finas na vertical (tronco em pe)
  for (let y = y0 + step; y < y1; y += step) for (const [a, b] of spans(y, 0)) if (b - a < spacing * 0.9 && b - a > 2) out.push([(a + b) / 2, y]);
  // colunas: faixas finas na horizontal (galho deitado)
  for (let x = x0 + step; x < x1; x += step) for (const [a, b] of spans(x, 1)) if (b - a < spacing * 0.9 && b - a > 2) out.push([x, (a + b) / 2]);
  // tira repetidos (cruzamento das duas varreduras)
  const keep: Pt[] = [];
  for (const q of out) if (!keep.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < step * 0.6)) keep.push(q);
  return keep;
}

// Delaunay (Bowyer-Watson) dos pontos, mantendo so triangulos dentro do contorno.
// Os primeiros `hullCount` pontos sao o contorno, em ordem.
export function triangulate(points: Pt[], hullCount: number): number[] {
  const n = points.length;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const minX = Math.min(...xs),
    minY = Math.min(...ys);
  const dx = Math.max(...xs) - minX || 1,
    dy = Math.max(...ys) - minY || 1;
  const dm = Math.max(dx, dy) * 20;
  const mx = minX + dx / 2,
    my = minY + dy / 2;
  const P: Pt[] = [...points, [mx - dm, my - dm], [mx, my + dm], [mx + dm, my - dm]];
  type T = { a: number; b: number; c: number; cx: number; cy: number; r2: number };
  const circ = (a: number, b: number, c: number): T => {
    const [ax, ay] = P[a],
      [bx, by] = P[b],
      [cx, cy] = P[c];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { a, b, c, cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: T[] = [circ(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i];
    const bad = tris.filter((t) => (px - t.cx) ** 2 + (py - t.cy) ** 2 < t.r2 * (1 + 1e-9));
    const edges = new Map<string, [number, number]>();
    for (const t of bad)
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ]) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        edges.has(k) ? edges.delete(k) : edges.set(k, [u, v]);
      }
    tris = tris.filter((t) => !bad.includes(t));
    for (const [u, v] of edges.values()) tris.push(circ(u, v, i));
  }
  const hull = points.slice(0, hullCount);
  const out: number[] = [];
  for (const t of tris) {
    if (t.a >= n || t.b >= n || t.c >= n) continue;
    const cx = (P[t.a][0] + P[t.b][0] + P[t.c][0]) / 3,
      cy = (P[t.a][1] + P[t.b][1] + P[t.c][1]) / 3;
    if (!pointInPolygon(cx, cy, hull)) continue;
    // ordem consistente (anti-horaria em y para cima)
    const area = (P[t.b][0] - P[t.a][0]) * (P[t.c][1] - P[t.a][1]) - (P[t.c][0] - P[t.a][0]) * (P[t.b][1] - P[t.a][1]);
    out.push(...(area > 0 ? [t.a, t.b, t.c] : [t.a, t.c, t.b]));
  }
  return out;
}

// Grade regular cobrindo o retangulo [0,w]x[0,h] (cols x rows celulas).
export function gridMesh(w: number, h: number, cols: number, rows: number): { points: Pt[]; hullCount: number; triangles: number[] } {
  // contorno primeiro (em ordem), depois os internos
  const hull: Pt[] = [];
  for (let i = 0; i < cols; i++) hull.push([(i / cols) * w, 0]);
  for (let j = 0; j < rows; j++) hull.push([w, (j / rows) * h]);
  for (let i = cols; i > 0; i--) hull.push([(i / cols) * w, h]);
  for (let j = rows; j > 0; j--) hull.push([0, (j / rows) * h]);
  const inner: Pt[] = [];
  for (let j = 1; j < rows; j++) for (let i = 1; i < cols; i++) inner.push([(i / cols) * w, (j / rows) * h]);
  const points = [...hull, ...inner];
  const idx = (i: number, j: number) => points.findIndex((p) => Math.abs(p[0] - (i / cols) * w) < 1e-6 && Math.abs(p[1] - (j / rows) * h) < 1e-6);
  const triangles: number[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = idx(i, j),
        b = idx(i + 1, j),
        c = idx(i + 1, j + 1),
        d = idx(i, j + 1);
      triangles.push(a, b, c, a, c, d);
    }
  return { points, hullCount: hull.length, triangles };
}

// Empurra o poligono para fora em d (vertices andam na bissetriz das normais das
// arestas vizinhas), limitado ao retangulo [0,w]x[0,h]. Compensa a simplificacao,
// que pode cortar para dentro do desenho.
export function inflate(poly: Pt[], d: number, w: number, h: number): Pt[] {
  const ccw = polygonArea(poly) > 0;
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i + n - 1) % n],
      c = poly[(i + 1) % n];
    const nrm = (u: Pt, v: Pt): Pt => {
      const dx = v[0] - u[0],
        dy = v[1] - u[1];
      const l = Math.hypot(dx, dy) || 1;
      // normal para fora: depende da orientacao (y para baixo na imagem)
      return ccw ? [dy / l, -dx / l] : [-dy / l, dx / l];
    };
    const n1 = nrm(a, p),
      n2 = nrm(p, c);
    let bx = n1[0] + n2[0],
      by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const cos = Math.max(0.35, bx * n1[0] + by * n1[1]);
    const k = d / cos;
    return [Math.max(0, Math.min(w, p[0] + bx * k)), Math.max(0, Math.min(h, p[1] + by * k))];
  });
}

// Malha automatica de uma imagem: contorno simplificado (por fora) + grade interna.
export function autoMesh(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, opts: { detail?: number; interior?: number; stride?: number } = {}) {
  const detail = opts.detail ?? 1; // 0.5 grosso .. 2 fino
  const tol = Math.max(1.5, Math.min(w, h) / (40 * detail));
  let hull = simplify(alphaContour(alpha, w, h, { stride: opts.stride }), tol);
  if (hull.length < 3) hull = [[0, 0], [w, 0], [w, h], [0, h]];
  hull = inflate(hull, tol, w, h);
  const spacing = Math.max(w, h) / ((opts.interior ?? 5) * detail);
  const inner = interiorGrid(hull, spacing);
  // partes finas (tronco, rabo, corda) nao recebem ponto da grade: pontos no meio delas,
  // ao longo do comprimento, para a malha dobrar
  // (perto do contorno e normal numa faixa fina: so evita repetir pontos da grade)
  const grid = inner.slice();
  for (const q of thinMidpoints(hull, spacing)) if (!grid.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < spacing * 0.35)) inner.push(q);
  const points = [...hull, ...inner];
  return { points, hullCount: hull.length, triangles: triangulate(points, hull.length) };
}

// Triangulacao para malhas editadas a mao: o contorno (primeiros `hullCount` pontos,
// em ordem) e respeitado mesmo concavo. Corta orelhas do contorno, encaixa os pontos
// internos (dividindo o triangulo ou a aresta onde caem) e depois troca diagonais ate
// ficar Delaunay, sem nunca trocar arestas do contorno. Pontos internos fora do
// contorno ficam de fora. Se o contorno se cruza, cai na triangulacao antiga.
export function triangulateHull(points: Pt[], hullCount: number): number[] {
  const P = points;
  const cross = (a: number, b: number, c: number) => (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
  const hull = Array.from({ length: hullCount }, (_, i) => i);
  if (hullCount < 3) return [];
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const eps = size * size * 1e-9;
  // orientacao do contorno: trabalha sempre com area positiva
  const sign = polygonArea(hull.map((i) => P[i])) >= 0 ? 1 : -1;
  const orient = (a: number, b: number, c: number) => sign * cross(a, b, c);
  if (selfIntersects(hull.map((i) => P[i]))) return triangulate(points, hullCount);
  // ponto dentro ou na borda do triangulo abc (orientado positivo)
  const inside = (p: number, a: number, b: number, c: number) => orient(a, b, p) >= -eps && orient(b, c, p) >= -eps && orient(c, a, p) >= -eps;
  const tris: [number, number, number][] = [];
  const poly = hull.slice();
  let guard = poly.length * poly.length + 10;
  while (poly.length > 3 && guard-- > 0) {
    let cut = -1;
    for (let k = 0; k < poly.length && cut < 0; k++) {
      const a = poly[(k + poly.length - 1) % poly.length],
        b = poly[k],
        c = poly[(k + 1) % poly.length];
      if (orient(a, b, c) <= eps) continue;
      let ok = true;
      for (const q of poly) if (q !== a && q !== b && q !== c && inside(q, a, b, c)) (ok = false);
      if (ok) cut = k;
    }
    if (cut < 0) return triangulate(points, hullCount);
    const n = poly.length;
    tris.push([poly[(cut + n - 1) % n], poly[cut], poly[(cut + 1) % n]]);
    poly.splice(cut, 1);
  }
  if (poly.length === 3 && orient(poly[0], poly[1], poly[2]) > eps) tris.push([poly[0], poly[1], poly[2]]);
  const ekey = (u: number, v: number) => (u < v ? u * 1048576 + v : v * 1048576 + u);
  const fixed = new Set<number>();
  for (let i = 0; i < hullCount; i++) fixed.add(ekey(i, (i + 1) % hullCount));
  // pontos internos
  for (let p = hullCount; p < P.length; p++) {
    let at = -1;
    for (let t = 0; t < tris.length && at < 0; t++) if (inside(p, ...tris[t])) at = t;
    if (at < 0) continue;
    const [a, b, c] = tris[at];
    // caiu sobre uma aresta: divide os dois lados dela
    const edges: [number, number, number][] = [
      [a, b, c],
      [b, c, a],
      [c, a, b],
    ];
    const on = edges.find(([u, v]) => Math.abs(orient(u, v, p)) <= eps);
    if (on) {
      const [u, v, w] = on;
      if (fixed.has(ekey(u, v))) continue;
      const other = tris.findIndex((t, i) => i !== at && t.includes(u) && t.includes(v));
      tris.splice(at, 1, [u, p, w], [p, v, w]);
      if (other >= 0) {
        const o = other > at ? other + 1 : other;
        const x = tris[o].find((q) => q !== u && q !== v)!;
        tris.splice(o, 1, [v, p, x], [p, u, x]);
      }
      continue;
    }
    tris.splice(at, 1, [a, b, p], [b, c, p], [c, a, p]);
  }
  // Lawson: troca a diagonal enquanto o vertice oposto estiver no circulo
  const inCircle = (a: number, b: number, c: number, d: number) => {
    const [ax, ay] = [P[a][0] - P[d][0], P[a][1] - P[d][1]];
    const [bx, by] = [P[b][0] - P[d][0], P[b][1] - P[d][1]];
    const [cx, cy] = [P[c][0] - P[d][0], P[c][1] - P[d][1]];
    const det = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
    return sign * det > eps * size * size;
  };
  for (let pass = 0; pass < 200; pass++) {
    const owner = new Map<number, number[]>();
    tris.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const key = ekey(t[k], t[(k + 1) % 3]);
        const l = owner.get(key);
        l ? l.push(i) : owner.set(key, [i]);
      }
    });
    let flipped = false;
    const dirty = new Set<number>();
    for (const [key, list] of owner) {
      if (list.length !== 2 || fixed.has(key) || dirty.has(list[0]) || dirty.has(list[1])) continue;
      const [t1, t2] = list.map((i) => tris[i]);
      // aresta u-v com t1 = (u, v, w) orientado
      let k = 0;
      while (ekey(t1[k], t1[(k + 1) % 3]) !== key) k++;
      const u = t1[k],
        v = t1[(k + 1) % 3],
        w = t1[(k + 2) % 3];
      const x = t2.find((q) => q !== u && q !== v)!;
      if (!inCircle(u, v, w, x)) continue;
      // so troca se o quadrilatero for convexo (os dois triangulos novos positivos)
      if (orient(w, u, x) <= eps || orient(x, v, w) <= eps) continue;
      tris[list[0]] = [w, u, x];
      tris[list[1]] = [x, v, w];
      dirty.add(list[0]);
      dirty.add(list[1]);
      flipped = true;
    }
    if (!flipped) break;
  }
  // mesma convencao de triangulate: area positiva em y para cima
  const out: number[] = [];
  for (const [a, b, c] of tris) {
    if (Math.abs(cross(a, b, c)) <= eps) continue;
    out.push(...(cross(a, b, c) > 0 ? [a, b, c] : [a, c, b]));
  }
  return out;
}

function selfIntersects(poly: Pt[]): boolean {
  const n = poly.length;
  const ccw = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = poly[i],
        b = poly[(i + 1) % n],
        c = poly[j],
        d = poly[(j + 1) % n];
      const d1 = ccw(a, b, c),
        d2 = ccw(a, b, d),
        d3 = ccw(c, d, a),
        d4 = ccw(c, d, b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  return false;
}
