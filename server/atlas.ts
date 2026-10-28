// Atlas do Spine (formato texto 4.x, e o antigo com campos indentados):
// ler, desempacotar em imagens soltas e empacotar imagens soltas em paginas.
import sharp, { type Sharp } from "sharp";

// o editor regrava paginas de atlas com o mesmo nome; o cache de arquivos do libvips
// devolveria a imagem antiga (tamanho errado)
sharp.cache(false);
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseAtlas, type AtlasPage, type AtlasRegion } from "../src/core/atlas-text.ts";
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

// ---- empacotamento (MaxRects, melhor lado curto; sem rotacao)

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

class MaxRects {
  free: Rect[];
  used: Rect[] = [];
  constructor(w: number, h: number) {
    this.free = [{ x: 0, y: 0, w, h }];
  }
  insert(w: number, h: number): Rect | null {
    let best: Rect | null = null;
    let bestShort = Infinity,
      bestLong = Infinity;
    for (const f of this.free) {
      if (f.w >= w && f.h >= h) {
        const s = Math.min(f.w - w, f.h - h),
          l = Math.max(f.w - w, f.h - h);
        if (s < bestShort || (s === bestShort && l < bestLong)) (best = { x: f.x, y: f.y, w, h }), (bestShort = s), (bestLong = l);
      }
    }
    if (!best) return null;
    const next: Rect[] = [];
    for (const f of this.free) {
      if (best.x >= f.x + f.w || best.x + best.w <= f.x || best.y >= f.y + f.h || best.y + best.h <= f.y) {
        next.push(f);
        continue;
      }
      if (best.x > f.x) next.push({ x: f.x, y: f.y, w: best.x - f.x, h: f.h });
      if (best.x + best.w < f.x + f.w) next.push({ x: best.x + best.w, y: f.y, w: f.x + f.w - best.x - best.w, h: f.h });
      if (best.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: best.y - f.y });
      if (best.y + best.h < f.y + f.h) next.push({ x: f.x, y: best.y + best.h, w: f.w, h: f.y + f.h - best.y - best.h });
    }
    // remove retangulos livres contidos em outros
    this.free = next.filter((a, i) => !next.some((b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (i > j || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)));
    this.used.push(best);
    return best;
  }
}

export interface PackInput {
  name: string; // nome da regiao (caminho relativo sem extensao, como no Spine)
  file?: string;
  data?: Buffer;
}

export interface PackOptions {
  maxSize?: number; // lado maximo da pagina
  padding?: number; // espaco entre regioes
  pma?: boolean; // grava premultiplicado (o spine-godot ignora: padrao false)
  format?: "webp" | "png";
  trim?: boolean; // recorta transparencia (offsets no atlas); so seguro sem malhas
  pageName?: string; // base do nome das paginas
}

