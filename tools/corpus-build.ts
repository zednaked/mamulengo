// Monta os rigs do corpus livre (tests/assets) so com os comandos do Mamulengo, a
// partir das partes soltas de cada personagem (arte CC0, ver tests/assets/LICENSES.md).
// Cada rig sai em tests/assets/<nome>/rig/ como um asset do jogo: .spine-json, .atlas,
// paginas e -data.tres (tests/assets e um projeto Godot minimo).
//
//   npx tsx tools/corpus-build.ts [raiz] [--only nome]
//
// raiz padrao: tests/assets. Com outra raiz, as partes sao lidas de tests/assets e o
// rig e escrito na raiz (util para comparar com o que esta no repo).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createAsset } from "../server/assets.ts";
import { parseAtlas } from "../src/core/atlas-text.ts";
import { Document } from "../src/core/document.ts";
import { executeAsync, type AssetProvider } from "../src/core/commands/index.ts";

export const CORPUS = resolve(dirname(fileURLToPath(import.meta.url)), "../tests/assets");

type Pt = [number, number];
type Run = (cmd: string, args?: any) => Promise<any>;

// imagem posicionada pelo mundo (como num PSD): centro, rotacao, espelho e escala.
// hidden: imagem extra num slot que ja existe (aparece so em animacoes)
export interface Peca {
  slot: string;
  bone: string;
  image: string;
  center: Pt;
  rotation?: number;
  flip?: boolean;
  scale?: number;
  hidden?: boolean;
}

async function pecas(run: Run, list: Peca[]) {
  for (const p of list) if (!p.hidden) await run("slot.add", { name: p.slot, bone: p.bone, attachment: p.image });
  for (const p of list) {
    const s = p.scale ?? 1;
    await run("attachment.region", { slot: p.slot, name: p.image, world: { center: p.center, rotation: p.rotation ?? 0, scale: [p.flip ? -s : s, s] } });
  }
}

// montagem em tres etapas: ossos, pecas (na ordem de desenho) e o resto (malhas,
// pesos, fisica, animacoes)
export interface Personagem {
  nome: string;
  anims: string[];
  ossos(run: Run): Promise<void>;
  pecas: Peca[];
  montar(run: Run): Promise<void>;
}

// Aventureiro (Kenney Toon Characters, "Male adventurer", partes HD).
// Layout medido na pose idle do pacote (pes em y=0, centro em x=0).
const aventureiro: Personagem = {
  nome: "aventureiro",
  anims: ["idle", "susto"],
  async ossos(run) {
    await run("bone.add", { name: "quadril", at: [0, 52] });
    await run("bone.add", { name: "tronco", parent: "quadril", at: [0, 52], toward: [0, 100] });
    await run("bone.add", { name: "cabeca", parent: "tronco", at: [0, 104], toward: [0, 190] });
    await run("bone.add", { name: "braco_e", parent: "tronco", at: [-36, 88], toward: [-50, 48] });
    await run("bone.add", { name: "mao_e", parent: "braco_e", at: [-50, 48], toward: [-50, 18] });
    await run("bone.add", { name: "braco_d", parent: "tronco", at: [36, 88], toward: [50, 48] });
    await run("bone.add", { name: "mao_d", parent: "braco_d", at: [50, 48], toward: [50, 18] });
    await run("bone.add", { name: "perna_e", parent: "quadril", at: [-20, 52], toward: [-20, 4] });
    await run("bone.add", { name: "perna_d", parent: "quadril", at: [20, 52], toward: [20, 4] });
  },
  pecas: [
    { slot: "perna_e", bone: "perna_e", image: "perna", center: [-20, 29], flip: true },
    { slot: "perna_d", bone: "perna_d", image: "perna", center: [20, 29] },
    { slot: "corpo", bone: "tronco", image: "corpo", center: [-1, 75] },
    { slot: "braco_e", bone: "braco_e", image: "braco", center: [-45, 65], flip: true },
    { slot: "braco_d", bone: "braco_d", image: "braco", center: [45, 65] },
    { slot: "mao_e", bone: "mao_e", image: "mao", center: [-49.5, 30], flip: true },
    { slot: "mao_d", bone: "mao_d", image: "mao", center: [49.5, 30] },
    { slot: "cabeca", bone: "cabeca", image: "cabeca", center: [4.5, 151.5] },
    { slot: "cabeca", bone: "cabeca", image: "cabeca_susto", center: [4.5, 151.5], hidden: true },
  ],
  async montar(run) {
    // tronco deformavel: malha presa ao quadril e ao tronco
    await run("mesh.create", { slot: "corpo", name: "corpo", mode: "grid", grid: [2, 3] });
    await run("mesh.weights", { slot: "corpo", attachment: "corpo", bones: ["quadril", "tronco"] });
    // cabeca com mola (balanca atrasada quando o corpo mexe)
    await run("physics.preset", { bone: "cabeca", preset: "mola" });
    // idle: respira, balanca a cabeca e os bracos
    await run("recipe.breathe", { anim: "idle", bone: "tronco", amount: 0.05, period: 1.6 });
    await run("recipe.sway", { anim: "idle", bone: "cabeca", angle: 4, period: 1.6, phase: 0.25 });
    await run("recipe.sway", { anim: "idle", bone: "braco_e", angle: 6, period: 1.6 });
    await run("recipe.sway", { anim: "idle", bone: "braco_d", angle: -6, period: 1.6 });
    // susto: troca o rosto, pula e treme
    await run("recipe.bounce", { anim: "susto", bone: "quadril", height: 30, period: 0.6 });
    await run("recipe.blink", { anim: "susto", slot: "cabeca", open: "cabeca", closed: "cabeca_susto", at: 0, duration: 0.6 });
    await run("recipe.shake", { anim: "susto", bone: "cabeca", start: 0 });
  },
};

