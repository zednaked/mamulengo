// Edicao da malha na setup pose: mover, adicionar e remover vertices (retriangula
// sozinho) e pintar a influencia de um osso. As chaves de deform da malha (e dos
// linked meshes que usam a mesma geometria) acompanham: cada vertice tem um bloco no
// array de deform (2 numeros sem pesos, 2 por osso com pesos), entao inserir, remover
// ou trocar os ossos de um vertice mexe so no bloco dele.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { animations, boneIndex, bones, requireBone, requireSkin, skins, slots } from "../model.ts";
import { pointInPolygon, triangulateHull, type Pt } from "../geometry.ts";
import { apply, applyLinear, boneWorld, invert, skeletonAt, type Affine } from "../pose.ts";
import { round } from "./timeline.ts";
import { attachmentAt, packDeform } from "./mesh.ts";
import type { Editor } from "../document.ts";
import type { SpineJson } from "../format.ts";

const SkinArg = z.string().default("default");

interface Infl {
  bone: number;
  x: number;
  y: number;
  w: number;
}
// vertice decodificado: uv (0..1 na imagem) e posicao (local no osso do slot, ou pesos)
interface Vtx {
  uv: Pt;
  local: Pt | null;
  inf: Infl[] | null;
}

// onde a geometria mora (a malha fonte, quando o attachment e linked mesh)
interface Loc {
  skin: string;
  si: number;
  slot: string;
  name: string;
  mesh: any;
}

// Como o runtime: linked mesh sem skin procura a fonte na skin default.
export function locateMesh(json: SpineJson, skin: string, slot: string, name: string): Loc {
  const a = attachmentAt(json, skin, slot, name);
  if (a.type === "linkedmesh") {
    const sSkin = a.skin ?? "default",
      sSlot = a.slot ?? slot;
    const src = attachmentAt(json, sSkin, sSlot, a.source);
    if (src.type !== "mesh") throw new Error(`fonte do linked mesh ${slot}/${name} nao e malha`);
    return { skin: sSkin, si: requireSkin(json, sSkin), slot: sSlot, name: a.source, mesh: src };
  }
  if (a.type !== "mesh") throw new Error(`${slot}/${name} nao e malha (e ${a.type ?? "region"}); use mesh.create para converter`);
  return { skin, si: requireSkin(json, skin), slot, name, mesh: a };
}

function decode(m: any): Vtx[] {
  const n = m.uvs.length / 2;
  const v = m.vertices;
  const weighted = v.length > m.uvs.length;
  const out: Vtx[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const uv: Pt = [m.uvs[i * 2], m.uvs[i * 2 + 1]];
    if (!weighted) {
      out.push({ uv, local: [v[i * 2], v[i * 2 + 1]], inf: null });
      continue;
    }
    const c = v[j++];
    const inf: Infl[] = [];
    for (let k = 0; k < c; k++, j += 4) inf.push({ bone: v[j], x: v[j + 1], y: v[j + 2], w: v[j + 3] });
    out.push({ uv, local: null, inf });
  }
  return out;
}

// matrizes da setup pose
interface Space {
  slotBone: string;
  slotW: Affine;
  bone(i: number): Affine;
  boneByName(n: string): Affine;
}

function space(json: SpineJson, slot: string): Space {
  const sk = skeletonAt(json, null, 0);
  const names = bones(json).map((b) => b.name);
  const cache = new Map<string, Affine>();
  const byName = (n: string) => {
    let m = cache.get(n);
    if (!m) cache.set(n, (m = boneWorld(sk, n)));
    return m;
  };
  const slotBone = slots(json).find((s) => s.name === slot)?.bone;
  if (!slotBone) throw new Error(`slot nao existe: ${slot}`);
  return { slotBone, slotW: byName(slotBone), bone: (i) => byName(names[i]), boneByName: byName };
}

