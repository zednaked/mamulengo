// Pixel art com ossos: o aventureiro e o soldado do Platformer Characters 1 da Kenney (CC0, em
// kenney/, com o License.txt), convertidos para pixel art e rigados aqui.
//
//   npx tsx exemplos/pixel/gerar.ts      (escreve aventureiro.boneco e soldado.boneco)
//
// A conversao, peca por peca: metade da resolucao (media das cores com o alfa), borda dura (alfa
// 0 ou 1, sem pixel meio transparente), a cor numa paleta curta do personagem (16 cores, tiradas
// das proprias pecas, o que apaga as cores de transicao do antisserrilhado) e 1 pixel de contorno
// por fora, na cor vizinha bem mais escura. As paginas saem com filtro Nearest e 1 pixel da
// textura por unidade do mundo: o editor liga o pixel perfeito sozinho.
//
// A montagem vem da pose "stand" do pacote (as pecas casadas nela por comparacao de pixels; os
// bracos ficam retos para baixo no setup, para a peca parada cair na grade, e giram nas animacoes).
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
const r3 = (x: number) => Math.round(x * 1000) / 1000;

type Img = { w: number; h: number; d: Uint8Array };

async function ler(arq: string, espelho = false): Promise<Img> {
  let s = sharp(readFileSync(arq)).ensureAlpha();
  if (espelho) s = s.flop();
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, d: new Uint8Array(data) };
}

// metade da resolucao pela cor predominante de cada bloco 2x2 (a arte ja na paleta): numa arte de
// cor chapada a media mistura o branco do olho com a pupila e o olho vira mancha; a cor que mais
// aparece mantem o desenho. O pixel fica opaco se o bloco estava mais da metade coberto; no empate,
// a cor mais escura (contorno de olho e boca nao some)
function metade(im: Img): Img {
  const w = Math.ceil(im.w / 2),
    h = Math.ceil(im.h / 2);
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let cobertura = 0;
      const conta = new Map<number, { n: number; i: number }>();
      for (let yy = 0; yy < 2; yy++)
        for (let xx = 0; xx < 2; xx++) {
          const X = x * 2 + xx,
            Y = y * 2 + yy;
          if (X >= im.w || Y >= im.h) continue;
          const i = (Y * im.w + X) * 4;
          cobertura += im.d[i + 3] / 255;
          if (im.d[i + 3] < 128) continue;
          const k = (im.d[i] << 16) | (im.d[i + 1] << 8) | im.d[i + 2];
          const c = conta.get(k) ?? { n: 0, i };
          c.n++;
          conta.set(k, c);
        }
      if (cobertura / 4 < 0.5 || !conta.size) continue;
      const luz = (i: number) => im.d[i] + im.d[i + 1] + im.d[i + 2];
      const [, melhor] = [...conta].sort((a, b) => b[1].n - a[1].n || luz(a[1].i) - luz(b[1].i))[0];
      d.set([im.d[melhor.i], im.d[melhor.i + 1], im.d[melhor.i + 2], 255], (y * w + x) * 4);
    }
  return { w, h, d };
}

// (a media, usada antes; fica para comparar)
export function metadeMedia(im: Img): Img {
  const w = Math.ceil(im.w / 2),
    h = Math.ceil(im.h / 2);
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let a = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let yy = 0; yy < 2; yy++)
        for (let xx = 0; xx < 2; xx++) {
          const X = x * 2 + xx,
            Y = y * 2 + yy;
          if (X >= im.w || Y >= im.h) continue;
          const i = (Y * im.w + X) * 4,
            al = im.d[i + 3] / 255;
          a += al;
          r += im.d[i] * al;
          g += im.d[i + 1] * al;
          b += im.d[i + 2] * al;
        }
      if (a / 4 < 0.5) continue;
      d.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), 255], (y * w + x) * 4);
    }
  return { w, h, d };
}

