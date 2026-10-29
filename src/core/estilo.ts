// Regua do estilo da casa: mede uma animacao (duracao, quanto o corpo anda e gira,
// amassa, batidas, pausas, curvas, trocas) relativa ao tamanho do personagem. Usada pelo
// tools/estilo.ts (medir os jogos) e pelo comando query.estilo (comparar com a casa).
import { animDuration, posesAt, wrapDeg } from "./ficha.ts";
import { abrirLeve, type Medidor } from "./instantes.ts";
import casaPadrao from "./estilo-casa.json" with { type: "json" };

// faixas da casa: vazias no repositorio; gere as suas com
// `npx tsx tools/estilo.ts <seus jogos> --resumo src/core/estilo-casa.json`
let casa: Record<string, any> = casaPadrao;
export function usarCasa(c: Record<string, any>) {
  casa = c;
}
export const papeisDaCasa = () => Object.keys(casa);

// papel pela convencao de nomes dos jogos (o codigo busca por papel com listas de candidatos)
export function papel(anim: string, dur?: number): string {
  const a = anim.toLowerCase();
  const base = papelPorNome(a);
  // acao comprida (garra que desce e sobe, sorteio): ritmo e pausas de outra natureza
  return base === "ganho/acao" && dur !== undefined && dur > 3 ? "acao longa" : base;
}

function papelPorNome(a: string): string {
  if (/break/.test(a)) return "quebra de idle";
  if (/blink/.test(a)) return "piscar";
  if (/idle/.test(a)) return "idle";
  if (/lose|perd/.test(a)) return "perda";
  if (/fall|queda/.test(a)) return "queda";
  if (/press|hold|loosen|spin/.test(a)) return "botao";
  if (/start|entra/.test(a)) return "entrada";
  if (/(^|[./])end|saida|out\b/.test(a)) return "saida";
  if (/win|gain|action|active|play|catch|explos|reveal/.test(a)) return "ganho/acao";
  if (/transition|launch/.test(a)) return "transicao";
  return "outro";
}

export function tipo(name: string, j: any): string {
  const n = name.toLowerCase();
  if (/character|personagem|char\b/.test(n)) return "personagem";
  if (/^pp|popup|frame|freespin|letreiro|placa|counter/.test(n)) return "popup/placa";
  if (/vfx|particle|payline/.test(n)) return "efeito";
  if (/tree|arvore|palm|planta|bush|grass|folha|leaf|flor/.test(n)) return "vegetacao";
  if (/background|transition|cenario/.test(n)) return "cenario";
  // "ui" so como palavra (guitar, build e fluid tem "ui" dentro)
  if (/btn|button|botao|(^|[^a-z])ui([^a-z]|$)|claw|roulette/.test(n)) return "interface/mecanico";
  // sem pista no nome: tem cabeca, ou braco e perna (palavras inteiras: "charm" e "Handle"
  // nao contam), ou muitos ossos e personagem
  const names = (j.bones ?? []).map((b: any) => String(b.name).toLowerCase());
  const has = (w: string) => names.some((b: string) => new RegExp(`(^|[^a-z])(${w})s?([^a-z]|$)`).test(b));
  if (names.length >= 8 && (has("head|cabeca") || (has("arm|braco") && has("leg|perna")))) return "personagem";
  return names.length > 40 ? "personagem" : "simbolo";
}

export interface Medida {
  asset: string;
  anim: string;
  papel: string;
  tipo: string;
  dur: number;
  corpo: number; // quanto a raiz do corpo anda (% da altura)
  silhueta: number; // quanto a pose mais longe se afasta da inicial (% da altura, ossos)
  giro: number; // maior giro de um osso (graus)
  giroMediano: number; // giro mediano dos ossos animados
  amassa: number; // maior |escala - 1| (%)
  deforma: number; // maior deslocamento de vertice nas chaves de deform (% da altura)
  batidas: number; // picos de movimento por segundo
  pausa: number; // maior pausa (s, quase parado)
  chavesPorSeg: number;
  curvas: { bezier: number; linear: number; stepped: number };
  trocas: number;
  deform: boolean;
  eventos: number;
  loop: boolean;
}

