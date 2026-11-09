// Joga o palco de um .boneco (docs/PALCO.md) pelo nucleo em wasm, com entrada roteirizada, e mede:
// onde o jogador esta a cada trecho, as moedas, se venceu ou morreu. O agente confere a fase assim
// (o pulo alcanca a plataforma? o inimigo vira na beira?) sem abrir o editor.
//
//   npx tsx tools/palco.ts <x.boneco> --roteiro "direita 40, direita+pulo 30, nada 20" [--json]
//
// roteiro: trechos separados por virgula, cada um "teclas quadros" (teclas: esquerda, direita, pulo,
// juntas com +, ou nada); 60 quadros por segundo. O pulo vale na borda (apertar): segurado num
// trecho conta uma vez, e cada trecho com pulo aperta de novo.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PASSO_PALCO, passosDoRoteiro } from "../src/core/palco-roteiro.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const roteiro = opt("roteiro", "nada 60");
const nucleo = opt("nucleo", "nucleo/build-web/nucleo.mjs");
const comoJson = args.includes("--json") && (args.splice(args.indexOf("--json"), 1), true);
const arq = args[0] && resolve(args[0]);
if (!arq) {
  console.error('uso: tools/palco.ts <x.boneco> --roteiro "direita 40, direita+pulo 30" [--json]');
  process.exit(2);
}

const N = await (await import(pathToFileURL(resolve(nucleo)).href)).default();
const comTexto = <T>(s: string, f: (p: number) => T): T => {
  const p = N.stringToNewUTF8(s);
  try {
    return f(p);
  } finally {
    N._free(p);
  }
};
// os filhos das instancias, de arquivo em arquivo
const vistos = new Set<string>();
function registrar(caminho: string) {
  if (vistos.has(caminho)) return;
  vistos.add(caminho);
  const texto = readFileSync(caminho, "utf8");
  comTexto(caminho, (c) => comTexto(texto, (t) => N._mm_arquivo(c, t)));
  try {
    for (const x of JSON.parse(texto).instancias ?? []) registrar(resolve(dirname(caminho), x.boneco));
  } catch {}
}
registrar(arq);
const m = comTexto(readFileSync(arq, "utf8"), (t) => comTexto(arq, (c) => N._mm_carregar_de(t, c)));
if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
const inst = N._mm_instancia(m);
if (!N._mm_palco(inst)) throw new Error("este .boneco nao tem palco");
const estado = () => JSON.parse(N.UTF8ToString(N._mm_palco_estado(inst)));

const linhas: any[] = [];
const jogadorDe = (e: any) => e.atores[0];
const { bits, fins, trechos } = passosDoRoteiro(roteiro);
let feito = 0;
fins.forEach((fim, k) => {
  for (; feito <= fim; feito++) N._mm_palco_passo(inst, bits[feito], 1, PASSO_PALCO);
  linhas.push({ trecho: trechos[k].texto, ...estado() });
});
const fim = linhas[linhas.length - 1];
if (comoJson) console.log(JSON.stringify(linhas));
else {
  for (const l of linhas) {
    const j = jogadorDe(l);
    console.log(`${l.trecho.padEnd(22)} t ${(l.tick / 60).toFixed(2)}s  ${j.nome} x ${j.x} y ${j.y} ${j.estado}${j.chao ? " no chao" : ""}  pontos ${l.pontos}${l.venceu ? "  VENCEU" : ""}${l.morreu ? "  MORREU" : ""}`);
  }
  console.log("atores no fim:", fim.atores.map((a: any) => `${a.nome}${a.vivo ? "" : " (fora)"} ${a.x},${a.y}`).join("; "));
}
