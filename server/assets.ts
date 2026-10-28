// Operacoes de arquivo de assets Spine num projeto Godot: criar asset a partir de
// imagens soltas, adicionar/trocar imagens (reempacota o atlas), listar imagens.
// As imagens-fonte ficam em <pasta do asset>/images/ (como o Spine), para reempacotar
// sem perda.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import sharp from "sharp";
import { packAtlas, parseAtlas, unpackAtlas, type PackOptions } from "./atlas.ts";
import { findProjectRoot, toRes } from "./godot.ts";

const IMG = new Set([".png", ".webp", ".jpg", ".jpeg"]);

// imagens de uma pasta (recursivo); nome da regiao = caminho relativo sem extensao
export function listImages(dir: string): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (IMG.has(extname(n).toLowerCase())) out.push({ name: relative(dir, p).replace(/\.[^.]+$/, "").split("\\").join("/"), file: p });
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function imageInfo(files: { name: string; file: string }[]) {
  return Promise.all(files.map(async (f) => ({ ...f, ...(await sharp(f.file).metadata().then((m) => ({ width: m.width, height: m.height })))})));
}

export function tresText(root: string, atlas: string, skeleton: string, defaultMix = 0) {
  return `[gd_resource type="SpineSkeletonDataResource" format=3]

[ext_resource type="SpineAtlasResource" path="${toRes(root, atlas)}" id="1"]
[ext_resource type="SpineSkeletonFileResource" path="${toRes(root, skeleton)}" id="2"]

[resource]
atlas_res = ExtResource("1")
skeleton_file_res = ExtResource("2")
default_mix = ${defaultMix.toFixed(2).replace(/0$/, "")}
`;
}

async function writePacked(atlasPath: string, images: { name: string; file: string }[], opts: PackOptions) {
  const base = basename(atlasPath, ".atlas");
  const packed = await packAtlas(images, { pageName: base, ...opts });
  for (const p of packed.pages) writeFileSync(join(dirname(atlasPath), p.name), p.data);
  writeFileSync(atlasPath, packed.atlas);
  return packed;
}

// Cria <dir>/<name>.spine-json + .atlas + paginas + <name>-data.tres a partir de imagens.
export async function createAsset(opts: { dir: string; name: string; imagesFrom: string; pack?: PackOptions }) {
  const root = findProjectRoot(opts.dir);
  if (!root) throw new Error(`${opts.dir} nao esta dentro de um projeto Godot`);
  const skeleton = join(opts.dir, `${opts.name}.spine-json`);
  const atlas = join(opts.dir, `${opts.name}.atlas`);
  const tres = join(opts.dir, `${opts.name}-data.tres`);
  for (const f of [skeleton, atlas, tres]) if (existsSync(f)) throw new Error(`ja existe: ${f}`);
  const src = listImages(opts.imagesFrom);
  if (!src.length) throw new Error(`nenhuma imagem em ${opts.imagesFrom}`);
  // guarda as fontes ao lado do asset
  const imagesDir = join(opts.dir, "images");
  for (const im of src) {
    const to = join(imagesDir, im.name + extname(im.file));
    mkdirSync(dirname(to), { recursive: true });
    if (to !== im.file) copyFileSync(im.file, to);
  }
  mkdirSync(opts.dir, { recursive: true });
  const packed = await writePacked(atlas, listImages(imagesDir), opts.pack ?? {});
  const doc = { skeleton: { spine: "4.3.23", images: "./images/", audio: "" }, bones: [{ name: "root" }], slots: [], skins: [{ name: "default", attachments: {} }], animations: {} };
  writeFileSync(skeleton, JSON.stringify(doc));
  writeFileSync(tres, tresText(root, atlas, skeleton));
  return { tres, skeleton, atlas, regions: packed.regions, pages: packed.pages.map((p) => p.name) };
}

// Adiciona/troca imagens no atlas de um asset e reempacota.
export async function addImages(opts: { atlas: string; files: string[]; names?: string[]; pack?: PackOptions }) {
  const dir = dirname(opts.atlas);
  const imagesDir = join(dir, "images");
  // sem a pasta de fontes (asset vindo do Spine), recria a partir do atlas atual
  if (!listImages(imagesDir).length) await unpackAtlas(opts.atlas, readFileSync(opts.atlas, "utf8"), imagesDir);
  opts.files.forEach((f, i) => {
    const name = opts.names?.[i] ?? basename(f).replace(/\.[^.]+$/, "");
    const to = join(imagesDir, name + extname(f));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(f, to);
  });
  const before = parseAtlas(readFileSync(opts.atlas, "utf8"));
  const packed = await writePacked(opts.atlas, listImages(imagesDir), { pma: before.pages[0]?.pma ?? false, ...opts.pack });
  return { atlas: opts.atlas, atlasText: packed.atlas, regions: packed.regions, pages: packed.pages.map((p) => p.name) };
}

