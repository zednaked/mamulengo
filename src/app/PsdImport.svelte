<script lang="ts">
  // Importar PSD: escolher ou largar um .psd cria um personagem novo ou atualiza o
  // aberto, e mostra o resumo do que foi feito.
  import { app } from "./state.svelte.ts";
  import { createFromPsd, suggestDir, updateFromPsd, uploadPsd, type PsdImportResult } from "./psd.ts";

  let open = $state(false);
  let file = $state<{ name: string; path: string } | null>(null);
  let name = $state("");
  let dir = $state("");
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let result = $state<PsdImportResult | null>(null);
  let input: HTMLInputElement | undefined = $state();
  let dragging = $state(false);
  // a pasta acompanha o nome ate a pessoa mexer nela
  let dirTouched = false;

  const folders = $derived([...new Set(app.assets.map((a) => a.skeleton.slice(0, a.skeleton.lastIndexOf("/", a.skeleton.lastIndexOf("/") - 1))))].sort());

  async function choose(f: File | null | undefined) {
    if (!f) return;
    if (!/\.psd$/i.test(f.name)) {
      app.toast("Esse arquivo nao e um .psd");
      return;
    }
    open = true;
    error = null;
    result = null;
    busy = "Lendo o arquivo…";
    try {
      file = { name: f.name, path: await uploadPsd(f) };
      name = f.name.replace(/\.psd$/i, "").replace(/[^\w.-]+/g, "_");
      dir = suggestDir(name);
      dirTouched = false;
    } catch (e: any) {
      error = String(e?.message ?? e);
    } finally {
      busy = null;
    }
  }

  async function act(mode: "create" | "update") {
    if (!file) return;
    error = null;
    busy = mode === "create" ? "Montando o personagem…" : "Atualizando…";
    try {
      result = mode === "create" ? await createFromPsd({ psd: file.path, dir, name }) : await updateFromPsd({ psd: file.path });
    } catch (e: any) {
      error = String(e?.message ?? e);
    } finally {
      busy = null;
    }
  }

  function close() {
    open = false;
    file = null;
    result = null;
    error = null;
  }

  // largar um .psd em qualquer lugar da janela
  const hasPsd = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file") && ![...(e.dataTransfer?.types ?? [])].includes("text/mamulengo-image");
  function over(e: DragEvent) {
    if (!hasPsd(e)) return;
    e.preventDefault();
    dragging = true;
  }
  function drop(e: DragEvent) {
    dragging = false;
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => /\.psd$/i.test(x.name));
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    choose(f);
  }
</script>

<svelte:window ondragover={over} ondragleave={(e) => !e.relatedTarget && (dragging = false)} ondrop={drop} />

<button onclick={() => input?.click()} title="Montar ou atualizar o personagem a partir de um PSD em camadas (ou largue o .psd na janela)">📥 PSD</button>
<input bind:this={input} type="file" accept=".psd,image/vnd.adobe.photoshop" hidden onchange={(e) => (choose((e.target as HTMLInputElement).files?.[0]), ((e.target as HTMLInputElement).value = ""))} />

{#if dragging}
  <div class="drop">Solte o .psd para montar ou atualizar o personagem</div>
{/if}

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="back" onclick={() => !busy && close()}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card" onclick={(e) => e.stopPropagation()}>
      <div class="title">📥 {file?.name ?? "PSD"}</div>
      {#if busy}
        <div class="busy">{busy}</div>
      {:else if result}
        <div class="done">{result.mode === "create" ? `Personagem ${result.asset} criado e aberto.` : `${result.asset} atualizado${result.saved ? " e salvo" : ""}.`}</div>
        <ul class="summary">
          {#each result.summary as line}
            <li class:warn={line.startsWith("Atencao")}>{line}</li>
          {/each}
        </ul>
        {#if result.mode === "update"}<div class="dim small">Desfazer (Ctrl+Z) volta o esqueleto; as imagens novas continuam no atlas.</div>{/if}
        <div class="row end"><button class="ok" onclick={close}>Fechar</button></div>
      {:else if file}
        <div class="opt">
          <div class="h">Criar personagem novo</div>
          <div class="dim small">Cada camada visivel vira uma parte, na ordem e no lugar do PSD. Camadas escondidas viram imagens de troca.</div>
          <label>Nome <input bind:value={name} placeholder="nome-do-personagem" oninput={() => !dirTouched && (dir = suggestDir(name))} /></label>
          <label>Pasta (dentro do projeto do jogo) <input bind:value={dir} list="psd-folders" placeholder="/caminho/do/projeto/personagens/nome" oninput={() => (dirTouched = true)} /></label>
          <datalist id="psd-folders">
            {#each folders as f}<option value="{f}/{name}"></option>{/each}
          </datalist>
          <div class="row end"><button class="ok" disabled={!name || !dir} onclick={() => act("create")}>Criar</button></div>
        </div>
        <div class="opt">
          <div class="h">Atualizar o personagem aberto</div>
          {#if app.asset}
            <div class="dim small">Casa cada camada com a imagem de mesmo nome em <b>{app.asset.name}</b>: desenho novo entra no lugar do antigo, camada nova vira imagem nova. Animacoes e malhas continuam valendo. Salva no fim.</div>
            <div class="row end"><button class="ok" disabled={app.doc?.dirty} title={app.doc?.dirty ? "Salve ou descarte as alteracoes antes" : ""} onclick={() => act("update")}>Atualizar {app.asset.name}</button></div>
          {:else}
            <div class="dim small">Abra um personagem para atualizar.</div>
          {/if}
        </div>
      {/if}
      {#if error}<div class="err">{error}</div>{/if}
      {#if !busy && !result}<div class="row end"><button onclick={close}>Cancelar</button></div>{/if}
    </div>
  </div>
{/if}

<style>
  .drop {
    position: fixed;
    inset: 12px;
    border: 3px dashed var(--accent2);
    border-radius: 16px;
    background: #16141bcc;
    display: grid;
    place-items: center;
    font-size: 20px;
    z-index: 190;
    pointer-events: none;
  }
  .back {
    position: fixed;
    inset: 0;
    background: #0009;
    display: grid;
    place-items: center;
    z-index: 200;
  }
  .card {
    width: min(560px, 92vw);
    max-height: 86vh;
    overflow: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 20px 60px #000c;
  }
  .title {
    font-size: 17px;
    font-weight: 700;
  }
  .opt {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel2);
  }
  .h {
    font-weight: 700;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--dim);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .end {
    justify-content: flex-end;
  }
  .ok {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .small {
    font-size: 12px;
    line-height: 1.4;
  }
  .busy,
  .done {
    font-size: 15px;
  }
  .summary {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .warn {
    color: var(--accent2);
  }
  .err {
    color: var(--err);
    white-space: pre-wrap;
    font-size: 13px;
  }
</style>
