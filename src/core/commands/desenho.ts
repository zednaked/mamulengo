// Comandos do ambiente Desenhar (src/core/desenho.ts): criar a imagem desenhada e presa a uma
// parte, por formas (pontos, SVG, retangulo, elipse, poligono), mexer em pontos e alcas,
// estilo (preenchimento, traco com alinhamento, quina e ponta, raio por ponto), ordem e
// tamanho da imagem. A pagina do atlas sai das formas no editor (src/app/desenho.ts).
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import type { Editor } from "../document.ts";
import { slotIndex, skins } from "../model.ts";
import { usesOfImage } from "../psd.ts";
import { meshView } from "./meshedit.ts";
import { pointInPolygon, type Pt } from "../geometry.ts";
import { ESTILOS, ajustar, estabilizar, larguraDaPressao, type Amostra } from "../lapis.ts";
import {
  drawingsOf,
  ellipsePoints,
  flatten,
  parseSvgPath,
  polygonPoints,
  rectPoints,
  requireDrawing,
  shapeBounds,
  shapeIndex,
  splitSegment,
  svgPath,
  type Contour,
  type DrawPoint,
  type DrawShape,
  type Drawing,
} from "../desenho.ts";

const Vec = z.tuple([z.number(), z.number()]);
const Color = z
  .string()
  .regex(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "cor em hex: rrggbb ou rrggbbaa")
  .transform((c) => (c.replace("#", "") + (c.replace("#", "").length === 6 ? "ff" : "")).toLowerCase());
const Point = z.object({
  x: z.number(),
  y: z.number(),
  in: Vec.optional().describe("alca de chegada, relativa ao ponto"),
  out: Vec.optional().describe("alca de saida, relativa ao ponto"),
  radius: z.number().min(0).optional().describe("arredonda o canto (ponto sem alcas, com os dois lados retos)"),
  press: z.number().min(0).max(4).optional().describe("traco de largura variavel: a largura neste ponto, em fracao da largura do traco"),
});
const Stroke = z.object({
  color: Color.optional(),
  width: z.number().positive().optional(),
  align: z.enum(["inside", "center", "outside"]).optional().describe("traco por dentro, no centro ou por fora do contorno"),
  join: z.enum(["miter", "round", "bevel"]).optional().describe("quina do traco: viva, redonda ou chanfrada"),
  cap: z.enum(["butt", "round", "square"]).optional().describe("ponta do traco aberto"),
  taper: z.tuple([z.number().min(0), z.number().min(0)]).optional().describe("afina o traco aberto no comeco e no fim: [comeco, fim] em pixels de comprimento ([0, 0] tira)"),
});
const ShapeRef = z.union([z.string(), z.number().int().min(0)]).describe("nome ou indice da forma (0 = mais atras)");
const Image = z.string().min(1).describe("nome da imagem desenhada (a regiao do atlas)");

const round = (v: number) => Math.round(v * 1000) / 1000;
const cleanPoint = (p: any): DrawPoint => {
  const o: DrawPoint = { x: round(p.x), y: round(p.y) };
  if (p.in && (p.in[0] || p.in[1])) o.in = [round(p.in[0]), round(p.in[1])];
  if (p.out && (p.out[0] || p.out[1])) o.out = [round(p.out[0]), round(p.out[1])];
  if (p.radius) o.radius = round(p.radius);
  if (p.press !== undefined && p.press !== null) o.press = round(Math.max(0, p.press));
  return o;
};

// a forma no formato do arquivo (chaves em ordem fixa, sem padroes)
function cleanShape(s: DrawShape): DrawShape {
  const o: any = { name: s.name, points: s.points.map(cleanPoint) };
  if (s.closed) o.closed = true;
  if (s.holes?.length) o.holes = s.holes.map((c) => ({ points: c.points.map(cleanPoint), ...(c.closed ? { closed: true } : {}) }));
  if (s.fill) o.fill = s.fill;
  if (s.rule === "nonzero") o.rule = "nonzero";
  if (s.stroke) {
    const st: any = { color: s.stroke.color, width: s.stroke.width };
    if (s.stroke.align && s.stroke.align !== "center") st.align = s.stroke.align;
    if (s.stroke.join && s.stroke.join !== "miter") st.join = s.stroke.join;
    if (s.stroke.cap && s.stroke.cap !== "butt") st.cap = s.stroke.cap;
    if (s.stroke.taper?.some((x) => x > 0)) st.taper = [round(s.stroke.taper[0]), round(s.stroke.taper[1])];
    o.stroke = st;
  }
  if (s.hidden) o.hidden = true;
  return o;
}

const path = (image: string): (string | number)[] => ["drawings", image];

function freeName(d: Drawing, base: string): string {
  if (!d.shapes.some((s) => s.name === base)) return base;
  for (let n = 2; ; n++) if (!d.shapes.some((s) => s.name === `${base}_${n}`)) return `${base}_${n}`;
}

// todos os pontos da forma, do contorno principal e dos furos
const allPoints = (s: DrawShape) => [...s.points, ...(s.holes ?? []).flatMap((c) => c.points)];

// o contorno c de uma copia da forma, para editar no lugar (0 = principal, 1.. = furos)
function editable(s: DrawShape, c: number): Contour {
  if (c === 0) return s as Contour;
  const h = s.holes?.[c - 1];
  if (!h) throw new Error(`contorno ${c}: a forma ${s.name} tem ${(s.holes?.length ?? 0) + 1} (0 = o principal, 1 em diante = furos)`);
  return h;
}

function setShape(e: Editor, image: string, i: number, s: DrawShape) {
  e.set([...path(image), "shapes", i], cleanShape(s));
}

// geometria de uma forma a partir de um dos jeitos de dar (pontos, svg, retangulo...)
const Geometry = {
  points: z.array(Point).optional(),
  closed: z.boolean().optional(),
  svg: z.string().optional().describe("atributo d de um <path> do SVG (M, L, H, V, C, S, Q, T, Z); varios subcaminhos viram varias formas (ou furos, com holes: true)"),
  rect: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]).optional().describe("[x, y, largura, altura]"),
  cornerRadius: z.number().min(0).optional().describe("com rect: raio dos quatro cantos"),
  ellipse: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]).optional().describe("[centro x, centro y, raio x, raio y]"),
  polygon: z
    .object({ center: Vec, radius: z.number().positive(), sides: z.number().int().min(3).max(64), inner: z.number().min(0.05).max(1).optional().describe("estrela: raio de dentro, 0 a 1") })
    .optional(),
};

function geometry(p: { points?: any[]; closed?: boolean; svg?: string; rect?: number[]; cornerRadius?: number; ellipse?: number[]; polygon?: any }): { points: DrawPoint[]; closed: boolean }[] | null {
  const given = ["points", "svg", "rect", "ellipse", "polygon"].filter((k) => (p as any)[k] !== undefined);
  if (given.length > 1) throw new Error(`de um jeito so a geometria (veio ${given.join(" e ")})`);
  if (p.svg !== undefined) return parseSvgPath(p.svg);
  if (p.rect) return [{ points: rectPoints(p.rect[0], p.rect[1], p.rect[2], p.rect[3], p.cornerRadius), closed: true }];
  if (p.ellipse) return [{ points: ellipsePoints(p.ellipse[0], p.ellipse[1], p.ellipse[2], p.ellipse[3]), closed: true }];
  if (p.polygon) return [{ points: polygonPoints(p.polygon.center[0], p.polygon.center[1], p.polygon.radius, p.polygon.sides, p.polygon.inner), closed: true }];
  if (p.points) return [{ points: p.points.map(cleanPoint), closed: p.closed ?? false }];
  return null;
}

