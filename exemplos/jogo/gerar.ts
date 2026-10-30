// Um jogo de mentira feito so com o Mamulengo: um corredor de plataformas com a arte CC0 da
// Kenney (Jumper Pack, UI Pack e Particle Pack) e o robo da vitrine como heroi. A cena inteira e
// um .boneco: o fundo em camadas, as plataformas, as moedas, um inimigo, a interface e o heroi
// (o rig da vitrine, com efeitos, particulas e jato, preso ao osso "heroi").
//
//   npx tsx exemplos/jogo/gerar.ts <pasta com jumper-pack, ui-pack e particle-pack extraidos>
//
// A pasta tem os zips da Kenney extraidos em <pack>/extraido (kenney.nl/assets: jumper-pack,
// ui-pack, particle-pack). Escreve exemplos/jogo/jogo.boneco e as paginas do atlas.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { chavesJato } from "../vitrine/jato.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PACKS = process.argv[2];
if (!PACKS) throw new Error("uso: npx tsx exemplos/jogo/gerar.ts <pasta com os packs da Kenney extraidos>");
const JUMPER = join(PACKS, "jumper-pack", "extraido", "PNG");
const UI = join(PACKS, "ui-pack", "extraido");
const PART = join(PACKS, "particle-pack", "extraido", "PNG (Transparent)");

// a tela do jogo: 1280 x 720, origem no canto de baixo e da esquerda, y para cima
const W = 1280,
  H = 720;

// ---- imagens: cada uma vira um buffer RGBA no tamanho final, depois um atlas

type Img = { nome: string; png: Buffer; w: number; h: number };
const imagens: Img[] = [];
async function poe(nome: string, arquivo: string, op: { escala?: number; largura?: number; corte?: { left: number; top: number; width: number; height: number } } = {}) {
  let s = sharp(arquivo).ensureAlpha();
  const meta = await sharp(arquivo).metadata();
  let w = meta.width!,
    h = meta.height!;
  if (op.escala || op.largura) {
    const e = op.escala ?? op.largura! / w;
    w = Math.round(w * e);
    h = Math.round(h * e);
    s = s.resize(w, h);
  }
  let png = await s.png().toBuffer();
  if (op.corte) {
    png = await sharp(png).extract(op.corte).png().toBuffer();
    w = op.corte.width;
    h = op.corte.height;
  }
  imagens.push({ nome, png, w, h });
}
// textos da interface, desenhados com a fonte do UI Pack
async function texto(nome: string, t: string, px: number, cor = "#ffffff") {
  const png = await sharp({ text: { text: `<span foreground="${cor}">${t}</span>`, fontfile: join(UI, "Font", "Kenney Future.ttf"), font: `Kenney Future ${px}`, rgba: true, dpi: 72 } }).png().toBuffer();
  const m = await sharp(png).metadata();
  imagens.push({ nome, png, w: m.width!, h: m.height! });
}

