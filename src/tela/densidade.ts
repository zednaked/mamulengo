// Quantos texels de cada imagem caem numa unidade da tela (dados.tamanho), no pior caso entre os
// elementos que a usam e os estados de layout. Uma imagem desenhada com bem mais texels por unidade do
// que qualquer aparelho mostra (o celular tem ~1,5 px por unidade numa tela de 700 de largura) so
// gasta download, decodificacao e memoria de GPU: o empacotador a reduz (tools/reduzir-imagens.ts) e a
// tela continua usando o tamanho logico (Imagem.tam, o do arquivo original) nos recortes e nos uvs.
import type { DadosTela, ElementoTela, Xf } from "./tela.ts";

type Img = Extract<ElementoTela, { tipo: "imagem" }>;

// texels por unidade da tela de um elemento de imagem: o maior entre os dois eixos
export function densidadeDoElemento(e: Pick<Img, "xf" | "dst" | "src" | "repetir">): number {
  const [, , ww, hh] = e.dst;
  const sx = Math.hypot(e.xf[0], e.xf[1]),
    sy = Math.hypot(e.xf[2], e.xf[3]);
  // repetida: um texel (logico) por unidade local
  const su = e.repetir ? Math.abs(ww) : Math.abs(e.src[2]),
    sv = e.repetir ? Math.abs(hh) : Math.abs(e.src[3]);
  const dx = Math.abs(ww) * sx,
    dy = Math.abs(hh) * sy;
  return Math.max(dx > 1e-6 ? su / dx : 0, dy > 1e-6 ? sv / dy : 0);
}

// o pior caso de cada arquivo (o caminho de Imagem.arquivo) em varias telas (tamanhos de janela) e
// nos estados delas. Gradientes ficam de fora (sao gerados na carga).
export function densidades(telas: DadosTela[]): Map<string, number> {
  const out = new Map<string, number>();
  const ver = (dados: DadosTela, e: Img) => {
    const im = dados.imagens[e.img];
    if (!im || im.gradiente || !im.arquivo) return;
    const d = densidadeDoElemento(e);
    if (d > (out.get(im.arquivo) ?? 0)) out.set(im.arquivo, d);
  };
  for (const dados of telas) {
    dados.elementos.forEach((e) => e.tipo === "imagem" && ver(dados, e));
    for (const est of Object.values(dados.estados ?? {}))
      for (const [i, m] of Object.entries(est.elementos)) {
        const e = dados.elementos[Number(i)];
        if (e?.tipo !== "imagem") continue;
        ver(dados, { ...e, xf: (m.xf as Xf) ?? e.xf, dst: m.dst ?? e.dst, src: m.src ?? e.src });
      }
  }
  return out;
}

// o tamanho reduzido de uma imagem (w, h logicos) com densidade d para ficar em `limite` texels por
// unidade; null se nao compensa (a reducao seria menor que `minimo` da area, ex. 0.85 = 15% a menos)
export function tamanhoReduzido(tam: [number, number], d: number, limite: number, minimo = 0.85): [number, number] | null {
  if (!(d > limite)) return null;
  const f = limite / d;
  if (f * f > minimo) return null;
  return [Math.max(1, Math.ceil(tam[0] * f)), Math.max(1, Math.ceil(tam[1] * f))];
}
