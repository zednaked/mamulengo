// Cortar e rigar (N-028): o laco do Atelie tira um pedaco da pintura e faz dele peca nova. Aqui so a
// conta dos pixels, sem tela (o editor chama em src/app/retoque.ts e o comando e o draw.carve):
// - a original perde exatamente a mascara do laco; a peca leva a tinta da mascara dilatada: opaca ate
//   `sobra` px para fora e sumindo ate 2 x sobra, entao a peca gira sem abrir fresta e, movida, nao
//   deixa beirada do pedaco na original;
// - o pivo e o centro da fronteira: os pixels da borda do laco com tinta dos dois lados (dentro e
//   fora), a mesma ideia do query.juntas; sem fronteira (pedaco solto), o centro da tinta;
// - a ponta e o pixel com tinta da peca mais longe do pivo;
// - onde o alfa vai a zero a cor fica (na peca e no buraco): o filtro linear do jogo mistura a borda do
//   corte com o vizinho transparente, e preto ali escurecia a junta.
import { pointInPolygon } from "./geometry.ts";

type Vec = [number, number];

export interface PlanoDoCorte {
  // a caixa da peca em pixels da imagem [x, y, w, h] (a tinta da mascara dilatada)
  box: [number, number, number, number];
  pivot: Vec;
  tip: Vec;
  // os pixels da peca (box w x h, RGBA reto) e a original com o buraco (w x h)
  peca: Uint8ClampedArray;
  resto: Uint8ClampedArray;
  // o retangulo da original que mudou
  mudou: [number, number, number, number];
  // quantos pixels da borda do laco cruzam tinta (0: pedaco solto, o pivo e o centro)
  fronteira: number;
}

// a mascara do laco: o centro de cada pixel dentro do poligono
export function mascaraDoLaco(pontos: Vec[], w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  if (pontos.length < 3) return m;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pontos) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1) + 1); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1) + 1); x++) if (pointInPolygon(x + 0.5, y + 0.5, pontos)) m[y * w + x] = 1;
  return m;
}

// dilata (valor 1) ou erode (valor 0) k px, em disco: distancia de chanfro 3-4 ate o outro lado
function morfo(m: Uint8Array, w: number, h: number, k: number, cresce: boolean, dist?: Float32Array): Uint8Array {
  if (k <= 0 && !dist) return m.slice();
  const alvo = cresce ? 1 : 0;
  const INF = 1 << 28;
  const d = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = m[i] === alvo ? 0 : INF;
  const passo = (i: number, j: number, c: number) => {
    if (d[j] + c < d[i]) d[i] = d[j] + c;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) passo(i, i - 1, 3);
      if (y > 0) {
        passo(i, i - w, 3);
        if (x > 0) passo(i, i - w - 1, 4);
        if (x < w - 1) passo(i, i - w + 1, 4);
      }
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) passo(i, i + 1, 3);
      if (y < h - 1) {
        passo(i, i + w, 3);
        if (x < w - 1) passo(i, i + w + 1, 4);
        if (x > 0) passo(i, i + w - 1, 4);
      }
    }
  if (dist) for (let i = 0; i < w * h; i++) dist[i] = d[i] / 3;
  // fora da folha conta como fora da mascara: na erosao, a borda da folha nao come a mascara
  const o = new Uint8Array(w * h);
  const lim = 3 * k + 1;
  for (let i = 0; i < w * h; i++) o[i] = cresce ? (d[i] <= lim ? 1 : 0) : m[i] && d[i] > lim ? 1 : 0;
  return o;
}

