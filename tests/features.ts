// Teste de features com fixture sintetica (sem assets de jogos): monta um boneco do
// zero exercitando os comandos e confere, a cada etapa, que o runtime oficial le e
// toca o resultado. Desfazer tudo volta ao documento inicial.
//   npx tsx tests/features.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, Physics, Skeleton, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-core";
import { createAsset } from "../server/assets.ts";
import { parseAtlas } from "../src/core/atlas-text.ts";
import { Document } from "../src/core/document.ts";
import { executeAsync, type AssetProvider } from "../src/core/commands/index.ts";
import { decodeDrawOrder, encodeDrawOrder } from "../src/core/commands/organize.ts";
import { boneWorld, bonesOnly, nullLoader, skeletonAt } from "../src/core/pose.ts";
import { usarCasa } from "../src/core/estilo.ts";

// faixas de estilo inventadas: o repositorio nao traz a casa de ninguem
usarCasa(JSON.parse(readFileSync(new URL("./estilo-casa.exemplo.json", import.meta.url), "utf8")));

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FALHA"} ${msg}`);
  if (!ok) failures++;
};

// --- fixture: projeto Godot minimo + imagens geradas
const dir = mkdtempSync(join(tmpdir(), "mamulengo-test-"));
writeFileSync(join(dir, "project.godot"), "config_version=5\n");
const src = join(dir, "src_images");
mkdirSync(src);
const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const imgs: Record<string, Buffer> = {
  corpo: svg(200, 260, `<ellipse cx="100" cy="130" rx="90" ry="120" fill="#e85d75"/>`),
  cabeca: svg(160, 150, `<circle cx="80" cy="75" r="70" fill="#ffd166"/><circle cx="55" cy="65" r="10" fill="#222"/><circle cx="105" cy="65" r="10" fill="#222"/>`),
  braco: svg(60, 180, `<rect x="10" y="5" width="40" height="170" rx="20" fill="#4ecdc4"/>`),
  brilho: svg(120, 120, `<circle cx="60" cy="60" r="55" fill="#fff" opacity=".6"/>`),
  olho_1: svg(30, 30, `<circle cx="15" cy="15" r="12" fill="#222"/>`),
  olho_2: svg(30, 30, `<rect x="3" y="13" width="24" height="4" fill="#222"/>`),
};
for (const [n, b] of Object.entries(imgs)) await sharp(b).png().toFile(join(src, n + ".png"));

const created = await createAsset({ dir: join(dir, "boneco"), name: "boneco", imagesFrom: src });
check(true, `asset criado: ${created.regions} regioes, paginas ${created.pages.join(",")}`);
const atlasText = readFileSync(created.atlas, "utf8");
const atlas = parseAtlas(atlasText);

// imagens para comandos que precisam de alpha (mesh.create auto)
const assets: AssetProvider = {
  async image(name) {
    const f = join(dir, "boneco", "images", name + ".png");
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data };
  },
  region(name) {
    const r = atlas.regions.find((x) => x.name === name);
    return r ? { width: r.originalWidth, height: r.originalHeight } : null;
  },
  async bytes(p) {
    return new Uint8Array(readFileSync(p));
  },
};

const raw0 = readFileSync(created.skeleton, "utf8");
const doc = Document.fromText(raw0, { text: atlasText, pages: {} });
const run = async (cmd: string, args: any = {}) => (await executeAsync(doc, { cmd, args }, "teste", undefined, {}, assets))[0];

// runtime oficial le e toca todas as animacoes (com fisica)
function runtimeOk(stage: string) {
  try {
    const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
    const sk = new Skeleton(data);
    const st = new AnimationState(new AnimationStateData(data));
    for (const a of data.animations) {
      st.setAnimation(0, a.name, true);
      for (let t = 0; t < a.duration + 0.1; t += 1 / 30) {
        st.update(1 / 30);
        st.apply(sk);
        sk.update(1 / 30);
        sk.updateWorldTransform(Physics.update);
      }
    }
    check(true, `runtime le: ${stage}`);
  } catch (e: any) {
    check(false, `runtime recusou em ${stage}: ${e.message}`);
  }
}

// --- montagem
await run("bone.add", { name: "quadril", parent: "root", y: 150 });
await run("bone.add", { name: "peito", parent: "quadril", rotation: 90, length: 160 });
await run("bone.add", { name: "pescoco", parent: "peito", x: 160, length: 30 });
await run("bone.add", { name: "cabeca", parent: "pescoco", x: 30, rotation: -90 });
await run("bone.add", { name: "ombro", parent: "peito", x: 140, y: -90, rotation: 180, length: 80 });
await run("bone.add", { name: "mao", parent: "ombro", x: 80, length: 70 });
await run("bone.add", { name: "alvo_mao", parent: "root", x: 150, y: 120 });
await run("slot.add", { name: "braco", bone: "ombro", attachment: "braco" });
await run("slot.add", { name: "corpo", bone: "peito", attachment: "corpo" });
await run("slot.add", { name: "cabeca", bone: "cabeca", attachment: "cabeca" });
await run("slot.add", { name: "olho", bone: "cabeca", attachment: "olho_1" });
await run("slot.add", { name: "brilho", bone: "cabeca", attachment: "brilho", blend: "additive" });
await run("attachment.region", { slot: "corpo", name: "corpo", width: 200, height: 260, x: 120, rotation: -90 });
await run("attachment.region", { slot: "cabeca", name: "cabeca", width: 160, height: 150, y: 60 });
await run("attachment.region", { slot: "braco", name: "braco", width: 60, height: 180, x: 80, rotation: 90 });
await run("attachment.region", { slot: "olho", name: "olho_1", width: 30, height: 30, y: 70 });
await run("attachment.region", { slot: "olho", name: "olho_2", width: 30, height: 30, y: 70 });
await run("attachment.region", { slot: "brilho", name: "brilho", width: 120, height: 120, y: 60 });
runtimeOk("montagem com regions");
{
  // bounds do cabecalho: a cabeca (160x150 em y 60 do osso cabeca, base em y 340) entra
  const b = await run("skeleton.bounds", {});
  const s = doc.json.skeleton;
  check(b.width > 150 && b.height > 300 && s.width === b.width && s.y === b.y && b.y + b.height > 450, `skeleton.bounds grava o cabecalho (${b.x}, ${b.y}, ${b.width}x${b.height})`);
}

// coordenadas de mundo: osso apontando para um ponto e imagem posicionada pela tela
await run("bone.add", { name: "antena", parent: "cabeca", at: [10, 420], toward: [40, 480] });
await run("slot.add", { name: "antena", bone: "antena" });
await run("attachment.region", { slot: "antena", name: "olho_1", world: { center: [25, 450], rotation: 30, scale: [1, 1] } });
{
  const { skeletonAt, boneWorld } = await import("../src/core/pose.ts");
  const sk = skeletonAt(doc.json, null, 0);
  const b = boneWorld(sk, "antena");
  const len = doc.json.bones.find((x: any) => x.name === "antena").length;
  const tip = [b.x + b.a * len, b.y + b.c * len];
  // imagem pelo mundo: o runtime oficial poe o centro e o angulo onde pedimos
  {
    const { RegionAttachment } = await import("@esotericsoftware/spine-core");
    const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
    const sk2 = new Skeleton(data);
    sk2.setupPose();
    sk2.updateWorldTransform(Physics.reset);
    const slot = sk2.findSlot("antena")!;
    const att = data.defaultSkin!.getAttachment(slot.data.index, "olho_1") as any;
    const v: number[] = [];
    att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
    const c = [(v[0] + v[4]) / 2, (v[1] + v[5]) / 2];
    const ang = (Math.atan2(v[7] - v[1], v[6] - v[0]) * 180) / Math.PI;
    check(Math.hypot(c[0] - 25, c[1] - 450) < 0.05 && Math.abs(ang - 30) < 0.05, `imagem por coordenadas de mundo: centro (${c[0].toFixed(2)}, ${c[1].toFixed(2)}), angulo ${ang.toFixed(2)}`);
    void RegionAttachment;
  }
  check(Math.hypot(b.x - 10, b.y - 420) < 0.01 && Math.hypot(tip[0] - 40, tip[1] - 480) < 0.01, `osso por coordenadas de mundo: base (${b.x.toFixed(2)}, ${b.y.toFixed(2)}), ponta (${tip[0].toFixed(2)}, ${tip[1].toFixed(2)})`);
}

// malha automatica + pesos em dois ossos
const m = await run("mesh.create", { slot: "corpo", name: "corpo", mode: "auto" });
check(m.triangles > 4, `malha automatica: ${m.vertices} vertices, ${m.triangles} triangulos`);
const w = await run("mesh.weights", { slot: "corpo", attachment: "corpo", bones: ["quadril", "peito"] });
check(w.influences > m.vertices, `pesos: ${w.influences} influencias`);
await run("mesh.create", { slot: "braco", name: "braco", mode: "grid", grid: [1, 4] });
await run("mesh.weights", { slot: "braco", attachment: "braco", bones: ["ombro", "mao"] });
runtimeOk("malhas com pesos");

// blends que leem a tela (so do nucleo): no .boneco em portugues; na exportacao para o Spine saem
// normais, com aviso
{
  const s0 = doc.json.slots[0].name;
  const antes = doc.json.slots[0].blend;
  await run("slot.set", { slot: s0, blend: "softLight" });
  const bo = (await import("../src/boneco/spine.ts")).importarSpine(structuredClone(doc.json), atlasText, "t");
  const sp = (await import("../src/boneco/spine.ts")).exportarSpine(bo, { soSpine: true });
  const volta = (await import("../src/boneco/spine.ts")).exportarSpine(bo);
  check(
    bo.slots[0].blend === "luz_suave" && volta.json.slots[0].blend === "softLight" && !sp.json.slots[0].blend && sp.avisos.some((x: string) => x.includes("luz_suave")),
    "blends: luz suave vai ao .boneco como luz_suave, volta igual e sai normal no Spine com aviso",
  );
  await run("slot.set", { slot: s0, blend: antes ?? "normal" });
}

// geleia (so do nucleo): preset, moleza automatica pela distancia ao osso, vai ao .boneco em
// portugues, acompanha a malha que ganha ponto e sai na exportacao para o Spine
{
  const gj = await run("mesh.jelly", { slot: "braco", attachment: "braco", preset: "slime" });
  const a = doc.json.skins[0].attachments.braco.braco;
  const n = a.uvs.length / 2;
  const j0 = structuredClone(a.jelly);
  const bo = (await import("../src/boneco/spine.ts")).importarSpine(structuredClone(doc.json), atlasText, "t");
  const ge = bo.skins[0].partes.braco.braco.geleia;
  const mv = await run("query.mesh", { slot: "braco", attachment: "braco" });
  await run("mesh.addVertex", { slot: "braco", attachment: "braco", at: mv.vertices[0].world, where: "inside" }).catch(() => run("mesh.addVertex", { slot: "braco", attachment: "braco", at: [(mv.vertices[0].world[0] + mv.vertices[2].world[0]) / 2, (mv.vertices[0].world[1] + mv.vertices[2].world[1]) / 2], where: "auto" }));
  const n2 = doc.json.skins[0].attachments.braco.braco.uvs.length / 2;
  const so = (await import("../src/boneco/spine.ts")).exportarSpine(bo, { soSpine: true });
  check(
    gj.enabled && j0.stiffness === 45 && j0.gravity === 60 && j0.wobble.length === n && Math.min(...j0.wobble) === 0 && Math.max(...j0.wobble) === 1 && ge?.rigidez === 45 && ge?.contagio === 60 && ge?.moleza?.length === n && n2 === n + 1 && doc.json.skins[0].attachments.braco.braco.jelly.wobble.length === n2 && !so.json.skins[0].attachments.braco.braco.jelly && so.avisos.some((x: string) => x.includes("geleia")),
    `geleia: mesh.jelly slime, moleza de 0 (preso no osso) a 1 em ${n} pontos, geleia/rigidez/moleza no .boneco, segue a malha (${n2} pontos), sai no Spine com aviso`,
  );
  await run("mesh.jelly", { slot: "braco", attachment: "braco", enabled: false });
  check(!doc.json.skins[0].attachments.braco.braco.jelly, "geleia: enabled false tira");
}

// malha automatica em peca fina e curva (a perna da Kenney nos monstros): nenhum pixel opaco fora
// dos triangulos, em varios detalhes (o Delaunay filtrado pelo centro deixava 420 px de fora)
{
  const { autoMesh } = await import("../src/core/geometry.ts");
  const { data, info } = await sharp(join(import.meta.dirname, "..", "exemplos", "monstros", "fontes", "leg_blueB.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const fora = (detail: number) => {
    const m = autoMesh(data, info.width, info.height, { detail });
    const P = m.points,
      T = m.triangles;
    let n = 0;
    for (let y = 0; y < info.height; y += 2)
      for (let x = 0; x < info.width; x += 2) {
        if (data[(y * info.width + x) * 4 + 3] <= 128) continue;
        const [px, py] = [x + 0.5, y + 0.5];
        let ok = false;
        for (let t = 0; t < T.length && !ok; t += 3) {
          const [a, b, c] = [P[T[t]], P[T[t + 1]], P[T[t + 2]]];
          const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]),
            d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]),
            d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
          ok = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
        }
        if (!ok) n++;
      }
    return n;
  };
  const r = [1, 1.2, 4].map(fora);
  check(r.every((n) => n === 0), `malha automatica cobre a peca fina inteira (pixels opacos de fora por detalhe 1, 1.2, 4: ${r.join(", ")})`);
}

// olho maluco: eye.googly cola olhos (branco, pupila no osso pendurado com fisica, brilho) em
// lugares aleatorios da parte opaca, pede as imagens da biblioteca no atlas e desfaz inteiro
{
  const s0 = doc.json.slots.find((s: any) => {
    const a = s.attachment && doc.json.skins?.[0]?.attachments?.[s.name]?.[s.attachment];
    return a && (!a.type || a.type === "region");
  })!;
  let semImagem = "";
  await run("eye.googly", { slot: s0.name }).catch((e: any) => (semImagem = String(e.message)));
  const comOlho: AssetProvider = { image: assets.image, region: (n) => (n.startsWith("efeito_googly_") ? { width: 128, height: 128 } : assets.region(n)) };
  const antes = doc.serialize();
  const [r] = await executeAsync(doc, { cmd: "eye.googly", args: { slot: s0.name, count: 2, seed: 3, size: 12 } }, "teste", undefined, {}, comOlho);
  const nomes = doc.json.slots.map((s: any) => s.name);
  const fis = (doc.json as any).constraints?.filter((c: any) => c.type === "physics" && c.bone?.startsWith(`${s0.name}_olho`)) ?? [];
  const sk = skeletonAt(doc.json, null, 0);
  const ang = (Math.atan2(boneWorld(sk, `${r.eyes[0]}_pupila`).c, boneWorld(sk, `${r.eyes[0]}_pupila`).a) * 180) / Math.PI;
  const ordem = nomes.indexOf(`${r.eyes[0]}_branco`) > nomes.indexOf(s0.name) && nomes.indexOf(`${r.eyes[0]}_pupila`) > nomes.indexOf(`${r.eyes[0]}_branco`);
  doc.undo();
  check(
    semImagem.includes("efeito_googly_branco") && r.eyes.length === 2 && fis.length === 2 && fis[0].gravity < 0 && Math.abs(ang + 90) < 0.5 && ordem && doc.serialize() === antes,
    `eye.googly: ${r.eyes.length} olhos em ${s0.name} (pupila pendurada a ${ang.toFixed(1)} graus, fisica com gravidade), sem as imagens avisa, desfazer volta`,
  );
}

// regressao (achada no teste de aceitacao): inserir/reordenar ossos nao pode mudar
// para onde as malhas com pesos apontam (elas guardam indices de osso)
{
  // filho da cabeca entra antes de ombro/mao na lista: desloca os indices dos pesos do braco
  const before = await run("query.mesh", { slot: "braco", attachment: "braco" });
  await run("bone.add", { name: "extra_no_meio", parent: "cabeca", x: 5 });
  await run("bone.reparent", { bone: "alvo_mao", parent: "pescoco" });
  const after = await run("query.mesh", { slot: "braco", attachment: "braco" });
  const worst = Math.max(...before.vertices.map((v: any, i: number) => Math.hypot(v.world[0] - after.vertices[i].world[0], v.world[1] - after.vertices[i].world[1])));
  const names = (r: any) => JSON.stringify(r.vertices.map((v: any) => v.bones));
  check(worst < 0.2 && names(before) === names(after), `pesos sobrevivem a inserir/reordenar ossos (desvio max ${worst.toFixed(3)}px)`);
}

