// A cena do Mamulengo e a tela montada dela para uma janela de qualquer tamanho. A cena e a fonte da
// verdade: a arvore (com os nomes de propriedade do Godot, para ir e voltar), as medidas que o layout
// precisa (texturas, fontes, limites de bonecos) e o que o Godot nao tem - as variantes por proporcao.
import type { NoCena, Valor } from "./tscn.ts";
import { Layout, type Caixa, type Medidas } from "./layout.ts";
import { Fonte, Fontes, type TabelaFonte } from "./fonte.ts";
import { telaDaCena, type OpcoesTela } from "./para-tela.ts";
import type { DadosTela } from "../tela/tela.ts";

// uma variante: propriedades por no que valem quando a janela casa (paisagem, faixa de proporcao)
export type Variante = {
  nome: string;
  quando: { paisagem?: boolean; aspectoMin?: number; aspectoMax?: number };
  // o tamanho virtual nessa variante (a "coluna" do desktop): largura x altura de projeto
  base?: [number, number];
  props: Record<string, Record<string, Valor>>;
};
export type CenaMamulengo = {
  versao: 1;
  base: [number, number]; // o tamanho de projeto (o Godot estica com canvas_items/expand a partir dele)
  raiz: NoCena;
  medidas: {
    texturas: Record<string, [number, number]>;
    fontes: Record<string, TabelaFonte>; // arquivo de fonte (res://) -> medidas
    fontesDe: Record<string, string[]>; // .tres/.ttf -> arquivos na ordem de reserva
    fontePadrao: string;
    limites: Record<string, [number, number, number, number]>; // .boneco -> retangulo do esqueleto
  };
  arquivos: Record<string, string>; // res:// -> caminho relativo a cena
  chaves: string[];
  variantes?: Variante[];
};
export type Ajustes = {
  // o que o codigo do jogo faz no layout antes do primeiro quadro (recebe a arvore ja copiada)
  ajustar?: (raiz: NoCena, calcular: () => Map<string, Caixa>, medidas: Medidas & { limites: (res: string) => [number, number, number, number] | undefined }) => void;
  // estados de layout do jogo (outro modo de jogo, um painel aberto): mudam a arvore; a tela os interpola
  estados?: Record<string, (raiz: NoCena, caixas: Map<string, Caixa>) => void>;
  traduzir?: (texto: string) => string;
  // o que o jogo refaz quando um no muda de tamanho num estado (o resized do Godot: bonecos que cabem
  // na area): recebe a arvore do estado e o layout dela; o layout e calculado de novo depois
  aoRedimensionar?: (raiz: NoCena, caixas: Map<string, Caixa>) => void;
};

// a janela em unidades de projeto (expand: o lado que sobra cresce) e a variante que vale
export function tamanhoVirtual(cena: CenaMamulengo, w: number, h: number): { tam: [number, number]; variante?: Variante } {
  const r = w / Math.max(h, 1);
  const variante = cena.variantes?.find((v) => {
    const q = v.quando;
    if (q.paisagem !== undefined && q.paisagem !== w > h) return false;
    if (q.aspectoMin !== undefined && r < q.aspectoMin) return false;
    if (q.aspectoMax !== undefined && r > q.aspectoMax) return false;
    return true;
  });
  const [bw, bh] = variante?.base ?? cena.base;
  // a base fixa da variante nao estica (a tela centra e o fundo cobre o resto); senao, o expand do Godot
  if (variante?.base) return { tam: [bw, bh], variante };
  return { tam: r < bw / bh ? [bw, Math.round((bw / r) * 1000) / 1000] : [Math.round(bh * r * 1000) / 1000, bh], variante };
}

const copia = (n: NoCena): NoCena => ({ ...n, props: { ...n.props }, filhos: n.filhos.map(copia) });
const acharNo = (raiz: NoCena, c: string): NoCena | undefined => {
  let no: NoCena | undefined = raiz;
  for (const parte of c.split("/")) no = no?.filhos.find((f) => f.nome === parte);
  return no;
};

