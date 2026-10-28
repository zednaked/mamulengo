// Fumaca dos comandos contra um asset real (caminho do .tres por argumento; asset fora do repo).
import { readFileSync } from "node:fs";
import { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } from "@esotericsoftware/spine-core";
import { parseSkeletonDataTres } from "../server/godot.ts";
import { Document } from "../src/core/document.ts";
import { execute } from "../src/core/commands/index.ts";

const asset = parseSkeletonDataTres(process.argv[2])!;
const raw = readFileSync(asset.skeleton, "utf8");
const atlasText = readFileSync(asset.atlas, "utf8");
const doc = Document.fromText(raw, { text: atlasText, pages: {} });
const load = () => new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
const x = (cmd: string, args: any) => execute(doc, { cmd, args }, "smoke")[0];

console.log(x("skeleton.info", {}).animations);
console.log(x("query.tree", { depth: 3 }));
const head = "head";
x("animation.create", { name: "zz_teste" });
const T = { bone: head };
x("key.set", { anim: "zz_teste", target: T, timeline: "rotate", time: 0, value: 0, curve: "elastico" });
x("key.set", { anim: "zz_teste", target: T, timeline: "rotate", time: 1, value: 20 });
const curve1 = doc.json.animations.zz_teste.bones.head.rotate[0].curve;
// muda o valor da chave final: a curva tem que escalar junto (mesmo formato)
x("key.set", { anim: "zz_teste", target: T, timeline: "rotate", time: 1, value: 40 });
const curve2 = doc.json.animations.zz_teste.bones.head.rotate[0].curve;
console.log("curva antes", curve1, "depois", curve2, curve2[1] === curve1[1] * 2 && curve2[3] === curve1[3] * 2 ? "OK escala" : "ERRO");
// chave no meio herda a curva do segmento
x("key.set", { anim: "zz_teste", target: T, timeline: "rotate", time: 0.5, value: 10 });
x("key.set", { anim: "zz_teste", target: T, timeline: "translate", time: 0.25, x: 5, y: -3, curve: "suave" });
x("key.set", { anim: "zz_teste", target: T, timeline: "translate", time: 0.75, x: 0, y: 0 });
x("key.move", { anim: "zz_teste", target: T, timeline: "rotate", time: 0.5, to: 0.8 });
x("key.delete", { anim: "zz_teste", target: T, timeline: "rotate", time: 0.8 });
x("bone.set", { bone: head, rotation: 3 });
console.log(x("query.animation", { name: "zz_teste", detail: true }).rows);
const sd = load();
console.log("runtime le:", sd.findAnimation("zz_teste")!.duration, "s");
// lote atomico: o segundo comando falha, o primeiro nao pode ficar
try {
  execute(doc, [{ cmd: "bone.set", args: { bone: head, x: 999 } }, { cmd: "bone.set", args: { bone: "nao_existe", x: 1 } }], "smoke");
} catch (e: any) {
  console.log("lote falhou como esperado:", e.message.slice(0, 90));
}
console.log("x do osso apos lote falho:", doc.json.bones.find((b: any) => b.name === head).x);
while (doc.canUndo()) doc.undo();
console.log("undo total volta aos bytes originais:", doc.serialize() === raw ? "OK" : "ERRO");
while (doc.canRedo()) doc.redo();
console.log("redo total:", doc.json.animations.zz_teste ? "OK" : "ERRO");
