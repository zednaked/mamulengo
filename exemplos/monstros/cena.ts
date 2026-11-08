// A coreografia dos monstros, num laco de 10 s (animacao "cena"):
//
//   0,0-0,6  todos respiram, cada um no seu ritmo; piscadas espalhadas pela cena toda
//   0,6-2,8  o azul acena com o braco da esquerda; os outros viram o rosto para ele
//   2,8-4,6  o vermelho agacha, pula e cai pesado; o amarelo, do lado, leva um susto
//   4,6-6,6  o verde gargalha (olhos fechados, boca aberta, chacoalha, bate nas pernas); o marrom fica bravo:
//            sobrancelhas para baixo, os quatro bracos se debatem e ele pisa duas vezes
//   6,6-8,8  a ola: um pulo com os bracos para cima, da esquerda para a direita, e um pulinho de
//            todos juntos no fim
//   8,8-10,0 tudo assenta na pose do comeco (o laco fecha)
//
// Cada pose sai de funcoes do tempo, amostradas a 30 por segundo. Os valores das timelines sao
// relativos ao setup: girar soma, mover desloca no espaco do pai, escalar multiplica. O corpo
// aponta para cima (giro 90): a escala x do osso e a altura, a y e a largura; no rosto e nos
// ossos presos ao corpo, mover (x, y) do pai e (cima, esquerda) no mundo.
import type { Rig } from "./gerar.ts";

export const DUR = 10;
const FPS = 30;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, z: number) => Math.min(z, Math.max(a, x));
const suave = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// sobe de 0 a 1 entre a e b, fica, e desce entre c e d
const janela = (t: number, a: number, b: number, c: number, d: number) => suave((t - a) / (b - a)) * (1 - suave((t - c) / (d - c)));
const sino = (t: number, a: number, z: number) => (t <= a || t >= z ? 0 : Math.sin((Math.PI * (t - a)) / (z - a)));
const onda = (t: number, periodo: number, fase = 0) => Math.sin((2 * Math.PI * (t - fase)) / periodo);
const fr01 = (t: number, a: number, z: number) => clamp((t - a) / (z - a), 0, 1);

// um pulo: agacha (prep), sobe e cai (ar) e amassa ao cair (queda); y do corpo inteiro e a
// deformacao (altura e largura do corpo)
function pulo(t: number, t0: number, prep: number, ar: number, h: number, peso = 1) {
  const decola = t0 + prep,
    pousa = decola + ar;
  let y = 0,
    agacha = 0,
    alto = 1,
    largo = 1,
    noAr = 0;
  if (t > t0 && t < decola) {
    const f = suave((t - t0) / prep);
    agacha = 12 * peso * f;
    alto = 1 - 0.12 * peso * f;
    largo = 1 + 0.1 * peso * f;
  } else if (t >= decola && t < pousa) {
    const f = (t - decola) / ar;
    y = 4 * h * f * (1 - f);
    noAr = Math.sin(Math.PI * f);
    // estica ao sair e ao chegar, redondo no alto
    const est = 0.14 * peso * (1 - Math.sin(Math.PI * f));
    alto = 1 + est;
    largo = 1 - est * 0.7;
  } else if (t >= pousa && t < pousa + 0.45) {
    // amassa e volta com um repique
    const f = (t - pousa) / 0.45;
    const m = Math.exp(-5 * f) * Math.cos(2.5 * Math.PI * f);
    agacha = 16 * peso * m;
    alto = 1 - 0.16 * peso * m;
    largo = 1 + 0.13 * peso * m;
  }
  return { y, agacha, alto, largo, noAr };
}

type Pose = {
  raiz: { x: number; y: number };
  quadril: { x: number; y: number };
  corpo: { giro: number; alto: number; largo: number; x: number; y: number }; // x, y: o corpo sobre o quadril (nao dobra os joelhos)
  rosto: { x: number; y: number }; // no mundo
  bracos: number[][]; // [ombro, cotovelo] por braco, giro em graus (para cima = lado * +)
  pes: { x: number; y: number }[];
  sobrancelhas: { y: number; giro: number };
  olhosFechados: boolean;
  olhosEscala: number;
  boca: string | null; // null: a de base
  camera?: number; // objetos na mao (alfa), nas animacoes do VT
  fotinho?: number;
};

const PISCA: Record<string, number[]> = { amarelo: [1.3, 7.4], vermelho: [2.1, 9.3], azul: [0.35, 6.1], verde: [3.4, 8.4], marrom: [2.5, 9.0] };
const pisca = (id: string, t: number) => (PISCA[id] ?? []).some((p) => t >= p && t < p + 0.12);

