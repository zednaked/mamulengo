// Desenhar no viewport (na Pose base), como no Figma: caneta (clique faz canto, arrastar faz
// curva, clicar no primeiro ponto fecha), selecionar (forma, ponto, alca; arrastar move),
// retangulo e elipse, e o modo furo (o que se desenha vira furo da forma escolhida). Tudo vira
// comando do core (draw.*); aqui so ha mira e desenho por cima.
// A imagem desenhada esta presa a uma parte: os pontos ficam em pixels da imagem e a conversao
// para o mundo segue a parte. Region: o osso e a region (x, y, rotacao, escala, tamanho), uma
// conta so. Malha: triangulo a triangulo, das UVs para os vertices na Pose base (com pesos ou nao).
import { Color } from "@esotericsoftware/spine-webgl";
import type { Viewer } from "../render/viewer.ts";
import { app, type DrawEdit } from "./state.svelte.ts";
import { cursor } from "./interact.ts";
import { contours, drawingsOf, flatten, nearestOnShape, type Contour, type DrawShape, type Drawing, type Vec } from "../core/desenho.ts";
import { caixaDasFormas, coverNeeded, drawingOfSlot } from "../core/commands/desenho.ts";
import { shapePath } from "./desenho.ts";
import { ESTILOS, Estabilizador, larguraDaPressao, type Amostra } from "../core/lapis.ts";
import { pinceladaComeca, pinceladaSegue, pinceladaTermina, type AmostraPincel, type Ferramenta } from "./pintura.ts";
import { apagarSelecao, balde, crescimento, deslocarSelecao, caixaDaSelecao, contornoDaSelecao, desistir, espelhar, ganchos, lacando, lacoDown, lacoMove, lacoUp, limparRetoque, retocando, selecao, selecionarTudo, semSelecao, soltar, temSolto } from "./retoque.ts";

const HIT_POINT = 8; // px de tela
const HIT_HANDLE = 7;
const HIT_EDGE = 6;

// ---- entrar e sair

export function startDrawEdit(slot: string, quadro?: { attachment: string; tool?: DrawEdit["tool"] }): boolean {
  const j = app.doc?.json;
  const found = j ? drawingOfSlot(j, slot, quadro?.attachment) : null;
  if (!j || !found) {
    app.toast("Esta parte não é uma imagem desenhada.");
    return false;
  }
  app.meshEdit = null;
  // o quadro de uma camada de quadros se desenha no instante dele, com a animacao aberta
  if (!quadro) app.mode = "setup";
  if (app.viewer) app.viewer.view.playing = false;
  const d = drawingsOf(j)[found.image];
  // os triangulos da malha a mostra atrapalham desenhar: somem ate sair do modo
  if (app.viewer?.view.showMeshes) (malhasAntes = true), (app.viewer.view.showMeshes = false);
  app.drawEdit = { image: found.image, slot, skin: found.skin, attachment: found.attachment, tool: quadro ? (quadro.tool ?? "pencil") : d.shapes.length ? "select" : "pen", shape: null, point: null, contour: 0, pen: null, penContour: 0, hole: false, ...(quadro ? { quadro: true } : {}) };
  app.select({ slot, bone: j.slots.find((s: any) => s.name === slot)?.bone });
  return true;
}

let malhasAntes = false;

export function stopDrawEdit() {
  limparRetoque();
  app.drawEdit = null;
  drag = null;
  traco = null;
  apagando = null;
  if (malhasAntes && app.viewer) app.viewer.view.showMeshes = true;
  malhasAntes = false;
}

// fim de um gesto: se o desenho passou da imagem ou da malha, a peca cresce para mostrar tudo
// (um passo de desfazer a parte, logo depois do gesto)
function cobrir() {
  const de = app.drawEdit;
  const j = app.doc?.json;
  if (!de || !j) return;
  // com pintura, a folha cresce aqui (os pixels andam junto); o draw.cover nao mexe nos pixels
  const d = drawingsOf(j)[de.image];
  const cx = d?.raster ? caixaDasFormas(d) : null;
  const cresce = d && cx ? crescimento(d.width, d.height, cx) : null;
  if (d && cresce) {
    const [l, t, r, b] = cresce;
    const rev = app.pinturas.crescer(de.image, d, l, t, r, b);
    deslocarSelecao(de.image, l, t);
    app.run({ cmd: "paint.grow", args: { image: de.image, left: l, top: t, right: r, bottom: b, rev } }, `${de.image} cresce até o desenho`);
    app.desenhos.pintar(app.doc!, app.viewer, de.image);
  }
  const c = coverNeeded(j, de.image);
  if (!c.grow && !c.meshes.length) return;
  const r = app.run({ cmd: "draw.cover", args: { image: de.image } }, c.meshes.length ? `a malha de ${de.slot} cobre o desenho` : `${de.image} cresce até o desenho`);
  const add = r?.[0] ? Object.values<number>(r[0].added).reduce((a, b) => a + b, 0) : 0;
  if (add) app.avisar(`A malha de ${de.slot} cresceu ${add} ponto${add > 1 ? "s" : ""} para mostrar o desenho inteiro (os pesos vêm dos vizinhos). Ctrl+Z desfaz só isso.`);
}

// o botao Desenhar da barra: abre o que der com o que esta escolhido. Peca desenhada: abre;
// peca em PNG: vetoriza a imagem (todas as partes que a usam passam ao desenho) e abre; so um
// osso: peca nova desenhada nele
export async function abrirDesenhar() {
  if (app.drawEdit) return stopDrawEdit();
  const j = app.doc?.json;
  if (!j) return;
  const slot = app.selection.slot;
  if (slot && drawingOfSlot(j, slot)) {
    startDrawEdit(slot);
    return;
  }
  const s = slot ? j.slots.find((x: any) => x.name === slot) : null;
  const a = s?.attachment ? j.skins.map((k: any) => k.attachments?.[slot!]?.[s.attachment]).find(Boolean) : null;
  if (s && a && ["region", "mesh"].includes(a.type ?? "region")) {
    const image = a.path ?? s.attachment;
    let nome = `${image}_v`;
    for (let n = 2; drawingsOf(j)[nome]; n++) nome = `${image}_v${n}`;
    app.avisar(`Vetorizando ${image}…`);
    const r = await app.runAsync({ cmd: "draw.trace", args: { image, drawing: nome, replace: true } }, `vetoriza ${image}`);
    if (!r?.[0]) return;
    startDrawEdit(slot!);
    app.avisar(`${image} virou desenho: ${r[0].shapes} formas, ${r[0].points} pontos, nas cores ${r[0].colors.map((c: string) => "#" + c).join(" ")}${r[0].replaced.length > 1 ? `, em ${r[0].replaced.length} partes` : ""}. Ctrl+Z volta para a imagem.`);
    return;
  }
  if (app.selection.bone) return newDrawnPart(app.selection.bone);
  app.toast("Escolha uma peça para desenhar por cima dela (uma imagem vira desenho), ou um osso para uma peça nova.");
}

