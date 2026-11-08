// Arte HD no editor pelo navegador, a parte do service worker: o service worker nao decodifica SVG,
// entao quem rasteriza e a pagina (atlas-hd-pagina.ts). Aqui ficam o plano e a gravacao, com o
// mesmo nucleo da ferramenta (src/core/atlas-hd.ts):
//   POST /api/atlas-hd/plano?boneco=&fator=&id=&pagina=   corpo: o SVG (vazio = o <nome>-fonte.svg
//        que ficou ao lado da ultima vez); devolve o plano e os caminhos do SVG e da pagina original
//   POST /api/atlas-hd/gravar?boneco=&fator=&pagina=&arquivo=   corpo: a pagina nova (PNG); grava ao
//        lado do .boneco e troca a pagina nele (com copia de seguranca antes)
import { gravarHd, planoAtlasHd, resumoHd } from "../core/atlas-hd.ts";
import { copia, erro, gravarBoneco, json, lerBoneco } from "./api.ts";
import * as fs from "./fs.ts";

export async function rotaAtlasHd(rota: string, req: Request, url: URL): Promise<Response | null> {
  if ((rota !== "/api/atlas-hd/plano" && rota !== "/api/atlas-hd/gravar") || req.method !== "POST") return null;
  const p = fs.normalizar(url.searchParams.get("boneco") ?? "");
  if (!p.endsWith(".boneco")) return erro(403, `so .boneco: ${p}`);
  const fator = Number(url.searchParams.get("fator") ?? "3");
  const pagina = Number(url.searchParams.get("pagina") ?? "0");
  if (!(fator > 0)) return erro(400, `fator invalido: ${url.searchParams.get("fator")}`);
  const lido = await lerBoneco(p);
  if (!lido) return erro(404, `nao existe: ${p}`);
  const pasta = fs.pastaDe(p);

  if (rota === "/api/atlas-hd/plano") {
    // o SVG fica ao lado do .boneco, como no servidor, para refazer
    const svgPath = `${pasta}/${fs.nomeDe(p).replace(/\.boneco$/, "")}-fonte.svg`;
    const corpo = await req.blob();
    if (corpo.size) await fs.gravarArquivo(svgPath, corpo);
    const svg = await fs.lerTexto(svgPath);
    if (svg == null) return erro(400, "mande o SVG da arte");
    const plano = planoAtlasHd(lido.b, svg, { fator, modelo: url.searchParams.get("id") ?? "{nome}", pagina });
    return json({ plano, svg: svgPath, original: `${pasta}/${plano.arquivo}` });
  }

  const arquivo = fs.nomeDe(url.searchParams.get("arquivo") ?? "");
  if (!/\.png$/i.test(arquivo)) return erro(400, `a pagina nova vai em PNG: ${arquivo}`);
  const png = await req.blob();
  if (!png.size) return erro(400, "pagina vazia");
  const saida = `${pasta}/${arquivo}`;
  // o plano de novo, so para o resumo (o mesmo SVG)
  const svg = (await fs.lerTexto(`${pasta}/${fs.nomeDe(p).replace(/\.boneco$/, "")}-fonte.svg`)) ?? "";
  const linhas = [resumoHd(saida, planoAtlasHd(lido.b, svg, { fator, modelo: url.searchParams.get("id") ?? "{nome}", pagina }))];
  await fs.gravarArquivo(saida, png);
  await copia(p);
  const aviso = gravarHd(lido.b, pagina, fator, arquivo);
  if (aviso) linhas.push(aviso);
  await gravarBoneco(p, lido.b, lido.binario);
  linhas.push(`${p}: pagina ${pagina} trocada por ${arquivo}`);
  return json({ ok: true, saida: linhas });
}
