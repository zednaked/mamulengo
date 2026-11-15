// Confere o tutorial de rig e IK (src/core/tutorial.ts): cada cena original tem de chegar com a
// tarefa por fazer (a conferencia nao passa) e, resolvida pelos comandos do editor (o que a pessoa
// faz pela tela), passar inteira. Tambem confere que preparar e recomecar (server/tutorial.ts)
// devolvem o original.
//
//   npx tsx tools/tutorial-teste.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { exportarSpine } from "../src/boneco/spine.ts";
import { Document } from "../src/core/document.ts";
import { executeAsync, type AssetProvider, type Call } from "../src/core/commands/index.ts";
import { parseAtlas } from "../src/core/atlas-text.ts";
import { extractRegion } from "../server/atlas.ts";
import sharp from "sharp";
import { GEO, GEO_MONSTRO, LICOES } from "../src/core/tutorial.ts";
import { arquivoDaCena, preparar, recomecar } from "../server/tutorial.ts";

const ORIG = join(import.meta.dirname, "..", "exemplos", "tutorial", "originais");
const abrir = (id: string) => {
  const ex = exportarSpine(JSON.parse(readFileSync(join(ORIG, `${id}.boneco.original`), "utf8")));
  return { doc: Document.fromText(JSON.stringify(ex.json), { text: ex.atlas, pages: {} }), prov: provDe(ex.atlas) };
};
// as imagens para o mesh.create (o contorno), das paginas dos originais
const provDe = (texto: string): AssetProvider => {
  const atlas = parseAtlas(texto);
  return {
    async image(nome) {
      const r = atlas.regions.find((x) => x.name === nome);
      const pg = r && atlas.pages.find((p) => p.name === r.page);
      if (!r || !pg) return null;
      const png = await extractRegion(sharp(join(ORIG, pg.name)), r);
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data };
    },
    region(nome) {
      const r = atlas.regions.find((x) => x.name === nome);
      return r ? { width: r.originalWidth, height: r.originalHeight } : null;
    },
  };
};
const { perna } = GEO;
const md = GEO_MONSTRO.pernaD;
const ponta = (p: { x: number; y: number }) => [p.x + 30, 10] as [number, number];

