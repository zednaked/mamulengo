// Malhas e deformacao de textura: criar malha a partir da imagem, pesos, deform por
// deslocamento ou pincel, linked mesh, clipping e outros attachments de vertices.
import { z } from "zod";
import { defineCommand, type CommandCtx } from "./registry.ts";
import { boneIndex, bones, requireAnimation, requireBone, requireSkin, requireSlot, skins, slots } from "../model.ts";
import { autoMesh, gridMesh, type Pt } from "../geometry.ts";
import { apply, applyLinear, boneWorld, invert, skeletonAt, type Affine } from "../pose.ts";
import { getKeys, round, timeOf } from "./timeline.ts";
import type { SpineJson } from "../format.ts";

const SkinArg = z.string().default("default");

// --- leitura de attachments

export function attachmentAt(doc: SpineJson, skin: string, slot: string, name: string): any {
  const s = skins(doc).find((x) => x.name === skin);
  const a = s?.attachments?.[slot]?.[name];
  if (!a) {
    const have = Object.keys(s?.attachments?.[slot] ?? {});
    throw new Error(`attachment nao existe: ${skin}/${slot}/${name}${have.length ? `. No slot: ${have.join(", ")}` : ""}`);
  }
  return a;
}

function resolveMesh(doc: SpineJson, skin: string, slot: string, name: string): { mesh: any; source: any } {
  const a = attachmentAt(doc, skin, slot, name);
  if (a.type === "linkedmesh") {
    // a geometria vem da malha fonte; sem campo skin, o runtime procura na skin default
    const src = attachmentAt(doc, a.skin ?? "default", a.slot ?? slot, a.source);
    return { mesh: a, source: src };
  }
  if (a.type !== "mesh") throw new Error(`${slot}/${name} nao e malha (e ${a.type ?? "region"}); use mesh.create para converter`);
  return { mesh: a, source: a };
}

export const vertexCount = (m: any) => m.uvs.length / 2;
export const isWeighted = (m: any) => m.vertices.length > m.uvs.length;

// Vertices com pesos: [{bone, x, y, w}...] por vertice.
export function weightsOf(m: any): { bone: number; x: number; y: number; w: number }[][] {
  const out: { bone: number; x: number; y: number; w: number }[][] = [];
  if (!isWeighted(m)) return out;
  const v = m.vertices;
  for (let i = 0; i < v.length; ) {
    const n = v[i++];
    const list = [];
    for (let k = 0; k < n; k++, i += 4) list.push({ bone: v[i], x: v[i + 1], y: v[i + 2], w: v[i + 3] });
    out.push(list);
  }
  return out;
}

// Posicao de mundo dos vertices na pose dada (sem deform).
export function worldVertices(doc: SpineJson, sk: ReturnType<typeof skeletonAt>, slot: string, m: any, deform?: number[] | null): Pt[] {
  const slotBone = slots(doc).find((s) => s.name === slot)!.bone;
  const out: Pt[] = [];
  if (!isWeighted(m)) {
    const W = boneWorld(sk, slotBone);
    for (let i = 0; i < m.vertices.length; i += 2) out.push(apply(W, m.vertices[i] + (deform?.[i] ?? 0), m.vertices[i + 1] + (deform?.[i + 1] ?? 0)));
    return out;
  }
  let f = 0;
  for (const list of weightsOf(m)) {
    let x = 0,
      y = 0;
    for (const e of list) {
      const W = boneWorld(sk, bones(doc)[e.bone].name);
      const p = apply(W, e.x + (deform?.[f] ?? 0), e.y + (deform?.[f + 1] ?? 0));
      x += p[0] * e.w;
      y += p[1] * e.w;
      f += 2;
    }
    out.push([x, y]);
  }
  return out;
}

// Converte deslocamentos de mundo por vertice nos valores de deform do formato
// (offsets no espaco do osso do slot, ou por par vertice/osso em malha com pesos).
function worldToDeform(doc: SpineJson, sk: ReturnType<typeof skeletonAt>, slot: string, m: any, deltas: Pt[]): number[] {
  const slotBone = slots(doc).find((s) => s.name === slot)!.bone;
  const out: number[] = [];
  if (!isWeighted(m)) {
    const inv = invert(boneWorld(sk, slotBone));
    for (const d of deltas) out.push(...applyLinear(inv, d[0], d[1]));
    return out;
  }
  weightsOf(m).forEach((list, vi) => {
    for (const e of list) out.push(...applyLinear(invert(boneWorld(sk, bones(doc)[e.bone].name)), deltas[vi][0], deltas[vi][1]));
  });
  return out;
}

function deformLength(m: any) {
  return isWeighted(m) ? weightsOf(m).reduce((s, l) => s + l.length * 2, 0) : m.vertices.length;
}

