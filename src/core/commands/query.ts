// Consultas: visao estruturada e compacta do esqueleto, para a UI e para o Claude
// raciocinarem sem ler o JSON cru.
import { z } from "zod";
import { defineCommand, describeCommands } from "./registry.ts";
import { animations, bones, constraints, keyValues, requireAnimation, requireBone, requireSlot, skins, slots } from "../model.ts";
import { timeOf } from "./timeline.ts";
import { skeletonAt } from "../pose.ts";
import { measureCuts, measureTransition, type TransitionReport } from "../transition.ts";

function duration(a: any): number {
  let t = 0;
  const scan = (n: any) => {
    if (Array.isArray(n)) {
      for (const k of n) if (k && typeof k === "object" && "time" in k) t = Math.max(t, k.time);
      for (const k of n) if (k && typeof k === "object") scan(k);
    } else if (n && typeof n === "object") for (const v of Object.values(n)) if (v && typeof v === "object") scan(v);
  };
  scan(a);
  return t;
}

function attachmentsOf(doc: any, slot: string) {
  const out: { skin: string; name: string; type: string }[] = [];
  for (const s of skins(doc)) for (const [n, a] of Object.entries<any>(s.attachments?.[slot] ?? {})) out.push({ skin: s.name, name: n, type: a.type ?? "region" });
  return out;
}

defineCommand({
  name: "help",
  group: "query",
  readonly: true,
  summary: "Lista os comandos (com schema de parametros). Filtre por grupo: bone, slot, attachment, animation, key, query, view, file, recipe.",
  params: z.object({ group: z.string().optional(), name: z.string().optional() }),
  run(_c, p) {
    const all = describeCommands(p.group);
    if (p.name) return all.filter((c) => c.name === p.name);
    return p.group ? all : all.map(({ params, ...rest }) => rest);
  },
});

defineCommand({
  name: "skeleton.info",
  group: "query",
  readonly: true,
  summary: "Resumo do esqueleto: contagens, animacoes com duracao, skins, constraints, features usadas.",
  params: z.object({}),
  run({ doc }) {
    const j = doc.json;
    const types: Record<string, number> = {};
    for (const s of skins(j)) for (const atts of Object.values<any>(s.attachments ?? {})) for (const a of Object.values<any>(atts)) types[a.type ?? "region"] = (types[a.type ?? "region"] ?? 0) + 1;
    return {
      spine: j.skeleton?.spine,
      size: { x: j.skeleton?.x, y: j.skeleton?.y, width: j.skeleton?.width, height: j.skeleton?.height },
      bones: bones(j).length,
      slots: slots(j).length,
      attachments: types,
      blend: slots(j).reduce((m: any, s) => ((m[s.blend ?? "normal"] = (m[s.blend ?? "normal"] ?? 0) + 1), m), {}),
      skins: skins(j).map((s) => s.name),
      constraints: constraints(j).map((c) => ({ name: c.c.name, type: c.type })),
      events: Object.keys(j.events ?? {}),
      animations: Object.entries(animations(j)).map(([name, a]) => ({ name, duration: duration(a) })),
      file: doc.file,
    };
  },
});

defineCommand({
  name: "query.tree",
  group: "query",
  readonly: true,
  summary: "Arvore de ossos com os slots de cada um (e attachments). depth limita a profundidade; bone escolhe a raiz.",
  params: z.object({ bone: z.string().optional(), depth: z.number().int().min(1).optional(), attachments: z.boolean().default(false) }),
  run({ doc }, p) {
    const j = doc.json;
    const slotsBy = new Map<string, string[]>();
    for (const s of slots(j)) slotsBy.set(s.bone, [...(slotsBy.get(s.bone) ?? []), s.name]);
    const kids = new Map<string, string[]>();
    for (const b of bones(j)) if (b.parent) kids.set(b.parent, [...(kids.get(b.parent) ?? []), b.name]);
    const root = p.bone ?? bones(j)[0]?.name;
    if (!root) return null;
    requireBone(j, root);
    const lines: string[] = [];
    const walk = (n: string, d: number) => {
      const sl = (slotsBy.get(n) ?? []).map((s) => {
        if (!p.attachments) return s;
        const at = attachmentsOf(j, s).map((a) => a.name + (a.type !== "region" ? `:${a.type}` : ""));
        return `${s}[${at.join(",")}]`;
      });
      lines.push(`${"  ".repeat(d)}${n}${sl.length ? "  <" + sl.join(", ") + ">" : ""}`);
      if (p.depth && d + 1 >= p.depth) {
        const c = kids.get(n)?.length ?? 0;
        if (c) lines.push(`${"  ".repeat(d + 1)}... ${c} filhos`);
        return;
      }
      for (const c of kids.get(n) ?? []) walk(c, d + 1);
    };
    walk(root, 0);
    return lines.join("\n");
  },
});

