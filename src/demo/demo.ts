// A demo ao vivo: os seis personagens CC0 de tests/boneco tocados pelo nucleo em wasm
// (nucleo/web/nucleo_web.cpp) e desenhados pelo desenhista WebGL2 (src/render/desenhista.ts).
// Nada do spine-core nem do spine-webgl entra aqui.
//
// O palco tem unidades proprias (y para cima, o chao em y = 0 de cada fileira). Cada modelo
// tem uma escala para todos ficarem com a mesma altura; a posicao e a rotacao de cada
// personagem vao para o osso raiz pelo mm_posicao, em unidades do modelo, para a fisica do
// nucleo ver o movimento (a antena e o cabelo balancam quando se arrasta).
//
// ?social=1: a imagem de previa (tools/foto-demo.ts social), quadro fixo, sem controles.
import { Desenhista, carregarNucleo, ortho, type PaginaGL } from "../render/desenhista.ts";
import { ELENCO, ROTULOS, type Personagem } from "./elenco.ts";
import { TEXTOS, texto, type Chave, type Lingua } from "./textos.ts";

declare const __WASM_BYTES__: number;
declare const __WASM_GZIP__: number;

type Info = { nome: string; paginas: { arquivo: string; largura: number; altura: number; pma: boolean }[]; fisica: boolean; animacoes: { nome: string; duracao: number }[] };
type Caixa = { x0: number; y0: number; x1: number; y1: number };

type Modelo = {
  p: Personagem;
  id: number;
  info: Info;
  paginas: PaginaGL[];
  // unidades do palco por unidade do modelo
  escala: number;
  // caixa da pose de setup, em unidades do palco, com a origem no osso raiz
  caixa: Caixa;
  anim: Map<string, number>;
  mix: { padrao: number; pares: { de: string; para: string; tempo: number }[] };
};

type V = { x: number; y: number };

// um personagem no palco. O corpo e rigido: gira `th` (rad) em torno do pivo W (no palco); `q`
// e o pivo relativo a origem sem rotacao. Origem desenhada = W - R(th) q.
type Ator = {
  m: Modelo;
  inst: number;
  casa: V;
  W: V;
  q: V;
  v: V;
  th: number;
  om: number;
  preso: boolean;
  anim: string;
  // segundos ate voltar ao idle (animacao em loop tocada pela vitrine)
  volta: number;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const SOCIAL = params.has("social");

// ---- lingua

let lingua: Lingua = "en";
try {
  const l = params.get("lang") ?? localStorage.getItem("mamulengo-lingua");
  if (l === "pt" || l === "en") lingua = l;
} catch {
  // sem armazenamento: fica o ingles
}
const t = (k: Chave, v?: Record<string, string | number>) => texto(lingua, k, v);
const rotulo = (a: string) => ROTULOS[a]?.[lingua] ?? a;

// ---- WebGL e o nucleo

const tela = $<HTMLCanvasElement>("tela");
const sombras = $<HTMLCanvasElement>("sombras");
const ctx2 = sombras.getContext("2d")!;
const gl = tela.getContext("webgl2", { stencil: true, alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: SOCIAL });

function falhar(msg: string) {
  const e = $("erro");
  e.hidden = false;
  e.textContent = msg;
}

if (!gl) {
  falhar(TEXTOS[lingua].semWebgl);
  throw new Error("sem WebGL2");
}
const desenhista = new Desenhista(gl);
const N: any = await carregarNucleo(new URL("nucleo/nucleo.mjs", document.baseURI).href);
const str = (p: number) => N.UTF8ToString(p) as string;

const carregarImagem = (url: string) =>
  new Promise<HTMLImageElement>((ok, falha) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => falha(new Error(`imagem nao carregou: ${url}`));
    i.src = url;
  });

const ALTURA = 230; // altura de todos no palco (unidades)

