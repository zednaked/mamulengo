// O vagalume: o zumbi CC0 (tests/boneco/zumbi) numa noite, com um vagalume que passa na frente e por
// tras dele, para mostrar juntos o 2,5D, a luz e a profundidade. Laco de 8 s (animacao "vagalume"):
//
//   0,0-1,3  o zumbi cochila em pe (olhos semicerrados, cabeca pendendo); so a lua, por tras, recorta
//            a silhueta
//   0,9-2,0  o vagalume chega pela direita, na frente: o rosto acende daquele lado, ele acorda e a
//            cabeca gira em 2,5D atras da luz
//   2,0-3,6  o vagalume da a volta por tras dele: passa atras do corpo, a luz vira contraluz e
//            contorna a silhueta; cabeca e corpo giram acompanhando
//   3,6-4,6  volta pela frente, baixo; ele tenta pegar com as duas maos, desengoncado, bate palma e
//            erra: o vagalume escapa para cima e ele olha para cima
//   4,6-6,4  o vagalume desce e pousa no nariz: susto, depois o rosto aceso de perto
//   6,4-8,0  o vagalume vai embora para cima e para a esquerda; o zumbi volta a cochilar
//
// A profundidade: o vagalume cresce quando vem para a frente, troca de lado na ordem de desenho
// (um slot atras de tudo, outro na frente), a altura da luz dele segue a profundidade (na frente
// ilumina o rosto, de lado e rasante, atras vira contraluz), a sombra no chao anda ao contrario da
// luz e ha nevoa nos dois planos.
//
//   npx tsx exemplos/vagalume/gerar.ts      (escreve exemplos/vagalume/vagalume.boneco)
//
// A pagina do zumbi em 3x vem do vetor da Kenney (Toon Characters 1, Zombie/Vector/character_zombie.svg):
//   npx tsx tools/atlas-hd.ts tests/boneco/zumbi/zumbi.boneco character_zombie.svg --id "{nome}_0_Layer0_*_FILL" --saida exemplos/vagalume/zumbi-hd.webp
// e o relevo dela, depois de gerar:  npx tsx tools/relevo.ts exemplos/vagalume/vagalume.boneco --borda 24 --paginas 0
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import sharp from "sharp";
import { exportarSpine, importarSpine } from "../../src/boneco/spine.ts";
import { parseAtlas } from "../../src/core/atlas-text.ts";
import { Document } from "../../src/core/document.ts";
import { executeAsync, type AssetProvider } from "../../src/core/commands/index.ts";
import { extractRegion } from "../../server/atlas.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const b = JSON.parse(readFileSync(join(AQUI, "..", "..", "tests", "boneco", "zumbi", "zumbi.boneco"), "utf8"));
b.nome = "vagalume";
delete b.ficha;
const DUR = 8;
const PASSO = 1 / 15; // as chaves que saem das funcoes abaixo
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, z: number) => Math.min(z, Math.max(a, x));
const suave = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const entre = (t: number, a: number, z: number) => suave((t - a) / (z - a));
const mistura = (a: number, z: number, f: number) => a + (z - a) * f;
const amostras = () => Array.from({ length: Math.round(DUR / PASSO) + 1 }, (_, k) => r3(Math.min(k * PASSO, DUR)));

// a pagina em 3x: o mesmo layout, retangulos em 3x (as partes guardam o tamanho delas)
const HD = 3;
b.paginas[0] = { ...b.paginas[0], arquivo: "zumbi-hd.webp", tamanho: b.paginas[0].tamanho.map((v: number) => v * HD), relevo: "zumbi-hd_relevo.png" };
for (const im of b.imagens) im.ret = im.ret.map((v: number) => v * HD);

