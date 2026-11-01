<script lang="ts">
  // Versoes do personagem, alem do desfazer: cada gravacao vira versao; da para marcar
  // com nome, ver o que mudou, comparar com o atual e restaurar (o atual vira versao antes).
  import { app } from "./state.svelte.ts";

  let list = $state<any[]>([]);
  let label = $state("");
  let busy = $state(false);
  let open = $state<string | null>(null);
  let diff = $state<{ id: string; changes: string[] } | null>(null);
  let confirm = $state<string | null>(null);

  $effect(() => {
    app.versionsTick;
    app.asset;
    load();
  });

  async function load() {
    try {
      list = await app.versions();
    } catch (e: any) {
      list = [];
    }
  }

  async function mark() {
    if (!label.trim()) return;
    busy = true;
    try {
      await app.markVersion(label.trim());
      label = "";
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      busy = false;
    }
  }

  async function compare(id: string) {
    try {
      const d = await app.diffVersion(id);
      diff = { id, changes: d.changes };
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    }
  }

  async function restore(id: string) {
    if (confirm !== id) {
      confirm = id;
      return;
    }
    confirm = null;
    busy = true;
    try {
      await app.restoreVersion(id);
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      busy = false;
    }
  }

  // o arquivo (.boneco): formato, arte HD a partir do SVG, relevo
  let info = $state<{ binario: boolean; bytes: number } | null>(null);
  $effect(() => {
    app.versionsTick;
    const t = app.asset?.tres;
    info = null;
    if (t?.endsWith(".boneco")) fetch(`/api/boneco/info?p=${encodeURIComponent(t)}`).then((r) => (r.ok ? r.json() : null)).then((j) => (info = j));
  });
  let svgInput = $state<HTMLInputElement>();
  let fator = $state(3);
  let idSvg = $state("{nome}");
  let fatorLeve = $state(0.5);
  async function arteHd(f: FileList | null) {
    const svg = f?.[0];
    if (!svg) return;
    await app.arteHd(svg, fator, idSvg);
    if (svgInput) svgInput.value = "";
  }

  const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
</script>

