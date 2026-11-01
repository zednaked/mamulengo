// A UI: um case de como a interface de um jogo se comporta, com o UI Pack da Kenney (CC0). Tres
// telas num laco de 11,6 s (animacao "ui"), com um cursor que faz o que o jogador faria:
//
//   0,0-3,1   menu principal: o painel entra passando um pouco do tamanho, o titulo cai, os botoes
//             sobem um depois do outro; o cursor passa por JOGAR (cresce), clica (afunda) e solta
//             (repique); tudo sai mais rapido que entrou, na ordem inversa
//   3,1-7,0   opcoes: o painel desliza da direita; o cursor liga o som (o visto aparece com um
//             pulo), arrasta o volume (a barra acompanha) e volta pela seta (o painel sai pela
//             direita)
//   7,1-11,6  premio: o fundo escurece, o popup salta, as tres estrelas entram uma por uma com um
//             clarao (biblioteca de efeitos), COLETAR pulsa ate o clique, o popup fecha num puff
//
//   npx tsx exemplos/ui/gerar.ts      (escreve exemplos/ui/ui.boneco e ui.png)
//
// As pecas estao em fontes/ (PNG em 2x do UI Pack, a fonte Kenney Future e o License.txt); os
// textos, o painel, o fundo e o cursor saem daqui.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { porEfeito } from "../../server/efeitos.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTES = join(AQUI, "fontes");
const HD = 2;
export const DUR = 11.6;
const FPS = 30;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, z: number) => Math.min(z, Math.max(a, x));
// curvas de interface: sai rapido e assenta (out), passa do ponto e volta (back)
const fr = (t: number, a: number, z: number) => clamp((t - a) / (z - a), 0, 1);
const out = (x: number) => 1 - (1 - x) ** 3;
const inn = (x: number) => x * x * x;
const back = (x: number, s = 1.7) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const mix = (a: number, z: number, f: number) => a + (z - a) * f;

