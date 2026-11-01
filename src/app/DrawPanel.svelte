<script lang="ts">
  // Painel do Desenhar: as formas da imagem (de frente para tras, como as camadas do Figma) e o
  // estilo da forma escolhida (preenchimento, traco com alinhamento, quina e ponta) e do ponto
  // (raio do canto, canto ou curva). Tudo vira draw.*.
  import { app } from "./state.svelte.ts";
  import { stopDrawEdit } from "./drawedit.ts";
  import { contours, drawingsOf, shapeBounds, type DrawShape } from "../core/desenho.ts";
  import { parseAtlas } from "../core/atlas-text.ts";

  let box = $state<HTMLDivElement>();
  $effect(() => {
    box?.scrollIntoView({ block: "nearest" });
  });

  const d = $derived.by(() => {
    app.version;
    const de = app.drawEdit;
    return de ? (drawingsOf(app.doc?.json)[de.image] ?? null) : null;
  });
  const de = $derived(app.drawEdit);
  const shape = $derived.by((): DrawShape | null => (d && de?.shape !== null && de?.shape !== undefined ? (d.shapes[de.shape] ?? null) : null));
  const point = $derived.by(() => (shape && de?.point !== null && de?.point !== undefined ? (contours(shape)[de.contour]?.points[de.point] ?? null) : null));

  // a forma de baixo mais perto que encosta na escolhida (a que "furar a de baixo" fura)
  const debaixo = $derived.by(() => {
    if (!d || !de || de.shape === null || !shape) return null;
    const b = shapeBounds(shape);
    if (!b) return null;
    for (let i = de.shape - 1; i >= 0; i--) {
      const o = shapeBounds(d.shapes[i]);
      if (o && o[0] < b[2] && b[0] < o[2] && o[1] < b[3] && b[1] < o[3]) return i;
    }
    return null;
  });
  function furarDebaixo() {
    if (!de || de.shape === null || debaixo === null || !d) return;
    const r = app.run({ cmd: "draw.cut", args: { image: de.image, shape: de.shape, into: debaixo } }, `${d.shapes[de.shape].name} fura ${d.shapes[debaixo].name}`);
    if (r?.[0]) {
      de.shape = r[0].index;
      de.point = null;
      de.contour = 0;
    }
  }

  let seq = 0;
  const merge = (k: string) => `painel-${k}-${de?.shape}-${seq}`;
  function set(args: any, label: string, k?: string) {
    if (!de || de.shape === null) return;
    app.run({ cmd: "draw.set", args: { image: de.image, shape: de.shape, ...args } }, label, k ? merge(k) : undefined, true);
  }
  // cor rrggbbaa <-> o seletor (#rrggbb) e a transparencia
  const rgb = (c?: string) => "#" + (c ?? "000000ff").slice(0, 6);
  const alpha = (c?: string) => parseInt((c ?? "000000ff").slice(6, 8) || "ff", 16) / 255;
  const hex = (rgbHex: string, a: number) =>
    rgbHex.slice(1) +
    Math.round(Math.max(0, Math.min(1, a)) * 255)
      .toString(16)
      .padStart(2, "0");

  function pick(i: number) {
    if (!de) return;
    de.shape = i;
    de.point = null;
    de.pen = null;
  }
  function order(i: number, to: number) {
    if (!de || !d) return;
    if (to < 0 || to >= d.shapes.length) return;
    if (app.run({ cmd: "draw.order", args: { image: de.image, shape: i, index: to } }, `ordem de ${d.shapes[i].name}`) && de.shape === i) de.shape = to;
  }
  function remove(i: number) {
    if (!de || !d) return;
    if (app.run({ cmd: "draw.remove", args: { image: de.image, shape: i } }, `apaga ${d.shapes[i].name}`)) de.shape = de.point = de.pen = null;
  }
  let renaming = $state<number | null>(null);
  let newName = $state("");
  function rename() {
    if (renaming === null || !de || !d) return;
    const i = renaming;
    renaming = null;
    const n = newName.trim();
    if (n && n !== d.shapes[i]?.name) app.run({ cmd: "draw.set", args: { image: de.image, shape: i, rename: n } }, `renomeia ${d.shapes[i].name}`);
  }
  function pointSet(args: any, label: string, k?: string) {
    if (!de || de.shape === null || de.point === null) return;
    app.run({ cmd: "draw.point", args: { image: de.image, shape: de.shape, contour: de.contour, index: de.point, ...args } }, label, k ? merge(k) : undefined, true);
  }
  function fit() {
    if (!de) return;
    const r = app.run({ cmd: "draw.fit", args: { image: de.image } }, `ajusta ${de.image} ao desenho`);
    if (r?.[0]) app.avisar(`${de.image} agora tem ${r[0].width} × ${r[0].height} px e continua no mesmo lugar.`);
  }
  // girar, escalar e espelhar a forma escolhida em volta do centro dela (draw.transform)
  function transforma(args: any, label: string) {
    if (!de || de.shape === null) return;
    app.run({ cmd: "draw.transform", args: { image: de.image, shapes: [de.shape], ...args } }, label);
  }
  // as imagens do atlas que este desenho pode substituir (em todas as partes que as usam)
  const imagensAtlas = $derived.by(() => {
    app.version;
    const t = app.doc?.atlas.text;
    if (!t) return [] as string[];
    return [...new Set(parseAtlas(app.desenhos.semDesenhos(t)).regions.map((r) => r.name))];
  });
  function substituir(img: string) {
    if (!de || !img) return;
    const r = app.run({ cmd: "draw.replace", args: { image: img, drawing: de.image } }, `${de.image} no lugar de ${img}`);
    if (r?.[0]) app.avisar(`${de.image} agora aparece no lugar de ${img} em ${r[0].replaced.join(", ")}.${r[0].warning ? " " + r[0].warning : ""}`);
  }
  const ordem = $derived(d ? d.shapes.map((s, i) => ({ s, i })).reverse() : []);
