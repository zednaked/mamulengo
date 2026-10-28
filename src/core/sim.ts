// Pose deterministica num instante: setup + animacao desde 0 em passos fixos de 1/64,
// a mesma sequencia do SpineSprite.update_skeleton no harness do Godot (medido igual
// osso a osso, fisica inclusive).
//
// Sequencia (prévia de transicao): A e depois B com mix, como o jogo faz.
// - enfileirar (queue/add_animation): B entra quando faltar "mix" para A acabar;
// - interromper (play/set_animation): B substitui A no instante "at".
// O AnimationState so troca de animacao no passo seguinte ao que passou do ponto, entao
// o resultado depende do tamanho do passo: a sequencia sempre anda em passos de 1/64.
//
// Atalhos que dao o MESMO resultado (conferido em tests/features.ts):
// - sem fisica e sem sequencia a pose so depende do tempo: um passo unico de 0 ate t;
// - com fisica ou sequencia, quando o tempo so avanca (arrastar a agulha para frente,
//   tocar quadro a quadro), continua do ultimo passo inteiro em vez de refazer desde 0.
//   So vale com t depois do checkpoint (t == checkpoint exato refaz: a pose desenhada
//   e a do ultimo passo, e restaurar sem passo nenhum deixaria a do passo parcial).
//   O estado que carrega historia: o da fisica, o das trilhas (com a de onde vem o mix),
//   o relogio do esqueleto e a pose local (o mix deixa valores que a proxima animacao
//   nao reescreve).
import { AnimationState, Physics, Skeleton, type TrackEntry } from "@esotericsoftware/spine-core";

// 1/64: fracao binaria exata em float32 e float64. Com 1/60, tres passos somam
// exatamente o passo de fisica de 20 fps (0.05) e o spine-cpp (float) e o spine-ts
// (double) decidem de lados opostos se a fisica anda naquele frame.
export const STEP = 1 / 64;

export interface Sequence {
  // animacao que vem depois
  next: string;
  // duracao do mix em segundos
  mix: number;
  // interromper A neste instante (play/set_animation); sem: enfileira (queue/add_animation)
  at?: number | null;
  // A em loop (padrao: nao, como o jogo toca um ganho)
  loop?: boolean;
  // B em loop (padrao: sim, como o jogo volta ao idle)
  nextLoop?: boolean;
}

// Instantes da sequencia para uma A de duracao dA e uma B de duracao dB: start e onde o
// mix comeca (B entra), end onde termina, total cobre B inteira depois da troca.
export function sequenceTimes(dA: number, dB: number, s: Sequence) {
  const mix = Math.max(0, s.mix);
  const start = s.at != null ? Math.max(0, s.at) : Math.max(dA - mix, 0);
  return { start, end: start + mix, total: start + Math.max(dB, mix), mix };
}

// Mix como o spine-godot dos jogos (binario 4.3 mais antigo que o spine-ts): a dona de
// cada propriedade e a entrada da trilha, nao a trilha. Na entrada que esta entrando,
// propriedade que a anterior anima vira "current" em vez de "first": antes da primeira
// chave dela a timeline nao mexe, e o valor da animacao que sai fica inteiro (o spine-ts
// puxaria para o setup na proporcao do mix). Depois da primeira chave as duas formulas
// sao iguais. Medido num personagem de jogo (idle interrompido por um ganho: oculos 2.65 de desvio
// sem isto, 0.0002 com isto). So muda algo quando ha mix.
export function likeSpineGodot(st: AnimationState): AnimationState {
  const s = st as any;
  s._animationsChanged = function () {
    this.animationsChanged = false;
    for (const track of this.tracks) {
      if (!track) continue;
      let entry = track;
      while (entry.mixingFrom) entry = entry.mixingFrom;
      do {
        this.computeHold(entry, entry);
        entry = entry.mixingTo;
      } while (entry);
    }
    this.propertyIds.clear();
  };
  return st;
}

type Flat = Record<string, number | boolean>;
const flat = (o: object): Flat => {
  const r: Flat = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === "number" || typeof v === "boolean") r[k] = v;
  return r;
};

// copia rasa de uma entrada da trilha (referencias e arrays copiados)
const copyEntry = (e: TrackEntry): Record<string, any> => {
  const r: Record<string, any> = {};
  for (const [k, v] of Object.entries(e)) r[k] = Array.isArray(v) ? v.slice() : v;
  return r;
};