// --- deform corrente num instante (com as curvas do formato)

function bezierY(curve: number[], t0: number, t1: number, t: number): number {
  // curva de deform: [cx1, cy1, cx2, cy2] com x em tempo absoluto e y em 0..1
  const [x1, y1, x2, y2] = curve;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    const x = (1 - s) ** 3 * t0 + 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3 * t1;
    x < t ? (lo = s) : (hi = s);
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3;
}

export function deformAt(keys: any[], len: number, t: number): number[] {
  const full = (k: any) => {
    const v = new Array(len).fill(0);
    (k?.vertices ?? []).forEach((x: number, i: number) => (v[(k.offset ?? 0) + i] = x));
    return v;
  };
  if (!keys.length) return new Array(len).fill(0);
  if (t <= timeOf(keys[0])) return full(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (t < timeOf(b)) {
      if (a.curve === "stepped") return full(a);
      const t0 = timeOf(a),
        t1 = timeOf(b);
      const k = Array.isArray(a.curve) ? bezierY(a.curve, t0, t1, t) : (t - t0) / (t1 - t0);
      const va = full(a),
        vb = full(b);
      return va.map((x, j) => x + (vb[j] - x) * k);
    }
  }
  return full(keys[keys.length - 1]);
}

// Remove zeros das pontas como o exportador (offset + vertices).
export function packDeform(v: number[]): { offset?: number; vertices?: number[] } {
  let s = 0,
    e = v.length;
  while (s < e && Math.abs(v[s]) < 1e-6) s++;
  while (e > s && Math.abs(v[e - 1]) < 1e-6) e--;
  if (s === e) return {};
  const out: { offset?: number; vertices?: number[] } = { vertices: v.slice(s, e).map(round) };
  if (s) out.offset = s;
  return out;
}

// --- comandos

const MeshMode = z.enum(["auto", "grid", "points"]);

