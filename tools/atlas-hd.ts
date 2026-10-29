// Pagina do atlas em alta resolucao a partir do vetor original da arte: cada imagem do .boneco
// nasce do(s) objeto(s) do SVG com o id dela, sem o transparente, no retangulo do atlas vezes o
// fator. Imagem sem objeto no SVG (ou girada/cortada no atlas) vem da pagina original ampliada,
// entao a pagina nova sai sempre completa. Precisa de rsvg-convert e magick.
//
//   npx tsx tools/atlas-hd.ts <x.boneco> <fonte.svg> [--fator 3] [--id "{nome}"] [--pagina 0]
//                             [--saida <pagina-hd.webp>] [--gravar]
//
//   --id     modelo do id no SVG: {nome} vira o nome da imagem e * casa qualquer trecho; varios
//            objetos que casam sao desenhados juntos, na ordem do arquivo (ex. "{nome}_0_Layer0_*_FILL")
//   --saida  padrao: <pagina>-hd.webp ao lado do .boneco
//   --gravar troca a pagina no .boneco (arquivo, tamanho e retangulos vezes o fator) e multiplica
//            as medidas de efeito em pixels da textura (linha.largura, brilho.raio, dissolver.grao)
//
// O transform dos grupos que contem o objeto nao entra (o objeto e desenhado sozinho); como cada
// parte e cortada e esticada para o retangulo dela, so a proporcao importa.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args.splice(i, 1).length > 0;
};
const fator = Number(opt("fator", "3"));
const modelo = opt("id", "{nome}");
const pagina = Number(opt("pagina", "0"));
const saidaOpt = opt("saida", "");
const gravar = flag("gravar");
const [arqBoneco, arqSvg] = args;
if (!arqBoneco || !arqSvg || !(fator > 0)) {
  console.error('uso: tools/atlas-hd.ts <x.boneco> <fonte.svg> [--fator 3] [--id "{nome}"] [--pagina 0] [--saida <arquivo.webp>] [--gravar]');
  process.exit(2);
}
const roda = (cmd: string, a: string[]) => {
  const r = spawnSync(cmd, a, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr || r.error}`);
  return r.stdout;
};

const b = JSON.parse(readFileSync(arqBoneco, "utf8"));
const pag = b.paginas[pagina];
if (!pag) throw new Error(`o .boneco nao tem a pagina ${pagina}`);
const pasta = dirname(resolve(arqBoneco));
const original = join(pasta, pag.arquivo);
const saida = resolve(saidaOpt || join(pasta, pag.arquivo.replace(/\.[^.]+$/, "") + "-hd.webp"));
const svg = readFileSync(arqSvg, "utf8");
const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
const fim = svg.lastIndexOf("</svg>");

const tmp = mkdtempSync(join(tmpdir(), "atlas-hd-"));
try {
  const camadas: string[] = [];
  let doVetor = 0;
  const daPagina: string[] = [];
  for (const im of b.imagens.filter((im: any) => (im.pagina ?? 0) === pagina)) {
    const [x, y, w, h] = im.ret.map((v: number) => Math.round(v * fator));
    const png = join(tmp, `${camadas.length}.png`);
    const re = new RegExp("^" + esc(modelo.replace("{nome}", im.nome)).replace(/\*/g, ".*") + "$");
    const casam = [...new Set(ids.filter((i) => re.test(i)))];
    if (casam.length && !im.girada && !im.corte) {
      // um grupo novo com os objetos, desenhado sozinho e cortado no tamanho dele; o zoom sai da
      // primeira passada para a parte nascer pelo menos do tamanho do retangulo
      const doc = join(tmp, "parte.svg");
      writeFileSync(doc, svg.slice(0, fim) + `<g id="__parte_hd">${casam.map((i) => `<use xlink:href="#${i}" href="#${i}"/>`).join("")}</g>` + svg.slice(fim));
      roda("rsvg-convert", ["-i", "__parte_hd", doc, "-o", png]);
      const [pw, ph] = roda("magick", [png, "-trim", "-format", "%w %h", "info:"]).split(" ").map(Number);
      const zoom = Math.max(1, (w / pw) * 1.5, (h / ph) * 1.5);
      roda("rsvg-convert", ["-i", "__parte_hd", "-z", String(zoom), doc, "-o", png]);
      // sem o transparente e no tamanho exato do retangulo (a borda suavizada pode sobrar 1 px)
      roda("magick", [png, "-trim", "+repage", "-resize", `${w}x${h}!`, png]);
      doVetor++;
    } else {
      const [ox, oy, ow, oh] = im.ret;
      const [rw, rh] = im.girada ? [oh, ow] : [ow, oh];
      roda("magick", [original, "-crop", `${rw}x${rh}+${ox}+${oy}`, "+repage", "-filter", "Lanczos", "-resize", `${Math.round(rw * fator)}x${Math.round(rh * fator)}!`, png]);
      daPagina.push(im.nome);
    }
    camadas.push(png, "-geometry", `+${x}+${y}`, "-composite");
  }
  const [lg, al] = pag.tamanho.map((v: number) => Math.round(v * fator));
  roda("magick", ["-size", `${lg}x${al}`, "xc:none", ...camadas, "-define", "webp:lossless=true", saida]);
  console.log(`${saida}: ${lg}x${al}, ${doVetor} imagens do vetor, ${daPagina.length} da pagina original${daPagina.length ? ` (${daPagina.join(", ")})` : ""}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (gravar) {
  b.paginas[pagina] = { ...pag, arquivo: basename(saida), tamanho: pag.tamanho.map((v: number) => Math.round(v * fator)) };
  for (const im of b.imagens) if ((im.pagina ?? 0) === pagina) im.ret = im.ret.map((v: number) => Math.round(v * fator));
  // medidas de efeito em pixels da textura, no setup dos slots e nas chaves
  const MEDIDAS: Record<string, string> = { linha: "largura", brilho: "raio", dissolver: "grao" };
  const multiplica = (ef: string, o: any) => {
    const c = MEDIDAS[ef];
    if (c && typeof o?.[c] === "number") o[c] *= fator;
  };
  for (const s of b.slots ?? []) for (const [ef, o] of Object.entries<any>(s.efeitos ?? {})) multiplica(ef, o);
  for (const a of Object.values<any>(b.animacoes ?? {}))
    for (const efs of Object.values<any>(a.efeitos ?? {})) for (const [ef, ks] of Object.entries<any[]>(efs)) ks.forEach((k) => multiplica(ef, k));
  if (b.paginas.length > 1) console.log("aviso: medidas de efeito multiplicadas em todos os slots, mas so a pagina " + pagina + " mudou");
  writeFileSync(arqBoneco, JSON.stringify(b, null, 1) + "\n");
  console.log(`${arqBoneco}: pagina ${pagina} trocada por ${basename(saida)}`);
}