async function carregar(p: Personagem): Promise<Modelo> {
  const pasta = `elenco/${p.pasta}/`;
  const txt = await (await fetch(`${pasta}${p.pasta}.boneco`)).text();
  const b = JSON.parse(txt);
  const ptr = N.stringToNewUTF8(txt);
  const id = N._mm_carregar(ptr);
  N._free(ptr);
  if (id < 0) throw new Error(`${p.pasta}: ${str(N._mm_erro())}`);
  const info = JSON.parse(str(N._mm_info(id))) as Info;
  const imgs = await Promise.all(info.paginas.map((pg) => carregarImagem(pasta + pg.arquivo)));
  const paginas = imgs.map((img, i) => ({ tex: desenhista.textura(img), pma: info.paginas[i].pma }));
  const anim = new Map(info.animacoes.map((a, i) => [a.nome, i]));
  return { p, id, info, paginas, escala: 1, caixa: { x0: 0, y0: 0, x1: 0, y1: 0 }, anim, mix: { padrao: b.mix?.padrao ?? 0.2, pares: b.mix?.pares ?? [] } };
}

// caixa da pose de setup pelos vertices do desenho (uma instancia so para medir)
function medir(m: Modelo) {
  const k = N._mm_instancia(m.id);
  N._mm_posicao(k, 0, 0, 0);
  N._mm_reiniciar(k);
  N._mm_passo(k, 0);
  N._mm_limpar_desenho();
  N._mm_desenhar(k);
  const n = N._mm_num_vertices();
  const v = N.HEAPF32.subarray(N._mm_vertices() / 4, N._mm_vertices() / 4 + n * 8);
  const c = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < n; i++) {
    const x = v[i * 8],
      y = v[i * 8 + 1];
    c.x0 = Math.min(c.x0, x);
    c.x1 = Math.max(c.x1, x);
    c.y0 = Math.min(c.y0, y);
    c.y1 = Math.max(c.y1, y);
  }
  m.escala = ALTURA / Math.max(1, c.y1 - Math.min(0, c.y0));
  m.caixa = { x0: c.x0 * m.escala, y0: c.y0 * m.escala, x1: c.x1 * m.escala, y1: c.y1 * m.escala };
}

let modelos: Modelo[] = [];
try {
  modelos = await Promise.all(ELENCO.map(carregar));
} catch (e: any) {
  falhar(t("erro", { e: e?.message ?? String(e) }));
  throw e;
}
N._mm_limpar_instancias();
for (const m of modelos) medir(m);
N._mm_limpar_instancias();

// ---- atores e animacao

let atores: Ator[] = [];
let modo: "todos" | "um" | "cem" = "todos";
let escolhido = 0; // indice do modelo escolhido (painel de animacoes)
const mixUI = () => Number($<HTMLInputElement>("mix").value);

function mixDe(m: Modelo, de: string, para: string) {
  return m.mix.pares.find((p) => p.de === de && p.para === para)?.tempo ?? Math.max(0.2, m.mix.padrao);
}
const duracao = (m: Modelo, a: string) => m.info.animacoes[m.anim.get(a) ?? 0]?.duracao ?? 0;
const temLaco = (m: Modelo, a: string) => m.p.laco.includes(a);

function novoAtor(m: Modelo, casa: V): Ator {
  const inst = N._mm_instancia(m.id);
  const a: Ator = { m, inst, casa: { ...casa }, W: { ...casa }, q: { x: 0, y: 0 }, v: { x: 0, y: 0 }, th: 0, om: 0, preso: false, anim: "idle", volta: 0 };
  N._mm_posicao(inst, casa.x / m.escala, casa.y / m.escala, 0);
  N._mm_reiniciar(inst);
  N._mm_estado_tocar(inst, 0, m.anim.get("idle") ?? 0, 1, 0);
  return a;
}

// toca `a` no ator: em loop, ou uma vez e depois volta ao idle; `mix`: a emenda de entrada
function tocar(at: Ator, a: string, mix: number) {
  const m = at.m;
  const i = m.anim.get(a);
  if (i === undefined) return;
  const laco = temLaco(m, a);
  N._mm_estado_tocar(at.inst, 0, i, laco ? 1 : 0, mix);
  at.anim = a;
  at.volta = 0;
  if (!laco) {
    const volta = mixDe(m, a, "idle");
    N._mm_estado_enfileirar(at.inst, 0, m.anim.get("idle") ?? 0, 1, Math.max(0, duracao(m, a) - volta), volta);
  }
}

