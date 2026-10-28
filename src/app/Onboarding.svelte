<script lang="ts">
  // Guia de primeira vez: quatro passos, sem jargao de Spine. Reabre pelo botao "?".
  let { open = $bindable(false) }: { open?: boolean } = $props();
  let step = $state(0);

  const STEPS = [
    { icon: "🎭", title: "Escolha um personagem", text: "Use o seletor la em cima. Aparecem todos os personagens dos seus jogos. Nada e alterado no jogo ate voce salvar." },
    { icon: "👆", title: "Clique numa parte", text: "Clique na cabeca, no braco, no corpo. A parte fica marcada e aparecem os movimentos prontos para ela." },
    { icon: "✨", title: "Faca ele se mexer", text: "Escolha uma animacao na linha do tempo e aperte Respirar, Balancar, Quicar... ou arraste a parte: cada movimento vira uma chave. Na aba Pose base, mexer muda o boneco em todas as animacoes. O pincel 🖌 deforma a imagem como massinha." },
    { icon: "🎮", title: "Salve e veja no jogo", text: "Salvar grava no projeto do jogo (com copia de seguranca). 'ver no Godot' mostra o quadro renderizado pelo proprio Godot, para conferir que fica igual." },
  ];

  function close() {
    open = false;
    try {
      localStorage.setItem("mamulengo.onboarded", "1");
    } catch {}
  }

  // primeira vez: abre sozinho
  $effect(() => {
    try {
      if (!localStorage.getItem("mamulengo.onboarded")) open = true;
    } catch {}
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="back" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card" onclick={(e) => e.stopPropagation()}>
      <div class="hello">Bem-vindo ao <b>Mamulengo</b></div>
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
          <button class="go" onclick={() => step++}>proximo</button>
        {:else}
          <button class="go" onclick={close}>comecar</button>
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
