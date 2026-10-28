// Levantamento: de onde viria a textura de cada pagina de atlas (import do Godot ou fonte).
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { scanSpineAssets } from "../server/godot.ts";
import { textureFor } from "../server/texture.ts";
const root = process.argv[2];
const seen = new Set<string>();
const count: Record<string, number> = {};
for (const a of scanSpineAssets(root)) {
  const pages = readFileSync(a.atlas, "utf8").split("\n").filter((l, i, ls) => /\.(png|webp|jpg)$/i.test(l.trim()) && (i === 0 || ls[i - 1].trim() === ""));
  for (const p of pages) {
    const f = join(dirname(a.atlas), p.trim());
    if (seen.has(f)) continue;
    seen.add(f);
    const t = textureFor(f);
    const k = t.origin + (t.note ? ` (${t.note})` : "");
    count[k] = (count[k] ?? 0) + 1;
    if (t.origin === "source") console.log(relative(root, f), "->", t.note);
  }
}
console.log(count);
