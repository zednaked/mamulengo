// "A foto da turma": o VT de 26 s (mais a abertura e o fechamento do Mamulengo, tools/vinheta.ts,
// perto de 30 s) com os monstros de exemplos/monstros e a cena do fotografo (exemplos/foco).
// Animacao "vt", em quatro planos:
//
//   A  0,0-5,5    plano aberto no parque: a turma chega (Tres-Olhos aos pulinhos, Ciclope caindo
//                 do alto, Gargalhada deslizando, Bagunca rolando e trombando), o Clique chama
//                 "Foto da turma!", ergue a camera e a imagem mergulha na lente
//   B  5,5-16,0   pelo visor: a cena do fotografo inteira (instancia de exemplos/foco)
//   C  16,0-20,75 de volta ao parque: o Clique mostra a foto, a turma reage, o Bagunca rouba a
//                 camera, junta todo mundo numa selfie e dispara
//   D  20,75-26,0 na mesa: a selfie cai por cima da primeira foto, revela, e a caneta escreve
//                 "de novo!!" no Bagunca
//
//   npx tsx exemplos/vt/gerar.ts      (depois de exemplos/monstros e exemplos/foco)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { T_VT as V } from "../monstros/cena.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const DUR = 26;
const B0 = 5.5, // o visor
  C0 = 16.0, // de volta ao parque
  D0 = 20.75; // a mesa
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, z: number) => Math.min(z, Math.max(a, x));
const suave = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const fr = (t: number, a: number, z: number) => clamp((t - a) / (z - a), 0, 1);
const entre = (t: number, a: number, z: number) => suave(fr(t, a, z));
const back = (x: number, s = 1.7) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
const inn = (x: number) => x * x * x;
const mix = (a: number, z: number, f: number) => a + (z - a) * f;
const W = 1280,
  H = 720;

// ---- imagens
type Img = { nome: string; buf: Buffer; w: number; h: number };
const imgs: Img[] = [];
async function svg(nome: string, w: number, h: number, corpo: string, esc = 2) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * esc)}" height="${Math.round(h * esc)}" viewBox="0 0 ${w} ${h}">${corpo}</svg>`;
  imgs.push({ nome, buf: await sharp(Buffer.from(s)).png().toBuffer(), w, h });
}
const FONTE = `font-family="Noto Sans, sans-serif"`;
// o parque (o mesmo da cena do fotografo)
const PARQUE = `<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ec8f0"/><stop offset="1" stop-color="#d8f0ff"/></linearGradient></defs>
  <rect width="1400" height="800" fill="url(#c)"/>
  <circle cx="930" cy="190" r="55" fill="#fff6c8"/>
  <ellipse cx="300" cy="140" rx="90" ry="26" fill="#fff" opacity="0.9"/><ellipse cx="360" cy="120" rx="60" ry="30" fill="#fff" opacity="0.9"/>
  <ellipse cx="820" cy="100" rx="70" ry="20" fill="#fff" opacity="0.8"/>
  <path d="M0 470 Q200 360 420 450 T860 430 T1400 420 L1400 800 L0 800Z" fill="#8fd18a"/>
  <path d="M0 520 Q300 450 620 520 T1400 500 L1400 800 L0 800Z" fill="#6fbf6a"/>
  ${[120, 260, 1010, 1180, 1300].map((x, k) => `<rect x="${x - 9}" y="${420 - (k % 2) * 30}" width="18" height="90" fill="#8a5a3c"/><circle cx="${x}" cy="${400 - (k % 2) * 30}" r="${55 - (k % 3) * 8}" fill="#4fa84e"/>`).join("")}
  <rect y="560" width="1400" height="240" fill="#5aa955"/>
  ${Array.from({ length: 40 }, (_, k) => `<path d="M${k * 36 + 8} 800 l6 -26 l6 26z" fill="#4c9a48"/>`).join("")}`;