// a pose de base: respirar, o balancinho no ritmo (o que sacode a geleia) e os bracos soltos;
// as cenas somam a coreografia delas por cima
function poseBase(rigs: Rig[], i: number, t: number): Pose {
  const r = rigs[i];
  const id = r.m.id;
  const p: Pose = {
    raiz: { x: 0, y: 0 },
    quadril: { x: 0, y: 0 },
    corpo: { giro: 0, alto: 1, largo: 1, x: 0, y: 0 },
    rosto: { x: 0, y: 0 },
    bracos: r.bracos.map(() => [0, 0]),
    pes: r.pernas.map(() => ({ x: 0, y: 0 })),
    sobrancelhas: { y: 0, giro: 0 },
    olhosFechados: pisca(id, t),
    olhosEscala: 1,
    boca: null,
  };
  // respirar: periodos que fecham nos 10 s (1,25 s; 2 s; 2,5 s), fases diferentes
  const per = [1.25, 2, 1.25, 2.5, 2][i];
  const resp = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - i * 0.23)) / per);
  p.corpo.y -= 3 * resp;
  // o balancinho no ritmo (o que sacode a geleia): a cada batida de 0,625 s um passinho seco de
  // lado, alternando, e uma descidinha; cada um entra numa fracao diferente da batida
  {
    const B = 0.625;
    const u = (t + i * 0.11) / B;
    const k = Math.floor(u),
      f = u - k;
    const lado = k % 2 ? 1 : -1;
    // chega em 0,035 s e fica (o tranco seco que faz a geleia chacoalhar), de um lado ao outro
    const ida = Math.min(1, f / (0.035 / B));
    p.corpo.x += 14 * (lado * ida - lado * (1 - ida));
    p.corpo.giro += 7 * (lado * ida - lado * (1 - ida));
    // e o boing: amassa de uma vez na batida e volta
    const boing = Math.exp(-f * 10) * Math.min(1, f / (0.03 / B));
    p.corpo.y -= 8 * boing;
    p.corpo.alto *= 1 - 0.1 * boing;
    p.corpo.largo *= 1 + 0.07 * boing;
  }
  p.corpo.alto *= 1 + 0.02 * resp;
  p.corpo.largo *= 1 - 0.012 * resp;
  r.bracos.forEach((b, k) => {
    p.bracos[k][0] += b.lado * 3 * onda(t, per, i * 0.23 + 0.15 + k * 0.1);
    p.bracos[k][1] += b.lado * 4 * onda(t, per, i * 0.23 + 0.3 + k * 0.1);
  });

  return p;
}

