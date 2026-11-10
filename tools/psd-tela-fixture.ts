// Gera o PSD de teste da tela (tests/assets/psd/tela.psd): a tela de exemplos/coelho (o menu) desenhada como um
// designer entregaria, em camadas, seguindo a convencao de nomes (docs/LAYOUT-PSD.md). Arte da Kenney
// (CC0, exemplos/coelho/kenney) e o ceu, as nuvens e a grama desenhados aqui. Os textos sao camadas de
// texto de verdade (texto, fonte Kenney Future, tamanho, cor, alinhamento, sombra) com a tinta
// desenhada pela propria fonte (src/core/fonte.ts), para o PSD se ver como a tela.
//
//   fundo        ceu (a arte inteira)
//   nuvens       nuvem_1, nuvem_2
//   chao         grama (faixa de largura total no rodape)
//   heroi        ilha e o grupo coelho
//   topo         9_barra (nove-fatias pelo nome)
//   placar       moeda e txt_placar (texto do codigo)
//   btn_pausa    redondo e pausa (botao sem imagens por estado: as poses padrao)
//   btn_jogar    normal, apertado, desligado (os estados) e o texto JOGAR
//   painel       9_painel, 9_titulo, MISSOES, as caixas de marcar e os textos MOEDAS, PULOS, CENOURA
//
//   npx tsx tools/psd-tela-fixture.ts [saida.psd]     (padrao: tests/assets/psd/tela.psd)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { initializeCanvas, writePsdBuffer, type Layer } from "ag-psd";
import { lerFonte, type Fonte } from "../src/core/fonte.ts";
import { nomesDaFonte } from "../src/core/psd-tela.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const KENNEY = join(HERE, "../exemplos/coelho/kenney");
initializeCanvas((() => { throw new Error("sem canvas"); }) as any, ((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })) as any);

type Img = { width: number; height: number; data: Uint8ClampedArray };
const W = 700,
  H = 1370;

async function raw(s: sharp.Sharp): Promise<Img> {
  const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}
