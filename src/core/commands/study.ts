// Estudo do rig e ferramentas para animar sem quebrar o que o animador montou:
// query.rig (o que o rig permite e como o animador usa), query.relation (uma peca em
// relacao a outra ao longo do tempo) e pose.follow (gira uma cadeia para uma peca
// acompanhar outra, como a mao que segura os oculos acompanhando a cabeca).
import { z } from "zod";
import { Physics } from "@esotericsoftware/spine-core";
import { defineCommand } from "./registry.ts";
import { requireAnimation, requireBone } from "../model.ts";
import { round } from "./timeline.ts";
import { animDuration as duration, checkFicha, draftFicha, fmt, meshDistortion, relation, rigStudy, wrapDeg } from "../ficha.ts";
import { skeletonAt } from "../pose.ts";
import { exposedSeams, seamImages, type Pixels } from "../recorte.ts";

const wrap = wrapDeg;

defineCommand({
  name: "query.rig",
  group: "query",
  readonly: true,
  summary:
    "Estudo do rig antes de animar: constraints e como cada animacao existente as usa (ligada/desligada), a faixa de valores que o animador usou em cada osso (o limite natural do movimento), trocas de imagem disponiveis por slot e armadilhas (fisica sem comprimento, pecas que passam por baixo de outras). exclude: animacoes a ignorar nas faixas (as suas, por exemplo).",
  params: z.object({ exclude: z.array(z.string()).default([]), bone: z.string().optional().describe("so este osso e os filhos nas faixas") }),
  run({ doc }, p) {
    const st = rigStudy(doc.json, p.exclude, p.bone);
    const warn = st.warnings;
    return {
      animacoes: st.animations.map((a) => `${a.name} (${fmt(a.duration)}s)`).join(", "),
      constraints: st.constraints.map((c) => `${c.name} [${c.type}] ${c.what}: ${Object.entries(c.use).map(([l, ns]) => `${l} em ${ns.join(",")}`).join("; ")}`),
      faixas: st.ranges.map((r) => `${r.bone}: ${r.channels.map((c) => `${c.timeline} ${c.lo.map((lo, i) => `${fmt(lo)}..${fmt(c.hi[i])}`).join(" / ")} (${c.anims.length} anim)`).join("; ")}`),
      trocas: st.swaps.map((s) => `${s.slot}: ${s.options.join(", ")}${s.hidden ? " (escondido no setup)" : ""}${s.usedIn.length ? `; ${s.options.length > 1 ? "trocado" : "aparece/some"} em ${s.usedIn.join(",")}` : ""}`),
      atencao: warn.length > 40 ? [...warn.slice(0, 40), `(+${warn.length - 40})`] : warn,
    };
  },
});

defineCommand({
  name: "query.relation",
  group: "query",
  readonly: true,
  summary:
    "Como uma peca (bone) fica em relacao a outra (relativeTo) ao longo de uma animacao, comparado a setup: deslocamento x,y no espaco de relativeTo e angulo. Use para conferir que oculos ficam no rosto, que a mao segura o objeto, que nada descola.",
  params: z.object({ anim: z.string(), bone: z.string(), relativeTo: z.string(), fps: z.number().positive().max(120).default(15) }),
  run({ doc }, p) {
    const a = requireAnimation(doc.json, p.anim);
    requireBone(doc.json, p.bone);
    requireBone(doc.json, p.relativeTo);
    const dur = duration(a);
    const r0 = relation(skeletonAt(doc.json, null, 0), p.relativeTo, p.bone);
    const n = Math.max(1, Math.round(dur * p.fps));
    const rows: string[] = [];
    let maxD = 0,
      maxA = 0,
      at = 0;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * dur;
      const r = relation(skeletonAt(doc.json, p.anim, i === n && n > 0 ? dur - 1e-4 : t), p.relativeTo, p.bone);
      const dx = r.x - r0.x,
        dy = r.y - r0.y,
        da = wrap(r.ang - r0.ang);
      if (Math.hypot(dx, dy) > maxD) (maxD = Math.hypot(dx, dy)), (at = t);
      maxA = Math.max(maxA, Math.abs(da));
      rows.push(`${t.toFixed(2)}: ${fmt(dx)},${fmt(dy)} ${fmt(da)}°`);
    }
    return { anim: p.anim, maior_deslocamento: `${fmt(maxD)} em t=${at.toFixed(2)}`, maior_angulo: `${fmt(maxA)}°`, amostras: rows.join(" | ") };
  },
});

