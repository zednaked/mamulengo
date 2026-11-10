// Importacao de PSD, a parte comum ao servidor (server/psd.ts) e ao editor pelo navegador
// (src/navegador/psd.ts): personagem novo em .boneco, ou o aberto atualizado camada por camada.
// Arquivo e imagem vem de quem chama (PsdIO): o servidor usa o disco e o sharp; o navegador, as
// pastas dele (src/navegador/fs.ts), canvas e um PNG sem perda (src/navegador/png.ts).
//
// Cada imagem fica em <pasta>/images/<nome>.png (a fonte, para reempacotar sem perda), as paginas
// do atlas ao lado do .boneco e o registro da importacao em images/psd-import.json (onde cada
// imagem estava no PSD, para a proxima atualizacao saber o que mudou de lugar).
import { importarSpine } from "../boneco/spine.ts";
import { aplicarEscolhas, lerTela, mapaDaTela, nomesDaFonte, type EscolhasTela, type FonteConhecida, type MapaTela, type PropostaTela } from "./psd-tela.ts";
import { parseAtlas } from "./atlas-text.ts";
import { Document } from "./document.ts";
import { executeAsync, type AssetProvider } from "./commands/index.ts";
import { psdCalls, psdSummary, rectCenter, sameRect, type PsdPlan, type PsdReport, type Rect } from "./psd.ts";
import { crop, readPsdPlan, type PsdMapa, type Raster, type ReadOptions } from "./psd-ler.ts";

export type Bruto = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

export interface PsdIO {
  existe(p: string): Promise<boolean>;
  ler(p: string): Promise<Uint8Array | null>;
  // grava inteiro (cria as pastas que faltarem)
  gravar(p: string, dados: Uint8Array | string): Promise<void>;
  // imagens de uma pasta (recursivo): nome da regiao = caminho relativo sem extensao
  imagens(dir: string): Promise<{ name: string; file: string }[]>;
  // os arquivos de uma pasta (sem descer; caminhos inteiros): as fontes da tela
  listar?(dir: string): Promise<string[]>;
  // os pixels (RGBA sem premultiplicar) de um arquivo de imagem, ou dos bytes de um PNG
  bruto(p: string): Promise<Bruto | null>;
  brutoDe(png: Uint8Array): Promise<Bruto>;
  // a imagem de uma camada em PNG, na escala pedida
  png(r: Raster, escala: number): Promise<Uint8Array>;
  // empacota as imagens soltas em paginas (texto do .atlas e os bytes de cada pagina)
  empacotar(imagens: { name: string; file: string }[], o: { pageName: string; pma?: boolean }): Promise<{ atlas: string; pages: { name: string; data: Uint8Array }[] }>;
  // separa as regioes de um atlas em imagens soltas (personagem que veio sem a pasta images/)
  desempacotar(atlas: string, atlasTexto: string, saida: string): Promise<void>;
  gravarBoneco(arquivo: string, b: any, binario: boolean): Promise<void>;
  // copia de seguranca antes de sobrescrever
  copia?(p: string): void | Promise<void>;
}

// caminhos com "/" (o servidor roda no Linux e no Mac; o navegador so tem "/")
export const juntar = (...ps: string[]) => ps.filter(Boolean).join("/").replace(/\/+/g, "/");
export const pasta = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
const base = (p: string, ext = "") => {
  const n = p.slice(p.lastIndexOf("/") + 1);
  return ext && n.endsWith(ext) ? n.slice(0, -ext.length) : n;
};

export interface PsdResult {
  plan: PsdPlan;
  report: PsdReport;
  summary: string[];
}

// ---- registro da importacao (ao lado das imagens-fonte): onde cada imagem estava no PSD

export interface PsdManifest {
  version: 1;
  psd: string;
  width: number;
  height: number;
  origin: [number, number];
  images: Record<string, { rect: Rect; scale: number; layer: string }>;
  mapa?: PsdMapa; // mapa usado na importacao (a atualizacao sem mapa reaplica este)
}

