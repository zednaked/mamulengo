// Versao leve de um .boneco, para aparelhos fracos (que esperam a GPU, docs/ROADMAP.md "Bake"):
// todas as imagens repacotadas no menor numero de paginas (menos trocas de textura, menos lotes)
// e gravadas numa fracao da resolucao. O .boneco leve guarda as medidas logicas: os retangulos,
// cortes, o tamanho das paginas, as particulas e as medidas de efeito ficam na escala original,
// so o arquivo da pagina e menor (os desenhistas normalizam pelo `tamanho` da pagina). O
// esqueleto, as partes e as animacoes nao mudam.
//
//   npx tsx tools/boneco-leve.ts <x.boneco> [--fator 0.5] [--lado 2048] [--saida <x-leve.boneco>]
//
//   --fator  1/n (0.5, 0.25 ou 1: so repacota)
//   --lado   lado maximo da pagina gravada, em pixels do arquivo
//   --saida  padrao: <x>-leve.boneco ao lado, com as paginas <x>-leve.webp (e _2, _3...)
//
// Paginas com pma, filtro, compressao no jogo ou relevo diferentes nao se juntam. O relevo vai
// junto, na mesma arrumacao. Instancias: cada filho ganha a versao leve dele e o pai aponta para
// ela. No fim, os lotes de desenho do primeiro quadro de cada animacao, antes e depois.
import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import sharp, { type Sharp } from "sharp";
import { packAtlas, parseAtlas } from "../server/atlas.ts";
import { arquivoBinario, gravarBonecoArquivo, lerBonecoArquivo } from "../server/boneco-binario.ts";

sharp.cache(false);
const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const fator = Number(opt("fator", "0.5"));
const lado = Number(opt("lado", "2048"));
const saidaOpt = opt("saida", "");
const n = Math.round(1 / fator);
if (!args[0] || !(fator > 0) || Math.abs(1 / fator - n) > 1e-9) {
  console.error("uso: tools/boneco-leve.ts <x.boneco> [--fator 0.5 (1/n)] [--lado 2048] [--saida <x-leve.boneco>]");
  process.exit(2);
}

const NUCLEO = resolve(dirname(new URL(import.meta.url).pathname), "../nucleo/build/nucleo-pose");
// lotes do primeiro quadro de cada animacao (o nucleo-pose escreve em stderr)
function lotes(arq: string): number[] {
  if (!existsSync(NUCLEO)) return [];
  const b = lerBonecoArquivo(arq);
  return Object.keys(b.animacoes ?? {}).map((a) => {
    const r = spawnSync(NUCLEO, [arq, a, "0", "--quadros", "1"], { encoding: "utf8", maxBuffer: 1 << 28 });
    return Number(/(\d+) lotes/.exec(r.stderr)?.[1] ?? NaN);
  });
}

// pixels da imagem na orientacao original (o atlas guarda girada 90, 180 ou 270)
async function recortar(pagina: Sharp, im: any): Promise<Buffer> {
  const [x, y, rw, rh] = im.ret;
  const g = im.girada ?? 0;
  const [w, h] = g === 90 || g === 270 ? [rh, rw] : [rw, rh];
  let img = pagina.clone().extract({ left: x, top: y, width: w, height: h });
  if (g) img = sharp(await img.png().toBuffer()).rotate(g === 90 ? 90 : g === 180 ? 180 : 270);
  return img.png().toBuffer();
}

function desmultiplicar(raw: Buffer) {
  for (let i = 0; i < raw.length; i += 4) {
    const a = raw[i + 3];
    if (a === 0) raw[i] = raw[i + 1] = raw[i + 2] = 0;
    else if (a < 255) for (let c = 0; c < 3; c++) raw[i + c] = Math.min(255, Math.round((raw[i + c] * 255) / a));
  }
}

