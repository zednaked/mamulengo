<script lang="ts">
  import { app } from "./state.svelte.ts";
  import { slotWorldBox } from "./interact.ts";
  import { applyLocal } from "./interact.ts";
  import { startMeshEdit } from "./meshedit.ts";
  import MeshPanel from "./MeshPanel.svelte";
  import { EFFECT_NAMES, effectAt, effectFields, fieldsAt } from "../core/model.ts";

  const FIELDS = [
    { k: "x", label: "x", step: 1 },
    { k: "y", label: "y", step: 1 },
    { k: "rotation", label: "giro", step: 1 },
    { k: "scaleX", label: "escala x", step: 0.01 },
    { k: "scaleY", label: "escala y", step: 0.01 },
  ] as const;

  // valores mostrados: pose atual (com a animacao aplicada) com uma animacao aberta, setup na Pose base
  const bone = $derived.by(() => {
    app.version;
    app.play.time;
    const name = app.selection.bone;
    if (!name || !app.doc) return null;
    const setup = app.doc.json.bones.find((b: any) => b.name === name);
    const live = app.viewer?.pose?.findBone(name)?.local;
    const src: any = app.mode === "animate" && live ? live : { x: setup?.x ?? 0, y: setup?.y ?? 0, rotation: setup?.rotation ?? 0, scaleX: setup?.scaleX ?? 1, scaleY: setup?.scaleY ?? 1 };
    return { name, parent: setup?.parent, values: Object.fromEntries(FIELDS.map((f) => [f.k, +(+src[f.k]).toFixed(f.step < 1 ? 3 : 2)])) };
  });

  const slot = $derived.by(() => {
    app.version;
    const name = app.selection.slot;
    if (!name || !app.doc) return null;
    const s = app.doc.json.slots.find((x: any) => x.name === name);
    const atts: string[] = [];
    for (const sk of app.doc.json.skins ?? []) for (const n of Object.keys(sk.attachments?.[name] ?? {})) if (!atts.includes(n)) atts.push(n);
    return { ...s, atts };
  });

  // cor atual do slot (com a animacao aplicada, com uma animacao aberta)
  const color = $derived.by(() => {
    app.version;
    app.play.time;
    const name = app.selection.slot;
    if (!name) return null;
    const live = app.mode === "animate" ? app.viewer?.pose?.findSlot(name)?.color : null;
    const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
    if (live) return { rgb: "#" + hex(live.r) + hex(live.g) + hex(live.b), a: live.a };
    const c = (app.doc?.json.slots.find((x: any) => x.name === name)?.color ?? "ffffffff").padEnd(8, "f");
    return { rgb: "#" + c.slice(0, 6), a: parseInt(c.slice(6, 8), 16) / 255 };
  });

  function setColor(rgb: string, a: number) {
    if (!slot) return;
    const hex = rgb.replace("#", "") + Math.round(a * 255).toString(16).padStart(2, "0");
    // ajustes seguidos no mesmo instante viram uma acao so de desfazer
    if (app.mode === "animate" && app.play.animation) {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { slot: slot.name }, timeline: "rgba", time, color: hex } }, `cor ${slot.name} @${time}`, `cor-${slot.name}-${time}`);
    } else app.run({ cmd: "slot.set", args: { slot: slot.name, color: hex } }, `cor ${slot.name}`, `cor-${slot.name}`);
  }

  // ---- efeitos (so .boneco; docs/NUCLEO.md "Efeitos"): os ligados no setup ou animados aqui
  const EFEITOS: Record<string, { nome: string; dica: string; campos: { k: string; label: string; max: number; step: number }[] }> = {
    outline: { nome: "contorno", dica: "linha em volta da imagem", campos: [{ k: "width", label: "largura", max: 16, step: 0.5 }] },
    glow: { nome: "brilho", dica: "halo em volta da imagem", campos: [{ k: "strength", label: "forca", max: 3, step: 0.05 }, { k: "radius", label: "raio", max: 40, step: 1 }] },
    dissolve: { nome: "dissolver", dica: "some em pedacos, com borda colorida", campos: [{ k: "value", label: "quanto", max: 1, step: 0.01 }, { k: "edge", label: "borda", max: 0.3, step: 0.01 }, { k: "grain", label: "pedacos", max: 64, step: 1 }] },
    tint: { nome: "tingir", dica: "pinta a imagem com uma cor", campos: [{ k: "strength", label: "forca", max: 1, step: 0.01 }] },
    smear: {
      nome: "borrar",
      dica: "estica a traseira da imagem quando ela anda rapido (smear de desenho animado)",
      campos: [
        { k: "strength", label: "forca (s)", max: 0.2, step: 0.005 },
        { k: "limit", label: "limite", max: 200, step: 1 },
        { k: "fade", label: "esmaecer", max: 1, step: 0.05 },
      ],
    },
    trail: {
      nome: "rastro",
      dica: "copias dos quadros anteriores por tras da imagem, mais fracas quanto mais antigas",
      campos: [
        { k: "copies", label: "copias", max: 16, step: 1 },
        { k: "interval", label: "intervalo (s)", max: 0.2, step: 0.005 },
        { k: "alpha", label: "alfa", max: 1, step: 0.05 },
      ],
    },
  };
  const ehBoneco = $derived(!!app.asset?.tres?.endsWith(".boneco"));
  const efeitos = $derived.by(() => {
    app.version;
    app.play.time;
    if (!slot || !app.doc || !ehBoneco) return [];
    const anim = app.mode === "animate" ? app.play.animation : null;
    const animados = Object.keys((anim && app.doc.json.animations?.[anim]?.effects?.[slot.name]) || {});
    return EFFECT_NAMES.filter((n) => slot.effects?.[n] || animados.includes(n)).map((n) => ({ n, v: effectFields(n, effectAt(app.doc!.json, anim, slot.name, n, app.play.time)) }));
  });
  const faltam = $derived(EFFECT_NAMES.filter((n) => !efeitos.some((x) => x.n === n)));

  function setEfeito(n: string, campo: string, valor: any) {
    if (!slot) return;
    if (app.mode === "animate" && app.play.animation) {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { slot: slot.name }, timeline: n, time, [campo]: valor } }, `${EFEITOS[n].nome} ${slot.name} @${time}`, `ef-${n}-${slot.name}-${time}`);
    } else app.run({ cmd: "slot.effect", args: { slot: slot.name, effect: n, [campo]: valor } }, `${EFEITOS[n].nome} ${slot.name}`, `ef-${n}-${slot.name}`);
  }
  // ligar um efeito: no setup com um valor que ja aparece (o padrao deixa desligado)
  const LIGA: Record<string, Record<string, any>> = { outline: { width: 3, color: "ffd23cff" }, glow: { strength: 1, color: "4cc9ffff" }, dissolve: {}, tint: { color: "ff3355ff" }, smear: { strength: 0.05 }, trail: { copies: 4 } };
  function ligar(n: string) {
    if (!slot || !n) return;
    app.run({ cmd: "slot.effect", args: { slot: slot.name, effect: n, ...LIGA[n] } }, `${EFEITOS[n].nome} em ${slot.name}`);
  }
  function tirar(n: string) {
    if (!slot) return;
    app.run({ cmd: "slot.effect", args: { slot: slot.name, effect: n, off: true } }, `tira ${EFEITOS[n].nome} de ${slot.name}`);
  }

  // ---- particulas (so .boneco; docs/NUCLEO.md "Particulas"): os emissores que desenham nesta camada
  const CAMPOS_P = [
    { k: "rate", label: "taxa", max: 100, step: 1, dica: "particulas por segundo" },
    { k: "speed", label: "velocidade", max: 600, step: 5, par: true, dica: "px/s (o maior do sorteio)" },
    { k: "life", label: "vida", max: 4, step: 0.05, par: true, dica: "segundos (a maior do sorteio)" },
    { k: "spread", label: "abertura", max: 360, step: 5, dica: "graus do leque" },
    { k: "angle", label: "direcao", max: 360, step: 5, dica: "graus no osso (0 = ao longo do osso)" },
    { k: "gravity", label: "gravidade", max: 1000, step: 10, dica: "px/s2 para baixo" },
  ] as const;
  const PADRAO_P: Record<string, number> = { rate: 10, speed: 100, life: 1, spread: 30, angle: 90, gravity: 0, width: 6, jitter: 0.15, segments: 10 };
  // o raio: a taxa e a intensidade (0 a 1), e os controles sao os da linha
  const CAMPOS_RAIO = [
    { k: "rate", label: "intensidade", max: 1, step: 0.01, dica: "0 apaga, 1 cheio" },
    { k: "width", label: "largura", max: 60, step: 1, dica: "px" },
    { k: "jitter", label: "desvio", max: 0.5, step: 0.01, dica: "quanto foge para os lados (fracao do comprimento)" },
    { k: "segments", label: "segmentos", max: 30, step: 1, dica: "pedacos da linha" },
  ];
  const camposDe = (p: any) => (p.type === "lightning" ? CAMPOS_RAIO : CAMPOS_P);
  const emissores = $derived.by(() => {
    app.version;
    app.play.time;
    if (!slot || !app.doc || !ehBoneco) return [];
    const anim = app.mode === "animate" ? app.play.animation : null;
    return ((app.doc.json as any).particles ?? [])
      .filter((p: any) => p.slot === slot.name)
      .map((p: any) => {
        const ks: any[] = (anim && app.doc!.json.animations?.[anim]?.particles?.[p.name]?.rate) || [];
        let rate = p.rate ?? PADRAO_P.rate;
        // a taxa no instante (linear entre as chaves), para o controle mostrar o que toca
        if (ks.length && app.play.time >= (ks[0].time ?? 0)) {
          let k = ks.length - 1;
          while (k > 0 && (ks[k].time ?? 0) > app.play.time) k--;
          rate = ks[k].value ?? rate;
          if (k < ks.length - 1 && ks[k].curve !== "stepped") rate += (((ks[k + 1].value ?? rate) - rate) * (app.play.time - (ks[k].time ?? 0))) / ((ks[k + 1].time ?? 0) - (ks[k].time ?? 0));
        }
        const v = (k: string) => (k === "rate" ? rate : Array.isArray(p[k]) ? p[k][1] : (p[k] ?? PADRAO_P[k]));
        return { p, v };
      });
  });
  const animando = $derived(app.mode === "animate" && !!app.play.animation);

  // ---- luzes (so .boneco; docs/NUCLEO.md "Luzes"): as presas a este osso e a ambiente
  const CAMPOS_LUZ = [
    { k: "strength", label: "forca", min: 0, max: 4, step: 0.05, dica: "quanto a luz soma (1: a cor dela inteira)" },
    { k: "radius", label: "raio", min: 0, max: 1500, step: 10, dica: "a luz some nessa distancia, em pixels do mundo" },
    { k: "height", label: "altura", min: -300, max: 500, step: 5, dica: "acima do plano; baixa ilumina rasante, negativa vira contraluz" },
  ];
  const luzesDoOsso = $derived.by(() => {
    app.version;
    app.play.time;
    if (!bone || !app.doc || !ehBoneco) return [];
    const anim = app.mode === "animate" ? app.play.animation : null;
    return ((app.doc.json as any).lights ?? []).filter((l: any) => l.bone === bone.name).map((l: any) => ({ n: l.name as string, v: effectFields("light", fieldsAt(app.doc!.json, anim, { light: l.name }, "light", app.play.time)) }));
  });
  const ambiente = $derived.by(() => {
    app.version;
    app.play.time;
    const j = app.doc?.json as any;
    if (!j || !ehBoneco || !(j.lights?.length || j.ambient)) return null;
    return effectFields("ambient", fieldsAt(j, app.mode === "animate" ? app.play.animation : null, { ambient: true }, "ambient", app.play.time));
  });
  // sem relevo nas paginas, as luzes nao tem o que iluminar
  const semRelevo = $derived(!!app.doc && !/^relevo:/m.test(app.doc.atlas.text));
  function setLuz(n: string, campo: string, valor: any) {
    if (animando) {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { light: n }, timeline: "light", time, [campo]: valor } }, `luz ${n} @${time}`, `luz-${n}-${campo}-${time}`);
    } else app.run({ cmd: "light.set", args: { name: n, [campo]: valor } }, `luz ${n}`, `luz-${n}-${campo}`);
  }
  function setAmbiente(campo: string, valor: any) {
    if (animando) {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { ambient: true }, timeline: "ambient", time, [campo]: valor } }, `ambiente @${time}`, `amb-${campo}-${time}`);
    } else app.run({ cmd: "ambient.set", args: { [campo]: valor } }, "luz ambiente", `amb-${campo}`);
  }
  function novaLuz() {
    if (!bone) return;
    let nome = "luz";
    for (let n = 2; ((app.doc?.json as any).lights ?? []).some((l: any) => l.name === nome); n++) nome = `luz_${n}`;
    app.run({ cmd: "light.set", args: { name: nome, bone: bone.name, color: "ffeecc", strength: 1.2, radius: 400, height: 100 } }, `luz em ${bone.name}`);
  }
  function setP(nome: string, campo: string, valor: number, atual: any) {
    if (animando && campo === "rate") {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { particles: nome }, timeline: "rate", time, value: valor } }, `taxa ${nome} @${time}`, `p-rate-${nome}-${time}`);
      return;
    }
    // campos com [min, max]: o controle muda o maior e mantem a proporcao do menor
    const par = CAMPOS_P.find((c) => c.k === campo && "par" in c);
    const val = par ? (Array.isArray(atual) ? [+(atual[0] * (valor / (atual[1] || 1))).toFixed(3), valor] : [valor * 0.5, valor]) : valor;
    app.run({ cmd: "particles.set", args: { name: nome, [campo]: val } }, `particulas ${nome}`, `p-${campo}-${nome}`);
  }
  function novoEmissor() {
    if (!slot) return;
    let nome = `${slot.name}_particulas`;
    for (let n = 2; ((app.doc?.json as any).particles ?? []).some((p: any) => p.name === nome); n++) nome = `${slot.name}_particulas_${n}`;
    app.run({ cmd: "particles.set", args: { name: nome, slot: slot.name, rate: 12, life: [0.6, 1.2], speed: [60, 140], spread: 50, scale: [0.4, 0.1], spin: [-120, 120], color: ["ffffffff", "ffffff00"] } }, `particulas em ${slot.name}`);
  }
  function rajada(nome: string) {
    const time = +app.play.time.toFixed(4);
    app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { particles: nome }, timeline: "burst", time, count: 12 } }, `rajada ${nome} @${time}`);
  }

  // tipo da imagem atual do slot (region vira malha; malha pode ganhar pesos)
  const attKind = $derived.by(() => {
    app.version;
    if (!slot?.attachment || !app.doc) return null;
    const a = app.doc.json.skins?.find((s: any) => s.attachments?.[slot.name]?.[slot.attachment])?.attachments[slot.name][slot.attachment];
    if (!a) return null;
    return { type: a.type ?? "region", weighted: a.type === "mesh" && a.vertices.length > a.uvs.length };
  });

  async function makeMesh() {
    if (!slot?.attachment) return;
    await app.runAsync([{ cmd: "mesh.create", args: { slot: slot.name, name: slot.attachment, detail: 1.8 } }], `deixar ${slot.attachment} deformavel`);
  }

  // pesos automaticos: osso da peca, o pai e os filhos (o que costuma dobrar junto)
  function bindToBones() {
    if (!slot?.attachment || !app.doc) return;
    const bones = app.doc.json.bones;
    const own = slot.bone;
    const parent = bones.find((b: any) => b.name === own)?.parent;
    const kids = bones.filter((b: any) => b.parent === own).map((b: any) => b.name);
    const list = [own, ...kids, ...(parent && parent !== bones[0].name ? [parent] : [])];
    if (list.length < 2) return app.toast(`${own} nao tem pai nem filhos para dobrar junto. Crie um osso filho (ferramenta Osso) dentro da imagem.`);
    app.run({ cmd: "mesh.weights", args: { slot: slot.name, attachment: slot.attachment, bones: list } }, `${slot.attachment} dobra com ${list.join(", ")}`);
  }

  // ordem de desenho (o z): a logica fica no estado (Pose base muda o setup; animando vira
  // chave). Subir e descer passam pela proxima camada que encosta nesta na tela
  function order(dir: 1 | -1 | "front" | "back") {
    if (!slot) return;
    if (dir === "front") app.moveLayer(slot.name, app.layerOrder().length - 1);
    else if (dir === "back") app.moveLayer(slot.name, 0);
    else app.stepLayer(slot.name, dir);
  }
  // camadas que encostam nesta agora: para "na frente de" e "atras de"
  const neighbors = $derived.by(() => {
    app.version;
    app.play.time;
    const sk = app.viewer?.pose;
    if (!slot || !sk) return [] as string[];
    const me = slotWorldBox(sk, slot.name);
    if (!me) return [];
    return app.layerOrder().filter((o) => {
      if (o === slot.name) return false;
      const b = slotWorldBox(sk, o);
      return !!b && me[0] < b[2] && b[0] < me[2] && me[1] < b[3] && b[1] < me[3];
    }).reverse();
  });
  let relTo = $state("");

  // IK em um clique: o osso selecionado e o pai passam a alcancar um alvo na ponta
  function quickIk() {
    if (!bone || !app.doc) return;
    const b = app.doc.json.bones.find((x: any) => x.name === bone.name);
    const parent = app.doc.json.bones.find((x: any) => x.name === b?.parent);
    if (!parent?.parent) return app.toast("IK precisa de um osso com pai (ex: antebraco com braco).");
    const sk = app.viewer?.pose?.findBone(bone.name);
    if (!sk) return;
    const len = b.length || 20;
    // ponta do osso no mundo (visual, y para cima)
    let tx = sk.worldX + sk.a * len,
      ty = sk.worldY + sk.c * len;
    if (app.viewer?.flip) ty = -ty;
    const target = `${bone.name}_alvo`;
    const root = app.doc.json.bones[0].name;
    app.run(
      [
        { cmd: "bone.add", args: { name: target, parent: root, at: [tx, ty], color: "ff3f00ff" } },
        { cmd: "ik.create", args: { name: `${bone.name}_ik`, bones: [parent.name, bone.name], target } },
      ],
      `IK em ${parent.name} + ${bone.name}`,
    );
    app.select({ bone: target });
    app.tool = "move";
  }

  // constraints que envolvem o osso selecionado
  const cons = $derived.by(() => {
    app.version;
    const b = app.selection.bone;
    if (!b || !app.doc) return [];
    return (app.doc.json.constraints ?? [])
      .filter((c: any) => c.bone === b || c.target === b || c.source === b || c.bones?.includes(b))
      .map((c: any) => ({ name: c.name, type: c.type, strength: c.strength ?? 100, mix: c.mix ?? 1 }));
  });
  const CTYPE: Record<string, string> = { physics: "balanco", ik: "IK (alcance)", transform: "copia", path: "caminho", slider: "slider" };

  let fineOpen = $state(false);
  let scrub: { k: string; x: number; v: number; step: number; merge: string } | null = null;
  let seq = 0;

  function set(k: string, v: number, merge?: string) {
    if (!bone) return;
    applyLocal(bone.name, { [k]: v }, merge);
  }

  // arrastar o rotulo muda o valor (como no Blender/Spine)
  function labelDown(e: PointerEvent, k: string, step: number) {
    if (!bone) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub = { k, x: e.clientX, v: bone.values[k], step, merge: `insp${++seq}` };
  }
  function labelMove(e: PointerEvent) {
    if (!scrub) return;
    const dx = e.clientX - scrub.x;
    set(scrub.k, scrub.v + dx * scrub.step * (e.shiftKey ? 0.1 : 1), scrub.merge);
  }

  function slotSet(args: Record<string, any>) {
    if (!slot) return;
    if (app.mode === "animate" && app.play.animation && "attachment" in args) {
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { slot: slot.name }, timeline: "attachment", time: +app.play.time.toFixed(4), name: args.attachment } });
      return;
    }
    app.run({ cmd: "slot.set", args: { slot: slot.name, ...args } });
  }