// o plano do corte da pintura `rgba` (w x h) pelo laco `pontos`; null se nao ha tinta dentro
export function planoDoCorte(rgba: Uint8ClampedArray, w: number, h: number, pontos: Vec[], sobra = 4, opaco = 128): PlanoDoCorte | null {
  const M = mascaraDoLaco(pontos, w, h);
  // a distancia (px) de cada pixel ate o laco, por fora: a borda da peca some aos poucos na faixa de
  // sobra, por cima da mesma tinta da original. Um degrau de opaco para transparente vira linha
  // escura na tela: o canvas guarda a cor pre-multiplicada e perde a cor do pixel de alfa 0, e o
  // filtro linear mistura esse preto na borda (visto ao vivo pelo Thiago num dedo cortado)
  const fora = new Float32Array(w * h);
  // (16/11, o Thiago: "a peca cortada fica mais para dentro do laco") a original e cortada
  // EXATAMENTE na linha do laco (E = a mascara, sem erosao): sobrar tinta dela dentro da linha
  // deixava uma beirada do pedaco na original quando a peca se move. A cobertura da junta fica toda
  // na peca: opaca ate `sobra` px para fora da linha e sumindo aos poucos ate 2 x sobra
  const D = morfo(M, w, h, 2 * sobra, true, fora);
  const E = M;
  const tinta = (i: number) => rgba[i * 4 + 3] > 2;
  // a caixa da tinta da peca
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!D[i] || !tinta(i)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  let temDentro = false;
  for (let i = 0; i < w * h && !temDentro; i++) temDentro = !!M[i] && tinta(i);
  if (!temDentro || x1 < x0) return null;
  const bw = x1 - x0 + 1,
    bh = y1 - y0 + 1;
  const peca = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * w + x + x0;
      // fora da mascara fica a cor sem o alfa: o filtro linear na borda do corte nao escurece
      peca.set(rgba.subarray(i * 4, i * 4 + 4), (y * bw + x) * 4);
      if (!D[i]) peca[(y * bw + x) * 4 + 3] = 0;
      else if (!M[i] && sobra > 0) {
        const t = Math.min(1, Math.max(0, 1 - (fora[i] - sobra - 0.5) / (sobra + 0.5)));
        peca[(y * bw + x) * 4 + 3] = Math.round(peca[(y * bw + x) * 4 + 3] * t * t * (3 - 2 * t));
      }
    }
  const resto = new Uint8ClampedArray(rgba);
  let ex0 = w,
    ey0 = h,
    ex1 = -1,
    ey1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (!E[i] || !resto[i * 4 + 3]) continue;
    resto[i * 4 + 3] = 0;
    const x = i % w,
      y = (i - x) / w;
    if (x < ex0) ex0 = x;
    if (x > ex1) ex1 = x;
    if (y < ey0) ey0 = y;
    if (y > ey1) ey1 = y;
  }
  // a fronteira: pixel opaco na borda do laco com vizinho opaco fora dele
  const forte = (i: number) => rgba[i * 4 + 3] >= opaco;
  const FUNDO = 32;
  let sx = 0,
    sy = 0,
    n = 0,
    nb = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!M[i] || !forte(i)) continue;
      const fora = (j: number, ok: boolean) => ok && !M[j] && forte(j);
      // o peso e o tanto de tinta que continua do lado de fora (ate FUNDO px): onde o resto da peca
      // segue (a junta) pesa muito; a borda fina em volta (o brilho, o contorno) quase nada. Sem isso
      // um laco que corta a ponta pelos lados e por cima poe o pivo no meio do pedaco (o "U")
      let p = 0;
      for (const [dx, dy, ok] of [[-1, 0, x > 0], [1, 0, x < w - 1], [0, -1, y > 0], [0, 1, y < h - 1]] as [number, number, boolean][]) {
        if (!fora(i + dy * w + dx, ok)) continue;
        let k = 1;
        while (k < FUNDO) {
          const xx = x + dx * (k + 1),
            yy = y + dy * (k + 1);
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
          const j = yy * w + xx;
          if (M[j] || !forte(j)) break;
          k++;
        }
        p = Math.max(p, k);
      }
      if (p) (sx += (x + 0.5) * p * p), (sy += (y + 0.5) * p * p), (n += p * p), nb++;
    }
  const fronteira = nb;
  if (!n) {
    for (let i = 0; i < w * h; i++)
      if (M[i] && forte(i)) {
        const x = i % w;
        (sx += x + 0.5), (sy += (i - x) / w + 0.5), n++;
      }
    if (!n) (sx = x0 + bw / 2), (sy = y0 + bh / 2), (n = 1);
  }
  const pivot: Vec = [sx / n, sy / n];
  let tip: Vec = [x0 + bw / 2, y0 + bh / 2],
    longe = -1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!D[i] || !forte(i)) continue;
      const dd = (x + 0.5 - pivot[0]) ** 2 + (y + 0.5 - pivot[1]) ** 2;
      if (dd > longe) (longe = dd), (tip = [x + 0.5, y + 0.5]);
    }
  return { box: [x0, y0, bw, bh], pivot, tip, peca, resto, mudou: ex1 >= ex0 ? [ex0, ey0, ex1 - ex0 + 1, ey1 - ey0 + 1] : [x0, y0, bw, bh], fronteira };
}
