// Recorte exposto (borda de bastidor): o pedaco do contorno de uma imagem que o animador
// escondeu atras de outra (o toco do braco sob o ombro, o topo da perna sob o quadril, o
// pescoco sob a cabeca) e que aparece quando a animacao gira demais a articulacao.
//
// Na pose de setup, cada ponto do contorno de cada imagem (alpha da imagem original) que
// fica coberto por uma imagem desenhada na frente, perto da articulacao entre as duas, e
// borda de bastidor. Em cada instante da animacao (ordem de desenho do instante), mede o
// comprimento dessas bordas que nenhuma imagem da frente cobre mais. Contorno coberto por
// acaso (o corpo atras da mao) nao conta: so vale perto da articulacao que liga as duas.
import { AnimationState, AnimationStateData, MeshAttachment, RegionAttachment, Skeleton, SkeletonJson, type AttachmentLoader, type Bone, type Slot } from "@esotericsoftware/spine-core";
import { godotGravity, nullLoader } from "./pose.ts";
import { PoseSim } from "./sim.ts";
import type { SpineJson } from "./format.ts";

export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

// malha equivalente de uma imagem: uv (0..1, y para baixo) e triangulos
interface Shape {
  uvs: number[];
  tris: number[];
  world: number[];
  box: [number, number, number, number];
}

const SOLID = 128; // alpha de quem esconde a borda na pose de setup
const COVER = 24; // alpha que ainda esconde no instante (o antialias da borda nao conta)
const MIN_RUN = 4; // pontos seguidos (~4 passos de borda) para contar como trecho

// uma imagem (regiao ou malha) do slot, na pose atual
export function shapeOf(slot: Slot, sk: Skeleton): Shape | null {
  const a = slot.appliedPose.attachment;
  let uvs: number[], tris: number[], world: number[];
  if (a instanceof MeshAttachment) {
    world = new Array(a.worldVerticesLength).fill(0);
    a.computeWorldVertices(sk, slot, 0, a.worldVerticesLength, world, 0, 2);
    uvs = Array.from(a.regionUVs);
    tris = Array.from(a.triangles);
  } else if (a instanceof RegionAttachment) {
    // cantos da imagem original inteira (o recorte de transparencia do atlas nao importa:
    // o alpha vem da imagem original)
    const w = (a.width / 2) * a.scaleX,
      h = (a.height / 2) * a.scaleY;
    const r = (a.rotation * Math.PI) / 180,
      c = Math.cos(r),
      s = Math.sin(r);
    const b = slot.bone.appliedPose;
    world = [];
    for (const [lx, ly] of [[-w, -h], [-w, h], [w, h], [w, -h]]) {
      const x = lx * c - ly * s + a.x,
        y = lx * s + ly * c + a.y;
      world.push(x * b.a + y * b.b + b.worldX, x * b.c + y * b.d + b.worldY);
    }
    uvs = [0, 1, 0, 0, 1, 0, 1, 1];
    tris = [0, 1, 2, 0, 2, 3];
  } else return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < world.length; i += 2) {
    x0 = Math.min(x0, world[i]);
    x1 = Math.max(x1, world[i]);
    y0 = Math.min(y0, world[i + 1]);
    y1 = Math.max(y1, world[i + 1]);
  }
  return { uvs, tris, world, box: [x0, y0, x1, y1] };
}

