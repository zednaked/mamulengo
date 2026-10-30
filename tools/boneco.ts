// .boneco na linha de comando (docs/FORMATO.md):
//   npx tsx tools/boneco.ts importar <x-data.tres | x.json> <saida.boneco> [--multiply certo|motor]
//   npx tsx tools/boneco.ts exportar <x.boneco> <pasta> [--nome n]
//   npx tsx tools/boneco.ts binario <x.boneco> <saida.boneco>   (para entregar ao jogo)
//   npx tsx tools/boneco.ts texto <x.boneco> <saida.boneco>     (de volta ao texto, para editar)
// importar le o JSON 4.3 do Spine e o atlas (pelo -data.tres, ou o .atlas ao lado), e leva
// junto o mix (-data.tres), a ficha (.ficha.md) e a compressao das paginas (.import do
// Godot). As paginas sao copiadas para a pasta do .boneco. exportar faz o caminho de volta:
// <nome>.spine-json, .atlas, paginas, -data.tres (com o mix, se a pasta estiver num projeto
// Godot), .ficha.md e o .import das paginas.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { exportarSpine, importarSpine, type Boneco } from "../src/boneco/spine.ts";
import { findProjectRoot, parseMixes, parseSkeletonDataTres } from "../server/godot.ts";
import { tresText } from "../server/assets.ts";
import { serializeSpineJson } from "../src/core/format.ts";
import { gravarBonecoArquivo, lerBonecoArquivo } from "../server/boneco-binario.ts";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const multiply = opt("multiply") as "certo" | "motor" | undefined;
const nomeOpt = opt("nome");
const [acao, de, para] = args;

// compressao da pagina no jogo, do .import do Godot (compress/mode 1 = com perda)
function jogoDe(pagina: string) {
  const imp = pagina + ".import";
  if (!existsSync(imp)) return undefined;
  const t = readFileSync(imp, "utf8");
  const modo = /^compress\/mode=(\d)/m.exec(t)?.[1];
  const q = /^compress\/lossy_quality=([\d.]+)/m.exec(t)?.[1];
  return modo === "1" ? { compressao: "perda", qualidade: Number(q ?? 0.7) } : modo === "0" ? { compressao: "sem_perda" } : undefined;
}

