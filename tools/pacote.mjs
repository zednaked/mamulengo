// O que o empacotador de um jogo repete (o cliente que vai para o CDN): fontes recortadas aos caracteres
// que a tela mostra, bonecos em binario, imagens comprimidas e reduzidas, o hash e a gravacao da pasta.
// Em JavaScript puro para o `node empacotar.mjs` do jogo importar direto:
//
//   import { caracteresBase, recortarFonte, emBinario, comprimirImagens, recomprimirImagem, gravarPacote } from "mamulengo-motor/tools/pacote.mjs";
//
// Nenhum comando passa por shell (execFileSync com a lista de argumentos: um nome de arquivo com aspas
// ou $() nao vira comando) e o pyftsubset roda com versoes fixas do fonttools e do brotli.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
// no checkout o nucleo da web fica em nucleo/build-web; no pacote do motor, em nucleo/
export const NUCLEO = [join(AQUI, "../nucleo/build-web/nucleo.mjs"), join(AQUI, "../nucleo/nucleo.mjs")].find((c) => existsSync(c)) ?? join(AQUI, "../nucleo/nucleo.mjs");
// as versoes com que o recorte foi conferido (mudar aqui e conferir as fontes de novo)
export const FONTTOOLS = "4.68.0";
export const BROTLI = "1.2.1";

// uma ferramenta .ts do motor pelo tsx de quem chama (o jogo), sem shell; devolve o que ela escreveu
function ferramenta(nome, args, { saida = false } = {}) {
  // o tsx de quem chama (o jogo) ou, num checkout do Mamulengo, o daqui
  let tsx;
  for (const de of [join(process.cwd(), "package.json"), import.meta.url]) {
    try {
      tsx = createRequire(de).resolve("tsx/cli");
      break;
    } catch {}
  }
  if (!tsx) throw new Error("falta o tsx (devDependency do jogo) para rodar " + nome);
  const r = execFileSync(process.execPath, [tsx, join(AQUI, nome), ...args], { stdio: ["ignore", saida ? "pipe" : "inherit", "inherit"], maxBuffer: 64 << 20 });
  return saida ? r.toString() : "";
}
const ultimaLinha = (s) => JSON.parse(s.trim().split("\n").pop());

