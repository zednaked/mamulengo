<script lang="ts">
  import { app, type AssetInfo } from "./state.svelte.ts";

  let open = $state(false);
  let q = $state("");

  const groups = $derived.by(() => {
    const f = q.trim().toLowerCase();
    const m = new Map<string, AssetInfo[]>();
    for (const a of app.assets) {
      if (f && !`${a.project}/${a.name}`.toLowerCase().includes(f)) continue;
      m.set(a.project, [...(m.get(a.project) ?? []), a]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  async function choose(a: AssetInfo) {
    if (app.doc?.dirty && !confirmDiscard()) return;
    open = false;
    await app.open(a);
  }

  // sem dialogo do navegador: um segundo clique confirma
  let armed = 0;
  function confirmDiscard() {
    if (Date.now() - armed < 3000) return true;
    armed = Date.now();
    app.toast("Ha alteracoes nao salvas. Clique de novo para trocar mesmo assim.");
    return false;
  }
</script>

<div class="picker">
  <button class="current" onclick={() => (open = !open)}>
    {#if app.asset}
      <span class="dim">{app.asset.project} /</span> <b>{app.asset.name}</b>
    {:else}
      Abrir personagem…
    {/if}
    <span class="dim">▾</span>
  </button>
  {#if open}
    <div class="pop">
      <!-- svelte-ignore a11y_autofocus -->
      <input placeholder="procurar ({app.assets.length} assets)" bind:value={q} autofocus />
      <div class="list">
        {#each groups as [proj, list]}
          <div class="proj">{proj}</div>
          {#each list as a}
            <button class="item" class:on={a.id === app.asset?.id} onclick={() => choose(a)}>{a.name}<span class="dim res">{a.res.replace("res://", "")}</span></button>
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }
  .current {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 260px;
    justify-content: space-between;
  }
  .pop {
    position: absolute;
    top: 40px;
    left: 0;
    width: 440px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    z-index: 20;
    box-shadow: 0 16px 40px #0009;
  }
  .list {
    overflow: auto;
  }
  .proj {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent2);
    margin: 8px 4px 4px;
  }
  .item {
    display: flex;
    justify-content: space-between;
    width: 100%;
    background: none;
    border: none;
    text-align: left;
  }
  .item:hover {
    background: var(--panel2);
  }
  .item.on {
    background: #3a2433;
  }
  .res {
    font-size: 11px;
    margin-left: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
