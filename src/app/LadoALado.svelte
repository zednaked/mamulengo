<script lang="ts">
  // A tela em todos os tamanhos de janela lado a lado (docs/EDITOR.md "Tela"): cada miniatura e a
  // janela inteira desenhada pelo nucleo, no instante da regua. Refaz quando o documento ou o
  // instante mudam (tocando, a cada meio segundo). Clique numa para usar aquele tamanho. Com a tabela
  // de idiomas, uma fileira por idioma escolhido (idioma x tamanho), com o aviso de estouro.
  import { app } from "./state.svelte.ts";
  import { JANELAS, janelaDe, type Janela } from "./janelas.ts";

  const ALT = 120;
  let fotos = $state<{ nome: string; rotulo: string; url: string; w: number; h: number; idioma: string }[]>([]);
  // os idiomas da tabela e os escolhidos para as fileiras (nenhum: so o mostrado)
  const idiomas = $derived.by(() => {
    app.version;
    return ((app.doc?.json as any)?.translations?.languages ?? []) as string[];
  });
  const escolhidos = $derived(app.ladoIdiomas);
  const fileiras = $derived(idiomas.length ? (escolhidos.filter((l) => idiomas.includes(l)).length ? escolhidos.filter((l) => idiomas.includes(l)) : [app.idioma || idiomas[0]]) : [""]);
  const estouros = $derived.by(() => {
    app.version;
    app.versaoTextos;
    try {
      return app.viewer?.nucleo?.textos?.estouros() ?? [];
    } catch {
      return [];
    }
  });
  const alternar = (l: string) => (app.ladoIdiomas = escolhidos.includes(l) ? escolhidos.filter((x) => x !== l) : [...escolhidos, l]);
  let ultima = 0;
  let pendente = 0;

  function fotografar() {
    const v = app.viewer;
    if (!v?.pose || !app.doc || !v.useNucleo) return (fotos = []);
    const antes: Janela | null = v.janela;
    // so a tela: sem selecao, gizmos, ossos nem marcas (como o look)
    const guardado = { overlays: v.overlays, selection: v.selection, highlights: v.highlights, bones: v.view.showBones, meshes: v.view.showMeshes, bounds: v.view.showBounds };
    v.overlays = [];
    v.selection = {};
    v.highlights = [];
    v.view.showBones = v.view.showMeshes = v.view.showBounds = false;
    const out: typeof fotos = [];
    const idiomaAntes = app.idioma || idiomas[0] || "";
    try {
      const lista = [{ nome: "arte", rotulo: "arte base" }, ...JANELAS];
      for (const idioma of fileiras) {
      if (idioma) v.nucleo?.usarIdioma(idioma);
      for (const p of lista) {
        let j: Janela | null;
        try {
          j = janelaDe(app.doc.json, p.nome);
        } catch {
          continue;
        }
        v.setJanela(j);
        const r = v.vistaJanela();
        if (!j || !r || !(r[2] > 0)) continue;
        const h = ALT,
          w = Math.round((ALT * j.w) / j.h);
        const c = v.renderRect(r, [w, h]);
        out.push({ nome: p.nome, rotulo: p.rotulo, url: c.toDataURL("image/png"), w, h, idioma });
      }
      }
    } finally {
      if (idiomaAntes) v.nucleo?.usarIdioma(idiomaAntes);
      v.overlays = guardado.overlays;
      v.selection = guardado.selection;
      v.highlights = guardado.highlights;
      v.view.showBones = guardado.bones;
      v.view.showMeshes = guardado.meshes;
      v.view.showBounds = guardado.bounds;
      v.setJanela(antes);
    }
    fotos = out;
    ultima = performance.now();
  }

  $effect(() => {
    if (!app.ladoALado) return;
    app.version;
    app.play.time;
    app.play.animation;
    app.janela;
    app.idioma;
    app.versaoTextos;
    fileiras;
    // tocando, no maximo duas vezes por segundo; parado, logo depois da mudanca
    const espera = app.play.playing ? Math.max(0, 500 - (performance.now() - ultima)) : 30;
    clearTimeout(pendente);
    pendente = window.setTimeout(fotografar, espera);
    return () => clearTimeout(pendente);
  });

  function usar(nome: string, idioma: string) {
    const v = app.viewer;
    if (!v || !app.doc) return;
    if (idioma) app.usarIdioma(idioma);
    app.usarJanela(janelaDe(app.doc.json, nome));
    const r = v.vistaJanela();
    if (r) v.frameRect(r, 1.2);
  }
</script>

{#if app.ladoALado}
  <div class="lado">
    {#if !fotos.length}
      <span class="dim">{app.runtime !== "nucleo" ? "lado a lado só no desenho do núcleo" : "sem tela: screen.set (arte base) no inspetor da raiz"}</span>
    {/if}
    {#if idiomas.length}
      <div class="idi" title="os idiomas das fileiras (idioma x tamanho); nenhum marcado: o mostrado">
        {#each idiomas as l}
          <button class:on={escolhidos.includes(l)} class:aviso={estouros.some((e) => e.idioma === l)} onclick={() => alternar(l)}>{l}</button>
        {/each}
      </div>
    {/if}
    <div class="fileiras">
      {#each fileiras as idioma}
        <div class="fileira">
          {#each fotos.filter((f) => f.idioma === idioma) as f (f.nome + f.idioma)}
            {@const est = estouros.filter((e) => e.idioma === f.idioma)}
            <button class="foto" class:on={app.janela?.nome === f.nome && (!f.idioma || (app.idioma || idiomas[0]) === f.idioma)} onclick={() => usar(f.nome, f.idioma)} title="usar {f.rotulo}{f.idioma ? ` em ${f.idioma}` : ""}{est.length ? `\n⚠ estoura: ${est.map((e) => e.nome).join(", ")}` : ""}">
              <img src={f.url} alt={f.rotulo} width={f.w} height={f.h} />
              <span>{f.rotulo}{f.idioma ? ` · ${f.idioma}` : ""}{#if est.length}<b class="av"> ⚠{est.length}</b>{/if}</span>
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .lado {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 30px;
    max-height: 70%;
    overflow-y: auto;
    z-index: 5;
    display: flex;
    gap: 8px;
    align-items: flex-end;
    overflow-x: auto;
    background: #101016e6;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 6px;
  }
  .fileiras {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fileira {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .idi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: none;
  }
  .idi button {
    font-size: 10px;
    padding: 0 5px;
  }
  .idi button.on {
    background: #2b6cb0;
    color: #fff;
  }
  .idi button.aviso {
    border-color: #f0b040;
  }
  .av {
    color: #f0b040;
  }
  .foto {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: none;
    border: 1px solid #333;
    flex: none;
  }
  .foto.on {
    border-color: #4a9eff;
  }
  .foto span {
    font-size: 10px;
    color: #aab;
  }
  img {
    display: block;
    background: #000;
  }
  .dim {
    color: #889;
    font-size: 11px;
  }
</style>
