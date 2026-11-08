// A abducao: um exemplo do Mamulengo com dois packs CC0 da Kenney (Alien UFO pack e Background
// elements), o robo de tests/boneco e, na abertura e no fechamento, o icone e o nome da vinheta
// (exemplos/vinheta). Doze segundos e meio, num laco (animacao "abducao"):
//
//   0,0-2,0   abertura: ceu de noite, o nome chega letra a letra e a marionete desce nos fios
//   2,0-3,0   a vista desce do ceu para a paisagem (camadas em paralaxe)
//   3,0-4,0   noite no campo: morros, arvores balancando, a casa com a janela acesa, o robo
//   4,0-5,4   o disco chega em zigue-zague e paira em cima do robo; o robo se assusta
//   5,4-8,0   o feixe desce, acende o chao, as arvores se curvam e o robo sobe girando
//   8,0-9,0   o feixe recolhe e o disco foge rasgando o ceu
//   9,0-10,0  a vista sobe de volta ao ceu
//   10,0-12,5 o disco atravessa o ceu soltando as letras; a marionete desce e agradece; escurece
//
// Arquivos (todos gerados aqui):
//   disco.boneco    o disco rosa tripulado: corpo, piloto no capacete, pernas de pouso, luzes da
//                   borda; animacoes paira (pernas abertas) e voa (pernas recolhidas, rastro)
//   arvore.boneco   uma arvore por skin, presa na base; animacoes balanca e vento
//   abducao.boneco  a cena; instancias do disco, das arvores, do robo, das letras e da marionete
//   robo.boneco, letra.boneco, marionete.boneco e as paginas deles: copiados de tests/boneco e
//   de exemplos/vinheta
//
//   npx tsx exemplos/abducao/gerar.ts
//
// As fontes da Kenney (CC0) estao em fontes/: o SVG dos discos (recortado e renderizado em alta
// resolucao) e os PNGs do fundo.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTES = join(AQUI, "fontes");
const REPO = join(AQUI, "..", "..");
const DUR = 13.5;
const HD = 2; // pixels da textura por pixel do mundo (o que sai do SVG)
const ROSA = "ff2e88";
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, z: number) => Math.min(z, Math.max(a, x));
const suave = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const entre = (t: number, a: number, z: number) => suave((t - a) / (z - a));
const mistura = (a: number, z: number, f: number) => a + (z - a) * f;
const sino = (t: number, a: number, z: number) => (t <= a || t >= z ? 0 : Math.sin((Math.PI * (t - a)) / (z - a)));
const alfa = (cor: string, a: number) => cor + Math.round(255 * clamp(a, 0, 1)).toString(16).padStart(2, "0");
const de = (ini: number, fim: number, passo = 1 / 30) => {
  const n = Math.max(1, Math.round((fim - ini) / passo));
  return Array.from({ length: n + 1 }, (_, k) => r3(ini + ((fim - ini) * k) / n));
};

