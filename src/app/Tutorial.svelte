<script lang="ts">
  // O tutorial de rig e IK: um cartao solto em cima do editor (da para trabalhar com ele aberto),
  // com as licoes de src/core/tutorial.ts. Abre a cena de cada licao (copias em
  // exemplos/tutorial/cenas, server/tutorial.ts), confere sozinho a cada mudanca e recomeca uma
  // cena ou todas a partir dos originais.
  import { app } from "./state.svelte.ts";
  import { LICOES, TRILHAS, licoesDa, type ItemConferido } from "../core/tutorial.ts";
  import { dropDraft } from "./drafts.ts";

  const CHAVE_LICAO = "mamulengo.tutorial.licoes";
  const CHAVE_TRILHA = "mamulengo.tutorial.trilha";
  const CHAVE_FEITAS = "mamulengo.tutorial.feitas";
  const CHAVE_LUGAR = "mamulengo.tutorial.lugar";
  const ler = <T,>(k: string, padrao: T): T => {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : padrao;
    } catch {
      return padrao;
    }
  };
  const gravar = (k: string, v: unknown) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  };

  // a trilha (Tico, Monstro) e a licao aberta em cada uma
  let trilha = $state<string>(TRILHAS.some((t) => t.id === ler(CHAVE_TRILHA, "")) ? ler(CHAVE_TRILHA, "") : TRILHAS[0].id);
  let porTrilha = $state<Record<string, number>>(ler(CHAVE_LICAO, {}));
  const lista = $derived(licoesDa(trilha));
  const atual = $derived(Math.min(lista.length - 1, Math.max(0, porTrilha[trilha] ?? 0)));
  let feitas = $state<string[]>(ler(CHAVE_FEITAS, []));
  let cenas = $state<Record<string, string>>({});
  let erro = $state<string | null>(null);
  let ocupado = $state(false);
  let mini = $state(false);
  // confirmar recomecar: "esta" ou "todas" (o segundo clique confirma)
  let armado = $state<"esta" | "todas" | null>(null);
  let lugar = $state<{ x: number; y: number } | null>(ler(CHAVE_LUGAR, null));

  const licao = $derived(lista[atual]);
  $effect(() => gravar(CHAVE_LICAO, porTrilha));
  $effect(() => gravar(CHAVE_TRILHA, trilha));
  const feitasNa = $derived(lista.filter((l) => feitas.includes(l.id)).length);

  // as cenas no disco: as copias que faltam sao feitas na primeira vez
  async function carregar() {
    erro = null;
    try {
      const r = await fetch("/api/tutorial");
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.status);
      cenas = Object.fromEntries(b.cenas.map((c: any) => [c.id, c.boneco]));
    } catch (e: any) {
      erro = `Não consegui preparar as cenas: ${e.message ?? e}`;
    }
  }
  $effect(() => {
    if (app.tutorial && !Object.keys(cenas).length) void carregar();
  });

  // a cena aberta e a desta licao?
  const nestaCena = $derived(!!app.asset && app.asset.tres === cenas[licao.id]);
  const outraLicao = $derived(app.asset ? LICOES.find((l) => cenas[l.id] === app.asset!.tres) : undefined);

  async function abrir(id = licao.id, semRascunho = false) {
    const arq = cenas[id];
    if (!arq) return;
    ocupado = true;
    try {
      if (semRascunho) await dropDraft(arq);
      await app.loadAssets(true);
      const a = app.assets.find((x) => x.tres === arq);
      if (!a) throw new Error(`a cena não apareceu na lista (${arq})`);
      await app.open(a);
      app.mode = "setup";
    } catch (e: any) {
      app.toast(`Não consegui abrir a cena: ${e.message ?? e}`);
    } finally {
      ocupado = false;
    }
  }

  async function recomecar(todas: boolean) {
    armado = null;
    ocupado = true;
    try {
      const r = await fetch("/api/tutorial/recomecar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(todas ? { trilha } : { id: licao.id }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.status);
      // o trabalho nao salvo voltaria pelo rascunho ao abrir: sai junto
      const ids = todas ? lista.map((l) => l.id) : [licao.id];
      for (const id of ids) if (cenas[id]) await dropDraft(cenas[id]);
      feitas = feitas.filter((f) => !ids.includes(f));
      gravar(CHAVE_FEITAS, feitas);
      if (todas) ir(0);
      const aberta = app.asset && ids.some((id) => cenas[id] === app.asset!.tres);
      if (aberta || !todas) await abrir(todas ? lista[0].id : licao.id, true);
      else ocupado = false;
      app.toast(todas ? `As cenas da trilha ${TRILHAS.find((t) => t.id === trilha)?.titulo} voltaram ao começo.` : `A cena “${licao.titulo}” voltou ao começo.`);
    } catch (e: any) {
      app.toast(`Não consegui recomeçar: ${e.message ?? e}`);
      ocupado = false;
    }
  }

  // conferencia ao vivo: a cada mudanca do documento (com folga, para nao medir no meio de um arrasto)
  let itens = $state<ItemConferido[]>([]);
  let timer = 0;
  $effect(() => {
    app.version;
    const doc = app.doc;
    const l = licao;
    if (!app.tutorial || !doc || !nestaCena) {
      itens = [];
      return;
    }
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        itens = l.conferir(doc.json);
      } catch (e: any) {
        itens = [{ ok: false, texto: `não consegui conferir: ${e.message ?? e}` }];
      }
      if (itens.length && itens.every((i) => i.ok) && !feitas.includes(l.id)) {
        feitas = [...feitas, l.id];
        gravar(CHAVE_FEITAS, feitas);
      }
    }, 250);
  });
  const pronta = $derived(itens.length > 0 && itens.every((i) => i.ok));

  function ir(i: number) {
    porTrilha = { ...porTrilha, [trilha]: Math.max(0, Math.min(lista.length - 1, i)) };
    armado = null;
  }
  function trocarTrilha(t: string) {
    trilha = t;
    armado = null;
  }

  // arrastar o cartao pelo cabecalho
  function arrastar(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    const card = (e.currentTarget as HTMLElement).parentElement!;
    const r = card.getBoundingClientRect();
    const [dx, dy] = [e.clientX - r.left, e.clientY - r.top];
    const mover = (ev: PointerEvent) => {
      lugar = { x: Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) };
    };
    const soltar = () => {
      removeEventListener("pointermove", mover);
      removeEventListener("pointerup", soltar);
      gravar(CHAVE_LUGAR, lugar);
    };
    addEventListener("pointermove", mover);
    addEventListener("pointerup", soltar);
  }
