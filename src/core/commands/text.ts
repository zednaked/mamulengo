// Texto com traducao (so do Mamulengo; docs/NUCLEO.md "Texto"): a parte de texto num slot (a caixa
// no osso, como uma regiao, com o texto livre ou a chave da tabela de idiomas, a fonte, o tamanho,
// a cor, o alinhamento e o que fazer quando estoura), as fontes do projeto (`fonts`, arquivos ao lado
// do .boneco) e a tabela de idiomas (`translations`, que importa e exporta o translations.csv do
// Godot). As letras sao desenhadas por quem mostra (o navegador, o Godot); o nucleo so as poe no lugar.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { requireBone, requireSlot, skins, slotIndex, slots } from "../model.ts";
import { round } from "./timeline.ts";
import type { Editor } from "../document.ts";
import {
  IDIOMAS_FROTA,
  diagramar,
  escreverCsv,
  juntarTraducoes,
  medidorRegistrado,
  textoNoIdioma,
  traducoesDoCsv,
  type Medidor,
  type ParteTexto,
  type Traducoes,
} from "../texto.ts";

const ORDEM = ["type", "x", "y", "rotation", "scaleX", "scaleY", "width", "height", "string", "key", "font", "size", "minSize", "color", "align", "valign", "overflow", "outline", "shadow"];
const PADRAO: Record<string, any> = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, align: "center", valign: "middle", overflow: "shrink", color: "ffffffff" };

export const traducoesDe = (json: any): Traducoes | undefined => json.translations;
export const fontesDe = (json: any): { name: string; file: string }[] => json.fonts ?? [];

// todas as partes de texto do documento: skin, slot, nome, osso e a parte
export function textosDe(json: any): { skin: string; slot: string; name: string; bone: string; a: ParteTexto }[] {
  const out: { skin: string; slot: string; name: string; bone: string; a: ParteTexto }[] = [];
  for (const sk of skins(json))
    for (const [sl, ps] of Object.entries<any>(sk.attachments ?? {}))
      for (const [n, a] of Object.entries<any>(ps))
        if (a?.type === "text") out.push({ skin: sk.name, slot: sl, name: n, bone: slots(json).find((s) => s.name === sl)?.bone ?? "", a });
  return out;
}

const Cor = z.string().regex(/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "cor rrggbb ou rrggbbaa");
const cor8 = (c: string) => (c.length === 6 ? c + "ff" : c).toLowerCase();

