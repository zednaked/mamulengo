// A vinheta curta: abertura e fechamento rapidos para colar em volta de um video do Mamulengo
// (tools/vinheta.ts), feitos das mesmas pecas da vinheta (vinheta.boneco: o palco, a luz, a
// marionete e as letras como instancias, a barra e o subtitulo), sem cortina, lampadas e plateia.
//
//   abertura   (1,5 s)  a marionete cai nos fios, as letras batem na tela uma depois da outra e
//                       voam para quem assiste
//   fechamento (2,4 s)  as letras chegam, a barra cresce, o subtitulo aparece dissolvendo e a
//                       marionete faz a reverencia
//
//   npx tsx exemplos/vinheta/curta.ts      (escreve exemplos/vinheta/curta.boneco; depois de gerar.ts)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const v = JSON.parse(readFileSync(join(AQUI, "vinheta.boneco"), "utf8"));

// o que fica do palco
const SLOTS = new Set(["fundo", "pano", "foco", "halo", "marionete", ...Array.from({ length: 9 }, (_, i) => `letra_${i}`), "barra", "subtitulo", "grao", "vinheta_lente"]);
const b: any = { ...v, nome: "curta" };
delete b.particulas;
delete b.ficha;
b.slots = v.slots.filter((s: any) => SLOTS.has(s.nome));
b.skins = v.skins.map((sk: any) => ({ ...sk, partes: Object.fromEntries(Object.entries(sk.partes ?? {}).filter(([s]) => SLOTS.has(s))) }));
b.instancias = v.instancias.filter((i: any) => SLOTS.has(i.slot));
// so a luz chave e o ambiente (as outras acendiam pela animacao)
b.luzes = v.luzes.filter((l: any) => l.nome === "chave");
const LETRAS = 9;

// ---- abertura: tudo rapido; as letras chegam com 50 ms entre elas e saem juntas
const abertura: any = { instancias: {}, slots: {}, efeitos: {} };
abertura.instancias.marionete = [{ tempo: 0, animacao: "chega", inicio: 0.15, repetir: false }];
for (let i = 0; i < LETRAS; i++)
  abertura.instancias[`letra_${i}`] = [
    { tempo: 0, animacao: "chega", inicio: r3(0.15 - 0.05 * i), repetir: false },
    { tempo: 1.05, animacao: "sai", inicio: 0, repetir: false },
  ];
// a barra e o subtitulo nao aparecem; a marionete some no fim (com as letras)
abertura.slots.barra = { rgba: [{ tempo: 0, cor: "ffffff00" }] };
abertura.efeitos.subtitulo = { dissolver: [{ tempo: 0, valor: 1 }] };
abertura.slots.marionete = { rgba: [{ tempo: 0, cor: "ffffffff" }, { tempo: 1.15, cor: "ffffffff" }, { tempo: 1.45, cor: "ffffff00" }] };
// fade de entrada da cena (do preto) e de saida
const fade = (dur: number, entra: number, sai: number) => [
  { tempo: 0, cor: "ffffff00" },
  { tempo: entra, cor: "ffffffff" },
  { tempo: r3(dur - sai), cor: "ffffffff" },
  { tempo: dur, cor: "ffffff00" },
];
for (const s of ["fundo", "pano", "foco", "halo"]) abertura.slots[s] = { rgba: fade(1.5, 0.12, 0.2) };

// ---- fechamento: as letras chegam, a barra cresce e o subtitulo dissolve para dentro; a
// marionete chega e faz a reverencia
const fechamento: any = { instancias: {}, slots: {}, efeitos: {}, ossos: {} };
fechamento.instancias.marionete = [
  { tempo: 0, animacao: "chega", inicio: 0.2, repetir: false },
  { tempo: 1.2, animacao: "reverencia", inicio: 0, repetir: false },
];
for (let i = 0; i < LETRAS; i++) fechamento.instancias[`letra_${i}`] = [{ tempo: 0, animacao: "chega", inicio: r3(0.25 - 0.04 * i), repetir: false }];
fechamento.ossos.barra = { escalar: [{ tempo: 0, x: 0, y: 1 }, { tempo: 0.6, x: 0, y: 1, curva: [0.7, 0, 0.8, 1] }, { tempo: 0.95, x: 1.15, y: 1, curva: [1.06, 1.15, 1.13, 1] }, { tempo: 1.1, x: 1, y: 1 }] };
fechamento.efeitos.subtitulo = { dissolver: [{ tempo: 0, valor: 1 }, { tempo: 0.75, valor: 1 }, { tempo: 1.3, valor: 0 }] };
for (const s of ["fundo", "pano", "foco", "halo"]) fechamento.slots[s] = { rgba: fade(2.4, 0.15, 0.25) };
for (const s of ["marionete", "barra", "subtitulo", ...Array.from({ length: LETRAS }, (_, i) => `letra_${i}`)]) fechamento.slots[s] = { rgba: [{ tempo: 0, cor: "ffffffff" }, { tempo: 2.15, cor: "ffffffff" }, { tempo: 2.4, cor: "ffffff00" }] };

b.animacoes = { abertura, fechamento };
writeFileSync(join(AQUI, "curta.boneco"), JSON.stringify(b, null, 1) + "\n");
console.log(`curta.boneco: ${b.slots.length} slots, ${b.instancias.length} instancias, abertura 1,5 s e fechamento 2,4 s`);
