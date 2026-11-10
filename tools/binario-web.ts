// .boneco texto -> binario (docs/FORMATO.md "Binario") pelo nucleo web (wasm), sem o nucleo-binario
// nativo: serve para empacotar o jogo numa maquina sem compilador (o CI). O mesmo codificador do
// nucleo (codificar_binario). Cada arquivo e conferido na volta: o binario lido de novo pelo nucleo
// tem de dar o mesmo documento que o texto (numero a numero); senao, erro.
//
//   npx tsx tools/binario-web.ts <entrada.boneco> <saida.boneco> [<entrada> <saida> ...] [--nucleo nucleo/build-web/nucleo.mjs]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export async function nucleoWeb(caminho?: string) {
  const padrao = resolve(dirname(fileURLToPath(import.meta.url)), "../nucleo/build-web/nucleo.mjs");
  return (await import(pathToFileURL(resolve(caminho ?? padrao)).href)).default();
}

// o texto de um .boneco em binario, conferido na volta
export function paraBinario(N: any, texto: string, nome = ""): Uint8Array {
  const p = N.stringToNewUTF8(texto);
  let bytes: Uint8Array;
  try {
    const n = N._mm_boneco_binario(p);
    if (n < 0) throw new Error(`${nome}: ${N.UTF8ToString(N._mm_erro())}`);
    bytes = N.HEAPU8.slice(N._mm_bytes(), N._mm_bytes() + n);
  } finally {
    N._free(p);
  }
  const q = N._malloc(bytes.length);
  try {
    N.HEAPU8.set(bytes, q);
    const t = N._mm_boneco_texto(q, bytes.length);
    if (!t) throw new Error(`${nome}: ${N.UTF8ToString(N._mm_erro())}`);
    if (!isDeepStrictEqual(JSON.parse(N.UTF8ToString(t)), JSON.parse(texto))) throw new Error(`${nome}: o binario nao volta ao mesmo documento`);
  } finally {
    N._free(q);
  }
  return bytes;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const k = args.indexOf("--nucleo");
  const nucleo = k >= 0 ? args.splice(k, 2)[1] : undefined;
  if (!args.length || args.length % 2) {
    console.error("uso: tools/binario-web.ts <entrada.boneco> <saida.boneco> [...pares] [--nucleo nucleo.mjs]");
    process.exit(2);
  }
  const N = await nucleoWeb(nucleo);
  for (let i = 0; i < args.length; i += 2) {
    const texto = readFileSync(args[i], "utf8");
    const b = paraBinario(N, texto, args[i]);
    writeFileSync(args[i + 1], b);
    console.error(`${args[i]}: ${(texto.length / 1024).toFixed(0)} KB -> ${(b.length / 1024).toFixed(0)} KB`);
  }
}