function pose(rigs: Rig[], i: number, t: number): Pose {
  const r = rigs[i];
  const id = r.m.id;
  const azul = rigs.find((x) => x.m.id === "azul")!;
  const p = poseBase(rigs, i, t);
  const per = [1.25, 2, 1.25, 2.5, 2][i];
  void per;

  // ---- 0,6-2,8 o azul acena (o braco da esquerda, como na amostra)
  if (id === "azul") {
    const sobe = janela(t, 0.6, 0.95, 2.35, 2.8);
    const k = r.bracos.findIndex((b) => b.lado < 0 && !b.extra);
    // para cima pela esquerda: giro negativo no braco esquerdo
    p.bracos[k][0] += -125 * sobe;
    p.bracos[k][1] += -20 * sobe + 28 * sobe * onda(t, 0.36, 0.95) * janela(t, 0.9, 1.05, 2.2, 2.4);
    p.corpo.giro += 5 * sobe;
    p.quadril.y -= 3 * sino(t, 0.6, 0.95);
    if (t > 0.7 && t < 2.65) p.boca = "mouth_closed_happy";
  } else {
    // os outros olham para o azul
    const olha = janela(t, 0.85, 1.15, 2.5, 2.85);
    p.rosto.x += Math.sign(azul.m.x - r.m.x) * 7 * olha;
  }

  // ---- 2,8-4,6 o vermelho pula; o amarelo se assusta com a queda
  if (id === "vermelho") {
    const j = pulo(t, 2.8, 0.32, 0.62, 95, 1.2);
    p.raiz.y += j.y;
    p.quadril.y -= j.agacha;
    p.corpo.alto *= j.alto;
    p.corpo.largo *= j.largo;
    // bracos: para tras no agachar, para cima no ar
    const ar = janela(t, 3.05, 3.2, 3.6, 3.85);
    const prep = sino(t, 2.8, 3.15);
    r.bracos.forEach((b, k) => {
      p.bracos[k][0] += b.lado * (95 * ar - 25 * prep);
      p.bracos[k][1] += b.lado * 25 * ar;
    });
    // pes soltos no ar (um pouco para dentro e para baixo)
    r.pernas.forEach((pe, k) => {
      p.pes[k].x += -pe.lado * 6 * ar;
      p.pes[k].y += 10 * ar;
    });
    if (t > 3.1 && t < 3.95) p.boca = "mouthA";
    if (t >= 3.95 && t < 4.4) p.boca = "mouth_closed_happy";
    p.rosto.y += 4 * ar - 3 * prep;
  }
  if (id === "amarelo") {
    // o vermelho cai em 3,74: o susto vem logo depois
    const susto = janela(t, 3.78, 3.86, 4.35, 4.85);
    const j = pulo(t, 3.76, 0.04, 0.3, 26, 0.6);
    p.raiz.y += j.y;
    p.quadril.y -= j.agacha;
    p.corpo.alto *= j.alto * (1 + 0.05 * susto);
    p.corpo.largo *= j.largo;
    p.corpo.giro += -6 * susto; // inclina para longe do vermelho (que esta a direita)
    p.olhosEscala = 1 + 0.25 * susto;
    r.bracos.forEach((b, k) => {
      p.bracos[k][0] += b.lado * 45 * susto;
      p.bracos[k][1] += b.lado * 35 * susto;
    });
    if (t > 3.8 && t < 4.6) p.boca = "mouthG";
  }
  if (id === "azul") {
    // o azul so estremece com a queda
    p.quadril.y -= 4 * sino(t, 3.75, 3.95);
  }

  // ---- 4,6-6,6 o verde gargalha
  if (id === "verde") {
    const ri = janela(t, 4.6, 4.8, 6.1, 6.5);
    p.corpo.giro += -7 * ri + 4 * ri * onda(t, 0.14);
    p.quadril.y -= ri * (3 + 3 * onda(t, 0.14, 0.03));
    p.corpo.alto *= 1 + 0.03 * ri * onda(t, 0.14, 0.05);
    p.rosto.y += 3 * ri;
    // os bracos abrem e batem nas pernas no ritmo da risada
    r.bracos.forEach((b, k) => {
      p.bracos[k][0] += b.lado * ri * (30 + 14 * onda(t, 0.28, 0.07));
      p.bracos[k][1] += b.lado * ri * (20 + 18 * onda(t, 0.28, 0.12));
    });
    if (t > 4.7 && t < 6.25) {
      p.boca = "mouthH";
      p.olhosFechados = true;
    }
  }
  // o marrom fica bravo
  if (id === "marrom") {
    const bravo = janela(t, 4.9, 5.15, 6.4, 6.8);
    p.sobrancelhas.y -= 6 * bravo;
    p.sobrancelhas.giro += 28 * bravo;
    r.bracos.forEach((b, k) => {
      const fase = k * 0.11;
      p.bracos[k][0] += b.lado * bravo * (55 + 35 * onda(t, 0.42, fase));
      p.bracos[k][1] += b.lado * bravo * (25 + 30 * onda(t, 0.42, fase + 0.1));
    });
    // duas pisadas: o pe da direita e depois o da esquerda
    const pisa = (k: number, t0: number) => {
      const sobe = sino(t, t0, t0 + 0.3);
      p.pes[k].y += 26 * sobe;
      p.pes[k].x += r.pernas[k].lado * 4 * sobe;
      const baque = sino(t, t0 + 0.3, t0 + 0.48);
      p.quadril.y -= 10 * baque - 6 * sobe;
      p.corpo.giro += -r.pernas[k].lado * 5 * sobe;
      p.corpo.alto *= 1 - 0.07 * baque;
      p.corpo.largo *= 1 + 0.05 * baque;
    };
    const kd = r.pernas.findIndex((x) => x.lado > 0),
      ke = r.pernas.findIndex((x) => x.lado < 0);
    pisa(kd, 5.3);
    pisa(ke, 5.85);
  }

  // ---- 6,6-8,8 a ola, da esquerda para a direita, e o pulinho de todos
  {
    const t0 = 6.6 + i * 0.26;
    const j = pulo(t, t0, 0.16, 0.42, 48, 0.9);
    p.raiz.y += j.y;
    p.quadril.y -= j.agacha;
    p.corpo.alto *= j.alto;
    p.corpo.largo *= j.largo;
    const cima = janela(t, t0 + 0.08, t0 + 0.28, t0 + 0.55, t0 + 0.9);
    // o marrom ja tem os bracos abertos para cima: sobe menos (os quatro nao se juntam)
    const sobe = id === "marrom" ? (k: number) => (r.bracos[k].extra ? 25 : 55) : () => 140;
    r.bracos.forEach((b, k) => {
      p.bracos[k][0] += b.lado * sobe(k) * cima;
      p.bracos[k][1] += b.lado * 15 * cima;
    });
    if (t > t0 + 0.15 && t < t0 + 0.75) p.boca = "mouthA";
    // todos juntos
    const fim = pulo(t, 8.1, 0.12, 0.3, 22, 0.7);
    p.raiz.y += fim.y;
    p.quadril.y -= fim.agacha;
    p.corpo.alto *= fim.alto;
    p.corpo.largo *= fim.largo;
    const tada = janela(t, 8.15, 8.3, 8.55, 9.0);
    r.bracos.forEach((b, k) => {
      p.bracos[k][0] += b.lado * (id === "marrom" ? (b.extra ? 8 : 18) : 45) * tada;
    });
    if (t > 8.15 && t < 8.8) p.boca = "mouth_closed_happy";
  }
  return p;
}