// A uma vez, depois B (em loop se for de loop; senao B uma vez e o idle)
function tocarEmenda(at: Ator, a: string, b: string, mix: number) {
  const m = at.m;
  const ia = m.anim.get(a),
    ib = m.anim.get(b);
  if (ia === undefined || ib === undefined) return;
  N._mm_estado_tocar(at.inst, 0, ia, 0, mixUI());
  const lacoB = temLaco(m, b);
  N._mm_estado_enfileirar(at.inst, 0, ib, lacoB ? 1 : 0, Math.max(0, duracao(m, a) - mix), mix);
  if (!lacoB) {
    const volta = mixDe(m, b, "idle");
    N._mm_estado_enfileirar(at.inst, 0, m.anim.get("idle") ?? 0, 1, Math.max(0, duracao(m, b) - volta), volta);
  }
  at.anim = b;
  at.volta = 0;
}

// ---- disposicao no palco

let vista = { x0: 0, y0: 0, x1: 1, y1: 1 }; // o que a camera tem de mostrar (palco)
let cam = { cx: 0, cy: 0, escala: 1, w: 1, h: 1 };

function montar() {
  N._mm_limpar_instancias();
  atores = [];
  // o numero de colunas que deixa os personagens maiores na tela de agora
  const W = Math.max(1, tela.clientWidth),
    H = Math.max(1, tela.clientHeight);
  const melhor = (opcoes: number[], total: number, passo: number, fileira: number, topo: number) =>
    opcoes.reduce((a, c) => {
      const e = (k: number) => Math.min(W / (k * passo), H / ((Math.ceil(total / k) - 1) * fileira + topo));
      return e(c) > e(a) ? c : a;
    });
  if (modo === "um") {
    const m = modelos[escolhido];
    atores.push(novoAtor(m, { x: 0, y: 0 }));
    vista = { x0: -200, y0: -40, x1: 200, y1: ALTURA * 1.55 };
  } else if (modo === "todos") {
    const passo = 265,
      fileira = 305;
    const colunas = SOCIAL ? 6 : melhor([6, 3, 2], modelos.length, passo, fileira, ALTURA * 1.45 + 50);
    const linhas = Math.ceil(modelos.length / colunas);
    modelos.forEach((m, i) => {
      const c = i % colunas,
        l = Math.floor(i / colunas);
      atores.push(novoAtor(m, { x: (c - (colunas - 1) / 2) * passo, y: (linhas - 1 - l) * fileira }));
    });
    vista = { x0: (-colunas / 2) * passo, y0: -50, x1: (colunas / 2) * passo, y1: (linhas - 1) * fileira + ALTURA * 1.45 };
  } else {
    // 100 copias: 10 fileiras de 10, de tras para frente; no modo de um, todas iguais
    const total = 100;
    const passo = 150,
      fileira = 105;
    const colunas = melhor([5, 6, 7, 8, 10, 12, 14], total, passo, fileira, ALTURA * 1.25 + 40);
    const linhas = Math.ceil(total / colunas);
    for (let k = 0; k < total; k++) {
      const c = k % colunas,
        l = Math.floor(k / colunas);
      const m = sozinho !== null ? modelos[sozinho] : modelos[l % modelos.length];
      const at = novoAtor(m, { x: (c - (colunas - 1) / 2) * passo + (l % 2 ? passo / 4 : -passo / 4), y: (linhas - 1 - l) * fileira });
      // cada um num ponto diferente do idle, e alguns comemorando
      N._mm_passo(at.inst, Math.random() * Math.max(0.1, duracao(m, "idle")));
      atores.push(at);
    }
    vista = { x0: (-colunas / 2 - 0.4) * passo, y0: -40, x1: (colunas / 2 + 0.4) * passo, y1: (linhas - 1) * fileira + ALTURA * 1.25 };
  }
  enquadrar();
}