interface Checkpoint {
  key: string;
  done: number;
  time: number;
  // sequencia interrompida: B ja entrou
  cut: boolean;
  entry: Flat;
  physics: Flat[];
  // so com sequencia: trilha inteira e pose local
  current?: TrackEntry | null;
  entries?: [TrackEntry, Record<string, any>][];
  unkeyed?: number;
  changed?: boolean;
  propertyIds?: Map<any, any>;
  attachmentState?: number[];
  drawOrder?: any[];
}

export class PoseSim {
  // desliga os atalhos (para medir e para conferir que dao o mesmo resultado)
  shortcuts = true;
  private ck: Checkpoint | null = null;
  // guarda a pose local dos ossos, slots e constraints no checkpoint da sequencia
  private shadow: Skeleton | null = null;

  readonly sk: Skeleton;
  readonly st: AnimationState;

  constructor(sk: Skeleton, st: AnimationState) {
    this.sk = sk;
    this.st = st;
  }

  // o estado mudou por fora (tocando com passo variavel, outra animacao): esquece
  invalidate() {
    this.ck = null;
  }

  private step(d: number) {
    const { sk, st } = this;
    st.update(d);
    st.apply(sk);
    sk.update(d);
    sk.updateWorldTransform(Physics.update);
  }

  poseAt(animation: string | null, loop: boolean, t: number, seq?: Sequence | null) {
    if (seq && animation) return this.sequenceAt(animation, seq, t);
    const { sk, st } = this;
    const key = `${animation}|${loop}`;
    const ck = this.ck;
    this.ck = null;
    if (!animation) {
      sk.setupPose();
      sk.time = 0;
      st.clearTracks();
      sk.updateWorldTransform(Physics.reset);
      return;
    }
    const physics = sk.physics.length > 0;
    let done = 0;
    const entry0 = st.tracks[0];
    if (physics && this.shortcuts && ck && ck.key === key && t > ck.done && entry0?.animation?.name === animation) {
      // continua do ultimo passo inteiro: restaura o que o passo parcial mexeu
      Object.assign(entry0, ck.entry);
      sk.physics.forEach((c, i) => Object.assign(c, ck.physics[i]));
      sk.time = ck.time;
      done = ck.done;
    } else {
      sk.setupPose();
      // relogio do esqueleto do zero, como um SpineSprite novo: a fisica mede o passo
      // por diferenca de tempo, e um relogio grande (sessao longa) muda o arredondamento
      sk.time = 0;
      st.clearTracks();
      const entry = st.setAnimation(0, animation, loop);
      entry.mixDuration = 0;
      sk.updateWorldTransform(Physics.reset);
      this.step(0);
      if (!physics && this.shortcuts) {
        if (t > 0) this.step(t);
        return;
      }
    }
    while (done + STEP <= t + 1e-9) {
      this.step(STEP);
      done += STEP;
    }
    if (physics) {
      const entry = st.tracks[0] as TrackEntry;
      this.ck = { key, done, time: sk.time, cut: false, entry: flat(entry), physics: sk.physics.map(flat) };
    }
    if (t - done > 0) this.step(t - done);
  }

  // B substitui A agora (set_animation), com o mix pedido
  private interrupt(seq: Sequence) {
    const e = this.st.setAnimation(0, seq.next, seq.nextLoop ?? true);
    e.mixDuration = Math.max(0, seq.mix);
  }