export function cena(rigs: Rig[]) {
  return { cena: amostra(rigs, (i, t) => pose(rigs, i, t), DUR), ...foto(rigs) };
}

// amostra as poses (null: o monstro some, a raiz em escala 0) a 30 por segundo
function amostra(rigs: Rig[], fn: (i: number, t: number) => Pose | null, dur: number, objetos = false) {
  const ossos: Record<string, Record<string, any[]>> = {};
  const slots: Record<string, Record<string, any[]>> = {};
  const poe = (o: string, tl: string, k: any) => ((ossos[o] ??= {})[tl] ??= []).push(k);
  const troca = (s: string, t: number, nome: string) => {
    const l = ((slots[s] ??= {}).parte ??= []);
    if (l.length && l[l.length - 1].nome === nome) return;
    l.push({ tempo: r3(t), nome });
  };
  const N = Math.round(dur * FPS);
  for (const [i, r] of rigs.entries()) {
    for (let q = 0; q <= N; q++) {
      const t = r3(q / FPS);
      const pp = fn(i, t);
      poe(r.raiz, "escalar", { tempo: t, x: pp ? 1 : 0, y: pp ? 1 : 0 });
      const p = pp ?? poseBase(rigs, i, t);
      poe(r.raiz, "mover", { tempo: t, x: r3(p.raiz.x), y: r3(p.raiz.y) });
      // pernas finas (amarelo e azul) dobram demais com pouco: o quadril desce a metade
      const fina = r.m.perna.endsWith("B") ? 0.5 : 1;
      poe(r.quadril, "mover", { tempo: t, x: r3(p.quadril.x), y: r3(p.quadril.y * fina) });
      poe(r.corpo, "mover", { tempo: t, x: r3(p.corpo.x), y: r3(p.corpo.y + p.quadril.y * (1 - fina)) });
      poe(r.corpo, "girar", { tempo: t, valor: r3(p.corpo.giro) });
      poe(r.corpo, "escalar", { tempo: t, x: r3(p.corpo.alto), y: r3(p.corpo.largo) });
      // o rosto e preso ao corpo (x do pai = cima, y = esquerda)
      poe(r.rosto, "mover", { tempo: t, x: r3(p.rosto.y), y: r3(-p.rosto.x) });
      r.bracos.forEach((b, k) => {
        poe(b.ombro, "girar", { tempo: t, valor: r3(p.bracos[k][0]) });
        poe(b.cotovelo, "girar", { tempo: t, valor: r3(p.bracos[k][1]) });
      });
      r.pernas.forEach((pe, k) => poe(pe.alvo, "mover", { tempo: t, x: r3(p.pes[k].x), y: r3(p.pes[k].y) }));
      r.sobrancelhas.forEach((s, k) => {
        const lado = k === 0 ? -1 : 1;
        poe(s, "mover", { tempo: t, x: r3(p.sobrancelhas.y), y: 0 });
        // a ponta de dentro desce: a da esquerda gira no sentido horario (medido na foto)
        poe(s, "girar", { tempo: t, valor: r3(lado * p.sobrancelhas.giro) });
      });
      r.olhos.forEach((o) => poe(o, "escalar", { tempo: t, x: r3(p.olhosEscala), y: r3(p.olhosEscala) }));
      r.slots.olhos.forEach((s, k) => troca(s, t, p.olhosFechados ? "eye_closed_happy" : r.pecas.olhos[k]));
      troca(r.slots.boca, t, p.boca ?? r.pecas.boca);
      if (objetos)
        for (const [slot, a] of [
          [r.slots.camera, p.camera ?? 0],
          [r.slots.fotinho, p.fotinho ?? 0],
        ] as [string | undefined, number][])
          // objetos aparecem e somem de uma vez (sem o meio-termo transparente entre dois quadros)
          if (slot) ((slots[slot] ??= {}).rgba ??= []).push({ tempo: t, cor: "ffffff" + Math.round(255 * clamp(pp ? a : 0, 0, 1)).toString(16).padStart(2, "0"), curva: "degrau" });
      // orelhas, chifres e antenas: a fisica do nucleo (gerar.ts)
    }
  }
  // tira as timelines que nao mudam (a escala da raiz quando ninguem some)
  for (const tls of Object.values(ossos))
    for (const [k, ks] of Object.entries(tls)) if (ks.every((x) => JSON.stringify({ ...x, tempo: 0 }) === JSON.stringify({ ...ks[0], tempo: 0 })) && k === "escalar" && ks[0].x === 1) delete tls[k];
  return { ossos, slots };
}

