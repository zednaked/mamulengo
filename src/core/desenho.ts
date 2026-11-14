// Desenho vetorial das imagens (o ambiente Desenhar): as formas ficam no documento, em
// `drawings.<imagem>`, e a imagem que o jogo le sai delas, numa pagina de atlas so dos
// desenhos (<personagem>-desenhos.png), refeita no editor a cada mudanca e gravada ao salvar.
// Puro: os comandos, o editor e os testes usam o mesmo calculo.
//
// Coordenadas em pixels da imagem, origem no canto de cima a esquerda, y para baixo (como no
// SVG). Cada forma e um contorno principal mais furos (outros contornos; o preenchimento e
// par-impar, como fill-rule evenodd no SVG): pontos com alcas relativas ao ponto (in chega, out
// sai); ponto sem alcas e canto, e o raio dele arredonda o canto quando os dois lados sao retos.

export type Vec = [number, number];

export interface DrawPoint {
  x: number;
  y: number;
  in?: Vec;
  out?: Vec;
  radius?: number;
  // traco de largura variavel (o lapis, src/core/lapis.ts): a largura aqui, em fracao da largura
  // do traco (a pressao da caneta); sem ele vale 1
  press?: number;
}

export interface DrawStroke {
  color: string;
  width: number;
  align?: "inside" | "center" | "outside";
  join?: "miter" | "round" | "bevel";
  cap?: "butt" | "round" | "square";
  // afina no comeco e no fim do traco aberto, em pixels de comprimento (o lapis)
  taper?: [number, number];
}

export interface Contour {
  points: DrawPoint[];
  closed?: boolean;
}

export interface DrawShape {
  name: string;
  points: DrawPoint[];
  closed?: boolean;
  // furos: contornos que tiram do preenchimento (o traco passa por eles tambem)
  holes?: Contour[];
  fill?: string;
  // regra do preenchimento: par-impar (padrao, os furos sao furos) ou "nonzero" (pelo sentido do
  // contorno, como nas fontes TrueType: pedacos que se sobrepoem somam em vez de furar)
  rule?: "nonzero";
  stroke?: DrawStroke;
  hidden?: boolean;
}

export interface Drawing {
  width: number;
  height: number;
  // pixels de textura por pixel da imagem (a nitidez quando a peca aparece grande)
  hd?: number;
  shapes: DrawShape[];
  // a pintura (raster) por baixo das formas: os pixels ficam fora do documento, num PNG ao lado
  // do personagem (pinturaArquivo) e, no editor, na memoria (src/app/pintura.ts). `rev` nomeia o
  // estado dos pixels: cada pincelada troca o rev, e desfazer volta ao rev de antes
  raster?: { rev: string };
}

// a pasta das pinturas ao lado do atlas (x.atlas -> x-pinturas/) e o arquivo de uma imagem nela
export function pinturasPasta(atlasFile: string): string {
  return atlasFile.split("/").pop()!.replace(/\.atlas$/, "").replace(/\.boneco$/, "") + "-pinturas";
}
export function pinturaArquivo(image: string): string {
  return image.replace(/[^A-Za-z0-9_.-]/g, (c) => "~" + c.charCodeAt(0).toString(16)) + ".png";
}

export const drawingsOf = (json: any): Record<string, Drawing> => json?.drawings ?? {};

export function requireDrawing(json: any, image: string): Drawing {
  const d = drawingsOf(json)[image];
  if (!d) throw new Error(`nao ha desenho "${image}". Desenhos: ${Object.keys(drawingsOf(json)).join(", ") || "(nenhum)"}`);
  return d;
}

// forma por nome ou indice
export function shapeIndex(d: Drawing, shape: string | number): number {
  const i = typeof shape === "number" ? shape : d.shapes.findIndex((s) => s.name === shape);
  if (i < 0 || i >= d.shapes.length) throw new Error(`forma inexistente: ${shape}. Formas: ${d.shapes.map((s) => s.name).join(", ") || "(nenhuma)"}`);
  return i;
}

// ---- contorno

// os contornos de uma forma: 0 e o principal, 1.. os furos
export function contours(s: DrawShape): Contour[] {
  return [{ points: s.points, closed: s.closed }, ...(s.holes ?? [])];
}

export function contourOf(s: DrawShape, c: number): Contour {
  const all = contours(s);
  if (c < 0 || c >= all.length) throw new Error(`contorno ${c}: a forma ${s.name} tem ${all.length} (0 = o principal, 1 em diante = furos)`);
  return all[c];
}

