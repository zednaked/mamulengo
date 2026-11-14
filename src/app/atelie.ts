// O atelie: tela limpa para desenhar e animar quadro a quadro (src/app/Atelie.svelte). Aqui fica a
// logica: entrar e sair, qual quadro esta em edicao (o que a timeline mostra no instante), criar
// quadro ao desenhar no vazio, e as operacoes da tira (novo, copia, tirar, fim, segurar). Os
// quadros sao comandos frame.* (src/core/commands/quadros.ts): cada um e um desenho que entra num
// instante da animacao aberta, por cima (ou por tras) do personagem animado por ossos.
import { app } from "./state.svelte.ts";
import { drawDragging, startDrawEdit, stopDrawEdit } from "./drawedit.ts";
import { camadasDeQuadros, chavesDoSlot, quadroEm, quadrosDoSlot } from "../core/commands/quadros.ts";
import { drawingsOf, type Drawing } from "../core/desenho.ts";
import { corEspalhada, instantes, juntar, mascara, type Curva } from "../core/intermediarios.ts";
import { drawDrawing } from "./desenho.ts";
import { NAVEGADOR } from "../navegador/pagina.ts";

const EPS = 1e-4;
const r4 = (t: number) => Math.round(t * 10000) / 10000;

export const passo = () => 1 / (app.atelie?.fps ?? 12);
// a celula (indice na tira) de um instante, e o instante de uma celula
export const celulaDe = (t: number) => Math.floor(t * (app.atelie?.fps ?? 12) + 1e-3);
export const tempoDe = (c: number) => r4(c / (app.atelie?.fps ?? 12));
export const agora = () => tempoDe(celulaDe(app.viewer?.view.time ?? 0));

export function camadas(): string[] {
  return app.doc ? camadasDeQuadros(app.doc.json) : [];
}

export function chaves() {
  const a = app.atelie;
  const anim = app.play.animation;
  return a?.layer && anim && app.doc ? chavesDoSlot(app.doc.json, anim, a.layer) : [];
}

export function abrirAtelie() {
  const v = app.viewer;
  const j = app.doc?.json;
  if (!v || !j) return;
  if (app.atelie) return sairAtelie();
  // desenhando uma peca: o atelie e so a tela limpa em volta dela
  const peca = app.drawEdit && !app.drawEdit.quadro;
  let layer: string | null = null;
  if (!peca) {
    const cs = camadas();
    layer = app.selection.slot && cs.includes(app.selection.slot) ? app.selection.slot : (cs[0] ?? null);
    if (app.mode === "setup") {
      if (!Object.keys(j.animations ?? {}).length) {
        if (!app.run({ cmd: "animation.create", args: { name: "desenho" } }, "animação para o quadro a quadro")) return;
        v.setAnimation("desenho");
        app.play.animation = "desenho";
      } else app.mode = "animate";
    }
    app.meshEdit = null;
    app.mosaicEdit = null;
  }
  app.atelie = { layer, fps: 12, cebola: true, antes: 2, depois: 1, boneco: 1, tool: peca ? app.drawEdit!.tool : "pencil" };
  if (!peca) {
    v.seek(agora());
    sincronizar();
  }
}

export function sairAtelie() {
  if (!app.atelie) return;
  // fora do atelie a tela volta a ficar em pe
  if (app.viewer) app.viewer.cam.rot = 0;
  app.giro = 0;
  if (app.drawEdit?.quadro) stopDrawEdit();
  app.atelie = null;
}

// o quadro que a timeline mostra agora vira a imagem em edicao (ou nenhuma, no vazio e tocando)
export function sincronizar() {
  const a = app.atelie;
  const j = app.doc?.json;
  if (!a || !j || drawDragging()) return;
  const de = app.drawEdit;
  if (de) a.tool = de.tool;
  if (!a.layer) return;
  const anim = app.play.animation;
  // tocando: o estado do viewer (o espelho em app.play so chega no quadro seguinte)
  const tocando = app.viewer?.view.playing ?? app.play.playing;
  const q = anim && !tocando ? quadroEm(chavesDoSlot(j, anim, a.layer), app.viewer?.view.time ?? app.play.time) : null;
  if (!q?.name) {
    if (de?.quadro) stopDrawEdit();
    return;
  }
  if (de?.quadro && de.slot === a.layer && de.attachment === q.name) return;
  if (de && !de.quadro) return;
  startDrawEdit(a.layer, { attachment: q.name, tool: a.tool });
}

