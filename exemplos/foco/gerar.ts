// O fotografo: profundidade de campo com desfoque, numa historia em que o foco e a acao. Vemos
// pelo visor da camera do azul (ele fica fora do quadro), num laco de 9 s (animacao "foto"):
//
//   0,0-1,6  o visor abre com tudo desfocado; a lente gira e o grupo entra em foco (o marcador
//            de foco anda de "perto" para o grupo, os cantos do AF ficam verdes)
//   1,6-2,9  o grupo acena; o marrom sai andando pela direita
//   2,9-3,9  o marrom aparece enorme na frente da lente, desfocado; o foco pula para ele (o
//            grupo borra ao fundo) e ele faz careta
//   4,6-5,8  o azul reclama ("Ei! Sai da frente!"), o visor treme, o marrom sai e o foco volta
//            para o grupo
//   5,8-6,4  todos fazem pose; flash
//   6,4-9,0  a foto congela e vira uma Polaroid em cima da mesa
//
// O desfoque e o das camadas de ajuste do nucleo (docs/NUCLEO.md "Ajuste"): uma sem mascara logo
// acima do fundo e do grupo (desfoca o que esta atras) e uma com mascara esfumada em cima do
// marrom de perto. Os monstros sao instancias de exemplos/monstros (animacoes foto_grupo e
// foto_careta), congeladas no flash.
//
//   npx tsx exemplos/foco/gerar.ts      (depois de exemplos/monstros/gerar.ts)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { T_FOTO as T, DUR_FOTO as DUR } from "../monstros/cena.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const HD = 1; // as imagens grandes (fundo, mesa) em 1x; o visor em 2x abaixo
const FPS = 30;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, z: number) => Math.min(z, Math.max(a, x));
const suave = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const fr = (t: number, a: number, z: number) => clamp((t - a) / (z - a), 0, 1);
const entre = (t: number, a: number, z: number) => suave(fr(t, a, z));
const back = (x: number, s = 1.7) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
const mix = (a: number, z: number, f: number) => a + (z - a) * f;
const W = 1280,
  H = 720;

// ---- imagens (SVG): o parque, o visor, os cantos do AF, o marcador, o balao, a mascara, a mesa
type Img = { nome: string; buf: Buffer; w: number; h: number; esc: number };
const imgs: Img[] = [];
async function svg(nome: string, w: number, h: number, corpo: string, esc = 2) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * esc}" height="${h * esc}" viewBox="0 0 ${w} ${h}">${corpo}</svg>`;
  imgs.push({ nome, buf: await sharp(Buffer.from(s)).png().toBuffer(), w, h, esc });
}
const FONTE = `font-family="Noto Sans, sans-serif"`;
// o parque: ceu, morros, arvores e grama (fica atras de tudo e desfoca junto com o grupo)
await svg(
  "parque",
  1400,
  800,
  `<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ec8f0"/><stop offset="1" stop-color="#d8f0ff"/></linearGradient></defs>
  <rect width="1400" height="800" fill="url(#c)"/>
  <circle cx="930" cy="190" r="55" fill="#fff6c8"/>
  <ellipse cx="300" cy="140" rx="90" ry="26" fill="#fff" opacity="0.9"/><ellipse cx="360" cy="120" rx="60" ry="30" fill="#fff" opacity="0.9"/>
  <ellipse cx="820" cy="100" rx="70" ry="20" fill="#fff" opacity="0.8"/>
  <path d="M0 470 Q200 360 420 450 T860 430 T1400 420 L1400 800 L0 800Z" fill="#8fd18a"/>
  <path d="M0 520 Q300 450 620 520 T1400 500 L1400 800 L0 800Z" fill="#6fbf6a"/>
  ${[120, 260, 1010, 1180, 1300].map((x, k) => `<rect x="${x - 9}" y="${420 - (k % 2) * 30}" width="18" height="90" fill="#8a5a3c"/><circle cx="${x}" cy="${400 - (k % 2) * 30}" r="${55 - (k % 3) * 8}" fill="#4fa84e"/>`).join("")}
  <rect y="560" width="1400" height="240" fill="#5aa955"/>
  ${Array.from({ length: 40 }, (_, k) => `<path d="M${k * 36 + 8} 800 l6 -26 l6 26z" fill="#4c9a48"/>`).join("")}`,
  HD,
);
// o visor: os quatro cantos, a cruz do centro, os dados da camera e a escala de foco
const cantos = (w: number, h: number, l: number, e: number, cor: string) =>
  [
    [0, 0, 1, 1],
    [w, 0, -1, 1],
    [0, h, 1, -1],
    [w, h, -1, -1],
  ]
    .map(([x, y, sx, sy]) => `<path d="M${x + sx * e / 2} ${y + sy * l} L${x + sx * e / 2} ${y + sy * e / 2} L${x + sx * l} ${y + sy * e / 2}" fill="none" stroke="${cor}" stroke-width="${e}" stroke-linecap="round"/>`)
    .join("");
