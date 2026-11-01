// Manipulacao direta no viewport: selecionar clicando na imagem, arrastar para
// mover/girar/esticar. Com uma animacao aberta cada arrasto vira chave no tempo atual; na Pose base muda o setup.
// A pose lida aqui (mundo dos ossos, vertices, ordem) vem de `viewer.pose`: o spine-core nos
// modos "godot" e "spine", o nucleo no modo "nucleo" (src/render/pose.ts).
import { Color } from "@esotericsoftware/spine-webgl";
import type { Viewer } from "../render/viewer.ts";
import { toParent, type PoseView, type SlotView } from "../render/pose.ts";
import { app } from "./state.svelte.ts";
import { isEffect } from "../core/model.ts";

export type Tool = "move" | "rotate" | "scale";

const tmp: number[] = [];

// Slot cuja imagem esta sob o ponto (da frente para tras). Camadas de brilho
// (blend aditivo/screen) so sao escolhidas se nada solido estiver sob o ponto:
// costumam cobrir o personagem e roubariam o clique.
export function pickSlot(pose: PoseView, x: number, y: number): string | null {
  return pickPart(pose, x, y)?.slot ?? null;
}

// Parte sob o ponto e o osso que de fato a move ali. Numa malha com pesos o slot pode
// estar preso a um osso (a raiz do personagem) e quem dobra a imagem ser outro (o braco): vale o
// osso que mais puxa os tres vertices do triangulo clicado, pesados pela distancia.
export function pickPart(pose: PoseView, x: number, y: number, hidden?: (slot: SlotView) => boolean): { slot: string; bone: string } | null {
  return pickSlotPass(pose, x, y, false, hidden) ?? pickSlotPass(pose, x, y, true, hidden);
}

// Osso que move a imagem do slot: o dono do slot, ou numa malha com pesos o que mais puxa
// (no triangulo tri com pesos bary, ou na malha inteira)
export function movingBone(pose: PoseView, slotName: string, tri?: number[], bary?: number[]): string {
  const slot = pose.findSlot(slotName);
  if (!slot) return "";
  const k = slot.part?.kind;
  const per = k === "mesh" || k === "linkedmesh" ? pose.weights(slot) : null;
  if (!per) return slot.bone.name;
  const sum = new Map<number, number>();
  const add = (vi: number, f: number) => per[vi]?.forEach(([b, w]) => sum.set(b, (sum.get(b) ?? 0) + w * f));
  if (tri) tri.forEach((vi, k) => add(vi, bary?.[k] ?? 1));
  else per.forEach((_, vi) => add(vi, 1));
  let best = -1,
    bw = -1;
  for (const [b, w] of sum) if (w > bw) ((best = b), (bw = w));
  return best >= 0 ? pose.bones[best].name : slot.bone.name;
}

// regiao ou malha (o que tem imagem e triangulos)
const drawable = (s: SlotView) => {
  const k = s.part?.kind;
  return k === "region" || k === "mesh" || k === "linkedmesh";
};

// Caixa na tela [x0, y0, x1, y1] da imagem atual de um slot (null se nao tem imagem)
export function slotWorldBox(pose: PoseView, slotName: string): number[] | null {
  const slot = pose.findSlot(slotName);
  if (!slot || !drawable(slot)) return null;
  const n = pose.vertices(slot, tmp);
  if (!n) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i += 2) (x0 = Math.min(x0, tmp[i])), (x1 = Math.max(x1, tmp[i])), (y0 = Math.min(y0, tmp[i + 1])), (y1 = Math.max(y1, tmp[i + 1]));
  return [x0, y0, x1, y1];
}

function pickSlotPass(pose: PoseView, x: number, y: number, glows: boolean, hidden?: (slot: SlotView) => boolean): { slot: string; bone: string } | null {
  const order = pose.drawOrder();
  for (let i = order.length - 1; i >= 0; i--) {
    const slot = order[i];
    if (!slot.bone.active || hidden?.(slot)) continue;
    const glow = slot.blend === "additive" || slot.blend === "screen";
    if (glow !== glows) continue;
    if (!drawable(slot)) continue;
    const tris = pose.triangles(slot);
    const n = pose.vertices(slot, tmp);
    if (!tris || !n) continue;
    if (slot.color.a < 0.05) continue;
    const mesh = slot.part!.kind !== "region";
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 2,
        b = tris[t + 1] * 2,
        c = tris[t + 2] * 2;
      if (inTri(x, y, tmp[a], tmp[a + 1], tmp[b], tmp[b + 1], tmp[c], tmp[c + 1])) {
        if (!mesh) return { slot: slot.name, bone: slot.bone.name };
        // coordenadas baricentricas do ponto no triangulo: o vertice mais perto pesa mais
        const det = (tmp[b + 1] - tmp[c + 1]) * (tmp[a] - tmp[c]) + (tmp[c] - tmp[b]) * (tmp[a + 1] - tmp[c + 1]) || 1e-9;
        const l1 = ((tmp[b + 1] - tmp[c + 1]) * (x - tmp[c]) + (tmp[c] - tmp[b]) * (y - tmp[c + 1])) / det;
        const l2 = ((tmp[c + 1] - tmp[a + 1]) * (x - tmp[c]) + (tmp[a] - tmp[c]) * (y - tmp[c + 1])) / det;
        return { slot: slot.name, bone: movingBone(pose, slot.name, [tris[t], tris[t + 1], tris[t + 2]], [l1, l2, 1 - l1 - l2]) };
      }
    }
  }
  return null;
}

