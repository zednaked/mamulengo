// A vitrine do que o Mamulengo faz alem do Spine: o robo CC0 (tests/boneco/robo) com efeitos
// por slot e particulas presas a ossos, numa animacao "vitrine" que passa por cada recurso.
//
//   npx tsx exemplos/vitrine/gerar.ts      (escreve exemplos/vitrine/vitrine.boneco)
//
// Roteiro (o corpo alterna o balanco "idle" do robo e a comemoracao "ganhou"):
//   0,0-2,0  idle      dano: o corpo pisca vermelho (tingir); a cabeca olha para os lados em 2,5D
//                      (malha virada como cilindro pelo deform.turn: o rosto gira, as orelhas
//                      acompanham rigidas)
//   2,3-3,6  ganhou    halo azul no corpo (brilho), faiscas das maos, duas rajadas da cabeca e
//                      jatos de fogo nos pes (particulas com varios tons, somando luz e tremendo)
//   3,9-5,9  idle      os bracos se dissolvem e voltam (dissolver ida e volta)
//   6,2-7,5  ganhou    tudo junto: dourado no corpo, contorno, halo, faiscas, rajadas, fogo e um
//                      raio entre as maos (emissor tipo raio, refeito a cada 0,05 s)
//   7,8-8,6  idle      tudo apaga; a animacao volta ao comeco
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import sharp from "sharp";
import { exportarSpine, importarSpine } from "../../src/boneco/spine.ts";
import { parseAtlas } from "../../src/core/atlas-text.ts";
import { Document } from "../../src/core/document.ts";
import { executeAsync, type AssetProvider } from "../../src/core/commands/index.ts";
import { extractRegion } from "../../server/atlas.ts";
import { NL, QUADRO, chavesJato, envelope, tremor } from "./jato.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ROBO = join(AQUI, "..", "..", "tests", "boneco", "robo");
const b = JSON.parse(readFileSync(join(ROBO, "robo.boneco"), "utf8"));
b.nome = "vitrine";
delete b.ficha;

// a pagina em 3x (robo-hd.webp, do vetor da Kenney por tools/atlas-hd.ts com --id "{nome}_0_Layer0_*_FILL"): o mesmo
// layout com os retangulos em 3x; as partes guardam o tamanho delas, entao so a nitidez muda.
// Larguras e raios dos efeitos sao em pixels da textura: tambem em 3x
const HD = 3;
b.paginas[0] = { ...b.paginas[0], arquivo: "robo-hd.webp", tamanho: b.paginas[0].tamanho.map((v: number) => v * HD) };
for (const im of b.imagens) im.ret = im.ret.map((v: number) => v * HD);

// ---- acertos do rig do robo, conferidos contra a pose "idle" da Kenney: os pes para fora (a
// perna esquerda e a espelhada, nao a direita), um vao entre as pernas e as maos centradas na
// ponta do braco
const parte = (s: string, n: string) => b.skins[0].partes[s][n];
for (const n of ["leg", "legBend"]) {
  const e = parte("perna_e", n),
    d = parte("perna_d", n);
  [e.rotacao, e.escala_y, d.rotacao, d.escala_y] = [d.rotacao, d.escala_y, e.rotacao, e.escala_y];
}
const PERNA_X = 22;
b.ossos.find((o: any) => o.nome === "perna_e").x = -PERNA_X;
b.ossos.find((o: any) => o.nome === "perna_d").x = PERNA_X;
const MAO_Y = -5;
parte("mao_e", "hand").y += MAO_Y;
parte("mao_d", "hand").y -= MAO_Y;

// ---- corpo: trechos das animacoes do robo em sequencia, com 0,3 s de emenda entre eles. O ultimo
// idle e cortado no fim do laco, que fecha na pose do comeco (sem isso a animacao ia ate 9,8 s)

const DUR = 8.6;

