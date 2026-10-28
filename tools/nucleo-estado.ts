// Conferencia do estado de animacao do nucleo (nucleo/include/mamulengo/estado.h) contra o
// oraculo: o AnimationState do runtime de referencia, usado como caixa-preta (so a API publica:
// setAnimation, addAnimation, setEmptyAnimation, update, apply e os eventos do listener).
//
//   npx tsx tools/nucleo-estado.ts <x.boneco | pasta> ... [--mix 0.2] [--roteiro r.json] [--so nome]
//       [--nucleo nucleo/build/nucleo-estado] [--detalhe]
//
// Um ROTEIRO e uma lista de acoes com o quadro em que acontecem e o numero de quadros de
// `passo` segundos (padrao 1/60). Por quadro q, o oraculo faz:
//   acoes do quadro q (tocar, enfileirar, vazio, limpar, escala_tempo);
//   state.update(d); state.apply(skeleton);
//   acoes de slot do quadro q (cor, esconder: o jogo muda o slot entre aplicar e o mundo);
//   skeleton.update(d); skeleton.updateWorldTransform(Physics.update)
// e guarda a pose (o contrato do nucleo-pose). Os eventos (inicio, interrompida, completa,
// fim, usuario) sao guardados com o quadro em que sairam. O nucleo-estado faz o mesmo com o
// Estado do nucleo; aqui se compara quadro a quadro, com as tolerancias do nucleo-compara.
//
// Sem --roteiro, cada .boneco ganha os roteiros padrao (`roteirosPadrao`): loop por 3 voltas
// e meia, A sem loop com B enfileirada em loop, A cortada no meio por B, A e depois vazio,
// fila com atraso, e o slot mudado pelo jogo. `--mix 0.2` troca o mix padrao do .boneco pelo
// dado (e acrescenta os roteiros que so fazem sentido com mix: corte no meio de um mix).
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, MeshAttachment, Physics, RegionAttachment, Skeleton, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-core";
import { exportarSpine } from "../src/boneco/spine.ts";
import { godotGravity } from "../src/core/pose.ts";

export interface Acao {
  quadro: number;
  tipo: "tocar" | "enfileirar" | "vazio" | "enfileirar_vazio" | "limpar" | "limpar_trilha" | "escala_tempo" | "cor" | "esconder";
  trilha?: number;
  animacao?: string;
  loop?: boolean;
  atraso?: number;
  mix?: number;
  valor?: number;
  slot?: string;
  cor?: [number, number, number, number];
}

export interface Roteiro {
  nome: string;
  quadros: number;
  passo?: number;
  // substitui o mix do .boneco (padrao e pares)
  mix?: { padrao?: number; pares?: { de: string; para: string; tempo: number }[] };
  acoes: Acao[];
}

export interface Evento {
  quadro: number;
  tipo: "inicio" | "interrompida" | "completa" | "fim" | "usuario";
  trilha: number;
  animacao: string | null;
  nome?: string;
  tempo?: number;
  inteiro?: number;
  decimal?: number;
  texto?: string | null;
  volume?: number;
  balanco?: number;
}

const VAZIA = "<empty>";

function mixDe(boneco: any, r: Roteiro) {
  const padrao = r.mix?.padrao ?? boneco.mix?.padrao ?? 0;
  const pares = r.mix?.pares ?? boneco.mix?.pares ?? [];
  return { padrao, pares };
}

