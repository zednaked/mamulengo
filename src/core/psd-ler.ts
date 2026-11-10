// Leitura de PSD (Node e navegador): le o arquivo com o ag-psd, aplica as tags do script oficial
// PhotoshopToSpine e devolve o plano (src/core/psd.ts) e os pixels de cada imagem, sem gravar
// nada. Quem grava e empacota e src/core/psd-importar.ts.
//
// O que e "assado" na imagem (como o script oficial, que salva cada camada pelo Photoshop):
// opacidade da camada e das pastas, mascara de camada, camadas presas (clipping) e [overlay].
// Efeitos de camada e camadas de ajuste nao entram (avisa).
import { initializeCanvas, readPsd, type Layer, type Psd } from "ag-psd";
import { parseTags, type PsdBone, type PsdPiece, type PsdPlan, type Rect, type Tag } from "./psd.ts";

// sem canvas (no Node e no service worker): o ag-psd so precisa criar ImageData (useImageData: true)
let canvasReady = false;
export function initCanvas() {
  if (canvasReady) return;
  initializeCanvas(
    (() => {
      throw new Error("canvas indisponivel no servidor");
    }) as any,
    ((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })) as any,
  );
  canvasReady = true;
}

// limites para arquivo vindo de fora (o ag-psd decodifica tudo em memoria)
const MAX_SIDE = 16384;
const MAX_LAYERS = 2000;

// ---- pixels: RGBA sem premultiplicar, num retangulo do PSD

export interface Raster {
  x: number;
  y: number;
  w: number;
  h: number;
  d: Uint8ClampedArray;
}

const newRaster = (x: number, y: number, w: number, h: number): Raster => ({ x, y, w, h, d: new Uint8ClampedArray(Math.max(0, w * h * 4)) });

function layerRaster(l: Layer): Raster | null {
  const img = l.imageData;
  const x = l.left ?? 0,
    y = l.top ?? 0;
  if (!img || !img.width || !img.height) return null;
  return { x, y, w: img.width, h: img.height, d: new Uint8ClampedArray(img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.width * img.height * 4)) };
}

function mulAlpha(r: Raster, k: number) {
  if (k >= 1) return;
  for (let i = 3; i < r.d.length; i += 4) r.d[i] = Math.round(r.d[i] * k);
}

// mascara de camada (cinza: 255 mostra, 0 esconde; fora dela vale defaultColor)
function applyMask(r: Raster, l: Layer) {
  const m = l.mask;
  if (!m || m.disabled || !m.imageData) return false;
  const mx = m.left ?? 0,
    my = m.top ?? 0,
    mw = m.imageData.width,
    mh = m.imageData.height;
  const def = m.defaultColor ?? 0;
  const md = m.imageData.data;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const px = r.x + x - mx,
        py = r.y + y - my;
      const v = px >= 0 && py >= 0 && px < mw && py < mh ? md[(py * mw + px) * 4] : def;
      if (v < 255) {
        const i = (y * r.w + x) * 4 + 3;
        r.d[i] = Math.round((r.d[i] * v) / 255);
      }
    }
  return true;
}

// src sobre dst (normal). clip: alpha de src vezes o alpha de dst (camada presa), e o
// resultado so cobre dst (o que esta fora de dst nao entra)
function over(dst: Raster, src: Raster, clip = false) {
  const x0 = Math.max(dst.x, src.x),
    y0 = Math.max(dst.y, src.y),
    x1 = Math.min(dst.x + dst.w, src.x + src.w),
    y1 = Math.min(dst.y + dst.h, src.y + src.h);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const s = ((y - src.y) * src.w + (x - src.x)) * 4,
        d = ((y - dst.y) * dst.w + (x - dst.x)) * 4;
      const ad = dst.d[d + 3] / 255;
      let as = src.d[s + 3] / 255;
      if (clip) as *= ad;
      if (as <= 0) continue;
      const a = as + ad * (1 - as);
      for (let c = 0; c < 3; c++) dst.d[d + c] = Math.round((src.d[s + c] * as + dst.d[d + c] * ad * (1 - as)) / a);
      dst.d[d + 3] = Math.round(a * 255);
    }
}

