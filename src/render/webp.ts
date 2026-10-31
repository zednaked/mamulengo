// WebP animado a partir de quadros de canvas: cada quadro vira WebP pelo proprio navegador
// (toBlob, com perda) e os quadros vao num conteiner RIFF/WEBP animado (VP8X com a marca de
// animacao, ANIM com o laco infinito, um ANMF por quadro com a duracao dele). Sem biblioteca.
// Bem menor que o GIF para cena com gradiente, luz e grao (o GIF tem 256 cores por arquivo).

const u24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const fourcc = (s: string) => [...s].map((c) => c.charCodeAt(0));

// os chunks de um arquivo WebP simples (depois de "RIFF....WEBP"): [nome, dados]
function chunks(b: Uint8Array): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const nome = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const tam = (b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24)) >>> 0;
    out.push([nome, b.subarray(p + 8, p + 8 + tam)]);
    p += 8 + tam + (tam & 1);
  }
  return out;
}

// um chunk: nome, tamanho, dados (e um byte de enchimento se o tamanho e impar)
function chunk(nome: string, ...partes: Uint8Array[]): Uint8Array {
  const tam = partes.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(8 + tam + (tam & 1));
  out.set(fourcc(nome), 0);
  out.set(u32(tam), 4);
  let p = 8;
  for (const x of partes) out.set(x, p), (p += x.length);
  return out;
}

const blobDe = (c: HTMLCanvasElement, qualidade: number) =>
  new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error("o navegador nao gerou WebP"))), "image/webp", qualidade));

// n quadros de w x h; quadro(i) desenha o quadro i num canvas; duracoes em ms (uma por quadro)
export async function encodeWebpAnim(n: number, size: [number, number], quadro: (i: number) => HTMLCanvasElement, duracoes: number[], qualidade = 0.8, progresso?: (d: number, t: number) => void): Promise<Blob> {
  const [w, h] = size;
  const quadros: Uint8Array[] = [];
  let alfa = false;
  for (let i = 0; i < n; i++) {
    const b = new Uint8Array(await (await blobDe(quadro(i), qualidade)).arrayBuffer());
    if (String.fromCharCode(b[8], b[9], b[10], b[11]) !== "WEBP") throw new Error("o navegador nao gerou WebP (toBlob devolveu outro formato)");
    // o quadro: ALPH (se tem) e VP8, ou VP8L. O resto (VP8X, e o ICCP com o perfil de cor que o
    // Chrome poe em cada um) nao pode ir dentro de um ANMF: o arquivo nao abria
    const dados: Uint8Array[] = [];
    for (const [nome, d] of chunks(b)) {
      if (nome !== "ALPH" && nome !== "VP8 " && nome !== "VP8L") continue;
      if (nome === "ALPH" || nome === "VP8L") alfa = true;
      dados.push(chunk(nome, d));
    }
    // posicao (0, 0), tamanho, duracao, e sem misturar com o anterior (o quadro e inteiro)
    const cab = new Uint8Array([...u24(0), ...u24(0), ...u24(w - 1), ...u24(h - 1), ...u24(Math.max(1, Math.round(duracoes[i]))), 0b10]);
    quadros.push(chunk("ANMF", cab, ...dados));
    progresso?.(i + 1, n);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  const vp8x = chunk("VP8X", new Uint8Array([0b10 | (alfa ? 0b10000 : 0), 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]));
  // ANIM: fundo transparente e laco infinito
  const anim = chunk("ANIM", new Uint8Array(6));
  const tam = 4 + vp8x.length + anim.length + quadros.reduce((s, x) => s + x.length, 0);
  const cabeca = new Uint8Array([...fourcc("RIFF"), ...u32(tam), ...fourcc("WEBP")]);
  return new Blob([cabeca, vp8x, anim, ...quadros] as BlobPart[], { type: "image/webp" });
}
