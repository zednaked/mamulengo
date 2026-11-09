// Rotoscopia (docs/ANIMAR.md, "Pose de video"): os pontos do corpo num video (MediaPipe Pose, 33
// pontos por quadro, em pixels do video com y para baixo) viram chaves nos ossos de um rig. Puro e
// testavel no node; o detector roda no navegador (src/app/posevideo.ts) e o comando e o
// pose.fromLandmarks. Em ordem:
//   1. quadros sem pessoa: o vizinho mais perto
//   2. esquerda e direita trocadas (de perfil, quando um membro passa pelo outro o detector troca os
//      rotulos): cada membro segue o mais perto do quadro anterior
//   3. tremor: filtro de um euro em cada coordenada (corta o tremido parado, segue o movimento rapido)
//   4. angulos: cada segmento (quadril -> joelho...) e um angulo no mundo; a chave do osso e o quanto
//      ele gira a mais que no setup, menos o que o pai ja girou (so angulos: as proporcoes do rig
//      ficam; o deslocamento do quadril vai na escala da perna do rig sobre a da pessoa)
//   5. pe no chao: o tornozelo quase parado e embaixo e contato; no contato, o pe fica preso onde
//      pousou e a perna dobra por IK de dois ossos (sem escorregar)
//   6. chaves demais: Douglas-Peucker em cada canal, so as batidas ficam (a curva entre elas reta)
import type { Affine } from "./pose.ts";

export type Ponto = [number, number, number?, number?];
export type QuadroPose = { t: number; pontos: Ponto[] | null };

// os pontos do MediaPipe Pose que usamos
export const LM = {
  nariz: 0,
  orelha_e: 7,
  orelha_d: 8,
  ombro_e: 11,
  ombro_d: 12,
  cotovelo_e: 13,
  cotovelo_d: 14,
  pulso_e: 15,
  pulso_d: 16,
  quadril_e: 23,
  quadril_d: 24,
  joelho_e: 25,
  joelho_d: 26,
  tornozelo_e: 27,
  tornozelo_d: 28,
  calcanhar_e: 29,
  calcanhar_d: 30,
  pe_e: 31,
  pe_d: 32,
} as const;

// os segmentos que viram osso: de onde a onde (um numero e um ponto; dois, o meio deles)
type Ref = number | [number, number];
export const SEGMENTOS: Record<string, [Ref, Ref]> = {
  tronco: [[23, 24], [11, 12]],
  cabeca: [[11, 12], [7, 8]],
  braco_e: [11, 13],
  antebraco_e: [13, 15],
  braco_d: [12, 14],
  antebraco_d: [14, 16],
  coxa_e: [23, 25],
  canela_e: [25, 27],
  pe_e: [29, 31],
  coxa_d: [24, 26],
  canela_d: [26, 28],
  pe_d: [30, 32],
};
export type Segmento = keyof typeof SEGMENTOS | "quadril";

// o osso de cada segmento pelo nome (portugues ou ingles; lado por _e/_esq/_l/_left ou _d/_dir/_r/_right)
const NOMES: Record<string, RegExp> = {
  quadril: /^(quadril|hips?|pelvis|cintura|bacia)$/i,
  tronco: /^(tronco|torso|spine|chest|corpo|body|peito)$/i,
  cabeca: /^(cabe[cç]a|head)$/i,
  braco: /^(bra[cç]o|upper_?arm|arm)$/i,
  antebraco: /^(antebra[cç]o|fore_?arm|lower_?arm)$/i,
  coxa: /^(coxa|thigh|upper_?leg)$/i,
  canela: /^(canela|perna|shin|calf|lower_?leg|leg)$/i,
  pe: /^(p[eé]|foot)$/i,
};
export function mapaPorNomes(ossos: string[]): Partial<Record<Segmento, string>> {
  const mapa: Partial<Record<Segmento, string>> = {};
  for (const o of ossos) {
    const m = o.match(/^(.*?)[_.\- ]?(e|esq|esquerd[oa]|l|left|d|dir|direit[oa]|r|right)$/i);
    const base = m ? m[1] : o;
    const lado = m ? (/^(e|esq|esquerd[oa]|l|left)$/i.test(m[2]) ? "e" : "d") : null;
    for (const [seg, re] of Object.entries(NOMES))
      if (re.test(base)) {
        const k = (["quadril", "tronco", "cabeca"].includes(seg) ? (lado ? null : seg) : lado ? `${seg}_${lado}` : null) as Segmento | null;
        if (k && !mapa[k]) mapa[k] = o;
      }
    // o nome inteiro tambem vale (tronco_e nao existe, mas "head" sim)
    for (const [seg, re] of Object.entries(NOMES)) if (["quadril", "tronco", "cabeca"].includes(seg) && re.test(o) && !mapa[seg as Segmento]) mapa[seg as Segmento] = o;
  }
  return mapa;
}