await svg(
  "visor",
  W,
  H,
  `${cantos(W - 80, H - 80, 60, 6, "#fff").replace(/M(\d)/g, "M$1")}`.replace(/<path d="M/g, `<path transform="translate(40 40)" d="M`) +
    `<path d="M${W / 2 - 14} ${H / 2} h28 M${W / 2} ${H / 2 - 14} v28" stroke="#fff" stroke-width="2" opacity="0.8"/>
    <text x="70" y="88" ${FONTE} font-size="26" font-weight="700" fill="#fff">AF</text>
    <circle cx="140" cy="79" r="9" fill="#ff4d4d"/>
    <text x="${W - 70}" y="88" ${FONTE} font-size="22" font-weight="600" fill="#fff" text-anchor="end">F2.8   1/125   ISO 200</text>
    <rect x="${W - 140}" y="${H - 108}" width="56" height="26" rx="4" fill="none" stroke="#fff" stroke-width="3"/><rect x="${W - 84}" y="${H - 101}" width="6" height="12" fill="#fff"/><rect x="${W - 135}" y="${H - 103}" width="36" height="16" fill="#fff"/>
    <line x1="${W / 2 - 280}" y1="${H - 80}" x2="${W / 2 + 280}" y2="${H - 80}" stroke="#fff" stroke-width="3"/>
    ${Array.from({ length: 15 }, (_, k) => `<line x1="${W / 2 - 280 + k * 40}" y1="${H - 80}" x2="${W / 2 - 280 + k * 40}" y2="${H - 80 - (k % 2 ? 8 : 14)}" stroke="#fff" stroke-width="2"/>`).join("")}
    <text x="${W / 2 - 300}" y="${H - 74}" ${FONTE} font-size="18" fill="#fff" text-anchor="end">perto</text>
    <text x="${W / 2 + 300}" y="${H - 74}" ${FONTE} font-size="18" fill="#fff">longe</text>`,
  1.5,
);
await svg("af", 220, 220, cantos(220, 220, 40, 6, "#fff"));
await svg("marcador", 24, 22, `<path d="M12 22 L0 0 H24Z" fill="#ffd23c"/>`);
await svg(
  "balao",
  420,
  130,
  `<path d="M24 4 H396 a20 20 0 0 1 20 20 V82 a20 20 0 0 1 -20 20 H90 L40 126 L58 102 H24 a20 20 0 0 1 -20 -20 V24 a20 20 0 0 1 20 -20Z" fill="#fff" stroke="#1c1838" stroke-width="5"/>
  <text x="210" y="66" ${FONTE} font-size="34" font-weight="800" fill="#1c1838" text-anchor="middle">Ei! Sai da frente!</text>`,
);
// a mascara do desfoque da frente: uma elipse esfumada (o marrom de perto)
await svg("mascara", 400, 440, `<defs><radialGradient id="m"><stop offset="0.6" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><ellipse cx="200" cy="220" rx="200" ry="220" fill="url(#m)"/>`, 1);
// o rabisco na foto: o nome do marrom (Bagunca) e uma seta, a caneta vermelha
await svg("rabisco", 340, 90, `<text x="170" y="62" ${FONTE} font-size="56" font-weight="800" font-style="italic" fill="#e0262f" text-anchor="middle" transform="rotate(-6 170 45)">Bagunça!!</text>`);
await svg("seta", 200, 170, `<path d="M180 14 Q110 30 40 140" fill="none" stroke="#e0262f" stroke-width="9" stroke-linecap="round"/><path d="M22 112 L38 152 L76 132" fill="none" stroke="#e0262f" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
await svg("branco", 64, 64, `<rect width="64" height="64" fill="#fff"/>`, 1);
await svg("preto", 64, 64, `<rect width="64" height="64" fill="#000"/>`, 1);
// a Polaroid em cima da mesa: a mesa com um buraco do tamanho da foto, a borda branca e a legenda
{
  const MW = 3400,
    MH = 2400,
    bx = (MW - W) / 2,
    by = (MH - H) / 2;
  await svg(
    "polaroid",
    MW,
    MH,
    `<defs><pattern id="t" width="240" height="40" patternUnits="userSpaceOnUse"><rect width="240" height="40" fill="#8b5a36"/><path d="M0 20 Q60 12 120 20 T240 20" stroke="#7a4d2c" stroke-width="3" fill="none"/></pattern></defs>
    <path fill-rule="evenodd" d="M0 0 H${MW} V${MH} H0Z M${bx} ${by} h${W} v${H} h${-W}Z" fill="url(#t)"/>
    <path fill-rule="evenodd" d="M${bx - 44} ${by - 44} h${W + 88} v${H + 210} h${-(W + 88)}Z M${bx} ${by} h${W} v${H} h${-W}Z" fill="#000" opacity="0.25" transform="translate(14 18)"/>
    <path fill-rule="evenodd" d="M${bx - 44} ${by - 44} h${W + 88} v${H + 210} h${-(W + 88)}Z M${bx} ${by} h${W} v${H} h${-W}Z" fill="#fbfaf5"/>
    <text x="${MW / 2}" y="${by + H + 110}" ${FONTE} font-size="64" font-style="italic" fill="#3a3a48" text-anchor="middle">a turma toda</text>`,
    1,
  );
}

// pagina: prateleiras (a mesa e grande: fica sozinha numa pagina)
const paginas: any[] = [];
const imagens: any[] = [];
let pg = -1,
  px = 0,
  py = 0,
  alt = 0,
  comp: sharp.OverlayOptions[] = [];
const fecha = async () => {
  if (pg < 0) return;
  const arq = `foco${pg ? `_${pg + 1}` : ""}.png`;
  await sharp({ create: { width: 2048, height: py + alt, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).png().toFile(join(AQUI, arq));
  paginas.push({ arquivo: arq, tamanho: [2048, py + alt] });
};
for (const im of imgs.filter((i) => i.nome !== "polaroid").sort((a, b) => b.h * b.esc - a.h * a.esc)) {
  const { width, height } = await sharp(im.buf).metadata();
  if (pg < 0 || px + width! > 2048) {
    if (pg < 0 || py + alt + height! > 2048) {
      await fecha();
      [pg, px, py, alt, comp] = [pg + 1, 0, 0, 0, []];
    } else [px, py, alt] = [0, py + alt + 4, 0];
  }
  imagens.push({ nome: im.nome, pagina: pg, ret: [px, py, width!, height!] });
  comp.push({ input: im.buf, left: px, top: py });
  px += width! + 4;
  alt = Math.max(alt, height!);
}
await fecha();
{
  // a mesa: reduzida pela metade (so a madeira e a borda; a foto e o buraco)
  const im = imgs.find((i) => i.nome === "polaroid")!;
  const meia = await sharp(im.buf).resize(Math.round(im.w / 2), Math.round(im.h / 2)).png().toBuffer();
  await sharp(meia).toFile(join(AQUI, "foco_mesa.png"));
  paginas.push({ arquivo: "foco_mesa.png", tamanho: [im.w / 2, im.h / 2] });
  imagens.push({ nome: "polaroid", pagina: paginas.length - 1, ret: [0, 0, im.w / 2, im.h / 2] });
}
const tam = (n: string) => imgs.find((i) => i.nome === n)!;

// ---- esqueleto
const CARETA = { x: 330, y: -470 }; // o marrom de perto: a raiz dele (os pes) bem abaixo do quadro
const AF_GRUPO = { x: 0, y: -100, s: 1.15 },
  AF_MARROM = { x: 300, y: 120, s: 1.6 };
const ossos: any[] = [
  { nome: "root" },
  { nome: "foto", pai: "root" },
  { nome: "grupo", pai: "foto", y: -300 },
  { nome: "careta", pai: "foto", x: CARETA.x, y: CARETA.y },
  { nome: "visor", pai: "root" },
  { nome: "af", pai: "visor", x: AF_GRUPO.x, y: AF_GRUPO.y },
  { nome: "marcador", pai: "visor", x: -280, y: -360 + 80 + 16 },
  { nome: "balao", pai: "root", x: -380, y: -200 },
  // o rabisco e a seta ficam na foto (escalam com a Polaroid); a seta aponta o rosto do marrom
  // no flash, medido no nucleo em (307, -127)
  { nome: "rabisco", pai: "foto", x: 470, y: 120 },
  { nome: "seta", pai: "foto", x: 400, y: 10 },
];
const slots: any[] = [
  { nome: "parque", osso: "foto", parte: "parque" },
  { nome: "desfoque_longe", osso: "foto" },
  { nome: "grupo", osso: "grupo" },
  { nome: "desfoque_fundo", osso: "foto" },
  { nome: "careta", osso: "careta" },
  { nome: "desfoque_frente", osso: "careta", parte: "mascara" },
  { nome: "revela", osso: "foto", cor: "ffffff00" },
  { nome: "polaroid", osso: "foto", parte: "polaroid", cor: "ffffff00" },
  { nome: "seta", osso: "seta", parte: "seta", cor: "ffffff00" },
  { nome: "rabisco", osso: "rabisco", parte: "rabisco", cor: "ffffff00" },
  { nome: "visor", osso: "visor", parte: "visor" },
  { nome: "af", osso: "af", parte: "af" },
  { nome: "marcador", osso: "marcador", parte: "marcador" },
  { nome: "balao", osso: "balao", parte: "balao", cor: "ffffff00" },
  { nome: "flash", osso: "root", parte: "branco", cor: "ffffff00" },
  { nome: "preto", osso: "root", parte: "preto" },
];
const t2 = (n: string) => ({ largura: tam(n).w, altura: tam(n).h });
const partes: Record<string, any> = {
  parque: { parque: t2("parque") },
  // a elipse cobre tambem os bracos abertos (a mascara nao segue a forma do marrom)
  desfoque_frente: { mascara: { y: 2.6 * 150, largura: 2.6 * 420, altura: 2.6 * 320 } },
  polaroid: { polaroid: t2("polaroid") },
  seta: { seta: t2("seta") },
  rabisco: { rabisco: t2("rabisco") },
  visor: { visor: t2("visor") },
  af: { af: t2("af") },
  marcador: { marcador: t2("marcador") },
  balao: { balao: t2("balao") },
  flash: { branco: { largura: W + 40, altura: H + 40 } },
  preto: { preto: { largura: W + 40, altura: H + 40 } },
};
const instancias = [
  { nome: "grupo", slot: "grupo", boneco: "../monstros/monstros.boneco", animacao: "foto_grupo", repetir: false, escala_x: 0.72, escala_y: 0.72 },
  { nome: "careta", slot: "careta", boneco: "../monstros/monstros.boneco", animacao: "foto_careta", repetir: false, escala_x: 2.6, escala_y: 2.6 },
];

// ---- a animacao, amostrada
const ossosA: Record<string, Record<string, any[]>> = {};
const slotsA: Record<string, any> = {};
const poe = (o: string, tl: string, k: any) => ((ossosA[o] ??= {})[tl] ??= []).push(k);
const cor = (s: string, t: number, rgb: string, a: number) => ((slotsA[s] ??= {}).rgba ??= []).push({ tempo: t, cor: rgb + Math.round(255 * clamp(a, 0, 1)).toString(16).padStart(2, "0") });
// o foco: uma distancia de 0 (perto) a 1 (longe) que a lente percorre, passando um pouco do
// ponto e voltando (o AF cacando); cada plano tem a profundidade dele e o desfoque sai da
// distancia entre ele e o foco
const Z = { longe: 1, grupo: 0.72, marrom: 0.17 };
const K = 20; // px de desfoque por unidade de distancia fora do foco
const CHAVES: [number, number][] = [
  [0, 0],
  [T.foco, 0],
  [T.foco + 0.65, 0.84],
  [T.foco + 1.0, Z.grupo],
  [T.entra + 0.45, Z.grupo],
  [T.entra + 0.85, 0.08],
  [T.entra + 1.05, Z.marrom],
  [T.volta, Z.marrom],
  [T.volta + 0.45, 0.82],
  [T.volta + 0.7, Z.grupo],
  [DUR, Z.grupo],
];
const foco = (t: number) => {
  for (let k = 0; k + 1 < CHAVES.length; k++) if (t <= CHAVES[k + 1][0]) return mix(CHAVES[k][1], CHAVES[k + 1][1], suave(fr(t, CHAVES[k][0], CHAVES[k + 1][0])));
  return CHAVES.at(-1)![1];
};
const fora = (t: number, z: number) => K * Math.abs(foco(t) - z);
// os ajustes se empilham: o do grupo desfoca tambem o parque, entao o do parque so completa
// (no minimo 0,01: com todos os valores no padrao o ajuste desliga e o slot desenharia a
// propria imagem)
const fundo = (t: number) => Math.max(0.01, fora(t, Z.grupo));
const longe = (t: number) => Math.max(0.01, fora(t, Z.longe) - fora(t, Z.grupo));
const frente = (t: number) => Math.max(0.01, fora(t, Z.marrom));
// o AF caca o foco (pulsa) e fica verde quando acerta
const acerto = [T.foco + 1.0, T.entra + 1.05, T.volta + 0.7];
const N = Math.round(DUR * FPS);
const efeitosRev: Record<string, any[]> = {};
for (let q = 0; q <= N; q++) {
  const t = r3(q / FPS);
  // a camera: o tremor da bronca e a Polaroid depois do flash
  const treme = entre(t, T.bronca + 0.1, T.bronca + 0.15) * (1 - entre(t, T.bronca + 0.35, T.bronca + 0.45));
  const pol = back(fr(t, T.flash + 0.15, T.flash + 0.85), 1.2);
  // depois de revelar, a camera se aproxima da foto, levando o marrom para perto do meio
  const perto = suave(fr(t, T.flash + 2.0, T.flash + 3.7));
  const esc = mix(1, 0.62, pol) * mix(1, 1.45, perto);
  const giroF = -5 * back(fr(t, T.flash + 0.15, T.flash + 0.95), 2.4);
  const [mx, my] = [307, -127];
  const c = Math.cos((giroF * Math.PI) / 180),
    sn = Math.sin((giroF * Math.PI) / 180);
  const leva = 0.75 * perto;
  poe("foto", "mover", { tempo: t, x: r3(9 * treme * Math.sin(t * 90) - leva * esc * (c * mx - sn * my)), y: r3(6 * treme * Math.cos(t * 70) + 30 * pol * (1 - perto) - leva * esc * (sn * mx + c * my)) });
  poe("foto", "escalar", { tempo: t, x: r3(esc), y: r3(esc) });
  // o rabisco: a seta risca primeiro, depois o nome
  const riscaSeta = fr(t, T.flash + 2.3, T.flash + 2.5),
    riscaNome = back(fr(t, T.flash + 2.45, T.flash + 2.7), 2);
  cor("seta", t, "ffffff", riscaSeta);
  poe("seta", "escalar", { tempo: t, x: r3(mix(0.6, 1, riscaSeta)), y: r3(mix(0.6, 1, riscaSeta)) });
  cor("rabisco", t, "ffffff", fr(t, T.flash + 2.45, T.flash + 2.55));
  poe("rabisco", "escalar", { tempo: t, x: r3(riscaNome), y: r3(riscaNome) });
  poe("foto", "girar", { tempo: t, valor: r3(giroF) });
  // a foto revelando (o ajuste fica embaixo da moldura: so mexe na foto)
  const rev = suave(fr(t, T.flash + 0.5, T.flash + 2.1));
  ((efeitosRev.ajuste ??= []) as any[]).push(t >= T.flash ? { tempo: t, saturacao: r3(mix(0.1, 1, rev)), luminosidade: r3(mix(0.32, 0, rev)), contraste: r3(mix(0.7, 1, rev)), desfoque: 0.01 } : { tempo: t, desfoque: 0.01 });
  cor("revela", t, "ffffff", t >= T.flash ? 1 : 0);
  // o marrom de perto: sobe pela direita, fica, e sai por baixo
  // espia pela borda direita (so a cara e as antenas), espera um instante e pula para o meio
  const espia = suave(fr(t, T.entra - 0.1, T.entra + 0.2)),
    pula = back(fr(t, T.entra + 0.4, T.entra + 0.62), 2.2),
    sai = suave(fr(t, T.bronca + 0.4, T.bronca + 0.8));
  const cx = mix(mix(560, 330, espia), 0, pula) + 320 * sai,
    cy = mix(mix(-140, -60, espia), 0, pula) - 520 * sai + 10 * Math.sin(t * 9) * espia * (1 - pula);
  poe("careta", "mover", { tempo: t, x: r3(cx), y: r3(cy) });
  poe("careta", "girar", { tempo: t, valor: r3(12 * espia * (1 - pula)) });
  // o marrom de perto e o desfoque dele so existem enquanto ele esta na frente da lente
  cor("careta", t, "ffffff", t > T.entra - 0.05 && t < T.volta + 0.3 ? 1 : 0);
  cor("desfoque_frente", t, "ffffff", t > T.entra - 0.05 && t < T.volta + 0.3 ? 1 : 0);
  // o AF: no grupo, depois no marrom, depois no grupo; pulsa enquanto caca o foco
  const noMarrom = entre(t, T.entra + 0.45, T.entra + 0.85) - entre(t, T.volta, T.volta + 0.45);
  const caca = acerto.some((a) => t > a - 0.9 && t < a) ? 0.06 * Math.sin(t * 40) : 0;
  poe("af", "mover", { tempo: t, x: r3(mix(AF_GRUPO.x, AF_MARROM.x, noMarrom) - AF_GRUPO.x), y: r3(mix(AF_GRUPO.y, AF_MARROM.y, noMarrom) - AF_GRUPO.y) });
  const sAf = mix(AF_GRUPO.s, AF_MARROM.s, noMarrom) * (1 + caca);
  poe("af", "escalar", { tempo: t, x: r3(sAf), y: r3(sAf) });
  const verde = acerto.some((a) => t >= a && t < a + 0.6) || (t > T.xis && t < T.flash);
  const visorA = 1 - fr(t, T.flash, T.flash + 0.05);
  cor("af", t, verde ? "7dff6a" : "ffffff", visorA);
  cor("visor", t, "ffffff", visorA);
  cor("marcador", t, "ffffff", visorA);
  poe("marcador", "mover", { tempo: t, x: r3(560 * foco(t)), y: 0 });
  // o balao da bronca
  const bal = t > T.bronca && t < T.volta + 0.25;
  poe("balao", "escalar", { tempo: t, x: r3(bal ? back(fr(t, T.bronca, T.bronca + 0.25), 2) : 0), y: r3(bal ? back(fr(t, T.bronca, T.bronca + 0.25), 2) : 0) });
  cor("balao", t, "ffffff", bal ? 1 - fr(t, T.volta, T.volta + 0.25) : 0);
  // o flash e a Polaroid
  cor("flash", t, "ffffff", t >= T.flash ? 1 - fr(t, T.flash + 0.05, T.flash + 0.5) : 0);
  cor("polaroid", t, "ffffff", t >= T.flash ? 1 : 0);
  // abre do preto e fecha no preto (o laco)
  const obturador = t >= T.flash - 0.07 && t < T.flash ? 1 : 0;
  cor("preto", t, "000000", Math.max(1 - fr(t, 0, 0.35), fr(t, DUR - 0.4, DUR), obturador));
}
const efeitos = {
  desfoque_longe: { ajuste: Array.from({ length: N + 1 }, (_, q) => ({ tempo: r3(q / FPS), desfoque: r3(longe(q / FPS)) })) },
  desfoque_fundo: { ajuste: Array.from({ length: N + 1 }, (_, q) => ({ tempo: r3(q / FPS), desfoque: r3(fundo(q / FPS)) })) },
  revela: efeitosRev,
  desfoque_frente: { ajuste: Array.from({ length: N + 1 }, (_, q) => ({ tempo: r3(q / FPS), desfoque: r3(frente(q / FPS)) })) },
};
// os monstros congelam no flash (a foto)
const inst = {
  grupo: [{ tempo: 0, animacao: "foto_grupo", inicio: 0, repetir: false }, { tempo: T.flash, inicio: T.flash, velocidade: 0 }],
  careta: [{ tempo: 0, animacao: "foto_careta", inicio: 0, repetir: false }],
};

const b = {
  boneco: 0,
  nome: "foco",
  paginas,
  imagens,
  esqueleto: { versao_spine: "4.3.23", x: -W / 2, y: -H / 2, largura: W, altura: H },
  ossos,
  slots,
  skins: [{ nome: "default", partes }],
  instancias,
  animacoes: { foto: { ossos: ossosA, slots: slotsA, efeitos, instancias: inst } },
};
writeFileSync(join(AQUI, "foco.boneco"), JSON.stringify(b, null, 1) + "\n");
console.log(`foco.boneco: ${slots.length} slots, ${imagens.length} imagens em ${paginas.length} paginas, ${DUR} s`);
