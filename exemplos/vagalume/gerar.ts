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
  if (t < 5.15) {
    // desce num arco e pousa no nariz
    const f = suave((t - 4.6) / 0.55);
    return { x: 8 + 70 * Math.sin(Math.PI * f) * (1 - f), y: mistura(248, FACE.y, f), z: 1, cena: true };
  }
  if (t < 6.4) return { x: FACE.x + 2 * Math.sin(2 * Math.PI * (t - 5.15) * 2), y: FACE.y + 2 * Math.sin(2 * Math.PI * (t - 5.15) * 3), z: 1, cena: true };
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
  return { giro: clamp(0.3 * v.x, -28, 28) * acordado(t), tilt: clamp(0.15 * (v.y - FACE.y), -10, 12) * acordado(t) };
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
// o chao: a beirada clara (luar) e o escuro para baixo
pagina("chao.png", 8, 64, (_x, y) => {
  const borda = Math.max(0, 1 - y / 0.08);
  return [mistura(22, 70, borda), mistura(26, 86, borda), mistura(40, 110, borda), 255];
});
// a lua: disco claro com a borda macia e um halo largo (somando luz)
pagina("lua.png", 128, 128, (x, y) => {
  const r = Math.hypot(x - 0.5, y - 0.5) * 2;
  const disco = clamp((0.42 - r) / 0.03, 0, 1);
  const halo = 0.35 * Math.max(0, 1 - r) ** 2.2;
  return [mistura(150, 236, disco), mistura(170, 240, disco), 255, 255 * clamp(disco + halo, 0, 1)];
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

// ---- ossos e slots da cena
b.ossos.push(
  { nome: "vagalume", pai: "root", x: 320, y: 210 },
  { nome: "sombra", pai: "root", y: 2 },
  { nome: "lua", pai: "root", x: -150, y: 290 },
  { nome: "nevoa_atras", pai: "root", y: 40 },
  { nome: "nevoa_frente", pai: "root", y: 4 },
);
const regiao = (slot: string, imagem: string, largura: number, altura: number, extra: any = {}) => (b.skins[0].partes[slot] = { [imagem]: { largura, altura, ...extra } });
const cena = [
  { nome: "ceu", osso: "root", parte: "ceu" },
  { nome: "lua", osso: "lua", parte: "lua", blend: "aditivo" },
  { nome: "chao", osso: "root", parte: "chao" },
  // a nevoa de tras: quatro copias a cada 500 px, o osso anda 500 em 8 s (a parte visivel no fim do
  // laco e igual a do comeco)
  ...[-2, -1, 0, 1].map((k) => ({ nome: `nevoa_atras_${k + 2}`, osso: "nevoa_atras", parte: "nevoa", cor: "8a9ad048" })),
  { nome: "vagalume_atras", osso: "vagalume", parte: "vagalume", blend: "aditivo", cor: "e6ff8a00" },
  { nome: "sombra", osso: "sombra", parte: "sombra", cor: "ffffff73" },
];
regiao("ceu", "ceu", 1000, 640, { y: 250 });
regiao("lua", "lua", 96, 96);
regiao("chao", "chao", 1000, 160, { y: -78 });
regiao("vagalume_atras", "vagalume", 40, 40);
regiao("sombra", "sombra", 150, 30);
b.slots.unshift(...cena);
// a nevoa da frente: duas copias a cada 1000 px, mais rapida (mais perto)
b.slots.push({ nome: "vagalume_frente", osso: "vagalume", parte: "vagalume", blend: "aditivo", cor: "e6ff8a00" }, ...[-1, 0].map((k) => ({ nome: `nevoa_frente_${k + 2}`, osso: "nevoa_frente", parte: "nevoa", cor: "9aa8d850" })));
regiao("vagalume_frente", "vagalume", 40, 40);
for (const k of [-2, -1, 0, 1]) regiao(`nevoa_atras_${k + 2}`, "nevoa", 420, 90, { x: k * 500 });
for (const k of [-1, 0]) regiao(`nevoa_frente_${k + 2}`, "nevoa", 640, 70, { x: k * 1000 - 120 });

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
b.particulas = [faiscas("faiscas_atras", "vagalume_atras"), faiscas("faiscas_frente", "vagalume_frente")];

// ---- luzes (docs/NUCLEO.md "Luzes"): noite (a ambiente baixa e azulada), a lua por tras e a
// esquerda (contraluz) e a luz do vagalume, que anda com o osso dele
b.ambiente = { cor: "7484c0ff", forca: 0.55 };
b.luzes = [
  { nome: "lua", osso: "root", x: -150, y: 290, cor: "aac6ffff", forca: 1.25, raio: 900, altura: -70 },
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
// a nevoa desliza (linear: o fim do laco cai numa copia igual ao comeco)
chave("nevoa_atras", "mover", 0, { x: 0, y: 0 });
chave("nevoa_atras", "mover", DUR, { x: 500, y: 0 });
chave("nevoa_frente", "mover", 0, { x: 0, y: 0 });
chave("nevoa_frente", "mover", DUR, { x: 1000, y: 0 });
// o zumbi: o corpo respira e balanca; a cabeca pende quando cochila; no pouso um pulinho
for (const t of T) {
  const a = acordado(t);
  const susto = Math.sin(Math.PI * clamp((t - 5.15) / 0.35, 0, 1));
  chave("corpo", "girar", t, { valor: r3(2.2 * Math.sin((2 * Math.PI * t) / 4) * (1 - 0.5 * a)) });
  chave("corpo", "escalar", t, { x: r3(1 - 0.02 * susto), y: r3(1 + 0.015 * Math.sin((2 * Math.PI * t) / 2) + 0.05 * susto) });
  chave("quadril", "mover", t, { x: 0, y: r3(-2.5 * (1 - a) + 7 * susto) });
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
  // o cotovelo para fora: a mao do lado e (direita da tela) dobra com o cotovelo para a direita
  const s = lado === "e" ? -1 : 1;
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
  // a tentativa (3,6 a 4,4): as maos vao atras do vagalume, atrasadas, e batem palma no 4,4
  const ida = entre(t, 3.55, 3.95) * (1 - entre(t, 4.55, 5.2));
  if (ida <= 0) return r;
  const v = vagalume(Math.min(t, 4.35) - 0.12);
  const s = lado === "e" ? 1 : -1;
  const palma = entre(t, 4.2, 4.4);
  // cada mao de um lado do vagalume, que se encontram nele na palma
  const alvo = { x: mistura(v.x + s * 34, v.x + s * 13, palma), y: v.y - 4 };
  // depois da palma as maos sobem um pouco atras do vagalume que escapou
  const sobe = entre(t, 4.4, 4.65) * (1 - entre(t, 4.75, 5.2));
  alvo.y += 30 * sobe;
  return { x: mistura(r.x, alvo.x, ida), y: mistura(r.y, alvo.y, ida) };
}
for (const t of T)
  for (const lado of ["e", "d"] as const) {
    const ang = ik(lado, mao(lado, t));
    // girar e relativo ao setup: o braco no corpo (mundo menos o do setup), o antebraco no braco
    const giroCorpo = 2.2 * Math.sin((2 * Math.PI * t) / 4) * (1 - 0.5 * acordado(t));
    const norm = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
    chave(`braco_${lado}`, "girar", t, { valor: r3(norm(ang.braco - SETUP_MUNDO[lado].braco - giroCorpo)) });
    chave(`antebraco_${lado}`, "girar", t, { valor: r3(norm(ang.antebraco - ang.braco)) });
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
  { tempo: 5.15, nome: "headShock" },
  { tempo: 5.55, nome: "head" },
  { tempo: 7.35, nome: "headFocus" },
];
b.slots.find((s: any) => s.nome === "cabeca").parte = "headFocus";

// a luz do vagalume: acende ao entrar, a altura segue a profundidade (atras: contraluz), mais
// forte e pulsando pousado no nariz
const luzes: Record<string, any[]> = { vagalume: [] };
for (const t of T) {
  const v = vagalume(t);
  const entra = entre(t, 0.9, 1.15) * (1 - entre(t, 7.0, 7.4));
  const pouso = entre(t, 5.1, 5.25) * (1 - entre(t, 6.3, 6.5));
  const forca = entra * (1.1 + pouso * (0.35 + 0.25 * Math.sin(2 * Math.PI * (t - 5.15) * 2.5)));
  luzes.vagalume.push({ tempo: t, forca: r3(forca), altura: r3(v.z >= 0 ? 15 + 55 * v.z - pouso * 25 : 75 * v.z), raio: r3(240 + 60 * pouso) });
}
// as faiscas: so do lado em que o vagalume esta
const particulas: Record<string, any> = { faiscas_frente: { taxa: [] }, faiscas_atras: { taxa: [] } };
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
// vai para logo depois do corpo), e voltam para tras quando o vagalume pousa
const ordem_desenho = [
  { tempo: 0 },
  { tempo: 3.55, deslocamentos: [{ slot: "cabeca", deslocamento: -4 }] },
  { tempo: 5.15 },
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
console.log(`vagalume.boneco: ${Object.keys(ossos).length} ossos animados, ${T.length} amostras, ${b.luzes.length} luzes`);
