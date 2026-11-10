// A tela do coelho sozinha, sem o jogo (o jogo esta em jogo/): o menu, para ver as ancoras em cada
// tamanho de janela e as capturas (docs/NUCLEO.md "Tela"), com o runtime web (src/tela/tela-boneco.ts).
// Com a janela mais larga que alta o painel das missoes entra no meio da direita ("desktop"); em pe,
// mais alto e menor ("retrato"). O JOGAR e a pausa sao botoes (docs/NUCLEO.md "Papeis"): o mouse e o
// dedo trocam os estados deles, e o toque no JOGAR soma 50 no placar (o jogo acha pelo nome do papel).
// Os textos sao texto de verdade (docs/NUCLEO.md "Texto"): ?idioma=en|ar|hi|... troca todos, o
// placar muda pelo nome da parte (tela.texto("pontos", ...)) e a primeira missao recebe o {n}.
//
//   npm run dev   e abra /exemplos/coelho/   (?quadro=N para em N segundos: as capturas; ?idioma=ar)
import { Desenhista, carregarNucleo } from "../../src/render/desenhista.ts";
import { TelaBoneco } from "../../src/tela/tela-boneco.ts";

const canvas = document.getElementById("tela") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2", { stencil: true, premultipliedAlpha: true, alpha: false, antialias: true, preserveDrawingBuffer: true })!;
const N = await carregarNucleo();
const desenhista = new Desenhista(gl);
const tela = await TelaBoneco.abrir(gl, N, desenhista, new URL("./coelho-jogo.boneco", import.meta.url).href);
tela.tocar("parado", true);
tela.tocar("coelho/respira", true, 2);
const busca = new URLSearchParams(location.search);
tela.idioma = busca.get("idioma") ?? "pt";
tela.texto("m1_texto", { n: 3 });
// o placar e o texto do codigo "placar" (a cada toque no JOGAR, mais 50)
let pontos = 0;
tela.texto("placar", pontos.toLocaleString(tela.idioma));
tela.ligarPonteiro(canvas);
tela.botao("jogar").aoTocar(() => tela.texto("placar", (pontos += 50).toLocaleString(tela.idioma)));

const parar = Number(busca.get("quadro") ?? NaN);
let deitada: boolean | null = null;
let antes = performance.now();
let relogio = 0;
function quadro(agora: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr),
    h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h);
  // o estado pela proporcao da janela
  if (deitada !== w > h) {
    tela.tocar(w > h ? "desktop" : "retrato", false, 1, deitada === null ? 0 : 0.25);
    deitada = w > h;
  }
  let dt = Math.min((agora - antes) / 1000, 0.1);
  antes = agora;
  // para as capturas: o relogio anda ate o instante pedido e para
  if (Number.isFinite(parar)) dt = Math.max(0, Math.min(dt, parar - relogio));
  relogio += dt;
  tela.avancar(dt);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.06, 0.07, 0.11, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  tela.desenhar(w, h);
  (window as any).pronto = Number.isFinite(parar) ? relogio >= parar : true;
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);

(window as any).tela = tela;