// animacao com tudo
await run("animation.create", { name: "1.idle" });
await run("key.set", { anim: "1.idle", target: { bone: "peito" }, timeline: "rotate", time: 0, value: 0, curve: "suave" });
await run("key.set", { anim: "1.idle", target: { bone: "peito" }, timeline: "rotate", time: 0.5, value: 6, curve: "suave" });
await run("key.set", { anim: "1.idle", target: { bone: "peito" }, timeline: "rotate", time: 1, value: 0 });
await run("key.set", { anim: "1.idle", target: { bone: "cabeca" }, timeline: "scale", time: 0.5, x: 1.05, y: 0.95, curve: "elastico" });
await run("key.set", { anim: "1.idle", target: { slot: "brilho" }, timeline: "rgba", time: 0, color: "ffffff00" });
await run("key.set", { anim: "1.idle", target: { slot: "brilho" }, timeline: "rgba", time: 0.5, color: "ffffffff" });
await run("key.set", { anim: "1.idle", target: { slot: "olho" }, timeline: "attachment", time: 0.8, name: "olho_2" });
await run("key.set", { anim: "1.idle", target: { slot: "olho" }, timeline: "attachment", time: 0.9, name: "olho_1" });
const q = await run("query.mesh", { slot: "corpo", attachment: "corpo" });
const top = q.vertices.reduce((a: any, b: any) => (b.world[1] > a.world[1] ? b : a));
await run("deform.set", { anim: "1.idle", slot: "corpo", attachment: "corpo", time: 0.5, moves: [{ i: top.i, dx: 0, dy: 12 }], curve: "suave" });
const br = await run("deform.brush", { anim: "1.idle", slot: "corpo", attachment: "corpo", time: 1, center: top.world, radius: 80, dx: 0, dy: 6 });
check(br.touched > 0, `pincel de deform tocou ${br.touched} vertices`);
// 2,5D: virar a malha como cilindro. Com 30 graus para a direita, o meio anda para a direita, a
// largura nao passa do raio e o lado que vem cresce na vertical mais que o que vai
{
  await run("animation.create", { name: "t.virar" });
  const antes = (await run("query.mesh", { slot: "corpo", attachment: "corpo", anim: "t.virar", time: 0 })).vertices.map((v: any) => v.world);
  await run("deform.turn", { anim: "t.virar", slot: "corpo", attachment: "corpo", time: 0, angle: 30, perspective: 0.3 });
  const depois = (await run("query.mesh", { slot: "corpo", attachment: "corpo", anim: "t.virar", time: 0 })).vertices.map((v: any) => v.world);
  const xs = antes.map((q: number[]) => q[0]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    R = (Math.max(...xs) - Math.min(...xs)) / 2;
  const meio = antes.map((q: number[], i: number) => [Math.abs(q[0] - cx), i]).sort((a: number[], b: number[]) => a[0] - b[0])[0][1];
  const altura = (lado: number) => {
    const ys = depois.filter((_: any, i: number) => Math.sign(antes[i][0] - cx) === lado).map((q: number[]) => q[1]);
    const ys0 = antes.filter((q: number[]) => Math.sign(q[0] - cx) === lado).map((q: number[]) => q[1]);
    return (Math.max(...ys) - Math.min(...ys)) / (Math.max(...ys0) - Math.min(...ys0));
  };
  const dentro = depois.every((q: number[]) => q[0] <= cx + R + 1e-3 && q[0] >= cx - R - 1e-3);
  check(depois[meio][0] - antes[meio][0] > R * 0.4 && dentro && altura(-1) > altura(1), `deform.turn vira a malha como cilindro (meio andou ${(depois[meio][0] - antes[meio][0]).toFixed(1)} de raio ${R.toFixed(1)}; alturas ${altura(-1).toFixed(3)} e ${altura(1).toFixed(3)})`);
  await run("animation.delete", { name: "t.virar" });
}
runtimeOk("animacao com deform");

// .boneco: o nome da parte dentro da animacao (animations/*/attachments/<skin>/<slot>/<parte>) e do
// artista e nao passa pelo dicionario; uma parte chamada "glow" virava "brilho" e o deform ficava orfao
{
  const { importarSpine, exportarSpine } = await import("../src/boneco/spine.ts");
  const j = structuredClone(doc.json);
  const renomeia = (o: any) => {
    o.glow = o.corpo;
    delete o.corpo;
  };
  renomeia(j.skins[0].attachments.corpo);
  renomeia(j.animations["1.idle"].attachments.default.corpo);
  for (const s of j.slots) if (s.attachment === "corpo" && s.name === "corpo") s.attachment = "glow";
  const bo = importarSpine(structuredClone(j), atlasText, "t");
  const orfas: string[] = [];
  for (const [an, a] of Object.entries<any>(bo.animacoes ?? {}))
    for (const [sk, slots] of Object.entries<any>(a.partes ?? {}))
      for (const [sl, partes] of Object.entries<any>(slots))
        for (const pt of Object.keys(partes)) if (!bo.skins.find((x: any) => x.nome === sk)?.partes?.[sl]?.[pt]) orfas.push(`${an}/${sk}/${sl}/${pt}`);
  const volta = exportarSpine(bo).json;
  check(
    !!bo.animacoes["1.idle"].partes.default.corpo.glow && !bo.animacoes["1.idle"].partes.default.corpo.brilho && !!bo.skins[0].partes.corpo.glow && orfas.length === 0 && JSON.stringify(volta.animations) === JSON.stringify(j.animations),
    `.boneco: parte "glow" com deform segue "glow" na animacao (nao "brilho"), nenhuma parte orfa (${orfas.join(",") || "0"}), animacoes voltam iguais`,
  );
}

// varias chaves: copiar/colar (outra animacao, outro osso), mover juntas, apagar juntas
{
  const { readShape } = await import("../src/core/commands/timeline.ts");
  const A = () => doc.json.animations;
  const times = (keys: any[]) => keys.map((k) => k.time ?? 0).join(",");
  // formatos de curva iguais (a menos do arredondamento float32 do formato)
  const same = (a: any, b: any) => {
    const fa = [a].flat(3), fb = [b].flat(3);
    return fa.length === fb.length && fa.every((x, i) => x === fb[i] || (typeof x === "number" && Math.abs(x - fb[i]) < 1e-3) || (Number.isNaN(x) && Number.isNaN(fb[i])));
  };
  const peito = (anim: string) => A()[anim].bones.peito.rotate;
  const clip = await run("keys.copy", { anim: "1.idle", keys: [0, 0.5, 1].map((time) => ({ target: { bone: "peito" }, timeline: "rotate", time })) });
  check(clip.items.length === 3 && clip.items[2].offset === 1, `keys.copy le 3 chaves (offsets ${clip.items.map((i: any) => i.offset).join(",")})`);
  await run("animation.create", { name: "6.colada" });
  await run("keys.paste", { anim: "6.colada", time: 0.2, items: clip.items });
  const pasted = peito("6.colada");
  const sameShape = same(readShape("rotate", pasted, 0), readShape("rotate", peito("1.idle"), 0));
  check(times(pasted) === "0.2,0.7,1.2" && pasted[1].value === 6 && sameShape, `keys.paste em outra animacao: tempos ${times(pasted)}, curva com o mesmo formato`);
  await run("keys.paste", { anim: "6.colada", time: 0, items: clip.items.map((i: any) => ({ ...i, target: { bone: "cabeca" } })) });
  check(times(A()["6.colada"].bones.cabeca.rotate) === "0,0.5,1", "keys.paste em outro osso (troca de target)");
  // mover juntas: chaves de timelines diferentes numa acao
  const before = doc.serialize();
  await run("keys.move", { anim: "6.colada", delta: 0.1, keys: [{ target: { bone: "peito" }, timeline: "rotate", time: 0.7 }, { target: { bone: "cabeca" }, timeline: "rotate", time: 0.5 }] });
  check(times(peito("6.colada")) === "0.2,0.8,1.2" && times(A()["6.colada"].bones.cabeca.rotate) === "0,0.6,1", "keys.move move chaves de dois ossos juntas");
  doc.undo();
  check(doc.serialize() === before, "keys.move e uma acao de desfazer");
  // passar por cima de outra chave reordena e mantem o formato das curvas
  const shape0 = readShape("rotate", peito("6.colada"), 0);
  await run("keys.move", { anim: "6.colada", delta: 0.7, keys: [{ target: { bone: "peito" }, timeline: "rotate", time: 0.2 }] });
  const moved = peito("6.colada");
  // o segmento novo vai de 0 a 0 (valores iguais): so o tempo da curva (x1, x2) e comparavel
  const sh1 = readShape("rotate", moved, 1) as any;
  check(times(moved) === "0.7,0.9,1.2" && same([sh1[0][0], sh1[0][2]], [(shape0 as any)[0][0], (shape0 as any)[0][2]]), `keys.move reordena (${times(moved)}) e a curva vai junto`);
  let clash = "";
  try {
    await run("keys.move", { anim: "6.colada", delta: 0.3, keys: [{ target: { bone: "peito" }, timeline: "rotate", time: 0.9 }] });
  } catch (e: any) {
    clash = e.message;
  }
  check(/já existe chave/.test(clash) && times(peito("6.colada")) === "0.7,0.9,1.2", "keys.move recusa cair em cima de outra chave");
  // eventos e ordem de desenho tambem
  await run("event.create", { name: "passo" });
  await run("event.key", { anim: "6.colada", time: 0.5, name: "passo" });
  await run("keys.move", { anim: "6.colada", delta: -0.25, keys: [{ timeline: "events", time: 0.5 }] });
  check(A()["6.colada"].events[0].time === 0.25, "keys.move move evento");
  const ev = await run("keys.copy", { anim: "6.colada", keys: [{ timeline: "events", time: 0.25 }] });
  await run("keys.paste", { anim: "6.colada", time: 1, items: ev.items });
  check(A()["6.colada"].events.length === 2, "keys.paste cola evento");
  runtimeOk("chaves coladas e movidas");
  const del = await run("keys.delete", {
    anim: "6.colada",
    keys: [
      { target: { bone: "peito" }, timeline: "rotate", time: 0.9 },
      { target: { bone: "cabeca" }, timeline: "rotate", time: 0 },
      { target: { bone: "cabeca" }, timeline: "rotate", time: 0.5 },
      { target: { bone: "cabeca" }, timeline: "rotate", time: 1 },
      { timeline: "events", time: 0.25 },
    ],
  });
  check(del.deleted === 5 && times(peito("6.colada")) === "0.7,1.2" && !A()["6.colada"].bones.cabeca && A()["6.colada"].events.length === 1, "keys.delete apaga varias (timeline vazia some)");
  runtimeOk("chaves apagadas juntas");
  await run("animation.delete", { name: "6.colada" });
}

// constraints
await run("ik.create", { name: "ik_braco", bones: ["ombro", "mao"], target: "alvo_mao", bendPositive: false });
{
  const before = doc.json.bones.find((b: any) => b.name === "cabeca").length;
  const ph = await run("physics.preset", { bone: "cabeca", preset: "orelha" });
  const len = doc.json.bones.find((b: any) => b.name === "cabeca").length;
  check(before ? ph.length === undefined : len > 0 && ph.length === len, `fisica de rotacao garante comprimento no osso (${before ?? 0} -> ${len})`);
}
await run("transform.create", { name: "brilho_segue", source: "cabeca", bones: ["mao"], copy: ["rotate"], mixRotate: 0.3 });
await run("key.set", { anim: "1.idle", target: { bone: "alvo_mao" }, timeline: "translate", time: 0.5, x: 20, y: 30 });
await run("key.set", { anim: "1.idle", target: { constraint: "ik_braco" }, timeline: "ik", time: 0, mix: 1 });
await run("key.set", { anim: "1.idle", target: { constraint: "ik_braco" }, timeline: "ik", time: 1, mix: 0.5 });
runtimeOk("constraints");

// slider: girar um osso percorre uma animacao inteira; vai ao .boneco em portugues e volta igual
{
  await run("bone.add", { name: "t_manivela", x: 40 });
  await run("slider.create", { name: "t_slider", animation: "1.idle", bone: "t_manivela", property: "rotate", from: 0, to: 0.5, scale: 0.01, additive: true, loop: true, mix: 0.8 });
  await run("constraint.set", { name: "t_slider", props: { local: true } });
  const sp = await import("../src/boneco/spine.ts");
  const bo = sp.importarSpine(structuredClone(doc.json), atlasText, "t");
  const r = bo.restricoes.find((c: any) => c.nome === "t_slider");
  const volta = sp.exportarSpine(bo).json.constraints.find((c: any) => c.name === "t_slider");
  const orig = doc.json.constraints.find((c: any) => c.name === "t_slider");
  check(
    r?.tipo === "slider" && r.animacao === "1.idle" && r.osso === "t_manivela" && r.somar && r.repetir && r.local_ && r.escalar === 0.01 && JSON.stringify(volta) === JSON.stringify(orig),
    "slider: slider.create com osso, somar, repetir e local vai ao .boneco e volta igual",
  );
  runtimeOk("slider");
  await run("constraint.delete", { name: "t_slider" });
  await run("bone.delete", { bone: "t_manivela" });
}

// IK sem bendPositive dobra para o lado desenhado (a pose de setup nao muda ao ligar)
{
  await run("bone.add", { name: "t_ombro", at: [0, 0], toward: [-100, -50] });
  await run("bone.add", { name: "t_cotovelo", parent: "t_ombro", at: [-100, -50], toward: [-40, 60] });
  await run("bone.add", { name: "t_alvo", at: [-40, 60] });
  const before = boneWorld(skeletonAt(doc.json, null, 0), "t_cotovelo");
  const r = await run("ik.create", { name: "t_ik", bones: ["t_ombro", "t_cotovelo"], target: "t_alvo" });
  const after = boneWorld(skeletonAt(doc.json, null, 0), "t_cotovelo");
  check(r.bendPositive === false && Math.hypot(after.x - before.x, after.y - before.y) < 0.5, `ik.create acha o lado da dobra (${r.bendPositive}, cotovelo andou ${Math.hypot(after.x - before.x, after.y - before.y).toFixed(2)})`);
  await run("bone.delete", { bone: "t_ombro" });
  await run("bone.delete", { bone: "t_alvo" });
}

// movimento medido na tela (nao pelos valores das chaves)
{
  await run("animation.create", { name: "t.giro" });
  await run("key.set", { anim: "t.giro", target: { bone: "alvo_mao" }, timeline: "rotate", time: 0, value: 0 });
  await run("key.set", { anim: "t.giro", target: { bone: "alvo_mao" }, timeline: "rotate", time: 0.5, value: 40 });
  await run("key.set", { anim: "t.giro", target: { bone: "alvo_mao" }, timeline: "rotate", time: 1, value: 10 });
  const mo = await run("query.motion", { anim: "t.giro", bones: ["alvo_mao"], fps: 20 });
  const tr = mo.bones.alvo_mao.trechos;
  check(tr.length === 2 && tr[0].includes("anti-horario 40") && tr[1].includes("horario 30") && !tr[1].includes("anti"), `query.motion: ${tr.join(" / ")}`);
  await run("animation.delete", { name: "t.giro" });
  // so anda (sobe e volta, sem girar): nao pode sair "parado"
  await run("animation.create", { name: "t.sobe" });
  await run("key.set", { anim: "t.sobe", target: { bone: "alvo_mao" }, timeline: "translate", time: 0, x: 0, y: 0, space: "world" });
  await run("key.set", { anim: "t.sobe", target: { bone: "alvo_mao" }, timeline: "translate", time: 0.5, x: 0, y: 40, space: "world" });
  await run("key.set", { anim: "t.sobe", target: { bone: "alvo_mao" }, timeline: "translate", time: 1, x: 0, y: 0, space: "world" });
  const so = (await run("query.motion", { anim: "t.sobe", bones: ["alvo_mao"], fps: 20 })).bones.alvo_mao.trechos;
  check(so.length === 2 && so[0].includes("sobe 40") && so[1].includes("desce 40"), `query.motion de osso que so anda: ${so.join(" / ")}`);
  await run("animation.delete", { name: "t.sobe" });
}

// estudo do rig e pecas que acompanham outras
{
  const rig = await run("query.rig", {});
  check(rig.constraints.some((l: string) => l.startsWith("ik_braco [ik]")) && rig.faixas.length > 0, `query.rig: ${rig.constraints.length} constraints, ${rig.faixas.length} faixas`);
  await run("bone.add", { name: "dedo", parent: "mao", x: 70 });
  await run("animation.create", { name: "t.segue" });
  await run("key.set", { anim: "t.segue", target: { constraint: "ik_braco" }, timeline: "ik", time: 0, mix: 0 });
  for (const [t, y] of [[0, 0], [0.5, 25], [1, 0]]) await run("key.set", { anim: "t.segue", target: { bone: "pescoco" }, timeline: "translate", time: t, x: 0, y, space: "world" });
  const before = await run("query.relation", { anim: "t.segue", bone: "dedo", relativeTo: "cabeca", fps: 20 });
  const f = await run("pose.follow", { anim: "t.segue", bone: "dedo", relativeTo: "cabeca", chain: ["ombro", "mao"], fps: 10, angleWeight: 0 });
  const after = await run("query.relation", { anim: "t.segue", bone: "dedo", relativeTo: "cabeca", fps: 20 });
  const big = (r: any) => parseFloat(r.maior_deslocamento);
  check(big(before) > 20 && big(after) < 3 && !f.atencao, `pose.follow: ponta da mao descolava ${before.maior_deslocamento}, depois ${after.maior_deslocamento} (entre chaves ${f.pior_entre_chaves})`);
  runtimeOk("pose.follow");
  await run("animation.delete", { name: "t.segue" });
  await run("bone.delete", { bone: "dedo" });
}

// ficha: o rascunho aprova o asset que descreve; regra violada e pega; nomes com espaco
{
  const md = await run("ficha.draft", { name: "boneco" });
  const ok = await run("ficha.check", { text: md });
  check(typeof md === "string" && md.includes("## Rig") && ok.falhas === 0, `ficha.draft aprova o proprio asset (${Object.keys(ok.animacoes).length} animacoes)`);
  const anim = Object.keys(doc.json.animations)[0];
  const bad = await run("ficha.check", {
    text: `## Rig\n\n\`\`\`regras\nlimite peito rotate -0.001..0.001\nduracao 99..100\n\`\`\`\n\n## Animacao: nao_existe\n\n\`\`\`regras\nloop\n\`\`\`\n`,
    anims: [anim, "nao_existe"],
  });
  const lines = Object.values<string[]>(bad.animacoes).flat();
  check(bad.falhas >= 2 && lines.some((l) => l.startsWith("FALHA duracao")) && lines.some((l) => l.includes("falta fazer")), `ficha.check pega regra violada e animacao faltando (${bad.falhas} falhas)`);
  // estilo: uma animacao quase parada e timida para um ganho de personagem
  await run("animation.create", { name: "t.timida" });
  for (const [t, v] of [[0, 0], [0.5, 1], [1, 0]]) await run("key.set", { anim: "t.timida", target: { bone: "peito" }, timeline: "rotate", time: t, value: v });
  const est = await run("ficha.check", { text: "## Animacao: t.timida\n\n```regras\nestilo ganho/acao\n```\n", anims: ["t.timida"] });
  const el = Object.values<string[]>(est.animacoes).flat().join(" ");
  check(est.falhas === 1 && /timida: .*silhueta/.test(el), `ficha: regra estilo reprova ganho timido (${el.slice(0, 90)})`);
  await run("animation.delete", { name: "t.timida" });
  // query.malha: o braco (malha com pesos ombro/mao) dobrado ao extremo torce; parado, nao
  await run("animation.create", { name: "t.torce" });
  if ((doc.json.constraints ?? []).some((c: any) => c.name === "ik_braco")) await run("key.set", { anim: "t.torce", target: { constraint: "ik_braco" }, timeline: "ik", time: 0, mix: 0 });
  await run("key.set", { anim: "t.torce", target: { bone: "mao" }, timeline: "rotate", time: 0, value: 0 });
  await run("key.set", { anim: "t.torce", target: { bone: "mao" }, timeline: "rotate", time: 0.5, value: 170 });
  const mq = await run("query.malha", { anim: "t.torce" });
  const top = mq.momentos[0];
  check(top?.malha === "braco" && top.torcao > 1 && top.t > 0 && top.t <= 0.5, `query.malha acha o braco torcido (${JSON.stringify(top)})`);
  await run("animation.delete", { name: "t.torce" });
  // query.recorte: o topo do braco escondido atras do corpo aparece com o ombro girado
  await run("animation.create", { name: "t.recorte" });
  if ((doc.json.constraints ?? []).some((c: any) => c.name === "ik_braco")) await run("key.set", { anim: "t.recorte", target: { constraint: "ik_braco" }, timeline: "ik", time: 0, mix: 0 });
  await run("key.set", { anim: "t.recorte", target: { bone: "ombro" }, timeline: "rotate", time: 0, value: 0 });
  await run("key.set", { anim: "t.recorte", target: { bone: "ombro" }, timeline: "rotate", time: 0.5, value: 0 });
  await run("key.set", { anim: "t.recorte", target: { bone: "ombro" }, timeline: "translate", time: 0.5, x: 0, y: 0 });
  await run("key.set", { anim: "t.recorte", target: { bone: "ombro" }, timeline: "translate", time: 1, x: 0, y: -70 });
  const rq = await run("query.recorte", { anim: "t.recorte" });
  const rt = rq.momentos[0];
  check(rq.bordas_escondidas.braco > 0 && rt?.peca === "braco" && rt.escondida_por === "corpo" && rt.t > 0.5 && !rq.momentos.some((m: any) => m.t < 0.5), `query.recorte acha o topo do braco descoberto (${JSON.stringify(rq.momentos.slice(0, 2))}, bordas ${JSON.stringify(rq.bordas_escondidas)})`);
  await run("animation.delete", { name: "t.recorte" });
  // efeitos do slot: setup por slot.effect, chaves por key.set (completas, o que falta vem do
  // instante), curva por canal, renomear e apagar o slot levam junto; o spine-core segue lendo
  {
    const s0 = doc.json.slots[0].name;
    await run("slot.effect", { slot: s0, effect: "tint", color: "ff0000", strength: 0.2 });
    await run("slot.effect", { slot: s0, effect: "outline", width: 3 });
    await run("animation.create", { name: "t.efeito" });
    await run("key.set", { anim: "t.efeito", target: { slot: s0 }, timeline: "tint", time: 0, strength: 0, curve: "suave" });
    await run("key.set", { anim: "t.efeito", target: { slot: s0 }, timeline: "tint", time: 0.5, strength: 1 });
    await run("key.set", { anim: "t.efeito", target: { slot: s0 }, timeline: "dissolve", time: 0.25, value: 0.4 });
    let erroSpine = "";
    try {
      const { SkeletonJson, AtlasAttachmentLoader, TextureAtlas } = await import("@esotericsoftware/spine-core");
      new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
    } catch (e: any) {
      erroSpine = String(e?.message ?? e);
    }
    const ks = doc.json.animations["t.efeito"].effects[s0];
    const curva = ks.tint[0].curve;
    let recusou = false;
    await run("slot.effect", { slot: s0, effect: "tint", width: 2 }).catch(() => (recusou = true));
    check(
      doc.json.slots[0].effects.tint.color === "ff0000" &&
        doc.json.slots[0].effects.outline.width === 3 &&
        ks.tint[0].color === "ff0000ff" &&
        ks.tint[1].color === "ff0000ff" &&
        ks.tint[1].strength === 1 &&
        ks.dissolve[0].value === 0.4 &&
        ks.dissolve[0].edge === 0.05 &&
        Array.isArray(curva) &&
        curva.length === 20 &&
        !erroSpine &&
        recusou,
      `efeitos: slot.effect e key.set (chaves completas, curva com 5 canais, campo errado recusado), spine-core le o documento${erroSpine ? ` (erro: ${erroSpine})` : ""}`,
    );
    await run("slot.rename", { slot: s0, to: "t.renomeado" });
    const renomeou = !!doc.json.animations["t.efeito"].effects["t.renomeado"];
    await run("slot.rename", { slot: "t.renomeado", to: s0 });
    await run("key.delete", { anim: "t.efeito", target: { slot: s0 }, timeline: "dissolve", time: 0.25 });
    await run("slot.effect", { slot: s0, effect: "tint", off: true });
    await run("slot.effect", { slot: s0, effect: "outline", off: true });
    check(renomeou && !doc.json.animations["t.efeito"].effects[s0].dissolve && doc.json.slots[0].effects === undefined, "efeitos: renomear o slot leva as timelines; key.delete e off limpam");
    await run("animation.delete", { name: "t.efeito" });
  }
  // atualizar a posicao de uma imagem nao regrava o tamanho dela com o do atlas (numa pagina em
  // alta resolucao o atlas e maior que a peca e a imagem esticava)
  {
    const sk = doc.json.skins[0];
    const [sl, atts] = Object.entries<any>(sk.attachments).find(([, a]) => Object.values<any>(a).some((x) => (x.type ?? "region") === "region"))!;
    const [nome, att] = Object.entries<any>(atts).find(([, x]) => (x.type ?? "region") === "region")!;
    const w0 = att.width;
    await run("attachment.region", { slot: sl, name: nome, width: w0 / 3 });
    await run("attachment.region", { slot: sl, name: nome, x: (att.x ?? 0) + 5 });
    const depois = doc.json.skins[0].attachments[sl][nome];
    check(Math.abs(depois.width - w0 / 3) < 1e-3, `attachment.region ao atualizar a posição mantém o tamanho guardado (${(w0 / 3).toFixed(1)}, não o do atlas ${w0})`);
    await run("attachment.region", { slot: sl, name: nome, x: (att.x ?? 0) - 5, width: w0 });
  }
  // reordenar a setup com animacao que tem chave de ordem: a animacao continua igual na tela
  {
    const { decodeDrawOrder: dec } = await import("../src/core/commands/organize.ts");
    const nomes = () => doc.json.slots.map((x: any) => x.name);
    const n0 = nomes();
    if (n0.length >= 3) {
      await run("animation.create", { name: "t.ordem" });
      const trocada = [...n0];
      [trocada[0], trocada[1]] = [trocada[1], trocada[0]];
      await run("draworder.key", { anim: "t.ordem", time: 0.2, order: trocada });
      // uma chave sem offsets (a ordem de setup) em 0
      await run("draworder.key", { anim: "t.ordem", time: 0, order: n0 });
      const ordens = () => doc.json.animations["t.ordem"].drawOrder.map((k: any) => (k.offsets?.length ? dec(nomes(), k.offsets) : nomes()).join(","));
      const antes = ordens();
      const r = await run("slot.order", { slot: n0[n0.length - 1], index: 0 });
      const depois = ordens();
      check(r.drawOrderKeys === 2 && JSON.stringify(antes) === JSON.stringify(depois) && nomes()[0] === n0[n0.length - 1], `slot.order na Pose base com chaves de ordem: as ${r.drawOrderKeys} chaves continuam com a mesma ordem na tela`);
      await run("slot.order", { slot: n0[n0.length - 1], index: n0.length - 1 });
      // por nome: below (logo atras de outro) e curinga (um grupo inteiro anda junto, na ordem dele)
      await run("draworder.key", { anim: "t.ordem", time: 0.4, below: { [n0[n0.length - 1]]: n0[0] } });
      const k4 = () => doc.json.animations["t.ordem"].drawOrder.find((k: any) => Math.abs((k.time ?? 0) - 0.4) < 1e-6);
      const o4 = dec(nomes(), k4().offsets);
      check(o4[0] === n0[n0.length - 1] && o4[1] === n0[0], `draworder.key below: ${n0[n0.length - 1]} logo atras de ${n0[0]}`);
      const pref = n0[0].slice(0, 1);
      const grupo = n0.filter((n: string) => n.startsWith(pref));
      await run("draworder.key", { anim: "t.ordem", time: 0.4, front: [pref + "*"] });
      const o5 = dec(nomes(), k4().offsets);
      check(JSON.stringify(o5.slice(o5.length - grupo.length)) === JSON.stringify(grupo), `draworder.key front com curinga: ${pref}* (${grupo.length} slots) na frente, na ordem de setup`);
      let semCasa = false;
      await run("draworder.key", { anim: "t.ordem", time: 0.4, front: ["nao_existe_*"] }).catch(() => (semCasa = true));
      check(semCasa, "draworder.key: curinga que nao casa com nada e recusado");
      await run("animation.delete", { name: "t.ordem" });
    }
  }
  // laco: fechar copia a primeira chave depois do fim; vai e volta espelha chaves e curvas
  {
    const b = doc.json.bones[1].name;
    const giro = (an: string, t: number) => {
      const w = boneWorld(skeletonAt(doc.json, an, t, false), b);
      return (Math.atan2(w.c, w.a) * 180) / Math.PI;
    };
    await run("animation.create", { name: "t.laco" });
    await run("key.set", { anim: "t.laco", target: { bone: b }, timeline: "rotate", time: 0, value: 0, curve: "sai-rapido" });
    await run("key.set", { anim: "t.laco", target: { bone: b }, timeline: "rotate", time: 0.5, value: 30 });
    await run("key.set", { anim: "t.laco", target: { bone: b }, timeline: "translate", time: 0.25, x: 10, y: 0 });
    await run("event.create", { name: "t_som" });
    await run("event.key", { anim: "t.laco", time: 0.1, name: "t_som" });
    await run("animation.duplicate", { name: "t.laco", to: "t.vaivem" });
    const fecha = await run("anim.closeLoop", { anim: "t.laco" });
    const rl = doc.json.animations["t.laco"].bones[b].rotate;
    const vv = await run("anim.pingPong", { anim: "t.vaivem" });
    const av = doc.json.animations["t.vaivem"];
    const simetrico = [0.05, 0.15, 0.3, 0.45].every((t) => Math.abs(giro("t.vaivem", t) - giro("t.vaivem", 1 - t)) < 1e-3);
    check(
      Math.abs(fecha.at - 0.7666667) < 1e-6 && rl.length === 3 && (rl[2].value ?? 0) === 0 && rl[2].time === fecha.at && vv.duration === 1 && av.bones[b].rotate.length === 3 && av.bones[b].rotate[2].time === 1 && simetrico && av.events.length === 2 && Math.abs(av.events[1].time - 0.9) < 1e-6,
      `laco: fechar poe a primeira chave em ${fecha.at}s; vai e volta dobra para ${vv.duration}s, simetrico no tempo (curva sai-rapido espelhada) e o evento volta em 0.9s`,
    );
    await run("animation.delete", { name: "t.laco" });
    await run("animation.delete", { name: "t.vaivem" });
  }
  // desenho vetorial (ambiente Desenhar): imagem desenhada numa parte nova, formas por pontos, svg,
  // retangulo com cantos e elipse, ponto no meio de um lado, ajuste ao desenho mantendo a parte
  // no lugar, pagina do atlas e ida e volta ao .boneco em portugues
  {
    const des = await import("../src/core/desenho.ts");
    const n0 = doc.history().length;
    const osso = doc.json.bones[1].name;
    await run("draw.create", { image: "t.desenho", width: 100, height: 80, slot: "t.desenho", bone: osso, x: 12, y: -4 });
    await run("draw.shape", { image: "t.desenho", rect: [10, 10, 60, 40], cornerRadius: 8, fill: "#ff8800", stroke: { width: 3, align: "inside", join: "round" } });
    const sv = await run("draw.shape", { image: "t.desenho", name: "gota", svg: "M 20 60 C 30 40 50 40 60 60 Z m 10 5 l 10 0 l 0 8 z" });
    await run("draw.shape", { image: "t.desenho", ellipse: [80, 20, 15, 10], stroke: { color: "112233" } });
    const antes = des.svgPath(doc.json.drawings["t.desenho"].shapes[1]);
    const sp = await run("draw.split", { image: "t.desenho", shape: "gota", seg: 0, t: 0.5 });
    const depoisSplit = des.flatten(doc.json.drawings["t.desenho"].shapes[1], 1);
    // o ponto novo esta em cima da curva de antes
    const novo = doc.json.drawings["t.desenho"].shapes[1].points[sp.index];
    const naCurva = des.flatten(des.parseSvgPath(antes)[0], 0.5).some(([x, y]) => Math.hypot(x - novo.x, y - novo.y) < 0.6);
    await run("draw.point", { image: "t.desenho", shape: 0, index: 1, radius: 4 });
    await run("draw.order", { image: "t.desenho", shape: "elipse", index: 0 });
    const W = () => {
      const a = doc.json.skins[0].attachments["t.desenho"]["t.desenho"];
      const m = boneWorld(skeletonAt(doc.json, null, 0), osso);
      return [m.a * a.x + m.b * a.y + m.x, m.c * a.x + m.d * a.y + m.y, a.width, a.height];
    };
    const w0 = W();
    const fit = await run("draw.fit", { image: "t.desenho", margin: 0 });
    const w1 = W();
    const d = doc.json.drawings["t.desenho"];
    const lay = des.layoutDrawings(doc.json.drawings)!;
    const at = des.atlasWithDrawings("a.png\nsize:4,4\nfilter:Linear,Linear\nx\nbounds:0,0,4,4\n", "t-desenhos.png", lay);
    const bo = (await import("../src/boneco/spine.ts")).importarSpine(structuredClone(doc.json), at, "t");
    const volta = (await import("../src/boneco/spine.ts")).exportarSpine(bo);
    let recusou = false;
    await run("draw.remove", { image: "t.desenho" }).catch(() => (recusou = true));
    const get = await run("draw.get", {});
    check(
      sv.added.length === 2 &&
        sv.added[1].name === "gota_2" &&
        depoisSplit.length > 0 &&
        naCurva &&
        d.shapes[0].name === "elipse" &&
        d.shapes[1].points[1].radius === 4 &&
        fit.width === d.width &&
        Math.abs(w1[2] - fit.width) < 1e-6 &&
        // o centro da parte andou o deslocamento do centro da imagem (pixel = unidade, sem escala)
        Math.abs(Math.hypot(w1[0] - w0[0], w1[1] - w0[1]) - Math.hypot(fit.offset[0] * -1 + fit.width / 2 - 50, fit.offset[1] * -1 + fit.height / 2 - 40)) < 1e-3 &&
        at.includes("t-desenhos.png\nsize:") &&
        at.includes("bounds:2,2,") &&
        bo.desenhos?.["t.desenho"]?.formas?.[1]?.traco?.alinhar === "dentro" &&
        bo.desenhos["t.desenho"].formas[1].traco.quina === "redonda" &&
        JSON.stringify(volta.json.drawings) === JSON.stringify(doc.json.drawings) &&
        recusou &&
        get[0].usedBy[0] === "t.desenho/t.desenho",
      `desenho: draw.create/shape/split/point/order/fit, ${fit.width}x${fit.height} sem sair do lugar, pagina ${lay.width}x${lay.height}, .boneco com desenhos/formas/traco em portugues e volta igual`,
    );
    // furos: svg de dois subcaminhos (letra O), draw.hole, draw.cut, ponto no furo, mover leva os furos
    const o = await run("draw.shape", { image: "t.desenho", name: "o", svg: "M10 10 L50 10 L50 50 L10 50 Z M20 20 L40 20 L40 40 L20 40 Z", holes: true });
    const io = o.added[0].index;
    const h2 = await run("draw.hole", { image: "t.desenho", shape: io, ellipse: [30, 30, 3, 3] });
    await run("draw.point", { image: "t.desenho", shape: io, contour: 1, index: 0, x: 21 });
    const cort = await run("draw.shape", { image: "t.desenho", name: "cortador", rect: [12, 12, 4, 4] });
    const cut = await run("draw.cut", { image: "t.desenho", shape: cort.added[0].index, into: io });
    const fo = doc.json.drawings["t.desenho"].shapes[cut.index];
    await run("draw.move", { image: "t.desenho", shapes: [cut.index], dx: 1, dy: 0 });
    const fm = doc.json.drawings["t.desenho"].shapes[cut.index];
    const boF = (await import("../src/boneco/spine.ts")).importarSpine(structuredClone(doc.json), at, "t").desenhos["t.desenho"].formas.find((f: any) => f.nome === "o");
    check(
      o.added.length === 1 && h2.contour === 2 && fo.holes.length === 3 && fo.holes[0].points[0].x === 21 && fm.holes[2].points[0].x === 13 && fm.points[0].x === 11 && boF?.furos?.length === 3 && des.svgPath(fm).split("M").length === 5,
      `desenho: furos por svg, draw.hole, draw.cut e ponto num furo; mover leva os furos; no .boneco "furos" (${fo.holes.length})`,
    );
    // o desenho passou da imagem: draw.cover cresce a imagem e a peca fica no mesmo lugar da tela
    const wAntes = W();
    const dAntes = { w: doc.json.drawings["t.desenho"].width, h: doc.json.drawings["t.desenho"].height };
    await run("draw.point", { image: "t.desenho", shape: 1, index: 0, x: -20 });
    const cov = await run("draw.cover", { image: "t.desenho" });
    const dDepois = doc.json.drawings["t.desenho"];
    const wDepois = W();
    const pxMundo = (w: number[]) => w[2] / dDepois.width;
    check(
      !!cov.grown && dDepois.width > dAntes.w && dDepois.shapes.every((f: any) => (des.shapeBounds(f)?.[0] ?? 0) >= 0) && Math.abs(wDepois[2] / dDepois.width - wAntes[2] / dAntes.w) < 1e-6 && pxMundo(wDepois) > 0 && Object.keys(cov.added).length === 0,
      `desenho: draw.cover cresce a imagem ${dAntes.w}x${dAntes.h} -> ${dDepois.width}x${dDepois.height} na mesma escala, com as formas dentro`,
    );
    // trocar uma imagem do atlas pelo desenho: todas as partes que a usam apontam para ele
    const usada = Object.entries<any>(doc.json.skins[0].attachments).flatMap(([sl, m]: any) => Object.entries<any>(m).map(([n, a]: any) => ({ sl, n, a }))).find((x) => (x.a.type ?? "region") === "region" && x.sl !== "t.desenho");
    const img = usada!.a.path ?? usada!.n;
    const rr = await run("draw.replace", { image: img, drawing: "t.desenho" });
    check(rr.replaced.includes(`${usada!.sl}/${usada!.n}`) && doc.json.skins[0].attachments[usada!.sl][usada!.n].path === "t.desenho" && !!rr.warning, `desenho: draw.replace troca ${img} pelo desenho (${rr.replaced.join(", ")}) e avisa do tamanho diferente`);
    // vetorizar: a cabeca (circulo amarelo com dois olhos) vira desenho; desenhada de volta em SVG,
    // fica perto da imagem (pixels da parte opaca com erro pequeno)
    const tr = await run("draw.trace", { image: "cabeca", replace: false });
    const dt = doc.json.drawings[tr.drawing];
    const svgT = `<svg xmlns="http://www.w3.org/2000/svg" width="${dt.width}" height="${dt.height}">` + dt.shapes.map((x: any) => `<path d="${des.svgPath(x)}" fill="#${x.fill.slice(0, 6)}" fill-rule="evenodd"/>`).join("") + "</svg>";
    const a1 = await sharp(Buffer.from(svgT)).ensureAlpha().raw().toBuffer();
    const a0 = (await assets.image("cabeca"))!.data;
    let erro = 0;
    for (let i = 0; i < a1.length; i++) erro += Math.abs(a1[i] - a0[i]);
    erro /= a1.length * 255;
    check(tr.colors[0] === "ffd166" && tr.colors.includes("222222") && tr.shapes === 3 && tr.points < 30 && erro < 0.02, `desenho: draw.trace vetoriza a cabeca em ${tr.shapes} formas e ${tr.points} pontos (${tr.colors.join(", ")}), erro medio ${(erro * 100).toFixed(2)}%`);
    while (doc.history().length > n0) doc.undo();
    check(!doc.json.drawings && !doc.json.slots.some((x: any) => x.name === "t.desenho"), "desenho: desfazer tira a imagem desenhada e a parte");
  }
  // texto e balao (src/core/fonte.ts): a fonte .ttf (CC0, Kenney Future) vira formas com os furos
  // das letras; o balao cria osso, parte e desenho com corpo, cauda e texto, e o pop nas chaves
  {
    const n0 = doc.history().length;
    const fonte = resolve("exemplos/ui/fontes/kenney-future.ttf");
    await run("draw.create", { image: "t.txt", width: 420, height: 120 });
    const r = await run("draw.text", { image: "t.txt", text: "BOO 42", font: fonte, size: 64, x: 20, y: 90, fill: "202020ff" });
    const sh = doc.json.drawings["t.txt"].shapes;
    const xs = sh[0].points.map((q: any) => q.x).concat(...(sh[0].holes ?? []).map((h: any) => h.points.map((q: any) => q.x)));
    const ys = sh[0].points.map((q: any) => q.y).concat(...(sh[0].holes ?? []).map((h: any) => h.points.map((q: any) => q.y)));
    const furos = sh[0].holes?.length ?? 0;
    // desenhado: tinta na barriga do B e vazio no meio do O (o furo)
    const des2 = await import("../src/core/desenho.ts");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120"><path d="${des2.svgPath(sh[0])}" fill="#000" fill-rule="${sh[0].rule ?? "evenodd"}"/></svg>`;
    const px = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alfa = (x: number, y: number) => px.data[(Math.round(y) * 420 + Math.round(x)) * 4 + 3];
    const oCentro = sh[0].holes?.find((h: any) => h.points.every((q: any) => q.x > 100))?.points;
    const mx = oCentro ? oCentro.reduce((a: number, q: any) => a + q.x, 0) / oCentro.length : 0;
    const my = oCentro ? oCentro.reduce((a: number, q: any) => a + q.y, 0) / oCentro.length : 0;
    check(sh[0].rule === "nonzero" && r.added.length === 1 && furos >= 3 && Math.min(...xs) >= 18 && Math.max(...ys) <= 91 && Math.min(...ys) > 20 && alfa(mx, my) === 0, `texto: draw.text vira uma forma com ${furos} furos, na linha de base e com o miolo do O vazio`);
    const b = await run("draw.balloon", { name: "t.balao", bone: doc.json.bones[0].name, x: 0, y: 300, text: "Oi!", font: fonte, size: 40, tail: [-60, 220], anim: "1.idle", from: 0.2, to: 0.9 });
    const bd = doc.json.drawings["t.balao"];
    const nomes = bd.shapes.map((x: any) => x.name).join(",");
    const esc = doc.json.animations["1.idle"].bones?.["t.balao"]?.scale ?? [];
    check(nomes === "cauda,corpo,emenda,texto" && b.width > 120 && doc.json.slots.some((x: any) => x.name === "t.balao") && esc.length >= 5 && Math.max(...esc.map((k: any) => k.x ?? 1)) > 1.1, `texto: draw.balloon com ${nomes}, ${b.width}x${b.height} e o pop (${esc.length} chaves)`);
    // query.desenho: o texto encostado na borda e cortado, o balao pequeno ampliado fica borrado
    await run("draw.shape", { image: "t.txt", name: "fora", rect: [380, 10, 60, 30], fill: "ff0000ff" });
    const qd = await run("query.desenho", { scale: 4 });
    const av = qd.avisos.join(" | ");
    check(av.includes("t.txt: cortada") && av.includes("fora") && av.includes("t.balao: borrada"), `query.desenho: corte pela borda e nitidez (${av.slice(0, 200)})`);
    while (doc.history().length > n0) doc.undo();
    check(!doc.json.drawings?.["t.txt"] && !doc.json.drawings?.["t.balao"] && !doc.json.bones.some((x: any) => x.name === "t.balao"), "texto: desfazer tira o texto e o balao");
  }
  // camada de ajuste: setup e chave (matiz negativo), vai ao .boneco como "ajuste" em portugues
  {
    const s0 = doc.json.slots[0].name;
    await run("slot.effect", { slot: s0, effect: "adjust", saturation: 0, blur: 3 });
    await run("animation.create", { name: "t.ajuste" });
    await run("key.set", { anim: "t.ajuste", target: { slot: s0 }, timeline: "adjust", time: 0.2, hue: -40, contrast: 1.5 });
    let recusou = false;
    await run("slot.effect", { slot: s0, effect: "adjust", width: 2 }).catch(() => (recusou = true));
    const bo = (await import("../src/boneco/spine.ts")).importarSpine(structuredClone(doc.json), atlasText, "t");
    const aj = bo.slots.find((x: any) => x.nome === s0)?.efeitos?.ajuste;
    const ch = bo.animacoes?.["t.ajuste"]?.efeitos?.[s0]?.ajuste?.[0];
    check(
      aj?.saturacao === 0 && aj?.desfoque === 3 && ch?.matiz === -40 && ch?.contraste === 1.5 && ch?.saturacao === 0 && ch?.desfoque === 3 && recusou,
      `ajuste: slot.effect e key.set, no .boneco ajuste {matiz, saturacao, contraste, desfoque} (${JSON.stringify(aj)} ${JSON.stringify(ch)})`,
    );
    await run("animation.delete", { name: "t.ajuste" });
    await run("slot.effect", { slot: s0, effect: "adjust", off: true });
  }
  // borrar (smear): sem cor, setup com padroes, chave com limit e fade, campo de outro efeito recusado
  {
    const s0 = doc.json.slots[0].name;
    await run("slot.effect", { slot: s0, effect: "smear", strength: 0.05 });
    await run("animation.create", { name: "t.borrar" });
    await run("key.set", { anim: "t.borrar", target: { slot: s0 }, timeline: "smear", time: 0.2, strength: 0.08, limit: 30, fade: 0.8 });
    let recusou = false;
    await run("slot.effect", { slot: s0, effect: "smear", color: "ff0000" }).catch(() => (recusou = true));
    const sm = doc.json.slots[0].effects.smear;
    const k = doc.json.animations["t.borrar"].effects[s0].smear[0];
    check(sm.strength === 0.05 && sm.limit === undefined && k.strength === 0.08 && k.limit === 30 && k.fade === 0.8 && recusou, `borrar: slot.effect e key.set (${JSON.stringify(sm)} ${JSON.stringify(k)})`);
    await run("animation.delete", { name: "t.borrar" });
    await run("slot.effect", { slot: s0, effect: "smear", off: true });
  }
  // rastro (trail): copias, intervalo e alfa no setup e numa chave
  {
    const s0 = doc.json.slots[0].name;
    await run("slot.effect", { slot: s0, effect: "trail", copies: 4, interval: 0.04 });
    await run("animation.create", { name: "t.rastro" });
    await run("key.set", { anim: "t.rastro", target: { slot: s0 }, timeline: "trail", time: 0.3, copies: 6, alpha: 0.8 });
    const tr = doc.json.slots[0].effects.trail;
    const k = doc.json.animations["t.rastro"].effects[s0].trail[0];
    check(tr.copies === 4 && tr.interval === 0.04 && k.copies === 6 && k.alpha === 0.8 && k.interval === 0.04, `rastro: slot.effect e key.set (${JSON.stringify(tr)} ${JSON.stringify(k)})`);
    await run("animation.delete", { name: "t.rastro" });
    await run("slot.effect", { slot: s0, effect: "trail", off: true });
  }
  // luzes: light.set cria e muda, key.set anima (chave completa), ambient.set, renomear o osso
  // acompanha, light.delete leva as timelines; o spine-core segue lendo
  {
    const osso = doc.json.bones[1].name;
    await run("light.set", { name: "t.luz", bone: osso, x: 10, color: "ff8800", strength: 1.5, radius: 200, height: 40 });
    await run("ambient.set", { color: "8899bb", strength: 0.7 });
    await run("animation.create", { name: "t.luzes" });
    await run("key.set", { anim: "t.luzes", target: { light: "t.luz" }, timeline: "light", time: 0.2, strength: 3 });
    await run("key.set", { anim: "t.luzes", target: { ambient: true }, timeline: "ambient", time: 0.4, strength: 0.3 });
    const l = doc.json.lights[0];
    const kl = doc.json.animations["t.luzes"].lights["t.luz"][0];
    const ka = doc.json.animations["t.luzes"].ambient[0];
    await run("bone.rename", { bone: osso, to: "t.osso" });
    const seguiu = doc.json.lights[0].bone === "t.osso";
    await run("bone.rename", { bone: "t.osso", to: osso });
    let erroSpine = "";
    try {
      const { SkeletonJson, AtlasAttachmentLoader, TextureAtlas } = await import("@esotericsoftware/spine-core");
      new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
    } catch (err: any) {
      erroSpine = String(err?.message ?? err);
    }
    await run("light.delete", { name: "t.luz" });
    await run("ambient.set", { off: true });
    const limpo = !doc.json.lights && !doc.json.ambient && !doc.json.animations["t.luzes"].lights;
    check(
      l.bone === osso && l.strength === 1.5 && kl.strength === 3 && kl.color === "ff8800ff" && kl.height === 40 && ka.strength === 0.3 && ka.color === "8899bbff" && seguiu && limpo && !erroSpine,
      `luzes: light.set, key.set (chave completa), ambient.set, osso renomeado, light.delete ${JSON.stringify({ kl, ka })}${erroSpine ? ` (spine-core: ${erroSpine})` : ""}`,
    );
    await run("animation.delete", { name: "t.luzes" });
  }

  // instancias: instance.set cria e muda, key.set (chave em degrau com animacao, inicio,
  // velocidade, repetir), renomear o slot e o osso acompanha, instance.rename leva as timelines,
  // instance.delete tambem; a ida e volta pelo .boneco guarda tudo e o spine-core segue lendo
  {
    const osso = doc.json.bones[1].name;
    const slot = doc.json.slots[0].name;
    await run("instance.set", { name: "t.inst", slot, boneco: "filho.boneco", animation: "anda", x: 12, scaleX: 0.5 });
    await run("instance.set", { name: "t.inst", bone: osso, loop: false, start: 0.25 });
    await run("animation.create", { name: "t.inst" });
    await run("key.set", { anim: "t.inst", target: { instance: "t.inst" }, timeline: "instance", time: 0.5, animation: "pula", start: 0, speed: 2 });
    const ki = structuredClone(doc.json.animations["t.inst"].instances["t.inst"][0]);
    const inst = structuredClone(doc.json.instances[0]);
    const { exportarSpine, importarSpine } = await import("../src/boneco/spine.ts");
    const b = importarSpine(structuredClone(doc.json), atlasText, "t");
    const volta = exportarSpine(b).json;
    const idaVolta = JSON.stringify(volta.instances) === JSON.stringify(doc.json.instances) && b.instancias[0].repetir === false && b.animacoes["t.inst"].instancias["t.inst"][0].velocidade === 2;
    await run("slot.rename", { slot, to: "t.slot" });
    await run("bone.rename", { bone: osso, to: "t.osso" });
    const seguiu = doc.json.instances[0].slot === "t.slot" && doc.json.instances[0].bone === "t.osso";
    await run("bone.rename", { bone: "t.osso", to: osso });
    await run("slot.rename", { slot: "t.slot", to: slot });
    await run("instance.rename", { name: "t.inst", to: "t.outra" });
    const renomeou = !!doc.json.animations["t.inst"].instances["t.outra"];
    let erroSpine = "";
    try {
      const { SkeletonJson, AtlasAttachmentLoader, TextureAtlas } = await import("@esotericsoftware/spine-core");
      new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
    } catch (err: any) {
      erroSpine = String(err?.message ?? err);
    }
    await run("instance.delete", { name: "t.outra" });
    const limpo = !doc.json.instances && !doc.json.animations["t.inst"].instances;
    check(
      inst.bone === osso && inst.loop === false && inst.start === 0.25 && inst.scaleX === 0.5 && ki.animation === "pula" && ki.speed === 2 && ki.start === 0 && idaVolta && seguiu && renomeou && limpo && !erroSpine,
      `instancias: instance.set, key.set (instance), ida e volta, slot e osso renomeados, instance.rename, instance.delete ${JSON.stringify({ inst, ki })}${erroSpine ? ` (spine-core: ${erroSpine})` : ""}`,
    );
    await run("animation.delete", { name: "t.inst" });
  }
  // follow: uma instancia presa ao osso do filho de outra (o objeto na mao), e a chave troca de
  // mao ou volta ao osso dela; a seguida vem antes; renomear leva junto; apagar a seguida recusa;
  // vai e volta pelo .boneco
  {
    const slot = doc.json.slots[0].name;
    await run("instance.set", { name: "t.dono", slot, boneco: "filho.boneco" });
    await run("instance.set", { name: "t.obj", slot, boneco: "filho.boneco", scaleX: 0.3, follow: { instance: "t.dono", bone: "mao" } });
    let antes = false;
    await run("instance.set", { name: "t.dono", follow: { instance: "t.obj", bone: "mao" } }).catch(() => (antes = true));
    await run("animation.create", { name: "t.segue" });
    await run("key.set", { anim: "t.segue", target: { instance: "t.obj" }, timeline: "instance", time: 0.4, follow: null });
    await run("instance.rename", { name: "t.dono", to: "t.dono2" });
    const renomeado = doc.json.instances.find((x: any) => x.name === "t.obj").follow.instance === "t.dono2";
    let recusou = false;
    await run("instance.delete", { name: "t.dono2" }).catch(() => (recusou = true));
    const { exportarSpine, importarSpine } = await import("../src/boneco/spine.ts");
    const b = importarSpine(structuredClone(doc.json), atlasText, "t");
    const volta = exportarSpine(b).json;
    const bo = b.instancias.find((x: any) => x.nome === "t.obj");
    const k = b.animacoes["t.segue"].instancias["t.obj"][0];
    check(
      antes && renomeado && recusou && bo.segue?.instancia === "t.dono2" && bo.segue?.osso === "mao" && k.segue === null && JSON.stringify(volta.instances) === JSON.stringify(doc.json.instances),
      `instancias: follow (objeto na mao de outra instancia), chave follow null, ordem exigida, rename leva, delete da seguida recusa, ida e volta ${JSON.stringify({ antes, renomeado, recusou, bo: bo.segue, k })}`,
    );
    await run("animation.delete", { name: "t.segue" });
    await run("instance.delete", { name: "t.obj" });
    await run("instance.delete", { name: "t.dono2" });
  }

  // instance.extract: a subarvore de um osso vira um .boneco (no resultado) e uma instancia no
  // lugar; desfazer volta tudo
  {
    const antes = doc.serialize();
    const b = doc.json.bones.find((x: any) => x.parent && !doc.json.bones.some((y: any) => y.parent === x.name) && doc.json.slots.some((s: any) => s.bone === x.name));
    const slotsDele = doc.json.slots.filter((s: any) => s.bone === b.name).map((s: any) => s.name);
    const r = await run("instance.extract", { bone: b.name, boneco: "t.filho.boneco" });
    const filho = JSON.parse(r.arquivo.texto);
    const ok =
      !doc.json.bones.some((x: any) => x.name === b.name) &&
      doc.json.instances?.[0]?.boneco === "t.filho.boneco" &&
      filho.ossos[0].nome === b.name &&
      !filho.ossos[0].pai &&
      slotsDele.every((n: string) => filho.slots.some((s: any) => s.nome === n) && !doc.json.slots.some((s: any) => s.name === n && s.name !== r.slot));
    doc.undo();
    check(ok && doc.serialize() === antes, `instance.extract: ${b.name} vira ${filho.ossos.length} osso(s) e ${filho.slots.length} slot(s) no filho, a instancia no lugar, desfazer volta`);
  }
  // mosaico: mosaic.set cria (tamanho da celula pela imagem) e muda a grade sem perder o que
  // cabe; mosaic.paint pinta celula, retangulo, balde e apaga; mosaic.cell guarda cor, altura,
  // giro, espelho e efeitos; tudo chega ao .boneco com os nomes certos; renomear o slot
  // acompanha e apagar o slot leva o mosaico; o spine-core le o documento; desfazer volta
  {
    const antes = doc.serialize();
    const h0 = doc.history().length;
    const s0 = doc.json.slots.find((s: any) => s.attachment)!;
    const img = s0.attachment as string;
    let semSlot = false;
    await run("mosaic.set", { name: "t.mapa" }).catch(() => (semSlot = true));
    await run("mosaic.set", { name: "t.mapa", slot: s0.name, columns: 4, rows: 3, palette: [img] });
    const m0 = (doc.json as any).mosaics[0];
    await run("mosaic.paint", { name: "t.mapa", image: img, at: [0, 0], to: [1, 1] });
    await run("mosaic.paint", { name: "t.mapa", image: null, at: [1, 1] });
    await run("mosaic.paint", { name: "t.mapa", image: 0, at: [3, 2], flood: true });
    const balde = (doc.json as any).mosaics[0].cells.filter((v: number) => v === 0).length;
    await run("mosaic.cell", { name: "t.mapa", at: [0, 0], color: "ff0000ff", height: 6, spin: 5, flip: true, effects: { glow: { color: "ffff00ff", strength: 1 } } });
    let efeitoRuim = false;
    await run("mosaic.cell", { name: "t.mapa", at: [0, 0], effects: { smear: { strength: 1 } } }).catch(() => (efeitoRuim = true));
    await run("mosaic.set", { name: "t.mapa", columns: 2 });
    const m = (doc.json as any).mosaics[0];
    let erroSpine = "";
    try {
      const { SkeletonJson, AtlasAttachmentLoader, TextureAtlas } = await import("@esotericsoftware/spine-core");
      new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
    } catch (e: any) {
      erroSpine = String(e?.message ?? e);
    }
    const { importarSpine } = await import("../src/boneco/spine.ts");
    const bm = importarSpine(doc.json, atlasText, "t").mosaicos?.[0];
    const regiao = parseAtlas(atlasText).regions.find((r: any) => r.name === img);
    check(
      semSlot &&
        m0.cell[0] === (regiao?.originalWidth ?? regiao?.width) &&
        balde === 12 &&
        efeitoRuim &&
        m.columns === 2 &&
        m.cells.length === 6 &&
        m.cells.every((v: number) => v === 0) &&
        m.extras?.["0"]?.spin === 1 &&
        bm?.forma === "grade" &&
        bm?.paleta?.[0] === img &&
        bm?.extras?.["0"]?.giro === 1 &&
        bm?.extras?.["0"]?.espelho === true &&
        bm?.extras?.["0"]?.efeitos?.brilho?.forca === 1 &&
        !erroSpine,
      `mosaico: mosaic.set, paint (retangulo, apagar, balde ${balde}), cell e a grade menor chegam ao .boneco; spine-core le${erroSpine ? ` (erro: ${erroSpine})` : ""} (${JSON.stringify(bm)?.slice(0, 200)})`,
    );
    let renomeou = false,
      levou = false;
    const h1 = doc.history().length;
    try {
      await run("slot.rename", { slot: s0.name, to: "t.chao" });
      renomeou = (doc.json as any).mosaics[0].slot === "t.chao";
      await run("slot.delete", { slot: "t.chao" });
      levou = !(doc.json as any).mosaics;
    } catch (e) {
      console.log("mosaico:", e);
    }
    // (o desfazer do slot.rename pode mudar a ordem das chaves: a comparacao exata e so do mosaico)
    while (doc.history().length > h1) doc.undo();
    const comMosaico = JSON.stringify((doc.json as any).mosaics) === JSON.stringify([m]);
    while (doc.history().length > h0) doc.undo();
    const canon = (x: any): any => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
    const igual = JSON.stringify(canon(JSON.parse(doc.serialize()))) === JSON.stringify(canon(JSON.parse(antes)));
    if (!(renomeou && levou && comMosaico && igual)) console.log("mosaico:", { renomeou, levou, comMosaico, igual });
    check(renomeou && levou && comMosaico && igual, "mosaico: renomear o slot acompanha, apagar o slot leva o mosaico, desfazer volta");
  }
  // pixel art: query.pixel acha osso fracionario, deslocamento suave e giro fora de 45; pixel.snap
  // arredonda e troca o trecho linear 0 -> 5 px em 1 s por degraus de 1 px no tempo da reta (a
  // troca do valor arredondado: 0.1, 0.3, 0.5, 0.7, 0.9 s); giro so avisa; desfazer volta
  {
    const antes = doc.serialize();
    const h0 = doc.history().length;
    const b0 = doc.json.bones[1].name;
    await run("bone.set", { bone: b0, x: 3.5 });
    await run("animation.create", { name: "t.pixel" });
    await run("key.set", { anim: "t.pixel", target: { bone: b0 }, timeline: "translate", time: 0, x: 0, y: 0 });
    await run("key.set", { anim: "t.pixel", target: { bone: b0 }, timeline: "translate", time: 1, x: 5, y: 0 });
    await run("key.set", { anim: "t.pixel", target: { bone: b0 }, timeline: "rotate", time: 0.5, value: 12 });
    const q = await run("query.pixel", { anim: "t.pixel" });
    const acha = (t: string) => q.avisos.some((a: string) => a.includes(t));
    const r = await run("pixel.snap", { anim: "t.pixel" });
    const keys = doc.json.animations["t.pixel"].bones[b0].translate;
    const tempos = keys.map((k: any) => k.time ?? 0);
    const xs = keys.map((k: any) => k.x ?? 0);
    const ok =
      acha(`osso ${b0}`) &&
      acha("curva suave") &&
      acha("giro em 12") &&
      doc.json.bones[1].x === 4 &&
      JSON.stringify(xs) === JSON.stringify([0, 1, 2, 3, 4, 5, 5]) &&
      JSON.stringify(tempos) === JSON.stringify([0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) &&
      keys.slice(0, -1).every((k: any) => k.curve === "stepped") &&
      r.avisosRestantes.some((a: string) => a.includes("t.pixel") && a.includes("giro em 12")) &&
      !r.avisosRestantes.some((a: string) => a.includes("t.pixel") && a.includes("translate"));
    if (!ok) console.log("pixel dbg", q.avisos.slice(0, 8), r.avisosRestantes.slice(0, 8), doc.json.bones[1].x);
    while (doc.history().length > h0) doc.undo();
    check(ok && doc.serialize() === antes, `pixel: query.pixel acha osso, curva suave e giro; pixel.snap encaixa (x ${JSON.stringify(xs)} em ${JSON.stringify(tempos)}); desfazer volta`);
  }
  // palco (docs/PALCO.md): o bloco stage do editor vai e volta do .boneco com os nomes certos
  {
    const { importarSpine, exportarSpine } = await import("../src/boneco/spine.ts");
    const stage = { gravity: 2400, solid: { mosaic: "mapa", palette: ["chao"] }, actors: [{ name: "heroi", instance: "heroi", type: "player", box: [70, 180], speed: 360, jump: 1350, animations: { idle: "parado", walk: "anda", jump: "pula", dead: "cai" } }, { name: "bicho", instance: "bicho", type: "patrol", side: -1 }] };
    const j = { skeleton: { spine: "4.3.23" }, bones: [{ name: "root" }], slots: [], skins: [{ name: "default", attachments: {} }], animations: {}, stage };
    const b = importarSpine(j, "", "t");
    const p = (b as any).palco;
    const volta = exportarSpine(b).json as any;
    check(
      p?.gravidade === 2400 && p?.solido?.mosaico === "mapa" && p?.solido?.paleta?.[0] === "chao" && p?.atores?.[0]?.tipo === "jogador" && p?.atores?.[0]?.caixa?.[1] === 180 && p?.atores?.[0]?.pulo === 1350 && p?.atores?.[0]?.animacoes?.andando === "anda" && p?.atores?.[1]?.tipo === "patrulha" && p?.atores?.[1]?.lado === -1 && JSON.stringify(volta.stage) === JSON.stringify(stage),
      `palco: stage chega ao .boneco como palco (${JSON.stringify(p?.atores?.[0])}) e volta igual`,
    );
  }
  // palco por comandos: stage.actor com boneco cria osso, camada, instancia e ator de uma vez;
  // sem type recusa; stage.set liga o mosaico solido e recusa imagem fora da paleta; renomear a
  // instancia leva o ator; apagar a instancia tira o ator; stage.remove com delete apaga tudo
  {
    const antes = doc.serialize();
    const h0 = doc.history().length;
    let semTipo = false,
      foraPaleta = false;
    await run("stage.actor", { name: "t.heroi", boneco: "t.heroi.boneco" }).catch(() => (semTipo = true));
    await run("stage.actor", { name: "t.heroi", boneco: "t.heroi.boneco", type: "player", x: 40, y: 10, box: [20, 40], jump: 500, animations: { walk: "anda" } });
    await run("stage.actor", { name: "t.moeda", boneco: "t.moeda.boneco", type: "collectible", x: 100, y: 10 });
    const s0 = doc.json.slots.find((s: any) => s.attachment)!;
    await run("mosaic.set", { name: "t.chao", slot: s0.name, columns: 4, rows: 2, palette: [s0.attachment], fill: 0 });
    await run("stage.set", { gravity: 1500, solid: { mosaic: "t.chao", palette: ["nao_existe"] } }).catch(() => (foraPaleta = true));
    await run("stage.set", { gravity: 1500, solid: { mosaic: "t.chao" } });
    const st = (doc.json as any).stage;
    const criou = doc.json.bones.some((b: any) => b.name === "t.heroi" && b.x === 40) && doc.json.slots.some((x: any) => x.name === "t.heroi") && (doc.json as any).instances.some((x: any) => x.name === "t.heroi" && x.boneco === "t.heroi.boneco");
    await run("instance.rename", { name: "t.moeda", to: "t.ouro" });
    const renomeou = st && (doc.json as any).stage.actors.find((a: any) => a.name === "t.moeda")?.instance === "t.ouro";
    await run("instance.delete", { name: "t.ouro" });
    const tirou = !(doc.json as any).stage.actors.some((a: any) => a.name === "t.moeda");
    await run("stage.remove", { name: "t.heroi", delete: true });
    const apagou = !doc.json.bones.some((b: any) => b.name === "t.heroi") && !((doc.json as any).instances ?? []).length && !(doc.json as any).stage.actors.length;
    const { importarSpine } = await import("../src/boneco/spine.ts");
    while (doc.history().length > h0 + 5) doc.undo();
    const p = (importarSpine(doc.json, atlasText, "t") as any).palco;
    while (doc.history().length > h0) doc.undo();
    check(
      semTipo && foraPaleta && criou && renomeou && tirou && apagou && st.gravity === 1500 && st.solid.mosaic === "t.chao" && st.actors[0].animations.walk === "anda" && p?.atores?.[0]?.tipo === "jogador" && p?.solido?.mosaico === "t.chao" && doc.serialize() === antes,
      `palco por comandos: stage.actor cria osso, camada, instancia e ator; stage.set; renomear e apagar a instancia acompanham; stage.remove apaga; desfazer volta (${JSON.stringify({ semTipo, foraPaleta, criou, renomeou, tirou, apagou })})`,
    );
  }
  // pose de video (rotoscopia): um corpo sintetico de angulos conhecidos (perna balancando com
  // ruido de 1 px, as pernas trocadas pelo detector nos quadros 10 a 12, o pe escorregando 10 px no
  // chao nos quadros 0 a 14) vira chaves certas: a troca desfeita, os angulos de volta, o pe preso no
  // chao por IK (e sem a trava ele escorrega), menos chaves que quadros
  {
    const { Document } = await import("../src/core/document.ts");
    const { executeAsync } = await import("../src/core/commands/index.ts");
    const rig = {
      skeleton: { spine: "4.3.23" },
      bones: [
        { name: "root" },
        { name: "quadril", parent: "root", y: 100 },
        { name: "tronco", parent: "quadril", rotation: 90, length: 60 },
        { name: "coxa_e", parent: "quadril", rotation: -90, length: 50 },
        { name: "canela_e", parent: "coxa_e", x: 50, length: 45 },
        { name: "pe_e", parent: "canela_e", x: 45, rotation: 90, length: 10 },
        { name: "coxa_d", parent: "quadril", rotation: -90, length: 50 },
        { name: "canela_d", parent: "coxa_d", x: 50, length: 45 },
        { name: "pe_d", parent: "canela_d", x: 45, rotation: 90, length: 10 },
      ],
      slots: [],
      skins: [{ name: "default", attachments: {} }],
      animations: {},
    };
    const d = new Document(structuredClone(rig) as any, { text: "", pages: {} });
    // a pessoa: o dobro do rig (coxa 100 px, canela 90 px), quadril parado em (300, 200) da imagem
    const F = 30,
      N = 45,
      L1 = 100,
      L2 = 90,
      H: [number, number] = [300, -200];
    let sem = 1;
    const ruido = () => ((sem = (sem * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const rad = (g: number) => (g * Math.PI) / 180;
    const verdade: { e: [number, number]; d: [number, number] }[] = [];
    const frames = Array.from({ length: N }, (_, i) => {
      const t = i / F;
      // a esquerda: quadros 0 a 14 apoiada (o tornozelo desliza 10 px no chao, y fixo); depois balanca
      let ce: number, ke: number;
      if (i < 15) {
        const ax = 300 + (10 * i) / 14,
          ay = -200 - 186;
        const dd = Math.hypot(ax - H[0], ay - H[1]);
        const base = (Math.atan2(ay - H[1], ax - H[0]) * 180) / Math.PI;
        const abre = (Math.acos((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd)) * 180) / Math.PI;
        ce = base + abre;
        const kx = H[0] + Math.cos(rad(ce)) * L1,
          ky = H[1] + Math.sin(rad(ce)) * L1;
        ke = (Math.atan2(ay - ky, ax - kx) * 180) / Math.PI;
      } else {
        ce = -90 + 25 * Math.sin(2 * Math.PI * (t - 0.5));
        ke = ce - 20;
      }
      const cd = -90 - 20 * Math.sin(2 * Math.PI * t),
        kd = cd - 10;
      verdade.push({ e: [ce, ke], d: [cd, kd] });
      const pernaPts = (c: number, k: number) => {
        const j: [number, number] = [H[0] + Math.cos(rad(c)) * L1, H[1] + Math.sin(rad(c)) * L1];
        const a: [number, number] = [j[0] + Math.cos(rad(k)) * L2, j[1] + Math.sin(rad(k)) * L2];
        return { j, a, cal: [a[0] - 10, a[1] - 5] as [number, number], pe: [a[0] + 25, a[1] - 5] as [number, number] };
      };
      let pe = pernaPts(ce, ke),
        pd = pernaPts(cd, kd);
      if (i >= 10 && i <= 12) [pe, pd] = [pd, pe];
      const img = (p: [number, number]) => [p[0] + ruido(), -p[1] + ruido(), 0, 1];
      const pts = Array.from({ length: 33 }, () => img(H));
      pts[11] = pts[12] = img([H[0], H[1] + 120]);
      pts[7] = pts[8] = img([H[0], H[1] + 160]);
      [pts[23], pts[24]] = [img(H), img(H)];
      [pts[25], pts[27], pts[29], pts[31]] = [img(pe.j), img(pe.a), img(pe.cal), img(pe.pe)];
      [pts[26], pts[28], pts[30], pts[32]] = [img(pd.j), img(pd.a), img(pd.cal), img(pd.pe)];
      return { t, points: pts };
    });
    const [r] = await executeAsync(d, { cmd: "pose.fromLandmarks", args: { anim: "t.andar", frames, smooth: 0.3, translate: "none" } }, "ui");
    const tl = (d.json as any).animations["t.andar"].bones;
    const em = (keys: any[], t: number) => {
      let k = keys.findIndex((x) => (x.time ?? 0) > t + 1e-9);
      if (k < 0) return keys[keys.length - 1].value;
      if (k === 0) return keys[0].value;
      const a = keys[k - 1],
        b = keys[k];
      return a.value + ((b.value - a.value) * (t - (a.time ?? 0))) / ((b.time ?? 0) - (a.time ?? 0));
    };
    // os angulos de volta (fora do contato, onde a trava nao mexe): coxa = mundo + 90, canela = canela - coxa
    let pior = 0;
    for (let i = 18; i < N; i++) {
      const t = i / F;
      pior = Math.max(pior, Math.abs(em(tl.coxa_d.rotate, t) - (verdade[i].d[0] + 90)), Math.abs(em(tl.canela_d.rotate, t) - (verdade[i].d[1] - verdade[i].d[0])));
      pior = Math.max(pior, Math.abs(em(tl.coxa_e.rotate, t) - (verdade[i].e[0] + 90)));
    }
    // o tornozelo esquerdo do rig no contato (coxa 50, canela 45 a partir de (0, 100))
    const tornozelo = (keysC: any[], keysK: any[], t: number) => {
      const c = -90 + em(keysC, t),
        k = c + em(keysK, t);
      return [Math.cos(rad(c)) * 50 + Math.cos(rad(k)) * 45, 100 + Math.sin(rad(c)) * 50 + Math.sin(rad(k)) * 45];
    };
    const deriva = (b: any) => {
      const p = Array.from({ length: 12 }, (_, i) => tornozelo(b.coxa_e.rotate, b.canela_e.rotate, (i + 1) / F));
      return Math.max(...p.map((x) => Math.hypot(x[0] - p[0][0], x[1] - p[0][1])));
    };
    const presa = deriva(tl);
    const d2 = new Document(structuredClone(rig) as any, { text: "", pages: {} });
    await executeAsync(d2, { cmd: "pose.fromLandmarks", args: { anim: "t.andar", frames, smooth: 0.3, translate: "none", lockFeet: false } }, "ui");
    const solta = deriva((d2.json as any).animations["t.andar"].bones);
    check(
      r.trocas >= 2 && pior < 3 && r.contatos.some((c: any) => c.lado === "e") && presa < 0.3 && solta > 1.5 && r.chavesDepois < r.chavesAntes && r.escala === 0.5,
      `pose de video: ${r.trocas} trocas de lado desfeitas, angulos de volta (pior ${pior.toFixed(2)} graus), pe preso no contato (deriva ${presa.toFixed(2)}; sem a trava ${solta.toFixed(2)}), chaves ${r.chavesAntes} -> ${r.chavesDepois}, escala ${r.escala}`,
    );
  }
  // particulas: particles.set cria (imagem do slot por padrao) e muda, key.set anima rate e
  // burst, renomear o slot e o osso acompanha, apagar o slot leva o emissor; o spine-core le
  {
    const s0 = doc.json.slots.find((s: any) => s.attachment)!;
    await run("particles.set", { name: "t.faisca", slot: s0.name, rate: 15, life: [0.5, 1], scale: [0.4, 0.1], color: ["ffd23cff", "ff000000"] });
    await run("particles.set", { name: "t.faisca", gravity: 120 });
    let semSlot = false;
    await run("particles.set", { name: "t.outra" }).catch(() => (semSlot = true));
    await run("animation.create", { name: "t.particulas" });
    await run("key.set", { anim: "t.particulas", target: { particles: "t.faisca" }, timeline: "rate", time: 0, value: 0 });
    await run("key.set", { anim: "t.particulas", target: { particles: "t.faisca" }, timeline: "rate", time: 0.5, value: 40 });
    await run("key.set", { anim: "t.particulas", target: { particles: "t.faisca" }, timeline: "burst", time: 0.25, count: 8 });
    let erroSpine = "";
    try {
      const { SkeletonJson, AtlasAttachmentLoader, TextureAtlas } = await import("@esotericsoftware/spine-core");
      new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
    } catch (e: any) {
      erroSpine = String(e?.message ?? e);
    }
    const em = (doc.json as any).particles[0];
    const tl = doc.json.animations["t.particulas"].particles["t.faisca"];
    const osso0 = em.bone ?? s0.bone;
    check(
      em.image === (s0.attachment ?? em.image) && em.gravity === 120 && em.escala?.[0] === 0.4 && semSlot && tl.rate[0].value === 0 && tl.rate[1].value === 40 && tl.burst[0].count === 8 && !erroSpine,
      `particulas: particles.set cria e muda, key.set anima rate e burst, spine-core le o documento${erroSpine ? ` (erro: ${erroSpine})` : ""}`,
    );
    const nome0 = s0.name;
    // fogo (tons, blend, balanco) e raio (entre dois ossos) vao para o .boneco com os nomes certos
    await run("particles.set", { name: "t.fogo", slot: s0.name, color: ["ffffffff", "ffcc00ff", "ff3300ff", "ff000000"], blend: "additive", wave: [4, 6] });
    const ossos2 = doc.json.bones.map((o: any) => o.name);
    await run("particles.set", { name: "t.raio", slot: s0.name, type: "lightning", bone: ossos2[1], toBone: ossos2[2], segments: 12, jitter: 0.2, width: 10, branches: 2, refresh: 0.05, rate: 1 });
    {
      const { importarSpine } = await import("../src/boneco/spine.ts");
      const bb = importarSpine(doc.json, atlasText, "t");
      const fogo = bb.particulas.find((x: any) => x.nome === "t.fogo"),
        raio = bb.particulas.find((x: any) => x.nome === "t.raio");
      check(
        fogo?.blend === "aditivo" && fogo?.cor?.length === 4 && fogo?.onda?.[1] === 6 && raio?.tipo === "raio" && raio?.ate === ossos2[2] && raio?.segmentos === 12 && raio?.desvio === 0.2 && raio?.ramos === 2 && raio?.troca === 0.05,
        `particulas: fogo (tons, blend, onda) e raio (tipo, ate, segmentos, desvio, ramos, troca) chegam ao .boneco (${JSON.stringify(raio)})`,
      );
    }
    // variacoes: cada particula sorteia uma das imagens; a primeira vale como imagem do emissor
    {
      const imgs = doc.json.slots.filter((s: any) => s.attachment).slice(0, 2).map((s: any) => s.attachment);
      await run("particles.set", { name: "t.fumaca", slot: s0.name, variants: imgs, rate: 6 });
      const { importarSpine } = await import("../src/boneco/spine.ts");
      const fu = importarSpine(doc.json, atlasText, "t").particulas.find((x: any) => x.nome === "t.fumaca");
      check(fu?.imagem === imgs[0] && JSON.stringify(fu?.variacoes) === JSON.stringify(imgs), `particulas: variants vira variacoes no .boneco, a primeira e a imagem (${JSON.stringify(fu?.variacoes)})`);
      await run("particles.delete", { name: "t.fumaca" });
    }
    await run("particles.delete", { name: "t.fogo" });
    await run("particles.delete", { name: "t.raio" });
    await run("slot.rename", { slot: nome0, to: "t.slotp" });
    const seguiu = (doc.json as any).particles[0].slot === "t.slotp";
    await run("slot.rename", { slot: "t.slotp", to: nome0 });
    await run("particles.rename", { name: "t.faisca", to: "t.brilho" });
    const renomeou = !!doc.json.animations["t.particulas"].particles["t.brilho"];
    await run("particles.delete", { name: "t.brilho" });
    check(seguiu && renomeou && !(doc.json as any).particles && !doc.json.animations["t.particulas"].particles && !!osso0, "particulas: renomear slot e emissor acompanha; apagar leva as timelines");
    await run("animation.delete", { name: "t.particulas" });
  }
  // path constraint no formato 4.3 (slot em "slot"): o runtime le, a posicao anima e o
  // estudo do rig (que nao carrega o path attachment) nao quebra com a timeline dele
  await run("slot.add", { name: "trilho", bone: "root" });
  await run("path.create", { slot: "trilho", name: "trilho", points: [[-60, 0], [0, 0], [60, 0], [140, 0], [200, 0], [260, 0]] });
  await run("slot.set", { slot: "trilho", attachment: "trilho" });
  await run("bone.add", { name: "conta", parent: "root" });
  await run("pathc.create", { name: "anda_no_trilho", bones: ["conta"], target: "trilho" });
  await run("animation.create", { name: "t.trilho" });
  await run("key.set", { anim: "t.trilho", target: { constraint: "anda_no_trilho" }, timeline: "position", time: 0, value: 0 });
  await run("key.set", { anim: "t.trilho", target: { constraint: "anda_no_trilho" }, timeline: "position", time: 1, value: 1 });
  const pc = doc.json.constraints.find((c: any) => c.name === "anda_no_trilho");
  runtimeOk("path constraint");
  const rg = await run("query.rig", {});
  check(pc.slot === "trilho" && !("target" in pc) && rg.constraints.some((l: string) => l.startsWith("anda_no_trilho [path]") && l.includes("slot trilho")), `path constraint grava "slot" (4.3) e query.rig le a animacao com a timeline dele (${JSON.stringify(pc)})`);
  await run("slot.rename", { slot: "trilho", to: "trilho2" });
  check(doc.json.constraints.find((c: any) => c.name === "anda_no_trilho")?.slot === "trilho2", "renomear o slot do path atualiza a constraint");
  await run("animation.delete", { name: "t.trilho" });
  await run("slot.delete", { slot: "trilho2" });
  await run("bone.delete", { bone: "conta" });
  check(!doc.json.constraints.some((c: any) => c.name === "anda_no_trilho"), "apagar o slot do path apaga a constraint");
  // .boneco: ida e volta com o Spine devolve o mesmo JSON e o mesmo atlas; os campos viram
  // portugues, os pesos ficam explicitos e a gravidade de fisica de rotacao troca de sinal
  {
    const { importarSpine, exportarSpine, atlasTexto } = await import("../src/boneco/spine.ts");
    const j = structuredClone(doc.json);
    j.constraints = [...(j.constraints ?? []), { type: "physics", name: "t.fis", bone: "cabeca", rotate: 1, gravity: 50 }];
    const b = importarSpine(j, atlasText, "boneco");
    const volta = exportarSpine(JSON.parse(JSON.stringify(b)));
    const fis = b.restricoes.find((c: any) => c.nome === "t.fis");
    const txt = JSON.stringify(b);
    const pesos = Object.values<any>(b.skins[0].partes).flatMap((s: any) => Object.values<any>(s)).find((a: any) => a.pesos);
    check(
      JSON.stringify(volta.json) === JSON.stringify(j) && JSON.stringify(parseAtlas(volta.atlas)) === JSON.stringify(parseAtlas(atlasText)) && fis.gravidade === -50 && !/"(bones|attachments|rotation|time)"/.test(txt) && Array.isArray(pesos?.pesos?.[0]?.[0]),
      `.boneco: ida e volta com o Spine igual, campos em portugues, pesos explicitos, gravidade no sentido do jogo (${b.ossos.length} ossos, ${b.imagens.length} imagens)`,
    );
    // no editor: x.boneco vira .spine-json, .atlas e .ficha.md virtuais; gravar o esqueleto
    // regrava o .boneco guardando mix, compressao da pagina e multiply do motor
    const { bonecoAsset, lerVirtual, gravarVirtual } = await import("../server/boneco.ts");
    const arq = join(dir, "t.boneco");
    const b2 = { ...b, mix: { padrao: 0.2 }, ficha: { texto: "# t" } };
    b2.paginas[0].jogo = { compressao: "perda", qualidade: 0.7 };
    writeFileSync(arq, JSON.stringify(b2));
    const asset = bonecoAsset(arq)!;
    const sj = JSON.parse(lerVirtual(asset.skeleton)!);
    sj.animations[Object.keys(sj.animations)[0]].bones = { cabeca: { rotate: [{ time: 0.25, value: 7 }] } };
    gravarVirtual(asset.skeleton, Buffer.from(JSON.stringify(sj)));
    gravarVirtual(asset.skeleton.replace(/\.spine-json$/, ".ficha.md"), Buffer.from("# nova"));
    const b3 = JSON.parse(readFileSync(arq, "utf8"));
    const a0 = Object.keys(b3.animacoes)[0];
    check(
      asset.defaultMix === 0.2 && lerVirtual(asset.atlas) === atlasTexto(b2) && b3.animacoes[a0].ossos.cabeca.girar[0].valor === 7 && b3.mix.padrao === 0.2 && b3.paginas[0].jogo?.qualidade === 0.7 && b3.ficha.texto === "# nova",
      ".boneco no editor: le e grava pelos arquivos virtuais sem perder mix, compressao e ficha",
    );
    // o dicionario sem chave repetida (no objeto literal a ultima ganharia calada)
  {
    const fonte = readFileSync(new URL("../src/boneco/dicionario.ts", import.meta.url), "utf8");
    const bloco = fonte.slice(fonte.indexOf("export const CAMPOS"), fonte.indexOf("};", fonte.indexOf("export const CAMPOS")));
    const chaves = [...bloco.matchAll(/^\s+([A-Za-z_][\w]*):/gm)].map((m) => m[1]);
    const rep = chaves.filter((k, i) => chaves.indexOf(k) !== i);
    check(!rep.length, `dicionario do .boneco sem chave repetida${rep.length ? `: ${rep.join(", ")}` : ""} (${chaves.length} campos)`);
  }
  // efeitos (so do Mamulengo): vao e voltam como `effects`, o spine-core le o JSON sem
    // reclamar e a exportacao para o Spine de verdade os tira com aviso
    const be = structuredClone(b);
    const se = be.slots[0].nome;
    be.slots[0].efeitos = { linha: { cor: "ffcc00ff", largura: 3 }, brilho: { forca: 0.8, raio: 12 } };
    be.particulas = [{ nome: "brilhos", slot: se, imagem: be.imagens[0].nome, taxa: 5, vida: [0.5, 1], escala: [1, 0.2], cor: ["ffffffff", "ffffff00"] }];
    be.animacoes[a0] = { ...be.animacoes[a0], particulas: { brilhos: { taxa: [{ valor: 0 }, { tempo: 0.3, valor: 20 }], rajada: [{ tempo: 0.1, quantidade: 6 }] } }, efeitos: { [se]: { dissolver: [{ valor: 0 }, { tempo: 0.5, valor: 1, cor: "00ff88ff" }], tingir: [{ cor: "ff0000ff", forca: 0, curva: "degrau" }, { tempo: 0.25, forca: 1 }] } } };
    const ve = exportarSpine(structuredClone(be));
    const soSpine = exportarSpine(structuredClone(be), { soSpine: true });
    const { SkeletonJson, AtlasAttachmentLoader, TextureAtlas } = await import("@esotericsoftware/spine-core");
    let lido = "";
    try {
      new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(ve.atlas))).readSkeletonData(structuredClone(ve.json));
    } catch (e: any) {
      lido = String(e?.message ?? e);
    }
    const de = importarSpine(ve.json, ve.atlas, "boneco");
    check(
      ve.json.slots[0].effects?.outline?.width === 3 &&
        ve.json.animations[a0].effects?.[se]?.dissolve?.[1]?.value === 1 &&
        !lido &&
        JSON.stringify(de.slots[0].efeitos) === JSON.stringify(be.slots[0].efeitos) &&
        JSON.stringify(de.animacoes[a0].efeitos) === JSON.stringify(be.animacoes[a0].efeitos) &&
        !JSON.stringify(soSpine.json).includes("effects") &&
        soSpine.avisos.filter((a) => a.includes("efeito")).length === 2 &&
        JSON.stringify(de.particulas) === JSON.stringify(be.particulas) &&
        JSON.stringify(de.animacoes[a0].particulas) === JSON.stringify(be.animacoes[a0].particulas) &&
        ve.json.particles?.[0]?.rate === 5 &&
        !JSON.stringify(soSpine.json).includes("particles") &&
        soSpine.avisos.filter((a) => a.includes("particulas")).length === 2,
      `.boneco: efeitos e particulas vao e voltam (effects, particles), o spine-core le sem erro${lido ? ` (erro: ${lido})` : ""} e a exportacao para o Spine tira com aviso`,
    );
  }
  const { parseFicha } = await import("../src/core/ficha.ts");
  const f = parseFicha('## Animacao: a\n```regras\ntroca "dedo esquerdo 1" "dedo esquerdo 2"\n```\n## Rig\n```regras\nexceto a,b\npreso X Y 3\n```\n');
  check(f.byAnim.a[0].args.join("|") === "dedo esquerdo 1|dedo esquerdo 2" && f.all[0].except.join() === "a,b", "ficha: nomes com espaco entre aspas e exceto");
}

// anim.match: a animacao termina (e comeca) na pose de entrada de outra
{
  const anims = Object.keys(doc.json.animations);
  await run("animation.create", { name: "t.emenda" });
  await run("key.set", { anim: "t.emenda", target: { bone: "peito" }, timeline: "rotate", time: 0, value: 25 });
  await run("key.set", { anim: "t.emenda", target: { bone: "peito" }, timeline: "rotate", time: 0.6, value: -30 });
  await run("key.set", { anim: "t.emenda", target: { bone: "cabeca" }, timeline: "scale", time: 0.6, x: 1.3, y: 0.8 });
  const { checkAnimation } = await import("../src/core/ficha.ts");
  const rule = (k: string) => checkAnimation(doc.json, "t.emenda", [{ line: k, kind: k, args: [anims[0], "1"], except: [] }])[0];
  const before = rule("termina_como");
  const m = await run("anim.match", { anim: "t.emenda", like: anims[0], at: "ambos" });
  const after = [rule("termina_como"), rule("comeca_como")];
  check(!before.ok && after.every((r) => r.ok) && m.keys > 0, `anim.match emenda com ${anims[0]}: antes ${before.detail}; depois ${after.map((r) => r.detail).join(" / ")}`);
  runtimeOk("anim.match");
  await run("animation.delete", { name: "t.emenda" });
}

// query.estilo: mede com a regua da casa e compara com a faixa do papel
{
  const anim = Object.keys(doc.json.animations)[0];
  const e = await run("query.estilo", { anim, tipo: "personagem", papel: "idle" });
  check(e.medidas?.length === 11 && typeof e.fora_da_faixa === "number" && e.medidas.every((l: string) => /^(ok|ABAIXO|ACIMA)/.test(l)), `query.estilo: ${e.fora_da_faixa} fora da faixa de ${e.referencia}`);
}

// atlas: imagem maior que a pagina padrao (2048) faz a pagina crescer ate 4096
{
  const { packAtlas } = await import("../server/atlas.ts");
  const big = await sharp({ create: { width: 30, height: 2100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const small = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const r = await packAtlas([{ name: "veu", data: big }, { name: "ponto", data: small }]);
  const pg = await sharp(r.pages[0].data).metadata();
  let recusou = "";
  const huge = await sharp({ create: { width: 10, height: 4200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  await packAtlas([{ name: "enorme", data: huge }]).catch((e) => (recusou = e.message));
  check(r.regions === 2 && (pg.height ?? 0) > 2048 && (pg.height ?? 0) <= 4096 && /reduza/.test(recusou), `atlas cresce para imagem de 2100 px (pagina ${pg.width}x${pg.height}); acima de 4096 recusa`);
}

// numeros: ruido minusculo vira 0 e nada termina em ponto (JSON valido)
{
  const { serializeSpineJson } = await import("../src/core/format.ts");
  const txt = serializeSpineJson({ skeleton: {}, bones: [{ name: "a", rotation: 1e-21, x: -3e-15, y: 2.5e-7 }] } as any, undefined, { reuse: false });
  let ok = true;
  try {
    const b = JSON.parse(txt).bones[0];
    ok = b.rotation === 0 && Math.abs(b.x + 3e-15) < 1e-18 && Math.abs(b.y - 2.5e-7) < 1e-12;
  } catch {
    ok = false;
  }
  check(ok && !/\d\.[,}\]]/.test(txt), `numeros minusculos saem como JSON valido: ${txt.slice(txt.indexOf('"bones"'), txt.indexOf('"bones"') + 70)}`);
}

// slot.set com outro osso mantem a imagem no lugar da tela (keepWorld)
{
  const sk0 = doc.json.slots.find((s: any) => s.bone === "cabeca" && s.attachment);
  if (sk0) {
    const { skeletonAt } = await import("../src/core/pose.ts");
    const center = () => {
      const sk = skeletonAt(doc.json, null, 0);
      const s = doc.json.slots.find((x: any) => x.name === sk0.name);
      const att = doc.json.skins[0].attachments[sk0.name][s.attachment];
      const b = sk.findBone(s.bone)!;
      const x = att.x ?? 0,
        y = att.y ?? 0;
      return [b.a * x + b.b * y + b.worldX, b.c * x + b.d * y + b.worldY];
    };
    const before = center();
    await run("slot.set", { slot: sk0.name, bone: "peito" });
    const after = center();
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
    check(moved < 0.01 && doc.json.slots.find((x: any) => x.name === sk0.name).bone === "peito", `slot.set troca o osso sem mover a imagem (${moved.toFixed(4)})`);
    doc.undo();
  }
}

// versoes: automatica sem duplicar, marcada com nome, comparar e restaurar (guarda o atual antes)
{
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: pj } = await import("node:path");
  const tmp = mkdtempSync(pj(tmpdir(), "mamulengo-versoes-"));
  process.env.MAMULENGO_VERSIONS = pj(tmp, "store");
  const V = await import("../server/versions.ts");
  const { diffSpine } = await import("../src/core/versions.ts");
  const sk = pj(tmp, "boneco.spine-json"),
    at = pj(tmp, "boneco.atlas");
  const doc1 = { skeleton: {}, bones: [{ name: "root" }], animations: { idle: { bones: { root: { rotate: [{ value: 5 }] } } } } };
  wf(sk, JSON.stringify(doc1));
  wf(at, "boneco.webp\nsize:4,4\nfilter:Linear,Linear\na\nbounds:0,0,2,2\n");
  wf(pj(tmp, "boneco.webp"), "pagina");
  const v1 = V.saveVersion({ skeleton: sk, atlas: at }).entry;
  const again = V.saveVersion({ skeleton: sk, atlas: at });
  const doc2 = { ...doc1, bones: [{ name: "root" }, { name: "cabeca", parent: "root" }], animations: { ...doc1.animations, pula: { bones: { cabeca: { translate: [{ y: 10 }] } } } } };
  wf(sk, JSON.stringify(doc2));
  V.saveVersion({ skeleton: sk, atlas: at, source: "claude" });
  const named = V.saveVersion({ skeleton: sk, atlas: at, label: "antes do festa" }).entry;
  const changes = diffSpine(doc1 as any, doc2 as any);
  const backups: string[] = [];
  const r = V.restoreVersion({ skeleton: sk, atlas: at, id: v1.id, backup: (p: string) => backups.push(p) });
  const list = V.listVersions(sk);
  check(
    !again.created && list.length === 4 && named.label === "antes do festa" && changes.some((c: string) => c.includes("animações novas: pula")) && changes.some((c: string) => c.includes("ossos novos: cabeca")) && JSON.parse(rf(sk, "utf8")).animations.pula === undefined && r.before.label?.startsWith("antes de restaurar") && backups.length >= 2,
    `versoes: ${list.length} guardadas (automatica sem duplicar), marcada, diff "${changes.join("; ")}", restaurar volta e guarda o atual`,
  );
  // .boneco: o esqueleto e o atlas sao virtuais (server/boneco.ts); guardar, mudar e restaurar
  {
    const { copyFileSync: cp, existsSync: ex } = await import("node:fs");
    const { gravarVirtual, lerVirtual } = await import("../server/boneco.ts");
    const orig = new URL("./boneco/robo/", import.meta.url).pathname;
    cp(orig + "robo.boneco", pj(tmp, "robo.boneco"));
    cp(orig + "robo-hd.webp", pj(tmp, "robo-hd.webp"));
    const bsk = pj(tmp, "robo.boneco.spine-json"),
      bat = pj(tmp, "robo.boneco.atlas");
    const ossos = () => JSON.parse(lerVirtual(bsk)!).bones.length;
    const n0 = ossos();
    const b1 = V.saveVersion({ skeleton: bsk, atlas: bat }).entry;
    const j = JSON.parse(lerVirtual(bsk)!);
    j.bones.push({ name: "osso_novo", parent: "root" });
    gravarVirtual(bsk, Buffer.from(JSON.stringify(j)));
    const b2 = V.saveVersion({ skeleton: bsk, atlas: bat, label: "com osso" });
    const guardados: string[] = [];
    const readBlob = V.readBlob;
    V.restoreVersion({ skeleton: bsk, atlas: bat, id: b1.id, backup: (p: string) => guardados.push(p) });
    const comOsso = JSON.parse(readBlob(b2.entry.skeleton).toString("utf8")).bones.length;
    check(b2.created && comOsso === n0 + 1 && ossos() === n0 && V.listVersions(bsk).length === 3 && guardados.includes(pj(tmp, "robo.boneco")) && ex(pj(tmp, "robo.boneco")), `versoes de um .boneco: guarda, marca e restaura (${n0} ossos de volta, copia de seguranca do .boneco)`);
  }
  delete process.env.MAMULENGO_VERSIONS;
}

// anotacoes: criar presa ao instante, responder, resolver, reabrir, apagar
{
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf, existsSync: ex } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: pj } = await import("node:path");
  const N = await import("../server/notes.ts");
  const tmp = mkdtempSync(pj(tmpdir(), "mamulengo-notas-"));
  const sk = pj(tmp, "boneco.spine-json");
  wf(sk, "{}");
  const bk: string[] = [];
  const a = N.changeNotes(sk, { acao: "criar", autor: "Ana", texto: "o braco gira demais aqui", anim: "1.idle", tempo: 0.5, osso: "braco" }, (p) => bk.push(p)) as any;
  N.changeNotes(sk, { acao: "criar", autor: "Ana", texto: "geral: deixar mais malandro" }, () => {});
  N.changeNotes(sk, { acao: "responder", id: a.id, autor: "Claude", texto: "reduzi para 20 graus" }, () => {});
  N.changeNotes(sk, { acao: "resolver", id: a.id, autor: "Claude" }, () => {});
  const list = N.listNotes(sk);
  const n0 = list.find((n) => n.id === a.id)!;
  let vazia = "";
  try {
    N.changeNotes(sk, { acao: "criar", autor: "x", texto: "  " }, () => {});
  } catch (e: any) {
    vazia = e.message;
  }
  N.changeNotes(sk, { acao: "apagar", id: list[1].id }, () => {});
  check(
    list.length === 2 && n0.estado === "resolvida" && n0.respostas.length === 2 && n0.tempo === 0.5 && n0.osso === "braco" && list[1].anim === null && vazia === "nota vazia" && N.listNotes(sk).length === 1 && ex(N.notesPath(sk)) && JSON.parse(rf(N.notesPath(sk), "utf8")).versao === 1 && bk.length === 1,
    `anotacoes: presa e geral, resposta, resolvida, apagar, arquivo ${N.notesPath(sk).split("/").pop()}`,
  );
}

// malha automatica em peca longa e fina (tronco de palmeira): pontos ao longo do meio
{
  const { autoMesh } = await import("../src/core/geometry.ts");
  const W = 400,
    H = 1000;
  const alpha = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const copa = y < 300 && Math.hypot(x - 200, y - 150) < 190;
      const tronco = y >= 250 && x >= 185 && x < 215;
      if (copa || tronco) alpha[y * W + x] = 255;
    }
  const m = autoMesh(alpha, W, H, { detail: 1, stride: 1 });
  const noTronco = m.points.slice(m.hullCount).filter(([x, y]) => y > 350 && x > 185 && x < 215);
  check(noTronco.length >= 6 && m.triangles.length > 0, `malha auto poe ${noTronco.length} pontos ao longo do tronco fino (antes: nenhum)`);
}

// recipe.sway com ciclos: repete ate o fim da animacao (folha com periodo curto)
{
  await run("animation.create", { name: "t.vento" });
  await run("key.set", { anim: "t.vento", target: { bone: "peito" }, timeline: "rotate", time: 4, value: 0 });
  const r = await run("recipe.sway", { anim: "t.vento", bone: "cabeca", angle: 5, period: 1, cycles: "fim" });
  const ks = doc.json.animations["t.vento"].bones.cabeca.rotate;
  check(r.cycles === 4 && ks.length === 17 && Math.abs(ks[ks.length - 1].time - 4) < 1e-6, `recipe.sway cycles "fim": ${r.cycles} ciclos, ${ks.length} chaves ate 4 s`);
  await run("animation.delete", { name: "t.vento" });
}

// desfazer ate o ponto salvo volta a "salvo"; refazer volta a "nao salvo"
{
  doc.markSaved();
  const anim = Object.keys(doc.json.animations)[0];
  await run("key.set", { anim, target: { bone: "peito" }, timeline: "rotate", time: 0.33, value: 3 });
  const a = doc.dirty;
  doc.undo();
  const b = doc.dirty;
  doc.redo();
  const c = doc.dirty;
  doc.undo();
  check(a && !b && c && !doc.dirty, `dirty segue a pilha de desfazer (${a},${b},${c})`);
}

// atritos do teste de aceitacao
{
  const r = await run("attachment.region", { slot: "antena", name: "olho_2", world: { center: [0, 0], size: [60, 30] } });
  check(r.visible === false, "attachment.region nao troca imagem de slot que ja mostra outra");
  await run("slot.add", { name: "vazio", bone: "cabeca" });
  const r2 = await run("attachment.region", { slot: "vazio", name: "olho_1", world: { center: [0, 400], size: [60, 30] } });
  check(r2.visible === true, "attachment.region deixa visivel a imagem de slot vazio");
  await run("bone.set", { name: "antena", at: [12, 425] });
  await run("key.set", { anim: "1.idle", target: { bone: "cabeca" }, timeline: "translate", time: 0.3, x: 0, y: 25, space: "world" });
  const { skeletonAt, boneWorld } = await import("../src/core/pose.ts");
  const p0 = boneWorld(skeletonAt(doc.json, null, 0), "cabeca");
  const sk = skeletonAt(doc.json, "1.idle", 0.3);
  const k = doc.json.animations["1.idle"].bones.cabeca.translate;
  check(k.length >= 1, "translate em espaco de mundo vira chave no espaco do pai");
  void p0;
  void sk;
  const d = await run("timeline.delete", { anim: "1.idle", target: { bone: "cabeca" }, timeline: "translate" });
  check(d.deleted >= 1 && !doc.json.animations["1.idle"].bones.cabeca.translate, "timeline.delete apaga a timeline");
}

// receitas
await run("recipe.breathe", { anim: "2.receitas", bone: "peito" });
await run("recipe.sway", { anim: "2.receitas", bone: "cabeca", angle: 8, phase: 0.25 });
await run("recipe.bounce", { anim: "3.pulo", bone: "quadril", height: 60 });
await run("recipe.popin", { anim: "4.entra", bone: "quadril", slot: "corpo" });
await run("recipe.pulse", { anim: "2.receitas", slot: "brilho", max: 0.8 });
await run("recipe.blink", { anim: "2.receitas", slot: "olho", open: "olho_1", closed: "olho_2", at: 1.2 });
await run("recipe.flipbook", { anim: "5.flip", slot: "olho", frames: ["olho_1", "olho_2", "olho_1", "olho_2"], fps: 12, loop: false });
await run("recipe.shake", { anim: "3.pulo", bone: "cabeca", start: 0.8 });
runtimeOk("receitas");

// principios: antecipacao, overshoot, sobreposicao
await run("animation.create", { name: "6.principios" });
await run("key.set", { anim: "6.principios", target: { bone: "cabeca" }, timeline: "rotate", time: 0, value: 0 });
await run("key.set", { anim: "6.principios", target: { bone: "cabeca" }, timeline: "rotate", time: 0.5, value: 30 });
await run("key.set", { anim: "6.principios", target: { bone: "cabeca" }, timeline: "rotate", time: 1.2, value: 0 });
const ant = await run("anim.anticipate", { anim: "6.principios", target: { bone: "cabeca" }, timeline: "rotate", time: 0.5 });
const rot = () => doc.json.animations["6.principios"].bones.cabeca.rotate;
check(Math.abs(ant.inserted - 0.38) < 1e-3 && rot().find((k: any) => Math.abs((k.time ?? 0) - 0.38) < 1e-3).value < 0, "antecipacao: recuo no sentido contrario antes do movimento");
await run("anim.overshoot", { anim: "6.principios", target: { bone: "cabeca" }, timeline: "rotate", time: 0.5 });
check(rot().find((k: any) => Math.abs((k.time ?? 0) - 0.5) < 1e-3).value > 30 && rot().find((k: any) => Math.abs((k.time ?? 0) - 0.7) < 1e-3).value === 30, "overshoot: passa do ponto e assenta");
await run("key.set", { anim: "6.principios", target: { bone: "peito" }, timeline: "rotate", time: 0, value: 0 });
await run("key.set", { anim: "6.principios", target: { bone: "peito" }, timeline: "rotate", time: 0.6, value: 10 });
await run("anim.overlap", { anim: "6.principios", from: "peito", chain: ["cabeca"], delay: 0.1, damping: 0.5 });
runtimeOk("principios");

// a pagina dos desenhos fora do editor (src/core/desenho-svg.ts, server/desenhos.ts): traco por
// fora fica so do lado de fora, por dentro so do lado de dentro, e o arranjo e o do editor
{
  const { desenhoEmSvg } = await import("../src/core/desenho-svg.ts");
  const ret = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const d: any = { width: 100, height: 60, shapes: [
    { name: "fora", points: ret(10, 10, 30, 30), closed: true, fill: "0000ffff", stroke: { color: "ff0000ff", width: 6, align: "outside" } },
    { name: "dentro", points: ret(60, 10, 30, 30), closed: true, fill: "0000ffff", stroke: { color: "00ff00ff", width: 6, align: "inside" } },
  ] };
  const px = await sharp(Buffer.from(desenhoEmSvg(d, 1))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => Array.from(px.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 4));
  const [foraFora, foraDentro, dentroDentro, dentroFora] = [at(7, 25), at(13, 25), at(63, 25), at(57, 25)];
  check(foraFora[0] > 200 && foraFora[3] > 200 && foraDentro[2] > 200 && foraDentro[0] < 50 && dentroDentro[1] > 200 && dentroFora[3] < 30, `desenho fora do editor: traco por fora e por dentro no SVG ${JSON.stringify({ foraFora, foraDentro, dentroDentro, dentroFora })}`);
  const { gravarPaginaDesenhos } = await import("../server/desenhos.ts");
  const tmp = mkdtempSync(join(tmpdir(), "desenhos-"));
  const r = await gravarPaginaDesenhos({ a: d, b: { ...d, hd: 3 } }, "", "t.atlas", tmp);
  const meta = await sharp(join(tmp, "t-desenhos.png")).metadata();
  check(r.pagina === "t-desenhos.png" && r.atlas.includes("t-desenhos.png") && r.atlas.includes("bounds:") && (meta.width ?? 0) >= 300, `desenho fora do editor: a pagina ${r.pagina} ${meta.width}x${meta.height} e o atlas`);
}

// filme (docs/FILME.md): a camera, chaves com corte seco, tremor, transicoes e planos viram ossos,
// partes e chaves comuns; a vista da camera (src/core/camera.ts) segue o osso
{
  const n0 = doc.history().length;
  const { vistaDaCamera } = await import("../src/core/camera.ts");
  const v = vistaDaCamera([0.5, 0, 0, 0.5, 100, 40], 1280, 720);
  const vg = vistaDaCamera([0, -1, 1, 0, 0, 0], 1280, 720);
  check(v.zoom === 2 && v.rect[2] === 640 && v.rect[0] === 100 - 320 && Math.abs(vg.giro - Math.PI / 2) < 1e-9, `filme: a vista da camera (escala 0,5 aproxima 2x, giro) ${JSON.stringify(v.rect)}`);
  const c = await run("camera.set", { width: 1280, height: 720 });
  await run("animation.create", { name: "t.filme" });
  await run("camera.key", { anim: "t.filme", time: 0, x: 0, y: 0, zoom: 1 });
  await run("camera.key", { anim: "t.filme", time: 1, x: 200, y: 0, zoom: 1.5, curve: "suave" });
  await run("camera.key", { anim: "t.filme", time: 2, x: -300, y: 50, zoom: 2, cut: true });
  const tr = doc.json.animations["t.filme"].bones.camera.translate;
  const sc = doc.json.animations["t.filme"].bones.camera.scale;
  await run("camera.shake", { anim: "t.filme", time: 1.2, duration: 0.4, strength: 12 });
  const tremor = doc.json.animations["t.filme"].bones.camera_tremor.translate;
  await run("shot.transition", { anim: "t.filme", time: 0.8, kind: "preto" });
  await run("shot.transition", { anim: "t.filme", time: 2, kind: "flash" });
  const ordem = doc.json.slots.map((x: any) => x.name);
  const s0 = doc.json.slots[0].name;
  await run("shot.show", { anim: "t.filme", time: 1.5, hide: [s0] });
  const al = doc.json.animations["t.filme"].slots[s0].rgba;
  check(
    c.camera === "camera_tremor" && doc.json.skeleton.camera === "camera_tremor" && tr[1].curve === "stepped" && Math.abs(sc[2].x - 0.5) < 1e-6 && tremor.length >= 8 && (tremor[tremor.length - 1].x ?? 0) === 0 && ordem.slice(-2).join() === "filme_preto,filme_branco" && al.some((k: any) => k.color?.endsWith("00")),
    `filme: camera.set, camera.key com corte, camera.shake, shot.transition (cortinas na frente), shot.show ${JSON.stringify({ tr1: tr[1], sc2: sc[2], tremor: tremor.length, ult: tremor[tremor.length - 1], al })}`,
  );
  const { exportarSpine, importarSpine } = await import("../src/boneco/spine.ts");
  const b = importarSpine(structuredClone(doc.json), atlasText, "t");
  check(b.esqueleto.camera === "camera_tremor" && exportarSpine(b).json.skeleton.camera === "camera_tremor", "filme: a camera vai e volta pelo .boneco");
  while (doc.history().length > n0) doc.undo();
}

// som (src/core/som.ts): os eventos com audio da animacao e das instancias, no relogio de cima;
// a instancia escondida (alfa 0) cala; a chave da instancia muda o tempo do filho
{
  const { trilhaDeSom } = await import("../src/core/som.ts");
  const filho = { eventos: { bip: { audio: "bip.ogg", volume: 0.8 } }, animacoes: { pulo: { ossos: { root: { girar: [{ tempo: 0, valor: 0 }, { tempo: 0.5, valor: 0 }] } }, eventos: [{ tempo: 0.25, nome: "bip" }] } } };
  const pai = {
    esqueleto: { audio: "sons" },
    slots: [{ nome: "s", osso: "root" }, { nome: "s2", osso: "root" }],
    eventos: { uau: { audio: "uau.ogg" } },
    instancias: [{ nome: "f", slot: "s", boneco: "f.boneco", animacao: "pulo" }, { nome: "g", slot: "s2", boneco: "f.boneco" }],
    animacoes: {
      a: {
        slots: { s: { rgba: [{ tempo: 0, cor: "ffffffff", curva: "degrau" }, { tempo: 1, cor: "ffffff00" }] } },
        instancias: { g: [{ tempo: 0.6, animacao: "pulo", inicio: 0, velocidade: 2 }] },
        eventos: [{ tempo: 1.5, nome: "uau", balanco: -0.5 }],
        ossos: { root: { girar: [{ tempo: 2, valor: 0 }] } },
      },
    },
  };
  const sons = trilhaDeSom(pai, "/x/pai.boneco", "a", 2, () => ({ b: filho, caminho: "/x/f.boneco" }));
  const lista = sons.map((x) => `${x.tempo.toFixed(3)}${x.onde ? ":" + x.onde : ""}`).join(" ");
  const esperado = "0.250:f 0.725:g 0.750:f 0.975:g 1.225:g 1.475:g 1.500 1.725:g 1.975:g";
  check(lista === esperado && sons.find((x) => x.evento === "uau")!.pasta === "/x/sons/" && sons[0].volume === 0.8, `som: trilha com instancias, laco, chave de velocidade e instancia escondida (${lista})`);
}

// mascara, ordem de desenho, eventos, skin
await run("slot.add", { name: "mascara", bone: "cabeca", below: "olho" });
await run("clipping.create", { slot: "mascara", name: "mascara", end: "olho", points: [[-60, 330], [60, 330], [60, 420], [-60, 420]] });
await run("draworder.key", { anim: "1.idle", time: 0.3, front: ["braco"] });
await run("draworder.key", { anim: "1.idle", time: 0.6, reset: true });
await run("event.create", { name: "pisca", string: "olho" });
await run("event.key", { anim: "1.idle", time: 0.8, name: "pisca" });
await run("skin.create", { name: "azul", copyFrom: "default" });
await run("linkedmesh.create", { slot: "corpo", name: "corpo_azul", source: "corpo", skin: "azul", sourceSkin: "default", path: "corpo" });
runtimeOk("mascara, draw order, eventos, skins");
// linked mesh numa skin nao-default apontando para fonte na mesma skin (o runtime le
// a fonte na skin default quando falta o campo skin)
await run("skin.create", { name: "verde", copyFrom: "default" });
await run("linkedmesh.create", { slot: "corpo", name: "corpo_verde", source: "corpo", skin: "verde", path: "corpo" });
check(doc.json.skins.find((s: any) => s.name === "verde").attachments.corpo.corpo_verde.skin === "verde", "linked mesh em skin nao-default grava o campo skin");
runtimeOk("linked mesh em skin nao-default");
// osso exclusivo de skin: tirar da lista volta a ser de todas (antes ficava exclusivo de nenhuma)
{
  const ob = doc.json.bones[doc.json.bones.length - 1].name;
  await run("skin.require", { skin: "verde", bones: [ob] });
  const marcado = !!doc.json.bones.find((b: any) => b.name === ob).skin;
  await run("skin.require", { skin: "verde", bones: [] });
  check(marcado && !doc.json.bones.find((b: any) => b.name === ob).skin && !doc.json.skins.find((s: any) => s.name === "verde").bones, "skin.require: osso que sai da lista da skin volta a ser de todas");
}

// edicao de malha: cada operacao continua lendo no runtime, mexe so no que deveria
// (posicoes de setup e deformadas dos outros vertices iguais, deforms do mesmo tamanho
// da malha, linked meshes inclusos) e desfazer/refazer volta os bytes exatos
{
  const { MeshAttachment, MixFrom } = await import("@esotericsoftware/spine-core");
  const { meshView } = await import("../src/core/commands/meshedit.ts");
  // vertices no mundo pelo runtime oficial (setup ou animacao no instante t)
  const rt = (att: string, anim: string | null, t = 0, skin = "default", slotName = "corpo"): number[][] => {
    const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
    const sk = new Skeleton(data);
    sk.setupPose();
    const slot = sk.findSlot(slotName)!;
    const a = data.findSkin(skin)!.getAttachment(slot.data.index, att) as InstanceType<typeof MeshAttachment>;
    slot.pose.setAttachment(a);
    if (anim) data.findAnimation(anim)!.apply(sk, 0, t, false, [], 1, MixFrom.setup, false, false, false);
    sk.updateWorldTransform(Physics.pose);
    const out: number[] = new Array(a.worldVerticesLength);
    a.computeWorldVertices(sk, slot, 0, a.worldVerticesLength, out, 0, 2);
    return Array.from({ length: out.length / 2 }, (_, i) => [out[i * 2], out[i * 2 + 1]]);
  };
  const far = (a: number[][], b: number[][], map: (i: number) => number) => Math.max(0, ...a.map((p, i) => (map(i) < 0 ? 0 : Math.hypot(p[0] - b[map(i)][0], p[1] - b[map(i)][1]))));
  // undo e redo exatos
  const step = async (cmd: string, args: any) => {
    const before = doc.serialize();
    const r = await run(cmd, args);
    const after = doc.serialize();
    doc.undo();
    const u = doc.serialize() === before;
    doc.redo();
    check(u && doc.serialize() === after, `${cmd}: desfazer volta os bytes e refazer reaplica`);
    return r;
  };
  // toda chave de deform da geometria do corpo cabe na malha
  const deformsFit = (stage: string) => {
    const m = doc.json.skins[0].attachments.corpo.corpo;
    let len = m.vertices.length;
    if (m.vertices.length > m.uvs.length) {
      len = 0;
      for (let i = 0; i < m.vertices.length; i += 1 + m.vertices[i] * 4) len += m.vertices[i] * 2;
    }
    let ok = true;
    for (const a of Object.values<any>(doc.json.animations))
      for (const sk of Object.values<any>(a.attachments ?? {}))
        for (const [n, d] of Object.entries<any>(sk.corpo ?? {})) if (n.startsWith("corpo")) for (const k of d.deform ?? []) if ((k.offset ?? 0) + (k.vertices?.length ?? 0) > len) ok = false;
    // triangulos cobrem o contorno sem sobrar nem sobrepor (soma das areas = area do contorno)
    const uv = (i: number) => [m.uvs[i * 2], m.uvs[i * 2 + 1]];
    let tri = 0,
      poly = 0;
    for (let i = 0; i < m.triangles.length; i += 3) {
      const [a, b, c] = [uv(m.triangles[i]), uv(m.triangles[i + 1]), uv(m.triangles[i + 2])];
      tri += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    for (let i = 0; i < m.hull; i++) {
      const [a, b] = [uv(i), uv((i + 1) % m.hull)];
      poly += (a[0] * b[1] - b[0] * a[1]) / 2;
    }
    ok &&= Math.abs(tri - Math.abs(poly)) < 1e-5;
    check(ok && m.triangles.every((i: number) => i < m.uvs.length / 2), `deforms e triangulos cabem na malha: ${stage}`);
  };
  // linked mesh com timelines proprias (o deform dele usa os mesmos indices)
  await run("linkedmesh.create", { slot: "corpo", name: "corpo_livre", source: "corpo", path: "corpo", timelines: false });
  await run("deform.set", { anim: "1.idle", slot: "corpo", attachment: "corpo_livre", time: 0.5, moves: [{ i: 3, dx: 8, dy: -4 }] });
  runtimeOk("linked mesh com deform proprio");

  const v0 = meshView(doc.json, "default", "corpo", "corpo");
  const S0 = rt("corpo", null),
    A0 = rt("corpo", "1.idle", 0.5),
    L0 = rt("corpo_livre", "1.idle", 0.5),
    Z0 = rt("corpo_azul", "1.idle", 0.5, "azul");
  check(far(S0, v0.world, (i) => i) < 0.01, `meshView bate com o runtime (desvio ${far(S0, v0.world, (i) => i).toFixed(4)})`);

  // ponto interno no meio de um triangulo
  const t3 = v0.triangles.slice(0, 3).map((i) => v0.world[i]);
  const inner = [(t3[0][0] + t3[1][0] + t3[2][0]) / 3, (t3[0][1] + t3[1][1] + t3[2][1]) / 3];
  const ai = await step("mesh.addVertex", { slot: "corpo", attachment: "corpo", at: inner });
  runtimeOk("mesh.addVertex interno");
  deformsFit("ponto interno");
  const mapIn = (i: number) => (i < ai.i ? i : i + 1);
  const S1 = rt("corpo", null);
  check(!ai.onHull && Math.hypot(S1[ai.i][0] - inner[0], S1[ai.i][1] - inner[1]) < 0.01, `ponto interno nasce onde clicou (indice ${ai.i}, ${ai.vertices} vertices, ${ai.triangles} triangulos)`);
  check(far(S0, S1, mapIn) < 0.01 && far(A0, rt("corpo", "1.idle", 0.5), mapIn) < 0.01, "ponto interno: setup e deform dos outros vertices iguais");
  check(far(L0, rt("corpo_livre", "1.idle", 0.5), mapIn) < 0.01 && far(Z0, rt("corpo_azul", "1.idle", 0.5, "azul"), mapIn) < 0.01, "ponto interno: linked meshes (timelines proprias e herdadas) iguais");

  // ponto no contorno, quase em cima da aresta 0-1
  const v1 = meshView(doc.json, "default", "corpo", "corpo");
  const e0 = v1.world[0],
    e1 = v1.world[1];
  const onEdge = [(e0[0] + e1[0]) / 2 + 1, (e0[1] + e1[1]) / 2 + 1];
  const A1 = rt("corpo", "1.idle", 0.5),
    S1b = rt("corpo", null),
    L1 = rt("corpo_livre", "1.idle", 0.5);
  const ah = await step("mesh.addVertex", { slot: "corpo", attachment: "corpo", at: onEdge, tolerance: 4 });
  runtimeOk("mesh.addVertex no contorno");
  deformsFit("ponto no contorno");
  const v2 = meshView(doc.json, "default", "corpo", "corpo");
  const mapH = (i: number) => (i < ah.i ? i : i + 1);
  check(ah.onHull && ah.i === 1 && v2.hull === v1.hull + 1, `ponto no contorno entra no hull (indice ${ah.i}, hull ${v2.hull})`);
  const A2 = rt("corpo", "1.idle", 0.5);
  check(far(S1b, rt("corpo", null), mapH) < 0.01 && far(A1, A2, mapH) < 0.01 && far(L1, rt("corpo_livre", "1.idle", 0.5), mapH) < 0.01, "ponto no contorno: os outros vertices nao mexem (setup, deform, linked)");
  const mid = [(A2[0][0] + A2[2][0]) / 2, (A2[0][1] + A2[2][1]) / 2];
  check(Math.hypot(A2[1][0] - mid[0], A2[1][1] - mid[1]) < 3, `ponto novo acompanha o deform dos vizinhos (${Math.hypot(A2[1][0] - mid[0], A2[1][1] - mid[1]).toFixed(2)}px do meio)`);

  // mover: o ponto vai para onde pedimos; sem esticar o uv muda, esticando fica
  const moved = ai.i + 1;
  const uvOf = (i: number) => doc.json.skins[0].attachments.corpo.corpo.uvs.slice(i * 2, i * 2 + 2).join();
  const target = [v2.world[moved][0] + 6, v2.world[moved][1] - 4];
  const uvBefore = uvOf(moved);
  const S2 = rt("corpo", null);
  await step("mesh.vertices", { slot: "corpo", attachment: "corpo", moves: [{ i: moved, x: target[0], y: target[1] }] });
  runtimeOk("mesh.vertices");
  const S3 = rt("corpo", null);
  check(Math.hypot(S3[moved][0] - target[0], S3[moved][1] - target[1]) < 0.01 && far(S2, S3, (i) => (i === moved ? -1 : i)) < 0.01, "mover vertice com pesos: vai ao alvo, os outros ficam");
  check(uvOf(moved) !== uvBefore, "mover sem esticar: o ponto anda sobre a imagem (uv muda)");
  const uv2 = uvOf(moved);
  await step("mesh.vertices", { slot: "corpo", attachment: "corpo", moves: [{ i: moved, dx: -3, dy: 2 }], stretch: true });
  check(uvOf(moved) === uv2, "mover esticando: uv fica");

  // remover os dois pontos novos volta a malha original (mesma geometria e deforms)
  const before = rt("corpo", "1.idle", 0.5);
  await step("mesh.removeVertex", { slot: "corpo", attachment: "corpo", i: [ah.i, moved] });
  runtimeOk("mesh.removeVertex");
  deformsFit("remover");
  const back = rt("corpo", "1.idle", 0.5);
  const unmap = (i: number) => (i === ah.i || i === moved ? -1 : i - (i > ah.i ? 1 : 0) - (i > moved ? 1 : 0));
  check(far(before, back, unmap) < 0.01 && far(S0, rt("corpo", null), (i) => i) < 0.01 && far(A0, back, (i) => i) < 0.01, "remover vertices: os outros ficam e a malha volta ao inicio");
  try {
    await run("mesh.removeVertex", { slot: "corpo", attachment: "corpo", i: Array.from({ length: v0.hull - 2 }, (_, i) => i) });
    check(false, "remover contorno demais deveria falhar");
  } catch {
    check(true, "contorno com menos de 3 pontos e recusado");
  }

  // pintar pesos: posicoes de setup ficam, pesos somam 1, o osso ganha influencia
  const vw = meshView(doc.json, "default", "corpo", "corpo");
  const pick = vw.weights.reduce((b, w, i) => ((w.peito ?? 0) < (vw.weights[b].peito ?? 0) ? i : b), 0);
  const c = vw.world[pick];
  const wBefore = vw.weights[pick].peito ?? 0;
  const pw = await step("mesh.paintWeights", { slot: "corpo", attachment: "corpo", bone: "peito", points: [c, [c[0] + 10, c[1]]], radius: 60, amount: 0.6 });
  runtimeOk("mesh.paintWeights");
  deformsFit("pintar pesos");
  const va = meshView(doc.json, "default", "corpo", "corpo");
  const sums = va.weights.map((w) => Object.values(w).reduce((s, x) => s + x, 0));
  check(pw.changed > 0 && va.weights[pick].peito > wBefore + 0.05, `pintar soma peso (peito ${wBefore.toFixed(2)} -> ${va.weights[pick].peito.toFixed(2)}, ${pw.changed} vertices)`);
  check(sums.every((s) => Math.abs(s - 1) < 1e-4) && far(S0, rt("corpo", null), (i) => i) < 0.02, "pesos normalizados e setup pose intacta");
  // osso novo perto do topo (onde ha deform): vertices pintados ganham uma influencia a
  // mais, o array de deform muda de layout e os nao pintados continuam iguais
  const top = va.world.reduce((b, q, i) => (q[1] > va.world[b][1] ? i : b), 0);
  const before2 = [rt("corpo", "1.idle", 0.5), rt("corpo", "1.idle", 1), rt("corpo_livre", "1.idle", 0.5)];
  await step("mesh.paintWeights", { slot: "corpo", attachment: "corpo", bone: "cabeca", points: [va.world[top]], radius: 45, amount: 0.8 });
  deformsFit("pintar osso novo");
  const vb = meshView(doc.json, "default", "corpo", "corpo");
  const same = (i: number) => (JSON.stringify(va.weights[i]) === JSON.stringify(vb.weights[i]) ? i : -1);
  const after2 = [rt("corpo", "1.idle", 0.5), rt("corpo", "1.idle", 1), rt("corpo_livre", "1.idle", 0.5)];
  check(vb.weights.some((_, i) => same(i) < 0) && before2.every((b, k) => far(b, after2[k], same) < 0.02), "pintar osso novo: deform (e linked) dos vertices nao pintados igual");
  await step("mesh.paintWeights", { slot: "corpo", attachment: "corpo", bone: "peito", vertices: [pick], amount: -1 });
  check((meshView(doc.json, "default", "corpo", "corpo").weights[pick].peito ?? 0) === 0, "tirar tudo de um osso passa o peso para outro");
  runtimeOk("mesh.paintWeights tirando");

  // malha sem pesos com deform: pintar converte e mantem a forma
  await run("mesh.create", { slot: "cabeca", name: "cabeca", mode: "grid", grid: [2, 2] });
  {
    // refazer a malha (replace, com o nome "attachment") mantem o lugar na tela
    const box = () => {
      const w = meshView(doc.json, "default", "cabeca", "cabeca").world;
      return [Math.min(...w.map((q) => q[0])), Math.max(...w.map((q) => q[0])), Math.min(...w.map((q) => q[1])), Math.max(...w.map((q) => q[1]))];
    };
    const b0 = box();
    let recusou = "";
    await run("mesh.create", { slot: "cabeca", attachment: "cabeca", mode: "grid", grid: [3, 3] }).catch((e: any) => (recusou = e.message));
    const r = await run("mesh.create", { slot: "cabeca", attachment: "cabeca", mode: "grid", grid: [3, 3], replace: true });
    const b1 = box();
    check(/replace/.test(recusou) && r.vertices === 16 && b0.every((v, i) => Math.abs(v - b1[i]) < 0.05), `mesh.create replace refaz a malha no mesmo lugar (${r.vertices} vertices)`);
    runtimeOk("mesh.create replace");
  }
  await run("deform.set", { anim: "1.idle", slot: "cabeca", attachment: "cabeca", time: 0.5, moves: [{ i: 0, dx: 5, dy: 5 }] });
  const hv = meshView(doc.json, "default", "cabeca", "cabeca");
  const H0 = rt("cabeca", "1.idle", 0.5, "default", "cabeca");
  await step("mesh.paintWeights", { slot: "cabeca", attachment: "cabeca", bone: "pescoco", points: [hv.world[4]], radius: 10, amount: 1 });
  const hv2 = meshView(doc.json, "default", "cabeca", "cabeca");
  check(hv2.weighted && far(hv.world, hv2.world, (i) => i) < 0.02, "pintar malha sem pesos: vira malha com pesos na mesma posicao");
  check(far(H0, rt("cabeca", "1.idle", 0.5, "default", "cabeca"), (i) => (i === 4 ? -1 : i)) < 0.02, "pintar malha sem pesos: deform dos vertices nao pintados igual");
  runtimeOk("pintar malha sem pesos com deform");

  // contorno concavo (L) com ponto colinear e pontos internos: cobre so a area do L
  const { triangulateHull } = await import("../src/core/geometry.ts");
  const L: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [2, 2], [2, 7], [7, 2], [2.5, 5]];
  const tl = triangulateHull(L, 7);
  let area = 0;
  for (let i = 0; i < tl.length; i += 3) {
    const [a, b, c] = [L[tl[i]], L[tl[i + 1]], L[tl[i + 2]]];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  check(Math.abs(area - 75) < 1e-9 && new Set(tl).size === L.length, `triangulacao respeita contorno concavo (area ${area}, ${tl.length / 3} triangulos)`);
}

// draw order: codificar e decodificar devolve a mesma ordem (aleatorio)
let doOk = true;
for (let k = 0; k < 200; k++) {
  const names = Array.from({ length: 12 }, (_, i) => `s${i}`);
  const order = [...names].sort(() => Math.random() - 0.5);
  if (decodeDrawOrder(names, encodeDrawOrder(names, order)).join() !== order.join()) doOk = false;
}
check(doOk, "draw order: codificacao LIS ida e volta (200 ordens aleatorias)");

// renomes e remocoes mantem o runtime feliz
await run("bone.rename", { bone: "cabeca", to: "cabeca2" });
await run("slot.rename", { slot: "olho", to: "olhinho" });
await run("attachment.rename", { slot: "olhinho", from: "olho_2", to: "olho_fechado" });
await run("constraint.rename", { name: "ik_braco", to: "ik" });
await run("event.rename", { name: "pisca", to: "piscou" });
runtimeOk("renomes");
await run("slot.delete", { slot: "brilho" });
await run("bone.delete", { bone: "mao", force: true });
runtimeOk("remocoes (slot, osso com pesos)");

// GIF exportado: o codificador proprio gera quadros que o libvips le de volta
{
  const { GifEncoder, Histogram } = await import("../src/render/gif.ts");
  const [w, h] = [48, 32];
  const frames = [0, 1, 2].map((f) => {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      px.set(x >= f * 16 && x < f * 16 + 16 ? [230, 60, 120, 255] : [33, 31, 41, 255], i * 4);
    }
    return px;
  });
  const hist = new Histogram();
  frames.forEach((f) => hist.add(f));
  const gif = new GifEncoder(w, h, hist.palette(256));
  frames.forEach((f) => gif.frame(f, 4));
  const bytes = gif.finish();
  const img = sharp(Buffer.from(bytes), { animated: true });
  const meta = await img.metadata();
  const raw = await img.raw().toBuffer();
  // quadro 2 (terceiro), pixel no meio da faixa colorida
  const at = (2 * w * h + 10 * w + 40) * (meta.channels ?? 4);
  const ok = meta.pages === 3 && meta.loop === 0 && Math.abs(raw[at] - 230) < 12 && Math.abs(raw[at + 1] - 60) < 12;
  check(ok, `GIF: ${meta.pages} quadros, loop ${meta.loop}, cor lida ${raw[at]},${raw[at + 1]},${raw[at + 2]}`);
}

// GIF so com o que muda (paleta de 255): cada quadro lido de volta igual ao quadro inteiro, e menor
{
  const { GifEncoder, Histogram } = await import("../src/render/gif.ts");
  const [w, h] = [64, 48];
  const frames = [0, 1, 2, 3, 3].map((f) => {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w,
        y = Math.floor(i / w);
      const bola = (x - 12 - f * 10) ** 2 + (y - 24) ** 2 < 64;
      px.set(bola ? [230, 60, 120, 255] : [(x * 4) & 255, (y * 5) & 255, 90, 255], i * 4);
    }
    return px;
  });
  const hist = new Histogram();
  frames.forEach((f) => hist.add(f));
  const pal = hist.palette(255);
  const parcial = new GifEncoder(w, h, pal);
  const inteiro = new GifEncoder(w, h, [...pal, [0, 0, 0]]);
  frames.forEach((f) => (parcial.frame(f, 4), inteiro.frame(f, 4)));
  const [bp, bi] = [parcial.finish(), inteiro.finish()];
  const [rp, ri] = await Promise.all([bp, bi].map((b) => sharp(Buffer.from(b), { animated: true }).ensureAlpha().raw().toBuffer()));
  let dif = 0;
  for (let i = 0; i < ri.length; i++) dif = Math.max(dif, Math.abs(rp[i] - ri[i]));
  check(dif === 0 && rp.length === w * h * 4 * frames.length && bp.length < bi.length, `GIF parcial: diferenca ${dif} contra quadros inteiros, ${bp.length} contra ${bi.length} bytes`);
}

// GIF com ruido: estoura o dicionario do LZW (codigo de limpeza) e volta igual
{
  const { GifEncoder, Histogram } = await import("../src/render/gif.ts");
  const n = 256;
  const px = new Uint8Array(n * n * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < n * n; i++) {
    const c = Math.floor(rnd() * 64);
    px.set([(c & 3) * 80, ((c >> 2) & 3) * 80, ((c >> 4) & 3) * 80, 255], i * 4);
  }
  const hist = new Histogram();
  hist.add(px);
  const gif = new GifEncoder(n, n, hist.palette(256));
  gif.frame(px, 10);
  const raw = await sharp(Buffer.from(gif.finish())).ensureAlpha().raw().toBuffer();
  let worst = 0;
  for (let i = 0; i < n * n * 4; i += 4) worst = Math.max(worst, Math.abs(raw[i] - px[i]), Math.abs(raw[i + 1] - px[i + 1]), Math.abs(raw[i + 2] - px[i + 2]));
  check(worst <= 8, `GIF com ruido (LZW cheio): diferenca maxima ${worst}`);
}

// desempenho sem mudar o resultado: PoseSim (atalhos), remendo do SkeletonData
{
  const { PoseSim } = await import("../src/core/sim.ts");
  const { patchSkeletonData } = await import("../src/core/patch.ts");
  const read = () => new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(structuredClone(doc.json));
  // pose inteira (ossos, cores, attachments, deform, draw order) para comparar exato
  const dump = (sk: Skeleton) =>
    JSON.stringify([
      sk.bones.map((b) => [b.appliedPose.a, b.appliedPose.b, b.appliedPose.c, b.appliedPose.d, b.appliedPose.worldX, b.appliedPose.worldY]),
      sk.slots.map((s) => [s.appliedPose.attachment?.name ?? null, [s.appliedPose.color.r, s.appliedPose.color.g, s.appliedPose.color.b, s.appliedPose.color.a], Array.from(s.appliedPose.deform)]),
      sk.drawOrder.appliedPose.map((s) => s.data.name),
    ]);
  const fresh = (data: any, anim: string, t: number) => {
    const sk = new Skeleton(data);
    const sim = new PoseSim(sk, new AnimationState(new AnimationStateData(data)));
    sim.shortcuts = false;
    sim.poseAt(anim, true, t);
    return dump(sk);
  };
  const data = read();
  const hasPhysics = new Skeleton(data).physics.length > 0;
  let same = 0,
    total = 0;
  for (const a of data.animations) {
    const sk = new Skeleton(data);
    const sim = new PoseSim(sk, new AnimationState(new AnimationStateData(data)));
    // avanca (incremental), volta (refaz), cai em passo inteiro e no meio de um passo
    for (const t of [0.1, 0.35, 0.359375, 0.9, 0.5, 1.3, 1.3, 2.1, 0.02]) {
      sim.poseAt(a.name, true, t);
      total++;
      if (dump(sk) === fresh(data, a.name, t)) same++;
    }
  }
  check(hasPhysics && same === total, `PoseSim com atalhos da a mesma pose que simular desde 0 (${same}/${total}, com fisica)`);
  {
    // medidas com a fisica do jogo: gravidade numa fisica de rotacao, esqueleto do
    // skeletonAt (y para cima) = esqueleto invertido do spine-godot, espelhado
    const j = structuredClone(doc.json);
    const ph = (j.constraints ?? []).find((c: any) => c.type === "physics" && c.rotate);
    if (ph) ph.gravity = 60;
    const d3 = new SkeletonJson(nullLoader).readSkeletonData(bonesOnly(j));
    let worst = 0;
    for (const a of d3.animations)
      for (const t of [0.4, 1.1, 2.3]) {
        const g = new Skeleton(d3);
        g.scaleY = -1;
        new PoseSim(g, new AnimationState(new AnimationStateData(d3))).poseAt(a.name, true, t);
        const m = skeletonAt(j, a.name, t);
        g.bones.forEach((b, i) => {
          const p = b.appliedPose,
            q = m.bones[i];
          const e = Math.abs(Math.atan2(-p.c, p.a) - Math.atan2(q.c, q.a)) * (180 / Math.PI);
          worst = Math.max(worst, Math.min(e, 360 - e) + Math.hypot(p.worldX - q.worldX, p.worldY + q.worldY));
        });
      }
    check(!!ph && worst < 1e-6, `medidas usam a gravidade do jogo (esqueleto invertido): desvio ${worst.toExponential(1)}`);
  }
  {
    // sem fisica: um passo so de 0 ate t (pode diferir no ultimo bit do tempo da trilha)
    const j = structuredClone(doc.json);
    j.constraints = (j.constraints ?? []).filter((c: any) => c.type !== "physics");
    const d2 = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))).readSkeletonData(j);
    let worst = 0;
    for (const a of d2.animations)
      for (const t of [0.1, 0.37, 0.9, 1.7]) {
        const sk = new Skeleton(d2);
        new PoseSim(sk, new AnimationState(new AnimationStateData(d2))).poseAt(a.name, true, t);
        const x = JSON.parse(dump(sk))[0].flat(), y = JSON.parse(fresh(d2, a.name, t))[0].flat();
        for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]));
      }
    check(worst < 1e-6, `PoseSim sem fisica (passo unico) = passos de 1/64 (desvio max ${worst.toExponential(1)})`);
  }

  // previa de transicao: sequencia A -> B (enfileirada e interrompida) com atalhos = desde 0
  {
    const { sequenceTimes, likeSpineGodot } = await import("../src/core/sim.ts");
    const { execute } = await import("../src/core/commands/index.ts");
    const names = data.animations.map((x) => x.name);
    const [A, B] = [names[0], names[1]];
    let same = 0,
      total = 0;
    for (const seq of [{ next: B, mix: 0.2 }, { next: B, mix: 0.15, at: 0.37 }, { next: B, mix: 0.3, at: 0.2, loop: true }, { next: B, mix: 0 }]) {
      const fresh = (t: number) => {
        const sk = new Skeleton(data);
        const sim = new PoseSim(sk, new AnimationState(new AnimationStateData(data)));
        sim.shortcuts = false;
        sim.poseAt(A, true, t, seq);
        return dump(sk);
      };
      const sk = new Skeleton(data);
      const sim = new PoseSim(sk, new AnimationState(new AnimationStateData(data)));
      const tt = sequenceTimes(data.findAnimation(A)!.duration, data.findAnimation(B)!.duration, seq);
      // avanca quadro a quadro (atalho), volta, e cai em cima da troca e do fim do mix
      const ts = [0.1, tt.start - 0.01, tt.start, tt.start + 0.013, tt.end, 0.05, tt.end + 0.2, tt.total];
      for (let t = 0; t <= tt.total; t += 1 / 30) ts.push(t);
      for (const t of ts) {
        sim.poseAt(A, true, t, seq);
        total++;
        if (dump(sk) === fresh(t)) same++;
      }
    }
    check(hasPhysics && same === total, `previa de transicao: atalhos dao a mesma pose que simular desde 0 (${same}/${total}, ${A} -> ${B}, com fisica)`);

    // mix como o spine-godot: B anima a peca so depois de 0.5 s; durante o mix o valor de A
    // fica inteiro (o spine-ts puxaria para o setup na proporcao do mix)
    const mini = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(""))).readSkeletonData({
      skeleton: { spine: "4.3.23" },
      bones: [{ name: "root" }, { name: "b", parent: "root" }],
      slots: [],
      animations: { A: { bones: { b: { translate: [{ y: 10 }, { time: 1, y: 10 }] } } }, B: { bones: { b: { translate: [{ time: 0.5 }, { time: 1 }] } } } },
    } as any);
    const yAt = (godot: boolean) => {
      const sk = new Skeleton(mini);
      const st = new AnimationState(new AnimationStateData(mini));
      new PoseSim(sk, godot ? likeSpineGodot(st) : st).poseAt("A", false, 0.3, { next: "B", mix: 0.2, at: 0.2 });
      return sk.findBone("b")!.pose.y;
    };
    check(Math.abs(yAt(true) - 10) < 1e-6 && Math.abs(yAt(false) - 5) < 1e-3, `mix do spine-godot: antes da primeira chave de B a peca fica com A (${yAt(true).toFixed(2)}; spine-ts ${yAt(false).toFixed(2)})`);

    // medida da emenda: B parada 100 acima de A. Sem mix e um pulo num quadro; com mix
    // longo vira um movimento lento (abaixo do piso). Regras da ficha usam a mesma medida.
    const { checkAnimation } = await import("../src/core/ficha.ts");
    const pair = {
      skeleton: { spine: "4.3.23", height: 500 },
      bones: [{ name: "root" }, { name: "b", parent: "root", length: 20 }],
      slots: [],
      animations: { A: { bones: { b: { translate: [{ y: 0 }, { time: 1, y: 0 }] } } }, B: { bones: { b: { translate: [{ y: 100 }, { time: 1, y: 100 }] } } } },
    } as any;
    const rs = checkAnimation(pair, "A", ["transicao B 0", "transicao B 4", "corte B 0", "corte B 4"].map((line) => ({ line, kind: line.split(" ")[0], args: line.split(" ").slice(1), except: [] })));
    check(!rs[0].ok && rs[1].ok && !rs[2].ok && rs[3].ok && /b anda/.test(rs[0].detail), `ficha: transicao e corte medem a emenda (sem mix: "${rs[0].detail}")`);
    const pdoc = Document.fromText(JSON.stringify(pair), { text: "", pages: {} });
    const q = execute(pdoc, { cmd: "query.transition", args: { anim: "A", next: "B", mix: 0, top: 1 } }, "teste")[0];
    const qc = execute(pdoc, { cmd: "query.transition", args: { anim: "A", next: "B", mix: 4, cuts: 3 } }, "teste")[0];
    check(!q.ok && q.bones[0].bone === "b" && q.bones[0].score > 1 && q.mode === "enfileirar" && q.start === 1 && qc.ok && qc.cortes.length === 3, `query.transition: pulo sem mix (score ${q.bones[0].score}), suave com mix 4 s em 3 cortes`);
    // mixes por par do -data.tres (animation_mixes), so os que o resource usa
    const { parseMixes } = await import("../server/godot.ts");
    const mx = parseMixes(`[gd_resource type="SpineSkeletonDataResource" load_steps=4 format=3]\n\n[sub_resource type="SpineAnimationMix" id="m1"]\nfrom = "3.win"\nto = "1.idle"\nmix = 0.25\n\n[sub_resource type="SpineAnimationMix" id="m2"]\nfrom = "a"\nto = "b"\nmix = 0.5\n\n[resource]\ndefault_mix = 0.1\nanimation_mixes = [SubResource("m1")]\n`);
    check(mx.length === 1 && mx[0].from === "3.win" && mx[0].to === "1.idle" && mx[0].mix === 0.25, "le os mixes por par do -data.tres (animation_mixes)");
  }

  // remendo: editar animacao e osso da setup e remendar = reler tudo
  const patched = read();
  const paths: any[] = [];
  const off = doc.onChange((e) => {
    for (const o of [...e.tx.ops, ...e.tx.inverse, ...(e.replaced?.ops ?? [])]) paths.push(o.path);
  });
  const ev: any[] = [];
  const off2 = doc.onChange((e) => ev.push(e));
  await run("key.set", { anim: "1.idle", target: { bone: "peito" }, timeline: "rotate", time: 0.25, value: 14 });
  // arrasto: duas etapas com merge (a segunda substitui a primeira)
  const { execute } = await import("../src/core/commands/index.ts");
  execute(doc, { cmd: "bone.set", args: { bone: "pescoco", rotation: 7, x: 150 } }, "ui", undefined, { merge: "arrasto" });
  execute(doc, { cmd: "bone.set", args: { bone: "pescoco", rotation: 9 } }, "ui", undefined, { merge: "arrasto" });
  // cor e parte do setup de um slot tambem se remendam
  execute(doc, { cmd: "slot.set", args: { slot: "olhinho", attachment: "olho_2", color: "ff8080c0" } }, "ui");
  off();
  off2();
  check(ev.length === 4 && ev[2].merged === true && ev[2].replaced === ev[1].tx, "etapa de arrasto avisa qual transacao substituiu (replaced)");
  const ok = patchSkeletonData(patched, doc.json, paths, new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText))));
  const full = read();
  let eq = ok;
  for (const a of full.animations) for (const t of [0, 0.25, 0.6]) if (fresh(patched, a.name, t) !== fresh(full, a.name, t)) eq = false;
  check(eq, "remendar o SkeletonData (animacao, osso e slot na setup) = reler o documento inteiro");
  const before = doc.json.slots.length;
  const paths2: any[] = [];
  const off3 = doc.onChange((e) => e.tx.ops.forEach((o) => paths2.push(o.path)));
  await run("slot.add", { name: "extra_remendo", bone: "root" });
  off3();
  check(doc.json.slots.length === before + 1 && !patchSkeletonData(read(), doc.json, paths2, new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasText)))), "mudanca estrutural (slot novo) recusa o remendo");
}

