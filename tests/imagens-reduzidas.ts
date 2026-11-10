// A entrega do jogo web. Imagens reduzidas pelo empacotador (tools/reduzir-imagens.ts) com o tamanho
// logico na tela: a densidade (texels por unidade) medida na cena montada, o arquivo reduzido so quando
// passa do limite, e o recorte da cena (nas coordenadas do original) no mesmo lugar do arquivo menor.
// A compressao com limite de erro (tools/comprimir-imagens.ts) e o .boneco binario pelo nucleo web
// (tools/binario-web.ts).
//   npx tsx tests/imagens-reduzidas.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { montarTela, type CenaMamulengo } from "../src/cena/montar.ts";
import type { NoCena } from "../src/cena/tscn.ts";
import { densidadeDoElemento, densidades, tamanhoReduzido } from "../src/tela/densidade.ts";
import type { DadosTela } from "../src/tela/tela.ts";
import { amostrarBilinear, amostrarPonto, reduzirImagens } from "../tools/reduzir-imagens.ts";
import { comprimirImagem, ehSemPerda, erroVisivel } from "../tools/comprimir-imagens.ts";
import { nucleoWeb, paraBinario } from "../tools/binario-web.ts";

let falhas = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FALHA"} ${msg}`);
  if (!ok) falhas++;
};
const perto = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// --- a conta da densidade
check(perto(densidadeDoElemento({ xf: [0.25, 0, 0, 0.25, 0, 0], dst: [0, 0, 400, 200], src: [0, 0, 400, 200] }), 4), "400 texels em 100 unidades: 4 texels por unidade");
check(perto(densidadeDoElemento({ xf: [1, 0, 0, 1, 0, 0], dst: [0, 0, 50, 100], src: [100, 0, 200, 100] }), 4), "recorte de 200 em 50 unidades: 4 (o pior eixo)");
check(perto(densidadeDoElemento({ xf: [0, 2, -2, 0, 0, 0], dst: [0, 0, 100, 100], src: [0, 0, 100, 100] }), 0.5), "girada e ampliada: 0.5");
check(perto(densidadeDoElemento({ xf: [0.5, 0, 0, 0.5, 0, 0], dst: [0, 0, 300, 300], src: [0, 0, 64, 64], repetir: true }), 2), "repetida: 1 texel por unidade local");
check(tamanhoReduzido([1000, 500], 4, 1.6)?.join("x") === "400x200", "4 -> 1.6: 1000x500 vira 400x200");
check(tamanhoReduzido([1000, 500], 1.7, 1.6) === null, "pouco acima do limite nao compensa");
check(tamanhoReduzido([1000, 500], 1.2, 1.6) === null, "abaixo do limite fica");
// estado que amplia a imagem: vale o pior caso
const tela: DadosTela = {
  versao: 1, tamanho: [100, 100], fontes: {}, imagens: { a: { arquivo: "a.webp" } },
  elementos: [{ tipo: "imagem", nome: "A", img: "a", xf: [0.25, 0, 0, 0.25, 0, 0], dst: [0, 0, 400, 400], src: [0, 0, 400, 400] }],
  estados: { zoom: { elementos: { 0: { xf: [1, 0, 0, 1, 0, 0] } }, nos: {} }, encolhe: { elementos: { 0: { xf: [0.1, 0, 0, 0.1, 0, 0] } }, nos: {} } },
};
check(perto(densidades([tela]).get("a.webp")!, 10), "o estado que encolhe a imagem decide (10 texels por unidade)");

// o filtro "gpu": amostra bilinear premultiplicada (o transparente nao tinge a borda)
{
  // 4x1: verde opaco, vermelho transparente, verde opaco, verde opaco -> 2x1 (cada texel novo entre dois)
  const px = new Uint8Array([0, 255, 0, 255, 255, 0, 0, 0, 0, 255, 0, 255, 0, 255, 0, 255]);
  const r = amostrarBilinear(px, 4, 1, 2, 1);
  check(r[0] === 0 && r[1] === 255 && r[2] === 0 && r[3] === 128, `meio transparente: verde com meio alfa, sem vermelho (${[...r.slice(0, 4)]})`);
  check(r[4] === 0 && r[5] === 255 && r[7] === 255, "entre dois verdes: verde opaco");
  const id = amostrarBilinear(px, 4, 1, 4, 1);
  check(id[1] === 255 && id[3] === 255 && id[7] === 0 && id[9] === 255, "mesmo tamanho: os mesmos texels");
  // o filtro "ponto" (padrao): o texel mais perto, sem misturar (o grao fica inteiro)
  const p = amostrarPonto(new Uint8Array([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]), 4, 1, 2, 1);
  check(p[0] === 20 && p[4] === 40, `ponto: 4 -> 2 pega os texels do centro (${p[0]}, ${p[4]})`);
}

