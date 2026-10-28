// Teste do corpus livre (tests/assets, arte CC0): roda so com o que esta no repo e
// cobre o que os gates fazem com os assets dos jogos.
//  1. o runtime oficial (spine-core) le cada rig pelo -data.tres e toca todas as
//     animacoes com fisica; o rig tem malha com pesos, fisica e idle
//  2. formato: abrir e salvar devolve os mesmos bytes (com e sem reaproveitar trechos)
//  3. atlas: desempacotar e reempacotar devolve o mesmo .atlas e os mesmos pixels, e
//     cada regiao e identica a parte original (tests/assets/<nome>/partes)
//  4. o layout medido pelo kit de aceitacao (tools/layout.ts) devolve as pecas onde o
//     build as pos (centro, rotacao, espelho, escala, ordem)
//  5. o rig do repo e exatamente o que tools/corpus-build.ts monta hoje (se um comando
//     mudar de comportamento, este teste acusa; regenere com o build e revise o diff)
//
//   npx tsx tests/corpus.ts
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import sharp from "sharp";
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, Physics, Skeleton, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-core";
import { scanSpineAssets } from "../server/godot.ts";
import { extractRegion, packAtlas, parseAtlas, unpackAtlas } from "../server/atlas.ts";
import { parseSpineJson, serializeSpineJson } from "../src/core/format.ts";
import { Document } from "../src/core/document.ts";
import { CORPUS, PERSONAGENS, build } from "../tools/corpus-build.ts";
import { artLayout } from "../tools/layout.ts";
import { checkFicha } from "../src/core/ficha.ts";

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FALHA"} ${msg}`);
  if (!ok) failures++;
};
const firstDiff = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `@${i}: ${JSON.stringify(a.slice(Math.max(0, i - 30), i + 30))} => ${JSON.stringify(b.slice(Math.max(0, i - 30), i + 30))}`;
};
const rgba = async (img: Buffer | string) => sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
// mesmos pixels visiveis (rgb sob alpha 0 nao importa)
function samePixels(a: { data: Buffer; info: any }, b: { data: Buffer; info: any }) {
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return false;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] === 0 && b.data[i + 3] === 0) continue;
    for (let c = 0; c < 4; c++) if (a.data[i + c] !== b.data[i + c]) return false;
  }
  return true;
}

const work = mkdtempSync(join(tmpdir(), "mamulengo-corpus-"));
const assets = scanSpineAssets(CORPUS);
check(assets.length === PERSONAGENS.length, `${assets.length} rigs achados pelo -data.tres em tests/assets (esperado ${PERSONAGENS.length})`);

