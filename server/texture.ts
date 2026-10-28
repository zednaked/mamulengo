// Textura como o jogo ve. O Godot nao usa a imagem-fonte: ele importa (fix_alpha_border,
// compressao com perda...) para .godot/imported/*.ctex. Para paridade de texel servimos
// esse .ctex quando ele existe e esta em dia com a fonte; senao, a fonte, e o editor
// emula o fix_alpha_border.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { findProjectRoot, resPath } from "./godot.ts";
import { dirname, join } from "node:path";

export interface TextureSource {
  body: Buffer;
  mime: string;
  // "godot-import": bytes do .ctex; "source": arquivo original
  origin: "godot-import" | "source";
  // o editor deve aplicar fix_alpha_border (fonte sem import em dia)
  fixAlphaBorder: boolean;
  note?: string;
  // filtro de canvas do projeto Godot (o spine-godot ignora o filtro declarado no atlas):
  // "nearest" ou "linear" (o import nao gera mipmaps, entao linear simples)
  godotFilter: "nearest" | "linear" | "linear-mipmaps" | "nearest-mipmaps";
  // o spine-godot do projeto desenha two-color tint (cor escura)?
  tintBlack: boolean;
}

// O spine-godot so desenha a cor escura (two-color tint) a partir do build que traz o
// shader "tint black" (SpineSprite.cpp: light_color/dark_color com CUSTOM0/CUSTOM1).
// O binario que os jogos usam hoje nao tem: a cor escura e ignorada (medido com
// tools/blend-fixture.ts). Olha o binario do editor Linux declarado no .gdextension.
const tintCache = new Map<string, { mtime: number; value: boolean }>();
export function projectTintBlack(root: string | null): boolean {
  if (!root) return false;
  let ext: string | undefined;
  try {
    ext = readdirSync(root).find((f) => f.endsWith(".gdextension") && /spine/i.test(readFileSync(join(root, f), "utf8")));
  } catch {
    return false;
  }
  if (!ext) return false;
  const text = readFileSync(join(root, ext), "utf8");
  const lib = /^linux\.editor\.x86_64\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? /^linux\.debug\.x86_64\s*=\s*"([^"]+)"/m.exec(text)?.[1];
  if (!lib) return false;
  const file = resPath(root, lib);
  if (!existsSync(file)) return false;
  const mtime = statSync(file).mtimeMs;
  const hit = tintCache.get(file);
  if (hit && hit.mtime === mtime) return hit.value;
  const value = readFileSync(file).includes("dark_color = CUSTOM0");
  tintCache.set(file, { mtime, value });
  return value;
}

// rendering/textures/canvas_textures/default_texture_filter: 0 nearest, 1 linear,
// 2 linear+mipmaps, 3 nearest+mipmaps (padrao do Godot 4: 1)
export function projectFilter(root: string | null): TextureSource["godotFilter"] {
  if (!root) return "linear";
  const text = existsSync(join(root, "project.godot")) ? readFileSync(join(root, "project.godot"), "utf8") : "";
  const v = /^textures\/canvas_textures\/default_texture_filter=(\d)/m.exec(text)?.[1];
  return v === "0" ? "nearest" : v === "2" ? "linear-mipmaps" : v === "3" ? "nearest-mipmaps" : "linear";
}

function importParams(file: string): Record<string, string> {
  const p = file + ".import";
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([\w/]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

// CompressedTexture2D (GST2): cabecalho de 36 bytes, depois o bloco de imagem:
// data_format u32 (0 raw, 1 png, 2 webp, 3 basis), w u16, h u16, mipmaps u32, format u32,
// e para png/webp: tamanho u32 + bytes do nivel 0.
export function extractCtex(buf: Buffer): { mime: string; body: Buffer } | null {
  if (buf.toString("latin1", 0, 4) !== "GST2") return null;
  let o = 36;
  const dataFormat = buf.readUInt32LE(o);
  o += 4 + 2 + 2 + 4 + 4;
  if (dataFormat !== 1 && dataFormat !== 2) return null;
  const size = buf.readUInt32LE(o);
  o += 4;
  return { mime: dataFormat === 1 ? "image/png" : "image/webp", body: buf.subarray(o, o + size) };
}

export function textureFor(file: string): TextureSource {
  const params = importParams(file);
  const fixAlphaBorder = (params["process/fix_alpha_border"] ?? "true") === "true";
  const root = findProjectRoot(dirname(file));
  const godotFilter = projectFilter(root);
  const tintBlack = projectTintBlack(root);
  const source = (note?: string): TextureSource => ({
    godotFilter,
    tintBlack,
    body: readFileSync(file),
    mime: file.endsWith(".png") ? "image/png" : "image/webp",
    origin: "source",
    fixAlphaBorder,
    note,
  });
  const dest = params["path"];
  if (!dest || !root) return source("sem .import: emulando o import do Godot");
  const ctex = resPath(root, dest);
  if (!existsSync(ctex)) return source("projeto ainda nao importado pelo Godot: emulando o import");
  // o .md5 ao lado do .ctex guarda o md5 da fonte no momento do import
  const md5File = ctex.replace(/\.ctex$/, ".md5");
  if (existsSync(md5File)) {
    const want = /source_md5="([0-9a-f]+)"/.exec(readFileSync(md5File, "utf8"))?.[1];
    const have = createHash("md5").update(readFileSync(file)).digest("hex");
    if (want && want !== have) return source("import do Godot desatualizado (fonte mudou): emulando ate reimportar");
  }
  const x = extractCtex(readFileSync(ctex));
  if (!x) return source("formato de .ctex sem decoder aqui (VRAM/basis): emulando o import");
  return { ...x, origin: "godot-import", fixAlphaBorder: false, godotFilter, tintBlack };
}