defineCommand({
  name: "mesh.create",
  group: "attachment",
  summary:
    "Transforma uma imagem num slot em malha deformavel (mesmo nome, entao as animacoes continuam valendo). mode auto: contorno da imagem + grade interna (detail 0.5 grosso a 2 fino); grid: cols x rows; points: hull/interior em pixels da imagem. Depois use mesh.weights e deform.*",
  params: z.preprocess(
    // os outros comandos de malha chamam de attachment: aceita os dois
    (v: any) => (v && v.name === undefined && v.attachment !== undefined ? { ...v, name: v.attachment, attachment: undefined } : v),
    z.object({
    slot: z.string(),
    name: z.string().describe("attachment region existente a converter, ou nome novo (com path); attachment tambem vale"),
    skin: SkinArg,
    path: z.string().optional().describe("regiao do atlas (se diferente do nome)"),
    replace: z.boolean().default(false).describe("refaz uma malha que ja existe (sem pesos), no mesmo lugar; os deforms dela nas animacoes saem"),
    mode: MeshMode.default("auto"),
    detail: z.number().min(0.25).max(4).default(1),
    grid: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
    hull: z.array(z.tuple([z.number(), z.number()])).optional().describe("mode points: contorno em pixels da imagem (y para baixo), em ordem"),
    interior: z.array(z.tuple([z.number(), z.number()])).optional(),
  }),
  ),
  label: (p) => `malha ${p.slot}/${p.name}`,
  async prepare(ctx, p) {
    // alpha da imagem original, para o contorno automatico
    const cur = skins(ctx.doc.json).find((s) => s.name === p.skin)?.attachments?.[p.slot]?.[p.name];
    const path = p.path ?? cur?.path ?? p.name;
    const img = await ctx.assets?.image(path);
    if (!img) throw new Error(`imagem da regiao "${path}" nao disponivel (o atlas tem essa regiao?)`);
    return img;
  },
  run({ e, prepared }, p) {
    const img = prepared as { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
    const si = requireSkin(e.json, p.skin);
    requireSlot(e.json, p.slot);
    const cur = skins(e.json)[si].attachments?.[p.slot]?.[p.name];
    let toLocal: (u: number, v: number) => Pt;
    let removedDeforms = 0;
    if (cur && cur.type === "mesh") {
      if (!p.replace) throw new Error(`${p.slot}/${p.name} ja e malha: use replace:true para refazer (os deforms dela saem), ou mesh.vertices/addVertex para ajustar`);
      if (cur.vertices.length !== cur.uvs.length) throw new Error(`${p.slot}/${p.name} tem pesos: refazer perderia os pesos; ajuste com mesh.addVertex/removeVertex`);
      // uv -> local da malha atual por minimos quadrados (afim): a nova fica no mesmo lugar
      const n = cur.uvs.length / 2;
      let [su, sv, sx2, sy2, suu, svv, suv, sux, svx, suy, svy] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const u = cur.uvs[i * 2],
          w = cur.uvs[i * 2 + 1],
          x = cur.vertices[i * 2],
          y = cur.vertices[i * 2 + 1];
        su += u; sv += w; sx2 += x; sy2 += y; suu += u * u; svv += w * w; suv += u * w; sux += u * x; svx += w * x; suy += u * y; svy += w * y;
      }
      const mu = su / n, mv = sv / n, mx = sx2 / n, my = sy2 / n;
      const cuu = suu / n - mu * mu, cvv = svv / n - mv * mv, cuv = suv / n - mu * mv;
      const det = cuu * cvv - cuv * cuv || 1e-12;
      const cux = sux / n - mu * mx, cvx = svx / n - mv * mx, cuy = suy / n - mu * my, cvy = svy / n - mv * my;
      const ax = (cux * cvv - cvx * cuv) / det, bx = (cvx * cuu - cux * cuv) / det;
      const ay = (cuy * cvv - cvy * cuv) / det, by = (cvy * cuu - cuy * cuv) / det;
      toLocal = (u, v) => [round(mx + ax * (u - mu) + bx * (v - mv)), round(my + ay * (u - mu) + by * (v - mv))];
      // deforms desta malha ficam com o numero de vertices antigo: saem
      for (const [an, anim] of Object.entries<any>(e.json.animations ?? {}))
        if (anim.attachments?.[p.skin]?.[p.slot]?.[p.name]?.deform) {
          e.set(["animations", an, "attachments", p.skin, p.slot, p.name, "deform"], undefined);
          removedDeforms++;
        }
    } else {
      if (cur && (cur.type ?? "region") !== "region") throw new Error(`${p.slot}/${p.name} ja e ${cur.type}`);
      // transformacao da region (a malha herda a mesma posicao na tela)
      const r = cur ?? { width: img.width, height: img.height };
      const rw = r.width ?? img.width,
        rh = r.height ?? img.height;
      const rot = ((r.rotation ?? 0) * Math.PI) / 180,
        cos = Math.cos(rot),
        sin = Math.sin(rot);
      const sx = r.scaleX ?? 1,
        sy = r.scaleY ?? 1;
      toLocal = (u: number, v: number): Pt => {
        const lx = (u - 0.5) * rw * sx,
          ly = (0.5 - v) * rh * sy;
        return [round(cos * lx - sin * ly + (r.x ?? 0)), round(sin * lx + cos * ly + (r.y ?? 0))];
      };
    }
    let geo: { points: Pt[]; hullCount: number; triangles: number[] };
    if (p.mode === "grid") geo = gridMesh(img.width, img.height, p.grid?.[0] ?? 4, p.grid?.[1] ?? 4);
    else if (p.mode === "points") {
      if (!p.hull || p.hull.length < 3) throw new Error("mode points precisa de hull com 3+ pontos");
      const { triangulate } = GEO;
      const pts = [...p.hull, ...(p.interior ?? [])] as Pt[];
      geo = { points: pts, hullCount: p.hull.length, triangles: triangulate(pts, p.hull.length) };
    } else geo = autoMesh(img.data, img.width, img.height, { detail: p.detail });
    if (!geo.triangles.length) throw new Error("a triangulacao nao gerou triangulos (contorno degenerado)");
    const uvs: number[] = [],
      vertices: number[] = [];
    for (const [px, py] of geo.points) {
      const u = px / img.width,
        v = py / img.height;
      uvs.push(round(u), round(v));
      vertices.push(...toLocal(u, v));
    }
    const edges: number[] = [];
    for (let i = 0; i < geo.hullCount; i++) edges.push(i * 2, ((i + 1) % geo.hullCount) * 2);
    const mesh: any = { type: "mesh" };
    if (p.path ?? cur?.path) mesh.path = p.path ?? cur.path;
    if (cur?.color) mesh.color = cur.color;
    Object.assign(mesh, { uvs, triangles: geo.triangles, vertices, hull: geo.hullCount, edges, width: img.width, height: img.height });
    e.set(["skins", si, "attachments", p.slot, p.name], mesh);
    return { vertices: geo.points.length, triangles: geo.triangles.length / 3, hull: geo.hullCount, ...(removedDeforms ? { aviso: `${removedDeforms} animacao(oes) perderam o deform desta malha (numero de vertices mudou)` } : {}) };
  },
});

import * as GEO from "../geometry.ts";