const svg = (w: number, h: number, corpo: string) => raw(sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${corpo}</svg>`)));
async function kenney(arq: string, w: number, h?: number): Promise<Img> {
  const m = await sharp(join(KENNEY, arq)).metadata();
  return raw(sharp(join(KENNEY, arq)).resize(Math.round(w), Math.round(h ?? (w * m.height!) / m.width!), { kernel: "lanczos3", fit: "fill" }));
}
function tinge(im: Img, rgb: number[], k = 1): Img {
  const d = new Uint8ClampedArray(im.data);
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.round(((d[i + c] * rgb[c]) / 255) * k);
  return { ...im, data: d };
}
function cinza(im: Img, k: number): Img {
  const d = new Uint8ClampedArray(im.data);
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * k;
    d[i] = d[i + 1] = d[i + 2] = Math.round(l);
  }
  return { ...im, data: d };
}
// a imagem pequena esticada como nove-fatias (o que o designer faz no Photoshop com a peca do kit)
function nove(im: Img, m: [number, number, number, number], w: number, h: number): Img {
  const [l, t, r, b] = m;
  const out = new Uint8ClampedArray(w * h * 4);
  const mapa = (v: number, tam: number, a: number, z: number, src: number) => (v < a ? v : v >= tam - z ? src - (tam - v) : a + Math.min(src - a - z - 1, Math.floor(((v - a) * (src - a - z)) / (tam - a - z))));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = mapa(x, w, l, r, im.width),
        sy = mapa(y, h, t, b, im.height);
      out.set(im.data.subarray((sy * im.width + sx) * 4, (sy * im.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  return { width: w, height: h, data: out };
}

// ---- o texto pela fonte: os contornos TrueType num SVG, recortado na tinta
const fonteBytes = new Uint8Array(readFileSync(join(KENNEY, "kenney-future.ttf")));
const fonte: Fonte = lerFonte(fonteBytes);
const FONTE_PS = nomesDaFonte(fonteBytes).find((n) => !/\s/.test(n)) ?? "KenneyFuture";
function caminho(f: Fonte, texto: string, s: number, x0: number, base: number): { d: string; larg: number } {
  let x = x0;
  let d = "";
  const k = s / f.unidades;
  for (const ch of texto) {
    const g = f.glifo(ch.codePointAt(0)!);
    for (const c of f.contornos(g)) {
      const pts = c.map((p) => ({ x: x + p.x * k, y: base - p.y * k, on: p.on }));
      if (pts.length < 2) continue;
      let i0 = pts.findIndex((p) => p.on);
      let ini = i0 >= 0 ? pts[i0] : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, on: true };
      if (i0 < 0) i0 = 0;
      d += `M${ini.x.toFixed(2)} ${ini.y.toFixed(2)}`;
      const n = pts.length;
      for (let j = 1; j <= n; j++) {
        const p = pts[(i0 + j) % n];
        if (p.on) {
          d += `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
          continue;
        }
        const q = pts[(i0 + j + 1) % n];
        const fim = q.on ? q : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        d += `Q${p.x.toFixed(2)} ${p.y.toFixed(2)} ${fim.x.toFixed(2)} ${fim.y.toFixed(2)}`;
        if (q.on) j++;
      }
      d += "Z";
      void ini;
    }
    x += f.avanco(g) * k;
  }
  return { d, larg: x - x0 };
}
const hexRgb = (h: string) => ({ r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) });
// camada de texto: x e o ponto do alinhamento (esquerda, meio ou direita da tinta), y o meio da tinta
async function texto(nome: string, t: string, o: { tam: number; cor: string; x: number; y: number; alinhar?: "left" | "center" | "right"; sombra?: string }): Promise<Layer> {
  const alinhar = o.alinhar ?? "center";
  const pad = 8;
  const { d, larg } = caminho(fonte, t, o.tam, pad, pad + o.tam);
  const w = Math.ceil(larg + pad * 2),
    h = Math.ceil(o.tam * 1.5 + pad * 2);
  const sombra = o.sombra ? `<path d="${d}" fill="#${o.sombra}" transform="translate(0 3)"/>` : "";
  const im = await svg(w, h, `${sombra}<path d="${d}" fill="#${o.cor}"/>`);
  // a tinta
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (im.data[(y * w + x) * 4 + 3] > 0) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const tw = x1 - x0 + 1,
    th = y1 - y0 + 1;
  const left = Math.round(alinhar === "left" ? o.x : alinhar === "right" ? o.x - tw : o.x - tw / 2) - x0;
  const top = Math.round(o.y - th / 2) - y0;
  return {
    name: nome,
    left,
    top,
    right: left + w,
    bottom: top + h,
    imageData: im as any,
    text: {
      text: t,
      transform: [1, 0, 0, 1, alinhar === "left" ? o.x : alinhar === "right" ? o.x : o.x, o.y + o.tam * 0.35],
      style: { font: { name: FONTE_PS }, fontSize: o.tam, fillColor: hexRgb(o.cor) },
      paragraphStyle: { justification: alinhar },
    },
    ...(o.sombra ? { effects: { dropShadow: [{ enabled: true, color: hexRgb(o.sombra), distance: { units: "Pixels", value: 3 }, angle: 90, size: { units: "Pixels", value: 0 }, opacity: 1 } as any] } } : {}),
  };
}

// camada com o meio em (x, y)
const at = (name: string, im: Img, x: number, y: number, extra: Partial<Layer> = {}): Layer => {
  const left = Math.round(x - im.width / 2),
    top = Math.round(y - im.height / 2);
  return { name, left, top, right: left + im.width, bottom: top + im.height, imageData: im as any, ...extra };
};
const grupo = (name: string, children: Layer[]): Layer => ({ name, opened: true, children });