// no modo de 100 copias: o modelo de todas (se veio do modo de um) ou null (o elenco misturado)
let sozinho: number | null = null;

function enquadrar() {
  const dpr = Math.min(window.devicePixelRatio || 1, SOCIAL ? 1 : 2);
  const w = Math.max(1, Math.round(tela.clientWidth * dpr)),
    h = Math.max(1, Math.round(tela.clientHeight * dpr));
  for (const c of [tela, sombras]) {
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }
  const vw = vista.x1 - vista.x0,
    vh = vista.y1 - vista.y0;
  // folga em cima (a dica) e embaixo (o selo e o medidor); no social o palco fica na faixa de
  // baixo, abaixo do titulo
  const [cima, baixo] = SOCIAL ? [h * 0.47, 50] : [46 * dpr, 46 * dpr];
  const escala = Math.min(w / vw, Math.max(1, h - cima - baixo) / vh) * 0.97;
  // o centro da vista no meio da faixa util
  const cy = (vista.y0 + vista.y1) / 2 - (baixo - cima) / (2 * escala);
  cam = { cx: (vista.x0 + vista.x1) / 2, cy, escala, w, h };
}

const palcoDe = (cx: number, cy: number): V => {
  const r = tela.getBoundingClientRect();
  const dpr = tela.width / Math.max(1, r.width);
  return { x: cam.cx + ((cx - r.left) * dpr - cam.w / 2) / cam.escala, y: cam.cy - ((cy - r.top) * dpr - cam.h / 2) / cam.escala };
};
const telaDe = (p: V): V => ({ x: cam.w / 2 + (p.x - cam.cx) * cam.escala, y: cam.h / 2 - (p.y - cam.cy) * cam.escala });

const rot = (th: number, p: V): V => ({ x: Math.cos(th) * p.x - Math.sin(th) * p.y, y: Math.sin(th) * p.x + Math.cos(th) * p.y });
const origem = (a: Ator): V => {
  const r = rot(a.th, a.q);
  return { x: a.W.x - r.x, y: a.W.y - r.y };
};
const centro = (a: Ator): V => ({ x: (a.m.caixa.x0 + a.m.caixa.x1) / 2, y: (a.m.caixa.y0 + a.m.caixa.y1) / 2 });

// troca o pivo sem mexer no desenho
function pivo(a: Ator, q: V) {
  const o = origem(a);
  const r = rot(a.th, q);
  a.q = q;
  a.W = { x: o.x + r.x, y: o.y + r.y };
}

// ---- arrasto (mouse e dedo)

const G = 1700; // gravidade do palco
let pega: { a: Ator; id: number; alvo: V; vel: V; acel: V; ultimo: V; tempo: number } | null = null;
let mexeu = false;
let ultimaMexida = -1e9;

function acertar(p: V): Ator | null {
  for (let i = ordem.length - 1; i >= 0; i--) {
    const a = ordem[i];
    const o = origem(a);
    const d = rot(-a.th, { x: p.x - o.x, y: p.y - o.y });
    const c = a.m.caixa,
      f = 14;
    if (d.x > c.x0 - f && d.x < c.x1 + f && d.y > c.y0 - f && d.y < c.y1 + f) return a;
  }
  return null;
}

