// Versao leve de um .boneco, para aparelhos fracos (docs/ROADMAP.md "Bake"): a conta esta em
// src/core/boneco-leve.ts (a mesma do editor pelo navegador); aqui o disco, o sharp e o nucleo-pose.
//
//   npx tsx tools/boneco-leve.ts <x.boneco> [--fator 0.5] [--lado 2048] [--saida <x-leve.boneco>]
//
//   --fator  1/n (0.5, 0.25 ou 1: so repacota)
//   --lado   lado maximo da pagina gravada, em pixels do arquivo
//   --saida  padrao: <x>-leve.boneco ao lado, com as paginas <x>-leve.webp (e _2, _3...)
//
// No fim, por personagem (os filhos das instancias antes), os lotes de desenho do primeiro quadro
// de cada animacao, antes e depois.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import sharp, { type Sharp } from "sharp";
import { packAtlas } from "../server/atlas.ts";
import { ehBinario, gravarBonecoArquivo, lerBonecoArquivo } from "../server/boneco-binario.ts";
import { desmultiplicar, divisor, versaoLeve, type LeveIO } from "../src/core/boneco-leve.ts";

sharp.cache(false);
const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const fator = Number(opt("fator", "0.5"));
const lado = Number(opt("lado", "2048"));
const saidaOpt = opt("saida", "");
if (!args[0] || divisor(fator) == null) {
  console.error("uso: tools/boneco-leve.ts <x.boneco> [--fator 0.5 (1/n)] [--lado 2048] [--saida <x-leve.boneco>]");
  process.exit(2);
}

const NUCLEO = resolve(dirname(new URL(import.meta.url).pathname), "../nucleo/build/nucleo-pose");

// pixels da imagem na orientacao original (o atlas guarda girada 90, 180 ou 270)
async function recortar(pagina: Sharp, im: { ret: number[]; girada?: number }): Promise<Buffer> {
  const [x, y, rw, rh] = im.ret;
  const g = im.girada ?? 0;
  const [w, h] = g === 90 || g === 270 ? [rh, rw] : [rw, rh];
  let img = pagina.clone().extract({ left: x, top: y, width: w, height: h });
  if (g) img = sharp(await img.png().toBuffer()).rotate(g === 90 ? 90 : g === 180 ? 180 : 270);
  return img.png().toBuffer();
}

const abertas = new Map<string, Sharp>();
const abre = (p: string) => {
  if (!abertas.has(p)) abertas.set(p, sharp(p).ensureAlpha());
  return abertas.get(p)!;
};

const io: LeveIO<Buffer> = {
  async lerBoneco(p) {
    return { b: lerBonecoArquivo(p), binario: ehBinario(readFileSync(p).subarray(0, 5)) };
  },
  async gravarBoneco(p, b, binario) {
    gravarBonecoArquivo(p, b, binario);
  },
  async existe(p) {
    return existsSync(p);
  },
  async tamanho(p) {
    return statSync(p).size;
  },
  async gravar(p, dados) {
    writeFileSync(p, dados);
  },
  async recorte(arquivo, im, o) {
    let png = await recortar(abre(arquivo), im);
    if (o.pma) {
      const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      desmultiplicar(raw.data);
      png = await sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } }).png().toBuffer();
    }
    if (!o.tamanho) return png;
    return sharp(png)
      .resize({ width: o.tamanho[0], height: o.tamanho[1], fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
  },
  async empacotar(entrada, o) {
    return packAtlas(entrada, { ...o, format: "webp" });
  },
  async relevo(p, w, h, camadas) {
    await sharp({ create: { width: w, height: h, channels: 4, background: { r: 128, g: 128, b: 255, alpha: 1 } } })
      .composite(camadas.map((c) => ({ input: c.imagem, left: c.x, top: c.y })))
      .webp({ lossless: true })
      .toFile(p);
  },
  // lotes do primeiro quadro de cada animacao (o nucleo-pose escreve em stderr)
  async lotes(arq) {
    if (!existsSync(NUCLEO)) return [];
    const b = lerBonecoArquivo(arq);
    return Object.keys(b.animacoes ?? {}).map((a) => {
      const r = spawnSync(NUCLEO, [arq, a, "0", "--quadros", "1"], { encoding: "utf8", maxBuffer: 1 << 28 });
      return Number(/(\d+) lotes/.exec(r.stderr)?.[1] ?? NaN);
    });
  },
  mostrar: (p) => relative(process.cwd(), p),
};

const arq = resolve(args[0]);
for (const linha of await versaoLeve(io, arq, resolve(saidaOpt || arq.replace(/\.boneco$/, "-leve.boneco")), { fator, lado })) console.log(linha);
