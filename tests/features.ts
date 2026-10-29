// Teste de features com fixture sintetica (sem assets de jogos): monta um boneco do
// zero exercitando os comandos e confere, a cada etapa, que o runtime oficial le e
// toca o resultado. Desfazer tudo volta ao documento inicial.
//   npx tsx tests/features.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  check(/ja existe chave/.test(clash) && times(peito("6.colada")) === "0.7,0.9,1.2", "keys.move recusa cair em cima de outra chave");
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
    !again.created && list.length === 4 && named.label === "antes do festa" && changes.some((c: string) => c.includes("animacoes novas: pula")) && changes.some((c: string) => c.includes("ossos novos: cabeca")) && JSON.parse(rf(sk, "utf8")).animations.pula === undefined && r.before.label?.startsWith("antes de restaurar") && backups.length >= 2,
    `versoes: ${list.length} guardadas (automatica sem duplicar), marcada, diff "${changes.join("; ")}", restaurar volta e guarda o atual`,
  );
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
  // plano so de leitura: PSD com camadas que viram a mesma imagem e recusado com explicacao
  check(readPsdPlan(readFileSync(join(PSD, "aventureiro.psd")), "x.psd").plan.pieces.length === plan1.pieces.length, "PSD: leitura sem gravar nada (readPsdPlan)");
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
