// O tutorial de rig e IK: sete cenas com o mesmo boneco (o Tico, desenhado aqui, CC0), cada uma
// com uma coisa por fazer. As licoes, as conferencias e os textos estao em src/core/tutorial.ts;
// o painel no editor em src/app/Tutorial.svelte; preparar e recomecar em server/tutorial.ts.
//
//   npx tsx exemplos/tutorial/gerar.ts
//
// Escreve exemplos/tutorial/originais/<cena>.boneco.original e tutorial.png. Os originais nao
// aparecem no seletor (a extensao e outra): o editor abre as copias em exemplos/tutorial/cenas/,
// feitas a partir deles na primeira vez e a cada "recomecar".
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CENAS_TUTORIAL, GEO, GEO_MONSTRO } from "../../src/core/tutorial.ts";
import { exportarSpine, importarSpine } from "../../src/boneco/spine.ts";
import { parseAtlas } from "../../src/core/atlas-text.ts";
import { Document } from "../../src/core/document.ts";
import { executeAsync, type AssetProvider } from "../../src/core/commands/index.ts";
import { extractRegion } from "../../server/atlas.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, "originais");
const HD = 2; // pixels da textura por pixel do mundo
const GRAUS = 180 / Math.PI;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ---- a arte: pecas em SVG (no tamanho do mundo; o PNG sai em 2x)
type Arte = { nome: string; w: number; h: number; svg: string };
const ARTE: Arte[] = [];
const svg = (w: number, h: number, corpo: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w * HD}" height="${h * HD}" viewBox="0 0 ${w} ${h}">${corpo}</svg>`;
function arte(nome: string, w: number, h: number, corpo: string) {
  ARTE.push({ nome, w, h, svg: svg(w, h, corpo) });
}
const TINTA = "#2b1d14";
// membro: capsula em pe (o comeco em cima), com a bola da junta nas duas pontas
function membro(nome: string, w: number, h: number, cor: string, risca?: string) {
  const r = w / 2 - 2;
  arte(
    nome,
    w,
    h,
    `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${r}" fill="${cor}" stroke="${TINTA}" stroke-width="2.5"/>` +
      (risca ? `<rect x="${w / 2 - 3}" y="${r}" width="6" height="${h - 2 * r}" rx="3" fill="${risca}" opacity="0.5"/>` : ""),
  );
}
const PELE = "#f2b48a",
  PELE_E = "#cf916a",
  CALCA = "#3f6fb5",
  CALCA_E = "#2d5089",
  CAMISA = "#e0533d",
  CAMISA_E = "#b03c2a";
membro("coxa", 34, 104, CALCA, "#ffffff");
membro("canela", 30, 98, CALCA, "#ffffff");
membro("coxa_e", 34, 104, CALCA_E);
membro("canela_e", 30, 98, CALCA_E);
membro("braco", 28, 80, CAMISA);
membro("antebraco", 24, 74, PELE);
membro("braco_e", 28, 80, CAMISA_E);
membro("antebraco_e", 24, 74, PELE_E);
for (const [n, c] of [["pe", "#5a3a26"], ["pe_e", "#3e2819"]] as const)
  arte(n, 66, 30, `<path d="M6 4 h22 q4 0 6 6 l4 4 h16 q10 0 10 9 v3 h-62 z" fill="${c}" stroke="${TINTA}" stroke-width="2.5" stroke-linejoin="round"/><rect x="4" y="23" width="60" height="4" rx="2" fill="#1a110b"/>`);
for (const [n, c] of [["mao", PELE], ["mao_e", PELE_E]] as const)
  arte(n, 34, 34, `<circle cx="17" cy="17" r="13" fill="${c}" stroke="${TINTA}" stroke-width="2.5"/><path d="M17 8 q8 2 8 9" fill="none" stroke="${TINTA}" stroke-width="2" stroke-linecap="round"/>`);
