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
};

const PISCA: Record<string, number[]> = { amarelo: [1.3, 7.4], vermelho: [2.1, 9.3], azul: [0.35, 6.1], verde: [3.4, 8.4], marrom: [2.5, 9.0] };
const pisca = (id: string, t: number) => (PISCA[id] ?? []).some((p) => t >= p && t < p + 0.12);

function pose(rigs: Rig[], i: number, t: number): Pose {
  const r = rigs[i];
  const id = r.m.id;
  const azul = rigs.find((x) => x.m.id === "azul")!;
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
  const ossos: Record<string, Record<string, any[]>> = {};
  const slots: Record<string, Record<string, any[]>> = {};
  const poe = (o: string, tl: string, k: any) => ((ossos[o] ??= {})[tl] ??= []).push(k);
  const troca = (s: string, t: number, nome: string) => {
    const l = ((slots[s] ??= {}).parte ??= []);
    if (l.length && l[l.length - 1].nome === nome) return;
    l.push({ tempo: r3(t), nome });
  };
  const N = Math.round(DUR * FPS);
  for (const [i, r] of rigs.entries()) {
    for (let q = 0; q <= N; q++) {
      const t = r3(q / FPS);
      const p = pose(rigs, i, t);
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
      // orelhas, chifres e antenas: a fisica do nucleo (gerar.ts)
    }
  }
  return { cena: { ossos, slots } };
}
