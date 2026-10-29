// Ficha do personagem: um .md ao lado do .spine-json que descreve o que cada animacao
// deve fazer (intencao, limites, comportamento esperado) e traz regras verificaveis.
// Aqui: estudo do rig (medido), rascunho da ficha e checagem das regras contra o asset.
//
// Regras: uma por linha num bloco ```regras dentro da secao "## Rig" (valem para todas
// as animacoes) ou "## Animacao: <nome>". Linhas que comecam com # sao comentario.
//   duracao 0.9..1.1              duracao em segundos
//   loop                          fim emenda no comeco (ossos no mesmo lugar)
//   limite braco_e rotate -63..44 valor local relativo ao setup, amostrado no tempo
//                                 (canais: rotate, x, y, scaleX, scaleY, shearX, shearY). rotate
//                                 mede o angulo final em relacao ao pai, depois de IK e
//                                 constraints: pega pulso e cotovelo movidos por IK
//   preso oculos cabeca 8         oculos nao sai mais que 8 da relacao de setup com cabeca
//   fisica orelha 25              ponta com fisica nao passa de 25 graus do setup, relativo ao pai
//   parado tronco                 o osso nao e animado (nenhuma timeline)
//   constraint oculos_na_mao desligada|ligada
//   evento passo 0.2..0.4         o evento acontece nesse intervalo
//   troca mao_aberta mao_joinha   o slot mostra essa imagem em algum momento
//   termina_como 1.idle 15        a pose final fica a no maximo 15 da pose inicial de 1.idle
//                                 (o jogo emenda com mix curto: senao, salta)
//   comeca_como 1.idle 15         a pose inicial combina com o comeco de 1.idle
//   transicao 1.idle 0.1 [tol]    tocada uma vez e enfileirada em 1.idle com mix de 0.1 s
//                                 (queueAnim), nenhum osso pula na emenda (src/core/transition.ts)
//   corte 3.win 0.1 [tol]         interrompida em qualquer instante por 3.win (playAnim), a
//                                 emenda nao pula (10 cortes espalhados; vale o pior)
//   estilo ganho/acao [personagem] amplitude e ritmo de animador para o papel (e tipo, padrao
//                                 personagem): reprova abaixo da mediana da casa (folga de 15%)
//                                 em corpo, silhueta, giro, giro tipico ou batidas (animacao
//                                 timida). Precisa de bounds no cabecalho
//   exceto 4.win                  (na secao Rig) a regra seguinte nao vale para essas animacoes
import { compararEstilo, medir } from "./estilo.ts";
import { abrirLeve, abrirMedidor, type LocalQ, type Medidor, type Quadro } from "./instantes.ts";
import { measureCuts, measureTransition } from "./transition.ts";
import { animations, bones, constraints, keyValues, skins, slots } from "./model.ts";
import type { SpineJson } from "./format.ts";

const DEG = 180 / Math.PI;
// o pior (ou o maior) so muda de instante, ou de osso, se passar o anterior em mais que isto
// (px ou graus, abaixo do que se ve): o lugar de um maximo de ruido nao depende do arredondamento
// do runtime (as poses do spine-core e do nucleo diferem em 1e-4 px)
export const EMPATE = 1e-3;
export const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
// inteiro acima de 10; abaixo, ate 2 casas (escala 1,04 nao pode virar "1")
export const fmt = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")).replace(/^-0$/, "0");

export function animDuration(a: any): number {
  let t = 0;
  const scan = (n: any) => {
    if (Array.isArray(n)) for (const k of n) if (k && typeof k === "object") ("time" in k && (t = Math.max(t, k.time)), scan(k));
    if (n && typeof n === "object" && !Array.isArray(n)) for (const v of Object.values(n)) if (v && typeof v === "object") scan(v);
  };
  scan(a);
  return t;
}

// pose de b no espaco de a (posicao local e angulo relativo)
export function relation(sk: Quadro, a: string, b: string) {
  const h = sk.findBone(a)!,
    g = sk.findBone(b)!;
  const det = h.a * h.d - h.b * h.c,
    dx = g.worldX - h.worldX,
    dy = g.worldY - h.worldY;
  return { x: (h.d * dx - h.b * dy) / det, y: (-h.c * dx + h.a * dy) / det, ang: (Math.atan2(g.c, g.a) - Math.atan2(h.c, h.a)) * DEG };
}

// Distancia entre duas poses do mesmo esqueleto: para cada osso, a origem e as pontas dos
// dois eixos (comprimento do osso, no minimo 50), entao rotacao, escala e cisalhamento
// contam, nao so a posicao. Ossos com fisica ficam de fora (dependem do passado).
export function poseDistance(json: SpineJson, A: Quadro, B: Quadro): { worst: number; bone: string } {
  const phys = new Set(constraints(json).filter((x) => x.type === "physics").map((x) => x.c.bone));
  let worst = 0,
    bone = "";
  for (const b of A.bones) {
    if (phys.has(b.name)) continue;
    const p = b,
      q = B.findBone(b.name)!;
    const L = Math.max(b.length || 0, 50);
    const d = Math.max(
      Math.hypot(p.worldX - q.worldX, p.worldY - q.worldY),
      Math.hypot(p.worldX + p.a * L - q.worldX - q.a * L, p.worldY + p.c * L - q.worldY - q.c * L),
      Math.hypot(p.worldX + p.b * L - q.worldX - q.b * L, p.worldY + p.d * L - q.worldY - q.d * L),
    );
    if (d > worst + EMPATE) (worst = d), (bone = b.name);
  }
  return { worst, bone };
}