export const manifestPath = (atlas: string) => juntar(pasta(atlas), "images", "psd-import.json");

async function lerRegistro(io: PsdIO, atlas: string): Promise<PsdManifest | null> {
  const b = await io.ler(manifestPath(atlas));
  if (!b) return null;
  try {
    const m = JSON.parse(new TextDecoder().decode(b));
    return m?.version === 1 ? m : null;
  } catch {
    return null;
  }
}

async function gravarRegistro(io: PsdIO, atlas: string, plan: PsdPlan, prev: PsdManifest | null, mapa?: PsdMapa) {
  const m: PsdManifest = { version: 1, psd: plan.file, width: plan.width, height: plan.height, origin: plan.origin, images: {} };
  const mp = mapa ?? prev?.mapa;
  if (mp && Object.keys(mp).length) m.mapa = mp;
  // imagens que sairam do PSD continuam registradas (no referencial novo)
  if (prev) {
    const dx = plan.origin[0] - prev.origin[0],
      dy = plan.origin[1] - prev.origin[1];
    for (const [k, v] of Object.entries(prev.images)) m.images[k] = { ...v, rect: [v.rect[0] + dx, v.rect[1] + dy, v.rect[2], v.rect[3]] };
  }
  for (const p of plan.pieces) m.images[p.image] = { rect: p.rect, scale: p.scale, layer: p.layer };
  await io.gravar(manifestPath(atlas), JSON.stringify(m, null, 1) + "\n");
}

// as imagens e o atlas para os comandos (malha automatica, recorte pela imagem...)
export function assetsDe(io: PsdIO, dir: string, atlasText: string): AssetProvider {
  const atlas = parseAtlas(atlasText);
  return {
    async image(name) {
      const r = await io.bruto(juntar(dir, "images", name + ".png"));
      return r ? { width: r.width, height: r.height, data: r.data as any } : null;
    },
    region(name) {
      const r = atlas.regions.find((x) => x.name === name);
      return r ? { width: r.originalWidth, height: r.originalHeight } : null;
    },
    async text(p) {
      const b = await io.ler(p);
      return b ? new TextDecoder().decode(b) : null;
    },
    async bytes(p) {
      return io.ler(p);
    },
  };
}

// grava a imagem de cada peca em <dir>/images
async function gravarImagens(io: PsdIO, imagesDir: string, images: { piece: { image: string; scale: number }; raster: Raster }[]) {
  for (const im of images) await io.gravar(juntar(imagesDir, im.piece.image + ".png"), await io.png(im.raster, im.piece.scale));
}

// Personagem novo: <dir>/<name>.boneco com as paginas ao lado e as imagens em <dir>/images. O
// editor abre o .boneco pelos arquivos virtuais (server/boneco.ts, src/navegador/api.ts).
export async function criarBonecoDePsd(
  io: PsdIO,
  opts: { psd: Uint8Array; arquivoPsd: string; dir: string; name: string; read?: ReadOptions; depois?: (doc: Document, assets: AssetProvider) => Promise<void> },
): Promise<PsdResult & { tres: string; skeleton: string; atlas: string; pages: string[] }> {
  if (!/^[\w.-]+$/.test(opts.name)) throw new Error(`nome invalido "${opts.name}": use letras, numeros, - e _ (sem espacos)`);
  const arquivo = juntar(opts.dir, `${opts.name}.boneco`);
  if (await io.existe(arquivo)) throw new Error(`ja existe: ${arquivo}`);
  const { plan, images } = readPsdPlan(opts.psd, opts.arquivoPsd, opts.read);
  if (!plan.pieces.length) throw new Error("nenhuma camada com desenho no PSD");
  for (const p of plan.pieces) p.status = "new";
  const imagesDir = juntar(opts.dir, "images");
  if ((await io.imagens(imagesDir)).length) throw new Error(`a pasta ${imagesDir} ja tem imagens; escolha uma pasta nova para o personagem`);
  await gravarImagens(io, imagesDir, images);
  const packed = await io.empacotar(await io.imagens(imagesDir), { pageName: opts.name });
  for (const p of packed.pages) await io.gravar(juntar(opts.dir, p.name), p.data);
  const json = { skeleton: { spine: "4.3.23", images: "./images/", audio: "" }, bones: [{ name: "root" }], slots: [], skins: [{ name: "default", attachments: {} }], animations: {} };
  const doc = Document.fromText(JSON.stringify(json), { text: packed.atlas, pages: {} });
  const { calls, report } = psdCalls(doc.json, plan);
  await executeAsync(doc, calls, "psd", `PSD ${plan.file}`, {}, assetsDe(io, opts.dir, packed.atlas));
  if (opts.depois) await opts.depois(doc, assetsDe(io, opts.dir, packed.atlas));
  await io.gravarBoneco(arquivo, importarSpine(doc.json, packed.atlas, opts.name), false);
  // o registro: a proxima atualizacao sabe onde cada imagem estava no PSD
  await gravarRegistro(io, arquivo + ".atlas", plan, null, opts.read?.mapa);
  return { tres: arquivo, skeleton: arquivo + ".spine-json", atlas: arquivo + ".atlas", pages: packed.pages.map((p) => p.name), plan, report, summary: psdSummary(plan, report, "create") };
}