// paleta curta do personagem: mediana por cortes (median cut) nas cores opacas de todas as pecas
function paleta(ims: Img[], n: number): number[][] {
  const cores: number[][] = [];
  for (const im of ims) for (let i = 0; i < im.d.length; i += 4) if (im.d[i + 3]) cores.push([im.d[i], im.d[i + 1], im.d[i + 2]]);
  let caixas = [cores];
  while (caixas.length < n) {
    // corta a caixa com a maior faixa de cor no canal mais largo
    let melhor = -1,
      canal = 0,
      faixa = -1;
    caixas.forEach((c, k) => {
      if (c.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255,
          hi = 0;
        for (const p of c) (lo = Math.min(lo, p[ch])), (hi = Math.max(hi, p[ch]));
        if (hi - lo > faixa) (faixa = hi - lo), (melhor = k), (canal = ch);
      }
    });
    if (melhor < 0 || faixa < 8) break;
    const c = caixas[melhor].sort((a, b) => a[canal] - b[canal]);
    const meio = c.length >> 1;
    caixas.splice(melhor, 1, c.slice(0, meio), c.slice(meio));
  }
  // a cor de cada caixa: a mais comum dela (uma cor chapada de verdade, nao uma media)
  return caixas.map((c) => {
    const conta = new Map<string, number>();
    for (const p of c) conta.set(p.join(), (conta.get(p.join()) ?? 0) + 1);
    return [...conta].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  });
}

function naPaleta(im: Img, pal: number[][]) {
  for (let i = 0; i < im.d.length; i += 4) {
    if (!im.d[i + 3]) continue;
    let m = 1e9,
      k = 0;
    pal.forEach((c, j) => {
      const d = (c[0] - im.d[i]) ** 2 + (c[1] - im.d[i + 1]) ** 2 + (c[2] - im.d[i + 2]) ** 2;
      if (d < m) (m = d), (k = j);
    });
    im.d.set(pal[k], i);
  }
}

// contorno de 1 pixel por fora: a cor do vizinho a 30%, puxada para o roxo (sombra fria)
function contorno(im: Img): Img {
  const w = im.w + 2,
    h = im.h + 2;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < im.h; y++) d.set(im.d.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((y + 1) * w + 1) * 4);
  const out = new Uint8Array(d);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3]) continue;
      let viz = -1;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + ax,
          Y = y + ay;
        if (X >= 0 && Y >= 0 && X < w && Y < h && d[(Y * w + X) * 4 + 3]) viz = (Y * w + X) * 4;
      }
      if (viz < 0) continue;
      out.set([Math.round(d[viz] * 0.3 + 18), Math.round(d[viz + 1] * 0.28 + 10), Math.round(d[viz + 2] * 0.35 + 30), 255], i);
    }
  return { w, h, d: out };
}

// ---- montagem (coordenadas do desenho: x para a direita, y para BAIXO, o chao em y 0, em pixels
// da pixel art). Os centros sao os da pose stand (80 x 110 no original); no desenho, (x - 40) / 2,
// (y - 110) / 2
const LUGAR: Record<string, { arq: string; espelho: boolean; cx: number; cy: number }> = {
  braco_d: { arq: "arm", espelho: true, cx: 60, cy: 80 },
  mao_d: { arq: "hand", espelho: true, cx: 61, cy: 95 },
  perna_d: { arq: "leg", espelho: true, cx: 51.5, cy: 98.5 },
  perna_e: { arq: "leg", espelho: false, cx: 30.5, cy: 98.5 },
  corpo: { arq: "body_front", espelho: false, cx: 41.5, cy: 79.5 },
  braco_e: { arq: "arm", espelho: false, cx: 22, cy: 80 },
  mao_e: { arq: "hand", espelho: false, cx: 21, cy: 95 },
  cabeca: { arq: "head", espelho: false, cx: 38, cy: 46 },
};
// as trocas de rosto do pacote (o olhar de esforco, usado como piscada e no aceno)
const ROSTOS: Record<string, string> = { cabeca_foco: "head_focus", cabeca_dor: "head_hurt" };

type Peca = { nome: string; img: Img; x: number; y: number };

