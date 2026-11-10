// Mostra qualquer tela (.boneco com o bloco tela) na janela inteira: a importada de um PSD
// (docs/LAYOUT-PSD.md), sem codigo de jogo. ?boneco=<url do .boneco> (padrao: exemplos/coelho/psd, a tela
// importada de tests/assets/psd/tela.psd), ?estado=<animacao> toca um estado em laco, ?botao=jogar:apertado mostra o estado de um botao,
// ?idioma=pt|en|..., ?quadro=N para em N segundos (as capturas, tools/tela-capturas.ts).
//
//   npm run dev   e abra /exemplos/coelho/ver/?boneco=/caminho/servido/tela.boneco
import { Desenhista, carregarNucleo } from "../../../src/render/desenhista.ts";
import { TelaBoneco } from "../../../src/tela/tela-boneco.ts";

const canvas = document.getElementById("tela") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2", { stencil: true, premultipliedAlpha: true, alpha: false, antialias: true, preserveDrawingBuffer: true })!;
const busca = new URLSearchParams(location.search);
const N = await carregarNucleo();
const desenhista = new Desenhista(gl);
const tela = await TelaBoneco.abrir(gl, N, desenhista, busca.get("boneco") ?? "../psd/tela.boneco");
if (busca.get("estado")) tela.tocar(busca.get("estado")!, true);
// ?botao=jogar:apertado mostra um estado de um botao (o nucleo toca o estado na trilha do botao)
for (const b of busca.getAll("botao")) {
  const [nome, estado] = b.split(":");
  tela.botao(nome).mostrar(estado as any);
}
tela.idioma = busca.get("idioma") ?? "pt";
tela.ligarPonteiro(canvas);

const parar = Number(busca.get("quadro") ?? NaN);
let antes = performance.now();
let relogio = 0;
function quadro(agora: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr),
    h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h);
  let dt = Math.min((agora - antes) / 1000, 0.1);
  antes = agora;
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
