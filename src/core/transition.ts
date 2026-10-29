// Mede a transicao entre duas animacoes como o jogo a toca (src/core/sim.ts): para cada
// osso, a maior velocidade durante o mix comparada com a maior velocidade dele no resto
// da sequencia (antes do mix, em A, e depois, em B). "A emenda pula" vira numero: um osso
// que na emenda anda muito mais rapido do que em qualquer outro momento.
//
// Velocidade = deslocamento entre quadros seguidos (origem e ponta do osso, o que for
// maior) vezes o fps, em unidades do esqueleto por segundo; giro em graus por segundo.
// Fisica entra (o jogo mostra). A pose vem da camada de src/core/instantes.ts: no modo
// "godot", como o spine-godot (gravidade das fisicas de rotacao invertida, o mix dele); no
// "spine", o spine-core puro; no "nucleo", o nucleo.
import type { SpineJson } from "./format.ts";
import { constraints } from "./model.ts";
import { abrirLeve, type Medidor } from "./instantes.ts";
import { STEP, sequenceTimes, type Sequence } from "./sim.ts";

export interface BoneTransition {
  bone: string;
  // maiores velocidades (unidades/s) e giros (graus/s) no mix e fora dele
  mixSpeed: number;
  restSpeed: number;
  mixTurn: number;
  restTurn: number;
  // instante do pico no mix (do andar ou do giro, o que pesar mais no score)
  at: number;
  // quantas vezes mais rapido que no resto (velocidade); null se parado no resto
  ratio: number | null;
  // velocidade no mix / (tol x resto + piso), o maior entre andar e girar; acima de 1 pula
  score: number;
  jumps: boolean;
  physics: boolean;
  // em palavras: o que passou mais do limite (girar ou andar)
  detail: string;
}

export interface TransitionReport {
  from: string;
  to: string;
  mode: "enfileirar" | "interromper";
  mix: number;
  start: number;
  end: number;
  total: number;
  fps: number;
  tol: number;
  // piso: abaixo disso nao conta como pulo (unidades/s e graus/s)
  floor: { speed: number; turn: number };
  ok: boolean;
  bones: BoneTransition[];
  // partes cuja transparencia muda de repente na emenda
  fades: { slot: string; mixFade: number; restFade: number; at: number; score: number; jumps: boolean; detail: string }[];
  summary: string;
}

const DEG = 180 / Math.PI;
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

// tamanho de referencia do personagem (altura do cabecalho, senao 500)
function sizeOf(json: SpineJson): number {
  const s = (json as any).skeleton ?? {};
  return s.height > 0 ? Math.max(s.height, s.width ?? 0) : 500;
}

export interface TransitionOptions {
  fps?: number;
  tol?: number;
  bones?: string[];
}