function worldOf(S: Space, v: Vtx): Pt {
  if (!v.inf) return apply(S.slotW, v.local![0], v.local![1]);
  let x = 0,
    y = 0;
  for (const e of v.inf) {
    const p = apply(S.bone(e.bone), e.x, e.y);
    x += p[0] * e.w;
    y += p[1] * e.w;
  }
  return [x, y];
}

// --- blocos de deform por vertice

const blockLen = (v: Vtx) => (v.inf ? v.inf.length * 2 : 2);

// deslocamento no mundo (setup) que o bloco produz; R = osso do slot de quem usa o deform
function blockToWorld(S: Space, R: Affine, v: Vtx, b: number[]): Pt {
  if (!v.inf) return applyLinear(R, b[0] ?? 0, b[1] ?? 0);
  let x = 0,
    y = 0;
  v.inf.forEach((e, k) => {
    const p = applyLinear(S.bone(e.bone), b[k * 2] ?? 0, b[k * 2 + 1] ?? 0);
    x += p[0] * e.w;
    y += p[1] * e.w;
  });
  return [x, y];
}

function worldToBlock(S: Space, R: Affine, v: Vtx, d: Pt): number[] {
  if (!v.inf) return applyLinear(invert(R), d[0], d[1]).map(round);
  return v.inf.flatMap((e) => applyLinear(invert(S.bone(e.bone)), d[0], d[1]).map(round));
}

interface DeformRef {
  slot: string;
  path: (string | number)[];
  keys: any[];
}

// chaves de deform que leem esta geometria: a propria malha e os linked meshes dela
function deformRefs(json: SpineJson, loc: Loc): DeformRef[] {
  const users = [{ skin: loc.skin, slot: loc.slot, name: loc.name }];
  for (const sk of skins(json))
    for (const [sl, atts] of Object.entries<any>(sk.attachments ?? {}))
      for (const [n, a] of Object.entries<any>(atts ?? {}))
        if (a?.type === "linkedmesh" && a.source === loc.name && (a.skin ?? "default") === loc.skin && (a.slot ?? sl) === loc.slot) users.push({ skin: sk.name, slot: sl, name: n });
  const out: DeformRef[] = [];
  for (const [an, anim] of Object.entries<any>(animations(json)))
    for (const u of users) {
      const keys = anim.attachments?.[u.skin]?.[u.slot]?.[u.name]?.deform;
      if (Array.isArray(keys) && keys.length) out.push({ slot: u.slot, keys, path: ["animations", an, "attachments", u.skin, u.slot, u.name, "deform"] });
    }
  return out;
}

// chave com offset/vertices novos, na ordem do exportador (antes da curva)
function withDeform(k: any, packed: { offset?: number; vertices?: number[] }) {
  const out: any = {};
  let placed = false;
  const put = () => {
    if (placed) return;
    placed = true;
    if (packed.offset) out.offset = packed.offset;
    if (packed.vertices) out.vertices = packed.vertices;
  };
  for (const [key, val] of Object.entries<any>(k)) {
    if (key === "offset" || key === "vertices") {
      put();
      continue;
    }
    if (key === "curve") put();
    out[key] = val;
  }
  put();
  return out;
}

// Reescreve cada chave de deform: fn recebe os blocos (layout antigo) e devolve os novos.
function remapDeforms(e: Editor, S: Space, loc: Loc, old: Vtx[], fn: (blocks: number[][], R: Affine, sameBone: boolean) => number[][]): number {
  const len = old.reduce((s, v) => s + blockLen(v), 0);
  let n = 0;
  for (const ref of deformRefs(e.json, loc)) {
    const boneName = slots(e.json).find((s) => s.name === ref.slot)!.bone;
    const R = S.boneByName(boneName);
    ref.keys.forEach((k, ki) => {
      const full = new Array(len).fill(0);
      (k.vertices ?? []).forEach((x: number, i: number) => {
        if ((k.offset ?? 0) + i < len) full[(k.offset ?? 0) + i] = x;
      });
      const blocks: number[][] = [];
      let at = 0;
      for (const v of old) blocks.push(full.slice(at, (at += blockLen(v))));
      const next = fn(blocks, R, boneName === S.slotBone).flat();
      const nk = withDeform(k, packDeform(next));
      if (JSON.stringify(nk) !== JSON.stringify(k)) {
        e.set([...ref.path, ki], nk);
        n++;
      }
    });
  }
  return n;
}

