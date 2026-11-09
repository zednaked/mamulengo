// Confere o mosaico do nucleo (docs/NUCLEO.md "Mosaico"), que o oraculo nao tem: monta um .boneco
// com mosaicos de grade, iso e perspectiva forcada (imagens cortadas e giradas no atlas, celulas
// com cor, altura, giro, espelho e efeito), desenha pelo nucleo em wasm e compara cada vertice
// (posicao, uv, cor) e os lotes com a conta refeita aqui pela especificacao.
//
//   npx tsx tools/nucleo-mosaico.ts [--nucleo nucleo/build-web/nucleo.mjs]
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const k = args.indexOf("--nucleo");
const url = pathToFileURL(resolve(k >= 0 ? args[k + 1] : "nucleo/build-web/nucleo.mjs")).href;
const N = await (await import(url)).default();

const PW = 128,
  PH = 64;
type Img = { nome: string; ret: [number, number, number, number]; girada?: number; corte?: [number, number, number, number] };
const imagens: Img[] = [
  { nome: "a", ret: [0, 0, 16, 16] },
  // cortada: os pixels sao um retangulo 10 x 12 dentro do original 16 x 16 (corte a partir de baixo e da esquerda)
  { nome: "b", ret: [16, 0, 10, 12], corte: [2, 3, 16, 16] },
  // girada 90 graus no atlas: 20 x 8 na orientacao original
  { nome: "c", ret: [32, 0, 20, 8], girada: 90 },
];
const rot = 30,
  bx = 100,
  by = 50;
const extras = { "1": { cor: "ff000080", altura: 4, giro: 1, espelho: true }, "4": { efeitos: { linha: { cor: "ffffffff", largura: 2 } } } };
const mosaicos = [
  { nome: "grade", slot: "s", x: 5, y: -3, celula: [10, 20], colunas: 3, linhas: 2, paleta: ["a", "b", "c", "falta"], celulas: [0, 1, 2, -1, 1, 3], extras },
  { nome: "iso", slot: "s", forma: "iso", x: 0, y: 0, celula: [32, 16], colunas: 2, linhas: 2, paleta: ["a", "b"], celulas: [0, 1, 1, 0], escala: 2, ancora: [0.5, 0.75], extras: { "2": { altura: 8 } } },
  { nome: "perspectiva", slot: "s", celula: [10, 10], colunas: 2, linhas: 2, paleta: ["a"], celulas: [0, 0, 0, 0], cantos: [-40, -40, -20, 0, 20, 0, 40, -40] },
];
const boneco = {
  boneco: 0,
  nome: "mosaico",
  paginas: [{ arquivo: "p.png", tamanho: [PW, PH] }],
  imagens: imagens.map((g) => ({ nome: g.nome, pagina: 0, ret: g.ret, ...(g.girada ? { girada: g.girada } : {}), ...(g.corte ? { corte: g.corte } : {}) })),
  ossos: [{ nome: "root", x: bx, y: by, rotacao: rot }],
  slots: [{ nome: "s", osso: "root", cor: "ffffffcc" }],
  mosaicos,
};

// ---- a conta pela especificacao
const cs = Math.cos((rot * Math.PI) / 180),
  sn = Math.sin((rot * Math.PI) / 180);