await svg("parque", 1400, 800, PARQUE, 1);
const balao = (nome: string, texto: string, w: number, cauda: "esq" | "dir") =>
  svg(
    nome,
    w,
    120,
    `<path d="M22 4 H${w - 22} a18 18 0 0 1 18 18 V74 a18 18 0 0 1 -18 18 H${cauda === "esq" ? 80 : w - 50} L${cauda === "esq" ? 34 : w - 26} 116 L${cauda === "esq" ? 52 : w - 76} 92 H22 a18 18 0 0 1 -18 -18 V22 a18 18 0 0 1 18 -18Z" fill="#fff" stroke="#1c1838" stroke-width="5"/>
  <text x="${w / 2}" y="62" ${FONTE} font-size="34" font-weight="800" fill="#1c1838" text-anchor="middle">${texto}</text>`,
  );
await balao("b_foto", "Foto da turma!", 330, "esq");
await balao("b_camera", "Ei! Minha câmera!", 380, "esq");
await balao("b_xis", "Xiiis!", 190, "dir");
// a Polaroid da selfie: a borda branca com o buraco da foto e a legenda; a mascara do revelar (o
// buraco); a mesa por baixo de tudo
await svg(
  "moldura",
  W + 88,
  H + 254,
  `<path fill-rule="evenodd" d="M0 0 h${W + 88} v${H + 254} h${-(W + 88)}Z M44 44 h${W} v${H} h${-W}Z" fill="#fbfaf5"/>
  <text x="${(W + 88) / 2}" y="${H + 44 + 140}" ${FONTE} font-size="64" font-style="italic" fill="#3a3a48" text-anchor="middle">a turma toda (de novo)</text>`,
  1,
);
await svg("sombra", W + 88, H + 254, `<rect width="${W + 88}" height="${H + 254}" rx="6" fill="#000" opacity="0.3"/>`, 0.25);
await svg("janela", 64, 64, `<rect width="64" height="64" fill="#fff"/>`, 1);
await svg("rabisco", 340, 90, `<text x="170" y="62" ${FONTE} font-size="56" font-weight="800" font-style="italic" fill="#e0262f" text-anchor="middle" transform="rotate(-6 170 45)">de novo!!</text>`);
await svg("seta", 300, 380, `<path d="M270 14 Q180 60 40 350" fill="none" stroke="#e0262f" stroke-width="10" stroke-linecap="round"/><path d="M80 326 L40 352 L36 302" fill="none" stroke="#e0262f" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`);
// a vinheta de lente (bordas escuras) e as cortinas de cor
await svg("lente", 640, 360, `<defs><radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs><rect width="640" height="360" fill="url(#v)"/>`, 1);
await svg("branco", 64, 64, `<rect width="64" height="64" fill="#fff"/>`, 1);
await svg("preto", 64, 64, `<rect width="64" height="64" fill="#000"/>`, 1);