// Empacota imagens soltas. Devolve o texto do .atlas e as paginas (bytes).
export async function packAtlas(images: PackInput[], opts: PackOptions = {}): Promise<{ atlas: string; pages: { name: string; data: Buffer }[]; regions: number }> {
  const maxSize = opts.maxSize ?? 2048,
    pad = opts.padding ?? 2,
    format = opts.format ?? "webp";
  // sem recorte por padrao: UVs de malha cobrem a imagem original inteira, e com a
  // transparencia recortada a malha amostraria as imagens vizinhas no atlas
  const trim = opts.trim ?? false;
  const base = opts.pageName ?? "atlas";
  // carrega, recorta transparencia
  const items = [];
  for (const im of images) {
    const { data, info } = await sharp(im.data ?? im.file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let [x0, y0, x1, y1] = [0, 0, info.width - 1, info.height - 1];
    if (trim) {
      [x0, y0, x1, y1] = [info.width, info.height, -1, -1];
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++)
          if (data[(y * info.width + x) * 4 + 3] > 0) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      if (x1 < 0) [x0, y0, x1, y1] = [0, 0, 0, 0]; // imagem vazia: 1x1
    }
    items.push({ ...im, raw: data, ow: info.width, oh: info.height, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  // maiores primeiro
  items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  // imagem maior que a pagina padrao (fundo de popup em tela cheia, por exemplo): a pagina
  // cresce ate 4096, como nos atlas que os jogos ja usam; acima disso, recusa
  const LIMITE = 4096;
  const biggest = Math.max(...items.map((it) => Math.max(it.w, it.h) + pad));
  let pageMax = maxSize;
  while (pageMax < biggest && pageMax < LIMITE) pageMax *= 2;
  for (const it of items) if (it.w + pad > pageMax || it.h + pad > pageMax) throw new Error(`${it.name} (${it.w}x${it.h}) nao cabe numa pagina de ${pageMax}; reduza a imagem (ate ${LIMITE - pad} px de lado)`);
  const pagesOut: { name: string; data: Buffer }[] = [];
  const lines: string[] = [];
  let rest = items;
  let pi = 0;
  while (rest.length) {
    // tenta a menor pagina potencia de 2 (lado a lado) que comporta tudo; senao a maxima
    let size = 64;
    let placed: { it: (typeof items)[0]; r: Rect }[] = [];
    let left: typeof items = [];
    for (;;) {
      const mr = new MaxRects(size, size);
      placed = [];
      left = [];
      for (const it of rest) {
        const r = mr.insert(it.w + pad, it.h + pad);
        r ? placed.push({ it, r }) : left.push(it);
      }
      if (!left.length || size >= pageMax) break;
      size *= 2;
    }
    // apara a pagina ao usado
    const pw = Math.max(...placed.map((p) => p.r.x + p.r.w));
    const ph = Math.max(...placed.map((p) => p.r.y + p.r.h));
    const name = `${base}${pi ? `_${pi + 1}` : ""}.${format}`;
    const canvas = Buffer.alloc(pw * ph * 4);
    for (const { it, r } of placed) {
      // copia a area recortada + sangria de 1px repetindo a borda (evita halo no filtro)
      for (let y = -1; y <= it.h; y++)
        for (let x = -1; x <= it.w; x++) {
          const tx = r.x + x,
            ty = r.y + y;
          if (tx < 0 || ty < 0 || tx >= pw || ty >= ph) continue;
          if ((x < 0 || y < 0 || x >= it.w || y >= it.h) && pad < 2) continue;
          const sx = it.x0 + Math.min(it.w - 1, Math.max(0, x)),
            sy = it.y0 + Math.min(it.h - 1, Math.max(0, y));
          const s = (sy * it.ow + sx) * 4,
            d = (ty * pw + tx) * 4;
          const edge = x < 0 || y < 0 || x >= it.w || y >= it.h;
          // na sangria: cor da borda com alpha 0 (o filtro linear nao puxa preto)
          canvas[d] = it.raw[s];
          canvas[d + 1] = it.raw[s + 1];
          canvas[d + 2] = it.raw[s + 2];
          canvas[d + 3] = edge ? 0 : it.raw[s + 3];
        }
    }
    if (opts.pma) for (let i = 0; i < canvas.length; i += 4) for (let c = 0; c < 3; c++) canvas[i + c] = Math.round((canvas[i + c] * canvas[i + 3]) / 255);
    let img = sharp(canvas, { raw: { width: pw, height: ph, channels: 4 } });
    const data = format === "webp" ? await img.webp({ lossless: true, exact: true } as any).toBuffer() : await img.png({ compressionLevel: 9 }).toBuffer();
    pagesOut.push({ name, data });
    lines.push(name, `size:${pw},${ph}`, "filter:Linear,Linear");
    if (opts.pma) lines.push("pma:true");
    for (const { it, r } of placed.sort((a, b) => a.it.name.localeCompare(b.it.name))) {
      const m = /^(.*)_(\d+)$/.exec(it.name);
      lines.push(it.name, `bounds:${r.x},${r.y},${it.w},${it.h}`);
      if (it.w !== it.ow || it.h !== it.oh) lines.push(`offsets:${it.x0},${it.oh - it.y0 - it.h},${it.ow},${it.oh}`);
      void m;
    }
    lines.push("");
    rest = left;
    pi++;
  }
  return { atlas: lines.join("\n"), pages: pagesOut, regions: items.length };
}