const Offset = z.object({ time: z.number(), x: z.number().default(0), y: z.number().default(0), rotation: z.number().default(0) });

defineCommand({
  name: "pose.follow",
  group: "key",
  summary:
    "Gira uma cadeia de ossos (chain, do ombro para a ponta) para que `bone` mantenha a relacao de setup com `relativeTo` em cada tempo, e grava chaves de rotate. Ex: a mao que segura os oculos acompanha a cabeca quando o corpo pula. offsets (no espaco de relativeTo, interpolados) movem a peca de proposito: {time, y:-60} desce os oculos no focinho.",
  params: z.object({
    anim: z.string(),
    bone: z.string().describe("a peca que deve ficar no lugar (ex: oculos)"),
    relativeTo: z.string().describe("em relacao a quem (ex: HEAD)"),
    chain: z.array(z.string()).min(1).max(6).describe("ossos que podem girar (ex: tronco, ombro_d, braco_d, mao_d)"),
    times: z.array(z.number().min(0)).optional(),
    from: z.number().min(0).optional(),
    to: z.number().optional(),
    fps: z.number().positive().max(60).default(15).describe("com from/to: uma chave a cada 1/fps"),
    offsets: z.array(Offset).default([]),
    angleWeight: z.number().min(0).default(3).describe("peso do angulo (por grau) contra a posicao (por unidade)"),
    curve: z.string().default("suave"),
  }),
  label: (p) => `${p.bone} acompanha ${p.relativeTo}`,
  run(ctx, p) {
    const j = ctx.e.json;
    const a = requireAnimation(j, p.anim);
    [p.bone, p.relativeTo, ...p.chain].forEach((b) => requireBone(j, b));
    let times = p.times;
    if (!times) {
      const t0 = p.from ?? 0,
        t1 = p.to ?? duration(a);
      const n = Math.max(1, Math.round((t1 - t0) * p.fps));
      times = Array.from({ length: n + 1 }, (_, i) => round(t0 + ((t1 - t0) * i) / n));
    }
    const offs = [...p.offsets].sort((x, y) => x.time - y.time);
    const ease = (u: number) => u * u * (3 - 2 * u);
    const offsetAt = (t: number) => {
      if (!offs.length) return { x: 0, y: 0, rotation: 0 };
      if (t <= offs[0].time) return offs[0];
      for (let i = 1; i < offs.length; i++)
        if (t <= offs[i].time) {
          const A = offs[i - 1],
            B = offs[i],
            u = ease((t - A.time) / (B.time - A.time || 1));
          return { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u, rotation: A.rotation + (B.rotation - A.rotation) * u };
        }
      return offs[offs.length - 1];
    };
    const r0 = relation(skeletonAt(j, null, 0), p.relativeTo, p.bone);
    const report: string[] = [];
    let worst = 0;
    for (const t of times) {
      const sk = skeletonAt(ctx.e.json, p.anim, t >= duration(a) && t > 0 ? duration(a) - 1e-4 : t);
      const o = offsetAt(t);
      const goal = { x: r0.x + o.x, y: r0.y + o.y, ang: r0.ang + o.rotation };
      const chain = p.chain.map((n) => sk.findBone(n)!);
      const base = chain.map((b) => b.pose.rotation);
      const err = (v: number[]) => {
        chain.forEach((b, i) => (b.pose.rotation = base[i] + v[i]));
        sk.updateWorldTransform(Physics.pose);
        const r = relation(sk, p.relativeTo, p.bone);
        // um pouco de preferencia por girar pouco: entre solucoes iguais, a mais calma
        return Math.hypot(r.x - goal.x, r.y - goal.y) + Math.abs(wrap(r.ang - goal.ang)) * p.angleWeight + 0.02 * Math.hypot(...v);
      };
      let v = chain.map(() => 0),
        e = err(v);
      for (let step = 8; step > 0.01; step /= 2)
        for (let it = 0, better = true; better && it < 200; it++) {
          better = false;
          for (let i = 0; i < v.length; i++)
            for (const s of [step, -step]) {
              const w = [...v];
              w[i] += s;
              const ew = err(w);
              if (ew < e) (e = ew), (v = w), (better = true);
            }
        }
      err(v);
      const r = relation(sk, p.relativeTo, p.bone);
      const d = Math.hypot(r.x - goal.x, r.y - goal.y);
      worst = Math.max(worst, d);
      chain.forEach((b, i) => ctx.run("key.set", { anim: p.anim, target: { bone: b.data.name }, timeline: "rotate", time: round(t), value: round(base[i] + v[i] - b.data.setupPose.rotation), curve: p.curve }));
      report.push(`${round(t)}: ${fmt(d)} ${fmt(wrap(r.ang - goal.ang))}°`);
    }
    // confere entre as chaves: curvas e limites de constraints (ex: max de um transform) podem escapar
    let between = 0,
      betweenAt = 0;
    const dur = duration(requireAnimation(ctx.e.json, p.anim));
    for (let i = 1; i < times.length; i++)
      for (const u of [0.25, 0.5, 0.75]) {
        const t = times[i - 1] + (times[i] - times[i - 1]) * u;
        const o = offsetAt(t);
        const r = relation(skeletonAt(ctx.e.json, p.anim, Math.min(t, dur - 1e-4)), p.relativeTo, p.bone);
        const d = Math.hypot(r.x - r0.x - o.x, r.y - r0.y - o.y);
        if (d > between) (between = d), (betweenAt = t);
      }
    return {
      keys: times.length * p.chain.length,
      pior_nas_chaves: fmt(worst),
      pior_entre_chaves: `${fmt(between)} em t=${betweenAt.toFixed(2)}`,
      por_tempo: report.join(" | "),
      ...(between > Math.max(3, worst * 3)
        ? { atencao: "escapa entre as chaves: ponha mais chaves nesse trecho (times ou fps maior) ou veja se um constraint com limite (max) esta saturando" }
        : {}),
    };
  },
});

