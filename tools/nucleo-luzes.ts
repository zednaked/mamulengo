// Confere as luzes do nucleo (docs/NUCLEO.md "Luzes") pela especificacao: le as luzes, a ambiente
// e as timelines delas de um .boneco, calcula os canais em varios instantes por conta propria
// (chaves lineares ou degrau; campo que falta herda da chave anterior; limites), poe cada luz em
// mundo pela matriz do osso dela (a do nucleo-pose) e compara com o grupo que o desenho do nucleo
// monta: a ambiente (cor x alfa x forca), so as luzes acesas (forca, raio e alfa > 0), na ordem
// do arquivo, ate 8, e cada uma com x, y, altura, cor x alfa x forca, raio e profundidade.
//
//   npx tsx tools/nucleo-luzes.ts [tests/nucleo/luzes/luzes.boneco] [--nucleo nucleo/build/nucleo-pose]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
const arq = resolve(args[0] ?? "tests/nucleo/luzes/luzes.boneco");
const b = JSON.parse(readFileSync(arq, "utf8"));

const LUZ: [string, number[]][] = [["cor", [1, 1, 1, 1]], ["forca", [1]], ["raio", [300]], ["altura", [80]], ["profundidade", [0]]];
const AMB: [string, number[]][] = [["cor", [1, 1, 1, 1]], ["forca", [1]]];
const hex = (s: string) => [0, 2, 4, 6].map((k) => (s.length > k ? parseInt(s.slice(k, k + 2), 16) / 255 : 1));
const f32 = Math.fround;
const canais = (campos: [string, number[]][], j: any, antes: number[]) => {
  const v = [...antes];
  let c = 0;
  for (const [nome, padrao] of campos) {
    if (j?.[nome] !== undefined) (nome === "cor" ? hex(j[nome]) : [j[nome]]).forEach((y, k) => (v[c + k] = y));
    c += padrao.length;
  }
  return v.map(f32);
};
const limita = (v: number[]) => v.map((x, k) => (k < 4 ? Math.min(1, Math.max(0, x)) : k < 6 ? Math.max(0, x) : x));
const padrao = (campos: [string, number[]][]) => campos.flatMap(([, p]) => p);
// o valor de uma timeline em t, partindo do setup
const naTimeline = (campos: [string, number[]][], setup: number[], chaves: any[] | undefined, t: number) => {
  if (!chaves?.length) return setup;
  let antes = setup;
  const ks = chaves.map((k) => (antes = canais(campos, k, antes)));
  const tk = chaves.map((k) => f32(k.tempo ?? 0));
  if (t < tk[0]) return setup;
  let k = tk.length - 1;
  while (k > 0 && tk[k] > t) k--;
  if (k === tk.length - 1 || chaves[k].curva === "degrau") return limita(ks[k]);
  return limita(ks[k].map((x, c) => x + ((ks[k + 1][c] - x) * (t - tk[k])) / (tk[k + 1] - tk[k])));
};

let falhas = 0,
  conferidos = 0;
const relevo = (b.paginas ?? []).some((p: any) => p.relevo);
for (const [anim, a] of Object.entries<any>(b.animacoes ?? { "-": {} })) {
  const dur = Math.max(0.5, ...Object.values<any>(a.luzes ?? {}).flatMap((ks: any[]) => ks.map((k) => k.tempo ?? 0)), ...(a.ambiente ?? []).map((k: any) => k.tempo ?? 0));
  const ts = Array.from({ length: 13 }, (_, k) => Math.round(((dur * k) / 12) * 1e4) / 1e4);
  const r = spawnSync(bin, [arq, anim, ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  const quadros = JSON.parse(r.stdout).quadros;
  // o nucleo-pose toca em laco: o tempo dentro da animacao (a duracao e a ultima chave de todas)
  const tempos: number[] = [];
  const junta = (o: any) => (Array.isArray(o) ? o.forEach(junta) : o && typeof o === "object" ? (typeof o.tempo === "number" && tempos.push(o.tempo), Object.values(o).forEach(junta)) : 0);
  junta(a);
  const duracao = Math.max(0, ...tempos.map(f32));
  ts.forEach((t0, q) => {
    const t = duracao > 0 ? t0 - duracao * Math.floor(t0 / duracao) : t0;
    const ambSetup = limita(canais(AMB, b.ambiente, padrao(AMB)));
    const am = naTimeline(AMB, ambSetup, a.ambiente, t);
    const pontos: number[][] = [];
    for (const l of b.luzes ?? []) {
      const setup = limita(canais(LUZ, l, padrao(LUZ)));
      const v = naTimeline(LUZ, setup, a.luzes?.[l.nome], t);
      if (!(v[4] > 0 && v[5] > 0 && v[3] > 0) || pontos.length >= 8) continue;
      const [ma, mb, mc, md, mx, my] = quadros[q].ossos[l.osso ?? b.ossos[0].nome];
      const [lx, ly] = [l.x ?? 0, l.y ?? 0];
      pontos.push([ma * lx + mb * ly + mx, mc * lx + md * ly + my, v[6], v[0] * v[3] * v[4], v[1] * v[3] * v[4], v[2] * v[3] * v[4], v[5], v[7]]);
    }
    const ambiente = [0, 1, 2].map((c) => am[c] * am[3] * am[4]);
    const grupo = relevo && (pontos.length > 0 || ambiente.some((x) => Math.abs(x - 1) > 1e-7));
    const saiu = quadros[q].luzes;
    conferidos++;
    let dif = 0;
    if (!grupo || !saiu) dif = !grupo === !saiu ? 0 : Infinity;
    else {
      if (saiu.pontos.length !== pontos.length || !(saiu.lotes > 0)) dif = Infinity;
      else {
        ambiente.forEach((x, c) => (dif = Math.max(dif, Math.abs(x - saiu.ambiente[c]))));
        pontos.forEach((p, k) => p.forEach((x, c) => (dif = Math.max(dif, Math.abs(x - saiu.pontos[k][c]) / Math.max(1, Math.abs(x))))));
      }
    }
    if (!(dif <= 1e-5)) {
      falhas++;
      console.log(`FALHA ${anim} t=${t0}: esperado ${JSON.stringify({ ambiente, pontos })} | nucleo ${JSON.stringify(saiu)}`);
    }
  });
}
console.log(falhas ? `${falhas} de ${conferidos} instantes com luzes diferentes` : `luzes iguais (${conferidos} instantes)`);
process.exit(falhas ? 1 : 0);
