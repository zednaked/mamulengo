<script lang="ts">
  // Versoes do personagem, alem do desfazer: cada gravacao vira versao; da para marcar
  // com nome, ver o que mudou, comparar com o atual e restaurar (o atual vira versao antes).
  import { app } from "./state.svelte.ts";

  let list = $state<any[]>([]);
  let label = $state("");
  let busy = $state(false);
  let open = $state<string | null>(null);
  let diff = $state<{ id: string; changes: string[] } | null>(null);
  let confirm = $state<string | null>(null);

  $effect(() => {
    app.versionsTick;
    app.asset;
    load();
  });

  async function load() {
    try {
      list = await app.versions();
    } catch (e: any) {
      list = [];
    }
  }

  async function mark() {
    if (!label.trim()) return;
    busy = true;
    try {
      await app.markVersion(label.trim());
      label = "";
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      busy = false;
    }
  }

  async function compare(id: string) {
    try {
      const d = await app.diffVersion(id);
      diff = { id, changes: d.changes };
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    }
  }

  async function restore(id: string) {
    if (confirm !== id) {
      confirm = id;
      return;
    }
    confirm = null;
    busy = true;
    try {
      await app.restoreVersion(id);
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      busy = false;
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
</script>

<div class="versions">
  {#if !app.asset}
    <p class="dim">Abra um personagem.</p>
  {:else}
    <div class="mark">
      <input bind:value={label} placeholder="nome da versao (ex: aprovado pela direcao de arte)" onkeydown={(e) => e.key === "Enter" && mark()} />
      <button class="go" onclick={mark} disabled={busy || !label.trim()} title="Salva e guarda o estado atual com esse nome">Marcar</button>
    </div>
    <p class="dim small">Cada vez que salva vira uma versao. Restaurar guarda o estado atual antes, entao da para voltar.</p>
    {#if !list.length}
      <p class="dim">Nenhuma versao ainda: a primeira aparece quando salvar.</p>
    {/if}
    {#each list as v (v.id)}
      <div class="v" class:named={!!v.label}>
        <div class="row">
          <span class="who" title={v.source === "claude" ? "feita pelo Claude" : "feita na tela"}>{v.source === "claude" ? "🤖" : "🙂"}</span>
          <b class="name">{v.label ?? "salvo"}</b>
          <span class="spacer"></span>
          <span class="dim small">{when(v.at)}</span>
        </div>
        <button class="changes" onclick={() => (open = open === v.id ? null : v.id)}>
          {#each open === v.id ? v.changes : v.changes.slice(0, 2) as c}
            <div>{c}</div>
          {/each}
          {#if v.changes.length > 2 && open !== v.id}<div class="dim">+{v.changes.length - 2} (ver tudo)</div>{/if}
        </button>
        <div class="row">
          <button class="mini" onclick={() => compare(v.id)}>comparar com o atual</button>
          <button class="mini" class:warn={confirm === v.id} onclick={() => restore(v.id)} disabled={busy}>{confirm === v.id ? "confirmar restaurar?" : "restaurar"}</button>
        </div>
        {#if diff?.id === v.id}
          <div class="diff">
            <div class="dim small">desta versao para o atual:</div>
            {#each diff?.changes ?? [] as c}<div>{c}</div>{/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .versions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    font-size: 12px;
    overflow: auto;
  }
  .mark {
    display: flex;
    gap: 6px;
  }
  .mark input {
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .spacer {
    flex: 1;
  }
  .dim {
    color: var(--dim);
  }
  .small {
    font-size: 11px;
  }
  .v {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .v.named {
    border-color: var(--accent);
  }
  .name {
    font-size: 12px;
  }
  .changes {
    all: unset;
    cursor: pointer;
    color: #d6d0e0;
    line-height: 1.35;
  }
  .mini {
    padding: 1px 6px;
    font-size: 11px;
  }
  .warn {
    background: #e05561;
    border-color: #e05561;
    color: white;
  }
  .go {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .diff {
    border-top: 1px solid var(--line);
    padding-top: 4px;
  }
</style>
