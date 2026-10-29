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
import { exportarSpine } from "../src/boneco/spine.ts";
import { animDuration } from "../src/core/ficha.ts";

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
const raios = (b.particulas ?? []).filter((e: any) => e.tipo === "raio");
const orbitas = (b.particulas ?? []).filter((e: any) => e.tipo === "orbita");
const emissores = (b.particulas ?? []).filter((e: any) => e.tipo !== "raio" && e.tipo !== "orbita").map((e: any) => {
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

// a duracao como o nucleo a conta: a ultima chave de qualquer timeline, inclusive particulas
function duracao(anim: string) {
  const a = b.animacoes[anim];
  const ps = Object.values<any>(a?.particulas ?? {}).flatMap((tls: any) => Object.values<any>(tls).flatMap((ks: any[]) => ks.map((k) => f32(k.tempo ?? 0))));
  return f32(Math.max(animDuration(exportarSpine(b).json.animations?.[anim]), ...ps, 0));
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
  const dur0 = duracao(anim);
  const ossos = oraculo(b, anim, passos.map(([a]) => (dur0 > 0 ? a % dur0 : a))).quadros.map((q: any) => q.ossos);
  const st = emissores.map(() => ({ acumulado: 0, nascidas: 0, pendentes: 0, vivas: [] as any[] }));
  let ultimo = -1;
  // a animacao toca em laco (o nucleo-pose aplica com loop): o tempo dela da a volta
  const dur = duracao(anim);
  passos.forEach(([a, dt], n) => {
    const ta = dur > 0 ? a % dur : a;
    emissores.forEach((d: any, ie: number) => {
      const e = st[ie];
      for (const k of b.animacoes[anim]?.particulas?.[d.nome]?.rajada ?? []) {
        const tk = f32(k.tempo ?? 0);
        if (n > 0 && ta === ultimo) continue;
        // como o aplicar do nucleo: em laco, a volta pega as chaves depois do ultimo e ate agora
        const passou = ta >= ultimo ? tk > ultimo && tk <= ta : tk > ultimo || tk <= ta;
        if (passou) e.pendentes += k.quantidade ?? 1;
      }
      const taxa = taxaEm(anim, d.nome, d.taxa, ta);
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
    ultimo = ta;
  });
  return st;
}

let falhas = 0,
  conferidas = 0;
for (const anim of Object.keys(b.animacoes ?? {})) {
  const ts = process.env.TEMPOS ? process.env.TEMPOS.split(",").map(Number) : [0.05, 0.2, 0.45, 0.7, 1.1, 2.6, 3.2, 6.6, 7.1];
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
      if (!(pior <= 1e-3)) {
        falhas++;
        console.log(`FALHA ${anim} t=${t} ${d.nome}: ${esp.length} esperadas, ${nos.length} no nucleo, pior diferenca ${pior}${process.env.TEMPOS ? ` idades esperadas ${[...new Set(esp.map((p: any) => p.idade.toFixed(2)))].join(",")}` : ""}`);
      }
    });
  });
}
// raios (docs/NUCLEO.md "Raio"): as linhas no instante, pela especificacao
let linhasConf = 0;
function linhasRaio(d: any, w: number[], we: number[] | null, relogio: number) {
  const S = [w[0] * (d.x ?? 0) + w[1] * (d.y ?? 0) + w[4], w[2] * (d.x ?? 0) + w[3] * (d.y ?? 0) + w[5]];
  let E: number[];
  if (we) E = [we[0] * (d.ate_x ?? 0) + we[1] * (d.ate_y ?? 0) + we[4], we[2] * (d.ate_x ?? 0) + we[3] * (d.ate_y ?? 0) + we[5]];
  else {
    const g = (d.angulo ?? 0) * GRAU;
    let ux = w[0] * Math.cos(g) + w[1] * Math.sin(g),
      uy = w[2] * Math.cos(g) + w[3] * Math.sin(g);
    const ul = Math.hypot(ux, uy);
    if (ul > 1e-9) (ux /= ul), (uy /= ul);
    E = [S[0] + ux * (d.comprimento ?? 100), S[1] + uy * (d.comprimento ?? 100)];
  }
  const seg = Math.max(2, d.segmentos ?? 10),
    desvio = d.desvio ?? 0.15,
    troca = Math.max(0.001, d.troca ?? 0.06);
  const g = Math.floor(relogio / troca) >>> 0,
    j = ((d.semente ?? 0) * 8 + 5) >>> 0;
  const out: number[][] = [];
  const quebrada = (A: number[], B: number[], n: number, dv: number, i0: number) => {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nx = L > 1e-9 ? -(B[1] - A[1]) / L : 0,
      ny = L > 1e-9 ? (B[0] - A[0]) / L : 0;
    const ln = [A[0], A[1]];
    for (let i = 1; i < n; i++) {
      const f = i / n,
        sx = sorteio((Math.imul(g, 64) + i0 + i) >>> 0, j);
      const off = L * dv * (2 * sx - 1) * Math.sin(Math.PI * f);
      ln.push(A[0] + (B[0] - A[0]) * f + nx * off, A[1] + (B[1] - A[1]) * f + ny * off);
    }
    ln.push(B[0], B[1]);
    out.push(ln);
  };
  quebrada(S, E, seg, desvio, 0);
  const L = Math.hypot(E[0] - S[0], E[1] - S[1]),
    dir = Math.atan2(E[1] - S[1], E[0] - S[0]);
  for (let r = 0; r < (d.ramos ?? 2) && seg > 2; r++) {
    const b0 = (Math.imul(g, 64) + 40 + r * 4) >>> 0;
    const s1 = sorteio(b0 + 1, j),
      s2 = sorteio(b0 + 2, j),
      s3 = sorteio(b0 + 3, j);
    const k = 1 + Math.floor(s1 * (seg - 2));
    const A = [out[0][k * 2], out[0][k * 2 + 1]];
    const ang = dir + ((s2 - 0.5) * Math.PI) / 2,
      comp = L * (0.25 + 0.25 * s3);
    quebrada(A, [A[0] + Math.cos(ang) * comp, A[1] + Math.sin(ang) * comp], Math.max(2, Math.floor(seg / 2)), desvio / 2, 20 + r * 16);
  }
  return out;
}
for (const anim of Object.keys(b.animacoes ?? {})) {
  if (!raios.length && !orbitas.length) break;
  const ts = [0.05, 1.1, 6.6, 7.1];
  const r = spawnSync(bin, [arq, anim, ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  const quadros = JSON.parse(r.stdout).quadros;
  const ossos = oraculo(b, anim, ts).quadros.map((q: any) => q.ossos);
  ts.forEach((t, q) => {
    // o relogio do nucleo-pose: a soma dos passos (0, depois 1/64 ate t)
    let acc = 0,
      rel = 0;
    while (acc < t) {
      const dt = Math.min(1 / 64, t - acc);
      acc += dt;
      if (t - acc < 1e-12) acc = t;
      rel += dt;
    }
    // orbitas (docs/NUCLEO.md "Orbita"): x, y, z, escala, giro por particula
    for (const d of orbitas) {
      const w = ossos[q][d.osso ?? b.slots.find((s: any) => s.nome === d.slot).osso];
      const cx = w[0] * (d.x ?? 0) + w[1] * (d.y ?? 0) + w[4],
        cy = w[2] * (d.x ?? 0) + w[3] * (d.y ?? 0) + w[5];
      const inc = (d.inclinacao ?? 0) * GRAU;
      const [rx, ry] = par(d.raios, [80, 20]);
      const volta = d.volta || 2,
        n = d.quantidade ?? 8,
        faixa = d.faixa ?? 0,
        prof = d.profundidade ?? 0.35;
      const esc0 = par(d.escala, [1, 1])[0],
        giro = par(d.giro, [0, 0]);
      const j6 = ((d.semente ?? 0) * 8 + 6) >>> 0,
        j7 = ((d.semente ?? 0) * 8 + 7) >>> 0;
      const esp: number[] = [];
      for (let k = 0; k < n; k++) {
        const s0 = sorteio(k, j6),
          s1 = sorteio(k, j7),
          s2 = sorteio(k + 1000, j6);
        const th = 2 * Math.PI * (rel / volta + k / n + (0.3 * (s0 - 0.5)) / n);
        const z = Math.sin(th);
        const px = rx * Math.cos(th),
          py = -ry * z + faixa * (2 * s1 - 1);
        esp.push(cx + px * Math.cos(inc) - py * Math.sin(inc), cy + px * Math.sin(inc) + py * Math.cos(inc), z, esc0 * (0.85 + 0.3 * s2) * (1 + prof * z), (giro[0] + (giro[1] - giro[0]) * s2) * rel);
      }
      const nos: number[] = quadros[q].orbitas?.[d.nome] ?? [];
      let pior = esp.length === nos.length ? 0 : Infinity;
      esp.forEach((v, i) => (pior = Math.max(pior, Math.abs(v - nos[i]))));
      linhasConf += n;
      if (!(pior <= 1e-3)) {
        falhas++;
        console.log(`FALHA orbita ${d.nome} ${anim} t=${t}: pior ${pior}`);
      }
    }
    for (const d of raios) {
      const intens = Math.min(1, Math.max(0, taxaEm(anim, d.nome, d.taxa ?? 10, t)));
      const esp = intens > 0 ? linhasRaio(d, ossos[q][d.osso ?? b.slots.find((s: any) => s.nome === d.slot).osso], d.ate ? ossos[q][d.ate] : null, rel) : [];
      const nos: number[][] = quadros[q].raios?.[d.nome] ?? [];
      let pior = esp.length === nos.length ? 0 : Infinity;
      esp.forEach((ln, k) => ln.forEach((v, i) => (pior = Math.max(pior, Math.abs(v - (nos[k]?.[i] ?? NaN))))));
      linhasConf += esp.length;
      if (!(pior <= 1e-3)) {
        falhas++;
        console.log(`FALHA raio ${d.nome} ${anim} t=${t}: ${esp.length} linhas esperadas, ${nos.length} no nucleo, pior ${pior}`);
      }
    }
  });
}
console.log(falhas ? `${falhas} conferencias falharam` : `particulas iguais (${conferidas} particulas conferidas${raios.length || orbitas.length ? `, ${linhasConf} linhas de raio e particulas de orbita` : ""})`);
process.exit(falhas ? 1 : 0);