function inTri(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// Osso mais proximo (segmento do osso) dentro de um raio em pixels de tela.
export function pickBone(v: Viewer, x: number, y: number, radiusPx = 10): string | null {
  const pose = v.pose;
  if (!pose) return null;
  let best: string | null = null;
  let bestD = radiusPx / v.cam.zoom;
  for (const p of pose.bones) {
    if (!p.active) continue;
    const len = p.length;
    const x2 = p.worldX + p.a * len,
      y2 = p.worldY + p.c * len;
    const d = segDist(x, y, p.worldX, p.worldY, x2, y2);
    if (d < bestD) (bestD = d), (best = p.name);
  }
  return best;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

interface Drag {
  bone: string;
  tool: Tool;
  merge: string;
  start: { x: number; y: number };
  // estado local do osso no inicio do arrasto (pose atual, com animacao aplicada)
  local: { x: number; y: number; rotation: number; scaleX: number; scaleY: number };
  grab: { x: number; y: number };
  startAngle: number;
  startDist: number;
  // o quanto o arrasto mudou ate agora, para a leitura junto do cursor
  leitura: string;
  // mover numa junta: os ossos que dobram (pai, e o avo se a cadeia e continua) e o estado deles
  // no inicio do arrasto
  dobra: Dobra | null;
  // o tamanho do que mudou (px no mover, graus no girar), para avisar se ficou pequeno demais
  tamanho?: { tipo: "move" | "rotate"; valor: number };
  // Ctrl na Pose base: mexe so na imagem da peca escolhida, dentro do osso dela
  imagem?: Imagem | null;
}

interface Imagem {
  slot: string;
  nome: string;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  // o osso da peca no mundo (para levar o arrasto ao espaco dele) e o centro da imagem no mundo
  osso: { a: number; b: number; c: number; d: number; x: number; y: number };
  cx: number;
  cy: number;
}

// a imagem (regiao) da peca escolhida, para o Ctrl; null se nao ha peca, se e malha (a malha se
// ajusta no Editar malha) ou animando (a posicao da imagem no osso e da Pose base)
function prepararImagem(v: Viewer): Imagem | null {
  const sl = app.selection.slot;
  const doc = app.doc;
  if (!sl || !doc) return null;
  const sv = v.pose?.findSlot(sl);
  const parte = sv?.part;
  if (!sv || !parte) return null;
  if (app.mode !== "setup" && app.play.animation) return (app.avisar("A posição da imagem no osso é da Pose base: escolha Pose base e arraste com Ctrl."), null);
  if (parte.kind !== "region") return (app.avisar(`${sl} é uma malha: o desenho dela se ajusta em Editar malha, no inspetor.`), null);
  const att = doc.json.skins?.find((s: any) => s.name === "default")?.attachments?.[sl]?.[parte.name];
  if (!att) return null;
  const o = sv.bone;
  const x = att.x ?? 0,
    y = att.y ?? 0;
  return { slot: sl, nome: parte.name, x, y, rotation: att.rotation ?? 0, scaleX: att.scaleX ?? 1, scaleY: att.scaleY ?? 1, osso: { a: o.a, b: o.b, c: o.c, d: o.d, x: o.worldX, y: o.worldY }, cx: o.worldX + o.a * x + o.b * y, cy: o.worldY + o.c * x + o.d * y };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// As setas fazem o que a ferramenta faz, em passos (mouse sobre o desenho): o mesmo arrasto,
// sintetico, do osso escolhido. Mover: 1 px (numa junta, dobra); Girar: 1 grau; Esticar: 1%.
// Shift: 10 vezes. Alt e Ctrl como no arrasto. Toques seguidos (menos de 0,8 s) sao uma acao so
// no desfazer: a acao junta substitui a anterior e os valores sao absolutos
let setas = { merge: "", at: 0 };
export function passoSeta(v: Viewer, key: string, shift: boolean, alt: boolean, ctrl: boolean): boolean {
  // o passo anterior ja na pose (toques seguidos chegam antes do proximo quadro)
  v.sync();
  const nome = app.selection.bone;
  const p: any = nome ? v.pose?.findBone(nome) : null;
  if (!p || !["move", "rotate", "scale"].includes(app.tool)) return false;
  const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const [sx, sy] = dir[key] ?? [0, 0];
  if (!sx && !sy) return false;
  const n = shift ? 10 : 1;
  v.view.playing = false;
  const agora = performance.now();
  if (agora - setas.at > 800) setas.merge = `seta${++seq}`;
  setas.at = agora;
  const o = { x: p.worldX, y: p.worldY };
  let ini: { x: number; y: number }, fim: { x: number; y: number };
  if (app.tool === "move") {
    // a direcao na tela levada ao esqueleto (no modo godot o y vem invertido)
    const c = v.canvas.getBoundingClientRect();
    const a0 = v.screenToSkel(c.left + c.width / 2, c.top + c.height / 2),
      a1 = v.screenToSkel(c.left + c.width / 2 + sx, c.top + c.height / 2 + sy);
    const l = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1;
    ini = o;
    fim = { x: o.x + ((a1.x - a0.x) / l) * n, y: o.y + ((a1.y - a0.y) / l) * n };
  } else {
    const r = 100 / v.cam.zoom;
    const L = Math.hypot(p.a, p.c) || 1;
    ini = { x: o.x + (p.a / L) * r, y: o.y + (p.c / L) * r };
    if (app.tool === "rotate") {
      // direita e baixo: horario na tela
      const horario = sx > 0 || sy > 0 ? 1 : -1;
      const g = ((n * Math.PI) / 180) * horario * (v.flip ? 1 : -1);
      const dx = ini.x - o.x,
        dy = ini.y - o.y;
      fim = { x: o.x + dx * Math.cos(g) - dy * Math.sin(g), y: o.y + dx * Math.sin(g) + dy * Math.cos(g) };
    } else {
      const f = 1 + (sx > 0 || sy < 0 ? 1 : -1) * 0.01 * n;
      fim = { x: o.x + (ini.x - o.x) * f, y: o.y + (ini.y - o.y) * f };
    }
  }
  if (!beginDrag(v, ini, app.tool as Tool, ctrl, setas.merge)) return true;
  moveDrag(v, fim, false, alt);
  endDrag(true);
  return true;
}

// o IK que dirige um osso (o osso esta na cadeia de um IK): nome e alvo
export function ikDe(bone: string): { nome: string; alvo: string } | null {
  const j: any = app.doc?.json;
  const todas = [...(j?.constraints ?? []).filter((c: any) => c.type === "ik"), ...(j?.ik ?? [])];
  for (const c of todas) if ((c.bones ?? []).includes(bone)) return { nome: c.name, alvo: c.target };
  return null;
}

// A linha de ajuda da ferramenta, no canto do desenho: o que um arrasto vai fazer com o que esta
// escolhido, e as teclas que mudam isso (no teste acompanhado, o que o Mover fazia numa junta e
// como mexer so na imagem nao estava claro em lugar nenhum)
export function ajudaFerramenta(v: Viewer): string {
  const bone = app.selection.bone;
  const sl = app.selection.slot;
  const base = app.mode === "setup" || !app.play.animation;
  const p: any = bone ? v.pose?.findBone(bone) : null;
  const img = base && sl ? " · Ctrl: só a imagem" : "";
  const ik = bone ? ikDe(bone) : null;
  switch (app.tool) {
    case "move": {
      if (!p) return "Mover: clique numa peça ou osso para escolher";
      if (ik && ik.alvo !== bone) return `Mover: ${bone} é dirigido pelo IK ${ik.nome}; arraste o alvo ${ik.alvo} para dobrar${img}`;
      const ikPai = p.parent ? ikDe(p.parent.name) : null;
      if (ikPai) return `Mover: o IK ${ikPai.nome} dirige ${p.parent.name}; arraste o alvo ${ikPai.alvo} para dobrar · arrastar ${bone} desloca ele solto${img} · Shift: fino`;
      const d = preparaDobra(p);
      if (d) return `Mover: arrastar ${bone} dobra ${d.avo ? `${d.avo.nome} e ${d.pai.nome}` : d.pai.nome} · Alt: só ${bone}, solto${img} · Shift: fino · setas: 1 px`;
      return `Mover: arrastar desloca ${bone} e o que pende dele${img} · Shift: fino · setas: 1 px`;
    }
    case "rotate":
      return p ? `Girar: arrastar gira ${bone} em volta da origem dele${img ? " · Ctrl: gira só a imagem" : ""} · setas: 1°` : "Girar: clique numa peça ou osso para escolher";
    case "scale":
      return p ? `Esticar: arrastar estica ${bone}${img ? " · Ctrl: estica só a imagem" : ""} · setas: 1%` : "Esticar: clique numa peça ou osso para escolher";
    case "deform":
      return base ? "Pincel: amassa a imagem dentro de uma animação; escolha uma na timeline · [ e ]: tamanho" : "Pincel: arraste sobre a peça para amassar · [ e ]: tamanho";
    case "bone":
      return "Osso: arraste a partir de um osso para criar um filho dele (na Pose base)";
    case "pan":
      return "Câmera: arraste para mover a vista · roda: zoom";
  }
  return "";
}

// arrasto com Ctrl: mover desloca a imagem no osso, girar gira em volta do centro dela, esticar
// muda a escala; tudo pelo attachment.region (desfazivel, uma acao por arrasto)
function arrastarImagem(d: Drag, world: { x: number; y: number }, k: number) {
  const im = d.imagem!;
  const o = im.osso;
  const det = o.a * o.d - o.b * o.c || 1;
  const args: any = { slot: im.slot, name: im.nome };
  if (d.tool === "move") {
    const dx = (world.x - d.start.x) * k,
      dy = (world.y - d.start.y) * k;
    // o arrasto (mundo) no espaco do osso
    const lx = (o.d * dx - o.b * dy) / det,
      ly = (-o.c * dx + o.a * dy) / det;
    args.x = r3(im.x + lx);
    args.y = r3(im.y + ly);
    d.leitura = `imagem de ${im.slot}: mover ${sinal(lx)}, ${sinal(ly)}`;
  } else if (d.tool === "rotate") {
    let g = ((Math.atan2(world.y - im.cy, world.x - im.cx) - Math.atan2(d.start.y - im.cy, d.start.x - im.cx)) * 180) / Math.PI;
    if (g > 180) g -= 360;
    if (g < -180) g += 360;
    g *= k * (det < 0 ? -1 : 1);
    args.rotation = r3(im.rotation + g);
    d.leitura = `imagem de ${im.slot}: girar ${sinal(g, 1)}°`;
  } else {
    const f = 1 + (Math.hypot(world.x - im.cx, world.y - im.cy) / Math.max(1e-3, Math.hypot(d.start.x - im.cx, d.start.y - im.cy)) - 1) * k;
    args.scaleX = r3(im.scaleX * f);
    args.scaleY = r3(im.scaleY * f);
    d.leitura = `imagem de ${im.slot}: esticar ${f.toFixed(2)}×`;
  }
  app.run({ cmd: "attachment.region", args }, `imagem de ${im.slot}`, d.merge);
}

interface Dobra {
  pai: { nome: string; ox: number; oy: number; ang: number; local: number; flip: number; len: number };
  avo: { nome: string; ox: number; oy: number; ang: number; local: number; flip: number; len: number } | null;
  // de que lado o cotovelo dobra (o sinal do produto vetorial avo -> pai -> junta no inicio)
  lado: number;
}

const angulo = (p: { a: number; c: number }) => Math.atan2(p.c, p.a);
// a ponta de um osso no mundo
const ponta = (p: any) => ({ x: p.worldX + p.a * p.length, y: p.worldY + p.c * p.length });
// o osso nasce na ponta do pai (uma junta: cotovelo, mao, joelho)? tolerancia de 10% do pai ou 3 px
// (rigs feitos a mao raramente acertam a ponta em cheio: a mao do robo fica a 1,9 px)
const naPonta = (p: any) => {
  const q = p.parent;
  if (!q || q.length <= 0) return false;
  const t = ponta(q);
  return Math.hypot(p.worldX - t.x, p.worldY - t.y) <= Math.max(3, q.length * 0.1);
};
const estado = (p: any) => ({ nome: p.name, ox: p.worldX, oy: p.worldY, ang: angulo(p), local: p.local.rotation, flip: p.a * p.d - p.b * p.c < 0 ? -1 : 1, len: p.length });

function preparaDobra(p: any): Dobra | null {
  if (!naPonta(p)) return null;
  const pai = p.parent;
  // um IK ja dirige o pai: girar ele nao apareceria (quem dobra e o alvo do IK)
  if (ikDe(pai.name)) return null;
  const avo = naPonta(pai) && !ikDe(pai.parent?.name) ? pai.parent : null;
  const lado = avo ? Math.sign((pai.worldX - avo.worldX) * (p.worldY - pai.worldY) - (pai.worldY - avo.worldY) * (p.worldX - pai.worldX)) || 1 : 1;
  return { pai: estado(pai), avo: avo ? estado(avo) : null, lado };
}

const graus = (r: number) => (r * 180) / Math.PI;
const giroCurto = (d: number) => {
  d = graus(d);
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
};

let drag: Drag | null = null;
let seq = 0;

export function beginDrag(v: Viewer, world: { x: number; y: number }, tool: Tool, soImagem = false, merge?: string): boolean {
  const name = app.selection.bone;
  const p = name ? v.pose?.findBone(name) : null;
  if (!p) return false;
  const lp = p.local;
  const parentPos = toParent(p, world.x, world.y);
  drag = {
    bone: name!,
    tool,
    merge: merge ?? `drag${++seq}`,
    start: world,
    local: { x: lp.x, y: lp.y, rotation: lp.rotation, scaleX: lp.scaleX, scaleY: lp.scaleY },
    grab: { x: parentPos.x - lp.x, y: parentPos.y - lp.y },
    startAngle: Math.atan2(world.y - p.worldY, world.x - p.worldX),
    startDist: Math.max(1e-3, Math.hypot(world.x - p.worldX, world.y - p.worldY)),
    leitura: "",
    dobra: tool === "move" ? preparaDobra(p) : null,
    imagem: soImagem && ["move", "rotate", "scale"].includes(tool) ? prepararImagem(v) : null,
  };
  if (soImagem && !drag.imagem) drag = null;
  if (!drag) return false;
  return true;
}

export function moveDrag(v: Viewer, world: { x: number; y: number }, fine: boolean, solto = false) {
  if (!drag) return;
  const p = v.pose?.findBone(drag.bone);
  if (!p) return;
  const k = fine ? 0.2 : 1;
  const L = drag.local;
  const next: Partial<typeof L> = {};
  if (drag.imagem) return arrastarImagem(drag, world, k);
  // mover numa junta: dobra o pai (e o avo) para a junta chegar ao cursor; Alt solta
  if (drag.tool === "move" && drag.dobra && !solto) return dobrar(drag, world, k);
  if (drag.tool === "move") {
    const pp = toParent(p, world.x, world.y);
    const sp = toParent(p, drag.start.x, drag.start.y);
    next.x = L.x + (pp.x - sp.x) * k;
    next.y = L.y + (pp.y - sp.y) * k;
    drag.leitura = `mover ${sinal(next.x - L.x)}, ${sinal(next.y - L.y)}`;
    drag.tamanho = { tipo: "move", valor: Math.hypot(next.x - L.x, next.y - L.y) };
  } else if (drag.tool === "rotate") {
    let d = ((Math.atan2(world.y - p.worldY, world.x - p.worldX) - drag.startAngle) * 180) / Math.PI;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    // osso espelhado (escala negativa no mundo) gira ao contrario
    const flip = p.a * p.d - p.b * p.c < 0 ? -1 : 1;
    next.rotation = L.rotation + d * k * flip;
    drag.tamanho = { tipo: "rotate", valor: Math.abs(d * k) };
    drag.leitura = `girar ${sinal(d * k * flip, 1)}° (fica ${next.rotation < 0 ? "−" : ""}${Math.abs(next.rotation).toFixed(1)}°)`;
  } else {
    const f = 1 + (Math.hypot(world.x - p.worldX, world.y - p.worldY) / drag.startDist - 1) * k;
    next.scaleX = L.scaleX * f;
    next.scaleY = L.scaleY * f;
    drag.leitura = `esticar ${f.toFixed(2)}×`;
  }
  if (fine) drag.leitura += " · fino";
  applyLocal(drag.bone, next, drag.merge);
}

// a junta vai ao alvo: com o avo, os dois ossos (lei dos cossenos, dobrando para o mesmo lado de
// antes); sem ele, o pai so aponta para o alvo. Grava rotacao local (Pose base ou chave)
function dobrar(d: Drag, world: { x: number; y: number }, k: number) {
  const { pai, avo, lado } = d.dobra!;
  // o alvo anda k vezes o que o mouse andou (Shift: fino)
  const alvo = { x: d.start.x + (world.x - d.start.x) * k, y: d.start.y + (world.y - d.start.y) * k };
  // a junta comeca na ponta do pai: o alvo e onde ela deve chegar, contando de onde se pegou
  const junta = { x: pai.ox + Math.cos(pai.ang) * pai.len + (alvo.x - d.start.x), y: pai.oy + Math.sin(pai.ang) * pai.len + (alvo.y - d.start.y) };
  if (!avo) {
    const dPai = giroCurto(Math.atan2(junta.y - pai.oy, junta.x - pai.ox) - pai.ang);
    const c = chamadasLocal(pai.nome, { rotation: pai.local + dPai * pai.flip }, d.merge);
    if (c) app.run(c.calls, `dobra ${pai.nome}`, d.merge);
    d.leitura = `dobrar ${pai.nome} ${sinal(dPai, 1)}° · Alt: solto`;
    return;
  }
  const L1 = avo.len,
    L2 = pai.len;
  const dx = junta.x - avo.ox,
    dy = junta.y - avo.oy;
  const dist = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-4, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const abre = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
  const angAvo = base - lado * abre;
  const cotovelo = { x: avo.ox + Math.cos(angAvo) * L1, y: avo.oy + Math.sin(angAvo) * L1 };
  const angPai = Math.atan2(junta.y - cotovelo.y, junta.x - cotovelo.x);
  const dAvo = giroCurto(angAvo - avo.ang);
  // o pai ja gira junto com o avo: o que sobra e dele
  const dPai = giroCurto(angPai - pai.ang - (angAvo - avo.ang));
  const ca = chamadasLocal(avo.nome, { rotation: avo.local + dAvo * avo.flip }, d.merge);
  const cp = chamadasLocal(pai.nome, { rotation: pai.local + dPai * pai.flip }, d.merge);
  if (ca && cp) app.run([...ca.calls, ...cp.calls], `dobra ${avo.nome} e ${pai.nome}`, d.merge);
  d.leitura = `dobrar ${avo.nome} ${sinal(dAvo, 1)}°, ${pai.nome} ${sinal(dPai, 1)}° · Alt: solto`;
}

const sinal = (n: number, casas = 0) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(casas);

// a leitura do arrasto em curso (null sem arrasto ou antes de mexer)
export function leituraArrasto(): string | null {
  return drag?.leitura || null;
}

export function endDrag(silencioso = false) {
  if (silencioso && drag) drag.tamanho = undefined;
  // animando, um movimento pequeno demais quase nao aparece tocando (no teste acompanhado o
  // balanco saiu com 3 px de deslize e ninguem percebeu)
  const t = drag?.tamanho;
  if (t && app.mode === "animate" && app.play.animation && t.valor > 0.05 && t.valor < (t.tipo === "move" ? 5 : 3))
    app.avisar(`Movimento pequeno (${t.valor.toFixed(1)}${t.tipo === "move" ? " px" : "°"}): tocando, quase não aparece.${t.tipo === "move" ? " Para balançar, Girar (2) costuma funcionar melhor." : ""}`);
  drag = null;
}

export function dragging() {
  return drag !== null;
}

// Grava valores locais do osso: na setup pose (modo Montar) ou como chave no tempo atual (Animar).
export function applyLocal(bone: string, local: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number }, merge?: string) {
  const c = chamadasLocal(bone, local, merge);
  if (!c) return;
  app.run(c.calls, c.label, merge);
}

// os comandos que gravam valores locais de um osso (bone.set na Pose base, key.set animando):
// varios ossos numa acao so juntam as listas (juntar acoes com a mesma chave substitui a anterior)
export function chamadasLocal(bone: string, local: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number }, merge?: string): { calls: any[]; label: string } | null {
  const v = app.viewer;
  const doc = app.doc;
  if (!v || !doc) return null;
  const setup = doc.json.bones.find((b: any) => b.name === bone);
  if (app.mode === "setup" || !v.view.animation) return { calls: [{ cmd: "bone.set", args: { bone, ...local } }], label: `move ${bone}` };
  // no Spine 4 as timelines guardam valores relativos a setup:
  // rotate e translate somam, scale multiplica
  const anim = v.view.animation;
  const time = +v.view.time.toFixed(4);
  const calls: any[] = [];
  const T = { bone };
  const base: Record<string, any> = { rotate: { value: 0 }, translate: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };
  const edge = (timeline: string) => calls.push(...edgeKeys(v, T, timeline, time, (tt) => ({ cmd: "key.set", args: { anim, target: T, timeline, time: tt, ...base[timeline], curve: "suave" } }), merge));
  if (local.rotation !== undefined) edge("rotate");
  if (local.x !== undefined || local.y !== undefined) edge("translate");
  if (local.scaleX !== undefined || local.scaleY !== undefined) edge("scale");
  if (local.rotation !== undefined) calls.push({ cmd: "key.set", args: { anim, target: T, timeline: "rotate", time, value: local.rotation - (setup.rotation ?? 0) } });
  const cur = v.pose?.findBone(bone)?.local ?? { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  if (local.x !== undefined || local.y !== undefined) {
    calls.push({ cmd: "key.set", args: { anim, target: T, timeline: "translate", time, x: (local.x ?? cur.x) - (setup.x ?? 0), y: (local.y ?? cur.y) - (setup.y ?? 0) } });
  }
  if (local.scaleX !== undefined || local.scaleY !== undefined) {
    calls.push({ cmd: "key.set", args: { anim, target: T, timeline: "scale", time, x: (local.scaleX ?? cur.scaleX) / (setup.scaleX ?? 1), y: (local.scaleY ?? cur.scaleY) / (setup.scaleY ?? 1) } });
  }
  return { calls, label: `chave ${bone} @${time}` };
}

// ossos separados da ponta do pai (com os ossos a vista): uma linha tracejada da ponta do pai ate
// o filho, para se ver de quem ele e filho. So o osso selecionado (em amarelo) e os filhos dele:
// em todos o rig ficava riscado (muito osso nasce fora da ponta do pai, como ombros e pernas)
export function drawLigacoes(v: Viewer) {
  const pose = v.pose;
  if (!pose || !v.view.showBones) return;
  const sel = app.selection.bone;
  const z = v.cam.zoom;
  for (const p of pose.bones) {
    const pai = p.parent;
    if (!pai || !sel || (p.name !== sel && pai.name !== sel)) continue;
    const tx = pai.worldX + pai.a * pai.length,
      ty = pai.worldY + pai.c * pai.length;
    const dx = p.worldX - tx,
      dy = p.worldY - ty;
    const d = Math.hypot(dx, dy);
    if (d * z < 8) continue;
    const forte = p.name === sel;
    const c = forte ? new Color(1, 0.82, 0.4, 0.95) : new Color(0.75, 0.72, 0.85, 0.3);
    // tracos de 6 px com vao de 4 px (na tela)
    const passo = 10 / z,
      traco = 6 / z;
    for (let t = 0; t < d; t += passo) {
      const t2 = Math.min(d, t + traco);
      v.scene.line(tx + (dx * t) / d, ty + (dy * t) / d, tx + (dx * t2) / d, ty + (dy * t2) / d, c);
    }
  }
}

// o que esta sob o mouse (Viewport.mostraAlvo): contorno da imagem e o osso, em ciano
export const hover: { bone?: string; slot?: string } = {};
export function drawHover(v: Viewer) {
  const pose = v.pose;
  if (!pose || (!hover.bone && !hover.slot)) return;
  const c = new Color(0.4, 0.88, 1, 0.85);
  const box = hover.slot ? slotWorldBox(pose, hover.slot) : null;
  if (box) v.scene.rect(false, box[0], box[1], box[2] - box[0], box[3] - box[1], c);
  const p = hover.bone ? pose.findBone(hover.bone) : null;
  if (p) {
    const len = Math.max(p.length, 12 / v.cam.zoom);
    // linha grossa (tres finas lado a lado) para aparecer por cima do osso vermelho
    const ex = (-p.c / Math.hypot(p.a, p.c)) * (1.5 / v.cam.zoom),
      ey = (p.a / Math.hypot(p.a, p.c)) * (1.5 / v.cam.zoom);
    for (const k of [-1, 0, 1]) v.scene.line(p.worldX + ex * k, p.worldY + ey * k, p.worldX + p.a * len + ex * k, p.worldY + p.c * len + ey * k, c);
    v.scene.circle(false, p.worldX, p.worldY, 8 / v.cam.zoom, c, 24);
  }
}

// Gizmo do osso selecionado: circulo de rotacao, seta de mover, alca de escala.
export function drawGizmo(v: Viewer) {
  const name = app.selection.bone;
  const p = name ? v.pose?.findBone(name) : null;
  if (!p) return;
  const r = 34 / v.cam.zoom;
  const s = v.scene;
  const accent = new Color(1, 0.18, 0.53, 0.95);
  const soft = new Color(1, 0.18, 0.53, 0.35);
  if (app.tool === "rotate") {
    s.circle(false, p.worldX, p.worldY, r, accent, 48);
    s.circle(false, p.worldX, p.worldY, r * 1.04, soft, 48);
  } else if (app.tool === "move") {
    s.line(p.worldX - r, p.worldY, p.worldX + r, p.worldY, accent);
    s.line(p.worldX, p.worldY - r, p.worldX, p.worldY + r, accent);
    s.circle(true, p.worldX, p.worldY, r * 0.18, soft);
  } else {
    s.rect(false, p.worldX - r * 0.7, p.worldY - r * 0.7, r * 1.4, r * 1.4, accent);
  }
}

// ---- pincel de deform e criacao de osso por arraste (coordenadas visuais, y para cima)

interface Stroke {
  kind: "deform" | "bone";
  start: { x: number; y: number };
  cur: { x: number; y: number };
  merge: string;
  slot?: string;
  attachment?: string;
}
let stroke: Stroke | null = null;
// posicao do cursor (visual) para desenhar o pincel
export const cursor = { x: 0, y: 0, inside: false };

function meshUnder(v: Viewer, slotName: string | undefined): { slot: string; attachment: string; isMesh: boolean } | null {
  const part = slotName ? v.pose?.findSlot(slotName)?.part : null;
  if (!slotName || !part) return null;
  return { slot: slotName, attachment: part.name, isMesh: part.kind === "mesh" || part.kind === "linkedmesh" };
}

export function beginStroke(v: Viewer, visual: { x: number; y: number }): boolean {
  if (app.tool === "bone") {
    stroke = { kind: "bone", start: visual, cur: visual, merge: `bone${++seq}` };
    return true;
  }
  if (app.tool !== "deform") return false;
  // o que estiver sob o pincel; fora do personagem, o slot selecionado
  let target: ReturnType<typeof meshUnder> = null;
  const pose = v.pose;
  if (pose) {
    const skel = v.flip ? { x: visual.x, y: -visual.y } : visual;
    const s = pickSlot(pose, skel.x, skel.y);
    if (s) {
      app.select({ slot: s, bone: pose.findSlot(s)!.bone.name });
      target = meshUnder(v, s);
    }
  }
  target ??= meshUnder(v, app.selection.slot);
  if (!target) {
    app.toast("Clique numa parte do personagem para deformar.");
    return false;
  }
  if (!target.isMesh) {
    app.offerMesh = { slot: target.slot, attachment: target.attachment };
    return false;
  }
  if (!v.view.animation || app.mode !== "animate") {
    app.toast("O pincel deforma dentro de uma animação: escolha uma (ou + nova) na timeline.");
    return false;
  }
  v.view.playing = false;
  stroke = { kind: "deform", start: visual, cur: visual, merge: `deform${++seq}`, ...target };
  return true;
}

export function moveStroke(v: Viewer, visual: { x: number; y: number }) {
  if (!stroke) return;
  stroke.cur = visual;
  if (stroke.kind !== "deform") return;
  const dx = visual.x - stroke.start.x,
    dy = visual.y - stroke.start.y;
  const t = +v.view.time.toFixed(4);
  const edges = edgeKeys(v, { deform: { slot: stroke.slot!, attachment: stroke.attachment!, skin: "default" } }, "deform", t, (time) => ({
    cmd: "deform.set",
    args: { anim: v.view.animation, slot: stroke!.slot, attachment: stroke!.attachment, time, moves: [], absolute: true, curve: "suave" },
  }), stroke.merge);
  app.run(
    [
      ...edges,
      {
      cmd: "deform.brush",
      args: {
        anim: v.view.animation,
        slot: stroke.slot,
        attachment: stroke.attachment,
        time: +v.view.time.toFixed(4),
        center: [stroke.start.x, stroke.start.y],
        radius: app.brushRadius / v.cam.zoom,
        dx,
        dy,
      },
    },
    ],
    `pincel ${stroke.slot} @${t}`,
    stroke.merge,
  );
}

// Primeira chave de uma timeline num tempo > 0: cria tambem a pose base no inicio e no
// fim da animacao, para o movimento ir e voltar (com uma chave so, o Spine segura a
// pose a animacao inteira, o que confunde quem esta comecando).
// a decisao vale o arraste inteiro: cada passo desfaz o anterior (merge), entao no
// segundo passo as chaves de borda "ja existiriam" e seriam perdidas no desfazer
const edgeDecision = new Map<string, any[]>();

export function edgeKeys(v: Viewer, target: any, timeline: string, t: number, make: (time: number) => any, merge?: string): any[] {
  // por arrasto, alvo e timeline (um arrasto pode gravar mais de um osso, como no dobrar)
  const id = merge ? `${merge}|${JSON.stringify(target)}|${timeline}` : null;
  if (id && edgeDecision.has(id)) return edgeDecision.get(id)!;
  const out = decideEdges(v, target, timeline, t, make);
  if (id) {
    if (edgeDecision.size > 200) edgeDecision.clear();
    edgeDecision.set(id, out);
  }
  return out;
}

function decideEdges(v: Viewer, target: any, timeline: string, t: number, make: (time: number) => any): any[] {
  const anim = v.view.animation;
  const a = anim ? app.doc?.json.animations?.[anim] : null;
  if (!a || t <= 1e-4) return [];
  let keys: any[] | undefined;
  if (target.bone) keys = a.bones?.[target.bone]?.[timeline];
  else if (target.slot) keys = (isEffect(timeline) ? a.effects : a.slots)?.[target.slot]?.[timeline];
  else if (target.deform) keys = a.attachments?.[target.deform.skin]?.[target.deform.slot]?.[target.deform.attachment]?.deform;
  if (keys?.length) return [];
  const out = [make(0)];
  // so a animacao (com a previa de transicao, duration() cobre a sequencia)
  const dur = v.animDuration();
  if (dur > t + 1e-4) out.push(make(+dur.toFixed(4)));
  return out;
}

export function endStroke() {
  const s = stroke;
  stroke = null;
  if (!s || s.kind !== "bone") return;
  const len = Math.hypot(s.cur.x - s.start.x, s.cur.y - s.start.y);
  if (len < 4) return;
  const parent = app.selection.bone ?? app.doc?.json.bones?.[0]?.name ?? "root";
  let n = 1;
  while (app.doc?.json.bones.some((b: any) => b.name === `osso${n}`)) n++;
  const name = `osso${n}`;
  if (app.run({ cmd: "bone.add", args: { name, parent, at: [s.start.x, s.start.y], toward: [s.cur.x, s.cur.y] } })) app.select({ bone: name });
}

// desenha o pincel e o osso sendo criado (no espaco do esqueleto)
export function drawTools(v: Viewer) {
  const toSkel = (p: { x: number; y: number }) => (v.flip ? { x: p.x, y: -p.y } : p);
  const s = v.scene;
  if (app.tool === "deform" && cursor.inside) {
    const c = toSkel(stroke?.kind === "deform" ? stroke.start : cursor);
    s.circle(false, c.x, c.y, app.brushRadius / v.cam.zoom, new Color(0.37, 0.88, 0.82, 0.9), 40);
    if (stroke?.kind === "deform") {
      const e = toSkel(stroke.cur);
      s.line(c.x, c.y, e.x, e.y, new Color(0.37, 0.88, 0.82, 0.9));
    }
  }
  if (stroke?.kind === "bone") {
    const a = toSkel(stroke.start),
      b = toSkel(stroke.cur);
    s.line(a.x, a.y, b.x, b.y, new Color(1, 0.82, 0.4, 1));
    s.circle(true, a.x, a.y, 5 / v.cam.zoom, new Color(1, 0.82, 0.4, 1));
  }
}