// ---- a foto (exemplos/foco): o grupo posando para o azul, que fotografa (ele fica fora), e o
// marrom de perto, na frente da lente. Os tempos sao os da cena da foto (exemplos/foco/gerar.ts)
export const DUR_FOTO = 10.5;
export const T_FOTO = { foco: 0.6, aceno: 1.6, sai: 2.3, entra: 2.9, careta: 3.9, bronca: 4.6, volta: 5.15, xis: 5.8, flash: 6.4 };
const T = T_FOTO;
// sem o azul no meio, os outros fecham o espaco
const JUNTA: Record<string, number> = { amarelo: 130, vermelho: 130, verde: -130, marrom: -130 };

function fotoGrupo(rigs: Rig[], i: number, t: number): Pose | null {
  const r = rigs[i];
  const id = r.m.id;
  if (id === "azul") return null;
  // o marrom sai andando para a direita e volta depois da bronca: fica fora do quadro, sem sumir
  // (escondido em escala 0, a geleia e a fisica dele lembravam o corpo encolhido e ele voltava
  // torto)
  const p = poseBase(rigs, i, t);
  p.raiz.x += JUNTA[id] ?? 0;
  const braco = (lado: -1 | 1, extra = false) => r.bracos.findIndex((b) => b.lado === lado && b.extra === extra);
  // acenam para a camera quando o foco chega
  const aceno = janela(t, T.aceno, T.aceno + 0.25, T.sai + 0.2, T.sai + 0.6);
  const mao = (k: number, lado: number, quanto: number, fase: number) => {
    if (k < 0) return;
    p.bracos[k][0] += lado * quanto * aceno;
    p.bracos[k][1] += lado * (15 + 25 * onda(t, 0.34, fase)) * aceno;
  };
  if (id === "amarelo") mao(braco(-1), -1, 120, 0);
  if (id === "vermelho") (mao(braco(-1), -1, 110, 0.1), mao(braco(1), 1, 110, 0.27));
  if (id === "verde") mao(braco(1), 1, 120, 0.05);
  if (id === "marrom") mao(braco(1), 1, 60, 0.15);
  if (aceno > 0.3) p.boca = "mouth_closed_happy";
  // o marrom vai embora pela direita, aos pulinhos, e volta do mesmo jeito
  if (id === "marrom") {
    const vai = suave((t - T.sai) / (T.entra - T.sai)),
      vem = 1 - suave((t - T.volta) / 0.6);
    const fora = t < T.volta ? vai : vem;
    p.raiz.x += 900 * fora;
    p.raiz.y += 14 * Math.abs(Math.sin(t * 14)) * (fora > 0 && fora < 1 ? 1 : 0);
    if (fora > 0) p.boca = "mouth_closed_happy";
  } else {
    // os outros olham o marrom saindo e a bagunca na frente da lente
    const olha = janela(t, T.sai, T.sai + 0.3, T.volta + 0.2, T.volta + 0.6);
    p.rosto.x += 8 * olha;
    if (id === "verde" && t > T.careta && t < T.bronca + 0.3) ((p.boca = "mouthH"), (p.olhosFechados = true), (p.corpo.giro += 4 * onda(t, 0.14)));
    if (id === "amarelo" && t > T.entra && t < T.entra + 0.7) p.boca = "mouthG";
    if (id === "vermelho" && t > T.bronca && t < T.volta) p.boca = "mouthA";
  }
  // xis: todos com os bracos para cima e o sorriso, ate o flash
  const xis = janela(t, T.xis, T.xis + 0.25, 99, 100);
  if (xis > 0 && id !== "marrom") {
    r.bracos.forEach((b, k) => {
      p.bracos[k][0] += b.lado * (b.extra ? 25 : 130) * xis;
      p.bracos[k][1] += b.lado * 20 * xis;
    });
    p.boca = "mouthA";
    p.olhosFechados = false;
  }
  // o marrom apronta de novo: posa comportado e, na hora do flash, pula torto de lingua de fora
  // com os quatro bracos para cima (a foto congela com ele no ar)
  if (xis > 0 && id === "marrom") {
    const j = pulo(t, T.flash - 0.32, 0.12, 0.5, 70, 1);
    p.raiz.y += j.y;
    p.quadril.y -= j.agacha;
    p.corpo.alto *= j.alto;
    p.corpo.largo *= j.largo;
    const doido = janela(t, T.flash - 0.22, T.flash - 0.1, 99, 100);
    p.corpo.giro += -16 * doido;
    r.bracos.forEach((b, k) => {
      p.bracos[k][0] += b.lado * (b.extra ? 25 + 40 * doido : 45 + 40 * doido) * xis;
      p.bracos[k][1] += b.lado * (20 + 25 * doido * onda(t, 0.2, k * 0.05)) * xis;
    });
    p.sobrancelhas.y += 6 * doido;
    p.boca = doido > 0.3 ? "mouthH" : "mouthA";
    p.olhosFechados = false;
  }
  return p;
}

