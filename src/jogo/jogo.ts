// O tocador do jogo exportado (docs/PALCO.md, "Exportar"): uma pagina so, sem servidor. Tudo vem
// em window.JOGO, embutido pelo tools/exportar-jogo.ts: o nucleo (o wasm em base64), os .boneco
// (o principal e os filhos das instancias, por caminho) e as paginas do atlas (data URL). O jogo
// anda em passos fixos de 1/60 s com o teclado ou os botoes de toque; a camera acompanha o
// jogador quando a fase nao cabe na tela; R ou o botao recomeca.
import fabrica from "mamulengo-nucleo";
import { Desenhista, ortho, type PaginaGL } from "../render/desenhista.ts";

type Jogo = {
  titulo: string;
  principal: string; // caminho do .boneco principal (entre os arquivos)
  arquivos: Record<string, string>; // caminho -> texto (.boneco)
  imagens: Record<string, string>; // caminho -> data URL (paginas)
  filtros: Record<string, string>; // caminho da pagina -> "Nearest" ou "Linear"
  wasm: string; // base64
  fundo: string; // cor do fundo, hex sem #
  vista?: [number, number]; // largura e altura do mundo que cabem na tela (padrao: o esqueleto)
};
const J: Jogo = (window as any).JOGO;

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const N: any = await (fabrica as any)({ wasmBinary: bytes(J.wasm) });
const comTexto = <T>(s: string, f: (p: number) => T): T => {
  const p = N.stringToNewUTF8(s);
  try {
    return f(p);
  } finally {
    N._free(p);
  }
};

// ---- a tela
const tela = document.getElementById("tela") as HTMLCanvasElement;
const gl = tela.getContext("webgl2", { stencil: true, premultipliedAlpha: true, alpha: false, antialias: true })!;
if (!gl) throw new Error("este navegador nao tem WebGL2");
const desenhista = new Desenhista(gl);

// ---- o modelo: os arquivos das instancias primeiro, depois o principal
for (const [c, t] of Object.entries(J.arquivos)) if (c !== J.principal) comTexto(c, (pc) => comTexto(t, (pt) => N._mm_arquivo(pc, pt)));
const modelo = comTexto(J.arquivos[J.principal], (pt) => comTexto(J.principal, (pc) => N._mm_carregar_de(pt, pc)));
if (modelo < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
const info = JSON.parse(N.UTF8ToString(N._mm_info(modelo)));
const esqueleto = JSON.parse(J.arquivos[J.principal]).esqueleto ?? {};
const dir = J.principal.slice(0, J.principal.lastIndexOf("/") + 1);
const texturas = new Map<string, WebGLTexture>();
for (const pg of info.paginas as { arquivo: string; pma: boolean }[]) {
  const c = normalizar(dir + pg.arquivo);
  if (texturas.has(pg.arquivo) || !J.imagens[c]) continue;
  const img = await createImageBitmap(await (await fetch(J.imagens[c])).blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const f = /^nearest/i.test(J.filtros[c] ?? "") ? gl.NEAREST : gl.LINEAR;
  texturas.set(pg.arquivo, desenhista.textura(img, { min: f, mag: f }));
}
const paginas: PaginaGL[] = info.paginas.map((pg: any) => ({ tex: texturas.get(pg.arquivo) as WebGLTexture, pma: pg.pma, relevo: null }));
const inst = N._mm_instancia(modelo);

function normalizar(c: string) {
  const out: string[] = [];
  for (const p of c.split("/")) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return "/" + out.join("/");
}

// ---- o jogo
let teclas = 0,
  sobra = 0,
  antes = performance.now();
let estado: any = null;
let cam: [number, number] | null = null;
const vista: [number, number] = J.vista ?? [esqueleto.largura ?? 1280, esqueleto.altura ?? 720];
const caixa = { x: esqueleto.x ?? 0, y: esqueleto.y ?? 0, w: esqueleto.largura ?? vista[0], h: esqueleto.altura ?? vista[1] };
function comecar() {
  if (!N._mm_palco(inst)) throw new Error("este .boneco nao tem palco");
  estado = JSON.parse(N.UTF8ToString(N._mm_palco_estado(inst)));
  cam = null;
}
comecar();

const fundo = [0, 2, 4].map((k) => parseInt(J.fundo.slice(k, k + 2), 16) / 255);
const placar = document.getElementById("placar")!;
function quadro(agora: number) {
  requestAnimationFrame(quadro);
  sobra = Math.min(sobra + (agora - antes) / 1000, 6 / 60);
  antes = agora;
  let n = 0;
  while (sobra >= 1 / 60 - 1e-9) {
    N._mm_palco_passo(inst, teclas, 1, 1 / 60);
    sobra -= 1 / 60;
    n++;
  }
  if (n) estado = JSON.parse(N.UTF8ToString(N._mm_palco_estado(inst)));
  // a tela no tamanho da janela, a vista inteira cabendo
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(tela.clientWidth * dpr),
    h = Math.round(tela.clientHeight * dpr);
  if (tela.width !== w || tela.height !== h) (tela.width = w), (tela.height = h);
  const escala = Math.min(w / vista[0], h / vista[1]);
  const vw = w / escala,
    vh = h / escala;
  // a camera: parada no meio da fase se ela cabe; senao atras do jogador, sem sair da fase
  const jog = estado?.atores?.find((a: any) => a.tipo === "jogador");
  const alvo: [number, number] = jog ? [jog.x, jog.y + vh * 0.15] : [caixa.x + caixa.w / 2, caixa.y + caixa.h / 2];
  cam ??= alvo;
  if (n) for (let i = 0; i < n; i++) (cam[0] += (alvo[0] - cam[0]) * 0.08), (cam[1] += (alvo[1] - cam[1]) * 0.08);
  const cx = caixa.w <= vw ? caixa.x + caixa.w / 2 : Math.min(Math.max(cam[0], caixa.x + vw / 2), caixa.x + caixa.w - vw / 2);
  const cy = caixa.h <= vh ? caixa.y + caixa.h / 2 : Math.min(Math.max(cam[1], caixa.y + vh / 2), caixa.y + caixa.h - vh / 2);
  gl.viewport(0, 0, w, h);
  gl.clearColor(fundo[0], fundo[1], fundo[2], 1);
  gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  N._mm_limpar_desenho();
  N._mm_desenhar(inst);
  desenhista.desenhar(N, paginas, ortho(cx, cy, escala, w, h));
  if (estado) placar.textContent = `🪙 ${estado.pontos}` + (estado.venceu ? "  ·  venceu! (R recomeça)" : estado.morreu ? "  ·  morreu (R recomeça)" : "");
}
requestAnimationFrame(quadro);

// ---- teclado e toque
const TECLAS: Record<string, number> = { ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, Space: 4, KeyW: 4, ArrowUp: 4 };
addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.code === "KeyR") return comecar();
  const b = TECLAS[e.code];
  if (b) (teclas |= b), e.preventDefault();
});
addEventListener("keyup", (e: KeyboardEvent) => {
  const b = TECLAS[e.code];
  if (b) teclas &= ~b;
});
for (const el of document.querySelectorAll<HTMLElement>("[data-tecla]")) {
  const b = Number(el.dataset.tecla);
  const solta = (e: Event) => ((teclas &= ~b), e.preventDefault());
  el.addEventListener("pointerdown", (e) => ((teclas |= b), el.setPointerCapture(e.pointerId), e.preventDefault()));
  el.addEventListener("pointerup", solta);
  el.addEventListener("pointercancel", solta);
}
document.getElementById("recomeca")!.addEventListener("click", () => comecar());
document.title = J.titulo;