// --- ponta a ponta numa cena sintetica: TextureRect cobrindo (stretch 6) um quadrado com uma imagem
// 400x200: vermelho | verde (o meio, 100..300) | azul. O recorte e o meio, em coordenadas do original.
const dir = mkdtempSync(join(tmpdir(), "mamulengo-imagens-"));
const faixa = (w: number, x: number, r: number, g: number, b: number) => ({ input: { create: { width: w, height: 200, channels: 4 as const, background: { r, g, b, alpha: 1 } } }, left: x, top: 0 });
await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
  .composite([faixa(100, 0, 255, 0, 0), faixa(200, 100, 0, 255, 0), faixa(100, 300, 0, 0, 255)])
  .png()
  .toFile(join(dir, "faixas.png"));
const no = (nome: string, tipo: string, props: NoCena["props"], filhos: NoCena[] = [], caminho = ""): NoCena => ({ nome, tipo, props, filhos, caminho, cena: "res://teste.tscn" });
const raiz = no("Main", "Control", { offset_right: 100, offset_bottom: 100 }, [
  no("Quadro", "TextureRect", { offset_right: 100, offset_bottom: 100, expand_mode: 1, stretch_mode: 6, texture: { ext: { tipo: "Texture2D", caminho: "res://faixas.png", id: "1" } } }, [], "Quadro"),
]);
const cena: CenaMamulengo = {
  versao: 1, base: [100, 100], raiz,
  medidas: { texturas: { "res://faixas.png": [400, 200] }, fontes: {}, fontesDe: {}, fontePadrao: "", limites: {} },
  arquivos: { "res://faixas.png": "faixas.png" }, chaves: [],
};
writeFileSync(join(dir, "cena.json"), JSON.stringify(cena));
const dados = montarTela(cena, 100, 100);
const el = dados.elementos.find((e) => e.tipo === "imagem");
check(el?.tipo === "imagem" && el.src.join(",") === "100,0,200,200", `recorte nas coordenadas do original (${el?.tipo === "imagem" ? el.src : "-"})`);
const im = el?.tipo === "imagem" ? dados.imagens[el.img] : undefined;
check(im?.tam?.join("x") === "400x200", "a tela leva o tamanho logico da imagem (Imagem.tam)");

// limite 1: 2 texels por unidade -> metade
const r = await reduzirImagens(join(dir, "cena.json"), join(dir, "saida"), { limite: 1, minPx: 0, janelas: [[100, 100]] });
const red = r["res://faixas.png"];
check(!!red && red.real.join("x") === "200x100" && red.logico.join("x") === "400x200" && perto(red.densidade, 2), `reduzida a 200x100 (densidade ${red?.densidade})`);
const meta = await sharp(red.arquivo).metadata();
check(meta.width === 200 && meta.height === 100, "o arquivo reduzido tem o tamanho real do manifesto");
// os uvs como a tela calcula (recorte / tamanho logico) amostrados no arquivo reduzido
const { data, info } = await sharp(red.arquivo).raw().toBuffer({ resolveWithObject: true });
const amostra = (u: number, v: number) => {
  const x = Math.min(199, Math.floor(u * 200)), y = Math.min(99, Math.floor(v * 100));
  const o = (y * 200 + x) * info.channels;
  return [data[o], data[o + 1], data[o + 2]];
};
const [u0, v0, su, sv] = (el as { src: number[] }).src;
const [lw, lh] = im!.tam!;
const verde = (c: number[]) => c[1] > 200 && c[0] < 40 && c[2] < 40;
let dentro = true;
for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) dentro &&= verde(amostra((u0 + su * t) / lw, (v0 + sv * 0.5) / lh));
check(dentro, "o recorte cai no meio verde do arquivo reduzido");
check(amostra(50 / lw, 0.5)[0] > 200 && amostra(350 / lw, 0.5)[2] > 200, "fora do recorte: vermelho a esquerda, azul a direita");
// limite alto: nada a reduzir; imagem pequena demais (minPx): fica
check(Object.keys(await reduzirImagens(join(dir, "cena.json"), join(dir, "s2"), { limite: 3, minPx: 0, janelas: [[100, 100]] })).length === 0, "abaixo do limite nao reduz");
check(Object.keys(await reduzirImagens(join(dir, "cena.json"), join(dir, "s3"), { limite: 1, janelas: [[100, 100]] })).length === 0, "abaixo de --min-px nao reduz");