tela.addEventListener("pointerdown", (e) => {
  if (pega) return;
  const p = palcoDe(e.clientX, e.clientY);
  const a = acertar(p);
  ultimaMexida = performance.now();
  if (!a) return;
  e.preventDefault();
  tela.setPointerCapture(e.pointerId);
  const o = origem(a);
  pivo(a, rot(-a.th, { x: p.x - o.x, y: p.y - o.y }));
  a.W = p;
  a.v = { x: 0, y: 0 };
  a.preso = true;
  pega = { a, id: e.pointerId, alvo: p, vel: { x: 0, y: 0 }, acel: { x: 0, y: 0 }, ultimo: p, tempo: performance.now() };
  tela.classList.add("pega");
  const i = modelos.indexOf(a.m);
  if (modo !== "cem" && i !== escolhido) escolher(i);
  if (!mexeu) {
    mexeu = true;
    $("dica").classList.add("some");
  }
});
tela.addEventListener("pointermove", (e) => {
  if (!pega || e.pointerId !== pega.id) return;
  pega.alvo = palcoDe(e.clientX, e.clientY);
  ultimaMexida = performance.now();
});
const soltar = (e: PointerEvent) => {
  if (!pega || e.pointerId !== pega.id) return;
  const a = pega.a;
  a.preso = false;
  // jogado com a velocidade do dedo (limitada), girando em torno do centro
  const lim = 2600;
  a.v = { x: Math.max(-lim, Math.min(lim, pega.vel.x)), y: Math.max(-lim, Math.min(lim, pega.vel.y)) };
  pivo(a, centro(a));
  pega = null;
  tela.classList.remove("pega");
};
tela.addEventListener("pointerup", soltar);
tela.addEventListener("pointercancel", soltar);

// ---- um passo do palco

function mover(a: Ator, dt: number) {
  if (a.preso && pega?.a === a) {
    // o pivo vai para o dedo; o corpo e um pendulo pendurado nele
    const p = pega.alvo;
    const nv = { x: (p.x - a.W.x) / dt, y: (p.y - a.W.y) / dt };
    const k = 1 - Math.exp(-dt * 25);
    const vel = { x: pega.vel.x + (nv.x - pega.vel.x) * k, y: pega.vel.y + (nv.y - pega.vel.y) * k };
    const acel = { x: (vel.x - pega.vel.x) / dt, y: (vel.y - pega.vel.y) / dt };
    pega.acel = { x: pega.acel.x + (acel.x - pega.acel.x) * 0.5, y: pega.acel.y + (acel.y - pega.acel.y) * 0.5 };
    pega.vel = vel;
    a.W = { ...p };
    const c = centro(a);
    const r = rot(a.th, { x: c.x - a.q.x, y: c.y - a.q.y });
    const L2 = Math.max(60 * 60, r.x * r.x + r.y * r.y);
    // forca por massa no centro: gravidade menos a aceleracao do pivo
    const fx = -pega.acel.x,
      fy = -G - pega.acel.y;
    const torque = (r.x * fy - r.y * fx) / L2;
    a.om += (torque - 3.2 * a.om) * dt;
    a.th = Math.max(-1.3, Math.min(1.3, a.th + a.om * dt));
    return;
  }
  // solto: voa, cai, quica e endireita
  const o0 = origem(a);
  const noChao = o0.y <= a.casa.y + 0.5 && Math.abs(a.v.y) < 1;
  if (!noChao || a.v.y > 0) a.v.y -= G * dt;
  a.W.x += a.v.x * dt;
  a.W.y += a.v.y * dt;
  a.om += (-90 * a.th - 9 * a.om) * dt;
  a.th += a.om * dt;
  const o = origem(a);
  if (o.y < a.casa.y) {
    a.W.y += a.casa.y - o.y;
    if (a.v.y < -260) a.v.y = -a.v.y * 0.32;
    else a.v.y = 0;
    a.v.x *= Math.exp(-dt * 7);
    a.om *= Math.exp(-dt * 4);
  }
  // as paredes: as bordas da tela
  const c = a.m.caixa;
  const o2 = origem(a);
  const meia = cam.w / 2 / cam.escala;
  if (o2.x + c.x0 < cam.cx - meia && a.v.x < 0) a.v.x = -a.v.x * 0.5;
  if (o2.x + c.x1 > cam.cx + meia && a.v.x > 0) a.v.x = -a.v.x * 0.5;
}

