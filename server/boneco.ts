// .boneco no editor: o editor de hoje le e grava o JSON do Spine e o atlas texto; aqui um
// x.boneco aparece como tres arquivos virtuais ao lado dele (x.boneco.spine-json,
// x.boneco.atlas e x.boneco.ficha.md), convertidos na hora (src/boneco/spine.ts). Gravar um
// deles regrava o .boneco inteiro, guardando o que so ele tem (mix, compressao das paginas,
// multiply do motor). As paginas sao arquivos de verdade ao lado. O .boneco binario (docs/FORMATO.md
// "Binario") e lido e regravado em binario (server/boneco-binario.ts).
import { existsSync, renameSync, copyFileSync } from "node:fs";
import { atlasTexto, exportarSpine, importarSpine, type Boneco } from "../src/boneco/spine.ts";
import { serializeSpineJson } from "../src/core/format.ts";
import type { SpineAsset } from "./godot.ts";
import { arquivoBinario, gravarBonecoArquivo, lerBonecoArquivo } from "./boneco-binario.ts";

const VIRTUAIS = /\.boneco\.(spine-json|atlas|ficha\.md)$/;

// caminho virtual -> [arquivo .boneco, qual parte] (ou null se nao e virtual)
export function bonecoVirtual(p: string): { arquivo: string; parte: "spine-json" | "atlas" | "ficha.md" } | null {
  const m = VIRTUAIS.exec(p);
  if (!m) return null;
  const arquivo = p.slice(0, -m[1].length - 1);
  return existsSync(arquivo) ? { arquivo, parte: m[1] as any } : null;
}

const ler = (arquivo: string): Boneco => lerBonecoArquivo(arquivo);

export function lerVirtual(p: string): string | null {
  const v = bonecoVirtual(p);
  if (!v) return null;
  const b = ler(v.arquivo);
  if (v.parte === "atlas") return atlasTexto(b);
  if (v.parte === "ficha.md") {
    if (!b.ficha?.texto) throw Object.assign(new Error(`nao existe: ${p}`), { code: 404 });
    return b.ficha.texto;
  }
  return serializeSpineJson(exportarSpine(b).json, undefined, { reuse: false });
}

// regrava o .boneco com o JSON e o atlas novos, guardando o que so o .boneco tem
function regravar(arquivo: string, antigo: Boneco, json: any, atlas: string, ficha = antigo.ficha) {
  const novo = importarSpine(json, atlas, antigo.nome);
  const motor = new Set((antigo.slots ?? []).filter((s: any) => s.blend === "multiplica_motor").map((s: any) => s.nome));
  for (const s of novo.slots ?? []) if (s.blend === "multiplica" && motor.has(s.nome)) s.blend = "multiplica_motor";
  for (const p of novo.paginas) {
    const velha = (antigo.paginas ?? []).find((x: any) => x.arquivo === p.arquivo);
    if (velha?.jogo) p.jogo = velha.jogo;
  }
  if (antigo.mix) novo.mix = antigo.mix;
  if (ficha) novo.ficha = ficha;
  // copia de seguranca e gravacao atomica, como os outros arquivos do editor
  copyFileSync(arquivo, arquivo + ".bak");
  const tmp = arquivo + ".mamulengo-tmp";
  gravarBonecoArquivo(tmp, novo, arquivoBinario(arquivo));
  renameSync(tmp, arquivo);
}

export function gravarVirtual(p: string, corpo: Buffer): boolean {
  const v = bonecoVirtual(p);
  if (!v) return false;
  const b = ler(v.arquivo);
  const atual = exportarSpine(b);
  if (v.parte === "spine-json") regravar(v.arquivo, b, JSON.parse(corpo.toString("utf8")), atual.atlas);
  else if (v.parte === "atlas") regravar(v.arquivo, b, atual.json, corpo.toString("utf8"));
  else regravar(v.arquivo, b, atual.json, atual.atlas, { ...(b.ficha ?? {}), texto: corpo.toString("utf8") });
  return true;
}

// o .boneco na lista de personagens, como se fosse um -data.tres
export function bonecoAsset(arquivo: string): SpineAsset | null {
  try {
    const b = ler(arquivo);
    if (typeof b.boneco !== "number") return null;
    return {
      tres: arquivo,
      skeleton: arquivo + ".spine-json",
      atlas: arquivo + ".atlas",
      defaultMix: b.mix?.padrao ?? 0,
      mixes: (b.mix?.pares ?? []).map((m: any) => ({ from: m.de, to: m.para, mix: m.tempo })),
    };
  } catch {
    return null;
  }
}
