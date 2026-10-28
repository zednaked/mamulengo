// Gera os PSDs de teste (tests/assets/psd) a partir das partes CC0 do corpus livre:
// o aventureiro montado em camadas com grupos, camadas escondidas e as tags do script
// PhotoshopToSpine, mais uma segunda versao (v2) com o que a arte costuma mudar depois
// de rigado (peca que mudou de lugar, que cresceu, desenho retocado, camada nova).
//
//   npx tsx tools/psd-fixture.ts [saida]     (padrao: tests/assets/psd)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { initializeCanvas, writePsdBuffer, type Layer, type Psd } from "ag-psd";

const HERE = dirname(fileURLToPath(import.meta.url));
const PARTES = join(HERE, "../tests/assets/aventureiro/partes");
const MONSTRO = join(HERE, "../tests/assets/monstro/partes");

initializeCanvas((() => { throw new Error("sem canvas"); }) as any, ((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })) as any);

interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

async function load(file: string, opts: { flip?: boolean; tint?: number[] } = {}): Promise<Img> {
  let s = sharp(file).ensureAlpha();
  if (opts.flip) s = s.flop();
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  const d = new Uint8ClampedArray(data);
  if (opts.tint) for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.round((d[i + c] * opts.tint[c]) / 255);
  return { width: info.width, height: info.height, data: d };
}

async function svg(w: number, h: number, body: string): Promise<Img> {
  const { data, info } = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

// desenha b por cima de a (normal), a cresce para caber (offset de b dentro do novo a)
function paste(a: Img, b: Img, bx: number, by: number): { img: Img; dx: number; dy: number } {
  const x0 = Math.min(0, bx),
    y0 = Math.min(0, by);
  const w = Math.max(a.width, bx + b.width) - x0,
    h = Math.max(a.height, by + b.height) - y0;
  const d = new Uint8ClampedArray(w * h * 4);
  const put = (src: Img, ox: number, oy: number) => {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const s = (y * src.width + x) * 4,
          t = ((y + oy) * w + (x + ox)) * 4;
        const as = src.data[s + 3] / 255,
          ad = d[t + 3] / 255;
        const A = as + ad * (1 - as);
        if (A <= 0) continue;
        for (let c = 0; c < 3; c++) d[t + c] = Math.round((src.data[s + c] * as + d[t + c] * ad * (1 - as)) / A);
        d[t + 3] = Math.round(A * 255);
      }
  };
  put(a, -x0, -y0);
  put(b, bx - x0, by - y0);
  return { img: { width: w, height: h, data: d }, dx: -x0, dy: -y0 };
}

// PSD 200x260; o personagem com os pes em y=250 e o centro em x=100 (camada [origin])
const W = 200,
  H = 260,
  OX = 100,
  OY = 250;

// camada com centro em coordenadas do personagem (y para cima, como corpus-build.ts)
function at(name: string, img: Img, center: [number, number], extra: Partial<Layer> = {}): Layer {
  const left = Math.round(OX + center[0] - img.width / 2),
    top = Math.round(OY - center[1] - img.height / 2);
  return { name, left, top, right: left + img.width, bottom: top + img.height, imageData: img as any, ...extra };
}

// a mesma camada com a imagem que cresceu (paste): o desenho antigo fica no mesmo lugar
const moved = (l: Layer, p: { img: Img; dx: number; dy: number }): Layer => {
  const left = l.left! - p.dx,
    top = l.top! - p.dy;
  return { ...l, left, top, right: left + p.img.width, bottom: top + p.img.height, imageData: p.img as any };
};

const group = (name: string, children: Layer[], extra: Partial<Layer> = {}): Layer => ({ name, opened: true, children, ...extra });

