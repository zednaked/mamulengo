// A vinheta do Mamulengo, feita de instancias (docs/NUCLEO.md "Instancias"): o boneco do icone e
// o nome, numa abertura de 8 s (animacao "vinheta"). Tres arquivos:
//
//   letra.boneco      uma letra (uma skin por letra do nome) com as animacoes chega (vem de quem
//                     assiste, grande, bate na tela e solta um anel), onda, brilha e sai (voa para
//                     quem assiste)
//   marionete.boneco  o boneco do icone (docs/media/boneco-icone.png): as tres varetas do
//                     controle, os fios ate os ombros, a cabeca e o corpo. Animacoes chega (quica
//                     nos fios), danca, pula e eletrico (raio pelos fios, estrelas em volta da
//                     cabeca). Todas comecam e acabam em repouso: a troca nao da salto
//   vinheta.boneco    a cena: nove instancias da letra, defasadas, e uma da marionete; a
//                     profundidade (a marionete vem do fundo e, na saida, a camera mergulha na
//                     cabeca), as luzes, o fundo, a barra e o subtitulo
//
//   0,25-1,85  a marionete vem do fundo, minuscula, cresce ate o lugar e quica nos fios; confete
//   1,25-2,3   as letras vem de quem assiste e batem na tela, uma a uma
//   1,85-3,65  a marionete danca; 2,55-3,7 uma luz varre o nome (o relevo sai da arte)
//   3,6-4,45   uma onda passa pelas letras e a marionete pula, puxada pelos fios
//   4,45-5,45  raio pelos fios, estrelas orbitando a cabeca, tudo aceso de azul
//   5,0-5,6    a barra cresce e o subtitulo aparece dissolvendo; 5,6 um brilho corre o nome
//   6,9-8,0    o subtitulo some, as letras voam para quem assiste e a camera mergulha na cabeca
//
//   npx tsx exemplos/vinheta/gerar.ts
//
// As imagens saem daqui (SVG pelo sharp; o nome em Noto Sans, do sistema), em 2x.
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DUR = 8;
const HD = 2; // pixels da textura por pixel do mundo
const ROSA = "ff2e88",
  AMARELO = "ffd166";
const NOME = "Mamulengo";
const SUBTITULO = "2D skeletal animation for games";
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, z: number) => Math.min(z, Math.max(a, x));
const suave = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const entre = (t: number, a: number, z: number) => suave((t - a) / (z - a));
const mistura = (a: number, z: number, f: number) => a + (z - a) * f;
const sino = (t: number, a: number, z: number) => (t <= a || t >= z ? 0 : Math.sin((Math.PI * (t - a)) / (z - a)));
const mola = (tau: number, w = 14, k = 7) => (tau <= 0 ? 0 : 1 - Math.exp(-k * tau) * Math.cos(w * tau));
const alfa = (cor: string, a: number) => cor + Math.round(255 * clamp(a, 0, 1)).toString(16).padStart(2, "0");
// os instantes de 0 a fim, de passo em passo (e o fim)
const de = (ini: number, fim: number, passo = 1 / 30) => {
  const n = Math.round((fim - ini) / passo);
  return Array.from({ length: n + 1 }, (_, k) => r3(ini + ((fim - ini) * k) / n));
};