function nomeLivre(base: string): string {
  const j = app.doc!.json;
  const tem = (n: string) => j.slots.some((s: any) => s.name === n);
  if (!tem(base)) return base;
  for (let n = 2; ; n++) if (!tem(`${base}${n}`)) return `${base}${n}`;
}

// camada de quadros nova, no osso escolhido (ou na raiz), com o primeiro quadro no instante atual
export function novaCamada(): boolean {
  const a = app.atelie;
  const v = app.viewer;
  const j = app.doc?.json;
  const anim = app.play.animation;
  if (!a || !v || !j || !anim) return false;
  const bone = app.selection.bone ?? j.bones[0]?.name;
  if (!bone) return false;
  const layer = nomeLivre("quadros");
  const t = agora();
  // pintura precisa de folha maior (os pixels nao crescem depois); o traco vetorial faz a imagem crescer
  const pixels = a.tool === "brush" || a.tool === "bucket";
  const lado = pixels ? 1024 : 512;
  const r = app.run({ cmd: "frame.add", args: { layer, anim, time: t, bone, width: lado, height: lado, ...(pixels ? { hd: 1 } : {}), world: { center: [v.cam.x, v.flip ? -v.cam.y : v.cam.y] }, until: tempoDe(celulaDe(t) + 1) } }, `camada de quadros ${layer}`);
  if (!r) return false;
  a.layer = layer;
  v.seek(t);
  sincronizar();
  return true;
}

// abre uma celula em t: as chaves dali em diante andam n celulas (da ultima para a primeira)
function empurrar(layer: string, anim: string, t: number, n: number): any[] {
  const ks = chavesDoSlot(app.doc!.json, anim, layer).filter((k) => k.time >= t - EPS);
  const ordem = n > 0 ? [...ks].reverse() : ks;
  return ordem.map((k) => ({ cmd: "frame.move", args: { layer, anim, time: k.time, to: tempoDe(celulaDe(k.time) + n) } }));
}

// quadro novo: no vazio, aqui; no comeco de um quadro, logo depois dele (os seguintes andam);
// no meio de um quadro segurado, aqui (divide a exposicao)
export function novoQuadro(copia = false): boolean {
  const a = app.atelie;
  const v = app.viewer;
  const j = app.doc?.json;
  const anim = app.play.animation;
  if (!a || !v || !j || !anim) return false;
  if (!a.layer) return novaCamada();
  const t = agora();
  const ks = chavesDoSlot(j, anim, a.layer);
  const q = quadroEm(ks, t);
  const calls: any[] = [];
  let em = t;
  if (q?.name && Math.abs(q.from - t) < EPS) {
    em = q.to !== null ? q.to : tempoDe(celulaDe(t) + 1);
    const la = ks.find((k) => Math.abs(k.time - em) < EPS);
    // depois dele vem outro quadro: abre uma celula
    if (la?.name) calls.push(...empurrar(a.layer, anim, em, 1));
  }
  const depois = ks.some((k) => k.time > em + EPS) || calls.length > 0;
  // a copia e do quadro a mostra agora; no vazio, do ultimo quadro antes daqui
  const origem = copia ? (q?.name ?? [...ks].reverse().find((k) => k.name && k.time <= t + EPS)?.name) : undefined;
  calls.push({ cmd: "frame.add", args: { layer: a.layer, anim, time: em, ...(origem ? { copy: origem } : {}), ...(depois ? {} : { until: tempoDe(celulaDe(em) + 1) }) } });
  if (!app.run(calls, copia ? "quadro novo (cópia)" : "quadro novo")) return false;
  v.seek(em);
  sincronizar();
  return true;
}

// desenhar onde nao ha quadro cria o quadro ali (chamado pelo viewport antes do traco)
export function atelieGarante() {
  const a = app.atelie;
  if (!a || app.drawEdit || app.viewer?.view.playing) return;
  if (a.tool !== "pencil" && a.tool !== "pen" && a.tool !== "rect" && a.tool !== "ellipse" && a.tool !== "brush" && a.tool !== "bucket") return;
  novoQuadro(false);
}

