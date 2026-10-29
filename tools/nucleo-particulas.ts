// Confere as particulas do nucleo (docs/NUCLEO.md "Particulas"), que o oraculo nao tem: refaz a
// simulacao pela especificacao, com os ossos do oraculo, nos mesmos passos do nucleo-pose (o
// instante 0 com dt = 0, depois passos de 1/64 s e o resto), e compara cada particula viva.
// So para personagens sem fisica (os ossos do oraculo nao dependem dos passos).
//
//   npx tsx tools/nucleo-particulas.ts [tests/nucleo/particulas/particulas.boneco] [--nucleo nucleo/build/nucleo-pose]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { oraculo } from "./oraculo.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
const arq = resolve(args[0] ?? "tests/nucleo/particulas/particulas.boneco");
const b = JSON.parse(readFileSync(arq, "utf8"));
const f32 = (x: number) => Math.fround(x);
const GRAU = Math.PI / 180;

// o hash dos efeitos, de 0 a 1
function sorteio(i: number, j: number) {
  let x = (Math.imul(i >>> 0, 1664525) + Math.imul(j >>> 0, 1013904223)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967295;
}

const par = (v: any, d: [number, number]): [number, number] => (Array.isArray(v) ? [v[0] ?? d[0], v[1] ?? d[1]] : v === undefined ? d : [v, v]);
const emissores = (b.particulas ?? []).map((e: any) => {
  const slot = b.slots.find((s: any) => s.nome === e.slot);
  return {
    nome: e.nome,
    osso: e.osso ?? slot.osso,
    x: e.x ?? 0,
    y: e.y ?? 0,
    taxa: Math.max(e.taxa ?? 10, 0),
    vida: par(e.vida, [1, 1]),
    vel: par(e.velocidade, [100, 100]),
    giro: par(e.giro, [0, 0]),
    angulo: e.angulo ?? 90,
    abertura: e.abertura ?? 30,
    gravidade: e.gravidade ?? 0,
    arrasto: e.arrasto ?? 0,
    maximo: e.maximo ?? 200,
    semente: e.semente ?? 0,
  };
});

// a taxa da animacao no tempo t (chaves lineares ou degrau)
function taxaEm(anim: string, nome: string, setup: number, t: number) {
  const ks: any[] = b.animacoes[anim]?.particulas?.[nome]?.taxa ?? [];
  if (!ks.length || t < f32(ks[0].tempo ?? 0)) return setup;
  let k = ks.length - 1;
  while (k > 0 && f32(ks[k].tempo ?? 0) > t) k--;
  const v0 = f32(ks[k].valor ?? setup);
  if (k === ks.length - 1 || ks[k].curva === "degrau") return Math.max(v0, 0);
  const t0 = f32(ks[k].tempo ?? 0),
    t1 = f32(ks[k + 1].tempo ?? 0),
    v1 = f32(ks[k + 1].valor ?? setup);
  return Math.max(v0 + ((v1 - v0) * (t - t0)) / (t1 - t0), 0);
}

function simula(anim: string, t: number) {
  // os passos do nucleo-pose
  const passos: [number, number][] = [[0, 0]];
  let acc = 0;
  while (acc < t) {
    const dt = Math.min(1 / 64, t - acc);
    acc += dt;
    if (t - acc < 1e-12) acc = t;
    passos.push([acc, dt]);
  }
  const ossos = oraculo(b, anim, passos.map(([a]) => a)).quadros.map((q: any) => q.ossos);
  const st = emissores.map(() => ({ acumulado: 0, nascidas: 0, pendentes: 0, vivas: [] as any[] }));
  let ultimo = -1;
  passos.forEach(([a, dt], n) => {
    emissores.forEach((d: any, ie: number) => {
      const e = st[ie];
      for (const k of b.animacoes[anim]?.particulas?.[d.nome]?.rajada ?? []) {
        const tk = f32(k.tempo ?? 0);
        if (n > 0 && a === ultimo) continue;
        if (tk > ultimo && tk <= a) e.pendentes += k.quantidade ?? 1;
      }
      const taxa = taxaEm(anim, d.nome, d.taxa, a);
      if (dt > 0) {
        const arr = Math.exp(-d.arrasto * dt);
        e.vivas = e.vivas.filter((p: any) => {
          p.idade += dt;
          if (p.idade >= p.vida) return false;
          p.vx *= arr;
          p.vy = p.vy * arr - d.gravidade * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.giro * dt;
          return true;
        });
      }
      e.acumulado += taxa * dt;
      let nascem = Math.floor(e.acumulado);
      e.acumulado -= nascem;
      nascem += e.pendentes;
      e.pendentes = 0;
      const w = ossos[n][d.osso];
      for (let k = 0; k < nascem; k++) {
        const idx = e.nascidas++;
        if (e.vivas.length >= d.maximo) continue;
        const j = d.semente * 8;
        const [sv, sl, sd, sg] = [0, 1, 2, 3].map((c) => sorteio(idx, j + c));
        const ang = (d.angulo + (sd - 0.5) * d.abertura) * GRAU;
        let dx = w[0] * Math.cos(ang) + w[1] * Math.sin(ang),
          dy = w[2] * Math.cos(ang) + w[3] * Math.sin(ang);
        const len = Math.hypot(dx, dy);
        if (len > 1e-9) (dx /= len), (dy /= len);
        const vel = d.vel[0] + (d.vel[1] - d.vel[0]) * sl;
        e.vivas.push({ x: w[0] * d.x + w[1] * d.y + w[4], y: w[2] * d.x + w[3] * d.y + w[5], vx: dx * vel, vy: dy * vel, rot: 0, giro: d.giro[0] + (d.giro[1] - d.giro[0]) * sg, idade: 0, vida: d.vida[0] + (d.vida[1] - d.vida[0]) * sv });
      }
    });
    ultimo = a;
  });
  return st;
}

let falhas = 0,
  conferidas = 0;
for (const anim of Object.keys(b.animacoes ?? {})) {
  const ts = [0.05, 0.2, 0.45, 0.7, 1.1];
  const r = spawnSync(bin, [arq, anim, ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  const quadros = JSON.parse(r.stdout).quadros;
  ts.forEach((t, q) => {
    const ref = simula(anim, t);
    emissores.forEach((d: any, ie: number) => {
      const nos: number[][] = quadros[q].particulas?.[d.nome] ?? [];
      const esp = ref[ie].vivas;
      let pior = 0;
      if (nos.length !== esp.length) pior = Infinity;
      else esp.forEach((p: any, k: number) => (pior = Math.max(pior, Math.hypot(p.x - nos[k][0], p.y - nos[k][1]), Math.abs(p.rot - nos[k][2]), Math.abs(p.idade - nos[k][3]))));
      conferidas += esp.length;
      if (!(pior <= 1e-4)) {
        falhas++;
        console.log(`FALHA ${anim} t=${t} ${d.nome}: ${esp.length} esperadas, ${nos.length} no nucleo, pior diferenca ${pior}`);
      }
    });
  });
}
console.log(falhas ? `${falhas} conferencias falharam` : `particulas iguais (${conferidas} particulas conferidas)`);
process.exit(falhas ? 1 : 0);