defineCommand({
  name: "draw.create",
  group: "drawing",
  summary:
    "Cria uma imagem desenhada (vetor) de width x height pixels, vazia. Com slot (existente) ou bone + slot (novo), ja a poe numa parte: region do tamanho do desenho, centrada em x/y do osso (ou world.center), e visivel na Pose base. A imagem do jogo sai das formas (pagina <personagem>-desenhos.png do atlas, refeita no editor e gravada ao salvar). hd = pixels de textura por pixel (padrao 2).",
  params: z.object({
    image: Image,
    width: z.number().positive(),
    height: z.number().positive(),
    hd: z.number().min(0.05).max(8).optional(),
    slot: z.string().optional().describe("parte que mostra o desenho (criada se nao existir, com bone)"),
    bone: z.string().optional().describe("osso da parte nova"),
    x: z.number().optional(),
    y: z.number().optional(),
    rotation: z.number().optional(),
    world: z.object({ center: Vec, rotation: z.number().default(0) }).optional().describe("posiciona pelo mundo, como attachment.region"),
  }),
  label: (p) => `novo desenho ${p.image}`,
  run({ e, run, assets }, p) {
    if (drawingsOf(e.json)[p.image]) throw new Error(`ja existe o desenho ${p.image}`);
    if (assets?.region(p.image)) throw new Error(`ja existe uma imagem ${p.image} no atlas (nao desenhada): escolha outro nome`);
    if (!/^[\w .\/-]+$/.test(p.image)) throw new Error(`nome invalido "${p.image}": letras, numeros, espaco, . / - e _`);
    if (!e.json.drawings) e.set(["drawings"], {});
    const d: any = { width: round(p.width), height: round(p.height) };
    if (p.hd !== undefined && p.hd !== 2) d.hd = p.hd;
    d.shapes = [];
    e.set(path(p.image), d);
    if (!p.slot) return { image: p.image };
    if (slotIndex(e.json, p.slot) < 0) {
      if (!p.bone) throw new Error(`a parte ${p.slot} nao existe: diga o bone para criar`);
      run("slot.add", { name: p.slot, bone: p.bone });
    }
    const place = p.world ? { world: p.world } : { x: p.x, y: p.y, rotation: p.rotation };
    run("attachment.region", { slot: p.slot, name: p.image, width: d.width, height: d.height, ...place });
    run("slot.set", { slot: p.slot, attachment: p.image });
    return { image: p.image, slot: p.slot };
  },
});

defineCommand({
  name: "draw.shape",
  group: "drawing",
  summary:
    "Acrescenta uma forma ao desenho (na frente das outras, ou em index). Geometria por points [{x, y, in?, out?, radius?}] + closed, svg (d de um path), rect [x, y, w, h] + cornerRadius, ellipse [cx, cy, rx, ry] ou polygon {center, radius, sides, inner?}. Coordenadas em pixels da imagem, y para baixo. Estilo: fill (rrggbbaa) e stroke {color, width, align inside|center|outside, join miter|round|bevel, cap butt|round|square}. Sem estilo: forma fechada ganha preenchimento cinza; aberta, traco preto de 2.",
  params: z.object({
    image: Image,
    name: z.string().optional(),
    index: z.number().int().min(0).optional(),
    ...Geometry,
    holes: z.boolean().optional().describe("com svg de varios subcaminhos: o primeiro e a forma e os outros sao furos dela (uma letra O, uma rosca)"),
    fill: Color.optional(),
    stroke: Stroke.optional(),
    hidden: z.boolean().optional(),
  }),
  label: (p) => `forma ${p.name ?? ""} em ${p.image}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    let geo: { points: DrawPoint[]; closed: boolean; holes?: Contour[] }[] = geometry(p) ?? [{ points: [], closed: false }];
    if (p.holes && geo.length > 1) geo = [{ ...geo[0], holes: geo.slice(1) }];
    let at = Math.min(p.index ?? d.shapes.length, d.shapes.length);
    const added: { index: number; name: string }[] = [];
    for (const g of geo) {
      const name = freeName(requireDrawing(e.json, p.image), p.name ?? (p.rect ? "retangulo" : p.ellipse ? "elipse" : p.polygon ? "poligono" : "forma"));
      const s: DrawShape = { name, points: g.points, closed: g.closed };
      if (g.holes) s.holes = g.holes;
      if (p.fill) s.fill = p.fill;
      if (p.stroke) s.stroke = { color: p.stroke.color ?? "000000ff", width: p.stroke.width ?? 2, align: p.stroke.align, join: p.stroke.join, cap: p.stroke.cap, taper: p.stroke.taper };
      if (!p.fill && !p.stroke) {
        if (g.closed) s.fill = "d9d9d9ff";
        else s.stroke = { color: "000000ff", width: 2 };
      }
      if (p.hidden) s.hidden = true;
      e.insert([...path(p.image), "shapes"], at, cleanShape(s));
      added.push({ index: at, name });
      at++;
    }
    return { added };
  },
});

defineCommand({
  name: "draw.freehand",
  group: "drawing",
  summary:
    "O lapis: um traco a mao livre vira uma forma vetorial de poucos pontos e largura variavel. points = [[x, y, pressao?, tempo_ms?], ...] em pixels da imagem (pressao 0 a 1). stabilize (0 a 1) tira o tremor da mao (a ponta segue com atraso e chega na caneta no fim); smooth e a tolerancia do ajuste em pixels (maior = mais liso, menos pontos; cantos vivos ficam). style: uniforme, lapis, nanquim, pincel ou marcador (o quanto a pressao muda a largura e o quanto afina nas pontas); pressure, min, taper [comeco, fim] (em multiplos da largura) e curve mudam o estilo. fill: fecha o caminho e preenche (mancha a mao livre), com ou sem traco (stroke: false).",
  params: z.object({
    image: Image,
    name: z.string().optional(),
    index: z.number().int().min(0).optional(),
    points: z.array(z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number(), z.number()])])).min(1),
    color: Color.optional(),
    width: z.number().positive().default(4),
    style: z.enum(Object.keys(ESTILOS) as [string, ...string[]]).default("lapis"),
    stabilize: z.number().min(0).max(1).default(0),
    smooth: z.number().min(0.05).max(50).default(1),
    pressure: z.number().min(0).max(1).optional().describe("o quanto a pressao muda a largura"),
    min: z.number().min(0).max(1).optional().describe("largura com pressao zero, em fracao"),
    curve: z.number().min(0.2).max(5).optional().describe("pressao -> largura: acima de 1 pede mais forca"),
    taper: z.tuple([z.number().min(0), z.number().min(0)]).optional().describe("afinar no comeco e no fim, em multiplos da largura"),
    cap: z.enum(["butt", "round", "square"]).optional(),
    fill: Color.optional().describe("fecha o caminho e preenche com esta cor"),
    stroke: z.boolean().optional().describe("com fill: false tira o traco (so a mancha)"),
  }),
  label: (p) => `lapis em ${p.image}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const est = { ...ESTILOS[p.style] };
    if (p.pressure !== undefined) est.pressao = p.pressure;
    if (p.min !== undefined) est.minimo = p.min;
    if (p.curve !== undefined) est.curva = p.curve;
    if (p.taper) est.afinar = p.taper;
    // sem pressao nos pontos (mouse), a pressao nao muda nada
    const temPressao = p.points.some((q) => q[2] !== undefined);
    const variavel = temPressao && est.pressao > 0;
    const cru: Amostra[] = p.points.map((q) => [q[0], q[1], q[2] ?? 1, q[3]]);
    const liso = estabilizar(cru, p.stabilize).map((q): Amostra => [q[0], q[1], variavel ? larguraDaPressao(q[2] ?? 1, est) : 1, q[3]]);
    const pts = ajustar(liso, p.smooth, { variavel });
    const fechado = !!p.fill && pts.length > 2;
    const comTraco = p.stroke !== false || !fechado;
    const s: DrawShape = { name: freeName(d, p.name ?? (fechado ? "mancha" : "traco")), points: pts, closed: fechado };
    if (fechado) s.fill = p.fill;
    if (comTraco) {
      const tp: [number, number] = fechado ? [0, 0] : [est.afinar[0] * p.width, est.afinar[1] * p.width];
      s.stroke = { color: p.color ?? "000000ff", width: p.width, join: "round", cap: p.cap ?? "round", taper: tp };
    }
    const at = Math.min(p.index ?? d.shapes.length, d.shapes.length);
    e.insert([...path(p.image), "shapes"], at, cleanShape(s));
    return { index: at, name: s.name, points: pts.length, from: p.points.length };
  },
});

