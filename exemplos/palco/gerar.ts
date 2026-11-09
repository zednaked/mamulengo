// O palco (docs/PALCO.md), o primeiro corte: uma fase de plataforma com o Jumper Pack da Kenney
// (CC0, em kenney/ e nos chaos de ../mosaico): o coelho (jogador), o espinho (patrulha), tres moedas
// (coletaveis) e a cenoura (a porta de saida), num mapa em mosaico. Cada personagem e um .boneco de
// troca de imagem; o palco.boneco os poe como instancias e diz quem e quem.
//
//   npx tsx exemplos/palco/gerar.ts      (escreve coelho, espinho, moeda, cenoura e palco.boneco)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { importarSpine } from "../../src/boneco/spine.ts";
import { packAtlas } from "../../server/atlas.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const K = (n: string) => join(AQUI, "kenney", `${n}.png`);

// um personagem de troca de imagem: cada quadro com os pes (o meio de baixo) na origem;
// animacoes: nome -> [quadros, segundos por quadro]
async function personagem(nome: string, quadros: Record<string, [string[], number]>, extra: (j: any) => void = () => {}) {
  const usadas = [...new Set(Object.values(quadros).flatMap(([q]) => q))];
  const entrada = usadas.map((q) => ({ name: q, data: readFileSync(K(q)) }));
  const partes: Record<string, any> = {};
  for (const q of usadas) {
    const m = await sharp(K(q)).metadata();
    partes[q] = { x: 0, y: m.height! / 2, width: m.width, height: m.height };
  }
  const animations: Record<string, any> = {};
  for (const [an, [qs, s]] of Object.entries(quadros)) {
    animations[an] = { slots: { corpo: { attachment: qs.map((q, i) => ({ time: +(i * s).toFixed(4), name: q })) } }, bones: { root: { translate: [{ time: +(qs.length * s).toFixed(4) }] } } };
  }
  const json: any = { skeleton: { spine: "4.3.23", images: "./kenney/", audio: "" }, bones: [{ name: "root" }], slots: [{ name: "corpo", bone: "root", attachment: usadas[0] }], skins: [{ name: "default", attachments: { corpo: partes } }], animations };
  extra(json);
  const pack = await packAtlas(entrada, { pageName: nome, format: "png", padding: 2 });
  for (const pg of pack.pages) writeFileSync(join(AQUI, pg.name), pg.data);
  writeFileSync(join(AQUI, `${nome}.boneco`), JSON.stringify(importarSpine(json, pack.atlas, nome), null, 1) + "\n");
}

await personagem("coelho", {
  parado: [["bunny1_stand"], 1],
  andando: [["bunny1_walk1", "bunny1_walk2"], 0.12],
  pulo: [["bunny1_jump"], 1],
  morto: [["bunny1_hurt"], 1],
});
await personagem("espinho", { andando: [["spikeMan_walk1", "spikeMan_walk2"], 0.2], parado: [["spikeMan_stand"], 1] });
await personagem("moeda", { parado: [["gold_1", "gold_2", "gold_3", "gold_4", "gold_3", "gold_2"], 0.08] });
await personagem("cenoura", { parado: [["carrot"], 1] }, (j) => {
  // a cenoura flutua: 8 px para cima e para baixo
  j.animations.parado.bones.root.translate = [
    { time: 0, y: 0, curve: [0.3, 0, 0.5, 0, 0.3, 0, 0.5, 8] },
    { time: 0.8, y: 8, curve: [1.1, 0, 1.3, 0, 1.1, 8, 1.3, 0] },
    { time: 1.6, y: 0 },
  ];
});

// ---- a fase: 24 x 8 celulas de 64 x 94 (os chaos do exemplo do mosaico), a linha 0 em cima
const C = 24,
  R = 8,
  CW = 64,
  CH = 94,
  TOPO = R * CH;
