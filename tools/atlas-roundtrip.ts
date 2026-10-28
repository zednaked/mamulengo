// Gate do atlas: desempacota cada atlas do corpus, reempacota e confere que toda
// regiao sai identica (pixel a pixel) e que o spine-core le o atlas gerado.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import sharp from "sharp";
import { TextureAtlas } from "@esotericsoftware/spine-core";
import { scanSpineAssets } from "../server/godot.ts";
import { extractRegion, packAtlas, parseAtlas, unpackAtlas } from "../server/atlas.ts";

const [root, work] = process.argv.slice(2);
const seen = new Set<string>();
let ok = 0, n = 0, regionsTotal = 0;
for (const a of scanSpineAssets(root)) {
  if (seen.has(a.atlas)) continue;
  seen.add(a.atlas);
  n++;
  const dir = join(work, String(n));
  rmSync(dir, { recursive: true, force: true });
  const files = await unpackAtlas(a.atlas, readFileSync(a.atlas, "utf8"), join(dir, "img"));
  const packed = await packAtlas(files.map((f) => ({ name: relative(join(dir, "img"), f).replace(/\.png$/, ""), file: f })), { pageName: "p", maxSize: 4096 });
  mkdirSync(join(dir, "out"), { recursive: true });
  writeFileSync(join(dir, "out", "p.atlas"), packed.atlas);
  for (const p of packed.pages) writeFileSync(join(dir, "out", p.name), p.data);
  new TextureAtlas(packed.atlas); // o leitor oficial aceita?
  const { pages, regions } = parseAtlas(packed.atlas);
  let bad = 0;
  for (const r of regions) {
    const pg = sharp(join(dir, "out", pages.find((p) => p.name === r.page)!.name));
    const got = await sharp(await extractRegion(pg, r)).raw().toBuffer();
    const want = await sharp(join(dir, "img", r.name + ".png")).ensureAlpha().raw().toBuffer();
    // compara so o que e visivel (rgb sob alpha 0 nao importa)
    for (let i = 0; i < want.length; i += 4) {
      if (want[i + 3] === 0 && got[i + 3] === 0) continue;
      if (want[i] !== got[i] || want[i + 1] !== got[i + 1] || want[i + 2] !== got[i + 2] || want[i + 3] !== got[i + 3]) {
        bad++;
        break;
      }
    }
  }
  regionsTotal += regions.length;
  const sizeBefore = parseAtlas(readFileSync(a.atlas, "utf8")).pages.map((p) => `${p.width}x${p.height}`).join("+");
  const sizeAfter = pages.map((p) => `${p.width}x${p.height}`).join("+");
  if (!bad) ok++;
  console.log(`${bad ? "FALHA" : "ok   "} ${basename(a.atlas)}: ${regions.length} regioes, paginas ${sizeBefore} -> ${sizeAfter}${bad ? `, ${bad} regioes diferentes` : ""}`);
}
console.log(`${ok}/${n} atlas reempacotados identicos (${regionsTotal} regioes)`);