// ---- texto: a fonte (.ttf) vira formas (src/core/fonte.ts), uma por linha, com os furos das letras

const TextParams = {
  text: z.string().min(1).describe("o texto; \\n quebra a linha"),
  font: z.string().describe("arquivo .ttf (caminho absoluto, ou relativo ao arquivo do personagem)"),
  size: z.number().positive().describe("altura do corpo da letra (em), em pixels da imagem"),
  align: z.enum(["left", "center", "right"]).optional(),
  letterSpacing: z.number().optional().describe("pixels a mais entre as letras"),
  lineHeight: z.number().positive().optional().describe("entrelinha em multiplos do tamanho (padrao 1.15)"),
};
const fontePath = (doc: any, f: string) => (f.startsWith("/") ? f : (doc.file?.skeleton ?? "").replace(/[^/]*$/, "") + f);
async function lerFonteDe(doc: any, assets: any, f: string) {
  const { lerFonte } = await import("../fonte.ts");
  const p = fontePath(doc, f);
  const b = await assets?.bytes?.(p);
  if (!b) throw new Error(`nao li a fonte ${p}${assets?.bytes ? "" : " (este ambiente nao le arquivos)"}`);
  return lerFonte(b);
}

defineCommand({
  name: "draw.text",
  group: "drawing",
  summary:
    "Escreve texto num desenho com uma fonte .ttf: as letras viram formas (uma por linha, com os furos das letras), nitidas em qualquer tamanho, com fill e stroke como as outras formas. x e y em pixels da imagem: a ancora do alinhamento (left, center, right) e a linha de base da primeira linha. Sem kerning nem ligaduras.",
  params: z.object({
    image: Image,
    name: z.string().optional(),
    index: z.number().int().min(0).optional(),
    x: z.number(),
    y: z.number(),
    ...TextParams,
    fill: Color.optional(),
    stroke: Stroke.optional(),
  }),
  label: (p) => `texto "${p.text.slice(0, 20)}" em ${p.image}`,
  prepare: async ({ doc, assets }, p) => {
    textoMod = await import("../fonte.ts");
    return { fonte: await lerFonteDe(doc, assets, p.font) };
  },
  run({ e, prepared }, p) {
    return { added: escreve(e, prepared.fonte, p) };
  },
});

// as formas do texto no desenho (devolve o que acrescentou)
function escreve(e: Editor, fonte: any, p: { image: string; name?: string; index?: number; x: number; y: number; text: string; size: number; align?: string; letterSpacing?: number; lineHeight?: number; fill?: string; stroke?: any }) {
  const { textoEmContornos } = textoMod!;
  const d = requireDrawing(e.json, p.image);
  const linhas = textoEmContornos(fonte, p.text, { x: p.x, y: p.y, tamanho: p.size, alinhar: p.align === "center" ? "centro" : p.align === "right" ? "direita" : "esquerda", espacamento: p.letterSpacing, entrelinha: p.lineHeight });
  let at = Math.min(p.index ?? d.shapes.length, d.shapes.length);
  const added: { index: number; name: string }[] = [];
  for (const l of linhas) {
    if (!l.contornos.length) continue;
    const name = freeName(requireDrawing(e.json, p.image), p.name ?? "texto");
    // a fonte preenche pelo sentido do contorno (letras feitas de pedacos sobrepostos)
    const s: DrawShape = { name, points: l.contornos[0], closed: true, rule: "nonzero" };
    if (l.contornos.length > 1) s.holes = l.contornos.slice(1).map((c: DrawPoint[]) => ({ points: c, closed: true }));
    s.fill = p.fill ?? (p.stroke ? undefined : "000000ff");
    if (p.stroke) s.stroke = { color: p.stroke.color ?? "000000ff", width: p.stroke.width ?? 2, align: p.stroke.align ?? "outside", join: p.stroke.join ?? "round", cap: p.stroke.cap };
    e.insert([...path(p.image), "shapes"], at, cleanShape(s));
    added.push({ index: at, name });
    at++;
  }
  return added;
}
// o modulo da fonte, carregado no prepare (o run e sincrono)
let textoMod: typeof import("../fonte.ts") | null = null;

defineCommand({
  name: "draw.balloon",
  group: "drawing",
  summary:
    "Balao de fala (ou caixa de legenda) pronto: um osso e uma parte novos com um desenho do tamanho do texto, o corpo arredondado, a cauda apontando para tail (no mundo, ou omitido para sem cauda) e o texto na fonte .ttf. Com anim e from/to: entra com um pop (cresce passando do ponto) e sai encolhendo. style: fala (branco, contorno escuro), grito (pontudo, amarelo) ou legenda (faixa escura, texto claro).",
  params: z.object({
    name: z.string().min(1).describe("nome do osso, da parte e da imagem"),
    bone: z.string().describe("osso pai"),
    x: z.number().describe("centro do balao, no osso pai"),
    y: z.number(),
    ...TextParams,
    padding: z.number().min(0).optional().describe("folga entre o texto e a borda (padrao 0.5 x size)"),
    tail: Vec.optional().describe("a ponta da cauda, em coordenadas do osso pai"),
    style: z.enum(["fala", "grito", "legenda"]).optional(),
    fill: Color.optional(),
    stroke: Stroke.optional(),
    textColor: Color.optional(),
    anim: z.string().optional(),
    from: z.number().min(0).optional(),
    to: z.number().min(0).optional(),
  }),
  label: (p) => `balao ${p.name}`,
  prepare: async ({ doc, assets }, p) => {
    textoMod = await import("../fonte.ts");
    return { fonte: await lerFonteDe(doc, assets, p.font) };
  },
  run({ e, run, prepared }, p) {
    const f = prepared.fonte;
    const estilo = p.style ?? "fala";
    const pad = p.padding ?? p.size * 0.5;
    const linhas = p.text.split("\n");
    const lh = (p.lineHeight ?? 1.15) * p.size;
    const s = p.size / f.unidades;
    const larg = Math.max(...linhas.map((l) => [...l].reduce((a, ch) => a + f.avanco(f.glifo(ch.codePointAt(0)!)) * s + (p.letterSpacing ?? 0), 0)));
    const alt = p.size * 1.0 + (linhas.length - 1) * lh;
    const sw = p.stroke?.width ?? (estilo === "legenda" ? 0 : Math.max(2, p.size * 0.09));
    // a caixa do corpo e a cauda, em pixels da imagem (y para baixo, origem no canto)
    const bw = larg + 2 * pad,
      bh = alt + 2 * pad;
    const cauda = p.tail ? [p.tail[0] - p.x, -(p.tail[1] - p.y)] : null; // relativa ao centro, y para baixo
    const m = sw + 4;
    const minX = Math.min(-bw / 2, cauda ? cauda[0] : 0) - m,
      maxX = Math.max(bw / 2, cauda ? cauda[0] : 0) + m,
      minY = Math.min(-bh / 2, cauda ? cauda[1] : 0) - m,
      maxY = Math.max(bh / 2, cauda ? cauda[1] : 0) + m;
    const W = Math.ceil(maxX - minX),
      H = Math.ceil(maxY - minY);
    const cx = -minX,
      cy = -minY; // o centro do corpo na imagem
    // o centro da imagem no osso: o centro do corpo deslocado
    const ox = (minX + maxX) / 2,
      oy = -(minY + maxY) / 2;
    run("bone.add", { name: p.name, parent: p.bone, x: p.x, y: p.y });
    run("draw.create", { image: p.name, width: W, height: H, slot: p.name, bone: p.name, x: ox, y: oy, hd: 3 });
    const fundo = p.fill ?? (estilo === "grito" ? "ffd84aff" : estilo === "legenda" ? "101418e6" : "ffffffff");
    const linha = { color: p.stroke?.color ?? "1d1b26ff", width: sw, align: "center" as const, join: "round" as const };
    const corpo: DrawPoint[] =
      estilo === "grito"
        ? Array.from({ length: 22 }, (_, i) => {
            const a = (i / 22) * Math.PI * 2,
              r = i % 2 ? 0.86 : 1.12;
            return { x: cx + Math.cos(a) * (bw / 2) * r, y: cy + Math.sin(a) * (bh / 2) * r };
          })
        : [
            { x: cx - bw / 2, y: cy - bh / 2, radius: Math.min(bh / 2, p.size * 0.6) },
            { x: cx + bw / 2, y: cy - bh / 2, radius: Math.min(bh / 2, p.size * 0.6) },
            { x: cx + bw / 2, y: cy + bh / 2, radius: Math.min(bh / 2, p.size * 0.6) },
            { x: cx - bw / 2, y: cy + bh / 2, radius: Math.min(bh / 2, p.size * 0.6) },
          ];
    // a cauda: um triangulo da borda do corpo ate a ponta, desenhado antes (o corpo cobre a base)
    if (cauda) {
      const tx = cx + cauda[0],
        ty = cy + cauda[1];
      const base = Math.min(bw * 0.18, p.size * 0.8);
      const bx = cx + Math.max(-bw / 2 + base, Math.min(bw / 2 - base, cauda[0] * 0.5));
      const byE = ty > cy ? cy + bh / 2 - sw : cy - bh / 2 + sw;
      run("draw.shape", { image: p.name, name: "cauda", points: [{ x: bx - base / 2, y: byE }, { x: tx, y: ty }, { x: bx + base / 2, y: byE }], closed: true, fill: fundo, ...(sw ? { stroke: linha } : {}) });
    }
    run("draw.shape", { image: p.name, name: "corpo", points: corpo, closed: true, fill: fundo, ...(sw ? { stroke: linha } : {}) });
    // a base da cauda sem o traco do corpo por cima: um remendo da cor do fundo
    if (cauda && sw) {
      const tx = cx + cauda[0];
      const base = Math.min(bw * 0.18, p.size * 0.8);
      const bx = cx + Math.max(-bw / 2 + base, Math.min(bw / 2 - base, (tx - cx) * 0.5));
      const ty = cy + cauda[1];
      const yb = ty > cy ? cy + bh / 2 : cy - bh / 2;
      const dir = ty > cy ? -1 : 1;
      run("draw.shape", { image: p.name, name: "emenda", points: [{ x: bx - base / 2 + sw * 0.6, y: yb + dir * sw * 1.2 }, { x: bx + base / 2 - sw * 0.6, y: yb + dir * sw * 1.2 }, { x: bx + base / 2 - sw * 0.9, y: yb - dir * sw * 0.9 }, { x: bx - base / 2 + sw * 0.9, y: yb - dir * sw * 0.9 }], closed: true, fill: fundo });
    }
    const corTexto = p.textColor ?? (estilo === "legenda" ? "f2f5f7ff" : "1d1b26ff");
    escreve(e, f, { image: p.name, name: "texto", x: cx + (p.align === "left" ? -larg / 2 : p.align === "right" ? larg / 2 : 0), y: cy - alt / 2 + p.size * 0.78, text: p.text, size: p.size, align: p.align ?? "center", letterSpacing: p.letterSpacing, lineHeight: p.lineHeight, fill: corTexto });
    // o pop: cresce passando do ponto e assenta; sai encolhendo
    if (p.anim && p.from !== undefined) {
      const a = p.anim,
        t0 = p.from;
      const k = (time: number, v: number) => run("key.set", { anim: a, target: { bone: p.name }, timeline: "scale", time: Math.round(time * 1000) / 1000, x: v, y: v });
      if (t0 > 0) k(0, 0);
      k(t0, 0);
      k(t0 + 0.12, 1.15);
      k(t0 + 0.22, 1);
      if (p.to !== undefined && p.to > t0 + 0.4) {
        k(p.to - 0.15, 1);
        k(p.to, 0);
      }
    }
    return { bone: p.name, slot: p.name, image: p.name, width: W, height: H };
  },
});

