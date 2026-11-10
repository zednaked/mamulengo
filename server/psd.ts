// Importacao de PSD (lado do Node, a leitura em src/core/psd-ler.ts): le o arquivo com o ag-psd, aplica as tags do
// script oficial PhotoshopToSpine, gera uma imagem por camada (ou grupo [merge]) e
// monta o plano (src/core/psd.ts) que vira comandos. Cria um asset novo ou atualiza um
// que ja existe, casando camada com imagem pelo nome.
//
// O que e "assado" na imagem (como o script oficial, que salva cada camada pelo
// Photoshop): opacidade da camada e das pastas, mascara de camada, camadas presas
// (clipping) e [overlay]. Efeitos de camada e camadas de ajuste nao entram (avisa).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { bonecoVirtual, lerVirtual, gravarVirtual } from "./boneco.ts";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { psdCalls, psdSummary } from "../src/core/psd.ts";
import { packAtlas, unpackAtlas } from "./atlas.ts";
import { createAsset, listImages } from "./assets.ts";
import { findProjectRoot } from "./godot.ts";
import { gravarBonecoArquivo } from "./boneco-binario.ts";
import { Document } from "../src/core/document.ts";
import { executeAsync } from "../src/core/commands/index.ts";
import { checkMapa, readPsdPlan, type PsdImage, type PsdMapa, type Raster, type ReadOptions } from "../src/core/psd-ler.ts";
import { aplicarEscolhas, mapaDaTela, resumoTela, type EscolhasTela } from "../src/core/psd-tela.ts";
import { assetsDe, atualizarDePsd, criarBonecoDePsd, criarTelaDePsd, proporTela, manifestPath, type PsdIO, type PsdManifest, type PsdResult } from "../src/core/psd-importar.ts";
export { checkMapa, manifestPath, readPsdPlan, type PsdImage, type PsdManifest, type PsdMapa, type PsdResult, type ReadOptions };

async function toPng(r: Raster, scale: number): Promise<Buffer> {
  let img = sharp(Buffer.from(r.d.buffer, r.d.byteOffset, r.d.byteLength), { raw: { width: r.w, height: r.h, channels: 4 } });
  if (scale !== 1) img = sharp(await img.resize(Math.max(1, Math.round(r.w * scale)), Math.max(1, Math.round(r.h * scale)), { kernel: "lanczos3" }).png().toBuffer());
  return img.png({ compressionLevel: 9 }).toBuffer();
}

async function sharpRaw(file: string | Buffer) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

// o disco e o sharp para a importacao comum (src/core/psd-importar.ts)
export function nodeIO(backup?: (file: string) => void): PsdIO {
  return {
    async existe(p) {
      return existsSync(p);
    },
    async ler(p) {
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    },
    async gravar(p, dados) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, dados);
    },
    async imagens(dir) {
      return listImages(dir);
    },
    async listar(dir) {
      return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)).filter((f) => statSync(f).isFile()) : [];
    },
    async bruto(p) {
      return existsSync(p) ? sharpRaw(p) : null;
    },
    async brutoDe(png) {
      return sharpRaw(Buffer.from(png));
    },
    png: toPng,
    async empacotar(imagens, o) {
      return packAtlas(imagens, o);
    },
    async desempacotar(atlas, texto, saida) {
      await unpackAtlas(atlas, texto, saida);
    },
    async gravarBoneco(arquivo, b, binario) {
      gravarBonecoArquivo(arquivo, b, binario);
    },
    copia: backup,
  };
}

// AssetProvider de arquivos (images/ e atlas), para rodar os comandos no Node
export const fileAssets = (dir: string, atlasText: string) => assetsDe(nodeIO(), dir, atlasText);

// Asset novo. Dentro de um projeto Godot: <dir>/<name>.spine-json + atlas + paginas + -data.tres,
// ja montado; fora dele, <dir>/<name>.boneco (src/core/psd-importar.ts).
export async function createFromPsd(opts: { psd: string; dir: string; name: string; read?: ReadOptions }): Promise<PsdResult & { tres: string; skeleton: string; atlas: string; pages: string[] }> {
  if (!/^[\w.-]+$/.test(opts.name)) throw new Error(`nome invalido "${opts.name}": use letras, numeros, - e _ (sem espacos)`);
  if (!findProjectRoot(opts.dir)) return criarBonecoDePsd(nodeIO(), { psd: new Uint8Array(readFileSync(opts.psd)), arquivoPsd: opts.psd, dir: opts.dir, name: opts.name, read: opts.read });
  const { plan, images } = readPsdPlan(readFileSync(opts.psd), opts.psd, opts.read);
  if (!plan.pieces.length) throw new Error("nenhuma camada com desenho no PSD");
  for (const p of plan.pieces) p.status = "new";
  // as imagens vao direto para <dir>/images (createAsset copia a pasta para ela mesma)
  const imagesDir = join(opts.dir, "images");
  for (const f of [`${opts.name}.spine-json`, `${opts.name}.atlas`, `${opts.name}-data.tres`]) if (existsSync(join(opts.dir, f))) throw new Error(`ja existe: ${join(opts.dir, f)}`);
  if (listImages(imagesDir).length) throw new Error(`a pasta ${imagesDir} ja tem imagens; escolha uma pasta nova para o personagem`);
  for (const im of images) {
    const f = join(imagesDir, im.piece.image + ".png");
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, await toPng(im.raster, im.piece.scale));
  }
  const created = await createAsset({ dir: opts.dir, name: opts.name, imagesFrom: imagesDir });
  const atlasText = readFileSync(created.atlas, "utf8");
  const doc = Document.fromText(readFileSync(created.skeleton, "utf8"), { text: atlasText, pages: {} });
  const { calls, report } = psdCalls(doc.json, plan);
  await executeAsync(doc, calls, "psd", `PSD ${plan.file}`, {}, fileAssets(opts.dir, atlasText));
  writeFileSync(created.skeleton, doc.serialize());
  // o registro da importacao (a atualizacao seguinte le)
  writeFileSync(manifestPath(created.atlas), JSON.stringify(manifestDe(plan, opts.read?.mapa), null, 1) + "\n");
  return { ...created, plan, report, summary: psdSummary(plan, report, "create") };
}