export function oraculoEstado(boneco: any, r: Roteiro) {
  const e = exportarSpine(boneco);
  const data = new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(e.atlas))).readSkeletonData(godotGravity(e.json));
  const sk = new Skeleton(data);
  const sd = new AnimationStateData(data);
  const mix = mixDe(boneco, r);
  sd.defaultMix = mix.padrao;
  for (const p of mix.pares) sd.setMix(p.de, p.para, p.tempo);
  const st = new AnimationState(sd);
  const eventos: Evento[] = [];
  let quadro = 0;
  const nomeAnim = (en: any) => (en.animation.name === VAZIA ? null : en.animation.name);
  const ev = (tipo: Evento["tipo"]) => (en: any) => eventos.push({ quadro, tipo, trilha: en.trackIndex, animacao: nomeAnim(en) });
  st.addListener({
    start: ev("inicio"),
    interrupt: ev("interrompida"),
    complete: ev("completa"),
    end: ev("fim"),
    event: (en: any, x: any) =>
      eventos.push({ quadro, tipo: "usuario", trilha: en.trackIndex, animacao: nomeAnim(en), nome: x.data.name, tempo: x.time, inteiro: x.intValue, decimal: x.floatValue, texto: x.stringValue ?? null, volume: x.volume, balanco: x.balance }),
  } as any);

  sk.setupPose();
  sk.time = 0;
  sk.updateWorldTransform(Physics.reset);
  const d = r.passo ?? 1 / 60;
  const quadros: any[] = [];
  const porQuadro = new Map<number, Acao[]>();
  for (const a of r.acoes) porQuadro.set(a.quadro, [...(porQuadro.get(a.quadro) ?? []), a]);
  for (quadro = 0; quadro < r.quadros; quadro++) {
    const acoes = porQuadro.get(quadro) ?? [];
    for (const a of acoes) {
      const t = a.trilha ?? 0;
      switch (a.tipo) {
        case "tocar":
          st.setAnimation(t, a.animacao!, a.loop ?? true);
          break;
        case "enfileirar":
          st.addAnimation(t, a.animacao!, a.loop ?? true, a.atraso ?? 0);
          break;
        case "vazio":
          st.setEmptyAnimation(t, a.mix ?? 0);
          break;
        case "enfileirar_vazio":
          st.addEmptyAnimation(t, a.mix ?? 0, a.atraso ?? 0);
          break;
        case "limpar":
          st.clearTracks();
          break;
        case "limpar_trilha":
          st.clearTrack(t);
          break;
        case "escala_tempo":
          st.timeScale = a.valor ?? 1;
          break;
      }
    }
    st.update(d);
    st.apply(sk);
    for (const a of acoes) {
      if (a.tipo !== "cor" && a.tipo !== "esconder") continue;
      const s = sk.findSlot(a.slot!) as any;
      if (a.tipo === "cor") s.pose.color.set(...a.cor!);
      else s.pose.setAttachment(null);
    }
    sk.update(d);
    sk.updateWorldTransform(Physics.update);
    quadros.push(pose(sk, quadro));
  }
  return { quadros, eventos };
}

function pose(sk: Skeleton, q: number) {
  const ossos: Record<string, number[]> = {};
  for (const b of sk.bones) {
    const p = b.appliedPose;
    ossos[b.data.name] = [p.a, p.b, p.c, p.d, p.worldX, p.worldY];
  }
  const slots: any[] = [];
  const vertices: Record<string, number[]> = {};
  for (const s of sk.drawOrder.appliedPose) {
    const a = s.appliedPose.attachment;
    const c = s.appliedPose.color;
    slots.push({ nome: s.data.name, parte: a ? a.name : null, cor: [c.r, c.g, c.b, c.a] });
    if (!s.bone.active) continue;
    if (a instanceof RegionAttachment) {
      const v = new Array(8).fill(0);
      a.computeWorldVertices(s, a.getOffsets(s.appliedPose), v, 0, 2);
      vertices[s.data.name] = v;
    } else if (a instanceof MeshAttachment) {
      const v = new Array(a.worldVerticesLength).fill(0);
      a.computeWorldVertices(sk, s, 0, a.worldVerticesLength, v, 0, 2);
      vertices[s.data.name] = v;
    }
  }
  return { q, ossos, slots, vertices };
}

// duracao como o nucleo e o oraculo contam: o maior tempo de chave, em float32
export function duracao(boneco: any, anim: string): number {
  let d = 0;
  const visita = (n: any) => {
    if (Array.isArray(n)) {
      for (const k of n) {
        if (k && typeof k === "object" && !Array.isArray(k)) d = Math.max(d, Math.fround(k.tempo ?? 0));
        visita(k);
      }
    } else if (n && typeof n === "object") for (const v of Object.values(n)) visita(v);
  };
  visita(boneco.animacoes?.[anim]);
  return d;
}

const Q = (s: number) => Math.max(1, Math.round(s * 60));

