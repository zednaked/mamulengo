// Intermediarios do quadro a quadro: o RIFE (interpolacao de quadros de video, server/rife.ts) gera o
// desenho entre duas chaves, como base para limpar por cima. Aqui so a conta dos pixels, sem placa:
// o RIFE nao sabe de transparencia, entao cada par vai duas vezes, como mascara (o alfa em cinza) e
// como cor espalhada (a cor da tinta escorre para fora da borda, e o resto e cinza medio), e a volta
// junta as duas: o alfa da mascara, a cor da outra (sem dividir pelo alfa, que faz franja na borda). O traco do RIFE sai mais macio que o das
// chaves: o alfa e casado, quantil a quantil, com a mistura das duas chaves em t (o mesmo que a
// ferramenta de intermediarios do ProCraft faz com o escuro do traco).

export const CURVAS = {
  lin: (x: number) => x,
  // os intermediarios se juntam perto da chave A (sai devagar dela)
  sai: (x: number) => x * x,
  // ... perto da chave B (chega devagar nela)
  entra: (x: number) => 1 - (1 - x) ** 2,
  ambos: (x: number) => (1 - Math.cos(Math.PI * x)) / 2,
};
export type Curva = keyof typeof CURVAS;

// os instantes (0 a 1) de n intermediarios entre duas chaves
export const instantes = (n: number, curva: Curva = "lin") => Array.from({ length: n }, (_, k) => CURVAS[curva]((k + 1) / (n + 1)));

const CINZA = 128;

// RGBA reto -> RGBA opaco com o alfa em cinza (branco = tinta cheia)
export function mascara(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = out[i + 1] = out[i + 2] = rgba[i + 3];
    out[i + 3] = 255;
  }
  return out;
}

// RGBA reto -> a cor opaca, com a cor da tinta escorrida `passos` pixels para fora da borda (e
// cinza medio mais longe), para o RIFE nao misturar a borda com o fundo
export function corEspalhada(rgba: Uint8ClampedArray, w: number, h: number, passos = 12): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  let tem = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++)
    if (rgba[i * 4 + 3] > 8) {
      out.set(rgba.subarray(i * 4, i * 4 + 3), i * 4);
      tem[i] = 1;
    }
  for (let p = 0; p < passos; p++) {
    const novo = tem.slice();
    let mudou = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (tem[i]) continue;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (!tem[k]) continue;
          r += out[k * 4];
          g += out[k * 4 + 1];
          b += out[k * 4 + 2];
          n++;
        }
        if (!n) continue;
        out[i * 4] = r / n;
        out[i * 4 + 1] = g / n;
        out[i * 4 + 2] = b / n;
        novo[i] = 1;
        mudou = true;
      }
    tem = novo;
    if (!mudou) break;
  }
  for (let i = 0; i < w * h; i++) {
    if (!tem[i]) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = CINZA;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// os quantis (q = 0..1 em `passos` + 1 pontos) dos valores acima de `piso`
function quantis(v: Float32Array, piso: number, passos: number): Float32Array | null {
  const xs = v.filter((x) => x > piso).sort();
  if (xs.length < 50) return null;
  const out = new Float32Array(passos + 1);
  for (let k = 0; k <= passos; k++) out[k] = xs[Math.min(xs.length - 1, Math.round((k / passos) * (xs.length - 1)))];
  return out;
}

const alfas = (rgba: Uint8ClampedArray) => {
  const a = new Float32Array(rgba.length / 4);
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3] / 255;
  return a;
};

// junta o que o RIFE devolveu (a mascara e a cor em t) num RGBA reto. chaveA e chaveB: as duas
// chaves em RGBA reto, para casar o alfa
export function juntar(mascaraT: Uint8ClampedArray, corT: Uint8ClampedArray, chaveA: Uint8ClampedArray, chaveB: Uint8ClampedArray, t: number): Uint8ClampedArray {
  const n = mascaraT.length / 4;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = (mascaraT[i * 4] + mascaraT[i * 4 + 1] + mascaraT[i * 4 + 2]) / (3 * 255);
  // o alfa casado com a mistura das chaves (o traco volta a ser firme)
  const P = 200,
    PISO = 0.04;
  const qa = quantis(alfas(chaveA), PISO, P),
    qb = quantis(alfas(chaveB), PISO, P),
    qt = quantis(a, PISO, P);
  if (qa && qb && qt) {
    const alvo = qa.map((x, k) => (1 - t) * x + t * qb[k]);
    for (let i = 0; i < n; i++) {
      const x = a[i];
      if (x <= PISO) continue;
      // interpolacao de x na curva qt -> alvo (qt e crescente)
      let lo = 0,
        hi = P;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (qt[m] <= x) lo = m;
        else hi = m;
      }
      const d = qt[hi] - qt[lo];
      const f = d > 1e-6 ? Math.min(1, Math.max(0, (x - qt[lo]) / d)) : 0;
      a[i] = alvo[lo] + (alvo[hi] - alvo[lo]) * f;
    }
  }
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const al = a[i];
    if (al < 0.01) continue;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = corT[i * 4 + c];
    out[i * 4 + 3] = Math.round(al * 255);
  }
  return out;
}