function fotoCareta(rigs: Rig[], i: number, t: number): Pose | null {
  const r = rigs[i];
  if (r.m.id !== "marrom") return null;
  const p = poseBase(rigs, i, t);
  // no centro da instancia (a cena da foto o poe na frente da lente)
  p.raiz.x -= r.m.x;
  // careta: lingua de fora, sobrancelhas pulando, os quatro bracos sacudindo para a lente
  const careta = janela(t, T.careta - 0.3, T.careta, T.bronca + 0.1, T.bronca + 0.4);
  p.sobrancelhas.y += 6 * careta * onda(t, 0.3);
  p.sobrancelhas.giro -= 15 * careta;
  r.bracos.forEach((b, k) => {
    p.bracos[k][0] += b.lado * careta * (60 + 30 * onda(t, 0.3, k * 0.07));
    p.bracos[k][1] += b.lado * careta * (30 + 25 * onda(t, 0.3, k * 0.07 + 0.1));
  });
  // a espiada pela borda (sorriso sapeca) e o pulo com a boca aberta (o "BU!")
  if (t < T.entra + 0.4) p.boca = "mouth_closed_happy";
  else if (t < T.careta - 0.15) p.boca = "mouthG";
  if (careta > 0.2) p.boca = "mouthH";
  // a bronca: murcha, sorri amarelo e sai
  if (t > T.bronca + 0.2) p.boca = "mouth_closed_happy";
  p.corpo.alto *= 1 - 0.08 * janela(t, T.bronca, T.bronca + 0.15, T.bronca + 0.4, T.bronca + 0.6);
  return p;
}

function foto(rigs: Rig[]) {
  return {
    foto_grupo: amostra(rigs, (i, t) => fotoGrupo(rigs, i, t), DUR_FOTO),
    foto_careta: amostra(rigs, (i, t) => fotoCareta(rigs, i, t), DUR_FOTO),
    ...vt(rigs),
  };
}

// ---- o VT "A foto da turma" (exemplos/vt): os tempos sao os da cena do VT; a parte do visor
// (5,5 a 16 s) e a cena da foto, entao aqui so o plano aberto antes e depois
export const T_VT = { chegada: 0.3, chama: 2.7, ergue: 4.3, mergulho: 5.0, volta: 16.0, reage: 16.8, corre: 17.9, rouba: 18.35, selfie: 19.2, flash: 20.6 };
export const DUR_VT = 21.4;
const V = T_VT;