arte(
  "tronco",
  90,
  150,
  `<rect x="34" y="2" width="22" height="24" rx="8" fill="${PELE}" stroke="${TINTA}" stroke-width="2.5"/>` +
    `<path d="M10 22 q35 -12 70 0 q8 3 8 14 v104 q0 8 -8 8 h-70 q-8 0 -8 -8 v-104 q0 -11 8 -14 z" fill="${CAMISA}" stroke="${TINTA}" stroke-width="2.5"/>` +
    `<path d="M30 20 l15 18 l15 -18" fill="none" stroke="${TINTA}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<circle cx="45" cy="64" r="4" fill="${TINTA}"/><circle cx="45" cy="90" r="4" fill="${TINTA}"/><circle cx="45" cy="116" r="4" fill="${TINTA}"/>`,
);
arte("quadril", 92, 50, `<path d="M6 6 h80 v26 q0 14 -14 14 h-52 q-14 0 -14 -14 z" fill="${CALCA}" stroke="${TINTA}" stroke-width="2.5"/><rect x="6" y="6" width="80" height="10" fill="#2d5089" stroke="${TINTA}" stroke-width="2.5"/>`);
arte(
  "cabeca",
  104,
  110,
  `<path d="M14 40 q-4 -32 40 -34 q44 0 40 34 q-10 -14 -40 -12 q-30 -2 -40 12 z" fill="#3a2414"/>` +
    `<ellipse cx="54" cy="62" rx="42" ry="44" fill="${PELE}" stroke="${TINTA}" stroke-width="2.5"/>` +
    `<path d="M14 44 q6 -26 40 -26 q30 0 40 24 q-14 -10 -38 -6 q-22 2 -42 8 z" fill="#3a2414" stroke="${TINTA}" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="70" cy="58" r="6" fill="${TINTA}"/><circle cx="72" cy="56" r="2" fill="#fff"/>` +
    `<circle cx="44" cy="58" r="6" fill="${TINTA}"/><circle cx="46" cy="56" r="2" fill="#fff"/>` +
    `<circle cx="84" cy="74" r="7" fill="#e88e72" opacity="0.7"/><circle cx="34" cy="74" r="7" fill="#e88e72" opacity="0.7"/>` +
    `<path d="M48 82 q12 10 26 0" fill="none" stroke="${TINTA}" stroke-width="3" stroke-linecap="round"/>`,
);
arte("chao", 900, 40, `<rect x="0" y="6" width="900" height="34" fill="#7fbf5a"/><rect x="0" y="4" width="900" height="6" rx="3" fill="#5f9c3f"/>` + Array.from({ length: 30 }, (_, i) => `<path d="M${15 + i * 30} 8 l4 -6 l3 6" fill="#5f9c3f"/>`).join(""));
arte("pedra", 90, 46, `<path d="M6 44 q-4 -20 14 -32 q20 -12 46 -6 q22 6 20 38 z" fill="#9aa0a8" stroke="${TINTA}" stroke-width="2.5" stroke-linejoin="round"/><path d="M26 18 q12 -6 22 -2" fill="none" stroke="#c4c9cf" stroke-width="4" stroke-linecap="round"/>`);
// alvo: onde a ponta tem de chegar (anel amarelo tracejado)
arte("marca", 40, 40, `<circle cx="20" cy="20" r="15" fill="#ffd34d" fill-opacity="0.25" stroke="#e0a800" stroke-width="3" stroke-dasharray="6 4"/><circle cx="20" cy="20" r="3" fill="#e0a800"/>`);
// guia das juntas: tres anéis onde vao o quadril, o joelho e o tornozelo (licao dos ossos)
arte("junta", 26, 26, `<circle cx="13" cy="13" r="10" fill="none" stroke="#ff3fa4" stroke-width="3" stroke-dasharray="5 3"/><circle cx="13" cy="13" r="2.5" fill="#ff3fa4"/>`);
arte("bola", 50, 50, `<circle cx="25" cy="25" r="22" fill="#ffcf3d" stroke="${TINTA}" stroke-width="2.5"/><path d="M5 20 q20 12 40 0 M8 34 q17 8 34 0" fill="none" stroke="#e05a2a" stroke-width="4"/>`);

