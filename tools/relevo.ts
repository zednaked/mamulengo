// Relevo das paginas de um .boneco (docs/NUCLEO.md "Luzes"): um mapa de normais por pagina,
// calculado da propria arte, para as luzes iluminarem as pecas sem o artista pintar nada. A altura
// sobe da borda num perfil de almofada (inclinada na borda, plana no miolo), mais um pouco do
// brilho da cor (detalhe); a normal sai da inclinacao.
//
// A borda e a da silhueta do personagem montado (modo silhueta, o padrao): o personagem na pose de
// montagem (os ossos pelo nucleo-pose), a uniao dos pixels opacos das pecas, e a altura de cada
// pixel de cada peca pela distancia ate a borda dessa uniao. Onde as pecas se juntam (o punho na
// mao, o pescoco no corpo) a superficie continua, sem vinco. As trocas de imagem de um slot (as
// caras) usam o lugar que teriam nele; imagem que nao esta em slot nenhum, e as giradas ou
// cortadas no atlas, ficam pela borda delas mesmas, como no modo peca.
//
//   npx tsx tools/relevo.ts <x.boneco> [--borda 12] [--profundidade 1] [--detalhe 0.2] [--paginas 0,2]
//                           [--modo silhueta|peca] [--nucleo nucleo/build/nucleo-pose] [--gravar]
//
//   --borda         largura da borda inclinada, em pixels da pagina (multiplique numa pagina HD)
//   --profundidade  quanto a borda sobe (1: a borda sobe a largura dela, 45 graus)
//   --detalhe       quanto o brilho da cor vira relevo (0: so a forma)
//   --paginas       so estas paginas (indices; padrao: as das partes das skins, abaixo); a silhueta
//                   e so das pecas destas paginas (o cenario de outra pagina nao entra)
//   --modo peca     cada imagem pela borda dela (o relevo de antes: vinco onde as pecas encostam)
//   --gravar        poe "relevo" nas paginas do .boneco
// So as paginas das partes das skins, fora dos slots aditivo e tela (luz nao recebe luz). Cada
// relevo vai ao lado da pagina: <pagina>_relevo.png (vermelho: x para a direita; verde: y para
// cima; azul: para fora da tela).
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const gravar = args.includes("--gravar") && (args.splice(args.indexOf("--gravar"), 1), true);
const borda = Number(opt("borda", "12"));
const profundidade = Number(opt("profundidade", "1"));
const detalhe = Number(opt("detalhe", "0.2"));
const soPaginas = opt("paginas", "");
const modo = opt("modo", "silhueta");
const nucleo = resolve(opt("nucleo", join(dirname(fileURLToPath(import.meta.url)), "..", "nucleo", "build", "nucleo-pose")));
const [arq] = args;
if (!arq || (modo !== "silhueta" && modo !== "peca")) {
  console.error("uso: tools/relevo.ts <x.boneco> [--borda 12] [--profundidade 1] [--detalhe 0.2] [--paginas 0,2] [--modo silhueta|peca] [--gravar]");
  process.exit(2);
}
const b = JSON.parse(readFileSync(resolve(arq), "utf8"));
const pasta = dirname(resolve(arq));

// as imagens usadas pelas skins (o nome da parte, ou o caminho dela), fora dos slots que somam
// luz ou clareiam (aditivo, tela: sao luz, nao recebem luz)
const emissivos = new Set((b.slots ?? []).filter((s: any) => s.blend === "aditivo" || s.blend === "tela").map((s: any) => s.nome));
const usadas = new Set<string>();
for (const sk of b.skins ?? [])
  for (const [slot, ps] of Object.entries<any>(sk.partes ?? {})) if (!emissivos.has(slot)) for (const [n, p] of Object.entries<any>(ps)) usadas.add(p.caminho ?? n);
const imagens = (b.imagens ?? []).filter((im: any) => usadas.has(im.nome));
const paginas = ([...new Set(imagens.map((im: any) => im.pagina ?? 0))] as number[]).filter((p) => !soPaginas || soPaginas.split(",").map(Number).includes(p));