// ponto do mundo -> uv da imagem (primeiro triangulo que o contem), ou null
export function uvAt(s: Shape, x: number, y: number): [number, number] | null {
  if (x < s.box[0] || x > s.box[2] || y < s.box[1] || y > s.box[3]) return null;
  const w = s.world,
    u = s.uvs,
    t = s.tris;
  for (let k = 0; k < t.length; k += 3) {
    const p = t[k] * 2,
      q = t[k + 1] * 2,
      r = t[k + 2] * 2;
    const d = (w[q + 1] - w[r + 1]) * (w[p] - w[r]) + (w[r] - w[q]) * (w[p + 1] - w[r + 1]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((w[q + 1] - w[r + 1]) * (x - w[r]) + (w[r] - w[q]) * (y - w[r + 1])) / d;
    const l2 = ((w[r + 1] - w[p + 1]) * (x - w[r]) + (w[p] - w[r]) * (y - w[r + 1])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    return [l1 * u[p] + l2 * u[q] + l3 * u[r], l1 * u[p + 1] + l2 * u[q + 1] + l3 * u[r + 1]];
  }
  return null;
}

// uv -> mundo, com a escala local (px do mundo por px da imagem) no ponto
function worldAt(s: Shape, u: number, v: number, W: number, H: number): [number, number, number] | null {
  const w = s.world,
    uv = s.uvs,
    t = s.tris;
  for (let k = 0; k < t.length; k += 3) {
    const p = t[k] * 2,
      q = t[k + 1] * 2,
      r = t[k + 2] * 2;
    const d = (uv[q + 1] - uv[r + 1]) * (uv[p] - uv[r]) + (uv[r] - uv[q]) * (uv[p + 1] - uv[r + 1]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((uv[q + 1] - uv[r + 1]) * (u - uv[r]) + (uv[r] - uv[q]) * (v - uv[r + 1])) / d;
    const l2 = ((uv[r + 1] - uv[p + 1]) * (u - uv[r]) + (uv[p] - uv[r]) * (v - uv[r + 1])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    // area na tela / area na imagem: a escala do triangulo
    const aw = Math.abs((w[q] - w[p]) * (w[r + 1] - w[p + 1]) - (w[r] - w[p]) * (w[q + 1] - w[p + 1]));
    const au = Math.abs(((uv[q] - uv[p]) * (uv[r + 1] - uv[p + 1]) - (uv[r] - uv[p]) * (uv[q + 1] - uv[p + 1])) * W * H);
    return [l1 * w[p] + l2 * w[q] + l3 * w[r], l1 * w[p + 1] + l2 * w[q + 1] + l3 * w[r + 1], au > 0 ? Math.sqrt(aw / au) : 0];
  }
  return null;
}

const alphaAt = (img: Pixels, u: number, v: number) => {
  const x = Math.floor(u * img.width),
    y = Math.floor(v * img.height);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  return img.data[(y * img.width + x) * 4 + 3];
};

// pontos do contorno da imagem (pixels opacos com vizinho transparente ou na beirada),
// um por celula de passo x passo: cada ponto vale ~passo px de borda
function contour(img: Pixels, step: number): [number, number][] {
  const { width: W, height: H, data } = img;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] >= SOLID;
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!solid(x, y) || (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))) continue;
      const cell = Math.floor(y / step) * 100000 + Math.floor(x / step);
      if (seen.has(cell)) continue;
      seen.add(cell);
      out.push([(x + 0.5) / W, (y + 0.5) / H]);
    }
  return out;
}

const imageName = (slot: Slot) => {
  const a: any = slot.appliedPose.attachment;
  return a ? (a.path ?? a.name) : null;
};

// os ossos que giram entre as duas imagens: do osso de cada uma ate o ancestral comum
// (exclusive). A borda de bastidor fica perto da origem de um deles (a articulacao)
function pivots(a: Bone, b: Bone): Bone[] {
  const up = (x: Bone) => {
    const out: Bone[] = [];
    for (let p: Bone | null = x; p; p = p.parent) out.push(p);
    return out;
  };
  const ua = up(a),
    ub = up(b);
  const common = ua.find((x) => ub.includes(x));
  const res: Bone[] = [];
  for (const x of ua) if (x === common) break; else res.push(x);
  for (const x of ub) if (x === common) break; else res.push(x);
  return res;
}