// --- geometria auxiliar (mundo da setup pose)

function bary(p: Pt, a: Pt, b: Pt, c: Pt): [number, number, number] | null {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return null;
  const l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d;
  const l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d;
  return [l1, l2, 1 - l1 - l2];
}

function segParam(p: Pt, a: Pt, b: Pt): { t: number; d: number } {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return { t, d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) };
}

// triangulo que contem p (ou o mais proximo) e as baricentricas de p nele
function findTri(world: Pt[], tris: number[], p: Pt): { idx: [number, number, number]; b: [number, number, number]; inside: boolean } | null {
  let best: { idx: [number, number, number]; b: [number, number, number]; inside: boolean } | null = null;
  let bestD = Infinity;
  for (let t = 0; t < tris.length; t += 3) {
    const idx: [number, number, number] = [tris[t], tris[t + 1], tris[t + 2]];
    const b = bary(p, world[idx[0]], world[idx[1]], world[idx[2]]);
    if (!b) continue;
    if (b[0] >= -1e-6 && b[1] >= -1e-6 && b[2] >= -1e-6) return { idx, b, inside: true };
    let d = Infinity;
    for (let k = 0; k < 3; k++) d = Math.min(d, segParam(p, world[idx[k]], world[idx[(k + 1) % 3]]).d);
    if (d < bestD) (bestD = d), (best = { idx, b, inside: false });
  }
  return best;
}

// mistura de vertices (pesos das contribuicoes ja normalizados) num ponto P do mundo
function blendVertex(S: Space, V: Vtx[], contrib: [number, number][], P: Pt, uv: Pt): Vtx {
  if (!V[0].inf) {
    const inv = invert(S.slotW);
    return { uv, local: apply(inv, P[0], P[1]).map(round) as Pt, inf: null };
  }
  const acc = new Map<number, number>();
  for (const [i, k] of contrib) for (const e of V[i].inf!) acc.set(e.bone, (acc.get(e.bone) ?? 0) + e.w * k);
  return { uv, local: null, inf: normalizeInf(S, acc, P, 4) };
}