defineCommand({
  name: "draw.set",
  group: "drawing",
  summary:
    "Muda uma forma: rename, geometria do contorno principal (points/closed, svg, rect, ellipse, polygon; svg de varios subcaminhos troca tambem os furos), fill (null tira), stroke (os campos dados; null tira o traco), hidden, holes: null tira os furos. closed sozinho fecha ou abre o contorno.",
  params: z.object({
    image: Image,
    shape: ShapeRef,
    rename: z.string().min(1).optional().describe("nome novo"),
    ...Geometry,
    fill: Color.nullable().optional(),
    stroke: Stroke.nullable().optional(),
    hidden: z.boolean().optional(),
    holes: z.null().optional().describe("null tira todos os furos"),
    contour: z.number().int().min(0).default(0).describe("com points/closed/rect/ellipse/polygon: o contorno mudado (0 = principal, 1 em diante = furos)"),
  }),
  label: (p) => `muda ${p.shape} em ${p.image}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const i = shapeIndex(d, p.shape);
    const s: DrawShape = structuredClone(d.shapes[i]);
    if (p.rename && p.rename !== s.name) {
      if (d.shapes.some((x) => x.name === p.rename)) throw new Error(`ja existe a forma ${p.rename}`);
      s.name = p.rename;
    }
    const g = geometry({ ...p, closed: p.points ? p.closed : undefined });
    if (p.contour > 0) {
      // um furo: so a geometria e o fechar dele
      const ct = editable(s, p.contour);
      if (g) {
        if (g.length !== 1) throw new Error("um furo e um contorno so");
        ct.points = g[0].points;
        ct.closed = p.points ? (p.closed ?? ct.closed) : g[0].closed;
      } else if (p.closed !== undefined) ct.closed = p.closed;
    } else if (g) {
      // varios subcaminhos: o primeiro e a forma, os outros os furos dela
      s.points = g[0].points;
      if (p.svg !== undefined) {
        if (g.length > 1) s.holes = g.slice(1);
        else delete s.holes;
      }
      s.closed = p.points ? (p.closed ?? s.closed) : g[0].closed;
    } else if (p.closed !== undefined) s.closed = p.closed;
    if (p.fill === null) delete s.fill;
    else if (p.fill) s.fill = p.fill;
    if (p.stroke === null) delete s.stroke;
    else if (p.stroke) s.stroke = { color: "000000ff", width: 2, ...s.stroke, ...Object.fromEntries(Object.entries(p.stroke).filter(([, v]) => v !== undefined)) } as any;
    if (p.hidden !== undefined) s.hidden = p.hidden;
    if (p.holes === null) delete s.holes;
    setShape(e, p.image, i, s);
    return { index: i, name: s.name, svg: svgPath(s) };
  },
});

defineCommand({
  name: "draw.point",
  group: "drawing",
  summary:
    "Mexe num ponto de uma forma (contour: 0 = contorno principal, 1 em diante = os furos): x/y (as alcas vao junto), in/out (alcas relativas; null tira, e o ponto vira canto), radius (null tira). insert: true poe um ponto novo antes de index (index = numero de pontos acrescenta no fim). remove: true apaga o ponto. smooth: true cria alcas alinhadas pelos vizinhos (curva suave); false tira as alcas.",
  params: z.object({
    image: Image,
    shape: ShapeRef,
    contour: z.number().int().min(0).default(0),
    index: z.number().int().min(0),
    x: z.number().optional(),
    y: z.number().optional(),
    in: Vec.nullable().optional(),
    out: Vec.nullable().optional(),
    radius: z.number().min(0).nullable().optional(),
    press: z.number().min(0).max(4).nullable().optional().describe("largura do traco neste ponto, em fracao (o lapis); null tira"),
    insert: z.boolean().optional(),
    remove: z.boolean().optional(),
    smooth: z.boolean().optional(),
  }),
  label: (p) => `${p.insert ? "ponto novo" : p.remove ? "apaga ponto" : "ponto"} ${p.index} de ${p.shape}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const i = shapeIndex(d, p.shape);
    const s: DrawShape = structuredClone(d.shapes[i]);
    const ct = editable(s, p.contour);
    const n = ct.points.length;
    if (p.insert) {
      if (p.index > n) throw new Error(`index ${p.index}: o contorno tem ${n} pontos`);
      if (p.x === undefined || p.y === undefined) throw new Error("ponto novo precisa de x e y");
      ct.points.splice(p.index, 0, cleanPoint({ x: p.x, y: p.y, in: p.in, out: p.out, radius: p.radius, press: p.press }));
    } else {
      if (p.index >= n) throw new Error(`index ${p.index}: o contorno tem ${n} pontos (0 a ${n - 1})`);
      if (p.remove) {
        ct.points.splice(p.index, 1);
        if (ct.points.length < 3) delete ct.closed;
        // furo sem area some
        if (p.contour > 0 && ct.points.length < 2) s.holes!.splice(p.contour - 1, 1);
      } else {
        const q: any = ct.points[p.index];
        if (p.x !== undefined) q.x = p.x;
        if (p.y !== undefined) q.y = p.y;
        if (p.in === null) delete q.in;
        else if (p.in) q.in = p.in;
        if (p.out === null) delete q.out;
        else if (p.out) q.out = p.out;
        if (p.radius === null) delete q.radius;
        else if (p.radius !== undefined) q.radius = p.radius;
        if (p.press === null) delete q.press;
        else if (p.press !== undefined) q.press = p.press;
        if (p.smooth === false) {
          delete q.in;
          delete q.out;
        } else if (p.smooth) {
          // tangente pela direcao entre os vizinhos, alcas de um terco da distancia
          const prev = ct.points[(p.index - 1 + n) % n],
            next = ct.points[(p.index + 1) % n];
          const open = !ct.closed;
          const a = open && p.index === 0 ? q : prev,
            b = open && p.index === n - 1 ? q : next;
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const l = Math.hypot(dx, dy) || 1;
          const li = Math.hypot(q.x - a.x, q.y - a.y) / 3 || l / 6,
            lo = Math.hypot(b.x - q.x, b.y - q.y) / 3 || l / 6;
          q.in = [(-dx / l) * li, (-dy / l) * li];
          q.out = [(dx / l) * lo, (dy / l) * lo];
          delete q.radius;
        }
      }
    }
    setShape(e, p.image, i, s);
    const novo = requireDrawing(e.json, p.image).shapes[i];
    return { points: p.contour === 0 ? novo.points.length : (novo.holes?.[p.contour - 1]?.points.length ?? 0) };
  },
});