// o fundo: as quatro camadas reduzidas para a largura da tela, so a faixa de baixo (a de cima
// e ceu liso)
for (let k = 1; k <= 4; k++) await poe(`fundo_${k}`, join(JUMPER, "Background", `bg_layer${k}.png`), { largura: W, corte: { left: 0, top: W - H, width: W, height: H } });
await poe("plataforma", join(JUMPER, "Environment", "ground_grass.png"), { escala: 0.7 });
await poe("plataforma_peq", join(JUMPER, "Environment", "ground_grass_small.png"), { escala: 0.7 });
await poe("plataforma_madeira", join(JUMPER, "Environment", "ground_wood_small.png"), { escala: 0.7 });
await poe("cogumelo", join(JUMPER, "Environment", "mushroom_red.png"), { escala: 0.6 });
await poe("grama", join(JUMPER, "Environment", "grass1.png"), { escala: 0.6 });
for (let k = 1; k <= 4; k++) await poe(`moeda_${k}`, join(JUMPER, "Items", `gold_${k}.png`), { escala: 0.55 });
for (let k = 1; k <= 5; k++) await poe(`asa_${k}`, join(JUMPER, "Enemies", `wingMan${k}.png`), { escala: 0.6 });
await poe("nuvem", join(JUMPER, "Enemies", "cloud.png"), { escala: 0.7 });
await poe("propulsor", join(JUMPER, "Items", "powerup_jetpack.png"), { escala: 0.8 });
await poe("vida", join(JUMPER, "HUD", "lifes.png"), { escala: 0.55 });
await poe("moeda_hud", join(JUMPER, "HUD", "coin_gold.png"), { escala: 0.7 });
await poe("painel", join(UI, "PNG", "Yellow", "Default", "button_rectangle_depth_gloss.png"), { escala: 1.2 });
await poe("painel_azul", join(UI, "PNG", "Blue", "Default", "button_rectangle_depth_gloss.png"), { escala: 1 });
await poe("brilho_moeda", join(PART, "star_06.png"), { escala: 0.25 });
await texto("txt_pontos", "01250", 34, "#5a3a10");
await texto("txt_moedas", "12", 30);
await texto("txt_mais", "+100", 30, "#ffe36b");

// ---- atlas: prateleiras numa pagina de ate 2048 x 2048 (com 2 px entre as imagens)

const PAG = 2048,
  ESP = 2;