// ---- os atlas: uma pagina por trilha. Cada imagem: o PNG em 2x e o tamanho no mundo
type Img = { nome: string; w: number; h: number; buf: Buffer };
type Pagina = { arquivo: string; tamanho: [number, number]; imagens: any[]; tam: (n: string) => { w: number; h: number } };
mkdirSync(SAIDA, { recursive: true });
async function pagina(arquivo: string, lista: Img[]): Promise<Pagina> {
  const LARG = 2048;
  let [px, py, alt] = [0, 0, 0];
  const imagens: any[] = [];
  const comp: sharp.OverlayOptions[] = [];
  for (const a of [...lista].sort((x, y) => y.h - x.h)) {
    const { width: w, height: h } = await sharp(a.buf).metadata();
    if (px + w! > LARG) [px, py, alt] = [0, py + alt + 4, 0];
    imagens.push({ nome: a.nome, pagina: 0, ret: [px, py, w, h] });
    comp.push({ input: a.buf, left: px, top: py });
    px += w! + 4;
    alt = Math.max(alt, h!);
  }
  const altura = py + alt;
  await sharp({ create: { width: LARG, height: altura, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).png().toFile(join(SAIDA, arquivo));
  return { arquivo, tamanho: [LARG, altura], imagens, tam: (n) => lista.find((x) => x.nome === n)! };
}
const doSvg = async (a: Arte): Promise<Img> => ({ nome: a.nome, w: a.w, h: a.h, buf: await sharp(Buffer.from(a.svg)).png().toBuffer() });
const PAG_TICO = await pagina("tutorial.png", await Promise.all(ARTE.map(doSvg)));
// as pecas do monstro: o Monster Builder Pack da Kenney (CC0), as mesmas de exemplos/monstros
const KENNEY = join(AQUI, "..", "monstros", "fontes");
async function kenney(arq: string, nome = arq, espelho = false): Promise<Img> {
  let s = sharp(join(KENNEY, arq + ".png")).ensureAlpha();
  if (espelho) s = s.flop();
  const buf = await s.png().toBuffer();
  const { width, height } = await sharp(buf).metadata();
  return { nome, w: width! / HD, h: height! / HD, buf };
}
const PAG_MONSTRO = await pagina("monstro.png", [
  await kenney("body_blueA", "corpo"),
  await kenney("leg_blueB", "perna_e", true),
  await kenney("leg_blueB", "perna_d"),
  await kenney("arm_blueC", "braco_e", true),
  await kenney("arm_blueC", "braco_d"),
  await kenney("detail_blue_ear_round", "orelha_e"),
  await kenney("detail_blue_ear_round", "orelha_d", true),
  await kenney("eye_yellow", "olho"),
  await kenney("nose_brown", "nariz"),
  await kenney("mouth_closed_teeth", "boca"),
  ...(await Promise.all(ARTE.filter((a) => ["chao", "junta"].includes(a.nome)).map(doSvg))),
]);

// ---- o boneco: pontos do mundo (y para cima, chao em 0, olhando para a direita)
type P = { x: number; y: number };
const QUADRIL: P = { x: 0, y: 196 };
const { perna: PERNA, pernaTras: PERNA_E, braco: BRACO, bracoTras: BRACO_E } = GEO;
const ang = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x) * GRAUS;
const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);

type Osso = { nome: string; pai?: string; x: number; y: number; giro: number; comprimento?: number; cor?: string };
type Peca = { slot: string; img: string; osso: string; x: number; y: number; giro: number; escala?: number };