// peca nova desenhada, presa ao osso escolhido, no centro do que se ve
export function newDrawnPart(bone: string, size: Vec = [200, 200]) {
  const j = app.doc?.json;
  const v = app.viewer;
  if (!j || !v) return;
  let n = 1;
  const taken = (x: string) => drawingsOf(j)[x] || j.slots.some((s: any) => s.name === x) || app.pixels.region(x);
  while (taken(`desenho_${n}`)) n++;
  const name = `desenho_${n}`;
  const r = app.run([{ cmd: "draw.create", args: { image: name, width: size[0], height: size[1], slot: name, bone, world: { center: [v.cam.x, v.cam.y] } } }], `nova peça desenhada ${name}`);
  if (r) {
    startDrawEdit(name);
    app.avisar(`${name} criada em ${bone}. Clique para pôr pontos (arrastar faz curva); clique no primeiro ponto para fechar.`);
  }
}

// ---- conversao imagem <-> mundo

type M = [number, number, number, number, number, number];

interface Mapper {
  // pixel da imagem (y para baixo) -> espaco do esqueleto, e de volta
  world(u: number, w: number): Vec;
  image(x: number, y: number): Vec;
  // pixels de tela por pixel da imagem (para os raios de mira)
  k: number;
  // a borda do que se desenha: o retangulo da imagem ou o contorno da malha (na imagem)
  border: Vec[];
}

function current(): { de: DrawEdit; d: Drawing } | null {
  const de = app.drawEdit;
  const d = de ? drawingsOf(app.doc?.json)[de.image] : null;
  return de && d ? { de, d } : null;
}

const ap = (m: M, u: number, v: number): Vec => [m[0] * u + m[1] * v + m[4], m[2] * u + m[3] * v + m[5]];
function inv(m: M): M {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det,
    b = -m[1] / det,
    c = -m[2] / det,
    d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + b * m[5]), -(c * m[4] + d * m[5])];
}

// region: pixel da imagem -> mundo numa matriz so
function regionMatrix(a: any, b: { a: number; b: number; c: number; d: number; worldX: number; worldY: number }, d: Drawing): M {
  const sx = ((a.width ?? d.width) / d.width) * (a.scaleX ?? 1),
    sy = ((a.height ?? d.height) / d.height) * (a.scaleY ?? 1);
  const r = ((a.rotation ?? 0) * Math.PI) / 180;
  const cr = Math.cos(r),
    sr = Math.sin(r);
  // local da region: x = (u - W/2) sx, y = (H/2 - v) sy, girado e deslocado
  const la = cr * sx,
    lb = sr * sy,
    lc = sr * sx,
    ld = -cr * sy;
  const lx = (a.x ?? 0) - la * (d.width / 2) - lb * (d.height / 2),
    ly = (a.y ?? 0) - lc * (d.width / 2) - ld * (d.height / 2);
  return [b.a * la + b.b * lc, b.a * lb + b.b * ld, b.c * la + b.d * lc, b.c * lb + b.d * ld, b.a * lx + b.b * ly + b.worldX, b.c * lx + b.d * ly + b.worldY];
}

// malha: cada triangulo leva as UVs (em pixels da imagem) aos vertices no mundo. Ponto fora da
// malha usa o triangulo mais perto, estendido (a forma pode passar da malha; o que passa nao
// aparece no jogo, so a borda avisa)
function meshMapper(src: Vec[], dst: Vec[], tris: ArrayLike<number>): (x: number, y: number) => Vec {
  return (x, y) => {
    let best = -1,
      bestOut = Infinity,
      bl = [0, 0, 0];
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [src[tris[t]], src[tris[t + 1]], src[tris[t + 2]]];
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
      const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
      const l3 = 1 - l1 - l2;
      const out = -Math.min(l1, l2, l3);
      if (out < bestOut) {
        bestOut = out;
        best = t;
        bl = [l1, l2, l3];
        if (out <= 0) break;
      }
    }
    if (best < 0) return [x, y];
    const [a, b, c] = [dst[tris[best]], dst[tris[best + 1]], dst[tris[best + 2]]];
    return [bl[0] * a[0] + bl[1] * b[0] + bl[2] * c[0], bl[0] * a[1] + bl[1] * b[1] + bl[2] * c[1]];
  };
}

const tmp: number[] = [];

export function mapperFor(v: Viewer, de: DrawEdit, d: Drawing): Mapper | null {
  const j = app.doc?.json;
  const a = j?.skins.find((s: any) => s.name === de.skin)?.attachments?.[de.slot]?.[de.attachment];
  const bn = j?.slots.find((s: any) => s.name === de.slot)?.bone;
  const pose = v.pose;
  if (!a || !bn || !pose) return null;
  if ((a.type ?? "region") === "mesh") {
    const slot = pose.findSlot(de.slot);
    const n = slot ? pose.vertices(slot, tmp) : 0;
    const uvs: number[] = a.uvs ?? [];
    if (!n || n !== uvs.length) return null;
    const img: Vec[] = [],
      wld: Vec[] = [];
    for (let i = 0; i < n; i += 2) {
      img.push([uvs[i] * d.width, uvs[i + 1] * d.height]);
      wld.push([tmp[i], tmp[i + 1]]);
    }
    const tris: number[] = a.triangles ?? [];
    // escala media: raiz da razao das areas
    let aw = 0,
      ai = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const area = (p: Vec[]) => Math.abs((p[tris[t + 1]][0] - p[tris[t]][0]) * (p[tris[t + 2]][1] - p[tris[t]][1]) - (p[tris[t + 2]][0] - p[tris[t]][0]) * (p[tris[t + 1]][1] - p[tris[t]][1]));
      aw += area(wld);
      ai += area(img);
    }
    const hull = Math.max(3, Math.min(img.length, a.hull ?? img.length));
    return { world: meshMapper(img, wld, tris), image: meshMapper(wld, img, tris), k: Math.sqrt(aw / (ai || 1)) * v.cam.zoom, border: [...img.slice(0, hull), img[0]] };
  }
  const b = pose.findBone(bn);
  if (!b) return null;
  const m = regionMatrix(a, b, d);
  const mi = inv(m);
  return {
    world: (u, w) => ap(m, u, w),
    image: (x, y) => ap(mi, x, y),
    k: Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * v.cam.zoom,
    border: [
      [0, 0],
      [d.width, 0],
      [d.width, d.height],
      [0, d.height],
      [0, 0],
    ],
  };
}

// imagem (pixels, y para baixo) -> pixels CSS do canvas do viewport, para desenhar um quadro por
// cima com o Canvas 2D (papel de cebola e o traco ao vivo). So para imagem simples (region).
export function matrizDeTela(v: Viewer, slot: string, attachment: string, image: string): [number, number, number, number, number, number] | null {
  const j = app.doc?.json;
  const d = drawingsOf(j)[image];
  const bn = j?.slots.find((s: any) => s.name === slot)?.bone;
  const a = j?.skins.map((s: any) => s.attachments?.[slot]?.[attachment]).find(Boolean);
  const b = bn ? v.pose?.findBone(bn) : null;
  if (!d || !a || !b || (a.type ?? "region") !== "region") return null;
  const m = regionMatrix(a, b, d);
  const fy = v.flip ? -1 : 1;
  const z = v.cam.zoom;
  const cx = v.canvas.clientWidth / 2,
    cy = v.canvas.clientHeight / 2;
  // mundo (y para cima): W = A (u, v) + t; tela = centro + diag(z, -z) R(giro) (W - cam)
  const c = Math.cos(v.cam.rot),
    s = Math.sin(v.cam.rot);
  const a00 = m[0],
    a01 = m[1],
    a10 = m[2] * fy,
    a11 = m[3] * fy;
  const t0 = m[4] - v.cam.x,
    t1 = m[5] * fy - v.cam.y;
  const r00 = c * a00 - s * a10,
    r01 = c * a01 - s * a11,
    r10 = s * a00 + c * a10,
    r11 = s * a01 + c * a11;
  return [r00 * z, -r10 * z, r01 * z, -r11 * z, cx + (c * t0 - s * t1) * z, cy - (s * t0 + c * t1) * z];
}

