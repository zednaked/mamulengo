// A vitrine do que o Mamulengo faz alem do Spine: o robo CC0 (tests/boneco/robo) com efeitos
// por slot e particulas presas a ossos, numa animacao "vitrine" que passa por cada recurso.
//
//   npx tsx exemplos/vitrine/gerar.ts      (escreve exemplos/vitrine/vitrine.boneco)
//
// Roteiro (o corpo alterna o balanco "idle" do robo e a comemoracao "ganhou"):
//   0,0-2,0  idle      dano: o corpo pisca vermelho (tingir); contorno dourado cresce na cabeca
//   2,3-3,6  ganhou    halo azul no corpo (brilho), faiscas das maos, duas rajadas da cabeca
//   3,9-5,9  idle      os bracos se dissolvem e voltam (dissolver ida e volta)
//   6,2-7,5  ganhou    tudo junto: dourado no corpo, contorno, halo, faiscas e rajadas
//   7,8-8,6  idle      tudo apaga; a animacao volta ao comeco
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ROBO = join(AQUI, "..", "..", "tests", "boneco", "robo");
const b = JSON.parse(readFileSync(join(ROBO, "robo.boneco"), "utf8"));
b.nome = "vitrine";
delete b.ficha;

// a pagina em 3x (robo-hd.webp, rasterizada do vetor da Kenney por robo-hd.py): o mesmo
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

// ---- corpo: trechos das animacoes do robo em sequencia, com 0,3 s de emenda entre eles

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
  (ossos[o] ??= {})[p] = ks;
}

// ---- efeitos (docs/NUCLEO.md "Efeitos"): setup desligado, a animacao liga e apaga

const slot = (n: string) => b.slots.find((s: any) => s.nome === n);
slot("cabeca").efeitos = { linha: { cor: "ffd23cff", largura: 0 } };
slot("corpo").efeitos = { brilho: { cor: "4cc9ffff", forca: 0, raio: 16 * HD }, tingir: { cor: "ff3355ff", forca: 0 } };
for (const s of ["braco_e", "braco_d"]) slot(s).efeitos = { dissolver: { valor: 0, cor: "ff8a3cff", borda: 0.08 } };

const efeitos = {
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
      { tempo: 0.5, largura: 0 },
      { tempo: 1.2, largura: 4 * HD },
      { tempo: 2.0, largura: 4 * HD },
      { tempo: 2.4, largura: 0 },
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
b.particulas = [
  faiscas("faiscas_e", "mao_e"),
  faiscas("faiscas_d", "mao_d"),
  { nome: "confete", slot: "cabeca", y: 50, imagem: "estrela", taxa: 0, vida: [0.9, 1.6], velocidade: [180, 360], angulo: 0, abertura: 150, gravidade: 320, arrasto: 1.2, escala: [0.2, 0.0875], giro: [-300, 300], cor: ["7fe3ffff", "ff7ad900"], semente: 7 },
];
const rampa = (t0: number, t1: number, t2: number, pico: number) => [
  { tempo: t0, valor: 0 },
  { tempo: t1, valor: pico },
  { tempo: t2, valor: 0 },
];
const particulas = {
  faiscas_e: { taxa: [...rampa(2.3, 2.7, 3.8, 45), ...rampa(6.2, 6.5, 7.7, 60)] },
  faiscas_d: { taxa: [...rampa(2.3, 2.7, 3.8, 45), ...rampa(6.2, 6.5, 7.7, 60)] },
  confete: {
    rajada: [
      { tempo: 2.45, quantidade: 22 },
      { tempo: 3.05, quantidade: 22 },
      { tempo: 6.35, quantidade: 30 },
      { tempo: 6.95, quantidade: 30 },
    ],
  },
};

b.animacoes = { vitrine: { ossos, efeitos, particulas }, idle: b.animacoes.idle, ganhou: b.animacoes.ganhou };
b.mix = { padrao: 0.2 };
writeFileSync(join(AQUI, "vitrine.boneco"), JSON.stringify(b, null, 1) + "\n");
console.log(`vitrine.boneco: ${Object.keys(ossos).length} ossos animados, ${b.particulas.length} emissores, efeitos em ${Object.keys(efeitos).length} slots`);