type Lugar = { pagina: number; x: number; y: number };
const lugares = new Map<string, Lugar>();
const paginas: { w: number; h: number; itens: { img: Img; x: number; y: number }[] }[] = [];
{
  let pag = -1,
    x = 0,
    y = 0,
    alt = 0;
  const nova = () => {
    paginas.push({ w: 0, h: 0, itens: [] });
    pag = paginas.length - 1;
    x = y = alt = 0;
  };
  nova();
  for (const img of [...imagens].sort((a, b) => b.h - a.h)) {
    if (x + img.w > PAG) {
      x = 0;
      y += alt + ESP;
      alt = 0;
    }
    if (y + img.h > PAG) nova();
    paginas[pag].itens.push({ img, x, y });
    paginas[pag].w = Math.max(paginas[pag].w, x + img.w);
    paginas[pag].h = Math.max(paginas[pag].h, y + img.h);
    lugares.set(img.nome, { pagina: pag, x, y });
    x += img.w + ESP;
    alt = Math.max(alt, img.h);
  }
}
const arquivosPag: string[] = [];
for (const [k, p] of paginas.entries()) {
  const arquivo = `jogo_${k + 1}.webp`;
  await sharp({ create: { width: p.w, height: p.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(p.itens.map((i) => ({ input: i.img.png, left: i.x, top: i.y })))
    .webp({ lossless: true })
    .toFile(join(AQUI, arquivo));
  arquivosPag.push(arquivo);
}

// ---- o .boneco da cena

const b: any = {
  boneco: 0,
  nome: "jogo",
  paginas: paginas.map((p, k) => ({ arquivo: arquivosPag[k], tamanho: [p.w, p.h] })),
  imagens: imagens.map((i) => ({ nome: i.nome, pagina: lugares.get(i.nome)!.pagina, ret: [lugares.get(i.nome)!.x, lugares.get(i.nome)!.y, i.w, i.h] })),
  esqueleto: { x: 0, y: 0, largura: W, altura: H },
  ossos: [{ nome: "root" }],
  slots: [],
  skins: [{ nome: "default", partes: {} }],
  animacoes: {},
};
const tam = (nome: string) => imagens.find((i) => i.nome === nome)!;
const osso = (nome: string, pai: string, x = 0, y = 0, extra: any = {}) => b.ossos.push({ nome, pai, ...(x ? { x } : {}), ...(y ? { y } : {}), ...extra });
// uma camada: slot no osso com a imagem (o tamanho da imagem), opcionalmente com blend e cor
const camada = (slot: string, ossoNome: string, imagem: string, op: { x?: number; y?: number; blend?: string; cor?: string; parte?: string } = {}) => {
  const t = tam(imagem);
  b.slots.push({ nome: slot, osso: ossoNome, parte: op.parte ?? imagem, ...(op.blend ? { blend: op.blend } : {}), ...(op.cor ? { cor: op.cor } : {}) });
  (b.skins[0].partes[slot] ??= {})[op.parte ?? imagem] = { ...(op.parte ? { caminho: imagem } : {}), x: op.x ?? 0, y: op.y ?? 0, largura: t.w, altura: t.h };
};

// mais partes num slot (os outros quadros de uma troca de imagem)
const quadros = (slot: string, nomes: string[]) => {
  for (const n of nomes) {
    const t = tam(n);
    b.skins[0].partes[slot][n] = { largura: t.w, altura: t.h };
  }
};

// fundo: cada camada num osso proprio (o paralaxe anda os ossos), centrada na tela
for (let k = 1; k <= 4; k++) {
  osso(`fundo_${k}`, "root", W / 2, H / 2);
  camada(`fundo_${k}`, `fundo_${k}`, `fundo_${k}`);
}
osso("nuvem", "root", 980, 600);
camada("nuvem", "nuvem", "nuvem", { cor: "ffffffcc" });

// o mundo do jogo (plataformas, moedas, inimigo) num osso que corre para a esquerda: 3200 px nos
// 8 s do laco (400 px/s). O heroi fica em x = 300 na tela, entao no mundo ele passa por
// 300 + 400 t. O que aparece no comeco tem uma copia 3200 px adiante, que e o que aparece no fim
const DUR = 8,
  VEL = 400,
  HX = 300;
const noMundo = (t: number) => HX + VEL * t;
osso("mundo", "root");
const PLATS = [
  { nome: "plat_a", x: 300, y: 150, img: "plataforma", deco: [["cogumelo", 110, 52]] },
  { nome: "plat_b", x: 900, y: 260, img: "plataforma_peq", deco: [["grama", -40, 48]] },
  { nome: "plat_c", x: 1560, y: 140, img: "plataforma_madeira", deco: [] },
  { nome: "plat_d", x: 2990, y: 190, img: "plataforma_madeira", deco: [] },
];
for (const p of PLATS)
  for (const copia of [0, 1]) {
    if (copia && p.x + VEL * DUR - VEL * DUR > W) continue; // so copia o que aparece no comeco
    const n = copia ? `${p.nome}_2` : p.nome;
    osso(n, "mundo", p.x + copia * VEL * DUR, p.y);
    camada(n, n, p.img);
    for (const [img, dx, dy] of p.deco as [string, number, number][]) {
      osso(`${n}_${img}`, n, dx, dy);
      camada(`${n}_${img}`, `${n}_${img}`, img);
    }
  }
// ---- o heroi: o rig da vitrine inteiro, com prefixo, preso ao osso "heroi"
const robo = JSON.parse(readFileSync(join(AQUI, "..", "vitrine", "vitrine.boneco"), "utf8"));
const P = (n: string) => `robo.${n}`;
osso("heroi", "root", 300, 190, { escala_x: 0.62, escala_y: 0.62 });
const base = b.paginas.length;
// as paginas do robo (e o relevo delas) ficam na pasta da vitrine
for (const pg of robo.paginas) b.paginas.push({ ...pg, arquivo: `../vitrine/${pg.arquivo}`, ...(pg.relevo ? { relevo: `../vitrine/${pg.relevo}` } : {}) });
for (const im of robo.imagens) b.imagens.push({ ...im, nome: P(im.nome), pagina: im.pagina + base });
for (const o of robo.ossos) b.ossos.push({ ...o, nome: P(o.nome), pai: o.pai ? P(o.pai) : "heroi" });
for (const s of robo.slots) b.slots.push({ ...s, nome: P(s.nome), osso: P(s.osso) });
for (const [slot, partes] of Object.entries<any>(robo.skins[0].partes)) {
  const novo: any = {};
  for (const [nome, p] of Object.entries<any>(partes)) {
    novo[nome] = { ...p, caminho: P(p.caminho ?? nome) };
    if (p.fim) novo[nome].fim = P(p.fim);
    if (p.pesos) novo[nome].pesos = p.pesos.map((v: any[]) => v.map(([o, x, y, w]: any[]) => [P(o), x, y, w]));
  }
  b.skins[0].partes[P(slot)] = novo;
}
b.particulas = (robo.particulas ?? []).map((e: any) => ({
  ...e,
  nome: P(e.nome),
  slot: P(e.slot),
  imagem: P(e.imagem),
  ...(e.osso ? { osso: P(e.osso) } : {}),
  ...(e.ate ? { ate: P(e.ate) } : {}),
  ...(e.atras ? { atras: P(e.atras) } : {}),
}));

// ---- a interface, por cima de tudo
osso("hud", "root", 0, H);
osso("painel", "hud", 150, -50);
camada("painel", "painel", "painel");
osso("txt_pontos", "painel", 0, 4);
camada("txt_pontos", "txt_pontos", "txt_pontos");
osso("painel_moedas", "hud", W - 150, -50);
camada("painel_moedas", "painel_moedas", "painel_azul");
osso("moeda_hud", "painel_moedas", -55, 2);
camada("moeda_hud", "moeda_hud", "moeda_hud");
osso("txt_moedas", "painel_moedas", 18, 4);
camada("txt_moedas", "txt_moedas", "txt_moedas");
for (let k = 0; k < 3; k++) {
  osso(`vida_${k}`, "hud", 330 + k * 40, -50);
  camada(`vida_${k}`, `vida_${k}`, "vida");
}

// ---- a animacao "jogo" (8 s em laco)

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const ossosA: any = {},
  slotsA: any = {},
  efeitosA: any = {},
  particulasA: any = {};

// o trajeto do heroi (altura dos pes na tela): plataforma A, pulo com tres moedas, plataforma
// B, pulo que pisa no inimigo, o propulsor e o voo com moedas, a plataforma D e de volta a A
const SUAVE_SOBE = [0.25, 0.6, 0.55, 1],
  SUAVE_DESCE = [0.45, 0, 0.75, 0.4];
const curva = (c: number[]) => [c[0], c[1], c[2], c[3]];
const ALTURA: [number, number, number[] | null][] = [
  [0, 190, null],
  [0.3, 190, SUAVE_SOBE],
  [0.85, 400, SUAVE_DESCE],
  [1.4, 300, null],
  [1.75, 300, SUAVE_SOBE],
  [2.12, 520, SUAVE_DESCE],
  [2.3, 470, SUAVE_SOBE],
  [2.62, 560, SUAVE_DESCE],
  [2.95, 470, null],
  [3.5, 455, null],
  [4.1, 425, null],
  [4.7, 460, null],
  [5.3, 430, null],
  [5.75, 425, SUAVE_DESCE],
  [6.5, 230, null],
  [6.9, 230, SUAVE_SOBE],
  [7.3, 340, SUAVE_DESCE],
  [7.7, 190, null],
  [8, 190, null],
];
const alturaEm = (t: number) => {
  for (let k = 0; k + 1 < ALTURA.length; k++) {
    const [t0, y0] = ALTURA[k],
      [t1, y1] = ALTURA[k + 1];
    if (t >= t0 && t <= t1) return y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
  }
  return 190;
};
ossosA.heroi = {
  mover: ALTURA.map(([t, y, c], k) => {
    const prox = ALTURA[k + 1];
    const chave: any = { tempo: t, x: 0, y: y - 190 };
    // a curva vale para y (o segundo canal); x fica linear
    if (c && prox) chave.curva = [r3(t + (prox[0] - t) / 3), 0, r3(t + (2 * (prox[0] - t)) / 3), 0, r3(t + c[0] * (prox[0] - t)), r3(y - 190 + c[1] * (prox[1] - y)), r3(t + c[2] * (prox[0] - t)), r3(y - 190 + c[3] * (prox[1] - y))];
    return chave;
  }),
};
void curva;

// o mundo corre; o fundo em paralaxe: arvores 2 telas por laco, colinas 1, nuvens e ceu parados
ossosA.mundo = { mover: [{ x: 0, y: 0 }, { tempo: DUR, x: -VEL * DUR, y: 0 }] };
for (const [k, telas] of [
  [3, 1],
  [4, 2],
] as [number, number][]) {
  for (let c = 1; c <= telas; c++) {
    osso(`fundo_${k}_${c}`, `fundo_${k}`, c * W, 0);
    // a copia desenha logo depois da camada original
    const i0 = b.slots.findIndex((s: any) => s.nome === `fundo_${k}`);
    b.slots.splice(i0 + c, 0, { nome: `fundo_${k}_${c}`, osso: `fundo_${k}_${c}`, parte: `fundo_${k}` });
    b.skins[0].partes[`fundo_${k}_${c}`] = { [`fundo_${k}`]: { largura: W, altura: H } };
  }
  ossosA[`fundo_${k}`] = { mover: [{ x: 0, y: 0 }, { tempo: DUR, x: -W * telas, y: 0 }] };
}

// moedas: tres no arco do primeiro pulo e cinco no voo, cada uma onde o heroi passa
const MOEDAS_T = [0.62, 0.8, 0.98, 3.4, 3.7, 4.0, 4.3, 4.6];
const GIRO = ["moeda_1", "moeda_2", "moeda_3", "moeda_4", "moeda_3", "moeda_2"];
// a moeda gira por troca de quadros (o verso espelhado): 12 quadros por volta, 10 voltas no laco
const QM = DUR / 120;
const giroMoeda = (k: number) => {
  const giro: any[] = [],
    esc: any[] = [];
  for (let q = 0; q < 120; q++) {
    const f = (q + k * 2) % (GIRO.length * 2);
    giro.push({ tempo: r3(q * QM), nome: GIRO[f % GIRO.length] });
    esc.push({ tempo: r3(q * QM), x: f < GIRO.length ? 1 : -1, y: 1, curva: "degrau" });
  }
  return { giro, esc };
};
// o que esta na tela no comeco tem uma copia 3200 px adiante (entra no fim, igual ao comeco)
const naTelaNoComeco = (x: number) => x < W + 60;
MOEDAS_T.forEach((tm, k) => {
  if (!naTelaNoComeco(noMundo(tm))) return;
  const n = `moeda_${k}_2`;
  osso(n, "mundo", noMundo(tm) + VEL * DUR, alturaEm(tm) + 80);
  camada(n, n, "moeda_1");
  quadros(n, ["moeda_2", "moeda_3", "moeda_4"]);
  const { giro, esc } = giroMoeda(k);
  slotsA[n] = { parte: giro };
  ossosA[n] = { escalar: esc };
});
MOEDAS_T.forEach((tm, k) => {
  const n = `moeda_${k}`;
  osso(n, "mundo", noMundo(tm), alturaEm(tm) + 80);
  camada(n, n, "moeda_1");
  quadros(n, ["moeda_2", "moeda_3", "moeda_4"]);
  const { giro, esc } = giroMoeda(k);
  // pega: cresce e some em 0,15 s
  giro.push({ tempo: r3(tm + 0.15), nome: null });
  slotsA[n] = { parte: giro.filter((c) => c.tempo <= tm + 0.15).concat(), rgba: [{ tempo: 0, cor: "ffffffff" }, { tempo: tm, cor: "ffffffff" }, { tempo: r3(tm + 0.15), cor: "ffffff00" }] };
  ossosA[n] = { escalar: esc.filter((c) => c.tempo < tm).concat([{ tempo: tm, x: 1, y: 1 }, { tempo: r3(tm + 0.15), x: 1.7, y: 1.7 }]) };
});

// o inimigo alado: bate as asas, flutua chegando, e e pisado em 2,3 s (pisca, some desfeito)
const TI = 2.3;
osso("inimigo", "mundo", noMundo(TI), alturaEm(TI) - 40);
camada("inimigo", "inimigo", "asa_1");
quadros("inimigo", ["asa_2", "asa_3", "asa_4", "asa_5"]);
{
  const asas: any[] = [];
  for (let q = 0, t = 0; t < TI + 0.5; q++, t += 0.08) asas.push({ tempo: r3(t), nome: `asa_${(q % 5) + 1}` });
  asas.push({ tempo: r3(TI + 0.55), nome: null });
  slotsA.inimigo = { parte: asas };
  const flutua = (t: number) => r3(12 * Math.sin((2 * Math.PI * 9 * t) / DUR));
  const bob: any[] = [];
  for (let t = 0; t < TI; t += 0.1) bob.push({ tempo: r3(t), x: 0, y: flutua(t) });
  if (naTelaNoComeco(noMundo(TI))) {
    osso("inimigo_2", "mundo", noMundo(TI) + VEL * DUR, alturaEm(TI) - 40);
    camada("inimigo_2", "inimigo_2", "asa_1");
    quadros("inimigo_2", ["asa_2", "asa_3", "asa_4", "asa_5"]);
    const asas2: any[] = [];
    for (let q = 0; q < 100; q++) asas2.push({ tempo: r3(q * 0.08), nome: `asa_${(q % 5) + 1}` });
    slotsA.inimigo_2 = { parte: asas2 };
    const bob2: any[] = [];
    for (let t = 0; t <= DUR + 1e-9; t += 0.1) bob2.push({ tempo: r3(t), x: 0, y: flutua(t) });
    ossosA.inimigo_2 = { mover: bob2 };
  }
  bob.push({ tempo: TI, x: 0, y: 0 }, { tempo: r3(TI + 0.12), x: 0, y: -26 });
  ossosA.inimigo = { mover: bob, escalar: [{ tempo: TI, x: 1, y: 1 }, { tempo: r3(TI + 0.1), x: 1.25, y: 0.7 }, { tempo: r3(TI + 0.25), x: 1, y: 1 }] };
  efeitosA.inimigo = {
    tingir: [{ tempo: 0, cor: "ff3040ff", forca: 0 }, { tempo: r3(TI - 0.01), forca: 0 }, { tempo: TI, forca: 0.9 }, { tempo: r3(TI + 0.2), forca: 0.4 }],
    dissolver: [{ tempo: 0, valor: 0, cor: "ffcc33ff", borda: 0.1, grao: 12 }, { tempo: r3(TI + 0.05), valor: 0 }, { tempo: r3(TI + 0.5), valor: 1 }],
  };
}

// o propulsor: pego em 2,95 s (cresce e some), liga o modo voo
const TP = 2.95;
osso("propulsor", "mundo", noMundo(TP), alturaEm(TP) + 70);
camada("propulsor", "propulsor", "propulsor");
slotsA.propulsor = { rgba: [{ tempo: 0, cor: "ffffffff" }, { tempo: TP, cor: "ffffffff" }, { tempo: r3(TP + 0.2), cor: "ffffff00" }] };
ossosA.propulsor = { escalar: [{ tempo: 0, x: 1, y: 1 }, { tempo: TP, x: 1, y: 1 }, { tempo: r3(TP + 0.2), x: 2.2, y: 2.2 }] };

// estrelas da Particle Pack no heroi: uma rajada em cada moeda, no inimigo e no propulsor
b.particulas.push({ nome: "pega", slot: "inimigo", osso: "heroi", y: 130, imagem: "brilho_moeda", blend: "aditivo", taxa: 0, vida: [0.35, 0.7], velocidade: [160, 340], angulo: 90, abertura: 360, gravidade: 300, arrasto: 2, escala: [0.9, 0.2], giro: [-260, 260], cor: ["fff6b0ff", "ffb03000"], semente: 5 });
particulasA.pega = { rajada: [...MOEDAS_T.map((t) => ({ tempo: t, quantidade: 7 })), { tempo: TI, quantidade: 14 }, { tempo: TP, quantidade: 18 }] };
// "+100" sobe e some em cada moeda e no inimigo (tres placas que se revezam: cada uma dura
// 0,55 s e os pontos chegam a cada 0,18 s, entao nenhuma placa e chamada antes de acabar)
const PONTOS_T = [...MOEDAS_T, TI].sort((a, c) => a - c);
const PLACAS = 3;
for (let k = 0; k < PLACAS; k++) {
  osso(`mais_${k}`, "heroi", 30, 190);
  camada(`mais_${k}`, `mais_${k}`, "txt_mais", { cor: "ffffff00" });
  const meus = PONTOS_T.filter((_, i) => i % PLACAS === k);
  meus.forEach((t, i) => {
    if (i && t < meus[i - 1] + 0.55) throw new Error(`placa ${k}: ${t} chega antes de ${meus[i - 1]} acabar`);
  });
  slotsA[`mais_${k}`] = { rgba: [{ tempo: 0, cor: "ffffff00" }, ...meus.flatMap((t) => [{ tempo: t, cor: "ffffff00", curva: "degrau" }, { tempo: r3(t + 0.02), cor: "ffffffff" }, { tempo: r3(t + 0.55), cor: "ffffff00" }])] };
  ossosA[`mais_${k}`] = { mover: [{ tempo: 0, x: 0, y: 0 }, ...meus.flatMap((t) => [{ tempo: t, x: 0, y: 0, curva: "degrau" }, { tempo: r3(t + 0.55), x: 30, y: 70 }])] };
}
// a placa de pontos pula a cada ponto
ossosA.painel = { escalar: [{ tempo: 0, x: 1, y: 1 }, ...PONTOS_T.flatMap((t) => [{ tempo: t, x: 1, y: 1 }, { tempo: r3(t + 0.06), x: 1.12, y: 1.12 }, { tempo: r3(t + 0.2), x: 1, y: 1 }])] };

// o heroi: o jato nas janelas (pulos, voo e o ultimo pulo), o modo voo (anel e brilho no corpo)
const JANELAS: [number, number][] = [
  [0.3, 0.8],
  [1.75, 2.2],
  [2.95, 5.8],
  [6.9, 7.3],
];
const jato = chavesJato(JANELAS, P, [55, 45, 65, 50]);
Object.assign(ossosA, jato.ossos);
Object.assign(slotsA, jato.slots);
Object.assign(efeitosA, jato.efeitos);
Object.assign(particulasA, jato.particulas);
// o ceu e claro: luz somada estoura em branco. O halo e as linguas passam a mistura normal, com
// cor quente e meio transparentes (o par normal translucido de um jato feito a mao); o nucleo e
// o fogo seguem somando luz. A fumaca vira vapor branco
for (const lado of ["e", "d"]) {
  for (const nome of [`jato_halo_${lado}`, `jato_lingua_${lado}`]) b.slots.find((x: any) => x.nome === P(nome)).blend = undefined;
  slotsA[P(`jato_halo_${lado}`)].rgba = slotsA[P(`jato_halo_${lado}`)].rgba.map((k: any) => ({ ...k, cor: "ffa24a" + Math.round(parseInt(k.cor.slice(6), 16) * 0.55).toString(16).padStart(2, "0") }));
}
const fumaca = b.particulas.find((e: any) => e.nome === P("fumaca"));
fumaca.cor = ["ffffffd8", "f4f2faa0", "ffffff00"];
particulasA[P("anel")] = { taxa: [{ valor: 0 }, { tempo: TP, valor: 0 }, { tempo: r3(TP + 0.25), valor: 1 }, { tempo: 5.5, valor: 1 }, { tempo: 5.9, valor: 0 }] };
efeitosA[P("corpo")] = { brilho: [{ tempo: 0, cor: "6fd8ffff", forca: 0, raio: 40 }, { tempo: TP, forca: 0 }, { tempo: r3(TP + 0.2), forca: 1.6 }, { tempo: 3.4, forca: 0.9 }, { tempo: 5.4, forca: 0.9 }, { tempo: 5.9, forca: 0 }] };

// o corpo do robo: o balanco parado e a comemoracao em trechos (os ossos com prefixo)
const TRECHOS: [string, number][] = [
  ["ganhou", 0.3],
  ["ganhou", 1.75],
  ["ganhou", 3.05],
  ["ganhou", 4.35],
  ["idle", 5.9],
];
const NEUTRO: Record<string, any> = { girar: { valor: 0 }, mover: { x: 0, y: 0 }, escalar: { x: 1, y: 1 } };
const fimAnim = (a: any) => Math.max(0, ...Object.values<any>(a.ossos ?? {}).flatMap((t: any) => Object.values<any>(t).flatMap((ks: any[]) => ks.map((k) => k.tempo ?? 0))));
const desloca = (k: any, dt: number) => {
  const n = { ...k, tempo: r3((k.tempo ?? 0) + dt) };
  if (Array.isArray(k.curva)) n.curva = k.curva.map((v: number, i: number) => (i % 2 === 0 ? r3(v + dt) : v));
  return n;
};
const props = new Set<string>();
for (const [an] of TRECHOS) for (const [o, t] of Object.entries<any>(robo.animacoes[an].ossos ?? {})) for (const pr of Object.keys(t)) props.add(`${o}|${pr}`);
for (const op of props) {
  const [o, pr] = op.split("|");
  if (!NEUTRO[pr]) continue;
  const ks: any[] = [{ tempo: 0, ...NEUTRO[pr] }];
  for (const [an, t0] of TRECHOS) {
    const a = robo.animacoes[an];
    const proprias: any[] | undefined = a.ossos?.[o]?.[pr];
    // o trecho nao passa do proximo (o voo emenda comemoracoes)
    if (proprias) ks.push(...proprias.map((k) => desloca(k, t0)).filter((k) => k.tempo < DUR));
    else ks.push({ tempo: t0, ...NEUTRO[pr] }, { tempo: r3(Math.min(DUR, t0 + fimAnim(a))), ...NEUTRO[pr] });
  }
  // em ordem e sem tempos repetidos (o mais novo ganha)
  const porTempo = new Map<number, any>();
  for (const k of ks) porTempo.set(k.tempo, k);
  const lista = [...porTempo.values()].sort((x, y) => x.tempo - y.tempo).filter((k) => k.tempo <= DUR);
  if (lista[lista.length - 1].tempo < DUR) lista.push({ tempo: DUR, ...NEUTRO[pr] });
  (ossosA[P(o)] ??= {})[pr] = lista;
}

// a tela do jogo: um recorte de 1280 x 720 sobre a cena inteira (o primeiro slot ate o ultimo);
// o que fica fora (as copias que ainda vao entrar, o fundo repetido) nao desenha
b.slots.unshift({ nome: "tela", osso: "root", parte: "tela" });
b.skins[0].partes.tela = { tela: { tipo: "recorte", fim: b.slots[b.slots.length - 1].nome, num_vertices: 4, vertices: [0, 0, W, 0, W, H, 0, H] } };

b.animacoes = { jogo: { ossos: ossosA, slots: slotsA, efeitos: efeitosA, particulas: particulasA } };
writeFileSync(join(AQUI, "jogo.boneco"), JSON.stringify(b, null, 1) + "\n");
console.log(`jogo.boneco: ${b.ossos.length} ossos, ${b.slots.length} slots, ${paginas.length} pagina(s) de atlas + ${robo.paginas.length} do robo`);