// ---- mira

type Aim =
  | { kind: "point"; shape: number; c: number; i: number }
  | { kind: "handle"; shape: number; c: number; i: number; side: "in" | "out" }
  | { kind: "edge"; shape: number; c: number; seg: number; t: number }
  | { kind: "shape"; shape: number }
  | { kind: "none" };

let hitCtx: OffscreenCanvasRenderingContext2D | null = null;

function shapeAt(d: Drawing, u: number, v: number, tol: number): number {
  hitCtx ??= new OffscreenCanvas(1, 1).getContext("2d")!;
  for (let i = d.shapes.length - 1; i >= 0; i--) {
    const s = d.shapes[i];
    if (s.hidden || !s.points.length) continue;
    const p = shapePath(s);
    if (s.fill && hitCtx.isPointInPath(p, u, v, "evenodd")) return i;
    hitCtx.lineWidth = Math.max(s.stroke?.width ?? 0, tol * 2);
    if (hitCtx.isPointInStroke(p, u, v)) return i;
  }
  return -1;
}

function aim(de: DrawEdit, d: Drawing, u: number, w: number, k: number): Aim {
  const sel = de.shape !== null ? d.shapes[de.shape] : null;
  if (sel) {
    const si = de.shape!;
    const cs = contours(sel);
    // alcas primeiro (ficam em cima dos pontos)
    let best: Aim = { kind: "none" },
      bd = HIT_HANDLE / k;
    cs.forEach((ct, c) =>
      ct.points.forEach((p, i) => {
        for (const side of ["in", "out"] as const) {
          const h = p[side];
          if (!h) continue;
          const dd = Math.hypot(p.x + h[0] - u, p.y + h[1] - w);
          if (dd < bd) (bd = dd), (best = { kind: "handle", shape: si, c, i, side });
        }
      }),
    );
    if (best.kind !== "none") return best;
    bd = HIT_POINT / k;
    cs.forEach((ct, c) =>
      ct.points.forEach((p, i) => {
        const dd = Math.hypot(p.x - u, p.y - w);
        if (dd < bd) (bd = dd), (best = { kind: "point", shape: si, c, i });
      }),
    );
    if (best.kind !== "none") return best;
    let be: Aim = { kind: "none" },
      ed = HIT_EDGE / k;
    cs.forEach((ct, c) => {
      const e = nearestOnShape(ct, u, w);
      if (e && e.d < ed) (ed = e.d), (be = { kind: "edge", shape: si, c, seg: e.seg, t: Math.max(0.01, Math.min(0.99, e.t)) });
    });
    if (be.kind !== "none") return be;
  }
  const i = shapeAt(d, u, w, HIT_EDGE / k);
  return i >= 0 ? { kind: "shape", shape: i } : { kind: "none" };
}

// ---- arraste

interface Drag {
  kind: "point" | "handle" | "shape" | "newhandle" | "box";
  merge: string;
  start: Vec; // na imagem
  shape: number;
  c: number;
  i?: number;
  side?: "in" | "out";
  orig?: any;
  alt?: boolean;
  box?: "rect" | "ellipse";
  hole?: boolean;
  moved?: boolean;
}
let drag: Drag | null = null;
let seq = 0;
// clique duplo num ponto: canto <-> suave
let lastClick = { at: 0, shape: -1, c: -1, i: -1 };

const rnd = (x: number) => Math.round(x * 100) / 100;

function toImage(v: Viewer, p: { x: number; y: number }): { u: number; w: number; k: number } | null {
  const c = current();
  if (!c) return null;
  const m = mapperFor(v, c.de, c.d);
  if (!m) return null;
  const [u, w] = m.image(p.x, p.y);
  return { u, w, k: m.k };
}

const img = (de: DrawEdit) => ({ image: de.image });
const contourIn = (s: DrawShape | undefined, c: number): Contour | undefined => (s ? contours(s)[c] : undefined);

// ---- lapis e borracha

// o traco sendo feito: as amostras ja estabilizadas, em pixels da imagem, com a pressao da caneta
// (sem caneta, sem pressao: a largura fica inteira e o estilo so afina as pontas)
interface Traco {
  pontos: Amostra[];
  est: Estabilizador;
  pressao: boolean;
  // amostras da caneta ainda em pixels de tela: o quadro acabou de ser criado e a pose so
  // passa a ter a parte no proximo desenho do viewport
  espera: Cru[];
}
type Cru = { clientX: number; clientY: number; pressure: number; pointerType: string; timeStamp: number };
const cru = (e: Cru): Cru => ({ clientX: e.clientX, clientY: e.clientY, pressure: e.pressure, pointerType: e.pointerType, timeStamp: e.timeStamp });

// passa as amostras para a imagem (as que esperavam primeiro); false = a pose ainda nao esta pronta
function entra(v: Viewer, tr: Traco, novas: Cru[]) {
  tr.espera.push(...novas.map(cru));
  while (tr.espera.length) {
    const a = amostra(v, tr.espera[0]);
    if (!a) return;
    tr.espera.shift();
    tr.pontos.push(tr.est.mover(a));
  }
}
let traco: Traco | null = null;
let apagando: { merge: string } | null = null;

// o traco ao vivo, para desenhar por cima (src/app/Atelie.svelte e drawDrawEdit)
export function tracoVivo(): { image: string; pontos: Amostra[]; pressao: boolean } | null {
  const de = app.drawEdit;
  return traco && de ? { image: de.image, pontos: traco.pontos, pressao: traco.pressao } : null;
}

function amostra(v: Viewer, e: { clientX: number; clientY: number; pressure: number; pointerType: string; timeStamp: number }): Amostra | null {
  const t = toImage(v, v.screenToSkel(e.clientX, e.clientY));
  if (!t) return null;
  return [t.u, t.w, e.pointerType === "pen" ? e.pressure : undefined, e.timeStamp];
}

// ---- pincel (raster): as amostras vao para o pintor (src/app/pintura.ts)