// ponto de borda de bastidor (uv na imagem), quem o esconde e quanto de borda vale no setup
interface Seam {
  u: number;
  v: number;
  behind: string;
  len: number;
}

export interface Exposed {
  // por instante, o comprimento de borda de bastidor a mostra (px do mundo) e o pior par
  frames: { t: number; len: number; worst: { slot: string; behind: string; len: number } | null; points?: [number, number][] }[];
  // borda de bastidor de cada slot na pose de setup (px do mundo)
  seams: Record<string, number>;
}

// nomes das imagens (path ou nome) de regioes e malhas das skins: o que carregar antes
export function seamImages(json: SpineJson): string[] {
  const out = new Set<string>();
  for (const sk of (json as any).skins ?? []) for (const slot of Object.values<any>(sk.attachments ?? {})) for (const [n, a] of Object.entries<any>(slot)) if (!a.type || ["region", "mesh", "linkedmesh"].includes(a.type)) out.add(a.path ?? n);
  return [...out];
}

// image: imagens originais ja carregadas (seamImages diz quais), null se faltar.
// reference: animacoes do animador da casa. Borda que ele mesmo descobre (os oculos tirados
// mostram o contorno da cabeca, o olho fechado mostra o buraco do olho) e contorno de
// verdade, nao bastidor: sai da conta
export function exposedSeams(json: SpineJson, anim: string, times: number[], image: (name: string) => Pixels | null, opts: { points?: boolean; reference?: { anim: string; times: number[] }[] } = {}): Exposed {
  const loader: AttachmentLoader = {
    ...nullLoader,
    newRegionAttachment: (_s: any, _ph: any, name: string, _p: any, seq: any) => {
      const r = new RegionAttachment(name, seq);
      r.updateSequence = () => {};
      return r as any;
    },
    newMeshAttachment: (_s: any, _ph: any, name: string, _p: any, seq: any) => {
      const m = new MeshAttachment(name, seq);
      m.updateSequence = () => {};
      return m as any;
    },
  };
  const data = new SkeletonJson(loader).readSkeletonData(godotGravity(json));
  const sk = new Skeleton(data);
  const sim = new PoseSim(sk, new AnimationState(new AnimationStateData(data)));

  // imagens visiveis na ordem de desenho do instante
  const visible = () => {
    const out: { slot: Slot; shape: Shape; img: Pixels }[] = [];
    for (const slot of sk.drawOrder.appliedPose) {
      if (slot.appliedPose.color.a < 0.05 || !slot.bone.active) continue;
      const n = imageName(slot);
      const shape = n ? shapeOf(slot, sk) : null;
      const img = n ? image(n) : null;
      if (shape && img) out.push({ slot, shape, img });
    }
    return out;
  };
  const coveredBy = (vis: ReturnType<typeof visible>, from: number, x: number, y: number, min: number) => {
    for (let j = from; j < vis.length; j++) {
      const uv = uvAt(vis[j].shape, x, y);
      if (uv && alphaAt(vis[j].img, uv[0], uv[1]) >= min) return vis[j];
    }
    return null;
  };

  // pose de setup: as bordas de bastidor
  sim.poseAt(null, true, 0);
  const base = visible();
  const seam = new Map<Slot, { name: string; pts: Seam[] }>();
  const seams: Record<string, number> = {};
  for (let i = 0; i < base.length; i++) {
    const { slot, shape, img } = base[i];
    const step = Math.max(2, Math.round(Math.max(img.width, img.height) / 80));
    const pts: Seam[] = [];
    let len = 0;
    for (const [u, v] of contour(img, step)) {
      const p = worldAt(shape, u, v, img.width, img.height);
      if (!p) continue;
      const c = coveredBy(base, i + 1, p[0], p[1], SOLID);
      if (!c) continue;
      // so perto da articulacao entre as duas: raio de meia imagem menor
      const size = (e: Shape) => Math.max(e.box[2] - e.box[0], e.box[3] - e.box[1]);
      const R = 0.5 * Math.min(size(shape), size(c.shape));
      const near = pivots(slot.bone, c.slot.bone).some((b) => Math.hypot(b.appliedPose.worldX - p[0], b.appliedPose.worldY - p[1]) < R);
      if (!near) continue;
      pts.push({ u, v, behind: c.slot.data.name, len: step * p[2] });
      len += step * p[2];
    }
    if (pts.length) {
      seam.set(slot, { name: imageName(slot)!, pts });
      seams[slot.data.name] = +len.toFixed(1);
    }
  }

  // pontos de bastidor descobertos na pose atual, por imagem visivel
  const exposedNow = () => {
    const vis = visible();
    const res: { slot: Slot; img: Pixels; out: { q: Seam; p: [number, number, number] }[] }[] = [];
    for (let i = 0; i < vis.length; i++) {
      const { slot, shape, img } = vis[i];
      const s = seam.get(slot);
      // a imagem trocou (outra regiao no slot): a borda medida no setup nao vale
      if (!s || imageName(slot) !== s.name) continue;
      const out: { q: Seam; p: [number, number, number] }[] = [];
      for (const q of s.pts) {
        const p = worldAt(shape, q.u, q.v, img.width, img.height);
        if (p && !coveredBy(vis, i + 1, p[0], p[1], COVER)) out.push({ q, p });
      }
      res.push({ slot, img, out });
    }
    return res;
  };

  // o que o animador da casa descobre e contorno: tira da conta
  if (opts.reference?.length) {
    const shown = new Set<Seam>();
    for (const r of opts.reference)
      for (const t of r.times) {
        sim.poseAt(r.anim, true, t);
        for (const e of exposedNow()) for (const o of e.out) shown.add(o.q);
      }
    for (const [slot, s] of seam) {
      s.pts = s.pts.filter((q) => !shown.has(q));
      if (!s.pts.length) {
        seam.delete(slot);
        delete seams[slot.data.name];
      } else seams[slot.data.name] = +s.pts.reduce((n, q) => n + q.len, 0).toFixed(1);
    }
  }

  const frames: Exposed["frames"] = [];
  for (const t of times) {
    sim.poseAt(anim, true, t);
    let len = 0;
    const per = new Map<string, number>();
    const points: [number, number][] = [];
    for (const { slot, img, out } of exposedNow()) {
      const step = Math.max(2, Math.round(Math.max(img.width, img.height) / 80));
      // so trechos continuos de borda: ponto solto e antialias ou quina, nao se ve
      const W = img.width,
        H = img.height,
        gap = 1.8 * step;
      const group = out.map((_, k) => k);
      const root = (k: number): number => (group[k] === k ? k : (group[k] = root(group[k])));
      for (let a = 0; a < out.length; a++)
        for (let b = a + 1; b < out.length; b++)
          if (Math.hypot((out[a].q.u - out[b].q.u) * W, (out[a].q.v - out[b].q.v) * H) <= gap) group[root(a)] = root(b);
      const size = new Map<number, number>();
      for (let k = 0; k < out.length; k++) size.set(root(k), (size.get(root(k)) ?? 0) + 1);
      for (let k = 0; k < out.length; k++) {
        if (size.get(root(k))! < MIN_RUN) continue;
        const { q, p } = out[k];
        const l = step * p[2];
        len += l;
        if (opts.points) points.push([p[0], p[1]]);
        const key = `${slot.data.name}\u0000${q.behind}`;
        per.set(key, (per.get(key) ?? 0) + l);
      }
    }
    let worst: Exposed["frames"][number]["worst"] = null;
    for (const [k, l] of per) if (!worst || l > worst.len) worst = { slot: k.split("\u0000")[0], behind: k.split("\u0000")[1], len: l };
    frames.push({ t, len, worst, ...(opts.points ? { points } : {}) });
  }
  return { frames, seams };
}