defineCommand({
  name: "draw.split",
  group: "drawing",
  summary: "Poe um ponto no meio de um lado, sem mudar o desenho (o lado seg vai do ponto seg ao seguinte; t de 0 a 1 ao longo dele, padrao 0.5; contour: 0 = principal, 1 em diante = furos). Devolve o indice do ponto novo.",
  params: z.object({ image: Image, shape: ShapeRef, contour: z.number().int().min(0).default(0), seg: z.number().int().min(0), t: z.number().min(0.001).max(0.999).default(0.5) }),
  label: (p) => `ponto no lado ${p.seg} de ${p.shape}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const i = shapeIndex(d, p.shape);
    const s = structuredClone(d.shapes[i]);
    const ct = editable(s, p.contour);
    const segs = ct.closed ? ct.points.length : ct.points.length - 1;
    if (p.seg >= segs) throw new Error(`lado ${p.seg}: o contorno tem ${segs} lados`);
    const r = splitSegment(ct, p.seg, p.t);
    ct.points = r.points;
    setShape(e, p.image, i, s);
    return { index: r.index };
  },
});

defineCommand({
  name: "draw.move",
  group: "drawing",
  summary: "Desloca formas inteiras, com os furos (dx, dy em pixels da imagem). shapes: nomes ou indices (padrao: todas). Com points (indices), move so esses pontos de uma forma so, no contorno contour (0 = principal, 1 em diante = furos).",
  params: z.object({ image: Image, shapes: z.array(ShapeRef).optional(), points: z.array(z.number().int().min(0)).optional(), contour: z.number().int().min(0).default(0), dx: z.number(), dy: z.number() }),
  label: (p) => `move formas de ${p.image}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const idx = p.shapes ? p.shapes.map((s) => shapeIndex(d, s)) : d.shapes.map((_, i) => i);
    if (p.points && idx.length !== 1) throw new Error("points: diga uma forma so em shapes");
    for (const i of idx) {
      const s = structuredClone(d.shapes[i]);
      const pts = p.points ? editable(s, p.contour).points.filter((_, k) => p.points!.includes(k)) : allPoints(s);
      for (const q of pts) {
        q.x += p.dx;
        q.y += p.dy;
      }
      setShape(e, p.image, i, s);
    }
    return { moved: idx.length };
  },
});

defineCommand({
  name: "draw.transform",
  group: "drawing",
  summary: "Gira e/ou escala formas em volta de um ponto (padrao: o centro da caixa delas). rotation em graus (sentido horario na imagem), scale [sx, sy]. Alcas e raios acompanham.",
  params: z.object({ image: Image, shapes: z.array(ShapeRef).optional(), rotation: z.number().default(0), scale: Vec.default([1, 1]), about: Vec.optional() }),
  label: (p) => `transforma formas de ${p.image}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const idx = p.shapes ? p.shapes.map((s) => shapeIndex(d, s)) : d.shapes.map((_, i) => i);
    let about = p.about;
    if (!about) {
      const bs = idx.map((i) => shapeBounds(d.shapes[i])).filter((b): b is [number, number, number, number] => !!b);
      if (!bs.length) return { moved: 0 };
      about = [(Math.min(...bs.map((b) => b[0])) + Math.max(...bs.map((b) => b[2]))) / 2, (Math.min(...bs.map((b) => b[1])) + Math.max(...bs.map((b) => b[3]))) / 2];
    }
    const r = (p.rotation * Math.PI) / 180;
    const [sx, sy] = p.scale;
    const lin = (vx: number, vy: number): [number, number] => {
      const x = vx * sx,
        y = vy * sy;
      return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
    };
    const k = Math.sqrt(Math.abs(sx * sy));
    for (const i of idx) {
      const s = structuredClone(d.shapes[i]);
      for (const q of allPoints(s)) {
        const [x, y] = lin(q.x - about[0], q.y - about[1]);
        q.x = about[0] + x;
        q.y = about[1] + y;
        if (q.in) q.in = lin(q.in[0], q.in[1]);
        if (q.out) q.out = lin(q.out[0], q.out[1]);
        if (q.radius) q.radius *= k;
      }
      setShape(e, p.image, i, s);
    }
    return { moved: idx.length, about };
  },
});

defineCommand({
  name: "draw.hole",
  group: "drawing",
  summary:
    "Acrescenta um furo a uma forma: um contorno que tira do preenchimento (par-impar, como fill-rule evenodd). Geometria como em draw.shape (points + closed, svg, rect + cornerRadius, ellipse, polygon). Devolve o contour do furo (1 = o primeiro).",
  params: z.object({ image: Image, shape: ShapeRef, ...Geometry }),
  label: (p) => `furo em ${p.shape}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const i = shapeIndex(d, p.shape);
    const geo = geometry(p) ?? [{ points: [], closed: false }];
    const s = structuredClone(d.shapes[i]);
    s.holes = [...(s.holes ?? []), ...geo.map((g) => ({ points: g.points, closed: g.closed }))];
    setShape(e, p.image, i, s);
    return { contour: s.holes.length - geo.length + 1, holes: s.holes.length };
  },
});