const TRECHOS: [string, number][] = [
  ["idle", 0],
  ["ganhou", 2.3],
  ["idle", 3.9],
  ["ganhou", 6.2],
  ["idle", 7.8],
];
const NEUTRO: Record<string, any> = { girar: { valor: 0 }, mover: { x: 0, y: 0 }, escalar: { x: 1, y: 1 } };
const fim = (a: any) => Math.max(0, ...Object.values<any>(a.ossos ?? {}).flatMap((t: any) => Object.values<any>(t).flatMap((ks: any[]) => ks.map((k) => k.tempo ?? 0))));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// a curva bezier guarda tempos absolutos (os numeros pares): andam junto com a chave
const desloca = (k: any, dt: number) => {
  const n = { ...k, tempo: r3((k.tempo ?? 0) + dt) };
  if (Array.isArray(k.curva)) n.curva = k.curva.map((v: number, i: number) => (i % 2 === 0 ? r3(v + dt) : v));
  return n;
};

const ossos: Record<string, Record<string, any[]>> = {};
const props = new Set<string>();
for (const [an] of TRECHOS) for (const [o, t] of Object.entries<any>(b.animacoes[an].ossos ?? {})) for (const p of Object.keys(t)) props.add(`${o}.${p}`);
for (const op of props) {
  const [o, p] = op.split(".");
  const ks: any[] = [];
  for (const [an, t0] of TRECHOS) {
    const a = b.animacoes[an];
    const proprias: any[] | undefined = a.ossos?.[o]?.[p];
    if (proprias) ks.push(...proprias.map((k) => desloca(k, t0)));
    else ks.push({ tempo: t0, ...NEUTRO[p] }, { tempo: r3(t0 + fim(a)), ...NEUTRO[p] });
  }
  const { tempo: _t, curva: _c, ...inicio } = ks[0];
  // pelo menos 0,15 s para voltar a pose do comeco, sem salto na emenda
  const antes = ks.filter((k) => k.tempo <= DUR - 0.15);
  // a bezier da ultima chave mirava a chave seguinte, que saiu: vira linear ate o fim
  const ultima = antes[antes.length - 1];
  if (Array.isArray(ultima.curva) && ultima.curva.some((v: number, i: number) => i % 2 === 0 && v > DUR - 0.15)) delete ultima.curva;
  (ossos[o] ??= {})[p] = [...antes, { tempo: DUR, ...inicio }];
}

// ---- efeitos (docs/NUCLEO.md "Efeitos"): setup desligado, a animacao liga e apaga

const slot = (n: string) => b.slots.find((s: any) => s.nome === n);
slot("cabeca").efeitos = { linha: { cor: "ffd23cff", largura: 0 } };
slot("corpo").efeitos = { brilho: { cor: "4cc9ffff", forca: 0, raio: 16 * HD }, tingir: { cor: "ff3355ff", forca: 0 } };
for (const s of ["braco_e", "braco_d"]) slot(s).efeitos = { dissolver: { valor: 0, cor: "ff8a3cff", borda: 0.08, grao: 8 * HD } };
// borrar (smear): bracos e maos esticam para tras quando balancam rapido na comemoracao; parados
// ou devagar (o 2,5D sutil) quase nada
const BORRAR = { forca: 0.05, limite: 45, esmaecer: 0.55 };
for (const s of ["braco_e", "braco_d"]) slot(s).efeitos.borrar = BORRAR;
for (const s of ["mao_e", "mao_d"]) slot(s).efeitos = { ...(slot(s).efeitos ?? {}), borrar: BORRAR, rastro: { copias: 0, intervalo: 0.035, alfa: 0.45 } };

