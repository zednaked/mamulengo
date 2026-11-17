// A folha que cresce (a pincelada, o laco ou o balde passaram da borda): quanto ela cresce de cada
// lado. Sem o editor, para os testes (tests/features.ts) e para src/app/retoque.ts e pintura.ts.

// o tamanho maximo de uma folha que cresce: o pintor devolve a imagem ate 2048 de lado,
// com a margem que deixa a pincelada passar da borda
export const FOLHA_MAX = 2048;
// quanto a folha precisa crescer para caber a caixa [x0, y0, x1, y1] (com folga), ou null
export function crescimento(w: number, h: number, c: [number, number, number, number], folga: number | [number, number] = 24): [l: number, t: number, r: number, b: number] | null {
  const [fx, fy] = typeof folga === "number" ? [folga, folga] : folga;
  let l = c[0] < 0 ? Math.ceil(-c[0] + fx) : 0,
    t = c[1] < 0 ? Math.ceil(-c[1] + fy) : 0,
    r = c[2] > w ? Math.ceil(c[2] - w + fx) : 0,
    b = c[3] > h ? Math.ceil(c[3] - h + fy) : 0;
  if (!l && !t && !r && !b) return null;
  // nao passa do maximo: corta o que sobra igualmente dos dois lados
  const sobraX = w + l + r - FOLHA_MAX,
    sobraY = h + t + b - FOLHA_MAX;
  if (sobraX > 0) (l = Math.max(0, l - Math.ceil(sobraX / 2))), (r = Math.max(0, FOLHA_MAX - w - l));
  if (sobraY > 0) (t = Math.max(0, t - Math.ceil(sobraY / 2))), (b = Math.max(0, FOLHA_MAX - h - t));
  return l || t || r || b ? [l, t, r, b] : null;
}

// a folga da pincelada que passa da borda (N-032): um quarto do lado, pelo menos FOLGA_MIN. Com
// pouca folga cada traco que sai da folha a fazia crescer de novo (e cada crescida troca o arranjo
// do atlas e reabre a folha no pintor); [x, y] porque cada eixo segue o seu lado
export const FOLGA_MIN = 64;
export function folgaDaPincelada(w: number, h: number): [number, number] {
  return [Math.max(FOLGA_MIN, Math.ceil(w / 4)), Math.max(FOLGA_MIN, Math.ceil(h / 4))];
}
