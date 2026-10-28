// Manipulacao direta no viewport: selecionar clicando na imagem, arrastar para
// mover/girar/esticar. Com uma animacao aberta cada arrasto vira chave no tempo atual; na Pose base muda o setup.
import { BlendMode, Color, MeshAttachment, RegionAttachment, Vector2, type Bone, type Skeleton } from "@esotericsoftware/spine-webgl";
import type { Viewer } from "../render/viewer.ts";
import { app } from "./state.svelte.ts";

export type Tool = "move" | "rotate" | "scale";

const tmp: number[] = [];

// Slot cuja imagem esta sob o ponto (da frente para tras). Camadas de brilho
// (blend aditivo/screen) so sao escolhidas se nada solido estiver sob o ponto:
// costumam cobrir o personagem e roubariam o clique.
export function pickSlot(sk: Skeleton, x: number, y: number): string | null {
  return pickPart(sk, x, y)?.slot ?? null;
}

// Parte sob o ponto e o osso que de fato a move ali. Numa malha com pesos o slot pode
// estar preso a um osso (a raiz do personagem) e quem dobra a imagem ser outro (o braco): vale o
// osso que mais puxa os tres vertices do triangulo clicado, pesados pela distancia.
export function pickPart(sk: Skeleton, x: number, y: number, hidden?: (slot: any) => boolean): { slot: string; bone: string } | null {
  return pickSlotPass(sk, x, y, false, hidden) ?? pickSlotPass(sk, x, y, true, hidden);
}

// Osso que move a imagem do slot: o dono do slot, ou numa malha com pesos o que mais puxa
// (no triangulo tri com pesos bary, ou na malha inteira)
export function movingBone(sk: Skeleton, slotName: string, tri?: number[], bary?: number[]): string {
  const slot = sk.findSlot(slotName);
  if (!slot) return "";
  const att = slot.appliedPose.attachment;
  if (!(att instanceof MeshAttachment) || !att.bones) return slot.bone.data.name;
  const per: Map<number, number>[] = [];
  for (let i = 0, v = 0; i < att.bones.length; ) {
    const n = att.bones[i++];
    const m = new Map<number, number>();
    for (let k = 0; k < n; k++, v += 3) m.set(att.bones[i + k], att.vertices[v + 2]);
    i += n;
    per.push(m);
  }
  const sum = new Map<number, number>();
  const add = (vi: number, f: number) => per[vi]?.forEach((w, b) => sum.set(b, (sum.get(b) ?? 0) + w * f));
  if (tri) tri.forEach((vi, k) => add(vi, bary?.[k] ?? 1));
  else per.forEach((_, vi) => add(vi, 1));
  let best = -1,
    bw = -1;
  for (const [b, w] of sum) if (w > bw) ((best = b), (bw = w));
  return best >= 0 ? sk.bones[best].data.name : slot.bone.data.name;
}

// Caixa na tela [x0, y0, x1, y1] da imagem atual de um slot (null se nao tem imagem)
export function slotWorldBox(sk: Skeleton, slotName: string): number[] | null {
  const slot = sk.findSlot(slotName);
  const att = slot?.appliedPose.attachment;
  if (!slot || !att) return null;
  let n = 0;
  if (att instanceof RegionAttachment) {
    att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), tmp, 0, 2);
    n = 8;
  } else if (att instanceof MeshAttachment) {
    n = att.worldVerticesLength;
    if (tmp.length < n) tmp.length = n;
    att.computeWorldVertices(sk, slot, 0, n, tmp, 0, 2);
  } else return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i += 2) (x0 = Math.min(x0, tmp[i])), (x1 = Math.max(x1, tmp[i])), (y0 = Math.min(y0, tmp[i + 1])), (y1 = Math.max(y1, tmp[i + 1]));
  return [x0, y0, x1, y1];
}

