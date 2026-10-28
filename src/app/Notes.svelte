<script lang="ts">
  // Anotacoes do personagem: escrever (presa ao instante e a parte, ou geral), responder,
  // resolver. Clicar no lugar da nota leva para a animacao, o instante e a parte.
  import { app } from "./state.svelte.ts";

  let text = $state("");
  let pin = $state(true);
  let only = $state<"anim" | "todas">("anim");
  let showDone = $state(false);
  let reply = $state<Record<string, string>>({});
  let name = $state(app.author);
  let busy = $state(false);

  const anim = $derived(app.play.animation);
  const shown = $derived(
    app.notes
      .filter((n) => (only === "todas" ? true : n.anim === anim || n.anim === null))
      .filter((n) => showDone || n.estado === "aberta")
      .slice()
      .reverse(),
  );
  const done = $derived(app.notes.filter((n) => n.estado === "resolvida").length);
  const t2 = (t: number | null) => (t == null ? "" : `${t.toFixed(2)}s`);
  const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  async function act(a: Record<string, any>) {
    busy = true;
    try {
      await app.noteAction(a);
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      busy = false;
    }
  }

  async function create() {
    if (!text.trim()) return;
    if (!app.author) app.setAuthor(name || "eu");
    await act({
      acao: "criar",
      autor: app.author,
      texto: text,
      ...(pin ? { anim, tempo: anim ? +app.play.time.toFixed(3) : null, osso: app.selection.bone ?? null, slot: app.selection.slot ?? null } : {}),
    });
    text = "";
  }

  function go(n: any) {
    const v = app.viewer;
    if (!v) return;
    if (n.anim && n.anim !== v.view.animation) v.setAnimation(n.anim);
    if (n.tempo != null) v.seek(n.tempo);
    if (n.osso || n.slot) app.select({ bone: n.osso ?? undefined, slot: n.slot ?? undefined });
  }
</script>

<div class="notes">
  {#if !app.doc}
    <p class="dim">Abra um personagem.</p>
  {:else}
    {#if !app.author}
      <div class="row">
        <input bind:value={name} placeholder="seu nome (aparece nas notas)" />
        <button onclick={() => app.setAuthor(name || "eu")}>ok</button>
      </div>
    {/if}
    <textarea bind:value={text} placeholder="Deixe uma nota: o que mudar, uma duvida, um aviso..." rows="3"></textarea>
    <div class="row">
      <label class="small"><input type="checkbox" bind:checked={pin} /> prender em {anim ?? "setup"}{anim ? ` @ ${t2(app.play.time)}` : ""}{app.selection.bone ? `, ${app.selection.bone}` : ""}</label>
      <span class="spacer"></span>
      <button class="go" onclick={create} disabled={busy || !text.trim()}>Anotar</button>
    </div>
    <div class="row small">
      <button class="mini" class:sel={only === "anim"} onclick={() => (only = "anim")}>desta animacao</button>
      <button class="mini" class:sel={only === "todas"} onclick={() => (only = "todas")}>todas</button>
      <span class="spacer"></span>
      {#if done}<label><input type="checkbox" bind:checked={showDone} /> resolvidas ({done})</label>{/if}
    </div>
    {#if !shown.length}<p class="dim">Nenhuma nota {showDone ? "" : "aberta "}aqui.</p>{/if}
    {#each shown as n (n.id)}
      <div class="n" class:done={n.estado === "resolvida"}>
        <div class="row">
          <b>{n.autor}</b>
          <span class="dim small">{when(n.at)}</span>
          <span class="spacer"></span>
          {#if n.anim || n.osso}
            <button class="where" onclick={() => go(n)} title="ir para este ponto">{n.anim ?? ""}{n.tempo != null ? ` @ ${t2(n.tempo)}` : ""}{n.osso ? ` · ${n.osso}` : ""}</button>
          {:else}
            <span class="dim small">geral</span>
          {/if}
        </div>
        <div class="txt">{n.texto}</div>
        {#each n.respostas as r}
          <div class="reply"><b>{r.autor}:</b> {r.texto}</div>
        {/each}
        <div class="row">
          <input class="ri" bind:value={reply[n.id]} placeholder="responder..." onkeydown={(e) => e.key === "Enter" && reply[n.id]?.trim() && act({ acao: "responder", id: n.id, autor: app.author || name || "eu", texto: reply[n.id] }).then(() => (reply[n.id] = ""))} />
          {#if n.estado === "aberta"}
            <button class="mini" onclick={() => act({ acao: "resolver", id: n.id, autor: app.author || "eu" })}>resolver</button>
          {:else}
            <button class="mini" onclick={() => act({ acao: "reabrir", id: n.id, autor: app.author || "eu" })}>reabrir</button>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    font-size: 13px;
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
  textarea,
  input {
    width: 100%;
    min-width: 0;
    background: var(--bg, #15131b);
    color: inherit;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px;
  }
  .row input[type="checkbox"] {
    width: auto;
  }
  .n {
    border: 1px solid var(--line);
    border-left: 3px solid #f2c94c;
    border-radius: 6px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .n.done {
    border-left-color: var(--line);
    opacity: 0.65;
  }
  .txt {
    white-space: pre-wrap;
    line-height: 1.35;
  }
  .reply {
    font-size: 12px;
    color: #d6d0e0;
    padding-left: 8px;
    border-left: 2px solid var(--line);
  }
  .where {
    padding: 0 6px;
    font-size: 11px;
    color: var(--accent);
  }
  .mini {
    padding: 1px 6px;
    font-size: 11px;
  }
  .mini.sel {
    border-color: var(--accent);
    color: var(--accent);
    background: transparent;
  }
  .ri {
    padding: 3px 6px;
    font-size: 12px;
  }
  .go {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
</style>
