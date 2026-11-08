// Os monstros: os cinco da amostra do Monster Builder Pack da Kenney (CC0), montados peca por peca
// (corpo, bracos, pernas, olhos, boca e detalhes) e rigados aqui. Pernas com IK ate um alvo no
// chao, bracos e pernas em malha dobrando entre dois ossos.
//
//   npx tsx exemplos/monstros/gerar.ts      (escreve exemplos/monstros/monstros.boneco)
//
// As pecas estao em fontes/ (PNG em 2x do pacote; License.txt); no mundo cada peca tem o tamanho
// do PNG normal (metade do 2x).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { exportarSpine, importarSpine } from "../../src/boneco/spine.ts";
import { parseAtlas } from "../../src/core/atlas-text.ts";
import { Document } from "../../src/core/document.ts";
import { executeAsync, type AssetProvider } from "../../src/core/commands/index.ts";
import { extractRegion } from "../../server/atlas.ts";
import { porEfeito } from "../../server/efeitos.ts";
import { cena, DUR } from "./cena.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTES = join(AQUI, "fontes");
const HD = 2; // pixels da textura por pixel do mundo
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const GRAUS = 180 / Math.PI;

// ---- objetos desenhados aqui (PNG em 2x em fontes/, como as pecas da Kenney)
{
  const camera = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="150" viewBox="0 0 110 75">
    <rect x="22" y="4" width="26" height="12" rx="3" fill="#3a3a48"/>
    <rect x="4" y="12" width="102" height="58" rx="10" fill="#4a4a5c"/>
    <rect x="4" y="12" width="102" height="16" rx="8" fill="#5c5c70"/>
    <rect x="82" y="17" width="16" height="9" rx="2" fill="#fff6c8"/>
    <circle cx="55" cy="44" r="23" fill="#2a2a36"/><circle cx="55" cy="44" r="17" fill="#3b6ea8"/>
    <circle cx="55" cy="44" r="9" fill="#14141c"/><circle cx="49" cy="38" r="4" fill="#ffffff" opacity="0.7"/>
    <circle cx="14" cy="22" r="3" fill="#ff4d4d"/></svg>`;
  const foto = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="160" viewBox="0 0 70 80">
    <rect x="2" y="2" width="66" height="76" rx="2" fill="#fbfaf5" stroke="#d8d4c8" stroke-width="1.5"/>
    <rect x="7" y="7" width="56" height="46" fill="#8fd18a"/><rect x="7" y="7" width="56" height="22" fill="#9fd8f5"/>
    <circle cx="20" cy="40" r="6" fill="#ffb400"/><circle cx="32" cy="38" r="6" fill="#ff4466"/><circle cx="44" cy="40" r="6" fill="#2ecc71"/><circle cx="55" cy="36" r="6" fill="#4a3a2c"/>
    <path d="M12 66 h30" stroke="#8a8a96" stroke-width="2"/></svg>`;
  await sharp(Buffer.from(camera)).png().toFile(join(FONTES, "prop_camera.png"));
  await sharp(Buffer.from(foto)).png().toFile(join(FONTES, "prop_foto.png"));
}

// ---- pecas: o PNG (2x), espelhado ou nao, e as medidas em pixels do mundo (y para baixo)
type Peca = { nome: string; arq: string; espelho: boolean; w: number; h: number; alfa: Uint8Array };
const pecas = new Map<string, Peca>();
async function peca(arq: string, espelho = false): Promise<Peca> {
  const nome = arq + (espelho ? "_e" : "");
  if (pecas.has(nome)) return pecas.get(nome)!;
  let s = sharp(join(FONTES, arq + ".png")).ensureAlpha();
  if (espelho) s = s.flop();
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  // o alfa na escala do mundo (um pixel do mundo = HD x HD da textura)
  const w = Math.round(info.width / HD),
    h = Math.round(info.height / HD);
  const alfa = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alfa[y * w + x] = data[((y * HD) * info.width + x * HD) * 4 + 3];
  const p = { nome, arq, espelho, w, h, alfa };
  pecas.set(nome, p);
  return p;
}
// a faixa opaca de uma linha da peca (fracao da altura): [inicio, fim] em x
function faixa(p: Peca, fy: number): [number, number] {
  const y = Math.min(p.h - 1, Math.max(0, Math.round(fy * p.h)));
  let [a, b] = [p.w, -1];
  for (let x = 0; x < p.w; x++) if (p.alfa[y * p.w + x] > 128) [a, b] = [Math.min(a, x), Math.max(b, x)];
  return [a, b];
}
// o meio do trecho opaco de uma linha mais perto de x0 (a linha pode cortar dois pedacos do membro)
function meio(p: Peca, fy: number, x0: number): number {
  const y = Math.min(p.h - 1, Math.max(0, Math.round(fy * p.h)));
  const trechos: [number, number][] = [];
  let ini = -1;
  for (let x = 0; x <= p.w; x++) {
    const on = x < p.w && p.alfa[y * p.w + x] > 128;
    if (on && ini < 0) ini = x;
    if (!on && ini >= 0) trechos.push([ini, x - 1]), (ini = -1);
  }
  if (!trechos.length) return x0;
  trechos.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - x0) - Math.abs((b[0] + b[1]) / 2 - x0));
  return (trechos[0][0] + trechos[0][1]) / 2;
}
// a bola de cima dos membros (ombro, quadril): centro e raio
function bola(p: Peca): { x: number; y: number; r: number } {
  let topo = 0;
  while (topo < p.h && faixa(p, topo / p.h)[1] < 0) topo++;
  let d = 0;
  for (let y = topo; y < topo + p.h * 0.35; y++) {
    const [a, b] = faixa(p, y / p.h);
    d = Math.max(d, b - a + 1);
  }
  const yc = topo + d / 2;
  const [a, b] = faixa(p, yc / p.h);
  return { x: (a + b) / 2, y: yc, r: d / 2 };
}