defineCommand({
  name: "ficha.draft",
  group: "query",
  readonly: true,
  summary:
    "Rascunho da ficha do personagem (.md): rig medido (o que e preso a que, gestos prontos, cuidados, faixas do animador), uma secao por animacao e regras verificaveis. Complete as partes (descrever) e salve ao lado do .spine-json como <nome>.ficha.md. Para incluir onde o jogo chama cada animacao e os mixes, use o CLI: npm run ficha -- draft <x-data.tres>.",
  params: z.object({ name: z.string().default("personagem") }),
  run({ doc }, p) {
    return draftFicha(doc.json, p.name);
  },
});

defineCommand({
  name: "ficha.check",
  group: "query",
  readonly: true,
  summary:
    "Confere as animacoes contra as regras da ficha (texto do .md, blocos ```regras): duracao, loop, limite, preso, fisica, parado, constraint, evento, troca, termina_como, comeca_como, transicao, corte. anims: so estas. Rode antes de mostrar uma animacao e depois de mexer no rig.",
  params: z.object({ text: z.string().describe("conteudo da ficha .md"), anims: z.array(z.string()).optional() }),
  run({ doc }, p) {
    const res = checkFicha(doc.json, p.text, p.anims);
    let fails = 0;
    const out: Record<string, string[]> = {};
    for (const [a, rs] of Object.entries(res)) {
      out[a] = rs.map((r) => `${r.ok ? "ok  " : "FALHA"} ${r.rule}: ${r.detail}`);
      fails += rs.filter((r) => !r.ok).length;
    }
    return { falhas: fails, animacoes: out };
  },
});

// Onde olhar de perto: os instantes em que alguma malha mais dobra ou estica fora do
// resto dela (braco erguido demais torce o ombro). Nao reprova: animadores fazem isso de
// proposito; quem decide e o olho, no quadro grande desses instantes.
defineCommand({
  name: "query.malha",
  group: "query",
  readonly: true,
  summary:
    "Instantes de maior torcao de malha numa animacao (como o jogo desenha: esqueleto, pesos e deform): area na tela que dobra sobre si ou estica/encolhe 2.5x mais que o resto da imagem, em milesimos do quadrado da altura. Nao e regra: olhe esses instantes grandes (look/zoom) e decida se a arte quebrou (membro torcido, mao gigante) ou e recurso (amassar, girar em 3D). Acima de ~10 costuma aparecer.",
  params: z.object({ anim: z.string(), fps: z.number().positive().max(60).default(30), top: z.number().int().min(1).max(10).default(5) }),
  run({ doc }, p) {
    const a = requireAnimation(doc.json, p.anim);
    const d = duration(a);
    const n = Math.max(1, Math.round(d * p.fps));
    const w = meshDistortion(doc.json, p.anim, Array.from({ length: n + 1 }, (_, i) => (i / n) * d));
    // um momento por malha e janela de 0.15 s, os piores primeiro
    const picks: typeof w.all = [];
    for (const e of w.all.sort((x, y) => y.frac - x.frac)) if (!picks.some((q) => q.mesh === e.mesh && Math.abs(q.t - e.t) < 0.15)) picks.push(e);
    return {
      anim: p.anim,
      momentos: picks.slice(0, p.top).map((e) => ({ t: round(e.t), malha: e.mesh, torcao: +(e.frac * 1000).toFixed(2) })),
      nota: picks.length ? "olhe estes instantes grandes (mamulengo_zoom com a parte, ou look com time): torcao alta em braco, mao ou rosto que nao foi intencional e arte quebrada" : "nenhuma malha dobra ou estica fora do resto",
    };
  },
});