defineCommand({
  name: "mesh.weights",
  group: "attachment",
  summary:
    "Prende os vertices da malha a ossos (para dobrar junto). mode auto: peso pela distancia aos ossos (ate 4 por vertice, smooth controla a suavidade); rigid: tudo no primeiro osso; explicit: weights por vertice. Deforms existentes sao convertidos.",
  params: z.object({
    slot: z.string(),
    attachment: z.string(),
    skin: SkinArg,
    bones: z.array(z.string()).min(1),
    mode: z.enum(["auto", "rigid", "explicit"]).default("auto"),
    smooth: z.number().min(0.1).max(4).default(1).describe("auto: maior = transicao mais suave entre ossos"),
    weights: z.array(z.record(z.string(), z.number())).optional().describe("explicit: um objeto {osso: peso} por vertice"),
  }),
  label: (p) => `pesos ${p.slot}/${p.attachment}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    const { mesh } = resolveMesh(e.json, p.skin, p.slot, p.attachment);
    if (mesh.type === "linkedmesh") throw new Error("pesos ficam na malha fonte do linked mesh");
    for (const b of p.bones) requireBone(e.json, b);
    const sk = skeletonAt(e.json, null, 0);
    const world = worldVertices(e.json, sk, p.slot, mesh);
    const n = world.length;
    // pesos por vertice
    const W: Record<string, number>[] = [];
    if (p.mode === "explicit") {
      if (!p.weights || p.weights.length !== n) throw new Error(`explicit precisa de ${n} entradas em weights`);
      W.push(...p.weights);
    } else if (p.mode === "rigid") for (let i = 0; i < n; i++) W.push({ [p.bones[0]]: 1 });
    else {
      // distancia ao segmento de cada osso (osso sem comprimento = ponto)
      const segs = p.bones.map((b) => {
        const bw = boneWorld(sk, b);
        const len = bones(e.json)[boneIndex(e.json, b)].length ?? 0;
        return { b, a: [bw.x, bw.y] as Pt, z: [bw.x + bw.a * len, bw.y + bw.c * len] as Pt };
      });
      const scale = Math.max(1, ...segs.map((s) => Math.hypot(s.z[0] - s.a[0], s.z[1] - s.a[1]))) * 0.25;
      for (const [x, y] of world) {
        const w: Record<string, number> = {};
        for (const s of segs) {
          const dx = s.z[0] - s.a[0],
            dy = s.z[1] - s.a[1];
          const l = dx * dx + dy * dy;
          const t = l ? Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (y - s.a[1]) * dy) / l)) : 0;
          const d = Math.hypot(x - s.a[0] - t * dx, y - s.a[1] - t * dy) / scale;
          w[s.b] = 1 / Math.pow(d + 0.05, 2 / p.smooth);
        }
        W.push(w);
      }
    }
    // normaliza, ate 4 influencias, descarta pesos irrisorios
    const norm = W.map((w) => {
      const top = Object.entries(w)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      const s = top.reduce((t, [, v]) => t + v, 0) || 1;
      return top.map(([b, v]) => [b, v / s] as [string, number]).filter(([, v]) => v > 0.01);
    });
    // deform antigo -> mundo (setup), para converter depois
    const oldDeform: { path: (string | number)[]; key: number; world: Pt[] }[] = [];
    for (const [an, a] of Object.entries<any>(e.json.animations ?? {})) {
      const keys = a.attachments?.[p.skin]?.[p.slot]?.[p.attachment]?.deform;
      if (!keys) continue;
      keys.forEach((k: any, ki: number) => {
        const full = deformAt([k], deformLength(mesh), timeOf(k));
        const moved = worldVertices(e.json, sk, p.slot, mesh, full);
        oldDeform.push({ path: ["animations", an, "attachments", p.skin, p.slot, p.attachment, "deform"], key: ki, world: moved.map((q, i) => [q[0] - world[i][0], q[1] - world[i][1]]) });
      });
    }
    // monta o formato com pesos: n, (osso, x, y, peso)*
    const verts: number[] = [];
    world.forEach(([x, y], i) => {
      verts.push(norm[i].length);
      for (const [b, w] of norm[i]) {
        const inv = invert(boneWorld(sk, b));
        const [lx, ly] = apply(inv, x, y);
        verts.push(boneIndex(e.json, b), round(lx), round(ly), round(w));
      }
    });
    const path = ["skins", si, "attachments", p.slot, p.attachment, "vertices"];
    e.set(path, verts);
    const after = attachmentAt(e.json, p.skin, p.slot, p.attachment);
    for (const d of oldDeform) {
      const packed = packDeform(worldToDeform(e.json, sk, p.slot, after, d.world));
      e.set([...d.path, d.key, "offset"], packed.offset);
      e.set([...d.path, d.key, "vertices"], packed.vertices);
    }
    return { vertices: n, influences: norm.reduce((s, l) => s + l.length, 0), deformKeysConverted: oldDeform.length };
  },
});

defineCommand({
  name: "mesh.unbind",
  group: "attachment",
  summary: "Tira os pesos: os vertices voltam a seguir so o osso do slot (na posicao da setup pose).",
  params: z.object({ slot: z.string(), attachment: z.string(), skin: SkinArg }),
  label: (p) => `sem pesos ${p.slot}/${p.attachment}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    const { mesh } = resolveMesh(e.json, p.skin, p.slot, p.attachment);
    if (!isWeighted(mesh)) return { already: true };
    const sk = skeletonAt(e.json, null, 0);
    const world = worldVertices(e.json, sk, p.slot, mesh);
    const inv = invert(boneWorld(sk, slots(e.json).find((s) => s.name === p.slot)!.bone));
    e.set(
      ["skins", si, "attachments", p.slot, p.attachment, "vertices"],
      world.flatMap(([x, y]) => apply(inv, x, y).map(round)),
    );
    return { vertices: world.length };
  },
});