// ---- imagens: pecas do pacote, textos na fonte do pacote e as desenhadas (SVG)
type Img = { nome: string; buf: Buffer; w: number; h: number };
const imgs: Img[] = [];
async function poe(nome: string, buf: Buffer) {
  const m = await sharp(buf).metadata();
  const im = { nome, buf, w: m.width!, h: m.height! };
  imgs.push(im);
  return im;
}
const peca = (nome: string, arq: string) => poe(nome, readFileSync(join(FONTES, arq + ".png")));
function texto(nome: string, t: string, px: number, cor: string, sombra?: string) {
  const r = spawnSync("magick", ["-background", "none", "-fill", cor, "-font", join(FONTES, "kenney-future.ttf"), "-pointsize", String(px * HD), `label:${t}`, "png:-"], { maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  let buf = r.stdout as Buffer;
  if (sombra) {
    // sombra dura 2 px para baixo (o estilo dos botoes da Kenney)
    const s = spawnSync("magick", ["png:-", "(", "+clone", "-fill", sombra, "-colorize", "100", ")", "-geometry", `+0+${2 * HD}`, "-compose", "DstOver", "-composite", "-background", "none", "-gravity", "north", "-extent", `0x0`, "png:-"], { input: buf, maxBuffer: 1 << 26 });
    if (s.status === 0) buf = s.stdout as Buffer;
  }
  return poe(nome, buf);
}
const svg = (nome: string, w: number, h: number, corpo: string) => poe(nome, Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w * HD}" height="${h * HD}" viewBox="0 0 ${w} ${h}">${corpo}</svg>`));

// o fundo vai 80 px abaixo da tela do jogo: a faixa das legendas do video (rect do export)
await svg("fundo", 960, 620, `<defs><radialGradient id="g" cx="0.5" cy="0.3" r="0.8"><stop offset="0" stop-color="#4b3f8f"/><stop offset="1" stop-color="#1c1838"/></radialGradient></defs><rect width="960" height="620" fill="url(#g)"/>`);
const painel = (nome: string, w: number, h: number) =>
  svg(nome, w, h + 10, `<rect x="0" y="10" width="${w}" height="${h}" rx="26" fill="#000" opacity="0.25"/><rect x="0" y="0" width="${w}" height="${h}" rx="26" fill="#cfc6e6"/><rect x="0" y="0" width="${w}" height="${h - 8}" rx="26" fill="#f6f2ff"/>`);
await painel("painel_menu", 360, 390);
await painel("painel_opcoes", 440, 330);
await painel("painel_premio", 440, 340);
await svg("escuro", 960, 620, `<rect width="960" height="620" fill="#000"/>`);
// o cursor (uma seta com contorno) e o anel do toque
await svg("cursor", 34, 46, `<path d="M3 3 L3 37 L12 29 L18 43 L24 40 L18 27 L30 27 Z" fill="#fff" stroke="#1c1838" stroke-width="3" stroke-linejoin="round"/>`);
await svg("toque", 64, 64, `<circle cx="32" cy="32" r="28" fill="none" stroke="#fff" stroke-width="4"/>`);
for (const [n, a] of [["verde", "green"], ["azul", "blue"], ["vermelho", "red"]]) {
  await peca(`botao_${n}`, `${a}_depth`);
  await peca(`botao_${n}_afundado`, `${a}_flat`);
}
await peca("redondo", "round_depth");
await peca("redondo_afundado", "round_flat");
await peca("seta", "arrow_w");
await peca("caixa", "check_off");
await peca("caixa_marcada", "check_on");
await peca("trilho", "slide_grey");
await peca("trilho_cor", "slide_color");
await peca("puxador", "slide_handle");
await peca("estrela", "star");
await peca("estrela_vazia", "star_empty");
await texto("t_titulo", "MONSTROS", 44, "#4a3f78");
await texto("t_jogar", "JOGAR", 26, "#ffffff", "#1d7a4a");
await texto("t_opcoes", "OPÇÕES", 26, "#ffffff", "#1f5f9e");
await texto("t_sair", "SAIR", 26, "#ffffff", "#9e2b3a");
await texto("t_opcoes_titulo", "OPÇÕES", 36, "#4a3f78");
await texto("t_som", "SOM", 24, "#4a3f78");
await texto("t_volume", "VOLUME", 24, "#4a3f78");
await texto("t_premio", "FASE COMPLETA", 30, "#4a3f78");
await texto("t_coletar", "COLETAR", 26, "#ffffff", "#1d7a4a");

// pagina: prateleiras numa largura fixa
const LARG = 2048;
let [px, py, alt] = [0, 0, 0];
const imagens: any[] = [];
const comp: sharp.OverlayOptions[] = [];
for (const im of [...imgs].sort((a, b) => b.h - a.h)) {
  if (px + im.w > LARG) [px, py, alt] = [0, py + alt + 4, 0];
  imagens.push({ nome: im.nome, pagina: 0, ret: [px, py, im.w, im.h] });
  comp.push({ input: im.buf, left: px, top: py });
  px += im.w + 4;
  alt = Math.max(alt, im.h);
}
await sharp({ create: { width: LARG, height: py + alt, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).png().toFile(join(AQUI, "ui.png"));
const tam = (n: string) => {
  const im = imgs.find((i) => i.nome === n)!;
  return { w: im.w / HD, h: im.h / HD };
};

// ---- esqueleto: cada elemento e um osso com as pecas dele (as pecas no centro do osso, ou
// deslocadas); a ordem de desenho e a da lista
type Peca = { slot: string; img: string; x?: number; y?: number; w?: number; h?: number; cor?: string; trocas?: string[] };
type Pose = { x?: number; y?: number; s?: number; sx?: number; sy?: number; rot?: number; a?: number; img?: Record<string, string> };
type El = { nome: string; pai?: string; x: number; y: number; pecas: Peca[]; pose?: (t: number) => Pose };
const els: El[] = [];
const el = (e: El) => (els.push(e), e);

// os tempos de cada cena
const T = {
  menu: 0.1,
  hover: 1.55,
  clique: 2.1,
  solta: 2.26,
  saiMenu: 2.6,
  opcoes: 3.1,
  som: 4.15,
  agarra: 5.0,
  larga: 5.75,
  voltar: 6.5,
  saiOpcoes: 6.68,
  escuro: 7.1,
  popup: 7.25,
  estrelas: 7.9,
  coletar: 10.3,
  fecha: 10.5,
};

el({ nome: "fundo", x: 0, y: -40, pecas: [{ slot: "fundo", img: "fundo" }] });

// ---- menu principal
const entra = (t: number, t0: number, d: number) => back(fr(t, t0, t0 + d));
el({
  nome: "menu_painel",
  x: 0,
  y: -15,
  pecas: [{ slot: "menu_painel", img: "painel_menu" }],
  pose: (t) => {
    // cresce passando do ponto; na saida, uma antecipacao (cresce um pouco) e some
    const s = t < T.saiMenu + 0.2 ? entra(t, T.menu, 0.4) : mix(1.04, 0, inn(fr(t, T.saiMenu + 0.26, T.saiMenu + 0.45))) * (t < T.saiMenu + 0.26 ? 1 / 1.04 : 1) * mix(1, 1.04, fr(t, T.saiMenu + 0.2, T.saiMenu + 0.26));
    return { s, a: Math.min(fr(t, T.menu, T.menu + 0.15), 1 - fr(t, T.saiMenu + 0.3, T.saiMenu + 0.45)) };
  },
});
el({
  nome: "menu_titulo",
  x: 0,
  y: 128,
  pecas: [{ slot: "menu_titulo", img: "t_titulo" }],
  pose: (t) => ({ y: 60 * (1 - entra(t, T.menu + 0.18, 0.45)) + 30 * out(fr(t, T.saiMenu + 0.12, T.saiMenu + 0.3)), a: Math.min(fr(t, T.menu + 0.18, T.menu + 0.35), 1 - fr(t, T.saiMenu + 0.12, T.saiMenu + 0.3)) }),
});
const BOTOES = [
  { id: "jogar", cor: "verde", y: 40 },
  { id: "opcoes", cor: "azul", y: -38 },
  { id: "sair", cor: "vermelho", y: -116 },
];
for (const [i, b] of BOTOES.entries()) {
  const t0 = T.menu + 0.32 + 0.08 * i;
  // sai na ordem inversa, mais rapido que entrou
  const t1 = T.saiMenu + 0.06 * (BOTOES.length - 1 - i);
  el({
    nome: `menu_${b.id}`,
    x: 0,
    y: b.y,
    pecas: [
      { slot: `menu_${b.id}`, img: `botao_${b.cor}`, trocas: [`botao_${b.cor}_afundado`] },
      { slot: `menu_${b.id}_texto`, img: `t_${b.id}`, y: 3 },
    ],
    pose: (t) => {
      const p: Pose = { y: -40 * (1 - entra(t, t0, 0.35)) - 30 * inn(fr(t, t1, t1 + 0.2)), a: Math.min(fr(t, t0, t0 + 0.15), 1 - fr(t, t1 + 0.05, t1 + 0.2)) };
      if (b.id === "jogar") {
        // hover: cresce 6% quando o cursor chega; clique: afunda (troca a imagem, desce 4 px e
        // encolhe um pouco); ao soltar, volta com um repique
        const hover = out(fr(t, T.hover, T.hover + 0.12)) * (1 - fr(t, T.saiMenu, T.saiMenu + 0.1));
        let s = 1 + 0.06 * hover;
        if (t >= T.clique && t < T.solta) {
          s *= 0.97;
          p.y! -= 4;
          p.img = { menu_jogar: "botao_verde_afundado" };
        } else if (t >= T.solta) s *= 1 + 0.05 * Math.exp(-9 * (t - T.solta)) * Math.sin(16 * (t - T.solta));
        p.s = s;
      }
      return p;
    },
  });
}

// ---- opcoes (o grupo desliza da direita e sai pela direita)
const opX = (t: number) => (t < T.saiOpcoes ? 700 * (1 - back(fr(t, T.opcoes, T.opcoes + 0.45), 1.2)) : 700 * inn(fr(t, T.saiOpcoes, T.saiOpcoes + 0.3)));
el({ nome: "opcoes", x: 0, y: 0, pecas: [], pose: (t) => ({ x: opX(t), s: t > T.opcoes - 0.01 && t < T.saiOpcoes + 0.32 ? 1 : 0 }) });
el({ nome: "opcoes_painel", pai: "opcoes", x: 0, y: -10, pecas: [{ slot: "opcoes_painel", img: "painel_opcoes" }] });
el({ nome: "opcoes_titulo", pai: "opcoes", x: 0, y: 105, pecas: [{ slot: "opcoes_titulo", img: "t_opcoes_titulo" }] });
el({ nome: "opcoes_som", pai: "opcoes", x: -95, y: 35, pecas: [{ slot: "opcoes_som", img: "t_som" }] });
const CAIXA = { x: 120, y: 35 };
el({
  nome: "opcoes_caixa",
  pai: "opcoes",
  ...CAIXA,
  pecas: [{ slot: "opcoes_caixa", img: "caixa", w: 40, h: 40, trocas: ["caixa_marcada"] }],
  // o visto aparece com um pulo
  pose: (t) => (t < T.som ? {} : { s: 1 + 0.35 * Math.exp(-8 * (t - T.som)) * Math.sin(Math.min(Math.PI, (t - T.som) * 14)) - 0.12 * Math.exp(-18 * (t - T.som)), img: { opcoes_caixa: "caixa_marcada" } }),
});
el({ nome: "opcoes_volume", pai: "opcoes", x: -95, y: -40, pecas: [{ slot: "opcoes_volume", img: "t_volume" }] });
// o volume: trilho cinza, a parte cheia (cresce da esquerda) e o puxador; de 0,3 a 0,85
const TRILHO = { x: 120, y: -40, w: 150 };
const vol = (t: number) => mix(0.3, 0.85, io(fr(t, T.agarra + 0.05, T.larga - 0.1)));
el({ nome: "opcoes_trilho", pai: "opcoes", ...TRILHO, pecas: [{ slot: "opcoes_trilho", img: "trilho", w: TRILHO.w, h: 18 }] });
el({
  nome: "opcoes_cheio",
  pai: "opcoes",
  x: TRILHO.x - TRILHO.w / 2,
  y: TRILHO.y,
  pecas: [{ slot: "opcoes_cheio", img: "trilho_cor", x: TRILHO.w / 2, w: TRILHO.w, h: 18 }],
  pose: (t) => ({ sx: Math.max(0.02, vol(t)) }),
});
const puxX = (t: number) => TRILHO.x - TRILHO.w / 2 + TRILHO.w * vol(t);
el({
  nome: "opcoes_puxador",
  pai: "opcoes",
  x: puxX(0),
  y: TRILHO.y + 4,
  pecas: [{ slot: "opcoes_puxador", img: "puxador", w: 26, h: 34 }],
  // agarrado: cresce; a posicao acompanha o volume
  pose: (t) => ({ x: puxX(t) - puxX(0), s: 1 + 0.18 * out(fr(t, T.agarra, T.agarra + 0.1)) * (1 - out(fr(t, T.larga, T.larga + 0.12))) }),
});
const VOLTAR = { x: -165, y: -125 };
el({
  nome: "opcoes_voltar",
  pai: "opcoes",
  ...VOLTAR,
  pecas: [
    { slot: "opcoes_voltar", img: "redondo", w: 56, h: 56, trocas: ["redondo_afundado"] },
    { slot: "opcoes_voltar_seta", img: "seta", y: 3, w: 26, h: 26 },
  ],
  pose: (t) => {
    const hover = out(fr(t, T.voltar - 0.25, T.voltar - 0.13));
    const p: Pose = { s: 1 + 0.08 * hover };
    if (t >= T.voltar && t < T.voltar + 0.14) {
      p.s! *= 0.95;
      p.y = -3;
      p.img = { opcoes_voltar: "redondo_afundado" };
    }
    return p;
  },
});

// ---- premio
el({ nome: "escuro", x: 0, y: -40, pecas: [{ slot: "escuro", img: "escuro", cor: "ffffff00" }], pose: (t) => ({ a: 0.6 * Math.min(out(fr(t, T.escuro, T.escuro + 0.25)), 1 - fr(t, T.fecha + 0.1, T.fecha + 0.4)) }) });
const popS = (t: number) => (t < T.fecha ? back(fr(t, T.popup, T.popup + 0.4), 2.2) : mix(1.04, 0, inn(fr(t, T.fecha + 0.06, T.fecha + 0.26))) * (t < T.fecha + 0.06 ? mix(1, 1.04, fr(t, T.fecha, T.fecha + 0.06)) / 1.04 : 1));
el({ nome: "premio", x: 0, y: 10, pecas: [], pose: (t) => ({ s: popS(t), a: Math.min(fr(t, T.popup, T.popup + 0.12), 1 - fr(t, T.fecha + 0.15, T.fecha + 0.26)) }) });
el({ nome: "premio_painel", pai: "premio", x: 0, y: -5, pecas: [{ slot: "premio_painel", img: "painel_premio" }] });
el({ nome: "premio_titulo", pai: "premio", x: 0, y: 110, pecas: [{ slot: "premio_titulo", img: "t_premio" }], pose: (t) => ({ y: 30 * (1 - back(fr(t, T.popup + 0.2, T.popup + 0.5))), a: fr(t, T.popup + 0.2, T.popup + 0.32) }) });
const ESTRELAS = [
  { x: -95, y: 20, s: 0.9 },
  { x: 0, y: 38, s: 1.1 },
  { x: 95, y: 20, s: 0.9 },
];
for (const [i, e] of ESTRELAS.entries()) {
  el({ nome: `premio_vaga${i}`, pai: "premio", x: e.x, y: e.y, pecas: [{ slot: `premio_vaga${i}`, img: "estrela_vazia", w: 64 * e.s, h: 60 * e.s }] });
  const t0 = T.estrelas + 0.3 * i;
  el({
    nome: `premio_estrela${i}`,
    pai: "premio",
    x: e.x,
    y: e.y,
    pecas: [{ slot: `premio_estrela${i}`, img: "estrela", w: 64 * e.s, h: 60 * e.s }],
    // entra grande e girando, assenta com repique
    pose: (t) => ({ s: t < t0 ? 0 : back(fr(t, t0, t0 + 0.35), 2.6), rot: -40 * (1 - out(fr(t, t0, t0 + 0.35))) }),
  });
}
el({
  nome: "premio_coletar",
  pai: "premio",
  x: 0,
  y: -95,
  pecas: [
    { slot: "premio_coletar", img: "botao_verde", trocas: ["botao_verde_afundado"] },
    { slot: "premio_coletar_texto", img: "t_coletar", y: 3 },
  ],
  pose: (t) => {
    // chamada para acao: pulsa ate ser tocado
    const pulso = t > T.estrelas + 0.9 && t < T.coletar - 0.25 ? 0.05 * Math.sin((2 * Math.PI * (t - T.estrelas - 0.9)) / 0.7) ** 2 : 0;
    const p: Pose = { s: 1 + pulso + 0.06 * out(fr(t, T.coletar - 0.25, T.coletar - 0.13)), a: fr(t, T.popup + 0.3, T.popup + 0.45) };
    if (t >= T.coletar && t < T.coletar + 0.15) {
      p.s! *= 0.97;
      p.y = -4;
      p.img = { premio_coletar: "botao_verde_afundado" };
    }
    return p;
  },
});

// ---- o cursor: caminho por pontos (tempo, x, y), com a curva io entre eles; toques nos cliques
const CAMINHO: [number, number, number][] = [
  [0, 520, -330],
  [0.9, 520, -330],
  [T.hover, 18, 30],
  [T.saiMenu + 0.1, 18, 30],
  [T.som - 0.45, 260, -60],
  [T.som - 0.05, CAIXA.x + 10, CAIXA.y - 10],
  [T.agarra - 0.15, CAIXA.x + 10, CAIXA.y - 10],
  [T.agarra, puxX(0) + 6, TRILHO.y - 8],
  [T.agarra + 0.05, puxX(0) + 6, TRILHO.y - 8],
  [T.larga - 0.1, TRILHO.x - TRILHO.w / 2 + TRILHO.w * 0.85 + 6, TRILHO.y - 8],
  [T.larga + 0.1, TRILHO.x - TRILHO.w / 2 + TRILHO.w * 0.85 + 6, TRILHO.y - 8],
  [T.voltar - 0.05, VOLTAR.x + 8, VOLTAR.y - 8],
  [T.saiOpcoes + 0.3, VOLTAR.x + 8, VOLTAR.y - 8],
  [T.estrelas + 1.2, 260, -200],
  [T.coletar - 0.05, 14, -112],
  [T.fecha + 0.15, 14, -112],
  [T.fecha + 0.8, 520, -330],
  [DUR, 520, -330],
];
const cursor = (t: number): [number, number] => {
  for (let k = 0; k + 1 < CAMINHO.length; k++) {
    const [t0, x0, y0] = CAMINHO[k],
      [t1, x1, y1] = CAMINHO[k + 1];
    if (t <= t1) {
      const f = io(fr(t, t0, t1));
      return [mix(x0, x1, f), mix(y0, y1, f)];
    }
  }
  return [CAMINHO.at(-1)![1], CAMINHO.at(-1)![2]];
};
const CLIQUES = [T.clique, T.som - 0.02, T.agarra, T.voltar, T.coletar];
el({
  nome: "cursor",
  x: 0,
  y: 0,
  // a ponta da seta no ponto do osso
  pecas: [
    { slot: "toque", img: "toque", cor: "ffffff00" },
    { slot: "cursor", img: "cursor", x: 15, y: -21 },
  ],
  pose: (t) => {
    const [x, y] = cursor(t);
    // no clique a seta encolhe um pouco
    const aperto = CLIQUES.some((c) => t >= c && t < c + 0.12) ? 0.88 : 1;
    return { x, y, s: aperto };
  },
});

// ---- o .boneco: ossos, slots e partes; a animacao amostrada
const ossos: any[] = [{ nome: "root" }];
const slots: any[] = [];
const partes: Record<string, any> = {};
for (const e of els) {
  ossos.push({ nome: e.nome, pai: e.pai ?? "root", ...(e.x ? { x: e.x } : {}), ...(e.y ? { y: e.y } : {}) });
  for (const p of e.pecas) {
    const t = tam(p.img);
    slots.push({ nome: p.slot, osso: e.nome, parte: p.img, ...(p.cor ? { cor: p.cor } : {}) });
    const parte = (img: string) => ({ ...(p.x ? { x: p.x } : {}), ...(p.y ? { y: p.y } : {}), largura: r3(p.w ?? tam(img).w), altura: r3(p.h ?? tam(img).h) });
    partes[p.slot] = { [p.img]: parte(p.img) };
    for (const tr of p.trocas ?? []) partes[p.slot][tr] = parte(tr);
    void t;
  }
}
const anim: any = { ossos: {}, slots: {} };
const N = Math.round(DUR * FPS);
for (const e of els) {
  if (!e.pose) continue;
  const tl: Record<string, any[]> = {};
  const poe = (k: string, v: any) => (tl[k] ??= []).push(v);
  for (let q = 0; q <= N; q++) {
    const t = r3(q / FPS);
    const p = e.pose(t);
    poe("mover", { tempo: t, x: r3(p.x ?? 0), y: r3(p.y ?? 0) });
    poe("escalar", { tempo: t, x: r3((p.s ?? 1) * (p.sx ?? 1)), y: r3((p.s ?? 1) * (p.sy ?? 1)) });
    poe("girar", { tempo: t, valor: r3(p.rot ?? 0) });
    for (const pc of e.pecas)
      if (pc.trocas) {
        const nome = p.img?.[pc.slot] ?? pc.img;
        const l = ((anim.slots[pc.slot] ??= {}).parte ??= []);
        if (!l.length || l[l.length - 1].nome !== nome) l.push({ tempo: t, nome });
      }
  }
  // tira as timelines que nao mudam
  for (const [k, ks] of Object.entries(tl)) if (ks.some((x) => JSON.stringify({ ...x, tempo: 0 }) !== JSON.stringify({ ...ks[0], tempo: 0 }))) (anim.ossos[e.nome] ??= {})[k] = ks;
}
// transparencia: o alfa de cada peca e o do elemento vezes o do grupo (o pai); so onde algum deles
// anima o alfa
for (const e of els) {
  const pai = els.find((x) => x.nome === e.pai);
  const temA = (x?: El) => !!x?.pose && x.pose(1).a !== undefined;
  if (!temA(e) && !temA(pai)) continue;
  for (const pc of e.pecas) {
    const base = pc.cor ?? "ffffffff";
    const l = ((anim.slots[pc.slot] ??= {}).rgba = [] as any[]);
    for (let q = 0; q <= N; q++) {
      const t = r3(q / FPS);
      // o escuro tem o alfa inteiro na pose (a cor de base dele e transparente)
      const a = (e.pose?.(t).a ?? 1) * (pai?.pose?.(t).a ?? 1) * (pc.slot === "escuro" ? 1 : parseInt(base.slice(6), 16) / 255);
      l.push({ tempo: t, cor: base.slice(0, 6) + Math.round(255 * clamp(a, 0, 1)).toString(16).padStart(2, "0") });
    }
  }
}
// o toque: um anel que abre e some a cada clique
{
  const ks: any[] = [];
  const kse: any[] = [];
  for (let q = 0; q <= N; q++) {
    const t = r3(q / FPS);
    const c = CLIQUES.find((c) => t >= c && t < c + 0.4);
    const f = c === undefined ? 1 : (t - c) / 0.4;
    ks.push({ tempo: t, cor: "ffffff" + Math.round(200 * (1 - out(f))).toString(16).padStart(2, "0") });
    kse.push({ tempo: t, x: r3(0.3 + 0.9 * out(f)), y: r3(0.3 + 0.9 * out(f)) });
  }
  anim.slots.toque = { rgba: ks };
  // o anel fica num osso proprio, filho do cursor, para escalar sem mexer na seta
  ossos.push({ nome: "toque", pai: "cursor" });
  slots.find((s) => s.nome === "toque").osso = "toque";
  anim.ossos.toque = { escalar: kse };
}

const b: any = {
  boneco: 0,
  nome: "ui",
  paginas: [{ arquivo: "ui.png", tamanho: [LARG, py + alt] }],
  imagens,
  esqueleto: { versao_spine: "4.3.23", x: -480, y: -350, largura: 960, altura: 620 },
  ossos,
  slots,
  skins: [{ nome: "default", partes }],
  animacoes: { ui: anim },
};
const ARQ = join(AQUI, "ui.boneco");
writeFileSync(ARQ, JSON.stringify(b, null, 1) + "\n");

// ---- efeitos da biblioteca: o clarao das estrelas e o puff do popup fechando
for (const ef of ["flash", "puff"]) await porEfeito(ARQ, ef);
{
  const lib = JSON.parse(readFileSync(join(AQUI, "../../biblioteca/efeitos/efeitos.json"), "utf8"));
  const bb = JSON.parse(readFileSync(ARQ, "utf8"));
  const pt = (en: Record<string, any>) => ({
    taxa: en.rate,
    vida: en.life,
    velocidade: en.speed,
    angulo: en.angle,
    abertura: en.spread,
    ...(en.gravity ? { gravidade: en.gravity } : {}),
    ...(en.drag ? { arrasto: en.drag } : {}),
    escala: en.scale,
    giro: en.spin,
    cor: en.color,
    ...(en.blend === "additive" ? { blend: "aditivo" } : {}),
  });
  const vars = (n: string) => lib[n].imagens.map((i: string) => `efeito_${i}`);
  bb.particulas = [
    ...ESTRELAS.map((_, i) => ({ nome: `clarao${i}`, slot: `premio_estrela${i}`, osso: `premio_estrela${i}`, imagem: vars("flash")[0], variacoes: vars("flash"), ...pt(lib.flash.emissor), escala: [0.35, 0.75], cor: ["fff3a0ff", "ffd23c00"] })),
    { nome: "puff", slot: "premio_coletar_texto", osso: "premio", imagem: vars("puff")[0], variacoes: vars("puff"), ...pt(lib.puff.emissor) },
  ];
  bb.animacoes.ui.particulas = {
    ...Object.fromEntries(ESTRELAS.map((_, i) => [`clarao${i}`, { rajada: [{ tempo: r3(T.estrelas + 0.3 * i + 0.05), quantidade: 3 }] }])),
    puff: { rajada: [{ tempo: r3(T.fecha + 0.2), quantidade: 16 }] },
  };
  writeFileSync(ARQ, JSON.stringify(bb, null, 1) + "\n");
}
console.log(`ui.boneco: ${els.length} elementos, ${slots.length} slots, ${imgs.length} imagens, ${DUR} s`);