</script>

{#if app.tutorial}
  <div class="card" class:mini style:left={lugar ? `${lugar.x}px` : null} style:top={lugar ? `${lugar.y}px` : null} role="dialog" aria-label="Tutorial de rig e IK">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header onpointerdown={arrastar} title="arraste para mudar o cartão de lugar">
      <span class="cab">🎓 Tutorial de rig e IK</span>
      <span class="conta">{feitasNa}/{lista.length}</span>
      <button class="x" onclick={() => (mini = !mini)} title={mini ? "abrir" : "recolher"}>{mini ? "▾" : "▴"}</button>
      <button class="x" onclick={() => (app.tutorial = false)} title="fechar (o progresso fica guardado)">✕</button>
    </header>
    {#if !mini}
      <div class="trilhas">
        {#each TRILHAS as t}
          <button class:on={t.id === trilha} onclick={() => trocarTrilha(t.id)} title={t.resumo}>{t.icone} {t.titulo} <span class="conta">{licoesDa(t.id).filter((l) => feitas.includes(l.id)).length}/{licoesDa(t.id).length}</span></button>
        {/each}
      </div>
      <nav>
        {#each lista as l, i}
          <button class="bola" class:on={i === atual} class:feita={feitas.includes(l.id)} onclick={() => ir(i)} title="{i + 1}. {l.titulo}{feitas.includes(l.id) ? ' (feita)' : ''}">{feitas.includes(l.id) ? "✓" : i + 1}</button>
        {/each}
      </nav>
      <div class="corpo">
        <h3><span class="ic">{licao.icone}</span>{atual + 1}. {licao.titulo}</h3>
        <p class="aprende">{licao.aprende}</p>
        <p class="tarefa"><b>Nesta cena:</b> {licao.tarefa}</p>
        {#if erro}
          <p class="erro">{erro}</p>
        {:else if !nestaCena}
          <button class="go" disabled={ocupado || !cenas[licao.id]} onclick={() => abrir()}>{ocupado ? "abrindo…" : "Abrir a cena desta lição"}</button>
          {#if outraLicao && outraLicao.id !== licao.id}<p class="dim">Aberta agora: a cena da lição {licoesDa(outraLicao.trilha).indexOf(outraLicao) + 1} da trilha {TRILHAS.find((t) => t.id === outraLicao.trilha)?.titulo}.</p>{/if}
        {/if}
        <ol>
          {#each licao.passos as p}<li>{p}</li>{/each}
        </ol>
        {#if licao.dica}<p class="dica">💡 {licao.dica}</p>{/if}
        {#if nestaCena}
          <div class="confere" class:pronta>
            <div class="ct">{pronta ? "🎉 Feito!" : "Falta:"}</div>
            {#each itens as it}
              <div class="it" class:ok={it.ok}><span class="m">{it.ok ? "✓" : "○"}</span>{it.texto}</div>
            {/each}
          </div>
        {/if}
      </div>
      <footer>
        <button disabled={atual === 0} onclick={() => ir(atual - 1)}>‹ anterior</button>
        {#if armado === "esta"}
          <button class="perigo" disabled={ocupado} onclick={() => recomecar(false)} title="apaga o que foi feito nesta cena, salvo ou não">apagar e recomeçar?</button>
        {:else}
          <button disabled={ocupado || !cenas[licao.id]} onclick={() => (armado = "esta")} title="volta esta cena ao começo">↺ recomeçar a cena</button>
        {/if}
        <button class:go={pronta} disabled={atual === lista.length - 1} onclick={() => ir(atual + 1)}>próxima ›</button>
      </footer>
      <div class="todas">
        {#if armado === "todas"}
          <span>Volta as {lista.length} cenas desta trilha ao começo e zera o progresso dela.</span>
          <button class="perigo" disabled={ocupado} onclick={() => recomecar(true)}>recomeçar tudo</button>
          <button onclick={() => (armado = null)}>não</button>
        {:else}
          <button class="leve" disabled={ocupado} onclick={() => (armado = "todas")}>↺ recomeçar todas as cenas da trilha</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .card {
    position: fixed;
    left: calc(50% - 190px);
    top: 56px;
    width: 380px;
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line, #444);
    border-radius: 10px;
    box-shadow: 0 10px 30px #0008;
    z-index: 150;
    font-size: var(--fs-m);
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    cursor: grab;
    border-bottom: 1px solid var(--line, #444);
    user-select: none;
  }
  .mini header {
    border-bottom: none;
  }
  .cab {
    font-weight: 700;
    flex: 1;
  }
  .conta {
    opacity: 0.7;
    font-size: var(--fs-p);
  }
  .x {
    padding: 0 6px;
    background: none;
    border: none;
  }
  .trilhas {
    display: flex;
    gap: 4px;
    padding: 8px 10px 0;
  }
  .trilhas button {
    flex: 1;
    font-size: var(--fs-p);
  }
  .trilhas button.on {
    outline: 2px solid var(--accent, #ffb400);
    font-weight: 700;
  }
  nav {
    display: flex;
    gap: 4px;
    padding: 8px 10px 0;
  }
  .bola {
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
    font-size: var(--fs-p);
  }
  .bola.feita {
    background: #2e7d4f;
    color: #fff;
  }
  .bola.on {
    outline: 2px solid var(--accent, #ffb400);
  }
  .corpo {
    overflow: auto;
    padding: 4px 12px 8px;
  }
  h3 {
    margin: 6px 0 4px;
    font-size: var(--fs-g);
  }
  .ic {
    margin-right: 6px;
  }
  .aprende {
    margin: 0 0 6px;
    opacity: 0.8;
  }
  .tarefa {
    margin: 0 0 8px;
  }
  ol {
    margin: 6px 0;
    padding-left: 20px;
  }
  li {
    margin-bottom: 4px;
    line-height: 1.35;
  }
  .dica {
    opacity: 0.85;
    font-size: var(--fs-p);
    margin: 6px 0;
  }
  .dim {
    opacity: 0.65;
    font-size: var(--fs-p);
    margin: 4px 0;
  }
  .erro {
    color: #ff7a6a;
  }
  .go {
    background: var(--accent, #ffb400);
    color: #111;
    font-weight: 700;
  }
  .confere {
    margin-top: 8px;
    padding: 8px;
    border-radius: 8px;
    background: #0003;
  }
  .confere.pronta {
    background: #2e7d4f44;
  }
  .ct {
    font-weight: 700;
    margin-bottom: 4px;
  }
  .it {
    display: flex;
    gap: 6px;
    opacity: 0.85;
  }
  .it.ok {
    opacity: 1;
    color: #7fdc9a;
  }
  .m {
    width: 14px;
    flex: none;
  }
  footer {
    display: flex;
    gap: 6px;
    justify-content: space-between;
    padding: 8px 10px;
    border-top: 1px solid var(--line, #444);
  }
  .todas {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 0 10px 8px;
    font-size: var(--fs-p);
  }
  .todas span {
    flex: 1;
  }
  .leve {
    background: none;
    border: none;
    opacity: 0.7;
    font-size: var(--fs-p);
    padding: 0;
    text-decoration: underline;
  }
  .perigo {
    background: #b03c2a;
    color: #fff;
  }
</style>
