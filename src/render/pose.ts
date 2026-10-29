// Leitura da pose atual do viewport, igual para os dois calculos: o spine-core (modos "godot"
// e "spine", SpinePose) e o nucleo em wasm (modo "nucleo", NucleoPose em nucleo.ts). Clique,
// arrasto, gizmos, caixas, camadas e o inspetor leem por aqui; nada disso precisa saber qual
// calculo deu a pose.
//
// Coordenadas: o espaco do esqueleto em runtime (no modo "godot" o spine-core roda com y
// invertido, e o viewer desfaz isso na tela; nos outros dois, y para cima).
import { BlendMode, BoundingBoxAttachment, ClippingAttachment, Color, MeshAttachment, PathAttachment, PointAttachment, RegionAttachment, Vector2, type Bone, type ShapeRenderer, type Skeleton, type Slot } from "@esotericsoftware/spine-webgl";

export type Blend = "normal" | "additive" | "multiply" | "screen";
export type PartKind = "region" | "mesh" | "linkedmesh" | "clipping" | "path" | "point" | "boundingbox";

export interface Local {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
}

export interface BoneView {
  readonly name: string;
  readonly index: number;
  readonly parent: BoneView | null;
  // comprimento do setup (o do arquivo) e no mundo
  readonly length: number;
  readonly worldLength: number;
  readonly active: boolean;
  // matriz de mundo [a b x; c d y]
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly worldX: number;
  readonly worldY: number;
  // pose local atual (com a animacao) e a do setup
  readonly local: Local;
  readonly setup: Local;
}

export interface PartView {
  readonly name: string;
  readonly kind: PartKind;
  // malha: quantos vertices do comeco sao o contorno
  readonly hull: number;
  readonly weighted: boolean;
  // caminho fechado
  readonly closed: boolean;
  // a imagem do atlas (regiao e malha): o caminho da parte, ou o nome
  readonly image: string;
}

export interface SlotView {
  readonly name: string;
  readonly index: number;
  readonly bone: BoneView;
  readonly blend: Blend;
  // parte mostrada agora (null: nenhuma)
  readonly part: PartView | null;
  readonly color: { r: number; g: number; b: number; a: number };
}

export interface PoseView {
  readonly bones: readonly BoneView[];
  readonly slots: readonly SlotView[];
  findBone(name: string): BoneView | null;
  findSlot(name: string): SlotView | null;
  // ordem de desenho atual, de tras para frente
  drawOrder(): readonly SlotView[];
  // vertices em mundo da parte atual do slot (regiao: 4 cantos; malha; caminho, recorte e caixa
  // tambem): escreve em out e devolve quantos numeros (0 sem geometria)
  vertices(slot: SlotView, out: number[]): number;
  // triangulos da parte atual (regiao e malha), indices de vertice
  triangles(slot: SlotView): ArrayLike<number> | null;
  // pesos da malha atual: por vertice, pares [osso, peso]; null sem pesos
  weights(slot: SlotView): [number, number][][] | null;
  // caixa [x, y, largura, altura] das regioes e malhas na pose atual (null se nao ha)
  bounds(): number[] | null;
}

// ponto do mundo no sistema do pai do osso (onde ficam x e y locais dele)
export function toParent(b: BoneView, x: number, y: number): { x: number; y: number } {
  const p = b.parent;
  if (!p) return { x, y };
  const det = p.a * p.d - p.b * p.c || 1e-12;
  const dx = x - p.worldX,
    dy = y - p.worldY;
  return { x: (dx * p.d - dy * p.b) / det, y: (dy * p.a - dx * p.c) / det };
}

// ---- spine-core

const BLEND: Record<number, Blend> = { [BlendMode.Normal]: "normal", [BlendMode.Additive]: "additive", [BlendMode.Multiply]: "multiply", [BlendMode.Screen]: "screen" };

function kindOf(att: any): PartKind | null {
  if (att instanceof RegionAttachment) return "region";
  if (att instanceof MeshAttachment) return att.getSourceMesh() ? "linkedmesh" : "mesh";
  if (att instanceof ClippingAttachment) return "clipping";
  if (att instanceof PathAttachment) return "path";
  if (att instanceof PointAttachment) return "point";
  if (att instanceof BoundingBoxAttachment) return "boundingbox";
  return null;
}

class SpineBone implements BoneView {
  parent: BoneView | null = null;
  constructor(readonly bone: Bone) {}
  get name() {
    return this.bone.data.name;
  }
  get index() {
    return this.bone.data.index;
  }
  get length() {
    return this.bone.data.length;
  }
  get worldLength() {
    const p = this.bone.appliedPose;
    return this.bone.data.length * Math.hypot(p.a, p.c);
  }
  get active() {
    return this.bone.active;
  }
  get a() {
    return this.bone.appliedPose.a;
  }
  get b() {
    return this.bone.appliedPose.b;
  }
  get c() {
    return this.bone.appliedPose.c;
  }
  get d() {
    return this.bone.appliedPose.d;
  }
  get worldX() {
    return this.bone.appliedPose.worldX;
  }
  get worldY() {
    return this.bone.appliedPose.worldY;
  }
  get local(): Local {
    return this.bone.pose;
  }
  get setup(): Local {
    return (this.bone.data as any).setupPose;
  }
}