// pesos {osso: w} -> influencias normalizadas (ate max), com a posicao P preservada
function normalizeInf(S: Space, w: Map<number, number>, P: Pt, max: number): Infl[] {
  let top = [...w.entries()].filter(([, x]) => x > 0.002).sort((a, b) => b[1] - a[1]).slice(0, max);
  if (!top.length) top = [[[...w.entries()].sort((a, b) => b[1] - a[1])[0][0], 1]];
  const s = top.reduce((t, [, x]) => t + x, 0);
  return top.map(([bone, x]) => {
    const [lx, ly] = apply(invert(S.bone(bone)), P[0], P[1]);
    return { bone, x: round(lx), y: round(ly), w: round(x / s) };
  });
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// --- gravar

interface Commit {
  verts: Vtx[];
  hull: number;
  // pares de vertices (arestas do contorno sao refeitas pelo hull)
  inner: [number, number][];
  // triangulos mantidos (null = retriangula)
  triangles: number[] | null;
}

function commit(e: Editor, loc: Loc, c: Commit): { vertices: number; triangles: number; unused: number } {
  const m = loc.mesh;
  const W = m.width || 100,
    H = m.height || 100;
  const tris = c.triangles ?? triangulateHull(c.verts.map((v) => [v.uv[0] * W, v.uv[1] * H] as Pt), c.hull);
  if (!tris.length) throw new Error("a malha ficaria sem triangulos (contorno degenerado)");
  const used = new Set(tris);
  const uvs = c.verts.flatMap((v) => [round(v.uv[0]), round(v.uv[1])]);
  const vertices = c.verts[0].inf ? c.verts.flatMap((v) => [v.inf!.length, ...v.inf!.flatMap((x) => [x.bone, x.x, x.y, x.w])]) : c.verts.flatMap((v) => v.local!);
  const path = ["skins", loc.si, "attachments", loc.slot, loc.name];
  const set = (k: string, v: any) => {
    if (JSON.stringify(m[k]) !== JSON.stringify(v)) e.set([...path, k], v);
  };
  set("uvs", uvs);
  set("vertices", vertices);
  set("triangles", tris);
  set("hull", c.hull);
  if (m.edges) {
    const edges: number[] = [];
    for (let i = 0; i < c.hull; i++) edges.push(i * 2, ((i + 1) % c.hull) * 2);
    for (const [a, b] of c.inner) edges.push(a * 2, b * 2);
    set("edges", edges);
  }
  return { vertices: c.verts.length, triangles: tris.length / 3, unused: c.verts.length - used.size };
}

// arestas internas (nao essenciais, desenhadas no Spine) remapeadas
function innerEdges(m: any, map: (i: number) => number): [number, number][] {
  const h = m.hull ?? 0;
  const out: [number, number][] = [];
  const e = m.edges ?? [];
  for (let k = 0; k + 1 < e.length; k += 2) {
    const a = e[k] / 2,
      b = e[k + 1] / 2;
    const hullEdge = a < h && b < h && (Math.abs(a - b) === 1 || Math.abs(a - b) === h - 1);
    if (hullEdge) continue;
    const na = map(a),
      nb = map(b);
    if (na >= 0 && nb >= 0) out.push([na, nb]);
  }
  return out;
}

// triangulos ainda validos depois de mover (nenhum virou do avesso na imagem)
function trianglesStillValid(m: any, verts: Vtx[]): boolean {
  const t = m.triangles;
  const W = m.width || 100,
    H = m.height || 100;
  const area = (a: Pt, b: Pt, c: Pt) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * W * H;
  const old = decode(m);
  for (let i = 0; i < t.length; i += 3) {
    const a0 = area(old[t[i]].uv, old[t[i + 1]].uv, old[t[i + 2]].uv);
    const a1 = area(verts[t[i]].uv, verts[t[i + 1]].uv, verts[t[i + 2]].uv);
    if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) < 1e-6) return false;
  }
  return true;
}

// --- leitura para a UI

export interface MeshView {
  slot: string;
  attachment: string;
  source: { skin: string; slot: string; name: string };
  world: Pt[];
  hull: number;
  triangles: number[];
  weighted: boolean;
  // por vertice: osso -> peso (malha sem pesos: tudo no osso do slot)
  weights: Record<string, number>[];
  bones: string[];
}

export function meshView(json: SpineJson, skin: string, slot: string, attachment: string): MeshView {
  const loc = locateMesh(json, skin, slot, attachment);
  const S = space(json, slot);
  const V = decode(loc.mesh);
  const names = bones(json).map((b) => b.name);
  const weights = V.map((v) => (v.inf ? Object.fromEntries(v.inf.map((e) => [names[e.bone], e.w])) : { [S.slotBone]: 1 }));
  const used = new Set<string>();
  for (const w of weights) for (const b of Object.keys(w)) used.add(b);
  return {
    slot,
    attachment,
    source: { skin: loc.skin, slot: loc.slot, name: loc.name },
    world: V.map((v) => worldOf(S, v)),
    hull: loc.mesh.hull ?? 0,
    triangles: loc.mesh.triangles,
    weighted: !!V[0]?.inf,
    weights,
    bones: [...used],
  };
}

