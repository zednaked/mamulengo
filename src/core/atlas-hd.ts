// Arte HD, a parte comum a tools/atlas-hd.ts (rsvg-convert e magick) e ao editor pelo navegador
// (src/navegador/atlas-hd-pagina.ts, o canvas): quais objetos do SVG desenham cada imagem do
// .boneco, os retangulos na pagina nova e a troca da pagina no .boneco. Rasterizar fica com quem
// chama.

// um pedaco da pagina nova: do vetor (ids) ou da pagina original ampliada (ids vazio)
export interface ParteHd {
  nome: string;
  // onde entra na pagina nova (o retangulo do atlas vezes o fator)
  ret: [number, number, number, number];
  // os objetos do SVG que desenham a imagem, na ordem do arquivo; vazio = vem da pagina original
  ids: string[];
  // da pagina original: o recorte (largura e altura como na pagina, girada ou nao) e o tamanho ampliado
  recorte: [number, number, number, number];
  ampliada: [number, number];
}

export interface PlanoHd {
  pagina: number;
  // o arquivo da pagina original (relativo ao .boneco) e o tamanho da pagina nova
  arquivo: string;
  tamanho: [number, number];
  partes: ParteHd[];
}

// os ids do SVG, na ordem do arquivo
export const idsDoSvg = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

// os ids que casam com o modelo ({nome} vira o nome da imagem, * casa qualquer trecho), sem repetir
export function idsDaImagem(ids: string[], modelo: string, nome: string): string[] {
  const re = new RegExp("^" + esc(modelo.replace("{nome}", nome)).replace(/\*/g, ".*") + "$");
  return [...new Set(ids.filter((i) => re.test(i)))];
}

export function planoAtlasHd(b: any, svg: string, o: { fator: number; modelo: string; pagina: number }): PlanoHd {
  const { fator, modelo, pagina } = o;
  const pag = b.paginas?.[pagina];
  if (!pag) throw new Error(`o .boneco nao tem a pagina ${pagina}`);
  const ids = idsDoSvg(svg);
  const partes: ParteHd[] = [];
  for (const im of b.imagens.filter((im: any) => (im.pagina ?? 0) === pagina)) {
    const ret = im.ret.map((v: number) => Math.round(v * fator)) as ParteHd["ret"];
    const casam = idsDaImagem(ids, modelo, im.nome);
    const [ox, oy, ow, oh] = im.ret;
    const [rw, rh] = im.girada ? [oh, ow] : [ow, oh];
    partes.push({
      nome: im.nome,
      ret,
      // girada ou cortada no atlas: a pagina original ampliada (o vetor nao sabe do corte nem do giro)
      ids: casam.length && !im.girada && !im.corte ? casam : [],
      recorte: [ox, oy, rw, rh],
      ampliada: [Math.round(rw * fator), Math.round(rh * fator)],
    });
  }
  return { pagina, arquivo: pag.arquivo, tamanho: pag.tamanho.map((v: number) => Math.round(v * fator)) as [number, number], partes };
}

// o SVG que desenha so os objetos de uma imagem: um grupo novo (__parte_hd) no fim do documento,
// com um <use> por objeto (o transform dos grupos que contem o objeto nao entra)
export const ID_PARTE = "__parte_hd";
export function svgDaParte(svg: string, ids: string[], id = ID_PARTE): string {
  const fim = svg.lastIndexOf("</svg>");
  return svg.slice(0, fim) + `<g id="${id}">${ids.map((i) => `<use xlink:href="#${i}" href="#${i}"/>`).join("")}</g>` + svg.slice(fim);
}

// o nome da pagina nova ao lado da original: <pagina>-hd.<ext>
export const arquivoHd = (arquivo: string, ext = "webp") => arquivo.replace(/\.[^.]+$/, "") + `-hd.${ext}`;

// a linha do resumo (a mesma da ferramenta)
export function resumoHd(saida: string, plano: PlanoHd): string {
  const daPagina = plano.partes.filter((p) => !p.ids.length).map((p) => p.nome);
  const doVetor = plano.partes.length - daPagina.length;
  const [lg, al] = plano.tamanho;
  return `${saida}: ${lg}x${al}, ${doVetor} imagens do vetor, ${daPagina.length} da pagina original${daPagina.length ? ` (${daPagina.join(", ")})` : ""}`;
}

// troca a pagina no .boneco (arquivo, tamanho e retangulos vezes o fator) e multiplica as medidas de
// efeito em pixels da textura, no setup dos slots e nas chaves. Muda o b; devolve o aviso, se houver
const MEDIDAS: Record<string, string> = { linha: "largura", brilho: "raio", dissolver: "grao" };
export function gravarHd(b: any, pagina: number, fator: number, arquivo: string): string | null {
  const pag = b.paginas[pagina];
  b.paginas[pagina] = { ...pag, arquivo, tamanho: pag.tamanho.map((v: number) => Math.round(v * fator)) };
  for (const im of b.imagens) if ((im.pagina ?? 0) === pagina) im.ret = im.ret.map((v: number) => Math.round(v * fator));
  const multiplica = (ef: string, o: any) => {
    const c = MEDIDAS[ef];
    if (c && typeof o?.[c] === "number") o[c] *= fator;
  };
  for (const s of b.slots ?? []) for (const [ef, o] of Object.entries<any>(s.efeitos ?? {})) multiplica(ef, o);
  for (const a of Object.values<any>(b.animacoes ?? {}))
    for (const efs of Object.values<any>(a.efeitos ?? {})) for (const [ef, ks] of Object.entries<any[]>(efs)) ks.forEach((k) => multiplica(ef, k));
  return b.paginas.length > 1 ? "aviso: medidas de efeito multiplicadas em todos os slots, mas so a pagina " + pagina + " mudou" : null;
}
