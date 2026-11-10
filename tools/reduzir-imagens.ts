// Reduz as imagens de uma cena do Mamulengo (telas/cena.json) que chegam a tela com mais texels por
// unidade do que o limite (src/tela/densidade.ts), sem tocar na arte-fonte: as reduzidas vao para uma
// pasta de saida e o manifesto diz, para cada res://, o arquivo novo, o tamanho logico (o original,
// que continua em medidas.texturas e e o que a tela usa nos recortes) e o real. O empacotador do jogo
// copia o arquivo reduzido no lugar do original.
//
// So entram as imagens grandes (--min-px, padrao 2 Mpx): sao elas que pesam na carga e na GPU, e uma
// imagem pequena pode ser ampliada pelo codigo do jogo (um tween de escala), o que a medida nao ve.
//
//   npx tsx tools/reduzir-imagens.ts <cena.json> <saida/> [--limite 1.6] [--minimo 0.85] [--min-px 2000000]
//        [--janelas 700x1370,1028x1370,1920x1080] [--ajustes modulo.ts] [--qualidade 90] [--manter res://a,res://b]
//        [--filtro gpu|lanczos3|ponto]
//
// --ajustes: um modulo do jogo que exporta `ajustes` (os do montarTela: ajustar, estados,
// aoRedimensionar), para medir a tela como o jogo a monta. O manifesto sai em <saida>/manifesto.json
// e no stdout.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { montarTela, type Ajustes, type CenaMamulengo } from "../src/cena/montar.ts";
import { densidades, tamanhoReduzido } from "../src/tela/densidade.ts";

export type Reduzida = { arquivo: string; logico: [number, number]; real: [number, number]; densidade: number; bytes: [number, number] };
export type OpcoesReducao = { limite?: number; minimo?: number; janelas?: [number, number][]; ajustes?: Ajustes; qualidade?: number; manter?: string[]; minPx?: number; filtro?: Filtro };
// O filtro (padrao ponto): a GPU desenha estas texturas com LINEAR e sem mipmap, quase uma amostra por
// pixel, entao o grao fino da arte aparece na tela; um filtro que suaviza (lanczos, ou o redutor do
// proprio webp na leitura) o apaga. Medido num feltro pintado (desvio do grao na captura, antes 2,78):
// ponto 2,65, gpu 1,79, lanczos3 1,62, redutor do webp 1,36.
// gpu: cada texel novo e a amostra bilinear do original no centro dele, sem pre-filtro, em alfa
// premultiplicado - o que a GPU fazia (LINEAR, sem mipmap) ao desenhar o original menor: o grao fino da
// arte (o feltro da mesa) continua na tela. lanczos3: o filtro classico, mais suave (some o grao) e
// arquivo menor. ponto: o texel do original mais perto do centro (o grao inteiro, bordas em degrau de
// um texel).
export type Filtro = "gpu" | "lanczos3" | "ponto";

// RGBA -> RGBA w x h pelo texel mais perto do centro de cada texel novo
export function amostrarPonto(px: Uint8Array, W: number, H: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const y = Math.min(H - 1, Math.floor(((j + 0.5) * H) / h));
    for (let i = 0; i < w; i++) {
      const x = Math.min(W - 1, Math.floor(((i + 0.5) * W) / w));
      out.set(px.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), (j * w + i) * 4);
    }
  }
  return out;
}

// RGBA (sRGB, alfa direto) -> RGBA w x h pela amostra bilinear premultiplicada no centro de cada texel
export function amostrarBilinear(px: Uint8Array, W: number, H: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const kx = W / w, ky = H / h;
  const pm = (o: number, c: number) => (c === 3 ? px[o + 3] : (px[o + c] * px[o + 3]) / 255);
  for (let j = 0; j < h; j++) {
    const y = Math.min(Math.max((j + 0.5) * ky - 0.5, 0), H - 1);
    const y0 = Math.min(Math.floor(y), H - 2 < 0 ? 0 : H - 2), fy = H > 1 ? y - y0 : 0, y1 = Math.min(y0 + 1, H - 1);
    for (let i = 0; i < w; i++) {
      const x = Math.min(Math.max((i + 0.5) * kx - 0.5, 0), W - 1);
      const x0 = Math.min(Math.floor(x), W - 2 < 0 ? 0 : W - 2), fx = W > 1 ? x - x0 : 0, x1 = Math.min(x0 + 1, W - 1);
      const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, d = (y1 * W + x1) * 4;
      const v = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) v[k] = (pm(a, k) * (1 - fx) + pm(b, k) * fx) * (1 - fy) + (pm(c, k) * (1 - fx) + pm(d, k) * fx) * fy;
      const o = (j * w + i) * 4;
      out[o + 3] = Math.round(v[3]);
      for (let k = 0; k < 3; k++) out[o + k] = v[3] > 0 ? Math.min(255, Math.round((v[k] * 255) / v[3])) : 0;
    }
  }
  return out;
}