// rastro nas maos so nas comemoracoes (parada, a copia ficaria por baixo da peca a toa): liga em
// degrau no comeco de cada uma e desliga no fim
const RASTRO = [
  { tempo: 0, copias: 0, curva: "degrau" },
  { tempo: 2.3, copias: 4, curva: "degrau" },
  { tempo: 3.7, copias: 0, curva: "degrau" },
  { tempo: 6.2, copias: 4, curva: "degrau" },
  { tempo: 7.6, copias: 0, curva: "degrau" },
];
const efeitos = {
  mao_e: { rastro: RASTRO },
  mao_d: { rastro: RASTRO },
  corpo: {
    tingir: [
      { tempo: 0, forca: 0 },
      { tempo: 0.15, forca: 0.85 },
      { tempo: 0.45, forca: 0 },
      { tempo: 0.6, forca: 0.85 },
      { tempo: 0.9, forca: 0 },
      // final: dourado
      { tempo: 6.2, forca: 0, cor: "ffc21aff" },
      { tempo: 6.6, forca: 0.55 },
      { tempo: 7.5, forca: 0.55 },
      { tempo: 8.0, forca: 0, cor: "ff3355ff" },
    ],
    brilho: [
      { tempo: 2.3, forca: 0 },
      { tempo: 2.6, forca: 1.6 },
      { tempo: 3.0, forca: 0.7 },
      { tempo: 3.3, forca: 1.4 },
      { tempo: 3.8, forca: 0 },
      { tempo: 6.2, forca: 0, cor: "ffd23cff" },
      { tempo: 6.5, forca: 1.4 },
      { tempo: 7.5, forca: 1.0 },
      { tempo: 8.0, forca: 0, cor: "4cc9ffff" },
    ],
  },
  cabeca: {
    linha: [
      { tempo: 6.2, largura: 0 },
      { tempo: 6.5, largura: 3.5 * HD },
      { tempo: 7.6, largura: 3.5 * HD },
      { tempo: 8.0, largura: 0 },
    ],
  },
  braco_e: {
    dissolver: [
      { tempo: 4.0, valor: 0 },
      { tempo: 4.8, valor: 1 },
      { tempo: 5.1, valor: 1 },
      { tempo: 5.8, valor: 0 },
    ],
  },
  braco_d: {
    dissolver: [
      { tempo: 4.2, valor: 0 },
      { tempo: 5.0, valor: 1 },
      { tempo: 5.2, valor: 1 },
      { tempo: 5.9, valor: 0 },
    ],
  },
};

// ---- particulas (docs/NUCLEO.md "Particulas"): desligadas no setup (taxa 0)

// a imagem das particulas: uma estrela de quatro pontas branca (a cor vem do emissor), numa
// pagina propria desenhada aqui. A forma e uma astroide (|x|^e + |y|^e <= 1, lados para dentro)
// com borda firme: so ~1 px de transicao, para nao parecer borrada ampliada
const LADO = 128;
const estrela = new PNG({ width: LADO, height: LADO });
for (let y = 0; y < LADO; y++)
  for (let x = 0; x < LADO; x++) {
    const dx = Math.abs(x + 0.5 - LADO / 2) / (LADO / 2),
      dy = Math.abs(y + 0.5 - LADO / 2) / (LADO / 2);
    const f = Math.pow(dx, 0.55) + Math.pow(dy, 0.55);
    const a = Math.min(1, Math.max(0, (1 - f) / 0.035));
    const i = (y * LADO + x) * 4;
    estrela.data[i] = estrela.data[i + 1] = estrela.data[i + 2] = 255;
    estrela.data[i + 3] = Math.round(a * 255);
  }
writeFileSync(join(AQUI, "estrela.png"), PNG.sync.write(estrela));
b.paginas.push({ arquivo: "estrela.png", tamanho: [LADO, LADO] });
b.imagens.push({ nome: "estrela", pagina: b.paginas.length - 1, ret: [0, 0, LADO, LADO] });

// o fogo: um disco branco macio (a cor vem do emissor, somando luz); o raio: um traco macio
// de um lado ao outro (v), com o miolo forte, esticado ao longo de cada pedaco (u)
const pagina = (arquivo: string, w: number, h: number, alfa: (x: number, y: number) => number) => {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
      png.data[i + 3] = Math.round(Math.min(1, Math.max(0, alfa((x + 0.5) / w, (y + 0.5) / h))) * 255);
    }
  writeFileSync(join(AQUI, arquivo), PNG.sync.write(png));
  b.paginas.push({ arquivo, tamanho: [w, h] });
  b.imagens.push({ nome: arquivo.replace(/\.png$/, ""), pagina: b.paginas.length - 1, ret: [0, 0, w, h] });
};
pagina("fogo.png", 96, 96, (x, y) => Math.pow(Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.5) * 2), 1.6));
pagina("raio.png", 16, 64, (_x, y) => {
  const d = Math.abs(y - 0.5) * 2;
  return Math.max(0, 1 - d / 0.22) + 0.45 * Math.pow(Math.max(0, 1 - d), 2.5);
});