export const RASTER: Record<string, Ferramenta> = { brush: "pintar", rubber: "apagar", smudge: "borrar" };
type CruP = Cru & { altitudeAngle?: number; azimuthAngle?: number; tiltX?: number; tiltY?: number };
const cruP = (e: CruP): CruP => ({ ...cru(e), altitudeAngle: e.altitudeAngle, azimuthAngle: e.azimuthAngle, tiltX: e.tiltX, tiltY: e.tiltY });
interface Pincelada {
  ferramenta: Ferramenta;
  ponteiro: "caneta" | "borracha" | "mouse" | "dedo";
  image: string;
  comecou: boolean;
  // amostras ainda em pixels de tela (o quadro recem-criado so entra na pose no proximo desenho)
  espera: CruP[];
}
let pincelada: Pincelada | null = null;

// a amostra da caneta em pixels da imagem, com a pressao e a inclinacao (radianos a partir de em pe)
function amostraPincel(v: Viewer, e: CruP): AmostraPincel | null {
  const t = toImage(v, v.screenToSkel(e.clientX, e.clientY));
  if (!t) return null;
  let inclina = 0,
    direcao = 0;
  if (e.pointerType === "pen") {
    if (typeof e.altitudeAngle === "number" && typeof e.azimuthAngle === "number") {
      inclina = Math.PI / 2 - e.altitudeAngle;
      direcao = e.azimuthAngle;
    } else if (e.tiltX || e.tiltY) {
      const tx = Math.tan(((e.tiltX ?? 0) * Math.PI) / 180),
        ty = Math.tan(((e.tiltY ?? 0) * Math.PI) / 180);
      inclina = Math.atan(Math.hypot(tx, ty));
      direcao = Math.atan2(ty, tx);
    }
  }
  // a direcao da caneta e na tela; na imagem, conta o giro da tela
  direcao += v.cam.rot;
  return [rnd(t.u), rnd(t.w), e.pointerType === "pen" ? Math.round(e.pressure * 1000) / 1000 : 0.5, Math.round(e.timeStamp * 10) / 10, Math.round(inclina * 1000) / 1000, Math.round(direcao * 1000) / 1000];
}

function alimentar(v: Viewer, novas: CruP[]) {
  const p = pincelada;
  if (!p) return;
  p.espera.push(...novas.map(cruP));
  const prontas: AmostraPincel[] = [];
  while (p.espera.length) {
    const a = amostraPincel(v, p.espera[0]);
    if (!a) break;
    p.espera.shift();
    prontas.push(a);
  }
  if (!prontas.length) return;
  if (!p.comecou) {
    if (!pinceladaComeca(p.image, p.ferramenta, p.ponteiro, prontas.splice(0, 1))) {
      pincelada = null;
      return;
    }
    p.comecou = true;
  }
  pinceladaSegue(prontas);
}

// o balde: em cima de uma forma vetorial troca a cor dela; fora, enche a tinta por baixo das linhas
function baldeEm(image: string, u: number, w: number) {
  const d = drawingsOf(app.doc?.json)[image];
  if (!d) return;
  const cor = app.lapis.color;
  const i = shapeAt(d, u, w, 0.5);
  const s = i >= 0 ? d.shapes[i] : null;
  if (s) {
    hitCtx ??= new OffscreenCanvas(1, 1).getContext("2d")!;
    const noMiolo = !!s.fill && hitCtx.isPointInPath(shapePath(s), u, w, "evenodd");
    app.run({ cmd: "draw.set", args: { image, shape: i, ...(noMiolo ? { fill: cor } : { stroke: { color: cor } }) } }, `balde em ${s.name}`);
    return;
  }
  if (!balde(image, u, w, cor, app.lapis.limiar)) app.toast("O balde não achou o que encher aqui.");
}
ganchos.vetorMudou = () => cobrir();

function apagarEm(de: DrawEdit, d: Drawing, u: number, w: number, k: number) {
  const i = shapeAt(d, u, w, 4 / k);
  if (i < 0 || !apagando) return;
  app.run({ cmd: "draw.remove", args: { image: de.image, shape: i } }, `apaga ${d.shapes[i].name}`, undefined, true);
  de.shape = de.point = de.pen = null;
}

function fecharTraco() {
  const de = app.drawEdit;
  const tr = traco;
  traco = null;
  if (!de || !tr) return;
  const pontos = [...tr.pontos, ...tr.est.soltar()];
  if (!pontos.length) return;
  const l = app.lapis;
  const args: any = { image: de.image, points: pontos.map((q) => (tr.pressao ? [rnd(q[0]), rnd(q[1]), Math.round((q[2] ?? 1) * 1000) / 1000] : [rnd(q[0]), rnd(q[1])])), width: l.width, color: l.color, style: l.estilo in ESTILOS ? l.estilo : "lapis", smooth: l.suavizar };
  if (l.mancha) (args.fill = l.color), (args.stroke = false);
  // o traco e o crescer da imagem ate ele num passo so de desfazer
  app.run([{ cmd: "draw.freehand", args }, { cmd: "draw.cover", args: { image: de.image } }], l.mancha ? "mancha" : "traço");
  // numa folha com pintura o draw.cover nao cresce: o cobrir cresce com os pixels
  if (drawingsOf(app.doc?.json)[de.image]?.raster) cobrir();
}