async function personagem(pasta: string) {
  // as pecas convertidas (sem contorno ainda): a paleta sai de todas juntas
  const originais: Record<string, Img> = {};
  for (const [nome, l] of Object.entries(LUGAR)) originais[nome] = await ler(join(KENNEY, pasta, l.arq + ".png"), l.espelho);
  for (const [nome, arq] of Object.entries(ROSTOS)) originais[nome] = await ler(join(KENNEY, pasta, arq + ".png"));
  // a paleta sai dos pixels opacos da arte original (as cores chapadas, nao as da borda suavizada);
  // a arte vai para a paleta e so depois e reduzida pela cor predominante
  const opacos = Object.values(originais).map((im) => ({ ...im, d: im.d.map((v, i) => (i % 4 === 3 ? (v > 250 ? 255 : 0) : v)) }));
  const pal = paleta(opacos, 16);
  for (const im of Object.values(originais)) naPaleta(im, pal);
  const brutas: Record<string, Img> = {};
  for (const [nome, im] of Object.entries(originais)) brutas[nome] = metade(im);
  const pecas: Record<string, Peca> = {};
  for (const [nome, im] of Object.entries(brutas)) {
    const l = LUGAR[nome] ?? LUGAR.cabeca;
    const c = contorno(im);
    // o canto de cima a esquerda numa coordenada inteira (a grade da peca casa com a do mundo)
    const x = Math.round((l.cx - 40) / 2 - c.w / 2),
      y = Math.round((l.cy - 110) / 2 - c.h / 2);
    pecas[nome] = { nome, img: c, x, y };
  }
  return { pecas, pal };
}

// ---- o esqueleto (o mesmo para os dois): nome, pai, x, y (desenho), giro no mundo, comprimento
const OSSOS: [string, string, number, number, number, number][] = [
  ["quadril", "root", 0, -10, 0, 0],
  ["corpo", "quadril", 0, -10, 90, 10],
  ["cabeca", "corpo", -1, -21, 90, 22],
  ["ombro_e", "corpo", -9, -19, -90, 8],
  ["mao_e", "ombro_e", -9, -12, -90, 4],
  ["ombro_d", "corpo", 10, -19, -90, 8],
  ["mao_d", "ombro_d", 10, -12, -90, 4],
  ["perna_e", "quadril", -5, -11, -90, 9],
  ["perna_d", "quadril", 5, -11, -90, 9],
];
const OSSO_DA_PECA: Record<string, string> = { sombra: "root", braco_d: "ombro_d", mao_d: "mao_d", perna_d: "perna_d", perna_e: "perna_e", corpo: "corpo", braco_e: "ombro_e", mao_e: "mao_e", cabeca: "cabeca" };

type Mundo = Map<string, { x: number; y: number; giro: number }>;
function montar() {
  const ossos: any[] = [{ name: "root" }];
  const mundo: Mundo = new Map([["root", { x: 0, y: 0, giro: 0 }]]);
  for (const [nome, pai, x, y, giro, comp] of OSSOS) {
    const p = mundo.get(pai)!;
    const c = Math.cos((-p.giro * Math.PI) / 180),
      s = Math.sin((-p.giro * Math.PI) / 180);
    const dx = x - p.x,
      dy = -y - p.y;
    ossos.push({ name: nome, parent: pai, x: r3(dx * c - dy * s), y: r3(dx * s + dy * c), ...(giro - p.giro ? { rotation: r3(giro - p.giro) } : {}), ...(comp ? { length: comp } : {}) });
    mundo.set(nome, { x, y: -y, giro });
  }
  return { ossos, mundo };
}

// a peca presa ao osso: o centro dela, no espaco do osso (sem escala no setup)
function anexo(mundo: Mundo, osso: string, p: Peca) {
  const o = mundo.get(osso)!;
  const cx = p.x + p.img.w / 2,
    cy = -(p.y + p.img.h / 2);
  const c = Math.cos((-o.giro * Math.PI) / 180),
    s = Math.sin((-o.giro * Math.PI) / 180);
  const dx = cx - o.x,
    dy = cy - o.y;
  return { x: r3(dx * c - dy * s), y: r3(dx * s + dy * c), ...(o.giro ? { rotation: r3(-o.giro) } : {}), width: p.img.w, height: p.img.h };
}