const mundo = (x: number, y: number) => [cs * x - sn * y + bx, sn * x + cs * y + by];
const hex = (s: string) => [0, 2, 4, 6].map((i) => (s.length > i ? parseInt(s.slice(i, i + 2), 16) / 255 : 1));
const slotCor = hex("ffffffcc");
// uv do canto da imagem (px, py a partir de cima e da esquerda do retangulo com pixels, orientacao original)
function uv(g: Img, px: number, py: number) {
  const [x, y, rw, rh] = g.ret;
  let u = x + px,
    v = y + py;
  if (g.girada === 90) (u = x + py), (v = y + rw - px);
  else if (g.girada === 180) (u = x + rw - px), (v = y + rh - py);
  else if (g.girada === 270) (u = x + rh - py), (v = y + px);
  return [u / PW, v / PH];
}
function homografia(q: number[]) {
  const [x0, y0] = [q[0], q[1]],
    [x1, y1] = [q[6], q[7]],
    [x2, y2] = [q[4], q[5]],
    [x3, y3] = [q[2], q[3]];
  const sx = x0 - x1 + x2 - x3,
    sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dy1 = y1 - y2,
    dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den,
    h = (dx1 * sy - sx * dy1) / den;
  return (u: number, v: number) => {
    const z = g * u + h * v + 1;
    return [((x1 - x0 + g * x1) * u + (x3 - x0 + h * x3) * v + x0) / z, ((y1 - y0 + g * y1) * u + (y3 - y0 + h * y3) * v + y0) / z];
  };
}
type V = { x: number; y: number; u: number; v: number; c: number[] };
const esperado: V[] = [];
let lotesComEfeito = 0;
for (const m of mosaicos as any[]) {
  const iso = m.forma === "iso";
  const [cw, ch] = m.celula;
  const ordem = m.celulas.map((_: any, i: number) => i);
  if (iso) ordem.sort((a: number, b: number) => ((a % m.colunas) + Math.floor(a / m.colunas) - ((b % m.colunas) + Math.floor(b / m.colunas))) || a - b);
  const H = m.cantos ? homografia(m.cantos) : null;
  for (const ci of ordem) {
    const ii = m.celulas[ci];
    if (ii < 0) continue;
    const g = imagens.find((x) => x.nome === m.paleta[ii]);
    if (!g) continue;
    const x = m.extras?.[String(ci)] ?? {};
    const [rw, rh] = [g.ret[2], g.ret[3]];
    const [ow, oh] = g.corte ? [g.corte[2], g.corte[3]] : [rw, rh];
    const [l, b, r, t] = g.corte ? [g.corte[0] / ow, g.corte[1] / oh, (g.corte[0] + rw) / ow, (g.corte[1] + rh) / oh] : [0, 0, 1, 1];
    const fx = [l, l, r, r],
      fy = [b, t, t, b];
    for (let q = 0; q < 4; q++) {
      if (x.espelho) fx[q] = 1 - fx[q];
      for (let s = 0; s < (x.giro ?? 0); s++) [fx[q], fy[q]] = [1 - fy[q], fx[q]];
    }
    const col = ci % m.colunas,
      lin = Math.floor(ci / m.colunas);
    const cc = x.cor ? hex(x.cor) : [1, 1, 1, 1];
    const cor = slotCor.map((v, i) => v * cc[i]);
    // meio pixel para dentro (sem costura entre ladrilhos)
    const e = Math.min(0.5, rw / 4, rh / 4);
    const cantos = [
      [e, rh - e],
      [e, e],
      [rw - e, e],
      [rw - e, rh - e],
    ];
    for (let q = 0; q < 4; q++) {
      let px: number, py: number;
      if (iso) {
        const lw = ow * (m.escala ?? 1),
          lh = oh * (m.escala ?? 1);
        const cx = ((col - lin) * cw) / 2 + m.x,
          cy = (-(col + lin) * ch) / 2 + m.y;
        px = cx - m.ancora[0] * lw + fx[q] * lw;
        py = cy + m.ancora[1] * lh - lh + fy[q] * lh;
      } else {
        px = col * cw + fx[q] * cw;
        py = -(lin + 1) * ch + fy[q] * ch;
        if (H) [px, py] = H(px / (m.colunas * cw), 1 + py / (m.linhas * ch));
        else (px += m.x), (py += m.y);
      }
      py += x.altura ?? 0;
      const [wx, wy] = mundo(px, py);
      const [u, v] = uv(g, cantos[q][0], cantos[q][1]);
      esperado.push({ x: wx, y: wy, u, v, c: cor });
    }
    if (x.efeitos) lotesComEfeito++;
  }
}

// ---- o nucleo
const texto = N.stringToNewUTF8(JSON.stringify(boneco)),
  cam = N.stringToNewUTF8("");
