// Editar malha no viewport (na Pose base): pontos (mover, adicionar na borda ou dentro,
// apagar) e pintura de pesos de um osso. Tudo vira comando do core (mesh.vertices,
// mesh.addVertex, mesh.removeVertex, mesh.paintWeights); aqui so ha mira e desenho.
// Coordenadas: visual (y para cima) = mundo dos comandos; o desenho converte para o
// espaco do esqueleto (invertido no modo godot).
import { Color } from "@esotericsoftware/spine-webgl";
import type { Viewer } from "../render/viewer.ts";
import { meshView, type MeshView } from "../core/commands/meshedit.ts";
import { pointInPolygon, type Pt } from "../core/geometry.ts";
import { app, type MeshEdit } from "./state.svelte.ts";
import { cursor } from "./interact.ts";

const HIT_VERTEX = 9; // px de tela
const HIT_EDGE = 8;

let cache: { key: string; view: MeshView | null } = { key: "", view: null };

// malha em edicao, relida so quando o documento muda
export function currentMesh(): MeshView | null {
  const me = app.meshEdit;
  const doc = app.doc;
  if (!me || !doc) return null;
  const key = `${doc.version}|${me.skin}|${me.slot}|${me.attachment}`;
  if (cache.key !== key) {
    let view: MeshView | null = null;
    // a malha e editada na Pose base: no modo "nucleo" o mundo dos ossos vem da pose do nucleo
    // (o viewer nesta versao do documento e na Pose base); nos outros modos, o comando calcula
    // pelo spine-core
    const v = app.viewer;
    v?.sync();
    const pose = v?.useNucleo && !v.view.animation ? v.pose : null;
    const world = pose
      ? (n: string) => {
          const b = pose.findBone(n);
          return b ? { a: b.a, b: b.b, c: b.c, d: b.d, x: b.worldX, y: b.worldY } : null;
        }
      : undefined;
    try {
      view = meshView(doc.json, me.skin, me.slot, me.attachment, world);
    } catch {
      view = null;
    }
    cache = { key, view };
  }
  return cache.view;
}

// skin onde o attachment do slot mora
function skinOf(slot: string, attachment: string): string | null {
  for (const s of app.doc?.json.skins ?? []) if (s.attachments?.[slot]?.[attachment]) return s.name;
  return null;
}

export function startMeshEdit(slot: string, attachment: string) {
  const skin = skinOf(slot, attachment);
  if (!skin) return;
  // a malha e editada na pose de montagem, parada
  app.mode = "setup";
  if (app.viewer) app.viewer.view.playing = false;
  const bone = app.doc?.json.slots.find((s: any) => s.name === slot)?.bone ?? null;
  app.meshEdit = { slot, attachment, skin, tab: "points", vertex: null, bone, paint: "add", strength: 0.5, stretch: false };
}

export function stopMeshEdit() {
  app.meshEdit = null;
  drag = null;
}

// --- mira

const dist = (a: Pt, b: { x: number; y: number }) => Math.hypot(a[0] - b.x, a[1] - b.y);

function nearestVertex(m: MeshView, p: { x: number; y: number }, r: number): number {
  let best = -1,
    bd = r;
  m.world.forEach((q, i) => {
    const d = dist(q, p);
    if (d < bd) (bd = d), (best = i);
  });
  return best;
}

function nearestEdge(m: MeshView, p: { x: number; y: number }): { k: number; d: number; at: Pt } {
  let out = { k: -1, d: Infinity, at: [0, 0] as Pt };
  for (let k = 0; k < m.hull; k++) {
    const a = m.world[k],
      b = m.world[(k + 1) % m.hull];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l)) : 0;
    const at: Pt = [a[0] + t * dx, a[1] + t * dy];
    const d = dist(at, p);
    if (d < out.d) out = { k, d, at };
  }
  return out;
}

// o que um clique faria aqui (para o desenho mostrar antes)
type Aim = { kind: "vertex"; i: number } | { kind: "edge"; at: Pt } | { kind: "inside"; at: Pt } | { kind: "none" };

function aim(v: Viewer, m: MeshView, p: { x: number; y: number }): Aim {
  const z = v.cam.zoom;
  const i = nearestVertex(m, p, HIT_VERTEX / z);
  if (i >= 0) return { kind: "vertex", i };
  const e = nearestEdge(m, p);
  if (e.d < HIT_EDGE / z) return { kind: "edge", at: e.at };
  if (pointInPolygon(p.x, p.y, m.world.slice(0, m.hull))) return { kind: "inside", at: [p.x, p.y] };
  return { kind: "none" };
}

// --- arraste e pincel