// ASCII, Latin-1, os simbolos de moeda e a pontuacao que um valor ou um texto curto costuma levar
export function caracteresBase() {
  const c = new Set();
  for (let i = 0x20; i <= 0xff; i++) c.add(String.fromCharCode(i));
  for (const ch of "₿ΞŁ₹₽€£¥₩₺₱฿₦₴₫₪₸₲₡₵₭₮₼₾﷼–—…•·×÷−₀₁₂₃") c.add(ch);
  return c;
}
// junta os caracteres de qualquer coisa (texto, lista, objeto de traducoes) num Set
export function juntarCaracteres(conjunto, valor) {
  if (valor == null) return conjunto;
  if (typeof valor === "object") for (const v of Object.values(valor)) juntarCaracteres(conjunto, v);
  else for (const ch of String(valor)) conjunto.add(ch);
  return conjunto;
}
// a fonte so com os caracteres dados, em WOFF2, com as regras de forma (arabe, devanagari). O nome do
// arquivo de saida leva o hash da fonte e do texto: o que ja foi recortado nao roda de novo.
export function recortarFonte(origem, pasta, caracteres) {
  mkdirSync(pasta, { recursive: true });
  const texto = [...caracteres].sort().join("");
  const h = createHash("sha256").update(readFileSync(origem)).update(texto).update(FONTTOOLS + BROTLI).digest("hex").slice(0, 12);
  const nome = origem.split("/").pop().replace(/\.(ttf|otf)$/i, "");
  const destino = join(pasta, `${nome}.${h}.woff2`);
  if (!existsSync(destino)) {
    const arqTexto = join(pasta, `${nome}.${h}.txt`);
    writeFileSync(arqTexto, texto);
    execFileSync("uv", ["run", "-q", "--with", `fonttools==${FONTTOOLS}`, "--with", `brotli==${BROTLI}`, "pyftsubset", origem, `--text-file=${arqTexto}`, "--layout-features=*", "--flavor=woff2", `--output-file=${destino}`], { stdio: ["ignore", "ignore", "inherit"] });
    rmSync(arqTexto, { force: true });
  }
  return destino;
}
// os .boneco em binario (o runtime reconhece pela magica BNCB), pelo nucleo web, conferidos na volta.
// Devolve origem -> arquivo binario (na pasta, com o hash do conteudo no nome); o que ja e binario fica.
export function emBinario(origens, pasta, nucleo = NUCLEO) {
  mkdirSync(pasta, { recursive: true });
  const feitos = new Map();
  const pares = [];
  for (const abs of origens) {
    const dados = readFileSync(abs);
    if (dados.subarray(0, 4).toString("latin1") === "BNCB") {
      feitos.set(abs, abs);
      continue;
    }
    const destino = join(pasta, createHash("sha256").update(dados).digest("hex").slice(0, 16) + ".boneco");
    if (!existsSync(destino)) pares.push(abs, destino);
    feitos.set(abs, destino);
  }
  if (pares.length) ferramenta("binario-web.ts", [...pares, "--nucleo", nucleo]);
  return feitos;
}
// os WebP sem perda regravados com perda quando o erro visivel fica no limite (comprimir-imagens.ts).
// Devolve origem -> { aceita, arquivo, ... }
export function comprimirImagens(imagens, pasta) {
  mkdirSync(pasta, { recursive: true });
  const lista = join(pasta, ".lista.txt");
  writeFileSync(lista, [...imagens].join("\n"));
  try {
    return ultimaLinha(ferramenta("comprimir-imagens.ts", [pasta, "--lista", lista], { saida: true }));
  } finally {
    rmSync(lista, { force: true });
  }
}
// as imagens que chegam a tela com mais texels por unidade do que o limite (reduzir-imagens.ts).
// Devolve res:// -> { arquivo, real, ... }
export function reduzirImagens(cena, pasta, { limite, ajustes } = {}) {
  const args = [cena, pasta];
  if (limite !== undefined) args.push("--limite", String(limite));
  if (ajustes) args.push("--ajustes", ajustes);
  return ultimaLinha(ferramenta("reduzir-imagens.ts", args, { saida: true }));
}
// uma imagem regravada com perda numa qualidade escolhida por quem olhou (WebP, alfa sem perda). E a
// decisao de arte que as ferramentas automaticas nao tomam: comprimir-imagens.ts so aceita o que fica
// dentro do limite de erro. Devolve o arquivo novo (na pasta, com cache pelo conteudo e pela
// qualidade) ou a propria origem, se nao diminuiu.
export async function recomprimirImagem(origem, pasta, qualidade) {
  let sharp;
  for (const de of [join(process.cwd(), "package.json"), import.meta.url]) {
    try {
      sharp = createRequire(de)("sharp");
      break;
    } catch {}
  }
  if (!sharp) throw new Error("falta o sharp (devDependency do jogo) para regravar " + origem);
  mkdirSync(pasta, { recursive: true });
  const dados = readFileSync(origem);
  const destino = join(pasta, createHash("sha256").update(dados).update(`q${qualidade}`).digest("hex").slice(0, 16) + ".webp");
  if (!existsSync(destino)) writeFileSync(destino, await sharp(dados).webp({ quality: qualidade, alphaQuality: 100, effort: 6 }).toBuffer());
  return statSync(destino).size < dados.length ? destino : origem;
}
// o nome da pasta do cliente sai do conteudo (um CDN guarda cada cliente para sempre): 12 hexadecimais
// sobre a pagina e sobre cada arquivo (caminho no pacote e conteudo: o caminho da origem ou um Buffer), em ordem
export function hashDoPacote(html, arquivos) {
  const h = createHash("sha256").update(html);
  for (const [r, origem] of [...arquivos].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) h.update(r).update(typeof origem === "string" ? readFileSync(origem) : origem);
  return h.digest("hex").slice(0, 12);
}
// grava a pasta do cliente: index.html e os arquivos (caminho no pacote -> caminho do arquivo de origem, ou um Buffer com o
// conteudo). Devolve { arquivos, bytes }.
export function gravarPacote(saida, html, arquivos) {
  rmSync(saida, { recursive: true, force: true });
  mkdirSync(saida, { recursive: true });
  writeFileSync(join(saida, "index.html"), html);
  for (const [r, origem] of arquivos) {
    mkdirSync(dirname(join(saida, r)), { recursive: true });
    if (typeof origem === "string") copyFileSync(origem, join(saida, r));
    else writeFileSync(join(saida, r), origem);
  }
  const soma = (d) => readdirSync(d, { withFileTypes: true }).reduce((t, e) => t + (e.isDirectory() ? soma(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
  return { arquivos: arquivos.size + 1, bytes: soma(saida) };
}