// Recorte exposto: a borda que o animador escondeu atras de outra imagem (toco do braco
// sob o ombro, topo da perna sob o quadril) aparecendo na animacao. Mede, nao reprova.
defineCommand({
  name: "query.recorte",
  group: "query",
  readonly: true,
  summary:
    "Recorte a mostra numa animacao: bordas de imagem que na pose de setup ficam escondidas atras de outra, perto da articulacao entre as duas (toco do braco sob o ombro, topo da perna sob o quadril, pescoco sob a cabeca), e que a animacao descobre. Comprimento a mostra em % da altura do personagem, por instante, com a peca e quem a escondia. Borda que as outras animacoes (do animador) tambem descobrem nao conta: e contorno de verdade; passe em exclude as suas animacoes para nao valerem de referencia. Nos personagens do animador da casa 9 em 10 animacoes ficam abaixo de 10 (65% em zero). Olhe os instantes grandes (look/zoom): toco ou corte reto aparecendo e arte quebrada.",
  params: z.object({ anim: z.string(), exclude: z.array(z.string()).default([]).describe("animacoes que nao servem de referencia (as que voce fez)"), fps: z.number().positive().max(60).default(30), top: z.number().int().min(1).max(10).default(5) }),
  async prepare({ doc, assets }) {
    const imgs = new Map<string, Pixels | null>();
    for (const n of seamImages(doc.json)) imgs.set(n, (await assets?.image(n).catch(() => null)) ?? null);
    return imgs;
  },
  run({ doc, prepared }, p) {
    const a = requireAnimation(doc.json, p.anim);
    const imgs = prepared as Map<string, Pixels | null>;
    if (![...imgs.values()].some(Boolean)) throw new Error("sem as imagens do atlas: query.recorte precisa dos pixels (alpha) de cada parte");
    const d = duration(a);
    const h = Math.max(1, (doc.json.skeleton as any)?.height || 500);
    const at = (d: number, fps: number) => {
      const n = Math.max(1, Math.round(d * fps));
      return Array.from({ length: n + 1 }, (_, i) => (i / n) * d);
    };
    // referencia: as outras animacoes (do animador), a 15 quadros por segundo
    const reference = Object.entries<any>(doc.json.animations ?? {})
      .filter(([k]) => k !== p.anim && !p.exclude.includes(k))
      .map(([k, v]) => ({ anim: k, times: at(duration(v), 15) }));
    const e = exposedSeams(doc.json, p.anim, at(d, p.fps), (k) => imgs.get(k) ?? null, { reference });
    const pct = (l: number) => +((l / h) * 100).toFixed(1);
    // um momento por peca e janela de 0.15 s, os piores primeiro
    const picks: typeof e.frames = [];
    for (const f of e.frames.filter((f) => f.worst).sort((x, y) => y.len - x.len)) if (!picks.some((q) => q.worst!.slot === f.worst!.slot && Math.abs(q.t - f.t) < 0.15)) picks.push(f);
    return {
      anim: p.anim,
      momentos: picks.slice(0, p.top).map((f) => ({ t: round(f.t), recorte: pct(f.len), peca: f.worst!.slot, escondida_por: f.worst!.behind, da_peca: pct(f.worst!.len) })),
      bordas_escondidas: Object.fromEntries(Object.entries(e.seams).map(([k, l]) => [k, pct(l)])),
      nota: picks.length ? "recorte em % da altura; olhe estes instantes grandes (mamulengo_zoom na peca, ou look com time): borda cortada ou toco aparecendo e arte quebrada" : "nenhuma borda escondida aparece",
    };
  },
});