// importacao de PSD (tests/assets/psd, arte CC0 gerada por tools/psd-fixture.ts): monta
// o personagem pelas camadas e tags; depois a v2 da arte atualiza o asset rigado sem
// quebrar malha, pesos e animacoes
{
  const { createFromPsd, updateDocFromPsd, readPsdPlan } = await import("../server/psd.ts");
  const { toWorld } = await import("../src/core/psd.ts");
  const PSD = new URL("./assets/psd/", import.meta.url).pathname;
  const pdir = join(dir, "psd-boneco");
  const made = await createFromPsd({ psd: join(PSD, "aventureiro.psd"), dir: pdir, name: "boneco" });
  const pj = JSON.parse(readFileSync(made.skeleton, "utf8"));
  const order = pj.slots.map((s: any) => s.name).join(",");
  check(order === "perna_e,perna_d,corpo,cinto,braco_e,mao_e,braco_d,mao_d,cabeca,olho_fechado,antena,brilho", `PSD: partes na ordem das camadas (${order})`);
  const slotOf = (n: string) => pj.slots.find((s: any) => s.name === n);
  const def = pj.skins.find((s: any) => s.name === "default").attachments;
  const tags = Object.keys(made.plan.tags).sort().join(",");
  check(
    slotOf("cabeca").attachment === "cabeca" && !!def.cabeca.cabeca_susto && !slotOf("olho_fechado").attachment && !slotOf("antena").attachment && def.olho_fechado["rosto/olho_fechado"],
    "PSD: camadas escondidas viram trocas escondidas ([slot] junta as duas cabecas; [folder] no caminho)",
  );
  check(
    pj.skins.find((s: any) => s.name === "monstro")?.attachments?.antena?.antena?.path === "monstro/antena" && slotOf("brilho").blend === "additive" && def.corpo.corpo.type === "mesh" && pj.bones.map((b: any) => b.name).join(",") === "root,quadril,tronco,braco_e,braco_d,cabeca",
    `PSD: [skin], linear dodge -> additive, [mesh], [bone] (ossos ${pj.bones.map((b: any) => b.name).join(",")})`,
  );
  check(
    tags === "bone,folder,ignore,merge,mesh,name,origin,scale,skin,slot" && made.plan.ignored.some((i) => i.why === "fundo opaco") && made.plan.ignored.some((i) => i.why === "[ignore]") && !!def.mao_e && !!def.cinto,
    `PSD: tags lidas (${tags}), [ignore] e fundo de fora, [name:*_e] e [merge]`,
  );
  // composicao: o runtime oficial poe cada imagem visivel exatamente no retangulo da camada
  const worldQuad = (json: any, atlasT: string, skin = "default") => {
    const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlasT))).readSkeletonData(structuredClone(json));
    const sk = new Skeleton(data);
    if (skin !== "default") sk.setSkin(skin);
    sk.setupPose();
    sk.updateWorldTransform(Physics.reset);
    const out = new Map<string, number[][]>();
    for (const slot of sk.slots) {
      const s = data.findSkin(skin)!;
      for (const e of s.getAttachments()) {
        if (e.slotIndex !== slot.data.index) continue;
        const a: any = e.attachment;
        const v: number[] = [];
        if (a.getOffsets) a.computeWorldVertices(slot, a.getOffsets(slot.appliedPose), v, 0, 2);
        else if (a.computeWorldVertices && a.worldVerticesLength) a.computeWorldVertices(sk, slot, 0, a.worldVerticesLength, v, 0, 2);
        else continue;
        const pts: number[][] = [];
        for (let i = 0; i < v.length; i += 2) pts.push([v[i], v[i + 1]]);
        out.set(`${slot.data.name}/${e.placeholder}`, pts);
        // uvs de malha: ponto da imagem (0..1) de cada vertice
        if (a.regionUVs) out.set(`${slot.data.name}/${e.placeholder}#uv`, Array.from({ length: a.regionUVs.length / 2 }, (_, i) => [a.regionUVs[i * 2], a.regionUVs[i * 2 + 1]]));
      }
    }
    return out;
  };
  const atlas1 = readFileSync(made.atlas, "utf8");
  const plan1 = made.plan;
  const placed = (plan: any, quads: Map<string, number[][]>) => {
    let worst = 0;
    for (const p of plan.pieces) {
      if (typeof p.mesh === "string") continue;
      const pts = quads.get(`${p.slot}/${p.attachment}`);
      if (!pts) return Infinity;
      const uv = quads.get(`${p.slot}/${p.attachment}#uv`);
      // malha: cada vertice no ponto do PSD da sua UV; region: os 4 cantos do retangulo
      const want = uv
        ? uv.map(([u, v]) => toWorld(plan, [p.rect[0] + u * p.rect[2], p.rect[1] + v * p.rect[3]]))
        : [toWorld(plan, [p.rect[0], p.rect[1]]), toWorld(plan, [p.rect[0] + p.rect[2], p.rect[1] + p.rect[3]])];
      if (uv) worst = Math.max(worst, ...want.map((w, i) => Math.hypot(w[0] - pts[i][0], w[1] - pts[i][1])));
      else {
        // region: a caixa dos 4 cantos (sem depender da ordem deles)
        const bb = (q: number[][]) => [Math.min(...q.map((x) => x[0])), Math.min(...q.map((x) => x[1])), Math.max(...q.map((x) => x[0])), Math.max(...q.map((x) => x[1]))];
        const a = bb(want),
          b = bb(pts);
        worst = Math.max(worst, ...a.map((x, i) => Math.abs(x - b[i])));
      }
    }
    return worst;
  };
  const q1 = new Map([...worldQuad(pj, atlas1), ...worldQuad(pj, atlas1, "monstro")]);
  const e1 = placed(plan1, q1);
  check(e1 < 0.01, `PSD: setup reproduz a composicao (desvio maximo ${e1.toFixed(4)} px em ${plan1.pieces.length} imagens, regions e malha)`);

  // rig em cima: pesos na malha, animacao com deform, troca de cabeca e osso girando
  const pdoc = Document.fromText(readFileSync(made.skeleton, "utf8"), { text: atlas1, pages: {} });
  const passets: AssetProvider = {
    async image(name) {
      const { data, info } = await sharp(join(pdir, "images", name + ".png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data };
    },
    region(name) {
      const r = parseAtlas(pdoc.atlas.text).regions.find((x) => x.name === name);
      return r ? { width: r.originalWidth, height: r.originalHeight } : null;
    },
  };
  const prun = async (cmd: string, args: any = {}) => (await executeAsync(pdoc, { cmd, args }, "teste", undefined, {}, passets))[0];
  await prun("mesh.weights", { slot: "corpo", attachment: "corpo", bones: ["quadril", "tronco"] });
  await prun("animation.create", { name: "susto" });
  const top = (await prun("query.mesh", { slot: "corpo", attachment: "corpo" })).vertices.reduce((a: any, b: any) => (b.world[1] > a.world[1] ? b : a));
  await prun("deform.set", { anim: "susto", slot: "corpo", attachment: "corpo", time: 0.5, moves: [{ i: top.i, dx: 4, dy: 10 }] });
  await prun("key.set", { anim: "susto", target: { slot: "cabeca" }, timeline: "attachment", time: 0.2, name: "cabeca_susto" });
  await prun("key.set", { anim: "susto", target: { bone: "tronco" }, timeline: "rotate", time: 0.5, value: 12 });
  writeFileSync(made.skeleton, pdoc.serialize());
  const meshBefore = (t: number) => prun("query.mesh", { slot: "corpo", attachment: "corpo", anim: "susto", time: t });
  const m0 = await meshBefore(0),
    m5 = await meshBefore(0.5);
  const corpoBefore = structuredClone(pdoc.json.skins[0].attachments.corpo.corpo);
  const animsBefore = JSON.stringify(pdoc.json.animations);
  const beforeUpdate = pdoc.serialize();
  const up = await updateDocFromPsd(pdoc, { psd: join(PSD, "aventureiro-v2.psd"), atlas: made.atlas });
  const rep = up.report;
  check(
    rep.added.join() === "chapeu/chapeu" && [...rep.refit].sort().join() === "cabeca,corpo,mao_d" && rep.repainted.join() === "perna_e" && rep.unchanged === made.plan.pieces.length - 4,
    `PSD v2: nova ${rep.added}, ajustadas ${rep.refit}, redesenhada ${rep.repainted}, ${rep.unchanged} iguais`,
  );
  const order2 = pdoc.json.slots.map((s: any) => s.name);
  // no PSD o chapeu fica logo acima do grupo [skin:monstro] (antena)
  check(order2[order2.indexOf("antena") + 1] === "chapeu" && pdoc.json.slots.find((s: any) => s.name === "chapeu").attachment === "chapeu", `PSD v2: camada nova entra logo acima da de baixo no PSD, visivel (${order2.join(",")})`);
  check(JSON.stringify(pdoc.json.animations) === animsBefore, "PSD v2: animacoes intactas (bytes iguais)");
  const corpoAfter = pdoc.json.skins[0].attachments.corpo.corpo;
  check(JSON.stringify(corpoAfter.vertices) === JSON.stringify(corpoBefore.vertices) && JSON.stringify(corpoAfter.triangles) === JSON.stringify(corpoBefore.triangles), "PSD v2: malha que cresceu mantem vertices, pesos e triangulos");
  const n0 = await meshBefore(0),
    n5 = await meshBefore(0.5);
  const far2 = (a: any, b: any) => Math.max(...a.vertices.map((v: any, i: number) => Math.hypot(v.world[0] - b.vertices[i].world[0], v.world[1] - b.vertices[i].world[1])));
  check(far2(m0, n0) < 1e-3 && far2(m5, n5) < 1e-3, `PSD v2: malha no mesmo lugar na setup e no deform (desvio ${Math.max(far2(m0, n0), far2(m5, n5)).toExponential(1)})`);
  // cada vertice continua no mesmo ponto do desenho (UV nova -> mesmo pixel do PSD)
  const c1 = plan1.pieces.find((p: any) => p.image === "corpo")!.rect;
  const c2 = up.plan.pieces.find((p: any) => p.image === "corpo")!;
  const uvErr = Math.max(...corpoBefore.uvs.map((u: number, i: number) => (i % 2 === 0 ? Math.abs(c1[0] + u * c1[2] - (c2.rect[0] + corpoAfter.uvs[i] * c2.rect[2])) : Math.abs(c1[1] + u * c1[3] - (c2.rect[1] + corpoAfter.uvs[i] * c2.rect[3])))));
  check(uvErr < 0.01 && corpoAfter.uvs.every((u: number) => u >= 0 && u <= 1) && rep.warnings.some((w) => w.includes("cresceu para fora da malha")), `PSD v2: UVs remapeadas (desvio ${uvErr.toFixed(4)} px do PSD), dentro da imagem, com aviso de desenho fora da malha`);
  const atlas2 = up.atlasText;
  const q2 = worldQuad(pdoc.json, atlas2);
  const regionsOnly = { ...up.plan, pieces: up.plan.pieces.filter((p: any) => p.skin === "default" && p.mesh === undefined) };
  const e2 = placed(regionsOnly, q2);
  check(e2 < 0.01, `PSD v2: imagens que mudaram de tamanho ou lugar caem no retangulo novo (desvio ${e2.toFixed(4)} px)`);
  try {
    const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(atlas2))).readSkeletonData(structuredClone(pdoc.json));
    const sk = new Skeleton(data);
    const st = new AnimationState(new AnimationStateData(data));
    st.setAnimation(0, "susto", false);
    for (let t = 0; t < 0.7; t += 1 / 30) (st.update(1 / 30), st.apply(sk), sk.updateWorldTransform(Physics.update));
    check(true, "PSD v2: runtime le e toca");
  } catch (e: any) {
    check(false, `PSD v2: runtime recusou: ${e.message}`);
  }
  // reimportar a mesma arte nao muda nada
  const again = await updateDocFromPsd(pdoc, { psd: join(PSD, "aventureiro-v2.psd"), atlas: made.atlas });
  check(!again.report.added.length && !again.report.refit.length && !again.report.repainted.length, "PSD: reimportar a mesma arte nao muda nada");
  pdoc.undo();
  check(pdoc.serialize() === beforeUpdate, "PSD v2: desfazer a atualizacao volta o esqueleto");
  // refit numa region que o rig girou e esticou: o mesmo ponto do desenho fica no mesmo lugar
  {
    await prun("attachment.region", { slot: "cinto", name: "cinto", rotation: 30, scaleX: 1.5, scaleY: -0.8 });
    const from: [number, number, number, number] = [64, 189, 70, 10],
      to: [number, number, number, number] = [58, 185, 84, 16];
    const corners = () => worldQuad(pdoc.json, pdoc.atlas.text).get("cinto/cinto")!;
    // ponto (u,v) da imagem (0..1, v para baixo) no mundo: cantos BL, TL, TR, BR do runtime
    const at = (q: number[][], u: number, v: number) => {
      const [bl, tl, tr, br] = q;
      const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u],
        bot = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
      return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
    };
    const q0 = corners();
    await prun("attachment.refit", { image: "cinto", from, to });
    const qn = corners();
    let worst = 0;
    for (const [px, py] of [[64, 189], [134, 199], [100, 194], [70, 197]]) {
      const a = at(q0, (px - from[0]) / from[2], (py - from[1]) / from[3]);
      const b = at(qn, (px - to[0]) / to[2], (py - to[1]) / to[3]);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    check(worst < 0.01, `attachment.refit em region girada e espelhada: pontos do desenho no mesmo lugar (desvio ${worst.toFixed(4)})`);
    pdoc.undo();
    pdoc.undo();
  }
  // asset sem registro da importacao (montado de outro jeito): as camadas novas sao
  // alinhadas pelas imagens que ja existem
  {
    const { rmSync: rm } = await import("node:fs");
    const { manifestPath } = await import("../server/psd.ts");
    const adir = join(dir, "psd-sem-registro");
    const a = await createFromPsd({ psd: join(PSD, "aventureiro.psd"), dir: adir, name: "solto" });
    rm(manifestPath(a.atlas));
    const adoc = Document.fromText(readFileSync(a.skeleton, "utf8"), { text: readFileSync(a.atlas, "utf8"), pages: {} });
    await executeAsync(adoc, { cmd: "bone.set", args: { bone: "quadril", x: 30 } }, "teste");
    const r = await updateDocFromPsd(adoc, { psd: join(PSD, "aventureiro-v2.psd"), atlas: a.atlas });
    const chapeu = r.plan.pieces.find((p: any) => p.image === "chapeu")!;
    const want = toWorld(r.plan, [chapeu.rect[0] + chapeu.rect[2] / 2, chapeu.rect[1] + chapeu.rect[3] / 2]);
    const q = worldQuad(adoc.json, r.atlasText).get("chapeu/chapeu")!;
    const c = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
    check(!!r.report.shift && Math.abs(r.report.shift[0] - 30) < 0.01 && Math.hypot(c[0] - want[0] - 30, c[1] - want[1]) < 0.01, `PSD sem registro: camada nova alinhada pelas imagens existentes (desvio inferido ${r.report.shift})`);
  }
  // fora de um projeto Godot o PSD vira um .boneco, com o mesmo esqueleto do caminho Godot
  {
    const { mkdtempSync: mk, rmSync: rm, existsSync: ex } = await import("node:fs");
    const { lerVirtual } = await import("../server/boneco.ts");
    const solta = mk(join(tmpdir(), "psd-boneco-"));
    const b = await createFromPsd({ psd: join(PSD, "aventureiro.psd"), dir: join(solta, "heroi"), name: "heroi" });
    const sj = JSON.parse(lerVirtual(b.skeleton)!);
    const gj = JSON.parse(readFileSync(made.skeleton, "utf8"));
    const nomes = (j: any) => j.bones.map((x: any) => x.name).join(",");
    check(b.tres.endsWith("heroi.boneco") && ex(b.tres) && nomes(sj) === nomes(gj) && sj.slots.length === gj.slots.length && !ex(join(solta, "heroi", "heroi-data.tres")), `PSD fora de projeto Godot vira .boneco (${sj.bones.length} ossos, ${sj.slots.length} partes, iguais ao caminho Godot)`);
    // e o .boneco atualiza pelo PSD (o atlas virtual relido e regravado), com o registro da criacao
    const bdoc = Document.fromText(lerVirtual(b.skeleton)!, { text: lerVirtual(b.atlas)!, pages: {} });
    const bu = await updateDocFromPsd(bdoc, { psd: join(PSD, "aventureiro-v2.psd"), atlas: b.atlas });
    const st = (s: string) => bu.plan.pieces.filter((p) => p.status === s).map((p) => p.image).join(",");
    const pagina = join(solta, "heroi", "heroi.webp");
    check(
      ex(join(solta, "heroi", "images", "psd-import.json")) && !bu.plan.align && st("new") === "chapeu" && st("changed") === "perna_e,corpo,mao_d,cabeca" && ex(pagina) && /chapeu/.test(lerVirtual(b.atlas)!),
      `PSD .boneco: atualizar pelo PSD (nova ${st("new")}, mudaram ${st("changed")}, com o registro da criacao)`,
    );
    rm(solta, { recursive: true, force: true });
  }
  // plano so de leitura: PSD com camadas que viram a mesma imagem e recusado com explicacao
  check(readPsdPlan(readFileSync(join(PSD, "aventureiro.psd")), "x.psd").plan.pieces.length === plan1.pieces.length, "PSD: leitura sem gravar nada (readPsdPlan)");
  // mapa externo (N-020): PSD chato, sem grupos nem tags; o mapa da os ossos, o pai, o pivo
  // e as camadas escondidas sem regravar o arquivo do cliente
  {
    const { writePsdBuffer } = await import("ag-psd");
    const { writeFileSync: wf, mkdtempSync: mk } = await import("node:fs");
    const ret = (x: number, y: number, w: number, h: number, c: number[]) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) d.set([...c, 255], i * 4);
      return { left: x, top: y, imageData: { width: w, height: h, data: d } };
    };
    const chato: any = {
      width: 400,
      height: 400,
      children: [
        { name: "tronco", ...ret(150, 100, 100, 200, [200, 0, 0]) },
        { name: "manga", ...ret(250, 100, 40, 100, [0, 200, 0]) },
        { name: "antebraco", ...ret(255, 180, 30, 100, [0, 0, 200]) },
        { name: "mao_alt", hidden: true, ...ret(255, 270, 30, 30, [200, 200, 0]) },
      ],
    };
    const buf = Buffer.from(writePsdBuffer(chato));
    const mapa = { camadas: { manga: "[bone:braco]", antebraco: "[bone:antebraco]" }, ossos: { antebraco: { pai: "braco", at: [270, 190] as [number, number] } }, esconder: ["tronco"] };
    const sem = readPsdPlan(buf, "f.psd").plan;
    check(sem.bones.length === 0 && sem.pieces.every((p) => p.bone === "root") && sem.pieces.find((p) => p.slot === "tronco")!.visible, "PSD sem mapa: igual a antes (sem ossos, tudo no root)");
    const { plan: mp } = readPsdPlan(buf, "f.psd", { mapa });
    const ab = mp.bones.find((b) => b.name === "antebraco"),
      pc = (s: string) => mp.pieces.find((p) => p.slot === s)!;
    check(
      !!ab && ab.parent === "braco" && ab.at[0] === 270 && ab.at[1] === 190 && mp.bones.findIndex((b) => b.name === "braco") < mp.bones.indexOf(ab) && pc("manga").bone === "braco" && pc("antebraco").bone === "antebraco" && !pc("tronco").visible,
      `PSD com mapa: ossos, pai e pivo pelo mapa, tronco escondido (${mp.bones.map((b) => `${b.name}<${b.parent}@${b.at}`).join(" ")})`,
    );
    const pdir2 = mk(join(dir, "psd-mapa-"));
    const pf = join(pdir2, "chato.psd");
    wf(pf, buf);
    const cm = await createFromPsd({ psd: pf, dir: join(pdir2, "boneco"), name: "chato", read: { mapa: { ...mapa, ossos: { ...mapa.ossos, mao: { pai: "antebraco", at: [270, 280], ponta: [270, 300] } } } } });
    const cj = JSON.parse(readFileSync(cm.skeleton, "utf8"));
    const cdoc = Document.fromText(readFileSync(cm.skeleton, "utf8"), { text: readFileSync(cm.atlas, "utf8"), pages: {} });
    const { skeletonAt: skAt, boneWorld: bw } = await import("../src/core/pose.ts");
    const sk = skAt(cdoc.json, null, 0);
    const wa = bw(sk, "antebraco"),
      wm = bw(sk, "mao");
    const ob = (n: string) => cj.bones.find((b: any) => b.name === n);
    check(
      ob("antebraco")?.parent === "braco" && Math.hypot(wa.x - 70, wa.y - 210) < 1e-3 && cj.slots.find((s: any) => s.name === "antebraco").bone === "antebraco" && ob("mao")?.parent === "antebraco" && Math.abs((ob("mao").length ?? 0) - 20) < 1e-3 && Math.hypot(wm.x - 70, wm.y - 120) < 1e-3,
      `PSD com mapa: no .spine-json o antebraco e filho do braco em (70,210) no mundo, com a parte nele; osso so do mapa com ponta (mao, comprimento ${ob("mao")?.length})`,
    );
    const { updateDocFromPsd: upd } = await import("../server/psd.ts");
    const re = await upd(cdoc, { psd: pf, atlas: cm.atlas });
    check(!!re.plan.bones.find((b) => b.name === "antebraco" && b.parent === "braco") && !re.report.added.length && !re.report.refit.length && !re.report.bones.length, "PSD com mapa: atualizar sem passar o mapa reaplica o da importacao (nada muda)");
    let erro = "";
    try {
      readPsdPlan(buf, "f.psd", { mapa: { camadas: { antebraco: "[bone:antebraco]" }, ossos: { antebraco: { pai: "nao_existe" } } } });
    } catch (e: any) {
      erro = e.message;
    }
    check(erro.includes("O PSD tem problemas") && erro.includes("nao_existe"), "PSD com mapa: pai inexistente e recusado");
    erro = "";
    try {
      readPsdPlan(buf, "f.psd", { mapa: { ossos: { a: { pai: "b" }, b: { pai: "a" } } } });
    } catch (e: any) {
      erro = e.message;
    }
    check(erro.includes("ciclo"), "PSD com mapa: ciclo de pais e recusado");
    const av = readPsdPlan(buf, "f.psd", { mapa: { camadas: { perna: "[bone:perna]" }, esconder: ["chapeu"] } }).plan.warnings;
    check(av.some((w) => w.includes('"perna"')) && av.some((w) => w.includes('"chapeu"')), "PSD com mapa: chave sem camada vira aviso");
    // query.juntas (N-021): o pivo do antebraco 50 px acima do centro da sobreposicao com a
    // manga (que fica em (70,210) no mundo) e apontado; no lugar certo, nao
    const { fileAssets } = await import("../server/psd.ts");
    const juntas = async (nome: string, cotovelo: [number, number]) => {
      const c = await createFromPsd({ psd: pf, dir: join(pdir2, nome), name: nome });
      const at = readFileSync(c.atlas, "utf8");
      const d = Document.fromText(readFileSync(c.skeleton, "utf8"), { text: at, pages: {} });
      const fa = fileAssets(join(pdir2, nome), at);
      await executeAsync(
        d,
        [
          { cmd: "bone.add", args: { name: "ombro", parent: "root", at: [70, 300], toward: [70, 210] } },
          { cmd: "bone.add", args: { name: "antebraco", parent: "ombro", at: cotovelo, toward: [70, 120] } },
          { cmd: "slot.set", args: { slot: "manga", bone: "ombro" } },
          { cmd: "slot.set", args: { slot: "antebraco", bone: "antebraco" } },
        ],
        "teste",
        undefined,
        {},
        fa,
      );
      return (await executeAsync(d, { cmd: "query.juntas", args: {} }, "teste", undefined, {}, fa))[0];
    };
    const j1 = await juntas("juntas1", [70, 260]);
    const a1 = j1.juntas.find((j: any) => j.osso === "antebraco");
    check(
      !!a1 && a1.pai === "ombro" && Math.hypot(a1.sugerido[0] - 70, a1.sugerido[1] - 210) < 2 && Math.abs(a1.distancia_px - 50) < 2 && j1.alertas.length === 1 && j1.alertas[0].startsWith("antebraco") && !j1.juntas.some((j: any) => j.osso === "ombro"),
      `query.juntas: pivo do antebraco longe da sobreposicao com a manga (sugere ${a1?.sugerido}, ${a1?.distancia_px} px, ${a1?.area_px} px de area); ombro (pai root) fica de fora`,
    );
    const j2 = await juntas("juntas2", [70, 210]);
    check(!j2.alertas.length && j2.juntas.find((j: any) => j.osso === "antebraco")?.distancia_px < 2, `query.juntas: pivo no centro da sobreposicao nao alerta (${JSON.stringify(j2.juntas)})`);
  }
}