if (acao === "importar") {
  if (!de || !para) throw new Error("importar <x-data.tres | x.json> <saida.boneco>");
  let json = resolve(de),
    atlas: string,
    mix: any;
  if (de.endsWith("-data.tres")) {
    const a = parseSkeletonDataTres(resolve(de));
    if (!a) throw new Error(`nao e um -data.tres do Spine: ${de}`);
    json = a.skeleton;
    atlas = a.atlas;
    const t = readFileSync(resolve(de), "utf8");
    const pad = /^default_mix\s*=\s*([\d.]+)/m.exec(t)?.[1];
    const pares = parseMixes(t);
    if (pad !== undefined || pares.length) mix = { padrao: Number(pad ?? 0), ...(pares.length ? { pares: pares.map((p) => ({ de: p.from, para: p.to, tempo: p.mix })) } : {}) };
  } else {
    const at = readdirSync(dirname(json)).filter((f) => f.endsWith(".atlas"));
    if (at.length !== 1) throw new Error(`passe o -data.tres: ${at.length} .atlas em ${dirname(json)}`);
    atlas = join(dirname(json), at[0]);
  }
  const nome = nomeOpt ?? basename(para, ".boneco");
  const b = importarSpine(JSON.parse(readFileSync(json, "utf8")), readFileSync(atlas, "utf8"), nome, { multiply });
  if (mix) b.mix = mix;
  const ficha = json.replace(/\.(spine-json|json)$/, ".ficha.md");
  if (existsSync(ficha)) b.ficha = { texto: readFileSync(ficha, "utf8") };
  const out = resolve(para);
  mkdirSync(dirname(out), { recursive: true });
  for (const p of b.paginas) {
    const src = join(dirname(atlas), p.arquivo);
    const jogo = jogoDe(src);
    if (jogo) p.jogo = jogo;
    if (resolve(dirname(out), p.arquivo) !== src) copyFileSync(src, join(dirname(out), p.arquivo));
  }
  writeFileSync(out, JSON.stringify(b, null, 1) + "\n");
  console.log(`${out}: ${b.ossos?.length ?? 0} ossos, ${b.slots?.length ?? 0} slots, ${Object.keys(b.animacoes ?? {}).length} animacoes, ${b.paginas.length} paginas${mix ? ", mix" : ""}${b.ficha ? ", ficha" : ""}`);
} else if (acao === "exportar") {
  if (!de || !para) throw new Error("exportar <x.boneco> <pasta>");
  const b: Boneco = lerBonecoArquivo(resolve(de));
  const nome = nomeOpt ?? b.nome ?? basename(de, ".boneco");
  const dir = resolve(para);
  mkdirSync(dir, { recursive: true });
  const e = exportarSpine(b, { soSpine: true });
  const skel = join(dir, `${nome}.spine-json`),
    atlas = join(dir, `${nome}.atlas`);
  writeFileSync(skel, serializeSpineJson(e.json, undefined, { reuse: false }));
  writeFileSync(atlas, e.atlas);
  for (const p of b.paginas) {
    const src = join(dirname(resolve(de)), p.arquivo);
    if (resolve(dir, p.arquivo) !== src) copyFileSync(src, join(dir, p.arquivo));
    if (p.jogo) writeFileSync(join(dir, p.arquivo + ".import"), `[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\n\n[params]\n\ncompress/mode=${p.jogo.compressao === "perda" ? 1 : 0}\ncompress/lossy_quality=${p.jogo.qualidade ?? 0.7}\nmipmaps/generate=false\n`);
  }
  if (b.ficha?.texto) writeFileSync(join(dir, `${nome}.ficha.md`), b.ficha.texto);
  const root = findProjectRoot(dir);
  if (root) {
    let t = tresText(root, atlas, skel, b.mix?.padrao ?? 0);
    // mix por par: um SpineAnimationMix por par, listados em animation_mixes
    const pares: any[] = b.mix?.pares ?? [];
    if (pares.length) {
      const subs = pares.map((m, i) => `[sub_resource type="SpineAnimationMix" id="mix${i + 1}"]\nfrom = "${m.de}"\nto = "${m.para}"\nmix = ${m.tempo}\n`).join("\n");
      t = t.replace("\n[resource]", `\n${subs}\n[resource]`).trimEnd() + `\nanimation_mixes = [${pares.map((_, i) => `SubResource("mix${i + 1}")`).join(", ")}]\n`;
    }
    writeFileSync(join(dir, `${nome}-data.tres`), t);
  }
  console.log(`${skel}${root ? " + -data.tres" : ""}`);
  for (const a of e.avisos) console.log(`  AVISO ${a}`);
} else if (acao === "binario" || acao === "texto") {
  // docs/FORMATO.md "Binario": o binario e a forma de entrega (menor, carrega mais rapido); o
  // editor abre os dois. A mesma arvore, conferida numero a numero pelo nucleo-binario
  if (!de || !para) throw new Error(`${acao} <x.boneco> <saida.boneco>`);
  const antes = readFileSync(resolve(de)).length;
  gravarBonecoArquivo(resolve(para), lerBonecoArquivo(resolve(de)), acao === "binario");
  console.log(`${resolve(para)}: ${acao}, ${antes} -> ${readFileSync(resolve(para)).length} bytes`);
} else {
  console.error("uso: boneco.ts importar <x-data.tres | x.json> <saida.boneco> | exportar <x.boneco> <pasta> | binario|texto <x.boneco> <saida.boneco>");
  process.exit(2);
}
