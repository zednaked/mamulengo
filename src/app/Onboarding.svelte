<script lang="ts">
  // Guia de primeira vez: cinco passos, sem jargao de Spine. Reabre pelo botao "?".
  let { open = $bindable(false) }: { open?: boolean } = $props();
  let step = $state(0);

  const STEPS = [
    { icon: "🎭", title: "Escolha um personagem", text: "No seletor lá em cima aparecem os personagens das pastas do projeto. Para começar do zero, ＋ Novo em branco, ali mesmo: abre uma tela limpa para desenhar. Já tem arte? Arraste um PSD em camadas para a janela: cada camada vira uma parte. Nada é gravado até você salvar." },
    { icon: "👆", title: "Clique numa parte", text: "Clique na cabeça, no braço, no corpo. A parte fica marcada no desenho e no Esqueleto, à esquerda, e o painel da direita mostra o que dá para fazer com ela." },
    { icon: "🦴", title: "Pose base ou animação", text: "Embaixo, Pose base é o boneco parado: mexer ali muda todas as animações (é onde se monta o esqueleto). Escolha uma animação, ou + nova, para animar: cada coisa que você mexe vira uma chave no instante da régua." },
    { icon: "✨", title: "Faça ele se mexer", text: "Arraste a parte com Girar (2) ou Mover (1): puxar uma junta, como a mão, dobra o braço inteiro (Alt solta). Ou aperte um movimento pronto: Respirar, Balançar, Quicar. Espaço toca e pausa, as setas andam um quadro, Ctrl+Z desfaz. O pincel 🖌 deforma a imagem como massinha." },
    { icon: "💾", title: "Salve e exporte", text: "Salvar (Ctrl+S) grava no projeto, com cópia de segurança. Exportar, embaixo à direita, gera GIF, WebP ou vídeo. O botão 📖 Guia (F1) explica cada ferramenta passo a passo, e ? mostra todos os atalhos." },
  ];
  function close() {
    open = false;
    try {
      localStorage.setItem("mamulengo.onboarded", "1");
    } catch {}
  }

  // teclado: setas andam, Enter segue, Esc fecha
  function tecla(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" || e.key === "Enter") step < STEPS.length - 1 ? step++ : close();
    else if (e.key === "ArrowLeft") step = Math.max(0, step - 1);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // primeira vez: abre sozinho
  $effect(() => {
    try {
      if (!localStorage.getItem("mamulengo.onboarded")) open = true;
    } catch {}
  });
</script>

<svelte:window onkeydown={tecla} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="back" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card" onclick={(e) => e.stopPropagation()}>
      <div class="hello">Boas-vindas ao <b>Mamulengo</b></div>
      <div class="step">
        <div class="icon">{STEPS[step].icon}</div>
        <div>
          <div class="title">{step + 1}. {STEPS[step].title}</div>
          <div class="text">{STEPS[step].text}</div>
        </div>
      </div>
      <div class="dots">
        {#each STEPS as _, i}<button class="dot" class:on={i === step} onclick={() => (step = i)} aria-label="passo {i + 1}"></button>{/each}
      </div>
      <div class="nav">
        <button onclick={close}>pular</button>
        {#if step < STEPS.length - 1}
          <button class="go" onclick={() => step++}>próximo</button>
        {:else}
          <button class="go" onclick={close}>começar</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .back {
    position: fixed;
    inset: 0;
    background: #0009;
    display: grid;
    place-items: center;
    z-index: 200;
  }
  .card {
    width: min(520px, 92vw);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 20px 60px #000c;
  }
  .hello {
    font-size: 15px;
    color: var(--dim);
  }
  .hello b {
    color: var(--accent);
  }
  .step {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    min-height: 110px;
  }
  .icon {
    font-size: 44px;
    line-height: 1;
  }
  .title {
    font-size: 19px;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .text {
    font-size: 15px;
    line-height: 1.45;
    color: #d6d0e0;
  }
  .dots {
    display: flex;
    gap: 6px;
    justify-content: center;
  }
  .dot {
    width: 10px;
    height: 10px;
    padding: 0;
    border-radius: 50%;
    background: var(--line);
    border: none;
  }
  .dot.on {
    background: var(--accent);
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