export function medir(asset: string, j: any, anim: string, m?: Medidor): Medida {
  if (!m) {
    const own = abrirLeve(j);
    try {
      return medir(asset, j, anim, own);
    } finally {
      own.liberar();
    }
  }
  const a = j.animations[anim];
  const dur = animDuration(a);
  const h = Math.max(1, j.skeleton?.height ?? 500);
  const fps = 30;
  const n = Math.max(2, Math.round(dur * fps));
  const bones = j.bones.map((b: any) => b.name);
  // raiz do corpo: descendo da raiz, o filho com mais descendentes, ate um osso que
  // tenha imagem ou mais de um filho (root -> raiz do personagem, por exemplo)
  const kids = new Map<string, string[]>();
  for (const b of j.bones) if (b.parent) (kids.get(b.parent) ?? kids.set(b.parent, []).get(b.parent)!).push(b.name);
  const size = (b: string): number => 1 + (kids.get(b) ?? []).reduce((s, k) => s + size(k), 0);
  let body = bones[0];
  for (let guard = 0; guard < 4; guard++) {
    const ks = kids.get(body) ?? [];
    if (!ks.length) break;
    const big = ks.reduce((x, y) => (size(y) > size(x) ? y : x));
    if (size(big) < size(body) * 0.5) break;
    body = big;
    if (ks.length === 1 && (kids.get(big) ?? []).length > 1) break;
  }
  const animated = Object.keys(a.bones ?? {});
  const pos: [number, number][][] = [];
  const rot: Record<string, number[]> = {};
  let amassa = 0;
  const quadros = posesAt(m, j, anim, Array.from({ length: n + 1 }, (_, i) => (i / n) * dur));
  for (const sk of quadros) {
    pos.push(sk.bones.map((b) => [b.worldX, b.worldY]));
    for (const name of animated) {
      const b = sk.findBone(name);
      if (!b) continue;
      (rot[name] ??= []).push(wrapDeg(b.local.rotation - b.setup.rotation));
      // espelhar (escala -1) e truque de desenho, nao amassar: compara o modulo
      amassa = Math.max(amassa, Math.abs(Math.abs(b.local.scaleX / (b.setup.scaleX || 1)) - 1), Math.abs(Math.abs(b.local.scaleY / (b.setup.scaleY || 1)) - 1));
    }
  }
  // corpo: quanto o centro de massa dos ossos anda (independe de qual osso e o "corpo")
  const cm = pos.map((p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]);
  const corpo = Math.max(Math.max(...cm.map((c) => c[0])) - Math.min(...cm.map((c) => c[0])), Math.max(...cm.map((c) => c[1])) - Math.min(...cm.map((c) => c[1]))) / h;
  void body;
  // silhueta: em cada quadro, o deslocamento dos ossos desde o quadro 0 (o osso no
  // percentil 75: pega bracos e cabeca indo longe, ignora os poucos que vao muito); o maior
  let silhueta = 0;
  for (const p of pos) {
    const d = p.map((q, k) => Math.hypot(q[0] - pos[0][k][0], q[1] - pos[0][k][1])).sort((x, y) => x - y);
    silhueta = Math.max(silhueta, d[Math.floor((d.length - 1) * 0.75)] ?? 0);
  }
  const ranges = Object.values(rot).map((v) => Math.max(...v) - Math.min(...v)).filter((r) => r > 0.5);
  ranges.sort((x, y) => x - y);
  // energia por quadro: deslocamento medio dos ossos, relativo a altura
  const energy: number[] = [];
  for (let i = 1; i < pos.length; i++) {
    let s = 0;
    for (let k = 0; k < pos[i].length; k++) s += Math.hypot(pos[i][k][0] - pos[i - 1][k][0], pos[i][k][1] - pos[i - 1][k][1]);
    energy.push(s / pos[i].length / h);
  }
  const peak = Math.max(...energy, 1e-9);
  let picos = 0;
  for (let i = 1; i < energy.length - 1; i++) if (energy[i] > energy[i - 1] && energy[i] >= energy[i + 1] && energy[i] > peak * 0.35) picos++;
  let pausa = 0,
    run = 0;
  for (const e of energy) {
    run = e < peak * 0.08 ? run + 1 : 0;
    pausa = Math.max(pausa, run / fps);
  }
  let keys = 0;
  const curvas = { bezier: 0, linear: 0, stepped: 0 };
  const scan = (node: any) => {
    if (Array.isArray(node)) {
      for (const k of node)
        if (k && typeof k === "object") {
          if ("time" in k || "value" in k || "x" in k || "curve" in k || "name" in k || "vertices" in k || "color" in k) {
            keys++;
            if (k.curve === "stepped") curvas.stepped++;
            else if (Array.isArray(k.curve)) curvas.bezier++;
            else curvas.linear++;
          }
          scan(k);
        }
    } else if (node && typeof node === "object") for (const v of Object.values(node)) if (v && typeof v === "object") scan(v);
  };
  scan({ bones: a.bones, slots: a.slots, attachments: a.attachments, ik: a.ik, transform: a.transform, physics: a.physics });
  const trocas = Object.values<any>(a.slots ?? {}).reduce((s, t) => s + (t.attachment?.length ?? 0), 0);
  const [start, end] = posesAt(m, j, anim, [0, dur]);
  let gap = 0;
  start.bones.forEach((b, k) => (gap = Math.max(gap, Math.hypot(b.worldX - end.bones[k].worldX, b.worldY - end.bones[k].worldY))));
  return {
    asset,
    anim,
    papel: papel(anim, dur),
    tipo: tipo(asset, j),
    dur,
    corpo: corpo * 100,
    silhueta: (silhueta / h) * 100,
    giro: ranges.length ? ranges[ranges.length - 1] : 0,
    giroMediano: ranges.length ? ranges[Math.floor(ranges.length / 2)] : 0,
    amassa: amassa * 100,
    deforma: deformMax(a) / h * 100,
    batidas: dur > 0 ? picos / dur : 0,
    pausa,
    chavesPorSeg: dur > 0 ? keys / dur : 0,
    curvas,
    trocas,
    deform: !!a.attachments,
    eventos: (a.events ?? []).length,
    loop: gap / h < 0.01,
  };
}