// --- comandos

const Target = { slot: z.string(), attachment: z.string(), skin: SkinArg };
const XY = z.tuple([z.number(), z.number()]);

defineCommand({
  name: "mesh.vertices",
  group: "attachment",
  summary:
    "Editar malha: move vertices na setup pose. moves = [{i, x, y}] posicao no MUNDO (pixels, y para cima) ou [{i, dx, dy}]. Por padrao o ponto anda sobre a imagem (a textura fica parada e o recorte muda, como 'editar malha' do Spine); stretch=true estica a imagem junto. Em malha com pesos a posicao vai para o espaco de cada osso. Deforms continuam valendo. Use query.mesh para ver os indices.",
  params: z.object({
    ...Target,
    moves: z.array(z.object({ i: z.number().int().min(0), x: z.number().optional(), y: z.number().optional(), dx: z.number().optional(), dy: z.number().optional() })).min(1),
    stretch: z.boolean().default(false).describe("true: a imagem estica com o ponto (uv fica); false: o ponto anda sobre a imagem"),
  }),
  label: (p) => `editar malha ${p.slot}/${p.attachment}`,
  run({ e }, p) {
    const loc = locateMesh(e.json, p.skin, p.slot, p.attachment);
    const S = space(e.json, p.slot);
    const V = decode(loc.mesh);
    const world = V.map((v) => worldOf(S, v));
    const next = V.map((v) => ({ uv: [...v.uv] as Pt, local: v.local ? ([...v.local] as Pt) : null, inf: v.inf?.map((x) => ({ ...x })) ?? null }));
    for (const mv of p.moves) {
      if (mv.i >= V.length) throw new Error(`vertice ${mv.i} nao existe (malha tem ${V.length})`);
      let P: Pt = [mv.x ?? world[mv.i][0] + (mv.dx ?? 0), mv.y ?? world[mv.i][1] + (mv.dy ?? 0)];
      if (!p.stretch) {
        // uv pelo mapa atual mundo -> imagem; fora da imagem, o ponto para na borda dela
        const t = findTri(world, loc.mesh.triangles, P);
        if (t) {
          const uv: Pt = [0, 1].map((k) => t.b[0] * V[t.idx[0]].uv[k] + t.b[1] * V[t.idx[1]].uv[k] + t.b[2] * V[t.idx[2]].uv[k]) as Pt;
          const cl: Pt = [clamp01(uv[0]), clamp01(uv[1])];
          if (cl[0] !== uv[0] || cl[1] !== uv[1]) {
            const ub = bary(cl, V[t.idx[0]].uv, V[t.idx[1]].uv, V[t.idx[2]].uv);
            if (ub) P = [0, 1].map((k) => ub[0] * world[t.idx[0]][k] + ub[1] * world[t.idx[1]][k] + ub[2] * world[t.idx[2]][k]) as Pt;
          }
          next[mv.i].uv = cl;
        }
      }
      const v = next[mv.i];
      if (!v.inf) v.local = apply(invert(S.slotW), P[0], P[1]).map(round) as Pt;
      else {
        const d: Pt = [P[0] - world[mv.i][0], P[1] - world[mv.i][1]];
        for (const x of v.inf) {
          const [lx, ly] = applyLinear(invert(S.bone(x.bone)), d[0], d[1]);
          x.x = round(x.x + lx);
          x.y = round(x.y + ly);
        }
      }
    }
    const keep = trianglesStillValid(loc.mesh, next);
    const r = commit(e, loc, { verts: next, hull: loc.mesh.hull ?? 0, inner: innerEdges(loc.mesh, (i) => i), triangles: keep ? loc.mesh.triangles : null });
    return { moved: p.moves.length, retriangulated: !keep, ...r };
  },
});