// Monstro (Kenney Monster Builder Pack): mascote de um olho, estilo simbolo de jogo.
const monstro: Personagem = {
  nome: "monstro",
  anims: ["idle", "ganhou"],
  async ossos(run) {
    await run("bone.add", { name: "base", at: [0, 0] });
    await run("bone.add", { name: "corpo", parent: "base", at: [0, 70], toward: [0, 150] });
    await run("bone.add", { name: "topo", parent: "corpo", at: [0, 150], toward: [0, 230] });
    await run("bone.add", { name: "antena", parent: "topo", at: [0, 232], toward: [0, 282] });
    await run("bone.add", { name: "braco_e", parent: "corpo", at: [-66, 182], toward: [-110, 100] });
    await run("bone.add", { name: "braco_d", parent: "corpo", at: [66, 182], toward: [110, 100] });
    await run("bone.add", { name: "perna_e", parent: "base", at: [-38, 100], toward: [-38, 0] });
    await run("bone.add", { name: "perna_d", parent: "base", at: [38, 100], toward: [38, 0] });
  },
  pecas: [
    { slot: "antena", bone: "antena", image: "antena", center: [0, 258] },
    { slot: "perna_e", bone: "perna_e", image: "perna", center: [-44, 62], flip: true },
    { slot: "perna_d", bone: "perna_d", image: "perna", center: [44, 62] },
    { slot: "braco_e", bone: "braco_e", image: "braco", center: [-80, 137], scale: 0.75, flip: true },
    { slot: "braco_d", bone: "braco_d", image: "braco", center: [80, 137], scale: 0.75 },
    { slot: "corpo", bone: "corpo", image: "corpo", center: [0, 150] },
    { slot: "olho", bone: "topo", image: "olho", center: [0, 178] },
    { slot: "boca", bone: "corpo", image: "boca", center: [0, 112] },
    { slot: "olho", bone: "topo", image: "olho_fechado", center: [0, 172], hidden: true },
  ],
  async montar(run) {
    // corpo deformavel (amassa e estica) preso ao corpo e ao topo
    await run("mesh.create", { slot: "corpo", name: "corpo", mode: "auto", detail: 0.5 });
    await run("mesh.weights", { slot: "corpo", attachment: "corpo", bones: ["corpo", "topo"] });
    await run("physics.preset", { bone: "antena", preset: "mola" });
    // idle: respira, inclina o topo, balanca os bracos e pisca
    await run("recipe.breathe", { anim: "idle", bone: "corpo", amount: 0.04, period: 2 });
    await run("recipe.sway", { anim: "idle", bone: "topo", angle: 5, period: 2, phase: 0.25 });
    await run("recipe.sway", { anim: "idle", bone: "braco_e", angle: 8, period: 2 });
    await run("recipe.sway", { anim: "idle", bone: "braco_d", angle: -8, period: 2 });
    await run("recipe.blink", { anim: "idle", slot: "olho", open: "olho", closed: "olho_fechado", at: 1.3 });
    // ganhou: pula com squash e levanta os bracos
    await run("recipe.bounce", { anim: "ganhou", bone: "base", height: 60, period: 0.8 });
    for (const [b, a] of [["braco_e", -70], ["braco_d", 70]] as const) {
      await run("key.set", { anim: "ganhou", target: { bone: b }, timeline: "rotate", time: 0, value: 0, curve: "suave" });
      await run("key.set", { anim: "ganhou", target: { bone: b }, timeline: "rotate", time: 0.4, value: a, curve: "suave" });
      await run("key.set", { anim: "ganhou", target: { bone: b }, timeline: "rotate", time: 0.8, value: 0 });
    }
    // o jogo toca o ganhou e volta ao idle: comeca e termina na pose de entrada dele
    await run("anim.match", { anim: "ganhou", like: "idle", at: "ambos" });
  },
};