<div class="versions">
  {#if !app.asset}
    <p class="dim">Abra um personagem.</p>
  {:else}
    {#if info}
      <div class="arquivo">
        <div class="tit">Arquivo</div>
        <div class="linha">
          <span>formato: <b>{info.binario ? "binário" : "texto"}</b> · {Math.round(info.bytes / 1024)} KB</span>
          <button disabled={app.relevoRodando} onclick={() => app.converterFormato(!info!.binario)} title={info.binario ? "Volta a gravar em texto (JSON): maior, mas legível e com diff no git" : "Grava em binário: bem menor e mais rápido de carregar no jogo; o editor continua lendo e gravando"}>{info.binario ? "para texto" : "para binário"}</button>
        </div>
        <div class="linha">
          <span title="A página do atlas refeita a partir do vetor original da arte (cada imagem pelo objeto do SVG com o id dela), nítida de perto">arte HD do SVG</span>
          <select bind:value={fator} title="quantas vezes maior">
            <option value={2}>2x</option>
            <option value={3}>3x</option>
            <option value={4}>4x</option>
          </select>
          <input class="id" bind:value={idSvg} title="o id no SVG de cada imagem: {'{nome}'} vira o nome dela, * casa qualquer trecho" />
          <button disabled={app.relevoRodando} onclick={() => svgInput?.click()}>SVG…</button>
          <input bind:this={svgInput} type="file" accept=".svg,image/svg+xml" hidden onchange={(e) => arteHd((e.target as HTMLInputElement).files)} />
        </div>
        <div class="linha">
          <span title="O mapa de normais das páginas, calculado da própria arte, para as luzes iluminarem as peças">relevo</span>
          <button disabled={app.relevoRodando} onclick={() => app.gerarRelevo()}>{app.relevoRodando ? "trabalhando…" : /^relevo:/m.test(app.doc?.atlas.text ?? "") ? "refazer" : "gerar"}</button>
        </div>
        <div class="linha">
          <span title="Uma cópia para aparelhos fracos: todas as imagens juntas no menor número de páginas (menos trocas de textura) e em resolução menor. Sai ao lado, como <nome>-leve.boneco; o esqueleto e as animações são os mesmos">versão leve</span>
          <select bind:value={fatorLeve} title="a resolução das páginas">
            <option value={0.5}>metade</option>
            <option value={0.25}>um quarto</option>
            <option value={1}>inteira (só junta)</option>
          </select>
          <button disabled={app.relevoRodando} onclick={() => app.versaoLeve(fatorLeve)}>gerar</button>
        </div>
        <p class="dim small">Formato, arte HD e relevo regravam o arquivo: o editor salva antes e reabre depois; para desfazer, restaure a versão de antes, logo abaixo.</p>
      </div>
    {/if}
    <div class="mark">
      <input bind:value={label} placeholder="nome da versão" title="Ex: aprovado pela direção de arte" onkeydown={(e) => e.key === "Enter" && mark()} />
      <button class="go" onclick={mark} disabled={busy || !label.trim()} title="Salva e guarda o estado atual com esse nome">Marcar</button>
    </div>
    <p class="dim small">Cada vez que salva vira uma versão. Restaurar guarda o estado atual antes, então da para voltar.</p>
    {#if !list.length}
      <p class="dim">Nenhuma versão ainda: a primeira aparece quando salvar.</p>
    {/if}
    {#each list as v (v.id)}
      <div class="v" class:named={!!v.label}>
        <div class="row">
          <span class="who" title={v.source === "claude" ? "feita pelo Claude" : "feita na tela"}>{v.source === "claude" ? "🤖" : "🙂"}</span>
          <b class="name">{v.label ?? "salvo"}</b>
          <span class="spacer"></span>
          <span class="dim small">{when(v.at)}</span>
        </div>
        <button class="changes" onclick={() => (open = open === v.id ? null : v.id)}>
          {#each open === v.id ? v.changes : v.changes.slice(0, 2) as c}
            <div>{c}</div>
          {/each}
          {#if v.changes.length > 2 && open !== v.id}<div class="dim">+{v.changes.length - 2} (ver tudo)</div>{/if}
        </button>
        <div class="row">
          <button class="mini" onclick={() => compare(v.id)}>comparar com o atual</button>
          <button class="mini" class:warn={confirm === v.id} onclick={() => restore(v.id)} disabled={busy}>{confirm === v.id ? "confirmar restaurar?" : "restaurar"}</button>
        </div>
        {#if diff?.id === v.id}
          <div class="diff">
            <div class="dim small">desta versão para o atual:</div>
            {#each diff?.changes ?? [] as c}<div>{c}</div>{/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .arquivo {
    border: 1px solid var(--line, #3a3448);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }
  .arquivo .tit {
    font-weight: 600;
    font-size: 13px;
  }
  .arquivo .linha {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    flex-wrap: wrap;
  }
  .arquivo .linha > span {
    flex: 1;
    min-width: 0;
  }
  .arquivo .id {
    width: 70px;
  }
  .versions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    font-size: 12px;
    overflow: auto;
  }
  .mark {
    display: flex;
    gap: 6px;
  }
  .mark input {
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .spacer {
    flex: 1;
  }
  .dim {
    color: var(--dim);
  }
  .small {
    font-size: 11px;
  }
  .v {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .v.named {
    border-color: var(--accent);
  }
  .name {
    font-size: 12px;
  }
  .changes {
    all: unset;
    cursor: pointer;
    color: #d6d0e0;
    line-height: 1.35;
  }
  .mini {
    padding: 1px 6px;
    font-size: 11px;
  }
  .warn {
    background: #e05561;
    border-color: #e05561;
    color: white;
  }
  .go {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .diff {
    border-top: 1px solid var(--line);
    padding-top: 4px;
  }
</style>