// ---- o caminho do vagalume: x, y no mundo (origem no chao entre os pes) e a profundidade z (1 na
// frente, -1 atras), e se esta em cena
type Ponto = { x: number; y: number; z: number; cena: boolean };
const FACE = { x: 0, y: 128 }; // o nariz
const POUSO = 5.4; // o vagalume pousa no nariz
function vagalume(t: number): Ponto {
  const pairar = (x: number, y: number, t0: number) => ({ x: x + 5 * Math.sin(2 * Math.PI * (t - t0) * 0.9), y: y + 8 * Math.sin(2 * Math.PI * (t - t0) * 1.4) });
  if (t < 0.9) return { x: 320, y: 210, z: 1, cena: false };
  if (t < 1.4) {
    const f = suave((t - 0.9) / 0.5);
    return { x: mistura(320, 98, f), y: mistura(210, 152, f) + 30 * Math.sin(Math.PI * f), z: 1, cena: true };
  }
  if (t < 2.0) return { ...pairar(98, 152, 1.4), z: 1, cena: true };
  if (t < 3.6) {
    // a volta por tras: de 20 graus (frente, a direita) a -200 (frente, a esquerda), passando por
    // -90 (atras do zumbi)
    const ini = pairar(98, 152, 1.4);
    const f = (t - 2.0) / 1.6;
    const fi = ((20 - 220 * suave(f)) * Math.PI) / 180;
    const p = { x: 105 * Math.cos(fi), y: 150 + 20 * Math.sin(2 * fi) };
    const k = suave(Math.min(1, f * 6)); // emenda com o pairar
    return { x: mistura(ini.x, p.x, k), y: mistura(ini.y, p.y, k), z: Math.sin(fi), cena: true };
  }
  if (t < 4.35) {
    // baixo, na frente, em ziguezague entre as maos
    const fim3 = vagalume(3.5999);
    const f = (t - 3.6) / 0.75;
    // os bracos sao curtos (a mao nao passa de uns 125 px) e a cabeca, na frente, cobre o que esta
    // logo abaixo do queixo: a palma e na altura da barriga
    return { x: mistura(fim3.x, -4, suave(f)) + 14 * Math.sin(f * Math.PI * 3) * suave(f), y: mistura(fim3.y, 68, suave(f)), z: 1, cena: true };
  }
  if (t < 4.6) {
    // escapa para cima no instante da palma
    const f = suave((t - 4.35) / 0.25);
    return { x: mistura(-4 + 14 * Math.sin(Math.PI * 3), 8, f), y: mistura(68, 248, f), z: 1, cena: true };
  }
  if (t < 4.95) {
    // paira la em cima, zombando, enquanto ele olha as maos vazias
    return { x: 8 + 12 * Math.sin(2 * Math.PI * (t - 4.6) * 1.6), y: 248 + 6 * Math.sin(2 * Math.PI * (t - 4.6) * 2.4), z: 1, cena: true };
  }
  if (t < POUSO) {
    // desce num arco e pousa no nariz
    const ini = vagalume(4.9499);
    const f = suave((t - 4.95) / (POUSO - 4.95));
    return { x: mistura(ini.x, FACE.x, f) + 60 * Math.sin(Math.PI * f) * (1 - f), y: mistura(ini.y, FACE.y, f), z: 1, cena: true };
  }
  if (t < 6.4) return { x: FACE.x + 2 * Math.sin(2 * Math.PI * (t - POUSO) * 2), y: FACE.y + 2 * Math.sin(2 * Math.PI * (t - POUSO) * 3), z: 1, cena: true };
  if (t < 7.4) {
    const f = suave((t - 6.4) / 1.0);
    return { x: mistura(0, -320, f * f), y: mistura(FACE.y, 300, f) + 25 * Math.sin(Math.PI * f), z: 1, cena: true };
  }
  return { x: -320, y: 300, z: 1, cena: false };
}

// ---- o zumbi: acordado (0 cochilando, 1 acordado) e para onde olha
const acordado = (t: number) => entre(t, 1.25, 1.5) * (1 - entre(t, 7.1, 7.6));
const olhar = (t: number) => {
  const v = vagalume(t);
  if (!v.cena) return { giro: 0, tilt: 0 };
  // o giro segue o x da luz; atras dele ainda tenta, por cima do ombro; o tilt segue a altura
  const segue = { giro: clamp(0.3 * v.x, -28, 28), tilt: clamp(0.15 * (v.y - FACE.y), -10, 12) };
  // depois da palma ele olha as maos vazias (para baixo) e so no 4,85 percebe o vagalume em cima
  // (a cabeca sobe de estalo)
  const maos = entre(t, 4.45, 4.62) * (1 - entre(t, 4.82, 4.92));
  return { giro: mistura(segue.giro, 0, maos) * acordado(t), tilt: mistura(segue.tilt, -11, maos) * acordado(t) };
};

