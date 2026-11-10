<script lang="ts">
  // Nove-fatias no inspetor da camada (docs/EDITOR.md "Nove-fatias"; a conta em docs/NUCLEO.md): ligar,
  // as 4 margens, o que o miolo faz em cada eixo, o texto que a caixa acompanha (o botão que cresce
  // com "JOGAR" em alemão) e uma prévia esticando a imagem (os cantos ficam, o resto estica). As
  // linhas do corte também aparecem sobre a imagem no viewport, arrastáveis.
  import { app } from "./state.svelte.ts";

  let { slot, parte }: { slot: string; parte: string } = $props();

  const doc = $derived.by(() => {
    app.version;
    return app.doc?.json as any;
  });
  const a = $derived.by(() => {
    app.version;
    return doc?.skins?.find((s: any) => s.attachments?.[slot]?.[parte])?.attachments[slot][parte] ?? null;
  });
  const skin = $derived(doc?.skins?.find((s: any) => s.attachments?.[slot]?.[parte])?.name ?? "default");
  // a parte e o mesmo objeto depois de uma edicao; a fatia e nova (slice.set troca o objeto)
  const m = $derived.by(() => {
    app.version;
    return a?.slice ? { ...a.slice } : null;
  });
  // os slots com parte de texto (para acompanhar), menos este
  const textos = $derived.by(() => {
    const out: string[] = [];
    for (const sk of doc?.skins ?? []) for (const [sl, ps] of Object.entries<any>(sk.attachments ?? {})) if (sl !== slot && Object.values<any>(ps).some((p) => p?.type === "text") && !out.includes(sl)) out.push(sl);
    return out;
  });

  const set = (args: any, rotulo: string, merge?: string) => app.run({ cmd: "slice.set", args: { slot, name: parte, skin, ...args } }, rotulo, merge);
  function ligar(on: boolean) {
    if (!on) return set({ off: true }, `${slot} sem nove-fatias`);
    // um quarto do lado menor, de partida (o designer arrasta as linhas no viewport)
    const q = Math.round(Math.min(a?.width ?? 32, a?.height ?? 32) / 4);
    set({ margins: q }, `${slot} com nove-fatias`);
  }

  // a prévia: a imagem cortada desenhada maior (os cantos no tamanho, as bordas e o miolo esticados
  // ou repetidos), embaixo da imagem esticada inteira, para comparar
  let fx = $state(1.6);
  let fy = $state(1.2);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let img = $state<HTMLImageElement | null>(null);
  const url = $derived(app.doc?.file.atlas && a ? `/api/region?atlas=${encodeURIComponent(app.doc.file.atlas)}&name=${encodeURIComponent(a.path ?? parte)}&v=${app.version}` : null);
  $effect(() => {
    if (!url) return;
    const i = new Image();
    i.onload = () => (img = i);
    i.src = url;
  });
  $effect(() => {
    const c = canvas,
      im = img;
    if (!c || !im || !m || !a) return;
    const W = 248,
      H = 150;
    c.width = W * devicePixelRatio;
    c.height = H * devicePixelRatio;
    const g = c.getContext("2d")!;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, W, H);
    // a escala da prévia: a imagem esticada cabe na metade da direita
    const pw = a.width ?? im.width,
      ph = a.height ?? im.height;
    // a caixa (o tamanho em que a regiao aparece) esticada pela previa
    const bw = m.width ?? pw,
      bh = m.height ?? ph;
    const k = Math.min((W - 12) / (bw * fx), (H / 2 - 10) / (bh * fy));
    const kx = im.width / pw,
      ky = im.height / ph; // pixels da imagem por unidade da parte
    const dw = bw * fx * k,
      dh = bh * fy * k;
    // esticada inteira (o que o Spine mostra), em cima
    g.globalAlpha = 0.55;
    g.drawImage(im, (W - dw) / 2, (H / 2 - dh) / 2, dw, dh);
    g.globalAlpha = 1;
    // fatiada, embaixo
    const x0 = (W - dw) / 2,
      y0 = H / 2 + (H / 2 - dh) / 2;
    const cx = [0, m.left, pw - m.right, pw].map((v: number) => Math.max(0, Math.min(pw, v)));
    const cy = [0, m.top, ph - m.bottom, ph].map((v: number) => Math.max(0, Math.min(ph, v)));
    const dx = [0, m.left * k, dw - m.right * k, dw];
    const dy = [0, m.top * k, dh - m.bottom * k, dh];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const sw = (cx[i + 1] - cx[i]) * kx,
          sh = (cy[j + 1] - cy[j]) * ky;
        const tw = dx[i + 1] - dx[i],
          th = dy[j + 1] - dy[j];
        if (sw <= 0 || sh <= 0 || tw <= 0 || th <= 0) continue;
        // repetir: pedaços do tamanho original (o último cortado)
        const repX = i === 1 && (m.axisX === "tile" || m.axisX === "tileFit"),
          repY = j === 1 && (m.axisY === "tile" || m.axisY === "tileFit");
        const px = repX ? (m.axisX === "tileFit" ? tw / Math.max(1, Math.round(tw / ((cx[2] - cx[1]) * k))) : (cx[2] - cx[1]) * k) : tw;
        const py = repY ? (m.axisY === "tileFit" ? th / Math.max(1, Math.round(th / ((cy[2] - cy[1]) * k))) : (cy[2] - cy[1]) * k) : th;
        for (let oy = 0; oy < th - 1e-6; oy += py)
          for (let ox = 0; ox < tw - 1e-6; ox += px) {
            const qw = Math.min(px, tw - ox),
              qh = Math.min(py, th - oy);
            g.drawImage(im, cx[i] * kx, cy[j] * ky, (sw * qw) / px, (sh * qh) / py, x0 + dx[i] + ox, y0 + dy[j] + oy, qw, qh);
          }
      }
    g.strokeStyle = "#ff4dbf";
    g.setLineDash([3, 3]);
    g.lineWidth = 1;
    for (const v of [dx[1], dx[2]]) g.strokeRect(x0 + v, y0, 0, dh);
    for (const v of [dy[1], dy[2]]) g.strokeRect(x0, y0 + v, dw, 0);
    g.setLineDash([]);
  });