// ---- o esqueleto: ossos pela posicao no mundo (y para cima) e giro no mundo
type Osso = { nome: string; pai?: string; x: number; y: number; giro: number; comprimento?: number };
const ossos: Osso[] = [{ nome: "root", x: 0, y: 0, giro: 0 }];
const osso = (nome: string, pai: string, x: number, y: number, giro = 0, comprimento?: number) => {
  ossos.push({ nome, pai, x, y, giro, comprimento });
  return nome;
};
const doOsso = (n: string) => ossos.find((o) => o.nome === n)!;
// do mundo para o espaco de um osso (sem escala no setup)
function local(n: string, x: number, y: number, giro = 0) {
  const o = doOsso(n);
  const c = Math.cos(-o.giro / GRAUS),
    s = Math.sin(-o.giro / GRAUS);
  const dx = x - o.x,
    dy = y - o.y;
  return { x: r3(dx * c - dy * s), y: r3(dx * s + dy * c), giro: r3(giro - o.giro) };
}

type Slot = { nome: string; osso: string; parte: string; cor?: string };
// a cor de uma peca pelo nome (body_blueA, arm_blueC...)
const corDe = (arq: string) => /_(blue|dark|green|red|white|yellow)/.exec(arq)?.[1];
// cada monstro desenha inteiro, num bloco: os do meio na frente dos das pontas
const PLANO = ["amarelo", "marrom", "vermelho", "verde", "azul"];
const plano = (slot: string) => PLANO.indexOf(slot.split("_")[0]);
const slots: { z: number; s: Slot }[] = [];
const partes: Record<string, Record<string, any>> = {};
const usadas = new Set<string>();
// uma peca presa a um osso, com o centro no ponto (x, y) do mundo; z ordena o desenho
function prende(slot: string, n: string, p: Peca, x: number, y: number, z: number, escala = 1, giro = 0) {
  const l = local(n, x, y, giro);
  slots.push({ z, s: { nome: slot, osso: n, parte: p.nome } });
  (partes[slot] ??= {})[p.nome] = { x: l.x, y: l.y, ...(l.giro ? { rotacao: l.giro } : {}), largura: r3(p.w * escala), altura: r3(p.h * escala) };
  usadas.add(p.nome);
}
// outra imagem no mesmo slot (troca pela timeline), no mesmo lugar
function troca(slot: string, p: Peca, escala = 1) {
  const [base] = Object.values(partes[slot]);
  partes[slot][p.nome] = { ...base, largura: r3(p.w * escala), altura: r3(p.h * escala) };
  usadas.add(p.nome);
}