  // Sequencia A -> B. Passos de 1/64 desde 0; interrompendo, o passo e cortado no
  // instante da troca (t ate "at", troca, e os passos recomecam dali). O harness do
  // Godot (tools/godot/parity.gd) faz exatamente a mesma conta.
  private sequenceAt(animation: string, seq: Sequence, t: number) {
    const { sk, st } = this;
    const key = `seq|${animation}|${JSON.stringify([seq.next, seq.mix, seq.at ?? null, !!seq.loop, seq.nextLoop ?? true])}`;
    const ck = this.ck;
    this.ck = null;
    const at = seq.at != null ? Math.max(0, seq.at) : null;
    let done = 0;
    let cut = false;
    if (this.shortcuts && ck && ck.key === key && t > ck.done) {
      this.restore(ck);
      done = ck.done;
      cut = ck.cut;
    } else {
      sk.setupPose();
      sk.time = 0;
      st.clearTracks();
      const a = st.setAnimation(0, animation, !!seq.loop);
      a.mixDuration = 0;
      if (at === null) {
        // queueAnim do jogo: add_animation com delay 0 = entra quando faltar o mix
        const b = st.addAnimation(0, seq.next, seq.nextLoop ?? true, 0);
        b.mixDuration = Math.max(0, seq.mix);
        b.delay = Math.max(a.animationEnd - a.animationStart - b.mixDuration, 0);
      }
      sk.updateWorldTransform(Physics.reset);
      this.step(0);
      if (at === 0) {
        this.interrupt(seq);
        cut = true;
      }
    }
    // ate a troca: passos inteiros desde 0, e o pedaco que falta ate "at"
    if (at !== null && !cut) {
      if (t + 1e-9 < at) {
        this.advance(done, t, key, false);
        return;
      }
      while (done + STEP <= at + 1e-9) {
        this.step(STEP);
        done += STEP;
      }
      if (at - done > 0) this.step(at - done);
      this.interrupt(seq);
      cut = true;
      done = at;
    }
    this.advance(done, t, key, cut);
  }

  private advance(done: number, t: number, key: string, cut: boolean) {
    while (done + STEP <= t + 1e-9) {
      this.step(STEP);
      done += STEP;
    }
    this.ck = this.save(key, done, cut);
    if (t - done > 0) this.step(t - done);
  }

  private save(key: string, done: number, cut: boolean): Checkpoint {
    const { sk, st } = this;
    const current = st.tracks[0] ?? null;
    const entries: [TrackEntry, Record<string, any>][] = [];
    const seen = new Set<TrackEntry>();
    const visit = (e: TrackEntry | null) => {
      if (!e || seen.has(e)) return;
      seen.add(e);
      entries.push([e, copyEntry(e)]);
      visit(e.mixingFrom);
      visit(e.next);
    };
    visit(current);
    const shadow = (this.shadow ??= new Skeleton(sk.data));
    sk.bones.forEach((b, i) => shadow.bones[i].pose.set(b.pose as any));
    sk.slots.forEach((s, i) => shadow.slots[i].pose.set(s.pose));
    sk.constraints.forEach((c, i) => (shadow.constraints[i].pose as any).set(c.pose));
    return {
      key,
      done,
      cut,
      time: sk.time,
      entry: {},
      physics: sk.physics.map(flat),
      current,
      entries,
      unkeyed: st.unkeyedState,
      changed: st.animationsChanged,
      propertyIds: new Map(st.propertyIds),
      attachmentState: sk.slots.map((s) => s.attachmentState),
      drawOrder: sk.drawOrder.pose.slice(),
    };
  }

  private restore(ck: Checkpoint) {
    const { sk, st } = this;
    const restored = new Set<TrackEntry>();
    for (const [e, c] of ck.entries!) {
      for (const [k, v] of Object.entries(c)) (e as any)[k] = Array.isArray(v) ? v.slice() : v;
      restored.add(e);
    }
    st.tracks.length = 0;
    if (ck.current) st.tracks[0] = ck.current;
    // o passo parcial pode ter terminado uma entrada (devolvida ao pool): ela volta a valer
    const pool = (st as any).trackEntryPool;
    pool.items = pool.items.filter((e: TrackEntry) => !restored.has(e));
    st.unkeyedState = ck.unkeyed!;
    st.animationsChanged = ck.changed!;
    st.propertyIds = new Map(ck.propertyIds!);
    const shadow = this.shadow!;
    sk.bones.forEach((b, i) => b.pose.set(shadow.bones[i].pose as any));
    sk.slots.forEach((s, i) => {
      s.pose.set(shadow.slots[i].pose);
      s.attachmentState = ck.attachmentState![i];
    });
    sk.constraints.forEach((c, i) => (c.pose as any).set(shadow.constraints[i].pose));
    sk.drawOrder.pose.length = 0;
    sk.drawOrder.pose.push(...ck.drawOrder!);
    sk.physics.forEach((c, i) => Object.assign(c, ck.physics[i]));
    sk.time = ck.time;
  }
}