// Traz um export do Spine (json + atlas + paginas) para um projeto Godot no formato dos
// jogos: <dir>/<name>.spine-json, <name>.atlas, paginas <name>[_n].<png|webp> e
// <name>-data.tres. O json e o atlas do export nem sempre tem o mesmo nome (Car.json com
// car.atlas, nome com espaco): aqui tudo passa a se chamar <name>. Avisa pagina maior que
// 4096 (limite de textura de muitos celulares no WebGL).
export async function importExport(opts: { json: string; atlas: string; dir: string; name: string; webp?: number | "lossless"; defaultMix?: number; force?: boolean; jogo?: { qualidade: number } | "sem_perda" }) {
  const root = findProjectRoot(opts.dir);
  if (!root) throw new Error(`${opts.dir} nao esta dentro de um projeto Godot`);
  if (!/^[\w.-]+$/.test(opts.name)) throw new Error(`nome invalido "${opts.name}": use letras, numeros, - e _`);
  mkdirSync(opts.dir, { recursive: true });
  const skeleton = join(opts.dir, `${opts.name}.spine-json`);
  const atlas = join(opts.dir, `${opts.name}.atlas`);
  const tres = join(opts.dir, `${opts.name}-data.tres`);
  if (!opts.force) for (const f of [skeleton, atlas, tres]) if (existsSync(f)) throw new Error(`ja existe: ${f}`);
  const json = JSON.parse(readFileSync(opts.json, "utf8"));
  const version = String(json.skeleton?.spine ?? "");
  const avisos: string[] = [];
  if (!version.startsWith("4.3")) avisos.push(`exportado pelo Spine ${version || "?"}: o jogo usa o runtime 4.3`);
  let text = readFileSync(opts.atlas, "utf8");
  const { pages } = parseAtlas(text);
  const ext = opts.webp !== undefined ? ".webp" : ".png";
  const paginas: { de: string; para: string; largura: number; altura: number; bytesOrigem: number; bytes: number }[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const src = join(dirname(opts.atlas), p.name);
    if (!existsSync(src)) throw new Error(`pagina do atlas nao encontrada: ${src}`);
    const nome = `${opts.name}${i ? `_${i + 1}` : ""}${ext}`;
    const dst = join(opts.dir, nome);
    const img = sharp(src);
    const m = await img.metadata();
    if (opts.webp === undefined) copyFileSync(src, dst);
    else await img.webp(opts.webp === "lossless" ? { lossless: true } : { quality: opts.webp, alphaQuality: 100 }).toFile(dst);
    if ((m.width ?? 0) > 4096 || (m.height ?? 0) > 4096) avisos.push(`pagina ${p.name} tem ${m.width}x${m.height}: passa de 4096 (limite de textura de muitos celulares)`);
    paginas.push({ de: p.name, para: nome, largura: m.width ?? 0, altura: m.height ?? 0, bytesOrigem: statSync(src).size, bytes: statSync(dst).size });
    // compressao da pagina no jogo: o Godot importa textura nova sem perda; os jogos usam
    // WebP com perda nas paginas. Um .import minimo basta (o Godot completa o resto), e o
    // que ja existe nao e tocado
    const imp = dst + ".import";
    if (!existsSync(imp)) {
      const jogo = opts.jogo ?? { qualidade: 0.7 };
      writeFileSync(imp, `[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\n\n[params]\n\ncompress/mode=${jogo === "sem_perda" ? 0 : 1}\ncompress/lossy_quality=${jogo === "sem_perda" ? 0.7 : jogo.qualidade}\nmipmaps/generate=false\n`);
    }
    // a linha do nome da pagina no atlas (sozinha na linha)
    text = text.split(/\r?\n/).map((l) => (l.trim() === p.name ? nome : l)).join("\n");
  }
  writeFileSync(atlas, text);
  copyFileSync(opts.json, skeleton);
  writeFileSync(tres, tresText(root, atlas, skeleton, opts.defaultMix ?? 0));
  return { tres, skeleton, atlas, version, paginas, avisos, animacoes: Object.keys(json.animations ?? {}) };
}