// maior deslocamento de um vertice nas chaves de deform (vegetacao e tecido se movem assim,
// sem osso nenhum andar)
function deformMax(a: any): number {
  let m = 0;
  for (const skin of Object.values<any>(a.attachments ?? {}))
    for (const slot of Object.values<any>(skin))
      for (const att of Object.values<any>(slot))
        for (const k of att.deform ?? []) {
          const v = k.vertices ?? [];
          const odd = (k.offset ?? 0) % 2 === 1;
          for (let i = odd ? 1 : 0; i + 1 < v.length; i += 2) m = Math.max(m, Math.hypot(v[i], v[i + 1]));
        }
  return m;
}

// comparacao com a faixa da casa (estilo-casa.json, gerado por tools/estilo.ts): usada
// pelo query.estilo e pela regra "estilo" da ficha
export const NOMES: Record<string, string> = {
  dur: "duracao (s)",
  corpo: "corpo anda (% da altura)",
  silhueta: "silhueta muda (% da altura)",
  giro: "maior giro (graus)",
  giroMediano: "giro tipico (graus)",
  amassa: "amassa/estica (%)",
  deforma: "deform de malha (% da altura)",
  batidas: "batidas por segundo",
  pausa: "maior pausa parada (s)",
  chavesPorSeg: "chaves por segundo",
  trocas: "trocas de imagem",
};

export function compararEstilo(m: any, tipo: string, papel: string) {
  const ref = (casa as any)[`${tipo}|${papel}`];
  if (!ref) return null;
  const linhas: string[] = [];
  const abaixo: string[] = [];
  let fora = 0;
  for (const k of Object.keys(NOMES)) {
    const [lo, med, hi] = (ref[k] as number[] | undefined) ?? [0, 0, 0];
    const v = m[k] as number;
    // faixa do meio da casa com folga de 20% (e um piso para faixas de largura zero)
    const pad = Math.max((hi - lo) * 0.2, Math.abs(med) * 0.15, k === "pausa" ? 0.1 : 0.5);
    const st = v < lo - pad ? "ABAIXO" : v > hi + pad ? "ACIMA" : "ok";
    if (st !== "ok") fora++;
    if (st === "ABAIXO") abaixo.push(k);
    linhas.push(`${st === "ok" ? "ok    " : st.padEnd(6)} ${NOMES[k]}: ${+v.toFixed(2)} (casa ${+lo.toFixed(2)} a ${+hi.toFixed(2)}, mediana ${+med.toFixed(2)})`);
  }
  return { ref, linhas, fora, abaixo };
}