function union(rs: Raster[]): [number, number, number, number] | null {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)),
    y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)),
    y1 = Math.max(...rs.map((r) => r.y + r.h));
  return [x0, y0, x1 - x0, y1 - y0];
}

export function crop(r: Raster, x: number, y: number, w: number, h: number): Raster {
  // copia crua (sem misturar: o RGB sob alpha 0 tambem passa)
  const out = newRaster(x, y, w, h);
  const x0 = Math.max(x, r.x),
    y0 = Math.max(y, r.y),
    x1 = Math.min(x + w, r.x + r.w),
    y1 = Math.min(y + h, r.y + r.h);
  for (let yy = y0; yy < y1; yy++) {
    const s = ((yy - r.y) * r.w + (x0 - r.x)) * 4;
    out.d.set(r.d.subarray(s, s + (x1 - x0) * 4), ((yy - y) * w + (x0 - x)) * 4);
  }
  return out;
}

// recorta a transparencia em volta (null se nao sobra nada)
function trimmed(r: Raster): Raster | null {
  let [x0, y0, x1, y1] = [r.w, r.h, -1, -1];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if (r.d[(y * r.w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return crop(r, r.x + x0, r.y + y0, x1 - x0 + 1, y1 - y0 + 1);
}

// ---- arvore de camadas com as tags

interface Node {
  layer: Layer;
  parent: Node | null;
  group: boolean;
  clean: string;
  tags: Tag[];
  hide?: boolean; // escondida pelo mapa (mapa.esconder)
}

const tagOf = (n: Node, key: string) => n.tags.find((t) => t.key === key);
const GROUP_ONLY = new Set(["merge", "name"]);
const LAYER_ONLY = new Set(["path"]);

// a camada (ou pasta acima) mais proxima com a tag, como findTagLayer do script oficial
function findTag(n: Node | null, key: string): Node | null {
  for (let x = n; x; x = x.parent) if (tagOf(x, key) && (x.group || !GROUP_ONLY.has(key))) return x;
  return null;
}
const tagValue = (n: Node, key: string) => tagOf(n, key)?.value ?? n.clean;

function pathOf(n: Node): string {
  const parts: string[] = [];
  for (let x: Node | null = n; x; x = x.parent) parts.unshift(x.layer.name ?? "");
  return parts.join("/");
}

// pastas [folder] e [skin] acima (caminho das imagens), como folders() do script oficial
function folders(n: Node | null, path: string): string {
  for (let x = n; x; x = x.parent) {
    const t = x.tags.find((t) => t.key === "folder" || t.key === "skin");
    if (!t) continue;
    const folder = t.value ?? x.clean;
    if (t.key === "skin" && folder === "default") return folders(x.parent, path);
    path = folder + "/" + path;
    if (folder.startsWith("/")) return path;
    return folders(x.parent, path);
  }
  return path;
}

function applyNamePatterns(n: Node | null, name: string): string {
  const g = findTag(n, "name");
  if (!g) return name;
  const pat = tagOf(g, "name")!.value ?? "";
  const i = pat.indexOf("*");
  if (i < 0) throw new Error(`[name:${pat}] precisa de um asterisco (*) no lugar do nome: ${pathOf(g)}`);
  return applyNamePatterns(g.parent, pat.slice(0, i) + name + pat.slice(i + 1));
}

const hiddenOf = (n: Node) => !!n.layer.hidden || !!n.hide;
const visibleUp = (n: Node | null) => {
  for (let x = n; x; x = x.parent) if (hiddenOf(x)) return false;
  return true;
};
const opacityOf = (l: Layer) => (l.opacity ?? 1) * ((l as any).fillOpacity ?? 1);

export interface PsdImage {
  piece: PsdPiece;
  raster: Raster;
}

// Mapa externo (opcional): as tags e os ossos que o PSD do cliente nao traz, sem regravar
// o arquivo. Chave de camada: o nome limpo ("antebraco") ou o caminho ("braco/antebraco",
// nomes limpos ou como estao no PSD). Posicoes em px do PSD.
export interface PsdMapa {
  camadas?: Record<string, string>; // camada -> tags somadas ao nome, ex. "[bone:antebraco] [slot:x]"
  ossos?: Record<string, { pai?: string; at?: [number, number]; ponta?: [number, number] }>;
  esconder?: string[]; // camadas que entram escondidas (como trocas)
}

export interface ReadOptions {
  ignoreHidden?: boolean; // como a opcao "Ignore hidden layers" do script (padrao: nao)
  mapa?: PsdMapa;
}

const isPt = (v: any) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x));

// confere o formato do mapa (vindo de um .json escrito a mao) e devolve uma copia limpa
export function checkMapa(m: any): PsdMapa {
  if (m === undefined || m === null) return {};
  if (typeof m !== "object" || Array.isArray(m)) throw new Error("mapa do PSD: esperava um objeto { camadas, ossos, esconder }");
  const bad: string[] = [];
  for (const k of Object.keys(m)) if (!["camadas", "ossos", "esconder"].includes(k)) bad.push(`chave desconhecida "${k}" (use camadas, ossos, esconder)`);
  const out: PsdMapa = {};
  if (m.camadas !== undefined) {
    if (typeof m.camadas !== "object" || Array.isArray(m.camadas)) bad.push("camadas: esperava { camada: \"[tags]\" }");
    else {
      out.camadas = {};
      for (const [k, v] of Object.entries(m.camadas)) {
        if (typeof v !== "string") bad.push(`camadas.${k}: esperava um texto com tags, ex. "[bone:braco]"`);
        else if (!parseTags(v).tags.length) bad.push(`camadas.${k}: "${v}" nao tem nenhuma tag entre colchetes`);
        else out.camadas[k] = v;
      }
    }
  }
  if (m.ossos !== undefined) {
    if (typeof m.ossos !== "object" || Array.isArray(m.ossos)) bad.push("ossos: esperava { osso: { pai, at, ponta } }");
    else {
      out.ossos = {};
      for (const [k, v] of Object.entries<any>(m.ossos)) {
        if (!k || k === "root") {
          bad.push(`ossos: nome invalido "${k}"`);
          continue;
        }
        if (!v || typeof v !== "object") {
          bad.push(`ossos.${k}: esperava { pai, at, ponta }`);
          continue;
        }
        for (const f of Object.keys(v)) if (!["pai", "at", "ponta"].includes(f)) bad.push(`ossos.${k}: campo desconhecido "${f}" (use pai, at, ponta)`);
        if (v.pai !== undefined && typeof v.pai !== "string") bad.push(`ossos.${k}.pai: esperava o nome do osso pai`);
        if (v.at !== undefined && !isPt(v.at)) bad.push(`ossos.${k}.at: esperava [x, y] em px do PSD`);
        if (v.ponta !== undefined && !isPt(v.ponta)) bad.push(`ossos.${k}.ponta: esperava [x, y] em px do PSD`);
        out.ossos[k] = { ...(v.pai !== undefined ? { pai: v.pai } : {}), ...(v.at ? { at: [v.at[0], v.at[1]] } : {}), ...(v.ponta ? { ponta: [v.ponta[0], v.ponta[1]] } : {}) };
      }
    }
  }
  if (m.esconder !== undefined) {
    if (!Array.isArray(m.esconder) || m.esconder.some((x: any) => typeof x !== "string")) bad.push("esconder: esperava uma lista de camadas");
    else out.esconder = [...m.esconder];
  }
  if (bad.length) throw new Error(`mapa do PSD com problemas:\n- ${bad.join("\n- ")}`);
  return out;
}

// Le o PSD e devolve o plano (sem status de atualizacao) e as imagens.
export function readPsdPlan(buf: Uint8Array, file: string, opts: ReadOptions = {}): { plan: PsdPlan; images: PsdImage[]; psd: Psd } {
  initCanvas();
  const head = readPsd(buf, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  if (head.width > MAX_SIDE || head.height > MAX_SIDE) throw new Error(`PSD grande demais (${head.width}x${head.height}; maximo ${MAX_SIDE})`);
  if ((head.bitsPerChannel ?? 8) !== 8) throw new Error(`o PSD usa ${head.bitsPerChannel} bits por canal; salve em 8 bits (Imagem > Modo > 8 bits/canal)`);
  if (head.colorMode !== undefined && head.colorMode !== 3) throw new Error("o PSD nao esta em RGB; converta (Imagem > Modo > Cor RGB)");
  let count = 0;
  const countAll = (ls?: Layer[]) => ls?.forEach((l) => (count++, countAll(l.children)));
  countAll(head.children);
  if (count > MAX_LAYERS) throw new Error(`camadas demais (${count}; maximo ${MAX_LAYERS})`);
  const psd = readPsd(buf, { useImageData: true, skipThumbnail: true });
  const W = psd.width,
    H = psd.height;

  const plan: PsdPlan = { file: file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1), width: W, height: H, origin: [W / 2, H], originFrom: "padrao", bones: [], pieces: [], ignored: [], tags: {}, warnings: [] };
  const errors: string[] = [];
  const countTag = (t: Tag) => (plan.tags[t.key] = (plan.tags[t.key] ?? 0) + 1);

  // coleta de cima para baixo, como o script oficial ([overlay] vale para as de baixo)
  interface Item {
    node: Node;
    clips: Node[];
    overlays: Node[];
  }
  const items: Item[] = [];
  const overlays: Node[] = [];

  // mapa externo: tags somadas ao nome da camada e camadas escondidas, sem tocar no PSD
  const mapa = checkMapa(opts.mapa);
  const usedKeys = new Set<string>();
  const cleanPath = (n: Node | null): string => (n ? (n.parent ? cleanPath(n.parent) + "/" : "") + n.clean : "");
  const mapKey = (n: Node, keys: Set<string>): string | null => {
    for (const k of [pathOf(n), cleanPath(n), n.layer.name ?? "", n.clean])
      if (k && keys.has(k)) {
        usedKeys.add(k);
        return k;
      }
    return null;
  };
  const camadaKeys = new Set(Object.keys(mapa.camadas ?? {}));
  const esconderKeys = new Set(mapa.esconder ?? []);
  const wrap = (l: Layer, parent: Node | null): Node => {
    const { clean, tags } = parseTags(l.name ?? "");
    const n: Node = { layer: l, parent, group: l.children !== undefined, clean, tags };
    if (camadaKeys.size) {
      const k = mapKey(n, camadaKeys);
      if (k) n.tags = [...tags, ...parseTags(mapa.camadas![k]).tags];
    }
    if (esconderKeys.size && mapKey(n, esconderKeys)) n.hide = true;
    return n;
  };

  const collect = (layers: Layer[], parent: Node | null) => {
    // de cima para baixo; camadas presas (clipping) ficam acima da base
    let pending: Node[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const n = wrap(l, parent);
      const where = pathOf(n);
      for (const t of n.tags) {
        if (!(PSD_KNOWN as readonly string[]).includes(t.key)) {
          plan.warnings.push(`tag desconhecida [${t.key}] em "${where}" (ignorada)`);
          continue;
        }
        if (n.group && LAYER_ONLY.has(t.key) && !tagOf(n, "merge")) plan.warnings.push(`[${t.key}] so vale em camada ou grupo [merge]: "${where}"`);
        if (!n.group && GROUP_ONLY.has(t.key)) plan.warnings.push(`[${t.key}] so vale em grupo: "${where}"`);
        countTag(t);
      }
      if (opts.ignoreHidden && hiddenOf(n)) {
        plan.ignored.push({ layer: where, why: "escondida" });
        continue;
      }
      if (tagOf(n, "ignore")) {
        plan.ignored.push({ layer: where, why: "[ignore]" });
        pending = [];
        continue;
      }
      if (tagOf(n, "origin")) {
        const r = layerRaster(l);
        const t = r && trimmed(r);
        if (t) {
          plan.origin = [t.x + t.w / 2, t.y + t.h / 2];
          plan.originFrom = "tag";
        } else plan.warnings.push(`camada [origin] vazia: "${where}"`);
        continue;
      }
      if ((l as any).adjustment) {
        plan.ignored.push({ layer: where, why: "camada de ajuste (nao vira imagem)" });
        continue;
      }
      if (l.clipping && !n.group) {
        pending.push(n);
        continue;
      }
      if (tagOf(n, "overlay")) {
        if (!visibleUp(n)) plan.ignored.push({ layer: where, why: "[overlay] escondido" });
        else overlays.push(n);
        continue;
      }
      // fundo: a camada de baixo da raiz, opaca e do tamanho do PSD (o script oficial
      // ignora o Background por padrao)
      if (!parent && i === 0 && !n.group && !n.tags.length) {
        const r = layerRaster(l);
        if (r && r.x <= 0 && r.y <= 0 && r.x + r.w >= W && r.y + r.h >= H && opacityOf(l) >= 1) {
          let opaque = true;
          for (let k = 3; k < r.d.length && opaque; k += 4) if (r.d[k] < 255) opaque = false;
          if (opaque) {
            plan.ignored.push({ layer: where, why: "fundo opaco" });
            continue;
          }
        }
      }
      if (n.group && !tagOf(n, "merge")) {
        if (pending.length) plan.warnings.push(`camadas presas a um grupo nao sao suportadas: ${pending.map(pathOf).join(", ")}`);
        pending = [];
        collect(l.children ?? [], n);
        continue;
      }
      if (n.group && !(l.children ?? []).length) continue;
      items.push({ node: n, clips: pending.reverse(), overlays: overlays.slice() });
      pending = [];
    }
    if (pending.length) plan.warnings.push(`camadas presas sem base: ${pending.map(pathOf).join(", ")}`);
  };
  collect(psd.children ?? [], null);

  const warnFx = (n: Node) => {
    const fx: any = n.layer.effects;
    if (fx && !fx.disabled && Object.entries(fx).some(([k, v]: any) => k !== "scale" && k !== "disabled" && (Array.isArray(v) ? v.some((e: any) => e.enabled !== false) : v?.enabled !== false)))
      plan.warnings.push(`efeitos de camada (sombra, contorno...) nao entram na imagem: "${pathOf(n)}"; rasterize no Photoshop se precisar`);
  };

  // pixels de uma camada folha com opacidade, mascara e camadas presas
  const leafRaster = (n: Node, clips: Node[], alpha: number): Raster | null => {
    const r = layerRaster(n.layer);
    if (!r) return null;
    warnFx(n);
    applyMask(r, n.layer);
    for (const c of clips) {
      if (hiddenOf(c)) continue;
      const cr = layerRaster(c.layer);
      if (!cr) continue;
      applyMask(cr, c.layer);
      mulAlpha(cr, opacityOf(c.layer));
      if ((c.layer.blendMode ?? "normal") !== "normal") plan.warnings.push(`camada presa "${pathOf(c)}" com modo ${c.layer.blendMode}: entrou como normal`);
      over(r, cr, true);
    }
    mulAlpha(r, opacityOf(n.layer) * alpha);
    return r;
  };

  // grupo [merge]: as camadas visiveis de dentro numa imagem so
  const mergeRaster = (g: Node, alpha: number): Raster | null => {
    const parts: Raster[] = [];
    const walk = (layers: Layer[], parent: Node, a: number) => {
      let pending: Node[] = [];
      const seq: { n: Node; clips: Node[] }[] = [];
      for (let i = layers.length - 1; i >= 0; i--) {
        const n = wrap(layers[i], parent);
        if (hiddenOf(n) || tagOf(n, "ignore") || (n.layer as any).adjustment) continue;
        if (n.layer.clipping && !n.group) {
          pending.push(n);
          continue;
        }
        seq.push({ n, clips: pending.reverse() });
        pending = [];
      }
      // de baixo para cima
      for (const { n, clips } of seq.reverse()) {
        if (n.group) walk(n.layer.children ?? [], n, a * opacityOf(n.layer));
        else {
          if ((n.layer.blendMode ?? "normal") !== "normal") plan.warnings.push(`"${pathOf(n)}" dentro de [merge] com modo ${n.layer.blendMode}: entrou como normal`);
          const r = leafRaster(n, clips, a);
          if (r) parts.push(r);
        }
      }
    };
    walk(g.layer.children ?? [], g, opacityOf(g.layer) * alpha);
    const u = union(parts);
    if (!u) return null;
    const out = newRaster(...u);
    for (const p of parts) over(out, p);
    return out;
  };

  const bones = new Map<string, PsdBone & { node: Node | null; rects: Rect[]; all: Rect[] }>();
  const boneOf = (n: Node): string => {
    const b = findTag(n, "bone");
    if (!b) return "root";
    const name = tagValue(b, "bone");
    const parent = b.parent ? boneOf(b.parent) : "root";
    const cur = bones.get(name);
    if (cur && cur.node !== b && cur.parent !== parent) errors.push(`o osso ${name} aparece em dois lugares com pais diferentes: "${pathOf(cur.node!)}" e "${pathOf(b)}"`);
    if (!cur) bones.set(name, { name, parent, at: [0, 0], node: b, rects: [], all: [] });
    return name;
  };

  const images: PsdImage[] = [];
  const seen = new Map<string, string>(); // skin|slot|attachment -> camada
  const seenImage = new Map<string, string>();
  // de baixo para cima (ordem de desenho)
  for (const it of items.reverse()) {
    const n = it.node;
    const where = pathOf(n);
    let name = n.clean.replace(/\.png$/i, "").replace(/[\\:"*?<>|]/g, "");
    try {
      name = applyNamePatterns(n, name);
    } catch (e: any) {
      errors.push(e.message);
      continue;
    }
    if (!name) {
      plan.ignored.push({ layer: where, why: "sem nome" });
      continue;
    }
    const folderPath = folders(n, "");
    let attachmentName: string;
    if (name.startsWith("/")) {
      name = name.slice(1);
      attachmentName = name;
    } else attachmentName = folderPath + name;
    // [path:x] vale na propria camada (ou no grupo [merge])
    const pathTag = tagOf(n, "path");
    let image = pathTag?.value ?? attachmentName;
    if (pathTag?.value) image = pathTag.value.startsWith("/") ? pathTag.value.slice(1) : folderPath + pathTag.value;

    let skin = "default";
    const sk = findTag(n, "skin");
    if (sk) {
      let s = tagValue(sk, "skin");
      if (s.startsWith("/")) s = s.slice(1);
      else if (sk.parent) s = folders(sk.parent, "") + s;
      if (s.toLowerCase() === "default") s = "default";
      skin = s;
    }
    let placeholder = attachmentName;
    if (skin !== "default") {
      if (!attachmentName.startsWith(skin + "/")) {
        errors.push(`"${where}": esperava o nome comecando com ${skin}/`);
        continue;
      }
      placeholder = attachmentName.slice(skin.length + 1);
    }
    const slotTag = findTag(n, "slot");
    const slot = slotTag ? tagValue(slotTag, "slot") : name;
    const scaleNode = findTag(n, "scale");
    const scale = scaleNode ? Number(tagOf(scaleNode, "scale")!.value) : 1;
    if (!(scale > 0)) {
      errors.push(`[scale:${tagOf(scaleNode!, "scale")!.value}] invalido em "${where}"`);
      continue;
    }
    const trimNode = findTag(n, "trim");
    const trim = trimNode ? tagOf(trimNode, "trim")!.value !== "false" : true;
    const meshNode = findTag(n, "mesh");
    const mesh: true | string | undefined = meshNode ? (tagOf(meshNode, "mesh")!.value ?? true) : undefined;

    // pixels
    const alpha = (() => {
      let a = 1;
      for (let x = n.parent; x; x = x.parent) a *= opacityOf(x.layer);
      return a;
    })();
    let r = n.group ? mergeRaster(n, alpha) : leafRaster(n, it.clips, alpha);
    if (r) for (const o of it.overlays) {
      const or = leafRaster(o, [], 1);
      if (or) over(r, or, true);
    }
    // dentro do PSD (como o script oficial sem revealAll)
    if (r) r = crop(r, Math.max(0, r.x), Math.max(0, r.y), Math.min(W, r.x + r.w) - Math.max(0, r.x), Math.min(H, r.y + r.h) - Math.max(0, r.y));
    const t = r && r.w > 0 && r.h > 0 ? trimmed(r) : null;
    if (!t) {
      plan.ignored.push({ layer: where, why: "vazia" });
      continue;
    }
    const raster = trim ? t : crop(t, 0, 0, W, H);
    const key = `${skin}|${slot}|${placeholder}`;
    if (seen.has(key)) {
      errors.push(`duas camadas viram a mesma imagem ${placeholder} na parte ${slot}${skin !== "default" ? ` (skin ${skin})` : ""}: "${seen.get(key)}" e "${where}". Renomeie uma delas ou use [ignore].`);
      continue;
    }
    seen.set(key, where);
    if (seenImage.has(image)) {
      errors.push(`duas camadas gravariam o mesmo arquivo ${image}.png: "${seenImage.get(image)}" e "${where}". Renomeie uma delas.`);
      continue;
    }
    seenImage.set(image, where);
    const blendMode = n.layer.blendMode ?? "normal";
    const blend = blendMode === "linear dodge" ? "additive" : blendMode === "multiply" ? "multiply" : blendMode === "screen" ? "screen" : undefined;
    if (!blend && blendMode !== "normal" && blendMode !== "pass through") plan.warnings.push(`modo ${blendMode} de "${where}" nao existe no Spine: ficou normal`);
    const visible = visibleUp(n);
    const bone = boneOf(n);
    const rect: Rect = [raster.x, raster.y, raster.w, raster.h];
    if (bone !== "root") {
      const b = bones.get(bone)!;
      b.all.push(rect);
      if (visible) b.rects.push(rect);
    }
    const piece: PsdPiece = { layer: where, slot, attachment: placeholder, image, skin, bone, visible, rect, scale, size: [Math.round(raster.w * scale), Math.round(raster.h * scale)] };
    if (blend) piece.blend = blend;
    if (mesh !== undefined) piece.mesh = mesh;
    plan.pieces.push(piece);
    images.push({ piece, raster });
  }
  // fonte de [mesh:fonte] tem de ser malha no mesmo slot
  for (const p of plan.pieces)
    if (typeof p.mesh === "string") {
      const src = plan.pieces.find((q) => q.slot === p.slot && q.attachment === p.mesh);
      if (!src) errors.push(`"${p.layer}": [mesh:${p.mesh}] precisa de uma camada ${p.mesh} [mesh] na mesma parte (${p.slot})`);
      else if (src.mesh !== true) errors.push(`"${p.layer}": a fonte ${p.mesh} nao tem a tag [mesh]`);
    }
  // mapa: ossos (pai, pivo, ponta); o pai do mapa vence o dos grupos [bone]
  const ossos = mapa.ossos ?? {};
  for (const name of Object.keys(ossos)) if (!bones.has(name)) bones.set(name, { name, parent: "root", at: [0, 0], node: null, rects: [], all: [] });
  for (const [name, o] of Object.entries(ossos)) {
    if (o.pai === undefined) continue;
    const b = bones.get(name)!;
    if (b.node && b.parent !== "root" && b.parent !== o.pai) plan.warnings.push(`mapa: o osso ${name} esta dentro do grupo do osso ${b.parent} no PSD, mas o mapa manda o pai ser ${o.pai} (valeu o mapa)`);
    b.parent = o.pai;
  }
  for (const b of bones.values())
    if (b.parent !== "root" && !bones.has(b.parent)) errors.push(`mapa: o osso ${b.name} tem pai ${b.parent}, que nao existe (nem nas camadas nem em mapa.ossos)`);
  for (const b of bones.values()) {
    const seen = new Set<string>([b.name]);
    for (let p = b.parent; p !== "root" && bones.has(p); p = bones.get(p)!.parent) {
      if (seen.has(p)) {
        errors.push(`mapa: ciclo nos pais do osso ${b.name} (${[...seen].join(" -> ")} -> ${p})`);
        break;
      }
      seen.add(p);
    }
  }
  // chaves do mapa que nao casaram com nenhuma camada
  for (const k of [...camadaKeys, ...esconderKeys]) if (!usedKeys.has(k)) plan.warnings.push(`mapa: nenhuma camada chamada "${k}" no PSD (chave ignorada)`);
  if (errors.length) throw new Error(`O PSD tem problemas:\n- ${errors.join("\n- ")}`);

  // osso no centro das camadas visiveis do grupo (sem nenhuma: de todas, ou dos filhos)
  const center = (rs: Rect[]): [number, number] | null => {
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map((r) => r[0])),
      y0 = Math.min(...rs.map((r) => r[1]));
    const x1 = Math.max(...rs.map((r) => r[0] + r[2])),
      y1 = Math.max(...rs.map((r) => r[1] + r[3]));
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  };
  const deep = (name: string): Rect[] => [...bones.get(name)!.all, ...[...bones.values()].filter((b) => b.parent === name).flatMap((b) => deep(b.name))];
  const ordered: PsdBone[] = [];
  const add = (parent: string) => {
    for (const b of bones.values())
      if (b.parent === parent) {
        const o = ossos[b.name];
        b.at = o?.at ?? center(b.rects) ?? center(b.all) ?? center(deep(b.name)) ?? plan.origin;
        ordered.push({ name: b.name, parent: b.parent, at: b.at, ...(o?.ponta ? { ponta: o.ponta } : {}) });
        add(b.name);
      }
  };
  add("root");
  plan.bones = ordered;
  // slots com mais de uma camada visivel: so a primeira aparece no setup
  const vis = new Map<string, string[]>();
  for (const p of plan.pieces) if (p.visible && p.skin === "default") vis.set(p.slot, [...(vis.get(p.slot) ?? []), p.attachment]);
  for (const [s, v] of vis) if (v.length > 1) plan.warnings.push(`a parte ${s} tem ${v.length} camadas visiveis (${v.join(", ")}); no Spine so a de baixo aparece (as outras ficam como troca)`);
  return { plan, images, psd };
}

// [9] e [9:margens] sao do modo de tela (src/core/psd-tela.ts, docs/LAYOUT-PSD.md): a importacao comum ignora
const PSD_KNOWN = ["bone", "slot", "skin", "folder", "ignore", "merge", "path", "scale", "trim", "mesh", "name", "overlay", "origin", "9"] as const;