export function roteirosPadrao(boneco: any, mix: number | null): Roteiro[] {
  const anims = Object.keys(boneco.animacoes ?? {});
  const out: Roteiro[] = [];
  const m = mix === null ? undefined : { padrao: mix, pares: [] };
  const sufixo = mix === null ? "" : ` mix ${mix}`;
  const dur = (a: string) => duracao(boneco, a);
  anims.forEach((a, i) => {
    const b = anims[(i + 1) % anims.length];
    const da = dur(a),
      db = dur(b);
    if (mix === null)
      out.push({ nome: `loop ${a}`, quadros: Q(da * 3.5) + 1, acoes: [{ quadro: 0, tipo: "tocar", animacao: a, loop: true }] });
    out.push({
      nome: `fila ${a} > ${b}${sufixo}`,
      quadros: Q(da + db * 2.25) + 2,
      mix: m,
      acoes: [
        { quadro: 0, tipo: "tocar", animacao: a, loop: false },
        { quadro: 0, tipo: "enfileirar", animacao: b, loop: true, atraso: 0 },
      ],
    });
    out.push({
      nome: `corte ${a} / ${b}${sufixo}`,
      quadros: Q(da / 2 + db * 1.5) + 2,
      mix: m,
      acoes: [
        { quadro: 0, tipo: "tocar", animacao: a, loop: true },
        { quadro: Q(da / 2), tipo: "tocar", animacao: b, loop: true },
      ],
    });
    out.push({
      nome: `vazio ${a}${sufixo}`,
      quadros: Q(da * 0.6) + 30,
      mix: m,
      acoes: [
        { quadro: 0, tipo: "tocar", animacao: a, loop: true },
        { quadro: Q(da * 0.6), tipo: "vazio", mix: mix ?? 0 },
      ],
    });
    if (mix === null && i === 0)
      out.push({
        nome: `atraso ${a} > ${b}`,
        quadros: Q(da + db) + 30,
        acoes: [
          { quadro: 0, tipo: "tocar", animacao: a, loop: true },
          { quadro: 0, tipo: "enfileirar", animacao: b, loop: false, atraso: 0.5 },
          { quadro: 0, tipo: "enfileirar_vazio", mix: 0, atraso: 0 },
        ],
      });
    if (mix !== null && i === 0)
      out.push({
        nome: `corte no mix ${a} / ${b} / ${a}${sufixo}`,
        quadros: Q(da + db) + 30,
        mix: m,
        acoes: [
          { quadro: 0, tipo: "tocar", animacao: a, loop: true },
          { quadro: 30, tipo: "tocar", animacao: b, loop: true },
          { quadro: 30 + Math.max(1, Q((mix as number) / 2)), tipo: "tocar", animacao: a, loop: true },
        ],
      });
    if (mix === null && i === 0 && boneco.slots?.length >= 2)
      out.push({
        nome: `slot do jogo ${a}`,
        quadros: Q(da * 1.5) + 2,
        acoes: [
          { quadro: 0, tipo: "tocar", animacao: a, loop: true },
          { quadro: 5, tipo: "cor", slot: boneco.slots[0].nome, cor: [1, 0.5, 0.25, 0.75] },
          { quadro: 7, tipo: "esconder", slot: boneco.slots[1].nome },
          { quadro: 12, tipo: "escala_tempo", valor: 0.5 },
        ],
      });
  });
  return out;
}

const TOL = { pos: 0.01, mat: 1e-4, cor: 1 / 255 };

export function compara(ref: any, nos: any) {
  let pos = 0,
    mat = 0,
    vert = 0,
    cor = 0,
    partes = 0,
    ordem = 0,
    faltam = 0,
    primeiro = -1;
  ref.quadros.forEach((q: any, i: number) => {
    const n = nos.quadros?.[i];
    const antes = [pos, mat, vert, cor, partes, ordem, faltam].join();
    if (!n) return faltam++;
    for (const [o, m] of Object.entries<number[]>(q.ossos)) {
      const k = n.ossos?.[o];
      if (!k) {
        faltam++;
        continue;
      }
      pos = Math.max(pos, Math.hypot(m[4] - k[4], m[5] - k[5]));
      for (let j = 0; j < 4; j++) mat = Math.max(mat, Math.abs(m[j] - k[j]));
    }
    if (q.slots.map((s: any) => s.nome).join() !== (n.slots ?? []).map((s: any) => s.nome).join()) ordem++;
    for (const s of q.slots) {
      const k = (n.slots ?? []).find((x: any) => x.nome === s.nome);
      if (!k) continue;
      if ((s.parte ?? null) !== (k.parte ?? null)) partes++;
      for (let j = 0; j < 4; j++) cor = Math.max(cor, Math.abs(s.cor[j] - (k.cor?.[j] ?? 0)));
    }
    for (const [s, v] of Object.entries<number[]>(q.vertices)) {
      const k = n.vertices?.[s];
      if (!k || k.length !== v.length) {
        faltam++;
        continue;
      }
      for (let j = 0; j < v.length; j += 2) vert = Math.max(vert, Math.hypot(v[j] - k[j], v[j + 1] - k[j + 1]));
    }
    if (primeiro < 0 && !(pos <= TOL.pos && mat <= TOL.mat && vert <= TOL.pos && cor <= TOL.cor && !partes && !ordem && !faltam) && antes !== [pos, mat, vert, cor, partes, ordem, faltam].join()) primeiro = i;
  });
  const chave = (e: Evento) =>
    [e.quadro, e.tipo, e.trilha, e.animacao, e.nome ?? "", e.tempo == null ? "" : e.tempo.toFixed(6), e.inteiro ?? "", e.decimal == null ? "" : e.decimal.toFixed(6), e.texto ?? "", e.volume == null ? "" : e.volume.toFixed(6), e.balanco == null ? "" : e.balanco.toFixed(6)].join("|");
  const er = (ref.eventos as Evento[]).map(chave),
    en = ((nos.eventos ?? []) as Evento[]).map(chave);
  let evDif = -1;
  for (let i = 0; i < Math.max(er.length, en.length); i++)
    if (er[i] !== en[i]) {
      evDif = i;
      break;
    }
  const ok = pos <= TOL.pos && mat <= TOL.mat && vert <= TOL.pos && cor <= TOL.cor && !partes && !ordem && !faltam && evDif < 0;
  return { ok, pos, mat, vert, cor, partes, ordem, faltam, primeiro, eventos: er.length, evDif, er, en };
}

