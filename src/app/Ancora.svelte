<script lang="ts">
  // Âncora na tela (docs/EDITOR.md "Tela"): o osso preso a um dos 9 pontos da janela, esticando
  // ou não, e o deslocamento até o ponto na arte base. Sem tela ainda, propõe a arte base. A conta
  // é do núcleo (docs/NUCLEO.md "Tela"); aqui só os comandos screen.set e anchor.set.
  import { app } from "./state.svelte.ts";
  import { execute } from "../core/commands/index.ts";
  import { ANCHORS, FITS } from "../core/commands/screen.ts";

  let { osso }: { osso: string } = $props();

  const NOMES_FIT: Record<string, string> = { contain: "caber", cover: "cobrir", width: "largura fixa", height: "altura fixa" };
  const PONTOS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
  const SETA: Record<string, string> = { "top-left": "↖", top: "↑", "top-right": "↗", left: "←", center: "•", right: "→", "bottom-left": "↙", bottom: "↓", "bottom-right": "↘" };

  const tela = $derived.by(() => {
    app.version;
    if (!app.doc) return null;
    try {
      return execute(app.doc, { cmd: "query.screen", args: {} }, "ui")[0] as any;
    } catch {
      return null;
    }
  });
  const minha = $derived(tela?.anchors?.find((a: any) => a.bone === osso) ?? null);
  let tam = $state({ w: 700, h: 1370 });

  const run = (args: any, rotulo: string, merge?: string) => app.run({ cmd: "anchor.set", args: { bone: osso, ...args } }, rotulo, merge);
  function ponto(p: string) {
    if (minha?.name === p) run({ off: true }, `${osso} solto da tela`);
    else run({ anchor: p }, `${osso} preso em ${p}`);
  }
  function esticar(eixo: "x" | "y") {
    const st: string = minha?.stretch === "none" ? "" : (minha?.stretch ?? "");
    const tem = st.includes(eixo);
    const novo = ["x", "y"].filter((e) => (e === eixo ? !tem : st.includes(e))).join("");
    run({ stretch: novo || "none" }, `${osso} estica ${novo || "nada"}`);
  }
  function cobrir() {
    if (minha?.cover) run({ cover: false }, `${osso} não cobre`);
    else run({ cover: true }, `${osso} cobre a janela`);
  }
  function desloca(k: 0 | 1, v: number) {
    if (!minha || !Number.isFinite(v)) return;
    const off = [minha.offset[0] ?? 0, minha.offset[1] ?? 0];
    off[k] = v;
    run({ offset: off }, `${osso} a ${off[0]}, ${off[1]} da âncora`, `ancora-off-${osso}`);
  }
  function criarTela() {
    const sk: any = app.doc?.json.skeleton ?? {};
    const args = sk.width > 0 && sk.height > 0 ? { art: [sk.x ?? 0, sk.y ?? 0, sk.width, sk.height] } : { size: [tam.w, tam.h] };
    if (app.run({ cmd: "screen.set", args }, "tela: arte base")) app.avisar("A tela tem arte base. Escolha um ponto da janela para este osso e troque o tamanho da janela no alto do viewport.");
  }
</script>

<div class="efeitos ancora">
  <div class="dim small secao" title="Prende o osso (e o que pende dele) a um ponto da janela: numa janela de outro tamanho ou proporção ele mantém a distância até esse ponto. Os ossos sem âncora acompanham o pai.">Âncora na tela</div>
  {#if !tela}
    <div class="linha">
      <span class="dim small">arte base</span>
      {#if !(app.doc?.json.skeleton as any)?.width}
        <input type="number" min="1" bind:value={tam.w} title="largura da arte base" />×<input type="number" min="1" bind:value={tam.h} title="altura da arte base" />
      {/if}
      <button onclick={criarTela} title="O tamanho de referência em que a tela foi desenhada (o PSD): a partir dele as janelas de outros tamanhos se ajustam">+ tela</button>
    </div>
  {:else}
    <div class="linha">
      <span class="dim small" title="a arte base: [x, y, largura, altura] no mundo">arte {tela.art[2]}×{tela.art[3]}</span>
      <select value={tela.fit} onchange={(e) => app.run({ cmd: "screen.set", args: { fit: (e.target as HTMLSelectElement).value } }, "tela: encaixe")} title="como a arte encaixa numa janela de outra proporção: caber (sobra janela), cobrir (corta), largura ou altura fixa">
        {#each FITS as f}<option value={f}>{NOMES_FIT[f]}</option>{/each}
      </select>
    </div>
    <div class="linha">
      <div class="grade" title="o ponto da janela (clique de novo para soltar)">
        {#each PONTOS as p}
          <button class:on={minha?.name === p} onclick={() => ponto(p)} title={p}>{SETA[p]}</button>
        {/each}
      </div>
      <div class="col">
        <button class:on={minha?.stretch?.includes("x")} disabled={!minha} onclick={() => esticar("x")} title="esticar na largura da janela (uma barra de ponta a ponta)">↔ esticar</button>
        <button class:on={minha?.stretch?.includes("y")} disabled={!minha} onclick={() => esticar("y")} title="esticar na altura da janela">↕ esticar</button>
        <button class:on={!!minha?.cover} disabled={!minha} onclick={cobrir} title="cobrir sem deformar: o grupo cresce por igual, em volta do ponto do osso, até a caixa das partes dele cobrir a janela (o fundo maior que a tela); não estica">⤢ cobrir</button>
      </div>
    </div>
    {#if minha}
      <div class="linha" title="a distância do ponto da âncora até o osso, na arte base (px; x para a direita, y para baixo). Mudar move o osso">
        <span class="dim small">desloc.</span>
        <input type="number" step="1" disabled={minha.offset[0] === null} value={minha.offset[0] ?? ""} onchange={(e) => desloca(0, +(e.target as HTMLInputElement).value)} title="x (vazio: estica em x)" />
        <input type="number" step="1" disabled={minha.offset[1] === null} value={minha.offset[1] ?? ""} onchange={(e) => desloca(1, +(e.target as HTMLInputElement).value)} title="y (vazio: estica em y)" />
      </div>
      {#if !minha.name}<div class="dim small">ponto [{minha.anchor.join(", ")}]</div>{/if}
      {#if minha.cover}<div class="dim small" title="a caixa que cobre a janela: [x, y, largura, altura] no mundo da arte base">cobre [{minha.cover.join(", ")}]</div>{/if}
    {/if}
  {/if}
</div>

<style>
  .ancora {
    margin: 6px 0;
    padding: 6px 0;
    border-top: 1px solid #ffffff14;
  }
  .secao {
    font-size: 11px;
    color: #9aa0b4;
    margin-bottom: 2px;
  }
  .small {
    font-size: 11px;
  }
  .dim {
    color: #9aa0b4;
  }
  .linha {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0;
  }
  .grade {
    display: grid;
    grid-template-columns: repeat(3, 22px);
    gap: 2px;
  }
  .grade button {
    width: 22px;
    height: 20px;
    padding: 0;
    font-size: 12px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .col button {
    font-size: 11px;
    padding: 1px 6px;
  }
  button.on {
    background: #2b6cb0;
    color: #fff;
  }
  input[type="number"] {
    width: 56px;
  }
  select {
    font-size: 11px;
  }
</style>