// Pessoa (Kenney Modular Characters): corpo humano com mangas longas que dobram.
const pessoa: Personagem = {
  nome: "pessoa",
  anims: ["idle", "acenar"],
  async ossos(run) {
    await run("bone.add", { name: "quadril", at: [0, 200] });
    await run("bone.add", { name: "tronco", parent: "quadril", at: [0, 205], toward: [0, 380] });
    await run("bone.add", { name: "cabeca", parent: "tronco", at: [0, 392], toward: [0, 540] });
    await run("bone.add", { name: "cabelo", parent: "cabeca", at: [0, 540], toward: [0, 580] });
    await run("bone.add", { name: "ombro_e", parent: "tronco", at: [-62, 365], toward: [-140, 320] });
    await run("bone.add", { name: "cotovelo_e", parent: "ombro_e", at: [-140, 320], toward: [-200, 250] });
    await run("bone.add", { name: "mao_e", parent: "cotovelo_e", at: [-200, 250], toward: [-212, 210] });
    await run("bone.add", { name: "ombro_d", parent: "tronco", at: [62, 365], toward: [140, 320] });
    await run("bone.add", { name: "cotovelo_d", parent: "ombro_d", at: [140, 320], toward: [200, 250] });
    await run("bone.add", { name: "mao_d", parent: "cotovelo_d", at: [200, 250], toward: [212, 210] });
    await run("bone.add", { name: "perna_e", parent: "quadril", at: [-40, 190], toward: [-55, 30] });
    await run("bone.add", { name: "pe_e", parent: "perna_e", at: [-55, 30], toward: [-90, 20] });
    await run("bone.add", { name: "perna_d", parent: "quadril", at: [40, 190], toward: [55, 30] });
    await run("bone.add", { name: "pe_d", parent: "perna_d", at: [55, 30], toward: [90, 20] });
  },
  pecas: [
    { slot: "mao_e", bone: "mao_e", image: "mao", center: [-208, 228] },
    { slot: "mao_d", bone: "mao_d", image: "mao", center: [208, 228], flip: true },
    { slot: "perna_e", bone: "perna_e", image: "perna", center: [-42, 110], flip: true },
    { slot: "perna_d", bone: "perna_d", image: "perna", center: [42, 110] },
    { slot: "sapato_e", bone: "pe_e", image: "sapato", center: [-62, 21] },
    { slot: "sapato_d", bone: "pe_d", image: "sapato", center: [62, 21], flip: true },
    { slot: "quadril", bone: "quadril", image: "quadril", center: [0, 200] },
    { slot: "pescoco", bone: "tronco", image: "pescoco", center: [0, 378] },
    { slot: "camisa", bone: "tronco", image: "camisa", center: [0, 300] },
    { slot: "manga_e", bone: "ombro_e", image: "manga", center: [-130, 300], flip: true },
    { slot: "manga_d", bone: "ombro_d", image: "manga", center: [130, 300] },
    { slot: "cabeca", bone: "cabeca", image: "cabeca", center: [0, 470] },
    { slot: "rosto", bone: "cabeca", image: "rosto", center: [0, 455] },
    { slot: "cabelo", bone: "cabelo", image: "cabelo", center: [0, 520] },
  ],
  async montar(run) {
    // mangas deformaveis: dobram no cotovelo (pesos em ombro e cotovelo)
    for (const l of ["e", "d"]) {
      await run("mesh.create", { slot: `manga_${l}`, name: "manga", mode: "auto" });
      await run("mesh.weights", { slot: `manga_${l}`, attachment: "manga", bones: [`ombro_${l}`, `cotovelo_${l}`] });
    }
    await run("physics.preset", { bone: "cabelo", preset: "cabelo" });
    // idle: respira, cabeca balanca, bracos balancam com atraso
    await run("recipe.breathe", { anim: "idle", bone: "tronco", amount: 0.03, period: 2.4 });
    await run("recipe.sway", { anim: "idle", bone: "cabeca", angle: 3, period: 2.4, phase: 0.25 });
    for (const [b, a, ph] of [["ombro_e", 5, 0], ["cotovelo_e", 6, 0.15], ["ombro_d", -5, 0], ["cotovelo_d", -6, 0.15]] as const)
      await run("recipe.sway", { anim: "idle", bone: b, angle: a, period: 2.4, phase: ph });
    // acenar: levanta o braco direito e balanca o antebraco
    await run("animation.create", { name: "acenar" });
    await run("key.set", { anim: "acenar", target: { bone: "ombro_d" }, timeline: "rotate", time: 0, value: 0, curve: "suave" });
    await run("key.set", { anim: "acenar", target: { bone: "ombro_d" }, timeline: "rotate", time: 0.3, value: 100, curve: "suave" });
    await run("key.set", { anim: "acenar", target: { bone: "ombro_d" }, timeline: "rotate", time: 1.5, value: 100, curve: "suave" });
    await run("key.set", { anim: "acenar", target: { bone: "ombro_d" }, timeline: "rotate", time: 1.8, value: 0 });
    await run("recipe.sway", { anim: "acenar", bone: "cotovelo_d", angle: 25, period: 0.6, start: 0.3 });
    await run("recipe.sway", { anim: "acenar", bone: "cotovelo_d", angle: 25, period: 0.6, start: 0.9 });
  },
};

