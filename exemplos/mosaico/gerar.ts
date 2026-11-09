// Mosaico (docs/NUCLEO.md "Mosaico"): tres mapas feitos de ladrilhos do Jumper Pack da Kenney (CC0,
// em kenney/, com o License.txt), um em cada forma:
//   - plataformas (grade): as pontas e o meio de cada chao viram ladrilhos; o meio alterna o
//     espelho por coluna e emenda sem costura;
//   - ilha (iso): blocos em losango, montados aqui a partir das mesmas texturas (o topo e a faixa de
//     cima do chao, os lados sao o perfil dele, mais escuros), com alturas, cor e brilho por celula;
//   - piso (grade em perspectiva forcada): o miolo de terra e areia em xadrez, num chao visto em
//     angulo pelos quatro cantos.
//
//   npx tsx exemplos/mosaico/gerar.ts      (escreve mosaico.boneco e mosaico.png)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { importarSpine } from "../../src/boneco/spine.ts";
import { packAtlas } from "../../server/atlas.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const KENNEY = join(AQUI, "kenney");
const FONTES = join(AQUI, "fontes");
mkdirSync(FONTES, { recursive: true });

type Img = { w: number; h: number; d: Uint8Array };
async function ler(arq: string): Promise<Img> {
  const { data, info } = await sharp(readFileSync(arq)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, d: new Uint8Array(data) };
}
function recorte(im: Img, x: number, y: number, w: number, h: number): Img {
  const d = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) d.set(im.d.subarray(((y + j) * im.w + x) * 4, ((y + j) * im.w + x + w) * 4), j * w * 4);
  return { w, h, d };
}
// amostra bilinear (com o alfa pre-multiplicado na media, para a borda nao escurecer)
function amostra(im: Img, x: number, y: number): number[] {
  x = Math.min(Math.max(x, 0), im.w - 1.001);
  y = Math.min(Math.max(y, 0), im.h - 1.001);
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  const out = [0, 0, 0, 0];
  for (const [dx, dy, w] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ]) {
    const k = ((y0 + dy) * im.w + x0 + dx) * 4;
    const a = im.d[k + 3] / 255;
    out[0] += im.d[k] * a * w;
    out[1] += im.d[k + 1] * a * w;
    out[2] += im.d[k + 2] * a * w;
    out[3] += a * w;
  }
  return out[3] > 0 ? [out[0] / out[3], out[1] / out[3], out[2] / out[3], out[3] * 255] : [0, 0, 0, 0];
}
const png = (im: Img) => sharp(Buffer.from(im.d), { raw: { width: im.w, height: im.h, channels: 4 } }).png().toBuffer();

// o bloco isometrico: o topo (losango 96 x 48) e os dois lados (40 de altura), o esquerdo um pouco
// mais escuro que o direito, como luz vindo da esquerda e de cima
const BW = 96,
  BH = 48,
  LADO = 40;
function bloco(topo: Img, lado: Img): Img {
  const w = BW,
    h = BH + LADO;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      let c: number[] | null = null;
      // topo: P = (48, 0) + u (48, 24) + v (-48, 24)
      const u = ((px - BW / 2) / (BW / 2) + py / (BH / 2)) / 2,
        v = (py / (BH / 2) - (px - BW / 2) / (BW / 2)) / 2;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) c = amostra(topo, u * (topo.w - 1), v * (topo.h - 1));
      else if (px < BW / 2) {
        // esquerdo: P = (0, 24) + s (48, 24) + t (0, LADO)
        const s = px / (BW / 2),
          t = (py - BH / 2 - (BH / 2) * s) / LADO;
        if (t >= 0 && t <= 1) c = amostra(lado, s * (lado.w - 1), t * (lado.h - 1)).map((k, i) => (i < 3 ? k * 0.78 : k));
      } else {
        // direito: P = (48, 48) + s (48, -24) + t (0, LADO)
        const s = (px - BW / 2) / (BW / 2),
          t = (py - BH + (BH / 2) * s) / LADO;
        if (t >= 0 && t <= 1) c = amostra(lado, s * (lado.w - 1), t * (lado.h - 1)).map((k, i) => (i < 3 ? k * 0.62 : k));
      }
      if (c) d.set(c.map((k) => Math.round(k)), (y * w + x) * 4);
    }
  return { w, h, d };
}

const MATERIAIS = ["grass", "stone", "sand", "wood", "snow"] as const;
const NOMES: Record<string, string> = { grass: "grama", stone: "pedra", sand: "areia", wood: "madeira", snow: "neve" };
const entrada: { name: string; data: Buffer }[] = [];
const poe = async (nome: string, im: Img) => {
  const b = await png(im);
  writeFileSync(join(FONTES, `${nome}.png`), b);
  entrada.push({ name: nome, data: b });
};
for (const m of MATERIAIS) {
  const im = await ler(join(KENNEY, `ground_${m}.png`));
  const n = NOMES[m];
  // plataforma: a ponta (os 64 da esquerda) e o meio colado nela; a ponta direita e a esquerda
  // espelhada, e o meio alterna o espelho: cada borda encontra a mesma borda do vizinho
  await poe(`${n}_ponta`, recorte(im, 0, 0, 64, 94));
  await poe(`${n}_meio`, recorte(im, 64, 0, 64, 94));
  // o miolo (sem a faixa de cima nem a borda de baixo) para o piso
  if (m === "grass" || m === "sand") await poe(`piso_${n}`, recorte(im, 158, 44, 64, 40));
  // bloco iso: o topo e a faixa de cima esticada; o lado, o perfil do chao
  const faixa = recorte(im, 140, 3, 100, 22);
  await poe(`bloco_${n}`, bloco(faixa, recorte(im, 150, 0, 80, 70)));
}