const MOS = join(AQUI, "..", "mosaico", "fontes");
const materiais = ["grama", "pedra", "areia", "madeira"];
const paleta = materiais.flatMap((m) => [`${m}_ponta`, `${m}_meio`]);
const celulas = new Array(C * R).fill(-1);
const extras: Record<string, any> = {};
// ponta, meio, meio espelhado, ..., ponta espelhada (o numero de meios e par: emenda sem costura)
function plataforma(mat: string, linha: number, de: number, ate: number) {
  if ((ate - de - 1) % 2) throw new Error(`plataforma ${mat}: o numero de meios tem de ser par`);
  const i0 = paleta.indexOf(`${mat}_ponta`);
  for (let c = de; c <= ate; c++) {
    const k = linha * C + c;
    celulas[k] = c === de || c === ate ? i0 : i0 + 1;
    if (c === ate || (c !== de && (c - de) % 2 === 0)) extras[k] = { flip: true };
  }
}
// o coelho tem 180 de altura: a plataforma mais baixa fica na linha 4 (o fundo dela, 282, acima da
// cabeca dele no chao, 274); o pulo sobe uns 380, e cada degrau sobe 94 com 128 de vao
// o buraco (12 e 13) fica sem plataforma em cima: pular do chao para atravessar nao bate a cabeca
plataforma("grama", 7, 0, 11); // o chao da esquerda
plataforma("grama", 7, 14, 23); // o chao da direita (o espinho)
plataforma("pedra", 4, 3, 6);
plataforma("areia", 3, 7, 10);
plataforma("madeira", 2, 15, 18);
const topoDa = (linha: number) => TOPO - linha * CH; // o y de cima da linha (onde os pes ficam)

const tiles = await packAtlas(
  paleta.map((n) => ({ name: n, data: readFileSync(join(MOS, `${n}.png`)) })),
  { pageName: "palco", format: "png", padding: 2 },
);
for (const pg of tiles.pages) writeFileSync(join(AQUI, pg.name), pg.data);

// os atores: osso, slot e instancia com o mesmo nome
const atores: { name: string; boneco: string; x: number; y: number; ator: any }[] = [
  { name: "coelho", boneco: "coelho.boneco", x: 96, y: topoDa(7), ator: { type: "player", box: [70, 180], speed: 360, jump: 1350 } },
  { name: "espinho", boneco: "espinho.boneco", x: 1300, y: topoDa(7), ator: { type: "patrol", box: [80, 140], speed: 110, side: -1, animations: { idle: "andando" } } },
  { name: "moeda_1", boneco: "moeda.boneco", x: 5 * CW, y: topoDa(4) + 20, ator: { type: "collectible", box: [60, 84] } },
  { name: "moeda_2", boneco: "moeda.boneco", x: 9 * CW, y: topoDa(3) + 20, ator: { type: "collectible", box: [60, 84] } },
  { name: "moeda_3", boneco: "moeda.boneco", x: 21 * CW, y: topoDa(7) + 20, ator: { type: "collectible", box: [60, 84] } },
  { name: "cenoura", boneco: "cenoura.boneco", x: 17 * CW, y: topoDa(2) + 10, ator: { type: "door", box: [70, 70] } },
];
const json = {
  skeleton: { spine: "4.3.23", images: "", audio: "", x: 0, y: 0, width: C * CW, height: TOPO + 160 },
  bones: [{ name: "root" }, { name: "mapa", parent: "root" }, ...atores.map((a) => ({ name: a.name, parent: "root", x: a.x, y: a.y }))],
  slots: [{ name: "mapa", bone: "mapa" }, ...atores.map((a) => ({ name: a.name, bone: a.name }))],
  skins: [{ name: "default", attachments: {} }],
  animations: {},
  mosaics: [{ name: "mapa", slot: "mapa", shape: "grid", x: 0, y: TOPO, cell: [CW, CH], columns: C, rows: R, palette: paleta, cells: celulas, extras }],
  instances: atores.map((a) => ({ name: a.name, slot: a.name, boneco: a.boneco, animation: a.name === "cenoura" || a.name.startsWith("moeda") ? "parado" : a.name === "espinho" ? "andando" : "parado" })),
  stage: { gravity: 2400, solid: { mosaic: "mapa" }, actors: atores.map((a) => ({ name: a.name, instance: a.name, ...a.ator })) },
};
const b = importarSpine(json, tiles.atlas, "palco");
writeFileSync(join(AQUI, "palco.boneco"), JSON.stringify(b, null, 1) + "\n");
console.log(`palco.boneco: ${C} x ${R} celulas, ${atores.length} atores (${atores.map((a) => `${a.name}:${a.ator.type}`).join(", ")})`);