if (process.argv[1]?.endsWith("nucleo-estado.ts")) {
  const args = process.argv.slice(2);
  const opt = (n: string, d?: string) => {
    const i = args.indexOf(`--${n}`);
    if (i < 0) return d;
    return args.splice(i, 2)[1];
  };
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    if (i >= 0) args.splice(i, 1);
    return i >= 0;
  };
  const mixArg = opt("mix");
  const roteiroArq = opt("roteiro");
  const so = opt("so");
  const bin = resolve(opt("nucleo", "nucleo/build/nucleo-estado")!);
  const detalhe = flag("detalhe");
  const arquivos = args.flatMap((a) => (statSync(a).isDirectory() ? readdirSync(a, { recursive: true }).map(String).filter((f) => f.endsWith(".boneco")).map((f) => join(a, f)) : [a]));
  const tmp = mkdtempSync(join(tmpdir(), "nucleo-estado-"));
  const f = (x: number) => (x === 0 ? "0" : x.toExponential(1));
  const linhas = ["| arquivo | roteiro | quadros | osso (px) | matriz | vertice (px) | cor | partes | ordem | eventos | |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  let falhas = 0,
    total = 0;
  for (const arq of arquivos.sort()) {
    const b = JSON.parse(readFileSync(arq, "utf8"));
    const roteiros: Roteiro[] = roteiroArq ? [].concat(JSON.parse(readFileSync(roteiroArq, "utf8"))) : roteirosPadrao(b, mixArg == null ? null : Number(mixArg));
    const nome = arq.split("/").pop();
    for (const r of roteiros) {
      if (so && !r.nome.includes(so)) continue;
      total++;
      const ref = oraculoEstado(b, r);
      const rarq = join(tmp, "roteiro.json");
      writeFileSync(rarq, JSON.stringify(r));
      const p = spawnSync(bin, [resolve(arq), rarq], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
      if (p.status !== 0 || !p.stdout) {
        falhas++;
        linhas.push(`| ${nome} | ${r.nome} | ${r.quadros} | | | | | | | | ERRO: ${(p.stderr || p.error?.message || "sem saida").trim().split("\n")[0].slice(0, 120)} |`);
        continue;
      }
      const c = compara(ref, JSON.parse(p.stdout));
      if (!c.ok) falhas++;
      const evs = c.evDif < 0 ? `${c.eventos} iguais` : `DIFEREM no ${c.evDif}`;
      linhas.push(`| ${nome} | ${r.nome} | ${r.quadros} | ${f(c.pos)} | ${f(c.mat)} | ${f(c.vert)} | ${f(c.cor)} | ${c.partes} | ${c.ordem} | ${evs} | ${c.ok ? "ok" : `FALHA${c.primeiro >= 0 ? ` (quadro ${c.primeiro})` : ""}${c.faltam ? ` (faltam ${c.faltam})` : ""}`} |`);
      if (detalhe && c.evDif >= 0) {
        linhas.push(`  oraculo: ${c.er.slice(Math.max(0, c.evDif - 2), c.evDif + 4).join("  ;  ")}`);
        linhas.push(`  nucleo:  ${c.en.slice(Math.max(0, c.evDif - 2), c.evDif + 4).join("  ;  ")}`);
      }
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(linhas.join("\n"));
  console.log(`\n${total - falhas} de ${total} roteiros dentro da tolerancia`);
  process.exit(falhas ? 1 : 0);
}
