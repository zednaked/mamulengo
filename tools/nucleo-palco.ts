// Confere o palco do nucleo (docs/PALCO.md) na fase de exemplos/palco, jogando roteiros pelo
// tools/palco.ts: a rota que vence (duas moedas e a cenoura), cair no buraco, o pisao no espinho,
// encostar nele de lado, a patrulha que vira nas beiras e a mesma entrada dando o mesmo jogo.
//
//   npx tsx tools/nucleo-palco.ts [exemplos/palco/palco.boneco]
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const arq = resolve(process.argv[2] ?? "exemplos/palco/palco.boneco");
const jogar = (roteiro: string): any[] => {
  const r = spawnSync("npx", ["tsx", "tools/palco.ts", arq, "--roteiro", roteiro, "--json"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
};
const ator = (e: any, n: string) => e.atores.find((a: any) => a.nome === n);
let falhas = 0;
const ok = (c: boolean, msg: string) => {
  console.log(`${c ? "ok  " : "FALHA"} ${msg}`);
  if (!c) falhas++;
};

const VENCE = "direita+pulo 50, pulo 2, direita 20, nada 40, direita 30, direita+pulo 50, direita 30";
const v = jogar(VENCE);
const fim = v.at(-1);
ok(fim.venceu && !fim.morreu && fim.pontos === 2, `a rota vence: pedra (moeda 1), areia (moeda 2), madeira (a cenoura) em ${(fim.tick / 60).toFixed(2)} s, ${fim.pontos} moedas`);
ok(JSON.stringify(jogar(VENCE)) === JSON.stringify(v), "a mesma entrada da o mesmo jogo, quadro a quadro");

const b = jogar("direita 140").at(-1);
ok(b.morreu && !ator(b, "coelho").vivo, `andar para o buraco: cai e morre (y ${ator(b, "coelho").y})`);

const p = jogar("direita 110, direita+pulo 45, nada 200").at(-1);
ok(!ator(p, "espinho").vivo && !p.morreu, "pular o buraco caindo em cima do espinho: o pisao tira o espinho, o coelho segue");

const l = jogar("direita+pulo 50, direita+pulo 45, direita+pulo 55, direita 30").at(-1);
ok(l.morreu && ator(l, "espinho").vivo, "passar da madeira e cair no chao da direita de frente para o espinho: o coelho morre");

// a patrulha: 12 s parado, o espinho anda so no chao da direita (x de 896 a 1536) e vira
const pat = jogar(Array.from({ length: 24 }, () => "nada 30").join(", "));
const xs = pat.map((e) => ator(e, "espinho").x);
const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
const viradas = pat.slice(1).filter((e, i) => ator(e, "espinho").lado !== ator(pat[i], "espinho").lado).length;
ok(lo >= 896 && hi <= 1536 && viradas >= 2 && pat.every((e) => ator(e, "espinho").y === 94), `a patrulha fica no chao da direita (x ${lo.toFixed(0)} a ${hi.toFixed(0)}) e vira ${viradas} vezes (na beira do buraco e na do fim)`);
// montada por comandos: o mesmo mapa sem nenhum ator, e os seis atores postos so com stage.set e
// stage.actor (osso, camada e instancia de uma vez); a mesma rota vence igual
{
  const { readFileSync, writeFileSync, mkdtempSync, copyFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { importarSpine, exportarSpine } = await import("../src/boneco/spine.ts");
  const { Document } = await import("../src/core/document.ts");
  const { executeAsync } = await import("../src/core/commands/index.ts");
  const original = JSON.parse(readFileSync(arq, "utf8"));
  const { json, atlas } = exportarSpine(original);
  const atores = json.stage.actors;
  const nomes = new Set(atores.map((a: any) => a.name));
  const ossos = Object.fromEntries(json.bones.filter((b: any) => nomes.has(b.name)).map((b: any) => [b.name, b]));
  const bonecos = Object.fromEntries(json.instances.map((i: any) => [i.name, i.boneco]));
  // so o mapa
  delete json.stage;
  delete json.instances;
  json.bones = json.bones.filter((b: any) => !nomes.has(b.name));
  json.slots = json.slots.filter((s: any) => !nomes.has(s.name));
  const doc = new Document(json, { text: atlas, pages: {} });
  const calls = [
    { cmd: "stage.set", args: { gravity: 2400, solid: { mosaic: "mapa" } } },
    ...atores.map((a: any) => ({ cmd: "stage.actor", args: { name: a.name, boneco: bonecos[a.name], x: ossos[a.name].x, y: ossos[a.name].y, type: a.type, box: a.box, ...(a.speed !== undefined ? { speed: a.speed } : {}), ...(a.jump !== undefined ? { jump: a.jump } : {}), ...(a.side !== undefined ? { side: a.side } : {}), ...(a.animations ? { animations: a.animations } : {}) } })),
  ];
  await executeAsync(doc, calls, "ui", "monta a fase");
  const pasta = mkdtempSync(join(tmpdir(), "palco-comandos-"));
  for (const f of readdirSync(dirname(arq))) if (/\.(boneco|png)$/.test(f) && f !== "palco.boneco") copyFileSync(join(dirname(arq), f), join(pasta, f));
  const montado = join(pasta, "palco.boneco");
  writeFileSync(montado, JSON.stringify(importarSpine(doc.json, atlas, "palco")));
  const r = spawnSync("npx", ["tsx", "tools/palco.ts", montado, "--roteiro", VENCE, "--json"], { encoding: "utf8" });
  const fimM = JSON.parse(r.stdout.trim().split("\n").pop()!).at(-1);
  ok(fimM.venceu && fimM.pontos === 2 && fimM.tick === fim.tick && JSON.stringify(fimM.atores) === JSON.stringify(fim.atores), `a fase montada so por comandos (stage.set e ${atores.length} stage.actor, a partir do mapa sem atores) vence igual, quadro a quadro`);
}
process.exit(falhas ? 1 : 0);