// a vitrine: sem ninguem mexendo, de tempos em tempos um personagem toca outra animacao
let vitrine = 1.2;
function vitrinePasso(dt: number) {
  if (modo === "cem") {
    vitrine -= dt;
    if (vitrine > 0) return;
    vitrine = 0.25;
    const a = atores[Math.floor(Math.random() * atores.length)];
    const outras = a.m.info.animacoes.map((x) => x.nome).filter((n) => n !== "idle" && !temLaco(a.m, n));
    if (a.anim === "idle" && outras.length) tocar(a, outras[Math.floor(Math.random() * outras.length)], 0.2);
    return;
  }
  if (performance.now() - ultimaMexida < 5000) return;
  vitrine -= dt;
  if (vitrine > 0) return;
  vitrine = modo === "um" ? 3.2 : 1.9;
  const livres = atores.filter((a) => !a.preso && a.anim === "idle" && a.volta <= 0);
  if (!livres.length) return;
  const a = livres[Math.floor(Math.random() * livres.length)];
  const outras = a.m.info.animacoes.map((x) => x.nome).filter((n) => n !== "idle");
  if (!outras.length) return;
  const n = outras[Math.floor(Math.random() * outras.length)];
  tocar(a, n, mixDe(a.m, a.anim, n));
  if (temLaco(a.m, n)) a.volta = 2.4;
}

// ---- desenho

let ordem: Ator[] = [];
const soma = { pose: 0, desenho: 0, quadros: 0, desde: performance.now() };
let ultimo = performance.now();

function sombrasEDesenho() {
  // sombras e nomes no canvas 2D de tras
  ctx2.setTransform(1, 0, 0, 1, 0, 0);
  ctx2.clearRect(0, 0, sombras.width, sombras.height);
  for (const a of ordem) {
    const o = origem(a);
    const alto = Math.max(0, o.y - a.casa.y);
    const lar = (a.m.caixa.x1 - a.m.caixa.x0) * 0.42 * cam.escala * Math.max(0.35, 1 - alto / 500);
    const s = telaDe({ x: o.x, y: a.casa.y });
    ctx2.fillStyle = `rgba(0,0,0,${0.32 * Math.max(0.25, 1 - alto / 400)})`;
    ctx2.beginPath();
    ctx2.ellipse(s.x, s.y, lar, lar * 0.16, 0, 0, Math.PI * 2);
    ctx2.fill();
  }
  if (modo !== "cem" && !SOCIAL) {
    const tam = Math.max(11, Math.min(16, cam.escala * 15));
    ctx2.font = `600 ${tam}px system-ui, sans-serif`;
    ctx2.textAlign = "center";
    for (const a of atores) {
      const s = telaDe({ x: a.casa.x, y: a.casa.y });
      const eu = modelos.indexOf(a.m) === escolhido;
      ctx2.fillStyle = eu ? "#ffd166" : "rgba(239,233,244,0.55)";
      ctx2.fillText(a.m.p.nome[lingua], s.x, s.y + tam * 1.9);
    }
  }
  // os personagens: de tras para frente, o arrastado por cima; uma lista de desenho por
  // trecho seguido do mesmo modelo (as paginas sao de cada modelo)
  gl!.viewport(0, 0, cam.w, cam.h);
  gl!.clearColor(0, 0, 0, 0);
  gl!.clearStencil(0);
  gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.STENCIL_BUFFER_BIT);
  let i = 0;
  while (i < ordem.length) {
    const m = ordem[i].m;
    N._mm_limpar_desenho();
    let j = i;
    while (j < ordem.length && ordem[j].m === m) N._mm_desenhar(ordem[j++].inst);
    desenhista.desenhar(N, m.paginas, ortho(cam.cx / m.escala, cam.cy / m.escala, cam.escala * m.escala, cam.w, cam.h));
    i = j;
  }
}

function ordenar() {
  ordem = [...atores].sort((a, b) => Number(a.preso) - Number(b.preso) || b.casa.y - a.casa.y);
}

const fmt = (ms: number) => (ms < 0.1 ? `${Math.max(1, Math.round(ms * 1000))} µs` : `${ms.toFixed(2)} ms`);
const intervalos: number[] = [];