defineCommand({
  name: "query.mesh",
  group: "query",
  readonly: true,
  summary:
    "Vertices de uma malha: indice, posicao na imagem (px, y para baixo), posicao no mundo na pose (anim/time opcionais), pesos. Use para escolher vertices a deformar (ex: cantos da boca pela posicao na imagem).",
  params: z.object({ slot: z.string(), attachment: z.string(), skin: SkinArg, anim: z.string().nullable().optional(), time: z.number().default(0) }),
  run({ doc }, p) {
    const { mesh, source } = resolveMesh(doc.json, p.skin, p.slot, p.attachment);
    const sk = skeletonAt(doc.json, p.anim ?? null, p.time);
    const keys = p.anim ? getKeys(doc.json, ["animations", p.anim, "attachments", p.skin, p.slot, p.attachment, "deform"]) : [];
    const world = worldVertices(doc.json, sk, p.slot, source, deformAt(keys, deformLength(source), p.time));
    const w = source.width ?? 1,
      h = source.height ?? 1;
    const ws = weightsOf(source);
    return {
      type: mesh.type,
      image: [w, h],
      hull: source.hull,
      triangles: source.triangles.length / 3,
      weighted: isWeighted(source),
      vertices: world.map((q, i) => ({
        i,
        img: [Math.round(source.uvs[i * 2] * w), Math.round(source.uvs[i * 2 + 1] * h)],
        world: q.map((x) => +x.toFixed(1)),
        ...(ws.length ? { bones: Object.fromEntries(ws[i].map((x) => [bones(doc.json)[x.bone].name, +x.w.toFixed(2)])) } : {}),
      })),
    };
  },
});

const DeformBase = {
  anim: z.string(),
  slot: z.string(),
  attachment: z.string(),
  skin: SkinArg,
  time: z.number().min(0),
  curve: z.union([z.string(), z.tuple([z.number(), z.number(), z.number(), z.number()])]).optional(),
};

// grava a chave de deform (via key.set, para manter curvas e formato)
function writeDeform(ctx: CommandCtx, p: { anim: string; slot: string; attachment: string; skin: string; time: number; curve?: any }, full: number[]) {
  const packed = packDeform(full);
  return ctx.run("key.set", {
    anim: p.anim,
    target: { deform: { slot: p.slot, attachment: p.attachment, skin: p.skin } },
    timeline: "deform",
    time: p.time,
    offset: packed.offset ?? 0,
    vertices: packed.vertices ?? [],
    ...(p.curve !== undefined ? { curve: p.curve } : {}),
  });
}

defineCommand({
  name: "deform.set",
  group: "key",
  summary:
    "Chave de deform (deformacao da textura) movendo vertices na TELA: moves = [{i, dx, dy}] em pixels do mundo (y para cima), somados ao deform que ja existe nesse instante. Use query.mesh para achar os vertices.",
  params: z.object({ ...DeformBase, moves: z.array(z.object({ i: z.number().int().min(0), dx: z.number(), dy: z.number() })), absolute: z.boolean().default(false).describe("true: substitui o deform atual em vez de somar") }),
  label: (p) => `deform ${p.slot}/${p.attachment} @${p.time}`,
  run(ctx, p) {
    const { e } = ctx;
    requireAnimation(e.json, p.anim);
    const { source } = resolveMesh(e.json, p.skin, p.slot, p.attachment);
    const sk = skeletonAt(e.json, p.anim, p.time);
    const n = vertexCount(source);
    const deltas: Pt[] = Array.from({ length: n }, () => [0, 0]);
    for (const m of p.moves) {
      if (m.i >= n) throw new Error(`vertice ${m.i} nao existe (malha tem ${n})`);
      deltas[m.i] = [m.dx, m.dy];
    }
    const add = worldToDeform(e.json, sk, p.slot, source, deltas);
    const keys = getKeys(e.json, ["animations", p.anim, "attachments", p.skin, p.slot, p.attachment, "deform"]);
    const base = p.absolute ? new Array(add.length).fill(0) : deformAt(keys, add.length, p.time);
    return writeDeform(ctx, p, base.map((x, j) => x + add[j]));
  },
});