// o caminho inteiro da forma: o principal e os furos
export function shapeOutline(s: DrawShape): Seg[] {
  return contours(s).flatMap((c) => outline(c));
}

// o que uma forma vira para desenhar: os comandos de um caminho (canvas, Path2D ou SVG)
export type Seg = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  closePath(): void;
}

const hasIn = (p: DrawPoint) => !!p.in && (p.in[0] !== 0 || p.in[1] !== 0);
const hasOut = (p: DrawPoint) => !!p.out && (p.out[0] !== 0 || p.out[1] !== 0);

// troca cada canto arredondado por dois pontos com alcas (o arco em uma cubica)
function fillets(points: DrawPoint[], closed: boolean): DrawPoint[] {
  const n = points.length;
  if (n < 3) return points;
  const rounded = (i: number) => {
    const p = points[i];
    if (!p.radius || p.radius <= 0 || hasIn(p) || hasOut(p)) return false;
    if (!closed && (i === 0 || i === n - 1)) return false;
    // so com os dois lados retos (vizinho sem alca para este lado)
    const a = points[(i - 1 + n) % n],
      b = points[(i + 1) % n];
    return !hasOut(a) && !hasIn(b);
  };
  const out: DrawPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!rounded(i)) {
      out.push(p);
      continue;
    }
    const a = points[(i - 1 + n) % n],
      b = points[(i + 1) % n];
    const la = Math.hypot(a.x - p.x, a.y - p.y),
      lb = Math.hypot(b.x - p.x, b.y - p.y);
    if (la < 1e-9 || lb < 1e-9) {
      out.push(p);
      continue;
    }
    const ua: Vec = [(a.x - p.x) / la, (a.y - p.y) / la],
      ub: Vec = [(b.x - p.x) / lb, (b.y - p.y) / lb];
    // angulo interno do canto
    const phi = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1])));
    if (phi < 1e-3 || Math.PI - phi < 1e-3) {
      out.push(p);
      continue;
    }
    // distancia do canto ate onde o arco encosta; no maximo metade do lado se o vizinho
    // tambem arredonda, o lado inteiro se nao
    const lim = (i2: number, len: number) => (rounded(i2) ? len / 2 : len);
    const t = Math.min(p.radius! / Math.tan(phi / 2), lim((i - 1 + n) % n, la), lim((i + 1) % n, lb));
    const turn = Math.PI - phi;
    const h = (4 / 3) * Math.tan(turn / 4) * t * Math.tan(phi / 2);
    const t1: DrawPoint = { x: p.x + ua[0] * t, y: p.y + ua[1] * t, out: [-ua[0] * h, -ua[1] * h] };
    const t2: DrawPoint = { x: p.x + ub[0] * t, y: p.y + ub[1] * t, in: [-ub[0] * h, -ub[1] * h] };
    out.push(t1, t2);
  }
  return out;
}

export function outline(s: Pick<DrawShape, "points" | "closed">): Seg[] {
  const pts = fillets(s.points, !!s.closed);
  const n = pts.length;
  if (!n) return [];
  const segs: Seg[] = [["M", pts[0].x, pts[0].y]];
  const edge = (a: DrawPoint, b: DrawPoint) => {
    if (!hasOut(a) && !hasIn(b)) segs.push(["L", b.x, b.y]);
    else segs.push(["C", a.x + (a.out?.[0] ?? 0), a.y + (a.out?.[1] ?? 0), b.x + (b.in?.[0] ?? 0), b.y + (b.in?.[1] ?? 0), b.x, b.y]);
  };
  for (let i = 0; i + 1 < n; i++) edge(pts[i], pts[i + 1]);
  if (s.closed && n > 1) {
    edge(pts[n - 1], pts[0]);
    segs.push(["Z"]);
  }
  return segs;
}

export function trace(sink: PathSink, segs: Seg[]) {
  for (const s of segs) {
    if (s[0] === "M") sink.moveTo(s[1], s[2]);
    else if (s[0] === "L") sink.lineTo(s[1], s[2]);
    else if (s[0] === "C") sink.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
    else sink.closePath();
  }
}

const num = (v: number) => String(Math.round(v * 100) / 100);

export function svgPath(s: Pick<DrawShape, "points" | "closed" | "holes">): string {
  return [{ points: s.points, closed: s.closed }, ...(s.holes ?? [])]
    .flatMap((c) => outline(c))
    .map((g) => g[0] + (g.length > 1 ? g.slice(1).map((v) => num(v as number)).join(" ") : ""))
    .join(" ");
}

