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
}

let drag: Drag | null = null;
let seq = 0;

export function beginDrag(v: Viewer, world: { x: number; y: number }, tool: Tool): boolean {
  const name = app.selection.bone;
  const p = name ? v.pose?.findBone(name) : null;
  if (!p) return false;
  const lp = p.local;
  const parentPos = toParent(p, world.x, world.y);
  drag = {
    bone: name!,
    tool,
    merge: `drag${++seq}`,
    start: world,
    local: { x: lp.x, y: lp.y, rotation: lp.rotation, scaleX: lp.scaleX, scaleY: lp.scaleY },
    grab: { x: parentPos.x - lp.x, y: parentPos.y - lp.y },
    startAngle: Math.atan2(world.y - p.worldY, world.x - p.worldX),
    startDist: Math.max(1e-3, Math.hypot(world.x - p.worldX, world.y - p.worldY)),
  };
  return true;
}

export function moveDrag(v: Viewer, world: { x: number; y: number }, fine: boolean) {
  if (!drag) return;
  const p = v.pose?.findBone(drag.bone);
  if (!p) return;
  const k = fine ? 0.2 : 1;
  const L = drag.local;
  const next: Partial<typeof L> = {};
  if (drag.tool === "move") {
    const pp = toParent(p, world.x, world.y);
    const sp = toParent(p, drag.start.x, drag.start.y);
    next.x = L.x + (pp.x - sp.x) * k;
    next.y = L.y + (pp.y - sp.y) * k;
  } else if (drag.tool === "rotate") {
    let d = ((Math.atan2(world.y - p.worldY, world.x - p.worldX) - drag.startAngle) * 180) / Math.PI;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    // osso espelhado (escala negativa no mundo) gira ao contrario
    const flip = p.a * p.d - p.b * p.c < 0 ? -1 : 1;
    next.rotation = L.rotation + d * k * flip;
  } else {
    const f = 1 + (Math.hypot(world.x - p.worldX, world.y - p.worldY) / drag.startDist - 1) * k;
    next.scaleX = L.scaleX * f;
    next.scaleY = L.scaleY * f;
  }
  applyLocal(drag.bone, next, drag.merge);
}

export function endDrag() {
  drag = null;
}

export function dragging() {
  return drag !== null;
}

// Grava valores locais do osso: na setup pose (modo Montar) ou como chave no tempo atual (Animar).
export function applyLocal(bone: string, local: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number }, merge?: string) {
  const v = app.viewer;
  const doc = app.doc;
  if (!v || !doc) return;
  const setup = doc.json.bones.find((b: any) => b.name === bone);
  if (app.mode === "setup" || !v.view.animation) {
    app.run({ cmd: "bone.set", args: { bone, ...local } }, `move ${bone}`, merge);
    return;
  }
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
  app.run(calls, `chave ${bone} @${time}`, merge);
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
    app.toast("Para deformar, use o modo Animar com uma animacao escolhida.");
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
  const id = merge ? `${merge}|${timeline}` : null;
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
