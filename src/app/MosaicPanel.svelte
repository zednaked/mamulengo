<script lang="ts">
  // Painel do mosaico (docs/NUCLEO.md "Mosaico"): a ferramenta, a paleta (imagens do atlas), a
  // grade (forma, colunas, linhas, celula) e, com a ferramenta de celula, o que muda na celula
  // escolhida (cor, altura, giro, espelho, brilho e linha). Tudo vira mosaic.*.
  import { app } from "./state.svelte.ts";
  import { stopMosaicEdit, type MosaicTool } from "./mosaicedit.ts";
  import { mosaics } from "../core/commands/mosaic.ts";
  import { parseAtlas } from "../core/atlas-text.ts";

  let box = $state<HTMLDivElement>();
  $effect(() => {
    box?.scrollIntoView({ block: "nearest" });
  });

  const me = $derived(app.mosaicEdit);
  const m = $derived.by(() => {
    app.version;
    return me && app.doc ? (mosaics(app.doc.json).find((x) => x.name === me.name) ?? null) : null;
  });
  const regioes = $derived.by(() => {
    app.version;
    const t = app.doc?.atlas.text;
    return t ? parseAtlas(t).regions.map((r) => r.name) : [];
  });
  const thumb = (name: string) => `/api/region?atlas=${encodeURIComponent(app.doc!.file.atlas!)}&name=${encodeURIComponent(name)}&v=${app.version}`;
  let filtro = $state("");
  let mostrarAtlas = $state(false);

  const FERRAMENTAS: [MosaicTool, string, string][] = [
    ["brush", "🖌️", "pincel: arraste para pintar com a imagem escolhida"],
    ["erase", "🧽", "borracha: arraste para esvaziar células"],
    ["rect", "▭", "retângulo: arraste de um canto ao outro"],
    ["fill", "🪣", "balde: troca as células ligadas com a mesma imagem"],
    ["cell", "◎", "célula: escolha uma para mudar cor, altura, giro, espelho e efeitos"],
  ];

  let seq = 0;
  function set(args: any, label: string, k?: string) {
    if (!me) return;
    app.run({ cmd: "mosaic.set", args: { name: me.name, ...args } }, label, k ? `mosaico-${k}-${me.name}-${seq}` : undefined, true);
  }
  function usar(nome: string) {
    if (!me || !m) return;
    const i = (m.palette ?? []).indexOf(nome);
    if (i >= 0) me.image = i;
    else {
      const n = m.palette?.length ?? 0;
      if (app.run({ cmd: "mosaic.set", args: { name: me.name, palette: [...(m.palette ?? []), nome] } }, `${nome} na paleta de ${me.name}`)) me.image = n;
    }
    if (me.tool === "erase" || me.tool === "cell") me.tool = "brush";
    mostrarAtlas = false;
  }

  // a celula escolhida (ferramenta de celula)
  const extra = $derived.by(() => {
    if (!m || !me?.cell) return null;
    return m.extras?.[me.cell[1] * m.columns + me.cell[0]] ?? {};
  });
  function celula(args: any, label: string, k?: string) {
    if (!me?.cell) return;
    app.run({ cmd: "mosaic.cell", args: { name: me.name, at: me.cell, ...args } }, label, k ? `celula-${k}-${me.name}-${me.cell.join(",")}-${seq}` : undefined, true);
  }
  const rgb = (c?: string) => "#" + (c ?? "ffffffff").slice(0, 6);
  const alpha = (c?: string) => parseInt((c ?? "ffffffff").slice(6, 8) || "ff", 16) / 255;
  const hex = (rgbHex: string, a: number) =>
    rgbHex.slice(1) +
    Math.round(Math.max(0, Math.min(1, a)) * 255)
      .toString(16)
      .padStart(2, "0");
</script>