// polilinha do contorno (para mirar e desenhar por cima); um ponto a cada `step` pixels
export function flatten(s: Pick<DrawShape, "points" | "closed">, step = 2): Vec[] {
  const out: Vec[] = [];
  let x = 0,
    y = 0;
  for (const g of outline(s)) {
    if (g[0] === "M" || g[0] === "L") {
      [x, y] = [g[1], g[2]];
      out.push([x, y]);
    } else if (g[0] === "C") {
      const len = Math.hypot(g[1] - x, g[2] - y) + Math.hypot(g[3] - g[1], g[4] - g[2]) + Math.hypot(g[5] - g[3], g[6] - g[4]);
      const k = Math.max(2, Math.min(64, Math.ceil(len / step)));
      for (let j = 1; j <= k; j++) out.push(cubicAt([x, y], [g[1], g[2]], [g[3], g[4]], [g[5], g[6]], j / k));
      [x, y] = [g[5], g[6]];
    } else if (out.length) out.push(out[0]);
  }
  return out;
}

export function cubicAt(a: Vec, b: Vec, c: Vec, d: Vec, t: number): Vec {
  const u = 1 - t;
  return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
}

// caixa [x0, y0, x1, y1] do contorno (com a curva, sem o traco)
export function shapeBounds(s: Pick<DrawShape, "points" | "closed">): [number, number, number, number] | null {
  const f = flatten(s, 1);
  if (!f.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of f) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  return [x0, y0, x1, y1];
}

// ---- trechos (para por um ponto no meio de um lado)

// o lado i vai do ponto i ao i+1 (no fechado, o ultimo volta ao primeiro)
export function segmentCount(s: Pick<DrawShape, "points" | "closed">) {
  const n = s.points.length;
  return s.closed ? n : Math.max(0, n - 1);
}

function segmentControls(s: Pick<DrawShape, "points" | "closed">, i: number): [Vec, Vec, Vec, Vec] {
  const n = s.points.length;
  const a = s.points[i],
    b = s.points[(i + 1) % n];
  return [
    [a.x, a.y],
    [a.x + (a.out?.[0] ?? 0), a.y + (a.out?.[1] ?? 0)],
    [b.x + (b.in?.[0] ?? 0), b.y + (b.in?.[1] ?? 0)],
    [b.x, b.y],
  ];
}

// lado e parametro mais perto de um ponto (na imagem)
export function nearestOnShape(s: Pick<DrawShape, "points" | "closed">, x: number, y: number): { seg: number; t: number; at: Vec; d: number } | null {
  let best: { seg: number; t: number; at: Vec; d: number } | null = null;
  for (let i = 0; i < segmentCount(s); i++) {
    const [a, b, c, d] = segmentControls(s, i);
    const k = 48;
    for (let j = 0; j <= k; j++) {
      const t = j / k;
      const p = cubicAt(a, b, c, d, t);
      const dd = Math.hypot(p[0] - x, p[1] - y);
      if (!best || dd < best.d) best = { seg: i, t, at: p, d: dd };
    }
  }
  return best;
}

// divide o lado seg em t (de Casteljau): devolve os pontos com o ponto novo no lugar, a forma
// do lado continua a mesma
export function splitSegment(s: Pick<DrawShape, "points" | "closed">, seg: number, t: number): { points: DrawPoint[]; index: number } {
  const n = s.points.length;
  const pts = s.points.map((p) => structuredClone(p));
  const ia = seg,
    ib = (seg + 1) % n;
  const a = pts[ia],
    b = pts[ib];
  const curve = hasOut(a) || hasIn(b);
  const [p0, p1, p2, p3] = segmentControls(s, seg);
  const lerp = (u: Vec, v: Vec, k: number): Vec => [u[0] + (v[0] - u[0]) * k, u[1] + (v[1] - u[1]) * k];
  const q0 = lerp(p0, p1, t),
    q1 = lerp(p1, p2, t),
    q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t),
    r1 = lerp(q1, q2, t);
  const m = lerp(r0, r1, t);
  const mid: DrawPoint = { x: round(m[0]), y: round(m[1]) };
  if (a.press !== undefined || b.press !== undefined) mid.press = round((a.press ?? 1) + ((b.press ?? 1) - (a.press ?? 1)) * t);
  if (curve) {
    a.out = [round(q0[0] - p0[0]), round(q0[1] - p0[1])];
    mid.in = [round(r0[0] - m[0]), round(r0[1] - m[1])];
    mid.out = [round(r1[0] - m[0]), round(r1[1] - m[1])];
    b.in = [round(q2[0] - p3[0]), round(q2[1] - p3[1])];
  }
  pts.splice(ia + 1, 0, mid);
  return { points: pts, index: ia + 1 };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// ---- formas prontas