</script>

<div class="insp">
  {#if bone}
    <div class="title"><span class="ico">🦴</span>{bone.name}</div>
    <div class="dim small">pai: {bone.parent ?? "(raiz)"} · {app.mode === "animate" && app.play.animation ? `chave em ${app.play.time.toFixed(2)}s` : "pose de montagem"}</div>
    <details class="fine" open={fineOpen} ontoggle={(e) => (fineOpen = (e.target as HTMLDetailsElement).open)}>
      <summary>ajuste fino</summary>
    <div class="fields">
      {#each FIELDS as f}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <label onpointerdown={(e) => labelDown(e, f.k, f.step)} onpointermove={labelMove} onpointerup={() => (scrub = null)}>{f.label}</label>
        <input type="number" step={f.step} value={bone.values[f.k]} onchange={(e) => set(f.k, +(e.target as HTMLInputElement).value)} />
      {/each}
    </div>
    </details>
    <div class="quick">
      <button onclick={quickIk} title="O osso e o pai passam a alcancar um alvo: mova o alvo e o membro dobra sozinho">🎯 Alcancar (IK)</button>
    </div>
    {#if cons.length}
      <div class="cons">
        {#each cons as c (c.name)}
          <div class="con">
            <span class="ctype">{CTYPE[c.type] ?? c.type}</span>
            <span class="cname" title={c.name}>{c.name}</span>
            {#if c.type === "physics"}
              <label class="slider" title="mole ↔ duro">mole <input type="range" min="20" max="300" value={c.strength} onchange={(e) => app.run({ cmd: "constraint.set", args: { name: c.name, props: { strength: +(e.target as HTMLInputElement).value } } }, `dureza ${c.name}`)} /> duro</label>
            {:else}
              <label class="slider" title="quanto vale (0..1)">mix <input type="range" min="0" max="1" step="0.05" value={c.mix} onchange={(e) => app.run({ cmd: "constraint.set", args: { name: c.name, props: { mix: +(e.target as HTMLInputElement).value } } }, `mix ${c.name}`)} /></label>
            {/if}
            <button class="x" title="remover" onclick={() => app.run({ cmd: "constraint.delete", args: { name: c.name } })}>✕</button>
          </div>
        {/each}
      </div>
    {/if}
    {#if ehBoneco}
      <div class="efeitos">
        <div class="dim small">
          Luzes (do Mamulengo): presas a este osso, iluminam as paginas com relevo. {animando ? "Mexer grava chave neste instante." : "Na Pose base muda o valor inicial."}
          {#if semRelevo}<br />Sem relevo nas paginas: <code>npx tsx tools/relevo.ts x.boneco --gravar</code>{/if}
        </div>
        {#each luzesDoOsso as l (l.n)}
          <div class="ef">
            <div class="efnome" title="luz presa em {bone.name}">
              <span>💡 {l.n}</span>
              <input type="color" value={"#" + l.v.color.slice(0, 6)} title="cor" oninput={(e) => setLuz(l.n, "color", (e.target as HTMLInputElement).value.slice(1) + l.v.color.slice(6, 8))} />
              {#if !animando}<button class="tira" onclick={() => app.run({ cmd: "light.delete", args: { name: l.n } }, `apaga ${l.n}`)} title="apagar a luz">✕</button>{/if}
            </div>
            {#each CAMPOS_LUZ as c}
              <label class="efcampo" title={c.dica}>
                <span>{c.label}</span>
                <input type="range" min={c.min} max={c.max} step={c.step} value={l.v[c.k]} oninput={(e) => setLuz(l.n, c.k, +(e.target as HTMLInputElement).value)} />
                <span class="num">{(+l.v[c.k]).toFixed(c.step < 1 ? 2 : 0)}</span>
              </label>
            {/each}
          </div>
        {/each}
        {#if ambiente}
          <div class="ef">
            <div class="efnome" title="a luz que chega em tudo que tem relevo, somada as luzes">
              <span>ambiente</span>
              <input type="color" value={"#" + ambiente.color.slice(0, 6)} title="cor" oninput={(e) => setAmbiente("color", (e.target as HTMLInputElement).value.slice(1) + ambiente!.color.slice(6, 8))} />
            </div>
            <label class="efcampo" title="1: as cores como sao; abaixo, o que nenhuma luz alcanca escurece">
              <span>forca</span>
              <input type="range" min="0" max="2" step="0.05" value={ambiente.strength} oninput={(e) => setAmbiente("strength", +(e.target as HTMLInputElement).value)} />
              <span class="num">{(+ambiente.strength).toFixed(2)}</span>
            </label>
          </div>
        {/if}
        {#if !animando}<button onclick={novaLuz} title="uma luz presa a este osso (anda com ele)">+ luz</button>{/if}
      </div>
    {/if}
  {:else}
    <div class="dim">Clique numa parte do personagem para escolher.</div>
  {/if}

  {#if slot}
    <div class="title slot"><span class="ico">🖼</span>{slot.name}</div>
    <div class="dim small">
      Camada: muda qual imagem aparece, cor, transparencia, ordem e malha. Quem move esta imagem e o osso
      <b>{app.selection.bone ?? slot.bone}</b>{(app.selection.bone ?? slot.bone) !== slot.bone ? ` (pelos pesos da malha; a camada fica presa em ${slot.bone})` : ""}: arrastar na tela move o osso.
    </div>
    <div class="fields">
      <label>imagem</label>
      <select value={slot.attachment ?? ""} onchange={(e) => slotSet({ attachment: (e.target as HTMLSelectElement).value || null })}>
        <option value="">(nenhuma)</option>
        {#each slot.atts as a}<option value={a}>{a}</option>{/each}
      </select>
      <label>mistura</label>
      <select value={slot.blend ?? "normal"} onchange={(e) => slotSet({ blend: (e.target as HTMLSelectElement).value })}>
        <option value="normal">normal</option>
        <option value="additive">brilho (aditivo)</option>
        <option value="multiply">multiplicar</option>
        <option value="screen">tela</option>
      </select>
      {#if slot.blend === "multiply" || slot.blend === "screen"}
        <span></span>
        <div class="dim">
          {slot.blend === "multiply"
            ? "No jogo (spine-godot) multiplicar ignora a transparencia: a imagem inteira escurece o fundo, inclusive as bordas transparentes."
            : "No jogo (spine-godot) tela vira subtracao: escurece em vez de clarear."}
        </div>
      {/if}
      <label>camada</label>
      <div class="order">
        <button onclick={() => order("back")} title="Para tras de tudo">⇊</button>
        <button onclick={() => order(-1)} title="Para tras da proxima camada que encosta nesta (PageDown)">↓</button>
        <button onclick={() => order(1)} title="Para a frente da proxima camada que encosta nesta (PageUp)">↑</button>
        <button onclick={() => order("front")} title="Na frente de tudo (Shift+PageUp)">⇈</button>
      </div>
      {#if neighbors.length}
        <span></span>
        <div class="order rel">
          <select bind:value={relTo} title="camadas que encostam nesta agora">
            <option value="">encosta em...</option>
            {#each neighbors as n}<option value={n}>{n}</option>{/each}
          </select>
          <button disabled={!relTo} onclick={() => relTo && slot && app.placeLayer(slot.name, relTo, "front")} title="Na frente desta camada">na frente</button>
          <button disabled={!relTo} onclick={() => relTo && slot && app.placeLayer(slot.name, relTo, "back")} title="Atras desta camada">atras</button>
        </div>
      {/if}
      {#if attKind}
        <span></span>
        <div class="mesh">
          {#if attKind.type === "region"}
            <button onclick={makeMesh} title="Transforma a imagem em malha, para deformar com o pincel">🫧 Deixar deformavel</button>
          {:else if attKind.type === "mesh" || attKind.type === "linkedmesh"}
            {#if attKind.type === "mesh"}
              <button onclick={bindToBones} title="Prende a malha aos ossos proximos, para dobrar junto">🦴 {attKind.weighted ? "Refazer dobra" : "Dobrar com os ossos"}</button>
            {/if}
            {#if app.meshEdit?.slot !== slot.name}
              <button class="edit" onclick={() => startMeshEdit(slot.name, slot.attachment)} title="Mover, criar e apagar pontos da malha e pintar quanto cada osso puxa (vai para a Pose base)">✏️ Editar malha</button>
            {/if}
          {/if}
        </div>
      {/if}
      {#if app.meshEdit?.slot === slot.name}
        <div class="wide"><MeshPanel /></div>
      {/if}
      {#if color}
        <label>cor</label>
        <div class="color">
          <input type="color" value={color.rgb} oninput={(e) => setColor((e.target as HTMLInputElement).value, color.a)} />
          <input type="range" min="0" max="1" step="0.01" value={color.a} title="transparencia" oninput={(e) => setColor(color.rgb, +(e.target as HTMLInputElement).value)} />
        </div>
      {/if}
    </div>
    {#if ehBoneco}
      <div class="efeitos">
        <div class="dim small">
          Efeitos e particulas (do Mamulengo, o Spine nao tem; aparecem no desenho do nucleo e no jogo). {app.mode === "animate" && app.play.animation ? "Mexer grava chave neste instante." : "Na Pose base muda o valor inicial."}
        </div>
        {#each efeitos as ef (ef.n)}
          <div class="ef">
            <div class="efnome" title={EFEITOS[ef.n].dica}>
              <span>{EFEITOS[ef.n].nome}</span>
              {#if ef.v.color}<input type="color" value={"#" + ef.v.color.slice(0, 6)} title="cor" oninput={(e) => setEfeito(ef.n, "color", (e.target as HTMLInputElement).value.slice(1) + ef.v.color.slice(6, 8))} />{/if}
              {#if app.mode !== "animate" || !app.play.animation}<button class="tira" onclick={() => tirar(ef.n)} title="tirar o efeito do setup">✕</button>{/if}
            </div>
            {#each EFEITOS[ef.n].campos as c}
              <label class="efcampo">
                <span>{c.label}</span>
                <input type="range" min="0" max={c.max} step={c.step} value={ef.v[c.k]} oninput={(e) => setEfeito(ef.n, c.k, +(e.target as HTMLInputElement).value)} />
                <span class="num">{(+ef.v[c.k]).toFixed(c.step < 1 ? 2 : 0)}</span>
              </label>
            {/each}
          </div>
        {/each}
        {#each emissores as em (em.p.name)}
          <div class="ef">
            <div class="efnome" title="emissor de particulas: nasce do osso {em.p.bone ?? slot.bone}, imagem {em.p.image}">
              <span>✦ {em.p.name}</span>
              {#if animando && em.p.type !== "lightning"}<button onclick={() => rajada(em.p.name)} title="rajada: 12 nascem de uma vez neste instante">rajada</button>{/if}
              {#if !animando}<button class="tira" onclick={() => app.run({ cmd: "particles.delete", args: { name: em.p.name } }, `apaga ${em.p.name}`)} title="apagar o emissor">✕</button>{/if}
            </div>
            {#each camposDe(em.p).filter((c) => !animando || c.k === "rate") as c}
              <label class="efcampo" title={c.dica}>
                <span>{c.label}</span>
                <input type="range" min="0" max={c.max} step={c.step} value={em.v(c.k)} oninput={(e) => setP(em.p.name, c.k, +(e.target as HTMLInputElement).value, em.p[c.k])} />
                <span class="num">{(+em.v(c.k)).toFixed(c.step < 1 ? 2 : 0)}</span>
              </label>
            {/each}
          </div>
        {/each}
        {#if !animando}<button onclick={novoEmissor} title="particulas que nascem do osso desta camada e desenham logo depois dela">+ particulas</button>{/if}
        {#if faltam.length && (app.mode !== "animate" || !app.play.animation)}
          <select value="" onchange={(e) => { ligar((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }} title="liga um efeito nesta camada">
            <option value="">+ efeito...</option>
            {#each faltam as n}<option value={n}>{EFEITOS[n].nome}: {EFEITOS[n].dica}</option>{/each}
          </select>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .insp {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .order.rel select {
    flex: 1;
    min-width: 0;
  }
  .order.rel button {
    font-size: 11px;
    padding: 2px 6px;
  }
  .order {
    display: flex;
    gap: 4px;
  }
  .order button {
    flex: 1;
    padding: 4px;
  }
  .quick button {
    width: 100%;
    text-align: left;
    margin-top: 4px;
  }
  .mesh {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mesh button {
    width: 100%;
    text-align: left;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .efeitos {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ef {
    border: 1px solid var(--line, #3a3448);
    border-radius: 6px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .efnome {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .efnome span {
    flex: 1;
  }
  .efnome input[type="color"] {
    width: 30px;
    height: 22px;
    padding: 0 2px;
  }
  .efnome .tira {
    padding: 0 6px;
  }
  .efcampo {
    display: grid;
    grid-template-columns: 56px 1fr 40px;
    align-items: center;
    gap: 6px;
  }
  .efcampo .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .color {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .color input[type="color"] {
    width: 34px;
    height: 26px;
    padding: 0 2px;
  }
  .cons {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .con {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 2px 6px;
    align-items: center;
    background: #1a1820;
    padding: 5px 8px;
    border-radius: 8px;
    font-size: 12px;
  }
  .ctype {
    color: var(--accent2);
  }
  .cname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .con .slider {
    grid-column: 1 / 3;
    display: flex;
    gap: 6px;
    align-items: center;
    cursor: default;
  }
  .con .slider input {
    flex: 1;
  }
  .x {
    padding: 2px 6px;
    grid-row: 1 / 3;
    grid-column: 3;
  }
  .fine summary {
    cursor: pointer;
    color: var(--dim);
    font-size: 12px;
    margin-bottom: 6px;
  }
  .title {
    font-weight: 600;
    font-size: 15px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .title.slot {
    margin-top: 10px;
  }
  .small {
    font-size: 12px;
  }
  .fields {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 6px 8px;
    align-items: center;
  }
  label {
    color: var(--dim);
    font-size: 12px;
    cursor: ew-resize;
    user-select: none;
  }
  input,
  select {
    width: 100%;
  }
  .ico {
    font-size: 12px;
  }
</style>
