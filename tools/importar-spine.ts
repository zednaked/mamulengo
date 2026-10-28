// Importa um export do Spine (json + atlas + paginas) para um projeto Godot no formato dos
// jogos (.spine-json, .atlas, paginas, -data.tres), com nomes coerentes.
//   npx tsx tools/importar-spine.ts <export.json | pasta do export> <pasta no projeto> [--name nome] [--webp 90|lossless] [--mix 0.1] [--qualidade 0.7 | --sem-perda] [--force]
// As paginas ganham um .import com a compressao do jogo (WebP com perda 0.7, a dos jogos;
// --qualidade muda, --sem-perda desliga), se ainda nao tiverem.
// Na pasta do export: um .json e um .atlas (se houver mais de um atlas, o de nome parecido
// com o do json). Imprime o que fez, as paginas (tamanho antes e depois) e os avisos.
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { importExport } from "../server/assets.ts";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const name = opt("name");
const webp = opt("webp");
const mix = opt("mix");
const qualidade = opt("qualidade");
const semPerda = args.includes("--sem-perda") ? (args.splice(args.indexOf("--sem-perda"), 1), true) : false;
const force = args.includes("--force") ? (args.splice(args.indexOf("--force"), 1), true) : false;
const [src, dir] = args;
if (!src || !dir) {
  console.error("uso: importar-spine.ts <export.json | pasta> <pasta no projeto> [--name n] [--webp 90|lossless] [--mix 0.1] [--force]");
  process.exit(2);
}
const isDir = statSync(src).isDirectory();
const exp = isDir ? resolve(src) : dirname(resolve(src));
const files = readdirSync(exp);
const json = isDir ? files.filter((f) => f.endsWith(".json")).map((f) => join(exp, f)) : [resolve(src)];
if (json.length !== 1) throw new Error(`esperava um .json em ${exp}, achei ${json.length}: passe o arquivo`);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const base = norm(basename(json[0], ".json"));
const atlases = files.filter((f) => f.endsWith(".atlas"));
if (!atlases.length) throw new Error(`nenhum .atlas em ${exp}`);
const atlas = atlases.length === 1 ? atlases[0] : (atlases.find((a) => norm(basename(a, ".atlas")) === base) ?? atlases.find((a) => base.startsWith(norm(basename(a, ".atlas")))));
if (!atlas) throw new Error(`mais de um .atlas em ${exp} e nenhum com nome parecido com o json: ${atlases.join(", ")}`);
const nome = name ?? basename(json[0], ".json").toLowerCase().replace(/[^\w.-]+/g, "_");
const r = await importExport({ json: json[0], atlas: join(exp, atlas), dir: resolve(dir), name: nome, webp: webp === undefined ? undefined : webp === "lossless" ? "lossless" : Number(webp), defaultMix: mix ? Number(mix) : undefined, force, jogo: semPerda ? "sem_perda" : qualidade ? { qualidade: Number(qualidade) } : undefined });
const mb = (b: number) => (b / 1e6).toFixed(2);
console.log(`${nome}: Spine ${r.version}, ${r.animacoes.length} animacoes (${r.animacoes.join(", ")})`);
console.log(`  de ${basename(json[0])} + ${atlas} -> ${r.tres}`);
for (const p of r.paginas) console.log(`  pagina ${p.de} -> ${p.para}: ${p.largura}x${p.altura}, ${mb(p.bytesOrigem)} -> ${mb(p.bytes)} MB`);
for (const a of r.avisos) console.log(`  AVISO ${a}`);