function pickSlotPass(sk: Skeleton, x: number, y: number, glows: boolean, hidden?: (slot: any) => boolean): { slot: string; bone: string } | null {
  const order = sk.drawOrder.appliedPose;
  for (let i = order.length - 1; i >= 0; i--) {
    const slot = order[i];
    if (!slot.bone.active || hidden?.(slot)) continue;
    const glow = slot.data.blendMode === BlendMode.Additive || slot.data.blendMode === BlendMode.Screen;
    if (glow !== glows) continue;
    const pose = slot.appliedPose;
    const att = pose.attachment;
    let tris: number[] | null = null;
    let n = 0;
    if (att instanceof RegionAttachment) {
      att.computeWorldVertices(slot, att.getOffsets(pose), tmp, 0, 2);
      tris = [0, 1, 2, 2, 3, 0];
      n = 8;
    } else if (att instanceof MeshAttachment) {
      n = att.worldVerticesLength;
      if (tmp.length < n) tmp.length = n;
      att.computeWorldVertices(sk, slot, 0, n, tmp, 0, 2);
      tris = att.triangles;
    }
    if (!tris || !n) continue;
    if (pose.color.a < 0.05) continue;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 2,
        b = tris[t + 1] * 2,
        c = tris[t + 2] * 2;
      if (inTri(x, y, tmp[a], tmp[a + 1], tmp[b], tmp[b + 1], tmp[c], tmp[c + 1])) {
        if (!(att instanceof MeshAttachment)) return { slot: slot.data.name, bone: slot.bone.data.name };
        // coordenadas baricentricas do ponto no triangulo: o vertice mais perto pesa mais
        const det = (tmp[b + 1] - tmp[c + 1]) * (tmp[a] - tmp[c]) + (tmp[c] - tmp[b]) * (tmp[a + 1] - tmp[c + 1]) || 1e-9;
        const l1 = ((tmp[b + 1] - tmp[c + 1]) * (x - tmp[c]) + (tmp[c] - tmp[b]) * (y - tmp[c + 1])) / det;
        const l2 = ((tmp[c + 1] - tmp[a + 1]) * (x - tmp[c]) + (tmp[a] - tmp[c]) * (y - tmp[c + 1])) / det;
        return { slot: slot.data.name, bone: movingBone(sk, slot.data.name, [tris[t], tris[t + 1], tris[t + 2]], [l1, l2, 1 - l1 - l2]) };
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
  const sk = v.skeleton;
  if (!sk) return null;
  let best: string | null = null;
  let bestD = radiusPx / v.cam.zoom;
  for (const b of sk.bones) {
    if (!b.active) continue;
    const p = b.appliedPose;
    const len = b.data.length;
    const x2 = p.worldX + p.a * len,
      y2 = p.worldY + p.c * len;
    const d = segDist(x, y, p.worldX, p.worldY, x2, y2);
    if (d < bestD) (bestD = d), (best = b.data.name);
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
  const b = name ? v.skeleton?.findBone(name) : null;
  if (!b) return false;
  const p = b.appliedPose;
  const lp = b.pose;
  const parentPos = toParent(b, world.x, world.y);
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

function toParent(b: Bone, x: number, y: number) {
  const v = new Vector2(x, y);
  return b.parent ? b.parent.appliedPose.worldToLocal(v) : v;
}

export function moveDrag(v: Viewer, world: { x: number; y: number }, fine: boolean) {
  if (!drag) return;
  const b = v.skeleton?.findBone(drag.bone);
  if (!b) return;
  const k = fine ? 0.2 : 1;
  const L = drag.local;
  const next: Partial<typeof L> = {};
  if (drag.tool === "move") {
    const pp = toParent(b, world.x, world.y);
    const sp = toParent(b, drag.start.x, drag.start.y);
    next.x = L.x + (pp.x - sp.x) * k;
    next.y = L.y + (pp.y - sp.y) * k;
  } else if (drag.tool === "rotate") {
    const p = b.appliedPose;
    let d = ((Math.atan2(world.y - p.worldY, world.x - p.worldX) - drag.startAngle) * 180) / Math.PI;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    // osso espelhado (escala negativa no mundo) gira ao contrario
    const flip = p.a * p.d - p.b * p.c < 0 ? -1 : 1;
    next.rotation = L.rotation + d * k * flip;
  } else {
    const p = b.appliedPose;
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
  if (local.x !== undefined || local.y !== undefined) {
    const cur = v.skeleton!.findBone(bone)!.pose;
    calls.push({ cmd: "key.set", args: { anim, target: T, timeline: "translate", time, x: (local.x ?? cur.x) - (setup.x ?? 0), y: (local.y ?? cur.y) - (setup.y ?? 0) } });
  }
  if (local.scaleX !== undefined || local.scaleY !== undefined) {
    const cur = v.skeleton!.findBone(bone)!.pose;
    calls.push({ cmd: "key.set", args: { anim, target: T, timeline: "scale", time, x: (local.scaleX ?? cur.scaleX) / (setup.scaleX ?? 1), y: (local.scaleY ?? cur.scaleY) / (setup.scaleY ?? 1) } });
  }
  app.run(calls, `chave ${bone} @${time}`, merge);
}

// Gizmo do osso selecionado: circulo de rotacao, seta de mover, alca de escala.
export function drawGizmo(v: Viewer) {
  const name = app.selection.bone;
  const b = name ? v.skeleton?.findBone(name) : null;
  if (!b) return;
  const p = b.appliedPose;
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
  if (!slotName || !v.skeleton) return null;
  const slot = v.skeleton.findSlot(slotName);
  const att = slot?.appliedPose.attachment;
  if (!slot || !att) return null;
  return { slot: slotName, attachment: att.name, isMesh: att instanceof MeshAttachment };
}

export function beginStroke(v: Viewer, visual: { x: number; y: number }): boolean {
  if (app.tool === "bone") {
    stroke = { kind: "bone", start: visual, cur: visual, merge: `bone${++seq}` };
    return true;
  }
  if (app.tool !== "deform") return false;
  // o que estiver sob o pincel; fora do personagem, o slot selecionado
  let target: ReturnType<typeof meshUnder> = null;
  if (v.skeleton) {
    const skel = v.flip ? { x: visual.x, y: -visual.y } : visual;
    const s = pickSlot(v.skeleton, skel.x, skel.y);
    if (s) {
      app.select({ slot: s, bone: v.skeleton.findSlot(s)!.bone.data.name });
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
  else if (target.slot) keys = a.slots?.[target.slot]?.[timeline];
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