// ---- animacoes (chaves com a curva suave padrao)
const suave = (t0: number, v0: number, t1: number, v1: number) => [r3(t0 + (t1 - t0) / 3), v0, r3(t1 - (t1 - t0) / 3), v1];
const giro = (ch: [number, number][]) => ch.map(([time, value], i) => ({ ...(time ? { time: r3(time) } : {}), value: r3(value), ...(i < ch.length - 1 ? { curve: suave(time, value, ch[i + 1][0], ch[i + 1][1]) } : {}) }));
const mover = (ch: [number, number, number][]) =>
  ch.map(([time, x, y], i) => {
    const n = ch[i + 1];
    return { ...(time ? { time: r3(time) } : {}), x: r3(x), y: r3(y), ...(n ? { curve: [...suave(time, x, n[0], n[1]), ...suave(time, y, n[0], n[2])] } : {}) };
  });
// troca de imagem numa chave (sem curva)
const troca = (ch: [number, string][]) => ch.map(([time, name]) => ({ ...(time ? { time: r3(time) } : {}), name }));

function animacoes() {
  // parado (1,6 s): respira 1 pixel, a cabeca vem depois e os bracos acompanham
  const parado = {
    bones: {
      corpo: { translate: mover([[0, 0, 0], [0.8, 0, -1], [1.6, 0, 0]]) },
      cabeca: { translate: mover([[0, 0, 0], [0.9, 0, -1], [1.6, 0, 0]]) },
      ombro_e: { rotate: giro([[0, 0], [0.8, -4], [1.6, 0]]) },
      ombro_d: { rotate: giro([[0, 0], [0.8, 4], [1.6, 0]]) },
    },
  };
  // andando de frente (0,6 s): cada pe sobe na sua vez (vindo para a camera), o corpo quica e
  // balanca para o lado do pe de apoio, os bracos vao e voltam, a cabeca atrasa
  const p = 0.3;
  const andando = {
    bones: {
      // o pe que sobe so 1 pixel (mais que isso ele some atras do corpo) e o outro desce 1: a diferenca
      // de 2 pixels le como passo; o corpo quica e pende para o pe de apoio
      perna_e: { translate: mover([[0, 0, 1], [p, 0, -1], [2 * p, 0, 1]]) },
      perna_d: { translate: mover([[0, 0, -1], [p, 0, 1], [2 * p, 0, -1]]) },
      quadril: { translate: mover([[0, 1, 0], [p / 2, 0, 1], [p, -1, 0], [1.5 * p, 0, 1], [2 * p, 1, 0]]) },
      corpo: { rotate: giro([[0, 3], [p, -3], [2 * p, 3]]) },
      // de frente o braco vai e volta quase so na profundidade: na tela, um balanco pequeno
      ombro_e: { rotate: giro([[0, 8], [p, -8], [2 * p, 8]]) },
      ombro_d: { rotate: giro([[0, 8], [p, -8], [2 * p, 8]]) },
      cabeca: { rotate: giro([[0, -2], [p, 2], [2 * p, -2]]), translate: mover([[0, 0, 0], [p / 2, 0, -1], [p, 0, 0], [1.5 * p, 0, -1], [2 * p, 0, 0]]) },
    },
  };
  // acenando (1,4 s): o braco direito antecipa para baixo, sobe, abana tres vezes e volta; a cabeca
  // inclina e o rosto muda para o de esforco no alto
  const acenando = {
    slots: { cabeca: { attachment: troca([[0, "cabeca"], [0.25, "cabeca_foco"], [1.15, "cabeca"]]) } },
    bones: {
      ombro_d: { rotate: giro([[0, 0], [0.12, -12], [0.32, 160], [0.5, 130], [0.68, 160], [0.86, 130], [1.04, 160], [1.4, 0]]) },
      mao_d: { rotate: giro([[0, 0], [0.32, 10], [0.5, -25], [0.68, 10], [0.86, -25], [1.04, 10], [1.4, 0]]) },
      cabeca: { rotate: giro([[0, 0], [0.3, -6], [1.1, -6], [1.4, 0]]) },
      corpo: { rotate: giro([[0, 0], [0.3, -3], [1.1, -3], [1.4, 0]]), translate: mover([[0, 0, 0], [0.3, 0, -1], [1.1, 0, -1], [1.4, 0, 0]]) },
    },
  };
  // pulo (0,9 s): agacha (antecipa), sobe esticado, cai e amortece
  const pulo = {
    slots: { cabeca: { attachment: troca([[0, "cabeca"], [0.1, "cabeca_foco"], [0.7, "cabeca"]]) } },
    bones: {
      quadril: { translate: mover([[0, 0, 0], [0.15, 0, -3], [0.4, 0, 14], [0.62, 0, 0], [0.72, 0, -3], [0.9, 0, 0]]) },
      ombro_e: { rotate: giro([[0, 0], [0.15, 20], [0.4, -50], [0.62, -20], [0.72, 15], [0.9, 0]]) },
      ombro_d: { rotate: giro([[0, 0], [0.15, -20], [0.4, 50], [0.62, 20], [0.72, -15], [0.9, 0]]) },
      perna_e: { translate: mover([[0, 0, 0], [0.4, 0, 2], [0.62, 0, 0], [0.9, 0, 0]]) },
      perna_d: { translate: mover([[0, 0, 0], [0.4, 0, 2], [0.62, 0, 0], [0.9, 0, 0]]) },
      cabeca: { translate: mover([[0, 0, 0], [0.18, 0, -1], [0.42, 0, 1], [0.72, 0, -2], [0.9, 0, 0]]) },
    },
  };
  return { parado, andando, acenando, pulo };
}