// o que a pessoa faz em cada cena, pelos comandos que a tela usa
const SOLUCAO: Record<string, Call[]> = {
  prender: ["braco", "antebraco", "mao"].map((n) => ({ cmd: "slot.set", args: { slot: n, bone: n } })),
  ossos: [
    // o osso nasce filho do escolhido, do comeco a ponta (ferramenta Osso)
    { cmd: "bone.add", args: { name: "minha_coxa", parent: "quadril", at: [perna.quadril.x + 3, perna.quadril.y - 2], toward: [perna.joelho.x, perna.joelho.y] } },
    { cmd: "bone.add", args: { name: "minha_canela", parent: "minha_coxa", at: [perna.joelho.x - 2, perna.joelho.y + 4], toward: [perna.tornozelo.x, perna.tornozelo.y] } },
    { cmd: "bone.add", args: { name: "meu_pe", parent: "minha_canela", at: [perna.tornozelo.x, perna.tornozelo.y], toward: ponta(perna.tornozelo) } },
    { cmd: "slot.set", args: { slot: "coxa", bone: "minha_coxa" } },
    { cmd: "slot.set", args: { slot: "canela", bone: "minha_canela" } },
    { cmd: "slot.set", args: { slot: "pe", bone: "meu_pe" } },
  ],
  // o 🎯 Alcancar (Inspector quickIk) e o arraste do alvo
  alcancar: [
    { cmd: "bone.add", args: { name: "canela_alvo", parent: "root", at: [perna.tornozelo.x, perna.tornozelo.y] } },
    { cmd: "ik.create", args: { name: "canela_ik", bones: ["coxa", "canela"], target: "canela_alvo" } },
    // o alvo e filho da raiz: x/y locais sao o mundo
    { cmd: "bone.set", args: { bone: "canela_alvo", x: GEO.pedra.x, y: GEO.pedra.y } },
  ],
  dobra: [], // depende do valor atual (abaixo)
  chao: [
    { cmd: "bone.reparent", args: { bone: "canela_alvo", parent: "root" } },
    { cmd: "bone.reparent", args: { bone: "canela_e_alvo", parent: "root" } },
  ],
  agachar: [
    { cmd: "animation.create", args: { name: "agachar" } },
    { cmd: "key.set", args: { anim: "agachar", target: { bone: "quadril" }, timeline: "translate", time: 0, x: 0, y: 0 } },
    { cmd: "key.set", args: { anim: "agachar", target: { bone: "quadril" }, timeline: "translate", time: 0.4, x: 0, y: -50 } },
    { cmd: "key.set", args: { anim: "agachar", target: { bone: "quadril" }, timeline: "translate", time: 0.8, x: 0, y: 0 } },
  ],
  bola: [{ cmd: "constraint.set", args: { name: "antebraco_ik", props: { target: "bola" } } }],
  "m-montar": ["olho_e", "olho_d", "nariz", "boca"].map((n) => ({ cmd: "slot.set", args: { slot: n, bone: "corpo" } })),
  "m-ossos": [
    { cmd: "bone.add", args: { name: "coxa_d", parent: "quadril", at: [md.quadril.x + 2, md.quadril.y - 3], toward: [md.joelho.x, md.joelho.y] } },
    { cmd: "bone.add", args: { name: "canela_d", parent: "coxa_d", at: [md.joelho.x, md.joelho.y], toward: [md.tornozelo.x + 3, md.tornozelo.y] } },
    { cmd: "slot.set", args: { slot: "perna_d", bone: "coxa_d" } },
  ],
  // os botoes Deixar deformavel (Inspector makeMesh) e Dobrar com os ossos (bindToBones)
  "m-malha": [
    { cmd: "mesh.create", args: { slot: "perna_d", name: "perna_d", detail: 1.8 } },
    { cmd: "mesh.weights", args: { slot: "perna_d", attachment: "perna_d", bones: ["coxa_d", "canela_d", "quadril"] } },
  ],
  // o 🎯 Alcancar nas duas canelas
  "m-pes": (["d", "e"] as const).flatMap((l) => {
    const t = (l === "d" ? GEO_MONSTRO.pernaD : GEO_MONSTRO.pernaE).tornozelo;
    return [
      { cmd: "bone.add", args: { name: `canela_${l}_alvo`, parent: "root", at: [t.x, t.y] } },
      { cmd: "ik.create", args: { name: `canela_${l}_ik`, bones: [`coxa_${l}`, `canela_${l}`], target: `canela_${l}_alvo` } },
    ];
  }),
  "m-pulo": [
    { cmd: "animation.create", args: { name: "pulo" } },
    ...([[0, 0], [0.2, -10], [0.45, 80], [0.7, -8], [0.9, 0]] as const).map(([t, y]) => ({ cmd: "key.set", args: { anim: "pulo", target: { bone: "quadril" }, timeline: "translate", time: t, x: 0, y } })),
    ...(["canela_d_alvo", "canela_e_alvo"] as const).flatMap((b) =>
      ([[0, 0], [0.2, 0], [0.45, 50], [0.7, 0], [0.9, 0]] as const).map(([t, y]) => ({ cmd: "key.set", args: { anim: "pulo", target: { bone: b }, timeline: "translate", time: t, x: 0, y } })),
    ),
  ],
};

let falhas = 0;
const falha = (m: string) => (falhas++, console.log(`  ✗ ${m}`));
for (const l of LICOES) {
  const { doc, prov } = abrir(l.id);
  const antes = l.conferir(doc.json);
  console.log(`${l.id}: original ${antes.filter((i) => i.ok).length}/${antes.length}`);
  if (antes.every((i) => i.ok)) falha(`${l.id}: a cena original ja passa (nao ha o que fazer)`);
  let calls = SOLUCAO[l.id];
  if (l.id === "dobra") {
    const ik = (doc.json.constraints ?? []).find((c: any) => c.name === "canela_ik");
    calls = [{ cmd: "constraint.set", args: { name: "canela_ik", props: { bendPositive: !(ik.bendPositive ?? true) } } }];
  }
  await executeAsync(doc, calls, "teste", "solucao", {}, prov);
  const depois = l.conferir(doc.json);
  for (const i of depois) if (!i.ok) falha(`${l.id}: ${i.texto}`);
  console.log(`${l.id}: resolvida ${depois.filter((i) => i.ok).length}/${depois.length}`);
  for (const i of depois) console.log(`    ${i.ok ? "✓" : "○"} ${i.texto}`);
}

// preparar e recomecar
preparar();
const arq = arquivoDaCena("prender");
const original = readFileSync(join(ORIG, "prender.boneco.original"), "utf8");
writeFileSync(arq, "{}");
recomecar("prender");
if (readFileSync(arq, "utf8") !== original) falha("recomecar nao devolveu o original");
writeFileSync(arquivoDaCena("bola"), "{}");
recomecar();
if (readFileSync(arquivoDaCena("bola"), "utf8") !== readFileSync(join(ORIG, "bola.boneco.original"), "utf8")) falha("recomecar tudo nao devolveu o original");
if (!existsSync(join(arq, "..", "tutorial.png"))) falha("a pagina tutorial.png nao foi copiada");

console.log(falhas ? `\n${falhas} falha(s)` : "\ntutorial ok");
process.exit(falhas ? 1 : 0);