// ---- os mapas
const cells = (cols: number, rows: number) => new Array(cols * rows).fill(-1);
// plataformas: 15 x 5 celulas de 64 x 94
const pal = MATERIAIS.flatMap((m) => [`${NOMES[m]}_ponta`, `${NOMES[m]}_meio`]);
const P = { cols: 16, rows: 5 };
const plat = cells(P.cols, P.rows);
const extrasPlat: Record<string, any> = {};
// ponta, meio, meio espelhado, ..., meio espelhado, ponta espelhada: o numero de meios e par
function plataforma(mat: string, linha: number, de: number, ate: number) {
  if ((ate - de - 1) % 2) throw new Error(`plataforma ${mat}: o numero de meios tem de ser par`);
  const i0 = pal.indexOf(`${mat}_ponta`);
  for (let c = de; c <= ate; c++) {
    const k = linha * P.cols + c;
    plat[k] = c === de || c === ate ? i0 : i0 + 1;
    if (c === ate || (c !== de && (c - de) % 2 === 0)) extrasPlat[k] = { flip: true };
  }
}
plataforma("grama", 0, 1, 6);
plataforma("neve", 0, 10, 15);
plataforma("pedra", 1, 5, 10);
plataforma("areia", 2, 0, 3);
plataforma("madeira", 2, 12, 15);
plataforma("grama", 4, 0, 15);

// ilha iso: 6 x 6 blocos, o miolo mais alto
const I = 6;
const blocos = MATERIAIS.map((m) => `bloco_${NOMES[m]}`);
const ilha = cells(I, I);
const extrasIlha: Record<string, any> = {};
for (let r = 0; r < I; r++)
  for (let c = 0; c < I; c++) {
    const k = r * I + c;
    const borda = r === 0 || c === 0 || r === I - 1 || c === I - 1;
    ilha[k] = borda ? 2 : (r + c) % 3 === 0 ? 1 : 0;
    if ((r === 0 && c === 0) || (r === I - 1 && c === I - 1)) ilha[k] = -1;
    const alto = !borda && r >= 2 && r <= 3 && c >= 2 && c <= 3;
    if (alto) extrasIlha[k] = { height: 20 };
  }
ilha[2 * I + 4] = 4; // neve no alto de um canto
extrasIlha[2 * I + 4] = { height: 40, effects: { glow: { color: "bfe6ffff", strength: 1, radius: 10 } } };
extrasIlha[4 * I + 1] = { color: "ffb0b0ff" };
extrasIlha[1 * I + 4] = { height: 10 };

// piso em perspectiva: xadrez 10 x 6 de 64
const F = { cols: 10, rows: 6 };
const piso = cells(F.cols, F.rows).map((_, k) => ((k % F.cols) + Math.floor(k / F.cols)) % 2);

const bones = [
  { name: "root" },
  { name: "plataformas", parent: "root" },
  { name: "ilha", parent: "root", y: 0 },
  { name: "piso", parent: "root" },
];
const slots = [
  { name: "piso", bone: "piso" },
  { name: "ilha", bone: "ilha" },
  { name: "plataformas", bone: "plataformas" },
];
const mosaics = [
  { name: "plataformas", slot: "plataformas", shape: "grid", x: -512, y: 900, cell: [64, 94], columns: P.cols, rows: P.rows, palette: pal, cells: plat, extras: extrasPlat },
  { name: "ilha", slot: "ilha", shape: "iso", x: 0, y: 330, cell: [BW, BH], columns: I, rows: I, palette: blocos, cells: ilha, anchor: [0.5, BH / 2 / (BH + LADO)], extras: extrasIlha },
  { name: "piso", slot: "piso", shape: "grid", cell: [64, 40], columns: F.cols, rows: F.rows, palette: ["piso_grama", "piso_areia"], cells: piso, corners: [-520, -420, -260, -110, 260, -110, 520, -420] },
];
// a ilha flutua: o osso sobe e desce
const animations = {
  flutua: {
    bones: {
      ilha: {
        translate: [
          { time: 0, y: 0, curve: [0.4, 0, 0.6, 0, 0.4, 0, 0.6, 12] },
          { time: 1, y: 12, curve: [1.4, 0, 1.6, 0, 1.4, 12, 1.6, 0] },
          { time: 2, y: 0 },
        ],
      },
    },
  },
};

const pack = await packAtlas(entrada, { pageName: "mosaico", format: "png", padding: 2 });
for (const pg of pack.pages) writeFileSync(join(AQUI, pg.name), pg.data);
const json = { skeleton: { spine: "4.3.23", images: "./fontes/", audio: "" }, bones, slots, skins: [{ name: "default", attachments: {} }], animations, mosaics };
const b = importarSpine(json, pack.atlas, "mosaico");
writeFileSync(join(AQUI, "mosaico.boneco"), JSON.stringify(b, null, 1) + "\n");
console.log(`mosaico.boneco: ${mosaics.length} mosaicos, ${entrada.length} imagens, ${pack.pages.map((pg) => pg.name).join(", ")}`);
