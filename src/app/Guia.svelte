<script lang="ts">
  // O guia das ferramentas: assuntos a esquerda, passos a direita (os textos em src/app/guia.ts)
  import { app } from "./state.svelte.ts";
  import { ASSUNTOS, marcarVisto } from "./guia.ts";
  import { abrirAtelie } from "./atelie.ts";
  import { abrirDesenhar } from "./drawedit.ts";

  let { atalhos }: { atalhos: () => void } = $props();
  const assunto = $derived(ASSUNTOS.find((x) => x.id === app.guia) ?? ASSUNTOS[0]);
  const i = $derived(ASSUNTOS.indexOf(assunto));

  $effect(() => {
    if (app.guia) marcarVisto(assunto.id);
  });

  const fechar = () => (app.guia = null);
  function ir() {
    const acao = assunto.ir?.acao;
    fechar();
    if (acao === "novo") app.novoAberto = true;
    else if (!app.doc) app.toast("Abra ou crie um personagem primeiro (＋ Novo em branco, no seletor lá em cima).");
    else if (acao === "atelie") !app.atelie && abrirAtelie();
    else if (acao === "desenhar") {
      if (app.atelie) abrirAtelie();
      abrirDesenhar();
    }
  }
  function tecla(e: KeyboardEvent) {
    if (!app.guia) return;
    if (e.key === "Escape") fechar();
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") app.guia = ASSUNTOS[Math.min(ASSUNTOS.length - 1, i + 1)].id;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") app.guia = ASSUNTOS[Math.max(0, i - 1)].id;
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
</script>

<svelte:window onkeydowncapture={tecla} />

{#if app.guia}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="back" onclick={fechar}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card" role="dialog" tabindex="-1" aria-label="Guia das ferramentas" onclick={(e) => e.stopPropagation()}>
      <nav>
        <div class="cab">Guia das ferramentas</div>
        {#each ASSUNTOS as x}
          <button class:on={x.id === assunto.id} onclick={() => (app.guia = x.id)}><span class="ic">{x.icone}</span>{x.titulo}</button>
        {/each}
        <div class="pe">
          <button class="leve" onclick={() => (fechar(), atalhos())}>todos os atalhos</button>
        </div>
      </nav>
      <section>
        <button class="x" onclick={fechar} aria-label="fechar">✕</button>
        <h2><span class="ic">{assunto.icone}</span>{assunto.titulo}</h2>
        <p class="serve">{assunto.serve}</p>
        <ol>
          {#each assunto.passos as p}<li>{p}</li>{/each}
        </ol>
        {#if assunto.teclas}
          <div class="teclas">
            {#each assunto.teclas as [k, o]}<span class="t"><kbd>{k}</kbd>{o}</span>{/each}
          </div>
        {/if}
        {#if assunto.falta}<p class="falta">{assunto.falta}</p>{/if}
        <div class="nav">
          {#if assunto.ir}<button class="go" onclick={ir}>{assunto.ir.rotulo}</button>{/if}
          <span class="esp"></span>
          <button disabled={i === 0} onclick={() => (app.guia = ASSUNTOS[i - 1].id)}>‹ anterior</button>
          <button disabled={i === ASSUNTOS.length - 1} onclick={() => (app.guia = ASSUNTOS[i + 1].id)}>próximo ›</button>
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .back {
    position: fixed;
    inset: 0;
    z-index: 210;
    background: #0009;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .card {
    display: grid;
    grid-template-columns: 230px 1fr;
    width: min(900px, 100%);
    height: min(620px, calc(100vh - 32px));
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 20px 60px #000c;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 8px;
    background: var(--bg);
    border-right: 1px solid var(--line);
    overflow: auto;
  }
  .cab {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent2);
    padding: 0 8px 8px;
  }
  nav button {
    display: flex;
    gap: 8px;
    align-items: center;
    text-align: left;
    background: none;
    border: none;
    border-radius: 8px;
    padding: 7px 8px;
    font-size: 13px;
  }
  nav button.on {
    background: var(--accent);
    color: white;
  }
  .ic {
    width: 22px;
    text-align: center;
    flex: none;
  }
  .pe {
    margin-top: auto;
    padding-top: 8px;
  }
  .leve {
    color: var(--dim);
    font-size: 12px;
  }
  section {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 22px 26px 18px;
    overflow: auto;
  }
  .x {
    position: absolute;
    top: 12px;
    right: 12px;
    background: none;
    border: none;
    color: var(--dim);
  }
  h2 {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 0 0 6px;
    font-size: 21px;
  }
  h2 .ic {
    font-size: 26px;
    width: auto;
  }
  .serve {
    margin: 0 0 12px;
    color: var(--dim);
    font-size: 14px;
    line-height: 1.45;
  }
  ol {
    margin: 0;
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    font-size: 14.5px;
    line-height: 1.45;
    color: #d6d0e0;
  }
  li::marker {
    color: var(--accent);
    font-weight: 700;
  }
  .teclas {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-top: 14px;
    font-size: 12.5px;
    color: var(--dim);
  }
  .t {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
  }
  kbd {
    font: inherit;
    font-size: 12px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .falta {
    margin: 14px 0 0;
    padding: 8px 10px;
    border-left: 3px solid var(--accent2);
    background: #ffffff0a;
    border-radius: 0 8px 8px 0;
    font-size: 13px;
    color: var(--dim);
  }
  .nav {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: auto;
    padding-top: 16px;
  }
  .esp {
    flex: 1;
  }
  .go {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    font-weight: 600;
    padding: 8px 16px;
  }
  @media (max-width: 640px) {
    .card {
      grid-template-columns: 1fr;
      height: calc(100vh - 32px);
    }
    nav {
      flex-direction: row;
      flex-wrap: wrap;
      border-right: none;
      border-bottom: 1px solid var(--line);
    }
    .cab,
    .pe {
      display: none;
    }
  }
</style>
