<script lang="ts">
  // Painel de editar malha: pontos (mover, criar, apagar) e pintura de pesos.
  import { app } from "./state.svelte.ts";
  import { currentMesh, deleteVertex, stopMeshEdit } from "./meshedit.ts";

  let box = $state<HTMLDivElement>();
  // o painel aparece no fim do inspetor: traz para a vista ao abrir
  $effect(() => {
    box?.scrollIntoView({ block: "nearest" });
  });

  const info = $derived.by(() => {
    app.version;
    app.meshEdit?.attachment;
    return currentMesh();
  });

  const slotBone = $derived.by(() => {
    app.version;
    return app.doc?.json.slots.find((s: any) => s.name === app.meshEdit?.slot)?.bone ?? null;
  });

  // ossos para pintar: os que ja pesam na malha e os vizinhos do osso da peca primeiro
  const boneList = $derived.by(() => {
    app.version;
    const doc = app.doc;
    if (!doc || !info) return { main: [] as string[], rest: [] as string[] };
    const all: string[] = doc.json.bones.map((b: any) => b.name);
    const main = new Set<string>(info.bones);
    if (slotBone) main.add(slotBone);
    const parent = doc.json.bones.find((b: any) => b.name === slotBone)?.parent;
    if (parent && parent !== all[0]) main.add(parent);
    for (const b of doc.json.bones) if (b.parent === slotBone) main.add(b.name);
    if (app.meshEdit?.bone) main.add(app.meshEdit.bone);
    return { main: all.filter((n) => main.has(n)), rest: all.filter((n) => !main.has(n)) };
  });

  // quanto cada osso pesa na malha (maior peso num vertice), para o botao mostrar
  const reach = $derived.by(() => {
    const out: Record<string, number> = {};
    for (const w of info?.weights ?? []) for (const [b, x] of Object.entries(w)) out[b] = Math.max(out[b] ?? 0, x);
    return out;
  });

  function set<K extends keyof NonNullable<typeof app.meshEdit>>(k: K, v: NonNullable<typeof app.meshEdit>[K]) {
    if (app.meshEdit) app.meshEdit[k] = v;
  }
</script>

{#if app.meshEdit && info}
  {@const me = app.meshEdit}
  <div class="mp" bind:this={box}>
    <div class="head">✏️ Malha de <b>{me.attachment}</b></div>
    <div class="tabs">
      <button class:on={me.tab === "points"} onclick={() => set("tab", "points")}>📍 Pontos</button>
      <button class:on={me.tab === "weights"} onclick={() => set("tab", "weights")}>🎨 Pesos</button>
    </div>
    {#if me.tab === "points"}
      <ul class="help">
        <li>Arraste um ponto para mover</li>
        <li>Clique na <b class="pink">borda</b>: ponto novo no contorno</li>
        <li>Clique <b class="cyan">dentro</b>: ponto novo no meio</li>
        <li><kbd>Delete</kbd> apaga o ponto escolhido</li>
      </ul>
      <label class="check" title="Desligado: o ponto anda sobre a imagem (muda o recorte). Ligado: a imagem estica junto.">
        <input type="checkbox" checked={me.stretch} onchange={(e) => set("stretch", (e.target as HTMLInputElement).checked)} /> Esticar a imagem junto
      </label>
      <button class="wide" disabled={me.vertex === null} onclick={deleteVertex}>🗑 Apagar ponto</button>
      <div class="dim small">{info.world.length} pontos · {info.hull} no contorno · {info.triangles.length / 3} triangulos</div>
    {:else}
      <div class="lbl">Qual osso puxa esta parte?</div>
      <div class="bones">
        {#each boneList.main as b (b)}
          <button class:on={me.bone === b} onclick={() => set("bone", b)} title="peso maximo na malha: {Math.round((reach[b] ?? 0) * 100)}%">
            <span class="dot" style="opacity: {0.25 + 0.75 * (reach[b] ?? 0)}"></span>{b}
          </button>
        {/each}
      </div>
      {#if boneList.rest.length}
        <select value="" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) set("bone", v); }}>
          <option value="">outro osso...</option>
          {#each boneList.rest as b (b)}<option value={b}>{b}</option>{/each}
        </select>
      {/if}
      <div class="tabs">
        <button class:on={me.paint === "add"} onclick={() => set("paint", "add")}>➕ Somar</button>
        <button class:on={me.paint === "sub"} onclick={() => set("paint", "sub")}>➖ Tirar</button>
      </div>
      <label class="row">forca <input type="range" min="0.05" max="1" step="0.05" value={me.strength} oninput={(e) => set("strength", +(e.target as HTMLInputElement).value)} /></label>
      <label class="row">pincel <input type="range" min="15" max="250" bind:value={app.brushRadius} /></label>
      <div class="legend"><span>0%</span><div class="ramp"></div><span>100%</span></div>
      {#if !info.weighted}
        <div class="dim small">A malha ainda segue so o osso <b>{slotBone}</b>. Pinte outro osso para ela dobrar com ele.</div>
      {/if}
      <div class="dim small">Segure Shift para inverter (somar/tirar).</div>
    {/if}
    <button class="done" onclick={stopMeshEdit}>✔ Pronto</button>
  </div>
{/if}

<style>
  .mp {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
    padding: 10px;
    border: 1px solid #5ee0d0;
    border-radius: 10px;
    background: #12262a;
  }
  .head {
    font-size: 14px;
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    flex: 1;
    font-size: 15px;
    padding: 8px 6px;
  }
  .help {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    line-height: 1.5;
  }
  .pink {
    color: var(--accent);
  }
  .cyan {
    color: #5ee0d0;
  }
  kbd {
    font: inherit;
    font-size: 11px;
    background: var(--panel2);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 4px;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
    cursor: pointer;
  }
  .check input {
    width: auto;
  }
  .wide,
  .done {
    width: 100%;
    padding: 9px;
    font-size: 15px;
  }
  .done {
    background: #5ee0d0;
    border-color: #5ee0d0;
    color: #10201f;
    font-weight: 600;
  }
  .lbl {
    font-size: 13px;
  }
  .bones {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .bones button {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 9px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #ff3833;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--dim);
  }
  .row input {
    flex: 1;
  }
  select {
    width: 100%;
  }
  .legend {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    color: var(--dim);
  }
  .ramp {
    flex: 1;
    height: 10px;
    border-radius: 5px;
    background: linear-gradient(90deg, rgb(41, 56, 158), rgb(38, 204, 140) 35%, rgb(255, 217, 51) 70%, rgb(255, 56, 51));
  }
  .small {
    font-size: 12px;
  }
</style>