defineCommand({
  name: "query.bone",
  group: "query",
  readonly: true,
  summary: "Dados de um osso: setup pose, pai, filhos, slots, constraints que o usam, e quais animacoes o animam.",
  params: z.object({ bone: z.string() }),
  run({ doc }, p) {
    const j = doc.json;
    const b = bones(j)[requireBone(j, p.bone)];
    const anims: Record<string, string[]> = {};
    for (const [n, a] of Object.entries<any>(animations(j))) if (a.bones?.[p.bone]) anims[n] = Object.keys(a.bones[p.bone]);
    return {
      ...b,
      children: bones(j)
        .filter((x) => x.parent === p.bone)
        .map((x) => x.name),
      slots: slots(j)
        .filter((s) => s.bone === p.bone)
        .map((s) => s.name),
      constraints: constraints(j)
        .filter(({ c }) => c.bone === p.bone || c.target === p.bone || c.source === p.bone || c.bones?.includes(p.bone))
        .map(({ c, type }) => ({ name: c.name, type })),
      animatedIn: anims,
    };
  },
});

defineCommand({
  name: "query.slot",
  group: "query",
  readonly: true,
  summary: "Dados de um slot: setup, attachments disponiveis (por skin e tipo), posicao na ordem de desenho, animacoes.",
  params: z.object({ slot: z.string() }),
  run({ doc }, p) {
    const j = doc.json;
    const i = requireSlot(j, p.slot);
    const anims: Record<string, string[]> = {};
    for (const [n, a] of Object.entries<any>(animations(j))) {
      const t = [...Object.keys(a.slots?.[p.slot] ?? {})];
      for (const s of Object.values<any>(a.attachments ?? {})) for (const [att, tl] of Object.entries<any>(s[p.slot] ?? {})) t.push(...Object.keys(tl).map((k) => `${k}:${att}`));
      if (t.length) anims[n] = t;
    }
    return { ...slots(j)[i], drawIndex: i, attachments: attachmentsOf(j, p.slot), animatedIn: anims };
  },
});

defineCommand({
  name: "query.attachment",
  group: "query",
  readonly: true,
  summary: "JSON completo de um attachment (mesh inclui uvs, triangles, vertices, hull). Use com moderacao: meshes grandes sao longos.",
  params: z.object({ slot: z.string(), name: z.string(), skin: z.string().default("default") }),
  run({ doc }, p) {
    const s = skins(doc.json).find((x) => x.name === p.skin);
    const a = s?.attachments?.[p.slot]?.[p.name];
    if (!a) throw new Error(`attachment nao existe: ${p.skin}/${p.slot}/${p.name}. Disponiveis: ${attachmentsOf(doc.json, p.slot).map((x) => x.name).join(", ")}`);
    const out: any = { ...a };
    if (a.type === "mesh") {
      out.vertexCount = a.uvs.length / 2;
      out.weighted = a.vertices.length > a.uvs.length;
    }
    return out;
  },
});

