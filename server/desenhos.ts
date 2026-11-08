// A pagina dos desenhos fora do editor (geradores, ferramentas): as formas de `drawings` viram
// <base>-desenhos.png com o sharp (src/core/desenho-svg.ts), no mesmo arranjo que o editor usa
// (layoutDrawings), e o atlas ganha a pagina. Com isto um gerador desenha pelo sistema de desenho
// (draw.* e draw.text) e grava o .boneco pronto, sem abrir o editor.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { atlasWithDrawings, drawingPageName, layoutDrawings, type Drawing } from "../src/core/desenho.ts";
import { desenhoEmSvg } from "../src/core/desenho-svg.ts";

// grava a pagina em `dir` e devolve o atlas com ela; atlasArquivo da o nome (x.atlas -> x-desenhos.png)
export async function gravarPaginaDesenhos(drawings: Record<string, Drawing>, atlasTexto: string, atlasArquivo: string, dir: string): Promise<{ atlas: string; pagina: string | null }> {
  const pagina = drawingPageName(atlasArquivo);
  const layout = layoutDrawings(drawings);
  if (!layout) return { atlas: atlasWithDrawings(atlasTexto, pagina, null), pagina: null };
  // um desenho maior que a largura da pagina (4096) nao cabe em lugar nenhum: diz qual
  const largos = layout.regions.filter((r) => r.w > layout.width || r.x + r.w > layout.width);
  if (largos.length) throw new Error(`desenho maior que a pagina (${layout.width} px de largura): ${largos.map((r) => `${r.name} (${r.w}x${r.h}, hd ${r.hd})`).join(", ")}: baixe o hd ou divida`);
  // a placa de video nao aceita textura maior que isso: sem o aviso, nada aparece e nao ha erro
  if (layout.width > 16384 || layout.height > 16384) {
    const maiores = layout.regions.map((r) => ({ n: r.name, a: r.w * r.h, hd: r.hd })).sort((a, b) => b.a - a.a).slice(0, 5);
    throw new Error(`a pagina dos desenhos ficou com ${layout.width}x${layout.height} pixels (o limite das placas e 16384): baixe o hd dos desenhos grandes (fundo chapado aguenta 0,1; silhueta ao longe 0,5). Os maiores: ${maiores.map((m) => `${m.n} (hd ${m.hd})`).join(", ")}`);
  }
  const partes = await Promise.all(
    layout.regions.map(async (r) => ({ input: await sharp(Buffer.from(desenhoEmSvg(drawings[r.name], r.hd))).resize(r.w, r.h, { fit: "fill" }).png().toBuffer(), left: r.x, top: r.y })),
  );
  const png = await sharp({ create: { width: layout.width, height: layout.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(partes)
    .png()
    .toBuffer();
  writeFileSync(join(dir, pagina), png);
  return { atlas: atlasWithDrawings(atlasTexto, pagina, layout), pagina };
}