// ---- imagens e atlas (o mesmo esquema da vinheta: prateleiras, cada arquivo com as paginas dele)
type Img = { nome: string; data: Buffer; w: number; h: number };
class Atlas {
  paginas: any[] = [];
  imagens: any[] = [];
  private porPagina: Img[][] = [];
  constructor(private arquivos: { arquivo: string; largura: number; relevo?: string }[]) {
    this.porPagina = arquivos.map(() => []);
  }
  async png(pagina: number, nome: string, buf: Buffer, opts: { branco?: boolean; escala?: number } = {}): Promise<Img> {
    let s = sharp(buf).ensureAlpha();
    if (opts.escala && opts.escala !== 1) {
      const m = await sharp(buf).metadata();
      s = s.resize(Math.round(m.width! * opts.escala), Math.round(m.height! * opts.escala), { kernel: "lanczos3" });
    }
    let { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
    // silhueta branca (a cor vem do slot): mantem so o alfa
    if (opts.branco) for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255;
    const im = { nome, data, w: info.width, h: info.height };
    this.porPagina[pagina].push(im);
    return im;
  }
  async svg(pagina: number, nome: string, w: number, h: number, corpo: string): Promise<Img> {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corpo}</svg>`;
    const { data, info } = await sharp(Buffer.from(s)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const im = { nome, data, w: info.width, h: info.height };
    this.porPagina[pagina].push(im);
    return im;
  }
  async montar() {
    for (let p = 0; p < this.arquivos.length; p++) {
      const { arquivo, largura, relevo } = this.arquivos[p];
      let [x, y, alt] = [0, 0, 0];
      const lugares: [Img, number, number][] = [];
      for (const im of [...this.porPagina[p]].sort((a, b) => b.h - a.h)) {
        if (x + im.w > largura) [x, y, alt] = [0, y + alt + 4, 0];
        lugares.push([im, x, y]);
        this.imagens.push({ nome: im.nome, pagina: p, ret: [x, y, im.w, im.h] });
        x += im.w + 4;
        alt = Math.max(alt, im.h);
      }
      await sharp({ create: { width: largura, height: y + alt, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(lugares.map(([im, left, top]) => ({ input: im.data, raw: { width: im.w, height: im.h, channels: 4 as const }, left, top })))
        .png()
        .toFile(join(AQUI, arquivo));
      this.paginas.push({ arquivo, tamanho: [largura, y + alt], ...(relevo ? { relevo } : {}) });
    }
  }
}

// um pedaco do SVG dos discos (coordenadas do SVG), em `esc` pixels por unidade, recortado ao
// que tem desenho; devolve tambem onde o recorte caiu (em unidades do SVG), para montar as pecas
// nas posicoes do desenho original
const SVG_DISCO = readFileSync(join(FONTES, "disco.svg"), "utf8");
async function recorteSvg(ret: [number, number, number, number], esc: number, mascara?: { cx: number; cy: number; r: number }) {
  const [x, y, w, h] = ret;
  let svg = SVG_DISCO.replace(/width="550px" height="400px" viewBox="0 0 550 400"/, `width="${Math.round(w * esc)}px" height="${Math.round(h * esc)}px" viewBox="${x} ${y} ${w} ${h}"`);
  if (mascara) {
    // so o que esta dentro do circulo (o capacete do piloto, sem o resto do disco)
    svg = svg.replace("<defs>", `<defs><clipPath id="m"><circle cx="${mascara.cx}" cy="${mascara.cy}" r="${mascara.r}"/></clipPath>`).replace(/(<\/defs>)/, `$1<g clip-path="url(#m)">`).replace(/<\/svg>\s*$/, "</g></svg>");
  }
  const cru = await sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(cru).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  // trimOffsetLeft/Top vem negativos (o quanto foi cortado)
  const ox = -(info.trimOffsetLeft ?? 0) / esc,
    oy = -(info.trimOffsetTop ?? 0) / esc;
  return { buf: data, x: x + ox, y: y + oy, w: info.width / esc, h: info.height / esc };
}

// timelines (o mesmo da vinheta)
class Anim {
  ossos: Record<string, Record<string, any[]>> = {};
  slots: Record<string, Record<string, any[]>> = {};
  efeitos: Record<string, Record<string, any[]>> = {};
  particulas: Record<string, Record<string, any[]>> = {};
  luzes: Record<string, any[]> = {};
  instancias: Record<string, any[]> = {};
  ambiente?: any[];
  osso(o: string, prop: string, t: number, v: any) {
    ((this.ossos[o] ??= {})[prop] ??= []).push({ tempo: r3(t), ...v });
  }
  json() {
    const out: any = {};
    for (const k of ["ossos", "slots", "efeitos", "particulas", "luzes", "instancias"] as const) if (Object.keys(this[k]).length) out[k] = this[k];
    if (this.ambiente) out.ambiente = this.ambiente;
    return out;
  }
}
const escreve = (arquivo: string, b: any) => writeFileSync(join(AQUI, arquivo), JSON.stringify(b, null, 1) + "\n");

// =====================================================================================
// disco.boneco: o disco rosa tripulado (coluna rosa do SVG)
// =====================================================================================
// escala do disco no mundo: o corpo (125 unidades do SVG) com uns 240 px
const ESC_DISCO = 1.6;
const RD = ESC_DISCO * HD; // pixels de textura por unidade do SVG
const atlasDisco = new Atlas([{ arquivo: "disco.png", largura: 1024, relevo: "disco_relevo.png" }]);
const corpo = await recorteSvg([372, 12, 140, 95], RD);
// o piloto vem da linha dos tripulados (390 unidades abaixo), so o capacete
const LINHA_TRIPULADO = 390;
const piloto = await recorteSvg([400, 348, 80, 80], RD, { cx: 440.5, cy: 386.5, r: 33 });
const pernaE = await recorteSvg([398, 282, 42, 66], RD);
const pernaD = await recorteSvg([441, 282, 42, 66], RD);
const dano = await recorteSvg([372, 600, 140, 95], RD);
await atlasDisco.png(0, "corpo", corpo.buf);
// a borda da frente do corpo: o que fica abaixo do meio do buraco da cabine, sem o escuro dele. O
// piloto vai entre o corpo e a borda: sai de dentro do buraco, como no desenho da Kenney
{
  const { data, info } = await sharp(corpo.buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const escuro = (i: number) => data[i + 3] > 200 && data[i] < 110 && data[i + 1] < 110 && data[i + 2] < 110;
  let [y0, y1] = [info.height, -1];
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (escuro((y * info.width + x) * 4)) [y0, y1] = [Math.min(y0, y), Math.max(y1, y)];
  const meio = (y0 + y1) / 2;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (y < meio || escuro(i)) data[i + 3] = 0;
    }
  await atlasDisco.png(0, "aro", await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
}
await atlasDisco.png(0, "corpo_dano", dano.buf);
await atlasDisco.png(0, "piloto", piloto.buf);
await atlasDisco.png(0, "perna_e", pernaE.buf);
await atlasDisco.png(0, "perna_d", pernaD.buf);
await atlasDisco.svg(0, "luz", 48, 48, `<defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="24" cy="24" r="24" fill="url(#g)"/>`);
await atlasDisco.montar();
// o centro do corpo (em unidades do SVG) e a origem do disco; y do mundo para cima
const CX = corpo.x + corpo.w / 2,
  CY = corpo.y + corpo.h / 2;
const mundo = (x: number, y: number) => ({ x: r3((x - CX) * ESC_DISCO), y: r3(-(y - CY) * ESC_DISCO) });
const centro = (p: { x: number; y: number; w: number; h: number }, dy = 0) => mundo(p.x + p.w / 2, p.y + p.h / 2 - dy);
const parte = (p: { w: number; h: number }, extra: any = {}) => ({ largura: r3(p.w * ESC_DISCO), altura: r3(p.h * ESC_DISCO), ...extra });
// o piloto ajustado no editor (sentado mais fundo na cabine): o recorte do SVG o deixava
// alto demais
const pPiloto = { x: -3.086, y: 61.214 };
void centro(piloto, LINHA_TRIPULADO);
// as pernas saem de dentro do casco (o topo delas fica atras do corpo), perto do meio
const pPernaE = { x: -24 * ESC_DISCO, y: -14 * ESC_DISCO };
const pPernaD = { x: 24 * ESC_DISCO, y: -14 * ESC_DISCO };
// as bolinhas das laterais do corpo (luzes)
const pLuzE = mundo(corpo.x + 9, corpo.y + 21),
  pLuzD = mundo(corpo.x + corpo.w - 9, corpo.y + 21);
{
  const voa = new Anim(),
    foge = new Anim(),
    paira = new Anim();
  // paira: balanco lento, pernas abertas, o piloto olhando para os lados, luzes alternando
  const P = 1.6;
  for (const t of de(0, P, P / 24)) {
    const f = (2 * Math.PI * t) / P;
    paira.osso("disco", "mover", t, { x: 0, y: r3(5 * Math.sin(f)) });
    paira.osso("disco", "girar", t, { valor: r3(2.5 * Math.sin(f + 0.8)) });
    paira.osso("piloto", "girar", t, { valor: r3(9 * Math.sin(2 * f)) });
    paira.osso("piloto", "mover", t, { x: r3(3 * Math.sin(2 * f)), y: 0 });
  }
  // voa (e foge): rapido, pernas recolhidas para dentro do corpo
  const V = 0.5;
  for (const an of [voa, foge])
    for (const t of de(0, V, V / 12)) {
      const f = (2 * Math.PI * t) / V;
      an.osso("disco", "mover", t, { x: 0, y: r3(3 * Math.sin(f)) });
      an.osso("disco", "girar", t, { valor: r3(2.5 * Math.sin(f)) });
      an.osso("piloto", "girar", t, { valor: r3(-5 + 3 * Math.sin(2 * f)) });
    }
  for (const [an, dur, aberta] of [
    [paira, P, true],
    [voa, V, false],
    [foge, V, false],
  ] as const) {
    // recolhidas: encolhidas no comprimento e subidas para dentro do corpo (que fica na frente)
    for (const p of ["perna_e", "perna_d"]) {
      an.osso(p, "escalar", 0, { x: aberta ? 1 : 0.8, y: aberta ? 1 : 0.15 });
      an.osso(p, "mover", 0, { x: 0, y: aberta ? 0 : 26 });
    }
    // as luzes da borda piscam alternando
    const passo = dur / 4;
    for (const [k, s] of (["luz_e", "luz_d"] as const).entries())
      an.slots[s] = { rgba: de(0, dur, passo).map((t, i) => ({ tempo: t, cor: alfa("ffd6ec", (i + k) % 2 ? 1 : 0.25) })) };
  }
  // o rastro so na fuga (e na travessia do fechamento); na chegada ele embolava com o zigue-zague
  foge.efeitos.corpo = { rastro: [{ tempo: 0, copias: 4, intervalo: 0.04, alfa: 0.3 }] };
  escreve("disco.boneco", {
    boneco: 0,
    nome: "disco",
    paginas: atlasDisco.paginas,
    imagens: atlasDisco.imagens,
    esqueleto: { largura: 280, altura: 260 },
    ossos: [
      { nome: "root" },
      { nome: "disco", pai: "root" },
      { nome: "piloto", pai: "disco", x: pPiloto.x, y: pPiloto.y },
      { nome: "perna_e", pai: "disco", x: r3(pPernaE.x), y: r3(pPernaE.y) },
      { nome: "perna_d", pai: "disco", x: r3(pPernaD.x), y: r3(pPernaD.y) },
      { nome: "luz_e", pai: "disco", x: pLuzE.x, y: pLuzE.y },
      { nome: "luz_d", pai: "disco", x: pLuzD.x, y: pLuzD.y },
    ],
    slots: [
      { nome: "perna_e", osso: "perna_e", parte: "perna_e" },
      { nome: "perna_d", osso: "perna_d", parte: "perna_d" },
      { nome: "corpo", osso: "disco", parte: "corpo", efeitos: { rastro: { copias: 0, intervalo: 0.04, alfa: 0.3 } } },
      { nome: "piloto", osso: "piloto", parte: "piloto" },
      { nome: "aro", osso: "disco", parte: "aro" },
      { nome: "luz_e", osso: "luz_e", parte: "luz", blend: "aditivo", cor: "ffd6ecff" },
      { nome: "luz_d", osso: "luz_d", parte: "luz", blend: "aditivo", cor: "ffd6ecff" },
    ],
    skins: [
      {
        nome: "default",
        partes: {
          piloto: { piloto: parte(piloto) },
          // as pernas penduradas pelo topo
          perna_e: { perna_e: parte(pernaE, { x: -4, y: r3((-pernaE.h * ESC_DISCO) / 2) }) },
          perna_d: { perna_d: parte(pernaD, { x: 4, y: r3((-pernaD.h * ESC_DISCO) / 2) }) },
          corpo: { corpo: parte(corpo), corpo_dano: parte(dano) },
          aro: { aro: parte(corpo) },
          luz_e: { luz: { largura: 30, altura: 30 } },
          luz_d: { luz: { largura: 30, altura: 30 } },
        },
      },
    ],
    animacoes: { paira: paira.json(), voa: voa.json(), foge: foge.json() },
  });
}

// =====================================================================================
// arvore.boneco: uma arvore por skin, presa na base (a copa balanca em volta do pe)
// =====================================================================================
const ARVORES = ["tree01", "tree02", "tree05", "tree10", "tree20", "tree24"];
// as arvores e o resto do fundo vem dos PNGs (1 px = 1 px do mundo, com um pouco de folga)
const ESC_FUNDO = 1.15;
const atlasArvore = new Atlas([{ arquivo: "arvore.png", largura: 1024, relevo: "arvore_relevo.png" }]);
const tamArvore: Record<string, { w: number; h: number }> = {};
for (const a of ARVORES) {
  const im = await atlasArvore.png(0, a, readFileSync(join(FONTES, `${a}.png`)), { escala: HD * ESC_FUNDO });
  tamArvore[a] = { w: im.w / HD, h: im.h / HD };
}
await atlasArvore.montar();
{
  const balanca = new Anim(),
    vento = new Anim();
  const B = 2.4,
    W = 0.6;
  for (const t of de(0, B, B / 16)) balanca.osso("arvore", "girar", t, { valor: r3(1.6 * Math.sin((2 * Math.PI * t) / B)) });
  // vento: puxada para um lado (a cena gira a instancia para o lado do feixe) e tremendo
  for (const t of de(0, W, W / 12)) vento.osso("arvore", "girar", t, { valor: r3(-2.5 + 2.5 * Math.sin((2 * Math.PI * t) / W)) });
  escreve("arvore.boneco", {
    boneco: 0,
    nome: "arvore",
    paginas: atlasArvore.paginas,
    imagens: atlasArvore.imagens,
    ossos: [{ nome: "root" }, { nome: "arvore", pai: "root", rotacao: 90 }],
    slots: [{ nome: "arvore", osso: "arvore", parte: "arvore" }],
    skins: [
      { nome: "default", partes: {} },
      // a imagem de pe sobre o osso (que aponta para cima: rotacao 90)
      ...ARVORES.map((a) => ({ nome: a, partes: { arvore: { arvore: { caminho: a, largura: r3(tamArvore[a].w), altura: r3(tamArvore[a].h), x: r3(tamArvore[a].h / 2), rotacao: -90 } } } })),
    ],
    animacoes: { balanca: balanca.json(), vento: vento.json() },
  });
}

// =====================================================================================
// copias: o robo (tests/boneco) e o icone e o nome (exemplos/vinheta)
// =====================================================================================
for (const f of ["robo.boneco", "robo-hd.webp"]) copyFileSync(join(REPO, "tests", "boneco", "robo", f), join(AQUI, f));
for (const f of ["letra.boneco", "letra.png", "letra_anel.png", "letra_relevo.png", "marionete.boneco", "marionete.png", "marionete_efeitos.png", "marionete_relevo.png"])
  copyFileSync(join(REPO, "exemplos", "vinheta", f), join(AQUI, f));
const vinheta = JSON.parse(readFileSync(join(REPO, "exemplos", "vinheta", "vinheta.boneco"), "utf8"));
const LETRAS = vinheta.ossos.filter((o: any) => /^letra_\d+$/.test(o.nome)).map((o: any) => ({ x: o.x, y: o.y, skin: vinheta.instancias.find((i: any) => i.nome === o.nome).skin }));

// =====================================================================================
// abducao.boneco: a cena
// =====================================================================================
// vista: 960x540, origem no centro, y para cima. A "camera" e o quanto a paisagem subiu para o
// quadro: 0 no ceu (abertura e fechamento), 1 na paisagem. Cada camada anda D * k (paralaxe)
const D = 600;
const cam = (t: number) => (t < 2 ? 0 : t < 3 ? entre(t, 2, 3) : t < 9 ? 1 : t < 10 ? 1 - entre(t, 9, 10) : 0);
// k de cada camada da paisagem (o chao anda tudo; o fundo, menos)
// O disco, o feixe e as explosoes ficam no plano do robo (o mesmo k dos morros de perto): qualquer
// movimento de camera os leva juntos e o feixe nao descola do robo. O primeiro plano (silhuetas)
// anda mais que o chao
const CAMADAS: [string, number][] = [
  ["estrelas", 0.12],
  ["lua", 0.15],
  ["nuvens", 0.25],
  ["montanhas", 0.35],
  ["morros_longe", 0.6],
  ["morros_perto", 0.85],
  ["plano_disco", 0.85],
  ["chao", 1],
  ["primeiro_plano", 1.3],
];
// as cores da noite (as faixas da Kenney vem brancas: a cor e do slot)
const NOITE = { montanhas: "3d4f8e", nuvens: "8a90c8", longe: "35577a", perto: "26425a", chao: "1d3344" };

const atlasCena = new Atlas([
  { arquivo: "abducao.png", largura: 2048, relevo: "abducao_relevo.png" },
  { arquivo: "abducao_efeitos.png", largura: 1024 },
]);
const fonte = (f: string) => readFileSync(join(FONTES, f));
// faixas (largura dupla: duas copias lado a lado, para as nuvens andarem sem acabar)
for (const [nome, arq] of [
  ["montanhas", "pointy_mountains.png"],
  ["nuvens", "clouds1.png"],
  ["morros_longe", "hills1.png"],
  ["morros_perto", "hills2.png"],
] as const)
  await atlasCena.png(0, nome, fonte(arq), { branco: true, escala: ESC_FUNDO });
await atlasCena.png(0, "casa", fonte("house_beige_front.png"), { escala: HD * ESC_FUNDO });
await atlasCena.png(0, "cerca", fonte("fence.png"), { escala: HD * ESC_FUNDO });
await atlasCena.png(0, "grama", fonte("grass3.png"), { escala: HD * ESC_FUNDO });
await atlasCena.png(0, "lua", fonte("moon_full.png"), { escala: HD * 1.4 });
// o primeiro plano: silhuetas (brancas: a cor e do slot, quase preta)
await atlasCena.png(0, "silhueta_pinheiro", fonte("tree02.png"), { branco: true, escala: HD * 1.6 });
await atlasCena.png(0, "silhueta_capim", fonte("grass3.png"), { branco: true, escala: HD * 2.2 });
await atlasCena.png(0, "silhueta_capim2", fonte("grass1.png"), { branco: true, escala: HD * 2.2 });
for (const n of ["cloud1", "cloud5", "cloud8"]) await atlasCena.png(0, n, fonte(`${n}.png`), { branco: true, escala: 1.2 });
// o chao e o ceu (gradiente) e as estrelas fixas
await atlasCena.svg(0, "chao", 64, 64, `<rect width="64" height="64" fill="#fff"/>`);
await atlasCena.svg(
  0,
  "ceu",
  250,
  160,
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07081c"/><stop offset="0.55" stop-color="#1a1840"/><stop offset="1" stop-color="#3b2a5e"/></linearGradient></defs><rect width="250" height="160" fill="url(#g)"/>`,
);
{
  // estrelas: pontos brancos sorteados (semente fixa), maiores e menores
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pts = Array.from({ length: 140 }, () => `<circle cx="${(rnd() * 1000).toFixed(1)}" cy="${(rnd() * 900).toFixed(1)}" r="${(0.5 + rnd() * rnd() * 1.6).toFixed(2)}" fill="#fff" fill-opacity="${(0.35 + rnd() * 0.65).toFixed(2)}"/>`);
  await atlasCena.svg(0, "estrelas", 1000, 900, pts.join(""));
}
// efeitos (pagina 1, sem relevo): o feixe do SVG, o anel, o estouro no chao, a explosao, o brilho
const ESC_EF = 1.9 * HD;
const feixeSvg = await recorteSvg([434, 704, 76, 112], ESC_EF);
const anelSvg = await recorteSvg([402, 816, 100, 46], ESC_EF);
const estouroSvg = await recorteSvg([264, 866, 182, 90], ESC_EF);
const explosaoSvg = await recorteSvg([262, 962, 188, 138], ESC_EF);
await atlasCena.png(1, "feixe", feixeSvg.buf);
await atlasCena.png(1, "anel", anelSvg.buf);
await atlasCena.png(1, "estouro", estouroSvg.buf);
await atlasCena.png(1, "explosao", explosaoSvg.buf);
await atlasCena.svg(1, "ponto", 64, 64, `<defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="0.4" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="32" cy="32" r="32" fill="url(#g)"/>`);
await atlasCena.svg(
  1,
  "estrela",
  64,
  64,
  `<polygon points="${Array.from({ length: 10 }, (_, k) => {
    const r = k % 2 ? 11 : 28,
      a = -Math.PI / 2 + (k * Math.PI) / 5;
    return `${(32 + r * Math.cos(a)).toFixed(1)},${(33 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ")}" fill="#fff"/>`,
);
await atlasCena.svg(1, "liso", 16, 16, `<rect width="16" height="16" fill="#fff"/>`);
// a vinheta da lente: transparente no meio, escura nos cantos
await atlasCena.svg(1, "vinheta", 192, 108, `<defs><radialGradient id="g" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></radialGradient></defs><rect width="192" height="108" fill="url(#g)"/>`);
await atlasCena.svg(1, "halo", 128, 128, `<defs><radialGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="64" cy="64" r="64" fill="url(#g)"/>`);
await atlasCena.montar();
const tam = (nome: string) => {
  const im = atlasCena.imagens.find((i: any) => i.nome === nome)!;
  return { w: im.ret[2], h: im.ret[3] };
};
// tamanho no mundo: faixas e nuvens soltas em 1:1 (ja escaladas), o resto dividido pelo HD
const noMundo = (nome: string, div = HD) => ({ largura: r3(tam(nome).w / div), altura: r3(tam(nome).h / div) });

// ---- onde as coisas ficam (na vista da paisagem)
const ROBO = { x: 70, y: -196, esc: 0.42 };
const PAIRA = { x: ROBO.x, y: 70 }; // o disco parado em cima do robo
const CASA = { x: -300, y: -165 };
// arvores: [x, y no chao da camada, skin, escala, camada, de que lado o vento as puxa]
const ARV: [number, number, string, number, string][] = [
  [-430, -128, "tree20", 0.55, "morros_longe"],
  [-370, -122, "tree02", 0.5, "morros_longe"],
  [-150, -118, "tree10", 0.5, "morros_longe"],
  [250, -116, "tree02", 0.52, "morros_longe"],
  [330, -124, "tree20", 0.58, "morros_longe"],
  [410, -120, "tree05", 0.5, "morros_longe"],
  [-190, -178, "tree05", 0.78, "morros_perto"],
  [-60, -186, "tree01", 0.72, "morros_perto"],
  [230, -184, "tree10", 0.8, "morros_perto"],
  [380, -176, "tree24", 0.75, "morros_perto"],
];

// estrelas que piscam: [x, y no ceu, tamanho]
const CINTILA: [number, number, number][] = [
  [-400, 220, 0.3],
  [-250, 120, 0.22],
  [-120, 250, 0.26],
  [20, 200, 0.2],
  [180, 260, 0.28],
  [330, 60, 0.22],
  [420, 240, 0.3],
  [-330, 380, 0.24],
  [120, 420, 0.26],
  [380, 470, 0.22],
];
const an = new Anim();
// a camera: cada camada da paisagem desce D*k quando a vista esta no ceu; a marca (o nome e a
// marionete) sobe D quando a vista esta na paisagem; as estrelas sobem pouco
// lateral: um passeio lento para a direita enquanto a vista esta na paisagem (a profundidade
// aparece: o perto anda mais que o longe)
const camX = (t: number) => mistura(-40, 40, suave(clamp((t - 2) / 7.5, 0, 1))) * cam(t);
// tremores: o feixe batendo no chao, o clarao da entrada e a fuga (somem em ~0,3 s)
const TREMORES: [number, number][] = [
  [5.7, 4],
  [7.7, 7],
  [8.05, 5],
];
const tremor = (t: number) => {
  let x = 0,
    y = 0;
  for (const [t0, a] of TREMORES) {
    const d = t - t0;
    if (d < 0 || d > 0.45) continue;
    const e = a * Math.exp(-d / 0.11);
    x += e * Math.sin(2 * Math.PI * 17 * d);
    y += e * Math.cos(2 * Math.PI * 13 * d + 0.7);
  }
  return { x, y };
};
for (const t of de(0, DUR, 1 / 30)) {
  const c = cam(t),
    cx = camX(t),
    tr = tremor(t);
  // cada camada: desce D*k com a vista no ceu, anda -camX*k de lado e treme k vezes o tremor
  for (const [camada, k] of CAMADAS) an.osso(camada, "mover", t, { x: r3((-cx + tr.x) * k), y: r3(-(1 - c) * D * k + tr.y * k) });
  // a marca (o nome e a marionete) esta na frente de tudo: sobe D inteiro quando a vista desce
  an.osso("marca", "mover", t, { x: r3(-cx + tr.x), y: r3(c * D + tr.y) });
}
// as nuvens andam devagar (a faixa e dupla: volta ao comeco sem salto)
const LARG_NUVENS = tam("nuvens").w;
an.osso("nuvens_vai", "mover", 0, { x: 0, y: 0, curva: [0, 0, 1, 1] });
an.osso("nuvens_vai", "mover", DUR, { x: r3(-LARG_NUVENS * 0.25), y: 0 });

// ---- abertura e fechamento: o nome e a marionete (instancias da vinheta)
const LET_INI = 0.45,
  LET_PASSO = 0.075;
// no fechamento o disco atravessa o ceu da direita para a esquerda soltando as letras
const DISCO_CEU = { ini: 10.1, fim: 10.95, x0: 640, x1: -720, y: 205 };
const passaLetra = (x: number) => DISCO_CEU.ini + ((DISCO_CEU.x0 - x) / (DISCO_CEU.x0 - DISCO_CEU.x1)) * (DISCO_CEU.fim - DISCO_CEU.ini);
LETRAS.forEach((l: any, k: number) => {
  const chega = LET_INI + LET_PASSO * k,
    volta = r3(passaLetra(l.x));
  an.instancias[`letra_${k}`] = [
    { tempo: 0, animacao: "chega", inicio: r3(-chega), repetir: false },
    { tempo: r3(1.55 + 0.05 * k), animacao: "brilha", inicio: 0 },
    { tempo: r3(1.75 + 0.05 * k), animacao: "flutua", inicio: 0, repetir: true },
    { tempo: volta, animacao: "chega", inicio: 0, repetir: false },
    { tempo: r3(volta + 0.8), animacao: "flutua", inicio: 0, repetir: true },
  ];
  // escondida longe da abertura e do fechamento (a instancia nem e calculada)
  an.slots[`letra_${k}`] = {
    rgba: [
      { tempo: 0, cor: "ffffff00", curva: "degrau" },
      { tempo: r3(chega), cor: "ffffffff", curva: "degrau" },
      { tempo: 3.05, cor: "ffffff00", curva: "degrau" },
      { tempo: volta, cor: "ffffffff", curva: "degrau" },
    ],
  };
});
an.instancias.marionete = [
  { tempo: 0, animacao: "chega", inicio: -0.15, repetir: false },
  { tempo: 1.75, animacao: "danca", inicio: 0, repetir: true },
  { tempo: 10.95, animacao: "chega", inicio: 0, repetir: false },
  { tempo: 12.55, animacao: "reverencia", inicio: 0, repetir: false },
];
an.slots.marionete = {
  rgba: [
    { tempo: 0, cor: "ffffff00", curva: "degrau" },
    { tempo: 0.15, cor: "ffffffff", curva: "degrau" },
    { tempo: 3.05, cor: "ffffff00", curva: "degrau" },
    { tempo: 10.95, cor: "ffffffff", curva: "degrau" },
  ],
};

// ---- o robo: parado (idle), se assusta quando o disco chega (ganhou: bracos para cima) e sobe
// girando e encolhendo ate o disco
const SOBE = { ini: 5.85, fim: 7.7 };
an.instancias.robo = [
  { tempo: 0, animacao: "idle", inicio: 0, repetir: true },
  { tempo: 4.55, animacao: "ganhou", inicio: 0, repetir: true },
];
for (const t of [0, ...de(SOBE.ini, SOBE.fim), DUR]) {
  const f = t < SOBE.ini ? 0 : t > SOBE.fim ? 1 : (t - SOBE.ini) / (SOBE.fim - SOBE.ini);
  const sobe = f * f * (3 - 2 * f);
  an.osso("robo", "mover", t, { x: r3(4 * Math.sin(f * 9)), y: r3(sobe * (PAIRA.y - 40 - ROBO.y)) });
  an.osso("robo", "girar", t, { valor: r3(-540 * f * f) });
  const e = mistura(1, 0.18, sobe);
  an.osso("robo", "escalar", t, { x: r3(e), y: r3(e) });
}
an.slots.robo = {
  rgba: [
    { tempo: 0, cor: "ffffffff", curva: "degrau" },
    { tempo: r3(SOBE.fim + 0.02), cor: "ffffff00", curva: "degrau" },
  ],
};

// ---- o disco: chega em zigue-zague (voa), paira (pernas abertas), foge (voa) e atravessa o ceu
// no fechamento. O caminho e da cena; o balanco, das animacoes do disco
type Pt = [number, number, number];
const CAMINHO: Pt[] = [
  [3.95, 640, 330],
  [4.3, 380, 220],
  [4.6, 260, 120],
  [4.85, 140, 150],
  [5.2, PAIRA.x, PAIRA.y],
  [8.05, PAIRA.x, PAIRA.y],
  [8.45, PAIRA.x - 60, PAIRA.y + 70],
  [9.05, -720, 520],
];
const noCaminho = (t: number) => {
  if (t <= CAMINHO[0][0]) return { x: CAMINHO[0][1], y: CAMINHO[0][2] };
  for (let i = 1; i < CAMINHO.length; i++) {
    const [t1, x1, y1] = CAMINHO[i],
      [t0, x0, y0] = CAMINHO[i - 1];
    if (t <= t1) {
      const f = suave((t - t0) / (t1 - t0));
      return { x: mistura(x0, x1, f), y: mistura(y0, y1, f) };
    }
  }
  const u = CAMINHO[CAMINHO.length - 1];
  return { x: u[1], y: u[2] };
};
for (const t of de(3.9, 9.1)) {
  const p = noCaminho(t);
  an.osso("disco", "mover", t, { x: r3(p.x), y: r3(p.y) });
  // inclina para onde vai
  const q = noCaminho(t + 1 / 30);
  an.osso("disco", "girar", t, { valor: r3(clamp(-(q.x - p.x) * 0.25, -12, 12)) });
}
// no ceu do fechamento (a vista ja subiu: o disco anda na camada da marca)
for (const t of de(DISCO_CEU.ini - 0.05, DISCO_CEU.fim + 0.05)) {
  const f = clamp((t - DISCO_CEU.ini) / (DISCO_CEU.fim - DISCO_CEU.ini), 0, 1);
  // o plano do disco esta D*k abaixo com a vista no ceu: a altura no quadro e DISCO_CEU.y
  an.osso("disco", "mover", t, { x: r3(mistura(DISCO_CEU.x0, DISCO_CEU.x1, f)), y: r3(DISCO_CEU.y + D * 0.85 + 18 * Math.sin(f * Math.PI * 2)) });
  an.osso("disco", "girar", t, { valor: 10 });
}
// as trocas com mistura: as pernas abrem e recolhem em vez de pular
an.instancias.disco = [
  { tempo: 0, animacao: "voa", inicio: 0, repetir: true },
  { tempo: 5.0, animacao: "paira", inicio: 0, repetir: true, mix: 0.4 },
  { tempo: 8.0, animacao: "foge", inicio: 0, repetir: true, mix: 0.3 },
];
an.slots.disco = {
  rgba: [
    { tempo: 0, cor: "ffffff00", curva: "degrau" },
    { tempo: 3.95, cor: "ffffffff", curva: "degrau" },
    { tempo: 9.05, cor: "ffffff00", curva: "degrau" },
    { tempo: DISCO_CEU.ini - 0.05, cor: "ffffffff", curva: "degrau" },
    { tempo: DISCO_CEU.fim + 0.05, cor: "ffffff00", curva: "degrau" },
  ],
};
// o brilho embaixo do disco pulsa enquanto ele aparece
an.slots.disco_brilho = { rgba: de(0, DUR, 0.2).map((t, i) => ({ tempo: t, cor: alfa("ff7ab8", (t >= 3.95 && t < 9.05) || (t >= DISCO_CEU.ini && t < DISCO_CEU.fim) ? 0.32 + 0.1 * Math.sin(i * 1.7) : 0) })) };

// ---- o feixe: desce de 5,45 a 5,7, pulsa, e recolhe de 7,85 a 8,05
const FEIXE = { desce: 5.45, aceso: 5.7, recolhe: 7.85, fim: 8.05 };
const ALT_FEIXE = PAIRA.y - 30 - (ROBO.y - 12);
for (const t of [0, ...de(FEIXE.desce, FEIXE.aceso), ...de(FEIXE.recolhe, FEIXE.fim), DUR]) {
  const e = t < FEIXE.desce || t > FEIXE.fim ? 0 : t < FEIXE.aceso ? entre(t, FEIXE.desce, FEIXE.aceso) : t > FEIXE.recolhe ? 1 - entre(t, FEIXE.recolhe, FEIXE.fim) : 1;
  an.osso("feixe", "escalar", t, { x: r3(mistura(0.4, 1, e)), y: r3(Math.max(0.001, e)) });
}
an.slots.feixe = { rgba: [{ tempo: 0, cor: alfa(ROSA, 0) }, ...de(FEIXE.desce, FEIXE.fim, 0.1).map((t) => ({ tempo: t, cor: alfa("ff7ab8", t > FEIXE.fim - 0.01 ? 0 : 0.55 + 0.2 * Math.sin(t * 23)) }))] };
an.slots.feixe_miolo = { rgba: [{ tempo: 0, cor: "ffffff00" }, ...de(FEIXE.desce, FEIXE.fim, 0.1).map((t) => ({ tempo: t, cor: alfa("ffffff", t > FEIXE.fim - 0.01 ? 0 : 0.32 + 0.12 * Math.sin(t * 31)) }))] };
// a sombra do robo: encolhe e some enquanto ele sobe
for (const t of [0, ...de(SOBE.ini, SOBE.fim, 0.1)]) {
  const f = t < SOBE.ini ? 0 : clamp((t - SOBE.ini) / (SOBE.fim - SOBE.ini), 0, 1);
  an.osso("sombra", "escalar", t, { x: r3(1 - 0.7 * f), y: r3(1 - 0.7 * f) });
}
an.slots.sombra = { rgba: [{ tempo: 0, cor: "00000070" }, { tempo: SOBE.ini, cor: "00000070" }, { tempo: SOBE.fim, cor: "00000000" }] };
// a nevoa anda devagar (cada faixa na camada dela)
an.osso("nevoa_l", "mover", 0, { x: -60, y: 0, curva: [0, 0, 1, 1] });
an.osso("nevoa_l", "mover", DUR, { x: 60, y: 0 });
an.osso("nevoa_c", "mover", 0, { x: 80, y: 0, curva: [0, 0, 1, 1] });
an.osso("nevoa_c", "mover", DUR, { x: -90, y: 0 });
// estrelas que piscam (cada uma no seu ritmo)
CINTILA.forEach((_, k) => {
  an.slots[`cintila_${k}`] = { rgba: de(0, DUR, 0.25).map((t, i) => ({ tempo: t, cor: alfa("ffffff", 0.25 + 0.75 * Math.abs(Math.sin(i * (0.7 + 0.13 * k) + k))) })) };
});
// estrelas cadentes: uma na abertura, uma na paisagem (o rastro faz a cauda)
for (const [t0, x0, y0] of [
  [0.7, 380, 250],
  [3.3, 260, 330],
] as const) {
  an.osso("cadente", "mover", t0 - 0.01, { x: x0, y: y0, curva: "degrau" });
  an.osso("cadente", "mover", t0, { x: x0, y: y0 });
  an.osso("cadente", "mover", t0 + 0.45, { x: x0 - 330, y: y0 - 150 });
}
an.slots.cadente = {
  rgba: [
    { tempo: 0, cor: "ffffff00", curva: "degrau" },
    { tempo: 0.7, cor: "ffffffff" },
    { tempo: 1.15, cor: "ffffff00", curva: "degrau" },
    { tempo: 3.3, cor: "ffffffff" },
    { tempo: 3.75, cor: "ffffff00", curva: "degrau" },
  ],
};
an.slots.feixe_luz = { rgba: [{ tempo: 0, cor: "ff7ab800" }, { tempo: FEIXE.desce, cor: "ff7ab800" }, { tempo: FEIXE.aceso, cor: "ff7ab866" }, { tempo: FEIXE.recolhe, cor: "ff7ab866" }, { tempo: FEIXE.fim, cor: "ff7ab800" }] };
// o anel e o estouro no chao quando o feixe chega
an.osso("anel", "escalar", 0, { x: 0.2, y: 0.2 });
an.osso("anel", "escalar", FEIXE.aceso, { x: 0.2, y: 0.2 });
an.osso("anel", "escalar", FEIXE.aceso + 0.5, { x: 2.4, y: 2.4 });
an.slots.anel = { rgba: [{ tempo: 0, cor: "ffffff00", curva: "degrau" }, { tempo: FEIXE.aceso, cor: "ffffffff" }, { tempo: FEIXE.aceso + 0.5, cor: "ffffff00" }] };
an.osso("estouro", "escalar", 0, { x: 0.3, y: 0.3 });
an.osso("estouro", "escalar", FEIXE.aceso, { x: 0.3, y: 0.3 });
an.osso("estouro", "escalar", FEIXE.aceso + 0.25, { x: 1, y: 1 });
an.slots.estouro = { rgba: [{ tempo: 0, cor: "ffffff00", curva: "degrau" }, { tempo: FEIXE.aceso, cor: "ffffffff" }, { tempo: FEIXE.aceso + 0.35, cor: "ffffff00" }] };
// a explosao em estrela quando o robo entra (7,7) e quando o disco foge (8,1)
for (const [t0, s] of [
  [SOBE.fim, 0.6],
  [8.1, 0.5],
] as const) {
  an.osso("explosao", "escalar", t0 - 0.01, { x: 0.2, y: 0.2, curva: "degrau" });
  an.osso("explosao", "escalar", t0, { x: 0.2, y: 0.2 });
  an.osso("explosao", "escalar", t0 + 0.22, { x: s, y: s });
  an.osso("explosao", "girar", t0, { valor: 0 });
  an.osso("explosao", "girar", t0 + 0.3, { valor: 40 });
}
an.slots.explosao = {
  rgba: [
    { tempo: 0, cor: "ffffff00", curva: "degrau" },
    { tempo: SOBE.fim, cor: "ffffffff" },
    { tempo: SOBE.fim + 0.3, cor: "ffffff00", curva: "degrau" },
    { tempo: 8.1, cor: "ffffffff" },
    { tempo: 8.45, cor: "ffffff00" },
  ],
};
an.osso("explosao", "mover", 0, { x: PAIRA.x, y: PAIRA.y - 40, curva: "degrau" });
an.osso("explosao", "mover", 8.05, { x: PAIRA.x + 40, y: PAIRA.y - 10, curva: "degrau" });

// ---- as arvores: balancam; com o feixe aceso, o vento as puxa para o disco
ARV.forEach(([x], k) => {
  const lado = x < PAIRA.x ? -1 : 1; // a copa vai para o lado do disco: gira para dentro
  an.instancias[`arvore_${k}`] = [
    { tempo: 0, animacao: "balanca", inicio: r3(-0.37 * k), repetir: true },
    { tempo: r3(FEIXE.aceso + 0.03 * k), animacao: "vento", inicio: 0, repetir: true, mix: 0.3 },
    { tempo: r3(FEIXE.fim + 0.1), animacao: "balanca", inicio: 0, repetir: true, mix: 0.6 },
  ];
  const perto = Math.max(0.3, 1 - Math.abs(x - PAIRA.x) / 600);
  const giro = -lado * 9 * perto;
  an.osso(`arvore_${k}`, "girar", 0, { valor: 0 });
  an.osso(`arvore_${k}`, "girar", FEIXE.aceso, { valor: 0 });
  an.osso(`arvore_${k}`, "girar", FEIXE.aceso + 0.4, { valor: r3(giro) });
  an.osso(`arvore_${k}`, "girar", FEIXE.recolhe, { valor: r3(giro) });
  an.osso(`arvore_${k}`, "girar", FEIXE.fim + 0.5, { valor: 0 });
});

// ---- luzes: a lua, a janela, o feixe no chao e a do motor do disco
an.luzes.feixe = [{ tempo: 0, forca: 0 }, { tempo: FEIXE.desce, forca: 0 }, ...de(FEIXE.aceso, FEIXE.recolhe, 0.1).map((t) => ({ tempo: t, forca: r3(2.2 + 0.4 * Math.sin(t * 23)) })), { tempo: FEIXE.fim, forca: 0 }];
an.luzes.motor = [{ tempo: 0, forca: 0, curva: "degrau" }, { tempo: 3.95, forca: 0.5, curva: "degrau" }, { tempo: 9.05, forca: 0, curva: "degrau" }];
an.luzes.marca = [{ tempo: 0, forca: 1.5 }, { tempo: 2.4, forca: 1.5 }, { tempo: 3.0, forca: 0 }, { tempo: 10.0, forca: 0 }, { tempo: 10.5, forca: 1.5 }];
an.luzes.janela = de(0, DUR, 0.25).map((t, i) => ({ tempo: t, forca: r3(0.9 + 0.12 * Math.sin(i * 2.3)) }));

// ---- particulas: estrelas subindo pelo feixe, faiscas quando ele bate, estrelas na entrada e na
// fuga, e o confete do fechamento
an.particulas.feixe_estrelas = { taxa: [{ tempo: 0, valor: 0, curva: "degrau" }, { tempo: FEIXE.aceso, valor: 26 }, { tempo: FEIXE.recolhe, valor: 26 }, { tempo: FEIXE.fim, valor: 0 }] };
an.particulas.faiscas = { rajada: [{ tempo: FEIXE.aceso, quantidade: 28 }] };
an.particulas.clarao_estrelas = { rajada: [{ tempo: SOBE.fim, quantidade: 26 }, { tempo: 8.1, quantidade: 30 }] };
an.particulas.vagalumes = { taxa: [{ tempo: 0, valor: 0, curva: "degrau" }, { tempo: 2.6, valor: 5 }, { tempo: 9.2, valor: 5 }, { tempo: 9.6, valor: 0 }] };
an.particulas.vagalumes2 = { taxa: [{ tempo: 0, valor: 0, curva: "degrau" }, { tempo: 2.6, valor: 4 }, { tempo: 9.2, valor: 4 }, { tempo: 9.6, valor: 0 }] };
an.particulas.confete = { rajada: [{ tempo: 12.6, quantidade: 46 }] };

// ---- camadas de ajuste: a cena tinge e pulsa com o feixe, o clarao da entrada e o escuro do
// comeco e do fim (o laco emenda no preto)
an.efeitos.ajuste_cena = {
  ajuste: [
    { tempo: 0, luminosidade: -1, saturacao: 1, matiz: 0, contraste: 1 },
    { tempo: 0.35, luminosidade: 0 },
    { tempo: FEIXE.desce, luminosidade: 0, saturacao: 1, matiz: 0 },
    { tempo: FEIXE.aceso, saturacao: 1.35, matiz: 14, contraste: 1.08 },
    { tempo: r3(SOBE.fim - 0.02), saturacao: 1.35, matiz: 14, luminosidade: 0 },
    { tempo: SOBE.fim, luminosidade: 0.45 },
    { tempo: r3(SOBE.fim + 0.12), luminosidade: 0 },
    { tempo: FEIXE.fim + 0.3, saturacao: 1, matiz: 0, contraste: 1 },
    { tempo: DUR - 0.45, luminosidade: 0 },
    { tempo: DUR, luminosidade: -1 },
  ],
};
// o fundo desfocado enquanto a marca esta na frente (profundidade de campo), nitido na paisagem
an.efeitos.ajuste_fundo = { ajuste: [{ tempo: 0, desfoque: 4 }, { tempo: 2, desfoque: 4 }, { tempo: 2.8, desfoque: 0 }, { tempo: 9.2, desfoque: 0 }, { tempo: 10, desfoque: 4 }] };

const FRENTE: [string, number, number, number, boolean][] = [
  ["silhueta_pinheiro", -455, 0, 1, false],
  ["silhueta_pinheiro", 470, -20, 0.85, true],
  ["silhueta_capim", -330, 0, 1, false],
  ["silhueta_capim2", -250, 0, 0.9, true],
  ["silhueta_capim", 200, 0, 0.8, true],
  ["silhueta_capim2", 330, 0, 1, false],
];
const NUVENS_SOLTAS: [string, number, number, number][] = [
  ["cloud1", -330, 205, 0.9],
  ["cloud5", 150, 240, 0.75],
  ["cloud8", 420, 150, 0.6],
];
escreve("abducao.boneco", {
  boneco: 0,
  nome: "abducao",
  paginas: atlasCena.paginas,
  imagens: atlasCena.imagens,
  esqueleto: { largura: 960, altura: 540 },
  ossos: [
    { nome: "root" },
    { nome: "ceu", pai: "root" },
    { nome: "estrelas", pai: "root" },
    { nome: "lua", pai: "root", x: 290, y: 165 },
    { nome: "montanhas", pai: "root", y: -40 },
    { nome: "nuvens", pai: "root", y: 110 },
    { nome: "nuvens_vai", pai: "nuvens" },
    { nome: "morros_longe", pai: "root", y: -90 },
    { nome: "morros_perto", pai: "root", y: -150 },
    { nome: "chao", pai: "root", y: -230 },
    { nome: "plano_disco", pai: "root" },
    { nome: "primeiro_plano", pai: "root", y: -270 },
    { nome: "nevoa_l", pai: "morros_longe", y: 10 },
    { nome: "nevoa_c", pai: "chao", y: 40 },
    { nome: "sombra", pai: "morros_perto", x: ROBO.x, y: r3(ROBO.y + 150 - 4) },
    { nome: "cadente", pai: "estrelas" },
    ...CINTILA.map(([x, y], k) => ({ nome: `cintila_${k}`, pai: "estrelas", x, y })),
    { nome: "casa", pai: "morros_perto", x: CASA.x, y: r3(CASA.y + 150) },
    { nome: "cerca", pai: "morros_perto", x: -150, y: -62 },
    ...ARV.map(([x, y, , esc, camada], k) => ({ nome: `arvore_${k}`, pai: camada, x, y: r3(y - (camada === "morros_longe" ? -90 : -150)), escala_x: esc, escala_y: esc })),
    { nome: "robo", pai: "morros_perto", x: ROBO.x, y: r3(ROBO.y + 150), escala_x: ROBO.esc, escala_y: ROBO.esc },
    { nome: "feixe_chao", pai: "morros_perto", x: ROBO.x, y: r3(ROBO.y + 150 - 6) },
    { nome: "anel", pai: "feixe_chao" },
    { nome: "estouro", pai: "feixe_chao", y: 30 },
    { nome: "disco", pai: "plano_disco" },
    { nome: "feixe", pai: "disco", y: -30 },
    { nome: "explosao", pai: "plano_disco" },
    { nome: "marca", pai: "root", y: 10 },
    { nome: "marionete", pai: "marca" },
    ...LETRAS.map((l: any, k: number) => ({ nome: `letra_${k}`, pai: "marca", x: l.x, y: l.y })),
    { nome: "confete", pai: "root", y: 300 },
  ],
  slots: [
    { nome: "ceu", osso: "ceu", parte: "ceu" },
    { nome: "estrelas", osso: "estrelas", parte: "estrelas", blend: "aditivo", cor: "e8e8ffd0" },
    ...CINTILA.map((_, k) => ({ nome: `cintila_${k}`, osso: `cintila_${k}`, parte: "estrela", blend: "aditivo", cor: "ffffffff" })),
    { nome: "cadente", osso: "cadente", parte: "liso", blend: "aditivo", cor: "ffffff00", efeitos: { rastro: { copias: 8, intervalo: 0.018, alfa: 0.55 } } },
    { nome: "lua_halo", osso: "lua", parte: "halo", blend: "aditivo", cor: "c8d6ff50" },
    { nome: "lua", osso: "lua", parte: "lua" },
    ...NUVENS_SOLTAS.map(([n], k) => ({ nome: `nuvem_${k}`, osso: "nuvens_vai", parte: n, cor: alfa(NOITE.nuvens, 0.45), profundidade: -260 })),
    { nome: "montanhas_base", osso: "montanhas", parte: "chao", cor: NOITE.montanhas + "ff", profundidade: -240 },
    { nome: "montanhas", osso: "montanhas", parte: "montanhas", cor: NOITE.montanhas + "ff", profundidade: -240 },
    { nome: "nuvens", osso: "nuvens_vai", parte: "nuvens", cor: alfa(NOITE.nuvens, 0.35), profundidade: -200 },
    { nome: "morros_longe_base", osso: "morros_longe", parte: "chao", cor: NOITE.longe + "ff", profundidade: -120 },
    { nome: "morros_longe", osso: "morros_longe", parte: "morros_longe", cor: NOITE.longe + "ff", profundidade: -120 },
    ...ARV.filter(([, , , , c]) => c === "morros_longe").map((_, k) => ({ nome: `arvore_${k}`, osso: `arvore_${k}`, cor: "8a9ac8ff", profundidade: -110 })),
    // a nevoa entre os morros: na frente das arvores de longe, atras dos morros de perto
    { nome: "nevoa_longe", osso: "nevoa_l", parte: "halo", blend: "aditivo", cor: "9fb0ff30" },
    { nome: "morros_perto_base", osso: "morros_perto", parte: "chao", cor: NOITE.perto + "ff", profundidade: -40 },
    { nome: "morros_perto", osso: "morros_perto", parte: "morros_perto", cor: NOITE.perto + "ff", profundidade: -40 },
    { nome: "casa", osso: "casa", parte: "casa", cor: "9aa6d8ff", profundidade: -30 },
    { nome: "janela", osso: "casa", parte: "halo", blend: "aditivo", cor: "ffcc7090" },
    ...ARV.map(([, , , , c], k) => [c, k] as const)
      .filter(([c]) => c === "morros_perto")
      .map(([, k]) => ({ nome: `arvore_${k}`, osso: `arvore_${k}`, cor: "b8c2eeff", profundidade: -20 })),
    { nome: "cerca", osso: "cerca", parte: "cerca", cor: "a8b0d8ff", profundidade: -10 },
    { nome: "chao", osso: "chao", parte: "chao", cor: NOITE.chao + "ff" },
    { nome: "nevoa_chao", osso: "nevoa_c", parte: "halo", blend: "aditivo", cor: "9fb0ff22" },
    // a camada de ajuste do fundo (o desfoque da abertura e do fechamento): a paisagem inteira atras
    // do foco, que e a marca; o que vem depois (o disco, a marca) fica nitido
    { nome: "ajuste_fundo", osso: "root" },
    { nome: "sombra", osso: "sombra", parte: "halo", cor: "00000070" },
    { nome: "vagalumes", osso: "morros_perto", blend: "aditivo" },
    // o feixe: luz no chao (halo), o cone, o anel e o estouro
    { nome: "feixe_luz", osso: "feixe_chao", parte: "halo", blend: "aditivo", cor: "ff7ab800" },
    { nome: "robo", osso: "robo" },
    { nome: "feixe_estrelas", osso: "feixe_chao", blend: "aditivo" },
    { nome: "feixe", osso: "feixe", parte: "feixe", blend: "aditivo", cor: alfa(ROSA, 0) },
    { nome: "feixe_miolo", osso: "feixe", parte: "feixe", blend: "aditivo", cor: "ffffff00" },
    { nome: "anel", osso: "anel", parte: "anel", blend: "aditivo", cor: "ffffff00" },
    { nome: "estouro", osso: "estouro", parte: "estouro", blend: "aditivo", cor: "ffffff00" },
    { nome: "faiscas", osso: "feixe_chao", blend: "aditivo" },
    { nome: "disco_brilho", osso: "disco", parte: "halo", blend: "aditivo", cor: "ff7ab800" },
    { nome: "disco", osso: "disco" },
    { nome: "explosao", osso: "explosao", parte: "explosao", blend: "aditivo", cor: "ffffff00" },
    { nome: "clarao_estrelas", osso: "explosao", blend: "aditivo" },
    // o primeiro plano: silhuetas escuras na frente da paisagem (andam mais que o chao)
    ...FRENTE.map(([n], k) => ({ nome: `frente_${k}`, osso: "primeiro_plano", parte: n, cor: "070b16ff" })),
    // a marca por cima de tudo
    { nome: "marionete", osso: "marionete", cor: "ffffff00", profundidade: 120 },
    ...LETRAS.map((_: any, k: number) => ({ nome: `letra_${k}`, osso: `letra_${k}`, cor: "ffffff00", profundidade: 120 })),
    { nome: "confete", osso: "confete" },
    { nome: "vinheta", osso: "root", parte: "vinheta", cor: "000000a8" },
    { nome: "ajuste_cena", osso: "root" },
  ],
  skins: [
    {
      nome: "default",
      partes: {
        ceu: { ceu: { largura: 1040, altura: 1240, y: 300 } },
        estrelas: { estrelas: { largura: 1000, altura: 900, y: 320 } },
        lua_halo: { halo: { largura: 300, altura: 300 } },
        lua: { lua: noMundo("lua") },
        ...Object.fromEntries(NUVENS_SOLTAS.map(([n, x, y, e], k) => [`nuvem_${k}`, { [n]: { ...noMundo(n, 1), x, y, escala_x: e, escala_y: e } }])),
        montanhas: { montanhas: { ...noMundo("montanhas", 1), escala_x: 1.1, escala_y: 1.1 } },
        nuvens: { nuvens: { ...noMundo("nuvens", 1), escala_x: 1.2, escala_y: 1.2 } },
        morros_longe: { morros_longe: { ...noMundo("morros_longe", 1), escala_x: 1.1, escala_y: 1.4 } },
        morros_perto: { morros_perto: { ...noMundo("morros_perto", 1), escala_x: 1.15, escala_y: 1.6 } },
        // a base de cada faixa: um bloco da mesma cor ate bem embaixo (separadas pela paralaxe, as
        // faixas mostravam a borda reta de baixo)
        montanhas_base: { chao: { largura: 1200, altura: 700, y: r3(-(tam("montanhas").h * 1.1) / 2 - 348) } },
        morros_longe_base: { chao: { largura: 1200, altura: 700, y: r3(-(tam("morros_longe").h * 1.4) / 2 - 348) } },
        morros_perto_base: { chao: { largura: 1200, altura: 700, y: r3(-(tam("morros_perto").h * 1.6) / 2 - 348) } },
        casa: { casa: noMundo("casa") },
        janela: { halo: { largura: 70, altura: 70, x: -14, y: -10 } },
        cerca: { cerca: noMundo("cerca") },
        chao: { chao: { largura: 1100, altura: 180, y: -40 } },
        feixe_luz: { halo: { largura: 420, altura: 150 } },
        feixe_miolo: { feixe: { largura: r3(feixeSvg.w * 1.9 * 0.7), altura: r3(ALT_FEIXE), y: r3(-ALT_FEIXE / 2) } },
        disco_brilho: { halo: { largura: 260, altura: 120, y: -60 } },
        sombra: { halo: { largura: 110, altura: 26 } },
        nevoa_longe: { halo: { largura: 1500, altura: 150 } },
        nevoa_chao: { halo: { largura: 1600, altura: 110 } },
        cadente: { liso: { largura: 26, altura: 2.5, rotacao: 24 } },
        ...Object.fromEntries(CINTILA.map(([, , e], k) => [`cintila_${k}`, { estrela: { largura: 64, altura: 64, escala_x: e, escala_y: e } }])),
        ...Object.fromEntries(FRENTE.map(([n, x, y, e, f], k) => [`frente_${k}`, { [n]: { ...noMundo(n), x, y: r3(y + (tam(n).h / HD) * e * 0.5), escala_x: r3(e * (f ? -1 : 1)), escala_y: e } }])),
        vinheta: { vinheta: { largura: 1000, altura: 562 } },
        feixe: { feixe: { largura: r3(feixeSvg.w * 1.9 * 1.6), altura: r3(ALT_FEIXE), y: r3(-ALT_FEIXE / 2) } },
        anel: { anel: { largura: r3(anelSvg.w * 1.9), altura: r3(anelSvg.h * 1.9) } },
        estouro: { estouro: { largura: r3(estouroSvg.w * 1.9), altura: r3(estouroSvg.h * 1.9) } },
        explosao: { explosao: { largura: r3(explosaoSvg.w * 1.9), altura: r3(explosaoSvg.h * 1.9) } },
      },
    },
  ],
  instancias: [
    { nome: "robo", slot: "robo", boneco: "robo.boneco", animacao: "idle" },
    { nome: "disco", slot: "disco", boneco: "disco.boneco", animacao: "voa" },
    ...ARV.map(([, , skin], k) => ({ nome: `arvore_${k}`, slot: `arvore_${k}`, boneco: "arvore.boneco", skin, animacao: "balanca" })),
    { nome: "marionete", slot: "marionete", boneco: "marionete.boneco", animacao: "danca" },
    ...LETRAS.map((l: any, k: number) => ({ nome: `letra_${k}`, slot: `letra_${k}`, boneco: "letra.boneco", skin: l.skin, animacao: "chega", repetir: false })),
  ],
  particulas: [
    ...[
      ["vagalumes", -160, -10, 21],
      ["vagalumes2", 300, -14, 22],
    ].map(([nome, x, y, semente]) => ({
      nome,
      slot: "vagalumes",
      osso: "morros_perto",
      x,
      y,
      imagem: "ponto",
      blend: "aditivo",
      taxa: 0,
      vida: [2.2, 3.4],
      velocidade: [8, 26],
      angulo: 90,
      abertura: 300,
      escala: [0.12, 0.07],
      onda: [12, 0.7],
      cor: ["d8ff8000", "d8ff80e0", "f0ffa0c0", "d8ff8000"],
      semente,
    })),
    {
      nome: "feixe_estrelas",
      slot: "feixe_estrelas",
      imagem: "estrela",
      blend: "aditivo",
      taxa: 0,
      vida: [1.1, 1.6],
      velocidade: [110, 190],
      angulo: 90,
      abertura: 10,
      escala: [0.32, 0.06],
      giro: [-300, 300],
      onda: [10, 1.4],
      cor: ["ffffffff", "ffb8dcff", "ff2e8800"],
      semente: 11,
    },
    {
      nome: "faiscas",
      slot: "faiscas",
      imagem: "ponto",
      blend: "aditivo",
      taxa: 0,
      vida: [0.5, 0.9],
      velocidade: [90, 260],
      angulo: 90,
      abertura: 150,
      gravidade: 420,
      escala: [0.18, 0.05],
      cor: ["ffffffff", "ff7ab8ff", "ff2e8800"],
      semente: 12,
    },
    {
      nome: "clarao_estrelas",
      slot: "clarao_estrelas",
      imagem: "estrela",
      blend: "aditivo",
      taxa: 0,
      vida: [0.6, 1.1],
      velocidade: [120, 340],
      angulo: 90,
      abertura: 360,
      arrasto: 2.2,
      escala: [0.38, 0.05],
      giro: [-400, 400],
      cor: ["ffffffff", "ffd6ecff", "ff2e8800"],
      semente: 13,
    },
    {
      nome: "confete",
      slot: "confete",
      imagem: "estrela",
      taxa: 0,
      vida: [1.6, 2.2],
      velocidade: [40, 160],
      angulo: -90,
      abertura: 150,
      gravidade: 120,
      arrasto: 0.6,
      escala: [0.3, 0.22],
      giro: [-540, 540],
      onda: [14, 1.3],
      cor: [ROSA + "ff", "ffd166ff", "ffffff00"],
      semente: 14,
    },
  ],
  luzes: [
    { nome: "lua", osso: "lua", cor: "b8c8ffff", forca: 0.55, raio: 1500, altura: 380 },
    { nome: "janela", osso: "casa", x: -14, y: -10, cor: "ffc070ff", forca: 0.9, raio: 170, altura: 30, profundidade: -20 },
    { nome: "feixe", osso: "feixe_chao", y: 20, cor: "ff7ab8ff", forca: 0, raio: 430, altura: 70, profundidade: -20 },
    // embaixo da nave: acende o chao e as copas, nao o casco
    { nome: "motor", osso: "disco", y: -110, cor: "ffb8dcff", forca: 0, raio: 320, altura: 40 },
    // a luz da marca: de frente e numa camada adiante (pega o nome e a marionete, nao a paisagem),
    // acesa so na abertura e no fechamento
    { nome: "marca", osso: "marca", y: 80, cor: "fff6faff", forca: 0, raio: 1100, altura: 260, profundidade: 260 },
  ],
  ambiente: { cor: "8c96d8ff", forca: 0.62 },
  animacoes: { abducao: an.json() },
});

// o relevo das pecas que recebem luz: as faixas, a casa e a cerca (pagina 0) e as arvores
for (const [arquivo, extra] of [
  ["abducao.boneco", ["--borda", "12", "--paginas", "0", "--modo", "peca"]],
  ["arvore.boneco", ["--borda", "10", "--paginas", "0", "--modo", "peca"]],
  ["disco.boneco", ["--borda", "10", "--paginas", "0", "--modo", "peca"]],
] as const) {
  const r = spawnSync("npx", ["tsx", join(REPO, "tools", "relevo.ts"), join(AQUI, arquivo), ...extra], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`relevo de ${arquivo}: ${r.stderr}`);
}

console.log(`disco: corpo ${corpo.w.toFixed(0)}x${corpo.h.toFixed(0)} un, piloto em ${JSON.stringify(pPiloto)}; arvores ${ARVORES.length}; letras ${LETRAS.length}`);