interface Drag {
  kind: "vertex" | "paint";
  merge: string;
  start: { x: number; y: number };
  i?: number;
  orig?: Pt;
  points?: Pt[];
  sub?: boolean;
}
let drag: Drag | null = null;
let seq = 0;

const target = (me: MeshEdit) => ({ slot: me.slot, attachment: me.attachment, skin: me.skin });

export function meshDown(v: Viewer, p: { x: number; y: number }, shift: boolean): boolean {
  const me = app.meshEdit;
  const m = currentMesh();
  if (!me || !m) return false;
  v.view.playing = false;
  if (me.tab === "weights") {
    if (!me.bone) {
      app.toast("Escolha no painel qual osso voce quer pintar.");
      return true;
    }
    drag = { kind: "paint", merge: `pesos${++seq}`, start: p, points: [[p.x, p.y]], sub: shift ? me.paint === "add" : me.paint === "sub" };
    paint(v);
    return true;
  }
  const a = aim(v, m, p);
  if (a.kind === "vertex") {
    me.vertex = a.i;
    drag = { kind: "vertex", merge: `ponto${++seq}`, start: p, i: a.i, orig: m.world[a.i] };
    return true;
  }
  if (a.kind === "edge" || a.kind === "inside") {
    const r = app.run({ cmd: "mesh.addVertex", args: { ...target(me), at: a.at, where: a.kind === "edge" ? "hull" : "inside", tolerance: HIT_EDGE / v.cam.zoom } }, a.kind === "edge" ? "ponto novo no contorno" : "ponto novo na malha");
    if (r?.[0]) {
      me.vertex = r[0].i;
      // ja pode arrastar o ponto recem-criado
      drag = { kind: "vertex", merge: `ponto${++seq}`, start: p, i: r[0].i, orig: r[0].world };
    }
    return true;
  }
  me.vertex = null;
  return true;
}

export function meshMove(v: Viewer, p: { x: number; y: number }) {
  const me = app.meshEdit;
  if (!drag || !me) return;
  if (drag.kind === "vertex") {
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * v.cam.zoom < 2) return;
    const x = drag.orig![0] + (p.x - drag.start.x),
      y = drag.orig![1] + (p.y - drag.start.y);
    app.run({ cmd: "mesh.vertices", args: { ...target(me), moves: [{ i: drag.i, x, y }], stretch: me.stretch } }, `mover ponto ${drag.i}`, drag.merge);
    return;
  }
  // pincel: um ponto novo a cada pedacinho do raio (o traco inteiro e uma acao so)
  const last = drag.points![drag.points!.length - 1];
  const r = app.brushRadius / v.cam.zoom;
  if (Math.hypot(p.x - last[0], p.y - last[1]) < r * 0.2) return;
  drag.points!.push([p.x, p.y]);
  paint(v);
}

function paint(v: Viewer) {
  const me = app.meshEdit;
  const m = currentMesh();
  if (!drag || drag.kind !== "paint" || !me || !m) return;
  const r = app.brushRadius / v.cam.zoom;
  const pts = drag.points!;
  // nada sob o pincel ainda: espera (o comando reclamaria)
  if (!m.world.some((q) => pts.some((c) => Math.hypot(q[0] - c[0], q[1] - c[1]) < r))) return;
  const amount = (drag.sub ? -1 : 1) * me.strength;
  app.run({ cmd: "mesh.paintWeights", args: { ...target(me), bone: me.bone, points: pts, radius: r, amount } }, `${drag.sub ? "tira" : "pinta"} ${me.bone} em ${me.attachment}`, drag.merge);
}

export function meshUp() {
  drag = null;
}

export function meshDragging() {
  return drag !== null;
}

export function deleteVertex() {
  const me = app.meshEdit;
  if (!me || me.vertex === null) return;
  // indice velho (depois de desfazer): so tira a escolha
  if (me.vertex >= (currentMesh()?.world.length ?? 0)) {
    me.vertex = null;
    return;
  }
  const r = app.run({ cmd: "mesh.removeVertex", args: { ...target(me), i: me.vertex } }, `apaga ponto ${me.vertex}`);
  if (r) me.vertex = null;
}

// --- desenho

// cor do peso: azul (nada) -> verde -> amarelo -> vermelho (tudo), como no Spine
export function weightColor(w: number, alpha = 1): Color {
  const stops = [
    [0, 0.16, 0.22, 0.62],
    [0.35, 0.15, 0.8, 0.55],
    [0.7, 1, 0.85, 0.2],
    [1, 1, 0.22, 0.2],
  ];
  const x = Math.max(0, Math.min(1, w));
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
  const [a, b] = [stops[i], stops[i + 1]];
  const t = (x - a[0]) / (b[0] - a[0]);
  return new Color(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, alpha);
}