class Montagem {
  ossos: Osso[] = [{ nome: "root", x: 0, y: 0, giro: 0 }];
  pecas: Peca[] = [];
  restricoes: any[] = [];
  animacoes: Record<string, any> = {};
  // a pagina do atlas e os comandos do editor rodados depois de montar (malhas e pesos)
  pag: Pagina = PAG_TICO;
  comandos: any[] = [];
  osso(nome: string, pai: string, at: P, giro = 0, comprimento?: number, cor?: string) {
    this.ossos.push({ nome, pai, x: at.x, y: at.y, giro, comprimento, cor });
  }
  // osso de a ate b
  segmento(nome: string, pai: string, a: P, b: P) {
    this.osso(nome, pai, a, ang(a, b), dist(a, b));
  }
  // a peca de um membro: a capsula de a ate b (a bola da junta passa um pouco das pontas)
  membro(slot: string, img: string, osso: string, a: P, b: P) {
    this.pecas.push({ slot, img, osso, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, giro: ang(a, b) + 90 });
  }
  peca(slot: string, img: string, osso: string, c: P, giro = 0, escala?: number) {
    this.pecas.push({ slot, img, osso, x: c.x, y: c.y, giro, escala });
  }
  achar(n: string) {
    return this.ossos.find((o) => o.nome === n)!;
  }
  // mundo -> espaco de um osso (sem escala no setup)
  local(n: string, x: number, y: number, giro = 0) {
    const o = this.achar(n);
    const c = Math.cos(-o.giro / GRAUS),
      s = Math.sin(-o.giro / GRAUS);
    const dx = x - o.x,
      dy = y - o.y;
    return { x: r3(dx * c - dy * s), y: r3(dx * s + dy * c), giro: r3(giro - o.giro) };
  }
  boneco(nome: string, pag: Pagina = PAG_TICO) {
    const ossos = this.ossos.map((o) => {
      if (!o.pai) return { nome: o.nome };
      const l = this.local(o.pai, o.x, o.y, o.giro);
      return {
        nome: o.nome,
        pai: o.pai,
        ...(l.x ? { x: l.x } : {}),
        ...(l.y ? { y: l.y } : {}),
        ...(l.giro ? { rotacao: l.giro } : {}),
        ...(o.comprimento ? { comprimento: r3(o.comprimento) } : {}),
        ...(o.cor ? { cor: o.cor } : {}),
      };
    });
    const partes: Record<string, any> = {};
    const usadas = new Set<string>();
    for (const p of this.pecas) {
      const l = this.local(p.osso, p.x, p.y, p.giro);
      const a = pag.tam(p.img);
      const e = p.escala ?? 1;
      (partes[p.slot] ??= {})[p.img] = { x: l.x, y: l.y, ...(l.giro ? { rotacao: l.giro } : {}), largura: r3(a.w * e), altura: r3(a.h * e) };
      usadas.add(p.img);
    }
    return {
      boneco: 0,
      nome,
      paginas: [{ arquivo: pag.arquivo, tamanho: pag.tamanho }],
      imagens: pag.imagens.filter((i) => usadas.has(i.nome)),
      esqueleto: { versao_spine: "4.3.23", x: -450, y: -20, largura: 900, altura: 460 },
      ossos,
      slots: this.pecas.map((p) => ({ nome: p.slot, osso: p.osso, parte: p.img })),
      skins: [{ nome: "default", partes }],
      ...(this.restricoes.length ? { restricoes: this.restricoes } : {}),
      ...(Object.keys(this.animacoes).length ? { animacoes: this.animacoes } : {}),
    };
  }
}

