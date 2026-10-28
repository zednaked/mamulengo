// Projeto Godot de trabalho com o corpus livre (tests/assets) e a GDExtension do
// spine-godot emprestada de outro projeto (os binarios nao entram no repo). Serve para
// rodar a paridade com o Godot de verdade e o teste de aceitacao sem assets privados.
// Roda o import do Godot (headless) uma vez no projeto gerado.
//
//   npx tsx tools/corpus-project.ts <saida> --spine <projeto Godot com spine-godot>
//   npx tsx tools/parity.ts <saida>/monstro/rig/monstro-data.tres --anim all
import { cpSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CORPUS } from "./corpus-build.ts";
import { ensureImported, linkSpineExtension } from "../server/godot-run.ts";
import { parseAtlas } from "../server/atlas.ts";
import { scanSpineAssets } from "../server/godot.ts";

const argv = process.argv.slice(2);
const spine = argv.includes("--spine") ? resolve(argv[argv.indexOf("--spine") + 1]) : null;
const out = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--spine");
if (!out || !spine) {
  console.error("uso: corpus-project.ts <saida> --spine <projeto Godot com spine-godot>");
  process.exit(2);
}
const dst = resolve(out);
rmSync(dst, { recursive: true, force: true });
cpSync(CORPUS, dst, { recursive: true });
if (!linkSpineExtension(dst, spine)) {
  console.error(`sem .gdextension em ${spine}`);
  process.exit(1);
}
// importa uma vez (o spine-godot so carrega .atlas/.spine-json importados)
const files = scanSpineAssets(dst).flatMap((a) => [a.skeleton, a.atlas, ...parseAtlas(readFileSync(a.atlas, "utf8")).pages.map((p) => join(dirname(a.atlas), p.name))]);
await ensureImported(dst, files);
console.log(`projeto em ${dst} (spine-godot de ${spine}), importado`);
