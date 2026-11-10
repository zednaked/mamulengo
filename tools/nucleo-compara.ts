// Compara o nucleo novo (nucleo-pose, docs/NUCLEO.md) com o oraculo (tools/oraculo.ts) em
// todas as animacoes de um ou mais .boneco: ossos, vertices, partes, cores e ordem de desenho.
//
//   npx tsx tools/nucleo-compara.ts <x.boneco | pasta> ... [--fps 30] [--nucleo nucleo/build/nucleo-pose] [--anim nome]
//
// Tolerancia (aceitacao do docs/FORMATO.md): posicao de osso e vertice ate 0,01 px, matriz
// ate 1e-4, cor ate 1/255, partes e ordem de desenho iguais. Sai com codigo 1 se algo passar.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { oraculo, tempos } from "./oraculo.ts";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return d;
  return args.splice(i, 2)[1];
};
const fps = opt("fps", "30")!;
const bin = resolve(opt("nucleo", "nucleo/build/nucleo-pose")!);
const so = opt("anim");
const arquivos = args.flatMap((a) => (statSync(a).isDirectory() ? readdirSync(a, { recursive: true }).map(String).filter((f) => f.endsWith(".boneco")).map((f) => join(a, f)) : [a]));

const TOL = { pos: 0.01, mat: 1e-4, cor: 1 / 255 };
let falhas = 0;
const linhas: string[] = ["| arquivo | animação | quadros | osso (px) | matriz | vértice (px) | cor | partes | ordem | |", "|---|---|---|---|---|---|---|---|---|---|"];
for (const arq of arquivos.sort()) {
  const b = JSON.parse(readFileSync(arq, "utf8"));
  // partes de texto (docs/NUCLEO.md "Texto") nao existem no Spine: o oraculo as ve vazias. Elas tem a
  // conferencia propria (tools/nucleo-texto.ts); aqui so nao contam como parte diferente.
  const textos = new Set<string>();
  for (const sk of b.skins ?? []) for (const [slot, ps] of Object.entries<any>(sk.partes ?? {})) for (const [nomeP, p] of Object.entries<any>(ps)) if (p?.tipo === "texto") textos.add(`${slot}/${nomeP}`);
  // nove-fatias (docs/NUCLEO.md "Nove-fatias"): o Spine desenha a regiao inteira; no tamanho base (sem
  // janela e sem texto que a acompanhe, como aqui) os 4 cantos de fora da grade do nucleo sao os dela.
  // A grade (nx x ny pontos, do setup) e o resto tem conferencia propria (tools/nucleo-fatias.ts)
  // (so as de caixa do tamanho da imagem: a caixa maior, o Spine nao tem)
  const grades: Record<string, { nx: number; ny: number }> = {};
  const caixaPropria = new Set<string>();
  for (const sk of b.skins ?? []) for (const [slot, ps] of Object.entries<any>(sk.partes ?? {})) for (const p of Object.values<any>(ps)) if ((p?.fatias?.largura ?? p?.largura) !== p?.largura || (p?.fatias?.altura ?? p?.altura) !== p?.altura) caixaPropria.add(slot);
  if (JSON.stringify(b.skins ?? []).includes('"fatias"')) {
    const r = spawnSync(bin, [resolve(arq), "-", "0", "--fatias"], { encoding: "utf8" });
    const f = /^fatias (.*)$/m.exec(r.stderr ?? "");
    if (f) for (const [slot, g] of Object.entries<any>(JSON.parse(f[1]))) grades[slot] = { nx: g.nx, ny: g.ny };
  }
  for (const anim of [null, ...Object.keys(b.animacoes ?? {})]) {
    if (so && anim !== so) continue;
    const ts = tempos(b, anim, anim ? `fps:${fps}` : "0");
    const ref = oraculo(b, anim, ts);
    const r = spawnSync(bin, [resolve(arq), anim ?? "-", ts.join(",")], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    const nome = arq.split("/").pop();
    if (r.status !== 0 || !r.stdout) {
      falhas++;
      linhas.push(`| ${nome} | ${anim ?? "setup"} | ${ts.length} | | | | | | | ERRO: ${(r.stderr || r.error?.message || "sem saida").trim().split("\n")[0].slice(0, 120)} |`);
      continue;
    }
    const nos = JSON.parse(r.stdout);
    let pos = 0,
      mat = 0,
      vert = 0,
      cor = 0,
      partes = 0,
      ordem = 0,
      faltam = 0;
    ref.quadros.forEach((q: any, i: number) => {
      const n = nos.quadros?.[i];
      if (!n) return faltam++;
      for (const [o, m] of Object.entries<number[]>(q.ossos)) {
        const k = n.ossos?.[o];
        if (!k) {
          faltam++;
          continue;
        }
        pos = Math.max(pos, Math.hypot(m[4] - k[4], m[5] - k[5]));
        for (let j = 0; j < 4; j++) mat = Math.max(mat, Math.abs(m[j] - k[j]));
      }
      if (q.slots.map((s: any) => s.nome).join() !== (n.slots ?? []).map((s: any) => s.nome).join()) ordem++;
      for (const s of q.slots) {
        const k = (n.slots ?? []).find((x: any) => x.nome === s.nome);
        if (!k) continue;
        const soTexto = s.parte == null && k.parte != null && textos.has(`${s.nome}/${k.parte}`);
        if (!soTexto && (s.parte ?? null) !== (k.parte ?? null)) partes++;
        for (let j = 0; j < 4; j++) cor = Math.max(cor, Math.abs(s.cor[j] - (k.cor?.[j] ?? 0)));
      }
      for (const [s, v] of Object.entries<number[]>(q.vertices)) {
        let k = n.vertices?.[s];
        const g = grades[s];
        if (k && g && v.length === 8 && k.length === g.nx * g.ny * 2) k = [0, (g.ny - 1) * g.nx, g.ny * g.nx - 1, g.nx - 1].flatMap((i) => [k[i * 2], k[i * 2 + 1]]);
        if (caixaPropria.has(s)) continue;
        if (!k || k.length !== v.length) {
          faltam++;
          continue;
        }
        for (let j = 0; j < v.length; j += 2) vert = Math.max(vert, Math.hypot(v[j] - k[j], v[j + 1] - k[j + 1]));
      }
    });
    const ok = pos <= TOL.pos && mat <= TOL.mat && vert <= TOL.pos && cor <= TOL.cor && !partes && !ordem && !faltam;
    if (!ok) falhas++;
    const f = (x: number) => (x === 0 ? "0" : x.toExponential(1));
    linhas.push(`| ${nome} | ${anim ?? "setup"} | ${ts.length} | ${f(pos)} | ${f(mat)} | ${f(vert)} | ${f(cor)} | ${partes} | ${ordem} | ${ok ? "ok" : `FALHA${faltam ? ` (faltam ${faltam})` : ""}`} |`);
  }
}
console.log(linhas.join("\n"));
console.log(`\n${falhas ? `${falhas} com diferenca acima da tolerancia` : "tudo dentro da tolerancia"}`);
process.exit(falhas ? 1 : 0);