defineCommand({
  name: "deform.turn",
  group: "key",
  summary:
    "2,5D: vira uma malha como se fosse um cilindro (cabeca, tronco, objeto redondo), numa chave de deform. angle em graus: no eixo vertical (padrao) positivo vira para a direita da tela, no horizontal positivo olha para cima. Os tracos deslizam para o lado do giro, a borda que se afasta encolhe e a que vem cresce (perspective, 0 a 1). Substitui o deform desse instante (use angle 0 para voltar). Com radius menor que a malha (so o rosto), o que fica fora (orelhas, abas) anda rigido junto com a borda, sem esticar. A malha precisa de vertices por dentro (mesh.create com detail >= 1).",
  params: z.object({
    ...DeformBase,
    angle: z.number().min(-80).max(80),
    axis: z.enum(["vertical", "horizontal"]).default("vertical"),
    perspective: z.number().min(0).max(1).default(0.25),
    center: z.tuple([z.number(), z.number()]).optional().describe("centro do cilindro na tela (padrao: centro da malha)"),
    radius: z.number().positive().optional().describe("raio do cilindro (padrao: metade da malha no sentido do giro); menor, so o miolo gira e as pontas acompanham rigidas"),
  }),
  label: (p) => `virar ${p.slot}/${p.attachment} ${p.angle} graus @${p.time}`,
  run(ctx, p) {
    const { e } = ctx;
    requireAnimation(e.json, p.anim);
    const { source } = resolveMesh(e.json, p.skin, p.slot, p.attachment);
    const sk = skeletonAt(e.json, p.anim, p.time);
    // a malha sem deform nesse instante: o giro e sempre a partir dela
    const pts = worldVertices(e.json, sk, p.slot, source, null);
    const xs = pts.map((q) => q[0]),
      ys = pts.map((q) => q[1]);
    const c: Pt = p.center ?? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    // a = eixo em que os pontos andam (x no giro vertical), b = o outro (cresce ou encolhe)
    const [a, b] = p.axis === "vertical" ? [0, 1] : [1, 0];
    const R = p.radius ?? (Math.max(...pts.map((q) => q[a])) - Math.min(...pts.map((q) => q[a]))) / 2;
    if (!(R > 0)) throw new Error("malha sem largura para virar");
    const th = (p.angle * Math.PI) / 180;
    // dentro do raio: a superficie do cilindro; fora dele (orelhas, abas): anda rigida junto
    // com a borda do lado dela, sem esticar
    const gira = (fi: number) => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, fi + th));
    const deltas: Pt[] = pts.map((q) => {
      const u = (q[a] - c[a]) / R;
      const out: Pt = [q[0], q[1]];
      if (Math.abs(u) <= 1) {
        const fi = Math.asin(u),
          fi2 = gira(fi);
        out[a] = c[a] + R * Math.sin(fi2);
        // perspectiva: o que chega mais perto (cos maior) cresce no outro eixo
        out[b] = c[b] + (q[b] - c[b]) * (1 + p.perspective * (Math.cos(fi2) - Math.cos(fi)));
      } else {
        const borda = Math.sign(u) * (Math.PI / 2),
          b2 = gira(borda);
        out[a] = q[a] + R * (Math.sin(b2) - Math.sin(borda));
        out[b] = c[b] + (q[b] - c[b]) * (1 + p.perspective * (Math.cos(b2) - Math.cos(borda)));
      }
      return [out[0] - q[0], out[1] - q[1]];
    });
    return writeDeform(ctx, p, worldToDeform(e.json, sk, p.slot, source, deltas));
  },
});