// pagina(s)
const paginas: any[] = [];
const imagens: any[] = [];
{
  let pg = -1,
    px = 0,
    py = 0,
    alt = 0,
    comp: sharp.OverlayOptions[] = [];
  const fecha = async () => {
    if (pg < 0) return;
    const arq = `vt${pg ? `_${pg + 1}` : ""}.png`;
    await sharp({ create: { width: 2048, height: py + alt, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).png().toFile(join(AQUI, arq));
    paginas.push({ arquivo: arq, tamanho: [2048, py + alt] });
  };
  for (const im of [...imgs].sort((a, b) => b.buf.length - a.buf.length)) {
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
}
const tam = (n: string) => imgs.find((i) => i.nome === n)!;
const t2 = (n: string, extra: any = {}) => ({ [n]: { largura: tam(n).w, altura: tam(n).h, ...extra } });

// ---- esqueleto
const GRUPO = { x: 150, y: -330, s: 0.62 },
  CLIQUE = { x: -390, y: -470, s: 1.25 };
// a camera do Clique na tela (para o mergulho na lente), aproximada
const LENTE = { x: -500, y: -35 };
const P2 = { x: 40, y: 10, s: 0.5, giro: 6 }; // a selfie em cima da mesa
const ossos: any[] = [
  { nome: "root" },
  { nome: "cena", pai: "root" },
  { nome: "grupo", pai: "cena", x: GRUPO.x, y: GRUPO.y },
  { nome: "clique", pai: "cena", x: CLIQUE.x, y: CLIQUE.y },
  { nome: "b_foto", pai: "cena", x: -250, y: 60 },
  { nome: "b_camera", pai: "cena", x: -250, y: 60 },
  { nome: "b_xis", pai: "cena", x: 280, y: 90 },
  { nome: "visor", pai: "root" },
  { nome: "mesa", pai: "root" },
  { nome: "p2", pai: "mesa", x: P2.x, y: P2.y, escala_x: P2.s, escala_y: P2.s, rotacao: P2.giro },
  { nome: "p2_grupo", pai: "p2", x: 0, y: -545 },
  { nome: "seta", pai: "p2", x: 270, y: 50 },
  { nome: "rabisco", pai: "p2", x: 420, y: 300 },
];
const slots: any[] = [
  // A e C: o parque (com o fundo levemente desfocado), a turma e o Clique na frente
  { nome: "parque", osso: "cena", parte: "parque" },
  { nome: "desfoque_parque", osso: "cena" },
  { nome: "grupo", osso: "grupo" },
  { nome: "clique", osso: "clique" },
  { nome: "b_foto", osso: "b_foto", parte: "b_foto", cor: "ffffff00" },
  { nome: "b_camera", osso: "b_camera", parte: "b_camera", cor: "ffffff00" },
  { nome: "b_xis", osso: "b_xis", parte: "b_xis", cor: "ffffff00" },
  // B: o visor (a cena do fotografo inteira)
  { nome: "visor", osso: "visor", cor: "ffffff00" },
  // D: a mesa e a primeira foto (a cena do fotografo no fim, congelada) e a selfie por cima
  { nome: "mesa", osso: "mesa", cor: "ffffff00" },
  { nome: "p2_sombra", osso: "p2", parte: "sombra", cor: "ffffff00" },
  { nome: "p2_parque", osso: "p2", parte: "parque", cor: "ffffff00" },
  { nome: "p2_grupo", osso: "p2_grupo", cor: "ffffff00" },
  { nome: "p2_revela", osso: "p2", parte: "janela", cor: "ffffff00" },
  { nome: "p2_moldura", osso: "p2", parte: "moldura", cor: "ffffff00" },
  { nome: "seta", osso: "seta", parte: "seta", cor: "ffffff00" },
  { nome: "rabisco", osso: "rabisco", parte: "rabisco", cor: "ffffff00" },
  // acabamento: a lente escurece as bordas; o flash e o preto por cima de tudo
  { nome: "lente", osso: "root", parte: "lente" },
  { nome: "flash", osso: "root", parte: "branco", cor: "ffffff00" },
  { nome: "preto", osso: "root", parte: "preto" },
];
const partes: Record<string, any> = {
  parque: t2("parque"),
  b_foto: t2("b_foto"),
  b_camera: t2("b_camera"),
  b_xis: t2("b_xis"),
  p2_sombra: { sombra: { x: 22, y: -26 - 105, largura: W + 88, altura: H + 254 } },
  p2_parque: { parque: { largura: W, altura: H } },
  p2_revela: { janela: { largura: W, altura: H } },
  // a moldura: o buraco (W x H) centrado no osso; a legenda embaixo
  p2_moldura: { moldura: { y: -105, largura: W + 88, altura: H + 254 } },
  seta: t2("seta"),
  rabisco: t2("rabisco"),
  lente: { lente: { largura: W + 40, altura: H + 40 } },
  flash: { branco: { largura: W + 40, altura: H + 40 } },
  preto: { preto: { largura: W + 40, altura: H + 40 } },
};
const instancias = [
  { nome: "grupo", slot: "grupo", boneco: "../monstros/monstros.boneco", animacao: "vt_grupo", repetir: false, escala_x: GRUPO.s, escala_y: GRUPO.s },
  { nome: "clique", slot: "clique", boneco: "../monstros/monstros.boneco", animacao: "vt_clique", repetir: false, escala_x: CLIQUE.s, escala_y: CLIQUE.s },
  { nome: "visor", slot: "visor", boneco: "../foco/foco.boneco", animacao: "foto", repetir: false },
  // a primeira foto na mesa: a cena do fotografo parada com a Polaroid e o "Bagunca!!"
  { nome: "mesa", slot: "mesa", boneco: "../foco/foco.boneco", animacao: "foto", repetir: false, inicio: 9.0, velocidade: 0 },
  { nome: "p2_grupo", slot: "p2_grupo", boneco: "../monstros/monstros.boneco", animacao: "vt_selfie", repetir: false, escala_x: 1.65, escala_y: 1.65 },
];

// ---- a animacao, amostrada
const ossosA: Record<string, Record<string, any[]>> = {};
const slotsA: Record<string, any> = {};
const efeitos: Record<string, any> = { desfoque_parque: { ajuste: [{ tempo: 0, desfoque: 3 }] }, p2_revela: { ajuste: [] as any[] } };
const poe = (o: string, tl: string, k: any) => ((ossosA[o] ??= {})[tl] ??= []).push(k);
const cor = (s: string, t: number, a: number, rgb = "ffffff") => ((slotsA[s] ??= {}).rgba ??= []).push({ tempo: t, cor: rgb + Math.round(255 * clamp(a, 0, 1)).toString(16).padStart(2, "0") });
const N = Math.round(DUR * FPS);
for (let q = 0; q <= N; q++) {
  const t = r3(q / FPS);
  const emA = t < B0,
    emB = t >= B0 && t < C0,
    emC = t >= C0 && t < D0,
    emD = t >= D0;
  // ---- o plano aberto: um leve travelling para a direita em A; o mergulho na lente no fim de A
  const mergulho = inn(fr(t, V.mergulho, B0));
  const escC = emA ? mix(1.04, 1, entre(t, 0, 3)) * mix(1, 7, mergulho) : mix(1.06, 1, entre(t, C0, C0 + 2.5));
  const alvoX = emA ? mix(20, 0, entre(t, 0, 3)) : 0;
  poe("cena", "escalar", { tempo: t, x: r3(escC), y: r3(escC) });
  // o mergulho e um zoom em volta da lente: o ponto da lente fica parado na tela
  // (desloca -L (s - 1) com a escala inteira do mergulho); o tremor das aterrissagens
  const sMerg = mix(1, 7, mergulho);
  const treme = (a: number) => (t > a && t < a + 0.3 ? Math.exp(-(t - a) * 14) * Math.sin((t - a) * 70) : 0);
  const tr = 9 * treme(1.25) + 6 * treme(2.45);
  poe("cena", "mover", { tempo: t, x: r3(emA ? alvoX - LENTE.x * (sMerg - 1) * escC : 0), y: r3((emA ? -LENTE.y * (sMerg - 1) * escC : 0) + tr) });
  const aberto = emA || emC ? 1 : 0;
  for (const s of ["parque", "grupo", "clique"]) cor(s, t, aberto);
  // o Clique entra na selfie: anda para a direita e para tras (encolhe para a escala da turma)
  const junta = entre(t, V.selfie, V.selfie + 0.5);
  poe("clique", "mover", { tempo: t, x: r3(300 * junta), y: r3(150 * junta) });
  poe("clique", "escalar", { tempo: t, x: r3(mix(1, 0.62, junta)), y: r3(mix(1, 0.62, junta)) });
  // os baloes
  const bal = (nome: string, a: number, z: number) => {
    const vis = t >= a && t < z;
    const s = vis ? back(fr(t, a, a + 0.22), 2) * (1 - entre(t, z - 0.15, z)) : 0;
    poe(nome, "escalar", { tempo: t, x: r3(s), y: r3(s) });
    cor(nome, t, vis ? 1 : 0);
  };
  bal("b_foto", V.chama, V.chama + 1.1);
  bal("b_camera", V.rouba + 0.15, V.selfie + 0.1);
  bal("b_xis", V.flash - 0.75, V.flash);
  // ---- o visor
  cor("visor", t, emB ? 1 : 0);
  // ---- a mesa: a primeira foto parada; a selfie cai por cima girando, assenta e revela
  cor("mesa", t, emD ? 1 : 0);
  const cai = back(fr(t, D0 + 0.15, D0 + 0.85), 1.6);
  const p2 = emD && t >= D0 + 0.15;
  poe("p2", "escalar", { tempo: t, x: r3(mix(1.6, 1, cai)), y: r3(mix(1.6, 1, cai)) });
  poe("p2", "girar", { tempo: t, valor: r3(mix(-14, 0, cai)) });
  poe("p2", "mover", { tempo: t, x: r3(mix(-60, 0, cai)), y: r3(mix(160, 0, cai)) });
  for (const s of ["p2_sombra", "p2_parque", "p2_grupo", "p2_moldura"]) cor(s, t, p2 ? 1 : 0);
  // a selfie revelando: o ajuste mascarado pela janela (so a foto, nao a mesa nem a outra foto)
  const rev = entre(t, D0 + 0.9, D0 + 2.6);
  cor("p2_revela", t, p2 ? 1 : 0);
  efeitos.p2_revela.ajuste.push({ tempo: t, saturacao: r3(mix(0.1, 1, rev)), luminosidade: r3(mix(0.32, 0, rev)), contraste: r3(mix(0.7, 1, rev)), desfoque: 0.01 });
  // a caneta: a seta e o "de novo!!"
  const riscaSeta = fr(t, D0 + 2.9, D0 + 3.1),
    riscaNome = back(fr(t, D0 + 3.05, D0 + 3.3), 2);
  cor("seta", t, emD ? riscaSeta : 0);
  poe("seta", "escalar", { tempo: t, x: r3(mix(0.6, 1, riscaSeta)), y: r3(mix(0.6, 1, riscaSeta)) });
  cor("rabisco", t, emD ? fr(t, D0 + 3.05, D0 + 3.15) : 0);
  poe("rabisco", "escalar", { tempo: t, x: r3(riscaNome), y: r3(riscaNome) });
  // a mesa se aproxima devagar no fim
  const perto = entre(t, D0 + 2.6, DUR);
  poe("mesa", "escalar", { tempo: t, x: r3(mix(1, 1.18, perto)), y: r3(mix(1, 1.18, perto)) });
  poe("mesa", "mover", { tempo: t, x: r3(-60 * perto), y: r3(-20 * perto) });
  // ---- o flash da selfie, e o preto: abre, a passagem para o visor (que abre do preto dele), a
  // volta do visor (que fecha no preto dele) e o fim
  cor("flash", t, t >= V.flash && t < D0 + 0.4 ? 1 - fr(t, D0 - 0.05, D0 + 0.4) : 0);
  const obturador = t >= V.flash - 0.07 && t < V.flash ? 1 : 0;
  const corte = t >= B0 - 0.12 && t < B0 ? fr(t, B0 - 0.12, B0) : 0;
  const preto = Math.max(1 - fr(t, 0, 0.4), corte, t >= C0 ? 1 - fr(t, C0, C0 + 0.35) : 0, fr(t, DUR - 0.45, DUR), obturador);
  cor("preto", t, preto, "000000");
  // a lente so nos planos de camera "real" (o visor tem a moldura dele)
  cor("lente", t, emB ? 0 : 1);
}
const inst = {
  grupo: [{ tempo: 0, animacao: "vt_grupo", inicio: 0, repetir: false }],
  clique: [{ tempo: 0, animacao: "vt_clique", inicio: 0, repetir: false }],
  visor: [{ tempo: B0, animacao: "foto", inicio: 0, repetir: false }],
};

const b = {
  boneco: 0,
  nome: "vt",
  paginas,
  imagens,
  esqueleto: { versao_spine: "4.3.23", x: -W / 2, y: -H / 2, largura: W, altura: H },
  ossos,
  slots,
  skins: [{ nome: "default", partes }],
  instancias,
  animacoes: { vt: { ossos: ossosA, slots: slotsA, efeitos, instancias: inst } },
};
writeFileSync(join(AQUI, "vt.boneco"), JSON.stringify(b, null, 1) + "\n");
console.log(`vt.boneco: ${slots.length} slots, ${instancias.length} instancias, ${imagens.length} imagens em ${paginas.length} paginas, ${DUR} s`);