const brutoIgual = (a: Bruto, b: Bruto) => {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
};

// Asset que ja existe: grava as imagens novas ou mudadas em images/, reempacota o atlas e devolve
// o plano com o status de cada imagem. Os comandos (psdCalls) rodam depois no documento aberto
// (no editor, desfaziveis). meshImages: imagens usadas por malhas no documento (a imagem gravada
// cobre a area antiga e a nova, para as UVs nao sairem dela). `atlas` e o .atlas (de verdade ou o
// virtual de um .boneco); `atlasTexto` o texto dele e `gravarAtlas` como regravar.
export async function atualizarDePsd(
  io: PsdIO,
  opts: { psd: Uint8Array; arquivoPsd: string; atlas: string; atlasTexto: string; gravarAtlas: (texto: string) => Promise<void>; meshImages?: string[]; read?: ReadOptions },
): Promise<{ plan: PsdPlan; atlasText: string; pages: string[] }> {
  const prev = await lerRegistro(io, opts.atlas);
  // sem mapa: reaplica o da importacao anterior (o registro guarda)
  const read: ReadOptions = { ...opts.read, mapa: opts.read?.mapa ?? prev?.mapa };
  const { plan, images } = readPsdPlan(opts.psd, opts.arquivoPsd, read);
  const dir = pasta(opts.atlas);
  const imagesDir = juntar(dir, "images");
  const atlasText0 = opts.atlasTexto;
  if (!(await io.imagens(imagesDir)).length) await io.desempacotar(opts.atlas, atlasText0, imagesDir);
  const regions = new Map(parseAtlas(atlasText0).regions.map((r) => [r.name, r]));
  if (prev) {
    // origem: a do PSD ([origin]); sem ela, a da importacao anterior, se o PSD nao mudou de tamanho
    if (plan.originFrom === "padrao" && prev.width === plan.width && prev.height === plan.height) {
      plan.origin = prev.origin;
      plan.originFrom = "anterior";
    }
  } else plan.align = true;
  const shift: [number, number] = prev ? [plan.origin[0] - prev.origin[0], plan.origin[1] - prev.origin[1]] : [0, 0];
  const meshes = new Set(opts.meshImages ?? []);
  let wrote = 0;
  for (const im of images) {
    const p = im.piece;
    const file = juntar(imagesDir, p.image + ".png");
    const region = regions.get(p.image);
    if (!region || !(await io.existe(file))) {
      p.status = "new";
    } else {
      // retangulo antigo no referencial deste PSD; sem registro, mesmo centro e o tamanho antigo
      const old = prev?.images[p.image];
      const oldScale = old?.scale ?? p.scale;
      const ow = region.originalWidth / oldScale,
        oh = region.originalHeight / oldScale;
      const c = rectCenter(p.rect);
      p.from = old ? [old.rect[0] + shift[0], old.rect[1] + shift[1], old.rect[2], old.rect[3]] : [c[0] - ow / 2, c[1] - oh / 2, ow, oh];
      // malha: a imagem cobre a area antiga tambem (as UVs continuam dentro dela)
      if (meshes.has(p.image) && !sameRect(p.from, p.rect)) {
        const f = p.from;
        const x0 = Math.floor(Math.min(f[0], p.rect[0])),
          y0 = Math.floor(Math.min(f[1], p.rect[1]));
        const x1 = Math.ceil(Math.max(f[0] + f[2], p.rect[0] + p.rect[2])),
          y1 = Math.ceil(Math.max(f[1] + f[3], p.rect[1] + p.rect[3]));
        if (x1 - x0 !== p.rect[2] || y1 - y0 !== p.rect[3]) {
          p.art = p.rect;
          im.raster = crop(im.raster, x0, y0, x1 - x0, y1 - y0);
          p.rect = [x0, y0, x1 - x0, y1 - y0];
          p.size = [Math.round(p.rect[2] * p.scale), Math.round(p.rect[3] * p.scale)];
        }
      }
    }
    const png = await io.png(im.raster, p.scale);
    if (p.status !== "new") {
      const antes = await io.bruto(file);
      const same = !!antes && brutoIgual(antes, await io.brutoDe(png));
      p.status = same && p.from && sameRect(p.from, p.rect) ? "same" : "changed";
      if (p.status === "same") continue;
    }
    await io.copia?.(file);
    await io.gravar(file, png);
    wrote++;
  }
  plan.kept = prev ? Object.keys(prev.images).filter((k) => !plan.pieces.some((p) => p.image === k)) : [];
  let atlasText = atlasText0;
  let pages = parseAtlas(atlasText0).pages.map((p) => p.name);
  if (wrote) {
    const before = parseAtlas(atlasText0);
    for (const pg of before.pages) await io.copia?.(juntar(dir, pg.name));
    const packed = await io.empacotar(await io.imagens(imagesDir), { pageName: base(opts.atlas, ".atlas").replace(/\.boneco$/, ""), pma: before.pages[0]?.pma ?? false });
    for (const pg of packed.pages) await io.gravar(juntar(dir, pg.name), pg.data);
    await opts.gravarAtlas(packed.atlas);
    atlasText = packed.atlas;
    pages = packed.pages.map((p) => p.name);
  }
  await gravarRegistro(io, opts.atlas, plan, prev, read.mapa);
  return { plan, atlasText, pages };
}

