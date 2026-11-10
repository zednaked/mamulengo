<script lang="ts">
  // O seletor de janela do viewport (docs/EDITOR.md "Tela"): a tela do jogo num celular, tablet ou
  // desktop, com a moldura desenhada; os ossos ancorados vao para o lugar (o nucleo calcula). Teclas:
  // Alt+0 a arte, Alt+1 a Alt+5 os presets, Alt+L lado a lado.
  import { app } from "./state.svelte.ts";
  import { JANELAS, janelaDe } from "./janelas.ts";
  import { NOMES_IDIOMA } from "../core/texto.ts";

  // o idioma dos textos (docs/NUCLEO.md "Texto"): troca tudo na hora; o aviso conta os textos que
  // estouram a caixa no idioma mostrado (e em todos, no titulo)
  const idiomas = $derived.by(() => {
    app.version;
    return ((app.doc?.json as any)?.translations?.languages ?? []) as string[];
  });
  const temTextos = $derived.by(() => {
    app.version;
    return !!(app.doc?.json as any)?.skins?.some((s: any) => Object.values(s.attachments ?? {}).some((ps: any) => Object.values(ps).some((a: any) => a?.type === "text")));
  });
  const estouros = $derived.by(() => {
    app.version;
    app.versaoTextos;
    app.idioma;
    try {
      return app.viewer?.nucleo?.textos?.estouros() ?? [];
    } catch {
      return [];
    }
  });
  const aqui = $derived(estouros.filter((e) => e.idioma === (app.idioma || idiomas[0])));
  $effect(() => {
    app.version;
    app.viewer?.nucleo?.usarIdioma(app.idioma || idiomas[0] || "pt");
  });
  function trocarIdioma(d: number) {
    if (!idiomas.length) return;
    const i = idiomas.indexOf(app.idioma || idiomas[0]);
    app.usarIdioma(idiomas[(i + d + idiomas.length) % idiomas.length]);
  }

  let livre = $state({ w: 1280, h: 800 });
  let abertoLivre = $state(false);

  function usar(p: string | number[] | null) {
    const v = app.viewer;
    if (!v || !app.doc) return;
    try {
      if (p !== null && app.runtime !== "nucleo") void app.setRuntime("nucleo");
      app.usarJanela(janelaDe(app.doc.json, p));
      const r = v.vistaJanela();
      if (r && r[2] > 0) v.frameRect(r, 1.2);
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    }
  }

  function tecla(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.target instanceof HTMLInputElement) return;
    if (e.code === "Digit0") usar("arte");
    else if (/^Digit[1-5]$/.test(e.code)) usar(JANELAS[Number(e.code.slice(5)) - 1].nome);
    else if (e.code === "KeyL") app.ladoALado = !app.ladoALado;
    else if (e.code === "BracketRight") trocarIdioma(1);
    else if (e.code === "BracketLeft") trocarIdioma(-1);
    else if (e.code === "Backquote") usar(null);
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={tecla} />

<div class="janelas" title="A tela vista numa janela de outro tamanho: os ossos ancorados (inspetor do osso, Âncora na tela) vão para o lugar. Alt+0 a 5 troca, Alt+L lado a lado, Alt+` tira">
  <span class="rot">janela</span>
  <button class:on={!app.janela} onclick={() => usar(null)} title="sem janela (Alt+`)">—</button>
  <button class:on={app.janela?.nome === "arte"} onclick={() => usar("arte")} title="o tamanho da arte base (Alt+0)">arte</button>
  {#each JANELAS as j, i}
    <button class:on={app.janela?.nome === j.nome} onclick={() => usar(j.nome)} title="{j.rotulo}: {j.w}×{j.h} (Alt+{i + 1})">{j.nome}</button>
  {/each}
  <button class:on={app.janela?.nome === "livre" || abertoLivre} onclick={() => (abertoLivre = !abertoLivre)} title="um tamanho qualquer">livre</button>
  {#if abertoLivre}
    <input type="number" min="100" bind:value={livre.w} title="largura em pixels" />×<input type="number" min="100" bind:value={livre.h} title="altura em pixels" />
    <button onclick={() => usar([livre.w, livre.h])}>ok</button>
  {/if}
  <span class="sep"></span>
  <button class:on={app.ladoALado} onclick={() => (app.ladoALado = !app.ladoALado)} title="todos os tamanhos lado a lado (Alt+L); clique num para usá-lo">lado a lado</button>
  {#if app.janela}<span class="dim">{app.janela.w}×{app.janela.h}</span>{/if}
  {#if idiomas.length || temTextos}
    <span class="sep"></span>
    <span class="rot">idioma</span>
    <select value={app.idioma || idiomas[0] || ""} onchange={(e) => app.usarIdioma((e.target as HTMLSelectElement).value)} title="o idioma dos textos no viewport (Alt+[ e Alt+] trocam)">
      {#if !idiomas.length}<option value="">sem tabela</option>{/if}
      {#each idiomas as l}<option value={l}>{l} · {NOMES_IDIOMA[l] ?? l}{estouros.some((e) => e.idioma === l) ? " ⚠" : ""}</option>{/each}
    </select>
    <button class:on={app.tabelaIdiomas} onclick={() => (app.tabelaIdiomas = !app.tabelaIdiomas)} title="a tabela de idiomas: chaves, traduções, importar e exportar o translations.csv">tabela</button>
    {#if estouros.length}
      <span class="aviso" title={estouros.map((e) => `${e.nome} em ${e.idioma}: "${e.texto}"`).join("\n")}>⚠ {aqui.length ? `${aqui.length} estoura${aqui.length > 1 ? "m" : ""}` : `${new Set(estouros.map((e) => e.idioma)).size} idioma(s)`}</span>
    {/if}
  {/if}
</div>

<style>
  .janelas {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 3px;
    background: #15151dd9;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 3px 5px;
    font-size: 11px;
  }
  .rot {
    color: #9aa;
    margin-right: 2px;
  }
  button {
    padding: 1px 6px;
    font-size: 11px;
  }
  button.on {
    background: #2b6cb0;
    color: #fff;
  }
  input {
    width: 52px;
    font-size: 11px;
  }
  .sep {
    width: 6px;
  }
  .dim {
    color: #889;
    margin-left: 3px;
  }
  select {
    font-size: 11px;
  }
  .aviso {
    color: #f0b040;
    margin-left: 3px;
  }
</style>