// ---- imagens e atlas: cada arquivo com as paginas dele
type Img = { nome: string; data: Buffer; w: number; h: number; ox: number; oy: number };
class Atlas {
  paginas: any[] = [];
  imagens: any[] = [];
  private porPagina: Img[][] = [];
  constructor(private arquivos: { arquivo: string; largura: number; relevo?: string }[]) {
    this.porPagina = arquivos.map(() => []);
  }
  async svg(pagina: number, nome: string, w: number, h: number, corpo: string, recorta = false): Promise<Img> {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corpo}</svg>`;
    let { data, info } = await sharp(Buffer.from(s)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let [ox, oy, W, H] = [0, 0, info.width, info.height];
    if (recorta) {
      let [x0, y0, x1, y1] = [W, H, -1, -1];
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (data[(y * W + x) * 4 + 3] > 0) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      // folga transparente em volta (o contorno e o halo crescem para fora)
      [x0, y0, x1, y1] = [Math.max(0, x0 - 2), Math.max(0, y0 - 2), Math.min(W - 1, x1 + 2), Math.min(H - 1, y1 + 2)];
      const out = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).raw().toBuffer();
      [data, ox, oy, W, H] = [out, x0, y0, x1 - x0 + 1, y1 - y0 + 1];
    }
    const im = { nome, data, w: W, h: H, ox, oy };
    this.porPagina[pagina].push(im);
    return im;
  }
  // prateleiras, 4 px entre as imagens
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
const pilula = (cor: string, comp: number, larg: number) => `<rect width="${comp * HD}" height="${larg * HD}" rx="${(larg * HD) / 2}" fill="#${cor}"/>`;
const radial = (paradas: [number, number][]) =>
  `<defs><radialGradient id="g">${paradas.map(([o, a]) => `<stop offset="${o}" stop-color="#fff" stop-opacity="${a}"/>`).join("")}</radialGradient></defs>`;

// timelines: ossos[osso][prop] e o resto por nome
class Anim {
  ossos: Record<string, Record<string, any[]>> = {};
  slots: Record<string, Record<string, any[]>> = {};
  efeitos: Record<string, Record<string, any[]>> = {};
  particulas: Record<string, Record<string, any[]>> = {};
  luzes: Record<string, any[]> = {};
  instancias: Record<string, any[]> = {};
  osso(o: string, prop: string, t: number, v: any) {
    ((this.ossos[o] ??= {})[prop] ??= []).push({ tempo: r3(t), ...v });
  }
  json() {
    const out: any = {};
    for (const k of ["ossos", "slots", "efeitos", "particulas", "luzes", "instancias"] as const) if (Object.keys(this[k]).length) out[k] = this[k];
    return out;
  }
}
const escreve = (arquivo: string, b: any) => writeFileSync(join(AQUI, arquivo), JSON.stringify(b, null, 1) + "\n");

// =====================================================================================
// letra.boneco
// =====================================================================================
const FONTE = 128,
  BASE = -100; // a linha de base do nome na cena
const PIVO = 45; // o osso da letra no meio da altura do x (a letra cresce e gira em volta dele)
const LW = 2400,
  LH = 640,
  LB = 440; // a tela da palavra em 2x e a linha de base nela
const atlasLetra = new Atlas([
  { arquivo: "letra.png", largura: 1024, relevo: "letra_relevo.png" },
  { arquivo: "letra_anel.png", largura: 128 },
]);
// a palavra inteira com uma letra visivel de cada vez (o espacamento e o kerning da fonte
// ficam); o lugar de cada letra sai do recorte
const LETRAS: { c: string; x: number; y: number; w: number; h: number }[] = [];
for (let k = 0; k < NOME.length; k++) {
  const texto = `<text x="${LW / 2}" y="${LB}" text-anchor="middle" font-family="Noto Sans" font-weight="800" font-size="${FONTE * HD}" letter-spacing="${-2 * HD}">${[...NOME]
    .map((c, i) => `<tspan fill="#ffffff" fill-opacity="${i === k ? 1 : 0}">${c}</tspan>`)
    .join("")}</text>`;
  const im = await atlasLetra.svg(0, `g_${k}`, LW, LH, texto, true);
  LETRAS.push({ c: NOME[k], x: (im.ox + im.w / 2 - LW / 2) / HD, y: (LB - (im.oy + im.h / 2)) / HD, w: im.w / HD, h: im.h / HD });
}
await atlasLetra.svg(1, "anel", 128, 128, `<circle cx="64" cy="64" r="56" fill="none" stroke="#fff" stroke-width="7"/>`);
await atlasLetra.montar();
// a extrusao da letra: tres camadas para baixo e para a direita, escurecendo
const EXTRUSAO = [
  { x: 7.5, y: -7.5, cor: "6e0f3c" },
  { x: 5, y: -5, cor: "a3165a" },
  { x: 2.5, y: -2.5, cor: "d81f74" },
];
{
  const parte = (k: number) => ({ glifo: { caminho: `g_${k}`, largura: r3(LETRAS[k].w), altura: r3(LETRAS[k].h), y: r3(LETRAS[k].y - PIVO) } });
  const partes = (k: number) => Object.fromEntries([["letra", parte(k)], ...EXTRUSAO.map((_, i) => [`camada_${i}`, parte(k)])]);
  const skins = [{ nome: "default", partes: partes(0) }, ...LETRAS.map((l, k) => ({ nome: l.c, partes: partes(k) }))];
  const chega = new Anim(),
    onda = new Anim(),
    brilha = new Anim(),
    sai = new Anim();
  // chega: de 3,6x (perto de quem assiste) ate o tamanho, acelerando, transparente no comeco;
  // bate em 0,3 e amassa como borracha; o contorno pisca e sai um anel
  const BATE = 0.3;
  for (const t of de(0, 0.75)) {
    const f = Math.min(t / BATE, 1);
    const u = t - BATE;
    const amassa = u < 0 ? 0 : Math.exp(-8 * u) * Math.cos(18 * u);
    const s = t < BATE ? mistura(3.6, 1, f * f) : 1;
    const fim = t >= 0.75 - 1e-6;
    chega.osso("letra", "escalar", t, fim ? { x: 1, y: 1 } : { x: r3(s * (1 + 0.14 * amassa)), y: r3(s * (1 - 0.22 * amassa)) });
    chega.osso("letra", "girar", t, { valor: r3(fim ? 0 : -14 * (1 - f) * (1 - f)) });
    (chega.slots.letra ??= { rgba: [] }).rgba.push({ tempo: t, cor: alfa("ffffff", t / 0.22) });
    EXTRUSAO.forEach((e, i) => (chega.slots[`camada_${i}`] ??= { rgba: [] }).rgba.push({ tempo: t, cor: alfa(e.cor, t / 0.22) }));
  }
  chega.efeitos.letra = {
    rastro: [{ tempo: 0, copias: 5, curva: "degrau" }, { tempo: BATE + 0.05, copias: 0, curva: "degrau" }],
    linha: [{ tempo: 0, largura: 0 }, { tempo: BATE, largura: 0 }, { tempo: BATE + 0.06, largura: 12 }, { tempo: 0.75, largura: 0 }],
  };
  chega.particulas.anel = { rajada: [{ tempo: BATE, quantidade: 1 }] };
  // onda: sobe e desce esticando, com um balanco
  for (const t of de(0, 0.4)) {
    const fo = sino(t, 0, 0.4);
    onda.osso("letra", "mover", t, { x: 0, y: r3(32 * fo) });
    onda.osso("letra", "escalar", t, { x: r3(1 - 0.06 * fo), y: r3(1 + 0.12 * fo) });
    onda.osso("letra", "girar", t, { valor: r3(-6 * Math.sin((2 * Math.PI * t) / 0.4)) });
  }
  onda.efeitos.letra = { rastro: [{ tempo: 0, copias: 4, curva: "degrau" }, { tempo: 0.4, copias: 0, curva: "degrau" }] };
  // flutua (1,6 s em laco): sobe e desce devagar, inclinando um pouco (zero no 0 e no fim)
  const flutua = new Anim();
  for (const t of de(0, 1.6)) {
    const s1 = Math.sin((2 * Math.PI * t) / 1.6);
    flutua.osso("letra", "mover", t, { x: 0, y: r3(6 * s1) });
    flutua.osso("letra", "girar", t, { valor: r3(-2 * Math.sin((4 * Math.PI * t) / 1.6)) });
  }
  brilha.efeitos.letra = { brilho: [{ tempo: 0, forca: 0 }, { tempo: 0.2, forca: 1.1 }, { tempo: 0.6, forca: 0 }] };
  // sai: cresce ate 4,5x acelerando (vem para quem assiste) e some
  for (const t of de(0, 0.45)) {
    const f = t / 0.45;
    sai.osso("letra", "escalar", t, { x: r3(mistura(1, 4.5, f * f)), y: r3(mistura(1, 4.5, f * f)) });
    (sai.slots.letra ??= { rgba: [] }).rgba.push({ tempo: t, cor: alfa("ffffff", 1 - entre(t, 0.08, 0.42)) });
    EXTRUSAO.forEach((e, i) => (sai.slots[`camada_${i}`] ??= { rgba: [] }).rgba.push({ tempo: t, cor: alfa(e.cor, 1 - entre(t, 0.04, 0.3)) }));
  }
  sai.efeitos.letra = { rastro: [{ tempo: 0, copias: 5, curva: "degrau" }] };
  escreve("letra.boneco", {
    boneco: 0,
    nome: "letra",
    paginas: atlasLetra.paginas,
    imagens: atlasLetra.imagens,
    esqueleto: { versao_spine: "4.3.23", pasta_imagens: "./images/", audio: "", x: -60, y: -40, largura: 120, altura: 140 },
    ossos: [{ nome: "root" }, { nome: "letra", pai: "root", y: PIVO }, ...EXTRUSAO.map((e, i) => ({ nome: `camada_${i}`, pai: "letra", x: e.x, y: e.y }))],
    slots: [
      // a extrusao: o mesmo glifo em tres camadas rosa, do fundo (mais escura) para a frente
      ...EXTRUSAO.map((e, i) => ({ nome: `camada_${i}`, osso: `camada_${i}`, parte: "glifo", cor: e.cor + "ff" })),
      {
        nome: "letra",
        osso: "letra",
        parte: "glifo",
        efeitos: { borrar: { forca: 0.03, limite: 50, esmaecer: 0.5 }, rastro: { copias: 0, intervalo: 0.025, alfa: 0.4 }, linha: { cor: ROSA + "ff", largura: 0 }, brilho: { cor: ROSA + "ff", forca: 0, raio: 18 } },
      },
    ],
    skins,
    particulas: [
      { nome: "anel", slot: "letra", osso: "letra", imagem: "anel", blend: "aditivo", taxa: 0, vida: [0.42, 0.42], velocidade: [0, 0], escala: [0.3, 2.2], cor: [ROSA + "ff", ROSA + "00"], maximo: 4 },
    ],
    animacoes: { chega: chega.json(), onda: onda.json(), brilha: brilha.json(), flutua: flutua.json(), sai: sai.json() },
  });
}

// =====================================================================================
// marionete.boneco: o icone (32 unidades; uma unidade, 9 px), com x no meio e o pe do corpo
// no y 40
// =====================================================================================
const U = 9;
const px = (sx: number) => (sx - 16) * U,
  py = (sy: number) => 40 + (28 - sy) * U;
const C0 = { x: 0, y: py(7) }; // o controle: o meio das varetas
// as pontas de baixo das varetas dos lados e a de cima da do meio (ela vai ate dentro da cabeca
// e acompanha a cabeca, como um fio rigido)
const PONTA = { e: { x: px(8), y: py(10) }, m: { x: 0, y: py(3) }, d: { x: px(24), y: py(10) } };
const OMBRO_Y = py(21); // a linha dos ombros (os cantos de cima do corpo)
const OMBRO_X = px(11);
const atlasMar = new Atlas([
  { arquivo: "marionete.png", largura: 512, relevo: "marionete_relevo.png" },
  { arquivo: "marionete_efeitos.png", largura: 256 },
]);
const FIO = 1.5 * U,
  VARA = 2 * U;
await atlasMar.svg(0, "cabeca", 10 * U * HD, 10 * U * HD, `<circle cx="${5 * U * HD}" cy="${5 * U * HD}" r="${5 * U * HD - 1}" fill="#${ROSA}"/>`);
await atlasMar.svg(0, "corpo", 10 * U * HD, 8 * U * HD, `<polygon points="${[0, 1, 5, 0, 10, 1, 9, 8, 1, 8].map((v) => v * U * HD).join(",")}" fill="#${AMARELO}"/>`);
await atlasMar.svg(0, "vara_lado", (6 * U + VARA) * HD, VARA * HD, pilula(ROSA, 6 * U + VARA, VARA));
await atlasMar.svg(0, "vara_meio", (8 * U + VARA) * HD, VARA * HD, pilula(ROSA, 8 * U + VARA, VARA));
const L_FIO = Math.hypot(PONTA.e.x - OMBRO_X, PONTA.e.y - OMBRO_Y);
await atlasMar.svg(0, "fio", (L_FIO + FIO) * HD, FIO * HD, pilula(ROSA, L_FIO + FIO, FIO));
await atlasMar.svg(1, "confete", 24, 14, `<rect x="1" y="1" width="22" height="12" rx="2" fill="#fff"/>`);
await atlasMar.svg(1, "raio", 16, 32, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.42" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.5" stop-color="#fff"/><stop offset="0.58" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="16" height="32" fill="url(#g)"/>`);
await atlasMar.svg(1, "estrela", 64, 64, `${radial([[0, 1], [1, 0]])}<circle cx="32" cy="32" r="14" fill="url(#g)"/><path d="M32 2 C34 26 38 30 62 32 C38 34 34 38 32 62 C30 38 26 34 2 32 C26 30 30 26 32 2Z" fill="#fff"/>`);
await atlasMar.montar();
{
  // o movimento: o controle (deslocamento e giro) e o boneco pendurado (deslocamento, giro,
  // amasso do corpo e giro da cabeca); os fios saem das pontas das varetas ate os ombros
  type Pose = { cx: number; cy: number; ct: number; bx: number; by: number; bt: number; amassa: number; ht: number };
  const REPOUSO: Pose = { cx: 0, cy: 0, ct: 0, bx: 0, by: 0, bt: 0, amassa: 0, ht: 0 };
  const gira = (x: number, y: number, g: number) => {
    const r = (g * Math.PI) / 180;
    return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
  };
  const pontos = (p: Pose) => {
    const c = { x: C0.x + p.cx, y: C0.y + p.cy };
    const ponta = (o: { x: number; y: number }) => {
      const v = gira(o.x - C0.x, o.y - C0.y, p.ct);
      return { x: c.x + v.x, y: c.y + v.y };
    };
    const b = { x: p.bx, y: OMBRO_Y + p.by };
    const noBoneco = (x: number, y: number) => {
      const v = gira(x, y, p.bt);
      return { x: b.x + v.x, y: b.y + v.y };
    };
    const pescoco = noBoneco(0, U);
    const topo = gira(0, 9 * U, p.bt + p.ht);
    return {
      fios: {
        e: [ponta(PONTA.e), noBoneco(OMBRO_X, 0)],
        d: [ponta(PONTA.d), noBoneco(-OMBRO_X, 0)],
        m: [ponta(PONTA.m), { x: pescoco.x + topo.x, y: pescoco.y + topo.y }],
      },
    };
  };
  const SETUP = pontos(REPOUSO);
  const ang = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const comp = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
  // as chaves de uma pose no instante t
  const chaves = (an: Anim, t: number, p: Pose) => {
    an.osso("controle", "mover", t, { x: r3(p.cx), y: r3(p.cy) });
    an.osso("controle", "girar", t, { valor: r3(p.ct) });
    an.osso("boneco", "mover", t, { x: r3(p.bx), y: r3(p.by) });
    an.osso("boneco", "girar", t, { valor: r3(p.bt) });
    an.osso("corpo", "escalar", t, { x: r3(1 + 0.6 * p.amassa), y: r3(1 - p.amassa) });
    an.osso("cabeca", "mover", t, { x: 0, y: r3(-60 * p.amassa) });
    an.osso("cabeca", "girar", t, { valor: r3(p.ht) });
    const agora = pontos(p);
    for (const k of ["e", "d", "m"] as const) {
      const [a0, b0] = SETUP.fios[k],
        [a, b] = agora.fios[k];
      an.osso(`fio_${k}`, "mover", t, { x: r3(a.x - a0.x), y: r3(a.y - a0.y) });
      an.osso(`fio_${k}`, "girar", t, { valor: r3(ang(a, b) - ang(a0, b0)) });
      an.osso(`fio_${k}`, "escalar", t, { x: r3(comp(a, b) / Math.max(comp(a0, b0), 1e-6)), y: 1 });
    }
  };
  // a mola do boneco pendurado: segue o controle com atraso (mais solto de lado que em pe), o
  // corpo amassa com a aceleracao e balanca como pendulo; os ultimos `assenta` segundos vao ao
  // repouso, para emendar com qualquer animacao
  const mole = (an: Anim, dur: number, controle: (t: number) => { cx: number; cy: number; ct: number }, impulso = { t: -1, vx: 0, vy: 0 }, assenta = 0.25) => {
    const dt = 1 / 240;
    let [x, y, vx, vy] = [0, 0, 0, 0];
    const wx = 2 * Math.PI * 1.3,
      wy = 2 * Math.PI * 2.4;
    const amostras = new Map<number, Pose>();
    const passos = Math.round(dur / dt);
    let ay = 0;
    for (let i = 0; i <= passos; i++) {
      const t = i * dt;
      const c = controle(t);
      if (impulso.t >= 0 && Math.abs(t - impulso.t) < dt / 2) (vx += impulso.vx), (vy += impulso.vy);
      const fx = -wx * wx * (x - c.cx) - 2 * 0.2 * wx * vx;
      const fy = -wy * wy * (y - c.cy) - 2 * 0.3 * wy * vy;
      ay = fy;
      vx += fx * dt;
      vy += fy * dt;
      x += vx * dt;
      y += vy * dt;
      if (i % 8 === 0) {
        const k = entre(t, dur - assenta, dur);
        const p: Pose = {
          cx: c.cx,
          cy: c.cy,
          ct: c.ct,
          bx: mistura(x, 0, k),
          by: mistura(y, 0, k),
          bt: mistura(clamp(0.35 * (x - c.cx) + 0.5 * c.ct, -25, 25), 0, k),
          amassa: mistura(clamp(ay / 9000, -0.12, 0.2), 0, k),
          ht: mistura(clamp(-0.25 * vx, -12, 12), 0, k),
        };
        amostras.set(r3(t), p);
      }
    }
    for (const [t, p] of amostras) chaves(an, t, t >= dur - 1e-6 ? REPOUSO : p);
  };
  const chega = new Anim(),
    danca = new Anim(),
    pula = new Anim(),
    eletrico = new Anim();
  // chega (1,6 s): o pai traz do fundo ate 0,65 (os fios tremem); ai o controle para e o boneco
  // cai nos fios e quica; confete. Rastro enquanto vem do fundo (o pai escala: as copias ficam
  // para tras, como um tunel)
  mole(chega, 1.6, (t) => ({ cx: 4 * Math.sin(2 * Math.PI * 3 * t) * (1 - entre(t, 0.4, 0.65)), cy: 0, ct: 0 }), { t: 0.65, vx: 40, vy: -560 }, 0.3);
  const RASTRO = ["corpo", "cabeca", "vara_e", "vara_d", "fio_m"];
  for (const s of RASTRO) chega.efeitos[s] = { rastro: [{ tempo: 0, copias: 6, curva: "degrau" }, { tempo: 0.8, copias: 0, curva: "degrau" }] };
  for (const c of ["confete_rosa", "confete_amarelo", "confete_branco"]) chega.particulas[c] = { rajada: [{ tempo: 0.72, quantidade: 22 }] };
  // danca (0,9 s em laco): o controle balanca e inclina; o boneco vai mais longe, com um
  // repique (tudo zero no 0 e no fim: emenda com o repouso)
  const W = (2 * Math.PI) / 0.9;
  for (const t of de(0, 0.9)) {
    const s1 = Math.sin(W * t),
      s2 = Math.sin(2 * W * t);
    chaves(danca, t, { cx: 22 * s1, cy: 5 * s2, ct: -8 * s1, bx: 34 * s1 + 6 * s2, by: 8 * s2, bt: -11 * s1 - 3 * s2, amassa: 0.06 * s2, ht: 8 * s1 });
  }
  // pula (0,8 s): o controle desce (preparo), da um tranco para cima e volta; o boneco vai atras
  mole(pula, 0.8, (t) => ({ cx: 0, cy: -14 * sino(t, 0, 0.14) + 90 * sino(t, 0.14, 0.5), ct: 0 }), undefined, 0.2);
  // eletrico (0,5 s em laco): tremedeira; raio pelos tres fios, estrelas em volta da cabeca
  for (const t of de(0, 0.5)) {
    const s4 = Math.sin(2 * Math.PI * 4 * t),
      s6 = Math.sin(2 * Math.PI * 6 * t);
    chaves(eletrico, t, { cx: 3 * s4, cy: 2 * s6, ct: 2 * s6, bx: 6 * s4, by: 3 * s6, bt: 4 * s6, amassa: 0.05 * s6, ht: 7 * s4 });
  }
  const ESTALOS = [0, 0.06, 0.1, 0.18, 0.24, 0.31, 0.36, 0.44];
  for (const r of ["raio_e", "raio_d", "raio_m"]) eletrico.particulas[r] = { taxa: ESTALOS.map((t, i) => ({ tempo: t, valor: i % 2 ? 0.35 : 1, curva: "degrau" })) };
  eletrico.particulas.estrelas = { taxa: [{ tempo: 0, valor: 1 }] };
  const fio = (k: string) => {
    const [a, b] = SETUP.fios[k as "e"];
    return { nome: `fio_${k}`, pai: "root", x: r3(a.x), y: r3(a.y), rotacao: r3(ang(a, b)), comprimento: r3(comp(a, b)) };
  };
  const raio = (k: string, ate: string) => ({ nome: `raio_${k}`, tipo: "raio", slot: "raio", osso: `ponta_${k}`, ate, imagem: "raio", blend: "aditivo", taxa: 0, largura: 12, segmentos: 9, desvio: 0.18, ramos: 2, troca: 0.05, cor: ["bfeaffff"], semente: k.charCodeAt(0) });
  const confete = (nome: string, cor: string, semente: number) => ({
    nome,
    slot: "confete",
    osso: "cabeca",
    y: 5 * U,
    imagem: "confete",
    taxa: 0,
    vida: [1.2, 1.9],
    velocidade: [200, 430],
    angulo: 90,
    abertura: 150,
    gravidade: 520,
    arrasto: 1.4,
    escala: [0.75, 0.55],
    giro: [-620, 620],
    cor: [cor + "ff", cor + "ff", cor + "00"],
    semente,
  });
  const lado = 6 * U + VARA;
  const fm = fio("m");
  escreve("marionete.boneco", {
    boneco: 0,
    nome: "marionete",
    paginas: atlasMar.paginas,
    imagens: atlasMar.imagens,
    esqueleto: { versao_spine: "4.3.23", pasta_imagens: "./images/", audio: "", x: -110, y: 30, largura: 220, altura: 250 },
    ossos: [
      { nome: "root" },
      { nome: "controle", pai: "root", x: C0.x, y: C0.y },
      ...(["e", "m", "d"] as const).flatMap((k) => [
        ...(k === "m" ? [] : [{ nome: `vara_${k}`, pai: "controle", x: PONTA[k].x }]),
        { nome: `ponta_${k}`, pai: "controle", x: PONTA[k].x, y: PONTA[k].y - C0.y },
      ]),
      { nome: "boneco", pai: "root", y: OMBRO_Y },
      { nome: "corpo", pai: "boneco" },
      { nome: "ombro_e", pai: "boneco", x: OMBRO_X },
      { nome: "ombro_d", pai: "boneco", x: -OMBRO_X },
      { nome: "cabeca", pai: "boneco", y: U },
      { nome: "topo", pai: "cabeca", y: 9 * U },
      fio("e"),
      fio("d"),
      fm,
    ],
    slots: [
      { nome: "orbita_atras", osso: "cabeca", blend: "aditivo" },
      { nome: "fio_e", osso: "fio_e", parte: "fio" },
      { nome: "fio_d", osso: "fio_d", parte: "fio" },
      { nome: "fio_m", osso: "fio_m", parte: "vara_meio", efeitos: { rastro: { copias: 0, intervalo: 0.03, alfa: 0.4 } } },
      ...(["e", "d"] as const).map((k) => ({ nome: `vara_${k}`, osso: `vara_${k}`, parte: "vara_lado", efeitos: { rastro: { copias: 0, intervalo: 0.03, alfa: 0.4 } } })),
      { nome: "corpo", osso: "corpo", parte: "corpo", efeitos: { rastro: { copias: 0, intervalo: 0.03, alfa: 0.4 }, borrar: { forca: 0.03, limite: 50, esmaecer: 0.5 } } },
      { nome: "cabeca", osso: "cabeca", parte: "cabeca", efeitos: { rastro: { copias: 0, intervalo: 0.03, alfa: 0.4 }, borrar: { forca: 0.03, limite: 50, esmaecer: 0.5 } } },
      { nome: "orbita_frente", osso: "cabeca", blend: "aditivo" },
      { nome: "raio", osso: "root", blend: "aditivo" },
      { nome: "confete", osso: "root" },
    ],
    skins: [
      {
        nome: "default",
        partes: {
          fio_e: { fio: { largura: r3(L_FIO + FIO), altura: FIO, x: r3(L_FIO / 2) } },
          fio_d: { fio: { largura: r3(L_FIO + FIO), altura: FIO, x: r3(L_FIO / 2) } },
          fio_m: { vara_meio: { largura: r3(fm.comprimento + VARA), altura: VARA, x: r3(fm.comprimento / 2) } },
          vara_e: { vara_lado: { largura: lado, altura: VARA, rotacao: 90 } },
          vara_d: { vara_lado: { largura: lado, altura: VARA, rotacao: 90 } },
          corpo: { corpo: { largura: 10 * U, altura: 8 * U, y: -3.5 * U } },
          cabeca: { cabeca: { largura: 10 * U, altura: 10 * U, y: 5 * U } },
        },
      },
    ],
    particulas: [
      confete("confete_rosa", ROSA, 1),
      confete("confete_amarelo", AMARELO, 2),
      confete("confete_branco", "ffffff", 3),
      raio("e", "ombro_e"),
      raio("d", "ombro_d"),
      raio("m", "topo"),
      {
        nome: "estrelas",
        tipo: "orbita",
        slot: "orbita_frente",
        atras: "orbita_atras",
        osso: "cabeca",
        y: 5 * U,
        imagem: "estrela",
        blend: "aditivo",
        taxa: 0,
        raios: [95, 20],
        volta: 1,
        quantidade: 9,
        faixa: 10,
        inclinacao: -10,
        profundidade: 0.45,
        escala: [0.32, 0.32],
        giro: [-160, 160],
        cor: ["fff1a8ff", "ff2e8899"],
        semente: 5,
      },
    ],
    animacoes: { danca: danca.json(), chega: chega.json(), pula: pula.json(), eletrico: eletrico.json() },
  });
}

