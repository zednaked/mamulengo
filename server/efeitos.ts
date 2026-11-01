// Biblioteca de efeitos (biblioteca/efeitos: texturas CC0 e presets de emissor em efeitos.json).
// Por um efeito num .boneco poe as imagens dele numa pagina so dos efeitos, <nome>-efeitos.png ao
// lado (refeita a partir da biblioteca a cada vez, com todas as imagens de efeito que o personagem
// ja tinha), e devolve os nomes no atlas e o emissor pronto para o particles.set.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { arquivoBinario, gravarBonecoArquivo, lerBonecoArquivo } from "./boneco-binario.ts";

const BIBLIOTECA = fileURLToPath(new URL("../biblioteca/efeitos/", import.meta.url));
// as imagens de efeito no atlas do personagem: efeito_<nome na biblioteca>
const PREFIXO = "efeito_";

type Efeito = { tipo?: "olho"; titulo: string; texto: string; imagens: string[]; emissor?: Record<string, any>; olho?: Record<string, any> };
const efeitos = (): Record<string, Efeito> => JSON.parse(readFileSync(join(BIBLIOTECA, "efeitos.json"), "utf8"));

export function listarEfeitos() {
  // o menu de particulas so lista emissores (o olho maluco tem comando proprio, eye.googly)
  return Object.entries(efeitos())
    .filter(([, e]) => !e.tipo)
    .map(([nome, e]) => ({ nome, titulo: e.titulo, texto: e.texto, rajadas: !e.emissor?.rate }));
}

export async function porEfeito(boneco: string, nome: string): Promise<{ imagens: string[]; emissor?: Record<string, any>; olho?: Record<string, any>; pagina: string; novas: number }> {
  const ef = efeitos()[nome];
  if (!ef) throw new Error(`efeito desconhecido: ${nome} (ha ${Object.keys(efeitos()).join(", ")})`);
  const b = lerBonecoArquivo(boneco);
  const arquivo = basename(boneco, ".boneco") + "-efeitos.png";
  const nomes = ef.imagens.map((i) => PREFIXO + i);
  const imagens: any[] = b.imagens ?? [];
  const faltam = nomes.filter((n) => !imagens.some((im) => im.nome === n));
  if (!faltam.length) return { imagens: nomes, emissor: ef.emissor, olho: ef.olho, pagina: arquivo, novas: 0 };
  // a pagina dos efeitos: as que ja estavam nela mais as novas, todas lidas da biblioteca
  let pi = (b.paginas ?? []).findIndex((p: any) => p.arquivo === arquivo);
  const ja = pi >= 0 ? imagens.filter((im) => (im.pagina ?? 0) === pi && im.nome.startsWith(PREFIXO)).map((im) => im.nome) : [];
  const todas = [...new Set([...ja, ...nomes])];
  const pecas = [];
  for (const n of todas) {
    const f = join(BIBLIOTECA, n.slice(PREFIXO.length) + ".png");
    if (!existsSync(f)) throw new Error(`a biblioteca nao tem ${basename(f)}`);
    const { width, height } = await sharp(f).metadata();
    pecas.push({ nome: n, f, w: width!, h: height! });
  }
  // prateleiras numa largura fixa, as mais altas primeiro; 2 px entre elas
  const LARG = 1024;
  pecas.sort((a, c) => c.h - a.h);
  let [x, y, alt] = [0, 0, 0];
  const lugares: { nome: string; f: string; ret: number[] }[] = [];
  for (const p of pecas) {
    if (x + p.w > LARG) [x, y, alt] = [0, y + alt + 2, 0];
    lugares.push({ nome: p.nome, f: p.f, ret: [x, y, p.w, p.h] });
    x += p.w + 2;
    alt = Math.max(alt, p.h);
  }
  const altura = y + alt;
  await sharp({ create: { width: LARG, height: altura, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(lugares.map((l) => ({ input: l.f, left: l.ret[0], top: l.ret[1] })))
    .png()
    .toFile(join(dirname(boneco), arquivo));
  if (pi < 0) {
    b.paginas = [...(b.paginas ?? []), { arquivo, tamanho: [LARG, altura] }];
    pi = b.paginas.length - 1;
  } else b.paginas[pi] = { ...b.paginas[pi], tamanho: [LARG, altura] };
  b.imagens = [...imagens.filter((im) => !((im.pagina ?? 0) === pi && im.nome.startsWith(PREFIXO))), ...lugares.map((l) => ({ nome: l.nome, pagina: pi, ret: l.ret }))];
  gravarBonecoArquivo(boneco, b, arquivoBinario(boneco));
  return { imagens: nomes, emissor: ef.emissor, olho: ef.olho, pagina: arquivo, novas: faltam.length };
}