type Opcoes = {
  // ossos das pernas (sem: as pecas da perna da frente ficam no quadril, para a licao dos ossos)
  pernaComOssos?: boolean;
  // pecas do braco da frente presas na raiz (licao de prender)
  bracoSolto?: boolean;
  // IK nas pernas: alvos na raiz ou (errado) no quadril
  ikPernas?: "raiz" | "quadril";
  // IK no braco da frente, com alvo na raiz
  ikBraco?: boolean;
  pedra?: boolean;
};
// o Tico inteiro. Ordem de desenho: chao, lado de tras (perna e braco escuros), corpo, lado da frente
function tico(o: Opcoes): Montagem {
  const m = new Montagem();
  m.peca("chao", "chao", "root", { x: 0, y: -14 });
  m.osso("quadril", "root", QUADRIL, 0, 0, "ffb400ff");
  m.osso("tronco", "quadril", { x: 0, y: 204 }, 90, 112);
  m.osso("cabeca", "tronco", { x: 0, y: 318 }, 90, 90);
  // lado de tras: sempre rigado
  m.segmento("coxa_e", "quadril", PERNA_E.quadril, PERNA_E.joelho);
  m.segmento("canela_e", "coxa_e", PERNA_E.joelho, PERNA_E.tornozelo);
  m.osso("pe_e", "canela_e", PERNA_E.tornozelo, -8, 34);
  m.segmento("braco_e", "tronco", BRACO_E.ombro, BRACO_E.cotovelo);
  m.segmento("antebraco_e", "braco_e", BRACO_E.cotovelo, BRACO_E.pulso);
  m.osso("mao_e", "antebraco_e", BRACO_E.pulso, ang(BRACO_E.cotovelo, BRACO_E.pulso), 14);
  m.membro("braco_e", "braco_e", "braco_e", BRACO_E.ombro, BRACO_E.cotovelo);
  m.membro("antebraco_e", "antebraco_e", "antebraco_e", BRACO_E.cotovelo, BRACO_E.pulso);
  m.peca("mao_e", "mao_e", "mao_e", BRACO_E.pulso);
  m.membro("coxa_e", "coxa_e", "coxa_e", PERNA_E.quadril, PERNA_E.joelho);
  m.membro("canela_e", "canela_e", "canela_e", PERNA_E.joelho, PERNA_E.tornozelo);
  m.peca("pe_e", "pe_e", "pe_e", { x: PERNA_E.tornozelo.x + 22, y: 13 });
  // corpo
  m.peca("tronco", "tronco", "tronco", { x: 0, y: 270 });
  m.peca("cabeca", "cabeca", "cabeca", { x: 4, y: 368 });
  // perna da frente
  if (o.pernaComOssos !== false) {
    m.segmento("coxa", "quadril", PERNA.quadril, PERNA.joelho);
    m.segmento("canela", "coxa", PERNA.joelho, PERNA.tornozelo);
    m.osso("pe", "canela", PERNA.tornozelo, -8, 34);
  }
  const op = o.pernaComOssos === false;
  m.membro("coxa", "coxa", op ? "quadril" : "coxa", PERNA.quadril, PERNA.joelho);
  m.membro("canela", "canela", op ? "quadril" : "canela", PERNA.joelho, PERNA.tornozelo);
  m.peca("pe", "pe", op ? "quadril" : "pe", { x: PERNA.tornozelo.x + 22, y: 13 });
  m.peca("quadril", "quadril", "quadril", { x: -2, y: 194 });
  // braco da frente
  m.segmento("braco", "tronco", BRACO.ombro, BRACO.cotovelo);
  m.segmento("antebraco", "braco", BRACO.cotovelo, BRACO.pulso);
  m.osso("mao", "antebraco", BRACO.pulso, ang(BRACO.cotovelo, BRACO.pulso), 14);
  const solto = !!o.bracoSolto;
  m.membro("braco", "braco", solto ? "root" : "braco", BRACO.ombro, BRACO.cotovelo);
  m.membro("antebraco", "antebraco", solto ? "root" : "antebraco", BRACO.cotovelo, BRACO.pulso);
  m.peca("mao", "mao", solto ? "root" : "mao", BRACO.pulso);
  if (o.pedra) m.peca("pedra", "pedra", "root", { x: GEO.pedra.x + 22, y: 20 });
  if (o.ikPernas) {
    const pai = o.ikPernas;
    const raizOuQuadril = pai === "raiz" ? "root" : "quadril";
    m.osso("canela_alvo", raizOuQuadril, PERNA.tornozelo, 0, 0, "ff3f00ff");
    m.osso("canela_e_alvo", raizOuQuadril, PERNA_E.tornozelo, 0, 0, "ff3f00ff");
    // o joelho desenhado vai para a frente (a direita): a dobra que mantem isso
    m.restricoes.push({ tipo: "ik", nome: "canela_ik", ossos: ["coxa", "canela"], alvo: "canela_alvo", dobra_positiva: dobraFrente(PERNA) });
    m.restricoes.push({ tipo: "ik", nome: "canela_e_ik", ossos: ["coxa_e", "canela_e"], alvo: "canela_e_alvo", dobra_positiva: dobraFrente(PERNA_E) });
  }
  if (o.ikBraco) {
    m.osso("antebraco_alvo", "root", BRACO.pulso, 0, 0, "ff3f00ff");
    m.restricoes.push({ tipo: "ik", nome: "antebraco_ik", ossos: ["braco", "antebraco"], alvo: "antebraco_alvo", dobra_positiva: cruz(BRACO.ombro, BRACO.cotovelo, BRACO.pulso) > 0 });
  }
  return m;
}
// lado da dobra (o mesmo calculo do ik.create): sinal de (b - a) x (c - b)
function cruz(a: P, b: P, c: P) {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}
const dobraFrente = (p: typeof PERNA) => cruz(p.quadril, p.joelho, p.tornozelo) > 0;

