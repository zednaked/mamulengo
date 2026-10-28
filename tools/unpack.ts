// Desempacota um .atlas em PNGs soltos: npx tsx tools/unpack.ts <arquivo.atlas> <saida>
import { readFileSync } from "node:fs";
import { unpackAtlas } from "../server/atlas.ts";
const [atlas, out] = process.argv.slice(2);
const files = await unpackAtlas(atlas, readFileSync(atlas, "utf8"), out);
console.log(`${files.length} imagens em ${out}`);