const feitos = new Map<string, string>();
async function leve(arq: string, saida: string): Promise<string> {
  if (feitos.has(arq)) return feitos.get(arq)!;
  feitos.set(arq, saida);
  const b = lerBonecoArquivo(arq);
  const pasta = dirname(arq);
  const pastaSaida = dirname(saida);
  const base = basename(saida, ".boneco");
  const paginas: any[] = b.paginas ?? [];
  const abertas = new Map<string, Sharp>();
  const abre = (rel: string) => {
    if (!abertas.has(rel)) abertas.set(rel, sharp(join(pasta, rel)).ensureAlpha());
    return abertas.get(rel)!;
  };
  // grupos de paginas que podem dividir a mesma textura
  const chave = (p: any) => JSON.stringify([!!p.pma, p.filtro ?? null, p.jogo ?? null, !!p.relevo]);
  const grupos = new Map<string, number[]>();
  paginas.forEach((p, i) => grupos.set(chave(p), [...(grupos.get(chave(p)) ?? []), i]));
  const novas: any[] = [];
  const imagens = b.imagens.map((im: any) => ({ ...im }));
  let gi = 0;
  for (const idx of grupos.values()) {
    const p0 = paginas[idx[0]];
    const doGrupo = imagens.map((im: any, k: number) => ({ im, k })).filter(({ im }: any) => idx.includes(im.pagina ?? 0));
    if (!doGrupo.length) continue;
    const entrada: { name: string; data: Buffer }[] = [];
    const relevos = new Map<string, Buffer>();
    for (const { im, k } of doGrupo) {
      const pg = paginas[im.pagina ?? 0];
      const [rw, rh] = [im.ret[2], im.ret[3]];
      const tam = { width: Math.max(1, Math.round(rw * fator)), height: Math.max(1, Math.round(rh * fator)), fit: "fill" as const, kernel: "lanczos3" as const };
      let png = await recortar(abre(pg.arquivo), im);
      if (pg.pma) {
        const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        desmultiplicar(raw.data);
        png = await sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } }).png().toBuffer();
      }
      entrada.push({ name: `i${k}`, data: fator === 1 ? png : await sharp(png).resize(tam).png().toBuffer() });
      if (pg.relevo) {
        const r = await recortar(abre(pg.relevo), im);
        relevos.set(`i${k}`, fator === 1 ? r : await sharp(r).resize(tam).png().toBuffer());
      }
    }
    const nome = `${base}${gi ? `_g${gi + 1}` : ""}`;
    const pac = await packAtlas(entrada, { maxSize: lado, padding: 2, pma: !!p0.pma, format: "webp", pageName: nome });
    const at = parseAtlas(pac.atlas);
    const primeira = novas.length;
    for (const [j, pa] of at.pages.entries()) {
      writeFileSync(join(pastaSaida, pa.name), pac.pages[j].data);
      const { arquivo: _a, tamanho: _t, relevo: _r, ...props } = p0;
      const nova: any = { arquivo: pa.name, tamanho: [pa.width * n, pa.height * n], ...props };
      if (p0.relevo) {
        // o relevo na mesma arrumacao, sem sangria (so a cor da normal importa)
        const camadas = at.regions.filter((r) => r.page === pa.name).map((r) => ({ input: relevos.get(r.name)!, left: r.x, top: r.y }));
        const arqRelevo = pa.name.replace(/\.webp$/, "_relevo.webp");
        await sharp({ create: { width: pa.width, height: pa.height, channels: 4, background: { r: 128, g: 128, b: 255, alpha: 1 } } })
          .composite(camadas)
          .webp({ lossless: true })
          .toFile(join(pastaSaida, arqRelevo));
        nova.relevo = arqRelevo;
      }
      novas.push(nova);
    }
    for (const r of at.regions) {
      const im = imagens[Number(r.name.slice(1))];
      im.pagina = primeira + at.pages.findIndex((pa) => pa.name === r.page);
      im.ret = [r.x * n, r.y * n, im.ret[2], im.ret[3]];
      delete im.girada;
    }
    gi++;
  }
  const out = { ...b, paginas: novas, imagens };
  // instancias: o filho leve ao lado do filho
  for (const ins of out.instancias ?? []) {
    if (typeof ins.boneco !== "string") continue;
    const filho = resolve(pasta, ins.boneco);
    if (!existsSync(filho)) continue;
    const filhoLeve = await leve(filho, filho.replace(/\.boneco$/, "-leve.boneco"));
    ins.boneco = relative(pastaSaida, filhoLeve);
  }
  gravarBonecoArquivo(saida, out, arquivoBinario(arq));
  const pix = (ps: any[], dir: string, f: number) =>
    ps.reduce((s, p) => s + (existsSync(join(dir, p.arquivo)) ? 1 : 0) * Math.round(p.tamanho[0] * f) * Math.round(p.tamanho[1] * f), 0);
  const antes = lotes(arq),
    depois = lotes(saida);
  const soma = (l: number[]) => (l.length ? `${l.reduce((a, x) => a + x, 0)} lotes em ${l.length} animacoes` : "sem animacoes");
  console.log(
    `${relative(process.cwd(), saida)}: ${paginas.length} -> ${novas.length} paginas, ${(pix(paginas, pasta, 1) / 1e6).toFixed(2)} -> ${(pix(novas, pastaSaida, fator) / 1e6).toFixed(2)} Mpx; ${soma(antes)} -> ${soma(depois)}; ${(statSync(arq).size / 1024).toFixed(0)} KB -> ${(statSync(saida).size / 1024).toFixed(0)} KB no .boneco`,
  );
  return saida;
}

const arq = resolve(args[0]);
await leve(arq, resolve(saidaOpt || arq.replace(/\.boneco$/, "-leve.boneco")));