// ---- as cenas (a ordem e os nomes vem de src/core/tutorial.ts)
const fazer: Record<string, () => Montagem> = {
  // 1. prender: os ossos do braco existem, as pecas estao na raiz; "acenar" mostra o problema
  prender() {
    const m = tico({ bracoSolto: true });
    m.animacoes.acenar = {
      ossos: {
        braco: { girar: [{ valor: 0 }, { tempo: 0.4, valor: 70 }, { tempo: 0.8, valor: 0 }] },
        antebraco: { girar: [{ valor: 0 }, { tempo: 0.2, valor: 40 }, { tempo: 0.4, valor: 60 }, { tempo: 0.6, valor: 20 }, { tempo: 0.8, valor: 0 }] },
      },
    };
    return m;
  },
  // 2. ossos: a perna da frente sem ossos, as pecas no quadril; aneis nas juntas
  ossos() {
    const m = tico({ pernaComOssos: false });
    for (const [k, p] of Object.entries(PERNA)) m.peca(`guia_${k}`, "junta", "root", p);
    return m;
  },
  // 3. alcancar: perna rigada sem IK, uma pedra e a marca onde o tornozelo tem de chegar
  alcancar() {
    const m = tico({ pedra: true });
    m.peca("marca", "marca", "root", ALVO_PEDRA);
    return m;
  },
  // 4. dobra: IK nas pernas, o pe da frente em cima da pedra e a dobra da frente trocada
  dobra() {
    const m = tico({ ikPernas: "raiz", pedra: true });
    m.achar("canela_alvo").x = ALVO_PEDRA.x;
    m.achar("canela_alvo").y = ALVO_PEDRA.y;
    m.restricoes[0].dobra_positiva = !m.restricoes[0].dobra_positiva;
    m.peca("marca", "marca", "root", ALVO_PEDRA);
    return m;
  },
  // 5. chao: alvos presos no quadril; "agachar" afunda os pes no chao
  chao() {
    const m = tico({ ikPernas: "quadril" });
    m.animacoes.agachar = AGACHAR;
    return m;
  },
  // 6. agachar: o rig pronto (alvos na raiz), sem a animacao
  agachar() {
    return tico({ ikPernas: "raiz" });
  },
  // 7. bola: braco com IK num alvo proprio; a bola passa e a mao nao vai junto
  bola() {
    const m = tico({ ikPernas: "raiz", ikBraco: true });
    m.osso("bola", "root", BOLA[0], 0, 0, "ffcf3dff");
    m.peca("bola", "bola", "bola", BOLA[0]);
    const base = BOLA[0];
    m.animacoes.bola_passa = {
      ossos: {
        bola: {
          mover: BOLA.map((p, i) => ({ ...(i ? { tempo: r3(i * 0.5) } : {}), x: r3(p.x - base.x), y: r3(p.y - base.y) })),
        },
      },
    };
    return m;
  },
};
const ALVO_PEDRA: P = GEO.pedra;
// o quadril desce 50 px e volta (licao 5)
const AGACHAR = {
  ossos: {
    quadril: {
      mover: [
        { x: 0, y: 0 },
        { tempo: 0.4, x: 0, y: -50 },
        { tempo: 0.9, x: 0, y: 0 },
      ],
    },
  },
};
// a bola faz uma volta na frente do Tico, ao alcance do braco (do ombro ate 128 px)
const BOLA: P[] = [
  { x: 74, y: 228 },
  { x: 96, y: 290 },
  { x: 60, y: 350 },
  { x: 100, y: 256 },
  { x: 74, y: 228 },
];