export function tirarQuadro() {
  const a = app.atelie;
  const anim = app.play.animation;
  if (!a?.layer || !anim || !app.doc) return;
  const q = quadroEm(chavesDoSlot(app.doc.json, anim, a.layer), agora());
  if (!q) return;
  if (app.drawEdit?.quadro) stopDrawEdit();
  app.run({ cmd: q.name ? "frame.remove" : "frame.end", args: { layer: a.layer, anim, time: q.from } }, q.name ? `tira o quadro ${q.name}` : "tira o fim");
  sincronizar();
}

// a camada fica vazia daqui em diante
export function fimAqui() {
  const a = app.atelie;
  const anim = app.play.animation;
  if (!a?.layer || !anim) return;
  if (app.run({ cmd: "frame.end", args: { layer: a.layer, anim, time: agora() } }, "fim do quadro")) sincronizar();
}

// segura o quadro atual mais (ou menos) uma celula: o que vem depois anda
export function segurar(n: 1 | -1) {
  const a = app.atelie;
  const anim = app.play.animation;
  if (!a?.layer || !anim || !app.doc) return;
  const ks = chavesDoSlot(app.doc.json, anim, a.layer);
  const q = quadroEm(ks, agora());
  if (!q || q.to === null) return;
  // encolher nao passa de uma celula
  if (n < 0 && q.to - q.from < passo() * 1.5) return;
  app.run(empurrar(a.layer, anim, q.to, n), n > 0 ? "segura mais um" : "segura menos um");
}

// arrastar a borda direita de um bloco da tira: o quadro que entra em `time` dura n celulas a mais
// (ou a menos, ate sobrar uma) e o que vem depois anda junto
export function segurarEm(time: number, n: number): boolean {
  const a = app.atelie;
  const anim = app.play.animation;
  if (!a?.layer || !anim || !app.doc || !n) return false;
  const ks = chavesDoSlot(app.doc.json, anim, a.layer);
  const i = ks.findIndex((k) => Math.abs(k.time - time) < EPS);
  const prox = ks[i + 1];
  if (i < 0 || !prox) return false;
  const d = Math.max(n, 1 - (celulaDe(prox.time) - celulaDe(time)));
  if (!d) return false;
  return !!app.run(empurrar(a.layer, anim, prox.time, d), d > 0 ? `segura mais ${d}` : `segura menos ${-d}`);
}

// arrastar um bloco da tira: o quadro passa a entrar na celula `cel`; em cima de outro, os dois
// trocam de lugar
export function moverQuadro(time: number, cel: number): boolean {
  const a = app.atelie;
  const anim = app.play.animation;
  const to = tempoDe(Math.max(0, cel));
  if (!a?.layer || !anim || !app.doc || Math.abs(to - time) < EPS) return false;
  if (app.drawEdit?.quadro) stopDrawEdit();
  if (!app.run({ cmd: "frame.move", args: { layer: a.layer, anim, time, to, swap: true } }, "muda o quadro de lugar")) return false;
  app.viewer?.seek(to);
  sincronizar();
  return true;
}

export function irPara(t: number) {
  app.viewer?.seek(Math.max(0, t));
  sincronizar();
}

// anda para o quadro desenhado vizinho (ou uma celula, se nao houver)
export function vizinho(dir: 1 | -1) {
  const t = agora();
  const ks = chaves().filter((k) => k.name);
  const alvo = dir > 0 ? ks.find((k) => k.time > t + EPS) : [...ks].reverse().find((k) => k.time < quadroInicio(t) - EPS);
  irPara(alvo ? alvo.time : tempoDe(Math.max(0, celulaDe(t) + dir)));
}
function quadroInicio(t: number) {
  const q = quadroEm(chaves(), t);
  return q?.name ? q.from : t;
}

export function tocar() {
  const v = app.viewer;
  if (!v) return;
  if (app.drawEdit?.quadro) stopDrawEdit();
  v.view.playing = !v.view.playing;
  if (!v.view.playing) {
    v.seek(agora());
    sincronizar();
  }
}

