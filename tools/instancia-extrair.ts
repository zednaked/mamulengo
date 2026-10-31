// Confere o instance.extract e o instance.inline (docs/NUCLEO.md "Instancias"): extrai um osso de
// um .boneco para um filho, grava pai e filho num diretorio temporario e compara, no nucleo, em
// todas as animacoes e varios instantes, o mundo de cada osso extraido: no original e dentro da
// instancia (a saida do nucleo-pose com as instancias); depois embute o filho de volta e compara
// todos os ossos e a ordem dos slots com o original.
//
//   npx tsx tools/instancia-extrair.ts [tests/boneco/robo/robo.boneco] [osso=ombro_e] [--nucleo nucleo/build/nucleo-pose]
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { exportarSpine, importarSpine } from "../src/boneco/spine.ts";
import { Document } from "../src/core/document.ts";
import { execute, executeAsync } from "../src/core/commands/index.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
const arq = resolve(args[0] ?? "tests/boneco/robo/robo.boneco");
const osso = args[1] ?? "ombro_e";

const b = JSON.parse(readFileSync(arq, "utf8"));
const ex = exportarSpine(b);
const doc = new Document(ex.json, { text: ex.atlas, pages: {} });
const [r] = execute(doc, { cmd: "instance.extract", args: { bone: osso, boneco: "filho.boneco" } }, "teste");
const tmp = mkdtempSync(join(tmpdir(), "extrair-"));
const pai = importarSpine(doc.json, doc.atlas.text, b.nome);
writeFileSync(join(tmp, "pai.boneco"), JSON.stringify(pai));
writeFileSync(join(tmp, "filho.boneco"), r.arquivo.texto);
for (const pg of b.paginas ?? []) for (const f of [pg.arquivo, pg.relevo].filter(Boolean)) copyFileSync(join(dirname(arq), f), join(tmp, f));

const pose = (c: string, anim: string, ts: number[]) => {
  const s = spawnSync(bin, [c, anim, ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (s.status !== 0) throw new Error(s.stderr);
  return JSON.parse(s.stdout).quadros;
};
let falhas = 0,
  conferidos = 0,
  maior = 0;
const compara = (a: number[], c: number[]) => Math.max(...a.map((x, k) => Math.abs(x - c[k]) / Math.max(1, Math.abs(x))));
for (const anim of Object.keys(b.animacoes ?? {})) {
  const ts = Array.from({ length: 9 }, (_, k) => +(k * 0.27).toFixed(3));
  const antes = pose(arq, anim, ts),
    depois = pose(join(tmp, "pai.boneco"), anim, ts);
  ts.forEach((t, q) => {
    const inst = depois[q].instancias?.[r.instance];
    if (!inst) {
      falhas++;
      return void console.log(`FALHA ${anim}@${t}: a instancia nao saiu`);
    }
    for (const [nome, m] of Object.entries<number[]>(antes[q].ossos)) {
      const novo = inst.ossos[nome] ?? depois[q].ossos[nome];
      conferidos++;
      if (!novo) {
        falhas++;
        console.log(`FALHA ${anim}@${t}: osso ${nome} sumiu`);
        continue;
      }
      const d = compara(m, novo);
      maior = Math.max(maior, d);
      if (!(d <= 1e-6)) (falhas++, console.log(`FALHA ${anim}@${t} ${nome}: ${JSON.stringify(m)} -> ${JSON.stringify(novo)}`));
    }
  });
}
// a volta: embutir de novo (instance.inline lendo o filho do disco) tem de dar o original
doc.file = { tres: join(tmp, "pai.boneco") };
const leitor = { image: async () => null, region: () => null, text: async (c: string) => readFileSync(c, "utf8") };
const [rv] = await executeAsync(doc, { cmd: "instance.inline", args: { name: r.instance } }, "teste", undefined, {}, leitor as any);
writeFileSync(join(tmp, "volta.boneco"), JSON.stringify(importarSpine(doc.json, doc.atlas.text, b.nome)));
for (const anim of Object.keys(b.animacoes ?? {})) {
  const ts = Array.from({ length: 9 }, (_, k) => +(k * 0.27).toFixed(3));
  const antes = pose(arq, anim, ts),
    volta = pose(join(tmp, "volta.boneco"), anim, ts);
  ts.forEach((t, q) => {
    for (const [nome, m] of Object.entries<number[]>(antes[q].ossos)) {
      conferidos++;
      const v = volta[q].ossos[nome];
      if (!v) return void (falhas++, console.log(`FALHA volta ${anim}@${t}: osso ${nome} sumiu`));
      const d = compara(m, v);
      maior = Math.max(maior, d);
      if (!(d <= 1e-6)) (falhas++, console.log(`FALHA volta ${anim}@${t} ${nome}`));
    }
    if (JSON.stringify(antes[q].slots.map((x: any) => x.nome)) !== JSON.stringify(volta[q].slots.map((x: any) => x.nome))) (falhas++, console.log(`FALHA volta ${anim}@${t}: a ordem dos slots mudou`));
  });
}
if (rv.avisos?.length) console.log("avisos da volta:", rv.avisos.join("; "));
rmSync(tmp, { recursive: true, force: true });
if (r.avisos?.length) console.log("avisos:", r.avisos.join("; "));
console.log(falhas ? `${falhas} diferencas em ${conferidos} ossos x instantes` : `extrair igual, e a volta tambem (${conferidos} ossos x instantes, maior diferenca ${maior.toExponential(1)})`);
process.exit(falhas ? 1 : 0);