// ---- a tela (docs/LAYOUT-PSD.md): o PSD de uma tela de jogo chega com a arte base, as ancoras, os
// papeis, os textos e as nove-fatias propostos (src/core/psd-tela.ts) e aplicados pelo psd.layout.

// as fontes que o PSD pode usar: ao lado dele, em fontes/ ou fonts/ ao lado dele, e nas pastas extras
export async function fontesConhecidas(io: PsdIO, arquivoPsd: string, extras: string[] = []): Promise<FonteConhecida[]> {
  const out: FonteConhecida[] = [];
  const d = pasta(arquivoPsd);
  for (const dir of [d, juntar(d, "fontes"), juntar(d, "fonts"), ...extras]) {
    for (const f of (await io.listar?.(dir)) ?? []) {
      if (!/\.(ttf|otf)$/i.test(f) || out.some((x) => x.arquivo === f)) continue;
      const b = await io.ler(f);
      if (b) out.push({ arquivo: f, nomes: nomesDaFonte(b) });
    }
  }
  return out;
}

// o mapa externo da tela ao lado do PSD: <nome>.tela.json
export const mapaTelaAoLado = (arquivoPsd: string) => arquivoPsd.replace(/\.psd$/i, "") + ".tela.json";

export async function proporTela(io: PsdIO, opts: { psd: Uint8Array; arquivoPsd: string; mapa?: MapaTela | null; fontes?: string[] }): Promise<{ proposta: PropostaTela; mapa: MapaTela | null; mapaArquivo: string | null }> {
  let mapa = opts.mapa ?? null;
  let mapaArquivo: string | null = null;
  if (!mapa) {
    const b = await io.ler(mapaTelaAoLado(opts.arquivoPsd));
    if (b) {
      mapaArquivo = mapaTelaAoLado(opts.arquivoPsd);
      try {
        mapa = JSON.parse(new TextDecoder().decode(b));
      } catch (e: any) {
        throw new Error(`${mapaArquivo}: JSON invalido (${e.message})`);
      }
    }
  }
  const fontes = await fontesConhecidas(io, opts.arquivoPsd, opts.fontes);
  return { proposta: lerTela(opts.psd, opts.arquivoPsd, { mapa, fontes }), mapa, mapaArquivo };
}