defineCommand({
  name: "deform.brush",
  group: "key",
  summary:
    "Pincel de deformacao: empurra os vertices perto de um ponto da tela (center em pixels do mundo, radius) por (dx, dy), com queda suave ate a borda do raio. Somado ao deform atual nesse instante. Bom para bochecha, respiracao, tecido.",
  params: z.object({ ...DeformBase, center: z.tuple([z.number(), z.number()]), radius: z.number().positive(), dx: z.number(), dy: z.number(), falloff: z.enum(["suave", "linear", "constante"]).default("suave") }),
  label: (p) => `pincel ${p.slot}/${p.attachment} @${p.time}`,
  run(ctx, p) {
    const { e } = ctx;
    requireAnimation(e.json, p.anim);
    const { source } = resolveMesh(e.json, p.skin, p.slot, p.attachment);
    const keys = getKeys(e.json, ["animations", p.anim, "attachments", p.skin, p.slot, p.attachment, "deform"]);
    const sk = skeletonAt(e.json, p.anim, p.time);
    const cur = deformAt(keys, deformLength(source), p.time);
    const world = worldVertices(e.json, sk, p.slot, source, cur);
    let touched = 0;
    const deltas: Pt[] = world.map(([x, y]) => {
      const d = Math.hypot(x - p.center[0], y - p.center[1]) / p.radius;
      if (d >= 1) return [0, 0];
      touched++;
      const k = p.falloff === "constante" ? 1 : p.falloff === "linear" ? 1 - d : 0.5 + 0.5 * Math.cos(Math.PI * d);
      return [p.dx * k, p.dy * k];
    });
    if (!touched) throw new Error(`nenhum vertice dentro do raio ${p.radius} em (${p.center}). Vertices vao de x ${Math.min(...world.map((q) => q[0])).toFixed(0)}..${Math.max(...world.map((q) => q[0])).toFixed(0)}, y ${Math.min(...world.map((q) => q[1])).toFixed(0)}..${Math.max(...world.map((q) => q[1])).toFixed(0)}`);
    const add = worldToDeform(e.json, sk, p.slot, source, deltas);
    writeDeform(ctx, p, cur.map((x, j) => x + add[j]));
    return { touched };
  },
});

defineCommand({
  name: "linkedmesh.create",
  group: "attachment",
  summary: "Cria um linked mesh: outra imagem usando a mesma malha/pesos de uma malha fonte (troca de textura mantendo a deformacao). timelines=true herda os deforms da fonte.",
  params: z.object({ slot: z.string(), name: z.string(), source: z.string(), sourceSlot: z.string().optional(), sourceSkin: z.string().optional(), skin: SkinArg, path: z.string().optional(), timelines: z.boolean().default(true) }),
  label: (p) => `linked mesh ${p.slot}/${p.name}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    requireSlot(e.json, p.slot);
    const src = attachmentAt(e.json, p.sourceSkin ?? p.skin, p.sourceSlot ?? p.slot, p.source);
    if (src.type !== "mesh") throw new Error("a fonte precisa ser uma malha");
    const a: any = { type: "linkedmesh" };
    if (p.path) a.path = p.path;
    // sem campo skin o runtime procura a fonte na skin default
    const srcSkin = p.sourceSkin ?? p.skin;
    if (srcSkin !== "default") a.skin = srcSkin;
    if (p.sourceSlot && p.sourceSlot !== p.slot) a.slot = p.sourceSlot;
    a.source = p.source;
    if (!p.timelines) a.timelines = false;
    if (src.width) Object.assign(a, { width: src.width, height: src.height });
    e.set(["skins", si, "attachments", p.slot, p.name], a);
    return { created: `${p.slot}/${p.name}` };
  },
});

const Points = z.array(z.tuple([z.number(), z.number()])).min(1).describe("pontos em pixels do MUNDO na setup pose (y para cima)");

function pointsToBoneLocal(doc: SpineJson, slot: string, pts: Pt[]): number[] {
  const sk = skeletonAt(doc, null, 0);
  const inv = invert(boneWorld(sk, slots(doc).find((s) => s.name === slot)!.bone));
  return pts.flatMap(([x, y]) => apply(inv, x, y).map(round));
}

defineCommand({
  name: "clipping.create",
  group: "attachment",
  summary: "Mascara (clipping): tudo desenhado depois deste slot, ate o slot end, so aparece dentro do poligono. Pontos em pixels do mundo.",
  params: z.object({ slot: z.string(), name: z.string(), end: z.string().describe("ultimo slot recortado"), points: Points, skin: SkinArg, convex: z.boolean().optional(), inverse: z.boolean().optional(), show: z.boolean().default(true).describe("ja deixa o slot usando esse attachment") }),
  label: (p) => `mascara ${p.slot}/${p.name}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    const sIdx = requireSlot(e.json, p.slot);
    const endIdx = requireSlot(e.json, p.end);
    if (endIdx < sIdx) throw new Error("o slot end precisa estar depois do slot da mascara na ordem de desenho");
    const a: any = { type: "clipping", end: p.end, vertexCount: p.points.length, vertices: pointsToBoneLocal(e.json, p.slot, p.points as Pt[]) };
    if (p.convex) a.convex = true;
    if (p.inverse) a.inverse = true;
    a.color = "ce3a3aff";
    e.set(["skins", si, "attachments", p.slot, p.name], a);
    if (p.show) e.set(["slots", sIdx, "attachment"], p.name);
    return { created: `${p.slot}/${p.name}` };
  },
});

