<script lang="ts">
  // Personagem em branco: nome e pasta; cria o .boneco (so o osso raiz), abre e, se pedido, entra
  // no Atelie para desenhar
  import { tick } from "svelte";
  import { app } from "./state.svelte.ts";
  import { nomeDeBoneco } from "../boneco/spine.ts";
  import { abrirAtelie } from "./atelie.ts";
  import { visto } from "./guia.ts";

  let nome = $state("");
  let raiz = $state("");
  let noAtelie = $state(true);
  let criando = $state(false);
  let armado = 0;
  const limpo = $derived(nomeDeBoneco(nome));
  const base = $derived(raiz || app.roots[0] || "");
  const destino = $derived(limpo && base ? `${base}/${limpo}/${limpo}.boneco` : "");
  const existe = $derived(!!destino && app.assets.some((a) => a.tres === destino));

  $effect(() => {
    if (app.novoAberto) {
      nome = "";
      armado = 0;
      if (!app.roots.includes(raiz)) raiz = app.roots[0] ?? "";
    }
  });

  const fechar = () => (app.novoAberto = false);
  async function criar() {
    if (!limpo || existe || criando) return;
    // sem dialogo do navegador: um segundo clique confirma perder o que nao foi salvo
    if (app.doc?.dirty && Date.now() - armado > 4000) {
      armado = Date.now();
      return app.toast("Há alterações não salvas no personagem aberto. Salve (Ctrl+S), ou clique em Criar de novo para deixá-las.");
    }
    criando = true;
    try {
      if (app.atelie) abrirAtelie();
      const a = await app.novoBoneco(limpo, `${base}/${limpo}`);
      if (!a) return;
      fechar();
      if (!noAtelie) return;
      // o viewer monta o personagem depois do open
      for (let i = 0; i < 40 && !(app.viewer && app.doc); i++) await new Promise((r) => setTimeout(r, 50));
      await tick();
      if (!app.atelie) abrirAtelie();
      if (!visto("lapis")) app.guia = "lapis";
    } finally {
      criando = false;
    }
  }
  function tecla(e: KeyboardEvent) {
    if (!app.novoAberto) return;
    if (e.key === "Escape") fechar();
    else if (e.key === "Enter") criar();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
</script>

<svelte:window onkeydowncapture={tecla} />

{#if app.novoAberto}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="back" onclick={fechar}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card" role="dialog" tabindex="-1" aria-label="Personagem novo" onclick={(e) => e.stopPropagation()}>
      <b>Personagem novo, em branco</b>
      <label>
        <span>Nome</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={nome} placeholder="gato, explosao, logo…" autofocus />
      </label>
      {#if app.roots.length > 1}
        <label>
          <span>Onde</span>
          <select bind:value={raiz}>
            {#each app.roots as r}<option value={r}>{r}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="linha"><input type="checkbox" bind:checked={noAtelie} /> abrir no Ateliê, para desenhar já</label>
      <div class="dim onde">
        {#if existe}Já existe um personagem com esse nome aí. Escolha outro nome.
        {:else if destino}Vai criar <code>{destino}</code>
        {:else if !base}Nenhuma pasta aberta para guardar o personagem.
        {:else}Começa só com o osso raiz, no centro da tela.{/if}
      </div>
      <div class="nav">
        <button onclick={fechar}>cancelar</button>
        <button class="go" disabled={!limpo || !base || existe || criando} onclick={criar}>{criando ? "criando…" : "Criar"}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .back {
    position: fixed;
    inset: 0;
    z-index: 205;
    background: #0009;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .card {
    width: min(460px, 100%);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 20px 60px #000c;
  }
  b {
    font-size: 17px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  label span {
    color: var(--dim);
  }
  label.linha {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  input:not([type]),
  select {
    font-size: 15px;
    padding: 7px 9px;
  }
  .onde {
    font-size: 12px;
    min-height: 32px;
    word-break: break-all;
  }
  .nav {
    display: flex;
    justify-content: space-between;
  }
  .go {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    font-weight: 600;
    padding: 8px 18px;
  }
</style>