class SpineSlot implements SlotView {
  constructor(
    readonly slot: Slot,
    readonly bone: BoneView,
    private parts: WeakMap<object, PartView>,
  ) {}
  get name() {
    return this.slot.data.name;
  }
  get index() {
    return this.slot.data.index;
  }
  get blend() {
    return BLEND[this.slot.data.blendMode] ?? "normal";
  }
  get part(): PartView | null {
    const att: any = this.slot.appliedPose.attachment;
    if (!att) return null;
    let p = this.parts.get(att);
    if (!p) {
      const kind = kindOf(att);
      if (!kind) return null;
      p = { name: att.name, kind, hull: att instanceof MeshAttachment ? att.hullLength / 2 : 0, weighted: !!att.bones, closed: !!att.closed, image: att.region?.name ?? att.path ?? att.name };
      this.parts.set(att, p);
    }
    return p;
  }
  get color() {
    return this.slot.appliedPose.color;
  }
}

export class SpinePose implements PoseView {
  readonly bones: SpineBone[];
  readonly slots: SpineSlot[];
  private byBone = new Map<string, SpineBone>();
  private bySlot = new Map<string, SpineSlot>();
  private parts = new WeakMap<object, PartView>();

  constructor(readonly sk: Skeleton) {
    this.bones = sk.bones.map((b) => new SpineBone(b));
    for (const b of this.bones) {
      b.parent = b.bone.parent ? this.bones[b.bone.parent.data.index] : null;
      this.byBone.set(b.name, b);
    }
    this.slots = sk.slots.map((s) => new SpineSlot(s, this.bones[s.bone.data.index], this.parts));
    for (const s of this.slots) this.bySlot.set(s.name, s);
  }

  findBone(name: string) {
    return this.byBone.get(name) ?? null;
  }
  findSlot(name: string) {
    return this.bySlot.get(name) ?? null;
  }
  drawOrder() {
    return this.sk.drawOrder.appliedPose.map((s) => this.slots[s.data.index]);
  }
  vertices(slot: SlotView, out: number[]): number {
    const s = (slot as SpineSlot).slot;
    const att: any = s.appliedPose.attachment;
    if (att instanceof RegionAttachment) {
      if (out.length < 8) out.length = 8;
      att.computeWorldVertices(s, att.getOffsets(s.appliedPose), out, 0, 2);
      return 8;
    }
    if (att && typeof att.computeWorldVertices === "function" && att.worldVerticesLength) {
      const n = att.worldVerticesLength;
      if (out.length < n) out.length = n;
      att.computeWorldVertices(this.sk, s, 0, n, out, 0, 2);
      return n;
    }
    return 0;
  }
  triangles(slot: SlotView) {
    const att: any = (slot as SpineSlot).slot.appliedPose.attachment;
    if (att instanceof RegionAttachment) return [0, 1, 2, 2, 3, 0];
    if (att instanceof MeshAttachment) return att.triangles;
    return null;
  }
  weights(slot: SlotView) {
    const att: any = (slot as SpineSlot).slot.appliedPose.attachment;
    if (!(att instanceof MeshAttachment) || !att.bones) return null;
    const out: [number, number][][] = [];
    for (let i = 0, v = 0; i < att.bones.length; ) {
      const n = att.bones[i++];
      const w: [number, number][] = [];
      for (let k = 0; k < n; k++, v += 3) w.push([att.bones[i + k], att.vertices[v + 2]]);
      i += n;
      out.push(w);
    }
    return out;
  }
  bounds() {
    const off = new Vector2(),
      size = new Vector2();
    this.sk.getBounds(off, size, []);
    if (!isFinite(size.x) || size.x <= 0 || size.y <= 0) return null;
    return [off.x, off.y, size.x, size.y];
  }
}

// ---- desenho de depuracao sobre qualquer pose (o do modo "nucleo"; os outros modos usam o
// SkeletonDebugRenderer do spine-webgl, que este imita: mesmas cores, espessuras e ordem)

export interface DebugOpts {
  bones: boolean;
  meshHull: boolean;
  meshTriangles: boolean;
  boundingBoxes: boolean;
  paths: boolean;
  clipping: boolean;
  scale: number;
  boneWidth: number;
}