// ---- imagens desenhadas aqui (a luz do vagalume, o ceu, o chao, a lua, a nevoa, a sombra)
const pagina = (arquivo: string, w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) => {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) png.data.set(px((x + 0.5) / w, (y + 0.5) / h).map((v) => Math.round(clamp(v, 0, 255))), (y * w + x) * 4);
  writeFileSync(join(AQUI, arquivo), PNG.sync.write(png));
  b.paginas.push({ arquivo, tamanho: [w, h] });
  const nome = arquivo.replace(/\.png$/, "");
  b.imagens.push({ nome, pagina: b.paginas.length - 1, ret: [0, 0, w, h] });
  return nome;
};
// a luz do vagalume: miolo branco firme e halo que cai rapido (a cor vem do slot, somando luz)
pagina("vagalume.png", 96, 96, (x, y) => {
  const r = Math.hypot(x - 0.5, y - 0.5) * 2;
  const a = Math.max(0, 1 - r / 0.18) ** 0.7 + 0.55 * Math.max(0, 1 - r) ** 3;
  return [255, 255, 255, 255 * Math.min(1, a)];
});
// o ceu: azul fundo em cima, mais roxo perto do horizonte
pagina("ceu.png", 8, 256, (_x, y) => {
  const f = y ** 1.6;
  return [mistura(10, 52, f), mistura(14, 34, f), mistura(38, 78, f), 255];
});
// as pecas do cenario que recebem luz (cerca, chao, grama da frente) tem a cor natural delas
// (madeira, grama): a ambiente baixa e azulada escurece tudo, e onde a lua ou o vagalume batem
// aparece a cor de verdade
const AMBIENTE = { cor: [0x74, 0x84, 0xc0], forca: 0.55 };
// ruido 1D suave e repetivel (para os perfis dos morros, da grama e das estrelas)
const hash = (i: number, s: number) => {
  const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const ruido = (x: number, s: number) => {
  const i = Math.floor(x),
    f = x - i;
  return mistura(hash(i, s), hash(i + 1, s), f * f * (3 - 2 * f));
};
// recorte macio de uma silhueta: 1 dentro, 0 fora, 1,5 px de transicao (d em pixels)
const borda = (d: number) => clamp(d / 1.5 + 0.5, 0, 1);
// o chao: grama recortada em cima (tufos), a beirada de luar e o escuro para baixo
pagina("chao.png", 512, 96, (x, y) => {
  const topo = 0.1 - 0.07 * Math.max(0, ruido(x * 90, 1) * 1.6 - 0.6) - 0.02 * ruido(x * 13, 2);
  const a = borda((y - topo) * 96);
  const luar = Math.max(0, 1 - (y - topo) / 0.06);
  return [mistura(46, 110, luar), mistura(74, 140, luar), mistura(56, 120, luar), 255 * a];
});
// a lua: disco claro com crateras, a borda macia e um halo largo (somando luz)
pagina("lua.png", 128, 128, (x, y) => {
  const r = Math.hypot(x - 0.5, y - 0.5) * 2;
  const disco = clamp((0.42 - r) / 0.03, 0, 1);
  const halo = 0.35 * Math.max(0, 1 - r) ** 2.2;
  const crateras = [
    [0.4, 0.42, 0.07],
    [0.58, 0.55, 0.05],
    [0.47, 0.62, 0.035],
    [0.6, 0.38, 0.03],
  ].reduce((m, [cx, cy, cr]) => Math.max(m, clamp((cr - Math.hypot(x - cx, y - cy)) / 0.012, 0, 1)), 0);
  return [mistura(150, 236 - 40 * crateras, disco), mistura(170, 240 - 34 * crateras, disco), 255 - 20 * crateras, 255 * clamp(disco + halo, 0, 1)];
});
// as estrelas miudas: pontos de 1 a 2 px, mais densas no alto
pagina("estrelas.png", 512, 512, (x, y) => {
  const gx = Math.floor(x * 512),
    gy = Math.floor(y * 512);
  let a = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const cx = Math.floor((gx + dx) / 5),
        cy = Math.floor((gy + dy) / 5);
      if (hash(cx * 7 + cy * 131, 3) > 0.92 - 0.06 * (1 - y)) {
        const px = cx * 5 + 2 + Math.floor(hash(cx, cy) * 3) - 1,
          py = cy * 5 + 2 + Math.floor(hash(cy, cx) * 3) - 1;
        const r = Math.hypot(gx - px, gy - py);
        a = Math.max(a, clamp(1.4 - r, 0, 1) * (0.4 + 0.6 * hash(cx, cy + 9)));
      }
    }
  // somem perto do horizonte (a parte de baixo do ceu fica atras dos morros)
  return [220, 228, 255, 255 * a * clamp((0.82 - y) / 0.3, 0, 1)];
});
// uma estrela de quatro pontas (as que cintilam)
pagina("cintila.png", 48, 48, (x, y) => {
  const dx = Math.abs(x - 0.5) * 2,
    dy = Math.abs(y - 0.5) * 2;
  const a = clamp((1 - (Math.pow(dx, 0.5) + Math.pow(dy, 0.5))) / 0.08, 0, 1) + 0.6 * Math.max(0, 1 - Math.hypot(dx, dy) / 0.35);
  return [235, 240, 255, 255 * clamp(a, 0, 1)];
});
// os morros de longe: perfil ondulado, azul-arroxeado claro (o ar entre a gente e eles)
pagina("morros_longe.png", 512, 128, (x, y) => {
  const topo = 1 - (0.5 + 0.2 * Math.sin(2 * Math.PI * x * 1.3 + 1) + 0.1 * Math.sin(2 * Math.PI * x * 3.1 + 2) + 0.05 * ruido(x * 24, 4));
  const d = (y - topo) * 128;
  return [mistura(64, 44, clamp(d / 40, 0, 1)), mistura(62, 44, clamp(d / 40, 0, 1)), mistura(118, 88, clamp(d / 40, 0, 1)), 255 * borda(d)];
});
// os morros de perto: mais escuros, com arvores redondas em silhueta
const ARVORES = [
  [0.08, 0.34, 0.05],
  [0.13, 0.3, 0.035],
  [0.31, 0.42, 0.06],
  [0.36, 0.38, 0.04],
  [0.67, 0.36, 0.055],
  [0.74, 0.33, 0.04],
  [0.91, 0.4, 0.05],
];
pagina("morros_perto.png", 1024, 192, (x, y) => {
  const topo = 1 - (0.42 + 0.12 * Math.sin(2 * Math.PI * x * 2.2 + 0.5) + 0.04 * ruido(x * 40, 5));
  let d = (y - topo) * 192;
  // copa redonda (dois circulos) e tronco
  for (const [ax, ay, ar] of ARVORES) {
    const base = 1 - (0.42 + 0.12 * Math.sin(2 * Math.PI * ax * 2.2 + 0.5));
    const copa = Math.max(ar * 192 - Math.hypot((x - ax) * 1024 * 0.5, (y - (base - ay * 0.55)) * 192), ar * 150 - Math.hypot((x - ax - ar * 0.35) * 1024 * 0.5, (y - (base - ay * 0.45)) * 192));
    const tronco = Math.min(3 - Math.abs(x - ax) * 1024, (y - (base - ay * 0.4)) * 192, (base + 0.02 - y) * 192);
    d = Math.max(d, copa, tronco);
  }
  return [24, 26, 52, 255 * borda(d)];
});
// a cerca de madeira: estacas tortinhas e duas ripas, com o luar no topo
pagina("cerca.png", 512, 64, (x, y) => {
  const px = x * 512,
    py = y * 64;
  let d = -9;
  for (let k = 0; k < 9; k++) {
    const cx = 28 + k * 57 + (hash(k, 6) - 0.5) * 10,
      inc = (hash(k, 7) - 0.5) * 0.12;
    const topo = 6 + hash(k, 8) * 8;
    const larg = 6 - Math.abs(px - (cx + (py - 32) * inc));
    d = Math.max(d, Math.min(larg, py - topo, 64 - py));
  }
  for (const ry of [22, 40]) d = Math.max(d, Math.min(4 - Math.abs(py - ry - (px / 512) * 3), px - 10, 502 - px));
  const luar = clamp(1 - (py - 4) / 14, 0, 1) * 0.5;
  return [mistura(122, 170, luar), mistura(88, 132, luar), mistura(66, 110, luar), 255 * borda(d)];
});
// tufos de grama da frente: escuros, em pontas
pagina("grama_frente.png", 256, 96, (x, y) => {
  let d = -9;
  for (let k = 0; k < 14; k++) {
    const cx = 0.04 + k * 0.07 + (hash(k, 9) - 0.5) * 0.04,
      alt = 0.45 + 0.5 * hash(k, 10),
      inc = (hash(k, 11) - 0.5) * 0.5;
    const t = (1 - y) / alt;
    if (t < 0 || t > 1) continue;
    const meia = 0.03 * (1 - t);
    d = Math.max(d, (meia - Math.abs(x - cx - inc * t * alt * 0.4)) * 256);
  }
  return [34, 58, 42, 255 * borda(d)];
});
// a nevoa: uma nuvem macia e achatada
pagina("nevoa.png", 128, 64, (x, y) => {
  const r = Math.hypot((x - 0.5) * 2, (y - 0.5) * 2);
  return [255, 255, 255, 255 * Math.max(0, 1 - r) ** 1.8];
});
// a sombra: elipse escura e macia
pagina("sombra.png", 128, 32, (x, y) => {
  const r = Math.hypot((x - 0.5) * 2, (y - 0.5) * 2);
  return [0, 0, 0, 255 * Math.max(0, 1 - r) ** 1.2];
});