// ---- os cinco, da esquerda para a direita, como na amostra
type Rosto = { arq: string; x: number; y: number; escala?: number; espelho?: boolean };
type Monstro = {
  id: string;
  x: number;
  corpo: string;
  braco: string;
  perna: string;
  // pernas: afastamento do meio (fracao da largura do corpo) e quanto da perna fica atras do corpo
  pernaAbre: number;
  bracoAlto: number; // ombro: fracao da altura do corpo, a partir de baixo
  bracoAbre: number; // ombro: fracao da meia largura do corpo
  bracoGiro?: number; // graus para fora, em volta do ombro
  bracosExtras?: { braco: string; alto: number; abre: number; giro?: number }; // o marrom tem quatro
  escala?: number; // o monstro inteiro
  olhos: Rosto[];
  // os olhos viram olhos malucos (eye.googly, no mesmo lugar e tamanho): os que ja parecem de boneco
  googly?: boolean;
  boca: Rosto;
  nariz?: Rosto;
  sobrancelhas?: Rosto[];
  detalhes: (Rosto & { atras?: boolean })[];
  // posicoes no rosto em fracao do corpo: x de -1 a 1 (meia largura), y de 0 (base) a 1 (topo)
};
export const MONSTROS: Monstro[] = [
  {
    id: "amarelo",
    x: -520,
    googly: true,
    corpo: "body_yellowD",
    braco: "arm_yellowC",
    perna: "leg_yellowB",
    pernaAbre: 0.3,
    bracoAlto: 0.5,
    bracoAbre: 0.85,
    bracoGiro: 25,
    olhos: [
      { arq: "eye_human", x: -0.34, y: 0.5, escala: 0.75 },
      { arq: "eye_human", x: 0.34, y: 0.5, escala: 0.75 },
      { arq: "eye_human", x: 0, y: 0.68, escala: 0.75 },
    ],
    boca: { arq: "mouthJ", x: 0, y: 0.28, escala: 0.45 },
    detalhes: [
      { arq: "detail_yellow_ear_round", x: -0.62, y: 0.95, escala: 0.8, atras: true },
      { arq: "detail_yellow_ear_round", x: 0.62, y: 0.95, escala: 0.8, atras: true, espelho: true },
    ],
  },
  {
    id: "vermelho",
    x: -250,
    googly: true,
    corpo: "body_redE",
    braco: "arm_whiteE",
    perna: "leg_redD",
    pernaAbre: 0.36,
    bracoAlto: 0.55,
    bracoAbre: 1.0,
    bracoGiro: 22,
    olhos: [{ arq: "eye_cute_light", x: 0, y: 0.7, escala: 1 }],
    boca: { arq: "mouth_closed_fangs", x: 0, y: 0.5, escala: 0.6 },
    detalhes: [
      { arq: "detail_red_horn_small", x: -0.8, y: 0.97, escala: 1.4, atras: true },
      { arq: "detail_red_horn_small", x: 0.8, y: 0.97, escala: 1.4, atras: true, espelho: true },
    ],
  },
  {
    id: "azul",
    x: 0,
    corpo: "body_blueA",
    braco: "arm_blueC",
    perna: "leg_blueB",
    pernaAbre: 0.35,
    bracoAlto: 0.5,
    bracoAbre: 0.95,
    bracoGiro: 15,
    olhos: [
      { arq: "eye_yellow", x: -0.9, y: 1.02, escala: 0.62 },
      { arq: "eye_yellow", x: 0.9, y: 1.02, escala: 0.62 },
    ],
    boca: { arq: "mouth_closed_teeth", x: 0, y: 0.3, escala: 0.6 },
    nariz: { arq: "nose_brown", x: 0, y: 0.55, escala: 0.8 },
    detalhes: [
      { arq: "detail_blue_ear_round", x: -0.9, y: 1.02, escala: 0.95, atras: true },
      { arq: "detail_blue_ear_round", x: 0.9, y: 1.02, escala: 0.95, atras: true, espelho: true },
    ],
  },
  {
    id: "verde",
    x: 250,
    corpo: "body_greenF",
    braco: "arm_greenB",
    perna: "leg_greenD",
    pernaAbre: 0.3,
    bracoAlto: 0.5,
    bracoAbre: 0.85,
    bracoGiro: 10,
    olhos: [{ arq: "eye_human_red", x: 0, y: 0.68, escala: 1.05 }],
    boca: { arq: "mouthB", x: 0, y: 0.42, escala: 0.75 },
    detalhes: [],
  },
  {
    id: "marrom",
    x: 530,
    corpo: "body_darkD",
    braco: "arm_yellowB",
    perna: "leg_darkD",
    pernaAbre: 0.36,
    bracoAlto: 0.62,
    bracoAbre: 0.9,
    bracoGiro: 55,
    bracosExtras: { braco: "arm_yellowB", alto: 0.4, abre: 0.9, giro: 30 },
    olhos: [
      { arq: "eye_red", x: -0.34, y: 0.6, escala: 0.6 },
      { arq: "eye_red", x: 0.34, y: 0.6, escala: 0.6, espelho: true },
    ],
    sobrancelhas: [
      { arq: "eyebrowA", x: -0.32, y: 0.75, escala: 0.75 },
      { arq: "eyebrowA", x: 0.32, y: 0.75, escala: 0.75, espelho: true },
    ],
    nariz: { arq: "nose_yellow", x: 0, y: 0.42, escala: 0.6 },
    boca: { arq: "mouthG", x: 0, y: 0.24, escala: 0.72 },
    detalhes: [
      { arq: "detail_dark_ear", x: -0.85, y: 0.85, escala: 1, atras: true },
      { arq: "detail_dark_ear", x: 0.85, y: 0.85, escala: 1, atras: true, espelho: true },
      { arq: "detail_yellow_antenna_large", x: -0.3, y: 1.12, escala: 1, atras: true },
      { arq: "detail_yellow_antenna_large", x: 0.3, y: 1.12, escala: 1, atras: true, espelho: true },
    ],
  },
];