export function drawMeshEdit(v: Viewer) {
  const me = app.meshEdit;
  const m = currentMesh();
  if (!me || !m) return;
  const s = v.scene;
  const z = v.cam.zoom;
  const P = m.world.map((q) => (v.flip ? [q[0], -q[1]] : q));
  const tri = m.triangles;
  // pontos menores quando a malha e densa na tela (aresta media curta)
  let sum = 0;
  for (let t = 0; t < tri.length; t += 3) sum += Math.hypot(P[tri[t]][0] - P[tri[t + 1]][0], P[tri[t]][1] - P[tri[t + 1]][1]);
  const dot = Math.max(2.5, Math.min(4.5, ((sum / Math.max(1, tri.length / 3)) * z) / 5));
  if (me.tab === "weights") {
    const w = m.weights.map((x) => (me.bone ? (x[me.bone] ?? 0) : 0));
    for (let t = 0; t < tri.length; t += 3) {
      const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
      s.triangle(true, P[a][0], P[a][1], P[b][0], P[b][1], P[c][0], P[c][1], weightColor(w[a], 0.6), weightColor(w[b], 0.6), weightColor(w[c], 0.6));
    }
    const line = new Color(1, 1, 1, 0.25);
    for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) {
      const [a, b] = [tri[t + k], tri[t + ((k + 1) % 3)]];
      s.line(P[a][0], P[a][1], P[b][0], P[b][1], line);
    }
    P.forEach((q, i) => {
      s.circle(true, q[0], q[1], (dot + 1.3) / z, new Color(0.08, 0.07, 0.1, 0.9), 12);
      s.circle(true, q[0], q[1], dot / z, weightColor(w[i]), 12);
    });
    // osso escolhido em destaque
    const p = me.bone ? v.pose?.findBone(me.bone) : null;
    if (p) {
      const len = Math.max(p.length, 14 / z);
      const col = new Color(1, 0.82, 0.4, 1);
      for (const o of [-1, 0, 1]) s.line(p.worldX + (o * 1.2) / z, p.worldY, p.worldX + p.a * len + (o * 1.2) / z, p.worldY + p.c * len, col);
      s.circle(true, p.worldX, p.worldY, 5 / z, col, 16);
    }
    if (cursor.inside) {
      const c = v.flip ? { x: cursor.x, y: -cursor.y } : cursor;
      const sub = drag?.kind === "paint" ? drag.sub : me.paint === "sub";
      s.circle(false, c.x, c.y, app.brushRadius / z, sub ? new Color(0.45, 0.65, 1, 0.95) : new Color(1, 0.5, 0.3, 0.95), 48);
    }
    return;
  }
  // pontos: triangulos finos, contorno forte, vertices grandes
  const thin = new Color(0.37, 0.88, 0.82, 0.45);
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) {
    const [a, b] = [tri[t + k], tri[t + ((k + 1) % 3)]];
    s.line(P[a][0], P[a][1], P[b][0], P[b][1], thin);
  }
  const hullCol = new Color(1, 0.18, 0.53, 1);
  for (let k = 0; k < m.hull; k++) {
    const [a, b] = [P[k], P[(k + 1) % m.hull]];
    s.line(a[0], a[1], b[0], b[1], hullCol);
    // linha dupla para o contorno ler bem
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (1 / z),
      ny = (dx / l) * (1 / z);
    s.line(a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, hullCol);
  }
  const hover = cursor.inside && !drag ? aim(v, m, cursor) : { kind: "none" as const };
  P.forEach((q, i) => {
    const sel = i === me.vertex;
    const hot = hover.kind === "vertex" && hover.i === i;
    const r = (sel ? dot + 2 : hot ? dot + 1.5 : dot) / z;
    s.circle(true, q[0], q[1], r + 1.5 / z, new Color(0.08, 0.07, 0.1, 0.95), 16);
    s.circle(true, q[0], q[1], r, sel ? new Color(1, 1, 1, 1) : i < m.hull ? hullCol : new Color(0.37, 0.88, 0.82, 1), 16);
  });
  // previa do ponto que o clique criaria
  if (hover.kind === "edge" || hover.kind === "inside") {
    const q = v.flip ? [hover.at[0], -hover.at[1]] : hover.at;
    const c = hover.kind === "edge" ? hullCol : new Color(0.37, 0.88, 0.82, 1);
    s.circle(false, q[0], q[1], 6 / z, c, 16);
    s.line(q[0] - 4 / z, q[1], q[0] + 4 / z, q[1], c);
    s.line(q[0], q[1] - 4 / z, q[0], q[1] + 4 / z, c);
  }
}
