// Empacota o motor web do Mamulengo (o que um jogo precisa para construir e empacotar o cliente dele)
// num .tgz que o npm instala direto pela URL da release:
//
//   "devDependencies": { "mamulengo-motor": "https://github.com/zednaked/mamulengo/releases/download/motor-0.1.0/mamulengo-motor-0.1.0.tgz" }
//
// O jogo passa a ter o motor em node_modules/mamulengo-motor (o package-lock.json guarda o hash, o
// `npm ci` confere), em vez de uma copia dentro do repositorio dele. O que vai:
//   src/      a tela e a cena (src/tela, src/cena) e o que elas importam
//   nucleo/   nucleo.mjs e nucleo.wasm (de nucleo/build-web; compile antes)
//   tools/    as ferramentas do pacote (imagens reduzidas e comprimidas, bonecos em binario)
//   VERSAO    a versao e o commit de onde saiu
//
//   node tools/motor-pacote.mjs <versao> [pasta de saida, padrao dist-motor]
// O .tgz sai igual byte a byte para as mesmas fontes (ordem, datas e donos fixos).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versao = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(versao ?? "")) {
  console.error("uso: node tools/motor-pacote.mjs <versao x.y.z> [pasta de saida]");
  process.exit(1);
}
const SAIDA = resolve(process.argv[3] ?? join(RAIZ, "dist-motor"));
const FERRAMENTAS = ["tools/binario-web.ts", "tools/comprimir-imagens.ts", "tools/reduzir-imagens.ts"];
const NUCLEO = ["nucleo/build-web/nucleo.mjs", "nucleo/build-web/nucleo.wasm"];
for (const f of NUCLEO) {
  if (!existsSync(join(RAIZ, f))) { console.error(`falta ${f}: compile o nucleo para a web antes (docs/NUCLEO.md)`); process.exit(1); }
}

// as fontes: tudo de src/tela e src/cena, as ferramentas, e o que eles importam (o esbuild lista)
const entradas = [
  ...["src/tela", "src/cena"].flatMap((d) => readdirSync(join(RAIZ, d)).filter((f) => f.endsWith(".ts")).map((f) => `${d}/${f}`)),
  ...FERRAMENTAS,
];
const { metafile } = await build({
  absWorkingDir: RAIZ, entryPoints: entradas, bundle: true, write: false, metafile: true,
  outdir: "nada", platform: "node", format: "esm", packages: "external", logLevel: "error",
});
const fontes = Object.keys(metafile.inputs).sort();
const fora = fontes.filter((f) => !/^(src|tools)\//.test(f));
if (fora.length) { console.error("fonte fora de src/ e tools/: " + fora.join(", ")); process.exit(1); }

const commit = execFileSync("git", ["-C", RAIZ, "rev-parse", "--short", "HEAD"]).toString().trim();
const sujo = execFileSync("git", ["-C", RAIZ, "status", "--porcelain", "--", "src", "tools", "nucleo/src", "nucleo/include", "nucleo/web"]).toString().trim();
const TMP = join(SAIDA, ".montagem");
const P = join(TMP, "package");
rmSync(TMP, { recursive: true, force: true });
for (const f of fontes) { mkdirSync(dirname(join(P, f)), { recursive: true }); cpSync(join(RAIZ, f), join(P, f)); }
mkdirSync(join(P, "nucleo"), { recursive: true });
for (const f of NUCLEO) cpSync(join(RAIZ, f), join(P, "nucleo", f.split("/").pop()));
cpSync(join(RAIZ, "LICENSE"), join(P, "LICENSE"));
writeFileSync(join(P, "VERSAO"), `${versao} (zednaked/mamulengo ${commit}${sujo ? ", com mudanca sem commit" : ""})\n`);
writeFileSync(join(P, "package.json"), JSON.stringify({
  name: "mamulengo-motor",
  version: versao,
  description: "O motor web do Mamulengo para o cliente de um jogo: a tela, a cena, o nucleo (wasm) e as ferramentas do pacote.",
  license: "MIT",
  type: "module",
  repository: { type: "git", url: "git+https://github.com/zednaked/mamulengo.git" },
}, null, 2) + "\n");

const tgz = join(SAIDA, `mamulengo-motor-${versao}.tgz`);
const tar = join(TMP, "motor.tar");
execFileSync("tar", ["--sort=name", "--mtime=2020-01-01 00:00:00Z", "--owner=0", "--group=0", "--numeric-owner", "--mode=u=rwX,go=rX", "-cf", tar, "-C", TMP, "package"]);
writeFileSync(tgz, execFileSync("gzip", ["-n", "-9", "-c", tar], { maxBuffer: 64 << 20 }));
rmSync(TMP, { recursive: true, force: true });

const dado = readFileSync(tgz);
console.log(`${tgz}: ${fontes.length} fontes + nucleo, ${(dado.length / 1024).toFixed(0)} KB`);
console.log(`sha256 ${createHash("sha256").update(dado).digest("hex")}`);
if (sujo) console.log("AVISO: ha mudanca sem commit nas fontes do motor");
