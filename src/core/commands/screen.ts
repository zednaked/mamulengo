// A tela (so do Mamulengo; docs/NUCLEO.md "Tela"): o boneco inteiro e a tela de um jogo. `screen`
// no topo do JSON do editor (onde o spine-core nao le) guarda a arte base (o tamanho de referencia,
// [x, y, largura, altura] no mundo, y para cima), o encaixe numa janela de outro tamanho e os ossos
// presos a pontos da janela. A conta (a vista e a correcao dos ossos ancorados) e do nucleo; aqui
// so o documento e o deslocamento ate a ancora na arte base, que e a pose de setup.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { boneIndex, bones, descendants, requireBone, skins, slots } from "../model.ts";
import { round } from "./timeline.ts";
import { apply, boneWorld, skeletonAt, type Affine } from "../pose.ts";
import type { Editor } from "../document.ts";

export const FITS = ["contain", "cover", "width", "height"] as const;
// os 9 pontos: x da esquerda (0) para a direita (1), y de cima (0) para baixo (1)
export const ANCHORS: Record<string, [number, number]> = {
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
};
export const anchorName = (a: number[]) => Object.entries(ANCHORS).find(([, v]) => v[0] === a[0] && v[1] === a[1])?.[0] ?? null;

export type ScreenAnchor = { bone: string; anchor: number[]; stretch?: string; cover?: number[] };
export type Screen = { art?: number[]; fit?: (typeof FITS)[number]; anchors?: ScreenAnchor[] };
export const screenOf = (json: any): Screen | null => json.screen ?? null;

// a arte base em uso: a do bloco, ou a caixa do esqueleto (o mesmo padrao do nucleo)
export function artOf(json: any): number[] | null {
  const s = screenOf(json);
  if (s?.art) return s.art;
  const k = json.skeleton ?? {};
  return k.width > 0 && k.height > 0 ? [k.x ?? 0, k.y ?? 0, k.width, k.height] : null;
}

// o deslocamento do osso ate o ponto da ancora, na arte base: x para a direita, y para baixo (como
// na tela); no eixo que estica, a ancora e a fracao do proprio osso e o deslocamento e 0
function offsetOf(art: number[], world: Affine, a: { anchor: number[]; stretch?: string }): [number | null, number | null] {
  const sx = a.stretch?.includes("x"), sy = a.stretch?.includes("y");
  const dx = world.x - (art[0] + a.anchor[0] * art[2]);
  const dy = art[1] + (1 - a.anchor[1]) * art[3] - world.y;
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return [sx ? null : r(dx), sy ? null : r(dy)];
}

