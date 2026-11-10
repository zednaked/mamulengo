<script lang="ts">
  // A parte de texto no inspetor (docs/EDITOR.md "Texto"): o texto livre ou a chave da tabela de
  // idiomas (com as traduções da chave editáveis aqui), a fonte do projeto, o tamanho, a cor, o
  // alinhamento, a caixa e o que fazer quando estoura, com o aviso dos idiomas em que não cabe. As
  // letras são do navegador (src/tela/textos.ts); a medida do aviso é a mesma do desenho.
  import { app } from "./state.svelte.ts";
  import { NOMES_IDIOMA } from "../core/texto.ts";

  let { slot, parte }: { slot: string; parte: string } = $props();

  const doc = $derived.by(() => {
    app.version;
    return app.doc?.json as any;
  });
  const a = $derived.by(() => {
    app.version;
    return doc?.skins?.find((s: any) => s.attachments?.[slot]?.[parte])?.attachments[slot][parte] ?? null;
  });
  const skin = $derived.by(() => {
    app.version;
    return doc?.skins?.find((s: any) => s.attachments?.[slot]?.[parte])?.name ?? "default";
  });
  const tr = $derived(doc?.translations ?? null);
  const fontes = $derived<{ name: string; file: string }[]>(doc?.fonts ?? []);
  const chaves = $derived(Object.keys(tr?.strings ?? {}));

  // os idiomas em que este texto estoura a caixa (a medida do navegador, com as fontes carregadas)
  const estouros = $derived.by(() => {
    app.version;
    app.versaoTextos;
    const t = app.viewer?.nucleo?.textos;
    if (!t) return [];
    try {
      return t.estouros().filter((e) => e.nome === parte);
    } catch {
      return [];
    }
  });

  const set = (args: any, rotulo: string, merge?: string) => app.run({ cmd: "text.set", args: { slot, name: parte, skin, ...args } }, rotulo, merge);
  const cor6 = (c?: string) => "#" + (c ?? "ffffffff").slice(0, 6);
  function traduzir(l: string, v: string) {
    if (!a?.key) return;
    app.run({ cmd: "i18n.set", args: { key: a.key, values: { [l]: v } } }, `${a.key} em ${l}`, `trad-${a.key}-${l}`);
  }
  function novaChave() {
    const k = prompt("nome da chave (como no translations.csv, ex.: JOGAR)", (a?.string ?? "").toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 24));
    if (!k) return;
    const idioma = tr?.languages?.[0] ?? "pt";
    if (!tr?.strings?.[k]) app.run({ cmd: "i18n.set", args: { key: k, values: { [idioma]: a?.string ?? "" } } }, `chave ${k}`);
    set({ key: k }, `${slot} usa ${k}`);
  }
</script>

