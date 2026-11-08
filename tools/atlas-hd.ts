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
// O plano (quais objetos, os retangulos) e a troca no .boneco sao de src/core/atlas-hd.ts, os mesmos
// do editor pelo navegador; aqui so o rasterizar.
//
// O transform dos grupos que contem o objeto nao entra (o objeto e desenhado sozinho); como cada
// parte e cortada e esticada para o retangulo dela, so a proporcao importa.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { arquivoHd, gravarHd, ID_PARTE, planoAtlasHd, resumoHd, svgDaParte } from "../src/core/atlas-hd.ts";

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
const svg = readFileSync(arqSvg, "utf8");
const plano = planoAtlasHd(b, svg, { fator, modelo, pagina });
const pasta = dirname(resolve(arqBoneco));
const original = join(pasta, plano.arquivo);
const saida = resolve(saidaOpt || join(pasta, arquivoHd(plano.arquivo)));

const tmp = mkdtempSync(join(tmpdir(), "atlas-hd-"));
try {
  const camadas: string[] = [];
  for (const parte of plano.partes) {
    const [x, y, w, h] = parte.ret;
    const png = join(tmp, `${camadas.length}.png`);
    if (parte.ids.length) {
      // os objetos desenhados sozinhos e cortados no tamanho deles; o zoom sai da primeira passada
      // para a parte nascer pelo menos do tamanho do retangulo
      const doc = join(tmp, "parte.svg");
      writeFileSync(doc, svgDaParte(svg, parte.ids));
      roda("rsvg-convert", ["-i", ID_PARTE, doc, "-o", png]);
      const [pw, ph] = roda("magick", [png, "-trim", "-format", "%w %h", "info:"]).split(" ").map(Number);
      const zoom = Math.max(1, (w / pw) * 1.5, (h / ph) * 1.5);
      roda("rsvg-convert", ["-i", ID_PARTE, "-z", String(zoom), doc, "-o", png]);
      // sem o transparente e no tamanho exato do retangulo (a borda suavizada pode sobrar 1 px)
      roda("magick", [png, "-trim", "+repage", "-resize", `${w}x${h}!`, png]);
    } else {
      const [ox, oy, rw, rh] = parte.recorte;
      const [aw, ah] = parte.ampliada;
      roda("magick", [original, "-crop", `${rw}x${rh}+${ox}+${oy}`, "+repage", "-filter", "Lanczos", "-resize", `${aw}x${ah}!`, png]);
    }
    camadas.push(png, "-geometry", `+${x}+${y}`, "-composite");
  }
  const [lg, al] = plano.tamanho;
  roda("magick", ["-size", `${lg}x${al}`, "xc:none", ...camadas, "-define", "webp:lossless=true", saida]);
  console.log(resumoHd(saida, plano));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (gravar) {
  const aviso = gravarHd(b, pagina, fator, basename(saida));
  if (aviso) console.log(aviso);
  writeFileSync(arqBoneco, JSON.stringify(b, null, 1) + "\n");
  console.log(`${arqBoneco}: pagina ${pagina} trocada por ${basename(saida)}`);
}
