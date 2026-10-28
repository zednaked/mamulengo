// Kits do teste de aceitacao a partir do corpus livre: um por personagem de
// tests/assets (imagens + layout + referencias + projeto Godot vazio), sem nenhum
// asset privado. Chama tools/acceptance-kit.ts para cada rig.
//
//   npx tsx tools/corpus-kit.ts <saida> [--from <raiz do corpus>] [--spine <projeto>] [--frames 8]
//
// Precisa do editor aberto com a raiz do corpus em MAMULENGO_ROOTS (as folhas de
// contato sao renderizadas por ele). --from aceita a copia feita por corpus-project.ts.
// --spine: de onde emprestar a GDExtension do spine-godot para o projeto/ de cada kit.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS, PERSONAGENS } from "./corpus-build.ts";

const argv = process.argv.slice(2);
const opt = (k: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
const out = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (!out) {
  console.error("uso: corpus-kit.ts <saida> [--from <raiz do corpus>] [--spine <projeto>] [--frames 8]");
  process.exit(2);
}
const from = resolve(opt("from") ?? CORPUS);
const kit = join(dirname(fileURLToPath(import.meta.url)), "acceptance-kit.ts");
const lines: string[] = [];
for (const p of PERSONAGENS) {
  const tres = join(from, p.nome, "rig", `${p.nome}-data.tres`);
  if (!existsSync(tres)) throw new Error(`rig nao achado: ${tres}`);
  const args = ["tsx", kit, tres, join(resolve(out), p.nome), "--anims", p.anims.join(",")];
  if (opt("frames")) args.push("--frames", opt("frames")!);
  if (opt("spine")) args.push("--spine", resolve(opt("spine")!));
  execFileSync("npx", args, { stdio: "inherit" });
  lines.push(`- ${p.nome}/: ${p.anims.join(", ")}`);
}
writeFileSync(
  join(resolve(out), "LEIAME.md"),
  `# Kits de aceitacao do corpus livre

Arte CC0 (Kenney), ver tests/assets/LICENSES.md no repo do Mamulengo. Cada pasta e um
kit completo (KIT.md dentro): recriar o asset a partir das imagens, do layout e das
folhas de referencia.

${lines.join("\n")}
`,
);
console.log(`kits em ${resolve(out)}`);