for (const arquivo of ["cerca.png", "chao.png", "grama_frente.png"]) b.paginas.find((p: any) => p.arquivo === arquivo).relevo = arquivo.replace(".png", "_relevo.png");

// ---- ossos e slots da cena
b.ossos.push(
  { nome: "vagalume", pai: "root", x: 320, y: 210 },
  { nome: "sombra", pai: "root", y: 2 },
  // a camera balanca em volta do zumbi: cada camada anda pela distancia (docs: paralaxe)
  { nome: "cam_ceu", pai: "root" },
  { nome: "cam_longe", pai: "root" },
  { nome: "cam_perto", pai: "root" },
  { nome: "cam_cerca", pai: "root" },
  { nome: "cam_frente", pai: "root" },
  { nome: "lua", pai: "cam_ceu", x: -150, y: 290 },
  { nome: "nevoa_atras", pai: "cam_cerca", y: 40 },
  { nome: "nevoa_frente", pai: "cam_frente", y: 4 },
  { nome: "cintila", pai: "cam_ceu" },
);
const regiao = (slot: string, imagem: string, largura: number, altura: number, extra: any = {}) => (b.skins[0].partes[slot] = { [imagem]: { largura, altura, ...extra } });
// estrelas que cintilam (a cor anima)
const CINTILA = [
  [-60, 300, 18],
  [90, 280, 14],
  [170, 230, 20],
  [-190, 220, 12],
  [30, 250, 10],
];
const cena = [
  { nome: "ceu", osso: "cam_ceu", parte: "ceu" },
  { nome: "estrelas", osso: "cam_ceu", parte: "estrelas", blend: "aditivo" },
  ...CINTILA.map((_, k) => ({ nome: `cintila_${k}`, osso: "cintila", parte: "cintila", blend: "aditivo" })),
  { nome: "lua", osso: "lua", parte: "lua", blend: "aditivo" },
  { nome: "morros_longe", osso: "cam_longe", parte: "morros_longe" },
  { nome: "vagalumes_longe", osso: "cam_longe" },
  { nome: "morros_perto", osso: "cam_perto", parte: "morros_perto" },
  // a nevoa de tras: quatro copias a cada 500 px, o osso anda 500 em 8 s (a parte visivel no fim do
  // laco e igual a do comeco)
  ...[-2, -1, 0, 1].map((k) => ({ nome: `nevoa_atras_${k + 2}`, osso: "nevoa_atras", parte: "nevoa", cor: "8a9ad048" })),
  // a cerca fica atras do chao (a base some na grama: esta mais longe que o zumbi)
  { nome: "cerca", osso: "cam_cerca", parte: "cerca" },
  { nome: "chao", osso: "root", parte: "chao" },
  { nome: "vagalume_atras", osso: "vagalume", parte: "vagalume", blend: "aditivo", cor: "e6ff8a00" },
  { nome: "sombra", osso: "sombra", parte: "sombra", cor: "ffffff73" },
];
regiao("ceu", "ceu", 1000, 640, { y: 250 });
regiao("lua", "lua", 96, 96);
regiao("chao", "chao", 1000, 190, { y: -86 });
// as estrelas cobrem o ceu inteiro (o mesmo retangulo dele)
regiao("estrelas", "estrelas", 1000, 640, { y: 250 });
CINTILA.forEach(([x, y, l], k) => regiao(`cintila_${k}`, "cintila", l, l, { x, y }));
regiao("morros_longe", "morros_longe", 1000, 170, { y: 70 });
regiao("morros_perto", "morros_perto", 1100, 190, { y: 40, x: 30 });
regiao("cerca", "cerca", 520, 56, { y: 26, x: 40 });
regiao("vagalume_atras", "vagalume", 40, 40);
regiao("sombra", "sombra", 150, 30);
b.slots.unshift(...cena);
// a nevoa da frente: duas copias a cada 1000 px, mais rapida (mais perto)
b.slots.push({ nome: "vagalume_frente", osso: "vagalume", parte: "vagalume", blend: "aditivo", cor: "e6ff8a00" }, ...[-1, 0].map((k) => ({ nome: `nevoa_frente_${k + 2}`, osso: "nevoa_frente", parte: "nevoa", cor: "9aa8d850" })));
regiao("vagalume_frente", "vagalume", 40, 40);
for (const k of [-2, -1, 0, 1]) regiao(`nevoa_atras_${k + 2}`, "nevoa", 420, 90, { x: k * 500 });
for (const k of [-1, 0]) regiao(`nevoa_frente_${k + 2}`, "nevoa", 640, 70, { x: k * 1000 - 120 });
// os tufos de grama da frente, nos dois cantos de baixo (na frente do zumbi e da nevoa de tras)
b.slots.push({ nome: "grama_frente_e", osso: "cam_frente", parte: "grama_frente" }, { nome: "grama_frente_d", osso: "cam_frente", parte: "grama_frente" });
regiao("grama_frente_e", "grama_frente", 260, 90, { x: -170, y: -40 });
regiao("grama_frente_d", "grama_frente", 220, 80, { x: 185, y: -45, escala_x: -1 });

