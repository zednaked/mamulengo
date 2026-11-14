<script lang="ts">
  // Os atalhos do teclado num lugar so (botao "?" ou a tecla ?), com o caminho de volta ao guia
  let { open = $bindable(false), guia }: { open?: boolean; guia: () => void } = $props();

  const GRUPOS: [string, [string, string][]][] = [
    ["Tocar e andar", [["Espaço", "tocar ou pausar"], ["← →", "quadro anterior ou próximo (com o mouse fora do desenho)"], ["Shift + ← →", "chave anterior ou próxima"], ["Home / End", "início ou fim"]]],
    ["Ferramentas", [["1", "mover (numa junta, dobra o membro)"], ["Alt + arrastar", "mover a junta solta"], ["Ctrl + arrastar", "mexer só na imagem, dentro do osso (Pose base)"], ["setas sobre o desenho", "a ferramenta em passos: 1 px, 1°, 1% (Shift: 10)"], ["2", "girar"], ["3", "esticar"], ["4", "deformar (pincel)"], ["[ ]", "tamanho do pincel"], ["5", "criar osso"], ["6 ou H", "câmera (ou segurar Espaço, ou botão do meio)"], ["F", "enquadrar"]]],
    ["Editar", [["Ctrl + Z", "desfazer"], ["Ctrl + Shift + Z", "refazer"], ["Ctrl + S", "salvar"], ["Del", "apagar as chaves selecionadas"], ["Ctrl + C / X / V", "copiar, recortar e colar chaves"], ["Ctrl + A", "selecionar todas as chaves"], ["Page Up / Down", "peça para frente ou para trás"], ["Esc", "tirar a seleção"]]],
    ["Painéis", [["Ctrl + [", "painel da esquerda"], ["Ctrl + ]", "painel da direita"], ["Ctrl + \\", "timeline"], ["Ctrl + roda", "zoom da timeline"]]],
  ];

  function tecla(e: KeyboardEvent) {
    if (!open || e.key !== "Escape") return;
    open = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
</script>

<svelte:window onkeydown={tecla} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="back" onclick={() => (open = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card" role="dialog" tabindex="-1" aria-label="Atalhos do teclado" onclick={(e) => e.stopPropagation()}>
      <div class="topo">
        <b>Atalhos do teclado</b>
        <button onclick={() => ((open = false), guia())}>📖 guia das ferramentas</button>
        <button class="x" onclick={() => (open = false)} aria-label="fechar">✕</button>
      </div>
      <div class="grupos">
        {#each GRUPOS as [titulo, itens]}
          <div class="grupo">
            <div class="titulo">{titulo}</div>
            {#each itens as [k, o]}
              <div class="linha"><kbd>{k}</kbd><span>{o}</span></div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .back {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #0008;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px 20px;
    width: min(760px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
    box-shadow: 0 10px 40px #000a;
  }
  .topo {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
  }
  .topo b {
    flex: 1;
    font-size: 15px;
  }
  .grupos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px 24px;
  }
  .titulo {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent2);
    margin-bottom: 4px;
  }
  .linha {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 13px;
    padding: 2px 0;
  }
  kbd {
    flex: 0 0 120px;
    font: inherit;
    font-size: 12px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 1px 6px;
    text-align: center;
  }
  .linha span {
    color: var(--dim);
  }
</style>