// =====================================================================================
// vinheta.boneco: a cena
// =====================================================================================
const atlasCena = new Atlas([
  { arquivo: "vinheta.png", largura: 2048 },
  { arquivo: "efeitos.png", largura: 256 },
  { arquivo: "fundo.png", largura: 256 },
]);
await atlasCena.svg(0, "barra", 120 * HD, 6 * HD, `<rect width="${120 * HD}" height="${6 * HD}" rx="${3 * HD}" fill="#${ROSA}"/>`);
const sub = await atlasCena.svg(
  0,
  "subtitulo",
  1600,
  140,
  `<text x="800" y="90" text-anchor="middle" font-family="Noto Sans" font-weight="600" font-size="${34 * HD}" letter-spacing="${HD}" fill="#e4def0">${SUBTITULO}</text>`,
  true,
);
await atlasCena.svg(1, "ponto", 64, 64, `${radial([[0, 1], [0.25, 0.85], [1, 0]])}<circle cx="32" cy="32" r="32" fill="url(#g)"/>`);
await atlasCena.svg(1, "halo", 128, 128, `${radial([[0, 0.9], [0.35, 0.35], [1, 0]])}<circle cx="64" cy="64" r="64" fill="url(#g)"/>`);
await atlasCena.svg(
  2,
  "fundo",
  256,
  144,
  `<defs><radialGradient id="f" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#2c2438"/><stop offset="0.6" stop-color="#1d1a24"/><stop offset="1" stop-color="#121016"/></radialGradient></defs><rect width="256" height="144" fill="url(#f)"/>`,
);
await atlasCena.montar();
{
  const an = new Anim();
  const SUB_Y = -222,
    BARRA_Y = -172;
  const CABECA = { x: 0, y: py(15) }; // o centro da cabeca da marionete em repouso
  // a marionete: vem do fundo (de 5% a 100%, girando, a cabeca saindo do meio da tela) e, na
  // saida, a camera mergulha na cabeca (14x, a cabeca indo para o meio) e escurece
  const ENTRA = [0.05, 0.7],
    MERGULHA = [7.15, 7.85];
  const fundo = (t: number) => {
    if (t < MERGULHA[0]) {
      const f = clamp((t - ENTRA[0]) / (ENTRA[1] - ENTRA[0]), 0, 1);
      // devagar no fundo e rapido perto (a perspectiva: o tamanho na tela cresce como 1/distancia)
      const e = f * f * f;
      const s = mistura(0.05, 1, e);
      const alvo = { x: mistura(0, CABECA.x, e), y: mistura(30, CABECA.y, e) };
      return { s, x: alvo.x - s * CABECA.x, y: alvo.y - s * CABECA.y, g: -40 * (1 - e) };
    }
    const f = entre(t, MERGULHA[0], MERGULHA[1]);
    const s = Math.exp(Math.log(14) * f * f);
    const alvo = { x: CABECA.x, y: mistura(CABECA.y, 20, f) };
    return { s, x: alvo.x - s * CABECA.x, y: alvo.y - s * CABECA.y, g: 0 };
  };
  for (const t of [...de(0, ENTRA[1] + 0.05), ...de(MERGULHA[0] - 0.05, DUR)]) {
    const p = fundo(t);
    an.osso("cena_boneco", "escalar", t, { x: r3(p.s), y: r3(p.s) });
    an.osso("cena_boneco", "mover", t, { x: r3(p.x), y: r3(p.y) });
    an.osso("cena_boneco", "girar", t, { valor: r3(p.g) });
  }
  // escondida, a instancia nem e calculada (o slot com alfa 0)
  an.slots.marionete = {
    rgba: [
      { tempo: 0, cor: "ffffff00", curva: "degrau" },
      { tempo: ENTRA[0], cor: "ffffffff" },
      { tempo: 7.78, cor: "ffffffff" },
      { tempo: 7.95, cor: "ffffff00" },
    ],
  };
  // o que a marionete toca: as trocas caem no fim de um laco da anterior (repouso: sem salto)
  an.instancias.marionete = [
    { tempo: 0, animacao: "chega", inicio: -ENTRA[0], repetir: false },
    { tempo: 1.65, animacao: "danca", inicio: 0, repetir: true },
    { tempo: 3.45, animacao: "pula", inicio: 0, repetir: false },
    { tempo: 4.25, animacao: "eletrico", inicio: 0, repetir: true },
    { tempo: 5.25, animacao: "danca", inicio: 0, repetir: true },
  ];
  // as letras: chega (defasada), onda, brilha e sai (do meio para as pontas); o slot apagado
  // antes de chegar e depois de sair (a instancia nao e calculada)
  const LET_INI = 1.0,
    LET_PASSO = 0.085,
    ONDA = 3.4,
    ONDA_PASSO = 0.065;
  LETRAS.forEach((_, k) => {
    const chega = LET_INI + LET_PASSO * k,
      sai = 7.0 + 0.035 * Math.abs(k - 4);
    an.instancias[`letra_${k}`] = [
      { tempo: 0, animacao: "chega", inicio: r3(-chega), repetir: false },
      { tempo: r3(ONDA + ONDA_PASSO * k), animacao: "onda", inicio: 0 },
      { tempo: r3(5.4 + 0.06 * k), animacao: "brilha", inicio: 0 },
      // depois do brilho flutua (cada uma comeca numa hora: a onda anda pelo nome)
      { tempo: r3(6.0 + 0.06 * k), animacao: "flutua", inicio: 0, repetir: true },
      { tempo: r3(sai), animacao: "sai", inicio: 0 },
    ];
    an.slots[`letra_${k}`] = {
      rgba: [
        { tempo: 0, cor: "ffffff00", curva: "degrau" },
        { tempo: r3(chega), cor: "ffffffff", curva: "degrau" },
        { tempo: r3(sai + 0.46), cor: "ffffff00", curva: "degrau" },
      ],
    };
  });
  // a barra cresce com mola; o subtitulo aparece dissolvendo ao contrario e some na saida
  for (const t of [0, ...de(4.75, 5.4), 6.9, ...de(6.95, 7.25)]) an.osso("barra", "escalar", t, { x: r3(t < 6.9 ? Math.max(0, mola(t - 4.75, 11, 6)) : 1 - entre(t, 6.95, 7.25)), y: 1 });
  an.efeitos.subtitulo = { dissolver: [{ tempo: 0, valor: 1 }, { tempo: 4.8, valor: 1 }, { tempo: 5.45, valor: 0 }, { tempo: 6.95, valor: 0 }, { tempo: 7.35, valor: 1 }] };
  // o halo atras da marionete: acende na chegada e no raio; some no mergulho
  an.slots.halo = {
    rgba: [
      { tempo: 0, cor: ROSA + "00" },
      { tempo: 0.62, cor: ROSA + "00" },
      { tempo: 0.78, cor: alfa(ROSA, 0.75) },
      { tempo: 1.4, cor: alfa(ROSA, 0.22) },
      { tempo: 4.2, cor: alfa(ROSA, 0.22) },
      { tempo: 4.4, cor: alfa("7fd8ff", 0.55) },
      { tempo: 5.1, cor: alfa("7fd8ff", 0.55) },
      { tempo: 5.3, cor: alfa(ROSA, 0.22) },
      { tempo: 7.1, cor: alfa(ROSA, 0.22) },
      { tempo: 7.4, cor: ROSA + "00" },
    ],
  };
  // a luz que varre o nome e a do raio (pisca com os estalos da marionete)
  for (const t of de(2.3, 3.45, 0.1)) an.osso("luz_varre", "mover", t, { x: r3(1240 * clamp((t - 2.3) / 1.15, 0, 1)), y: 0 });
  an.luzes.varre = [{ tempo: 0, forca: 0 }, { tempo: 2.3, forca: 0 }, { tempo: 2.6, forca: 3.2 }, { tempo: 3.15, forca: 3.2 }, { tempo: 3.45, forca: 0 }];
  const estalos = Array.from({ length: 16 }, (_, k) => 4.25 + k * 0.0625);
  an.luzes.faisca = [{ tempo: 0, forca: 0, curva: "degrau" }, ...estalos.map((t, i) => ({ tempo: r3(t), forca: i % 2 ? 0.7 : 2.2, curva: "degrau" })), { tempo: 5.25, forca: 0, curva: "degrau" }];
  // a poeira: pontinhos que vem do fundo em direcao a quem assiste (nascem no meio e crescem
  // andando para fora, acelerando)
  an.particulas.poeira = { rajada: [{ tempo: 0, quantidade: 14 }] };

  const BASE_LETRA = BASE;
  escreve("vinheta.boneco", {
    boneco: 0,
    nome: "vinheta",
    paginas: atlasCena.paginas,
    imagens: atlasCena.imagens,
    esqueleto: { versao_spine: "4.3.23", pasta_imagens: "./images/", audio: "", x: -480, y: -263, largura: 960, altura: 540 },
    ossos: [
      { nome: "root" },
      { nome: "cena_boneco", pai: "root" },
      { nome: "letras", pai: "root" },
      ...LETRAS.map((l, k) => ({ nome: `letra_${k}`, pai: "letras", x: r3(l.x), y: BASE_LETRA })),
      { nome: "barra", pai: "root", y: BARRA_Y },
      { nome: "subtitulo", pai: "root", y: SUB_Y },
      { nome: "luz_varre", pai: "root", x: -620, y: -60 },
    ],
    slots: [
      { nome: "fundo", osso: "root", parte: "fundo" },
      { nome: "poeira", osso: "root", blend: "aditivo" },
      { nome: "halo", osso: "cena_boneco", parte: "halo", blend: "aditivo", cor: ROSA + "00" },
      { nome: "marionete", osso: "cena_boneco" },
      ...LETRAS.map((_, k) => ({ nome: `letra_${k}`, osso: `letra_${k}` })),
      { nome: "barra", osso: "barra", parte: "barra" },
      { nome: "subtitulo", osso: "subtitulo", parte: "subtitulo", efeitos: { dissolver: { valor: 0, cor: ROSA + "ff", borda: 0.12, grao: 6 } } },
    ],
    skins: [
      {
        nome: "default",
        partes: {
          fundo: { fundo: { largura: 1000, altura: 580, y: 7 } },
          halo: { halo: { largura: 380, altura: 380, x: CABECA.x, y: CABECA.y - 20 } },
          barra: { barra: { largura: 120, altura: 6 } },
          subtitulo: { subtitulo: { largura: r3(sub.w / HD), altura: r3(sub.h / HD) } },
        },
      },
    ],
    instancias: [
      { nome: "marionete", slot: "marionete", boneco: "marionete.boneco", animacao: "danca" },
      ...LETRAS.map((l, k) => ({ nome: `letra_${k}`, slot: `letra_${k}`, boneco: "letra.boneco", skin: l.c, animacao: "chega", repetir: false })),
    ],
    particulas: [
      {
        nome: "poeira",
        slot: "poeira",
        osso: "root",
        y: 20,
        imagem: "ponto",
        blend: "aditivo",
        taxa: 7,
        vida: [2.2, 3.4],
        velocidade: [25, 70],
        angulo: 90,
        abertura: 360,
        arrasto: -0.9,
        escala: [0.04, 0.55],
        cor: ["c9b8ff00", "c9b8ff40", "ff2e8838", "ff2e8800"],
        semente: 3,
      },
    ],
    luzes: [
      { nome: "chave", osso: "root", x: -320, y: 320, cor: "fff6faff", forca: 0.32, raio: 2200, altura: 420 },
      { nome: "varre", osso: "luz_varre", cor: "ffd2e8ff", forca: 0, raio: 300, altura: 40 },
      { nome: "faisca", osso: "cena_boneco", y: 200, cor: "a8e2ffff", forca: 0, raio: 520, altura: 90 },
    ],
    ambiente: { cor: "e8e2ffff", forca: 0.68 },
    animacoes: { vinheta: an.json() },
  });
}

// o relevo das pecas que recebem luz: a marionete pela silhueta montada, as letras cada uma pela
// borda dela (as skins trocam a imagem)
for (const [arquivo, extra] of [
  ["marionete.boneco", ["--borda", "10", "--paginas", "0"]],
  ["letra.boneco", ["--borda", "10", "--paginas", "0", "--modo", "peca"]],
] as const) {
  const r = spawnSync("npx", ["tsx", join(AQUI, "..", "..", "tools", "relevo.ts"), join(AQUI, arquivo), ...extra], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`relevo de ${arquivo}: ${r.stderr}`);
}
console.log(`vinheta: ${LETRAS.length} letras e a marionete por instancias`);