// sombra no chao: uma elipse de pixel, chapada e meio transparente (embaixo de tudo)
function sombra(): Peca {
  const w = 22,
    h = 5;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x + 0.5 - w / 2) / (w / 2)) ** 2 + ((y + 0.5 - h / 2) / (h / 2)) ** 2 <= 1) d.set([24, 16, 40, 110], (y * w + x) * 4);
  return { nome: "sombra", img: { w, h, d }, x: -11, y: -3 };
}

for (const [id, pasta] of [["aventureiro", "Adventurer"], ["soldado", "Soldier"]] as const) {
  const { pecas, pal } = await personagem(pasta);
  pecas.sombra = sombra();
  const { ossos, mundo } = montar();
  // de tras para a frente
  const ordem = ["sombra", "braco_d", "mao_d", "perna_d", "perna_e", "corpo", "braco_e", "mao_e", "cabeca"];
  const slots: any[] = [];
  const partes: Record<string, Record<string, any>> = {};
  for (const s of ordem) {
    slots.push({ name: s, bone: OSSO_DA_PECA[s], attachment: s });
    partes[s] = { [s]: anexo(mundo, OSSO_DA_PECA[s], pecas[s]) };
  }
  // os rostos trocam no slot da cabeca, no mesmo lugar
  for (const r of Object.keys(ROSTOS)) partes.cabeca[r] = anexo(mundo, "cabeca", { ...pecas[r], x: pecas.cabeca.x, y: pecas.cabeca.y });
  // as pecas em PNG e a pagina com filtro Nearest
  const entrada = [];
  for (const p of Object.values(pecas)) {
    const png = await sharp(Buffer.from(p.img.d), { raw: { width: p.img.w, height: p.img.h, channels: 4 } }).png().toBuffer();
    writeFileSync(join(FONTES, `${id}_${p.nome}.png`), png);
    entrada.push({ name: p.nome, data: png });
  }
  const pack = await packAtlas(entrada, { pageName: id, format: "png", padding: 2 });
  for (const pg of pack.pages) writeFileSync(join(AQUI, pg.name), pg.data);
  const atlas = pack.atlas.replace(/filter:Linear,Linear/g, "filter:Nearest,Nearest");
  const json = { skeleton: { spine: "4.3.23", images: "./fontes/", audio: "" }, bones: ossos, slots, skins: [{ name: "default", attachments: partes }], animations: animacoes() };
  const b = importarSpine(json, atlas, id);
  b.mix = { padrao: 0.15 };
  writeFileSync(join(AQUI, `${id}.boneco`), JSON.stringify(b, null, 1) + "\n");
  console.log(`${id}.boneco: ${ossos.length} ossos, ${slots.length} slots, paleta de ${pal.length} cores, ${pack.pages.map((pg) => pg.name).join(", ")}`);
}
