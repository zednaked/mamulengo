// Confere os efeitos do nucleo (docs/NUCLEO.md "Efeitos"), que o oraculo nao tem: le as
// timelines de efeito de um .boneco, calcula os canais em varios instantes por conta propria
// (chaves lineares ou degrau; campo que falta herda da chave anterior; limites de cada canal)
// e compara com a saida do nucleo-pose.
//
//   npx tsx tools/nucleo-efeitos.ts [tests/nucleo/efeitos/efeitos.boneco] [--nucleo nucleo/build/nucleo-pose]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
const arq = resolve(args[0] ?? "tests/nucleo/efeitos/efeitos.boneco");
const b = JSON.parse(readFileSync(arq, "utf8"));

// os campos de cada efeito na ordem dos canais, com o padrao
const CAMPOS: Record<string, [string, number[]][]> = {
  linha: [["cor", [1, 1, 1, 1]], ["largura", [0]]],
  brilho: [["cor", [1, 1, 1, 1]], ["forca", [0]], ["raio", [8]]],
  dissolver: [["valor", [0]], ["cor", [1, 0.5, 0, 1]], ["borda", [0.05]], ["grao", [8]]],
  tingir: [["cor", [1, 1, 1, 1]], ["forca", [0]]],
  borrar: [["forca", [0]], ["limite", [60]], ["esmaecer", [0.5]]],
};
const INICIO: Record<string, number> = { linha: 0, brilho: 5, dissolver: 11, tingir: 18, borrar: 23 };
const SEM_TETO = new Set([4, 9, 10, 17, 23, 24]);
const hex = (s: string) => [0, 2, 4, 6].map((k) => (s.length > k ? parseInt(s.slice(k, k + 2), 16) / 255 : 1));
const canais = (ef: string, j: any, antes: number[]) => {
  const v = [...antes];
  let c = 0;
  for (const [nome, padrao] of CAMPOS[ef]) {
    if (j?.[nome] !== undefined) {
      const x = nome === "cor" ? hex(j[nome]) : [j[nome]];
      x.forEach((y, k) => (v[c + k] = y));
    }
    c += padrao.length;
  }
  return v;
};
const padrao = () => Object.values(CAMPOS).flatMap((cs) => cs.flatMap(([, p]) => p));
const limita = (v: number[]) => v.map((x, k) => Math.max(k === 17 ? 1 : 0, SEM_TETO.has(k) ? x : Math.min(1, x)));

let falhas = 0,
  conferidos = 0;
for (const [anim, a] of Object.entries<any>(b.animacoes ?? {})) {
  if (!a.efeitos) continue;
  const fim = Math.max(...Object.values<any>(a.efeitos).flatMap((efs: any) => Object.values<any>(efs).flatMap((ks: any[]) => ks.map((k) => k.tempo ?? 0))));
  const ts = Array.from({ length: 13 }, (_, k) => Math.round(((fim * k) / 12) * 1e4) / 1e4);
  const r = spawnSync(bin, [arq, anim, ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  const quadros = JSON.parse(r.stdout).quadros;
  ts.forEach((t, q) => {
    for (const s of b.slots) {
      // setup do slot
      let esp = padrao();
      for (const [ef, j] of Object.entries<any>(s.efeitos ?? {})) {
        const v = canais(ef, j, esp.slice(INICIO[ef], INICIO[ef] + CAMPOS[ef].reduce((n, [, p]) => n + p.length, 0)));
        v.forEach((x, k) => (esp[INICIO[ef] + k] = x));
      }
      esp = limita(esp);
      const setup = [...esp];
      for (const [ef, chaves] of Object.entries<any[]>(a.efeitos[s.nome] ?? {})) {
        const n = CAMPOS[ef].reduce((m, [, p]) => m + p.length, 0);
        let antes = setup.slice(INICIO[ef], INICIO[ef] + n);
        const ks = chaves.map((k) => (antes = canais(ef, k, antes)));
        const tk = chaves.map((k) => k.tempo ?? 0);
        let v: number[];
        if (t < tk[0]) v = setup.slice(INICIO[ef], INICIO[ef] + n);
        else {
          let k = tk.length - 1;
          while (k > 0 && tk[k] > t) k--;
          if (k === tk.length - 1 || chaves[k].curva === "degrau") v = ks[k];
          else v = ks[k].map((x, c) => x + ((ks[k + 1][c] - x) * (t - tk[k])) / (tk[k + 1] - tk[k]));
        }
        v.forEach((x, k) => (esp[INICIO[ef] + k] = x));
      }
      esp = limita(esp);
      const ligado = (esp[4] > 0 && esp[3] > 0) || (esp[9] > 0 && esp[8] > 0) || esp[11] > 0 || (esp[22] > 0 && esp[21] > 0) || (esp[23] > 0 && esp[24] > 0);
      const saiu = quadros[q].slots.find((x: any) => x.nome === s.nome)?.efeitos;
      conferidos++;
      if (!ligado && !saiu) continue;
      const dif = saiu ? Math.max(...esp.map((x, k) => Math.abs(x - saiu[k]))) : Infinity;
      if (!(dif <= 1e-4)) {
        falhas++;
        console.log(`FALHA ${anim} t=${t} ${s.nome}: esperado ${esp.map((x) => +x.toFixed(4)).join(",")} | nucleo ${saiu?.map((x: number) => +x.toFixed(4)).join(",") ?? "sem efeitos"}`);
      }
    }
  });
}
console.log(falhas ? `${falhas} de ${conferidos} slots x instantes com efeitos diferentes` : `efeitos iguais (${conferidos} slots x instantes)`);
process.exit(falhas ? 1 : 0);