defineCommand({
  name: "mesh.addVertex",
  group: "attachment",
  summary:
    "Editar malha: adiciona um vertice em at (pixels do MUNDO na setup pose, y para cima). where auto: perto da borda (tolerance) vira ponto do contorno, dentro vira ponto interno; hull/inside forcam. Pesos, uv e deforms do ponto novo saem dos vizinhos; retriangula. Devolve o indice novo.",
  params: z.object({
    ...Target,
    at: XY,
    where: z.enum(["auto", "hull", "inside"]).default("auto"),
    tolerance: z.number().min(0).default(6).describe("auto: distancia ate a borda (pixels do mundo) para virar ponto do contorno"),
  }),
  label: (p) => `ponto na malha ${p.slot}/${p.attachment}`,
  run({ e }, p) {
    const loc = locateMesh(e.json, p.skin, p.slot, p.attachment);
    const m = loc.mesh;
    const S = space(e.json, p.slot);
    const V = decode(m);
    const world = V.map((v) => worldOf(S, v));
    const h = m.hull ?? 0;
    if (h < 3) throw new Error("malha sem contorno (hull)");
    const at = p.at as Pt;
    // aresta do contorno mais perto
    let edge = { k: 0, t: 0, d: Infinity };
    for (let k = 0; k < h; k++) {
      const s = segParam(at, world[k], world[(k + 1) % h]);
      if (s.d < edge.d) edge = { k, ...s };
    }
    const inside = pointInPolygon(at[0], at[1], world.slice(0, h));
    const onHull = p.where === "hull" || (p.where === "auto" && edge.d <= p.tolerance);
    if (!onHull && !(inside || p.where === "inside")) throw new Error(`o ponto (${at.map((x) => x.toFixed(1))}) esta fora da malha: clique dentro dela ou na borda`);
    let P: Pt, uv: Pt, contrib: [number, number][], index: number;
    if (onHull) {
      const a = edge.k,
        b = (edge.k + 1) % h;
      const t = Math.max(0.001, Math.min(0.999, edge.t));
      contrib = [
        [a, 1 - t],
        [b, t],
      ];
      if (edge.d <= p.tolerance) {
        // em cima da aresta: no ponto da aresta, sem mudar o recorte
        P = [world[a][0] + (world[b][0] - world[a][0]) * t, world[a][1] + (world[b][1] - world[a][1]) * t];
        uv = [V[a].uv[0] + (V[b].uv[0] - V[a].uv[0]) * t, V[a].uv[1] + (V[b].uv[1] - V[a].uv[1]) * t];
      } else {
        // longe da borda: estende o contorno ate o ponto (limitado a imagem)
        P = at;
        const f = findTri(world, m.triangles, P)!;
        uv = [0, 1].map((k) => clamp01(f.b[0] * V[f.idx[0]].uv[k] + f.b[1] * V[f.idx[1]].uv[k] + f.b[2] * V[f.idx[2]].uv[k])) as Pt;
      }
      index = edge.k + 1;
    } else {
      const f = findTri(world, m.triangles, at);
      if (!f || !f.inside) throw new Error("o ponto nao cai em nenhum triangulo da malha");
      P = at;
      contrib = f.idx.map((i, k) => [i, f.b[k]] as [number, number]);
      uv = [0, 1].map((k) => f.b[0] * V[f.idx[0]].uv[k] + f.b[1] * V[f.idx[1]].uv[k] + f.b[2] * V[f.idx[2]].uv[k]) as Pt;
      index = V.length;
    }
    const near = world.findIndex((q) => Math.hypot(q[0] - P[0], q[1] - P[1]) < 0.5);
    if (near >= 0) throw new Error(`ja existe o vertice ${near} nesse lugar`);
    const nv = blendVertex(S, V, contrib, P, uv);
    const verts = V.slice();
    verts.splice(index, 0, nv);
    const map = (i: number) => (i < index ? i : i + 1);
    const keys = remapDeforms(e, S, loc, V, (blocks, R) => {
      let d: Pt = [0, 0];
      for (const [i, k] of contrib) {
        const w = blockToWorld(S, R, V[i], blocks[i]);
        d = [d[0] + w[0] * k, d[1] + w[1] * k];
      }
      const out = blocks.slice();
      out.splice(index, 0, worldToBlock(S, R, nv, d));
      return out;
    });
    const r = commit(e, loc, { verts, hull: onHull ? h + 1 : h, inner: innerEdges(m, map), triangles: null });
    return { i: index, onHull, world: P.map((x) => +x.toFixed(2)), deformKeys: keys, ...r };
  },
});