// ---- particulas: o rastro de faiscas do vagalume (um emissor por plano)
const faiscas = (nome: string, slot: string) => ({
  nome,
  slot,
  osso: "vagalume",
  imagem: "vagalume",
  blend: "aditivo",
  taxa: 0,
  vida: [0.4, 0.8],
  velocidade: [10, 40],
  angulo: -90,
  abertura: 180,
  gravidade: 30,
  arrasto: 2,
  escala: [0.12, 0.02],
  cor: ["f4ffb0ff", "c8ff5a00"],
  semente: nome.length,
});
// vagalumes ao longe, sobre o campo: pontinhos que acendem e apagam devagar, sem luz propria
const LONGE = [
  [-170, 70],
  [-90, 95],
  [-20, 60],
  [70, 90],
  [150, 65],
  [200, 100],
];
const longe = (k: number) => ({
  nome: `longe_${k}`,
  slot: "vagalumes_longe",
  osso: "cam_longe",
  x: LONGE[k][0],
  y: LONGE[k][1],
  imagem: "vagalume",
  blend: "aditivo",
  taxa: 0.7,
  vida: [2.5, 4],
  velocidade: [3, 14],
  angulo: 90,
  abertura: 360,
  gravidade: -3,
  escala: [0.09, 0.07],
  cor: ["dcff8000", "dcff80ff", "dcff8000"],
  semente: 20 + k,
});
b.particulas = [faiscas("faiscas_atras", "vagalume_atras"), faiscas("faiscas_frente", "vagalume_frente"), ...LONGE.map((_, k) => longe(k))];

// ---- luzes (docs/NUCLEO.md "Luzes"): noite (a ambiente baixa e azulada), a lua por tras e a
// esquerda (contraluz) e a luz do vagalume, que anda com o osso dele
b.ambiente = { cor: AMBIENTE.cor.map((v) => v.toString(16).padStart(2, "0")).join("") + "ff", forca: AMBIENTE.forca };
b.luzes = [
  { nome: "lua", osso: "lua", cor: "aac6ffff", forca: 1.25, raio: 900, altura: -70 },
  { nome: "vagalume", osso: "vagalume", cor: "f4ffb8ff", forca: 0, raio: 240, altura: 60 },
];