// ---- intermediarios: o RIFE (server/rife.ts) desenha n quadros entre o quadro a mostra e o
// seguinte, como pintura, para limpar por cima. A curva espaca o desenho (lin, sai, entra, ambos);
// as celulas ficam iguais, e se nao couberem, o que vem depois anda.

// o quadro inteiro (tinta e formas) em RGBA reto, numa folha w x h, com o canto dele em (ox, oy)
function pixelsDoQuadro(image: string, d: Drawing, w: number, h: number, ox = 0, oy = 0): Uint8ClampedArray {
  const g = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true })!;
  drawDrawing(g, d, ox, oy, 1, app.pinturas.base(image, d));
  return g.getImageData(0, 0, w, h).data;
}
async function png(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
}
async function rife(a: Uint8Array, b: Uint8Array, t: number, w: number, h: number): Promise<Uint8ClampedArray> {
  const corpo = new Uint8Array(4 + a.length + b.length);
  new DataView(corpo.buffer).setUint32(0, a.length, true);
  corpo.set(a, 4);
  corpo.set(b, 4 + a.length);
  const r = await fetch(`/api/rife?t=${t.toFixed(4)}`, { method: "POST", body: corpo });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `rife: ${r.status}`);
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const g = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return g.getImageData(0, 0, w, h).data;
}

// os pares de chaves desenhadas vizinhas: o do quadro a mostra, ou todos
function paresDeChaves(ks: { time: number; name: string | null }[], todos: boolean): number[] {
  const pares: number[] = [];
  for (let i = 0; i + 1 < ks.length; i++) if (ks[i].name && ks[i + 1].name) pares.push(i);
  if (todos) return pares;
  const q = quadroEm(ks, agora());
  const i = q ? ks.findIndex((k) => Math.abs(k.time - q.from) < EPS) : -1;
  return pares.includes(i) ? [i] : [];
}