defineCommand({
  name: "boundingbox.create",
  group: "attachment",
  summary: "Area de clique/colisao (bounding box) num slot. Pontos em pixels do mundo.",
  params: z.object({ slot: z.string(), name: z.string(), points: Points, skin: SkinArg }),
  label: (p) => `area ${p.slot}/${p.name}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    requireSlot(e.json, p.slot);
    e.set(["skins", si, "attachments", p.slot, p.name], { type: "boundingbox", vertexCount: p.points.length, vertices: pointsToBoneLocal(e.json, p.slot, p.points as Pt[]) });
    return { created: `${p.slot}/${p.name}` };
  },
});

defineCommand({
  name: "point.create",
  group: "attachment",
  summary: "Ponto de referencia (point attachment): posicao e rotacao no mundo, para o jogo prender efeitos.",
  params: z.object({ slot: z.string(), name: z.string(), at: z.tuple([z.number(), z.number()]), rotation: z.number().default(0), skin: SkinArg }),
  label: (p) => `ponto ${p.slot}/${p.name}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    requireSlot(e.json, p.slot);
    const [x, y] = pointsToBoneLocal(e.json, p.slot, [p.at as Pt]);
    const a: any = { type: "point" };
    if (x) a.x = x;
    if (y) a.y = y;
    if (p.rotation) a.rotation = round(p.rotation);
    e.set(["skins", si, "attachments", p.slot, p.name], a);
    return { created: `${p.slot}/${p.name}` };
  },
});

defineCommand({
  name: "path.create",
  group: "attachment",
  summary: "Caminho bezier (path attachment) para path constraints. points: ancora e alcas em sequencia (c1, ancora, c2 por ponto), pixels do mundo.",
  params: z.object({ slot: z.string(), name: z.string(), points: Points, closed: z.boolean().default(false), constantSpeed: z.boolean().default(true), skin: SkinArg }),
  label: (p) => `caminho ${p.slot}/${p.name}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    requireSlot(e.json, p.slot);
    if (p.points.length % 3) throw new Error("path: numero de pontos multiplo de 3 (alca, ancora, alca)");
    const v = pointsToBoneLocal(e.json, p.slot, p.points as Pt[]);
    // comprimento aproximado de cada curva (o runtime usa para velocidade constante)
    const pts = p.points as Pt[];
    const curves = p.closed ? pts.length / 3 : pts.length / 3 - 1;
    const lengths: number[] = [];
    let acc = 0;
    for (let c = 0; c < curves; c++) {
      const p0 = pts[c * 3 + 1],
        p1 = pts[c * 3 + 2],
        p2 = pts[(c * 3 + 3) % pts.length],
        p3 = pts[(c * 3 + 4) % pts.length];
      let prev = p0;
      for (let s = 1; s <= 16; s++) {
        const t = s / 16;
        const q: Pt = [0, 1].map((k) => (1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * p1[k] + 3 * (1 - t) * t * t * p2[k] + t ** 3 * p3[k]) as Pt;
        acc += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        prev = q;
      }
      lengths.push(round(acc));
    }
    const a: any = { type: "path" };
    if (p.closed) a.closed = true;
    if (!p.constantSpeed) a.constantSpeed = false;
    Object.assign(a, { lengths, vertexCount: pts.length, vertices: v });
    e.set(["skins", si, "attachments", p.slot, p.name], a);
    return { created: `${p.slot}/${p.name}`, length: acc };
  },
});

defineCommand({
  name: "sequence.set",
  group: "attachment",
  summary: "Sequencia de imagens num attachment (flipbook nativo do 4.x): count imagens nome_<start..> com digits digitos. setup = quadro inicial.",
  params: z.object({ slot: z.string(), attachment: z.string(), skin: SkinArg, count: z.number().int().min(1), start: z.number().int().default(1), digits: z.number().int().default(0), setup: z.number().int().default(0) }),
  label: (p) => `sequencia ${p.slot}/${p.attachment}`,
  run({ e }, p) {
    const si = requireSkin(e.json, p.skin);
    attachmentAt(e.json, p.skin, p.slot, p.attachment);
    const seq: any = { count: p.count };
    if (p.start !== 1) seq.start = p.start;
    if (p.digits) seq.digits = p.digits;
    if (p.setup) seq.setup = p.setup;
    e.set(["skins", si, "attachments", p.slot, p.attachment, "sequence"], seq);
    return { ok: true };
  },
});

export { vertexCount as meshVertexCount };
export type { Affine };