// distancia euclidiana exata ate o pixel "fora" mais proximo (Felzenszwalb e Huttenlocher)
function distancia(dentro: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h)),
    d = new Float64Array(Math.max(w, h)),
    z = new Float64Array(Math.max(w, h) + 1),
    v = new Int32Array(Math.max(w, h));
  const um = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  const g = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = dentro[y * w + x] ? INF : 0;
    um(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    um(w);
    for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]);
  }
  return g;
}

// ---- as pecas na pose de montagem: triangulos com a uv na pagina (pixels) e o ponto no mundo
type P2 = [number, number];
type Tri = { uv: [P2, P2, P2]; w: [P2, P2, P2] };
const ossos: Record<string, number[]> = (() => {
  if (modo !== "silhueta") return {};
  const r = spawnSync(nucleo, [resolve(arq), "-", "0"], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`nucleo-pose: ${r.stderr || r.error} (compile o nucleo: cmake --build nucleo/build)`);
  return JSON.parse(r.stdout).quadros[0].ossos;
})();
const noMundo = (m: number[], x: number, y: number): P2 => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
const imagemPorNome = new Map<string, any>((b.imagens ?? []).map((im: any) => [im.nome, im]));
function triangulos(osso: string, p: any, im: any): Tri[] | null {
  const m = ossos[osso];
  if (!m || im.girada || im.corte) return null;
  const [rx, ry, rw, rh] = im.ret;
  if (!p.tipo || p.tipo === "regiao") {
    const w = p.largura ?? rw,
      h = p.altura ?? rh,
      sx = p.escala_x ?? 1,
      sy = p.escala_y ?? 1,
      a = ((p.rotacao ?? 0) * Math.PI) / 180;
    // cantos: baixo-esquerda, cima-esquerda, cima-direita, baixo-direita (a textura de cima e o y +)
    const cantos: P2[] = [
      [-w / 2, -h / 2],
      [-w / 2, h / 2],
      [w / 2, h / 2],
      [w / 2, -h / 2],
    ].map(([x, y]) => {
      const [lx, ly] = [x * sx, y * sy];
      return noMundo(m, (p.x ?? 0) + lx * Math.cos(a) - ly * Math.sin(a), (p.y ?? 0) + lx * Math.sin(a) + ly * Math.cos(a));
    });
    const uv: P2[] = [
      [rx, ry + rh],
      [rx, ry],
      [rx + rw, ry],
      [rx + rw, ry + rh],
    ];
    return [
      { uv: [uv[0], uv[1], uv[2]], w: [cantos[0], cantos[1], cantos[2]] },
      { uv: [uv[2], uv[3], uv[0]], w: [cantos[2], cantos[3], cantos[0]] },
    ];
  }
  if (p.tipo !== "malha") return null;
  const n = p.uvs.length / 2;
  const mundo: P2[] = [];
  for (let i = 0; i < n; i++) {
    if (p.pesos) {
      let x = 0,
        y = 0;
      for (const [o, vx, vy, peso] of p.pesos[i]) {
        const mo = ossos[o];
        if (!mo) return null;
        const q = noMundo(mo, vx, vy);
        x += q[0] * peso;
        y += q[1] * peso;
      }
      mundo.push([x, y]);
    } else mundo.push(noMundo(m, p.vertices[i * 2], p.vertices[i * 2 + 1]));
  }
  const uv: P2[] = Array.from({ length: n }, (_, i) => [rx + p.uvs[i * 2] * rw, ry + p.uvs[i * 2 + 1] * rh]);
  const out: Tri[] = [];
  for (let t = 0; t + 2 < p.triangulos.length; t += 3) {
    const [i, j, k] = [p.triangulos[t], p.triangulos[t + 1], p.triangulos[t + 2]];
    out.push({ uv: [uv[i], uv[j], uv[k]], w: [mundo[i], mundo[j], mundo[k]] });
  }
  return out;
}
// cada texel (x, y da pagina) de um triangulo, com o ponto no mundo e quanto mundo vale um texel
function porTexel(tri: Tri, fn: (x: number, y: number, wx: number, wy: number, escala: number) => void) {
  const [a, bb, c] = tri.uv;
  const den = (bb[1] - c[1]) * (a[0] - c[0]) + (c[0] - bb[0]) * (a[1] - c[1]);
  if (Math.abs(den) < 1e-9) return;
  const areaW = Math.abs((tri.w[1][0] - tri.w[0][0]) * (tri.w[2][1] - tri.w[0][1]) - (tri.w[2][0] - tri.w[0][0]) * (tri.w[1][1] - tri.w[0][1]));
  const escala = Math.sqrt(areaW / Math.abs(den));
  const x0 = Math.floor(Math.min(a[0], bb[0], c[0])),
    x1 = Math.ceil(Math.max(a[0], bb[0], c[0])),
    y0 = Math.floor(Math.min(a[1], bb[1], c[1])),
    y1 = Math.ceil(Math.max(a[1], bb[1], c[1]));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const l0 = ((bb[1] - c[1]) * (px - c[0]) + (c[0] - bb[0]) * (py - c[1])) / den;
      const l1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      fn(x, y, l0 * tri.w[0][0] + l1 * tri.w[1][0] + l2 * tri.w[2][0], l0 * tri.w[0][1] + l1 * tri.w[1][1] + l2 * tri.w[2][1], escala);
    }
}

