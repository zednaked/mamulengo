// Layout da arte (o que o PSD daria): cada imagem com centro, rotacao e escala na
// composicao de setup, e a ordem das camadas. Sem ossos, pesos ou animacao.
// Usado pelo kit de aceitacao (tools/acceptance-kit.ts) e conferido em tests/corpus.ts.
import { AtlasAttachmentLoader, MeshAttachment, Physics, RegionAttachment, Skeleton, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-core";

export interface Layer {
  order: number;
  layer: string;
  image: string;
  center: [number, number];
  rotation: number;
  scale: [number, number];
  blend: string;
  visible: boolean;
}

export const LAYOUT_NOTE = "posicoes em pixels do mundo, y para cima; ordem 0 = mais atras; scale x negativo = imagem espelhada";

export function artLayout(json: any, atlasText: string): Layer[] {
  const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(json);
  const sk = new Skeleton(data);
  sk.setupPose();
  sk.updateWorldTransform(Physics.reset);
  const layers: any[] = [];
  const measure = (slot: any, att: any, order: number, visible: boolean) => {
    if (!(att instanceof RegionAttachment) && !(att instanceof MeshAttachment)) return;
    const v: number[] = [];
    let image = att.path ?? att.name;
    if (att instanceof RegionAttachment) att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
    else att.computeWorldVertices(sk, slot, 0, att.worldVerticesLength, v, 0, 2);
    // centro e eixo x da imagem no mundo (pela region: cantos; pela malha: uvs)
    let cx = 0,
      cy = 0,
      rot = 0,
      sx = 1,
      sy = 1;
    if (att instanceof RegionAttachment) {
      // ordem dos cantos: BL, TL, TR, BR
      cx = (v[0] + v[4]) / 2;
      cy = (v[1] + v[5]) / 2;
      // eixos x (BL->BR) e y (BL->TL); determinante negativo = imagem espelhada
      const [xx, xy, yx, yy] = [v[6] - v[0], v[7] - v[1], v[2] - v[0], v[3] - v[1]];
      const flip = xx * yy - xy * yx < 0 ? -1 : 1;
      rot = (Math.atan2(flip * xy, flip * xx) * 180) / Math.PI;
      sx = (flip * Math.hypot(xx, xy)) / att.width;
      sy = Math.hypot(yx, yy) / att.height;
    } else {
      // ajusta u,v -> mundo por minimos quadrados (afim) e le centro/eixos
      const uv = att.regionUVs;
      const n = uv.length / 2;
      let [su, sv, sx2, sy2, suu, svv, suv, sux, svx, suy, svy] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const [u, w] = [uv[i * 2], uv[i * 2 + 1]];
        const [x, y] = [v[i * 2], v[i * 2 + 1]];
        su += u; sv += w; sx2 += x; sy2 += y; suu += u * u; svv += w * w; suv += u * w; sux += u * x; svx += w * x; suy += u * y; svy += w * y;
      }
      const mu = su / n, mv = sv / n, mx = sx2 / n, my = sy2 / n;
      const cuu = suu / n - mu * mu, cvv = svv / n - mv * mv, cuv = suv / n - mu * mv;
      const det = cuu * cvv - cuv * cuv || 1e-9;
      const cux = sux / n - mu * mx, cvx = svx / n - mv * mx, cuy = suy / n - mu * my, cvy = svy / n - mv * my;
      const ax = (cux * cvv - cvx * cuv) / det, bx = (cvx * cuu - cux * cuv) / det;
      const ay = (cuy * cvv - cvy * cuv) / det, by = (cvy * cuu - cuy * cuv) / det;
      cx = mx + ax * (0.5 - mu) + bx * (0.5 - mv);
      cy = my + ay * (0.5 - mu) + by * (0.5 - mv);
      // v cresce para baixo: o eixo y da imagem no mundo e -(bx, by)
      const flip = ax * by - ay * bx > 0 ? -1 : 1;
      rot = (Math.atan2(flip * ay, flip * ax) * 180) / Math.PI;
      // 4.3: a regiao da malha fica na sequence (att.region nao existe mais)
      const reg = ((att as any).sequence?.regions?.[0] ?? (att as any).region) as any;
      sx = (flip * Math.hypot(ax, ay)) / (reg?.originalWidth || att.width || 1);
      sy = Math.hypot(bx, by) / (reg?.originalHeight || att.height || 1);
    }
    layers.push({ order, layer: slot.data.name, image, center: [+cx.toFixed(1), +cy.toFixed(1)], rotation: +rot.toFixed(1), scale: [+sx.toFixed(3), +sy.toFixed(3)], blend: ["normal", "additive", "multiply", "screen"][slot.data.blendMode], visible });
  };
  const order = sk.drawOrder.appliedPose;
  order.forEach((slot, i) => measure(slot, slot.appliedPose.attachment, i, true));
  // camadas escondidas no setup (aparecem so em animacoes): o PSD tambem as tem.
  // Posicao = onde a imagem fica na composicao de setup.
  const skin = data.defaultSkin!;
  const seen = new Set(layers.map((l) => l.layer + "/" + l.image));
  for (const a of Object.values<any>(json.animations ?? {}))
    for (const [slotName, tls] of Object.entries<any>(a.slots ?? {}))
      for (const k of tls.attachment ?? []) {
        if (!k.name) continue;
        const slot = sk.findSlot(slotName)!;
        const att = skin.getAttachment(slot.data.index, k.name);
        const id = slotName + "/" + ((att as any)?.path ?? k.name);
        if (!att || seen.has(id)) continue;
        seen.add(id);
        measure(slot, att, order.indexOf(slot), false);
      }
  layers.sort((a, b) => a.order - b.order);
  return layers;
}
