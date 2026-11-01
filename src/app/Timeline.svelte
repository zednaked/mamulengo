<script lang="ts">
  // Timeline: regua em quadros (30 fps) com zoom e rolagem, uma linha por parte
  // animada (ou por timeline da parte selecionada), selecao de varias chaves,
  // mover/apagar/copiar/colar e exportar GIF/WebM. Toda edicao e comando (keys.*).
  import { app } from "./state.svelte.ts";
  import { CURVE_PRESETS, constraints, isEffect } from "../core/model.ts";
  import { cursor } from "./interact.ts";
  import { exportAnimation } from "./exporter.ts";
  import CurveIcon from "./CurveIcon.svelte";
  import CurveEditor from "./CurveEditor.svelte";

  type Ref = { target?: any; timeline: string; time: number; name?: string };
  type Cell = { time: number; refs: Ref[]; curve?: "stepped" | "bezier"; next?: number };
  type Row = { id: string; label: string; color: string; cells: Cell[]; kind: "all" | "part" | "detail"; target?: any; timeline?: string; part?: { bone?: string; slot?: string; instance?: string } };
  type Tl = { part: string; partLabel: string; partSel?: { bone?: string; slot?: string; instance?: string }; partColor: string; target?: any; timeline: string; label: string; keys: any[]; bone?: string; slot?: string };

  const FPS = 30;
  // o export WebP usa o codificador do navegador (canvas.toBlob): o Safari nao tem
  const WEBP = (() => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      return c.toDataURL("image/webp").startsWith("data:image/webp");
    } catch {
      return false;
    }
  })();
  const ROW = 24;
  const PAD = 10;
  const snap = (t: number) => Math.max(0, Math.round(t * FPS) / FPS);
  const tkey = (t: number) => Math.round(t * 1e4);
  const NOCURVE = new Set(["attachment", "events", "drawOrder", "sequence", "inherit", "reset", "burst"]);
  const COLORS: Record<string, string> = { rotate: "#7ee787", translate: "#6cc6ff", scale: "#ffd166", shear: "#c39bff", attachment: "#ff9f6c", rgba: "#ff6bb5", alpha: "#ff6bb5", deform: "#5ee0d0", outline: "#ffd23c", glow: "#4cc9ff", dissolve: "#ff8a3c", tint: "#ff5577", adjust: "#b8f05a", rate: "#ffd23c", burst: "#ffd23c" };

  let creating = $state(false);
  let renaming = $state<string | null>(null);
  let renameTo = $state("");
  let newName = $state("");
  let armedDelete = 0;
  let seq = 0;

  function rename() {
    const from = renaming;
    const to = renameTo.trim();
    renaming = null;
    if (!from || !to || to === from) return;
    if (app.run({ cmd: "animation.rename", args: { name: from, to } })) app.viewer?.setAnimation(to);
  }
  function duplicate(a: string) {
    let n = 2;
    while (app.doc?.json.animations?.[`${a}_${n}`]) n++;
    const to = `${a}_${n}`;
    if (app.run({ cmd: "animation.duplicate", args: { name: a, to } })) {
      app.viewer?.setAnimation(to);
      app.avisar(`Cópia de ${a} criada: ${to} (duplo clique no nome renomeia).`);
    }
  }
  // sem dialogo do navegador: segundo clique em 3s confirma
  function remove(a: string) {
    if (Date.now() - armedDelete > 3000) {
      armedDelete = Date.now();
      app.toast(`Clique de novo em apagar para remover ${a}.`);
      return;
    }
    armedDelete = 0;
    if (app.run({ cmd: "animation.delete", args: { name: a } })) app.avisar(`Animação ${a} apagada. Ctrl+Z desfaz.`);
  }

  const anims = $derived.by(() => {
    app.version;
    return Object.keys(app.doc?.json.animations ?? {});
  });

  // --- linhas

  // nomes das linhas na interface (as timelines sao as do formato, em ingles): os da ferramenta
  const NOME_LINHA: Record<string, string> = {
    rotate: "girar", translate: "mover", translatex: "mover x", translatey: "mover y", scale: "esticar", scalex: "esticar x", scaley: "esticar y",
    shear: "inclinar", shearx: "inclinar x", sheary: "inclinar y", attachment: "imagem", rgba: "cor", rgb: "cor", alpha: "transparência", rgba2: "cor e sombra",
    deform: "deformar", sequence: "sequência", outline: "contorno", glow: "brilho", dissolve: "dissolver", tint: "tingir", smear: "borrar", trail: "rastro", adjust: "ajuste",
    rate: "taxa", burst: "rajada", mix: "mistura", instance: "instância", light: "luz", ambient: "ambiente",
  };

  // todas as timelines da animacao, com a parte (osso, slot, constraint) a que pertencem
  function collect(a: any): Tl[] {
    const out: Tl[] = [];
    const json = app.doc!.json;
    const boneOf = (s: string) => json.slots?.find((x: any) => x.name === s)?.bone;
    for (const [b, tls] of Object.entries<any>(a.bones ?? {}))
      for (const [tl, keys] of Object.entries<any>(tls)) out.push({ part: `b:${b}`, partLabel: b, partSel: { bone: b }, partColor: "#cfc6e6", target: { bone: b }, timeline: tl, label: NOME_LINHA[tl] ?? tl, keys, bone: b });
    for (const [s, tls] of Object.entries<any>(a.slots ?? {}))
      for (const [tl, keys] of Object.entries<any>(tls)) out.push({ part: `s:${s}`, partLabel: s, partSel: { bone: boneOf(s), slot: s }, partColor: "#ff9fcf", target: { slot: s }, timeline: tl, label: NOME_LINHA[tl] ?? tl, keys, slot: s });
    // efeitos do slot (so do Mamulengo): ficam em `effects`, fora de `slots`
    for (const [s, tls] of Object.entries<any>(a.effects ?? {}))
      for (const [tl, keys] of Object.entries<any>(tls)) out.push({ part: `s:${s}`, partLabel: s, partSel: { bone: boneOf(s), slot: s }, partColor: "#ff9fcf", target: { slot: s }, timeline: tl, label: NOME_LINHA[tl] ?? tl, keys, slot: s });
    for (const [skin, sl] of Object.entries<any>(a.attachments ?? {}))
      for (const [s, atts] of Object.entries<any>(sl))
        for (const [att, tls] of Object.entries<any>(atts))
          for (const [tl, keys] of Object.entries<any>(tls))
            out.push({ part: `s:${s}`, partLabel: s, partSel: { bone: boneOf(s), slot: s }, partColor: "#ff9fcf", target: { deform: { slot: s, attachment: att, skin } }, timeline: tl, label: `${NOME_LINHA[tl] ?? tl} ${att}`, keys, slot: s });
    const known = new Set(constraints(json).map((c) => c.c.name));
    for (const type of ["ik", "transform"])
      for (const [n, keys] of Object.entries<any>(a[type] ?? {}))
        if (known.has(n)) out.push({ part: `c:${n}`, partLabel: n, partColor: "#ffd166", target: { constraint: n }, timeline: type, label: type, keys });
    for (const type of ["path", "physics", "slider"])
      for (const [n, tls] of Object.entries<any>(a[type] ?? {}))
        if (known.has(n)) for (const [tl, keys] of Object.entries<any>(tls)) out.push({ part: `c:${n}`, partLabel: n, partColor: "#ffd166", target: { constraint: n }, timeline: tl, label: NOME_LINHA[tl] ?? tl, keys });
    // particulas (so do Mamulengo): rate e burst por emissor
    const emissores = new Set(((json as any).particles ?? []).map((p: any) => p.name));
    for (const [n, tls] of Object.entries<any>(a.particles ?? {}))
      if (emissores.has(n)) for (const [tl, keys] of Object.entries<any>(tls)) out.push({ part: `p:${n}`, partLabel: `✦ ${n}`, partColor: "#ffd23c", target: { particles: n }, timeline: tl, label: NOME_LINHA[tl] ?? tl, keys });
    // instancias (so do Mamulengo): uma linha por instancia, as chaves que trocam o que o filho toca
    for (const [n, keys] of Object.entries<any>(a.instances ?? {})) out.push({ part: `i:${n}`, partLabel: `◆ ${n}`, partSel: { instance: n }, partColor: "#7fd8ff", target: { instance: n }, timeline: "instance", label: "instância", keys });
    // luzes e ambiente (so do Mamulengo; docs/NUCLEO.md "Luzes"): uma linha por luz, que escolhe o
    // osso dela, e a da luz ambiente
    const luzes = new Map<string, string>(((json as any).lights ?? []).map((l: any) => [l.name, l.bone]));
    for (const [n, keys] of Object.entries<any>(a.lights ?? {}))
      if (luzes.has(n)) out.push({ part: `l:${n}`, partLabel: `☀ ${n}`, partSel: { bone: luzes.get(n) }, partColor: "#ffe08a", target: { light: n }, timeline: "light", label: "luz", keys });
    if (Array.isArray(a.ambient) && a.ambient.length) out.push({ part: "amb", partLabel: "☀ ambiente", partColor: "#ffe08a", target: { ambient: true }, timeline: "ambient", label: "ambiente", keys: a.ambient });
    if (a.events?.length) out.push({ part: "ev", partLabel: "eventos", partColor: "#ffffff", timeline: "events", label: "eventos", keys: a.events });
    if (a.drawOrder?.length) out.push({ part: "do", partLabel: "ordem", partColor: "#ff9f6c", timeline: "drawOrder", label: "ordem", keys: a.drawOrder });
    return out;
  }

  const refOf = (tl: Tl, k: any): Ref => ({ ...(tl.target ? { target: tl.target } : {}), timeline: tl.timeline, time: k.time ?? 0, ...(tl.timeline === "events" ? { name: k.name } : {}) });

  // chaves de varias timelines agrupadas por instante
  function merged(tls: Tl[]): Cell[] {
    const m = new Map<number, Cell>();
    for (const tl of tls)
      for (const k of tl.keys) {
        const t = k.time ?? 0;
        let c = m.get(tkey(t));
        if (!c) m.set(tkey(t), (c = { time: t, refs: [] }));
        c.refs.push(refOf(tl, k));
      }
    return [...m.values()].sort((x, y) => x.time - y.time);
  }

  const detail = $derived(!!(app.selection.bone || app.selection.slot));

  const rows = $derived.by((): Row[] => {
    app.version;
    const a = app.play.animation ? app.doc?.json.animations?.[app.play.animation] : null;
    if (!a) return [];
    const tls = collect(a);
    // no detalhe de uma parte, a primeira linha diz qual (antes so "tudo", sem dizer onde se estava)
    const nomeParte = app.selection.slot ?? app.selection.bone;
    const out: Row[] = [{ id: "all", label: detail && nomeParte ? nomeParte : "tudo", color: "#9a93a8", cells: merged(tls), kind: "all" }];
    const { bone, slot } = app.selection;
    if (bone || slot) {
      for (const tl of tls) {
        if (!((tl.bone && tl.bone === bone) || (tl.slot && tl.slot === slot))) continue;
        const cells = tl.keys.map((k: any, i: number): Cell => ({ time: k.time ?? 0, refs: [refOf(tl, k)], curve: k.curve === "stepped" ? "stepped" : k.curve ? "bezier" : undefined, next: tl.keys[i + 1]?.time }));
        const id = tl.target?.deform ? `d:${tl.target.deform.slot}:${tl.target.deform.attachment}:${tl.timeline}` : `${tl.part}:${tl.timeline}`;
        out.push({ id, label: tl.label, color: COLORS[tl.timeline] ?? "#bbb", cells, kind: "detail", target: tl.target, timeline: tl.timeline });
      }
      return out;
    }
    const parts = new Map<string, Tl[]>();
    for (const tl of tls) parts.set(tl.part, [...(parts.get(tl.part) ?? []), tl]);
    for (const [id, list] of parts) {
      const one = list.length === 1 || list.every((x) => x.timeline === list[0].timeline);
      out.push({ id, label: list[0].partLabel, color: one ? (COLORS[list[0].timeline] ?? list[0].partColor) : list[0].partColor, cells: merged(list), kind: "part", part: list[0].partSel });
    }
    return out;
  });

  const cellId = (r: Row, c: Cell) => `${r.id}@${tkey(c.time)}`;

  // --- selecao de chaves (ids "linha@tempo")

  let sel = $state<string[]>([]);
  const selSet = $derived(new Set(sel));
  const picked = $derived(rows.flatMap((r) => r.cells.filter((c) => selSet.has(cellId(r, c))).map((c) => ({ row: r, cell: c }))));
  const pickedRefs = $derived.by(() => {
    const m = new Map<string, Ref>();
    for (const { cell } of picked) for (const r of cell.refs) m.set(`${JSON.stringify(r.target ?? null)}|${r.timeline}|${tkey(r.time)}|${r.name ?? ""}`, r);
    return [...m.values()];
  });
  const curveRefs = $derived(pickedRefs.filter((r) => !NOCURVE.has(r.timeline)));
  // uma chave de evento escolhida: o nome dele, para renomear (todos os disparos acompanham)
  const eventoEscolhido = $derived(picked.length === 1 && picked[0].row.timeline === "events" ? ((picked[0].cell.refs[0] as any)?.name ?? null) : null);
  function renomearEvento(de: string, para: string) {
    para = para.trim();
    if (!para || para === de) return;
    if (app.run({ cmd: "event.rename", args: { name: de, to: para } }, `evento ${de} vira ${para}`)) app.avisar(`O evento ${de} agora se chama ${para}, em todas as animações. Ctrl+Z desfaz.`);
  }
  // apagar uma timeline inteira (o x no nome da linha)
  function apagarTimeline(r: Row) {
    const anim = app.play.animation;
    if (!anim || !r.timeline) return;
    if (app.run({ cmd: "timeline.delete", args: { anim, target: r.target ?? {}, timeline: r.timeline } }, `apaga a timeline ${r.label}`)) app.avisar(`A linha ${r.label} saiu de ${anim} (todas as chaves). Ctrl+Z desfaz.`);
  }

  const single = $derived(picked.length === 1 && picked[0].row.kind === "detail" && !NOCURVE.has(picked[0].row.timeline!) ? picked[0] : null);
  const singleKeys = $derived.by(() => {
    app.version;
    const s = single;
    const a = app.play.animation ? app.doc?.json.animations?.[app.play.animation] : null;
    if (!s || !a) return [];
    const t = s.row.target;
    const tl = s.row.timeline!;
    if (t.bone) return a.bones?.[t.bone]?.[tl] ?? [];
    if (t.slot) return (isEffect(tl) ? a.effects : a.slots)?.[t.slot]?.[tl] ?? [];
    if (t.deform) return a.attachments?.[t.deform.skin]?.[t.deform.slot]?.[t.deform.attachment]?.[tl] ?? [];
    if (t.particles) return a.particles?.[t.particles]?.[tl] ?? [];
    return [];
  });

  // trocar de animacao: selecao e zoom recomecam
  let lastAnim: string | null = null;
  $effect(() => {
    const a = app.play.animation;
    if (a === lastAnim) return;
    lastAnim = a;
    sel = [];
    zoom = null;
  });

  // --- regua: zoom (pixels por segundo) e rolagem (segundo na borda esquerda)

  let laneW = $state(600);
  let zoom = $state<{ start: number; pps: number } | null>(null);
  // inclui o tempo atual: andar alem do fim (para estender a animacao) aumenta a regua
  // a ultima chave a parte: so muda com as linhas, nao a cada quadro tocando
  const ultimaChave = $derived(rows.reduce((m, r) => r.cells.reduce((mm, c) => Math.max(mm, c.time), m), 0));
  // tocando, o tempo fica dentro da duracao: so parado ele pode passar do fim. Ler o tempo
  // tocando faria cada quadro revisar todas as marcas de chave (elas dependem da escala)
  const dur = $derived(Math.max(app.play.duration, app.play.playing ? 0 : app.play.time, ultimaChave, 0.5));
  const pps = $derived(zoom?.pps ?? Math.max(4, (laneW - 2 * PAD) / dur));
  const start = $derived(zoom?.start ?? 0);
  const X = (t: number) => PAD + (t - start) * pps;

  const ticks = $derived.by(() => {
    const fpx = pps / FPS;
    const C = [1, 2, 5, 10, 15, 30, 60, 150, 300, 600, 1800, 3600];
    const label = C.find((c) => c * fpx >= 44) ?? 3600;
    const minor = [...C].reverse().find((c) => c <= label && label % c === 0 && c * fpx >= 6) ?? label;
    const out: { f: number; x: number; label: boolean; sec: boolean }[] = [];
    const f1 = (start + laneW / pps) * FPS;
    for (let f = Math.max(0, Math.floor((start * FPS) / minor) * minor); f <= f1 && out.length < 1500; f += minor) out.push({ f, x: X(f / FPS), label: f % label === 0, sec: f % FPS === 0 });
    return out;
  });
  const tickText = (f: number) => (f % FPS === 0 ? `${f / FPS}s` : `${f}`);

  function setView(s: number, p: number) {
    p = Math.max(8, Math.min(6000, p));
    s = Math.max(-PAD / p, Math.min(s, dur));
    zoom = { start: s, pps: p };
  }

  // zoom pelos botoes: centrado no cursor de tempo (se ele estiver na tela) ou no meio da regua
  function zoomBy(f: number) {
    const vis = (laneW - 2 * PAD) / pps;
    const t = app.play.time >= start && app.play.time <= start + vis ? app.play.time : start + vis / 2;
    const p = Math.max(8, Math.min(6000, pps * f));
    setView(t - (t - start) * (pps / p), p);
  }
  // enquadra um intervalo de tempo (as chaves escolhidas, ou em volta de uma chave)
  function zoomTo(t0: number, t1: number) {
    const meio = (t0 + t1) / 2,
      larg = Math.max(t1 - t0, 4 / FPS) * 1.3;
    const p = (laneW - 2 * PAD) / larg;
    setView(meio - larg / 2, p);
  }
  const selTimes = $derived(picked.map((x) => x.cell.time));

  let ruler: HTMLDivElement | undefined = $state();
  let lanes: HTMLDivElement | undefined = $state();
  let scroller: HTMLDivElement | undefined = $state();

  const timeAt = (clientX: number) => snap(start + (clientX - ruler!.getBoundingClientRect().left - PAD) / pps);

  function wheel(e: WheelEvent) {
    if (!ruler) return;
    const mx = e.clientX - ruler.getBoundingClientRect().left - PAD;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const at = start + mx / pps;
      const p = pps * Math.exp(-e.deltaY * 0.002);
      setView(at - mx / Math.max(8, Math.min(6000, p)), p);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      setView(start + (e.deltaX || e.deltaY) / pps, pps);
    }
  }

  // --- ponteiro: arrastar a regua, chaves, caixa de selecao e o fundo (botao do meio)

  type Drag =
    | { kind: "scrub" }
    | { kind: "pan"; x: number; y: number; start: number; top: number }
    | { kind: "box"; x0: number; y0: number; x1: number; y1: number; add: boolean; base: string[]; moved: boolean; cx: number }
    | { kind: "keys"; refs: Ref[]; ids: { row: string; time: number }[]; t0: number; x: number; moved: boolean; merge: string; delta: number; min: number };
  let drag = $state.raw<Drag | null>(null);

  function seek(t: number) {
    app.viewer?.seek(t);
  }

  // captura no conteiner (estavel): a chave arrastada e recriada quando muda de tempo
  function capture(e: PointerEvent) {
    scroller?.setPointerCapture(e.pointerId);
  }

  function panDown(e: PointerEvent) {
    if (e.button !== 1) return;
    e.preventDefault();
    capture(e);
    drag = { kind: "pan", x: e.clientX, y: e.clientY, start, top: scroller?.scrollTop ?? 0 };
  }

  function rulerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    capture(e);
    drag = { kind: "scrub" };
    seek(timeAt(e.clientX));
  }

  function lanesDown(e: PointerEvent) {
    if (e.button !== 0) return;
    capture(e);
    const r = lanes!.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top;
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    drag = { kind: "box", x0: x, y0: y, x1: x, y1: y, add, base: add ? sel : [], moved: false, cx: e.clientX };
  }

  function keyDown(e: PointerEvent, row: Row, cell: Cell) {
    if (e.button !== 0) return;
    e.stopPropagation();
    capture(e);
    const id = cellId(row, cell);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (selSet.has(id)) {
        sel = sel.filter((x) => x !== id);
        seek(cell.time);
        return;
      }
      sel = [...sel, id];
    } else if (!selSet.has(id)) sel = [id];
    seek(cell.time);
    // arrasta tudo o que esta selecionado (ids lidos depois de atualizar a selecao)
    const ids = sel.map((s) => ({ row: s.slice(0, s.lastIndexOf("@")), time: +s.slice(s.lastIndexOf("@") + 1) / 1e4 }));
    const refs = rows.flatMap((r) => r.cells.filter((c) => sel.includes(cellId(r, c))).flatMap((c) => c.refs));
    const uniq = [...new Map(refs.map((r) => [`${JSON.stringify(r.target ?? null)}|${r.timeline}|${tkey(r.time)}|${r.name ?? ""}`, r])).values()];
    drag = { kind: "keys", refs: uniq, ids, t0: cell.time, x: e.clientX, moved: false, merge: `keys${++seq}`, delta: 0, min: Math.min(...uniq.map((r) => r.time)) };
  }

  function pointerMove(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    if (d.kind === "scrub") seek(timeAt(e.clientX));
    else if (d.kind === "pan") {
      setView(d.start - (e.clientX - d.x) / pps, pps);
      if (scroller) scroller.scrollTop = d.top - (e.clientY - d.y);
    } else if (d.kind === "box") {
      const r = lanes!.getBoundingClientRect();
      const x1 = e.clientX - r.left,
        y1 = e.clientY - r.top;
      const moved = d.moved || Math.hypot(x1 - d.x0, y1 - d.y0) > 4;
      drag = { ...d, x1, y1, moved };
      if (!moved) return;
      const [xa, xb] = [Math.min(d.x0, x1), Math.max(d.x0, x1)];
      const [ya, yb] = [Math.min(d.y0, y1), Math.max(d.y0, y1)];
      const hits: string[] = [];
      rows.forEach((row, i) => {
        if (i * ROW + ROW / 2 < ya - 6 || i * ROW + ROW / 2 > yb + 6) return;
        for (const c of row.cells) if (X(c.time) >= xa - 6 && X(c.time) <= xb + 6) hits.push(cellId(row, c));
      });
      sel = [...new Set([...d.base, ...hits])];
    } else if (d.kind === "keys") {
      if (!d.moved && Math.abs(e.clientX - d.x) < 3) return;
      // a chave puxada cai num quadro; as outras andam o mesmo tanto
      const dd = +Math.max(-d.min, timeAt(e.clientX) - d.t0).toFixed(6);
      if (d.moved && Math.abs(dd - d.delta) < 1e-6) return;
      const anim = app.play.animation;
      if (!anim) return;
      // cada etapa refaz o movimento a partir do original (merge): uma acao de desfazer
      const ok = app.run({ cmd: "keys.move", args: { anim, keys: d.refs, delta: dd } }, undefined, d.merge, true);
      if (!ok) return;
      drag = { ...d, moved: true, delta: dd };
      sel = d.ids.map((s) => `${s.row}@${tkey(s.time + dd)}`);
      seek(d.t0 + dd);
    }
  }

  function pointerUp() {
    const d = drag;
    drag = null;
    if (d?.kind === "box" && !d.moved) {
      // clique no vazio: leva o tempo ate la e limpa a selecao
      if (!d.add) sel = [];
      seek(timeAt(d.cx));
    }
  }

  // --- acoes sobre a selecao

  function deleteKeys() {
    const anim = app.play.animation;
    if (!anim || !pickedRefs.length) return;
    const n = pickedRefs.length;
    const oque = descreveChaves(pickedRefs);
    if (app.run({ cmd: "keys.delete", args: { anim, keys: pickedRefs } })) {
      sel = [];
      app.avisar(`${n === 1 ? "1 chave apagada" : `${n} chaves apagadas`}: ${oque}. Ctrl+Z desfaz.`);
    }
  }

  // o laco em chaves (src/core/commands/laco.ts)
  // emendar: a animacao comeca e/ou termina na pose de entrada de outra (anim.match)
  function emendar(v: string) {
    const anim = app.play.animation;
    if (!anim || !v) return;
    const [at, like] = v.split("|");
    const r = app.run({ cmd: "anim.match", args: { anim, like, at } }, `${anim} ${at === "inicio" ? "começa" : at === "fim" ? "termina" : "começa e termina"} como ${like}`);
    if (!r) return;
    if (!r[0]?.keys) app.avisar(`${anim} já ${at === "inicio" ? "começa" : "termina"} na pose em que ${like} começa: nada a mudar.`);
    else app.avisar(`${anim} agora ${at === "inicio" ? "começa" : at === "fim" ? "termina" : "começa e termina"} na pose de ${like} (${r[0].keys} chave${r[0].keys > 1 ? "s" : ""}): o jogo emenda uma na outra sem salto. Ctrl+Z desfaz.`);
  }
  function fecharLaco() {
    const anim = app.play.animation;
    if (!anim) return;
    const r = app.run({ cmd: "anim.closeLoop", args: { anim } });
    if (!r) return;
    if (!r[0].closed) app.avisar(`${anim} já termina como começa: nada a fechar.`);
    else app.avisar(`Laço fechado: ${r[0].closed} ${r[0].closed === 1 ? "parte volta" : "partes voltam"} ao começo em ${r[0].at.toFixed(2)}s. Ctrl+Z desfaz.`);
  }
  function vaiEVolta() {
    const anim = app.play.animation;
    if (!anim) return;
    const r = app.run({ cmd: "anim.pingPong", args: { anim } });
    if (r) app.avisar(`Vai e volta: ${anim} agora tem ${r[0].duration.toFixed(2)}s (a volta espelhada). Ctrl+Z desfaz.`);
  }

  // "cabeca (girar, mover) em 0.57s": o que um losango agrupado (linha tudo ou da parte) apaga
  function descreveChaves(refs: Ref[]): string {
    const partes = new Map<string, Set<string>>();
    const tempos = new Set<string>();
    for (const r of refs) {
      const t: any = r.target ?? {};
      const quem = t.bone ?? t.slot ?? t.deform?.slot ?? t.constraint ?? t.particles ?? t.instance ?? (r.timeline === "events" ? "eventos" : r.timeline === "drawOrder" ? "ordem" : "?");
      if (!partes.has(quem)) partes.set(quem, new Set());
      partes.get(quem)!.add(NOME_LINHA[r.timeline] ?? r.timeline);
      tempos.add(r.time.toFixed(2));
    }
    const lista = [...partes].slice(0, 4).map(([q, tl]) => `${q} (${[...tl].join(", ")})`).join(", ") + (partes.size > 4 ? ` e mais ${partes.size - 4}` : "");
    return lista + (tempos.size === 1 ? ` em ${[...tempos][0]}s` : "");
  }

  function copyKeys() {
    const anim = app.play.animation;
    if (!anim || !pickedRefs.length) return false;
    const r = app.run({ cmd: "keys.copy", args: { anim, keys: pickedRefs } });
    if (!r) return false;
    app.keyClipboard = r[0];
    app.log({ label: `copiou ${r[0].items.length} chave(s)`, source: "ui", kind: "info", ops: 0 });
    app.avisar(`${r[0].items.length === 1 ? "1 chave copiada" : `${r[0].items.length} chaves copiadas`}: leve a régua ao instante e Ctrl+V.`);
    return true;
  }

  // colar na parte selecionada: se tudo veio de um osso (ou slot) so, vai para o selecionado
  function retarget(items: any[]) {
    const bones = new Set(items.filter((i) => i.target?.bone).map((i) => i.target.bone));
    const slots = new Set(items.filter((i) => i.target?.slot).map((i) => i.target.slot));
    const { bone, slot } = app.selection;
    const toBone = bones.size === 1 && bone && !bones.has(bone) ? bone : null;
    const toSlot = slots.size === 1 && slot && !slots.has(slot) ? slot : null;
    return items.map((i) => (i.target?.bone && toBone ? { ...i, target: { bone: toBone } } : i.target?.slot && toSlot ? { ...i, target: { slot: toSlot } } : i));
  }

  function pasteKeys() {
    const clip = app.keyClipboard;
    const anim = app.play.animation;
    if (!clip || !anim) return;
    const items = retarget(clip.items);
    // tempo do viewer (app.play so acompanha a cada quadro desenhado)
    const t = snap(app.viewer?.view.time ?? app.play.time);
    const r = app.run({ cmd: "keys.paste", args: { anim, time: t, items } });
    if (!r) return;
    app.avisar(`${items.length === 1 ? "1 chave colada" : `${items.length} chaves coladas`} em ${t.toFixed(2)}s. Ctrl+Z desfaz.`);
    // seleciona o que foi colado (na visao de partes e na de timelines)
    const ids = new Set<string>();
    for (const it of items) {
      const tt = tkey(t + it.offset);
      const tg = it.target;
      const part = !tg ? (it.timeline === "events" ? "ev" : "do") : tg.bone ? `b:${tg.bone}` : tg.slot ? `s:${tg.slot}` : tg.deform ? `s:${tg.deform.slot}` : tg.light ? `l:${tg.light}` : tg.ambient ? "amb" : tg.particles ? `p:${tg.particles}` : tg.instance ? `i:${tg.instance}` : `c:${tg.constraint}`;
      ids.add(`${part}@${tt}`);
      ids.add(tg?.deform ? `d:${tg.deform.slot}:${tg.deform.attachment}:${it.timeline}@${tt}` : `${part}:${it.timeline}@${tt}`);
    }
    sel = [...ids];
  }

  function setCurve(name: string) {
    const anim = app.play.animation;
    if (!anim || !curveRefs.length) return;
    const calls = curveRefs.map((r) => ({ cmd: "curve.set", args: { anim, target: r.target, timeline: r.timeline, time: r.time, curve: name } }));
    app.run(calls, calls.length > 1 ? `curva ${name} em ${calls.length} chaves` : undefined);
  }

  // --- transporte e atalhos

  function togglePlay() {
    const v = app.viewer;
    if (!v) return;
    if (!v.view.playing && v.view.time >= v.duration() - 1e-4 && !v.view.loop) v.poseAt(0);
    v.view.playing = !v.view.playing;
  }

  function stepFrame(n: number) {
    const v = app.viewer;
    if (!v) return;
    // passa do fim de proposito: e assim que se estende a animacao com chaves novas
    seek(Math.max(0, Math.round(v.view.time * FPS) + n) / FPS);
  }

  function jumpKey(dir: 1 | -1) {
    const times = rows[0]?.cells.map((c) => c.time) ?? [];
    const now = app.viewer?.view.time ?? app.play.time;
    const t = dir > 0 ? times.find((x) => x > now + 1e-4) : [...times].reverse().find((x) => x < now - 1e-4);
    if (t !== undefined) seek(t);
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if ((k === "Delete" || k === "Backspace") && pickedRefs.length) {
      e.preventDefault();
      deleteKeys();
    } else if (mod && k.toLowerCase() === "c" && pickedRefs.length) {
      e.preventDefault();
      copyKeys();
    } else if (mod && k.toLowerCase() === "x" && pickedRefs.length) {
      e.preventDefault();
      if (copyKeys()) {
        const n = pickedRefs.length;
        deleteKeys();
        app.avisar(`${n === 1 ? "1 chave recortada" : `${n} chaves recortadas`}: leve a régua ao instante e Ctrl+V.`);
      }
    } else if (mod && k.toLowerCase() === "v" && app.keyClipboard) {
      e.preventDefault();
      pasteKeys();
    } else if (mod && k.toLowerCase() === "a" && rows.length) {
      e.preventDefault();
      sel = rows.slice(1).flatMap((r) => r.cells.map((c) => cellId(r, c)));
    } else if (e.code === "Space" && !mod) {
      // no viewport o espaco segura para mover a camera
      if (cursor.inside || e.repeat) return;
      e.preventDefault();
      if (el instanceof HTMLButtonElement) el.blur();
      togglePlay();
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const dir = k === "ArrowRight" ? 1 : -1;
      if (e.shiftKey) jumpKey(dir);
      else stepFrame(dir);
    } else if (k === "Home") {
      e.preventDefault();
      seek(0);
    } else if (k === "End") {
      e.preventDefault();
      seek(app.viewer?.duration() ?? 0);
    } else if (k === "Escape" && sel.length) sel = [];
  }

  // eventos: nome digitado vira evento (criado se preciso) disparado no tempo atual
  let eventName = $state("");
  let eventInput: HTMLInputElement | undefined = $state();
  function addEvent() {
    const n = eventName.trim();
    const anim = app.play.animation;
    if (!n || !anim) return;
    const calls: any[] = [];
    if (!app.doc?.json.events?.[n]) calls.push({ cmd: "event.create", args: { name: n } });
    calls.push({ cmd: "event.key", args: { anim, time: +app.play.time.toFixed(4), name: n } });
    if (app.run(calls, `evento ${n} @${app.play.time.toFixed(2)}`)) eventName = "";
  }

  // principios (antecipar, passar do ponto) em cada chave selecionada, uma acao so
  const PRINCIPLE_TL = new Set(["rotate", "translate", "scale", "shear"]);
  const principleRefs = $derived(curveRefs.filter((r) => PRINCIPLE_TL.has(r.timeline)));
  function principle(cmd: string) {
    const anim = app.play.animation;
    if (!anim || !principleRefs.length) return;
    app.run(principleRefs.map((r) => ({ cmd, args: { anim, target: r.target, timeline: r.timeline, time: r.time } })), `${cmd === "anim.anticipate" ? "antecipar" : "passar do ponto"} (${principleRefs.length})`);
  }

  function createAnim() {
    const n = newName.trim();
    if (!n) return;
    if (app.run({ cmd: "animation.create", args: { name: n } })) {
      app.viewer?.setAnimation(n);
      creating = false;
      newName = "";
    }
  }

  // --- exportar

  let exporting = $state<{ open: boolean; format: "gif" | "webm" | "webp"; fps: number; dir: string; busy: boolean; progress: string; result: string; url: string; arquivo: string; caminho: string; titulo: string; subtitulo: string; rodape: string; credito: string }>({ open: false, format: "gif", fps: 30, dir: "", busy: false, progress: "", result: "", url: "", arquivo: "", caminho: "", titulo: "", subtitulo: "", rodape: "", credito: "" });
  // o painel de exportar fica preso a tela, acima do botao: dentro da timeline ele seria cortado
  let exportPos = $state({ right: 16, bottom: 16 });
  function abrirExport(b: HTMLElement) {
    const r = b.getBoundingClientRect();
    exportPos = { right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 6 };
    exporting.open = !exporting.open;
  }

  async function runExport() {
    const x = exporting;
    x.busy = true;
    x.result = "";
    if (x.url) URL.revokeObjectURL(x.url);
    x.url = "";
    try {
      // moldura: so se algum texto foi preenchido
      const m = { titulo: x.titulo.trim(), subtitulo: x.subtitulo.trim(), rodape: x.rodape.trim(), credito: x.credito.trim() };
      const moldura = Object.values(m).some(Boolean) ? Object.fromEntries(Object.entries(m).filter(([, v]) => v)) : undefined;
      const r = await exportAnimation({ format: x.format, fps: x.fps, dir: x.dir.trim() || undefined, moldura, onProgress: (d, n) => (x.progress = `${d}/${n}`), onBlob: (b) => (x.url = URL.createObjectURL(b)) });
      x.arquivo = r.path.split("/").pop() ?? r.path;
      x.caminho = r.path;
      x.result = `${r.path} (${Math.round(r.bytes / 1024)} KB, ${r.frames} quadros ${r.size[0]}x${r.size[1]})`;
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      x.busy = false;
      x.progress = "";
    }
  }

  const frame = $derived(Math.round(app.play.time * FPS));

  // nomes das curvas na interface (as chaves sao as do comando, sem acento)
  const NOME_CURVA: Record<string, string> = { stepped: "degrau", "sai-rapido": "sai rápido", "entra-rapido": "entra rápido", elastico: "elástico" };
  // onde a timeline comeca na tela, para o editor de curva flutuar logo acima
  let tlEl: HTMLDivElement | undefined = $state();
  let altJanela = $state(window.innerHeight);
  let topoTl = $state(0);
  // e no canto direito do desenho (main.view), nao sobre o painel da direita
  let direitaCurva = $state(16);
  $effect(() => {
    if (!tlEl) return;
    const mede = () => {
      topoTl = tlEl!.getBoundingClientRect().top;
      const vista = document.querySelector("main.view")?.getBoundingClientRect();
      direitaCurva = vista ? Math.max(8, window.innerWidth - vista.right + 8) : 16;
    };
    const o = new ResizeObserver(mede);
    o.observe(tlEl);
    o.observe(document.body);
    mede();
    return () => o.disconnect();
  });

  // --- emenda (previa de transicao): depois desta animacao, outra, com mix; ou
  // interrompida no meio. O scrub cobre a sequencia inteira; as chaves sao da primeira.
  const emenda = $derived(app.play.seq);
  const others = $derived(anims.filter((a) => a !== app.play.animation));
  // mix que o jogo usaria (-data.tres), para mostrar ao lado
  const gameMix = $derived(app.play.animation && emenda ? app.mixFor(app.play.animation, emenda.next) : null);
  function setSeq(patch: Partial<{ next: string | null; mix: number; at: number | null; loop: boolean }>) {
    const v = app.viewer;
    const anim = app.play.animation;
    if (!v || !anim) return;
    const cur = v.view.sequence;
    const next = patch.next !== undefined ? patch.next : (cur?.next ?? null);
    if (!next) return v.setSequence(null);
    const mix = patch.mix ?? (patch.next !== undefined && patch.next !== cur?.next ? app.mixFor(anim, next) : (cur?.mix ?? app.mixFor(anim, next)));
    v.setSequence({ next, mix: Math.max(0, isFinite(mix) ? mix : 0), at: patch.at !== undefined ? patch.at : (cur?.at ?? null), loop: patch.loop ?? cur?.loop ?? false, nextLoop: true });
  }
  // cortar no meio: no instante atual (se ainda for da primeira), senao na metade
  function toggleCut(on: boolean) {
    const v = app.viewer;
    if (!v || !emenda) return;
    const t = v.view.time;
    setSeq({ at: on ? +(t > 0 && t < emenda.durA ? t : emenda.durA / 2).toFixed(3) : null });
  }