export async function fixture(v2: boolean): Promise<Psd> {
  const perna = await load(join(PARTES, "perna.png"));
  const pernaE = await load(join(PARTES, "perna.png"), { flip: true, ...(v2 ? { tint: [200, 220, 255] } : {}) });
  const corpo0 = await load(join(PARTES, "corpo.png"));
  let corpoLayer = at("corpo [mesh]", corpo0, [-1, 75]);
  const braco = await load(join(PARTES, "braco.png"));
  const bracoE = await load(join(PARTES, "braco.png"), { flip: true });
  const mao = await load(join(PARTES, "mao.png"));
  const maoE = await load(join(PARTES, "mao.png"), { flip: true });
  const cabeca0 = await load(join(PARTES, "cabeca.png"));
  let cabecaLayer = at("cabeca", cabeca0, [4.5, 151.5]);
  const susto = await load(join(PARTES, "cabeca_susto.png"));
  const antena = await load(join(MONSTRO, "antena.png"));
  const olhoFechado = await load(join(MONSTRO, "olho_fechado.png"));
  if (v2) {
    // a cabeca ganhou um topete (a imagem cresce 10 px para cima)
    const topete = await svg(40, 22, `<path d="M2 20 Q20 -6 38 20 Z" fill="#6b3d1e"/>`);
    const p = paste(cabeca0, topete, 40, -10);
    cabecaLayer = moved(cabecaLayer, p);
    // o corpo (malha) ganhou uma bolsa na esquerda (a imagem cresce 12 px para a esquerda)
    const bolsa = await svg(20, 24, `<rect x="0" y="0" width="20" height="24" rx="5" fill="#8a5a2b"/>`);
    const q = paste(corpo0, bolsa, -12, 40);
    corpoLayer = moved(corpoLayer, q);
  }
  const listra = await svg(74, 10, `<rect x="0" y="0" width="74" height="10" fill="#ffffff" fill-opacity="0.55"/>`);
  const brilho = await svg(60, 40, `<ellipse cx="30" cy="20" rx="28" ry="18" fill="#fff6c0"/>`);
  // mascara do brilho: some da esquerda para a direita
  const mascara = new Uint8ClampedArray(60 * 40 * 4);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) mascara.fill(Math.round((255 * x) / 59), (y * 60 + x) * 4, (y * 60 + x) * 4 + 4);
  const fivela = await svg(14, 10, `<rect x="0" y="0" width="14" height="10" rx="2" fill="#e0b040"/>`);
  const cinto = await svg(70, 8, `<rect x="0" y="0" width="70" height="8" fill="#3b2a1a"/>`);
  const rascunho = await svg(180, 6, `<rect x="0" y="0" width="180" height="6" fill="#ff0000"/>`);
  const dot = await svg(2, 2, `<rect x="0" y="0" width="2" height="2" fill="#00ff00"/>`);
  const fundo = await svg(W, H, `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  const chapeu = await svg(70, 30, `<path d="M0 28 L70 28 L58 18 L50 0 L20 0 L12 18 Z" fill="#2d6a4f"/>`);

  const maoD = at("mao_d", mao, [49.5 + (v2 ? 6 : 0), 30 + (v2 ? 4 : 0)]);
  const brilhoLayer = at("brilho", brilho, [10, 165], { blendMode: "linear dodge", opacity: 0.6 });
  brilhoLayer.mask = { top: brilhoLayer.top, left: brilhoLayer.left, bottom: brilhoLayer.bottom, right: brilhoLayer.right, defaultColor: 0, imageData: { width: 60, height: 40, data: mascara } as any };

  // ordem do ag-psd: children[0] e a camada de baixo
  const children: Layer[] = [
    { name: "Fundo", left: 0, top: 0, right: W, bottom: H, imageData: fundo as any },
    group("[bone:quadril] corpo todo", [
      at("perna_e", pernaE, [-20, 29]),
      at("perna_d", perna, [20, 29]),
      group("[bone:tronco]", [
        corpoLayer,
        at("listra", listra, [-1, 70], { clipping: true }),
        group("[merge] cinto", [at("couro", cinto, [-1, 56]), at("fivela", fivela, [-1, 56])]),
        group("[name:*_e] esquerda", [at("[bone:braco_e] braco", bracoE, [-45, 65]), at("mao", maoE, [-49.5, 30])]),
        at("[bone:braco_d] braco_d", braco, [45, 65]),
        maoD,
        group("[bone:cabeca]", [
          group("[slot:cabeca] rostos", [cabecaLayer, at("cabeca_susto", susto, [4.5, 151.5], { hidden: true })]),
          group("[folder:rosto] detalhes", [at("olho_fechado [scale:0.5]", olhoFechado, [20, 150], { hidden: true })]),
          group("[skin:monstro] fantasia", [at("antena", antena, [4.5, 225])], { hidden: true }),
          ...(v2 ? [at("chapeu", chapeu, [4.5, 205])] : []),
        ]),
      ]),
    ]),
    brilhoLayer,
    at("[ignore] rascunho", rascunho, [0, 120]),
    at("[origin]", dot, [0, 0]),
  ];
  return { width: W, height: H, children };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(HERE, "../tests/assets/psd"));
  mkdirSync(out, { recursive: true });
  for (const [name, v2] of [["aventureiro.psd", false], ["aventureiro-v2.psd", true]] as const) {
    const buf = writePsdBuffer(await fixture(v2), { noBackground: true });
    writeFileSync(join(out, name), buf);
    console.log(`${name}: ${buf.length} bytes`);
  }
}
