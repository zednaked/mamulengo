// Confere a geleia do nucleo (docs/NUCLEO.md "Geleia") pelo comportamento: uma malha em grade
// presa embaixo (moleza 0) e solta em cima, num osso que anda 80 px em 0,3 s e para. Compara os
// vertices do nucleo-pose com e sem geleia (o rig):
// - a fileira presa fica no rig em todo instante;
// - andando, o topo atrasa; parando, passa do ponto e volta (balanca); depois assenta no rig;
// - sem a geleia, a malha e o rig.
//
//   npx tsx tools/nucleo-geleia.ts [--nucleo nucleo/build/nucleo-pose]
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
// a peca de teste e gerada aqui a cada vez (malha sem imagem: o oraculo do nucleo-compara nao a le)
const dir = mkdtempSync(join(tmpdir(), "nucleo-geleia-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

// malha 5 x 5 de 100 x 100 px, presa ao osso pela base (y de 0 a 100 no osso)
const N = 5;
const uvs: number[] = [],
  vertices: number[] = [],
  moleza: number[] = [];
for (let r = 0; r < N; r++)
  for (let c = 0; c < N; c++) {
    const u = c / (N - 1),
      v = r / (N - 1);
    uvs.push(u, v);
    vertices.push(-50 + u * 100, 100 - v * 100);
    moleza.push(+((1 - v) ** 1.5).toFixed(4));
  }
const triangulos: number[] = [];
for (let r = 0; r + 1 < N; r++)
  for (let c = 0; c + 1 < N; c++) {
    const a = r * N + c;
    triangulos.push(a, a + 1, a + N, a + 1, a + N + 1, a + N);
  }
const contorno: number[] = [];
const boneco = (geleia: any) => ({
  boneco: 0,
  nome: "geleia",
  paginas: [],
  imagens: [],
  esqueleto: { versao_spine: "4.3.23" },
  ossos: [{ nome: "root" }, { nome: "corpo", pai: "root" }],
  slots: [
    { nome: "corpo", osso: "corpo", parte: "corpo" },
    { nome: "olho", osso: "corpo", parte: "olho" },
  ],
  // o olho: uma imagem de 10 x 10 no alto da malha, presa ao mesmo osso
  skins: [{ nome: "default", partes: { corpo: { corpo: { tipo: "malha", uvs, triangulos, vertices, contorno: 16, largura: 100, altura: 100, ...(geleia ? { geleia } : {}) } }, olho: { olho: { x: 0, y: 87.5, largura: 10, altura: 10 } } } }],
  animacoes: { anda: { ossos: { corpo: { mover: [{ x: 0 }, { tempo: 0.3, x: 80, curva: "degrau" }, { tempo: 5, x: 80 }] } } } },
});
void contorno;
const G = { rigidez: 120, contagio: 80, amortecimento: 3, moleza, seguem: ["olho"] };
writeFileSync(`${dir}/geleia.boneco`, JSON.stringify(boneco(G)));
writeFileSync(`${dir}/rig.boneco`, JSON.stringify(boneco(null)));

const ts = Array.from({ length: 61 }, (_, k) => +(k * 0.05).toFixed(2)).concat([4]);
const posar = (arq: string) => {
  const r = spawnSync(bin, [arq, "anda", ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout).quadros.map((q: any) => q.vertices.corpo as number[]);
};
const posarOlho = (arq: string) => {
  const r = spawnSync(bin, [arq, "anda", ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  return JSON.parse(r.stdout).quadros.map((q: any) => q.vertices.olho as number[]);
};
const mole = posar(`${dir}/geleia.boneco`),
  rig = posar(`${dir}/rig.boneco`);
const rigSem = posar(`${dir}/rig.boneco`);

let falhas = 0;
const ok = (c: boolean, msg: string) => {
  console.log(`${c ? "ok  " : "FALHA"} ${msg}`);
  if (!c) falhas++;
};
// topo do meio (fileira 0, coluna 2) e base (ultima fileira)
const topo = 2,
  base = (N - 1) * N;
const dx = (q: number, v: number) => mole[q][v * 2] - rig[q][v * 2];
let presa = 0;
for (let q = 0; q < ts.length; q++) for (let c = 0; c < N; c++) presa = Math.max(presa, Math.abs(dx(q, base + c)), Math.abs(mole[q][(base + c) * 2 + 1] - rig[q][(base + c) * 2 + 1]));
ok(presa < 1e-9, `fileira presa no rig (desvio maximo ${presa.toExponential(1)} px)`);
const q03 = ts.indexOf(0.3);
ok(dx(q03, topo) < -5, `andando, o topo atrasa (${dx(q03, topo).toFixed(1)} px do rig em 0,3 s)`);
const depois = ts.map((t, q) => ({ t, d: dx(q, topo) })).filter((x) => x.t > 0.3 && x.t <= 1.5);
const passa = Math.max(...depois.map((x) => x.d));
ok(passa > 2, `parando, o topo passa do ponto (${passa.toFixed(1)} px alem)`);
const volta = depois.findIndex((x) => x.d > 2);
ok(volta >= 0 && depois.slice(volta).some((x) => x.d < 0), "e volta (balanca)");
const fim = Math.max(...Array.from({ length: N * N }, (_, v) => Math.hypot(dx(ts.length - 1, v), mole[ts.length - 1][v * 2 + 1] - rig[ts.length - 1][v * 2 + 1])));
ok(fim < 0.5, `assenta no rig (${fim.toFixed(3)} px em 4 s)`);
ok(JSON.stringify(rig) === JSON.stringify(rigSem), "sem geleia, a malha e o rig (e a conta e a mesma a cada vez)");
// o olho segue: anda com o deslocamento da malha no ponto dele (entre as fileiras 0 e 1, coluna 2)
{
  const om = posarOlho(`${dir}/geleia.boneco`),
    or = posarOlho(`${dir}/rig.boneco`);
  let pior = 0,
    mexe = 0;
  for (let q = 0; q < ts.length; q++) {
    const d = om[q][0] - or[q][0];
    // o centro do olho fica a 1/2 entre o topo (v 2) e a fileira de baixo (v 7)
    const esperado = (dx(q, 2) + dx(q, 7)) / 2;
    pior = Math.max(pior, Math.abs(d - esperado));
    mexe = Math.max(mexe, Math.abs(d));
  }
  ok(mexe > 5 && pior < 0.01, `o olho segue a geleia (anda ate ${mexe.toFixed(1)} px, desvio ${pior.toExponential(1)} px do ponto da malha)`);
}
// a curva do topo, para olhar
console.log("topo - rig (px):", ts.filter((t) => t <= 1.5).map((t) => `${t}:${dx(ts.indexOf(t), topo).toFixed(1)}`).join(" "));
if (falhas) process.exit(1);