{#if a}
  <div class="texto">
    <div class="secao" title="As letras são desenhadas por quem mostra (o navegador, o Godot), com o idioma escolhido no alto do viewport">Texto</div>
    <div class="linha">
      <select value={a.key ?? ""} onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v === "+") novaChave(); else set({ key: v || null }, v ? `${slot} usa ${v}` : `${slot} sem chave`); }} title="a chave na tabela de idiomas (sem chave: texto livre)">
        <option value="">texto livre</option>
        {#each chaves as k}<option value={k}>{k}</option>{/each}
        <option value="+">+ nova chave…</option>
      </select>
    </div>
    <textarea rows="2" value={a.string ?? ""} placeholder={a.key ? "padrão quando falta a tradução" : "o texto"} onchange={(e) => set({ text: (e.target as HTMLTextAreaElement).value }, `texto de ${slot}`)} title={'o texto livre; com chave, o que aparece quando falta a tradução. "{nome}" é um parâmetro que o jogo troca'}></textarea>
    {#if a.key && tr}
      <div class="trad">
        {#each tr.languages as l, i}
          <label class:estoura={estouros.some((x) => x.idioma === l)} class:atual={(app.idioma || tr.languages[0]) === l} title={NOMES_IDIOMA[l] ?? l}>
            <span class="cod">{l}</span>
            <input dir="auto" value={tr.strings[a.key]?.[i] ?? ""} onchange={(e) => traduzir(l, (e.target as HTMLInputElement).value)} />
          </label>
        {/each}
      </div>
    {/if}
    <div class="linha">
      <select value={a.font ?? ""} onchange={(e) => set({ font: (e.target as HTMLSelectElement).value || null }, `fonte de ${slot}`)} title="a fonte do projeto (font.add); as outras entram de reserva para as letras que faltam">
        <option value="">{fontes[0] ? `${fontes[0].name} (padrão)` : "fonte do sistema"}</option>
        {#each fontes as f}<option value={f.name}>{f.name}</option>{/each}
      </select>
      <input type="number" min="1" step="1" value={a.size ?? 32} onchange={(e) => set({ size: +(e.target as HTMLInputElement).value }, `tamanho de ${slot}`, `tam-${slot}`)} title="tamanho da letra (px do mundo)" />
      <input type="color" value={cor6(a.color)} oninput={(e) => set({ color: (e.target as HTMLInputElement).value.slice(1) + (a.color ?? "ffffffff").slice(6) }, `cor de ${slot}`, `cor-${slot}`)} title="cor das letras" />
    </div>
    <div class="linha">
      {#each [["left", "⇤"], ["center", "↔"], ["right", "⇥"]] as [v, s]}
        <button class:on={(a.align ?? "center") === v} onclick={() => set({ align: v }, `${slot} alinhado ${v}`)} title="alinhar: {v}">{s}</button>
      {/each}
      <span class="sep"></span>
      {#each [["top", "⤒"], ["middle", "↕"], ["bottom", "⤓"]] as [v, s]}
        <button class:on={(a.valign ?? "middle") === v} onclick={() => set({ valign: v }, `${slot} alinhado ${v}`)} title="vertical: {v}">{s}</button>
      {/each}
    </div>
    <div class="linha" title="a caixa do texto, no osso (px do mundo)">
      <span class="dim">caixa</span>
      <input type="number" min="1" value={a.width} onchange={(e) => set({ width: +(e.target as HTMLInputElement).value }, `caixa de ${slot}`, `cx-${slot}`)} />×<input type="number" min="1" value={a.height} onchange={(e) => set({ height: +(e.target as HTMLInputElement).value }, `caixa de ${slot}`, `cy-${slot}`)} />
    </div>
    <div class="linha">
      <span class="dim">estouro</span>
      <select value={a.overflow ?? "shrink"} onchange={(e) => set({ overflow: (e.target as HTMLSelectElement).value }, `estouro de ${slot}`)} title="quando o texto não cabe na caixa">
        <option value="shrink">encolher</option>
        <option value="wrap">quebrar linha</option>
        <option value="clip">cortar</option>
        <option value="none">nada</option>
      </select>
      {#if (a.overflow ?? "shrink") === "shrink"}
        <input type="number" min="1" value={a.minSize ?? Math.round((a.size ?? 32) / 2)} onchange={(e) => set({ minSize: +(e.target as HTMLInputElement).value }, `mínimo de ${slot}`, `min-${slot}`)} title="a letra não encolhe abaixo disto" />
      {/if}
    </div>
    <div class="linha">
      <label class="dim"><input type="checkbox" checked={!!a.outline} onchange={(e) => set({ outline: (e.target as HTMLInputElement).checked ? { width: 2, color: "000000" } : null }, `contorno de ${slot}`)} /> contorno</label>
      {#if a.outline}
        <input type="number" min="0" step="0.5" value={a.outline.width} onchange={(e) => set({ outline: { ...a.outline, width: +(e.target as HTMLInputElement).value } }, `contorno de ${slot}`, `ol-${slot}`)} />
        <input type="color" value={cor6(a.outline.color)} oninput={(e) => set({ outline: { ...a.outline, color: (e.target as HTMLInputElement).value.slice(1) } }, `contorno de ${slot}`, `olc-${slot}`)} />
      {/if}
      <label class="dim"><input type="checkbox" checked={!!a.shadow} onchange={(e) => set({ shadow: (e.target as HTMLInputElement).checked ? { color: "00000080", y: 3 } : null }, `sombra de ${slot}`)} /> sombra</label>
      {#if a.shadow}
        <input type="color" value={cor6(a.shadow.color)} oninput={(e) => set({ shadow: { ...a.shadow, color: (e.target as HTMLInputElement).value.slice(1) + (a.shadow.color ?? "00000080").slice(6) } }, `sombra de ${slot}`, `shc-${slot}`)} />
      {/if}
    </div>
    {#if estouros.length}
      <div class="aviso" title="Nestes idiomas o texto não cabe na caixa (com encolher: nem no tamanho mínimo). Aumente a caixa, mude o estouro ou encurte a tradução">
        ⚠ estoura em {estouros.map((e) => `${e.idioma}${e.quanto[0] > 0 ? ` (+${Math.ceil(e.quanto[0])} px)` : e.quanto[1] > 0 ? ` (+${Math.ceil(e.quanto[1])} px na altura)` : ""}`).join(", ")}
      </div>
    {/if}
  </div>
{/if}

<style>
  .texto {
    margin: 6px 0;
    padding: 6px 0;
    border-top: 1px solid #ffffff14;
    font-size: 11px;
  }
  .secao {
    color: #9aa0b4;
    margin-bottom: 2px;
  }
  .dim {
    color: #9aa0b4;
  }
  .linha {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 3px 0;
    flex-wrap: wrap;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font-size: 12px;
  }
  .trad {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 6px;
    margin: 3px 0;
  }
  .trad label {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .trad input {
    width: 100%;
    min-width: 0;
    font-size: 11px;
  }
  .cod {
    color: #9aa0b4;
    width: 20px;
    flex: none;
  }
  .trad label.atual .cod {
    color: #4a9eff;
  }
  .trad label.estoura input {
    outline: 1px solid #e0a030;
  }
  input[type="number"] {
    width: 48px;
  }
  select {
    font-size: 11px;
  }
  button {
    padding: 1px 6px;
    font-size: 12px;
  }
  button.on {
    background: #2b6cb0;
    color: #fff;
  }
  .sep {
    width: 6px;
  }
  .aviso {
    color: #f0b040;
    margin-top: 4px;
  }
</style>