function vtGrupo(rigs: Rig[], i: number, t: number): Pose | null {
  const r = rigs[i];
  const id = r.m.id;
  if (id === "azul") return null;
  const p = poseBase(rigs, i, t);
  p.raiz.x += JUNTA[id] ?? 0;
  // ---- a chegada, um de cada jeito
  if (id === "amarelo") {
    // aos pulinhos pela esquerda
    const f = fr01(t, V.chegada, V.chegada + 0.9);
    p.raiz.x -= 900 * (1 - suave(f));
    p.raiz.y += f > 0 && f < 1 ? 55 * Math.abs(Math.sin(Math.PI * 3 * f)) : 0;
    const pousa = sino(t, V.chegada + 0.9, V.chegada + 1.15);
    p.corpo.alto *= 1 - 0.18 * pousa;
    p.corpo.largo *= 1 + 0.14 * pousa;
  }
  if (id === "vermelho") {
    // cai do alto e amassa ao chegar
    const f = fr01(t, 0.8, 1.25);
    p.raiz.y += 1150 * (1 - f) ** 2;
    const pousa = sino(t, 1.25, 1.6);
    p.quadril.y -= 18 * pousa;
    p.corpo.alto *= 1 - 0.28 * pousa;
    p.corpo.largo *= 1 + 0.2 * pousa;
    r.bracos.forEach((b, k) => (p.bracos[k][0] += b.lado * 90 * (t < 1.25 ? fr01(t, 0.8, 1.0) : 1 - fr01(t, 1.25, 1.6))));
  }
  if (id === "verde") {
    // desliza pela direita e freia inclinado
    const f = fr01(t, 1.2, 1.85);
    p.raiz.x += 900 * (1 - f) ** 3;
    p.corpo.giro += -14 * sino(t, 1.45, 2.05);
    r.bracos.forEach((b, k) => (p.bracos[k][0] += b.lado * 60 * sino(t, 1.3, 2.0)));
  }
  if (id === "marrom") {
    // rola pela direita e tromba no Gargalhada
    const f = fr01(t, 1.7, 2.45);
    p.raiz.x += 1000 * (1 - f);
    p.raiz.y += f > 0 && f < 1 ? 60 * Math.abs(Math.sin(Math.PI * 2 * f)) : 0;
    p.corpo.giro += f > 0 && f < 1 ? 360 * f : 0;
    p.raiz.x += 30 * sino(t, 2.45, 2.75);
    const baque = sino(t, 2.45, 2.7);
    p.corpo.alto *= 1 - 0.2 * baque;
    p.corpo.largo *= 1 + 0.15 * baque;
  }
  if (id === "verde") {
    // a trombada
    p.raiz.x -= 45 * sino(t, 2.45, 2.85);
    p.corpo.giro += 10 * sino(t, 2.45, 2.8);
    if (t > 2.45 && t < 2.9) p.boca = "mouthG";
  }
  // ---- o Clique chama: todos olham para ele (a esquerda) e sorriem
  const olha = janela(t, V.chama, V.chama + 0.3, V.mergulho + 0.3, V.mergulho + 0.5);
  p.rosto.x -= 10 * olha;
  if (olha > 0.5) p.boca = "mouth_closed_happy";
  // esperando a foto: os bracos meio para cima
  const espera = janela(t, V.chama + 0.8, V.chama + 1.2, V.mergulho + 0.3, V.mergulho + 0.6);
  r.bracos.forEach((b, k) => (p.bracos[k][0] += b.lado * (b.extra ? 10 : 35) * espera));

  // ---- de volta (depois do visor): o Clique mostra a foto e todos se debrucam
  if (t >= V.volta) {
    const debruca = janela(t, V.volta, V.volta + 0.4, V.corre, V.corre + 0.3);
    p.corpo.giro += 7 * debruca;
    p.rosto.x -= 12 * debruca;
    const reage = janela(t, V.reage, V.reage + 0.2, V.corre, V.corre + 0.3);
    if (id === "verde" && reage > 0.3) ((p.boca = "mouthH"), (p.olhosFechados = true), (p.corpo.giro += 5 * onda(t, 0.14)));
    if (id === "amarelo" && reage > 0.3) p.boca = "mouthG";
    if (id === "vermelho" && reage > 0) {
      // a mao na testa
      const k = r.bracos.findIndex((b) => b.lado < 0 && !b.extra);
      p.bracos[k][0] -= 125 * reage;
      p.bracos[k][1] -= 70 * reage;
      p.boca = "mouthA";
    }
    if (id === "marrom" && reage > 0) {
      // orgulhoso da careta
      r.bracos.forEach((b, k) => (p.bracos[k][0] += b.lado * (b.extra ? 40 : 80) * reage));
      p.corpo.alto *= 1 + 0.06 * reage;
      p.boca = "mouth_closed_happy";
    }
    // ---- o Bagunca rouba a camera (por tras do Clique) e volta para o meio
    if (id === "marrom") {
      const vai = suave(fr01(t, V.corre, V.rouba)),
        vem = suave(fr01(t, V.rouba + 0.1, V.selfie));
      const ate = -1600;
      p.raiz.x += ate * vai * (1 - vem) + -160 * vem;
      p.raiz.y += (t > V.corre && t < V.selfie ? 25 * Math.abs(Math.sin(t * 20)) : 0);
      // pula para alcancar a mao do Clique (que esta mais perto da camera e mais alto)
      p.raiz.y += 330 * sino(t, V.rouba - 0.25, V.rouba + 0.3);
      p.camera = t >= V.rouba ? 1 : 0;
      if (t > V.rouba && t < V.selfie) p.boca = "mouthA";
    }
    // ---- a selfie: todos se espremem em volta do Bagunca, que ergue a camera
    const aperta = janela(t, V.selfie, V.selfie + 0.4, 99, 100);
    const ATE: Record<string, number> = { amarelo: 230, vermelho: 150, verde: -60, marrom: 0 };
    p.raiz.x += (ATE[id] ?? 0) * aperta;
    if (aperta > 0) {
      if (id === "marrom") {
        const k = r.bracos.findIndex((b) => b.lado > 0 && !b.extra);
        p.bracos[k][0] += 120 * aperta;
        p.bracos[k][1] += 30 * aperta;
        p.boca = t > V.flash - 0.25 ? "mouthH" : "mouthA";
      } else {
        p.boca = "mouthA";
        p.olhosFechados = false;
        p.corpo.giro += (id === "verde" ? 8 : -8) * aperta;
      }
    }
  }
  return p;
}