export function drawDown(v: Viewer, p: { x: number; y: number }, mods: { shift: boolean; alt: boolean }, e?: PointerEvent): boolean {
  const c = current();
  const t = toImage(v, p);
  // pincel, borracha de tinta e borrar: a pincelada vai para o pintor
  if (c && e && RASTER[c.de.tool]) {
    if (pincelada) return true;
    v.view.playing = false;
    const borr = e.pointerType === "pen" && (e.buttons & 32) !== 0;
    pincelada = { ferramenta: borr ? "apagar" : RASTER[c.de.tool], ponteiro: e.pointerType === "pen" ? (borr ? "borracha" : "caneta") : e.pointerType === "touch" ? "dedo" : "mouse", image: c.de.image, comecou: false, espera: [] };
    c.de.shape = c.de.point = c.de.pen = null;
    alimentar(v, [e]);
    return true;
  }
  // balde e laco (src/app/retoque.ts)
  if (c && (c.de.tool === "bucket" || c.de.tool === "lasso")) {
    v.view.playing = false;
    c.de.shape = c.de.point = c.de.pen = null;
    if (c.de.tool === "lasso") {
      if (t) lacoDown(c.de.image, t.u, t.w, t.k);
      return true;
    }
    // (o quadro recem-criado so entra na pose no proximo desenho: o balde espera por ele)
    const image = c.de.image;
    const enche = (falta: number) => {
      const agora = app.drawEdit?.image === image ? toImage(v, p) : null;
      if (agora) return void baldeEm(image, agora.u, agora.w);
      if (falta > 0 && app.drawEdit?.image === image) requestAnimationFrame(() => enche(falta - 1));
    };
    enche(4);
    return true;
  }
  if (c && !t && e && c.de.tool === "pencil" && c.de.quadro) {
    traco = { pontos: [], est: new Estabilizador(app.lapis.estabilizar), pressao: e.pointerType === "pen", espera: [cru(e)] };
    return true;
  }
  if (!c || !t) return false;
  const { de, d } = c;
  const { u, w, k } = t;
  v.view.playing = false;
  // a borracha da caneta (o botao de tras) apaga com qualquer ferramenta de desenhar
  const borracha = de.tool === "eraser" || (!!e && e.pointerType === "pen" && (e.buttons & 32) !== 0);
  if (borracha) {
    apagando = { merge: `borracha${++seq}` };
    apagarEm(de, d, u, w, k);
    return true;
  }
  if (de.tool === "pencil") {
    const a: Amostra = e ? (amostra(v, e) ?? [u, w]) : [u, w];
    const est = new Estabilizador(app.lapis.estabilizar);
    traco = { pontos: [est.mover(a)], est, pressao: a[2] !== undefined, espera: [] };
    de.shape = de.point = de.pen = null;
    return true;
  }
  // a caneta perdida (desfazer, forma apagada, contorno ja fechado): recomeca
  if (de.pen !== null) {
    const ct = contourIn(d.shapes[de.pen], de.penContour);
    if (!ct || ct.closed) de.pen = null;
  }
  // furo precisa de uma forma escolhida
  const furo = de.hole && de.shape !== null && !!d.shapes[de.shape];
  if (de.hole && !furo && de.tool !== "select") {
    app.toast("Escolha a forma que vai ser furada (ferramenta Selecionar) e desenhe o furo nela.");
    return true;
  }

  if (de.tool === "rect" || de.tool === "ellipse") {
    drag = { kind: "box", merge: `forma${++seq}`, start: [u, w], shape: furo ? de.shape! : d.shapes.length, c: 0, box: de.tool, hole: furo };
    return true;
  }

  if (de.tool === "pen") {
    if (de.pen !== null) {
      const s = d.shapes[de.pen];
      const ct = contourIn(s, de.penContour)!;
      const f = ct.points[0];
      // no primeiro ponto: fecha (sem preenchimento, a forma ganha o cinza do Figma)
      if (ct.points.length >= 2 && Math.hypot(f.x - u, f.y - w) < HIT_POINT / k) {
        const args: any = { ...img(de), shape: de.pen, contour: de.penContour, closed: true };
        if (!s.fill && de.penContour === 0) args.fill = "d9d9d9ff";
        app.run({ cmd: "draw.set", args }, de.penContour ? `fecha o furo de ${s.name}` : `fecha ${s.name}`);
        de.shape = de.pen;
        de.contour = de.penContour;
        de.point = 0;
        drag = { kind: "newhandle", merge: `alca${++seq}`, start: [f.x, f.y], shape: de.pen, c: de.penContour, i: 0, orig: structuredClone(f) };
        de.pen = null;
        return true;
      }
      const n = ct.points.length;
      if (!app.run({ cmd: "draw.point", args: { ...img(de), shape: de.pen, contour: de.penContour, index: n, insert: true, x: rnd(u), y: rnd(w) } }, `ponto em ${s.name}`)) return true;
      de.shape = de.pen;
      de.contour = de.penContour;
      de.point = n;
      drag = { kind: "newhandle", merge: `alca${++seq}`, start: [rnd(u), rnd(w)], shape: de.pen, c: de.penContour, i: n, orig: { x: rnd(u), y: rnd(w) } };
      return true;
    }
    const a = aim(de, d, u, w, k);
    // no lado da forma escolhida: um ponto novo ali, sem mudar o desenho
    if (a.kind === "edge") {
      const r = app.run({ cmd: "draw.split", args: { ...img(de), shape: a.shape, contour: a.c, seg: a.seg, t: a.t } }, `ponto novo em ${d.shapes[a.shape].name}`);
      if (r?.[0]) {
        de.point = r[0].index;
        de.contour = a.c;
        const q = contourIn(drawingsOf(app.doc!.json)[de.image].shapes[a.shape], a.c)!.points[r[0].index];
        drag = { kind: "point", merge: `ponto${++seq}`, start: [u, w], shape: a.shape, c: a.c, i: r[0].index, orig: structuredClone(q) };
      }
      return true;
    }
    if (a.kind === "point") {
      const ct = contourIn(d.shapes[a.shape], a.c)!;
      de.point = a.i;
      de.contour = a.c;
      // no ultimo ponto de um contorno aberto: continua dele
      if (!ct.closed && a.i === ct.points.length - 1) {
        de.pen = a.shape;
        de.penContour = a.c;
        return true;
      }
      // num ponto da forma escolhida: escolhe e arrasta (nao comeca outro caminho em cima dele)
      drag = { kind: "point", merge: `ponto${++seq}`, start: [u, w], shape: a.shape, c: a.c, i: a.i, orig: structuredClone(ct.points[a.i]) };
      return true;
    }
    if (a.kind === "handle") {
      de.point = a.i;
      de.contour = a.c;
      drag = { kind: "handle", merge: `alca${++seq}`, start: [u, w], shape: a.shape, c: a.c, i: a.i, side: a.side, orig: structuredClone(contourIn(d.shapes[a.shape], a.c)!.points[a.i]), alt: mods.alt };
      return true;
    }
    // caminho novo: um furo da forma escolhida ou uma forma nova
    if (furo) {
      const r = app.run({ cmd: "draw.hole", args: { ...img(de), shape: de.shape, points: [{ x: rnd(u), y: rnd(w) }] } }, `furo em ${d.shapes[de.shape!].name}`);
      if (r?.[0]) {
        de.pen = de.shape;
        de.penContour = de.contour = r[0].contour;
        de.point = 0;
        drag = { kind: "newhandle", merge: `alca${++seq}`, start: [rnd(u), rnd(w)], shape: de.shape!, c: r[0].contour, i: 0, orig: { x: rnd(u), y: rnd(w) } };
      }
      return true;
    }
    const r = app.run({ cmd: "draw.shape", args: { ...img(de), name: "caminho", points: [{ x: rnd(u), y: rnd(w) }], stroke: { color: "000000ff", width: 2 } } }, `caminho novo em ${de.image}`);
    if (r?.[0]) {
      const at = r[0].added[0].index;
      de.pen = de.shape = at;
      de.penContour = de.contour = 0;
      de.point = 0;
      drag = { kind: "newhandle", merge: `alca${++seq}`, start: [rnd(u), rnd(w)], shape: at, c: 0, i: 0, orig: { x: rnd(u), y: rnd(w) } };
    }
    return true;
  }

  // selecionar
  const a = aim(de, d, u, w, k);
  if (a.kind === "handle") {
    de.point = a.i;
    de.contour = a.c;
    drag = { kind: "handle", merge: `alca${++seq}`, start: [u, w], shape: a.shape, c: a.c, i: a.i, side: a.side, orig: structuredClone(contourIn(d.shapes[a.shape], a.c)!.points[a.i]), alt: mods.alt };
    return true;
  }
  if (a.kind === "point") {
    const now = performance.now();
    const q = contourIn(d.shapes[a.shape], a.c)!.points[a.i];
    if (now - lastClick.at < 350 && lastClick.shape === a.shape && lastClick.c === a.c && lastClick.i === a.i) {
      app.run({ cmd: "draw.point", args: { ...img(de), shape: a.shape, contour: a.c, index: a.i, smooth: !(q.in || q.out) } }, q.in || q.out ? "ponto vira canto" : "ponto vira curva");
      lastClick.at = 0;
      return true;
    }
    lastClick = { at: now, shape: a.shape, c: a.c, i: a.i };
    de.point = a.i;
    de.contour = a.c;
    drag = { kind: "point", merge: `ponto${++seq}`, start: [u, w], shape: a.shape, c: a.c, i: a.i, orig: structuredClone(q) };
    return true;
  }
  if (a.kind === "edge" || a.kind === "shape") {
    if (de.shape !== a.shape) de.point = null;
    de.shape = a.shape;
    drag = { kind: "shape", merge: `forma${++seq}`, start: [u, w], shape: a.shape, c: 0 };
    return true;
  }
  de.shape = null;
  de.point = null;
  return true;
}

