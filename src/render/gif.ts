// Codificador de GIF animado (sem dependencias): paleta global de 256 cores por
// median cut sobre amostras dos quadros, pontilhado ordenado leve e LZW. Repete
// para sempre (extensao NETSCAPE2.0).

class Bytes {
  buf = new Uint8Array(1 << 16);
  n = 0;
  byte(b: number) {
    if (this.n >= this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = b;
  }
  word(w: number) {
    this.byte(w & 255);
    this.byte((w >> 8) & 255);
  }
  bytes(a: ArrayLike<number>) {
    for (let i = 0; i < a.length; i++) this.byte(a[i]);
  }
  result() {
    return this.buf.slice(0, this.n);
  }
}

// --- paleta: histograma de 15 bits (5 por canal) e median cut

export class Histogram {
  counts = new Float64Array(32768);
  // soma das cores reais de cada caixinha (a media sai sem o vies do centro da caixinha)
  sums = new Float64Array(32768 * 3);
  add(rgba: Uint8ClampedArray | Uint8Array, stride = 1) {
    for (let i = 0; i < rgba.length; i += 4 * stride) {
      const b = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      this.counts[b]++;
      this.sums[b * 3] += rgba[i];
      this.sums[b * 3 + 1] += rgba[i + 1];
      this.sums[b * 3 + 2] += rgba[i + 2];
    }
  }
  palette(size = 256): number[][] {
    type Box = { bins: number[]; count: number };
    const bins: number[] = [];
    for (let i = 0; i < 32768; i++) if (this.counts[i]) bins.push(i);
    const ch = (b: number, c: number) => (b >> (10 - c * 5)) & 31;
    const box = (bs: number[]): Box => ({ bins: bs, count: bs.reduce((s, b) => s + this.counts[b], 0) });
    const boxes: Box[] = bins.length ? [box(bins)] : [];
    while (boxes.length < size) {
      // divide a caixa com mais pixels vezes extensao (as que ainda podem ser divididas)
      let best = -1,
        score = 0,
        axis = 0;
      boxes.forEach((b, i) => {
        if (b.bins.length < 2) return;
        for (let c = 0; c < 3; c++) {
          let lo = 31,
            hi = 0;
          for (const x of b.bins) {
            const v = ch(x, c);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          const s = (hi - lo) * Math.sqrt(b.count);
          if (s > score) [score, best, axis] = [s, i, c];
        }
      });
      if (best < 0) break;
      const b = boxes[best];
      b.bins.sort((x, y) => ch(x, axis) - ch(y, axis));
      let acc = 0,
        cut = 1;
      for (let i = 0; i < b.bins.length - 1; i++) {
        acc += this.counts[b.bins[i]];
        cut = i + 1;
        if (acc >= b.count / 2) break;
      }
      boxes.splice(best, 1, box(b.bins.slice(0, cut)), box(b.bins.slice(cut)));
    }
    const pal = boxes.map((b) => {
      let r = 0,
        g = 0,
        bl = 0;
      for (const x of b.bins) {
        r += this.sums[x * 3];
        g += this.sums[x * 3 + 1];
        bl += this.sums[x * 3 + 2];
      }
      return [Math.round(r / b.count), Math.round(g / b.count), Math.round(bl / b.count)];
    });
    while (pal.length < size) pal.push([0, 0, 0]);
    return pal;
  }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export class GifEncoder {
  private out = new Bytes();
  private lut = new Int16Array(32768).fill(-1);

  constructor(
    private w: number,
    private h: number,
    private palette: number[][],
  ) {
    const o = this.out;
    o.bytes([71, 73, 70, 56, 57, 97]); // GIF89a
    o.word(w);
    o.word(h);
    o.byte(0xf7); // tabela global de 256 cores
    o.byte(0);
    o.byte(0);
    for (const [r, g, b] of palette) o.bytes([r, g, b]);
    // NETSCAPE2.0: repetir para sempre
    o.bytes([0x21, 0xff, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0]);
  }

  private nearest(key: number): number {
    let i = this.lut[key];
    if (i >= 0) return i;
    const r = ((key >> 10) & 31) * 8 + 4,
      g = ((key >> 5) & 31) * 8 + 4,
      b = (key & 31) * 8 + 4;
    let best = Infinity;
    this.palette.forEach(([pr, pg, pb], j) => {
      const d = (pr - r) ** 2 * 3 + (pg - g) ** 2 * 4 + (pb - b) ** 2 * 2;
      if (d < best) [best, i] = [d, j];
    });
    this.lut[key] = i;
    return i;
  }

  // quadro RGBA (w*h*4) com atraso em centesimos de segundo
  frame(rgba: Uint8ClampedArray | Uint8Array, delayCs: number) {
    const { w, h, out: o } = this;
    const idx = new Uint8Array(w * h);
    for (let y = 0, p = 0; y < h; y++)
      for (let x = 0; x < w; x++, p++) {
        const d = (BAYER[((y & 3) << 2) | (x & 3)] - 7.5) * 0.5;
        const q = p * 4;
        const r = Math.max(0, Math.min(255, rgba[q] + d)),
          g = Math.max(0, Math.min(255, rgba[q + 1] + d)),
          b = Math.max(0, Math.min(255, rgba[q + 2] + d));
        idx[p] = this.nearest(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      }
    // controle grafico: atraso, sem transparencia, descarte "nao mexe"
    o.bytes([0x21, 0xf9, 4, 0x04]);
    o.word(Math.max(1, Math.round(delayCs)));
    o.bytes([0, 0]);
    // descritor da imagem (quadro inteiro, usa a tabela global)
    o.byte(0x2c);
    o.word(0);
    o.word(0);
    o.word(w);
    o.word(h);
    o.byte(0);
    lzw(idx, 8, o);
  }

  finish(): Uint8Array {
    this.out.byte(0x3b);
    return this.out.result();
  }
}

function lzw(pixels: Uint8Array, minCode: number, o: Bytes) {
  o.byte(minCode);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  // dicionario: (prefixo << 8 | byte) -> codigo
  const dict = new Int16Array(4096 * 256);
  let next = 0,
    size = 0;
  const block: number[] = [];
  let acc = 0,
    bits = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
      if (block.length === 255) flush();
    }
  };
  const flush = () => {
    if (!block.length) return;
    o.byte(block.length);
    o.bytes(block);
    block.length = 0;
  };
  const reset = () => {
    dict.fill(-1);
    next = eoi + 1;
    size = minCode + 1;
  };
  reset();
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const hit = dict[(prefix << 8) | k];
    if (hit >= 0) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict[(prefix << 8) | k] = next++;
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      reset();
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) block.push(acc & 255);
  flush();
  o.byte(0);
}