// por slot (fora os emissivos): a parte da montagem e todas as partes, nas paginas escolhidas
type Uso = { slot: string; osso: string; parte: any; im: any; setup: boolean };
const usos: Uso[] = [];
for (const s of b.slots ?? []) {
  if (emissivos.has(s.nome)) continue;
  for (const sk of b.skins ?? [])
    for (const [n, p] of Object.entries<any>(sk.partes?.[s.nome] ?? {})) {
      const im = imagemPorNome.get(p.caminho ?? n);
      if (im && paginas.includes(im.pagina ?? 0)) usos.push({ slot: s.nome, osso: s.osso, parte: p, im, setup: s.parte === n });
    }
}

// ---- a silhueta: os texels opacos das partes da montagem, no mundo, e a distancia ate a borda
const pixelsDe = new Map<number, { data: Buffer; W: number; H: number }>();
for (const pi of paginas) {
  const { data, info } = await sharp(join(pasta, b.paginas[pi].arquivo)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  pixelsDe.set(pi, { data, W: info.width, H: info.height });
}
const alfa = (pi: number, x: number, y: number) => {
  const p = pixelsDe.get(pi)!;
  return x < 0 || y < 0 || x >= p.W || y >= p.H ? 0 : p.data[(y * p.W + x) * 4 + 3];
};
let silhueta: { d: Float64Array; x0: number; y0: number; c: number; gw: number; gh: number } | null = null;
if (modo === "silhueta") {
  const tris = usos.filter((u) => u.setup).map((u) => ({ u, t: triangulos(u.osso, u.parte, u.im) })).filter((x) => x.t) as { u: Uso; t: Tri[] }[];
  // a grade do mundo: do tamanho de um texel tipico, com margem para a distancia
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const escalas: number[] = [];
  for (const { t } of tris)
    for (const tri of t) {
      for (const [x, y] of tri.w) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
      porTexel(tri, (_x, _y, _wx, _wy, e) => escalas.push(e));
    }
  escalas.sort((a, z) => a - z);
  let c = escalas[Math.floor(escalas.length * 0.9)];
  if (tris.length && Number.isFinite(c)) {
    c = Math.max(c, Math.max(x1 - x0, y1 - y0) / 3000);
    const m = 4;
    (x0 -= m * c), (y0 -= m * c);
    const gw = Math.ceil((x1 - x0) / c) + 2 * m,
      gh = Math.ceil((y1 - y0) / c) + 2 * m;
    // cada celula do mundo dentro de cada triangulo le a textura no ponto dela (do mundo para a uv:
    // sem furos, qualquer que seja o tamanho do texel)
    const dentro = new Uint8Array(gw * gh);
    for (const { u, t } of tris)
      for (const tri of t) {
        const [a, bb, cc] = tri.w;
        const den = (bb[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - bb[0]) * (a[1] - cc[1]);
        if (Math.abs(den) < 1e-12) continue;
        const gx0 = Math.max(0, Math.floor((Math.min(a[0], bb[0], cc[0]) - x0) / c)),
          gx1 = Math.min(gw - 1, Math.ceil((Math.max(a[0], bb[0], cc[0]) - x0) / c)),
          gy0 = Math.max(0, Math.floor((Math.min(a[1], bb[1], cc[1]) - y0) / c)),
          gy1 = Math.min(gh - 1, Math.ceil((Math.max(a[1], bb[1], cc[1]) - y0) / c));
        for (let gy = gy0; gy <= gy1; gy++)
          for (let gx = gx0; gx <= gx1; gx++) {
            const px = x0 + (gx + 0.5) * c,
              py = y0 + (gy + 0.5) * c;
            const l0 = ((bb[1] - cc[1]) * (px - cc[0]) + (cc[0] - bb[0]) * (py - cc[1])) / den;
            const l1 = ((cc[1] - a[1]) * (px - cc[0]) + (a[0] - cc[0]) * (py - cc[1])) / den;
            const l2 = 1 - l0 - l1;
            if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
            const ux = l0 * tri.uv[0][0] + l1 * tri.uv[1][0] + l2 * tri.uv[2][0],
              uy = l0 * tri.uv[0][1] + l1 * tri.uv[1][1] + l2 * tri.uv[2][1];
            if (alfa(u.im.pagina ?? 0, Math.floor(ux), Math.floor(uy)) >= 128) dentro[gy * gw + gx] = 1;
          }
      }
    silhueta = { d: distancia(dentro, gw, gh), x0, y0, c, gw, gh };
  }
}
// a distancia no ponto, interpolada entre os centros das celulas (sem degraus)
const distMundo = (wx: number, wy: number) => {
  const s = silhueta!;
  const fx = (wx - s.x0) / s.c - 0.5,
    fy = (wy - s.y0) / s.c - 0.5;
  const gx = Math.floor(fx),
    gy = Math.floor(fy);
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= s.gw || y >= s.gh ? 0 : s.d[y * s.gw + x]);
  const ax = fx - gx,
    ay = fy - gy;
  return (v(gx, gy) * (1 - ax) * (1 - ay) + v(gx + 1, gy) * ax * (1 - ay) + v(gx, gy + 1) * (1 - ax) * ay + v(gx + 1, gy + 1) * ax * ay) * s.c;
};

const almofada = (t: number) => Math.sqrt(1 - (1 - t) * (1 - t));
for (const pi of paginas) {
  const pg = b.paginas[pi];
  const { data, W, H } = pixelsDe.get(pi)!;
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) out.set([128, 128, 255], i * 3);
  let pelaSilhueta = 0;
  for (const im of imagens.filter((im: any) => (im.pagina ?? 0) === pi && !im.girada)) {
    const [rx, ry, rw, rh] = im.ret.map((v: number) => Math.round(v));
    // a imagem com 1 px de transparente em volta (a borda do retangulo tambem e borda)
    const w = rw + 2,
      h = rh + 2;
    const dentro = new Uint8Array(w * h),
      lum = new Float64Array(w * h);
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const o = ((ry + y) * W + rx + x) * 4;
        const k = (y + 1) * w + x + 1;
        dentro[k] = data[o + 3] >= 128 ? 1 : 0;
        lum[k] = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
      }
    // pela silhueta: a media da almofada de cada uso da imagem (o mesmo braco nos dois lados)
    const soma = new Float64Array(w * h),
      conta = new Uint16Array(w * h);
    if (silhueta)
      for (const u of usos.filter((x) => x.im === im)) {
        const t = triangulos(u.osso, u.parte, u.im);
        for (const tri of t ?? [])
          porTexel(tri, (x, y, wx, wy, e) => {
            const lx = x - rx,
              ly = y - ry;
            if (lx < 0 || ly < 0 || lx >= rw || ly >= rh) return;
            const k = (ly + 1) * w + lx + 1;
            soma[k] += almofada(Math.min(distMundo(wx, wy) / Math.max(borda * e, 1e-6), 1));
            conta[k]++;
          });
      }
    // os texels opacos que nenhum triangulo cobriu (a malha nao cobre a imagem inteira) pegam a media
    // dos vizinhos ja calculados, umas passadas; misturar com a borda da propria imagem faria caroco
    const forma = new Float64Array(w * h).fill(NaN);
    for (let k = 0; k < w * h; k++) if (dentro[k] && conta[k]) (forma[k] = soma[k] / conta[k]), pelaSilhueta++;
    if (silhueta)
      for (let passada = 0; passada < 8; passada++) {
        const novo = forma.slice();
        for (let y = 1; y < h - 1; y++)
          for (let x = 1; x < w - 1; x++) {
            const k = y * w + x;
            if (!dentro[k] || !Number.isNaN(forma[k])) continue;
            let s = 0,
              n = 0;
            for (const q of [k - 1, k + 1, k - w, k + w]) if (!Number.isNaN(forma[q])) (s += forma[q]), n++;
            if (n) novo[k] = s / n;
          }
        forma.set(novo);
      }
    // o resto pela borda da propria imagem
    const dist = distancia(dentro, w, h);
    const alt = new Float64Array(w * h);
    for (let k = 0; k < w * h; k++) {
      if (!dentro[k]) continue;
      const f = Number.isNaN(forma[k]) ? almofada(Math.min(dist[k] / Math.max(borda, 1e-6), 1)) : forma[k];
      alt[k] = (f * profundidade + lum[k] * detalhe * 0.25) * borda;
    }
    // suaviza (os degraus da distancia; pela silhueta um pouco mais, 5 x 5) e tira a normal da
    // inclinacao
    const r = silhueta ? 2 : 1;
    const suave = new Float64Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let s = 0,
          n = 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const yy = y + dy,
              xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            s += alt[yy * w + xx];
            n++;
          }
        suave[y * w + x] = s / n;
      }
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const k = (y + 1) * w + x + 1;
        if (!dentro[k] && data[((ry + y) * W + rx + x) * 4 + 3] === 0) continue;
        const gx = (suave[k + 1] - suave[k - 1]) / 2,
          gy = (suave[k + w] - suave[k - w]) / 2;
        // y da imagem desce; no relevo, y sobe
        let nx = -gx,
          ny = gy,
          nz = 1;
        const l = Math.hypot(nx, ny, nz);
        (nx /= l), (ny /= l), (nz /= l);
        out.set([Math.round((nx * 0.5 + 0.5) * 255), Math.round((ny * 0.5 + 0.5) * 255), Math.round((nz * 0.5 + 0.5) * 255)], ((ry + y) * W + rx + x) * 3);
      }
  }
  const nome = pg.arquivo.replace(/\.[^.]+$/, "") + "_relevo.png";
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(join(pasta, nome));
  console.log(`${join(pasta, nome)}: ${W} x ${H}, ${imagens.filter((im: any) => (im.pagina ?? 0) === pi).length} imagens${silhueta ? `, ${pelaSilhueta} pixels pela silhueta do personagem` : ""}`);
  if (gravar) pg.relevo = nome;
}
if (gravar) {
  writeFileSync(resolve(arq), JSON.stringify(b, null, 1) + "\n");
  console.log(`${basename(arq)}: relevo em ${paginas.length} paginas`);
}
