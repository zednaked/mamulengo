// Confere o .boneco binario (docs/FORMATO.md "Binario"): cada .boneco das pastas vira binario
// (nucleo-binario, que ja confere a arvore numero a numero) e o nucleo-pose tem de dar a mesma
// saida, byte a byte, com o texto e com o binario, em todas as animacoes e varios instantes.
// Escreve os tamanhos (cru, gzip e brotli) e o tempo de carga ate o modelo.
//
//   npx tsx tools/boneco-binario.ts [pastas...] [--nucleo nucleo/build]
//   (padrao: tests/boneco tests/nucleo exemplos)
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const build = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build");
const pastas = args.length ? args : ["tests/boneco", "tests/nucleo", "exemplos"];
const achar = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? achar(p) : n.endsWith(".boneco") ? [p] : [];
  });
const roda = (bin: string, a: string[]) => {
  const r = spawnSync(join(build, bin), a, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${bin} ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const kb = (n: number) => (n / 1024).toFixed(1);

const tmp = mkdtempSync(join(tmpdir(), "boneco-binario-"));
let falhas = 0;
const tot = { texto: 0, bin: 0, gz: [0, 0], br: [0, 0], ms: [0, 0] };
console.log("arquivo | texto KB | binario KB | gzip texto / binario | brotli texto / binario | carga ms texto / binario");
try {
  // todos em binario antes de comparar, nos mesmos caminhos relativos (o pai binario acha o
  // filho binario das instancias onde o texto acha o dele)
  const arquivos = pastas.flatMap(achar).sort();
  const binDe = (arq: string) => join(tmp, relative(process.cwd(), resolve(arq)));
  for (const arq of arquivos) {
    mkdirSync(dirname(binDe(arq)), { recursive: true });
    roda("nucleo-binario", [arq, binDe(arq)]);
  }
  for (const arq of arquivos) {
    const bin = binDe(arq);
    const [t, b] = [readFileSync(arq), readFileSync(bin)];
    // as animacoes e 7 instantes de cada, ate o fim da mais longa
    const j = JSON.parse(t.toString("utf8"));
    const anims = Object.keys(j.animacoes ?? {});
    const ts = [0, 0.1, 0.33, 0.5, 0.9, 1.7, 3.1].join(",");
    let iguais = true;
    for (const a of anims.length ? anims : ["-"]) {
      if (roda("nucleo-pose", [arq, a, ts]).replace(/"tempo_medio[^,}]*/g, "") !== roda("nucleo-pose", [bin, a, ts]).replace(/"tempo_medio[^,}]*/g, "")) iguais = false;
    }
    if (!iguais) {
      falhas++;
      console.log(`FALHA ${arq}: a pose com o binario difere`);
    }
    const gz = [gzipSync(t, { level: 9 }).length, gzipSync(b, { level: 9 }).length];
    const br = [t, b].map((x) => brotliCompressSync(x, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length);
    const ms = [arq, bin].map((x) => +roda("nucleo-binario", ["--medir", x, "20"]));
    tot.texto += t.length;
    tot.bin += b.length;
    gz.forEach((x, k) => (tot.gz[k] += x));
    br.forEach((x, k) => (tot.br[k] += x));
    ms.forEach((x, k) => (tot.ms[k] += x));
    console.log(`${arq} | ${kb(t.length)} | ${kb(b.length)} | ${kb(gz[0])} / ${kb(gz[1])} | ${kb(br[0])} / ${kb(br[1])} | ${ms[0].toFixed(2)} / ${ms[1].toFixed(2)}${iguais ? "" : " | POSE DIFERENTE"}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`total | ${kb(tot.texto)} | ${kb(tot.bin)} | ${kb(tot.gz[0])} / ${kb(tot.gz[1])} | ${kb(tot.br[0])} / ${kb(tot.br[1])} | ${tot.ms[0].toFixed(2)} / ${tot.ms[1].toFixed(2)}`);
console.log(falhas ? `${falhas} arquivos com a pose diferente no binario` : "binario igual ao texto (pose byte a byte)");
process.exit(falhas ? 1 : 0);