for (const p of PERSONAGENS) {
  const a = assets.find((x) => basename(x.skeleton) === `${p.nome}.spine-json`);
  if (!a) {
    check(false, `${p.nome}: rig nao achado`);
    continue;
  }
  console.log(`--- ${p.nome} (${relative(CORPUS, a.tres)})`);
  const raw = readFileSync(a.skeleton, "utf8");
  const atlasText = readFileSync(a.atlas, "utf8");

  // 1. runtime oficial
  try {
    const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(raw);
    const sk = new Skeleton(data);
    const st = new AnimationState(new AnimationStateData(data));
    let steps = 0;
    for (const anim of data.animations) {
      sk.setupPose();
      st.setAnimation(0, anim.name, true);
      for (let t = 0; t <= anim.duration * 2 + 1 / 64; t += 1 / 64, steps++) {
        st.update(1 / 64);
        st.apply(sk);
        sk.update(1 / 64);
        sk.updateWorldTransform(Physics.update);
        for (const b of sk.bones) if (!Number.isFinite(b.appliedPose.worldX + b.appliedPose.worldY)) throw new Error(`osso ${b.data.name} saiu do mundo em ${anim.name} t=${t}`);
      }
    }
    const names = data.animations.map((x) => x.name);
    check(p.anims.every((n) => names.includes(n)), `runtime le e toca ${names.join(", ")} (${steps} passos de 1/64 s, com fisica)`);
  } catch (e: any) {
    check(false, `runtime recusou: ${e?.message ?? e}`);
  }
  const json = JSON.parse(raw);
  const atts = (json.skins ?? []).flatMap((s: any) => Object.values<any>(s.attachments ?? {}).flatMap((m) => Object.values<any>(m)));
  const weighted = atts.filter((x: any) => x.type === "mesh" && x.vertices.length > x.uvs.length);
  const physics = (json.constraints ?? []).filter((c: any) => c.type === "physics");
  check(weighted.length > 0 && physics.length > 0 && !!json.animations?.idle, `${json.bones.length} ossos, ${json.slots.length} slots, ${weighted.length} malha(s) com pesos, ${physics.length} fisica(s), idle`);

  // 2. formato
  check(serializeSpineJson(parseSpineJson(raw)) === raw, "abrir e salvar devolve os mesmos bytes");
  const fresh = serializeSpineJson(parseSpineJson(raw), undefined, { reuse: false });
  check(fresh === raw, `serializar do zero reproduz os bytes${fresh === raw ? "" : " " + firstDiff(raw, fresh)}`);
  {
    // editar e desfazer pelo Document volta aos bytes
    const doc = Document.fromText(raw, { text: atlasText, pages: {} });
    const { executeAsync } = await import("../src/core/commands/index.ts");
    await executeAsync(doc, { cmd: "bone.set", args: { bone: json.bones[1].name, x: 7 } }, "teste");
    const edited = doc.serialize();
    doc.undo();
    check(edited !== raw && doc.serialize() === raw, "editar e desfazer volta aos bytes");
  }

  // 3. atlas sem perda
  {
    const dir = join(work, p.nome);
    const files = await unpackAtlas(a.atlas, atlasText, join(dir, "img"));
    const page0 = parseAtlas(atlasText).pages[0];
    const packed = await packAtlas(
      files.map((f) => ({ name: relative(join(dir, "img"), f).replace(/\.png$/, ""), file: f })),
      { pageName: basename(a.atlas, ".atlas"), pma: page0.pma, format: page0.name.endsWith(".png") ? "png" : "webp" },
    );
    check(packed.atlas === atlasText, `reempacotar ${files.length} imagens devolve o mesmo .atlas${packed.atlas === atlasText ? "" : " " + firstDiff(atlasText, packed.atlas)}`);
    let samePages = true,
      sameBytes = true;
    for (const pg of packed.pages) {
      const orig = readFileSync(join(dirname(a.atlas), pg.name));
      if (!orig.equals(pg.data)) sameBytes = false;
      if (!samePixels(await rgba(orig), await rgba(pg.data))) samePages = false;
    }
    check(samePages, `paginas reempacotadas com os mesmos pixels${sameBytes ? " (e os mesmos bytes)" : " (bytes diferentes: outro libwebp?)"}`);
    // cada regiao do atlas e a parte original, pixel a pixel
    const { pages, regions } = parseAtlas(atlasText);
    let bad: string[] = [];
    const partes = join(CORPUS, p.nome, "partes");
    for (const r of regions) {
      const page = sharp(join(dirname(a.atlas), pages.find((x) => x.name === r.page)!.name));
      const got = await rgba(await extractRegion(page, r));
      const want = await rgba(join(partes, r.name + ".png"));
      if (!samePixels(got, want)) bad.push(r.name);
    }
    const nPartes = readdirSync(partes).filter((f) => f.endsWith(".png")).length;
    check(!bad.length && regions.length === nPartes, `${regions.length}/${nPartes} regioes identicas as partes originais${bad.length ? ": diferem " + bad.join(", ") : ""}`);
  }

  // 4. layout do kit = pecas do build
  {
    const layers = artLayout(JSON.parse(raw), atlasText);
    const bad: string[] = [];
    for (const pc of p.pecas) {
      const l = layers.find((x) => x.layer === pc.slot && x.image === pc.image);
      const s = (pc.scale ?? 1) * (pc.flip ? -1 : 1);
      const rot = ((((l?.rotation ?? 0) - (pc.rotation ?? 0)) % 360) + 540) % 360 - 180;
      if (!l || Math.hypot(l.center[0] - pc.center[0], l.center[1] - pc.center[1]) > 0.15 || Math.abs(rot) > 0.15 || Math.abs(l.scale[0] - s) > 0.002 || Math.abs(l.scale[1] - Math.abs(s)) > 0.002 || l.visible === !!pc.hidden)
        bad.push(`${pc.slot}/${pc.image} ${JSON.stringify(l && { c: l.center, r: l.rotation, s: l.scale, v: l.visible })}`);
    }
    const order = layers.filter((l) => l.visible).map((l) => l.layer).join();
    const want = p.pecas.filter((x) => !x.hidden).map((x) => x.slot).join();
    check(!bad.length && order === want, `layout do kit devolve as ${p.pecas.length} pecas (centro, rotacao, espelho, escala, ordem)${bad.length ? ": " + bad.join("; ") : ""}${order === want ? "" : " ordem " + order}`);
  }

  // 5. o build de hoje reproduz o rig do repo
  {
    const root = join(work, "build");
    const c = await build(p, root);
    for (const [mine, theirs] of [
      [c.skeleton, a.skeleton],
      [c.atlas, a.atlas],
      [c.tres, a.tres],
    ]) {
      const x = readFileSync(mine, "utf8"),
        y = readFileSync(theirs, "utf8");
      check(x === y, `build reproduz ${basename(theirs)}${x === y ? "" : " " + firstDiff(y, x)}`);
    }
  }
}

// 6. cada personagem tem ficha e as animacoes cumprem as regras dela
for (const a of assets) {
  const ficha = a.skeleton.replace(/\.spine-json$/, ".ficha.md");
  if (!existsSync(ficha)) {
    check(false, `${basename(ficha)} existe`);
    continue;
  }
  const res = checkFicha(JSON.parse(readFileSync(a.skeleton, "utf8")), readFileSync(ficha, "utf8"));
  const bad = Object.entries(res).flatMap(([n, rs]) => rs.filter((r) => !r.ok).map((r) => `${n}: ${r.rule} (${r.detail})`));
  check(!bad.length, `${basename(ficha)}: ${Object.values(res).flat().length} regras${bad.length ? " | " + bad.join("; ") : ""}`);
}

rmSync(work, { recursive: true, force: true });
console.log(failures ? `${failures} falha(s)` : "tudo ok");
process.exitCode = failures ? 1 : 0;