</script>

{#if a}
  <div class="fatias">
    <label class="secao" title="Os cantos não esticam; as bordas de cima e de baixo esticam só na largura, as dos lados só na altura, e o miolo nos dois sentidos. Vale quando o osso estica com a janela (âncora com esticar) e quando a caixa acompanha um texto">
      <input type="checkbox" checked={!!m} onchange={(e) => ligar((e.target as HTMLInputElement).checked)} /> nove-fatias
    </label>
    {#if m}
      <div class="margens" title="as margens, nas unidades da parte ({a.width ?? 32} × {a.height ?? 32}); arraste as linhas rosa no viewport">
        <span></span>
        <label>cima <input type="number" min="0" value={m.top} onchange={(e) => set({ top: +(e.target as HTMLInputElement).value }, `${slot}: margem de cima`)} /></label>
        <span></span>
        <label>esq. <input type="number" min="0" value={m.left} onchange={(e) => set({ left: +(e.target as HTMLInputElement).value }, `${slot}: margem esquerda`)} /></label>
        <span class="dim">{Math.max(0, (a.width ?? 32) - m.left - m.right)} × {Math.max(0, (a.height ?? 32) - m.top - m.bottom)}</span>
        <label>dir. <input type="number" min="0" value={m.right} onchange={(e) => set({ right: +(e.target as HTMLInputElement).value }, `${slot}: margem direita`)} /></label>
        <span></span>
        <label>baixo <input type="number" min="0" value={m.bottom} onchange={(e) => set({ bottom: +(e.target as HTMLInputElement).value }, `${slot}: margem de baixo`)} /></label>
        <span></span>
      </div>
      <div class="linha" title="a caixa: o tamanho em que a região aparece (a imagem é {a.width ?? 32} × {a.height ?? 32}); os cantos ficam no tamanho da imagem">
        <span class="dim">caixa</span>
        <input type="number" min="1" value={m.width ?? a.width ?? 32} onchange={(e) => set({ size: [+(e.target as HTMLInputElement).value, m.height ?? a.height ?? 32] }, `${slot}: caixa`)} />
        ×
        <input type="number" min="1" value={m.height ?? a.height ?? 32} onchange={(e) => set({ size: [m.width ?? a.width ?? 32, +(e.target as HTMLInputElement).value] }, `${slot}: caixa`)} />
      </div>
      <div class="linha">
        <span class="dim">miolo</span>
        <select value={m.axisX ?? "stretch"} onchange={(e) => set({ axisX: (e.target as HTMLSelectElement).value }, `${slot}: eixo x`)} title="na largura: esticar, repetir (pedaços do tamanho original, o último cortado) ou repetir e caber (o número inteiro de pedaços, esticados)">
          <option value="stretch">↔ esticar</option>
          <option value="tile">↔ repetir</option>
          <option value="tileFit">↔ repetir e caber</option>
        </select>
        <select value={m.axisY ?? "stretch"} onchange={(e) => set({ axisY: (e.target as HTMLSelectElement).value }, `${slot}: eixo y`)} title="na altura">
          <option value="stretch">↕ esticar</option>
          <option value="tile">↕ repetir</option>
          <option value="tileFit">↕ repetir e caber</option>
        </select>
      </div>
      <div class="linha" title="a caixa acompanha o texto mostrado neste slot (a largura medida mais o respiro de cada lado): o botão cresce com JOGAR em alemão ou em hindi. A caixa do texto é a largura máxima (passando dela, o texto encolhe)">
        <span class="dim">acompanha</span>
        <select value={m.fitText?.slot ?? ""} onchange={(e) => { const v = (e.target as HTMLSelectElement).value; set({ fitText: v ? { slot: v, padding: m.fitText?.padding ?? [24, 10] } : null }, v ? `${slot} acompanha ${v}` : `${slot} sem acompanhar`); }}>
          <option value="">nenhum texto</option>
          {#each textos as t}<option value={t}>{t}</option>{/each}
        </select>
        {#if m.fitText}
          <label class="dim">respiro <input type="number" min="0" value={m.fitText.padding?.[0] ?? 0} onchange={(e) => set({ fitText: { slot: m.fitText.slot, padding: [+(e.target as HTMLInputElement).value, m.fitText.padding?.[1] ?? 0] } }, `${slot}: respiro`)} /></label>
          <input type="number" min="0" value={m.fitText.padding?.[1] ?? 0} onchange={(e) => set({ fitText: { slot: m.fitText.slot, padding: [m.fitText.padding?.[0] ?? 0, +(e.target as HTMLInputElement).value] } }, `${slot}: respiro`)} />
        {/if}
      </div>
      <div class="previa">
        <canvas bind:this={canvas} style:width="248px" style:height="150px"></canvas>
        <div class="linha">
          <label class="dim" title="a prévia esticando na largura">↔ <input type="range" min="0.5" max="4" step="0.05" bind:value={fx} /></label>
          <label class="dim" title="na altura">↕ <input type="range" min="0.5" max="3" step="0.05" bind:value={fy} /></label>
        </div>
        <div class="dim legenda">em cima esticada inteira (como no Spine); embaixo com nove-fatias</div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .fatias {
    margin: 6px 0;
    padding: 6px 0;
    border-top: 1px solid #ffffff14;
    font-size: 11px;
  }
  .secao {
    color: #9aa0b4;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dim {
    color: #9aa0b4;
  }
  .margens {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    justify-items: center;
    gap: 2px;
    margin: 4px 0;
  }
  .linha {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 3px 0;
    flex-wrap: wrap;
  }
  input[type="number"] {
    width: 52px;
  }
  input[type="range"] {
    width: 90px;
  }
  select {
    font-size: 11px;
  }
  .previa canvas {
    display: block;
    background: repeating-conic-gradient(#2a2d3a 0% 25%, #22242f 0% 50%) 50% / 12px 12px;
    border-radius: 3px;
  }
  .legenda {
    font-size: 10px;
  }
</style>