export const PERSONAGENS = [aventureiro, monstro, pessoa];

// monta um personagem: cria o asset a partir das partes e roda os comandos
export async function build(p: Personagem, root: string) {
  const dir = join(root, p.nome, "rig");
  // a ficha e escrita a mao: sobrevive a remontagem do rig
  const fichas = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ficha.md")).map((f) => [f, readFileSync(join(dir, f), "utf8")] as const) : [];
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [f, t] of fichas) writeFileSync(join(dir, f), t);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(root, "project.godot"))) writeFileSync(join(root, "project.godot"), PROJECT_GODOT);
  const created = await createAsset({ dir, name: p.nome, imagesFrom: join(CORPUS, p.nome, "partes") });
  const atlasText = readFileSync(created.atlas, "utf8");
  const atlas = parseAtlas(atlasText);
  const assets: AssetProvider = {
    async image(name) {
      const { data, info } = await sharp(join(dir, "images", name + ".png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data };
    },
    region(name) {
      const r = atlas.regions.find((x) => x.name === name);
      return r ? { width: r.originalWidth, height: r.originalHeight } : null;
    },
  };
  const doc = Document.fromText(readFileSync(created.skeleton, "utf8"), { text: atlasText, pages: {} });
  const run: Run = async (cmd, args = {}) => (await executeAsync(doc, { cmd, args }, "corpus", undefined, {}, assets))[0];
  await p.ossos(run);
  await pecas(run, p.pecas);
  await p.montar(run);
  writeFileSync(created.skeleton, doc.serialize());
  return created;
}

export const PROJECT_GODOT = `config_version=5

[application]

config/name="mamulengo-corpus"
config/features=PackedStringArray("4.7", "GL Compatibility")

[rendering]

renderer/rendering_method="gl_compatibility"
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
  const root = resolve(argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--only") ?? CORPUS);
  for (const p of PERSONAGENS) {
    if (only && p.nome !== only) continue;
    const c = await build(p, root);
    console.log(`${p.nome}: ${c.regions} imagens, paginas ${c.pages.join(",")} -> ${c.skeleton}`);
  }
}