function quadro(agora: number) {
  const dtReal = Math.min(0.05, Math.max(0, (agora - ultimo) / 1000));
  intervalos.push(agora - ultimo);
  if (intervalos.length > 120) intervalos.shift();
  ultimo = agora;
  const dt = dtReal || 1 / 60;
  vitrinePasso(dt);
  const t0 = performance.now();
  for (const a of atores) {
    mover(a, dt);
    if (a.volta > 0) {
      a.volta -= dt;
      if (a.volta <= 0) tocar(a, "idle", mixDe(a.m, a.anim, "idle"));
    }
    const o = origem(a);
    N._mm_posicao(a.inst, o.x / a.m.escala, o.y / a.m.escala, (a.th * 180) / Math.PI);
    N._mm_passo(a.inst, dt);
  }
  const t1 = performance.now();
  ordenar();
  sombrasEDesenho();
  const t2 = performance.now();
  soma.pose += t1 - t0;
  soma.desenho += t2 - t1;
  soma.quadros++;
  if (agora - soma.desde > 500) {
    const q = soma.quadros;
    const media = intervalos.reduce((x, y) => x + y, 0) / Math.max(1, intervalos.length);
    estat = { fps: 1000 / media, pose: soma.pose / q, desenho: soma.desenho / q, n: atores.length };
    $("medidor").textContent = t("medidor", { fps: Math.round(estat.fps), n: atores.length === 1 ? t("um") : t("varios", { n: atores.length }), pose: fmt(estat.pose), des: fmt(estat.desenho) });
    soma.pose = soma.desenho = soma.quadros = 0;
    soma.desde = agora;
  }
  requestAnimationFrame(quadro);
}
let estat = { fps: 0, pose: 0, desenho: 0, n: 0 };

// ---- controles

function escolher(i: number) {
  escolhido = i;
  pintarControles();
}

function atorEscolhido(): Ator | undefined {
  return atores.find((a) => a.m === modelos[escolhido]);
}

function pintarControles() {
  const m = modelos[escolhido];
  const pers = $("personagens");
  pers.innerHTML = "";
  const ficha = (rot: string, ligado: boolean, faz: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ficha";
    b.textContent = rot;
    b.setAttribute("aria-pressed", String(ligado));
    b.onclick = faz;
    return b;
  };
  pers.append(
    ficha(t("todos"), modo === "todos" || (modo === "cem" && sozinho === null), () => {
      modo = "todos";
      sozinho = null;
      montar();
      pintarControles();
    }),
  );
  modelos.forEach((x, i) =>
    pers.append(
      ficha(x.p.nome[lingua], modo === "um" ? i === escolhido : modo === "cem" ? sozinho === i : false, () => {
        escolhido = i;
        if (modo === "cem") sozinho = i;
        else modo = "um";
        montar();
        pintarControles();
      }),
    ),
  );
  $("quem").textContent = modo === "cem" ? "" : `· ${m.p.nome[lingua]}`;
  const an = $("animacoes");
  an.innerHTML = "";
  const nomes = m.info.animacoes.map((a) => a.nome);
  const at = atorEscolhido();
  for (const n of nomes) {
    const b = ficha(rotulo(n), at?.anim === n, () => {
      const alvo = atorEscolhido();
      if (!alvo) return;
      ultimaMexida = performance.now();
      tocar(alvo, n, mixUI());
      pintarControles();
    });
    const d = document.createElement("small");
    d.textContent = `${m.info.animacoes[m.anim.get(n)!].duracao.toFixed(1)} s`;
    b.append(d);
    an.append(b);
  }
  for (const [id, padrao] of [
    ["emenda-a", nomes.find((n) => n !== "idle") ?? nomes[0]],
    ["emenda-b", "idle"],
  ] as const) {
    const s = $<HTMLSelectElement>(id);
    const antes = s.dataset.modelo === String(escolhido) ? s.value : padrao;
    s.innerHTML = nomes.map((n) => `<option value="${n}">${rotulo(n)}</option>`).join("");
    s.value = nomes.includes(antes) ? antes : padrao;
    s.dataset.modelo = String(escolhido);
  }
  $("copias").textContent = modo === "cem" ? t("copiasSair") : t("copias");
}

