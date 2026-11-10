// O joguinho do coelho: a logica, escrita so pelo manifesto (../coelho-jogo.manifesto.json) e pela API
// da tela (src/tela/tela-boneco.ts), sem abrir o editor nem o gerador. E o caminho "tela pronta +
// manifesto -> jogo" (docs/BACKEND.md, "Papeis"): cada elemento e achado pelo nome que tem na tela.
//
// O jogo: JOGAR comeca uma rodada de 30 s. Tocar a tela (ou espaco) pula. Moedas passam flutuando,
// embaixo (pega parado) e no alto (so no pulo); a cenoura vale 5; o espinho machuca e leva 2 moedas.
// As missoes do painel marcam sozinhas. A pausa congela o jogo. No fim, o resultado, o recorde (guardado
// no navegador) e "de novo".
//
//   npm run dev   e abra /exemplos/coelho/jogo/   (?idioma=ar, ?semente=7, ?mudo)
//   ?manual: o relogio so anda por window.passo(segundos) (os testes: tools/tela-jogo-teste.ts)
import { Desenhista, carregarNucleo } from "../../../src/render/desenhista.ts";
import { TelaBoneco } from "../../../src/tela/tela-boneco.ts";

const busca = new URLSearchParams(location.search);
const canvas = document.getElementById("tela") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2", { stencil: true, premultipliedAlpha: true, alpha: false, antialias: true, preserveDrawingBuffer: true })!;
const tela = await TelaBoneco.abrir(gl, await carregarNucleo(), new Desenhista(gl), new URL("../coelho-jogo.boneco", import.meta.url).href);
tela.idioma = busca.get("idioma") ?? "pt";
tela.ligarPonteiro(canvas);

// ---- as trilhas: quem escreve a logica escolhe (o manifesto lista os estados, nao onde tocam).
// Os botoes ja estao nas deles (10, 11 e 12, pelo manifesto)
const T = { tela: 0, painel: 1, coelho: 2, brilho: 3, placar: 4, tempo: 5, aviso: 6, dica: 7, itens: 20, jogarSai: 30, missao: 31, pausa: 34, fim: 35, recorde: 36 };
const ITENS = ["moeda1", "moeda2", "moeda3", "moeda4", "moeda5", "moeda6", "cenoura", "espinho1", "espinho2"];
// o que a pausa congela: tudo do jogo; os botoes e a propria tela de pausa continuam
const DO_JOGO = [T.tela, T.coelho, T.brilho, T.placar, T.tempo, T.aviso, T.dica, ...ITENS.map((_, i) => T.itens + i)];
const DURACAO = 30;

