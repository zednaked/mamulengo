// Confere a fisica de posicao (canais x e y; docs/NUCLEO.md "Fisica de posicao") do nucleo contra
// o oraculo: um pai que salta, anda em rampa ou faz um caminho, e o filho com a fisica; a 1/50,
// 1/60 e 1/64 s, com limite, mix e giro junto. Os casos sao gerados numa pasta temporaria.
//
//   npx tsx tools/nucleo-fisica.ts [--nucleo nucleo/build/nucleo-pose]
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { oraculo } from "./oraculo.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
const dir = mkdtempSync(join(tmpdir(), "nucleo-fisica-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

const cena = (f: Record<string, any>, anim: any, esq: Record<string, any> = {}) => ({
  boneco: 0,
  nome: "fisica",
  paginas: [],
  imagens: [],
  esqueleto: { versao_spine: "4.3.23", ...esq },
  ossos: [{ nome: "root" }, { nome: "p", pai: "root" }, { nome: "c", pai: "p", x: 50, comprimento: 40 }],
  slots: [],
  skins: [{ nome: "default", partes: {} }],
  restricoes: [{ tipo: "fisica", nome: "f", osso: "c", ...f }],
  animacoes: { a: anim },
});
const mover = (ks: any[]) => ({ ossos: { p: { mover: ks } } });
const salto = mover([{ x: 0, y: 0, curva: "degrau" }, { tempo: 0.1, x: 100, y: 0, curva: "degrau" }, { tempo: 5, x: 100, y: 0 }]);
const rampa = mover([{ x: 0, y: 0 }, { tempo: 0.4, x: 120, y: 0 }, { tempo: 5, x: 120, y: 0 }]);
const anda = mover([{ x: 0, y: 0 }, { tempo: 0.4, x: 120, y: 60 }, { tempo: 0.8, x: -40, y: 20 }, { tempo: 5, x: -40, y: 20 }]);
const CASOS: [string, any, any, any?][] = [
  ["salto", { x: 1, y: 1 }, salto],
  ["salto com limite", { x: 1, inercia: 1, forca: 0, amortecimento: 1, limite: 300 }, salto],
  ["so inercia", { x: 1, inercia: 0.8, forca: 0, amortecimento: 1 }, rampa],
  ["rampa", { x: 1, inercia: 0.8, forca: 60, amortecimento: 0.7 }, rampa],
  ["caminho xy", { x: 1, y: 1, inercia: 0.8, forca: 60, amortecimento: 0.7 }, anda],
  ["caminho mix 0,5", { x: 1, y: 1, mix: 0.5 }, anda],
  ["so y, massa 2", { y: 1, massa: 2 }, anda],
  ["giro e posicao", { x: 1, y: 1, girar: 1 }, anda],
  ["gravidade e vento", { x: 1, y: 1, gravidade: 200, vento: 100 }, anda],
  ["gravidade, escala_ref 50", { x: 1, y: 1, gravidade: 200, vento: -60 }, anda, { escala_ref: 50 }],
];
let pior = 0,
  onde = "";
const arq = join(dir, "caso.boneco");
for (const fps of [50, 60, 64])
  for (const [nome, f, anim, esq] of CASOS) {
    const ts = Array.from({ length: Math.round(1.2 * fps) + 1 }, (_, k) => k / fps);
    const b = cena(f, anim, esq);
    writeFileSync(arq, JSON.stringify(b));
    const o = oraculo(b, "a", ts).quadros;
    const r = spawnSync(bin, [arq, "a", ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(r.stderr);
    const n = JSON.parse(r.stdout).quadros;
    o.forEach((q: any, k: number) => {
      const d = Math.hypot(q.ossos.c[4] - n[k].ossos.c[4], q.ossos.c[5] - n[k].ossos.c[5]);
      if (d > pior) [pior, onde] = [d, `${nome} a ${fps} q/s, quadro ${k}`];
    });
  }
if (pior > 1e-6) {
  console.log(`fisica de posicao diferente: ${pior.toExponential(1)} px (${onde})`);
  process.exit(1);
}
console.log(`fisica de posicao igual (${CASOS.length} casos x 3 taxas, maior diferenca ${pior.toExponential(1)} px)`);