// a caixa das partes do grupo (o osso e os filhos) na pose de setup, no mundo: [x, y, largura,
// altura], y para cima. Regioes pelos 4 cantos, malhas sem pesos pelos vertices (com pesos, pelo
// osso de cada peso); texto pela caixa. O "cobrir sem deformar" usa como a caixa que cobre a janela
export function groupBox(doc: any, bone: string): number[] | null {
  const grupo = descendants(doc, bone);
  grupo.add(bone);
  const sk = skeletonAt(doc, null, 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ponto = (p: [number, number]) => {
    x0 = Math.min(x0, p[0]), y0 = Math.min(y0, p[1]), x1 = Math.max(x1, p[0]), y1 = Math.max(y1, p[1]);
  };
  for (const sl of slots(doc)) {
    if (!grupo.has(sl.bone) || !sl.attachment) continue;
    const skin = skins(doc).find((k) => k.name === "default") ?? skins(doc)[0];
    const att = skin?.attachments?.[sl.name]?.[sl.attachment];
    if (!att) continue;
    const w = boneWorld(sk, sl.bone);
    const tipo = att.type ?? "region";
    if (tipo === "region" || tipo === "text") {
      const sx = att.scaleX ?? 1, sy = att.scaleY ?? 1, r = ((att.rotation ?? 0) * Math.PI) / 180;
      const hw = ((att.slice?.width ?? att.width ?? 0) / 2) * sx, hh = ((att.slice?.height ?? att.height ?? 0) / 2) * sy;
      for (const [cx, cy] of [[-hw, -hh], [-hw, hh], [hw, hh], [hw, -hh]])
        ponto(apply(w, (att.x ?? 0) + cx * Math.cos(r) - cy * Math.sin(r), (att.y ?? 0) + cx * Math.sin(r) + cy * Math.cos(r)));
    } else if (tipo === "mesh" && Array.isArray(att.vertices)) {
      const v: number[] = att.vertices;
      if (v.length === (att.uvs?.length ?? -1)) for (let i = 0; i < v.length; i += 2) ponto(apply(w, v[i], v[i + 1]));
      else
        for (let i = 0; i < v.length; ) {
          const n = v[i++];
          let px = 0, py = 0;
          for (let k = 0; k < n; k++, i += 4) {
            const [qx, qy] = apply(boneWorld(sk, bones(doc)[v[i]].name), v[i + 1], v[i + 2]);
            px += qx * v[i + 3], py += qy * v[i + 3];
          }
          ponto([px, py]);
        }
    }
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return [r(x0), r(y0), r(x1 - x0), r(y1 - y0)];
}

function setScreen(e: Editor, s: Screen | null) {
  e.set(["screen"], s ?? undefined);
}

defineCommand({
  name: "screen.set",
  group: "skeleton",
  summary:
    "A tela (so do Mamulengo, para .boneco; o Spine nao tem): o boneco inteiro como a tela de um jogo. art [x, y, largura, altura] e a arte base no mundo (y para cima, canto de baixo e da esquerda), o tamanho de referencia em que a tela foi desenhada; size [largura, altura] poe a arte com o meio da borda de baixo na origem (o padrao do import de PSD). fit: como a arte encaixa numa janela de outra proporcao (contain: cabe inteira, sobra borda; cover: cobre a janela, corta; width: a largura manda; height: a altura manda). Os ossos presos a pontos da janela: anchor.set. off:true tira a tela (e as ancoras).",
  params: z.object({
    art: z.array(z.number()).length(4).optional(),
    size: z.array(z.number().positive()).length(2).optional(),
    fit: z.enum(FITS).optional(),
    off: z.boolean().optional(),
  }),
  label: () => "tela",
  run({ e }, p) {
    if (p.off) {
      setScreen(e, null);
      return { screen: null };
    }
    const cur: Screen = { ...(screenOf(e.json) ?? {}) };
    if (p.art && p.size) throw new Error("use art ou size, nao os dois");
    if (p.art) {
      if (!(p.art[2] > 0 && p.art[3] > 0)) throw new Error("a arte base precisa de largura e altura positivas");
      cur.art = p.art.map(round);
    }
    if (p.size) cur.art = [round(-p.size[0] / 2), 0, round(p.size[0]), round(p.size[1])];
    if (p.fit) cur.fit = p.fit;
    if (!cur.art && !artOf(e.json)) throw new Error("falta a arte base: screen.set {size: [largura, altura]} ou {art: [x, y, largura, altura]}");
    const novo: Screen = { ...(cur.art ? { art: cur.art } : {}), fit: cur.fit ?? "contain", ...(cur.anchors?.length ? { anchors: cur.anchors } : {}) };
    if (JSON.stringify(novo) !== JSON.stringify(screenOf(e.json))) setScreen(e, novo);
    return { screen: novo };
  },
});

defineCommand({
  name: "anchor.set",
  group: "bone",
  summary:
    "Prende um osso (com o que pende dele) a um ponto da janela (so do Mamulengo; precisa da tela: screen.set). anchor: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right, ou [x, y] de 0 a 1 (x da esquerda, y de cima). Numa janela de outro tamanho ou proporcao o osso mantem a distancia ate esse ponto; os ossos sem ancora acompanham o pai. stretch x, y ou xy: estica o osso nesse eixo com a janela (uma barra de ponta a ponta), e nesse eixo ele fica na fracao em que esta na arte. offset [dx, dy]: a distancia do ponto da ancora ate o osso na arte base, em px, x para a direita e y para baixo; muda o setup do osso. cover: cobrir sem deformar (o fundo maior que a tela): o osso escala por igual, em volta do proprio ponto, ate a caixa cobrir a janela, nunca menos que a arte; true usa a caixa das partes do grupo no setup, [x, y, largura, altura] (mundo, y para cima) uma caixa dada, false tira; nao combina com stretch. Um bloco que anda junto (o palco) e um osso ancorado com os filhos sem ancora. off:true solta o osso. Prefira o osso que agrupa as partes (ou o da instancia).",
  params: z.object({
    bone: z.string(),
    anchor: z.union([z.enum(Object.keys(ANCHORS) as [string, ...string[]]), z.array(z.number().min(0).max(1)).length(2)]).optional(),
    stretch: z.enum(["none", "x", "y", "xy"]).optional(),
    offset: z.array(z.number()).length(2).optional(),
    cover: z.union([z.boolean(), z.array(z.number()).length(4)]).optional(),
    off: z.boolean().optional(),
  }),
  label: (p) => `ancora ${p.bone}`,
  run({ e }, p) {
    const bi = requireBone(e.json, p.bone);
    const s = screenOf(e.json);
    const art = artOf(e.json);
    const lista = [...(s?.anchors ?? [])];
    const k = lista.findIndex((a) => a.bone === p.bone);
    if (p.off) {
      if (k < 0) return { bone: p.bone, anchor: null };
      lista.splice(k, 1);
      const { anchors: _, ...resto } = s!;
      setScreen(e, lista.length ? { ...resto, anchors: lista } : resto);
      return { bone: p.bone, anchor: null };
    }
    if (!art) throw new Error("a tela ainda nao tem arte base: screen.set {size: [largura, altura]} antes");
    const antes: ScreenAnchor = k >= 0 ? lista[k] : { bone: p.bone, anchor: [0.5, 0.5] };
    const a: ScreenAnchor = { bone: p.bone, anchor: [...antes.anchor] };
    if (p.anchor) a.anchor = typeof p.anchor === "string" ? [...ANCHORS[p.anchor]] : p.anchor.map(round);
    const st = p.stretch ?? antes.stretch ?? "none";
    if (st !== "none") a.stretch = st;
    let cover = p.cover === undefined ? antes.cover : p.cover === false ? undefined : p.cover === true ? groupBox(e.json, p.bone) : p.cover.map(round);
    if (p.cover === true && !cover) throw new Error(`${p.bone}: o grupo nao tem partes para dar a caixa; passe cover [x, y, largura, altura]`);
    if (cover && !(cover[2] > 0 && cover[3] > 0)) throw new Error("cover: a caixa precisa de largura e altura positivas");
    if (cover && a.stretch) {
      if (p.cover !== undefined && p.stretch === undefined) delete a.stretch;
      else if (p.stretch !== undefined && p.cover === undefined) cover = undefined;
      else throw new Error("cobrir sem deformar nao estica: use cover ou stretch");
    }
    if (cover) a.cover = cover;
    if (k >= 0) lista[k] = a;
    else lista.push(a);
    // na ordem dos ossos, como o nucleo calcula
    lista.sort((x, y) => boneIndex(e.json, x.bone) - boneIndex(e.json, y.bone));
    const novo: Screen = { ...(s ?? { art, fit: "contain" }), anchors: lista };
    if (JSON.stringify(novo) !== JSON.stringify(s)) setScreen(e, novo);
    // o deslocamento: move o setup do osso para que, na arte base, ele fique a [dx, dy] do ponto
    if (p.offset) {
      const sk = skeletonAt(e.json, null, 0);
      const w = boneWorld(sk, p.bone);
      const alvoX = art[0] + a.anchor[0] * art[2] + p.offset[0];
      const alvoY = art[1] + (1 - a.anchor[1]) * art[3] - p.offset[1];
      let dx = a.stretch?.includes("x") ? 0 : alvoX - w.x,
        dy = a.stretch?.includes("y") ? 0 : alvoY - w.y;
      const b = bones(e.json)[bi];
      if (b.parent) {
        const pw = boneWorld(sk, b.parent);
        const det = pw.a * pw.d - pw.b * pw.c || 1e-12;
        [dx, dy] = [(pw.d * dx - pw.b * dy) / det, (-pw.c * dx + pw.a * dy) / det];
      }
      if (Math.abs(dx) > 1e-9) e.set(["bones", bi, "x"], round((b.x ?? 0) + dx) || undefined);
      if (Math.abs(dy) > 1e-9) e.set(["bones", bi, "y"], round((b.y ?? 0) + dy) || undefined);
    }
    return { bone: p.bone, anchor: a.anchor, name: anchorName(a.anchor), stretch: a.stretch ?? "none", cover: a.cover ?? null };
  },
});

defineCommand({
  name: "query.screen",
  group: "query",
  readonly: true,
  summary:
    "A tela: a arte base, o encaixe e cada osso ancorado com o ponto (nome e [x, y]), o esticar, a caixa do cobrir sem deformar (cover) e o deslocamento ate o ponto na arte base (px, x para a direita, y para baixo; null no eixo que estica). Para ver noutros tamanhos de janela: mamulengo_view {window} e look.",
  params: z.object({}),
  run({ doc }) {
    const j = doc.json;
    const s = screenOf(j);
    if (!s) return { screen: null };
    const art = artOf(j)!;
    const sk = s.anchors?.length ? skeletonAt(j, null, 0) : null;
    return {
      art,
      fit: s.fit ?? "contain",
      anchors: (s.anchors ?? []).map((a) => ({ bone: a.bone, anchor: a.anchor, name: anchorName(a.anchor), stretch: a.stretch ?? "none", cover: a.cover ?? null, offset: offsetOf(art, boneWorld(sk!, a.bone), a) })),
    };
  },
});