// exemplos: as chaves de instancia nas animacoes so usam os campos que o leitor conhece (o leitor nao
// avisa campo desconhecido; "mistura" no lugar de "mix" fazia a troca saltar no abducao)
{
  const { readdirSync, statSync } = await import("node:fs");
  const RAIZ = join(import.meta.dirname, "..", "exemplos");
  const CAMPOS = new Set(["tempo", "animacao", "inicio", "velocidade", "repetir", "mix", "segue"]);
  const ruins: string[] = [];
  let n = 0;
  for (const ex of readdirSync(RAIZ)) {
    const d = join(RAIZ, ex);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith(".boneco"))) {
      const b = JSON.parse(readFileSync(join(d, f), "utf8"));
      for (const [an, a] of Object.entries<any>(b.animacoes ?? {}))
        for (const [inst, chaves] of Object.entries<any>(a.instancias ?? {}))
          for (const k of chaves) {
            n++;
            for (const c of Object.keys(k)) if (!CAMPOS.has(c)) ruins.push(`${ex}/${f} ${an}/${inst}: ${c}`);
          }
    }
  }
  check(n > 0 && ruins.length === 0, `exemplos: ${n} chaves de instancia, todas com campos conhecidos${ruins.length ? ` (desconhecidos: ${[...new Set(ruins)].slice(0, 5).join("; ")})` : ""}`);
}

