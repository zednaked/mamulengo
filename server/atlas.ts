// Atlas do Spine (formato texto 4.x, e o antigo com campos indentados):
// ler, desempacotar em imagens soltas e empacotar imagens soltas em paginas.
import sharp, { type Sharp } from "sharp";

// o editor regrava paginas de atlas com o mesmo nome; o cache de arquivos do libvips
// devolveria a imagem antiga (tamanho errado)
sharp.cache(false);
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseAtlas, type AtlasPage, type AtlasRegion } from "../src/core/atlas-text.ts";
import { empacotarBruto, type PackOptions, type PackRaw } from "../src/core/atlas-pack.ts";
export type { PackOptions };
export { parseAtlas, type AtlasPage, type AtlasRegion };

// Imagem original de uma regiao (desrotacionada, com a transparencia recortada de volta).
export async function extractRegion(pageImage: Sharp, r: AtlasRegion, opts: { unpremultiply?: boolean } = {}): Promise<Buffer> {
  const rot = r.degrees === 90;
  const w = rot ? r.height : r.width;
  const h = rot ? r.width : r.height;
  let img = pageImage.clone().extract({ left: r.x, top: r.y, width: w, height: h });
  // o Spine guarda regioes "rotate:90" giradas 90 graus no sentido anti-horario
  // (conferido com texto: WIN desempacotado em pe)
  if (rot) img = sharp(await img.png().toBuffer()).rotate(90);
  let raw = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let data = raw.data;
  if (opts.unpremultiply) {
    data = Buffer.from(data);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) data[i] = data[i + 1] = data[i + 2] = 0;
      else if (a < 255) for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round((data[i + c] * 255) / a));
    }
  }
  // copia crua para a posicao original (sem composite: o libvips premultiplica e
  // arredondaria o RGB dos pixels semitransparentes)
  const top = r.originalHeight - r.offsetY - r.height;
  const W = r.originalWidth,
    H = r.originalHeight;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < raw.info.height; y++) {
    const ty = top + y;
    if (ty < 0 || ty >= H) continue;
    const x0 = Math.max(0, r.offsetX),
      x1 = Math.min(W, r.offsetX + raw.info.width);
    if (x1 > x0) data.copy(out, (ty * W + x0) * 4, (y * raw.info.width + (x0 - r.offsetX)) * 4, (y * raw.info.width + (x1 - r.offsetX)) * 4);
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

// Desempacota um atlas em PNGs soltos (alpha simples), um por regiao (com sufixo _index).
export async function unpackAtlas(atlasPath: string, atlasText: string, outDir: string): Promise<string[]> {
  const { pages, regions } = parseAtlas(atlasText);
  const out: string[] = [];
  for (const p of pages) {
    const img = sharp(join(dirname(atlasPath), p.name));
    for (const r of regions.filter((x) => x.page === p.name)) {
      const name = r.index >= 0 ? `${r.name}_${r.index}` : r.name;
      const file = join(outDir, name + ".png");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await extractRegion(img, r, { unpremultiply: p.pma }));
      out.push(file);
    }
  }
  return out;
}

// ---- empacotamento: o algoritmo esta em src/core/atlas-pack.ts; aqui o sharp le e grava

export interface PackInput {
  name: string; // nome da regiao (caminho relativo sem extensao, como no Spine)
  file?: string;
  data?: Buffer;
}

// Empacota imagens soltas. Devolve o texto do .atlas e as paginas (bytes).
export async function packAtlas(images: PackInput[], opts: PackOptions = {}): Promise<{ atlas: string; pages: { name: string; data: Buffer }[]; regions: number }> {
  const brutas: PackRaw[] = [];
  for (const im of images) {
    const { data, info } = await sharp(im.data ?? im.file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    brutas.push({ name: im.name, width: info.width, height: info.height, data });
  }
  return empacotarBruto(brutas, opts, async (rgba, w, h, format) => {
    const img = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: w, height: h, channels: 4 } });
    return format === "webp" ? await img.webp({ lossless: true, exact: true } as any).toBuffer() : await img.png({ compressionLevel: 9 }).toBuffer();
  });
}