// ---- o sorteio, com semente (a mesma semente da a mesma rodada)
let semente = Number(busca.get("semente") ?? Date.now()) >>> 0;
const sorteio = () => {
  semente = (semente + 0x6d2b79f5) >>> 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- o comeco: a tela parada (a pose ja calculada, para medir onde esta cada item)
tela.estado("parado", { loop: true, trilha: T.tela });
tela.estado("coelho/respira", { loop: true, trilha: T.coelho });
tela.avancar(0);
// cada item: o tipo pelo nome e a altura pela posicao na tela (os do alto so se pegam no pulo)
const itens = ITENS.map((nome, i) => ({
  nome,
  tipo: nome.replace(/\d+$/, ""),
  alto: tela.posicao(nome)[1] - tela.posicao("heroi")[1] > 200,
  trilha: T.itens + i,
  fase: "livre" as "livre" | "passando" | "pego",
  nasceu: -1, // quando saiu: o item reaproveitado ainda esta onde foi pego ate a pose andar
}));
const RAIO: Record<string, number> = { moeda: 70, cenoura: 80, espinho: 62 };

// ---- o estado do jogo
const jogo = {
  fase: "menu" as "menu" | "jogando" | "fim",
  pausado: false,
  tempo: 0, // segundos de rodada
  moedas: 0,
  pegas: 0, // moedas pegas (a missao 1)
  pulos: 0,
  cenoura: false,
  noAr: false,
  ferido: false,
  proximo: 0, // quando sai o proximo item
  cenouraEm: 0,
  missoes: [false, false, false],
  recorde: lerRecorde(),
  novoRecorde: false,
  mostrado: 0, // o numero do resultado contando ate as moedas
};
const numero = (n: number) => n.toLocaleString(tela.idioma);
const mostrarPlacar = () => tela.texto("placar", numero(jogo.moedas));
tela.texto("m1_texto", { n: 3 });
tela.texto("tempo", numero(DURACAO));
mostrarPlacar();

// ---- o som pelos eventos das animacoes (Kenney, CC0)
const sons: Record<string, HTMLAudioElement> = {};
if (!busca.has("mudo"))
  for (const n of ["pulo", "moeda", "cenoura", "ai", "missao", "fim"]) {
    sons[n] = new Audio(new URL(`../sons/${n}.ogg`, import.meta.url).href);
    tela.aoEvento(n, () => void (sons[n].cloneNode() as HTMLAudioElement).play().catch(() => {}));
  }

// ---- o painel das missoes: ao lado no desktop (sempre); no celular em pe, so no menu (na rodada as
// missoes avisam por cima, e no fim o resultado ocupa o meio)
let deitada: boolean | null = null;
let painel: string | null = null;
function mostrarPainel() {
  const quer = deitada ? "desktop" : jogo.fase === "menu" ? "retrato" : null;
  if (quer === painel) return;
  if (quer) tela.estado(quer, { trilha: T.painel, mix: painel ? 0.25 : 0 });
  else tela.estado(painel!, { trilha: T.painel, reverso: true });
  painel = quer;
}

// ---- comecar, pular, pegar
function comecar() {
  if (jogo.fase === "jogando" || jogo.pausado) return;
  if (jogo.fase === "menu") tela.estado("jogar/sai", { trilha: T.jogarSai });
  tela.botao("jogar").desligar();
  tela.botao("pausa").ligar();
  if (jogo.fase === "fim") {
    // o resultado sai, o recorde para de piscar, as missoes desmarcam
    tela.soltar(T.fim, 0.25);
    tela.soltar(T.recorde, 0.1);
    jogo.missoes.forEach((feita, k) => feita && tela.soltar(T.missao + k, 0.2));
  }
  Object.assign(jogo, { fase: "jogando", tempo: 0, moedas: 0, pegas: 0, pulos: 0, cenoura: false, noAr: false, ferido: false, proximo: 0.8, missoes: [false, false, false], novoRecorde: false });
  jogo.cenouraEm = 8 + sorteio() * 12;
  tela.estado("coelho/respira", { loop: true, trilha: T.coelho, mix: 0.2 });
  tela.estado("dica/mostra", { trilha: T.dica });
  tela.texto("tempo", numero(DURACAO));
  mostrarPlacar();
  mostrarPainel();
}
function pular() {
  if (jogo.fase !== "jogando" || jogo.pausado || jogo.noAr || jogo.ferido) return;
  jogo.noAr = true;
  jogo.pulos++;
  tela.estado("coelho/pula", { trilha: T.coelho, mix: 0.05, depois: "coelho/respira" });
}
tela.aoEvento("pousa", () => (jogo.noAr = false));
tela.aoTerminar("coelho/ai", () => (jogo.ferido = false));

// sai um item: o tipo pelo sorteio (a cenoura uma vez so), um livre desse tipo e dessa altura
function soltarItem() {
  let tipo = "moeda",
    alto = sorteio() < 0.5;
  if (!jogo.cenoura && jogo.tempo > jogo.cenouraEm && !itens.some((i) => i.tipo === "cenoura" && i.fase !== "livre")) (tipo = "cenoura"), (alto = true);
  else if (jogo.tempo > 3 && sorteio() < 0.22) (tipo = "espinho"), (alto = false);
  const item = itens.find((i) => i.tipo === tipo && i.alto === alto && i.fase === "livre");
  if (tipo === "cenoura" && item) jogo.cenouraEm = Infinity;
  if (!item) return;
  item.fase = "passando";
  item.nasceu = jogo.tempo;
  tela.estado(`${item.nome}/passa`, { trilha: item.trilha });
}
for (const item of itens) {
  tela.aoTerminar(`${item.nome}/passa`, () => (item.fase = "livre"));
  tela.aoTerminar(`${item.nome}/${item.tipo === "espinho" ? "bate" : "pega"}`, () => (item.fase = "livre"));
}

function pegar(item: (typeof itens)[number]) {
  item.fase = "pego";
  if (item.tipo === "espinho") {
    // machucou: o espinho quica para longe, o coelho fica ferido um instante e perde 2 moedas
    tela.estado(`${item.nome}/bate`, { trilha: item.trilha, mix: 0.05 });
    tela.estado("coelho/ai", { trilha: T.coelho, mix: 0.1, depois: "coelho/respira" });
    Object.assign(jogo, { ferido: true, noAr: false, moedas: Math.max(0, jogo.moedas - 2) });
    tela.estado("placar/perde", { trilha: T.placar });
  } else {
    tela.estado(`${item.nome}/pega`, { trilha: item.trilha, mix: 0.08 });
    tela.estado("brilho/pega", { trilha: T.brilho });
    tela.estado("placar/soma", { trilha: T.placar });
    if (item.tipo === "cenoura") (jogo.cenoura = true), (jogo.moedas += 5);
    else jogo.moedas++, jogo.pegas++;
  }
  mostrarPlacar();
}

// ---- as missoes: marcam sozinhas, com o aviso (o texto da missao, no idioma da tela)
const CUMPRIDA = [() => jogo.pegas >= 3, () => jogo.pulos >= 10, () => jogo.cenoura];
function conferirMissoes() {
  CUMPRIDA.forEach((cumprida, k) => {
    if (jogo.missoes[k] || !cumprida()) return;
    jogo.missoes[k] = true;
    tela.estado(`missao${k + 1}/feita`, { trilha: T.missao + k });
    tela.texto("aviso", tela.textoMostrado(`m${k + 1}_texto`));
    tela.estado("aviso/mostra", { trilha: T.aviso });
  });
}

// ---- o fim da rodada: o resultado, o recorde e a festa
function terminar() {
  jogo.fase = "fim";
  jogo.noAr = false;
  jogo.novoRecorde = jogo.moedas > jogo.recorde;
  jogo.recorde = Math.max(jogo.recorde, jogo.moedas);
  gravarRecorde(jogo.recorde);
  jogo.mostrado = 0;
  tela.texto("resultado", { n: numero(0) });
  tela.texto("recorde", { n: numero(jogo.recorde) });
  tela.soltar(T.tempo, 0.2);
  tela.estado("fim/entra", { trilha: T.fim });
  if (jogo.novoRecorde) tela.estado("fim/recorde", { loop: true, trilha: T.recorde });
  tela.estado("coelho/festa", { loop: true, trilha: T.coelho, mix: 0.1 });
  tela.botao("pausa").desligar();
  mostrarPainel();
}
function lerRecorde() {
  try {
    return Number(localStorage.getItem("coelho.recorde") ?? 0) || 0;
  } catch {
    return 0;
  }
}
function gravarRecorde(n: number) {
  try {
    localStorage.setItem("coelho.recorde", String(n));
  } catch {}
}

// ---- a pausa: as trilhas do jogo param (ritmo 0), PAUSA aparece e o JOGAR desliga
function pausar() {
  if (jogo.fase === "fim") return;
  jogo.pausado = !jogo.pausado;
  tela.ritmo(DO_JOGO, jogo.pausado ? 0 : 1);
  tela.estado("pausa/entra", { trilha: T.pausa, reverso: !jogo.pausado });
  if (jogo.fase === "menu") tela.botao("jogar").desligar(jogo.pausado);
}

// ---- os papeis do manifesto e o teclado
tela.botao("jogar").aoTocar(comecar);
tela.botao("denovo").aoTocar(comecar);
tela.botao("pausa").aoTocar(pausar);
tela.aoApertar("pular", pular);
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "ArrowUp") pular();
  else if (e.code === "KeyP" || e.code === "Escape") pausar();
  else if (e.code === "Enter") comecar();
  else return;
  e.preventDefault();
});

