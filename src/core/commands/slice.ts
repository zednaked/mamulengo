// Nove-fatias (so do Mamulengo; docs/NUCLEO.md "Nove-fatias"): a regiao cortada por 4 margens em 9
// pedacos. Os cantos nao esticam, as bordas de cima e de baixo esticam so na largura, as dos lados
// so na altura, e o miolo estica (ou repete). `slice` na parte do JSON do editor (o spine-core nao
// le; a exportacao para o Spine tira, com aviso). A grade de vertices e uvs e do nucleo; aqui so o
// documento.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { requireSlot, skins, slots } from "../model.ts";
import { round } from "./timeline.ts";

export const AXIS_MODES = ["stretch", "tile", "tileFit"] as const;
export type Slice = { width?: number; height?: number; left: number; top: number; right: number; bottom: number; axisX?: (typeof AXIS_MODES)[number]; axisY?: (typeof AXIS_MODES)[number]; fitText?: { slot: string; padding?: number[] } };

// todas as regioes fatiadas do documento: skin, slot, nome e a parte
export function slicesOf(json: any): { skin: string; slot: string; name: string; a: any }[] {
  const out: { skin: string; slot: string; name: string; a: any }[] = [];
  for (const sk of skins(json)) for (const [sl, ps] of Object.entries<any>(sk.attachments ?? {})) for (const [n, a] of Object.entries<any>(ps)) if (a?.slice) out.push({ skin: sk.name, slot: sl, name: n, a });
  return out;
}

// a parte de texto de um slot (a do setup, se e texto; senao a primeira), como o nucleo a acha
export function textOfSlot(json: any, slot: string): any | null {
  const setup = slots(json).find((s) => s.name === slot)?.attachment;
  let achou: any = null;
  for (const sk of skins(json))
    for (const [n, a] of Object.entries<any>(sk.attachments?.[slot] ?? {}))
      if (a?.type === "text") {
        if (n === setup) return a;
        achou ??= a;
      }
  return achou;
}

