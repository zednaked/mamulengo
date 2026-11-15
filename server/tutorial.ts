// O tutorial de rig e IK no disco: os originais (exemplos/tutorial/originais, feitos por
// exemplos/tutorial/gerar.ts) e as copias que o editor abre (exemplos/tutorial/cenas, fora do
// git). preparar() faz as copias que faltam; recomecar() apaga a pasta da cena (com pinturas e o
// que mais a pessoa tenha posto la) e copia o original de novo.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CENAS_TUTORIAL, pastaDaCena } from "../src/core/tutorial.ts";

const BASE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "exemplos", "tutorial");
const ORIGINAIS = join(BASE, "originais");
const CENAS = join(BASE, "cenas");

export const arquivoDaCena = (id: string) => join(CENAS, pastaDaCena(id), `${id}.boneco`);

function copiar(id: string) {
  const dir = join(CENAS, pastaDaCena(id));
  mkdirSync(dir, { recursive: true });
  const original = join(ORIGINAIS, `${id}.boneco.original`);
  copyFileSync(original, join(dir, `${id}.boneco`));
  // as paginas do atlas que a cena usa (tutorial.png no Tico, monstro.png no monstro)
  for (const p of JSON.parse(readFileSync(original, "utf8")).paginas ?? []) copyFileSync(join(ORIGINAIS, p.arquivo), join(dir, p.arquivo));
}

export function preparar(): { id: string; boneco: string }[] {
  if (!existsSync(join(ORIGINAIS, "tutorial.png"))) throw new Error(`faltam os originais do tutorial em ${ORIGINAIS} (npx tsx exemplos/tutorial/gerar.ts)`);
  return CENAS_TUTORIAL.map(({ id }) => {
    if (!existsSync(arquivoDaCena(id))) copiar(id);
    return { id, boneco: arquivoDaCena(id) };
  });
}

// id: uma cena; trilha: as cenas dela; nenhum dos dois: todas
export function recomecar(id?: string, trilha?: string): string[] {
  const ids = id ? [id] : CENAS_TUTORIAL.filter((c) => !trilha || c.trilha === trilha).map((c) => c.id);
  for (const i of ids) {
    if (!CENAS_TUTORIAL.some((c) => c.id === i)) throw new Error(`cena desconhecida: ${i}`);
    rmSync(join(CENAS, pastaDaCena(i)), { recursive: true, force: true });
    copiar(i);
  }
  return ids.map(arquivoDaCena);
}