export function measureTransition(json: SpineJson, anim: string, seq: Sequence, o: TransitionOptions = {}, m?: Medidor): TransitionReport {
  const anims = (json.animations ?? {}) as Record<string, any>;
  if (!anims[anim]) throw new Error(`animacao nao existe: ${anim}`);
  if (!anims[seq.next]) throw new Error(`animacao nao existe: ${seq.next}`);
  if (!m) {
    const own = abrirLeve(json);
    try {
      return measureTransition(json, anim, seq, o, own);
    } finally {
      own.liberar();
    }
  }
  const fps = o.fps ?? 60;
  const tol = o.tol ?? 1.5;
  const tt = sequenceTimes(m.duracao(anim), m.duracao(seq.next), seq);
  const n = Math.max(2, Math.ceil(tt.total * fps));
  const physBones = new Set(constraints(json).filter((x) => x.type === "physics").map((x) => x.c.bone as string));
  const quadros = m.sequencia(anim, seq, Array.from({ length: n + 1 }, (_, i) => Math.min(tt.total, i / fps)), { slots: true });
  const q0 = quadros[0];
  const names = o.bones?.length ? o.bones : q0.bones.map((b) => b.name);
  const idx = names.map((nm) => {
    const b = q0.findBone(nm);
    if (!b) throw new Error(`osso nao existe: ${nm}`);
    return b.index;
  });
  const acc = idx.map(() => ({ mixSpeed: 0, restSpeed: 0, mixTurn: 0, restTurn: 0, at: 0, atTurn: 0 }));
  let prev: number[][] | null = null;
  let prevAlpha: number[] | null = null;
  const slotAcc = q0.slots.map(() => ({ mix: 0, rest: 0, at: 0 }));
  // a troca acontece no passo seguinte ao que passou do ponto: a janela vai um passo alem
  const w0 = tt.start,
    w1 = Math.max(tt.end, tt.start) + STEP;
  for (let i = 0; i <= n; i++) {
    const t = Math.min(tt.total, i / fps);
    const q = quadros[i];
    const cur = idx.map((k) => {
      const p = q.bones[k];
      // origem e os dois eixos (comprimento minimo 50): girar, esticar e amassar contam
      const L = Math.max(p.length || 0, 50);
      return [p.worldX, p.worldY, p.worldX + p.a * L, p.worldY + p.c * L, Math.atan2(p.c, p.a) * DEG, p.worldX + p.b * L, p.worldY + p.d * L, Math.abs(p.a * p.d - p.b * p.c)];
    });
    const alpha = q.slots.map((s) => s.color.a);
    if (prev) {
      const t0 = Math.min(tt.total, (i - 1) / fps);
      const dt = t - t0 || 1 / fps;
      const inMix = t > w0 && t0 < w1;
      cur.forEach((c, j) => {
        const q = prev![j];
        // escala quase zero (popup sumindo): os eixos degeneram e o angulo nao significa nada
        if (c[7] < 1e-4 || q[7] < 1e-4) return;
        const sp = Math.max(Math.hypot(c[0] - q[0], c[1] - q[1]), Math.hypot(c[2] - q[2], c[3] - q[3]), Math.hypot(c[5] - q[5], c[6] - q[6])) / dt;
        const tr = Math.abs(wrap(c[4] - q[4])) / dt;
        const a = acc[j];
        if (inMix) {
          if (sp > a.mixSpeed) (a.mixSpeed = sp), (a.at = t);
          if (tr > a.mixTurn) (a.mixTurn = tr), (a.atTurn = t);
        } else {
          a.restSpeed = Math.max(a.restSpeed, sp);
          a.restTurn = Math.max(a.restTurn, tr);
        }
      });
    }
    if (prevAlpha) {
      const t0 = Math.min(tt.total, (i - 1) / fps);
      const dt = t - t0 || 1 / fps;
      const inMix = t > w0 && t0 < w1;
      alpha.forEach((a, j) => {
        const r = Math.abs(a - prevAlpha![j]) / dt;
        const s = slotAcc[j];
        if (inMix) {
          if (r > s.mix) (s.mix = r), (s.at = t);
        } else s.rest = Math.max(s.rest, r);
      });
    }
    prevAlpha = alpha;
    prev = cur;
  }
  const floor = { speed: 0.1 * sizeOf(json), turn: 90 };
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const bones: BoneTransition[] = idx.map((k, j) => {
    const a = acc[j];
    const sSpeed = a.mixSpeed / (tol * a.restSpeed + floor.speed),
      sTurn = a.mixTurn / (tol * a.restTurn + floor.turn);
    const score = Math.max(sSpeed, sTurn);
    return {
      bone: q0.bones[k].name,
      mixSpeed: r1(a.mixSpeed),
      restSpeed: r1(a.restSpeed),
      mixTurn: r1(a.mixTurn),
      restTurn: r1(a.restTurn),
      // instante do pico do que mais pesa (andar ou girar)
      at: +(sTurn > sSpeed ? a.atTurn : a.at).toFixed(3),
      ratio: a.restSpeed > 1e-6 ? +(a.mixSpeed / a.restSpeed).toFixed(2) : a.mixSpeed > 1e-6 ? null : 0,
      score: +score.toFixed(2),
      jumps: score > 1,
      physics: physBones.has(q0.bones[k].name),
      detail: "",
    };
  });
  // transparencia: piso de 4/s (sumir inteiro em 0,25 s e aceitavel no mix)
  const fades = q0.slots
    .map((s, j: number) => {
      const a = slotAcc[j];
      const score = a.mix / (tol * a.rest + 4);
      return { slot: s.name, mixFade: r1(a.mix), restFade: r1(a.rest), at: +a.at.toFixed(3), score: +score.toFixed(2), jumps: score > 1, detail: `${s.name} muda de transparencia a ${r1(a.mix)}/s no mix (resto: ${r1(a.rest)}/s) em t=${a.at.toFixed(2)}` };
    })
    .filter((f: any) => f.mixFade > 0)
    .sort((x: any, y: any) => y.score - x.score);
  // os piores primeiro
  bones.sort((x, y) => y.score - x.score);
  const bad = bones.filter((b) => b.jumps);
  const mode = seq.at != null ? "interromper" : "enfileirar";
  const w = bones[0];
  // o que passou do limite: o giro ou o andar
  const turnLed = (b: BoneTransition) => b.mixTurn / (tol * b.restTurn + floor.turn) > b.mixSpeed / (tol * b.restSpeed + floor.speed);
  const fmtx = (x: number | null) => (x === null ? "parado no resto" : `${x}x`);
  for (const b of bones)
    b.detail = (turnLed(b) ? `${b.bone} gira ${Math.round(b.mixTurn)}°/s no mix (resto: ${Math.round(b.restTurn)}°/s)` : `${b.bone} anda ${Math.round(b.mixSpeed)}/s no mix (resto: ${Math.round(b.restSpeed)}/s, ${fmtx(b.ratio)})`) + ` em t=${b.at.toFixed(2)}`;
  const badFades = fades.filter((f: any) => f.jumps);
  const worst = [...bad.map((b) => b.detail), ...badFades.map((f: any) => f.detail)];
  const summary = worst.length
    ? `a emenda pula: ${worst.slice(0, 3).join("; ")}${worst.length > 3 ? ` e mais ${worst.length - 3}` : ""}`
    : `emenda suave${w ? ` (mais perto do limite: ${w.detail}, score ${w.score})` : ""}`;
  return { from: anim, to: seq.next, mode, mix: tt.mix, start: +tt.start.toFixed(4), end: +tt.end.toFixed(4), total: +tt.total.toFixed(4), fps, tol, floor: { speed: r1(floor.speed), turn: floor.turn }, ok: !bad.length && !badFades.length, bones, fades: fades.slice(0, 8), summary };
}