export async function telaPsd() {
  const ceu = await svg(W, H, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb7f0"/><stop offset="0.65" stop-color="#bfe7ff"/><stop offset="1" stop-color="#e9f8ff"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`);
  const nuvem = await svg(220, 90, `<g fill="#fff" opacity="0.9"><ellipse cx="70" cy="58" rx="60" ry="30"/><ellipse cx="120" cy="40" rx="55" ry="36"/><ellipse cx="165" cy="60" rx="50" ry="26"/></g>`);
  const grama = await svg(W, 200, `<rect y="26" width="${W}" height="174" fill="#7a5a3a"/><rect y="0" width="${W}" height="40" fill="#6cc04a"/><rect y="30" width="${W}" height="10" fill="#4f9a35"/>`);
  const pausa = await svg(24, 30, `<rect x="0" width="8" height="30" rx="2" fill="#fff"/><rect x="16" width="8" height="30" rx="2" fill="#fff"/>`);
  const coelho = await kenney("bunny1_stand.png", 120);
  const ilha = await kenney("ground_grass.png", 300);
  const moeda = await kenney("gold_1.png", 58);
  const redondo = await kenney("redondo_azul.png", 84);
  const marcado = await kenney("marcado.png", 34);
  const vazio = await kenney("vazio.png", 34);
  // as pecas do UI Pack esticadas como nove-fatias (no tamanho da tela)
  const barra = nove(tinge(await kenney("barra_cinza.png", 192, 64), [0x3d, 0x4f, 0x8c]), [16, 14, 16, 20], 684, 98);
  const botao = nove(await kenney("botao_verde.png", 192, 64), [16, 16, 16, 22], 270, 92);
  const painel = nove(await kenney("painel_azul.png", 128, 128), [22, 22, 22, 22], 268, 340);
  const titulo = nove(await kenney("titulo_azul.png", 192, 64), [14, 14, 14, 20], 214, 58);

  // ordem do ag-psd: children[0] e a camada de baixo
  const children: Layer[] = [
    grupo("fundo", [at("ceu", ceu, W / 2, H / 2)]),
    grupo("nuvens", [at("nuvem_1", nuvem, 160, 370), at("nuvem_2", nuvem, 520, 490, { opacity: 0.8 })]),
    grupo("chao", [at("grama", grama, W / 2, H - 100)]),
    grupo("heroi", [at("ilha", ilha, 350, 760), grupo("coelho", [at("coelho", coelho, 350, 630)])]),
    grupo("topo", [at("9_barra", barra, 350, 51)]),
    grupo("placar", [at("moeda", moeda, 44, 52), await texto("txt_placar", "1250", { tam: 40, cor: "ffffff", x: 92, y: 52, alinhar: "left" })]),
    grupo("btn_pausa", [at("redondo", redondo, 642, 54), at("pausa", pausa, 642, 51)]),
    grupo("btn_jogar", [
      at("desligado", cinza(botao, 0.55), 350, 1120, { hidden: true }),
      at("apertado", tinge(botao, [200, 216, 200]), 350, 1120, { hidden: true }),
      at("normal", botao, 350, 1120),
      await texto("JOGAR", "JOGAR", { tam: 40, cor: "ffffff", x: 350, y: 1114, sombra: "1d7a4a" }),
    ]),
    grupo("painel", [
      at("9_painel", painel, 550, 690),
      at("9_titulo", titulo, 550, 557),
      await texto("MISSOES", "MISSÕES", { tam: 28, cor: "ffffff", x: 550, y: 553 }),
      ...(await Promise.all(
        ["MOEDAS", "PULOS", "CENOURA"].map(async (k, i) => [
          at(`m${i + 1}_caixa`, i === 0 ? marcado : vazio, 462, 630 + 70 * i),
          await texto(k, ["3 moedas", "10 pulos", "a cenoura"][i], { tam: 22, cor: "4a3f78", x: 490, y: 630 + 70 * i, alinhar: "left" }),
        ]),
      )).flat(),
    ]),
  ];
  return { width: W, height: H, children };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(HERE, "../tests/assets/psd/tela.psd"));
  const buf = writePsdBuffer(await telaPsd(), { noBackground: true, invalidateTextLayers: false } as any);
  writeFileSync(out, buf);
  console.log(`${out}: ${buf.length} bytes (fonte ${FONTE_PS})`);
}