defineCommand({
  name: "draw.cut",
  group: "drawing",
  summary: "Fura uma forma com outra: o contorno de shape (e os furos dele) vira furo de into, e shape some. Para furar com qualquer desenho feito pela caneta, retangulo ou elipse.",
  params: z.object({ image: Image, shape: ShapeRef.describe("a forma que vira furo"), into: ShapeRef.describe("a forma furada") }),
  label: (p) => `${p.shape} fura ${p.into}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const a = shapeIndex(d, p.shape),
      b = shapeIndex(d, p.into);
    if (a === b) throw new Error("uma forma nao fura ela mesma");
    const cutter = d.shapes[a];
    if (cutter.points.length < 3) throw new Error(`${cutter.name} tem menos de 3 pontos: nao fecha um furo`);
    const s = structuredClone(d.shapes[b]);
    s.holes = [...(s.holes ?? []), { points: structuredClone(cutter.points), closed: true }, ...structuredClone(cutter.holes ?? [])];
    setShape(e, p.image, b, s);
    e.remove([...path(p.image), "shapes"], a);
    return { into: s.name, index: a < b ? b - 1 : b, holes: s.holes.length };
  },
});

defineCommand({
  name: "draw.replace",
  group: "drawing",
  summary:
    "Troca uma imagem do atlas por uma desenhada em todas as partes que a usam (region e malha, em todas as skins): elas passam a apontar (path) para o desenho, no mesmo lugar. Desenho de outro tamanho: as partes sao ajustadas como em attachment.refit (o desenho cobre o mesmo retangulo, esticado).",
  params: z.object({ image: z.string().describe("imagem do atlas que sai"), drawing: Image.describe("desenho que entra") }),
  label: (p) => `${p.drawing} no lugar de ${p.image}`,
  run({ e, assets }, p) {
    const d = requireDrawing(e.json, p.drawing);
    const uses = usesOfImage(e.json, p.image);
    if (!uses.length) throw new Error(`nenhuma parte usa a imagem ${p.image}`);
    const out: string[] = [];
    for (const u of uses) {
      const si = skins(e.json).findIndex((s) => s.name === u.skin);
      const at = ["skins", si, "attachments", u.slot, u.name];
      if ((u.a.type ?? "region") === "linkedmesh") continue;
      e.set([...at, "path"], p.drawing === u.name ? undefined : p.drawing);
      out.push(`${u.slot}/${u.name}`);
    }
    // regions com o tamanho da imagem velha: passam a ter o do desenho, na mesma escala da tela
    const r = assets?.region(p.image);
    const warn = r && (Math.abs(r.width - d.width) > 1e-6 || Math.abs(r.height - d.height) > 1e-6) ? `o desenho tem ${d.width}x${d.height} e a imagem ${r.width}x${r.height}: as partes mostram o desenho esticado no lugar da imagem` : null;
    return { replaced: out, ...(warn ? { warning: warn } : {}) };
  },
});

defineCommand({
  name: "draw.trace",
  group: "drawing",
  summary:
    "Vetoriza uma imagem do atlas (cores chapadas): cada cor vira uma camada de formas com curvas, da maior area para a menor, com furos onde houver; o resultado e um desenho novo (drawing, padrao <image>_v) do tamanho da imagem. colors (rrggbb, de baixo para cima) escolhe as camadas; sem elas, as cores dominantes. tolerance = erro maximo da curva em pixels (padrao 0.6; maior = menos pontos). replace: true ja poe o desenho no lugar da imagem em todas as partes (draw.replace). Sombras e degrades suaves nao entram (so cor solida).",
  params: z.object({
    image: z.string().describe("imagem do atlas"),
    drawing: z.string().optional().describe("nome do desenho novo (padrao <image>_v)"),
    colors: z.array(z.string()).optional(),
    tolerance: z.number().min(0.1).max(5).default(0.6),
    corner: z.number().min(10).max(170).default(55).describe("graus: virada a partir da qual o contorno faz canto"),
    hd: z.number().min(0.05).max(8).default(3),
    replace: z.boolean().default(false),
  }),
  label: (p) => `vetoriza ${p.image}`,
  async prepare({ assets }, p) {
    const img = await assets?.image(p.image);
    if (!img) throw new Error(`sem os pixels da imagem ${p.image} (ela existe no atlas?)`);
    const { traceImage } = await import("../vetoriza.ts");
    return { width: img.width, height: img.height, ...traceImage(img, { colors: p.colors, tolerance: p.tolerance, corner: p.corner }) };
  },
  run({ e, run, prepared }, p) {
    if (drawingsOf(e.json)[p.image]) throw new Error(`${p.image} ja e um desenho`);
    const t = prepared as { width: number; height: number; colors: string[]; shapes: { color: string; points: DrawPoint[]; holes: DrawPoint[][] }[] };
    const nome = p.drawing ?? `${p.image}_v`;
    run("draw.create", { image: nome, width: t.width, height: t.height, hd: p.hd });
    let pontos = 0;
    const porCor = new Map<string, number>();
    for (const s of t.shapes) {
      const n = (porCor.get(s.color) ?? 0) + 1;
      porCor.set(s.color, n);
      const c = t.colors.indexOf(s.color);
      const ehUnica = t.shapes.filter((x) => x.color === s.color).length === 1;
      const r = run("draw.shape", { image: nome, name: `cor${c + 1}${ehUnica ? "" : `_${n}`}`, points: s.points, closed: true, fill: s.color + "ff" });
      for (const h of s.holes) run("draw.hole", { image: nome, shape: r.added[0].index, points: h, closed: true });
      pontos += s.points.length + s.holes.reduce((m, h) => m + h.length, 0);
    }
    const replaced = p.replace ? run("draw.replace", { image: p.image, drawing: nome }).replaced : [];
    return { drawing: nome, colors: t.colors, shapes: t.shapes.length, points: pontos, replaced };
  },
});

// quanto o traco de uma forma passa do contorno (pixels da imagem)
const strokeOut = (s: DrawShape) => (s.stroke ? (s.stroke.align === "inside" && s.closed ? 0 : s.stroke.align === "outside" && s.closed ? s.stroke.width : s.stroke.width / 2) * (s.stroke.join === "miter" || !s.stroke.join ? 1.5 : 1) : 0);

const strokeMax = (d: Drawing) => Math.max(0, ...d.shapes.filter((s) => !s.hidden).map(strokeOut));

// a caixa das formas visiveis com o traco, ou null sem formas
function drawnBox(d: Drawing): [number, number, number, number] | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const s of d.shapes) {
    if (s.hidden) continue;
    const b = shapeBounds(s);
    if (!b) continue;
    const m = strokeOut(s);
    (x0 = Math.min(x0, b[0] - m)), (y0 = Math.min(y0, b[1] - m)), (x1 = Math.max(x1, b[2] + m)), (y1 = Math.max(y1, b[3] + m));
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}

// pontos do desenho que a malha precisa cobrir (o contorno de fora das formas visiveis) e a folga
// de cada um (o traco para fora)
function silhouette(d: Drawing): { p: Pt; m: number }[] {
  const out: { p: Pt; m: number }[] = [];
  for (const s of d.shapes) if (!s.hidden && s.points.length) for (const p of flatten(s, 2)) out.push({ p, m: strokeOut(s) });
  return out;
}

function nearestOnPolygon(p: Pt, poly: Pt[]): { at: Pt; d: number; k: number; t: number } {
  let best = { at: poly[0], d: Infinity, k: 0, t: 0 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    const at: Pt = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d < best.d) best = { at, d, k: i, t };
  }
  return best;
}

// do pixel da imagem para o mundo pela malha (triangulo que contem o ponto, ou o mais perto, estendido)
function imageToMeshWorld(uvPx: Pt[], world: Pt[], tris: number[], q: Pt): Pt {
  let best = -1,
    bo = Infinity,
    bl = [0, 0, 0];
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [uvPx[tris[t]], uvPx[tris[t + 1]], uvPx[tris[t + 2]]];
    const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((b[1] - c[1]) * (q[0] - c[0]) + (c[0] - b[0]) * (q[1] - c[1])) / det;
    const l2 = ((c[1] - a[1]) * (q[0] - c[0]) + (a[0] - c[0]) * (q[1] - c[1])) / det;
    const l3 = 1 - l1 - l2;
    const o = -Math.min(l1, l2, l3);
    if (o < bo) (bo = o), (best = t), (bl = [l1, l2, l3]);
  }
  const [a, b, c] = [world[tris[best]], world[tris[best + 1]], world[tris[best + 2]]];
  return [bl[0] * a[0] + bl[1] * b[0] + bl[2] * c[0], bl[0] * a[1] + bl[1] * b[1] + bl[2] * c[1]];
}

// o que falta para a peca mostrar o desenho inteiro: a imagem crescer e/ou a malha estender
// a caixa das formas visiveis com o traco (pixels da imagem), ou null
export const caixaDasFormas = (d: Drawing) => drawnBox(d);

export function coverNeeded(json: any, image: string): { grow: boolean; meshes: string[] } {
  const d = drawingsOf(json)[image];
  if (!d) return { grow: false, meshes: [] };
  const b = drawnBox(d);
  const grow = !!b && (b[0] < -0.5 || b[1] < -0.5 || b[2] > d.width + 0.5 || b[3] > d.height + 0.5);
  const meshes: string[] = [];
  const sil = silhouette(d);
  for (const u of usesOfImage(json, image)) {
    if ((u.a.type ?? "region") !== "mesh") continue;
    const h = u.a.hull ?? 0;
    const uv: number[] = u.a.uvs;
    const hull: Pt[] = [];
    for (let i = 0; i < h; i++) hull.push([uv[2 * i] * d.width, uv[2 * i + 1] * d.height]);
    // o mesmo criterio do draw.cover: falta mais de meio pixel (fora, ou dentro com o traco passando)
    const falta = ({ p, m }: { p: Pt; m: number }) => {
      const d = nearestOnPolygon(p, hull).d;
      return (pointInPolygon(p[0], p[1], hull) ? m - d : d + m) > 0.5;
    };
    if (hull.length >= 3 && sil.some(falta)) meshes.push(`${u.skin}/${u.slot}/${u.name}`);
  }
  return { grow, meshes };
}

defineCommand({
  name: "paint.set",
  group: "drawing",
  summary:
    "Pintura (raster): registra o estado dos pixels de uma imagem desenhada. Os pixels ficam fora do documento (um PNG na pasta <personagem>-pinturas, ao lado; no editor, na memoria): aqui so entra `rev`, o nome do estado, para cada pincelada ser um passo de desfazer. rev null tira a pintura. O editor chama ao fim de cada pincelada do Atelie; por fora, grave o PNG (do tamanho da imagem) e chame com um rev novo.",
  params: z.object({ image: Image, rev: z.string().min(1).max(40).nullable().describe("nome do estado dos pixels; null tira a pintura") }),
  label: (p) => (p.rev ? `pintura em ${p.image}` : `${p.image} sem pintura`),
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const antes = d.raster?.rev ?? null;
    if (p.rev) e.set(["drawings", p.image, "raster"], { rev: p.rev });
    else if (d.raster) e.set(["drawings", p.image, "raster"], undefined);
    return { image: p.image, rev: p.rev, before: antes };
  },
});

defineCommand({
  name: "paint.grow",
  group: "drawing",
  summary:
    "Pintura (raster): a imagem cresce left/top/right/bottom pixels para cada lado (as formas e os pixels andam junto e as partes ficam no mesmo lugar da tela) e passa ao estado `rev` dos pixels, ja do tamanho novo. O editor chama quando a pincelada ou o laco passam da borda; por fora, grave antes o PNG do tamanho novo.",
  params: z.object({ image: Image, left: z.number().int().min(0).default(0), top: z.number().int().min(0).default(0), right: z.number().int().min(0).default(0), bottom: z.number().int().min(0).default(0), rev: z.string().min(1).max(40) }),
  label: (p) => `${p.image} cresce`,
  run({ e, run }, p) {
    const d = requireDrawing(e.json, p.image);
    const antes = d.raster?.rev ?? null;
    resize(e, run, p.image, d.width + p.left + p.right, d.height + p.top + p.bottom, p.left, p.top);
    e.set(["drawings", p.image, "raster"], { rev: p.rev });
    const n = requireDrawing(e.json, p.image);
    return { image: p.image, width: n.width, height: n.height, rev: p.rev, before: antes };
  },
});

defineCommand({
  name: "draw.cover",
  group: "drawing",
  summary:
    "Faz as partes mostrarem o desenho inteiro depois de ele crescer: a imagem aumenta ate caber as formas (as partes ficam no mesmo lugar) e, nas malhas, o contorno se estende ate cobrir o desenho (pontos novos no contorno, com pesos e deforms dos vizinhos). Nada a fazer: nao muda nada. O editor chama sozinho ao fim de cada gesto no Desenhar.",
  params: z.object({ image: Image, margin: z.number().min(0).default(3) }),
  label: (p) => `${p.image} cobre o desenho`,
  run({ e, run }, p) {
    const d0 = requireDrawing(e.json, p.image);
    let grown: number[] | null = null;
    const b = drawnBox(d0);
    // com pintura a imagem nao cresce (os pixels tem o tamanho dela): a forma de fora fica cortada
    if (!d0.raster && b && (b[0] < -0.5 || b[1] < -0.5 || b[2] > d0.width + 0.5 || b[3] > d0.height + 0.5)) {
      const x0 = Math.floor(Math.min(0, b[0] - p.margin)),
        y0 = Math.floor(Math.min(0, b[1] - p.margin)),
        x1 = Math.ceil(Math.max(d0.width, b[2] + p.margin)),
        y1 = Math.ceil(Math.max(d0.height, b[3] + p.margin));
      resize(e, run, p.image, x1 - x0, y1 - y0, -x0, -y0);
      grown = [x1 - x0, y1 - y0, -x0, -y0];
    }
    const added: Record<string, number> = {};
    const stopped: Record<string, string> = {};
    for (const u of usesOfImage(e.json, p.image)) {
      if ((u.a.type ?? "region") !== "mesh") continue;
      const key = `${u.slot}/${u.name}`;
      added[key] = 0;
      for (let it = 0; it < 40; it++) {
        const d = requireDrawing(e.json, p.image);
        const a = skins(e.json).find((s) => s.name === u.skin)!.attachments[u.slot][u.name];
        const mv = meshView(e.json, u.skin, u.slot, u.name);
        const uvPx: Pt[] = mv.world.map((_, i) => [a.uvs[2 * i] * d.width, a.uvs[2 * i + 1] * d.height]);
        const hull = uvPx.slice(0, mv.hull);
        // o ponto do desenho mais fora da malha
        let pior: { p: Pt; falta: number; n: ReturnType<typeof nearestOnPolygon>; fora: boolean } | null = null;
        for (const { p: q, m } of silhouette(d)) {
          const fora = !pointInPolygon(q[0], q[1], hull);
          const n = nearestOnPolygon(q, hull);
          const falta = fora ? n.d + m : m - n.d;
          if (falta > 0.5 && (!pior || falta > pior.falta)) pior = { p: q, falta, n, fora };
        }
        if (!pior) break;
        // alvo: o ponto do desenho mais a folga, para fora do lado da malha; dentro da imagem
        const { n } = pior;
        const ha = hull[n.k],
          hb = hull[(n.k + 1) % hull.length];
        let nx = -(hb[1] - ha[1]),
          ny = hb[0] - ha[0];
        const nl = Math.hypot(nx, ny) || 1;
        (nx /= nl), (ny /= nl);
        // a normal do lado aponta para fora do contorno (o lado de fora nao esta no poligono)
        const meio: Pt = [(ha[0] + hb[0]) / 2, (ha[1] + hb[1]) / 2];
        if (pointInPolygon(meio[0] + nx * 0.5, meio[1] + ny * 0.5, hull)) (nx = -nx), (ny = -ny);
        const ext = pior.fora ? n.d + p.margin + strokeMax(d) : p.margin + strokeMax(d);
        const alvo: Pt = [Math.max(0, Math.min(d.width, n.at[0] + nx * ext)), Math.max(0, Math.min(d.height, n.at[1] + ny * ext))];
        const lado = Math.hypot(hb[0] - ha[0], hb[1] - ha[1]);
        // perto de um ponto da malha: empurra o ponto; senao um ponto novo neste lado, empurrado
        let vi: number;
        if (n.t * lado < Math.max(6, lado * 0.2)) vi = n.k;
        else if ((1 - n.t) * lado < Math.max(6, lado * 0.2)) vi = (n.k + 1) % hull.length;
        else {
          try {
            vi = run("mesh.addVertex", { slot: u.slot, attachment: u.name, skin: u.skin, at: imageToMeshWorld(uvPx, mv.world, mv.triangles, n.at), where: "hull", tolerance: 1e9 }).i;
          } catch (err: any) {
            stopped[key] = String(err?.message ?? err);
            break;
          }
        }
        const mv2 = meshView(e.json, u.skin, u.slot, u.name);
        const a2 = skins(e.json).find((s) => s.name === u.skin)!.attachments[u.slot][u.name];
        const uv2: Pt[] = mv2.world.map((_, i) => [a2.uvs[2 * i] * d.width, a2.uvs[2 * i + 1] * d.height]);
        const w = imageToMeshWorld(uv2, mv2.world, mv2.triangles, alvo);
        try {
          run("mesh.vertices", { slot: u.slot, attachment: u.name, skin: u.skin, moves: [{ i: vi, x: w[0], y: w[1] }], stretch: false });
        } catch (err: any) {
          stopped[key] = String(err?.message ?? err);
          break;
        }
        added[key]++;
      }
    }
    return { grown, added, ...(Object.keys(stopped).length ? { stopped } : {}) };
  },
});

defineCommand({
  name: "draw.order",
  group: "drawing",
  summary: "Muda a forma de lugar na pilha do desenho (index 0 = mais atras).",
  params: z.object({ image: Image, shape: ShapeRef, index: z.number().int().min(0) }),
  label: (p) => `ordem de ${p.shape} em ${p.image}`,
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    const i = shapeIndex(d, p.shape);
    const to = Math.min(p.index, d.shapes.length - 1);
    if (to === i) return { index: i };
    const s = structuredClone(d.shapes[i]);
    e.remove([...path(p.image), "shapes"], i);
    e.insert([...path(p.image), "shapes"], to, s);
    return { index: to };
  },
});

defineCommand({
  name: "draw.remove",
  group: "drawing",
  summary: "Apaga uma forma do desenho (com contour >= 1, so aquele furo dela); sem shape, apaga o desenho inteiro (recusa se alguma parte ainda usa a imagem).",
  params: z.object({ image: Image, shape: ShapeRef.optional(), contour: z.number().int().min(1).optional() }),
  label: (p) => (p.shape !== undefined ? `apaga ${p.shape} de ${p.image}` : `apaga o desenho ${p.image}`),
  run({ e }, p) {
    const d = requireDrawing(e.json, p.image);
    if (p.shape !== undefined && p.contour !== undefined) {
      const i = shapeIndex(d, p.shape);
      const s = structuredClone(d.shapes[i]);
      editable(s, p.contour);
      s.holes!.splice(p.contour - 1, 1);
      setShape(e, p.image, i, s);
      return { removed: `furo ${p.contour} de ${s.name}` };
    }
    if (p.shape !== undefined) {
      const i = shapeIndex(d, p.shape);
      const name = d.shapes[i].name;
      e.remove([...path(p.image), "shapes"], i);
      return { removed: name };
    }
    const uses = usesOfImage(e.json, p.image);
    if (uses.length) throw new Error(`a imagem ${p.image} ainda e usada por ${uses.map((u) => `${u.slot}/${u.name}`).join(", ")}: tire essas partes antes`);
    e.set(path(p.image), undefined);
    if (!Object.keys(e.json.drawings ?? {}).length) e.set(["drawings"], undefined);
    return { removed: p.image };
  },
});

// muda o tamanho da imagem; offset desloca as formas (o que estava no pixel (u, v) vai para
// (u + ox, v + oy)); as partes que usam a imagem ficam no mesmo lugar da tela
function resize(e: Editor, run: (n: string, a: unknown) => any, image: string, w: number, h: number, ox: number, oy: number) {
  const d = requireDrawing(e.json, image);
  const W = d.width,
    H = d.height;
  if (ox || oy)
    d.shapes.forEach((s, i) => {
      const c = structuredClone(s);
      for (const q of allPoints(c)) (q.x += ox), (q.y += oy);
      setShape(e, image, i, c);
    });
  e.set([...path(image), "width"], round(w));
  e.set([...path(image), "height"], round(h));
  if (usesOfImage(e.json, image).length) run("attachment.refit", { image, from: [0, 0, W, H], to: [-ox, -oy, w, h] });
}

defineCommand({
  name: "draw.resize",
  group: "drawing",
  summary: "Muda o tamanho da imagem desenhada (width, height, hd). offset [ox, oy] desloca as formas dentro dela. As partes que usam a imagem ficam no mesmo lugar e escala na tela.",
  params: z.object({ image: Image, width: z.number().positive().optional(), height: z.number().positive().optional(), offset: Vec.default([0, 0]), hd: z.number().min(0.05).max(8).optional() }),
  label: (p) => `tamanho de ${p.image}`,
  run({ e, run }, p) {
    const d = requireDrawing(e.json, p.image);
    resize(e, run, p.image, p.width ?? d.width, p.height ?? d.height, p.offset[0], p.offset[1]);
    if (p.hd !== undefined) e.set([...path(p.image), "hd"], p.hd === 2 ? undefined : p.hd);
    const n = requireDrawing(e.json, p.image);
    return { width: n.width, height: n.height, hd: n.hd ?? 2 };
  },
});

defineCommand({
  name: "draw.fit",
  group: "drawing",
  summary: "Ajusta a imagem ao desenho: corta (ou cresce) ate a caixa das formas visiveis, com o traco e margin pixels de folga (padrao 2). As partes ficam no mesmo lugar da tela.",
  params: z.object({ image: Image, margin: z.number().min(0).default(2) }),
  label: (p) => `ajusta ${p.image} ao desenho`,
  run({ e, run }, p) {
    const d = requireDrawing(e.json, p.image);
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const s of d.shapes) {
      if (s.hidden) continue;
      const b = shapeBounds(s);
      if (!b) continue;
      const sw = s.stroke ? (s.stroke.align === "inside" ? 0 : s.stroke.align === "outside" ? s.stroke.width : s.stroke.width / 2) * (s.stroke.join === "miter" || !s.stroke.join ? 2 : 1) : 0;
      (x0 = Math.min(x0, b[0] - sw)), (y0 = Math.min(y0, b[1] - sw)), (x1 = Math.max(x1, b[2] + sw)), (y1 = Math.max(y1, b[3] + sw));
    }
    if (!isFinite(x0)) throw new Error(`o desenho ${p.image} nao tem formas visiveis`);
    x0 = Math.floor(x0 - p.margin);
    y0 = Math.floor(y0 - p.margin);
    x1 = Math.ceil(x1 + p.margin);
    y1 = Math.ceil(y1 + p.margin);
    resize(e, run, p.image, x1 - x0, y1 - y0, -x0, -y0);
    return { width: x1 - x0, height: y1 - y0, offset: [-x0, -y0] };
  },
});

defineCommand({
  name: "draw.get",
  group: "drawing",
  readonly: true,
  summary: "Le os desenhos: sem image, a lista (tamanho, formas, partes que usam). Com image, cada forma com pontos, estilo, caixa e o caminho SVG equivalente.",
  params: z.object({ image: z.string().optional() }),
  run({ doc }, p) {
    const all = drawingsOf(doc.json);
    const uses = (im: string) => usesOfImage(doc.json, im).map((u) => (u.skin === "default" ? `${u.slot}/${u.name}` : `${u.skin}/${u.slot}/${u.name}`));
    if (!p.image) return Object.entries(all).map(([image, d]) => ({ image, width: d.width, height: d.height, hd: d.hd ?? 2, shapes: d.shapes.map((s) => s.name), usedBy: uses(image) }));
    const d = requireDrawing(doc.json, p.image);
    return {
      image: p.image,
      width: d.width,
      height: d.height,
      hd: d.hd ?? 2,
      usedBy: uses(p.image),
      shapes: d.shapes.map((s, index) => ({ index, ...s, bounds: shapeBounds(s), svg: svgPath(s) })),
    };
  },
});

// usado pelo editor para achar o desenho de uma parte
export function drawingOfSlot(json: any, slot: string, attachment?: string | null): { image: string; skin: string; attachment: string } | null {
  const s = (json.slots ?? []).find((x: any) => x.name === slot);
  const att = attachment ?? s?.attachment;
  if (!att) return null;
  for (const sk of skins(json)) {
    const a = sk.attachments?.[slot]?.[att];
    if (!a) continue;
    const t = a.type ?? "region";
    if (t !== "region" && t !== "mesh") continue;
    const image = a.path ?? att;
    if (drawingsOf(json)[image]) return { image, skin: sk.name, attachment: att };
  }
  return null;
}
