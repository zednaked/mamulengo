// Roda um comando de leitura do editor (query.*, os readonly: true) sobre um .boneco, sem editor
// aberto: o mesmo Document que o editor abre (o .boneco visto como spine-json + atlas virtuais,
// server/boneco.ts), as imagens recortadas das paginas como o /api/region do servidor (girada,
// corte e PMA desfeitos) e os filhos das instancias lidos do disco. Imprime o resultado em JSON.
// Comando que edita e recusado: para editar, o editor (tools/cli.ts) ou um script proprio.
//
//   npx tsx tools/rodar.ts <x.boneco> <comando> ['{json}']
//   npx tsx tools/rodar.ts <x.boneco> --lista        os comandos de leitura e os parametros
//
//   npx tsx tools/rodar.ts tests/boneco/pessoa/pessoa.boneco query.juntas '{"tol":10}'
//
// Sai 0 com o resultado na saida padrao; 1 com o erro do comando (ou recusa); 2 com uso errado.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp, { type Sharp } from "sharp";
import { atlasTexto, exportarSpine } from "../src/boneco/spine.ts";
import { serializeSpineJson } from "../src/core/format.ts";
import { parseAtlas } from "../src/core/atlas-text.ts";
import { Document } from "../src/core/document.ts";
import { executeAsync, getCommand, listCommands, type AssetProvider } from "../src/core/commands/index.ts";
import { lerBonecoArquivo } from "../server/boneco-binario.ts";
import { extractRegion } from "../server/atlas.ts";

const [arqArg, cmd, json] = process.argv.slice(2);
const uso = () => {
  console.error("uso: rodar.ts <x.boneco> <comando> ['{json}']  |  rodar.ts <x.boneco> --lista");
  process.exit(2);
};
if (!arqArg || !cmd) uso();
const arq = resolve(arqArg);
if (!arq.endsWith(".boneco") || !existsSync(arq)) {
  console.error(`não é um .boneco que existe: ${arq}`);
  process.exit(2);
}

if (cmd === "--lista") {
  const ro = listCommands().filter((c) => c.readonly);
  for (const c of ro) console.log(`${c.name}\n  ${c.summary}\n`);
  process.exit(0);
}

const falha = (msg: string): never => {
  // na saida padrao tambem (como o cli.ts): quem redireciona stderr ainda ve o erro
  console.log("ERRO:", msg);
  console.error("ERRO:", msg);
  process.exit(1);
};

let def;
try {
  def = getCommand(cmd);
} catch (e: any) {
  falha(e?.message ?? String(e));
}
if (!def!.readonly) falha(`${cmd} edita o personagem: rodar.ts só roda comandos de leitura (veja --lista)`);
let args: unknown = {};
if (json)
  try {
    args = JSON.parse(json);
  } catch (e: any) {
    falha(`json dos argumentos inválido: ${e?.message ?? e}`);
  }

// o mesmo documento que o editor abre de um .boneco (server/boneco.ts lerVirtual)
const b = lerBonecoArquivo(arq);
const atlas = atlasTexto(b);
const doc = Document.fromText(serializeSpineJson(exportarSpine(b).json, undefined, { reuse: false }), { text: atlas, pages: {} });
doc.file = { skeleton: arq + ".spine-json", atlas: arq + ".atlas", tres: arq };

// imagens: o recorte do servidor (/api/region), em RGBA nao premultiplicado
const { pages, regions } = parseAtlas(atlas);
const paginas = new Map<string, Sharp>();
const pagina = (nome: string) => {
  if (!paginas.has(nome)) paginas.set(nome, sharp(join(dirname(arq), nome)));
  return paginas.get(nome)!;
};
const provider: AssetProvider = {
  async image(nome) {
    const r = regions.find((x) => x.name === nome);
    if (!r) return null;
    const pg = pages.find((p) => p.name === r.page)!;
    if (!existsSync(join(dirname(arq), pg.name))) return null;
    const png = await extractRegion(pagina(pg.name), r, { unpremultiply: pg.pma });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data };
  },
  region(nome) {
    const r = regions.find((x) => x.name === nome);
    return r ? { width: r.originalWidth, height: r.originalHeight } : null;
  },
  async text(p) {
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  },
  async bytes(p) {
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  },
};

try {
  const [r] = await executeAsync(doc, { cmd, args }, "rodar", undefined, {}, provider);
  const out = (typeof r === "string" ? r : JSON.stringify(r, null, 1)) + "\n";
  process.stdout.write(out, () => process.exit(0));
} catch (e: any) {
  falha(e?.message ?? String(e));
}