// o que a animacao precisa saber de cada um (nomes dos ossos e slots, medidas)
export type Rig = {
  m: Monstro;
  raiz: string;
  quadril: string;
  corpo: string;
  rosto: string;
  olhos: string[];
  boca: string;
  sobrancelhas: string[];
  bracos: { lado: -1 | 1; ombro: string; cotovelo: string; extra: boolean }[];
  pernas: { lado: -1 | 1; alvo: string }[];
  detalhes: string[];
  altura: number; // do corpo
  largura: number;
  quadrilY: number;
  slots: { boca: string; olhos: string[]; camera?: string; fotinho?: string };
  // olhos malucos: o ponto na imagem do corpo (pixels da textura, y para baixo) e o diametro
  googly: { u: number; v: number; size: number }[];
  pecas: { boca: string; olhos: string[] };
};
const rigs: Rig[] = [];
// pernas: o joelho em fracao da altura da peca (para os pesos ao longo da perna)
const joelhoF: Record<string, number> = {};
const restricoes: any[] = [];

for (const m of MONSTROS) {
  const corpo = await peca(m.corpo);
  const pernaD = await peca(m.perna),
    pernaE = await peca(m.perna, true);
  const bracoD = await peca(m.braco),
    bracoE = await peca(m.braco, true);
  // altura do quadril: a bola da perna fica atras da base do corpo
  const bp = bola(pernaD);
  const quadrilY = r3(pernaD.h - bp.y - bp.r * 0.3);
  const base = quadrilY - bp.r * 0.6; // a base do corpo
  const raiz = osso(m.id, "root", m.x, 0);
  const quadril = osso(`${m.id}_quadril`, raiz, m.x, quadrilY);
  const nCorpo = osso(`${m.id}_corpo`, quadril, m.x, base, 90, corpo.h * 0.5);
  const topo = base + corpo.h;
  const rosto = osso(`${m.id}_rosto`, nCorpo, m.x, base + corpo.h * 0.55, 90);
  const rig: Rig = { m, raiz, quadril, corpo: nCorpo, rosto, olhos: [], boca: "", sobrancelhas: [], bracos: [], pernas: [], detalhes: [], altura: corpo.h, largura: corpo.w, quadrilY, slots: { boca: "", olhos: [] }, pecas: { boca: "", olhos: [] }, googly: [] };
  const em = (r: Rosto) => ({ x: m.x + (r.x * corpo.w) / 2, y: base + r.y * corpo.h });
  prende(`${m.id}_corpo`, nCorpo, corpo, m.x, base + corpo.h / 2, 100);

  // pernas: a bola no quadril, a canela ate o tornozelo, o alvo do IK no tornozelo
  for (const lado of [-1, 1] as const) {
    const p = lado < 0 ? pernaE : pernaD;
    const b = bola(p);
    // a peca no mundo: a bola no ponto do quadril de cada lado
    const qx = m.x + lado * m.pernaAbre * corpo.w;
    const ox = qx - b.x,
      oy = quadrilY + b.y; // canto de cima e da esquerda da peca, no mundo (y para cima)
    const ponto = (fx: number, fy: number) => ({ x: ox + fx, y: oy - fy });
    // o tornozelo: onde a canela acaba e o pe comeca (a linha alarga de repente), um pouco acima
    const largura = (fy: number) => {
      const [a, z] = faixa(p, fy);
      return z - a + 1;
    };
    let fTornozelo = 0.8;
    for (let fy = 0.55; fy < 0.95; fy += 1 / p.h)
      if (largura(fy) > largura(0.5) * 1.6) {
        fTornozelo = fy - 3 / p.h;
        break;
      }
    const fJoelho = (b.y / p.h + fTornozelo) / 2;
    const j = ponto(meio(p, fJoelho, b.x), fJoelho * p.h),
      t = ponto(meio(p, fTornozelo, b.x), fTornozelo * p.h);
    const nomeL = lado < 0 ? "e" : "d";
    const ang = (a: { x: number; y: number }, z: { x: number; y: number }) => Math.atan2(z.y - a.y, z.x - a.x) * GRAUS;
    const coxa = osso(`${m.id}_coxa_${nomeL}`, quadril, qx, quadrilY, ang({ x: qx, y: quadrilY }, j), Math.hypot(j.x - qx, j.y - quadrilY));
    const canela = osso(`${m.id}_canela_${nomeL}`, coxa, j.x, j.y, ang(j, t), Math.hypot(t.x - j.x, t.y - j.y));
    const alvo = osso(`${m.id}_pe_${nomeL}`, raiz, t.x, t.y);
    prende(`${m.id}_perna_${nomeL}`, coxa, p, ox + p.w / 2, oy - p.h / 2, 10);
    joelhoF[`${m.id}_perna_${nomeL}`] = fJoelho;
    // o IK dobra para o lado que a perna ja dobra no desenho (senao o joelho vira do avesso)
    const dobra = ((ang(j, t) - ang({ x: qx, y: quadrilY }, j) + 540) % 360) - 180;
    restricoes.push({ tipo: "ik", nome: `${m.id}_ik_${nomeL}`, ossos: [coxa, canela], alvo, dobra_positiva: dobra > 0 });
    rig.pernas.push({ lado, alvo });
  }

  // bracos: a bola no ombro; o cotovelo no meio; atras do corpo
  const pBraco = async (arq: string, alto: number, abre: number, extra: boolean, giro = 0) => {
    for (const lado of [-1, 1] as const) {
      const p = await peca(arq, lado < 0);
      const b = bola(p);
      const sx = m.x + lado * abre * (corpo.w / 2),
        sy = base + alto * corpo.h;
      const ox = sx - b.x,
        oy = sy + b.y;
      // girado para fora em volta do ombro (o lado esquerdo gira ao contrario)
      const th = (lado * giro) / GRAUS;
      const gira = (x: number, y: number) => ({ x: sx + (x - sx) * Math.cos(th) - (y - sy) * Math.sin(th), y: sy + (x - sx) * Math.sin(th) + (y - sy) * Math.cos(th) });
      const ponto = (fx: number, fy: number) => gira(ox + fx, oy - fy);
      const c = ponto(meio(p, 0.5, b.x), 0.5 * p.h),
        mao = ponto(meio(p, 0.9, b.x), 0.9 * p.h);
      const ang = (a: { x: number; y: number }, z: { x: number; y: number }) => Math.atan2(z.y - a.y, z.x - a.x) * GRAUS;
      const nomeL = (lado < 0 ? "e" : "d") + (extra ? "2" : "");
      const ombro = osso(`${m.id}_ombro_${nomeL}`, nCorpo, sx, sy, ang({ x: sx, y: sy }, c), Math.hypot(c.x - sx, c.y - sy));
      const cotovelo = osso(`${m.id}_cotovelo_${nomeL}`, ombro, c.x, c.y, ang(c, mao), Math.hypot(mao.x - c.x, mao.y - c.y));
      const cp = gira(ox + p.w / 2, oy - p.h / 2);
      // atras do corpo (o desenho esconde a bola do ombro); da mesma cor do corpo, um tom mais
      // escuro para o braco se separar dele na borda
      prende(`${m.id}_braco_${nomeL}`, ombro, p, cp.x, cp.y, extra ? 15 : 20, 1, lado * giro);
      if (!extra && corDe(arq) === corDe(m.corpo)) slots[slots.length - 1].s.cor = "dcdcdcff";
      rig.bracos.push({ lado, ombro, cotovelo, extra });
    }
  };
  await pBraco(m.braco, m.bracoAlto, m.bracoAbre, false, m.bracoGiro ?? 0);
  if (m.bracosExtras) await pBraco(m.bracosExtras.braco, m.bracosExtras.alto, m.bracosExtras.abre, true, m.bracosExtras.giro ?? 0);

  // detalhes (orelhas, chifres, antenas): presos ao corpo, atras dele
  let k = 0;
  for (const d of m.detalhes) {
    const p = await peca(d.arq, !!d.espelho);
    const c = em(d);
    const n = osso(`${m.id}_detalhe${++k}`, nCorpo, c.x, c.y - (p.h * (d.escala ?? 1)) / 2, 90, (p.h * (d.escala ?? 1)) / 2);
    prende(`${m.id}_detalhe${k}`, n, p, c.x, c.y, d.atras ? 50 : 150, d.escala);
    rig.detalhes.push(n);
  }
  // rosto: olhos, sobrancelhas, nariz, boca
  k = 0;
  for (const o of m.olhos) {
    const p = await peca(o.arq, !!o.espelho);
    if (m.googly) {
      // no lugar do olho: o ponto na textura do corpo (2x) e o tamanho do olho de antes
      rig.googly.push({ u: ((o.x + 1) / 2) * corpo.w * HD, v: (1 - o.y) * corpo.h * HD, size: p.w * (o.escala ?? 1) });
      continue;
    }
    const c = em(o);
    const n = osso(`${m.id}_olho${++k}`, rosto, c.x, c.y);
    prende(`${m.id}_olho${k}`, n, p, c.x, c.y, 200, o.escala);
    // piscar e espantar: o olho fechado no mesmo slot
    troca(`${m.id}_olho${k}`, await peca("eye_closed_happy"), (o.escala ?? 1) * 0.9);
    rig.olhos.push(n);
    rig.slots.olhos.push(`${m.id}_olho${k}`);
    rig.pecas.olhos.push(p.nome);
  }
  k = 0;
  for (const o of m.sobrancelhas ?? []) {
    const p = await peca(o.arq, !!o.espelho);
    const c = em(o);
    const n = osso(`${m.id}_sobrancelha${++k}`, rosto, c.x, c.y);
    prende(`${m.id}_sobrancelha${k}`, n, p, c.x, c.y, 210, o.escala);
    rig.sobrancelhas.push(n);
  }
  if (m.nariz) {
    const p = await peca(m.nariz.arq);
    const c = em(m.nariz);
    prende(`${m.id}_nariz`, osso(`${m.id}_nariz`, rosto, c.x, c.y), p, c.x, c.y, 220, m.nariz.escala);
  }
  {
    const p = await peca(m.boca.arq);
    const c = em(m.boca);
    rig.boca = osso(`${m.id}_boca`, rosto, c.x, c.y);
    prende(`${m.id}_boca`, rig.boca, p, c.x, c.y, 215, m.boca.escala);
    // bocas para as reacoes, no mesmo lugar (a escala segue a largura da boca de base)
    for (const outra of ["mouthA", "mouthG", "mouthH", "mouth_closed_happy"]) {
      const q = await peca(outra);
      troca(`${m.id}_boca`, q, ((m.boca.escala ?? 1) * p.w) / q.w);
    }
    rig.slots.boca = `${m.id}_boca`;
    rig.pecas.boca = p.nome;
  }
  void topo;
  // objetos nas maos (so aparecem nas animacoes do VT): o Clique segura a camera na mao de fora
  // (a esquerda da tela) e mostra a Polaroid com a do lado da turma; o Bagunca rouba a camera
  // com a mao direita
  const naMao = async (lado: -1 | 1, nome: string, arq: string, z: number, dy: number) => {
    const br = rig.bracos.find((b) => b.lado === lado && !b.extra)!;
    const c = doOsso(br.cotovelo);
    const len = c.comprimento ?? 0;
    const mx = c.x + Math.cos(c.giro / GRAUS) * len,
      my = c.y + Math.sin(c.giro / GRAUS) * len;
    const mao = osso(`${m.id}_mao_${lado < 0 ? "e" : "d"}`, br.cotovelo, mx, my);
    prende(`${m.id}_${nome}`, mao, await peca(arq), mx, my + dy, z, 1);
    slots[slots.length - 1].s.cor = "ffffff00";
    return `${m.id}_${nome}`;
  };
  if (m.id === "azul") {
    rig.slots.camera = await naMao(-1, "camera", "prop_camera", 230, 10);
    rig.slots.fotinho = await naMao(1, "fotinho", "prop_foto", 231, 30);
  }
  if (m.id === "marrom") rig.slots.camera = await naMao(1, "camera", "prop_camera", 230, 10);
  rigs.push(rig);
}