export function drawMove(v: Viewer, p: { x: number; y: number }, mods: { shift: boolean; alt: boolean }, e?: PointerEvent) {
  const c = current();
  const t = toImage(v, p);
  if (pincelada) {
    if (e) alimentar(v, e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]);
    return;
  }
  if (retocando()) {
    if (t) lacoMove(t.u, t.w, t.k, mods.shift, mods.alt);
    return;
  }
  if (traco && c) {
    // todas as amostras da caneta desde o ultimo quadro (a mesa manda mais de uma por quadro)
    if (e) entra(v, traco, e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]);
    else if (t) traco.pontos.push(traco.est.mover([t.u, t.w]));
    return;
  }
  if (apagando && c && t) return apagarEm(c.de, c.d, t.u, t.w, t.k);
  if (!drag || !c || !t) return;
  const { de } = c;
  let du = t.u - drag.start[0],
    dw = t.w - drag.start[1];
  if (!drag.moved && Math.hypot(du, dw) * t.k < 2) return;
  drag.moved = true;
  const s = c.d.shapes[drag.shape];
  if (drag.kind === "box") {
    let [x0, y0] = drag.start;
    // Shift: quadrado / circulo; Alt: a partir do centro
    if (mods.shift) {
      const m = Math.max(Math.abs(du), Math.abs(dw));
      du = Math.sign(du || 1) * m;
      dw = Math.sign(dw || 1) * m;
    }
    if (mods.alt) (x0 -= du), (y0 -= dw), (du *= 2), (dw *= 2);
    const x = Math.min(x0, x0 + du),
      y = Math.min(y0, y0 + dw);
    const W = Math.max(1, Math.abs(du)),
      H = Math.max(1, Math.abs(dw));
    const geo = drag.box === "rect" ? { rect: [rnd(x), rnd(y), rnd(W), rnd(H)] } : { ellipse: [rnd(x + W / 2), rnd(y + H / 2), rnd(W / 2), rnd(H / 2)] };
    if (drag.hole) {
      const r = app.run({ cmd: "draw.hole", args: { ...img(de), shape: drag.shape, ...geo } }, `furo em ${s?.name}`, drag.merge, true);
      if (r?.[0]) (de.contour = r[0].contour), (de.point = null);
      return;
    }
    const r = app.run({ cmd: "draw.shape", args: { ...img(de), ...geo, fill: "d9d9d9ff" } }, drag.box === "rect" ? "retângulo" : "elipse", drag.merge, true);
    if (r?.[0]) {
      de.shape = r[0].added[0].index;
      de.point = null;
    }
    return;
  }
  if (!s) return;
  if (drag.kind === "shape") {
    if (mods.shift) Math.abs(du) > Math.abs(dw) ? (dw = 0) : (du = 0);
    app.run({ cmd: "draw.move", args: { ...img(de), shapes: [drag.shape], dx: rnd(du), dy: rnd(dw) } }, `move ${s.name}`, drag.merge, true);
    return;
  }
  const at = { ...img(de), shape: drag.shape, contour: drag.c, index: drag.i };
  if (drag.kind === "point") {
    if (mods.shift) Math.abs(du) > Math.abs(dw) ? (dw = 0) : (du = 0);
    app.run({ cmd: "draw.point", args: { ...at, x: rnd(drag.orig.x + du), y: rnd(drag.orig.y + dw) } }, `move ponto ${drag.i} de ${s.name}`, drag.merge, true);
    return;
  }
  // alca: arrastar uma alca move a outra em espelho (mesma direcao, comprimento dela), Alt
  // solta as duas; a alca nova (caneta) sai simetrica
  const q = drag.orig;
  if (drag.kind === "newhandle") {
    const h: Vec = [rnd(t.u - q.x), rnd(t.w - q.y)];
    const args: any = { ...at, out: h, in: [-h[0], -h[1]] };
    if (mods.alt) delete args.in;
    app.run({ cmd: "draw.point", args }, `curva no ponto ${drag.i} de ${s.name}`, drag.merge, true);
    return;
  }
  const side = drag.side!;
  const other = side === "in" ? "out" : "in";
  const h0 = q[side] as Vec;
  const h: Vec = [rnd(h0[0] + du), rnd(h0[1] + dw)];
  const args: any = { ...at, [side]: h };
  const o = q[other] as Vec | undefined;
  if (o && !drag.alt && !mods.alt) {
    const lo = Math.hypot(o[0], o[1]),
      lh = Math.hypot(h[0], h[1]) || 1;
    args[other] = [rnd((-h[0] / lh) * lo), rnd((-h[1] / lh) * lo)];
  }
  app.run({ cmd: "draw.point", args }, `alça do ponto ${drag.i} de ${s.name}`, drag.merge, true);
}

export function drawUp() {
  const de = app.drawEdit;
  if (pincelada) {
    if (app.viewer) alimentar(app.viewer, []);
    const comecou = pincelada.comecou;
    pincelada = null;
    if (comecou) pinceladaTermina();
    return;
  }
  if (retocando()) {
    if (de) lacoUp(de.image);
    return;
  }
  if (traco) {
    if (traco.espera.length && app.viewer) entra(app.viewer, traco, []);
    fecharTraco();
    return;
  }
  if (apagando) {
    apagando = null;
    return;
  }
  // retangulo ou elipse feitos: volta para selecionar, como no Figma
  if (drag?.kind === "box" && de && drag.moved) de.tool = "select";
  const gesto = drag !== null;
  drag = null;
  if (gesto) cobrir();
}

export function drawDragging() {
  return drag !== null || traco !== null || apagando !== null || pincelada !== null || retocando();
}

// ---- teclado