// n intermediarios entre cada par (o do quadro a mostra, ou todos os da camada). Quadros de tamanho
// ou lugar diferentes (a folha que cresceu) entram numa folha que cobre os dois
export async function intermediarios(n: number, curva: Curva, todos = false): Promise<boolean> {
  const a = app.atelie;
  const anim = app.play.animation;
  const j = app.doc?.json;
  if (!a?.layer || !anim || !j || a.gerando) return false;
  if (NAVEGADOR) return void app.toast("Os intermediários precisam do servidor do editor instalado (o RIFE roda na placa de vídeo)."), false;
  const layer = a.layer;
  const ks = chavesDoSlot(j, anim, layer);
  const pares = paresDeChaves(ks, todos);
  if (!pares.length) {
    const q = quadroEm(ks, agora());
    const i = q ? ks.findIndex((k) => Math.abs(k.time - q.from) < EPS) : -1;
    app.toast(todos ? "A camada não tem dois quadros desenhados um depois do outro." : !ks[i]?.name ? "Vá até um quadro desenhado: os intermediários vão dele até o próximo." : ks[i + 1] ? "Depois deste quadro a camada fica vazia (∅ fim): não há para onde ir." : "Não há quadro depois deste: desenhe a chave seguinte primeiro.");
    return false;
  }
  const qs = quadrosDoSlot(j, layer);
  const ds = drawingsOf(j);
  const peca = (nome: string) => {
    const q = qs.find((x) => x.name === nome)!;
    return { image: q.image, d: ds[q.image], a: q.a };
  };
  // cada par: a folha que cobre os dois (nas coordenadas da imagem de A) e os quadros nela
  const planos = pares.map((i) => {
    const A = peca(ks[i].name!),
      B = peca(ks[i + 1].name!);
    const aw = Math.ceil(A.d.width),
      ah = Math.ceil(A.d.height),
      bw = B.d.width,
      bh = B.d.height;
    // o canto de cima de B na imagem de A (as duas na mesma camada, sem giro nem escala entre elas)
    const bx = Math.round((B.a.x ?? 0) - bw / 2 - ((A.a.x ?? 0) - A.d.width / 2)),
      by = Math.round((A.a.y ?? 0) + A.d.height / 2 - ((B.a.y ?? 0) + bh / 2));
    const x0 = Math.min(0, bx),
      y0 = Math.min(0, by),
      x1 = Math.max(aw, Math.ceil(bx + bw)),
      y1 = Math.max(ah, Math.ceil(by + bh));
    const W = x1 - x0,
      H = y1 - y0;
    return { i, W, H, cresce: [-x0, -y0, x1 - aw, y1 - ah] as [number, number, number, number], pa: pixelsDoQuadro(A.image, A.d, W, H, -x0, -y0), pb: pixelsDoQuadro(B.image, B.d, W, H, bx - x0, by - y0) };
  });
  const ts = instantes(n, curva);
  const prontos: Uint8ClampedArray[][] = [];
  const total = planos.length * n;
  try {
    a.gerando = `0/${total}`;
    let feitos = 0;
    for (const pl of planos) {
      const { W, H, pa, pb } = pl;
      const [ma, mb, ca, cb] = await Promise.all([png(mascara(pa), W, H), png(mascara(pb), W, H), png(corEspalhada(pa, W, H), W, H), png(corEspalhada(pb, W, H), W, H)]);
      const deste: Uint8ClampedArray[] = [];
      for (const t of ts) {
        const mt = await rife(ma, mb, t, W, H);
        const ct = await rife(ca, cb, t, W, H);
        deste.push(juntar(mt, ct, pa, pb, t));
        a.gerando = `${++feitos}/${total}`;
      }
      prontos.push(deste);
    }
  } catch (e: any) {
    app.toast(`Os intermediários não saíram: ${e?.message ?? e}`);
    return false;
  } finally {
    if (app.atelie) app.atelie.gerando = null;
  }
  // o documento pode ter mudado enquanto o RIFE trabalhava
  const ks2 = chavesDoSlot(app.doc!.json, anim, layer);
  if (JSON.stringify(ks2) !== JSON.stringify(ks)) return void app.toast("Os quadros mudaram enquanto os intermediários eram feitos: tente de novo."), false;
  // as celulas novas: cada par escolhido ganha espaco para n quadros, e o que vem depois anda
  const cel = ks.map((k) => celulaDe(k.time));
  const nova = [...cel];
  for (let i = 1; i < ks.length; i++) {
    nova[i] = nova[i - 1] + (cel[i] - cel[i - 1]);
    if (pares.includes(i - 1) && nova[i] - nova[i - 1] < n + 1) nova[i] = nova[i - 1] + n + 1;
  }
  const calls: any[] = [];
  // da ultima para a primeira: as chaves so andam para a direita, ninguem cai em cima de outra
  for (let i = ks.length - 1; i >= 0; i--) if (nova[i] !== cel[i]) calls.push({ cmd: "frame.move", args: { layer, anim, time: ks[i].time, to: tempoDe(nova[i]) } });
  const onde: { p: number; k: number; c: number }[] = [];
  planos.forEach((pl, p) => {
    for (let k = 0; k < n; k++) {
      const c = nova[pl.i] + Math.round(((k + 1) * (nova[pl.i + 1] - nova[pl.i])) / (n + 1));
      onde.push({ p, k, c });
      calls.push({ cmd: "frame.add", args: { layer, anim, time: tempoDe(c) } });
    }
  });
  if (app.drawEdit?.quadro) stopDrawEdit();
  // um passo so de desfazer: os quadros entram uma vez para saber os nomes, voltam, e entram de novo
  // ja com a pintura (e a folha do tamanho que cobre o par)
  const r1 = app.run(calls, "intermediários");
  if (!r1) return false;
  const nomes = calls.map((c, k) => (c.cmd === "frame.add" ? (r1[k]?.frame as string) : null)).filter((x): x is string => !!x);
  app.undo();
  if (nomes.length !== onde.length) return false;
  const pinta: any[] = [];
  nomes.forEach((image, k) => {
    const { p, k: m } = onde[k];
    const pl = planos[p];
    const rev = app.pinturas.definir(image, prontos[p][m], pl.W, pl.H);
    const [l, tp, r, b] = pl.cresce;
    pinta.push(l || tp || r || b ? { cmd: "paint.grow", args: { image, left: l, top: tp, right: r, bottom: b, rev } } : { cmd: "paint.set", args: { image, rev } });
  });
  const r2 = app.run([...calls, ...pinta], total > 1 ? `${total} intermediários` : "intermediário");
  if (!r2) return false;
  irPara(tempoDe(onde[0].c));
  return true;
}