const faiscas = (nome: string, s: string) => ({
  nome,
  slot: s,
  imagem: "estrela",
  taxa: 0,
  vida: [0.5, 1.1],
  velocidade: [90, 190],
  angulo: 90,
  abertura: 70,
  gravidade: 260,
  escala: [0.175, 0.025],
  giro: [-200, 200],
  cor: ["ffe066ff", "ff6a1e00"],
  semente: nome.length,
});
// jatos de fogo dos pes (as pernas apontam para baixo: angulo 0 e ao longo do osso)
const jato = (nome: string, s: string) => ({
  nome,
  slot: s.replace("perna_", "jato_nucleo_"),
  osso: s,
  x: 40,
  imagem: "fogo",
  blend: "aditivo",
  taxa: 0,
  vida: [0.22, 0.45],
  velocidade: [160, 260],
  angulo: 0,
  abertura: 22,
  gravidade: -380,
  escala: [0.42, 0.12],
  giro: [-90, 90],
  onda: [5, 7],
  cor: ["fff4d0b0", "ffd25a99", "ff7a1a80", "c0201000"],
  semente: nome.length + 11,
});
// o arco eletrico entre as maos
const arco = { nome: "arco", tipo: "raio", slot: "cabeca", osso: "mao_e", ate: "mao_d", imagem: "raio", blend: "aditivo", taxa: 0, largura: 20, segmentos: 14, desvio: 0.16, ramos: 3, troca: 0.05, cor: ["9fe8ffff"], semente: 4 };
b.particulas = [
  jato("fogo_e", "perna_e"),
  jato("fogo_d", "perna_d"),
  arco,
  faiscas("faiscas_e", "mao_e"),
  faiscas("faiscas_d", "mao_d"),
  { nome: "confete", slot: "cabeca", y: 50, imagem: "estrela", taxa: 0, vida: [0.9, 1.6], velocidade: [180, 360], angulo: 0, abertura: 150, gravidade: 320, arrasto: 1.2, escala: [0.2, 0.0875], giro: [-300, 300], cor: ["7fe3ffff", "ff7ad900"], semente: 7 },
];
const rampa = (t0: number, t1: number, t2: number, pico: number) => [
  { tempo: t0, valor: 0 },
  { tempo: t1, valor: pico },
  { tempo: t2, valor: 0 },
];
const particulas: any = {
  anel: { taxa: [{ valor: 0 }, { tempo: 2.4, valor: 0 }, { tempo: 2.7, valor: 1 }, { tempo: 3.5, valor: 1 }, { tempo: 3.9, valor: 0 }, { tempo: 6.3, valor: 0 }, { tempo: 6.6, valor: 1 }, { tempo: 7.5, valor: 1 }, { tempo: 7.9, valor: 0 }] },
  faiscas_e: { taxa: [...rampa(2.3, 2.7, 3.8, 45), ...rampa(6.2, 6.5, 7.7, 60)] },
  faiscas_d: { taxa: [...rampa(2.3, 2.7, 3.8, 45), ...rampa(6.2, 6.5, 7.7, 60)] },
  // o arco liga, treme (a intensidade pisca) e apaga
  arco: { taxa: [{ tempo: 6.35, valor: 0, curva: "degrau" }, { tempo: 6.4, valor: 1 }, { tempo: 6.9, valor: 0.55 }, { tempo: 7.0, valor: 1 }, { tempo: 7.45, valor: 1 }, { tempo: 7.6, valor: 0 }] },
  confete: {
    rajada: [
      { tempo: 2.45, quantidade: 22 },
      { tempo: 3.05, quantidade: 22 },
      { tempo: 6.35, quantidade: 30 },
      { tempo: 6.95, quantidade: 30 },
    ],
  },
};