</script>

{#if de && d}
  <div class="dp" bind:this={box}>
    <div class="head">
      <span>✏️ Desenho <b>{de.image}</b> <span class="dim">{d.width} × {d.height} px</span></span>
      <button class="ok" onclick={stopDrawEdit}>Pronto</button>
    </div>
    <div class="tools">
      <button class:on={de.tool === "select"} onclick={() => ((de.tool = "select"), (de.pen = null))} title="Selecionar e mover (V)">↖ Selecionar</button>
      <button class:on={de.tool === "pen"} onclick={() => (de.tool = "pen")} title="Caneta (P): clique faz canto, arrastar faz curva">✒️ Caneta</button>
      <button class:on={de.tool === "rect"} onclick={() => ((de.tool = "rect"), (de.pen = null))} title="Retângulo (R)">▭</button>
      <button class:on={de.tool === "ellipse"} onclick={() => ((de.tool = "ellipse"), (de.pen = null))} title="Elipse (O)">◯</button>
      <button class:on={de.hole} disabled={de.shape === null && !de.hole} onclick={() => ((de.hole = !de.hole), (de.pen = null), de.tool === "select" && (de.tool = "pen"))} title="Modo furo: a caneta, o retângulo e a elipse furam a forma escolhida (Esc sai)">⊘ Furo</button>
    </div>
    <div class="secao">Formas <span class="dim">(a de cima fica na frente)</span></div>
    <div class="formas">
      {#each ordem as { s, i } (i + s.name)}
        <div class="forma" class:sel={de.shape === i}>
          {#if renaming === i}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="ren" bind:value={newName} onkeydown={(e) => (e.key === "Enter" ? rename() : e.key === "Escape" && (renaming = null))} onblur={rename} autofocus />
          {:else}
            <button class="nome" class:off={s.hidden} onclick={() => pick(i)} ondblclick={() => ((renaming = i), (newName = s.name))} title="clique escolhe · clique duplo renomeia">
              <span class="amostra" style:background={s.fill ? "#" + s.fill : "transparent"} style:border-color={s.stroke ? "#" + s.stroke.color : "#666"}></span>
              {s.name}
              <span class="dim">{s.closed ? "" : "aberto"}</span>
            </button>
          {/if}
          <button class="mini" onclick={() => order(i, i + 1)} title="para a frente">↑</button>
          <button class="mini" onclick={() => order(i, i - 1)} title="para trás">↓</button>
          <button class="mini" onclick={() => app.run({ cmd: "draw.set", args: { image: de.image, shape: i, hidden: !s.hidden } }, s.hidden ? `mostra ${s.name}` : `esconde ${s.name}`)} title={s.hidden ? "mostrar" : "esconder (não entra na imagem)"}>{s.hidden ? "◡" : "👁"}</button>
          <button class="mini" onclick={() => remove(i)} title="apagar">✕</button>
        </div>
      {:else}
        <div class="dim vazio">Nenhuma forma ainda. Use a caneta, o retângulo ou a elipse na tela.</div>
      {/each}
    </div>

    {#if shape}
      <div class="secao">{shape.name}</div>
      <div class="grade">
        <label class="ck"><input type="checkbox" checked={!!shape.fill} onchange={(e) => set({ fill: (e.target as HTMLInputElement).checked ? "d9d9d9ff" : null }, "preenchimento")} /> Preenchimento</label>
        {#if shape.fill}
          <div class="cor">
            <input type="color" value={rgb(shape.fill)} oninput={(e) => set({ fill: hex((e.target as HTMLInputElement).value, alpha(shape.fill)) }, "cor do preenchimento", "fill")} />
            <input type="range" min="0" max="1" step="0.01" value={alpha(shape.fill)} title="opacidade" oninput={(e) => set({ fill: hex(rgb(shape.fill), +(e.target as HTMLInputElement).value) }, "opacidade do preenchimento", "fa")} />
          </div>
        {:else}<span></span>{/if}

        <label class="ck"><input type="checkbox" checked={!!shape.stroke} onchange={(e) => set({ stroke: (e.target as HTMLInputElement).checked ? { color: "000000ff", width: 2 } : null }, "traço")} /> Traço</label>
        {#if shape.stroke}
          <div class="cor">
            <input type="color" value={rgb(shape.stroke.color)} oninput={(e) => set({ stroke: { color: hex((e.target as HTMLInputElement).value, alpha(shape.stroke?.color)) } }, "cor do traço", "sc")} />
            <input type="range" min="0" max="1" step="0.01" value={alpha(shape.stroke.color)} title="opacidade" oninput={(e) => set({ stroke: { color: hex(rgb(shape.stroke?.color), +(e.target as HTMLInputElement).value) } }, "opacidade do traço", "sa")} />
          </div>
          <span class="rot">espessura</span>
          <input type="number" min="0.25" step="0.5" value={shape.stroke.width} onchange={(e) => +(e.target as HTMLInputElement).value > 0 && set({ stroke: { width: +(e.target as HTMLInputElement).value } }, "espessura do traço")} />
          <span class="rot">posição</span>
          <div class="seg">
            {#each [["inside", "dentro"], ["center", "centro"], ["outside", "fora"]] as [v, t]}
              <button class:on={(shape.stroke.align ?? "center") === v} disabled={!shape.closed && v !== "center"} onclick={() => set({ stroke: { align: v } }, `traço por ${t}`)}>{t}</button>
            {/each}
          </div>
          <span class="rot">quina</span>
          <div class="seg">
            {#each [["miter", "viva"], ["round", "redonda"], ["bevel", "chanfrada"]] as [v, t]}
              <button class:on={(shape.stroke.join ?? "miter") === v} onclick={() => set({ stroke: { join: v } }, `quina ${t}`)}>{t}</button>
            {/each}
          </div>
          {#if !shape.closed}
            <span class="rot">ponta</span>
            <div class="seg">
              {#each [["butt", "reta"], ["round", "redonda"], ["square", "quadrada"]] as [v, t]}
                <button class:on={(shape.stroke.cap ?? "butt") === v} onclick={() => set({ stroke: { cap: v } }, `ponta ${t}`)}>{t}</button>
              {/each}
            </div>
          {/if}
        {/if}
        {#if shape.holes?.length}
          <span class="rot">furos</span>
          <div class="furos">
            {#each shape.holes as h, k}
              <span class="furo" class:sel={de.contour === k + 1}>
                <button class="mini nomef" onclick={() => ((de.contour = k + 1), (de.point = 0))} title="escolher o furo ({h.points.length} pontos)">⊘ {k + 1}</button>
                <button class="mini" onclick={() => (app.run({ cmd: "draw.remove", args: { image: de.image, shape: de.shape, contour: k + 1 } }, `tira o furo ${k + 1} de ${shape?.name}`), (de.contour = 0), (de.point = null))} title="tirar o furo">✕</button>
              </span>
            {/each}
          </div>
        {/if}
        <span></span>
        <button disabled={debaixo === null} onclick={furarDebaixo} title={debaixo === null ? "nenhuma forma de baixo encosta nesta" : `esta forma vira um furo em ${d.shapes[debaixo].name}`}>⊘ Furar a forma de baixo</button>
        <span class="rot">girar</span>
        <div class="seg">
          <button onclick={() => transforma({ rotation: -15 }, "gira -15°")} title="girar 15° para a esquerda">↺ 15°</button>
          <button onclick={() => transforma({ rotation: 15 }, "gira 15°")} title="girar 15° para a direita">↻ 15°</button>
          <button onclick={() => transforma({ scale: [-1, 1] }, "espelha na horizontal")} title="espelhar na horizontal">⇋</button>
          <button onclick={() => transforma({ scale: [1, -1] }, "espelha na vertical")} title="espelhar na vertical">⇵</button>
        </div>
        <span class="rot">tamanho</span>
        <div class="seg">
          <button onclick={() => transforma({ scale: [0.9, 0.9] }, "diminui 10%")} title="10% menor">−10%</button>
          <button onclick={() => transforma({ scale: [1.1, 1.1] }, "aumenta 10%")} title="10% maior">+10%</button>
        </div>
        <label class="ck"><input type="checkbox" checked={!!shape.closed} disabled={shape.points.length < 2} onchange={(e) => set({ closed: (e.target as HTMLInputElement).checked }, (e.target as HTMLInputElement).checked ? "fecha" : "abre")} /> Fechado</label>
        <span></span>
      </div>
    {/if}

    {#if point && de.point !== null}
      <div class="secao">Ponto {de.point + 1} de {contours(shape!)[de.contour]?.points.length}{de.contour ? ` · furo ${de.contour}` : ""}</div>
      <div class="grade">
        <span class="rot">tipo</span>
        <div class="seg">
          <button class:on={!point.in && !point.out} onclick={() => pointSet({ smooth: false }, "ponto vira canto")}>canto</button>
          <button class:on={!!(point.in || point.out)} onclick={() => pointSet({ smooth: true }, "ponto vira curva")}>curva</button>
        </div>
        {#if !point.in && !point.out}
          <span class="rot">raio</span>
          <div class="cor">
            <input type="range" min="0" max="60" step="0.5" value={point.radius ?? 0} oninput={(e) => pointSet({ radius: +(e.target as HTMLInputElement).value || null }, "raio do canto", "raio")} />
            <span class="num">{(point.radius ?? 0).toFixed(1)}</span>
          </div>
        {/if}
        <span class="rot">x, y</span>
        <div class="cor">
          <input type="number" step="0.5" value={point.x} onchange={(e) => pointSet({ x: +(e.target as HTMLInputElement).value }, "x do ponto")} />
          <input type="number" step="0.5" value={point.y} onchange={(e) => pointSet({ y: +(e.target as HTMLInputElement).value }, "y do ponto")} />
        </div>
      </div>
    {/if}

    <div class="secao">Imagem</div>
    <div class="grade">
      <span class="rot">nitidez</span>
      <div class="seg">
        {#each [1, 2, 3] as h}
          <button class:on={(d.hd ?? 2) === h} onclick={() => app.run({ cmd: "draw.resize", args: { image: de.image, hd: h } }, `nitidez ${h}x em ${de.image}`)} title="pixels de textura por pixel: mais nítido quando a peça aparece grande, mais memória">{h}x</button>
        {/each}
      </div>
      <span></span>
      <button onclick={fit} disabled={!d.shapes.some((s) => !s.hidden && s.points.length)} title="corta a imagem até o desenho (a peça fica no mesmo lugar)">Ajustar a imagem ao desenho</button>
      {#if imagensAtlas.length}
        <span></span>
        <select value="" onchange={(e) => { substituir((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }} title="Todas as partes que usam aquela imagem passam a mostrar este desenho, no mesmo lugar (se o tamanho for outro, ele estica)">
          <option value="">usar no lugar de…</option>
          {#each imagensAtlas as im}<option value={im}>{im}</option>{/each}
        </select>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dp {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
    padding: 10px;
    border: 1px solid #0c99ff;
    border-radius: 10px;
    background: #121c26;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .ok {
    background: #0c99ff;
    color: #fff;
    border-color: #0c99ff;
    font-weight: 600;
  }
  .tools {
    display: flex;
    gap: 4px;
  }
  .tools button {
    flex: 1;
    padding: 7px 4px;
    font-size: 13px;
  }
  .on {
    background: #0c99ff33;
    border-color: #0c99ff;
  }
  .secao {
    font-size: 12px;
    font-weight: 600;
    margin-top: 4px;
  }
  .formas {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 220px;
    overflow: auto;
  }
  .forma {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: 6px;
  }
  .forma.sel {
    background: #0c99ff2a;
  }
  .nome {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    text-align: left;
    padding: 4px;
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .nome.off {
    opacity: 0.45;
  }
  .amostra {
    width: 12px;
    height: 12px;
    flex: none;
    border-radius: 3px;
    border: 2px solid;
  }
  .mini {
    background: none;
    border: none;
    padding: 2px 5px;
    font-size: 12px;
    opacity: 0.6;
  }
  .mini:hover {
    opacity: 1;
  }
  .ren {
    flex: 1;
    min-width: 0;
  }
  .vazio {
    font-size: 12px;
    padding: 4px;
  }
  .grade {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 8px;
    align-items: center;
    font-size: 13px;
  }
  .ck {
    display: flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .rot {
    color: var(--dim);
    font-size: 12px;
  }
  .cor {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }
  .cor input[type="range"] {
    flex: 1;
    min-width: 0;
  }
  .cor input[type="number"] {
    width: 70px;
  }
  .seg {
    display: flex;
    gap: 2px;
  }
  .seg button {
    flex: 1;
    font-size: 12px;
    padding: 4px 2px;
  }
  .furos {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .furo {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .furo.sel {
    border-color: #0c99ff;
  }
  .nomef {
    opacity: 1;
  }
  .num {
    font-size: 12px;
    width: 34px;
    text-align: right;
  }
  input[type="number"] {
    width: 80px;
  }
</style>