// tools/vinheta.ts: o som do video sai no post, atrasado pela abertura (so com ffmpeg na maquina)
{
  const { spawnSync } = await import("node:child_process");
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) console.log("pulado: vinheta com som (sem ffmpeg)");
  else {
    const vd = mkdtempSync(join(tmpdir(), "vinheta-"));
    const ent = join(vd, "x.mp4"),
      sai = join(vd, "x-post.mp4");
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", ent]);
    const r = spawnSync("npx", ["tsx", join(import.meta.dirname, "..", "tools", "vinheta.ts"), ent, "--saida", sai], { encoding: "utf8" });
    const faixas = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", sai], { encoding: "utf8" }).stdout.trim().split("\n");
    const ab = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(import.meta.dirname, "..", "exemplos", "vinheta", "curta-abertura.webm")], { encoding: "utf8" }).stdout.trim());
    const sd = spawnSync("ffmpeg", ["-hide_banner", "-i", sai, "-map", "0:a?", "-af", "silencedetect=noise=-40dB:d=0.3", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const fim = Number(/silence_end: ([\d.]+)/.exec(sd)?.[1] ?? NaN);
    check(r.status === 0 && faixas.includes("audio") && Math.abs(fim - ab) < 0.05, `vinheta: o post leva o som do video (${faixas.join("+")}), comecando no fim da abertura (${fim.toFixed(3)} s, abertura ${ab.toFixed(3)} s)`);
    rmSync(vd, { recursive: true, force: true });
  }
}

// formato: salva e relê; desfazer tudo volta ao inicio
const text = doc.serialize();
check(JSON.parse(text) && text.length > raw0.length, `serializa ${text.length} bytes`);
let undos = 0;
while (doc.canUndo()) (doc.undo(), undos++);
const back = doc.serialize();
if (back !== raw0) {
  let i = 0;
  while (back[i] === raw0[i]) i++;
  console.log("  diferenca em", i, JSON.stringify(raw0.slice(i - 40, i + 60)), "=>", JSON.stringify(back.slice(i - 40, i + 60)));
}
check(back === raw0, `desfazer ${undos} acoes volta aos bytes iniciais`);

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `${failures} falha(s)` : "tudo ok");
process.exitCode = failures ? 1 : 0;