defineCommand({
  name: "mesh.removeVertex",
  group: "attachment",
  summary: "Editar malha: remove vertices (indice ou lista). O contorno precisa ficar com 3 pontos ou mais. Deforms perdem o bloco do vertice; retriangula.",
  params: z.object({ ...Target, i: z.union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)]) }),
  label: (p) => `tira ponto da malha ${p.slot}/${p.attachment}`,
  run({ e }, p) {
    const loc = locateMesh(e.json, p.skin, p.slot, p.attachment);
    const m = loc.mesh;
    const S = space(e.json, p.slot);
    const V = decode(m);
    const del = new Set(Array.isArray(p.i) ? p.i : [p.i]);
    for (const i of del) if (i >= V.length) throw new Error(`vertice ${i} nao existe (malha tem ${V.length})`);
    const h = m.hull ?? 0;
    const hull = h - [...del].filter((i) => i < h).length;
    if (hull < 3) throw new Error("o contorno precisa de pelo menos 3 pontos");
    const remap: number[] = [];
    let n = 0;
    for (let i = 0; i < V.length; i++) remap.push(del.has(i) ? -1 : n++);
    const verts = V.filter((_, i) => !del.has(i));
    const keys = remapDeforms(e, S, loc, V, (blocks) => blocks.filter((_, i) => !del.has(i)));
    const r = commit(e, loc, { verts, hull, inner: innerEdges(m, (i) => remap[i]), triangles: null });
    return { removed: del.size, deformKeys: keys, ...r };
  },
});

