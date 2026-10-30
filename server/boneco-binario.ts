// .boneco em texto ou binario (docs/FORMATO.md "Binario") para o editor e as ferramentas: o
// binario e lido e gravado pelo nucleo-binario (nucleo/build), o mesmo codigo que o jogo usa.
// Um arquivo que era binario volta a ser gravado em binario.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "nucleo", "build", "nucleo-binario");

export const ehBinario = (b: Buffer) => b.length >= 5 && b.subarray(0, 4).toString("latin1") === "BNCB" && b[4] === 1;

function nucleoBinario(args: string[]) {
  if (!existsSync(BIN)) throw new Error(`.boneco binario precisa do nucleo-binario: compile o nucleo (cmake -S nucleo -B nucleo/build -G Ninja && cmake --build nucleo/build)`);
  const r = spawnSync(BIN, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`nucleo-binario: ${r.stderr || r.error}`);
}

// o objeto do .boneco, texto ou binario
export function lerBonecoArquivo(arquivo: string): any {
  const b = readFileSync(arquivo);
  if (!ehBinario(b)) return JSON.parse(b.toString("utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "boneco-"));
  try {
    nucleoBinario(["--texto", arquivo, join(tmp, "x.json")]);
    return JSON.parse(readFileSync(join(tmp, "x.json"), "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// grava o objeto em `destino`: texto indentado, ou binario se `binario`
export function gravarBonecoArquivo(destino: string, b: any, binario: boolean) {
  const texto = JSON.stringify(b, null, 1) + "\n";
  if (!binario) return writeFileSync(destino, texto);
  const tmp = mkdtempSync(join(tmpdir(), "boneco-"));
  try {
    writeFileSync(join(tmp, "x.boneco"), texto);
    nucleoBinario([join(tmp, "x.boneco"), destino]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export const arquivoBinario = (arquivo: string) => existsSync(arquivo) && ehBinario(readFileSync(arquivo).subarray(0, 5));