defineCommand({
  name: "slice.set",
  group: "attachment",
  summary:
    "Nove-fatias numa regiao (so do Mamulengo; o Spine desenha a regiao inteira, esticada): as 4 margens (left, top, right, bottom, nas unidades da parte, as de width e height da regiao, que sao a imagem inteira; margins poe as 4 de uma vez) cortam a imagem em 9 pedacos. size [largura, altura] e a caixa, o tamanho em que ela aparece (um botao de 260 x 90 feito de uma imagem de 192 x 64; padrao: o da imagem). Os cantos nao esticam, as bordas de cima e de baixo esticam so na largura, as dos lados so na altura e o miolo nos dois sentidos. Vale quando o osso estica com a janela (anchor.set stretch: painel e barra sem deformar as bordas) e com fitText {slot, padding: [x, y]}: a caixa cresce com o texto mostrado nesse slot mais o respiro de cada lado (o botao JOGAR que cabe em alemao e em hindi; a caixa do texto e a largura maxima). axisX, axisY: stretch (padrao), tile (repete pedacos do tamanho original, o ultimo cortado) ou tileFit (repete o numero inteiro mais perto, esticados). fitText:null tira o acompanhar; off:true tira as fatias. A parte e a do slot (name; padrao a do setup).",
  params: z.object({
    slot: z.string(),
    name: z.string().optional().describe("a parte (padrao: a do setup do slot)"),
    skin: z.string().default("default"),
    size: z.array(z.number().positive()).length(2).nullable().optional().describe("a caixa [largura, altura]: o tamanho em que a regiao aparece (padrao: o da parte, a imagem); null volta ao da parte"),
    margins: z.number().min(0).optional(),
    left: z.number().min(0).optional(),
    top: z.number().min(0).optional(),
    right: z.number().min(0).optional(),
    bottom: z.number().min(0).optional(),
    axisX: z.enum(AXIS_MODES).optional(),
    axisY: z.enum(AXIS_MODES).optional(),
    fitText: z.object({ slot: z.string(), padding: z.array(z.number().min(0)).min(1).max(2).optional() }).nullable().optional(),
    off: z.boolean().optional(),
  }),
  label: (p) => `nove-fatias ${p.slot}`,
  run({ e }, p) {
    const sIdx = requireSlot(e.json, p.slot);
    const nome = p.name ?? slots(e.json)[sIdx].attachment;
    if (!nome) throw new Error(`o slot ${p.slot} nao mostra parte (passe name)`);
    const si = skins(e.json).findIndex((s) => s.name === p.skin);
    const a = si >= 0 ? skins(e.json)[si].attachments?.[p.slot]?.[nome] : undefined;
    if (!a) throw new Error(`parte nao existe: ${p.skin}/${p.slot}/${nome}`);
    if ((a.type ?? "region") !== "region") throw new Error(`${p.slot}/${nome} e ${a.type}: nove-fatias so em regiao`);
    const path = ["skins", si, "attachments", p.slot, nome, "slice"];
    if (p.off) {
      if (a.slice) e.set(path, undefined);
      return { slot: p.slot, name: nome, slice: null };
    }
    const cur: Slice = a.slice ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const m = p.margins;
    const w = a.width ?? 32,
      h = a.height ?? 32;
    const caixa = p.size === null ? null : (p.size ?? (cur.width ? [cur.width, cur.height ?? h] : null));
    const s: Slice = {
      ...(caixa && (caixa[0] !== w || caixa[1] !== h) ? { width: round(caixa[0]), height: round(caixa[1]) } : {}),
      left: round(p.left ?? m ?? cur.left),
      top: round(p.top ?? m ?? cur.top),
      right: round(p.right ?? m ?? cur.right),
      bottom: round(p.bottom ?? m ?? cur.bottom),
    };
    const axisX = p.axisX ?? cur.axisX,
      axisY = p.axisY ?? cur.axisY;
    if (axisX && axisX !== "stretch") s.axisX = axisX;
    if (axisY && axisY !== "stretch") s.axisY = axisY;
    const fit = p.fitText === undefined ? cur.fitText : p.fitText;
    if (fit) {
      requireSlot(e.json, fit.slot);
      if (fit.slot === p.slot) throw new Error("fitText: o texto mora noutro slot (o de cima da regiao)");
      if (!textOfSlot(e.json, fit.slot)) throw new Error(`fitText: o slot ${fit.slot} nao tem parte de texto (text.set antes)`);
      const pad = fit.padding ?? [0, 0];
      s.fitText = { slot: fit.slot, padding: [round(pad[0]), round(pad[1] ?? pad[0])] };
    }
    const avisos: string[] = [];
    if (s.left + s.right > w) avisos.push(`left + right (${s.left + s.right}) passa da largura ${w}: sem miolo, os cantos se encontram`);
    if (s.top + s.bottom > h) avisos.push(`top + bottom (${s.top + s.bottom}) passa da altura ${h}: sem miolo, os cantos se encontram`);
    if (JSON.stringify(s) !== JSON.stringify(a.slice)) e.set(path, s);
    return { slot: p.slot, name: nome, slice: s, width: w, height: h, ...(avisos.length ? { warnings: avisos } : {}) };
  },
});

defineCommand({
  name: "query.slices",
  group: "query",
  summary:
    "As regioes com nove-fatias (slice.set): slot, parte, o tamanho base (width x height), as margens, os eixos, o texto que a caixa acompanha e o tamanho do miolo (o que estica); avisos de margem que passa da imagem e de texto acompanhado que sumiu.",
  params: z.object({}),
  run({ e }) {
    const out = slicesOf(e.json).map(({ skin, slot, name, a }) => {
      const s: Slice = a.slice;
      const w = a.width ?? 32,
        h = a.height ?? 32;
      const avisos: string[] = [];
      if (s.left + s.right > w || s.top + s.bottom > h) avisos.push("as margens passam do tamanho da imagem (sem miolo)");
      if (s.fitText && !textOfSlot(e.json, s.fitText.slot)) avisos.push(`o slot acompanhado ${s.fitText.slot} nao tem texto`);
      return {
        skin,
        slot,
        name,
        size: [w, h],
        box: [s.width ?? w, s.height ?? h],
        margins: { left: s.left, top: s.top, right: s.right, bottom: s.bottom },
        axis: [s.axisX ?? "stretch", s.axisY ?? "stretch"],
        center: [round(Math.max(0, w - s.left - s.right)), round(Math.max(0, h - s.top - s.bottom))],
        fitText: s.fitText ?? null,
        ...(avisos.length ? { warnings: avisos } : {}),
      };
    });
    return { slices: out };
  },
});