function pintarTextos() {
  document.documentElement.lang = lingua === "pt" ? "pt-BR" : "en";
  document.title = t("titulo");
  for (const el of document.querySelectorAll<HTMLElement>("[data-t]")) el.textContent = t(el.dataset.t as Chave);
  $("lingua").textContent = t("lingua");
  const kb = (n: number) => Math.round(n / 1024);
  $("selo").innerHTML = t("selo", { kb: `<b>${kb(__WASM_BYTES__)}</b>`, gz: kb(__WASM_GZIP__) });
  pintarControles();
}

$("lingua").onclick = () => {
  lingua = lingua === "en" ? "pt" : "en";
  try {
    localStorage.setItem("mamulengo-lingua", lingua);
  } catch {
    // sem armazenamento
  }
  pintarTextos();
};
$<HTMLInputElement>("mix").oninput = () => ($("mix-valor").textContent = `${mixUI().toFixed(2)} s`);
$("tocar-emenda").onclick = () => {
  const at = atorEscolhido();
  if (!at) return;
  ultimaMexida = performance.now();
  tocarEmenda(at, $<HTMLSelectElement>("emenda-a").value, $<HTMLSelectElement>("emenda-b").value, mixUI());
  pintarControles();
};
$("copias").onclick = () => {
  if (modo === "cem") {
    modo = sozinho !== null ? "um" : "todos";
  } else {
    sozinho = modo === "um" ? escolhido : null;
    modo = "cem";
  }
  montar();
  pintarControles();
};
$("reiniciar").onclick = () => {
  montar();
  pintarControles();
};

let largura = 0,
  altura = 0;
new ResizeObserver(() => {
  const w = tela.clientWidth,
    h = tela.clientHeight;
  if (w === largura && h === altura) return;
  // mudou a proporcao (girou o celular, por exemplo): refaz a disposicao
  const virou = largura && Math.abs(Math.log(w / h) - Math.log(largura / altura)) > 0.25;
  largura = w;
  altura = h;
  if (virou) montar();
  else enquadrar();
}).observe(tela);

// ---- partida

// para a conferencia automatica (tools/foto-demo.ts)
(window as any).__demo = {
  estat: () => estat,
  atores: () => atores.map((a) => ({ nome: a.m.p.pasta, origem: origem(a), tela: telaDe(origem(a)), th: a.th, anim: a.anim })),
  telaDe: (x: number, y: number) => {
    const p = telaDe({ x, y });
    const r = tela.getBoundingClientRect();
    const dpr = tela.width / Math.max(1, r.width);
    return { x: r.left + p.x / dpr, y: r.top + p.y / dpr };
  },
};

if (SOCIAL) {
  // quadro fixo: cada um num instante escolhido de uma animacao, passos de 1/60 s
  document.body.classList.add("modo-social");
  $("social").hidden = false;
  largura = tela.clientWidth;
  altura = tela.clientHeight;
  modo = "todos";
  montar();
  const poses: Record<string, [string, number]> = { robo: ["ganhou", 0.34], zumbi: ["anda", 0.7], monstro2: ["ganhou", 0.44], aventureiro: ["susto", 0.3], monstro: ["ganhou", 0.3], pessoa: ["acenar", 0.75] };
  for (const a of atores) {
    const [n, tt] = poses[a.m.p.pasta] ?? ["idle", 0.5];
    tocar(a, n, 0);
    for (let k = 0; k < Math.round(tt * 60); k++) N._mm_passo(a.inst, 1 / 60);
  }
  ordenar();
  sombrasEDesenho();
  document.body.dataset.pronto = "1";
} else {
  pintarTextos();
  largura = tela.clientWidth;
  altura = tela.clientHeight;
  montar();
  pintarControles();
  requestAnimationFrame((t0) => {
    ultimo = t0;
    requestAnimationFrame(quadro);
  });
  document.body.dataset.pronto = "1";
}