export function drawKey(e: KeyboardEvent): boolean {
  const de = app.drawEdit;
  const c = current();
  if (!de || !c) return false;
  const k = e.key;
  const mod = e.ctrlKey || e.metaKey;
  if (mod) return false;
  // no atelie, R e F14 giram a tela (src/app/atelie.ts), como no ProCraft
  if (app.atelie && (k === "r" || k === "R" || k === "F14")) return false;
  // o laco: Enter assenta o pedaco, Esc devolve (ou tira a selecao), Delete apaga o que esta dentro
  if (selecao() && (k === "Enter" || k === "Escape")) {
    if (k === "Enter") soltar();
    else if (temSolto()) desistir();
    else semSelecao();
    return true;
  }
  if (selecao() && (k === "Delete" || k === "Backspace")) {
    apagarSelecao();
    return true;
  }
  // no atelie, Enter sem caminho aberto toca a animacao (src/app/Atelie.svelte)
  if (k === "Enter" && de.pen === null && de.quadro) return false;
  if ((k === "h" || k === "H") && selecao()) {
    espelhar(e.shiftKey);
    return true;
  }
  if (k === "t" || k === "T") {
    if (selecionarTudo(de.image)) de.tool = "lasso";
    else app.toast("Este quadro ainda está vazio.");
    return true;
  }
  if (k === "Escape" || k === "Enter") {
    if (de.pen !== null) de.pen = null;
    else if (k === "Escape" && de.hole) de.hole = false;
    else if (k === "Escape" && de.point !== null) de.point = null;
    else if (k === "Escape" && de.shape !== null) de.shape = null;
    else if (k === "Escape" && !de.quadro) stopDrawEdit();
    return true;
  }
  // B: o pincel (pintura); E: a borracha da familia em uso (tinta com o pincel, traco com o lapis)
  const pintando = !!RASTER[de.tool];
  const tools: Record<string, DrawEdit["tool"]> = { v: "select", p: "pen", r: "rect", o: "ellipse", l: "pencil", b: "brush", e: pintando ? "rubber" : "eraser", s: "smudge", g: "bucket", q: "lasso" };
  // [ e ]: o tamanho do pincel ou a largura do lapis
  if ((k === "[" || k === "]") && pintando) {
    const f = RASTER[de.tool];
    app.pincel.tamanho[f] = Math.max(0.01, Math.min(1, Math.round((app.pincel.tamanho[f] + (k === "]" ? 0.03 : -0.03)) * 100) / 100));
    app.guardarPincel();
    return true;
  }
  if (k === "[" || k === "]") {
    const l = app.lapis;
    const passo = l.width < 4 ? 0.5 : l.width < 12 ? 1 : l.width < 40 ? 2 : 5;
    l.width = Math.max(0.5, Math.min(200, l.width + (k === "]" ? passo : -passo)));
    app.guardarLapis();
    return true;
  }
  if (tools[k.toLowerCase()]) {
    de.tool = tools[k.toLowerCase()];
    // a selecao continua nas ferramentas de pixels (o pincel e o balde respeitam o laco)
    if (de.tool !== "lasso" && de.tool !== "bucket" && !RASTER[de.tool]) semSelecao();
    if (de.tool !== "pen") de.pen = null;
    return true;
  }
  if ((k === "Delete" || k === "Backspace") && de.shape !== null) {
    const s = c.d.shapes[de.shape];
    if (!s) return true;
    const ct = contourIn(s, de.contour);
    if (de.point !== null && ct?.points[de.point]) {
      const n = ct.points.length;
      if (de.contour === 0 && n <= 1) {
        app.run({ cmd: "draw.remove", args: { ...img(de), shape: de.shape } }, `apaga ${s.name}`);
        de.shape = de.point = de.pen = null;
      } else {
        app.run({ cmd: "draw.point", args: { ...img(de), shape: de.shape, contour: de.contour, index: de.point, remove: true } }, `apaga ponto de ${s.name}`);
        // furo que ficou sem pontos some (o comando tira); a escolha volta ao principal
        if (de.contour > 0 && n <= 2) (de.contour = 0), (de.point = null);
        else de.point = n > 1 ? Math.max(0, de.point - 1) : null;
      }
    } else {
      app.run({ cmd: "draw.remove", args: { ...img(de), shape: de.shape } }, `apaga ${s.name}`);
      de.shape = de.point = de.pen = null;
    }
    return true;
  }
  if (k.startsWith("Arrow") && de.shape !== null) {
    const step = e.shiftKey ? 10 : 1;
    const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0,
      dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
    app.run({ cmd: "draw.move", args: { ...img(de), shapes: [de.shape], ...(de.point !== null ? { points: [de.point], contour: de.contour } : {}), dx, dy } }, "empurra", `seta-${de.shape}-${de.contour}-${de.point}`);
    cobrir();
    return true;
  }
  return false;
}

// a linha de ajuda do modo
export function drawHelp(): string {
  const de = app.drawEdit;
  if (!de) return "";
  if (de.tool === "pencil") return "arraste para desenhar · [ e ] mudam a largura · a pressão da caneta engrossa o traço · E: borracha · V: escolher e ajustar os pontos";
  if (de.tool === "eraser") return "arraste por cima dos traços para apagar · L: lápis";
  if (de.tool === "bucket") return "clique numa área fechada para encher de cor (por baixo das linhas) · em cima de uma forma vetorial, troca a cor dela · com laço, enche só dentro dele";
  if (de.tool === "lasso") return selecao() ? "arraste dentro para mover · os cantos esticam (Shift: por igual; Alt: do centro) · os lados esticam numa direção · passar do outro lado espelha · H espelha, Shift+H de cabeça para baixo · a bolinha de cima gira (Shift: de 15 em 15°) · Enter assenta · Esc devolve · Delete apaga" : "contorne o que quer mexer · T escolhe o quadro inteiro";
  if (de.tool === "brush") return "pinte com a caneta · [ e ] mudam o tamanho · E: borracha de tinta · S: borrar · L: lápis vetorial";
  if (de.tool === "rubber") return "apague a tinta com a caneta · [ e ] mudam o tamanho · B: pincel";
  if (de.tool === "smudge") return "arraste para borrar a tinta · [ e ] mudam o tamanho · B: pincel";
  if (de.hole && de.tool !== "select") return de.shape === null ? "modo furo: escolha antes a forma que vai ser furada" : "modo furo: o que você desenhar agora fura a forma escolhida · Esc sai do modo furo";
  if (de.tool === "pen")
    return de.pen !== null ? "clique põe ponto · arrastar faz curva (Alt: só um lado) · clique no primeiro ponto fecha · Enter ou Esc termina" : "clique começa um caminho · no lado da forma escolhida, põe um ponto · no fim de um caminho aberto, continua";
  if (de.tool === "rect" || de.tool === "ellipse") return "arraste para desenhar · Shift: proporção igual · Alt: do centro";
  return "clique escolhe a forma · arraste move · pontos e alças da forma escolhida · clique duplo no ponto: canto ↔ curva · Alt na alça solta as duas · Delete apaga · setas empurram";
}

// ---- desenho por cima

const C = {
  frame: new Color(1, 1, 1, 0.35),
  sel: new Color(0.05, 0.6, 1, 1),
  hover: new Color(0.05, 0.6, 1, 0.55),
  handle: new Color(0.05, 0.6, 1, 0.85),
  white: new Color(1, 1, 1, 1),
  pen: new Color(1, 0.18, 0.53, 1),
};