// ---- o jato (o mesmo desenho de camadas de um jato feito a mao, com arte e numeros nossos):
// um halo grande de luz falsa (amarelo por fora, anel frio por dentro), um nucleo branco no bocal
// e as linguas e brasas das particulas de fogo; os dois primeiros somam luz e tremem a cada 1/30 s,
// com um exagero na ignicao. Em volta, a luz falsa: as pernas esquentam (tingir) e o chao acende
const RGBA = (arquivo: string, w: number, h: number, px: (x: number, y: number) => number[]) => {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, bb, a] = px((x + 0.5) / w, (y + 0.5) / h);
      const i = (y * w + x) * 4;
      png.data[i] = Math.round(r);
      png.data[i + 1] = Math.round(g);
      png.data[i + 2] = Math.round(bb);
      png.data[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  writeFileSync(join(AQUI, arquivo), PNG.sync.write(png));
  b.paginas.push({ arquivo, tamanho: [w, h] });
  b.imagens.push({ nome: arquivo.replace(/\.png$/, ""), pagina: b.paginas.length - 1, ret: [0, 0, w, h] });
};
const mistura = (c1: number[], c2: number[], f: number) => c1.map((v, i) => v + (c2[i] - v) * Math.min(1, Math.max(0, f)));
// halo: elipse ao longo de x (o bocal a esquerda); por fora amarelo, por dentro um anel frio
RGBA("jato_halo.png", 192, 128, (x, y) => {
  const e = Math.hypot((x - 0.42) / 0.42, (y - 0.5) / 0.46);
  // quente por dentro (branco amarelado, laranja), dourado na borda, um toque rosado entre os dois
  const cor = e < 0.35 ? mistura([255, 244, 214], [255, 170, 80], e / 0.35) : e < 0.7 ? mistura([255, 170, 80], [255, 120, 150], (e - 0.35) / 0.35) : mistura([255, 120, 150], [255, 205, 80], (e - 0.7) / 0.3);
  // mais forte perto do bocal (a esquerda), sumindo ao longo do jato
  return [...cor, Math.pow(Math.max(0, 1 - e), 1.15) * (1 - 0.45 * x)];
});
// nucleo: oval branca no bocal
RGBA("jato_nucleo.png", 96, 48, (x, y) => {
  const e = Math.hypot((x - 0.32) / 0.32, (y - 0.5) / 0.44);
  return [255, 255, 250, Math.pow(Math.max(0, 1 - e), 1.1)];
});
// luz no chao: elipse branca macia (a cor vem do slot)
RGBA("luz_chao.png", 256, 64, (x, y) => [255, 255, 255, Math.pow(Math.max(0, 1 - Math.hypot((x - 0.5) / 0.5, (y - 0.5) / 0.5)), 1.6)]);