// ---- as timelines: amostradas das funcoes
const T = amostras();
const ossos: Record<string, Record<string, any[]>> = {};
const chave = (osso: string, prop: string, t: number, v: any) => ((ossos[osso] ??= {})[prop] ??= []).push({ tempo: t, ...v });
// o vagalume (o osso mexe pela diferenca do setup) e o tamanho pela profundidade
for (const t of T) {
  const v = vagalume(t);
  chave("vagalume", "mover", t, { x: r3(v.x - 320), y: r3(v.y - 210) });
  const s = r3(1 + 0.3 * v.z);
  chave("vagalume", "escalar", t, { x: s, y: s });
  // a sombra no chao anda ao contrario da luz do vagalume (so na frente, perto) e estica
  const luz = v.cena ? clamp(1 - Math.abs(v.y - 40) / 260, 0, 1) * Math.max(0, v.z) : 0;
  chave("sombra", "mover", t, { x: r3(-0.35 * v.x * luz), y: 0 });
  chave("sombra", "escalar", t, { x: r3(1 + 0.25 * luz), y: 1 });
}
// a camera: 35 px para cada lado em 8 s; o ceu quase acompanha (longe), o zumbi e o chao ficam, a
// grama da frente corre ao contrario (perto)
const PARALAXE: Record<string, number> = { cam_ceu: 0.95, cam_longe: 0.8, cam_perto: 0.55, cam_cerca: 0.28, cam_frente: -0.45 };
for (const t of T) for (const [osso, k] of Object.entries(PARALAXE)) chave(osso, "mover", t, { x: r3(k * 35 * Math.sin((2 * Math.PI * t) / DUR)), y: 0 });
// a nevoa desliza (linear: o fim do laco cai numa copia igual ao comeco)
chave("nevoa_atras", "mover", 0, { x: 0, y: 0 });
chave("nevoa_atras", "mover", DUR, { x: 500, y: 0 });
chave("nevoa_frente", "mover", 0, { x: 0, y: 0 });
chave("nevoa_frente", "mover", DUR, { x: 1000, y: 0 });
// o zumbi: o corpo respira e balanca; a cabeca pende quando cochila; agacha um pouco no preparo
// antes de tentar pegar; no pouso um pulo de susto
for (const t of T) {
  const a = acordado(t);
  const susto = Math.sin(Math.PI * clamp((t - POUSO) / 0.4, 0, 1));
  const prep = Math.sin(Math.PI * clamp((t - 3.42) / 0.22, 0, 1));
  chave("corpo", "girar", t, { valor: r3(2.2 * Math.sin((2 * Math.PI * t) / 4) * (1 - 0.5 * a)) });
  chave("corpo", "escalar", t, { x: r3(1 - 0.03 * susto + 0.02 * prep), y: r3(1 + 0.015 * Math.sin((2 * Math.PI * t) / 2) + 0.07 * susto - 0.04 * prep) });
  chave("quadril", "mover", t, { x: 0, y: r3(-2.5 * (1 - a) + 11 * susto - 3 * prep) });
  // pende para um lado cochilando; acordado fica reto, com um balanco curto
  chave("cabeca", "girar", t, { valor: r3(13 * (1 - a) + 3 * Math.sin((2 * Math.PI * t) / 2.67) * a) });
}

// os bracos por cinematica inversa: onde cada mao quer estar, e o ombro e o cotovelo saem dali
const BRACO = 24.16609,
  ANTEBRACO = 24.74542 + 0;
const OMBRO = { e: { x: 39, y: 76 }, d: { x: -39, y: 76 } };
const SETUP_MUNDO = { e: { braco: -65.556, antebraco: -65.556 }, d: { braco: -114.444, antebraco: -114.444 } };
const graus = (r: number) => (r * 180) / Math.PI;
function ik(lado: "e" | "d", alvo: { x: number; y: number }) {
  const o = OMBRO[lado];
  const dx = alvo.x - o.x,
    dy = alvo.y - o.y;
  const d = clamp(Math.hypot(dx, dy), 1e-3, BRACO + ANTEBRACO - 0.5);
  const base = Math.atan2(dy, dx);
  const cos = clamp((BRACO * BRACO + d * d - ANTEBRACO * ANTEBRACO) / (2 * BRACO * d), -1, 1);
  // o cotovelo para baixo (abaixo da linha do ombro a mao, como braco pendurado): no lado e (direita
  // da tela) a mao vai para a esquerda e o cotovelo desce girando no sentido anti-horario; no d, o
  // contrario
  const s = lado === "e" ? 1 : -1;
  const a1 = base + s * Math.acos(cos);
  const cx = o.x + BRACO * Math.cos(a1),
    cy = o.y + BRACO * Math.sin(a1);
  const a2 = Math.atan2(alvo.y - cy, alvo.x - cx);
  return { braco: graus(a1), antebraco: graus(a2) };
}
const repouso = (lado: "e" | "d", t: number) => {
  const s = lado === "e" ? 1 : -1;
  return { x: s * 54 + 2 * Math.sin((2 * Math.PI * t) / 4 + (lado === "e" ? 0 : 1)), y: 32 + 1.5 * Math.sin((2 * Math.PI * t) / 2) };
};
function mao(lado: "e" | "d", t: number) {
  const r = repouso(lado, t);
  const s = lado === "e" ? 1 : -1;
  // o preparo (3,42 a 3,62): as maos recuam, para baixo e para fora, antes de ir
  const prep = Math.sin(Math.PI * clamp((t - 3.42) / 0.2, 0, 1));
  let p = { x: r.x + s * 6 * prep, y: r.y - 8 * prep };
  // a tentativa: as maos vao atras do vagalume, atrasadas, batem palma no 4,4, seguram, e abrem
  // devagar (vazias) enquanto ele olha para elas; descem quando ele ve o vagalume em cima
  const ida = entre(t, 3.58, 3.95) * (1 - entre(t, 4.95, 5.35));
  if (ida > 0) {
    const v = vagalume(Math.min(t, 4.35) - 0.12);
    const palma = entre(t, 4.2, 4.4),
      abre = entre(t, 4.55, 4.78);
    const alvo = { x: mistura(mistura(v.x + s * 36, v.x + s * 16, palma), v.x + s * 32, abre), y: v.y - 8 + 5 * abre };
    p = { x: mistura(p.x, alvo.x, ida), y: mistura(p.y, alvo.y, ida) };
  }
  // o susto no pouso: as maos sacodem para cima e para fora
  const sacode = Math.sin(Math.PI * clamp((t - POUSO) / 0.45, 0, 1));
  return { x: p.x + s * 10 * sacode, y: p.y + 24 * sacode };
}
// os angulos dos bracos a 60 por segundo, desenrolados e suavizados (o braco tem inercia: perto do
// ombro a cinematica inversa e instavel e um passo pequeno do alvo vira um giro grande), e as
// chaves saem dessa curva
const FINO = 1 / 60;
const finos = Array.from({ length: Math.round(DUR / FINO) + 1 }, (_, k) => k * FINO);
const desenrola = (v: number[]) => {
  for (let i = 1; i < v.length; i++) {
    while (v[i] - v[i - 1] > 180) v[i] -= 360;
    while (v[i] - v[i - 1] < -180) v[i] += 360;
  }
  return v;
};
// janela gaussiana de +-6 amostras (sigma 3: 0,05 s); no laco as pontas se emendam
const suaviza = (v: number[]) =>
  v.map((_, i) => {
    let s = 0,
      p = 0;
    for (let k = -6; k <= 6; k++) {
      const j = Math.min(v.length - 1, Math.max(0, i + k));
      const w = Math.exp(-(k * k) / 18);
      s += v[j] * w;
      p += w;
    }
    return s / p;
  });
