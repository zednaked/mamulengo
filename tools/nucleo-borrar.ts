// Confere o borrar do nucleo (docs/NUCLEO.md "Borrar") pela especificacao: para cada instante, os
// vertices do slot nele e no passo anterior do nucleo-pose (o mesmo passo de 1/64 s que ele usa),
// os canais do borrar naquele instante, e a conta refeita aqui; compara com os "borrados" que o
// nucleo-pose escreve (vertices esticados e quanto o alfa cai).
//
//   npx tsx tools/nucleo-borrar.ts [tests/nucleo/borrar/borrar.boneco] [--nucleo nucleo/build/nucleo-pose]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
const arq = resolve(args[0] ?? "tests/nucleo/borrar/borrar.boneco");
const b = JSON.parse(readFileSync(arq, "utf8"));
const FORCA = 23, LIMITE = 24, ESMAECER = 25;

// o instante do passo anterior do nucleo-pose: 0, 1/64, 2/64... e o resto ate t
const anterior = (t: number) => {
  const passo = 1 / 64;
  let acc = 0,
    ant = -1;
  for (;;) {
    if (acc >= t) return ant;
    ant = acc;
    const dt = Math.min(passo, t - acc);
    acc += dt;
    if (t - acc < 1e-12) acc = t;
  }
};
const posar = (anim: string, ts: number[]) => {
  const r = spawnSync(bin, [arq, anim, ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout).quadros;
};

// a conta da especificacao: null quando nao borra
function borrar(cur: number[], ant: number[] | undefined, dt: number, ef: number[]) {
  const [forca, limite, esm] = [ef[FORCA], ef[LIMITE], ef[ESMAECER]];
  if (!(forca > 0 && limite > 0) || !ant || ant.length !== cur.length || cur.length < 2 || !(dt > 0) || dt > 0.25) return null;
  const n = cur.length / 2;
  const d: number[] = [];
  let mx = 0,
    my = 0,
    cx = 0,
    cy = 0;
  for (let k = 0; k < n; k++) {
    let dx = ((cur[k * 2] - ant[k * 2]) / dt) * forca,
      dy = ((cur[k * 2 + 1] - ant[k * 2 + 1]) / dt) * forca;
    const l = Math.hypot(dx, dy);
    if (l > limite) (dx *= limite / l), (dy *= limite / l);
    d.push(dx, dy);
    (mx += dx), (my += dy), (cx += cur[k * 2]), (cy += cur[k * 2 + 1]);
  }
  const ml = Math.hypot(mx, my);
  if (ml < 1e-9) return null;
  const [ux, uy] = [mx / ml, my / ml];
  (cx /= n), (cy /= n);
  const tras = (k: number) => -((cur[k * 2] - cx) * ux + (cur[k * 2 + 1] - cy) * uy);
  let atras = 0;
  for (let k = 0; k < n; k++) atras = Math.max(atras, tras(k));
  if (!(atras > 0)) return null;
  const xy = [...cur],
    cai: number[] = [];
  for (let k = 0; k < n; k++) {
    const w = Math.min(1, Math.max(0, tras(k) / atras));
    xy[k * 2] -= w * d[k * 2];
    xy[k * 2 + 1] -= w * d[k * 2 + 1];
    cai.push(esm * w * Math.min(1, Math.hypot(d[k * 2], d[k * 2 + 1]) / limite));
  }
  return [...xy, ...cai];
}

let falhas = 0,
  conferidos = 0,
  borrados = 0;
for (const anim of Object.keys(b.animacoes ?? {})) {
  const ts = Array.from({ length: 31 }, (_, k) => Math.round(k * 0.0173 * 1e4) / 1e4);
  const ants = ts.map(anterior);
  const quadros = posar(anim, ts);
  const qAnt = posar(anim, ants.map((t) => Math.max(t, 0)));
  ts.forEach((t, q) => {
    for (const s of b.slots) {
      const ef = quadros[q].slots.find((x: any) => x.nome === s.nome)?.efeitos;
      const cur = quadros[q].vertices[s.nome];
      if (!ef || !cur) continue;
      // o anterior so existe se o borrar ja estava ligado no passo anterior
      const efAnt = qAnt[q].slots.find((x: any) => x.nome === s.nome)?.efeitos;
      const ligadoAnt = efAnt && efAnt[FORCA] > 0 && efAnt[LIMITE] > 0;
      const esperado = ants[q] < 0 || !ligadoAnt ? null : borrar(cur, qAnt[q].vertices[s.nome], t - ants[q], ef);
      const saiu = quadros[q].borrados?.[s.nome] ?? null;
      conferidos++;
      if (esperado) borrados++;
      const dif = esperado && saiu && esperado.length === saiu.length ? Math.max(...esperado.map((x, k) => Math.abs(x - saiu[k]))) : esperado || saiu ? Infinity : 0;
      if (!(dif <= 1e-4)) {
        falhas++;
        console.log(`FALHA ${anim} t=${t} ${s.nome}: ${esperado ? "esperado borrar" : "esperado nada"}, nucleo ${saiu ? "borrou" : "nada"} (diferenca ${dif})`);
      }
    }
  });
}
console.log(falhas ? `${falhas} de ${conferidos} slots x instantes com borrar diferente` : `borrar igual (${conferidos} slots x instantes, ${borrados} esticados)`);
process.exit(falhas ? 1 : 0);