{#if me && m}
  <div class="mosaico" bind:this={box}>
    <div class="topo">
      <b>🧩 {m.name}</b>
      <span class="dim">{m.columns} × {m.rows} · {m.shape === "iso" ? "iso" : m.corners ? "perspectiva" : "grade"}</span>
      <button class="sai" onclick={stopMosaicEdit} title="parar de pintar (Esc)">concluir</button>
    </div>
    <div class="ferramentas">
      {#each FERRAMENTAS as [t, ic, dica]}
        <button class:on={me.tool === t} onclick={() => ((me.tool = t), t !== "cell" && (me.cell = null))} title={dica}>{ic}</button>
      {/each}
    </div>

    <div class="paleta">
      {#each m.palette ?? [] as nome, i}
        <button class="img" class:on={me.image === i && me.tool !== "erase"} onclick={() => ((me.image = i), me.tool === "erase" || me.tool === "cell" ? (me.tool = "brush") : null)} title={nome}>
          <img src={thumb(nome)} alt={nome} />
        </button>
      {/each}
      <button class="mais" onclick={() => (mostrarAtlas = !mostrarAtlas)} title="acrescentar uma imagem do atlas à paleta">+</button>
    </div>
    {#if mostrarAtlas}
      <div class="atlas">
        <input placeholder="filtrar imagens" bind:value={filtro} />
        <div class="grade-atlas">
          {#each regioes.filter((r) => !filtro || r.toLowerCase().includes(filtro.toLowerCase())).slice(0, 120) as nome}
            <button class="img" onclick={() => usar(nome)} title={nome}><img src={thumb(nome)} alt={nome} loading="lazy" /></button>
          {/each}
        </div>
      </div>
    {/if}

    {#if me.tool === "cell"}
      {#if me.cell && extra}
        <div class="campos">
          <span class="dim">célula {me.cell[0]}, {me.cell[1]}</span>
          <label>cor <input type="color" value={rgb(extra.color)} oninput={(e) => celula({ color: hex((e.target as HTMLInputElement).value, alpha(extra.color)) }, "cor da célula", "cor")} /></label>
          <label>transparência <input type="range" min="0" max="1" step="0.01" value={alpha(extra.color)} oninput={(e) => celula({ color: hex(rgb(extra.color), +(e.target as HTMLInputElement).value) }, "transparência da célula", "alfa")} /></label>
          <label>altura <input type="range" min="-64" max="64" step="1" value={extra.height ?? 0} oninput={(e) => celula({ height: +(e.target as HTMLInputElement).value || null }, "altura da célula", "altura")} /> <span class="num">{extra.height ?? 0}</span></label>
          <div class="linha">
            <button onclick={() => celula({ spin: ((extra.spin ?? 0) + 1) % 4 }, "gira a célula")} title="um quarto de volta">⟲ girar</button>
            <button class:on={extra.flip} onclick={() => celula({ flip: !extra.flip }, "espelha a célula")}>⇋ espelhar</button>
            <button class:on={!!extra.effects?.glow} onclick={() => celula({ effects: { glow: extra.effects?.glow ? null : { color: "fff2a0ff", strength: 1, radius: 8 } } }, "brilho na célula")}>✨ brilho</button>
            <button class:on={!!extra.effects?.outline} onclick={() => celula({ effects: { outline: extra.effects?.outline ? null : { color: "ffffffff", width: 2 } } }, "linha na célula")}>▢ linha</button>
            <button onclick={() => celula({ color: null, height: null, spin: null, flip: null, effects: null }, "célula ao padrão")} title="tira cor, altura, giro, espelho e efeitos">limpar</button>
          </div>
        </div>
      {:else}
        <p class="dim">Clique numa célula para mudar cor, altura, giro, espelho e efeitos.</p>
      {/if}
    {/if}

    {#if m.shape !== "iso" && !m.corners}
      <label class="linha" title="o palco (docs/PALCO.md): os ladrilhos deste mosaico seguram os atores (chão e paredes)">
        <input
          type="checkbox"
          checked={(app.doc?.json as any)?.stage?.solid?.mosaic === m.name}
          onchange={(e) => app.run({ cmd: "stage.set", args: { solid: (e.target as HTMLInputElement).checked ? { mosaic: m.name } : null } }, (e.target as HTMLInputElement).checked ? `${m.name} é o chão do palco` : "palco sem chão")}
        />
        🎮 chão sólido do palco
      </label>
    {/if}
    <details>
      <summary>grade</summary>
      <div class="campos">
        <label>forma
          <select value={m.shape} onchange={(e) => set({ shape: (e.target as HTMLSelectElement).value }, "forma do mosaico")}>
            <option value="grid">grade (vista de cima)</option>
            <option value="iso">isométrica</option>
          </select>
        </label>
        <label>colunas <input type="number" min="1" max="1024" value={m.columns} onchange={(e) => set({ columns: +(e.target as HTMLInputElement).value }, "colunas do mosaico")} /></label>
        <label>linhas <input type="number" min="1" max="1024" value={m.rows} onchange={(e) => set({ rows: +(e.target as HTMLInputElement).value }, "linhas do mosaico")} /></label>
        <label>célula <input type="number" min="1" value={m.cell[0]} onchange={(e) => set({ cell: [+(e.target as HTMLInputElement).value, m.cell[1]] }, "célula do mosaico")} /> × <input type="number" min="1" value={m.cell[1]} onchange={(e) => set({ cell: [m.cell[0], +(e.target as HTMLInputElement).value] }, "célula do mosaico")} /></label>
        {#if m.shape === "iso"}
          <label>escala <input type="number" min="0.05" step="0.05" value={m.escala ?? 1} onchange={(e) => set({ scale: +(e.target as HTMLInputElement).value }, "escala do mosaico")} /></label>
          <label>âncora y <input type="range" min="0" max="1" step="0.01" value={m.anchor?.[1] ?? 0.5} oninput={(e) => set({ anchor: [m.anchor?.[0] ?? 0.5, +(e.target as HTMLInputElement).value] }, "âncora do mosaico", "ancora")} /></label>
        {:else}
          <label class="linha">
            <input
              type="checkbox"
              checked={!!m.corners}
              onchange={(e) => {
                const on = (e.target as HTMLInputElement).checked;
                const w = m.columns * m.cell[0],
                  h = m.rows * m.cell[1],
                  x = m.x ?? 0,
                  y = m.y ?? 0;
                // perspectiva de chao: o fundo (em cima) mais estreito e mais baixo
                set({ corners: on ? [x, y - h, x + w * 0.2, y - h * 0.45, x + w * 0.8, y - h * 0.45, x + w, y - h] : null }, on ? "perspectiva forçada" : "sem perspectiva");
              }}
            />
            perspectiva forçada (chão em ângulo)
          </label>
        {/if}
      </div>
    </details>
  </div>
{/if}

<style>
  .mosaico {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--line, #333);
    border-radius: 8px;
  }
  .topo {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .topo .sai {
    margin-left: auto;
  }
  .dim {
    opacity: 0.65;
    font-size: 0.85em;
  }
  .ferramentas,
  .linha {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    align-items: center;
  }
  .ferramentas button.on,
  .linha button.on,
  .img.on {
    outline: 2px solid var(--accent, #ff4fa3);
  }
  .paleta,
  .grade-atlas {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .grade-atlas {
    max-height: 180px;
    overflow: auto;
  }
  .img {
    width: 40px;
    height: 40px;
    padding: 2px;
    display: grid;
    place-items: center;
  }
  .img img {
    max-width: 100%;
    max-height: 100%;
    image-rendering: pixelated;
  }
  .mais {
    width: 40px;
    height: 40px;
  }
  .campos {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .campos input[type="number"] {
    width: 64px;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
</style>