function vtClique(rigs: Rig[], i: number, t: number): Pose | null {
  const r = rigs[i];
  if (r.m.id !== "azul") return null;
  const p = poseBase(rigs, i, t);
  p.raiz.x -= r.m.x;
  const fora = r.bracos.findIndex((b) => b.lado < 0 && !b.extra),
    turma = r.bracos.findIndex((b) => b.lado > 0 && !b.extra);
  // a camera na mao de fora, na altura do peito; ergue ate o olho antes do mergulho
  // e de volta, ergue de novo para mais uma (e ai o Bagunca a arranca da mao)
  const olho = janela(t, V.ergue, V.ergue + 0.5, V.volta - 1, V.volta) + janela(t, V.corre - 0.35, V.corre, V.rouba, V.rouba + 0.3);
  p.bracos[fora][0] -= 70 + 55 * olho;
  p.bracos[fora][1] -= 35 + 40 * olho;
  p.camera = t < V.rouba ? 1 : 0;
  // chama a turma acenando com a outra mao
  const chama = janela(t, V.chama, V.chama + 0.2, V.chama + 1.0, V.chama + 1.3);
  p.bracos[turma][0] += 120 * chama;
  p.bracos[turma][1] += (20 + 30 * onda(t, 0.3)) * chama;
  if (chama > 0.3) p.boca = "mouthA";
  // de volta: mostra a foto para a turma
  if (t >= V.volta) {
    const mostra = janela(t, V.volta, V.volta + 0.35, V.rouba + 0.2, V.rouba + 0.5);
    p.bracos[turma][0] += 85 * mostra;
    p.bracos[turma][1] += 15 * mostra;
    p.fotinho = mostra > 0.05 ? 1 : 0;
    // a camera some da mao: o susto, e depois entra na selfie
    const susto = sino(t, V.rouba, V.rouba + 0.35);
    p.bracos[fora][0] += 40 * susto;
    if (t > V.rouba && t < V.selfie) p.boca = "mouthG";
    const selfie = janela(t, V.selfie, V.selfie + 0.4, 99, 100);
    if (selfie > 0) {
      p.boca = "mouthA";
      p.bracos[turma][0] += 60 * selfie;
      p.corpo.giro -= 8 * selfie;
    }
  } else p.fotinho = 0;
  return p;
}

// a selfie congelada (o conteudo da segunda Polaroid), de perto: a turma espremida na foto, o
// Bagunca na frente de lingua de fora com o braco esticado para a camera, o Clique piscando no
// flash, os outros por cima dos ombros; as pernas ficam na borda de baixo da Polaroid (o VT poe
// os pes abaixo da janela). A ordem de desenho (Bagunca na frente) vem do gerar.ts
function vtSelfie(rigs: Rig[], i: number, t: number): Pose | null {
  const r = rigs[i];
  const id = r.m.id;
  const p = poseBase(rigs, i, 0);
  const X: Record<string, number> = { amarelo: -75, vermelho: 70, azul: -235, verde: 225, marrom: 95 },
    Y: Record<string, number> = { amarelo: 70, vermelho: 95, azul: 0, verde: 55, marrom: -25 },
    GIRO: Record<string, number> = { amarelo: -12, vermelho: 6, azul: -9, verde: 14, marrom: 10 };
  p.raiz.x += -r.m.x + X[id];
  p.raiz.y += Y[id];
  p.corpo.giro += GIRO[id];
  p.boca = id === "marrom" ? "mouthH" : id === "azul" ? "mouthG" : "mouthA";
  p.olhosFechados = id === "azul";
  if (id === "marrom") {
    // o braco da camera esticado para cima e para fora
    const k = r.bracos.findIndex((b) => b.lado > 0 && !b.extra);
    p.bracos[k][0] += 150;
    p.bracos[k][1] += 10;
    p.sobrancelhas.y += 6;
  } else {
    // os outros com os bracos colados (nada sai da foto)
    r.bracos.forEach((b, k) => (p.bracos[k][0] -= b.lado * (b.extra ? 10 : 25)));
  }
  void t;
  return p;
}

function vt(rigs: Rig[]) {
  const grupo: any = amostra(rigs, (i, t) => vtGrupo(rigs, i, t), DUR_VT, true);
  // a poeira de cada chegada e da trombada (os emissores da biblioteca no gerar.ts)
  grupo.particulas = {
    amarelo_poeira: { rajada: [{ tempo: 1.2, quantidade: 6 }] },
    vermelho_poeira: { rajada: [{ tempo: 1.25, quantidade: 18 }] },
    verde_poeira: { rajada: [{ tempo: 1.6, quantidade: 8 }] },
    marrom_poeira: { rajada: [{ tempo: 2.45, quantidade: 12 }, { tempo: V.rouba, quantidade: 6 }] },
  };
  return { vt_grupo: grupo, vt_clique: amostra(rigs, (i, t) => vtClique(rigs, i, t), DUR_VT, true), vt_selfie: amostra(rigs, (i, t) => vtSelfie(rigs, i, t), 1, true) };
}