const mod = N._mm_carregar_de(texto, cam);
if (mod < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
const inst = N._mm_instancia(mod);
N._mm_reiniciar(inst);
N._mm_limpar_desenho();
N._mm_desenhar(inst);
const nv = N._mm_num_vertices();
const vs = N.HEAPF32.subarray(N._mm_vertices() / 4, N._mm_vertices() / 4 + nv * 8);

let falhas = 0;
const ok = (c: boolean, msg: string) => {
  console.log(`${c ? "ok  " : "FALHA"} ${msg}`);
  if (!c) falhas++;
};
ok(nv === esperado.length, `vertices: ${nv} do nucleo, ${esperado.length} esperados`);
let pior = 0,
  piorUv = 0,
  piorCor = 0;
// o efeito de linha cresce os cantos da celula 4 da grade pela margem: essa celula fica de fora da posicao e da uv
const crescida = new Set<number>();
{
  let n = 0;
  for (const ci of [0, 1, 2, 4, 5]) {
    if (ci === 4) for (let q = 0; q < 4; q++) crescida.add(n + q);
    if (mosaicos[0].celulas[ci] >= 0 && mosaicos[0].paleta[mosaicos[0].celulas[ci]] !== "falta") n += 4;
  }
}
esperado.forEach((e, i) => {
  const o = vs.subarray(i * 8, i * 8 + 8);
  if (!crescida.has(i)) {
    pior = Math.max(pior, Math.abs(o[0] - e.x), Math.abs(o[1] - e.y));
    piorUv = Math.max(piorUv, Math.abs(o[2] - e.u), Math.abs(o[3] - e.v));
  }
  piorCor = Math.max(piorCor, ...e.c.map((c, k) => Math.abs(o[4 + k] - c)));
});
ok(pior < 1e-3, `posicao (grade com corte, giro e espelho; iso com escala, ancora, ordem e altura; perspectiva): pior diferenca ${pior.toExponential(2)}`);
ok(piorUv < 1e-6, `uv (cortada e girada no atlas): pior diferenca ${piorUv.toExponential(2)}`);
ok(piorCor < 1e-6, `cor (do slot vezes a da celula): pior diferenca ${piorCor.toExponential(2)}`);
// a celula com linha cresce para fora (a margem): os cantos dela ficam mais longe do centro
{
  const base = [...crescida][0];
  const centro = (arr: number[][]) => arr.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
  const nuc = [0, 1, 2, 3].map((q) => [vs[(base + q) * 8], vs[(base + q) * 8 + 1]]);
  const esp = [0, 1, 2, 3].map((q) => [esperado[base + q].x, esperado[base + q].y]);
  const c = centro(esp);
  const maior = nuc.every((p, q) => Math.hypot(p[0] - c[0], p[1] - c[1]) > Math.hypot(esp[q][0] - c[0], esp[q][1] - c[1]));
  ok(maior, "efeito de linha na celula: os cantos crescem pela margem");
}
const nl = N._mm_num_lotes();
const lotes = N.HEAP32.subarray(N._mm_lotes() / 4, N._mm_lotes() / 4 + 7 * nl);
let comEfeito = 0;
for (let i = 0; i < nl; i++) if (lotes[i * 7 + 5] >= 0) comEfeito++;
// uma pagina so: as celulas sem efeito juntam num lote, cortado so pelas que tem efeito
ok(comEfeito === lotesComEfeito && nl === 1 + 2 * lotesComEfeito, `lotes: ${nl}, ${comEfeito} com efeito (esperado ${1 + 2 * lotesComEfeito} e ${lotesComEfeito}); as outras celulas juntas`);
// pixel art (pagina Nearest): sem o recuo de meio pixel, as uvs vao ate a borda do ladrilho
{
  const px = { ...boneco, paginas: [{ arquivo: "p.png", tamanho: [PW, PH], filtro: "Nearest,Nearest" }], mosaicos: [{ nome: "px", slot: "s", celula: [16, 16], colunas: 1, linhas: 1, paleta: ["a"], celulas: [0] }] };
  const t = N.stringToNewUTF8(JSON.stringify(px));
  const mm = N._mm_carregar_de(t, cam);
  const ii = N._mm_instancia(mm);
  N._mm_reiniciar(ii);
  N._mm_limpar_desenho();
  N._mm_desenhar(ii);
  const v = N.HEAPF32.subarray(N._mm_vertices() / 4, N._mm_vertices() / 4 + 32);
  const uvs = [0, 1, 2, 3].flatMap((q) => [v[q * 8 + 2], v[q * 8 + 3]]);
  const esp = [0, 16 / PH, 0, 0, 16 / PW, 0, 16 / PW, 16 / PH];
  ok(uvs.every((x, k) => Math.abs(x - esp[k]) < 1e-7), `pagina Nearest: uvs na borda do ladrilho (${uvs.map((x) => x.toFixed(4)).join(" ")})`);
}
process.exit(falhas ? 1 : 0);