defineCommand({
  name: "mesh.paintWeights",
  group: "attachment",
  summary:
    "Pincel de pesos: aumenta (amount > 0) ou diminui (amount < 0) a influencia de um osso nos vertices perto dos pontos (pixels do MUNDO na setup pose), com queda suave ate radius; value puxa o peso para um valor (0..1). vertices = indices pinta so esses. Os outros ossos do vertice se ajustam para somar 1; malha sem pesos passa a ter. Deforms acompanham.",
  params: z.object({
    ...Target,
    bone: z.string(),
    points: z.array(XY).optional().describe("centros do pincel (um traco = varios pontos, aplicados em ordem)"),
    radius: z.number().positive().default(40),
    vertices: z.array(z.number().int().min(0)).optional(),
    amount: z.number().min(-1).max(1).default(0.5),
    value: z.number().min(0).max(1).optional(),
    falloff: z.enum(["suave", "linear", "constante"]).default("suave"),
    maxBones: z.number().int().min(1).max(8).default(4),
  }),
  label: (p) => `pesos de ${p.bone} em ${p.slot}/${p.attachment}`,
  run({ e }, p) {
    const loc = locateMesh(e.json, p.skin, p.slot, p.attachment);
    const m = loc.mesh;
    const S = space(e.json, p.slot);
    const V = decode(m);
    const world = V.map((v) => worldOf(S, v));
    const bi = requireBone(e.json, p.bone);
    const slotBi = boneIndex(e.json, S.slotBone);
    if (!p.points?.length && !p.vertices?.length) throw new Error("passe points (pincel) ou vertices");
    const W = V.map((v) => new Map<number, number>(v.inf ? v.inf.map((x) => [x.bone, x.w]) : [[slotBi, 1]]));
    // para quem vai o peso tirado de um vertice que so tinha este osso: o osso mais perto
    const cands = new Set<number>([slotBi]);
    for (const w of W) for (const b of w.keys()) cands.add(b);
    const parent = bones(e.json)[bi].parent;
    if (parent) cands.add(boneIndex(e.json, parent));
    cands.delete(bi);
    const segOf = (b: number) => {
      const m2 = S.bone(b);
      const len = bones(e.json)[b].length ?? 0;
      return [[m2.x, m2.y], [m2.x + m2.a * len, m2.y + m2.c * len]] as [Pt, Pt];
    };
    const fallback = (q: Pt) => {
      let best = -1,
        bd = Infinity;
      for (const b of cands) {
        const [a, z2] = segOf(b);
        const d = segParam(q, a, z2).d;
        if (d < bd) (bd = d), (best = b);
      }
      return best;
    };
    const changed = new Set<number>();
    const dab = (i: number, k: number) => {
      if (k <= 0) return;
      const w = W[i];
      const cur = w.get(bi) ?? 0;
      let nw = p.value !== undefined ? cur + (p.value - cur) * k : p.amount >= 0 ? cur + (1 - cur) * k : cur * (1 - k);
      nw = clamp01(nw);
      if (Math.abs(nw - cur) < 1e-7) return;
      const rest = 1 - nw;
      const others = 1 - cur;
      if (others > 1e-6) {
        for (const [b, x] of w) if (b !== bi) w.set(b, (x / others) * rest);
      } else if (rest > 1e-6) {
        const fb = fallback(world[i]);
        if (fb < 0) return;
        w.set(fb, rest);
      }
      w.set(bi, nw);
      changed.add(i);
    };
    const strength = p.value !== undefined ? Math.abs(p.amount || 1) : Math.abs(p.amount);
    let touched = 0;
    if (p.vertices?.length) {
      for (const i of p.vertices) {
        if (i >= V.length) throw new Error(`vertice ${i} nao existe (malha tem ${V.length})`);
        dab(i, strength);
        touched++;
      }
    }
    for (const c of p.points ?? []) {
      world.forEach((q, i) => {
        const d = Math.hypot(q[0] - c[0], q[1] - c[1]) / p.radius;
        if (d >= 1) return;
        touched++;
        const f = p.falloff === "constante" ? 1 : p.falloff === "linear" ? 1 - d : 0.5 + 0.5 * Math.cos(Math.PI * d);
        dab(i, strength * f);
      });
    }
    if (!touched) {
      const xs = world.map((q) => q[0]),
        ys = world.map((q) => q[1]);
      throw new Error(`nenhum vertice dentro do raio ${p.radius}. Vertices vao de x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}, y ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}`);
    }
    const wasWeighted = !!V[0].inf;
    if (!changed.size && wasWeighted) return { touched, changed: 0 };
    // vertices novos: os que mudaram ganham influencias novas na mesma posicao
    const verts: Vtx[] = V.map((v, i) => {
      if (changed.has(i)) return { uv: v.uv, local: null, inf: normalizeInf(S, W[i], world[i], p.maxBones) };
      if (v.inf) return v;
      return { uv: v.uv, local: null, inf: [{ bone: slotBi, x: v.local![0], y: v.local![1], w: 1 }] };
    });
    const keys = remapDeforms(e, S, loc, V, (blocks, R, sameBone) =>
      blocks.map((b, i) => {
        if (!changed.has(i) && (wasWeighted || sameBone)) return b;
        return worldToBlock(S, R, verts[i], blockToWorld(S, R, V[i], b));
      }),
    );
    commit(e, loc, { verts, hull: m.hull ?? 0, inner: innerEdges(m, (i) => i), triangles: m.triangles });
    return { touched, changed: changed.size, deformKeys: keys, influences: verts.reduce((s, v) => s + v.inf!.length, 0) };
  },
});