defineCommand({
  name: "query.animation",
  group: "query",
  readonly: true,
  summary:
    "Resumo de uma animacao: duracao e cada timeline com tempos das chaves, valores (compactos) e curvas. detail=true inclui os valores; sem, so tempos.",
  params: z.object({ name: z.string(), detail: z.boolean().default(false), filter: z.string().optional().describe("so alvos cujo nome contem este texto") }),
  run({ doc }, p) {
    const a = requireAnimation(doc.json, p.name);
    const rows: any[] = [];
    const fmtKey = (kind: string, k: any) => {
      const t = timeOf(k);
      const c = k.curve === undefined ? "" : k.curve === "stepped" ? " stepped" : " ~";
      if (!p.detail) return `${t}${c}`;
      let v: any;
      if (kind === "attachment") v = k.name ?? "(nenhum)";
      else if (kind === "deform") v = `${(k.vertices?.length ?? 0) / 2}v@${k.offset ?? 0}`;
      else if (kind === "rgba" || kind === "rgb") v = k.color ?? "ffffffff";
      else v = keyValues(kind, k).map((x) => +x.toFixed(3)).join(",");
      return `${t}=${v}${c}`;
    };
    const push = (type: string, target: string, tl: string, keys: any[]) => {
      if (p.filter && !target.includes(p.filter)) return;
      rows.push(`${type} ${target} ${tl}: ${keys.map((k) => fmtKey(tl, k)).join(" | ")}`);
    };
    for (const [b, tls] of Object.entries<any>(a.bones ?? {})) for (const [tl, keys] of Object.entries<any>(tls)) push("bone", b, tl, keys);
    for (const [s, tls] of Object.entries<any>(a.slots ?? {})) for (const [tl, keys] of Object.entries<any>(tls)) push("slot", s, tl, keys);
    for (const [skin, sl] of Object.entries<any>(a.attachments ?? {}))
      for (const [s, atts] of Object.entries<any>(sl)) for (const [att, tls] of Object.entries<any>(atts)) for (const [tl, keys] of Object.entries<any>(tls)) push("attachment", `${skin}/${s}/${att}`, tl, keys);
    for (const t of ["ik", "transform"] as const) for (const [c, keys] of Object.entries<any>(a[t] ?? {})) push(t, c, t, keys);
    for (const t of ["path", "physics", "slider"] as const) for (const [c, tls] of Object.entries<any>(a[t] ?? {})) for (const [tl, keys] of Object.entries<any>(tls)) push(t, c || "(todas)", tl, keys);
    if (a.drawOrder) rows.push(`drawOrder: ${a.drawOrder.map((k: any) => `${timeOf(k)}=${(k.offsets ?? []).map((o: any) => `${o.slot}${o.offset >= 0 ? "+" : ""}${o.offset}`).join(",") || "setup"}`).join(" | ")}`);
    if (a.events) rows.push(`events: ${a.events.map((k: any) => `${timeOf(k)}=${k.name}`).join(" | ")}`);
    return { name: p.name, duration: duration(a), timelines: rows.length, rows: rows.join("\n") };
  },
});

// Movimento na tela: o que cada osso faz de verdade (girar para que lado, subir ou
// descer), medido pelo runtime e nao pelos valores das chaves. Valores locais enganam:
// um osso com rotacao de setup -150 girando +20 pode ir para o lado que parece errado.
defineCommand({
  name: "query.motion",
  group: "query",
  readonly: true,
  summary:
    "Movimento real na tela de ossos numa animacao: por trecho, quanto cada osso gira (horario/anti-horario, em graus na tela), anda (subir/descer/esquerda/direita, em px) e, com tip, para onde vai a ponta. Use para conferir o sentido de um movimento antes de mostrar.",
  params: z.object({
    anim: z.string(),
    bones: z.array(z.string()).min(1),
    fps: z.number().positive().max(120).default(30),
    tip: z.boolean().default(true).describe("mede tambem a ponta do osso (origem + comprimento)"),
    minAngle: z.number().default(2).describe("trechos com menos que isso (graus) contam como parado"),
  }),
  run({ doc }, p) {
    const a = requireAnimation(doc.json, p.anim);
    p.bones.forEach((b) => requireBone(doc.json, b));
    const dur = duration(a);
    const n = Math.max(1, Math.round(dur * p.fps));
    const samples: Record<string, { t: number; x: number; y: number; ang: number; tx: number; ty: number }[]> = {};
    // cada amostra refaz a pose do zero (mesma sequencia deterministica do viewer)
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * dur;
      // em loop, t == duracao ja e o tempo 0 de novo: mede o fim um pouco antes
      const s = skeletonAt(doc.json, p.anim, i === n && n > 0 ? dur - 1e-4 : t);
      for (const name of p.bones) {
        const b = s.findBone(name)!;
        const w = b.appliedPose;
        const ang = Math.atan2(w.c, w.a) * (180 / Math.PI);
        const len = b.data.length || 0;
        (samples[name] ??= []).push({ t: +t.toFixed(3), x: w.worldX, y: w.worldY, ang, tx: w.worldX + w.a * len, ty: w.worldY + w.c * len });
      }
    }
    const unwrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
    const out: Record<string, any> = {};
    for (const [name, ss] of Object.entries(samples)) {
      // trechos: corta onde a rotacao muda de sentido
      const segs: string[] = [];
      let start = 0,
        dir = 0,
        acc = 0;
      const flush = (end: number) => {
        const s0 = ss[start],
          s1 = ss[end];
        const dx = s1.x - s0.x,
          dy = s1.y - s0.y,
          tdx = s1.tx - s0.tx,
          tdy = s1.ty - s0.ty;
        const parts: string[] = [];
        if (Math.abs(acc) >= p.minAngle) parts.push(`gira ${acc > 0 ? "anti-horario" : "horario"} ${Math.abs(acc).toFixed(0)}°`);
        const mv = (x: number, y: number) => [Math.abs(y) >= 2 ? `${y > 0 ? "sobe" : "desce"} ${Math.abs(y).toFixed(0)}` : "", Math.abs(x) >= 2 ? `${x > 0 ? "direita" : "esquerda"} ${Math.abs(x).toFixed(0)}` : ""].filter(Boolean).join(" ");
        const m = mv(dx, dy);
        if (m) parts.push(`origem ${m}px`);
        const tm = p.tip ? mv(tdx, tdy) : "";
        if (tm && tm !== m) parts.push(`ponta ${tm}px`);
        segs.push(`${s0.t.toFixed(2)}-${s1.t.toFixed(2)}: ${parts.join(", ") || "parado"}`);
      };
      // tambem corta onde a origem volta (sobe e desce sem girar): sem isso um osso
      // que so anda e volta, como um alvo de IK, sairia "parado" no trecho inteiro
      const turned = (moved: number, step: number) => Math.abs(moved) >= 2 && Math.abs(step) > 0.05 && Math.sign(step) !== Math.sign(moved);
      for (let i = 1; i < ss.length; i++) {
        const d = unwrap(ss[i].ang - ss[i - 1].ang);
        const sd = Math.abs(d) < 0.05 ? 0 : Math.sign(d);
        const sx = ss[i].x - ss[i - 1].x,
          sy = ss[i].y - ss[i - 1].y;
        const back = turned(ss[i - 1].x - ss[start].x, sx) || turned(ss[i - 1].y - ss[start].y, sy);
        if ((dir && sd && sd !== dir) || back) {
          flush(i - 1);
          start = i - 1;
          acc = 0;
          dir = 0;
        }
        if (sd) dir = sd;
        acc += d;
      }
      flush(ss.length - 1);
      // angulo continuo (sem pular de 180 para -180)
      const angs = [ss[0].ang];
      for (let i = 1; i < ss.length; i++) angs.push(angs[i - 1] + unwrap(ss[i].ang - ss[i - 1].ang));
      out[name] = { angulo: `${Math.min(...angs).toFixed(0)}..${Math.max(...angs).toFixed(0)}°`, trechos: segs };
    }
    return { anim: p.anim, duration: dur, nota: "tela com y para cima; anti-horario = angulo cresce", bones: out };
  },
});