// poses dos instantes (crescentes, de uma vez); no fim, o ultimo quadro de quem toca uma vez
// (chave stepped no fim vale): em loop, t = duracao ja seria o comeco
export function posesAt(m: Medidor, json: SpineJson, anim: string | null, times: number[]): Quadro[] {
  const d = anim ? animDuration(json.animations[anim]) : 0;
  const fim = (t: number) => !!anim && d > 0 && t >= d;
  const dentro = times.filter((t) => !fim(t));
  const a = m.poses(anim, dentro);
  const b = times.some(fim) ? m.poses(anim, [d], { loop: false })[0] : null;
  let k = 0;
  return times.map((t) => (fim(t) ? b! : a[k++]));
}

// pose de um instante (abre um medidor so para ela: para varios, use posesAt)
export function poseAt(json: SpineJson, anim: string | null, t: number, m?: Medidor): Quadro {
  if (m) return posesAt(m, json, anim, [t])[0];
  const own = abrirLeve(json);
  try {
    return posesAt(own, json, anim, [t])[0];
  } finally {
    own.liberar();
  }
}

function constraintKeys(a: any, type: string, name: string): any[] | undefined {
  if (type === "transform") return a.transform?.[name];
  if (type === "ik") return a.ik?.[name];
  if (type === "physics") return a.physics?.[name]?.mix;
  if (type === "path") return a.path?.[name]?.mix;
  return a.slider?.[name]?.mix;
}

export function constraintState(a: any, c: any, type: string): "ligada" | "desligada" | "liga e desliga" {
  const setup = type === "transform" ? (c.mixRotate ?? 1) + (c.mixX ?? 1) + (c.mixY ?? 1) : (c.mix ?? 1);
  const keys = constraintKeys(a, type, c.name);
  if (!keys?.length) return setup ? "ligada" : "desligada";
  const vals = keys.map((k) => (type === "transform" ? (k.mixRotate ?? 1) + (k.mixX ?? 1) + (k.mixY ?? 1) : (k.mix ?? 1)));
  return vals.every((v) => v === 0) ? "desligada" : vals.every((v) => v === vals[0]) ? "ligada" : "liga e desliga";
}

export interface RigStudy {
  animations: { name: string; duration: number }[];
  constraints: { name: string; type: string; what: string; use: Record<string, string[]> }[];
  ranges: { bone: string; channels: { timeline: string; lo: number[]; hi: number[]; anims: string[] }[] }[];
  swaps: { slot: string; options: string[]; hidden: boolean; usedIn: string[] }[];
  warnings: string[];
}