// --- compressao leve com limite de erro (tools/comprimir-imagens.ts)
{
  const px = (w: number, h: number, f: (x: number, y: number) => number[]) => {
    const b = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(f(x, y), (y * w + x) * 4);
    return b;
  };
  check(erroVisivel(px(2, 1, () => [255, 0, 0, 0]), px(2, 1, () => [0, 255, 0, 0])) === 0, "cor diferente onde e transparente nao conta");
  check(erroVisivel(px(1, 1, () => [200, 0, 0, 128]), px(1, 1, () => [190, 0, 0, 128])) === 5, "o erro e da cor pre-multiplicada (10 com alfa 1/2 -> 5)");
  // pintura suave (gradiente com textura leve) passa; ruido de alto contraste (bordas duras) nao
  let s2 = 3;
  const leve = () => ((s2 = (s2 * 1103515245 + 12345) & 0x7fffffff) % 7) - 3;
  const suave = await sharp(px(256, 256, (x, y) => [x + leve(), y + leve(), ((x + y) >> 1) + leve(), 255].map((v) => Math.max(0, Math.min(255, v)))), { raw: { width: 256, height: 256, channels: 4 } }).webp({ lossless: true }).toBuffer();
  let semente = 7;
  const acaso = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) & 1 ? 255 : 0);
  const ruido = await sharp(px(256, 256, () => [acaso(), acaso(), acaso(), 255]), { raw: { width: 256, height: 256, channels: 4 } }).webp({ lossless: true }).toBuffer();
  writeFileSync(join(dir, "suave.webp"), suave);
  writeFileSync(join(dir, "ruido.webp"), ruido);
  check(ehSemPerda(suave) && !ehSemPerda(await sharp(suave).webp({ quality: 80 }).toBuffer()), "VP8L reconhecido; o com perda fica de fora");
  const a = await comprimirImagem(join(dir, "suave.webp"), join(dir, "comp"));
  check(!!a?.aceita && a.p99 <= 10 && a.bytes[1] < a.bytes[0], `gradiente aceito (p99 ${a?.p99}, ${a?.bytes[0]} -> ${a?.bytes[1]} bytes)`);
  const b = await comprimirImagem(join(dir, "ruido.webp"), join(dir, "comp"));
  check(!!b && !b.aceita && b.arquivo === join(dir, "ruido.webp"), `ruido recusado (p99 ${b?.p99}), fica o original`);
  const c = await comprimirImagem(join(dir, "suave.webp"), join(dir, "comp"));
  check(JSON.stringify(c) === JSON.stringify(a), "a segunda vez vem do cache");
  writeFileSync(join(dir, "ruido2.webp"), ruido);
  const d = await comprimirImagem(join(dir, "ruido2.webp"), join(dir, "comp"));
  check(d?.arquivo === join(dir, "ruido2.webp"), "recusada igual a outra (cache) aponta para a propria origem");
}

// --- .boneco binario pelo nucleo web (tools/binario-web.ts), para empacotar sem o nucleo nativo
{
  const N = await nucleoWeb();
  const texto = readFileSync(new URL("./boneco/monstro/monstro.boneco", import.meta.url), "utf8");
  const b = paraBinario(N, texto, "monstro");
  check(String.fromCharCode(...b.subarray(0, 4)) === "BNCB" && b.length < texto.length / 2, `monstro em binario: ${(texto.length / 1024).toFixed(0)} -> ${(b.length / 1024).toFixed(0)} KB, conferido na volta`);
  let recusou = false;
  try {
    paraBinario(N, "{ isto nao e json", "ruim");
  } catch {
    recusou = true;
  }
  check(recusou, "texto invalido da erro");
}

rmSync(dir, { recursive: true, force: true });
console.log(falhas ? `${falhas} falha(s)` : "tudo ok");
process.exit(falhas ? 1 : 0);
