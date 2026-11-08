// Imagens no editor pelo navegador (pagina e service worker): ler os bytes de um arquivo das
// pastas, decodificar sem perda (PNG pelo png.ts; WebP e JPEG pelo canvas), mudar o tamanho e
// gravar PNG. As ferramentas que no servidor usam o sharp (PSD, relevo, versao leve, efeitos,
// trocar imagens) usam estas.
import type { Bruto } from "../core/psd-importar.ts";
import type { Raster } from "../core/psd-ler.ts";
import * as fs from "./fs.ts";
import { codificarPng, decodificarPng } from "./png.ts";

export const IMAGEM = /\.(png|webp|jpe?g)$/i;

export async function bytes(p: string): Promise<Uint8Array | null> {
  const f = await fs.lerArquivo(p);
  return f ? new Uint8Array(await f.arrayBuffer()) : null;
}

// qualquer imagem: PNG pelo decodificador sem perda; o resto (WebP, JPEG) pelo canvas
export async function decodificar(b: Uint8Array): Promise<Bruto> {
  const png = await decodificarPng(b).catch(() => null);
  if (png) return png;
  const bm = await createImageBitmap(new Blob([b as BlobPart]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const c = new OffscreenCanvas(bm.width, bm.height);
  const g = c.getContext("2d")!;
  g.drawImage(bm, 0, 0);
  bm.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: new Uint8Array(d.data.buffer) };
}

// em outra escala (o [scale] do PSD, a versao leve): o canvas com a melhor suavizacao (o servidor
// usa lanczos)
export async function escalar(r: Raster, escala: number): Promise<Bruto> {
  return escalarPara(r, Math.max(1, Math.round(r.w * escala)), Math.max(1, Math.round(r.h * escala)));
}

// RGBA em outro tamanho (w x h)
export async function redimensionar(b: Bruto, w: number, h: number): Promise<Bruto> {
  return escalarPara({ x: 0, y: 0, w: b.width, h: b.height, d: new Uint8ClampedArray(b.data) }, w, h);
}

async function escalarPara(r: Raster, w: number, h: number): Promise<Bruto> {
  const bm = await createImageBitmap(new ImageData(new Uint8ClampedArray(r.d), r.w, r.h), { premultiplyAlpha: "none" });
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(bm, 0, 0, w, h);
  bm.close();
  const d = g.getImageData(0, 0, w, h);
  return { width: w, height: h, data: new Uint8Array(d.data.buffer) };
}

// grava RGBA como PNG sem perda
export async function gravarPng(p: string, b: Bruto) {
  await fs.gravarArquivo(p, (await codificarPng(b.data, b.width, b.height)) as BufferSource);
}

// RGBA de um arquivo das pastas (null se nao existe)
export async function lerImagem(p: string): Promise<Bruto | null> {
  const b = await bytes(p);
  return b ? decodificar(b) : null;
}
