// Gate de paridade 1: o runtime oficial (spine-core) le e toca todo asset Spine
// encontrado, resolvendo o atlas pelo .tres como o spine-godot faz.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, AnimationState, AnimationStateData } from "@esotericsoftware/spine-core";
import { scanSpineAssets } from "../server/godot.ts";

const root = process.argv[2] ?? process.cwd();
const assets = scanSpineAssets(root);
const seen = new Set<string>();
let ok = 0;
for (const a of assets) {
  seen.add(a.skeleton);
  try {
    const atlas = new TextureAtlas(readFileSync(a.atlas, "utf8"));
    const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(readFileSync(a.skeleton, "utf8"));
    const sk = new Skeleton(data);
    const state = new AnimationState(new AnimationStateData(data));
    for (const anim of data.animations) {
      state.setAnimation(0, anim.name, false);
      for (let t = 0; t <= anim.duration + 1 / 30; t += 1 / 30) {
        state.update(1 / 30);
        state.apply(sk);
        sk.update(1 / 30);
        sk.updateWorldTransform(Physics.update);
      }
    }
    ok++;
  } catch (e: any) {
    console.log("FAIL", relative(root, a.tres), "-", String(e?.message ?? e).slice(0, 160));
  }
}
console.log(`${ok}/${assets.length} assets ok (${seen.size} esqueletos distintos)`);