export function rigStudy(json: SpineJson, exclude: string[] = [], onlyUnder?: string, m?: Medidor): RigStudy {
  const anims = Object.entries<any>(animations(json)).filter(([n]) => !exclude.includes(n));
  const out: RigStudy = { animations: anims.map(([n, a]) => ({ name: n, duration: animDuration(a) })), constraints: [], ranges: [], swaps: [], warnings: [] };
  const parent = new Map(bones(json).map((b) => [b.name, b.parent]));

  for (const { c, type } of constraints(json)) {
    let what = "";
    if (type === "transform") what = `${c.source ?? c.target} -> ${(c.bones ?? []).join(",")}`;
    else if (type === "ik") what = `${(c.bones ?? []).join(",")} alcanca ${c.target}`;
    else if (type === "physics") what = `${c.bone}${["rotate", "scaleX", "shearX"].some((k) => c[k]) ? " (rotacao)" : ""}`;
    else if (type === "path") what = `${(c.bones ?? []).join(",")} no path do slot ${c.slot ?? c.target}`;
    else what = c.bone ?? c.animation ?? "";
    const use: Record<string, string[]> = {};
    for (const [n, a] of anims) (use[constraintState(a, c, type)] ??= []).push(n);
    out.constraints.push({ name: c.name, type, what, use });
    if (type === "physics" && ["rotate", "scaleX", "shearX"].some((k) => c[k])) {
      const b = bones(json).find((x) => x.name === c.bone);
      if (b && !b.length) out.warnings.push(`fisica ${c.name}: osso ${c.bone} sem comprimento, a rotacao da voltas inteiras (bone.set length)`);
      if (c.gravity) out.warnings.push(`fisica ${c.name}: gravidade ${c.gravity} numa fisica de rotacao; no jogo (spine-godot, esqueleto invertido) ela puxa para o lado contrario do editor do Spine e a peca pode nao voltar ao lugar. A casa usa gravity 0 (so a mola); confira com termina_como`);
    }
  }

  const under = (b: string) => {
    if (!onlyUnder || b === onlyUnder) return true;
    for (let a = parent.get(b); a; a = parent.get(a)) if (a === onlyUnder) return true;
    return false;
  };
  const animated = new Set(anims.flatMap(([, a]) => Object.keys(a.bones ?? {})));
  for (const b of bones(json).map((x) => x.name)) {
    if (!animated.has(b) || !under(b)) continue;
    const per: Record<string, { lo: number[]; hi: number[]; anims: Set<string> }> = {};
    for (const [n, a] of anims)
      for (const [tl, keys] of Object.entries<any>(a.bones?.[b] ?? {}))
        for (const k of keys) {
          const v = keyValues(tl, k);
          const r = (per[tl] ??= { lo: v.map(() => Infinity), hi: v.map(() => -Infinity), anims: new Set() });
          v.forEach((x, i) => ((r.lo[i] = Math.min(r.lo[i], x)), (r.hi[i] = Math.max(r.hi[i], x))));
          r.anims.add(n);
        }
    out.ranges.push({ bone: b, channels: Object.entries(per).map(([timeline, r]) => ({ timeline, lo: r.lo, hi: r.hi, anims: [...r.anims] })) });
  }

  for (const s of slots(json)) {
    const opts = new Set<string>();
    for (const sk of skins(json)) for (const n of Object.keys(sk.attachments?.[s.name] ?? {})) opts.add(n);
    const usedIn = anims.filter(([, a]) => a.slots?.[s.name]?.attachment).map(([n]) => n);
    if (opts.size > 1 || usedIn.length || (!s.attachment && opts.size)) out.swaps.push({ slot: s.name, options: [...opts], hidden: !s.attachment, usedIn });
  }

  // pecas desenhadas antes da imagem de um osso ancestral: se andarem demais, somem por baixo.
  // Ossos de topo (raiz e o primeiro abaixo dela) seguram malhas com pesos do corpo todo; nao contam.
  const order = slots(json);
  const depth = (b: string) => {
    let d = 0;
    for (let a = parent.get(b); a; a = parent.get(a)) d++;
    return d;
  };
  // so conta quem cobre de verdade: caixas das imagens (region) na setup que se tocam.
  // Malha ou outro tipo: sem caixa, conta (na duvida, avisa).
  const setupSk = poseAt(json, null, 0, m);
  const defaultSkin = skins(json).find((k) => k.name === "default") ?? skins(json)[0];
  const box = (slot: { name: string; bone: string; attachment?: string }): number[] | null => {
    const at = slot.attachment && defaultSkin?.attachments?.[slot.name]?.[slot.attachment];
    if (!at || (at.type && at.type !== "region")) return null;
    const p = setupSk.findBone(slot.bone);
    if (!p || !at.width || !at.height) return null;
    const r = ((at.rotation ?? 0) * Math.PI) / 180,
      cs = Math.cos(r),
      sn = Math.sin(r);
    const xs: number[] = [],
      ys: number[] = [];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = (u * at.width * (at.scaleX ?? 1)) / 2,
        ly = (v * at.height * (at.scaleY ?? 1)) / 2;
      const bx = (at.x ?? 0) + lx * cs - ly * sn,
        by = (at.y ?? 0) + lx * sn + ly * cs;
      xs.push(p.a * bx + p.b * by + p.worldX);
      ys.push(p.c * bx + p.d * by + p.worldY);
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const touches = (s: any, t: any) => {
    const a = box(s),
      b = box(t);
    return !a || !b || (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]);
  };
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    for (let a = parent.get(s.bone), k = 0; a && k < 2 && depth(a) >= 2; a = parent.get(a), k++) {
      const covers = order.slice(i + 1).filter((t) => t.bone === a && t.attachment && touches(s, t)).map((t) => t.name);
      if (covers.length) {
        out.warnings.push(`${s.name} passa por baixo de ${covers.slice(0, 3).join(", ")} (osso ${a}): se andar demais, some atras`);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- regras

export interface Rule {
  line: string;
  kind: string;
  args: string[];
  except: string[];
}
export interface FichaRules {
  all: Rule[];
  byAnim: Record<string, Rule[]>;
}

export function parseFicha(md: string): FichaRules {
  const out: FichaRules = { all: [], byAnim: {} };
  let section: string | null = null;
  let inBlock = false;
  let except: string[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    const h = /^##\s+(.*)$/.exec(raw);
    if (h && !inBlock) {
      const title = h[1].trim();
      const m = /^anima[cç][aã]o:?\s+(\S+)/i.exec(title);
      section = m ? m[1].replace(/`/g, "") : /^rig\b/i.test(title) ? "*" : null;
      continue;
    }
    if (/^```regras/.test(line)) {
      inBlock = true;
      except = [];
      continue;
    }
    if (inBlock && line.startsWith("```")) {
      inBlock = false;
      continue;
    }
    if (!inBlock || !line || line.startsWith("#") || section === null) continue;
    const [kind, ...args] = tokens(line.replace(/\s+#.*$/, ""));
    if (kind === "exceto") {
      except = args.flatMap((a) => a.split(","));
      continue;
    }
    const rule: Rule = { line: line.replace(/\s+#.*$/, ""), kind, args, except };
    except = [];
    if (section === "*") out.all.push(rule);
    else (out.byAnim[section] ??= []).push(rule);
  }
  return out;
}

// palavras separadas por espaco; nomes com espaco entre aspas ("dedo dobrado 1")
function tokens(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}
const quoteName = (name: string) => (/\s/.test(name) ? `"${name}"` : name);

// "a..b" ou um valor so ("4" = exatamente 4, com a tolerancia de arredondamento)
const range = (s: string): [number, number] => {
  const m = /^(-?[\d.]+)\.\.(-?[\d.]+)$/.exec(s);
  if (m) return [+m[1], +m[2]];
  if (/^-?[\d.]+$/.test(s)) return [+s, +s];
  throw new Error(`faixa invalida: ${s} (use a..b ou um valor)`);
};

export interface RuleResult {
  rule: string;
  ok: boolean;
  detail: string;
}

// angulo final de um osso em relacao ao pai (depois de IK e constraints), em graus
export function relAngle(sk: Quadro, bone: string): number {
  const b = sk.findBone(bone)!;
  const w = (x: { a: number; c: number }) => Math.atan2(x.c, x.a) * DEG;
  return b.parent ? w(b) - w(b.parent) : w(b);
}

// faixa de rotacao final (relativa a pose base) de cada osso, medida nas animacoes
export function appliedRotateRanges(json: SpineJson, bones: string[], anims: string[], fps = 15, m?: Medidor): Map<string, [number, number]> {
  const own = m ? null : abrirLeve(json);
  const med = m ?? own!;
  try {
  const setup = poseAt(json, null, 0, med);
  const base = new Map(bones.map((b) => [b, relAngle(setup, b)]));
  const out = new Map<string, [number, number]>();
  for (const an of anims) {
    const d = animDuration((json.animations as any)[an]);
    const n = Math.max(1, Math.round(d * fps));
    const poses = posesAt(med, json, an, Array.from({ length: n + 1 }, (_, i) => (i / n) * d));
    for (const sk of poses) {
      for (const b of bones) {
        const v = wrapDeg(relAngle(sk, b) - base.get(b)!);
        const r = out.get(b) ?? [Infinity, -Infinity];
        out.set(b, [Math.min(r[0], v), Math.max(r[1], v)]);
      }
    }
  }
  return out;
  } finally {
    own?.liberar();
  }
}

const CHANNEL: Record<string, (p: LocalQ, s: LocalQ) => number> = {
  rotate: (p, s) => wrapDeg(p.rotation - s.rotation),
  x: (p, s) => p.x - s.x,
  y: (p, s) => p.y - s.y,
  scaleX: (p, s) => p.scaleX / (s.scaleX || 1),
  scaleY: (p, s) => p.scaleY / (s.scaleY || 1),
  shearX: (p, s) => p.shearX - s.shearX,
  shearY: (p, s) => p.shearY - s.shearY,
};

// m: o medidor (sem: abre um so para esta animacao)
export function checkAnimation(json: SpineJson, anim: string, rules: Rule[], fps = 30, m?: Medidor): RuleResult[] {
  const a = json.animations?.[anim];
  if (!a) return [{ rule: `animacao ${anim}`, ok: false, detail: "nao existe no asset" }];
  if (!m) {
    const own = abrirLeve(json);
    try {
      return checkAnimation(json, anim, rules, fps, own);
    } finally {
      own.liberar();
    }
  }
  const med = m;
  const dur = animDuration(a);
  const n = Math.max(1, Math.round(dur * fps));
  const times = Array.from({ length: n + 1 }, (_, i) => (i / n) * dur);
  let poses: Quadro[] | null = null;
  const samples = () => (poses ??= posesAt(med, json, anim, times));
  const setup = poseAt(json, null, 0, med);
  const res: RuleResult[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };
  for (const r of rules) {
    if (r.except.includes(anim)) continue;
    try {
      const [p0, p1, p2] = r.args;
      switch (r.kind) {
        case "duracao": {
          const [lo, hi] = range(p0);
          res.push({ rule: r.line, ok: dur >= lo - 1e-3 && dur <= hi + 1e-3, detail: `${fmt(dur)}s` });
          break;
        }
        case "loop": {
          const tol = +(p0 ?? 2);
          const { worst, bone: at } = poseDistance(json, poseAt(json, anim, 0, med), poseAt(json, anim, dur, med));
          res.push({ rule: r.line, ok: worst <= tol, detail: worst <= tol ? `emenda (pior ${fmt(worst)})` : `${at} salta ${fmt(worst)} do fim para o comeco` });
          break;
        }
        case "limite": {
          need(!!p0 && !!p1 && !!p2, "use: limite <osso> <canal> a..b");
          const get = CHANNEL[p1];
          need(!!get, `canal ${p1}: use ${Object.keys(CHANNEL).join(", ")}`);
          const [lo, hi] = range(p2);
          const sd = setup.findBone(p0);
          need(!!sd, `osso nao existe: ${p0}`);
          let min = Infinity,
            max = -Infinity,
            tmin = 0,
            tmax = 0;
          // rotate: o angulo final em relacao ao pai, depois de IK e constraints (as chaves
          // de um osso movido por IK ficam paradas e diziam 0..0 com o pulso virado do avesso)
          const rel = (sk: Quadro) => relAngle(sk, p0);
          const base = rel(setup);
          samples().forEach((sk, i) => {
            const b = sk.findBone(p0)!;
            const v = p1 === "rotate" ? wrapDeg(rel(sk) - base) : get(b.local, b.setup);
            if (v < min - EMPATE) (min = v), (tmin = times[i]);
            if (v > max + EMPATE) (max = v), (tmax = times[i]);
          });
          const ok = min >= lo - 1e-3 && max <= hi + 1e-3;
          res.push({ rule: r.line, ok, detail: ok ? `${fmt(min)}..${fmt(max)}` : `${fmt(min)} em t=${tmin.toFixed(2)} .. ${fmt(max)} em t=${tmax.toFixed(2)}` });
          break;
        }
        case "preso": {
          need(!!p0 && !!p1, "use: preso <peca> <em> [tolerancia]");
          const tol = +(p2 ?? 5);
          const r0 = relation(setup, p1, p0);
          let worst = 0,
            at = 0;
          samples().forEach((sk, i) => {
            const q = relation(sk, p1, p0);
            const d = Math.hypot(q.x - r0.x, q.y - r0.y);
            if (d > worst + EMPATE) (worst = d), (at = times[i]);
          });
          res.push({ rule: r.line, ok: worst <= tol, detail: `pior ${fmt(worst)} em t=${at.toFixed(2)}` });
          break;
        }
        case "fisica": {
          need(!!p0, "use: fisica <osso> <graus>");
          const lim = +(p1 ?? 25);
          const par = bones(json).find((b) => b.name === p0)?.parent;
          need(!!par, `osso sem pai: ${p0}`);
          const r0 = relation(setup, par!, p0);
          let worst = 0,
            at = 0;
          samples().forEach((sk, i) => {
            const d = Math.abs(wrapDeg(relation(sk, par!, p0).ang - r0.ang));
            if (d > worst + EMPATE) (worst = d), (at = times[i]);
          });
          res.push({ rule: r.line, ok: worst <= lim, detail: `pior ${fmt(worst)}° em t=${at.toFixed(2)}` });
          break;
        }
        case "termina_como":
        case "comeca_como": {
          need(!!p0 && !!json.animations?.[p0], `animacao nao existe: ${p0}`);
          const tol = +(p1 ?? 15);
          const { worst, bone: at } = poseDistance(json, poseAt(json, anim, r.kind === "termina_como" ? dur : 0, med), poseAt(json, p0, 0, med));
          res.push({ rule: r.line, ok: worst <= tol, detail: worst <= tol ? `combina (pior ${fmt(worst)})` : `${at} fica a ${fmt(worst)} da pose de ${p0}` });
          break;
        }
        case "transicao":
        case "corte": {
          need(!!p0 && !!json.animations?.[p0], `animacao nao existe: ${p0}`);
          need(p1 !== undefined && isFinite(+p1), `use: ${r.kind} <animacao> <mix em segundos> [tolerancia]`);
          const o = { tol: p2 !== undefined ? +p2 : undefined };
          if (r.kind === "transicao") {
            const m = measureTransition(json, anim, { next: p0, mix: +p1 }, o, med);
            res.push({ rule: r.line, ok: m.ok, detail: m.summary });
          } else {
            const m = measureCuts(json, anim, { next: p0, mix: +p1 }, o, med);
            const bad = m.cuts.filter((c) => !c.ok);
            res.push({ rule: r.line, ok: m.ok, detail: m.ok ? `nenhum corte pula (pior em t=${m.worst.start.toFixed(2)}: ${m.worst.bones[0]?.bone ?? "-"} score ${m.worst.bones[0]?.score ?? 0})` : `pula cortando em ${bad.map((c) => c.at.toFixed(2)).join(", ")}; pior em t=${m.worst.start.toFixed(2)}: ${m.worst.summary}` });
          }
          break;
        }
        case "parado": {
          const tls = Object.keys(a.bones?.[p0] ?? {});
          res.push({ rule: r.line, ok: !tls.length, detail: tls.length ? `animado: ${tls.join(", ")}` : "sem timelines" });
          break;
        }
        case "constraint": {
          const c = constraints(json).find((x) => x.c.name === p0);
          need(!!c, `constraint nao existe: ${p0}`);
          const st = constraintState(a, c!.c, c!.type);
          res.push({ rule: r.line, ok: st === p1, detail: st });
          break;
        }
        case "evento": {
          const [lo, hi] = range(p1);
          const ev = (a.events ?? []).filter((e: any) => e.name === p0).map((e: any) => e.time ?? 0);
          res.push({ rule: r.line, ok: ev.some((t: number) => t >= lo - 1e-3 && t <= hi + 1e-3), detail: ev.length ? `em ${ev.map(fmt).join(", ")}` : "nao acontece" });
          break;
        }
        case "estilo": {
          // nivel de animador: pelo menos a mediana da casa (folga de 15%) na amplitude e no
          // ritmo; so ficar dentro da faixa deixa passar animacao timida
          const m: any = medir("", json, anim, med);
          const c = compararEstilo(m, p1 ?? "personagem", p0);
          need(!!c, `sem faixa da casa para ${p1 ?? "personagem"} / ${p0}`);
          need(!!(json.skeleton as any)?.height, "o cabecalho nao tem bounds: rode skeleton.bounds antes (as medidas sao em % da altura)");
          const baixo = ["corpo", "silhueta", "giro", "giroMediano", "batidas"].filter((k) => m[k] < c!.ref[k][1] * 0.85).map((k) => `${k} ${fmt(m[k])} (mediana da casa ${fmt(c!.ref[k][1])})`);
          res.push({ rule: r.line, ok: !baixo.length, detail: baixo.length ? `timida: ${baixo.join("; ")}` : `na mediana da casa ou acima (${["corpo", "silhueta", "giroMediano", "batidas"].map((k) => `${k} ${fmt(m[k])}`).join(", ")})` });
          break;
        }
        case "troca": {
          const keys = a.slots?.[p0]?.attachment ?? [];
          const ok = keys.some((k: any) => (k.name ?? null) === (p1 === "nenhuma" ? null : p1));
          res.push({ rule: r.line, ok, detail: ok ? "acontece" : `imagens usadas: ${keys.map((k: any) => k.name ?? "nenhuma").join(", ") || "nenhuma troca"}` });
          break;
        }
        default:
          res.push({ rule: r.line, ok: false, detail: `regra desconhecida: ${r.kind}` });
      }
    } catch (e: any) {
      res.push({ rule: r.line, ok: false, detail: `erro: ${e.message}` });
    }
  }
  return res;
}

// Torcao das malhas numa animacao, como o runtime desenha (esqueleto, pesos e deform
// juntos): em cada instante, a area na tela dos triangulos que dobram (viram contra a
// maioria da malha) ou mudam de area 2.5x mais que o resto dela, relativa ao quadrado da
// altura do personagem. Crescer, encolher ou espelhar a imagem inteira nao conta; malhas
// com chaves de deform na animacao (escolha do animador) tambem nao.
// E medida para OLHAR, nao regra: animadores dobram e esticam malhas de proposito (bone
// girando em 3D, cabeca amassando) na mesma faixa de uma torcao feia. Medido no corpus.
export function meshDistortion(json: SpineJson, anim: string, times: number[], m?: Medidor) {
  const own = m ? null : abrirMedidor(json);
  try {
    return distorcao(m ?? own!, json, anim, times);
  } finally {
    own?.liberar();
  }
}

// a malha (do JSON) que cada slot mostra, por nome da parte: so malhas com triangulos (malha
// ligada e regiao ficam de fora)
function malhasDoJson(json: SpineJson) {
  const out = new Map<string, { name: string; triangles: number[] }>();
  const sks = skins(json);
  const def = sks.find((k) => k.name === "default");
  for (const sk of def ? [def, ...sks.filter((k) => k !== def)] : sks)
    for (const [slot, atts] of Object.entries<any>(sk.attachments ?? {}))
      for (const [n, a] of Object.entries<any>(atts)) if (a?.type === "mesh" && a.triangles && !out.has(`${slot}\u0000${n}`)) out.set(`${slot}\u0000${n}`, { name: n, triangles: a.triangles });
  return out;
}

function distorcao(med: Medidor, json: SpineJson, anim: string, times: number[]) {
  const malhas = malhasDoJson(json);
  const verts = (q: Quadro) => {
    const out = new Map<string, { v: number[]; tri: number[]; name: string }>();
    for (const s of q.slots) {
      const mm = s.attachment !== null ? malhas.get(`${s.name}\u0000${s.attachment}`) : undefined;
      if (!mm || !s.vertices?.length) continue;
      out.set(`${s.name}\u0000${s.attachment}`, { v: s.vertices, tri: mm.triangles, name: mm.name });
    }
    return out;
  };
  const base = verts(med.poses(null, [0], { vertices: true })[0]);
  const area = (v: number[], p: number, q: number, r: number) => ((v[q * 2] - v[p * 2]) * (v[r * 2 + 1] - v[p * 2 + 1]) - (v[r * 2] - v[p * 2]) * (v[q * 2 + 1] - v[p * 2 + 1])) / 2;
  // por malha e instante: a fracao da area da imagem em triangulos que viraram ou mudaram
  // mais que 2.5x. Deform de animador mexe em poucos triangulos pequenos (boca, sobrancelha);
  // braco torcido estraga um pedaco grande da imagem
  // malhas que a animacao deforma a mao (chaves de deform): a forma ali e escolha do
  // animador (escorco, palma virada, sobrancelha espelhada); conta so o que torce sozinho
  const sculpted = new Set<string>();
  for (const skin of Object.values<any>((json.animations as any)?.[anim]?.attachments ?? {})) for (const slot of Object.values<any>(skin)) for (const [att, tls] of Object.entries<any>(slot)) if (tls.deform) sculpted.add(att);
  // tamanho do personagem: a area estragada conta em relacao a ele (20% de um colar fino
  // escondido atras da gravata nao se ve; 4% de um braco inteiro salta aos olhos)
  const h = Math.max(1, (json.skeleton as any)?.height || 500);
  let worst = { frac: 0, ratio: 1, mesh: "", t: 0 };
  const all: { frac: number; mesh: string; t: number }[] = [];
  const quadros = med.poses(anim, times, { vertices: true });
  for (const q of quadros) {
    const t = q.t;
    for (const [a, cur] of verts(q)) {
      const v1 = cur.v;
      const v0 = base.get(a)?.v;
      if (!v0 || sculpted.has(cur.name)) continue;
      const tri = cur.tri;
      const pairs: [number, number][] = [];
      let total = 0;
      for (let k = 0; k < tri.length; k += 3) {
        const A0 = area(v0, tri[k], tri[k + 1], tri[k + 2]),
          A1 = area(v1, tri[k], tri[k + 1], tri[k + 2]);
        total += Math.abs(A0);
        if (Math.abs(A0) >= 4) pairs.push([A0, A1]);
      }
      if (!pairs.length) continue;
      // forma, nao tamanho: a imagem inteira crescer, encolher ou espelhar (popup que surge
      // de 0, dado que gira, escala -1) e intencao. Conta o triangulo que destoa da malha:
      // orientacao contra a da maioria, ou area mudando 2.5x mais (ou menos) que a mediana
      const k = pairs.map(([A0, A1]) => A1 / A0).sort((x, y) => x - y);
      const med = k[Math.floor(k.length / 2)];
      if (Math.abs(med) < 0.02) continue; // malha quase sumida: nao se ve
      let bad = 0,
        top = 1;
      for (const [A0, A1] of pairs) {
        const rel = A1 / A0 / med;
        const ratio = rel <= 0 ? Infinity : Math.max(rel, 1 / rel);
        // dobra: o triangulo vira contra a maioria (a imagem dobra sobre si mesma). Amassar
        // e esticar um pedaco e recurso do animador (bico, colar); dobrar e arte quebrada
        // na tela: dobrou (vira contra a maioria) ou esticou/encolheu 2.5x mais que o resto
        if ((rel < 0 && Math.abs(A1) > 1) || ratio > 2.5) bad += Math.max(Math.abs(A1), Math.abs(A0 * med));
        top = Math.max(top, ratio);
      }
      // area estragada na tela, em % da area de um quadrado da altura do personagem
      const frac = bad / (h * h);
      if (frac > 0) all.push({ frac, mesh: cur.name, t });
      if (frac > worst.frac) worst = { frac, ratio: top, mesh: cur.name, t };
    }
  }
  return { ...worst, all };
}

export function checkFicha(json: SpineJson, md: string, only?: string[], m?: Medidor): Record<string, RuleResult[]> {
  const f = parseFicha(md);
  const names = only ?? Object.keys(animations(json));
  const out: Record<string, RuleResult[]> = {};
  const own = m ? null : abrirLeve(json);
  try {
    for (const n of names) out[n] = checkAnimation(json, n, [...f.all, ...(f.byAnim[n] ?? [])], 30, m ?? own!);
  } finally {
    own?.liberar();
  }
  for (const n of Object.keys(f.byAnim)) if (!animations(json)[n] && (!only || only.includes(n))) out[n] = [{ rule: `## Animacao: ${n}`, ok: false, detail: "a ficha descreve, mas o asset nao tem (falta fazer?)" }];
  return out;
}

// ---------------------------------------------------------------- rascunho

export interface GameContext {
  project?: string;
  returnsTo?: Record<string, string>; // animacao -> animacao que o jogo toca em seguida
  usage?: Record<string, string[]>; // animacao -> arquivos:linhas do jogo que a citam
  mix?: { defaultMix?: number; pairs?: string[] };
}

// Medidas de uma animacao para o rascunho: o que ela faz hoje, para virar regra.
function measure(json: SpineJson, anim: string, m: Medidor) {
  const a = json.animations[anim];
  const dur = animDuration(a);
  const loop = checkAnimation(json, anim, [{ line: "loop", kind: "loop", args: ["2"], except: [] }], 30, m)[0];
  const physics = constraints(json).filter((x) => x.type === "physics");
  const phys = physics.map(({ c }) => ({ bone: c.bone, res: checkAnimation(json, anim, [{ line: "", kind: "fisica", args: [c.bone, "999"], except: [] }], 30, m)[0] }));
  return { dur, loopOk: loop.ok, loopDetail: loop.detail, phys, bones: Object.keys(a.bones ?? {}), swaps: Object.keys(a.slots ?? {}).filter((s) => a.slots[s].attachment), events: (a.events ?? []).map((e: any) => `${e.name}@${fmt(e.time ?? 0)}`) };
}

export function draftFicha(json: SpineJson, name: string, ctx: GameContext = {}): string {
  const m = abrirLeve(json);
  try {
    return rascunho(json, name, ctx, m);
  } finally {
    m.liberar();
  }
}

function rascunho(json: SpineJson, name: string, ctx: GameContext, med: Medidor): string {
  const st = rigStudy(json, [], undefined, med);
  const L: string[] = [];
  const allBones = bones(json).map((b) => b.name);
  L.push(`# Ficha: ${name}`, "");
  L.push(
    "> Rascunho gerado pelo Mamulengo a partir do asset. As partes medidas estao certas; as marcadas com **(descrever)** precisam de quem conhece o personagem. Mantenha esta ficha junto do .spine-json e atualize quando o rig ou as animacoes mudarem.",
    "",
  );
  L.push("## Personagem", "");
  L.push("- **Quem e:** (descrever: personalidade, como se move, peso, idade, exagero aceito)");
  L.push("- **Onde aparece no jogo:** (descrever: tela, tamanho aproximado na tela, o que esta em volta)");
  if (ctx.project) L.push(`- **Projeto:** ${ctx.project}`);
  if (ctx.mix?.defaultMix !== undefined || ctx.mix?.pairs?.length)
    L.push(`- **Transicoes no jogo:** mix padrao ${ctx.mix?.defaultMix ?? "?"}s${ctx.mix?.pairs?.length ? `; especificas: ${ctx.mix.pairs.join(", ")}` : ""}. Poses de inicio e fim precisam combinar com isso.`);
  L.push("");

  L.push("## Rig", "");
  L.push(`${allBones.length} ossos, ${slots(json).length} slots, ${constraints(json).length} constraints.`, "");
  L.push("### O que e preso a que", "");
  for (const c of st.constraints) L.push(`- \`${c.name}\` (${c.type}): ${c.what}. ${Object.entries(c.use).map(([k, v]) => `${k} em ${v.join(", ")}`).join("; ")}.`);
  if (!st.constraints.length) L.push("- nenhuma constraint");
  L.push("", "### Gestos prontos (trocas de imagem)", "");
  for (const s of st.swaps) L.push(`- \`${s.slot}\`: ${s.options.join(", ")}${s.hidden ? " (escondido no setup)" : ""}${s.usedIn.length ? `; usado em ${s.usedIn.join(", ")}` : ""}`);
  if (!st.swaps.length) L.push("- nenhuma");
  L.push("", "### Cuidados", "");
  for (const w of st.warnings) L.push(`- ${w}`);
  L.push("- (descrever: partes que nunca se mexem, articulacoes que quebram a arte, o que a arte nao cobre)", "");
  L.push("### Faixas usadas pelo animador (relativas ao setup)", "");
  L.push("Limite natural do movimento. Ir alem pede motivo.", "");
  for (const r of st.ranges) L.push(`- \`${r.bone}\`: ${r.channels.map((c) => `${c.timeline} ${c.lo.map((lo, i) => `${fmt(lo)}..${fmt(c.hi[i])}`).join(" / ")}`).join("; ")}`);
  L.push("");

  // regras do rig: limites com folga de 15% da faixa, pecas presas e fisica
  L.push("```regras");
  L.push("# limites (faixa do animador com folga, angulo final depois de IK e constraints); ajuste se o personagem permitir mais");
  {
    // ossos com chave de rotacao e ossos movidos por IK/transform: a faixa e medida no
    // resultado, igual a regra (pulso e cotovelo de IK so aparecem assim)
    const keyed = st.ranges.filter((r) => r.channels.some((c) => c.timeline === "rotate")).map((r) => r.bone);
    const driven = (json.constraints ?? []).filter((c: any) => (c.type ?? "") === "ik" || c.type === "transform").flatMap((c: any) => c.bones ?? (c.bone ? [c.bone] : []));
    const list = [...new Set([...keyed, ...driven])].filter((b) => bones(json).some((x) => x.name === b));
    const animNames = Object.keys(json.animations ?? {});
    const rr = appliedRotateRanges(json, list, animNames, 15, med);
    for (const b of list) {
      const r = rr.get(b);
      if (!r || !isFinite(r[0])) continue;
      const pad = Math.max(3, (r[1] - r[0]) * 0.15);
      L.push(`limite ${quoteName(b)} rotate ${fmt(r[0] - pad)}..${fmt(r[1] + pad)}`);
    }
  }
  // alvo de transform constraint: medido em cada animacao; onde o animador o desloca de
  // proposito (ou liga a constraint), vira excecao
  for (const c of st.constraints) {
    if (c.type !== "transform") continue;
    const target = c.what.split("-> ")[1]?.split(",")[0];
    const par = bones(json).find((b) => b.name === target)?.parent;
    if (!target || !par) continue;
    // quanto o animador desloca a peca em cada animacao: a tolerancia vem disso, e o que
    // passa muito da mediana (tirar os oculos, por exemplo) vira excecao
    const devs = st.animations.map(({ name: an }) => {
      const d = checkAnimation(json, an, [{ line: "", kind: "preso", args: [target, par, "0"], except: [] }], 30, med)[0].detail;
      return { an, d: +(/pior ([\d.]+)/.exec(d)?.[1] ?? 0) };
    });
    const sorted = devs.map((x) => x.d).sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const loose = devs.filter((x) => x.d > Math.max(20, median * 3)).map((x) => x.an);
    const tol = Math.max(8, Math.ceil(Math.max(0, ...devs.filter((x) => !loose.includes(x.an)).map((x) => x.d)) * 1.1) + 2);
    L.push(`# ${target} acompanha ${par}; deslocamento medido por animacao: ${devs.map((x) => `${x.an} ${fmt(x.d)}`).join(", ")}`);
    if (loose.length) L.push(`exceto ${loose.join(",")}`);
    L.push(`preso ${quoteName(target)} ${quoteName(par)} ${tol}`);
  }
  for (const { c } of constraints(json).filter((x) => x.type === "physics")) L.push(`fisica ${quoteName(c.bone)} 25`);
  L.push("```", "");

  L.push("## Animacoes", "");
  L.push("Cada animacao: para que serve, quando toca, roteiro em batidas, comportamento esperado e o que nao fazer. As regras de cada secao somam com as do Rig.", "");
  for (const { name: an } of st.animations) {
    const m = measure(json, an, med);
    L.push(`## Animacao: ${an}`, "");
    L.push(`- **Para que serve:** (descrever)`);
    L.push(`- **Quando toca:** ${ctx.usage?.[an]?.length ? `citada em ${ctx.usage[an].slice(0, 4).join(", ")}${ctx.usage[an].length > 4 ? "..." : ""}` : "(descrever; o codigo do jogo nao cita este nome)"}`);
    L.push(`- **Duracao:** ${fmt(m.dur)}s; ${m.loopOk ? "emenda em loop" : `nao emenda (${m.loopDetail}): toca uma vez ou volta por mix`}`);
    L.push(`- **Mexe em:** ${m.bones.length ? m.bones.join(", ") : "nenhum osso"}${m.swaps.length ? `; troca ${m.swaps.join(", ")}` : ""}${m.events.length ? `; eventos ${m.events.join(", ")}` : ""}`);
    L.push(`- **Roteiro (batidas):** (descrever: tempo -> o que acontece; antecipacao, acao, assentamento)`);
    L.push(`- **Comportamento esperado:** (descrever: o que o jogador deve sentir e ler)`);
    L.push(`- **Nao fazer:** (descrever)`, "");
    L.push("```regras");
    L.push(`duracao ${+m.dur.toFixed(3)}..${+m.dur.toFixed(3)}`);
    if (m.loopOk) L.push("loop");
    // sem o codigo do jogo: o que nao emenda em si mesmo provavelmente volta para o idle
    const idle = st.animations.map((x) => x.name).find((n) => /idle/i.test(n) && !/break/i.test(n));
    const next = ctx.returnsTo?.[an] ?? (!m.loopOk && idle && idle !== an ? idle : undefined);
    if (next && next !== an) {
      // o que o animador fez hoje e aceito (o mix do jogo cobre); acima de 15, anota a medida
      const r = checkAnimation(json, an, [{ line: "", kind: "termina_como", args: [next, "15"], except: [] }], 30, med)[0];
      const m2 = /a ([\d.]+) da pose/.exec(r.detail);
      if (r.ok || !m2) L.push(`termina_como ${next} 15`);
      else L.push(`# hoje termina a ${m2[1]} da pose de ${next} (${r.detail.split(" ")[0]}); o mix do jogo cobre`, `termina_como ${next} ${Math.ceil(+m2[1]) + 2}`);
      const mix = ctx.mix?.defaultMix;
      if (mix !== undefined) {
        // a emenda como o jogo toca (queueAnim com o mix do -data.tres)
        const t = measureTransition(json, an, { next, mix }, {}, med);
        if (t.ok) L.push(`transicao ${next} ${mix}`);
        // hoje pula: fica anotado (o rascunho so propoe regras que a animacao cumpre)
        else L.push(`# hoje ${t.summary}`, `# transicao ${next} ${mix}`);
      }
    }
    for (const s of m.swaps) {
      const k = json.animations[an].slots[s].attachment.find((x: any) => x.name);
      if (k) L.push(`troca ${quoteName(s)} ${quoteName(k.name)}`);
    }
    L.push("```", "");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------- leitura para a UI

export interface FichaSection {
  title: string;
  // itens "- **Rotulo:** texto"
  fields: { label: string; text: string }[];
}

// Secoes "## ..." com os campos em negrito; blocos de codigo ficam de fora (as regras
// sao lidas por parseFicha).
export function fichaSections(md: string): { personagem?: FichaSection; rig?: FichaSection; anims: Record<string, FichaSection> } {
  const out: { personagem?: FichaSection; rig?: FichaSection; anims: Record<string, FichaSection> } = { anims: {} };
  let cur: FichaSection | null = null;
  let fence = false;
  for (const raw of md.split("\n")) {
    if (raw.trim().startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = /^##\s+(.*)$/.exec(raw);
    if (h) {
      const title = h[1].trim();
      cur = { title, fields: [] };
      const m = /^anima[cç][aã]o:?\s+(\S+)/i.exec(title);
      if (m) out.anims[m[1].replace(/`/g, "")] = cur;
      else if (/^personagem/i.test(title)) out.personagem = cur;
      else if (/^rig\b/i.test(title)) out.rig = cur;
      continue;
    }
    const f = /^-\s+\*\*(.+?):?\*\*:?\s*(.*)$/.exec(raw);
    if (cur && f) cur.fields.push({ label: f[1].replace(/:$/, ""), text: f[2] });
  }
  return out;
}

// caminho da ficha de um skeleton: x.spine-json -> x.ficha.md
export const fichaPath = (skeleton: string) => skeleton.replace(/\.(spine-json|json)$/, "") + ".ficha.md";
