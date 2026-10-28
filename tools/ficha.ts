// Ficha do personagem pela linha de comando, com o contexto do jogo (que o editor nao ve):
// onde o codigo Godot chama cada animacao, o que toca depois e os mixes do -data.tres.
//
//   npx tsx tools/ficha.ts draft <x-data.tres | x.spine-json> [--out arquivo.md] [--name Nome]
//   npx tsx tools/ficha.ts check <ficha.md> [--asset x.spine-json] [--anims a,b]
//
// Sem --out, o rascunho sai ao lado do .spine-json como <nome>.ficha.md (nao sobrescreve:
// se ja existir, sai como .ficha.rascunho.md). check sai com codigo 1 se alguma regra falhar.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { checkFicha, draftFicha } from "../src/core/ficha.ts";
import { gameContext, skeletonOf } from "../server/ficha-context.ts";

const [cmd, target, ...rest] = process.argv.slice(2);
const opt = (k: string) => {
  const i = rest.indexOf(`--${k}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

if (cmd === "draft" && target) {
  const { json: jp, tres } = skeletonOf(target);
  const json = JSON.parse(readFileSync(jp, "utf8"));
  const name = opt("name") ?? basename(jp).replace(/\.(spine-json|json)$/, "");
  const ctx = gameContext(jp, tres, Object.keys(json.animations ?? {}));
  const md = draftFicha(json, name, ctx);
  let out = opt("out") ?? join(dirname(jp), `${name}.ficha.md`);
  if (!opt("out") && existsSync(out)) out = out.replace(/\.ficha\.md$/, ".ficha.rascunho.md");
  writeFileSync(out, md);
  console.log(out);
} else if (cmd === "check" && target) {
  const md = readFileSync(target, "utf8");
  const asset = opt("asset") ?? join(dirname(target), basename(target).replace(/\.ficha(\.rascunho)?\.md$/, ".spine-json"));
  const json = JSON.parse(readFileSync(asset, "utf8"));
  const res = checkFicha(json, md, opt("anims")?.split(","));
  let fails = 0;
  for (const [a, rs] of Object.entries(res)) {
    console.log(`== ${a}`);
    for (const r of rs) {
      if (!r.ok) fails++;
      console.log(`${r.ok ? "ok   " : "FALHA"} ${r.rule}: ${r.detail}`);
    }
  }
  console.log(fails ? `${fails} regra(s) falharam` : "tudo de acordo com a ficha");
  process.exit(fails ? 1 : 0);
} else {
  console.error("uso: ficha.ts draft <x-data.tres|x.spine-json> [--out f.md] [--name N] | check <ficha.md> [--asset x.spine-json] [--anims a,b]");
  process.exit(2);
}