export const JANELAS_PADRAO: [number, number][] = [
  [360, 800], [412, 915], [1080, 2400], [700, 1370], [771, 1370], [1028, 1370], [768, 1024], [1366, 768], [1920, 1080], [2560, 1440],
];

// cena: o caminho do cena.json; saida: a pasta das reduzidas. Devolve res:// -> reduzida
export async function reduzirImagens(arqCena: string, saida: string, o: OpcoesReducao = {}): Promise<Record<string, Reduzida>> {
  const { limite = 1.6, minimo = 0.85, janelas = JANELAS_PADRAO, ajustes = {}, qualidade = 90, manter = [], minPx = 2_000_000, filtro = "ponto" } = o;
  const cena: CenaMamulengo = JSON.parse(readFileSync(arqCena, "utf8"));
  const dir = dirname(resolve(arqCena));
  const telas = janelas.map(([w, h]) => montarTela(cena, w, h, ajustes));
  const dens = densidades(telas);
  mkdirSync(saida, { recursive: true });
  const out: Record<string, Reduzida> = {};
  for (const [res, rel] of Object.entries(cena.arquivos)) {
    if (manter.includes(res) || !/\.(webp|png|jpe?g)$/i.test(rel)) continue;
    const logico = cena.medidas.texturas[res];
    const d = dens.get(rel);
    if (!logico || d === undefined || logico[0] * logico[1] < minPx) continue;
    const novo = tamanhoReduzido(logico, d, limite, minimo);
    if (!novo) continue;
    const abs = resolve(dir, rel);
    const meta = await sharp(abs).metadata();
    // o arquivo tem de estar no tamanho logico (senao os recortes da cena nao batem com ele)
    if (meta.width !== logico[0] || meta.height !== logico[1]) throw new Error(`${res}: arquivo ${meta.width}x${meta.height}, cena diz ${logico[0]}x${logico[1]}`);
    const fonte = readFileSync(abs);
    const chave = createHash("sha256").update(fonte).update(`${novo}|${qualidade}|6|${filtro}`).digest("hex").slice(0, 12);
    const ext = rel.split(".").pop()!.toLowerCase();
    const destino = join(resolve(saida), `${chave}.${ext}`);
    if (!existsSync(destino)) {
      // decodificado inteiro antes (o webp do sharp reduz na leitura com o filtro dele e ignora o kernel)
      const { data, info } = await sharp(fonte).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let img =
        filtro !== "lanczos3"
          ? sharp((filtro === "ponto" ? amostrarPonto : amostrarBilinear)(data, info.width, info.height, novo[0], novo[1]), { raw: { width: novo[0], height: novo[1], channels: 4 } })
          : sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(novo[0], novo[1], { fit: "fill", kernel: "lanczos3" });
      img = ext === "webp" ? img.webp({ quality: qualidade, alphaQuality: 100, effort: 6, smartSubsample: true }) : ext === "png" ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: qualidade, mozjpeg: true });
      writeFileSync(destino, await img.toBuffer());
    }
    out[res] = { arquivo: destino, logico, real: novo, densidade: Math.round(d * 1000) / 1000, bytes: [fonte.length, statSync(destino).size] };
  }
  writeFileSync(join(saida, "manifesto.json"), JSON.stringify(out, null, 1));
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const filtro = opt("filtro") as Filtro | undefined, minPx = opt("min-px"), limite = opt("limite"), minimo = opt("minimo"), jan = opt("janelas"), aj = opt("ajustes"), q = opt("qualidade"), manter = opt("manter");
  const [arqCena, saida] = args;
  if (!arqCena || !saida) {
    console.error("uso: tools/reduzir-imagens.ts <cena.json> <saida/> [--limite 1.6] [--minimo 0.85] [--janelas WxH,...] [--ajustes modulo.ts] [--qualidade 90] [--manter res://...] [--min-px N] [--filtro gpu|lanczos3|ponto]");
    process.exit(2);
  }
  const ajustes: Ajustes = aj ? (await import(pathToFileURL(resolve(aj)).href)).ajustes : {};
  const r = await reduzirImagens(arqCena, saida, {
    limite: limite ? Number(limite) : undefined,
    minimo: minimo ? Number(minimo) : undefined,
    janelas: jan ? jan.split(",").map((s) => s.split("x").map(Number) as [number, number]) : undefined,
    ajustes,
    qualidade: q ? Number(q) : undefined,
    manter: manter?.split(","),
    minPx: minPx ? Number(minPx) : undefined,
    filtro,
  });
  for (const [res, x] of Object.entries(r))
    console.error(`${res}: ${x.logico.join("x")} -> ${x.real.join("x")} (${x.densidade} texel/unid), ${(x.bytes[0] / 1024).toFixed(0)} KB -> ${(x.bytes[1] / 1024).toFixed(0)} KB`);
  console.log(JSON.stringify(r));
}