function manifestDe(plan: PsdResult["plan"], mapa?: PsdMapa): PsdManifest {
  const m: PsdManifest = { version: 1, psd: plan.file, width: plan.width, height: plan.height, origin: plan.origin, images: {} };
  if (mapa && Object.keys(mapa).length) m.mapa = mapa;
  for (const p of plan.pieces) m.images[p.image] = { rect: p.rect, scale: p.scale, layer: p.layer };
  return m;
}

// Asset que ja existe (src/core/psd-importar.ts atualizarDePsd): o .atlas de verdade, ou o virtual
// de um .boneco (lido e regravado pelo server/boneco.ts)
export async function updateFromPsd(opts: { psd: string; atlas: string; meshImages?: string[]; read?: ReadOptions; backup?: (file: string) => void }): Promise<{ plan: PsdResult["plan"]; atlasText: string; pages: string[] }> {
  const virtual = bonecoVirtual(opts.atlas);
  const atlasTexto = virtual ? lerVirtual(opts.atlas)! : readFileSync(opts.atlas, "utf8");
  return atualizarDePsd(nodeIO(opts.backup), {
    psd: new Uint8Array(readFileSync(opts.psd)),
    arquivoPsd: opts.psd,
    atlas: opts.atlas,
    atlasTexto,
    meshImages: opts.meshImages,
    read: opts.read,
    async gravarAtlas(texto) {
      opts.backup?.(virtual ? virtual.arquivo : opts.atlas);
      if (virtual) gravarVirtual(opts.atlas, Buffer.from(texto, "utf8"));
      else writeFileSync(opts.atlas, texto);
    },
  });
}

// Atualizacao inteira no Node (testes, ferramentas): arquivos + comandos no documento.
export async function updateDocFromPsd(doc: Document, opts: { psd: string; atlas: string; read?: ReadOptions }): Promise<PsdResult & { atlasText: string }> {
  const meshImages = new Set<string>();
  for (const s of doc.json.skins ?? [])
    for (const [, m] of Object.entries<any>(s.attachments ?? {}))
      for (const [name, a] of Object.entries<any>(m)) if (a.type === "mesh" || a.type === "linkedmesh") meshImages.add(a.path ?? name);
  const { plan, atlasText } = await updateFromPsd({ ...opts, meshImages: [...meshImages] });
  doc.atlas = { ...doc.atlas, text: atlasText };
  const { calls, report } = psdCalls(doc.json, plan);
  if (calls.length) await executeAsync(doc, calls, "psd", `PSD ${plan.file}`, {}, fileAssets(dirname(opts.atlas), atlasText));
  return { plan, report, summary: psdSummary(plan, report, "update"), atlasText };
}

// A tela (docs/LAYOUT-PSD.md): a proposta (dryRun) e a tela nova, sempre .boneco
export async function proposeScreenFromPsd(opts: { psd: string; mapa?: any; escolhas?: EscolhasTela; fontes?: string[] }) {
  const r = await proporTela(nodeIO(), { psd: new Uint8Array(readFileSync(opts.psd)), arquivoPsd: opts.psd, mapa: opts.mapa, fontes: opts.fontes });
  const proposta = aplicarEscolhas(r.proposta, opts.escolhas);
  return { proposta, linhas: resumoTela(proposta), mapa: mapaDaTela(proposta), mapaArquivo: r.mapaArquivo };
}
export async function createScreenFromPsd(opts: { psd: string; dir: string; name: string; mapa?: any; escolhas?: any; fontes?: string[]; ignoreHidden?: boolean }) {
  if (!/^[\w.-]+$/.test(opts.name)) throw new Error(`nome invalido "${opts.name}": use letras, numeros, - e _ (sem espacos)`);
  return criarTelaDePsd(nodeIO(), { psd: new Uint8Array(readFileSync(opts.psd)), arquivoPsd: opts.psd, dir: opts.dir, name: opts.name, mapa: opts.mapa, escolhas: opts.escolhas, fontes: opts.fontes, ignoreHidden: opts.ignoreHidden });
}
