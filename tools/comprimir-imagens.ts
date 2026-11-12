// Regrava com perda as imagens WebP sem perda (VP8L) quando quase nada muda na tela: o arquivo novo
// (WebP q95, alfa sem perda) so entra se, nos pixels visiveis e com a cor pre-multiplicada pelo alfa
// (o que a tela desenha), o percentil 99 do erro fica ate `limite` (padrao 10 de 255) e o arquivo
// diminui. Arte de bordas duras (numeros, brilhos finos) costuma ser recusada; pintura (o cenario, o
// personagem) costuma passar com 3 a 4x menos bytes. A arte-fonte nao muda: as aceitas vao para a
// pasta de saida, com cache por hash (do arquivo e das opcoes), recusas inclusive.
//
// A que e recusada com perda ainda e regravada SEM perda no esforco maximo: entra se a imagem fica
// identica (todos os pixels, ate a cor dos transparentes) e o arquivo diminui pelo menos 3%. Um WebP
// sem perda gravado com pouco esforco (o de um canvas, o de um editor) cai muito assim, sem mudar nada.
//
//   npx tsx tools/comprimir-imagens.ts <saida/> <a.webp> [b.webp ...] [--lista arquivos.txt] [--qualidade 95] [--limite 10]
//
// Imprime no stdout o JSON { origem: { arquivo, aceita, p99, bytes: [antes, depois] } }.
import { existsSync, realpathSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

export type Comprimida = { arquivo: string; aceita: boolean; p99: number; bytes: [number, number]; semPerda?: boolean };
export type OpcoesCompressao = { qualidade?: number; limite?: number };

// o WebP tem um bloco VP8L (sem perda), direto ou dentro do VP8X?
export function ehSemPerda(b: Uint8Array): boolean {
  const txt = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 20 || txt(0) !== "RIFF" || txt(8) !== "WEBP") return false;
  for (let o = 12; o + 8 <= b.length; ) {
    if (txt(o) === "VP8L") return true;
    const n = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24);
    o += 8 + n + (n & 1);
  }
  return false;
}

// percentil `q` do erro entre duas imagens RGBA do mesmo tamanho, nos pixels visiveis (alfa > 0 em
// alguma), em cada pixel o maior entre os canais da cor pre-multiplicada e o alfa (0 a 255)
export function erroVisivel(a: Uint8Array, b: Uint8Array, q = 0.99): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let o = 0; o < a.length; o += 4) {
    const aa = a[o + 3], ab = b[o + 3];
    if (!aa && !ab) continue;
    let e = Math.abs(aa - ab);
    for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(a[o + c] * aa - b[o + c] * ab) / 255);
    hist[Math.min(255, Math.round(e))]++;
    n++;
  }
  if (!n) return 0;
  const alvo = Math.ceil(n * q);
  let soma = 0;
  for (let v = 0; v < 256; v++) if ((soma += hist[v]) >= alvo) return v;
  return 255;
}

export async function comprimirImagem(origem: string, saida: string, o: OpcoesCompressao = {}): Promise<Comprimida | null> {
  const { qualidade = 95, limite = 10 } = o;
  const fonte = readFileSync(origem);
  if (!ehSemPerda(fonte)) return null;
  mkdirSync(saida, { recursive: true });
  const chave = createHash("sha256").update(fonte).update(`q${qualidade}|l${limite}|v3`).digest("hex").slice(0, 16);
  const ficha = join(resolve(saida), `${chave}.json`);
  // a recusada aponta para a propria origem (duas origens iguais dividem a ficha do cache)
  if (existsSync(ficha)) {
    const r: Comprimida = JSON.parse(readFileSync(ficha, "utf8"));
    return r.aceita ? r : { ...r, arquivo: resolve(origem) };
  }
  const novo = await sharp(fonte).webp({ quality: qualidade, alphaQuality: 100, effort: 6 }).toBuffer();
  const [ra, rb] = await Promise.all([fonte, novo].map((x) => sharp(x).ensureAlpha().raw().toBuffer()));
  const p99 = erroVisivel(ra, rb);
  let aceita = p99 <= limite && novo.length < fonte.length;
  let gravar = novo;
  let semPerda = false;
  if (!aceita) {
    // sem perda, no esforco maximo (no WebP sem perda a qualidade 100 e o esforco de compressao; `exact`
    // guarda ate a cor dos pixels transparentes): so vale com todos os bytes da imagem iguais e menor
    const igual = await sharp(fonte).webp({ lossless: true, effort: 6, quality: 100, exact: true }).toBuffer();
    const rc = await sharp(igual).ensureAlpha().raw().toBuffer();
    if (igual.length < fonte.length * 0.97 && Buffer.compare(ra, rc) === 0) (aceita = true), (semPerda = true), (gravar = igual);
  }
  const arquivo = aceita ? join(resolve(saida), `${chave}.webp`) : resolve(origem);
  if (aceita) writeFileSync(arquivo, gravar);
  const r: Comprimida = { arquivo, aceita, p99: semPerda ? 0 : p99, bytes: [fonte.length, aceita ? gravar.length : fonte.length], ...(semPerda ? { semPerda } : {}) };
  writeFileSync(ficha, JSON.stringify(r));
  return r;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const q = opt("qualidade"), l = opt("limite"), lista = opt("lista");
  const [saida, ...arquivos] = args;
  if (lista) arquivos.push(...readFileSync(lista, "utf8").split("\n").filter(Boolean));
  if (!saida || !arquivos.length) {
    console.error("uso: tools/comprimir-imagens.ts <saida/> <a.webp> [...] [--qualidade 95] [--limite 10]");
    process.exit(2);
  }
  const out: Record<string, Comprimida> = {};
  let antes = 0, depois = 0, aceitas = 0, recusadas = 0, iguais = 0;
  for (const a of arquivos) {
    const r = await comprimirImagem(resolve(a), saida, { qualidade: q ? Number(q) : undefined, limite: l ? Number(l) : undefined });
    if (!r) continue;
    out[resolve(a)] = r;
    antes += r.bytes[0], depois += r.bytes[1];
    r.semPerda ? iguais++ : r.aceita ? aceitas++ : recusadas++;
  }
  console.error(`comprimir-imagens: ${aceitas} aceitas com perda, ${iguais} regravadas sem perda, ${recusadas} como estavam, ${(antes / 1048576).toFixed(2)} -> ${(depois / 1048576).toFixed(2)} MB`);
  console.log(JSON.stringify(out));
}