</script>

<svelte:window onkeydown={onKey} bind:innerHeight={altJanela} />

<!-- clicar num botao da timeline nao deixa o foco nele: o Espaco seguinte e tocar/pausar, e o
     anel de foco (de quem navega com Tab) nao acende num botao clicado com o mouse -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tl" bind:this={tlEl} onpointerup={(e) => (e.target as HTMLElement).closest?.("button")?.blur()}>
  <div class="anims">
    {#if app.doc}<button class="base" class:on={!app.play.animation} onclick={() => (app.mode = "setup")} title="Pose base: o boneco parado, de onde toda animação parte. Mexer aqui muda todas as animações">Pose base</button>{/if}
    {#each anims as a}
      {#if renaming === a}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="ren" bind:value={renameTo} onkeydown={(e) => (e.key === "Enter" ? rename() : e.key === "Escape" && (renaming = null))} onblur={rename} autofocus />
      {:else}
        <button class:on={a === app.play.animation} onclick={() => app.viewer?.setAnimation(a)} ondblclick={() => ((renaming = a), (renameTo = a))} title="duplo clique renomeia">{a}</button>
      {/if}
      {#if a === app.play.animation && renaming !== a}
        <button class="mini" title="Duplicar animação" onclick={() => duplicate(a)}>⧉</button>
        <button class="mini del" title="Apagar animação (clique duas vezes)" onclick={() => remove(a)}>🗑</button>
      {/if}
    {/each}
    {#if creating}
      <!-- svelte-ignore a11y_autofocus -->
      <input placeholder="nome da animação" bind:value={newName} onkeydown={(e) => (e.key === "Enter" ? createAnim() : e.key === "Escape" && ((creating = false), (newName = "")))} onblur={() => !newName.trim() && (creating = false)} autofocus />
      <button onclick={createAnim}>criar</button>
    {:else if app.doc}
      <button class="add" title="Nova animação" onclick={() => (creating = true)}>+ nova</button>
    {/if}
  </div>

  {#if app.doc && !app.play.animation}
    <div class="base-note">
      <b>Pose base</b>: o que você mexer aqui (posição, giro, tamanho, imagens, malhas, ossos novos) muda o boneco em <b>todas</b> as animações. Para animar, escolha uma animação acima.
    </div>
  {/if}
  <!-- duas barras: tocar e tempo; e curvas (ou evento e emenda) com o zoom e o exportar. Na tela
       larga ficam lado a lado; na pequena a segunda ocupa a largura inteira, sempre (escolher
       chaves troca o que ela mostra sem mudar a altura) -->
  <div class="barras">
  <div class="transport" class:hidden={!app.play.animation}>
    <button class="play" title="Tocar / pausar (espaço, fora do viewport)" onclick={togglePlay} aria-label={app.play.playing ? "pausar" : "tocar"}
      >{#if app.play.playing}<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="3" height="10" rx="0.8" /><rect x="9.5" y="3" width="3" height="10" rx="0.8" /></svg>{:else}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z" /></svg>{/if}</button
    >
    <button class:on={app.play.loop} title="Repetir" onclick={() => app.viewer && (app.viewer.view.loop = !app.viewer.view.loop)}>⟲</button>
    <select value={app.play.speed} onchange={(e) => app.viewer && (app.viewer.view.speed = +(e.target as HTMLSelectElement).value)} title="Velocidade">
      <option value={0.1}>0.1x</option>
      <option value={0.25}>0.25x</option>
      <option value={0.5}>0.5x</option>
      <option value={1}>1x</option>
      <option value={2}>2x</option>
    </select>
    <span class="time" title="Instante atual, quadro (a {FPS} por segundo) e duração. Setas: quadro anterior ou próximo. Shift+setas: chave anterior ou próxima. Home/End: início ou fim">{app.play.time.toFixed(2)}s <span class="dim">quadro {frame} · de {app.play.duration.toFixed(2)}s</span></span>
    {#if app.play.animation && app.play.duration === 0}<span class="dim empty-hint">sem chaves ainda: escolha o instante na régua e mexa uma parte</span>{/if}
    {#if app.play.animation && app.play.duration > 0}
      <span class="laco">
        <button class="mini" title="Fechar o laço: copia a primeira chave de cada parte para depois da última, e a repetição emenda sem pulo" onclick={fecharLaco}>⥁<span class="rot"> fechar o laço</span></button>
        <button class="mini" title="Vai e volta: acrescenta a volta (as chaves de trás para a frente, com as curvas espelhadas); a animação dobra de duração. Vale também no jogo" onclick={vaiEVolta}>⇄<span class="rot"> vai e volta</span></button>
        {#if others.length}
          <select class="mini" value="" onchange={(e) => { emendar((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }} title="Emendar sem salto: esta animação termina (ou começa) na pose em que outra começa, para o jogo tocar uma depois da outra">
            <option value="">⇆ emendar…</option>
            {#each others as o}
              <option value="fim|{o}">terminar como {o} começa</option>
              <option value="inicio|{o}">começar como {o} começa</option>
            {/each}
          </select>
        {/if}
      </span>
    {/if}
  </div>
  <div class="transport barra2" class:hidden={!app.play.animation}>
    {#if picked.length}
      <span class="curves">
        {#if curveRefs.length}
          <span class="dim">curva{curveRefs.length > 1 ? ` (${curveRefs.length})` : ""}:</span>
          {#each Object.keys(CURVE_PRESETS) as c}
            <button class="curve" title="curva {NOME_CURVA[c] ?? c}" onclick={() => setCurve(c)}><CurveIcon preset={c} /><span>{NOME_CURVA[c] ?? c}</span></button>
          {/each}
        {/if}
        {#if principleRefs.length}
          <button class="curve" title="Recuo no sentido contrário antes deste movimento" onclick={() => principle("anim.anticipate")}>↶<span class="rot"> antecipar</span></button>
          <button class="curve" title="Passa um pouco do ponto e assenta" onclick={() => principle("anim.overshoot")}>↷<span class="rot"> passar do ponto</span></button>
        {/if}
        {#if eventoEscolhido}
          <label class="ev-nome" title="O nome do evento (o jogo recebe no sinal animation_event). Trocar aqui renomeia em todos os disparos, em todas as animações">evento <input value={eventoEscolhido} onchange={(e) => renomearEvento(eventoEscolhido, (e.target as HTMLInputElement).value)} /></label>
        {/if}
        <button class="del" title="Apagar chaves selecionadas (Del)" onclick={deleteKeys}>apagar{pickedRefs.length > 1 ? ` ${pickedRefs.length}` : ""}</button>
      </span>
      {#if single && app.play.animation}<div class="floating" style:bottom="{altJanela - topoTl + 8}px" style:right="{direitaCurva}px"><CurveEditor anim={app.play.animation} target={single.row.target} timeline={single.row.timeline!} time={single.cell.time} keys={singleKeys} /></div>{/if}
    {:else if app.play.animation}
      <span class="ev">
        <input placeholder="evento (ex: som_pulo)" bind:this={eventInput} class:cheio={!!eventName} bind:value={eventName} onkeydown={(e) => e.key === "Enter" && addEvent()} />
        <!-- sem nome, o botao leva ao campo (no modo compacto o campo fica fechado ate isso) -->
        <button onclick={() => (eventName.trim() ? addEvent() : eventInput?.focus())} title="Dispara o evento neste instante (o jogo recebe no sinal animation_event)">+ evento</button>
      </span>
    {/if}
    {#if app.play.animation && others.length}
      <span class="seqctl" class:com-chaves={picked.length > 0} title="Prévia da emenda: escolha a animação que vem depois desta para ver como o jogo passa de uma para a outra. A régua cobre as duas; a faixa rosa é a mistura.">
        <span class="dim">em seguida:</span>
        <select value={emenda?.next ?? ""} onchange={(e) => setSeq({ next: (e.target as HTMLSelectElement).value || null })}>
          <option value="">(nenhuma)</option>
          {#each others as a}<option value={a}>{a}</option>{/each}
        </select>
        {#if emenda}
          <label title="Quanto tempo as duas se misturam{gameMix !== null ? ` (o jogo usa ${gameMix} s)` : ''}">mistura <input class="num" type="number" min="0" step="0.05" value={emenda.mix} onchange={(e) => setSeq({ mix: +(e.target as HTMLInputElement).value })} /> s</label>
          {#if gameMix !== null && Math.abs(gameMix - emenda.mix) > 1e-6}<button class="mini" title="Voltar para o mix do jogo (-data.tres)" onclick={() => setSeq({ mix: gameMix! })}>jogo: {gameMix}</button>{/if}
          <label title="Cortar no meio: a outra entra neste instante (como um prêmio que interrompe). Sem marcar, ela entra quando esta termina."><input type="checkbox" checked={emenda.at !== null} onchange={(e) => toggleCut((e.target as HTMLInputElement).checked)} /> interromper em</label>
          {#if emenda.at !== null}
            <input class="num" type="number" min="0" step="0.05" value={emenda.at} onchange={(e) => setSeq({ at: Math.max(0, +(e.target as HTMLInputElement).value) })} /> s
            <button class="mini" title="Interromper no instante atual" disabled={app.play.time >= emenda.durA} onclick={() => setSeq({ at: +app.play.time.toFixed(3) })}>aqui</button>
          {/if}
        {/if}
      </span>
    {/if}
    <span class="right">
      <span class="zoom" title="Zoom da timeline (também Ctrl+roda; Shift+roda ou botão do meio rola; duplo clique numa chave aproxima ali)">
        <button class="mini" onclick={() => zoomBy(1 / 1.6)}>−</button>
        <button class="mini" onclick={() => zoomBy(1.6)}>+</button>
        {#if selTimes.length > 1}<button class="mini" title="Enquadrar as chaves escolhidas" onclick={() => zoomTo(Math.min(...selTimes), Math.max(...selTimes))}>seleção</button>{/if}
        <button class="mini" class:on={!zoom} title="Ajustar a régua a animação inteira" onclick={() => (zoom = null)}>tudo</button>
      </span>
      {#if app.keyClipboard}<button class="mini" title="Colar no tempo atual (Ctrl+V)" onclick={pasteKeys}>colar {app.keyClipboard.items.length}</button>{/if}
      <button class="mini" class:on={exporting.open} disabled={!app.doc} title="Exportar GIF ou vídeo da animação como esta na tela" onclick={(e) => abrirExport(e.currentTarget as HTMLElement)}>⇩ exportar</button>
    </span>
    {#if exporting.open}
      <div class="export" style:right="{exportPos.right}px" style:bottom="{exportPos.bottom}px">
        <div class="fmt">
          <button class:on={exporting.format === "gif"} onclick={() => (exporting.format = "gif")}>GIF</button>
          <button class:on={exporting.format === "webm"} onclick={() => (exporting.format = "webm")}>WebM</button>
          <button class:on={exporting.format === "webp"} disabled={!WEBP} onclick={() => (exporting.format = "webp")} title={WEBP ? "WebP animado: bem menor que o GIF em cena com gradiente, luz e grão" : "Este navegador não gera WebP (o Safari não gera): use GIF ou vídeo, ou exporte pelo Chrome ou Firefox"}>WebP</button>
        </div>
        <label>fps <select bind:value={exporting.fps}><option value={15}>15</option><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select></label>
        <input class="pasta" placeholder="pasta (opcional)" title="Onde gravar uma cópia. Vazio: ~/.cache/mamulengo/exports. O arquivo também fica para baixar aqui." bind:value={exporting.dir} />
        <details class="moldura">
          <summary title="Textos em faixas em volta da animação, para mostrar (vazio: sem moldura)">moldura com textos</summary>
          <div class="campos">
            <input placeholder="título" bind:value={exporting.titulo} />
            <input placeholder="subtítulo" bind:value={exporting.subtitulo} />
            <input placeholder="rodapé" bind:value={exporting.rodape} />
            <input placeholder="crédito" bind:value={exporting.credito} />
          </div>
        </details>
        {#if !app.play.animation}<div class="dim aviso">Escolha uma animação para exportar.</div>{/if}
        <button class="go" disabled={exporting.busy || !app.play.animation} onclick={runExport}>{exporting.busy ? `gravando ${exporting.progress}` : "exportar"}</button>
        {#if exporting.result}
          <div class="done">
            {#if exporting.url}<a class="baixar" href={exporting.url} download={exporting.arquivo}>⇩ baixar {exporting.arquivo}</a>{/if}
            <span class="dim" title={exporting.result}>{exporting.caminho.split("/").length > 4 ? "…/" + exporting.caminho.split("/").slice(-3).join("/") : exporting.caminho}</span>
            <span class="acoes">
              <button class="mini" onclick={() => navigator.clipboard?.writeText(exporting.caminho).then(() => app.avisar("Caminho copiado."), () => app.toast("O navegador não deixou copiar."))}>copiar caminho</button>
              <button class="mini" onclick={() => fetch("/api/abrir-pasta", { method: "POST", body: JSON.stringify({ p: exporting.caminho }) }).then(async (r) => !r.ok && app.toast((await r.json()).error))}>abrir pasta</button>
            </span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  </div>
  <!-- na Pose base nao ha chaves: a regua vazia so ocupava lugar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grid" class:hidden={!app.play.animation} bind:this={scroller} onwheel={wheel} onpointerdowncapture={panDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp} onauxclick={(e) => e.preventDefault()}>
    <div class="head">
      <div class="corner">
        {#if detail}
          <button class="mini back" title="Voltar para todas as partes animadas (ou Esc com o mouse sobre o desenho)" onclick={() => app.select({})}>‹ todas</button>
        {:else}
          <span class="dim">partes</span>
        {/if}
      </div>
      <div class="ruler" bind:this={ruler} bind:clientWidth={laneW} onpointerdown={rulerDown} title="Ctrl+roda: zoom. Shift+roda ou botão do meio: rolar">
        <div class="past" style:left="{X(dur)}px"></div>
        {#if emenda}
          <div class="seq-after" style:left="{X(emenda.end)}px" style:width="{Math.max(0, (emenda.total - emenda.end) * pps)}px"><span>{emenda.next}</span></div>
          <div class="seq-mix" style:left="{X(emenda.start)}px" style:width="{Math.max(2, (emenda.end - emenda.start) * pps)}px" title="mistura: {emenda.start.toFixed(2)}s a {emenda.end.toFixed(2)}s"></div>
        {/if}
        {#each ticks as t (t.f)}
          <div class="tick" class:sec={t.sec} class:lab={t.label} style:left="{t.x}px">
            {#if t.label}<span>{tickText(t.f)}</span>{/if}
          </div>
        {/each}
        {#each app.notes.filter((n) => n.estado === "aberta" && n.anim && n.anim === app.play.animation && n.tempo != null) as n (n.id)}
          <button
            class="note-mark"
            style:left="{X(n.tempo)}px"
            title="{n.autor}: {n.texto}"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => {
              app.viewer?.seek(n.tempo);
              if (n.osso) app.select({ bone: n.osso });
              app.rightTab = "notas";
            }}
          ></button>
        {/each}
        <div class="head-mark" style:transform="translateX({X(app.play.time)}px)"></div>
      </div>
    </div>
    <div class="body">
      <div class="labels">
        {#each rows as r}
          {#if r.kind === "part" && r.part}
            {#if r.part.instance}
              <button class="label link" style:color={r.color} title="Entrar na instância {r.part.instance}: abre o .boneco dela para editar (← no topo volta)" onclick={() => app.entrarInstancia(r.part!.instance!)}>{r.label} ↳</button>
            {:else}
              <button class="label link" style:color={r.color} title="Ver as timelines de {r.label}" onclick={() => app.select(r.part!)}>{r.label}</button>
            {/if}
          {:else if r.kind === "detail" && r.timeline && app.play.animation}
            <div class="label com-x" style:color={r.color} title={r.label}>
              <span>{r.label}</span>
              <button class="tl-x" onclick={() => apagarTimeline(r)} title="apagar esta linha inteira (todas as chaves de {r.label} nesta animação; Ctrl+Z desfaz)">✕</button>
            </div>
          {:else}
            <div class="label" style:color={r.color} title={r.label}>{r.label}</div>
          {/if}
        {/each}
        {#if detail && rows.length === 1}<div class="hint">sem chaves: com esta animação aberta, mexa na parte</div>{/if}
      </div>
      <div class="lanes" bind:this={lanes} style:height="{Math.max(rows.length, 1) * ROW + 8}px" onpointerdown={lanesDown}>
        <div class="past" style:left="{X(dur)}px"></div>
        {#if emenda}
          <div class="seq-after lane" style:left="{X(emenda.end)}px" style:width="{Math.max(0, (emenda.total - emenda.end) * pps)}px"></div>
          <div class="seq-mix lane" style:left="{X(emenda.start)}px" style:width="{Math.max(2, (emenda.end - emenda.start) * pps)}px"></div>
        {/if}
        {#each ticks as t (t.f)}
          <div class="grid-line" class:sec={t.sec} style:left="{t.x}px"></div>
        {/each}
        {#each rows as r, i (r.id)}
          <div class="row" class:all={r.kind === "all"} style:top="{i * ROW}px">
            {#each r.cells as c (tkey(c.time))}
              {#if r.kind === "detail" && c.curve && c.next !== undefined}
                <div class="seg" class:stepped={c.curve === "stepped"} style:left="{X(c.time)}px" style:width="{(c.next - c.time) * pps}px" style:background={r.color}></div>
              {/if}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="key"
                class:sel={selSet.has(cellId(r, c))}
                class:many={c.refs.length > 1}
                class:late={!!emenda && emenda.at !== null && c.time > emenda.start + 1e-4}
                style:left="{X(c.time)}px"
                style:--c={r.color}
                onpointerdown={(e) => keyDown(e, r, c)}
                ondblclick={() => zoomTo(c.time - 6 / FPS, c.time + 6 / FPS)}
                title="{r.label} @ {c.time}s (q{Math.round(c.time * FPS)}){c.refs.length > 1 ? ` - ${c.refs.length} chaves` : ''}"
              ></div>
            {/each}
          </div>
        {/each}
        {#if drag?.kind === "box" && drag.moved}
          <div class="box" style:left="{Math.min(drag.x0, drag.x1)}px" style:top="{Math.min(drag.y0, drag.y1)}px" style:width="{Math.abs(drag.x1 - drag.x0)}px" style:height="{Math.abs(drag.y1 - drag.y0)}px"></div>
        {/if}
        <div class="head-line" style:transform="translateX({X(app.play.time)}px)"></div>
      </div>
    </div>
  </div>
</div>

<style>
  .label.com-x {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .label.com-x span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tl-x {
    background: none;
    border: none;
    padding: 0 3px;
    font-size: 10px;
    opacity: 0;
    color: var(--dim);
  }
  .label.com-x:hover .tl-x {
    opacity: 0.8;
  }
  .ev-nome {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: 12px;
  }
  .ev-nome input {
    width: 110px;
  }
  .tl {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 0;
    position: relative;
  }
  /* o editor da curva fica sobre o desenho, logo acima da timeline: dentro dela cobria o zoom e
     o exportar, e a timeline cortaria */
  .floating {
    position: fixed;
    z-index: 5;
    box-shadow: 0 6px 20px #000a;
    border-radius: 8px;
  }
  .base.on {
    background: #e08a2e;
    border-color: #e08a2e;
    color: #1d1b22;
  }
  .base-note {
    margin: 6px 0;
    padding: 8px 10px;
    border: 1px solid #e08a2e;
    border-radius: 6px;
    color: #f3d3ad;
    font-size: 13px;
  }
  .hidden {
    display: none !important;
  }
  .anims {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .anims button {
    border-radius: 999px;
    padding: 5px 12px;
  }
  .add {
    border-style: dashed;
  }
  .moldura {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .zoom {
    display: inline-flex;
    gap: 2px;
    margin-right: 6px;
  }
  .zoom .mini {
    min-width: 26px;
  }
  .anims .mini {
    padding: 4px 7px;
    border-radius: 8px;
    font-size: 12px;
  }
  .ren {
    width: 140px;
    border-radius: 999px;
    padding: 5px 12px;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    position: relative;
  }
  /* tela pequena (App.svelte, .compacto): abas e controles na mesma linha, tudo mais baixo */
  :global(.compacto) .tl {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 5px 10px;
    align-items: start;
    font-size: 13px;
  }
  :global(.compacto) .tl > .base-note {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  :global(.compacto) .tl > .grid {
    grid-column: 1 / -1;
    grid-row: 3;
    align-self: stretch;
  }
  :global(.compacto) .tl > .anims {
    grid-column: 1;
    grid-row: 1;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
    max-width: 46vw;
  }
  /* o que nao couber desce para outra linha (cortar escondia o exportar) */
  :global(.compacto) .tl .transport:not(.barra2) {
    grid-column: 2;
    grid-row: 1;
    gap: 5px 6px;
  }
  :global(.compacto) .transport :global(button) {
    white-space: nowrap;
  }
  :global(.compacto) .ev input {
    width: 0;
    padding: 3px 0;
    border-width: 0;
    transition: width 0.15s;
  }
  :global(.compacto) .ev:focus-within input,
  :global(.compacto) .ev input.cheio {
    width: 130px;
    padding: 3px 7px;
    border-width: 1px;
  }
  :global(.compacto) .anims button {
    padding: 3px 9px;
    flex-shrink: 0;
  }
  :global(.compacto) .play {
    width: 36px;
    height: 28px;
    font-size: 13px;
  }
  .play {
    width: 46px;
    height: 36px;
    font-size: 16px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .play svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
  :global(.compacto) .play svg {
    width: 14px;
    height: 14px;
  }
  .empty-hint {
    font-size: 12px;
    white-space: nowrap;
  }
  /* largura fixa: tocando, o texto muda a cada quadro e empurrava a barra (o menu de emendar
     aberto andava junto e saia cortado) */
  .time {
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    width: 17em;
    flex: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ev {
    display: flex;
    gap: 4px;
  }
  .ev input {
    width: 170px;
  }
  .right {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .laco {
    display: inline-flex;
    gap: 4px;
  }
  .barras {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .barra2 {
    flex: 1 1 auto;
  }
  :global(.compacto) .barras {
    display: contents;
  }
  :global(.compacto) .tl .barra2 {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  :global(.compacto) .transport .curves {
    flex: 1 1 0;
  }
  :global(.compacto) .transport .right {
    flex: none;
  }
  .mini {
    padding: 4px 9px;
    font-size: 12px;
  }
  .mini.on {
    border-color: var(--accent);
  }
  /* abre para cima, sobre o desenho (posicao calculada em abrirExport) */
  .export {
    position: fixed;
    z-index: 6;
    background: var(--panel2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 80px);
    overflow: auto;
    box-shadow: 0 6px 20px #000a;
  }
  .export .moldura {
    width: 100%;
    font-size: 12px;
    color: var(--dim);
  }
  .export .moldura summary {
    cursor: pointer;
  }
  .export .moldura .campos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 6px;
  }
  .export .moldura input {
    width: 100%;
    min-width: 0;
  }
  .export .aviso {
    width: 100%;
    font-size: 12px;
  }
  .export .baixar {
    color: var(--ok);
    font-weight: 600;
  }
  .export .fmt {
    display: flex;
    gap: 2px;
    background: var(--bg);
    padding: 3px;
    border-radius: 8px;
  }
  .export .fmt button {
    border: none;
    background: none;
    padding: 4px 10px;
  }
  .export .fmt button.on {
    background: var(--accent);
  }
  .export label {
    font-size: 12px;
    color: var(--dim);
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .export input.pasta {
    flex: 1;
    min-width: 0;
  }
  .export .go {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .export .done {
    width: 100%;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .export .done .acoes {
    display: flex;
    gap: 6px;
  }
  .export .done span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .curves {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }
  /* tela pequena: as curvas so com o desenho (o nome fica na dica) e numa linha so, para a
     timeline nao perder as linhas das chaves que acabaram de ser escolhidas */
  :global(.compacto) .curves {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
    min-width: 0;
  }
  :global(.compacto) .curve span,
  :global(.compacto) .curves .rot {
    display: none;
  }
  /* sem barra de rolagem (ela mudava a altura da linha ao escolher chaves) */
  :global(.compacto) .curves {
    scrollbar-width: none;
  }
  :global(.compacto) .curves .dim,
  :global(.compacto) .curves button {
    flex: none;
  }
  .curve {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 7px;
    font-size: 12px;
  }
  .del {
    color: var(--err);
  }
  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    border-radius: 8px;
    background: #1a1820;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 3;
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    background: #1a1820;
    border-bottom: 1px solid #2c2834;
  }
  .corner {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 8px;
    font-size: 11px;
  }
  .back {
    padding: 1px 8px;
    font-size: 11px;
  }
  .note-mark {
    position: absolute;
    top: 2px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    padding: 0;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    background: #f2c94c;
    border: 1px solid #1d1b22;
    cursor: pointer;
    z-index: 3;
  }
  .ruler {
    position: relative;
    height: 22px;
    overflow: hidden;
    cursor: ew-resize;
    user-select: none;
  }
  .body {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    min-height: calc(100% - 23px);
  }
  .labels {
    min-width: 0;
  }
  .label {
    display: block;
    width: 100%;
    height: 24px;
    line-height: 24px;
    font-size: 12px;
    text-align: right;
    padding: 0 10px 0 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .label.link {
    background: none;
    border: none;
    border-radius: 0;
    cursor: pointer;
  }
  .label.link:hover {
    text-decoration: underline;
  }
  .hint {
    font-size: 11px;
    color: var(--dim);
    padding: 4px 10px;
    text-align: right;
  }
  .lanes {
    position: relative;
    overflow: hidden;
    min-height: 100%;
    user-select: none;
    touch-action: none;
  }
  .past {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    background: #0006;
    pointer-events: none;
  }
  .tick {
    position: absolute;
    bottom: 0;
    height: 5px;
    border-left: 1px solid #3a3544;
  }
  .tick.lab {
    height: 9px;
    border-left-color: #565063;
  }
  .tick.sec {
    height: 100%;
    border-left-color: #6a6378;
  }
  .tick span {
    position: absolute;
    bottom: 8px;
    left: 3px;
    font-size: 10px;
    color: var(--dim);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .tick.sec span {
    color: var(--text);
  }
  .grid-line {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid #211e28;
    pointer-events: none;
  }
  .grid-line.sec {
    border-left-color: #34303d;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    height: 24px;
    contain: layout paint;
  }
  .row.all {
    background: #ffffff08;
  }
  .seg {
    position: absolute;
    top: 11px;
    height: 2px;
    opacity: 0.45;
    pointer-events: none;
  }
  .seg.stepped {
    height: 0;
    border-top: 2px dashed;
    background: none !important;
  }
  /* o losango pintado so com gradientes (quatro quartos da borda e quatro do miolo): girar a
     marca com transform, ou recortar com clip-path, criava um no de camada por chave, e com
     milhares de chaves o navegador gastava ~16 ms por quadro so montando as camadas */
  .key {
    --c: #bbb;
    --o: #16141b;
    position: absolute;
    top: 3px;
    width: 18px;
    height: 18px;
    margin-left: -9px;
    cursor: grab;
    background:
      linear-gradient(to bottom right, transparent 50%, var(--c) 50%) 1.5px 1.5px / 7.5px 7.5px no-repeat,
      linear-gradient(to bottom left, transparent 50%, var(--c) 50%) 9px 1.5px / 7.5px 7.5px no-repeat,
      linear-gradient(to top right, transparent 50%, var(--c) 50%) 1.5px 9px / 7.5px 7.5px no-repeat,
      linear-gradient(to top left, transparent 50%, var(--c) 50%) 9px 9px / 7.5px 7.5px no-repeat,
      linear-gradient(to bottom right, transparent 50%, var(--o) 50%) 0 0 / 9px 9px no-repeat,
      linear-gradient(to bottom left, transparent 50%, var(--o) 50%) 9px 0 / 9px 9px no-repeat,
      linear-gradient(to top right, transparent 50%, var(--o) 50%) 0 9px / 9px 9px no-repeat,
      linear-gradient(to top left, transparent 50%, var(--o) 50%) 9px 9px / 9px 9px no-repeat;
  }
  /* varias chaves no mesmo instante: borda mais clara */
  .key.many {
    --o: #4a4458;
  }
  .key.sel {
    --o: white;
    z-index: 1;
  }
  .box {
    position: absolute;
    border: 1px solid #ffffffaa;
    background: #ffffff14;
    pointer-events: none;
    z-index: 2;
  }
  /* interrompida: chaves depois do corte nao tocam */
  .key.late {
    opacity: 0.3;
  }
  /* tela pequena com chaves escolhidas: a linha fica para as curvas */
  :global(.compacto) .seqctl.com-chaves {
    display: none;
  }
  .seqctl {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
  }
  .seqctl .num {
    width: 58px;
  }
  .seqctl label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  /* emenda: a mistura em rosa, a animacao seguinte sombreada */
  .seq-mix,
  .seq-after {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }
  .seq-mix {
    background: #ff6bb566;
    border-left: 1px solid #ff6bb5;
    border-right: 1px solid #ff6bb5;
    z-index: 1;
  }
  .seq-after {
    background: repeating-linear-gradient(135deg, #ffffff0a 0 6px, #0000 6px 12px);
    overflow: hidden;
  }
  .seq-after span {
    position: absolute;
    left: 6px;
    top: 1px;
    font-size: 11px;
    color: #ff9fcf;
    white-space: nowrap;
  }
  .seq-after.lane {
    background: repeating-linear-gradient(135deg, #ffffff08 0 6px, #0000 6px 12px);
  }
  .seq-mix.lane {
    background: #ff6bb522;
  }
  /* o cursor anda por transform, numa camada propria: mover pelo left repintava a faixa
     inteira, com todas as chaves, a cada quadro tocando */
  .head-mark,
  .head-line {
    position: absolute;
    left: 0;
    will-change: transform;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    pointer-events: none;
    z-index: 2;
  }
</style>
