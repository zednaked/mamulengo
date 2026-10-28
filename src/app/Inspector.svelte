<script lang="ts">
  import { app } from "./state.svelte.ts";
  import { slotWorldBox } from "./interact.ts";
  import { applyLocal } from "./interact.ts";
  import { startMeshEdit } from "./meshedit.ts";
  import MeshPanel from "./MeshPanel.svelte";

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
    const live = app.viewer?.skeleton?.findBone(name)?.pose;
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
    const live = app.mode === "animate" ? app.viewer?.skeleton?.findSlot(name)?.pose.color : null;
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
    const sk = app.viewer?.skeleton;
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
    const sk = app.viewer?.skeleton?.findBone(bone.name)?.appliedPose;
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