defineCommand({
  name: "text.set",
  group: "attachment",
  summary:
    "Parte de texto num slot (so do Mamulengo; o Spine nao tem): a caixa (width x height, no osso do slot como uma regiao, x/y o meio dela) com o texto livre (text) ou a chave da tabela de idiomas (key, i18n.set; text vale como padrao quando falta a traducao), a fonte do projeto (font: o nome dado em font.add), size (a letra em px do mundo), color, align (left, center, right), valign (top, middle, bottom) e overflow: shrink (encolhe ate minSize; padrao metade), wrap (quebra nas palavras), clip (corta na caixa) ou none. outline {width, color} contorna as letras; shadow {color, x, y} a sombra (y para baixo). Os parametros \"{nome}\" no texto o jogo troca: tela.texto(\"saldo\", {valor: \"R$ 100\"}). Sem o slot, bone cria o slot (na frente de todos, ou above/below). key:null volta ao texto livre. Para ver os estouros em cada idioma: query.texts.",
  params: z.object({
    slot: z.string(),
    name: z.string().optional().describe("o nome da parte (padrao: o do slot)"),
    skin: z.string().default("default"),
    bone: z.string().optional().describe("cria o slot neste osso, se ele ainda nao existe"),
    above: z.string().optional(),
    below: z.string().optional(),
    text: z.string().optional(),
    key: z.string().nullable().optional(),
    font: z.string().nullable().optional(),
    size: z.number().positive().optional(),
    minSize: z.number().min(0).optional(),
    color: Cor.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    valign: z.enum(["top", "middle", "bottom"]).optional(),
    overflow: z.enum(["shrink", "wrap", "clip", "none"]).optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    rotation: z.number().optional(),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    outline: z.object({ width: z.number().min(0), color: Cor.optional() }).nullable().optional(),
    shadow: z.object({ color: Cor.optional(), x: z.number().optional(), y: z.number().optional() }).nullable().optional(),
  }),
  label: (p) => `texto ${p.slot}`,
  run({ e, run }, p) {
    let sIdx = slotIndex(e.json, p.slot);
    if (sIdx < 0) {
      if (!p.bone) throw new Error(`slot nao existe: ${p.slot} (passe bone para criar)`);
      requireBone(e.json, p.bone);
      run("slot.add", { name: p.slot, bone: p.bone, ...(p.above ? { above: p.above } : {}), ...(p.below ? { below: p.below } : {}) });
      sIdx = requireSlot(e.json, p.slot);
    }
    if (p.font && !fontesDe(e.json).some((f) => f.name === p.font)) throw new Error(`fonte desconhecida: ${p.font} (font.add {name, file} antes; as do projeto: ${fontesDe(e.json).map((f) => f.name).join(", ") || "nenhuma"})`);
    if (p.key && !traducoesDe(e.json)?.strings[p.key]) throw new Error(`chave desconhecida: ${p.key} (i18n.set {key, values} antes)`);
    const nome = p.name ?? p.slot;
    let si = skins(e.json).findIndex((s) => s.name === p.skin);
    if (si < 0) {
      if (!e.json.skins) e.set(["skins"], []);
      si = skins(e.json).length;
      e.insert(["skins"], si, { name: p.skin, attachments: {} });
    }
    const path = ["skins", si, "attachments", p.slot, nome];
    const cur = skins(e.json)[si].attachments?.[p.slot]?.[nome];
    if (cur && cur.type !== "text") throw new Error(`${p.slot}/${nome} ja existe e e ${cur.type ?? "region"}`);
    const novo: any = { ...(cur ?? { type: "text", width: 200, height: 60, size: 32 }) };
    const muda: Record<string, any> = {
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      scaleX: p.scaleX,
      scaleY: p.scaleY,
      width: p.width,
      height: p.height,
      string: p.text,
      key: p.key,
      font: p.font,
      size: p.size,
      minSize: p.minSize,
      color: p.color && cor8(p.color),
      align: p.align,
      valign: p.valign,
      overflow: p.overflow,
      outline: p.outline === null ? null : p.outline && { width: round(p.outline.width), color: cor8(p.outline.color ?? "000000ff") },
      shadow: p.shadow === null ? null : p.shadow && { color: cor8(p.shadow.color ?? "00000080"), x: round(p.shadow.x ?? 0), y: round(p.shadow.y ?? 3) },
    };
    for (const [k, v] of Object.entries(muda)) {
      if (v === undefined) continue;
      if (v === null) delete novo[k];
      else novo[k] = typeof v === "number" ? round(v) : v;
    }
    if (!novo.key && novo.string === undefined) novo.string = "";
    // na ordem do formato, sem os padroes
    const a: any = {};
    for (const k of ORDEM) if (novo[k] !== undefined && !(k in PADRAO && JSON.stringify(PADRAO[k]) === JSON.stringify(novo[k]))) a[k] = novo[k];
    a.type = "text";
    if (JSON.stringify(a) !== JSON.stringify(cur)) e.set(path, a);
    if (!slots(e.json)[sIdx].attachment && p.skin === "default") e.set(["slots", sIdx, "attachment"], nome);
    return { slot: p.slot, name: nome, bone: slots(e.json)[sIdx].bone, text: a };
  },
});

defineCommand({
  name: "font.add",
  group: "skeleton",
  summary:
    "Uma fonte do projeto para os textos (so do Mamulengo): name (o nome que text.set usa) e file, o arquivo TTF, OTF ou WOFF2 ao lado do .boneco (caminho relativo a ele). A primeira e a padrao; as outras entram como reserva das letras que faltam (ponha uma de arabe e uma de devanagari para esses idiomas). off:true tira (os textos com ela voltam a padrao).",
  params: z.object({ name: z.string().min(1), file: z.string().optional(), off: z.boolean().optional() }),
  label: (p) => `fonte ${p.name}`,
  run({ e }, p) {
    const lista = [...fontesDe(e.json)];
    const k = lista.findIndex((f) => f.name === p.name);
    if (p.off) {
      if (k < 0) throw new Error(`fonte desconhecida: ${p.name}`);
      lista.splice(k, 1);
      e.set(["fonts"], lista.length ? lista : undefined);
      for (const t of textosDe(e.json))
        if (t.a.font === p.name) e.set(["skins", skins(e.json).findIndex((s) => s.name === t.skin), "attachments", t.slot, t.name, "font"], undefined);
      return { fonts: lista };
    }
    if (!p.file) throw new Error("file: o arquivo da fonte (TTF, OTF ou WOFF2), relativo ao .boneco");
    if (!/\.(ttf|otf|woff2?)$/i.test(p.file)) throw new Error(`fonte ${p.file}: use TTF, OTF ou WOFF2`);
    const f = { name: p.name, file: p.file };
    if (k >= 0) lista[k] = f;
    else lista.push(f);
    e.set(["fonts"], lista);
    return { fonts: lista };
  },
});

function setTraducoes(e: Editor, t: Traducoes | undefined) {
  e.set(["translations"], t && (t.languages.length || Object.keys(t.strings).length) ? t : undefined);
}

