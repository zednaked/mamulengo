// Relevo das paginas de um .boneco (docs/NUCLEO.md "Luzes"): um mapa de normais por pagina,
// calculado da propria imagem, para as luzes iluminarem as pecas sem o artista pintar nada. Em
// cada imagem do atlas, a altura sobe da borda (a distancia ate o transparente, num perfil de
// almofada: inclinada na borda, plana no miolo) mais um pouco do brilho da cor (detalhe); a
// normal sai da inclinacao. Fora das imagens (e nas imagens giradas), plano.
//
//   npx tsx tools/relevo.ts <x.boneco> [--borda 12] [--profundidade 1] [--detalhe 0.2] [--gravar]
//
//   --borda         largura da borda inclinada, em pixels da pagina (multiplique numa pagina HD)
//   --profundidade  quanto a borda sobe (1: a borda sobe a largura dela, 45 graus)
//   --detalhe       quanto o brilho da cor vira relevo (0: so a forma)
//   --gravar        poe "relevo" nas paginas do .boneco
// So as paginas das partes das skins, fora dos slots aditivo e tela (luz nao recebe luz). Cada
// relevo vai ao lado da pagina: <pagina>_relevo.png (vermelho: x para a direita; verde: y para
// cima; azul: para fora da tela).
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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
const [arq] = args;
if (!arq) {
  console.error("uso: tools/relevo.ts <x.boneco> [--borda 12] [--profundidade 1] [--detalhe 0.2] [--gravar]");
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
const paginas = [...new Set(imagens.map((im: any) => im.pagina ?? 0))] as number[];

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

for (const pi of paginas) {
  const pg = b.paginas[pi];
  const { data, info } = await sharp(join(pasta, pg.arquivo)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width,
    H = info.height;
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) out.set([128, 128, 255], i * 3);
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
    const dist = distancia(dentro, w, h);
    // altura em pixels: almofada (borda inclinada, miolo plano) e o detalhe do brilho
    const alt = new Float64Array(w * h);
    for (let k = 0; k < w * h; k++) {
      if (!dentro[k]) continue;
      const t = Math.min(dist[k] / Math.max(borda, 1e-6), 1);
      alt[k] = (Math.sqrt(1 - (1 - t) * (1 - t)) * profundidade + lum[k] * detalhe * 0.25) * borda;
    }
    // suaviza 1 px (os degraus da distancia) e tira a normal da inclinacao
    const suave = new Float64Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += alt[(y + dy) * w + x + dx];
        suave[y * w + x] = s / 9;
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
  console.log(`${join(pasta, nome)}: ${W} x ${H}, ${imagens.filter((im: any) => (im.pagina ?? 0) === pi).length} imagens`);
  if (gravar) pg.relevo = nome;
}
if (gravar) {
  writeFileSync(resolve(arq), JSON.stringify(b, null, 1) + "\n");
  console.log(`${basename(arq)}: relevo em ${paginas.length} paginas`);
}