// ---- o monstro (o Clique azul), de frente: pontos do mundo, chao em 0
type OpcoesMonstro = {
  rostoSolto?: boolean; // olhos, nariz e boca na raiz (licao de montar)
  semOssosD?: boolean; // perna da direita sem ossos, presa no quadril (licao dos ossos)
  malha?: ("d" | "e")[]; // pernas que ja dobram pela malha
  ik?: boolean;
};
const MP = GEO_MONSTRO;
const ESC_OLHO = 0.62;
function monstro(o: OpcoesMonstro): Montagem {
  const m = new Montagem();
  m.pag = PAG_MONSTRO;
  m.peca("chao", "chao", "root", { x: 0, y: -8 }, 0, 0.5);
  m.osso("quadril", "root", { x: 0, y: 135 }, 0, 0, "ffb400ff");
  m.osso("corpo", "quadril", { x: 0, y: 125 }, 90, 82);
  // as pernas: a imagem inteira com a bola do quadril no ponto do quadril (55 x 149, bola em 16,14)
  for (const lado of ["e", "d"] as const) {
    const g = lado === "d" ? MP.pernaD : MP.pernaE;
    const semOssos = lado === "d" && o.semOssosD;
    if (!semOssos) {
      m.segmento(`coxa_${lado}`, "quadril", g.quadril, g.joelho);
      m.segmento(`canela_${lado}`, `coxa_${lado}`, g.joelho, g.tornozelo);
    }
    const cx = lado === "d" ? g.quadril.x - 16 + 27.5 : g.quadril.x + 16 - 27.5;
    m.peca(`perna_${lado}`, `perna_${lado}`, semOssos ? "quadril" : `coxa_${lado}`, { x: cx, y: 74.5 });
  }
  // bracos e orelhas atras do corpo, presos nele (o braco: bola do ombro em 28.5, 29 da imagem 98 x 181)
  for (const [lado, sx] of [["e", -1], ["d", 1]] as const) {
    m.peca(`braco_${lado}`, `braco_${lado}`, "corpo", { x: sx * (70 - 28.5 + 49), y: 200 + 29 - 90.5 });
    m.peca(`orelha_${lado}`, `orelha_${lado}`, "corpo", { x: sx * 74, y: 293 }, 0, 0.95);
  }
  // o corpo depois das pernas e dos bracos: a bola do quadril e o ombro ficam atras
  m.peca("corpo", "corpo", "corpo", { x: 0, y: 125 + 82.5 });
  const rosto = o.rostoSolto ? "root" : "corpo";
  m.peca("olho_e", "olho", rosto, { x: -74, y: 293 }, 0, ESC_OLHO);
  m.peca("olho_d", "olho", rosto, { x: 74, y: 293 }, 0, ESC_OLHO);
  m.peca("nariz", "nariz", rosto, { x: 0, y: 216 }, 0, 0.8);
  m.peca("boca", "boca", rosto, { x: 0, y: 175 }, 0, 0.6);
  // as malhas: os mesmos comandos dos botoes Deixar deformavel e Dobrar com os ossos
  for (const lado of o.malha ?? []) {
    m.comandos.push({ cmd: "mesh.create", args: { slot: `perna_${lado}`, name: `perna_${lado}`, detail: 1.8 } });
    m.comandos.push({ cmd: "mesh.weights", args: { slot: `perna_${lado}`, attachment: `perna_${lado}`, bones: [`coxa_${lado}`, `canela_${lado}`, "quadril"] } });
  }
  if (o.ik)
    for (const lado of ["d", "e"] as const) {
      const g = lado === "d" ? MP.pernaD : MP.pernaE;
      m.osso(`canela_${lado}_alvo`, "root", g.tornozelo, 0, 0, "ff3f00ff");
      m.restricoes.push({ tipo: "ik", nome: `canela_${lado}_ik`, ossos: [`coxa_${lado}`, `canela_${lado}`], alvo: `canela_${lado}_alvo`, dobra_positiva: cruz(g.quadril, g.joelho, g.tornozelo) > 0 });
    }
  return m;
}
fazer["m-montar"] = () => {
  const m = monstro({ rostoSolto: true, malha: ["d", "e"] });
  m.animacoes.pular = { ossos: { quadril: { mover: [{ x: 0, y: 0 }, { tempo: 0.3, x: 0, y: 70 }, { tempo: 0.6, x: 0, y: 0 }] } } };
  return m;
};
fazer["m-ossos"] = () => {
  const m = monstro({ semOssosD: true });
  for (const [k, p] of Object.entries(MP.pernaD)) m.peca(`guia_${k}`, "junta", "root", p, 0, 0.8);
  return m;
};
fazer["m-malha"] = () => {
  const m = monstro({ malha: ["e"] });
  const chute = (g: number) => [{ valor: 0 }, { tempo: 0.3, valor: g }, { tempo: 0.7, valor: g }, { tempo: 1, valor: 0 }];
  m.animacoes.chutar = { ossos: { canela_d: { girar: chute(25) }, canela_e: { girar: chute(-25) } } };
  return m;
};
fazer["m-pes"] = () => {
  const m = monstro({ malha: ["d", "e"] });
  m.animacoes.agachar = { ossos: { quadril: { mover: [{ x: 0, y: 0 }, { tempo: 0.4, x: 0, y: -12 }, { tempo: 0.9, x: 0, y: 0 }] } } };
  return m;
};
fazer["m-pulo"] = () => monstro({ malha: ["d", "e"], ik: true });