export function montarTela(cena: CenaMamulengo, w: number, h: number, a: Ajustes = {}): DadosTela & { variante?: string } {
  const { tam, variante } = tamanhoVirtual(cena, w, h);
  const m = cena.medidas;
  const metricas = new Map<string, Fontes>();
  const fontesDe = (r: string) => m.fontesDe[r || m.fontePadrao] ?? [r || m.fontePadrao];
  const medir = (f: string) => {
    let x = metricas.get(f);
    if (!x) metricas.set(f, (x = new Fontes(fontesDe(f).map((arq) => Fonte.deTabela(m.fontes[arq])))));
    return x;
  };
  const chaves = new Set(cena.chaves);
  const opcoes: OpcoesTela & { limites: (r: string) => [number, number, number, number] | undefined } = {
    textura: (r) => m.texturas[r],
    fontePadrao: m.fontePadrao,
    texto: (f, corpo, t) => {
      const fs = medir(f || m.fontePadrao);
      return [fs.largura(t, corpo), fs.altura(corpo)];
    },
    traduzir: a.traduzir,
    arquivo: (r) => cena.arquivos[r] ?? r,
    fontesDe,
    chaves,
    limites: (r) => m.limites[r],
  };
  // a arvore desta janela: a variante por cima, os ajustes do jogo, o layout
  const raiz = copia(cena.raiz);
  for (const [c, props] of Object.entries(variante?.props ?? {})) {
    const no = acharNo(raiz, c);
    if (no) Object.assign(no.props, props);
  }
  const layout = new Layout(raiz, opcoes);
  a.ajustar?.(raiz, () => layout.calcular(tam[0], tam[1]), opcoes);
  const caixas = new Map(layout.calcular(tam[0], tam[1]));
  const tela = telaDaCena(raiz, caixas, tam, opcoes) as DadosTela & { variante?: string };
  tela.variante = variante?.nome;
  // os estados: a mesma arvore mudada, o layout de novo, e so o que mudou
  const estados: NonNullable<DadosTela["estados"]> = {};
  for (const [nome, mudar] of Object.entries(a.estados ?? {})) {
    const r2 = copia(raiz);
    mudar(r2, caixas);
    const l2 = new Layout(r2, opcoes);
    let c2 = new Map(l2.calcular(tam[0], tam[1]));
    if (a.aoRedimensionar) {
      a.aoRedimensionar(r2, c2);
      c2 = new Map(l2.calcular(tam[0], tam[1]));
    }
    const t2 = telaDaCena(r2, c2, tam, opcoes);
    estados[nome] = diferenca(tela, t2);
  }
  if (Object.keys(estados).length) tela.estados = estados;
  return tela;
}

// o que muda entre duas telas da mesma arvore (os elementos tem a mesma ordem)
function diferenca(a: DadosTela, b: DadosTela): NonNullable<DadosTela["estados"]>[string] {
  const dif = (x: number[] | undefined, y: number[] | undefined) => !!x && !!y && (x.length !== y.length || x.some((v, i) => Math.abs(v - y[i]) > 0.01));
  const out: NonNullable<DadosTela["estados"]>[string] = { elementos: {}, nos: {} };
  a.elementos.forEach((e, i) => {
    const f = b.elementos[i] as Record<string, any>;
    if (!f || f.nome !== e.nome) return;
    const ee = e as Record<string, any>;
    const m: Record<string, number[]> = {};
    for (const c of ["xf", "ret", "dst", "src"]) if (dif(ee[c], f[c])) m[c] = f[c];
    if (Object.keys(m).length) out.elementos[i] = m;
  });
  for (const [n, x] of Object.entries(a.nos ?? {})) {
    const y = b.nos?.[n];
    if (!y) continue;
    const m: Record<string, any> = {};
    if (dif(x.xf, y.xf)) m.xf = y.xf;
    if (dif(x.tam, y.tam)) m.tam = y.tam;
    if (!!x.oculto !== !!y.oculto) m.oculto = !!y.oculto;
    if (Object.keys(m).length) out.nos[n] = m;
  }
  return out;
}
