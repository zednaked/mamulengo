// O PSD no editor pelo navegador: a importacao comum (src/core/psd-importar.ts) com arquivo e
// imagem do navegador. Arquivos nas pastas de fs.ts; imagens em PNG sem perda (png.ts); paginas do
// atlas em PNG (o navegador nao grava WebP sem perda); o canvas so para mudar o tamanho ([scale]) e
// para ler uma pagina antiga em WebP.
import { empacotarBruto, regiaoBruta } from "../core/atlas-pack.ts";
import { parseAtlas } from "../core/atlas-text.ts";
import type { Bruto, PsdIO } from "../core/psd-importar.ts";
import type { Raster } from "../core/psd-ler.ts";
import * as fs from "./fs.ts";
import { codificarPng } from "./png.ts";
import { bytes, decodificar, escalar } from "./imagens.ts";

import { IMAGEM } from "./imagens.ts";

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