export function rectPoints(x: number, y: number, w: number, h: number, radius = 0): DrawPoint[] {
  const r = radius > 0 ? { radius } : {};
  return [
    { x, y, ...r },
    { x: x + w, y, ...r },
    { x: x + w, y: y + h, ...r },
    { x, y: y + h, ...r },
  ];
}

export function ellipsePoints(cx: number, cy: number, rx: number, ry: number): DrawPoint[] {
  const k = 0.5522847498;
  return [
    { x: cx, y: cy - ry, in: [-rx * k, 0], out: [rx * k, 0] },
    { x: cx + rx, y: cy, in: [0, -ry * k], out: [0, ry * k] },
    { x: cx, y: cy + ry, in: [rx * k, 0], out: [-rx * k, 0] },
    { x: cx - rx, y: cy, in: [0, ry * k], out: [0, -ry * k] },
  ].map((p) => ({ x: round(p.x), y: round(p.y), in: p.in.map(round) as Vec, out: p.out.map(round) as Vec }));
}

// poligono regular, com a primeira ponta em cima; estrela com inner (raio de dentro, 0 a 1)
export function polygonPoints(cx: number, cy: number, radius: number, sides: number, inner?: number): DrawPoint[] {
  const out: DrawPoint[] = [];
  const n = inner ? sides * 2 : sides;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = inner && i % 2 ? radius * inner : radius;
    out.push({ x: round(cx + Math.cos(a) * r), y: round(cy + Math.sin(a) * r) });
  }
  return out;
}

// ---- SVG (o atributo d de um <path>)

// um contorno por subcaminho; arcos (A) ainda nao
export function parseSvgPath(d: string): { points: DrawPoint[]; closed: boolean }[] {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: { points: DrawPoint[]; closed: boolean }[] = [];
  let cur: { points: DrawPoint[]; closed: boolean } | null = null;
  let i = 0;
  let cmd = "";
  let x = 0,
    y = 0;
  // ultimo controle (para S e T)
  let lastC: Vec | null = null,
    lastQ: Vec | null = null;
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
  const n = () => {
    if (!isNum()) throw new Error(`caminho SVG: faltou numero depois de ${cmd}`);
    return parseFloat(toks[i++]);
  };
  const last = () => cur!.points[cur!.points.length - 1];
  const start = (px: number, py: number) => {
    cur = { points: [{ x: px, y: py }], closed: false };
    out.push(cur);
  };
  const cubic = (c1: Vec, c2: Vec, px: number, py: number) => {
    const p = last();
    p.out = [round(c1[0] - p.x), round(c1[1] - p.y)];
    cur!.points.push({ x: px, y: py, in: [round(c2[0] - px), round(c2[1] - py)] });
    lastC = c2;
  };
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) throw new Error("caminho SVG: comeca sem comando");
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0,
      oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    if (C !== "Z" && !cur && C !== "M") throw new Error("caminho SVG: precisa comecar com M");
    let qc: Vec | null = null;
    let cc: Vec | null = null;
    switch (C) {
      case "M": {
        x = ox + n();
        y = oy + n();
        start(x, y);
        // pares seguintes sao L
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        x = ox + n();
        y = oy + n();
        cur!.points.push({ x, y });
        break;
      case "H":
        x = ox + n();
        cur!.points.push({ x, y });
        break;
      case "V":
        y = oy + n();
        cur!.points.push({ x, y });
        break;
      case "C": {
        const c1: Vec = [ox + n(), oy + n()],
          c2: Vec = [ox + n(), oy + n()];
        x = ox + n();
        y = oy + n();
        cubic(c1, c2, x, y);
        cc = c2;
        break;
      }
      case "S": {
        const p = last();
        const c1: Vec = lastC ? [2 * p.x - lastC[0], 2 * p.y - lastC[1]] : [p.x, p.y];
        const c2: Vec = [ox + n(), oy + n()];
        x = ox + n();
        y = oy + n();
        cubic(c1, c2, x, y);
        cc = c2;
        break;
      }
      case "Q":
      case "T": {
        const p = last();
        const q: Vec = C === "Q" ? [ox + n(), oy + n()] : lastQ ? [2 * p.x - lastQ[0], 2 * p.y - lastQ[1]] : [p.x, p.y];
        x = ox + n();
        y = oy + n();
        // quadratica -> cubica
        cubic([p.x + (2 / 3) * (q[0] - p.x), p.y + (2 / 3) * (q[1] - p.y)], [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)], x, y);
        qc = q;
        break;
      }
      case "Z": {
        if (cur) {
          const c: { points: DrawPoint[]; closed: boolean } = cur;
          c.closed = true;
          const f = c.points[0],
            l = c.points[c.points.length - 1];
          // o ultimo ponto em cima do primeiro: um ponto so, com a alca de chegada dele
          if (c.points.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
            if (l.in) f.in = l.in;
            c.points.pop();
          }
          x = f.x;
          y = f.y;
        }
        cur = null;
        break;
      }
      case "A":
        throw new Error("caminho SVG: arcos (A) ainda nao; converta para curvas");
      default:
        throw new Error(`caminho SVG: comando desconhecido ${cmd}`);
    }
    if (C !== "C" && C !== "S") lastC = cc;
    if (C !== "Q" && C !== "T") lastQ = null;
    else lastQ = qc;
    // depois de Z, um numero solto e erro; M novo comeca outro contorno
    if (C === "Z" && isNum()) throw new Error("caminho SVG: numero depois de Z");
    if (C === "Z" && i < toks.length && toks[i].toUpperCase() !== "M") {
      // comando depois de Z sem M: continua do ponto inicial
      start(x, y);
    }
  }
  for (const c of out) for (const p of c.points) (p.x = round(p.x)), (p.y = round(p.y));
  return out.filter((c) => c.points.length);
}