// Interromper A em varios instantes (o premio que corta a animacao no meio): o pior corte.
export function measureCuts(json: SpineJson, anim: string, seq: Omit<Sequence, "at">, o: TransitionOptions & { cuts?: number } = {}, m?: Medidor) {
  if (!m) {
    const own = abrirLeve(json);
    try {
      return measureCuts(json, anim, seq, o, own);
    } finally {
      own.liberar();
    }
  }
  const dur = (json.animations as any)?.[anim] ? m.duracao(anim) : 0;
  const k = Math.max(1, o.cuts ?? 10);
  let worst: TransitionReport | null = null;
  const all: { at: number; ok: boolean; worst: string }[] = [];
  for (let i = 0; i < k; i++) {
    // instantes deslocados para nao cair so em cima de chaves
    const at = +((dur * (i + 0.5)) / k).toFixed(4);
    const r = measureTransition(json, anim, { ...seq, at }, o, m);
    const b = r.bones[0];
    const f = r.fades[0];
    const pior = f && f.score > (b?.score ?? 0) ? `${f.detail} (score ${f.score})` : b ? `${b.detail} (score ${b.score})` : "";
    all.push({ at, ok: r.ok, worst: pior });
    const score = (x: TransitionReport) => Math.max(x.bones[0]?.score ?? 0, x.fades[0]?.score ?? 0);
    if (!worst || score(r) > score(worst)) worst = r;
  }
  return { worst: worst!, cuts: all, ok: all.every((c) => c.ok) };
}