const ponto = (p: Ponto[], r: Ref): [number, number] => (typeof r === "number" ? [p[r][0], p[r][1]] : [(p[r[0]][0] + p[r[1]][0]) / 2, (p[r[0]][1] + p[r[1]][1]) / 2]);
// angulo no mundo do Mamulengo (y para cima), em graus
const angulo = (a: [number, number], b: [number, number]) => (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 1. quadros sem pessoa: o vizinho mais perto que tem
export function preencher(q: QuadroPose[]): QuadroPose[] {
  const com = q.map((x, i) => (x.pontos ? i : -1)).filter((i) => i >= 0);
  if (!com.length) throw new Error("nenhum quadro com pessoa");
  return q.map((x, i) => (x.pontos ? x : { t: x.t, pontos: q[com.reduce((m, k) => (Math.abs(k - i) < Math.abs(m - i) ? k : m))].pontos }));
}

// 2. esquerda e direita: cada grupo (bracos, pernas) troca se trocado fica bem mais perto do quadro
// anterior (ja corrigido). Devolve os quadros e quantas trocas
const GRUPOS: { pares: [number, number][]; custo: number[] }[] = [
  {
    pares: [
      [11, 12],
      [13, 14],
      [15, 16],
    ],
    custo: [13, 14, 15, 16],
  },
  {
    pares: [
      [23, 24],
      [25, 26],
      [27, 28],
      [29, 30],
      [31, 32],
    ],
    custo: [25, 26, 27, 28, 29, 30, 31, 32],
  },
];
export function corrigirLados(q: QuadroPose[]): { quadros: QuadroPose[]; trocas: number } {
  let trocas = 0;
  // o quanto conta: com os membros cruzados as distancias sao pequenas e o ruido decide; a troca
  // tem de ganhar 15% do comprimento da coxa (a mediana) por ponto comparado
  const coxas = q.map((x) => dist([x.pontos![23][0], x.pontos![23][1]], [x.pontos![25][0], x.pontos![25][1]])).sort((a, b) => a - b);
  const minimo = 0.15 * (coxas[coxas.length >> 1] || 1);
  const out: QuadroPose[] = [];
  for (const [i, x] of q.entries()) {
    const p = x.pontos!.map((v) => [...v] as Ponto);
    const ant = out[i - 1]?.pontos;
    if (ant)
      for (const g of GRUPOS) {
        const par = new Map<number, number>();
        for (const [a, b] of g.pares) par.set(a, b).set(b, a);
        const fica = g.custo.reduce((s, k) => s + dist([p[k][0], p[k][1]], [ant[k][0], ant[k][1]]), 0);
        const troca = g.custo.reduce((s, k) => s + dist([p[par.get(k)!][0], p[par.get(k)!][1]], [ant[k][0], ant[k][1]]), 0);
        if (troca < fica * 0.6 && fica - troca > minimo * g.custo.length) {
          trocas++;
          for (const [a, b] of g.pares) [p[a], p[b]] = [p[b], p[a]];
        }
      }
    out.push({ t: x.t, pontos: p });
  }
  return { quadros: out, trocas };
}

// 3. filtro de um euro (Casiez, Roussel e Vogel, CHI 2012): o corte sobe com a velocidade. O video
// inteiro esta a mao: o filtro passa para a frente e para tras e fica a media (o atraso de um lado
// cancela o do outro; num balanco de 1 Hz, o filtro so de um lado atrasava 3 a 4 graus)
export function suavizar(q: QuadroPose[], suave = 0.5): QuadroPose[] {
  if (suave <= 0 || q.length < 3) return q;
  const ida = umEuro(q, suave);
  const volta = umEuro(
    [...q].reverse().map((x, _, r) => ({ t: r[0].t - x.t, pontos: x.pontos })),
    suave,
  ).reverse();
  return ida.map((x, i) => ({ t: x.t, pontos: x.pontos!.map((v, k) => [(v[0] + volta[i].pontos![k][0]) / 2, (v[1] + volta[i].pontos![k][1]) / 2, v[2], v[3]] as Ponto) }));
}

function umEuro(q: QuadroPose[], suave: number): QuadroPose[] {
  const minCorte = 4 - 3.5 * Math.min(1, suave),
    beta = 0.02,
    dCorte = 1;
  const alfa = (corte: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * corte * dt));
  const n = q[0].pontos!.length;
  const est: { x: number; dx: number }[][] = Array.from({ length: n }, () => [
    { x: 0, dx: 0 },
    { x: 0, dx: 0 },
  ]);
  return q.map((x, i) => {
    const p = x.pontos!.map((v) => [...v] as Ponto);
    if (i === 0) {
      p.forEach((v, k) => ((est[k][0].x = v[0]), (est[k][1].x = v[1])));
      return { t: x.t, pontos: p };
    }
    const dt = Math.max(1e-3, x.t - q[i - 1].t);
    p.forEach((v, k) =>
      ([0, 1] as const).forEach((c) => {
        const e = est[k][c];
        const val = v[c] as number;
        const dx = (val - e.x) / dt;
        e.dx += alfa(dCorte, dt) * (dx - e.dx);
        const corte = minCorte + beta * Math.abs(e.dx);
        e.x += alfa(corte, dt) * (val - e.x);
        v[c] = e.x;
      }),
    );
    return { t: x.t, pontos: p };
  });
}