// ---- girar a tela (como no ProCraft): R tocado gira 15 graus no sentido do relogio, Shift+R e F14
// voltam (o anel da mesa manda R e F14), R segurado com um arrasto gira livre (Shift: de 15 em 15).
// O giro e so da vista (cam.rot): o desenho e o arquivo nao mudam.

const PASSO_GIRO = Math.PI / 12;
let animando = 0;
let alvoGiro: number | null = null;
// o angulo de agora, em graus no sentido do relogio (para mostrar)
export const giroEmGraus = () => {
  const r = app.viewer?.cam.rot ?? 0;
  let g = Math.round((-r * 180) / Math.PI) % 360;
  if (g > 180) g -= 360;
  if (g <= -180) g += 360;
  return g;
};

// gira a vista ate `alvo` (radianos), num instante curto
export function girarPara(alvo: number) {
  const v = app.viewer;
  if (!v) return;
  alvoGiro = alvo;
  if (animando) return;
  const passo = () => {
    const vv = app.viewer;
    if (!vv || alvoGiro === null) return void (animando = 0);
    const falta = alvoGiro - vv.cam.rot;
    if (Math.abs(falta) < 0.002) {
      vv.cam.rot = alvoGiro;
      alvoGiro = null;
      animando = 0;
      app.giro = giroEmGraus();
      return;
    }
    vv.cam.rot += falta * 0.45;
    app.giro = giroEmGraus();
    animando = requestAnimationFrame(passo);
  };
  animando = requestAnimationFrame(passo);
}
// um passo do anel: +1 no sentido do relogio, -1 contra
export function girarPasso(dir: 1 | -1) {
  const v = app.viewer;
  if (!v) return;
  const de = alvoGiro ?? v.cam.rot;
  girarPara(de - dir * PASSO_GIRO);
}
export const desvirar = () => girarPara(Math.round((app.viewer?.cam.rot ?? 0) / (2 * Math.PI)) * 2 * Math.PI);

// a tecla R: tocada gira um passo, segurada deixa o arrasto girar
let tecaR: { desde: number; girou: boolean } | null = null;
let arrastoGiro: { a0: number; rot0: number } | null = null;
export function teclaGiro(e: KeyboardEvent, solta: boolean): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === "F14") {
    if (!solta) girarPasso(-1);
    return true;
  }
  if (e.key !== "r" && e.key !== "R") return false;
  if (!solta) {
    if (!e.repeat) tecaR = { desde: performance.now(), girou: false };
    return true;
  }
  const t = tecaR;
  tecaR = null;
  if (t && !t.girou && performance.now() - t.desde < 350) girarPasso(e.shiftKey ? -1 : 1);
  return true;
}
const anguloNaTela = (v: { canvas: HTMLCanvasElement }, x: number, y: number) => {
  const r = v.canvas.getBoundingClientRect();
  return Math.atan2(y - (r.top + r.height / 2), x - (r.left + r.width / 2));
};
// o ponteiro desce com o R segurado: comeca a girar (devolve se tomou o gesto)
export function giroDown(x: number, y: number): boolean {
  const v = app.viewer;
  if (!v || !tecaR) return false;
  tecaR.girou = true;
  alvoGiro = null;
  arrastoGiro = { a0: anguloNaTela(v, x, y), rot0: v.cam.rot };
  return true;
}
export function giroMove(x: number, y: number, shift: boolean): boolean {
  const v = app.viewer;
  const g = arrastoGiro;
  if (!v || !g) return false;
  // na tela (y para baixo) o angulo cresce no sentido do relogio; o giro da vista e ao contrario
  let rot = g.rot0 - (anguloNaTela(v, x, y) - g.a0);
  if (shift) rot = Math.round(rot / PASSO_GIRO) * PASSO_GIRO;
  v.cam.rot = rot;
  app.giro = giroEmGraus();
  return true;
}
export function giroUp(): boolean {
  const era = arrastoGiro !== null;
  arrastoGiro = null;
  return era;
}