export function drawDrawEdit(v: Viewer) {
  const c = current();
  if (!c) return;
  const { de, d } = c;
  const m = mapperFor(v, de, d);
  if (!m) return;
  const s = v.scene;
  const z = v.cam.zoom;
  const fy = v.flip ? -1 : 1;
  const W = (u: number, w: number): Vec => {
    const p = m.world(u, w);
    return [p[0], p[1] * fy];
  };
  const poly = (pts: Vec[], col: Color, thick = 1) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = W(pts[i][0], pts[i][1]),
        b = W(pts[i + 1][0], pts[i + 1][1]);
      s.line(a[0], a[1], b[0], b[1], col);
      if (thick > 1) {
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * (0.8 / z),
          ny = (dx / l) * (0.8 / z);
        s.line(a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, col);
      }
    }
  };
  // a borda da imagem (ou da malha: fora dela o desenho nao aparece)
  poly(m.border, C.frame);
  const k = m.k;
  const step = 2 / k;
  const t = cursor.inside ? toImage(v, { x: cursor.x, y: v.flip ? -cursor.y : cursor.y }) : null;
  const hover = t && !drag ? aim(de, d, t.u, t.w, k) : ({ kind: "none" } as Aim);
  if ((hover.kind === "shape" || hover.kind === "edge") && hover.shape !== de.shape && de.tool === "select") {
    const hs = d.shapes[hover.shape];
    if (hs) for (const ct of contours(hs)) poly(flatten(ct, step), C.hover, 2);
  }
  const sel = de.shape !== null ? d.shapes[de.shape] : null;
  if (sel) {
    const cs = contours(sel);
    for (const ct of cs) poly(flatten(ct, step), C.sel, 2);
    cs.forEach((ct, ci) => {
      ct.points.forEach((q: any, i) => {
        for (const side of ["in", "out"] as const) {
          const h = q[side];
          if (!h) continue;
          const a = W(q.x, q.y),
            b = W(q.x + h[0], q.y + h[1]);
          s.line(a[0], a[1], b[0], b[1], C.handle);
          const hot = hover.kind === "handle" && hover.c === ci && hover.i === i && hover.side === side;
          s.circle(true, b[0], b[1], (hot ? 4.5 : 3.5) / z, C.handle, 12);
          s.circle(true, b[0], b[1], (hot ? 3 : 2) / z, C.white, 12);
        }
      });
      ct.points.forEach((q, i) => {
        const chosen = ci === de.contour && i === de.point;
        const hot = hover.kind === "point" && hover.c === ci && hover.i === i;
        const r = chosen ? 4.5 : hot ? 4.2 : 3.4;
        const p = W(q.x, q.y);
        s.circle(true, p[0], p[1], (r + 1.5) / z, C.sel, 14);
        s.circle(true, p[0], p[1], r / z, chosen ? C.sel : C.white, 14);
      });
    });
    // previa do ponto que o clique na borda criaria
    if (hover.kind === "edge" && de.tool === "pen") {
      const e = nearestOnShape(cs[hover.c], t!.u, t!.w);
      if (e) {
        const p = W(e.at[0], e.at[1]);
        s.circle(false, p[0], p[1], 6 / z, C.pen, 16);
        s.line(p[0] - 4 / z, p[1], p[0] + 4 / z, p[1], C.pen);
        s.line(p[0], p[1] - 4 / z, p[0], p[1] + 4 / z, C.pen);
      }
    }
  }
  // caneta: o proximo trecho seguindo o cursor
  if (de.tool === "pen" && de.pen !== null && t && !drag) {
    const ct = contourIn(d.shapes[de.pen], de.penContour);
    const last = ct?.points[ct.points.length - 1];
    if (ct && last) {
      const f = ct.points[0];
      const fecha = ct.points.length >= 2 && Math.hypot(f.x - t.u, f.y - t.w) < HIT_POINT / k;
      const end: Vec = fecha ? [f.x, f.y] : [t.u, t.w];
      poly(flatten({ points: [{ x: last.x, y: last.y, out: last.out }, { x: end[0], y: end[1], in: fecha ? f.in : undefined }], closed: false }, step), C.pen);
      if (fecha) {
        const p = W(f.x, f.y);
        s.circle(false, p[0], p[1], 7 / z, C.pen, 18);
      }
    }
  }
  // o laco em andamento, a selecao e a caixa dela
  if (selecao() && selecao()!.image !== de.image) limparRetoque();
  if (temSolto() && de.tool !== "lasso") soltar();
  const lc = lacando();
  if (lc && lc.length > 1) poly(lc, C.pen, 2);
  const cs = contornoDaSelecao();
  if (cs && selecao()?.image === de.image) {
    poly([...cs, cs[0]], C.white, 2);
    const cx = de.tool === "lasso" ? caixaDaSelecao(k) : null;
    if (cx) {
      poly([...cx.cantos, cx.cantos[0]], C.sel);
      const topo = W((cx.cantos[0][0] + cx.cantos[1][0]) / 2, (cx.cantos[0][1] + cx.cantos[1][1]) / 2);
      const g = W(cx.gira[0], cx.gira[1]);
      s.line(topo[0], topo[1], g[0], g[1], C.sel);
      s.circle(true, g[0], g[1], 5.5 / z, C.sel, 16);
      s.circle(true, g[0], g[1], 3.5 / z, C.white, 16);
      for (const q of cx.cantos) {
        const p = W(q[0], q[1]);
        s.circle(true, p[0], p[1], 5.5 / z, C.sel, 16);
        s.circle(true, p[0], p[1], 3.5 / z, C.white, 16);
      }
      // os meios dos lados esticam so numa direcao
      for (const q of cx.lados) {
        const p = W(q[0], q[1]);
        s.circle(true, p[0], p[1], 4.5 / z, C.sel, 4);
        s.circle(true, p[0], p[1], 2.8 / z, C.white, 4);
      }
    }
  }
  if (t && de.tool === "bucket") {
    const p = W(t.u, t.w);
    s.line(p[0] - 6 / z, p[1], p[0] + 6 / z, p[1], C.white);
    s.line(p[0], p[1] - 6 / z, p[0], p[1] + 6 / z, C.white);
    s.circle(false, p[0], p[1], 3 / z, C.pen, 12);
  }
  // o lapis: o circulo do tamanho da ponta; a borracha: um quadradinho
  if (t && de.tool === "pencil") {
    const p = W(t.u, t.w);
    s.circle(false, p[0], p[1], Math.max(1.5, (app.lapis.width / 2) * k) / z, C.pen, 24);
  }
  if (t && de.tool === "eraser") {
    const p = W(t.u, t.w);
    const r = 5 / z;
    s.line(p[0] - r, p[1] - r, p[0] + r, p[1] - r, C.white);
    s.line(p[0] + r, p[1] - r, p[0] + r, p[1] + r, C.white);
    s.line(p[0] + r, p[1] + r, p[0] - r, p[1] + r, C.white);
    s.line(p[0] - r, p[1] + r, p[0] - r, p[1] - r, C.white);
  }
  // cursor da caneta e das formas (no modo furo, um circulo cortado)
  if (t && (de.tool === "rect" || de.tool === "ellipse" || (de.tool === "pen" && hover.kind !== "edge"))) {
    const p = W(t.u, t.w);
    s.line(p[0] - 5 / z, p[1], p[0] + 5 / z, p[1], C.pen);
    s.line(p[0], p[1] - 5 / z, p[0], p[1] + 5 / z, C.pen);
    if (de.hole) {
      s.circle(false, p[0] + 9 / z, p[1] - 9 / z, 4 / z, C.pen, 12);
      s.line(p[0] + 6 / z, p[1] - 6 / z, p[0] + 12 / z, p[1] - 12 / z, C.pen);
    }
  }
}