// as linguas de fogo em 6 quadros (trocados a cada 1/30 s, como uma sequencia desenhada): cada
// uma e um feixe de chamas ao longo de x (o bocal a esquerda), branco no comeco, amarelo,
// laranja e vermelho na ponta, com o recorte e a ponta mudando de quadro para quadro
const LW = 160,
  LH = 64;
{
  const png = new PNG({ width: LW, height: LH * NL });
  const ruido = (a: number, bb: number) => {
    const v = Math.sin(a * 127.1 + bb * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  for (let f = 0; f < NL; f++)
    for (let y = 0; y < LH; y++)
      for (let x = 0; x < LW; x++) {
        const u = (x + 0.5) / LW,
          v = (y + 0.5) / LH - 0.5;
        // tres linguas que se abrem e balancam
        let a = 0;
        for (let k = 0; k < 3; k++) {
          const desl = (k - 1) * 0.12 * u + 0.06 * Math.sin(u * 9 + f * 1.9 + k * 2.1) * u;
          const larg = (0.2 - 0.05 * Math.abs(k - 1)) * Math.pow(1 - u, 0.7) * (0.85 + 0.3 * ruido(f + k, Math.floor(u * 8)));
          const comp = 0.75 + 0.25 * ruido(f * 3 + k, 7);
          if (u > comp) continue;
          a = Math.max(a, Math.min(1, Math.max(0, (larg - Math.abs(v - desl)) / 0.035)) * Math.pow(1 - u / comp, 0.5));
        }
        const cor = u < 0.15 ? mistura([255, 255, 245], [255, 225, 120], u / 0.15) : u < 0.45 ? mistura([255, 225, 120], [255, 140, 40], (u - 0.15) / 0.3) : mistura([255, 140, 40], [210, 40, 20], (u - 0.45) / 0.55);
        const i = ((f * LH + y) * LW + x) * 4;
        [png.data[i], png.data[i + 1], png.data[i + 2]] = cor.map(Math.round);
        png.data[i + 3] = Math.round(a * 255);
      }
  writeFileSync(join(AQUI, "linguas.png"), PNG.sync.write(png));
  b.paginas.push({ arquivo: "linguas.png", tamanho: [LW, LH * NL] });
  for (let f = 0; f < NL; f++) b.imagens.push({ nome: `lingua_${f}`, pagina: b.paginas.length - 1, ret: [0, f * LH, LW, LH] });
}
// o clarao da ignicao: um disco com raios finos, branco (a cor vem do slot)
RGBA("clarao.png", 160, 160, (x, y) => {
  const dx = x - 0.5,
    dy = y - 0.5,
    r = Math.hypot(dx, dy) * 2,
    g = Math.atan2(dy, dx);
  // 8 raios girados meio passo (nenhum em pe, que ficaria uma barra entre as pernas)
  const raios = Math.pow(Math.abs(Math.cos(4 * (g - Math.PI / 8))), 18) * Math.max(0, 1 - r) * 0.8;
  return [255, 255, 255, Math.min(1, Math.pow(Math.max(0, 1 - r), 2.2) + raios)];
});
// a fumaca: uma nuvem macia de bordas irregulares, cinza clara
RGBA("fumaca.png", 96, 96, (x, y) => {
  const dx = x - 0.5,
    dy = y - 0.5,
    g = Math.atan2(dy, dx);
  const borda = 0.42 + 0.06 * Math.sin(g * 5) + 0.03 * Math.sin(g * 11 + 1);
  const r = Math.hypot(dx, dy);
  return [235, 232, 240, Math.pow(Math.max(0, 1 - r / borda), 0.9) * 0.9];
});

const JANELAS: [number, number][] = [
  [2.25, 3.7],
  [6.15, 7.6],
];

const iPernaD = b.slots.findIndex((x: any) => x.nome === "perna_d");
const novos: any[] = [];
for (const lado of ["e", "d"]) {
  b.ossos.push({ nome: `jato_${lado}`, pai: `perna_${lado}`, x: 42 });
  // a mascara: um recorte preso a perna, em cone da largura da sola para baixo (x a partir de 44
  // no osso), para o jato sair por baixo do pe e nao pelos lados; corta o halo, as linguas, o
  // nucleo e as particulas de fogo
  novos.push({ nome: `mascara_${lado}`, osso: `perna_${lado}`, parte: "mascara" });
  b.skins[0].partes[`mascara_${lado}`] = { mascara: { tipo: "recorte", fim: `jato_nucleo_${lado}`, num_vertices: 4, vertices: [44, -21, 260, -230, 260, 230, 44, 21] } };
  novos.push(
    // apagados no setup (transparentes): so a animacao com o jato acende; as outras (idle, ganhou)
    // ficam sem jato
    { nome: `jato_halo_${lado}`, osso: `jato_${lado}`, parte: "jato_halo", blend: "aditivo", cor: "ffffff00" },
    { nome: `jato_lingua_${lado}`, osso: `jato_${lado}`, blend: "aditivo" },
    { nome: `jato_nucleo_${lado}`, osso: `jato_${lado}`, parte: "jato_nucleo", blend: "aditivo", cor: "ffffff00" },
  );
  b.skins[0].partes[`jato_lingua_${lado}`] = Object.fromEntries(Array.from({ length: NL }, (_, f) => [`lingua_${f}`, { x: 52, largura: 92, altura: 38 }]));
  b.skins[0].partes[`jato_halo_${lado}`] = { jato_halo: { x: 46, largura: 150, altura: 84 } };
  b.skins[0].partes[`jato_nucleo_${lado}`] = { jato_nucleo: { x: 14, largura: 46, altura: 24 } };
}
b.slots.splice(iPernaD + 1, 0, ...novos);
// a luz no chao e o clarao da ignicao, atras de tudo, presos ao root (o chao); a fumaca nasce
// no chao e desenha num slot proprio, sem imagem, antes de tudo (atras do robo)
b.ossos.push({ nome: "chao", pai: "root" }, { nome: "clarao", pai: "root", y: 6 });
b.slots.unshift({ nome: "fumaca", osso: "chao" }, { nome: "luz_chao", osso: "chao", parte: "luz_chao", blend: "aditivo", cor: "ff9a4000" }, { nome: "clarao", osso: "clarao", parte: "clarao", blend: "aditivo", cor: "ffd9a000" });
b.skins[0].partes.clarao = { clarao: { largura: 150, altura: 90 } };
// um anel de estrelas em orbita no corpo: as de tras passam atras do robo (slot da fumaca, o
// primeiro) e as da frente por cima de tudo (slot da cabeca, o ultimo)
b.particulas.push({ nome: "anel", tipo: "orbita", slot: "cabeca", atras: "fumaca", osso: "corpo", x: 30, imagem: "estrela", blend: "aditivo", taxa: 0, raios: [125, 24], volta: 1.6, quantidade: 14, faixa: 14, inclinacao: -8, profundidade: 0.45, escala: [0.17, 0.17], giro: [-140, 140], cor: ["ffe680ff", "7d70c0aa"], semente: 2 });
b.particulas.push({ nome: "fumaca", slot: "fumaca", osso: "chao", y: 8, imagem: "fumaca", taxa: 0, vida: [0.9, 1.6], velocidade: [70, 190], angulo: 90, abertura: 175, gravidade: -25, arrasto: 2.2, escala: [0.45, 1.5], giro: [-40, 40], cor: ["d8d2e0b0", "9890a860", "80789000"], semente: 9 });
b.skins[0].partes.luz_chao = { luz_chao: { y: 2, largura: 230, altura: 46 } };
// as chaves do jato (exemplos/vitrine/jato.ts): ossos, camadas, pernas aquecidas, fogo e fumaca
const chJato = chavesJato(JANELAS, (n) => n, [55, 65]);
Object.assign(ossos, chJato.ossos);
Object.assign(efeitos, chJato.efeitos);
Object.assign(particulas, chJato.particulas);
const slotsAnim: any = { ...chJato.slots };

// ---- luzes (docs/NUCLEO.md "Luzes"): o relevo da pagina do robo (tools/relevo.ts
// exemplos/vitrine/vitrine.boneco --borda 36; a borda e de pagina 3x) e as luzes. Discretas o
// tempo todo (uma chave quente de cima, uma contraluz azul rasante pela esquerda, a ambiente um
// pouco fria e baixa) e as que contam o que acontece: o fogo do jato ilumina as pernas e o corpo
// por baixo, tremendo com a chama, e o raio acende as maos de azul
b.paginas[0].relevo = "robo-hd_relevo.png";
b.ambiente = { cor: "c9d3eeff", forca: 0.82 };
b.luzes = [
  { nome: "chave", x: 300, y: 460, cor: "fff0dcff", forca: 0.55, raio: 1100, altura: 260 },
  { nome: "contraluz", x: -300, y: 170, cor: "66b3ffff", forca: 1.1, raio: 700, altura: -20 },
  { nome: "jato_e", osso: "jato_e", x: 30, cor: "ff9a40ff", forca: 0, raio: 300, altura: 25 },
  { nome: "jato_d", osso: "jato_d", x: 30, cor: "ff9a40ff", forca: 0, raio: 300, altura: 25 },
  { nome: "raio_e", osso: "mao_e", cor: "8fd8ffff", forca: 0, raio: 260, altura: 50 },
  { nome: "raio_d", osso: "mao_d", cor: "8fd8ffff", forca: 0, raio: 260, altura: 50 },
];
// o fogo: a forca segue o envelope do jato e treme a cada dois quadros da chama
const fogo = (canal: number) => {
  const ks: any[] = [{ tempo: 0, forca: 0 }];
  for (const jan of JANELAS) {
    ks.push({ tempo: r3(jan[0]), forca: 0 });
    for (let k = 1, t = jan[0] + 2 * QUADRO; t < jan[1]; k++, t += 2 * QUADRO) ks.push({ tempo: r3(t), forca: r3(1.7 * envelope(t, jan) * (0.7 + 0.6 * tremor(k, canal))) });
    ks.push({ tempo: r3(jan[1]), forca: 0 });
  }
  return ks;
};
// o raio: pisca enquanto o arco esta ligado (6,4 a 7,45 s)
const relampago = (canal: number) => {
  const ks: any[] = [{ tempo: 0, forca: 0 }, { tempo: 6.35, forca: 0 }];
  for (let k = 1, t = 6.4; t < 7.45; k++, t += 0.05) ks.push({ tempo: r3(t), forca: r3(tremor(k, canal) < 0.3 ? 0.4 : 1.6 + tremor(k, canal + 1)) });
  ks.push({ tempo: 7.6, forca: 0 });
  return ks;
};
const luzes = { jato_e: fogo(11), jato_d: fogo(12), raio_e: relampago(13), raio_d: relampago(15) };

b.animacoes = { vitrine: { ossos, slots: slotsAnim, efeitos, particulas, luzes }, idle: b.animacoes.idle, ganhou: b.animacoes.ganhou };

// ---- 2,5D: com os comandos do editor (os mesmos da tela e da ponte), sobre o documento no
// formato do editor. A cabeca vira malha pelo contorno da imagem e olha para os lados
const ex = exportarSpine(b);
const atlas = parseAtlas(ex.atlas);
const imagens: AssetProvider = {
  async image(nome) {
    const r = atlas.regions.find((x) => x.name === nome);
    const pg = r && atlas.pages.find((p) => p.name === r.page);
    if (!r || !pg) return null;
    const png = await extractRegion(sharp(join(AQUI, pg.name)), r);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data };
  },
  region(nome) {
    const r = atlas.regions.find((x) => x.name === nome);
    return r ? { width: r.originalWidth, height: r.originalHeight } : null;
  },
};
const doc = Document.fromText(JSON.stringify(ex.json), { text: ex.atlas, pages: {} });
// alem do olhar, um 2,5D sutil em tudo: cada parte gira devagar uns poucos graus, em fases
// diferentes (a cabeca puxa, o corpo vem logo atras, as pernas acompanham menos, os bracos tem o
// ritmo deles). Periodos que fecham nos 8,6 s do laco (DUR), para nao pular na volta
const onda = (t: number, graus: number, periodo: number, fase = 0) => graus * Math.sin((2 * Math.PI * (t - fase)) / periodo);
// o olhar de 0 a 2 s: 0, -18, 0, 18, 0 com ida e volta suave; depois o balanco
const olharCabeca = (t: number) => {
  if (t <= 2) return -18 * Math.sin(Math.PI * t);
  return t < 2.15 ? 0 : onda(t, 7, DUR / 4, 2.15);
};
const PARTES = [
  { slot: "cabeca", att: "head", raio: 32, giro: olharCabeca, aceno: (t: number) => onda(t, 5, DUR / 3) },
  { slot: "corpo", att: "body", raio: undefined, giro: (t: number) => onda(t, 5, DUR / 4, 0.12), aceno: (t: number) => onda(t, 3, DUR / 3, 0.2) },
  { slot: "perna_e", att: "leg", raio: undefined, giro: (t: number) => onda(t, 3, DUR / 4, 0.2), aceno: () => 0 },
  { slot: "perna_d", att: "leg", raio: undefined, giro: (t: number) => onda(t, 3, DUR / 4, 0.2), aceno: () => 0 },
  { slot: "braco_e", att: "arm", raio: undefined, giro: (t: number) => onda(t, 6, DUR / 5, 0.3), aceno: () => 0 },
  { slot: "braco_d", att: "arm", raio: undefined, giro: (t: number) => onda(t, 6, DUR / 5, 0.6), aceno: () => 0 },
];
const chamadas: any[] = [];
for (const pt of PARTES)
  if (pt.att !== "arm") chamadas.push({ cmd: "mesh.create", args: { slot: pt.slot, name: pt.att, detail: 1.4 } });
for (const pt of PARTES)
  for (let k = 0; k * (1 / 6) <= DUR + 1e-9; k++) {
    const t = r3(Math.min(k / 6, DUR));
    const tilt = pt.aceno(t);
    chamadas.push({ cmd: "deform.turn", args: { anim: "vitrine", slot: pt.slot, attachment: pt.att, time: t, angle: r3(pt.giro(t)), perspective: 0.15, ...(pt.raio ? { radius: pt.raio } : {}), ...(tilt ? { tilt: r3(tilt) } : {}) } });
  }
await executeAsync(doc, chamadas, "gerador", "2,5D", {}, imagens);
const final = importarSpine(doc.json, ex.atlas, "vitrine");
final.mix = { padrao: 0.2 };
writeFileSync(join(AQUI, "vitrine.boneco"), JSON.stringify(final, null, 1) + "\n");
console.log(`vitrine.boneco: ${Object.keys(ossos).length} ossos animados, ${b.particulas.length} emissores, efeitos em ${Object.keys(efeitos).length} slots`);