// ---- um passo do jogo (dt em segundos)
function passo(dt: number) {
  if (jogo.fase === "jogando" && !jogo.pausado) {
    const antes = jogo.tempo;
    jogo.tempo += dt;
    // os itens saem cada vez mais perto um do outro
    if (jogo.tempo >= jogo.proximo) {
      soltarItem();
      jogo.proximo = jogo.tempo + (1.25 + sorteio() * 0.7) * (1 - jogo.tempo / 120);
    }
    // so depois de um instante: no quadro em que sai, a moeda reaproveitada ainda esta no meio do coelho (onde a
    // animacao "pega" a deixou), e contava como pega do nada
    for (const item of itens) if (item.fase === "passando" && jogo.tempo - item.nasceu > 0.1 && tela.distancia("corpo", item.nome) < RAIO[item.tipo] && !(item.tipo === "espinho" && jogo.ferido)) pegar(item);
    conferirMissoes();
    const resta = Math.max(0, DURACAO - jogo.tempo);
    if (Math.ceil(resta) !== Math.ceil(DURACAO - antes)) tela.texto("tempo", numero(Math.ceil(resta)));
    if (resta <= 5 && DURACAO - antes > 5) tela.estado("tempo/urgente", { loop: true, trilha: T.tempo });
    if (resta <= 0) terminar();
  }
  // o resultado conta ate as moedas
  if (jogo.fase === "fim" && jogo.mostrado < jogo.moedas) {
    jogo.mostrado = Math.min(jogo.moedas, jogo.mostrado + dt * Math.max(12, jogo.moedas * 1.5));
    tela.texto("resultado", { n: numero(Math.floor(jogo.mostrado)) });
  }
  tela.avancar(dt);
}

// ---- o quadro: a janela, o passo e o desenho
const manual = busca.has("manual");
let antes = performance.now();
function quadro(agora: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr),
    h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h);
  if (deitada !== w > h) (deitada = w > h), mostrarPainel();
  if (!manual) passo(Math.min((agora - antes) / 1000, 0.1));
  antes = agora;
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.06, 0.07, 0.11, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  tela.desenhar(w, h);
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);

// para os testes de ponta a ponta: o estado, os itens e o relogio na mao (?manual), a 60 quadros por segundo
Object.assign(window, {
  tela,
  jogo,
  itens,
  passo: (seg: number) => {
    for (let i = 0; i < Math.round(seg * 60); i++) passo(1 / 60);
  },
});