defineCommand({
  name: "query.transition",
  group: "query",
  readonly: true,
  summary:
    "Mede a emenda entre duas animacoes como o jogo toca (mesma conta do viewer e do spine-godot): anim e depois next com mix (queue/add_animation), ou interrompendo anim em at (play/set_animation). Para cada osso, a maior velocidade (unidades/s) e o maior giro (graus/s) durante o mix contra o resto da sequencia. score > 1: pula (mais rapido que tol x o resto, mais um piso). cuts: interrompe em varios instantes e devolve o pior (o premio que corta a animacao no meio).",
  params: z.object({
    anim: z.string(),
    next: z.string(),
    mix: z.number().min(0).describe("segundos (o jogo usa o default_mix do -data.tres ou o mix do par)"),
    at: z.number().min(0).optional().describe("interromper anim neste instante; sem: enfileira"),
    loop: z.boolean().default(false).describe("anim em loop"),
    nextLoop: z.boolean().default(true).describe("next em loop"),
    cuts: z.number().int().min(1).max(60).optional().describe("interromper em tantos instantes espalhados pela animacao e devolver o pior"),
    fps: z.number().positive().max(240).default(60),
    tol: z.number().positive().default(1.5),
    bones: z.array(z.string()).optional(),
    top: z.number().int().min(1).default(8).describe("quantos ossos listar (os piores)"),
  }),
  run({ doc }, p) {
    requireAnimation(doc.json, p.anim);
    requireAnimation(doc.json, p.next);
    p.bones?.forEach((b) => requireBone(doc.json, b));
    const o = { fps: p.fps, tol: p.tol, bones: p.bones };
    const seq = { next: p.next, mix: p.mix, loop: p.loop, nextLoop: p.nextLoop };
    const trim = (r: TransitionReport) => ({ ...r, bones: r.bones.slice(0, p.top), ossos: r.bones.length });
    if (p.cuts) {
      const c = measureCuts(doc.json, p.anim, seq, { ...o, cuts: p.cuts });
      return { ok: c.ok, cortes: c.cuts, pior: trim(c.worst) };
    }
    return trim(measureTransition(doc.json, p.anim, { ...seq, at: p.at ?? null }, o));
  },
});
