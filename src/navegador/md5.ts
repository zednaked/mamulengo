// MD5 (RFC 1321) para conferir se o import do Godot esta em dia com a fonte (o .md5 ao lado do
// .ctex guarda o md5 da imagem-fonte); o crypto.subtle do navegador nao tem MD5.
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(dados: Uint8Array): string {
  const n = dados.length;
  const total = (((n + 8) >>> 6) + 1) * 64;
  const m = new Uint8Array(total);
  m.set(dados);
  m[n] = 0x80;
  const v = new DataView(m.buffer);
  v.setUint32(total - 8, (n * 8) >>> 0, true);
  v.setUint32(total - 4, Math.floor(n / 0x20000000), true);
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  const w = new Uint32Array(16);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(o + i * 4, true);
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) (f = (b & c) | (~b & d)), (g = i);
      else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) % 16);
      else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) % 16);
      else (f = c ^ (b | ~d)), (g = (7 * i) % 16);
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + w[g]) >>> 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((x, i) => ov.setUint32(i * 4, x, true));
  return [...out].map((x) => x.toString(16).padStart(2, "0")).join("");
}