// as imagens para os comandos (o contorno da malha), lidas da pagina gravada
const provDe = (texto: string): AssetProvider => {
  const atlas = parseAtlas(texto);
  return {
    async image(nome) {
      const r = atlas.regions.find((x) => x.name === nome);
      const pg = r && atlas.pages.find((p) => p.name === r.page);
      if (!r || !pg) return null;
      const png = await extractRegion(sharp(join(SAIDA, pg.name)), r);
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data };
    },
    region(nome) {
      const r = atlas.regions.find((x) => x.name === nome);
      return r ? { width: r.originalWidth, height: r.originalHeight } : null;
    },
  };
};

for (const c of CENAS_TUTORIAL) {
  const f = fazer[c.id];
  if (!f) throw new Error(`cena sem gerador: ${c.id}`);
  const m = f();
  let b: any = m.boneco(c.id, m.pag);
  if (m.comandos.length) {
    const ex = exportarSpine(b);
    const doc = Document.fromText(JSON.stringify(ex.json), { text: ex.atlas, pages: {} });
    await executeAsync(doc, m.comandos, "gerador", "malhas", {}, provDe(ex.atlas));
    b = importarSpine(doc.json, ex.atlas, c.id);
  }
  writeFileSync(join(SAIDA, `${c.id}.boneco.original`), JSON.stringify(b, null, 1) + "\n");
}
console.log(`${CENAS_TUTORIAL.length} cenas em ${SAIDA}`);
