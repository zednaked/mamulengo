// PNG sem perda no navegador (e no service worker): o canvas guarda a cor multiplicada pelo alfa
// e perde a cor dos pixels quase transparentes; as imagens-fonte do personagem (images/*.png) e
// as paginas do atlas precisam sair e voltar iguais, byte a byte nos pixels. O zlib e o do proprio
// navegador (CompressionStream "deflate" e o formato que o PNG usa).
//
// codificar: RGBA 8 bits, com o filtro de cada linha escolhido pela menor soma (como o libpng).
// decodificar: 8 bits, sem entrelacamento, tons de cinza, RGB, paleta (com tRNS) e com alfa; o
// resto devolve null (quem chama usa o canvas).

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array, ini = 0xffffffff): number {
  let c = ini;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c;
}

async function passar(dados: Uint8Array, s: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const r = new Response(new Blob([dados as BlobPart]).stream().pipeThrough(s));
  return new Uint8Array(await r.arrayBuffer());
}

const ASSINATURA = [137, 80, 78, 71, 13, 10, 26, 10];

function pedaco(tipo: string, dados: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + dados.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, dados.length);
  for (let i = 0; i < 4; i++) out[4 + i] = tipo.charCodeAt(i);
  out.set(dados, 8);
  v.setUint32(8 + dados.length, (crc32(out.subarray(4, 8 + dados.length)) ^ 0xffffffff) >>> 0);
  return out;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export async function codificarPng(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const linha = w * 4;
  const cru = new Uint8Array((linha + 1) * h);
  const tentativa = new Uint8Array(linha);
  for (let y = 0; y < h; y++) {
    const cur = rgba.subarray(y * linha, (y + 1) * linha);
    const ant = y ? rgba.subarray((y - 1) * linha, y * linha) : null;
    let melhor = 0,
      menor = Infinity;
    const destino = cru.subarray(y * (linha + 1) + 1, (y + 1) * (linha + 1));
    for (let f = 0; f < 5; f++) {
      let soma = 0;
      for (let i = 0; i < linha; i++) {
        const a = i >= 4 ? cur[i - 4] : 0,
          b = ant ? ant[i] : 0,
          c = ant && i >= 4 ? ant[i - 4] : 0;
        const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (cur[i] - p) & 0xff;
        tentativa[i] = v;
        soma += v < 128 ? v : 256 - v;
      }
      if (soma < menor) {
        menor = soma;
        melhor = f;
        destino.set(tentativa);
      }
    }
    cru[y * (linha + 1)] = melhor;
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const partes = [new Uint8Array(ASSINATURA), pedaco("IHDR", ihdr), pedaco("IDAT", await passar(cru, new CompressionStream("deflate"))), pedaco("IEND", new Uint8Array())];
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) out.set(p, o), (o += p.length);
  return out;
}

export async function decodificarPng(b: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  if (b.length < 8 || ASSINATURA.some((x, i) => b[i] !== x)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let w = 0,
    h = 0,
    prof = 0,
    cor = 0,
    entrelacado = 0;
  let paleta: Uint8Array | null = null,
    trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 8 <= b.length; ) {
    const n = v.getUint32(o);
    const tipo = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const d = b.subarray(o + 8, o + 8 + n);
    if (tipo === "IHDR") {
      w = v.getUint32(o + 8);
      h = v.getUint32(o + 12);
      prof = d[8];
      cor = d[9];
      entrelacado = d[12];
    } else if (tipo === "PLTE") paleta = d;
    else if (tipo === "tRNS") trns = d;
    else if (tipo === "IDAT") idat.push(d);
    else if (tipo === "IEND") break;
    o += 12 + n;
  }
  const canais = cor === 6 ? 4 : cor === 2 ? 3 : cor === 4 ? 2 : cor === 0 || cor === 3 ? 1 : 0;
  if (!w || !h || prof !== 8 || entrelacado || !canais || (cor === 3 && !paleta)) return null;
  const junto = new Uint8Array(idat.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of idat) junto.set(p, o), (o += p.length);
  const cru = await passar(junto, new DecompressionStream("deflate"));
  const bpp = canais,
    linha = w * bpp;
  if (cru.length < (linha + 1) * h) return null;
  const px = new Uint8Array(linha * h);
  for (let y = 0; y < h; y++) {
    const f = cru[y * (linha + 1)];
    const src = cru.subarray(y * (linha + 1) + 1, (y + 1) * (linha + 1));
    const cur = px.subarray(y * linha, (y + 1) * linha);
    const ant = y ? px.subarray((y - 1) * linha, y * linha) : null;
    for (let i = 0; i < linha; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0,
        bb = ant ? ant[i] : 0,
        c = ant && i >= bpp ? ant[i - bpp] : 0;
      const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? bb : f === 3 ? (a + bb) >> 1 : f === 4 ? paeth(a, bb, c) : -1;
      if (p < 0) return null;
      cur[i] = (src[i] + p) & 0xff;
    }
  }
  const out = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) {
    const k = i * 4;
    if (cor === 6) out.set(px.subarray(j, j + 4), k);
    else if (cor === 2) {
      out[k] = px[j];
      out[k + 1] = px[j + 1];
      out[k + 2] = px[j + 2];
      out[k + 3] = trns && trns.length >= 6 && px[j] === trns[1] && px[j + 1] === trns[3] && px[j + 2] === trns[5] ? 0 : 255;
    } else if (cor === 0 || cor === 4) {
      out[k] = out[k + 1] = out[k + 2] = px[j];
      out[k + 3] = cor === 4 ? px[j + 1] : trns && trns.length >= 2 && px[j] === trns[1] ? 0 : 255;
    } else {
      const e = px[j];
      out[k] = paleta![e * 3];
      out[k + 1] = paleta![e * 3 + 1];
      out[k + 2] = paleta![e * 3 + 2];
      out[k + 3] = trns && e < trns.length ? trns[e] : 255;
    }
  }
  return { width: w, height: h, data: out };
}
