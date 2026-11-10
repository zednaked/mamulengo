<script lang="ts">
  // Importar PSD: escolher ou largar um .psd cria um personagem novo ou atualiza o
  // aberto, e mostra o resumo do que foi feito.
  import { app } from "./state.svelte.ts";
  import { createFromPsd, proposeScreen, suggestDir, updateFromPsd, uploadPsd, type PropostaResult, type PsdImportResult } from "./psd.ts";
  import { ANCORAS, NOME_DO_ESTADO } from "../core/psd-tela.ts";

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
  // tela (docs/LAYOUT-PSD.md): a proposta de cada camada, que a pessoa desmarca ou troca antes de criar
  let tela = $state(false);
  let proposta = $state<PropostaResult | null>(null);
  let ligado = $state<Record<string, boolean>>({});
  let troca = $state<Record<string, { ancora?: string; esticar?: string }>>({});
  const TIPO: Record<string, string> = { ancora: "âncora", botao: "botão", toque: "toque", texto: "texto", fatias: "nove-fatias" };
  async function propor() {
    if (!file) return;
    proposta = await proposeScreen({ psd: file.path });
    ligado = Object.fromEntries(proposta.proposta.itens.map((i) => [i.id, i.ligado]));
    troca = {};
  }
  function escolhas() {
    const itens = proposta?.proposta.itens ?? [];
    const off = itens.filter((i) => i.ligado && !ligado[i.id]).map((i) => i.id);
    const on = itens.filter((i) => !i.ligado && ligado[i.id]).map((i) => i.id);
    const change: Record<string, any> = {};
    for (const [id, t] of Object.entries(troca)) if (t.ancora || t.esticar) change[id] = { ...(t.ancora ? { ancora: t.ancora } : {}), ...(t.esticar ? { esticar: t.esticar } : {}) };
    return { off, on, change };
  }

  const folders = $derived([...new Set(app.assets.map((a) => a.skeleton.slice(0, a.skeleton.lastIndexOf("/", a.skeleton.lastIndexOf("/") - 1))))].sort());

  async function choose(f: File | null | undefined) {
    if (!f) return;
    if (!/\.psd$/i.test(f.name)) {
      app.toast("Esse arquivo não é um .psd");
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
      busy = "Lendo as camadas…";
      // a proposta de tela: marcada sozinha quando o nome ou as camadas dizem que e uma tela
      await propor().catch(() => (proposta = null));
      tela = !!proposta?.proposta.pareceTela;
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
      result = mode === "create" ? await createFromPsd({ psd: file.path, dir, name, ...(tela && proposta ? { tela: escolhas() } : {}) }) : await updateFromPsd({ psd: file.path });
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
    proposta = null;
    tela = false;
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
          <div class="dim small">Cada camada visível vira uma parte, na ordem e no lugar do PSD. Camadas escondidas viram imagens de troca.</div>
          <label>Nome <input bind:value={name} placeholder="nome-do-personagem" oninput={() => !dirTouched && (dir = suggestDir(name))} /></label>
          <label title="Dentro de um projeto Godot o personagem sai no formato do spine-godot (-data.tres); fora dele, como .boneco, o formato do Mamulengo">Pasta <input bind:value={dir} list="psd-folders" placeholder="/caminho/do/projeto/personagens/nome" oninput={() => (dirTouched = true)} /></label>
          <datalist id="psd-folders">
            {#each folders as f}<option value="{f}/{name}"></option>{/each}
          </datalist>
          {#if proposta}
            <label class="check" title="Tela de jogo (.boneco): âncoras pela posição, papéis pelos nomes (btn_, toque_, txt_), camadas de texto como texto e nove-fatias (9_). docs/LAYOUT-PSD.md"><input type="checkbox" bind:checked={tela} /> Criar como tela de jogo{proposta.proposta.pareceTela ? " (parece uma tela)" : ""}</label>
          {/if}
          {#if tela && proposta}
            <div class="dim small">Arte base {proposta.proposta.arte.rect[2]} × {proposta.proposta.arte.rect[3]} px, caber: {proposta.proposta.arte.porque}.{proposta.mapaArquivo ? ` Mapa: ${proposta.mapaArquivo}.` : ""}</div>
            <ul class="prop">
              {#each proposta.proposta.itens as it (it.id)}
                <li class:off={!ligado[it.id]}>
                  <label class="item" title={it.porque}><input type="checkbox" bind:checked={ligado[it.id]} /> <b>{TIPO[it.tipo]}</b> {it.tipo === "ancora" ? it.osso : it.tipo === "texto" ? it.slot : it.tipo === "fatias" ? it.slot : it.nome}</label>
                  {#if it.tipo === "ancora"}
                    <select value={troca[it.id]?.ancora ?? it.ancora} onchange={(e) => (troca[it.id] = { ...troca[it.id], ancora: (e.target as HTMLSelectElement).value })}>
                      {#each ANCORAS as a}<option value={a}>{a}</option>{/each}
                    </select>
                    <select value={troca[it.id]?.esticar ?? it.esticar} onchange={(e) => (troca[it.id] = { ...troca[it.id], esticar: (e.target as HTMLSelectElement).value })}>
                      {#each ["none", "x", "y", "xy"] as a}<option value={a}>{a === "none" ? "sem esticar" : `estica ${a}`}</option>{/each}
                    </select>
                  {:else if it.tipo === "texto"}
                    <span class="dim">{it.chave ? `chave ${it.chave}` : `do código: ${it.doCodigo ?? "livre"}`}{it.fonte && !it.arquivoFonte ? " · fonte falta" : ""}</span>
                  {:else if it.tipo === "fatias"}
                    <span class="dim">[{it.margens.join(", ")}]</span>
                  {:else if it.tipo === "botao"}
                    <span class="dim">{it.slot ? Object.keys(it.estados).map((e) => NOME_DO_ESTADO[e as keyof typeof NOME_DO_ESTADO]).join(", ") : "estados padrão"}</span>
                  {/if}
                  <div class="why">{it.camada}: {it.porque}</div>
                </li>
              {/each}
            </ul>
            {#each proposta.proposta.avisos as a}<div class="warn small">⚠ {a}</div>{/each}
          {/if}
          <div class="row end"><button class="ok" disabled={!name || !dir} onclick={() => act("create")}>{tela ? "Criar tela" : "Criar"}</button></div>
        </div>
        <div class="opt">
          <div class="h">Atualizar o personagem aberto</div>
          {#if app.asset}
            <div class="dim small">Casa cada camada com a imagem de mesmo nome em <b>{app.asset.name}</b>: desenho novo entra no lugar do antigo, camada nova vira imagem nova. Animações e malhas continuam valendo. Salva no fim.</div>
            <div class="row end"><button class="ok" disabled={app.doc?.dirty} title={app.doc?.dirty ? "Salve ou descarte as alterações antes" : ""} onclick={() => act("update")}>Atualizar {app.asset.name}</button></div>
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
  .check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--text, inherit);
    font-size: 13px;
  }
  .prop {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 40vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .prop li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    background: var(--panel);
  }
  .prop li.off {
    opacity: 0.5;
  }
  .prop .item {
    flex-direction: row;
    align-items: center;
    gap: 4px;
    color: inherit;
  }
  .prop select {
    font-size: 11px;
  }
  .why {
    width: 100%;
    color: var(--dim);
    font-size: 11px;
  }
  .err {
    color: var(--err);
    white-space: pre-wrap;
    font-size: 13px;
  }
</style>