// 5. contato: o tornozelo quase parado e perto do mais baixo da janela (1 s); trechos de 3 ou mais quadros
export function contatos(q: QuadroPose[], lado: "e" | "d", perna: number): [number, number][] {
  const k = lado === "e" ? LM.tornozelo_e : LM.tornozelo_d;
  const y = q.map((x) => x.pontos![k][1]);
  const ehContato = q.map((x, i) => {
    // a velocidade numa janela de 5 quadros (o ruido de um quadro nao vira movimento)
    const a = Math.max(0, i - 2),
      b = Math.min(q.length - 1, i + 2);
    const v = dist([q[b].pontos![k][0], y[b]], [q[a].pontos![k][0], y[a]]) / Math.max(1e-3, q[b].t - q[a].t);
    const jan = q.map((_, j) => j).filter((j) => Math.abs(q[j].t - x.t) <= 0.5);
    const baixo = Math.max(...jan.map((j) => y[j]));
    return v < perna * 0.6 && baixo - y[i] < perna * 0.06;
  });
  const out: [number, number][] = [];
  for (let i = 0; i < q.length; ) {
    if (!ehContato[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < q.length && ehContato[j + 1]) j++;
    if (j - i + 1 >= 3) out.push([i, j]);
    i = j + 1;
  }
  return out;
}

// 6. Douglas-Peucker: os indices que ficam (o primeiro e o ultimo sempre)
export function reduzir(t: number[], v: number[][], tol: number, manter: Iterable<number> = []): number[] {
  const fica = new Set([0, t.length - 1, ...manter]);
  const passo = (a: number, b: number) => {
    let pior = -1,
      ip = -1;
    for (let i = a + 1; i < b; i++) {
      const f = (t[i] - t[a]) / (t[b] - t[a] || 1);
      const d = Math.max(...v[i].map((x, c) => Math.abs(x - (v[a][c] + (v[b][c] - v[a][c]) * f))));
      if (d > pior) (pior = d), (ip = i);
    }
    if (pior > tol) {
      fica.add(ip);
      passo(a, ip);
      passo(ip, b);
    }
  };
  if (t.length > 2) passo(0, t.length - 1);
  return [...fica].sort((a, b) => a - b);
}

export type Rig = {
  // o mundo de cada osso no setup (y para cima)
  mundo: (osso: string) => Affine;
  pai: (osso: string) => string | null;
};

export type Opcoes = {
  mapa: Partial<Record<Segmento, string>>;
  espelhar?: boolean; // a pessoa olha para o outro lado do rig
  suave?: number; // 0 a 1
  travarPes?: boolean;
  reduzir?: boolean;
  translacao?: "xy" | "y" | "nenhuma";
  inicio?: number; // instante da primeira chave na animacao
};

export type Resultado = {
  chaves: Record<string, { rotate?: { time: number; value: number }[]; translate?: { time: number; x: number; y: number }[] }>;
  relatorio: { quadros: number; trocas: number; contatos: { lado: string; de: number; ate: number }[]; chavesAntes: number; chavesDepois: number; escala: number; mapa: Partial<Record<Segmento, string>> };
};

const graus = (m: Affine) => (Math.atan2(m.c, m.a) * 180) / Math.PI;
const desembrulha = (v: number[]) => {
  for (let i = 1; i < v.length; i++) {
    while (v[i] - v[i - 1] > 180) v[i] -= 360;
    while (v[i] - v[i - 1] < -180) v[i] += 360;
  }
  return v;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function rotoscopia(entrada: QuadroPose[], rig: Rig, o: Opcoes): Resultado {
  if (entrada.length < 2) throw new Error("poucos quadros (precisa de 2 ou mais)");
  let q = preencher(entrada);
  if (o.espelhar) q = q.map((x) => ({ t: x.t, pontos: x.pontos!.map((v) => [-v[0], v[1], v[2], v[3]] as Ponto) }));
  const lados = corrigirLados(q);
  q = suavizar(lados.quadros, o.suave ?? 0.5);
  const t0 = q[0].t;
  const tempos = q.map((x) => r3(x.t - t0 + (o.inicio ?? 0)));
  const mapa = o.mapa;
  // a perna da pessoa (pixels) e a do rig (unidades): a escala do deslocamento
  const pernaPessoa =
    q.reduce((s, x) => s + (dist(ponto(x.pontos!, 23), ponto(x.pontos!, 25)) + dist(ponto(x.pontos!, 25), ponto(x.pontos!, 27)) + dist(ponto(x.pontos!, 24), ponto(x.pontos!, 26)) + dist(ponto(x.pontos!, 26), ponto(x.pontos!, 28))) / 2, 0) / q.length;
  const origem = (osso: string) => [rig.mundo(osso).x, rig.mundo(osso).y] as [number, number];
  const comp = (de?: string, ate?: string) => (de && ate ? dist(origem(de), origem(ate)) : 0);
  const pernaRig = comp(mapa.coxa_e ?? mapa.coxa_d, mapa.canela_e ?? mapa.canela_d) + comp(mapa.canela_e ?? mapa.canela_d, mapa.pe_e ?? mapa.pe_d);
  const escala = pernaRig > 0 && pernaPessoa > 0 ? pernaRig / pernaPessoa : 1;

  // 4. os angulos no mundo de cada segmento mapeado, quadro a quadro (sem pulo de 360)
  const W: Record<string, number[]> = {};
  for (const [seg, osso] of Object.entries(mapa)) if (osso && SEGMENTOS[seg]) W[osso] = desembrulha(q.map((x) => angulo(ponto(x.pontos!, SEGMENTOS[seg][0]), ponto(x.pontos!, SEGMENTOS[seg][1]))));
  // o deslocamento do quadril (unidades do mundo, y para cima)
  const pelve = q.map((x) => ponto(x.pontos!, [23, 24]));
  const tr = o.translacao ?? "xy";
  const desl = pelve.map((p) => [tr === "xy" ? (p[0] - pelve[0][0]) * escala : 0, tr === "nenhuma" ? 0 : -(p[1] - pelve[0][1]) * escala] as [number, number]);

  // 5. pe no chao: IK de dois ossos no espaco do rig
  const relContatos: { lado: string; de: number; ate: number }[] = [];
  // no contato, todas as chaves da perna ficam (1 grau a menos na coxa ja desliza o pe)
  const manter = new Map<string, Set<number>>();
  if (o.travarPes !== false)
    for (const lado of ["e", "d"] as const) {
      const coxa = mapa[`coxa_${lado}`],
        canela = mapa[`canela_${lado}`];
      if (!coxa || !canela || !W[coxa] || !W[canela]) continue;
      const L1 = comp(coxa, canela),
        L2 = comp(canela, mapa[`pe_${lado}`]) || L1;
      const H0 = origem(coxa);
      const quadril = mapa.quadril;
      const H = (i: number): [number, number] => (quadril ? [H0[0] + desl[i][0], H0[1] + desl[i][1]] : H0);
      const dir = (a: number): [number, number] => [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
      const tornozelo = (i: number): [number, number] => {
        const h = H(i),
          a = dir(W[coxa][i]),
          b = dir(W[canela][i]);
        return [h[0] + a[0] * L1 + b[0] * L2, h[1] + a[1] * L1 + b[1] * L2];
      };
      for (const [de, ate] of contatos(q, lado, pernaPessoa / 2)) {
        relContatos.push({ lado, de: tempos[de], ate: tempos[ate] });
        for (const o of [coxa, canela]) for (let i = de; i <= Math.min(ate + 1, q.length - 1); i++) (manter.get(o) ?? manter.set(o, new Set()).get(o)!).add(i);
        const alvo = tornozelo(de);
        for (let i = de + 1; i <= ate; i++) {
          const h = H(i);
          const d = Math.min(dist(h, alvo), L1 + L2 - 1e-6);
          const base = (Math.atan2(alvo[1] - h[1], alvo[0] - h[0]) * 180) / Math.PI;
          const abre = (Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))) * 180) / Math.PI;
          // dobra para o mesmo lado que a perna do video dobrava
          const lado0 = Math.sign(((W[canela][i] - W[coxa][i] + 540) % 360) - 180) || 1;
          const ac = base - lado0 * abre;
          const joelho: [number, number] = [h[0] + Math.cos((ac * Math.PI) / 180) * L1, h[1] + Math.sin((ac * Math.PI) / 180) * L1];
          let an = (Math.atan2(alvo[1] - joelho[1], alvo[0] - joelho[0]) * 180) / Math.PI;
          while (an - W[canela][i] > 180) an -= 360;
          while (an - W[canela][i] < -180) an += 360;
          let a2 = ac;
          while (a2 - W[coxa][i] > 180) a2 -= 360;
          while (a2 - W[coxa][i] < -180) a2 += 360;
          W[coxa][i] = a2;
          W[canela][i] = an;
        }
      }
    }

  // a chave de rotacao: o quanto o osso gira a mais que no setup, menos o quanto o osso mapeado
  // mais perto acima dele ja girou
  const delta = (osso: string, i: number) => W[osso][i] - graus(rig.mundo(osso));
  const acima = (osso: string): string | null => {
    for (let p = rig.pai(osso); p; p = rig.pai(p)) if (W[p]) return p;
    return null;
  };
  const chaves: Resultado["chaves"] = {};
  let antes = 0,
    depois = 0;
  for (const osso of Object.keys(W)) {
    const pai = acima(osso);
    const v = desembrulha(q.map((_, i) => delta(osso, i) - (pai ? delta(pai, i) : 0)));
    const fica = o.reduzir === false ? v.map((_, i) => i) : reduzir(tempos, v.map((x) => [x]), 1, manter.get(osso) ?? []);
    antes += v.length;
    depois += fica.length;
    chaves[osso] = { rotate: fica.map((i) => ({ time: tempos[i], value: r3(v[i]) })) };
  }
  if (mapa.quadril && tr !== "nenhuma") {
    // no espaco do pai do quadril
    const pai = rig.pai(mapa.quadril);
    const m = pai ? rig.mundo(pai) : null;
    const det = m ? m.a * m.d - m.b * m.c || 1 : 1;
    const local = desl.map(([x, y]) => (m ? ([(m.d * x - m.b * y) / det, (-m.c * x + m.a * y) / det] as [number, number]) : ([x, y] as [number, number])));
    const fica = o.reduzir === false ? local.map((_, i) => i) : reduzir(tempos, local, 0.5);
    antes += local.length;
    depois += fica.length;
    chaves[mapa.quadril] = { ...(chaves[mapa.quadril] ?? {}), translate: fica.map((i) => ({ time: tempos[i], x: r3(local[i][0]), y: r3(local[i][1]) })) };
  }
  return { chaves, relatorio: { quadros: q.length, trocas: lados.trocas, contatos: relContatos, chavesAntes: antes, chavesDepois: depois, escala: r3(escala), mapa } };
}