// A tela nova: <dir>/<name>.boneco (sempre .boneco: a tela e so do Mamulengo), as fontes achadas em
// <dir>/fontes e o manifesto <name>.manifesto.json (query.roles) ao lado.
export async function criarTelaDePsd(
  io: PsdIO,
  opts: { psd: Uint8Array; arquivoPsd: string; dir: string; name: string; mapa?: MapaTela | null; escolhas?: EscolhasTela; fontes?: string[]; ignoreHidden?: boolean },
): Promise<PsdResult & { tres: string; skeleton: string; atlas: string; pages: string[]; proposta: PropostaTela; linhas: string[]; manifesto: string }> {
  // as fontes tambem na pasta da tela (o PSD largado na janela vem de uma pasta temporaria)
  const { proposta: p0, mapa } = await proporTela(io, { ...opts, fontes: [...(opts.fontes ?? []), opts.dir, juntar(opts.dir, "fontes")] });
  const proposta = aplicarEscolhas(p0, opts.escolhas);
  // as fontes usadas vao para <dir>/fontes (o .boneco aponta para elas, relativo a ele)
  const fonts: Record<string, string> = {};
  for (const t of proposta.itens) {
    if (t.tipo !== "texto" || !t.ligado || !t.fonte || !t.arquivoFonte || fonts[t.fonte]) continue;
    const b = await io.ler(t.arquivoFonte);
    if (!b) continue;
    const nome = t.arquivoFonte.slice(t.arquivoFonte.lastIndexOf("/") + 1);
    await io.gravar(juntar(opts.dir, "fontes", nome), b);
    fonts[t.fonte] = `fontes/${nome}`;
  }
  // o mapa comum (camadas, ossos, esconder) do mapa da tela vai junto com as tags da proposta
  const base = mapa ? { camadas: mapa.camadas, ossos: mapa.ossos, esconder: mapa.esconder } : null;
  let linhas: string[] = [];
  let avisos: string[] = [];
  let man: any = null;
  const r = await criarBonecoDePsd(io, {
    psd: opts.psd,
    arquivoPsd: opts.arquivoPsd,
    dir: opts.dir,
    name: opts.name,
    read: { ignoreHidden: opts.ignoreHidden, mapa: mapaDaTela(proposta, base) },
    async depois(doc, assets) {
      const [res] = await executeAsync(doc, { cmd: "psd.layout", args: { proposal: proposta, fonts } }, "psd", `tela ${proposta.arquivo}`, {}, assets);
      linhas = res.lines;
      avisos = res.warnings;
      man = (await executeAsync(doc, { cmd: "query.roles", args: { name: opts.name } }, "psd"))[0].manifest;
    },
  });
  // o manifesto (o contrato com quem escreve a logica)
  const manifesto = juntar(opts.dir, `${opts.name}.manifesto.json`);
  await io.gravar(manifesto, JSON.stringify(man, null, 1) + "\n");
  return { ...r, proposta, linhas, manifesto, summary: [...r.summary, "Tela:", ...linhas.filter((l) => !l.startsWith("Atencao")), ...avisos.map((a) => `Atencao: ${a}`)] };
}
