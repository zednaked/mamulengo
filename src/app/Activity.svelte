<script lang="ts">
  import { app } from "./state.svelte.ts";

  const icon = (s: string) => (s === "claude" ? "🤖" : s === "ui" ? "🙂" : "⚙");
  const ago = (t: number) => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? `${s}s` : `${Math.round(s / 60)}min`;
  };
  let now = $state(Date.now());
  $effect(() => {
    const i = setInterval(() => (now = Date.now()), 5000);
    return () => clearInterval(i);
  });
</script>

<div class="act">
  {#each app.activity as a (a.id)}
    <div class="item {a.kind}" class:claude={a.source === "claude"}>
      <span class="who">{icon(a.source)}</span>
      <span class="what">{a.kind === "undo" ? "desfez: " : a.kind === "redo" ? "refez: " : ""}{a.label}</span>
      <span class="when dim">{now && ago(a.at)}</span>
    </div>
  {:else}
    <div class="dim">Tudo que voce e o Claude fizerem aparece aqui.</div>
  {/each}
</div>

<style>
  .act {
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-y: auto;
    font-size: 12px;
    min-height: 0;
    flex: 1;
  }
  .item {
    display: grid;
    grid-template-columns: 20px 1fr auto;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    background: #1a1820;
  }
  .item.claude {
    background: #16242e;
    border-left: 2px solid var(--claude);
  }
  .item.error {
    background: #2e1820;
    color: #ffc9c9;
  }
  .item.undo .what,
  .item.redo .what {
    color: var(--dim);
  }
  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
