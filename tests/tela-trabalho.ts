// O trabalho que a tela evita, numa cena sintetica (uma lista de linhas com caixa e texto), sem WebGL nem navegador:
// - os setters (mostrar, cor, recortar, colocar, transformar, deslocar, z) com o mesmo valor de antes nao sujam a
//   arvore, e o estado que a tela guarda (cor final, movimento, recorte, ordem) e sempre o de um recalculo do zero;
// - textos e caixas com o mesmo desenho dividem o pedaco do atlas: trocar o conteudo de uma linha por um que ja esta
//   no atlas nao desenha nem sobe nada; aparencia diferente, idioma novo e atlas cheio desenham de novo.
//   npx tsx tests/tela-trabalho.ts
import { Tela, type DadosTela, type ElementoTela } from "../src/tela/tela.ts";

let falhas = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FALHA"} ${msg}`);
  if (!ok) falhas++;
};

// o GL e o Canvas 2D de mentira: so contam o que sobe para o atlas
let subidas = 0;
const gl = new Proxy({} as Record<string, unknown>, {
  get: (_, k) => (k === "getShaderParameter" ? () => true : k === "texSubImage2D" ? () => void subidas++ : typeof k === "string" && /^[A-Z_0-9]+$/.test(k) ? 1 : () => 1),
}) as unknown as WebGL2RenderingContext;
const ctx = new Proxy({} as Record<string, unknown>, {
  get: (_, k) => (k === "measureText" ? (t: string) => ({ width: t.length * 10, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 4 }) : () => {}),
  set: () => true,
});
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const LINHAS = 6;
function cena(): DadosTela {
  const elementos: ElementoTela[] = [];
  const nos: DadosTela["nos"] = { Lista: { xf: [1, 0, 0, 1, 0, 0], tam: [400, 600] } };
  for (let i = 0; i < LINHAS; i++) {
    const l = `Lista/L${i}`;
    nos[l] = { xf: [1, 0, 0, 1, 0, i * 100], tam: [400, 90] };
    elementos.push({ tipo: "caixa", nome: `${l}/Fundo`, xf: [1, 0, 0, 1, 0, i * 100], ret: [0, 0, 400, 90], estilo: { tipo: "StyleBoxFlat", cor: "f4f6fbff", cantos: [8, 8, 8, 8] } });
    elementos.push({ tipo: "texto", nome: `${l}/N`, xf: [1, 0, 0, 1, 20, i * 100 + 20], ret: [0, 0, 120, 40], texto: String(i + 1), fontes: ["Sans"], tamanho: 28, cor_fonte: "1d2133ff" });
  }
  return { versao: 1, tamanho: [400, 600], fontes: {}, imagens: {}, nos, elementos };
}
const nova = () => new Tela(gl, {}, {} as any, cena(), "");
const sujo = (t: Tela) => (t as any).sujo as boolean;
const limpo = (t: Tela) => void t.xfDe(t.elementos[0]); // o xfDe recalcula o que estiver sujo

// ---- os setters
{
  const t = nova(), no = "Lista/L2";
  const casos: [string, () => void][] = [
    ["mostrar", () => t.mostrar(no, false)],
    ["cor", () => t.cor(no, "ffffff80")],
    ["cor em numeros", () => t.cor(no, [1, 0.5, 0.5, 1])],
    ["recortar", () => t.recortar(no, [0, 0, 400, 300])],
    ["transformar", () => t.transformar(no, [1, 0, 0, 1, 5, 6])],
    ["deslocar", () => t.deslocar(no, 7, 8)],
    ["colocar", () => t.colocar(no, [10, 220], [1.1, 1.1], [200, 45])],
    ["z", () => t.z(no, 3)],
  ];
  for (const [nome, f] of casos) {
    limpo(t);
    f();
    check(sujo(t), `${nome} com valor novo suja a arvore`);
    limpo(t);
    f();
    check(!sujo(t), `${nome} com o mesmo valor nao suja`);
  }
  limpo(t);
  t.mostrar("Lista/Nada", true);
  check(!sujo(t), "mostrar um no que nao existe (visivel) nao suja");
  t.mostrar("Lista/Nada", false);
  check(sujo(t), "esconder um no que nao existe suja (e cria o no)");
}

// ---- o estado guardado e o de um recalculo do zero, depois de muitos setters ao acaso (repetidos ou nao)
{
  const t = nova();
  let semente = 3;
  const rnd = (n: number) => ((semente = (semente * 1103515245 + 12345) % 2147483648) % n);
  const estado = (x: Tela) => {
    const p = x as any;
    return JSON.stringify(x.elementos.map((e) => [e.nome, p.efeito.get(e) ?? null, p.moverDe.get(e) ?? null, p.recorteDe.get(e) ?? null, p.ordem.indexOf(e)]));
  };
  let iguais = true;
  for (let passo = 0; passo < 3000; passo++) {
    const no = `Lista/L${rnd(LINHAS)}`, v = rnd(3);
    [
      () => t.mostrar(no, v > 0),
      () => t.cor(no, ["ffffffff", "ffffff80", "ff0000ff"][v]),
      () => t.recortar(no, v ? [0, 0, 400, 100 * v] : null),
      () => t.transformar(no, v ? [1, 0, 0, 1, v, 0] : null),
      () => t.deslocar(no, 0, v * 4),
      () => t.colocar(no, [v * 3, 100 * rnd(LINHAS)]),
      () => t.z(no, v),
    ][rnd(7)]();
    if (passo % 7 === 0) {
      limpo(t);
      const incremental = estado(t);
      (t as any).sujo = true;
      limpo(t);
      if (estado(t) !== incremental) iguais = false;
    }
  }
  check(iguais, "3000 setters ao acaso: o estado guardado e sempre o do recalculo do zero");
}

// ---- o atlas por conteudo
{
  const t = nova();
  subidas = 0;
  t.desenhar(400, 600);
  check(subidas === 1 + LINHAS, `as ${LINHAS} caixas iguais sao um desenho so, e cada numero o seu (${subidas} subidas)`);
  subidas = 0;
  t.desenhar(400, 600);
  check(subidas === 0, "o quadro seguinte nao sobe nada");
  // a lista rolou: cada linha mostra o numero da de baixo (todos ja estao no atlas, menos o novo da ultima)
  for (let i = 0; i < LINHAS; i++) t.texto(`Lista/L${i}/N`, String(i + 2));
  subidas = 0;
  t.desenhar(400, 600);
  check(subidas === 1, `rolar uma linha so desenha o numero que entrou (${subidas} subidas)`);
  // aparencia diferente: outra cor no mesmo texto e outro desenho
  (t.elemento("Lista/L0/N") as Extract<ElementoTela, { tipo: "texto" }>).cor_fonte = "ffffffff";
  t.refazer("Lista/L0/N");
  subidas = 0;
  t.desenhar(400, 600);
  check(subidas === 1, "a cor nova desenha de novo");
  // o idioma novo recomeca o atlas (a direcao e as fontes mudam)
  t.lingua = "ar";
  subidas = 0;
  t.desenhar(400, 600);
  check(subidas === 1 + LINHAS, `idioma novo: tudo de novo, ainda dividindo o que e igual (${subidas} subidas)`);
}

if (falhas) {
  console.log(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\ntudo certo");
