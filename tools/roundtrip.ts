// Gate de paridade 2: fidelidade de bytes do formato.
//  a) abrir e salvar sem editar devolve os mesmos bytes
//  b) editar um valor gera um diff minimo e o resultado continua lendo igual
//  c) serializar do zero (sem reaproveitar trechos) reproduz o estilo do exportador
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { scanSpineAssets } from "../server/godot.ts";
import { parseSpineJson, serializeSpineJson, sameDoc } from "../src/core/format.ts";

const root = process.argv[2] ?? process.cwd();
let a = 0, b = 0, c = 0, n = 0;
for (const asset of scanSpineAssets(root)) {
  n++;
  const raw = readFileSync(asset.skeleton, "utf8");
  const name = relative(root, asset.skeleton);

  if (serializeSpineJson(parseSpineJson(raw)) === raw) a++;
  else console.log("A", name);

  const doc = parseSpineJson(raw);
  const bone = doc.bones[doc.bones.length - 1];
  bone.x = (bone.x ?? 0) + 1.5;
  const out = serializeSpineJson(doc);
  let p = 0;
  while (raw[p] === out[p]) p++;
  let q = 0;
  while (q < raw.length - p && raw[raw.length - 1 - q] === out[out.length - 1 - q]) q++;
  const changed = raw.length - p - q;
  const okSem = sameDoc(parseSpineJson(out), doc);
  if (okSem && changed < 200) b++;
  else console.log("B", name, "trecho alterado:", changed, "semantica", okSem);

  const fresh = serializeSpineJson(parseSpineJson(raw), undefined, { reuse: false });
  if (fresh === raw) c++;
  else {
    let i = 0;
    while (raw[i] === fresh[i]) i++;
    console.log("C", name, "@" + i, JSON.stringify(raw.slice(Math.max(0, i - 40), i + 40)), "=>", JSON.stringify(fresh.slice(Math.max(0, i - 40), i + 40)));
  }
}
console.log(`a) sem edicao identico: ${a}/${n}\nb) edicao com diff minimo: ${b}/${n}\nc) estilo do exportador do zero: ${c}/${n}`);