defineCommand({
  name: "i18n.set",
  group: "skeleton",
  summary: `A tabela de idiomas (so do Mamulengo): languages poe os idiomas e a ordem (os 12 da frota: ${IDIOMAS_FROTA.join(", ")}; um que sai leva as traducoes dele); key com values {idioma: texto} cria ou muda uma chave (os idiomas que nao vieram ficam como estao; idioma novo entra no fim); rename muda o nome da chave (e nas partes que a usam); delete tira a chave. Importar o translations.csv: i18n.import.`,
  params: z.object({
    languages: z.array(z.string().min(1)).optional(),
    key: z.string().min(1).optional(),
    values: z.record(z.string(), z.string()).optional(),
    rename: z.string().min(1).optional(),
    delete: z.boolean().optional(),
  }),
  label: (p) => (p.key ? `traducao ${p.key}` : "idiomas"),
  run({ e }, p) {
    let t: Traducoes = structuredClone(traducoesDe(e.json) ?? { languages: [], strings: {} });
    if (p.languages) {
      if (new Set(p.languages).size !== p.languages.length) throw new Error("idioma repetido");
      const antes = t.languages;
      t = { languages: p.languages, strings: Object.fromEntries(Object.entries(t.strings).map(([k, v]) => [k, p.languages!.map((l) => v[antes.indexOf(l)] ?? "")])) };
    }
    if (p.key) {
      if (p.delete) {
        if (!(p.key in t.strings)) throw new Error(`chave desconhecida: ${p.key}`);
        delete t.strings[p.key];
        for (const x of textosDe(e.json)) if (x.a.key === p.key) e.set(["skins", skins(e.json).findIndex((s) => s.name === x.skin), "attachments", x.slot, x.name, "key"], undefined);
      } else {
        if (!t.languages.length && !p.values) t.languages = ["pt"];
        for (const l of Object.keys(p.values ?? {})) if (!t.languages.includes(l)) t.languages.push(l), Object.values(t.strings).forEach((v) => v.push(""));
        const linha = t.strings[p.key] ?? t.languages.map(() => "");
        while (linha.length < t.languages.length) linha.push("");
        for (const [l, v] of Object.entries(p.values ?? {})) linha[t.languages.indexOf(l)] = v;
        if (p.rename && p.rename !== p.key) {
          if (p.rename in t.strings) throw new Error(`chave ja existe: ${p.rename}`);
          const ents = Object.entries(t.strings).map(([k, v]) => (k === p.key ? [p.rename!, linha] : [k, v]));
          t.strings = Object.fromEntries(p.key in t.strings ? ents : [...ents, [p.rename, linha]]);
          for (const x of textosDe(e.json)) if (x.a.key === p.key) e.set(["skins", skins(e.json).findIndex((s) => s.name === x.skin), "attachments", x.slot, x.name, "key"], p.rename);
        } else t.strings[p.key] = linha;
      }
    }
    setTraducoes(e, t);
    return { languages: t.languages, keys: Object.keys(t.strings).length, ...(p.key && !p.delete ? { [p.rename ?? p.key]: t.strings[p.rename ?? p.key] } : {}) };
  },
});

defineCommand({
  name: "i18n.import",
  group: "skeleton",
  summary:
    "Importa a tabela de idiomas de um CSV no formato do translations.csv do Godot (a primeira linha `keys,pt,en,es,...`, depois uma chave por linha; aspas como no CSV). csv: o texto; ou file: o caminho (relativo ao .boneco). Junta com a que existe (o que o CSV traz vale; idiomas novos entram no fim); replace:true troca a tabela inteira.",
  params: z.object({ csv: z.string().optional(), file: z.string().optional(), replace: z.boolean().optional() }),
  label: () => "importa traducoes",
  prepare: async ({ doc, assets }, p) => {
    if (p.csv !== undefined || !p.file) return { csv: p.csv };
    const caminho = p.file.startsWith("/") ? p.file : ((doc as any).file?.skeleton ?? "").replace(/[^/]*$/, "") + p.file;
    const b = await assets?.bytes?.(caminho);
    if (!b) throw new Error(`nao li ${caminho}`);
    return { csv: new TextDecoder().decode(b) };
  },
  run({ e, prepared }, p) {
    const csv = prepared?.csv ?? p.csv;
    if (csv === undefined) throw new Error("csv ou file");
    const novo = traducoesDoCsv(csv);
    const t = p.replace ? novo : juntarTraducoes(traducoesDe(e.json), novo);
    setTraducoes(e, t);
    return { languages: t.languages, keys: Object.keys(t.strings).length, imported: Object.keys(novo.strings).length };
  },
});

defineCommand({
  name: "i18n.export",
  group: "query",
  readonly: true,
  summary: "A tabela de idiomas como CSV no formato do translations.csv do Godot (keys,pt,en,...).",
  params: z.object({}),
  run({ doc }) {
    const t = traducoesDe(doc.json);
    return { csv: t ? escreverCsv(t) : "keys\n", languages: t?.languages ?? [], keys: Object.keys(t?.strings ?? {}).length };
  },
});

