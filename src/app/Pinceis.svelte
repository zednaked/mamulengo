<script lang="ts">
  // O seletor de pinceis da pintura: os conjuntos do ProCraft a esquerda, os pinceis do conjunto
  // com a amostra de cada um, busca por nome e os usados por ultimo. Vale para a ferramenta em uso
  // (pintar, apagar a tinta ou borrar): cada uma guarda o pincel dela.
  import { app } from "./state.svelte.ts";
  import { previaDoPincel, type Ferramenta } from "./pintura.ts";

  let { ferramenta, fechar }: { ferramenta: Ferramenta; fechar: () => void } = $props();
  const p = $derived(app.pincel);
  const atual = $derived(p.escolha[ferramenta]);
  let conjunto = $state<string | null>(null);
  let busca = $state("");
  const RECENTES = "Usados por último";

  $effect(() => {
    if (conjunto === null) conjunto = atual?.[0] ?? (p.recentes.length ? RECENTES : (p.conjuntos[0]?.nome ?? null));
  });

  const lista = $derived.by((): [string, string][] => {
    const f = busca.trim().toLowerCase();
    if (f) return p.conjuntos.flatMap((c) => c.pinceis.filter((n) => n.toLowerCase().includes(f) || c.nome.toLowerCase().includes(f)).map((n): [string, string] => [c.nome, n])).slice(0, 80);
    if (conjunto === RECENTES) return p.recentes;
    const c = p.conjuntos.find((x) => x.nome === conjunto);
    return c ? c.pinceis.map((n): [string, string] => [c.nome, n]) : [];
  });

  function escolher(e: [string, string]) {
    p.escolha[ferramenta] = e;
    p.recentes = [e, ...p.recentes.filter((r) => r[0] !== e[0] || r[1] !== e[1])].slice(0, 12);
    app.guardarPincel();
  }
  // a amostra entra quando o pincel aparece na lista
  function amostra(node: HTMLImageElement, e: [string, string]) {
    let vivo = true;
    const poe = (x: [string, string]) =>
      previaDoPincel(x[0], x[1]).then((u) => {
        if (vivo && u) node.src = u;
      });
    const olho = new IntersectionObserver((v) => {
      if (v.some((i) => i.isIntersecting)) (olho.disconnect(), void poe(e));
    });
    olho.observe(node);
    return {
      update: (x: [string, string]) => void poe(x),
      destroy: () => ((vivo = false), olho.disconnect()),
    };
  }
  function tecla(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    fechar();
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  const NOME: Record<Ferramenta, string> = { pintar: "pintar", apagar: "apagar a tinta", borrar: "borrar" };
</script>

<svelte:window onkeydowncapture={tecla} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="fundo" onclick={fechar}></div>
<div class="painel" role="dialog" aria-label="Pincéis">
  <div class="cab">
    <b>Pincel para {NOME[ferramenta]}</b>
    <!-- svelte-ignore a11y_autofocus -->
    <input placeholder="procurar em {p.conjuntos.reduce((n, c) => n + c.pinceis.length, 0)} pincéis" bind:value={busca} autofocus />
    <button onclick={fechar} aria-label="fechar">✕</button>
  </div>
  <div class="corpo">
    <nav>
      {#if p.recentes.length}<button class:on={!busca && conjunto === RECENTES} onclick={() => ((busca = ""), (conjunto = RECENTES))}>★ {RECENTES}</button>{/if}
      {#each p.conjuntos as c}
        <button class:on={!busca && conjunto === c.nome} class:tem={atual?.[0] === c.nome} onclick={() => ((busca = ""), (conjunto = c.nome))}>{c.nome} <span class="n">{c.pinceis.length}</span></button>
      {/each}
    </nav>
    <div class="lista">
      {#each lista as e (e[0] + "\n" + e[1])}
        <button class="pincel" class:on={atual?.[0] === e[0] && atual?.[1] === e[1]} onclick={() => escolher(e)} ondblclick={fechar} title="{e[1]} ({e[0]}). Dois cliques escolhem e fecham">
          <img alt="" use:amostra={e} />
          <span class="nome">{e[1]}</span>
          {#if busca || conjunto === RECENTES}<span class="de">{e[0]}</span>{/if}
        </button>
      {:else}
        <div class="vazio">{busca ? "Nenhum pincel com esse nome." : "Conjunto vazio."}</div>
      {/each}
    </div>
  </div>
  <div class="pe">{p.daBiblioteca ? "Os pincéis são os da sua biblioteca do ProCraft (só leitura: nada muda nela)." : "Pincéis que vêm com o ProCraft (não achei a sua biblioteca em ~/.local/share/procraft)."}</div>
</div>

<style>
  .fundo {
    position: fixed;
    inset: 0;
    z-index: 60;
  }
  .painel {
    position: absolute;
    left: 96px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 61;
    width: min(640px, calc(100% - 120px));
    height: min(560px, calc(100% - 150px));
    display: flex;
    flex-direction: column;
    background: #1b1822f5;
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 16px 50px #000b;
    backdrop-filter: blur(10px);
    overflow: hidden;
    font-size: 13px;
  }
  .cab {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
  }
  .cab b {
    white-space: nowrap;
  }
  .cab input {
    flex: 1;
    min-width: 0;
  }
  .corpo {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 200px 1fr;
  }
  nav {
    overflow: auto;
    padding: 6px;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  nav button {
    text-align: left;
    background: none;
    border: none;
    border-radius: 7px;
    padding: 5px 8px;
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-size: 12.5px;
  }
  nav button.tem {
    color: var(--accent);
  }
  nav button.on {
    background: var(--accent);
    color: white;
  }
  .n {
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }
  .lista {
    overflow: auto;
    padding: 8px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 6px;
    align-content: start;
  }
  .pincel {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border-radius: 10px;
    text-align: left;
    background: #ffffff08;
    border: 1px solid transparent;
  }
  .pincel.on {
    border-color: var(--accent);
    background: #ff2e8822;
  }
  .pincel img {
    width: 100%;
    height: 48px;
    object-fit: contain;
    /* a amostra vem em tinta escura sobre transparente */
    filter: invert(1) brightness(1.6);
  }
  .nome {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .de {
    color: var(--dim);
    font-size: 11px;
  }
  .vazio,
  .pe {
    color: var(--dim);
    padding: 8px 12px;
    font-size: 12px;
  }
  .pe {
    border-top: 1px solid var(--line);
  }
</style>