const C = {
  boneLine: new Color(1, 0, 0, 1),
  boneOrigin: new Color(0, 1, 0, 1),
  attachmentLine: new Color(0, 0, 1, 0.5),
  triangleLine: new Color(1, 0.64, 0, 0.5),
  path: new Color().setFromString("FF7F00"),
  clip: new Color(0.8, 0, 0, 2),
  aabb: new Color(0, 1, 0, 0.5),
  box: new Color(0.6, 0.6, 0.6, 1),
  gray: new Color(192 / 255, 192 / 255, 192 / 255, 1),
};

export function drawDebug(shapes: ShapeRenderer, gl: WebGLRenderingContext, pose: PoseView, o: DebugOpts) {
  shapes.setBlendMode(gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const v: number[] = [];
  if (o.bones) {
    shapes.setColor(C.boneLine);
    for (const b of pose.bones) {
      if (!b.parent) continue;
      shapes.rectLine(true, b.worldX, b.worldY, b.length * b.a + b.worldX, b.length * b.c + b.worldY, o.boneWidth * o.scale);
    }
  }
  if (o.meshHull || o.meshTriangles)
    for (const s of pose.slots) {
      const p = s.part;
      if (!s.bone.active || !p || (p.kind !== "mesh" && p.kind !== "linkedmesh")) continue;
      if (!pose.vertices(s, v)) continue;
      if (o.meshTriangles) {
        const t = pose.triangles(s) ?? [];
        shapes.setColor(C.triangleLine);
        for (let i = 0; i < t.length; i += 3) {
          const a = t[i] * 2,
            b = t[i + 1] * 2,
            c = t[i + 2] * 2;
          shapes.triangle(false, v[a], v[a + 1], v[b], v[b + 1], v[c], v[c + 1]);
        }
      }
      if (o.meshHull && p.hull > 0) {
        shapes.setColor(C.attachmentLine);
        const h = p.hull * 2;
        let lx = v[h - 2],
          ly = v[h - 1];
        for (let i = 0; i < h; i += 2) {
          shapes.line(v[i], v[i + 1], lx, ly);
          lx = v[i];
          ly = v[i + 1];
        }
      }
    }
  if (o.boundingBoxes) {
    // a caixa das caixas de colisao e os poligonos delas
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const polys: number[][] = [];
    for (const s of pose.slots) {
      if (!s.bone.active || s.part?.kind !== "boundingbox") continue;
      const n = pose.vertices(s, v);
      const poly = v.slice(0, n);
      for (let i = 0; i < n; i += 2) (x0 = Math.min(x0, poly[i])), (x1 = Math.max(x1, poly[i])), (y0 = Math.min(y0, poly[i + 1])), (y1 = Math.max(y1, poly[i + 1]));
      polys.push(poly);
    }
    if (polys.length) {
      shapes.setColor(C.aabb);
      shapes.rect(false, x0, y0, x1 - x0, y1 - y0);
      shapes.setColor(C.box);
      for (const poly of polys) shapes.polygon(poly, 0, poly.length);
    }
  }
  if (o.paths)
    for (const s of pose.slots) {
      if (!s.bone.active || s.part?.kind !== "path") continue;
      let nn = pose.vertices(s, v);
      if (!nn) continue;
      let x1 = v[2],
        y1 = v[3],
        x2 = 0,
        y2 = 0;
      if (s.part.closed) {
        const cx1 = v[0],
          cy1 = v[1],
          cx2 = v[nn - 2],
          cy2 = v[nn - 1];
        x2 = v[nn - 4];
        y2 = v[nn - 3];
        shapes.setColor(C.path);
        shapes.curve(x1, y1, cx1, cy1, cx2, cy2, x2, y2, 32);
        shapes.setColor(C.gray);
        shapes.line(x1, y1, cx1, cy1);
        shapes.line(x2, y2, cx2, cy2);
      }
      nn -= 4;
      for (let i = 4; i < nn; i += 6) {
        const cx1 = v[i],
          cy1 = v[i + 1],
          cx2 = v[i + 2],
          cy2 = v[i + 3];
        x2 = v[i + 4];
        y2 = v[i + 5];
        shapes.setColor(C.path);
        shapes.curve(x1, y1, cx1, cy1, cx2, cy2, x2, y2, 32);
        shapes.setColor(C.gray);
        shapes.line(x1, y1, cx1, cy1);
        shapes.line(x2, y2, cx2, cy2);
        x1 = x2;
        y1 = y2;
      }
    }
  if (o.bones) {
    shapes.setColor(C.boneOrigin);
    for (const b of pose.bones) shapes.circle(true, b.worldX, b.worldY, 3 * o.scale, C.boneOrigin, 8);
  }
  if (o.clipping) {
    shapes.setColor(C.clip);
    for (const s of pose.slots) {
      if (!s.bone.active || s.part?.kind !== "clipping") continue;
      const n = pose.vertices(s, v);
      for (let i = 0; i < n; i += 2) shapes.line(v[i], v[i + 1], v[(i + 2) % n], v[(i + 3) % n]);
    }
  }
}