// o medidor do node: a largura de avanco das letras pela fonte .ttf (sem shaping: no arabe e no
// devanagari e uma aproximacao); as fontes de reserva cobrem as letras que faltam
async function medidorDoNode(doc: any, assets: any): Promise<((familia?: string) => Medidor) | null> {
  const { lerFonte } = await import("../fonte.ts");
  const lidas: { nome: string; f: any }[] = [];
  for (const f of fontesDe(doc.json)) {
    const caminho = f.file.startsWith("/") ? f.file : (doc.file?.skeleton ?? "").replace(/[^/]*$/, "") + f.file;
    try {
      const b = await assets?.bytes?.(caminho);
      if (b) lidas.push({ nome: f.name, f: lerFonte(b) });
    } catch {
      // CFF ou WOFF2: fica de fora da conta aproximada
    }
  }
  if (!lidas.length) return null;
  return (familia) => {
    const ordem = [...lidas.filter((l) => l.nome === familia), ...lidas.filter((l) => l.nome !== familia)];
    const principal = ordem[0].f;
    return {
      largura(t, px) {
        let w = 0;
        for (const ch of t) {
          const cp = ch.codePointAt(0)!;
          const l = ordem.find((o) => o.f.glifo(cp)) ?? ordem[0];
          w += (l.f.avanco(l.f.glifo(cp)) * px) / l.f.unidades;
        }
        return w;
      },
      metricas(px) {
        return { asc: (principal.ascendente * px) / principal.unidades, desc: (-principal.descendente * px) / principal.unidades };
      },
    };
  };
}

defineCommand({
  name: "query.texts",
  group: "query",
  readonly: true,
  summary:
    "Os textos (partes de texto) com o osso, o slot, a chave, a fonte, a caixa, e em cada idioma da tabela (ou os de languages) o texto mostrado e se estoura a caixa: a letra que ficou (shrink), quanto passa em largura e altura (px do mundo). No editor a medida e a do navegador (com o shaping de verdade); fora dele, a da largura das letras na fonte (aproximada no arabe e no devanagari). Tambem as fontes e os idiomas do projeto e as chaves sem traducao.",
  params: z.object({ languages: z.array(z.string()).optional(), slot: z.string().optional() }),
  prepare: async ({ doc, assets }) => {
    const reg = medidorRegistrado();
    if (reg) return { medidor: await reg(doc), exata: true };
    return { medidor: await medidorDoNode(doc, assets), exata: false };
  },
  run({ doc, prepared }, p) {
    const j = doc.json;
    const t = traducoesDe(j);
    const idiomas = p.languages ?? (t?.languages.length ? t.languages : ["pt"]);
    const fab: ((familia?: string, idioma?: string) => Medidor) | null = prepared?.medidor ?? null;
    const textos = textosDe(j)
      .filter((x) => !p.slot || x.slot === p.slot)
      .map((x) => {
        const porIdioma = Object.fromEntries(
          idiomas.map((l) => {
            const s = textoNoIdioma(x.a, t, l);
            if (!fab) return [l, { text: s }];
            const d = diagramar(s, { width: x.a.width, height: x.a.height, size: x.a.size ?? 32, minSize: x.a.minSize, align: x.a.align, valign: x.a.valign, overflow: x.a.overflow }, fab(x.a.font, l));
            return [l, { text: s, size: d.px, lines: d.linhas.length, overflows: d.estoura, ...(d.estoura ? { over: d.quanto.map((v) => Math.round(v * 10) / 10) } : {}) }];
          }),
        );
        return {
          slot: x.slot,
          name: x.name,
          bone: x.bone,
          skin: x.skin,
          key: x.a.key ?? null,
          font: x.a.font ?? fontesDe(j)[0]?.name ?? null,
          box: [x.a.width, x.a.height],
          size: x.a.size ?? 32,
          overflow: x.a.overflow ?? "shrink",
          languages: porIdioma,
        };
      });
    const faltam = t ? Object.entries(t.strings).flatMap(([k, v]) => t.languages.filter((_, i) => !v[i]).map((l) => `${k}:${l}`)) : [];
    return {
      fonts: fontesDe(j),
      languages: t?.languages ?? [],
      keys: Object.keys(t?.strings ?? {}).length,
      missing: faltam,
      measured: fab ? (prepared?.exata ? "navegador" : "aproximada (largura das letras na fonte)") : "sem fonte legivel: so os textos",
      texts: textos,
      overflowing: textos.flatMap((x) => Object.entries<any>(x.languages).filter(([, v]) => v.overflows).map(([l]) => `${x.slot}:${l}`)),
    };
  },
});