// ---- pagina de atlas dos desenhos

export interface DrawLayout {
  width: number;
  height: number;
  regions: { name: string; x: number; y: number; w: number; h: number; hd: number }[];
}

const PAD = 2;

// prateleiras, das imagens mais altas para as mais baixas (o mesmo desenho sempre cai no
// mesmo lugar: a ordem desempata pelo nome)
export function layoutDrawings(drawings: Record<string, Drawing>): DrawLayout | null {
  const items = Object.entries(drawings).map(([name, d]) => {
    const hd = d.hd ?? 2;
    return { name, w: Math.max(1, Math.ceil(d.width * hd)), h: Math.max(1, Math.ceil(d.height * hd)), hd };
  });
  if (!items.length) return null;
  items.sort((a, b) => b.h - a.h || b.w - a.w || (a.name < b.name ? -1 : 1));
  const area = items.reduce((s, r) => s + (r.w + PAD) * (r.h + PAD), 0);
  // largura: perto de um quadrado, sem passar da fila inteira numa linha so
  const fila = items.reduce((s, r) => s + r.w + PAD, PAD);
  const W = Math.min(4096, Math.max(Math.max(...items.map((r) => r.w)) + PAD * 2, Math.min(fila, Math.ceil(Math.sqrt(area) * 1.15))));
  let x = PAD,
    y = PAD,
    row = 0;
  const regions: DrawLayout["regions"] = [];
  for (const r of items) {
    if (x + r.w + PAD > W && x > PAD) {
      x = PAD;
      y += row + PAD;
      row = 0;
    }
    regions.push({ name: r.name, x, y, w: r.w, h: r.h, hd: r.hd });
    x += r.w + PAD;
    row = Math.max(row, r.h);
  }
  return { width: W, height: y + row + PAD, regions };
}

// nome da pagina dos desenhos para um atlas (x.atlas ou x.boneco.atlas -> x-desenhos.png)
export function drawingPageName(atlasFile: string): string {
  const base = atlasFile.split("/").pop()!.replace(/\.atlas$/, "").replace(/\.boneco$/, "");
  return `${base}-desenhos.png`;
}

// o texto do atlas sem a pagina dos desenhos
export function stripPage(text: string, page: string): string {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).filter((b) => b.trim());
  return blocks.filter((b) => b.trim().split("\n")[0].trim() !== page).join("\n\n");
}

export function atlasWithDrawings(text: string, page: string, layout: DrawLayout | null): string {
  const base = stripPage(text, page).trim();
  if (!layout) return base ? base + "\n" : "";
  const lines = [page, `size:${layout.width},${layout.height}`, "filter:Linear,Linear"];
  for (const r of layout.regions) lines.push(r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`);
  return (base ? base + "\n\n" : "") + lines.join("\n") + "\n";
}

// chave do arranjo: muda quando a pagina precisa ser refeita do zero (nova imagem, tamanho)
export const layoutKey = (l: DrawLayout | null) => (l ? `${l.width}x${l.height}|` + l.regions.map((r) => `${r.name}:${r.x},${r.y},${r.w},${r.h}`).join(";") : "");