// ---- atlas: uma pagina (prateleiras), as pecas em 2x
const lista = [...usadas].map((n) => pecas.get(n)!).sort((a, b) => b.h - a.h);
const LARG = 2048;
let [px, py, alt] = [0, 0, 0];
const imagens: any[] = [];
const comp: sharp.OverlayOptions[] = [];
for (const p of lista) {
  let s = sharp(join(FONTES, p.arq + ".png")).ensureAlpha();
  if (p.espelho) s = s.flop();
  const buf = await s.png().toBuffer();
  const { width, height } = await sharp(buf).metadata();
  if (px + width! > LARG) [px, py, alt] = [0, py + alt + 4, 0];
  imagens.push({ nome: p.nome, pagina: 0, ret: [px, py, width!, height!] });
  comp.push({ input: buf, left: px, top: py });
  px += width! + 4;
  alt = Math.max(alt, height!);
}
const altura = py + alt;
await sharp({ create: { width: LARG, height: altura, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).png().toFile(join(AQUI, "monstros.png"));

// ---- o .boneco: ossos no espaco do pai
const ossosB = ossos.map((o) => {
  if (!o.pai) return { nome: o.nome };
  const l = local(o.pai, o.x, o.y, o.giro);
  return { nome: o.nome, pai: o.pai, ...(l.x ? { x: l.x } : {}), ...(l.y ? { y: l.y } : {}), ...(l.giro ? { rotacao: l.giro } : {}), ...(o.comprimento ? { comprimento: r3(o.comprimento) } : {}) };
});
const b: any = {
  boneco: 0,
  nome: "monstros",
  paginas: [{ arquivo: "monstros.png", tamanho: [LARG, altura] }],
  imagens,
  esqueleto: { versao_spine: "4.3.23", x: -700, y: -20, largura: 1400, altura: 420 },
  ossos: ossosB,
  slots: slots.sort((a, b) => plano(a.s.nome) - plano(b.s.nome) || a.z - b.z).map((x) => x.s),
  skins: [{ nome: "default", partes }],
  restricoes,
  animacoes: cena(rigs),
};

// ---- bracos e pernas em malha, dobrando entre os dois ossos (os comandos do editor)
const ex = exportarSpine(b);
// as imagens para os comandos (contorno da malha, olho maluco), lidas das paginas do atlas dado
const provDe = (texto: string): AssetProvider => {
  const atlas = parseAtlas(texto);
  return {
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
};
const prov = provDe(ex.atlas);
const doc = Document.fromText(JSON.stringify(ex.json), { text: ex.atlas, pages: {} });
const chamadas: any[] = [];
for (const r of rigs) {
  for (const s of slots.map((x) => x.s).filter((s) => s.nome.startsWith(`${r.m.id}_braco_`) || s.nome.startsWith(`${r.m.id}_perna_`))) {
    const [o1, o2] = s.nome.includes("_braco_")
      ? (() => {
          const br = r.bracos.find((b) => s.nome === `${r.m.id}_braco_${b.ombro.split("_ombro_")[1]}`)!;
          return [br.ombro, br.cotovelo];
        })()
      : [`${r.m.id}_coxa_${s.nome.slice(-1)}`, `${r.m.id}_canela_${s.nome.slice(-1)}`];
    // pernas em grade sobre a peca inteira: o contorno automatico, numa perna fina, punha um
    // ponto para dentro e recortava a arte
    chamadas.push({ cmd: "mesh.create", args: s.nome.includes("_perna_") ? { slot: s.nome, name: s.parte, mode: "grid", grid: [2, 12] } : { slot: s.nome, name: s.parte, detail: 1.2 } });
    // a perna dobra em curva (pesos suaves); o braco um pouco menos
    chamadas.push({ cmd: "mesh.weights", args: { slot: s.nome, attachment: s.parte, bones: [o1, o2], smooth: s.nome.includes("_perna_") ? 2 : 1.2 } });
  }
}
// o corpo em geleia: base firme no quadril, topo mole; olhos, boca e o resto do rosto vao junto
// jiggly: mola forte (chacoalha rapido, 3 a 4 vezes por segundo) e pouco amortecimento (varias
// voltas depois de cada tranco); a moleza cresce da base ao topo, entao a forma entorta em vez de
// andar inteira. O verde e o mais mole e cede um pouco para baixo
const GELEIA: Record<string, any> = {
  amarelo: { stiffness: 300, coupling: 12, damping: 1.2, curve: 0.45 },
  vermelho: { stiffness: 380, coupling: 15, damping: 1.4, curve: 0.5 },
  azul: { stiffness: 380, coupling: 15, damping: 1.4, curve: 0.5 },
  verde: { stiffness: 220, coupling: 10, damping: 1, gravity: 60, curve: 0.4 },
  marrom: { stiffness: 300, coupling: 12, damping: 1.2, curve: 0.45 },
};
for (const r of rigs) {
  const att = Object.keys(partes[`${r.m.id}_corpo`])[0];
  // malha fina (detalhe maximo): com poucos pontos por dentro a barriga so entorta inteira; com a
  // grade densa ela ondula
  chamadas.push({ cmd: "mesh.create", args: { slot: `${r.m.id}_corpo`, name: att, detail: 4 } });
  // seguem: tudo que esta preso ao corpo menos as pernas (os pes ficam no chao, pelo IK)
  const seguem = slots.map((x) => x.s.nome).filter((n) => n.startsWith(`${r.m.id}_`) && n !== `${r.m.id}_corpo` && !n.includes("_perna_"));
  chamadas.push({ cmd: "mesh.jelly", args: { slot: `${r.m.id}_corpo`, attachment: att, ...GELEIA[r.m.id], followers: seguem } });
}
// o corpo todo mole: alem da barriga, antebracos, orelhas, chifres e antenas sacodem no tempo
// deles com a fisica de giro do nucleo (o rosto vai com a barriga: a fisica de posicao ainda nao
// existe no nucleo, docs/ROADMAP.md)
// o preset orelha, com limite: a decolagem dos pulos (uns 600 px/s) virava chifres e antenas de
// ponta-cabeca; ate 200 px/s os passinhos ainda sacodem
// mix 0,5: metade do balanco (pedido depois de ver o inteiro)
const ORELHA = { rotate: 1, inertia: 0.6, strength: 120, damping: 0.8, limit: 200, mix: 0.5 };
for (const r of rigs) {
  // o antebraco sacode menos: reage tambem ao giro do proprio braco, que sobe rapido nos gestos
  for (const b of r.bracos) chamadas.push({ cmd: "physics.create", args: { name: `${b.cotovelo}_fisica`, bone: b.cotovelo, ...ORELHA, inertia: 0.35, strength: 170 } });
  for (const d of r.detalhes) chamadas.push({ cmd: "physics.create", args: { name: `${d}_fisica`, bone: d, ...ORELHA } });
}
await executeAsync(doc, chamadas, "gerador", "malhas", {}, prov);
// a geleia pela metade: a mesma moleza de cada ponto (a automatica, pela distancia ao osso) vezes
// MOLEZA; a saida da geleia e proporcional a ela
const MOLEZA = 0.5;
for (const r of rigs) {
  const slot = `${r.m.id}_corpo`,
    att = Object.keys(partes[slot])[0];
  const sk = doc.json.skins.find((k: any) => k.attachments?.[slot]?.[att]);
  const auto: number[] = sk.attachments[slot][att].jelly.wobble;
  await executeAsync(doc, [{ cmd: "mesh.jelly", args: { slot, attachment: att, wobble: auto.map((w) => r3(w * MOLEZA)) } }], "gerador", "geleia", {}, prov);
}
// as pernas: pesos pela altura na peca, coxa em cima e canela do joelho para baixo (o pe inteiro
// na canela), com uma faixa curta de mistura no joelho. Os automaticos (pela distancia aos ossos)
// puxavam parte do pe pela coxa e a perna fina quebrava perto do tornozelo
for (const [slot, fj] of Object.entries(joelhoF)) {
  const att = Object.keys(partes[slot])[0];
  const [q] = await executeAsync(doc, [{ cmd: "query.mesh", args: { slot, attachment: att } }], "gerador", "consulta", {}, prov);
  const [coxa, canela] = [slot.replace("_perna_", "_coxa_"), slot.replace("_perna_", "_canela_")];
  const FAIXA = 0.09;
  const weights = q.vertices.map((v: any) => {
    const f = v.img[1] / q.image[1];
    const c = Math.min(1, Math.max(0, (f - (fj - FAIXA)) / (2 * FAIXA)));
    const w = c * c * (3 - 2 * c);
    return w <= 0.001 ? { [coxa]: 1 } : w >= 0.999 ? { [canela]: 1 } : { [coxa]: r3(1 - w), [canela]: r3(w) };
  });
  await executeAsync(doc, [{ cmd: "mesh.weights", args: { slot, attachment: att, bones: [coxa, canela], mode: "explicit", weights } }], "gerador", "pesos", {}, prov);
}
const final = importarSpine(doc.json, ex.atlas, "monstros");
final.mix = { padrao: 0.2 };
const ARQ = join(AQUI, "monstros.boneco");
writeFileSync(ARQ, JSON.stringify(final, null, 1) + "\n");

// ---- efeitos da biblioteca (biblioteca/efeitos), como o editor faz: as imagens entram numa pagina
// monstros-efeitos.png e os emissores nascem pelo particles.set, com rajadas na timeline
for (const ef of ["poeira", "pum", "olho_maluco"]) await porEfeito(ARQ, ef);
{
  const ef = JSON.parse(readFileSync(join(AQUI, "../../biblioteca/efeitos/efeitos.json"), "utf8"));
  const b2 = JSON.parse(readFileSync(ARQ, "utf8"));
  const ex2 = exportarSpine(b2);
  const doc2 = Document.fromText(JSON.stringify(ex2.json), { text: ex2.atlas, pages: {} });
  const vars = (n: string) => ef[n].imagens.map((i: string) => `efeito_${i}`);
  const ch: any[] = [];
  const rajada = (nome: string, time: number, count: number) => ch.push({ cmd: "key.set", args: { anim: "cena", target: { particles: nome }, timeline: "burst", time: r3(time), count } });
  // poeira no chao de cada um, desenhada na frente do monstro (no chao, nao cobre o rosto); a do
  // pulo grande e das pisadas mais forte
  for (const [i, r] of rigs.entries()) {
    const nome = `${r.m.id}_poeira`;
    ch.push({ cmd: "particles.set", args: { name: nome, slot: r.slots.boca, bone: r.raiz, y: 4, variants: vars("poeira"), ...ef.poeira.emissor } });
    // os pousos da ola (decola em t0 + 0,16, 0,42 s no ar) e o pulinho de todos (8,1 + 0,12 + 0,3)
    rajada(nome, 6.6 + i * 0.26 + 0.16 + 0.42, 9);
    rajada(nome, 8.1 + 0.12 + 0.3, 6);
  }
  rajada("vermelho_poeira", 2.8 + 0.32 + 0.62, 20);
  rajada("amarelo_poeira", 3.76 + 0.04 + 0.3, 7);
  // as pisadas do marrom: o pe desce em t0 + 0,3 (direita em 5,3 e esquerda em 5,85)
  rajada("marrom_poeira", 5.6, 14);
  rajada("marrom_poeira", 6.15, 14);
  // o pum do verde gargalhando: sai de tras pela lateral esquerda, vai para a esquerda e sobe
  ch.push({ cmd: "particles.set", args: { name: "verde_pum", slot: "verde_perna_e", bone: "verde_quadril", x: -45, y: 15, variants: vars("pum"), ...ef.pum.emissor, angle: 190, spread: 40 } });
  rajada("verde_pum", 5.05, 7);
  rajada("verde_pum", 5.7, 9);
  // os olhos de boneco do amarelo e do vermelho viram olhos malucos, no mesmo lugar
  for (const r of rigs) for (const g of r.googly) ch.push({ cmd: "eye.googly", args: { slot: `${r.m.id}_corpo`, at: [[r3(g.u), r3(g.v)]], size: r3(g.size), name: `${r.m.id}_olho` } });
  // a selfie do VT (vt_selfie): o Bagunca na frente de todos e o Clique logo atras (cada monstro
  // vai para a frente na sua vez, inteiro)
  ch.push({ cmd: "draworder.key", args: { anim: "vt_selfie", time: 0, front: ["vermelho_*", "verde_*", "amarelo_*", "azul_*", "marrom_*"] } });
  await executeAsync(doc2, ch, "gerador", "efeitos", {}, provDe(ex2.atlas));
  const comEfeitos = importarSpine(doc2.json, ex2.atlas, "monstros");
  comEfeitos.mix = final.mix;
  writeFileSync(ARQ, JSON.stringify(comEfeitos, null, 1) + "\n");
}
console.log(`monstros.boneco: ${rigs.length} monstros, ${ossos.length} ossos, ${slots.length} slots, ${usadas.size} imagens, ${DUR} s`);
void readFileSync;
