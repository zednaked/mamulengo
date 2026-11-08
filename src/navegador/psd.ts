// O PSD no editor pelo navegador: a importacao comum (src/core/psd-importar.ts) com arquivo e
// imagem do navegador. Arquivos nas pastas de fs.ts; imagens em PNG sem perda (png.ts); paginas do
// atlas em PNG (o navegador nao grava WebP sem perda); o canvas so para mudar o tamanho ([scale]) e
// para ler uma pagina antiga em WebP.
import { empacotarBruto, regiaoBruta } from "../core/atlas-pack.ts";
import { parseAtlas } from "../core/atlas-text.ts";
import type { Bruto, PsdIO } from "../core/psd-importar.ts";
import type { Raster } from "../core/psd-ler.ts";
import * as fs from "./fs.ts";
import { codificarPng, decodificarPng } from "./png.ts";

const IMAGEM = /\.(png|webp|jpe?g)$/i;

async function bytes(p: string): Promise<Uint8Array | null> {
  const f = await fs.lerArquivo(p);
  return f ? new Uint8Array(await f.arrayBuffer()) : null;
}

// qualquer imagem: PNG pelo decodificador sem perda; o resto (WebP, JPEG) pelo canvas
async function decodificar(b: Uint8Array): Promise<Bruto> {
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

// a camada em outra escala ([scale] do PSD): o canvas com a melhor suavizacao (o servidor usa lanczos)
async function escalar(r: Raster, escala: number): Promise<Bruto> {
  const w = Math.max(1, Math.round(r.w * escala)),
    h = Math.max(1, Math.round(r.h * escala));
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

export function ioNavegador(o: { gravarBoneco: (arquivo: string, b: any, binario: boolean) => Promise<void>; copia: (p: string) => Promise<void> }): PsdIO {
  return {
    existe: fs.existe,
    ler: bytes,
    async gravar(p, dados) {
      await fs.gravarArquivo(p, typeof dados === "string" ? dados : (dados as BufferSource));
    },
    async imagens(dir) {
      const raiz = fs.normalizar(dir);
      const lista = await fs.percorrer(raiz, (n) => IMAGEM.test(n)).catch(() => [] as string[]);
      return lista.map((file) => ({ name: file.slice(raiz.length + 1).replace(/\.[^.]+$/, ""), file })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async bruto(p) {
      const b = await bytes(p);
      return b ? decodificar(b) : null;
    },
    async brutoDe(png) {
      return decodificar(png);
    },
    async png(r, escala) {
      if (escala === 1) return codificarPng(r.d, r.w, r.h);
      const e = await escalar(r, escala);
      return codificarPng(e.data, e.width, e.height);
    },
    async empacotar(imagens, opts) {
      const brutas = [];
      for (const im of imagens) {
        const b = await bytes(im.file);
        if (b) brutas.push({ name: im.name, ...(await decodificar(b)) });
      }
      return empacotarBruto(brutas, { ...opts, format: "png" }, (rgba, w, h) => codificarPng(rgba, w, h));
    },
    async desempacotar(atlas, texto, saida) {
      const { pages, regions } = parseAtlas(texto);
      for (const p of pages) {
        const b = await bytes(fs.pastaDe(atlas) + "/" + p.name);
        if (!b) continue;
        const pagina = await decodificar(b);
        for (const r of regions.filter((x) => x.page === p.name)) {
          const nome = r.index >= 0 ? `${r.name}_${r.index}` : r.name;
          const im = regiaoBruta(pagina, r, { unpremultiply: p.pma });
          await fs.gravarArquivo(`${saida}/${nome}.png`, (await codificarPng(im.data, im.width, im.height)) as BufferSource);
        }
      }
    },
    gravarBoneco: o.gravarBoneco,
    copia: o.copia,
  };
}
