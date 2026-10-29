// Pose dos ossos num instante de uma animacao, a partir do documento. Comandos usam para
// converter "mover na tela" em valores locais. Mesma sequencia deterministica do viewer
// (src/core/instantes.ts: spine-core ou nucleo, conforme o modo das medidas).
import type { AttachmentLoader } from "@esotericsoftware/spine-core";
import type { SpineJson } from "./format.ts";
import { comMedidor, type Quadro } from "./instantes.ts";

// Esqueleto so com ossos, slots (sem imagens) e constraints: as timelines que mexem em
// attachments saem, porque nao ha imagens carregadas.
export function bonesOnly(doc: SpineJson): SpineJson {
  const anims: Record<string, any> = {};
  for (const [n, a] of Object.entries<any>(doc.animations ?? {})) {
    // path constraints saem (precisam do path attachment, que nao e carregado aqui), entao
    // as timelines delas tambem: o runtime recusa timeline de constraint que nao existe
    const { bones, ik, transform, physics, slider } = a;
    // so as timelines de cor dos slots (transparencia conta na emenda); imagens nao
    // existem aqui, entao trocas de imagem e deforms ficam de fora
    let slots: Record<string, any> | undefined;
    for (const [sn, tls] of Object.entries<any>(a.slots ?? {})) {
      const c = Object.fromEntries(Object.entries<any>(tls).filter(([k]) => /^(rgba|rgb|alpha|rgba2|rgb2)$/.test(k)));
      if (Object.keys(c).length) (slots ??= {})[sn] = c;
    }
    anims[n] = { bones, ik, transform, physics, slider, ...(slots ? { slots } : {}) };
  }
  return {
    skeleton: doc.skeleton,
    bones: doc.bones,
    slots: (doc.slots ?? []).map((s: any) => ({ name: s.name, bone: s.bone, ...(s.color ? { color: s.color } : {}) })),
    constraints: (doc.constraints ?? []).filter((c: any) => c.type !== "path"),
    ik: doc.ik,
    transform: doc.transform,
    physics: doc.physics,
    animations: anims,
  };
}

export const nullLoader: AttachmentLoader = {
  newRegionAttachment: () => null as any,
  newMeshAttachment: () => null as any,
  newBoundingBoxAttachment: () => null as any,
  newPathAttachment: () => null as any,
  newPointAttachment: () => null as any,
  newClippingAttachment: () => null as any,
};

// O spine-godot roda o esqueleto invertido (scaleY -1), e a fisica de rotacao do runtime
// aplica a gravidade com Skeleton.yDir, que nao acompanha a inversao: no jogo a gravidade
// dessas fisicas puxa para o outro lado. Aqui o esqueleto fica com y para cima (as
// medidas sao na tela) e a gravidade delas troca de sinal, no setup e nas timelines.
// A fisica de posicao (x, y) ja segue o scaleY e fica como esta. Medido igual ao
// esqueleto invertido (tests/features.ts).
export function godotGravity(doc: SpineJson): SpineJson {
  const rot = new Set<string>();
  const constraints = (doc.constraints ?? []).map((c: any) => {
    if (c.type !== "physics" || !(c.rotate || c.shearX || c.scaleX)) return c;
    rot.add(c.name);
    return c.gravity ? { ...c, gravity: -c.gravity } : c;
  });
  if (!rot.size) return doc;
  const neg = (k: any) => ({ ...k, value: -(k.value ?? 0), ...(Array.isArray(k.curve) ? { curve: k.curve.map((v: number, i: number) => (i % 2 ? -v : v)) } : {}) });
  const animations: Record<string, any> = {};
  for (const [n, a] of Object.entries<any>(doc.animations ?? {})) {
    const ph = a.physics && Object.fromEntries(Object.entries<any>(a.physics).map(([c, tls]) => [c, rot.has(c) && tls.gravity ? { ...tls, gravity: tls.gravity.map(neg) } : tls]));
    animations[n] = ph ? { ...a, physics: ph } : a;
  }
  return { ...doc, constraints, animations };
}

// A pose dos ossos num instante (a camada de src/core/instantes.ts, no modo das medidas:
// spine-core nos modos "godot" e "spine", o nucleo no modo "nucleo"). Para varios instantes,
// abra um medidor (abrirMedidor) e peca todos de uma vez.
export function skeletonAt(doc: SpineJson, anim: string | null, t: number, loop = true): Quadro {
  // loop como o viewer (o editor toca em loop); sem loop, t = duracao e o ultimo quadro
  return comMedidor(doc, null, (m) => m.poses(anim, [t], { loop })[0], { leve: true });
}

export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
  y: number;
}

export function boneWorld(sk: Quadro, name: string): Affine {
  const b = sk.findBone(name);
  if (!b) throw new Error(`osso nao existe: ${name}`);
  return { a: b.a, b: b.b, c: b.c, d: b.d, x: b.worldX, y: b.worldY };
}

export const apply = (m: Affine, x: number, y: number): [number, number] => [m.a * x + m.b * y + m.x, m.c * x + m.d * y + m.y];
export const applyLinear = (m: Affine, x: number, y: number): [number, number] => [m.a * x + m.b * y, m.c * x + m.d * y];
export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c || 1e-12;
  const a = m.d / det,
    b = -m.b / det,
    c = -m.c / det,
    d = m.a / det;
  return { a, b, c, d, x: -(a * m.x + b * m.y), y: -(c * m.x + d * m.y) };
}
