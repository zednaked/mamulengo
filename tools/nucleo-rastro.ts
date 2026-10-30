// Confere o rastro do nucleo (docs/NUCLEO.md "Rastro") pela especificacao: para cada instante, os
// passos do nucleo-pose ate ele (0, 1/64, 2/64... e o resto), os vertices e os canais do rastro em
// cada passo, e as copias refeitas aqui: a memoria simulada passo a passo (rastro desligado apaga; a
// cada passo fica o mais novo ate passo - copias x intervalo e os seguintes) e, para k de copias
// ate 1, o guardado mais novo ate agora - k x intervalo, com a mesma quantidade de vertices;
// alfa = alfa x (copias - k + 1) / copias. Compara com os "rastros" que o nucleo-pose escreve.
//
//   npx tsx tools/nucleo-rastro.ts [tests/nucleo/rastro/rastro.boneco] [--nucleo nucleo/build/nucleo-pose]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
const arq = resolve(args[0] ?? "tests/nucleo/rastro/rastro.boneco");
const b = JSON.parse(readFileSync(arq, "utf8"));
const [COPIAS, INTERVALO, ALFA] = [26, 27, 28];

// os passos do nucleo-pose ate t (os relogios em que o mundo foi calculado)
const passos = (t: number) => {
  const p = 1 / 64,
    out = [0];
  let acc = 0;
  while (acc < t) {
    acc += Math.min(p, t - acc);
    if (t - acc < 1e-12) acc = t;
    out.push(acc);
  }
  return out;
};
const posar = (anim: string, ts: number[]) => {
  const r = spawnSync(bin, [arq, anim, ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout).quadros;
};
const ligado = (ef: number[] | undefined) => !!ef && ef[COPIAS] >= 1 && ef[INTERVALO] > 0 && ef[ALFA] > 0;

let falhas = 0,
  conferidos = 0,
  copiasVistas = 0;
for (const anim of Object.keys(b.animacoes ?? {})) {
  const ts = Array.from({ length: 16 }, (_, k) => Math.round(k * 0.0371 * 1e4) / 1e4);
  // todos os passos de todos os instantes, numa chamada so
  const todos = [...new Set(ts.flatMap(passos))].sort((x, y) => x - y);
  const q = posar(anim, todos);
  const em = new Map(todos.map((t, k) => [t, q[k]]));
  for (const t of ts) {
    const ps = passos(t);
    const agora = em.get(t);
    for (const s of b.slots) {
      const ef = agora.slots.find((x: any) => x.nome === s.nome)?.efeitos;
      const cur = agora.vertices[s.nome];
      let esperado: number[][] = [];
      if (ligado(ef) && cur) {
        // os passos guardados, simulando a memoria: desligado apaga; a cada passo fica o mais
        // novo ate passo - copias x intervalo (os canais daquele passo) e os seguintes
        let guardados: number[] = [];
        for (const p of ps) {
          const e = em.get(p).slots.find((x: any) => x.nome === s.nome)?.efeitos;
          if (!ligado(e)) {
            guardados = [];
            continue;
          }
          guardados.push(p);
          const corte = p - Math.min(Math.floor(e[COPIAS]), 16) * e[INTERVALO];
          while (guardados.length > 1 && guardados[1] <= corte) guardados.shift();
        }
        const c = Math.min(Math.floor(ef[COPIAS]), 16);
        if (guardados.length >= 2)
          for (let k = c; k >= 1; k--) {
            const alvo = t - k * ef[INTERVALO];
            const p = [...guardados].reverse().find((x) => x <= alvo + 1e-9);
            if (p === undefined) continue;
            const xy = em.get(p).vertices[s.nome];
            if (!xy || xy.length !== cur.length) continue;
            esperado.push([Math.fround((ef[ALFA] * (c - k + 1)) / c), ...xy]);
          }
      }
      const saiu: number[][] = agora.rastros?.[s.nome] ?? [];
      conferidos++;
      copiasVistas += esperado.length;
      let dif = esperado.length === saiu.length ? 0 : Infinity;
      for (let c = 0; c < esperado.length && dif < Infinity; c++) {
        if (esperado[c].length !== saiu[c].length) dif = Infinity;
        else for (let k = 0; k < esperado[c].length; k++) dif = Math.max(dif, Math.abs(esperado[c][k] - saiu[c][k]));
      }
      if (!(dif <= 1e-6)) {
        falhas++;
        console.log(`FALHA ${anim} t=${t} ${s.nome}: ${esperado.length} copias esperadas, nucleo ${saiu.length} (diferenca ${dif})`);
      }
    }
  }
}
console.log(falhas ? `${falhas} de ${conferidos} slots x instantes com rastro diferente` : `rastro igual (${conferidos} slots x instantes, ${copiasVistas} copias)`);
process.exit(falhas ? 1 : 0);
