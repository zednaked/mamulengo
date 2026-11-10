<script lang="ts">
  // A tabela de idiomas (docs/EDITOR.md "Texto"): as chaves nas linhas, os idiomas nas colunas, cada
  // célula editável; a célula que estoura a caixa de algum texto fica marcada. Importa e exporta o
  // translations.csv do Godot (keys,pt,en,...). Clique no código de um idioma para vê-lo no viewport.
  import { app } from "./state.svelte.ts";
  import { execute } from "../core/commands/index.ts";
  import { IDIOMAS_FROTA, NOMES_IDIOMA } from "../core/texto.ts";

  const tr = $derived.by(() => {
    app.version;
    return ((app.doc?.json as any)?.translations ?? { languages: [], strings: {} }) as { languages: string[]; strings: Record<string, string[]> };
  });
  // as chaves que algum texto usa, e as celulas que estouram (chave + idioma)
  const usos = $derived.by(() => {
    app.version;
    const m = new Map<string, string[]>();
    for (const sk of (app.doc?.json as any)?.skins ?? [])
      for (const [sl, ps] of Object.entries<any>(sk.attachments ?? {})) for (const a of Object.values<any>(ps)) if (a?.type === "text" && a.key) m.set(a.key, [...(m.get(a.key) ?? []), sl]);
    return m;
  });
  const estouram = $derived.by(() => {
    app.version;
    app.versaoTextos;
    const t = app.viewer?.nucleo?.textos;
    const out = new Set<string>();
    if (!t) return out;
    try {
      for (const e of t.estouros()) {
        const d = t.textos.find((x) => x.nome === e.nome);
        if (d?.chave) out.add(`${d.chave}|${e.idioma}`);
      }
    } catch {}
    return out;
  });
  let novaChave = $state("");
  let entrada: HTMLInputElement | undefined = $state();

  const set = (args: any, rotulo: string, merge?: string) => app.run({ cmd: "i18n.set", args }, rotulo, merge);
  function celula(k: string, l: string, v: string) {
    set({ key: k, values: { [l]: v } }, `${k} em ${l}`, `trad-${k}-${l}`);
  }
  function addChave() {
    const k = novaChave.trim();
    if (!k) return;
    set({ key: k, values: { [tr.languages[0] ?? "pt"]: "" } }, `chave ${k}`);
    novaChave = "";
  }
  function addIdioma(l: string) {
    if (!l || tr.languages.includes(l)) return;
    set({ languages: [...tr.languages, l] }, `idioma ${l}`);
  }
  function frota() {
    set({ languages: [...tr.languages, ...IDIOMAS_FROTA.filter((l) => !tr.languages.includes(l))] }, "os 12 idiomas da frota");
  }
  async function importar(f: File | undefined) {
    if (!f) return;
    const r = await app.runAsync({ cmd: "i18n.import", args: { csv: await f.text() } }, `importa ${f.name}`);
    if (r) app.avisar(`${f.name}: ${r[0].imported} chaves; a tabela tem ${r[0].keys} chaves em ${r[0].languages.length} idiomas.`);
  }
  function exportar() {
    if (!app.doc) return;
    const csv = execute(app.doc, { cmd: "i18n.export", args: {} }, "ui")[0].csv as string;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "translations.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<div class="idiomas">
  <div class="topo">
    <b>Tabela de idiomas</b>
    <span class="dim">{Object.keys(tr.strings).length} chaves · {tr.languages.length} idiomas</span>
    <span class="esp"></span>
    <button onclick={() => entrada?.click()} title="junta um translations.csv do Godot (keys,pt,en,...): o que ele traz vale">importar CSV</button>
    <input bind:this={entrada} type="file" accept=".csv,text/csv" hidden onchange={(e) => importar((e.target as HTMLInputElement).files?.[0])} />
    <button onclick={exportar} title="baixa a tabela como translations.csv">exportar CSV</button>
    <select value="" onchange={(e) => { addIdioma((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }}>
      <option value="">+ idioma…</option>
      {#each IDIOMAS_FROTA.filter((l) => !tr.languages.includes(l)) as l}<option value={l}>{l} · {NOMES_IDIOMA[l]}</option>{/each}
    </select>
    {#if IDIOMAS_FROTA.some((l) => !tr.languages.includes(l))}<button onclick={frota} title="pt, en, es, hi, ru, fr, it, ne, ar, fil, de, nl">+ os 12 da frota</button>{/if}
    <button onclick={() => (app.tabelaIdiomas = false)} title="fechar">✕</button>
  </div>
  <div class="rolar">
    <table>
      <thead>
        <tr>
          <th>chave</th>
          {#each tr.languages as l}
            <th class:atual={(app.idioma || tr.languages[0]) === l}><button class="cod" onclick={() => app.usarIdioma(l)} title="ver {NOMES_IDIOMA[l] ?? l} no viewport">{l}</button></th>
          {/each}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each Object.entries(tr.strings) as [k, v] (k)}
          <tr>
            <td class="chave" title={usos.get(k) ? `usada em ${usos.get(k)!.join(", ")}` : "nenhum texto usa esta chave"}>{k}{#if !usos.get(k)}<span class="dim"> ·</span>{/if}</td>
            {#each tr.languages as l, i}
              <td class:falta={!v[i]} class:estoura={estouram.has(`${k}|${l}`)}>
                <input dir="auto" value={v[i] ?? ""} onchange={(e) => celula(k, l, (e.target as HTMLInputElement).value)} title={estouram.has(`${k}|${l}`) ? "estoura a caixa de um texto que usa esta chave" : ""} />
              </td>
            {/each}
            <td><button class="tira" onclick={() => set({ key: k, delete: true }, `tira ${k}`)} title="tirar a chave (os textos com ela voltam ao texto livre)">✕</button></td>
          </tr>
        {/each}
        <tr>
          <td><input placeholder="NOVA_CHAVE" bind:value={novaChave} onkeydown={(e) => e.key === "Enter" && addChave()} /></td>
          <td colspan={tr.languages.length + 1}><button onclick={addChave}>+ chave</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<style>
  .idiomas {
    position: absolute;
    top: 40px;
    right: 8px;
    left: 8px;
    max-height: 55%;
    z-index: 6;
    display: flex;
    flex-direction: column;
    background: #15151df2;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 6px;
    font-size: 11px;
  }
  .topo {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .esp {
    flex: 1;
  }
  .dim {
    color: #889;
  }
  .rolar {
    overflow: auto;
  }
  table {
    border-collapse: collapse;
  }
  th,
  td {
    border: 1px solid #2a2a36;
    padding: 1px 2px;
  }
  th.atual {
    background: #2b6cb055;
  }
  td.chave {
    color: #cfd3e0;
    white-space: nowrap;
  }
  td input {
    width: 110px;
    font-size: 11px;
    background: transparent;
    border: none;
    color: inherit;
  }
  td.falta input {
    background: #ffffff0a;
  }
  td.estoura {
    background: #f0b04033;
  }
  button {
    font-size: 11px;
    padding: 1px 6px;
  }
  .cod {
    background: none;
    border: none;
    color: #cfd3e0;
    cursor: pointer;
  }
  .tira {
    background: none;
    border: none;
    color: #889;
  }
  select {
    font-size: 11px;
  }
</style>