const noTempo = (v: number[], t: number) => v[Math.min(v.length - 1, Math.round(t / FINO))];
for (const lado of ["e", "d"] as const) {
  const giroCorpo = (t: number) => 2.2 * Math.sin((2 * Math.PI * t) / 4) * (1 - 0.5 * acordado(t));
  const angs = finos.map((t) => ik(lado, mao(lado, t)));
  // girar e relativo ao setup: o braco no corpo (mundo menos o do setup), o antebraco no braco
  const braco = suaviza(desenrola(angs.map((a, i) => a.braco - SETUP_MUNDO[lado].braco - giroCorpo(finos[i]))));
  const ante = suaviza(desenrola(angs.map((a) => a.antebraco - a.braco)));
  // a mao chega atrasada, como coisa pendurada: gira contra a velocidade do antebraco no mundo
  const anteMundo = desenrola(braco.map((v, i) => v + ante[i]));
  const maoG = suaviza(anteMundo.map((v, i) => clamp(0.6 * (anteMundo[Math.max(0, i - 6)] - v), -35, 35)));
  for (const t of T) {
    chave(`braco_${lado}`, "girar", t, { valor: r3(noTempo(braco, t)) });
    chave(`antebraco_${lado}`, "girar", t, { valor: r3(noTempo(ante, t)) });
    chave(`mao_${lado}`, "girar", t, { valor: r3(noTempo(maoG, t)) });
  }
}

// os giros calculados vem entre -180 e 180: desenrola ao longo do tempo (cada chave a menos de 180
// graus da anterior), senao a passagem de 179 para -179 vira uma volta inteira num quadro
for (const tl of Object.values(ossos))
  if (tl.girar)
    for (let i = 1; i < tl.girar.length; i++) {
      let v = tl.girar[i].valor;
      const ant = tl.girar[i - 1].valor;
      while (v - ant > 180) v -= 360;
      while (v - ant < -180) v += 360;
      tl.girar[i].valor = r3(v);
    }

// os slots: a luz do vagalume de um lado ou de outro da ordem de desenho (em degrau na troca)
const slots: Record<string, any> = { vagalume_atras: { rgba: [] }, vagalume_frente: { rgba: [] }, cabeca: { parte: [] } };
let antes = "";
for (const t of T) {
  const v = vagalume(t);
  const lado = !v.cena ? "nenhum" : v.z >= 0 ? "frente" : "atras";
  if (lado === antes) continue;
  antes = lado;
  slots.vagalume_frente.rgba.push({ tempo: t, cor: lado === "frente" ? "e6ff8aff" : "e6ff8a00", curva: "degrau" });
  slots.vagalume_atras.rgba.push({ tempo: t, cor: lado === "atras" ? "e6ff8aff" : "e6ff8a00", curva: "degrau" });
}
// as caras: cochilando, acordado, susto no pouso, acordado, cochilando
slots.cabeca.parte = [
  { tempo: 0, nome: "headFocus" },
  { tempo: 1.32, nome: "head" },
  { tempo: POUSO, nome: "headShock" },
  { tempo: r3(POUSO + 0.45), nome: "head" },
  { tempo: 7.35, nome: "headFocus" },
];
b.slots.find((s: any) => s.nome === "cabeca").parte = "headFocus";

// as estrelas cintilam: alfa entre 0,25 e 1, num numero inteiro de ciclos em 8 s (o laco fecha)
CINTILA.forEach((_, k) => {
  const ciclos = 2 + k,
    fase = hash(k, 12);
  slots[`cintila_${k}`] = {
    rgba: amostras()
      .filter((_, i) => i % 3 === 0)
      .map((t) => ({ tempo: t, cor: "ffffff" + Math.round(255 * (0.25 + 0.75 * Math.abs(Math.sin(Math.PI * ((ciclos * t) / DUR + fase))))).toString(16).padStart(2, "0") })),
  };
});
// a luz do vagalume: acende ao entrar, a altura segue a profundidade (atras: contraluz), mais
// forte e pulsando pousado no nariz
const luzes: Record<string, any[]> = { vagalume: [] };
for (const t of T) {
  const v = vagalume(t);
  const entra = entre(t, 0.9, 1.15) * (1 - entre(t, 7.0, 7.4));
  const pouso = entre(t, POUSO - 0.05, POUSO + 0.1) * (1 - entre(t, 6.3, 6.5));
  const forca = entra * (1.1 + pouso * (0.35 + 0.25 * Math.sin(2 * Math.PI * (t - POUSO) * 2.5)));
  luzes.vagalume.push({ tempo: t, forca: r3(forca), altura: r3(v.z >= 0 ? 15 + 55 * v.z - pouso * 25 : 75 * v.z), raio: r3(240 + 60 * pouso) });
}
// as faiscas: so do lado em que o vagalume esta; os vagalumes de longe ja comecam acesos (uma
// rajada no comeco do laco)
const particulas: Record<string, any> = { faiscas_frente: { taxa: [] }, faiscas_atras: { taxa: [] } };
LONGE.forEach((_, k) => (particulas[`longe_${k}`] = { rajada: [{ tempo: 0, quantidade: 2 }] }));
antes = "";
for (const t of T) {
  const v = vagalume(t);
  const lado = !v.cena ? "nenhum" : v.z >= 0 ? "frente" : "atras";
  if (lado === antes) continue;
  antes = lado;
  particulas.faiscas_frente.taxa.push({ tempo: t, valor: lado === "frente" ? 22 : 0, curva: "degrau" });
  particulas.faiscas_atras.taxa.push({ tempo: t, valor: lado === "atras" ? 22 : 0, curva: "degrau" });
}

// a ordem de desenho: na tentativa de pegar, os bracos e as maos passam na frente da cabeca (ela
// vai para logo depois do corpo), e voltam para tras quando as maos descem, antes do pouso
const ordem_desenho = [
  { tempo: 0 },
  { tempo: 3.55, deslocamentos: [{ slot: "cabeca", deslocamento: -4 }] },
  { tempo: 5.3 },
];

b.animacoes = { vagalume: { ossos, slots, luzes, particulas, ordem_desenho }, idle: b.animacoes.idle, anda: b.animacoes.anda };

// ---- 2,5D com os comandos do editor: a cabeca (as tres caras) e o corpo viram malha e giram atras
// da luz; o corpo gira menos, a cabeca puxa. Na cabeca o cilindro tem raio 40 (o rosto; a malha
// vai de -54 a 54): as orelhas ficam fora e andam rigidas com a borda, sem esticar
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
const chamadas: any[] = [];
const CARAS = ["head", "headFocus", "headShock"];
for (const att of CARAS) chamadas.push({ cmd: "mesh.create", args: { slot: "cabeca", name: att, detail: 1.4 } });
chamadas.push({ cmd: "mesh.create", args: { slot: "corpo", name: "body", detail: 1.4 } });
for (const t of amostras().filter((_, k) => k % 2 === 0)) {
  const o = olhar(t);
  for (const att of CARAS) chamadas.push({ cmd: "deform.turn", args: { anim: "vagalume", slot: "cabeca", attachment: att, time: t, angle: r3(o.giro), perspective: 0.2, radius: 40, ...(o.tilt ? { tilt: r3(o.tilt) } : {}) } });
  chamadas.push({ cmd: "deform.turn", args: { anim: "vagalume", slot: "corpo", attachment: "body", time: t, angle: r3(0.4 * o.giro), perspective: 0.15 } });
}
await executeAsync(doc, chamadas, "gerador", "2,5D", {}, imagens);
const final = importarSpine(doc.json, ex.atlas, "vagalume");
final.mix = { padrao: 0.2 };
writeFileSync(join(AQUI, "vagalume.boneco"), JSON.stringify(final, null, 1) + "\n");
// o relevo (tools/relevo.ts, pela silhueta): o zumbi e as pecas de cenario que recebem luz, cada
// uma com a borda na escala dela
for (const [arquivo, borda] of [["zumbi-hd.webp", 24], ["cerca.png", 5], ["chao.png", 8], ["grama_frente.png", 4]] as const) {
  const i = final.paginas.findIndex((p: any) => p.arquivo === arquivo);
  const r = spawnSync("npx", ["tsx", join(AQUI, "..", "..", "tools", "relevo.ts"), join(AQUI, "vagalume.boneco"), "--borda", String(borda), "--paginas", String(i)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`relevo de ${arquivo}: ${r.stderr}`);
}
console.log(`vagalume.boneco: ${Object.keys(ossos).length} ossos animados, ${T.length} amostras, ${b.luzes.length} luzes`);
