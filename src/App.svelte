<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./app/state.svelte.ts";
  import Viewport from "./app/Viewport.svelte";
  import Timeline from "./app/Timeline.svelte";
  import Tree from "./app/Tree.svelte";
  import Layers from "./app/Layers.svelte";
  import Inspector from "./app/Inspector.svelte";
  import Activity from "./app/Activity.svelte";
  import AssetPicker from "./app/AssetPicker.svelte";
  import Recipes from "./app/Recipes.svelte";
  import Ficha from "./app/Ficha.svelte";
  import Versions from "./app/Versions.svelte";
  import Notes from "./app/Notes.svelte";
  import Images from "./app/Images.svelte";
  import GodotCheck from "./app/GodotCheck.svelte";
  import Onboarding from "./app/Onboarding.svelte";
  import PsdImport from "./app/PsdImport.svelte";
  import { connectBridge } from "./bridge/client.ts";
  import { deleteVertex, stopMeshEdit } from "./app/meshedit.ts";

  let showBones = $state(false);
  let leftTab = $state<"bones" | "layers" | "images" | "versions">("bones");

  // tamanhos dos paineis (arrastar as alças; clique duplo volta ao padrao), guardados no navegador
  const LAYOUT0 = { left: 240, right: 280, foot: 220, act: 110 };
  let layout = $state({ ...LAYOUT0 });
  try {
    Object.assign(layout, JSON.parse(localStorage.getItem("mamulengo.layout") ?? "{}"));
  } catch {}
  const LIMITS: Record<keyof typeof LAYOUT0, [number, () => number]> = {
    left: [150, () => window.innerWidth * 0.45],
    right: [200, () => window.innerWidth * 0.5],
    foot: [90, () => window.innerHeight * 0.7],
    act: [40, () => window.innerHeight * 0.6],
  };
  // preferencias da interface guardadas no servidor (~/.local/share/mamulengo/preferencias.json):
  // o localStorage e separado por porta e por perfil (app, bancadas, espectador); o arquivo
  // vale em todos. O localStorage fica como copia para abrir na hora.
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: Record<string, any> = {};
  function savePrefs(part: Record<string, any>) {
    pending = { ...pending, ...part };
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => {
      const body = JSON.stringify(pending);
      pending = {};
      fetch("/api/prefs", { method: "PUT", body }).catch(() => {});
    }, 400);
  }
  let prefsLoaded = $state(false);
  fetch("/api/prefs")
    .then((r) => r.json())
    .then((p) => {
      if (p.layout) Object.assign(layout, p.layout);
      if (p.leftTab) leftTab = p.leftTab;
      if (p.rightTab) app.rightTab = p.rightTab;
      if (typeof p.legenda === "boolean") app.showNarration = p.legenda;
    })
    .catch(() => {})
    .finally(() => (prefsLoaded = true));
  $effect(() => {
    const l = leftTab,
      r = app.rightTab;
    if (prefsLoaded) savePrefs({ leftTab: l, rightTab: r });
  });

  function resize(e: PointerEvent, key: keyof typeof LAYOUT0, dir: 1 | -1, axis: "x" | "y") {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = axis === "x" ? e.clientX : e.clientY,
      v0 = layout[key];
    const move = (ev: PointerEvent) => {
      const d = ((axis === "x" ? ev.clientX : ev.clientY) - start) * dir;
      const [lo, hi] = LIMITS[key];
      layout[key] = Math.round(Math.max(lo, Math.min(hi(), v0 + d)));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      try {
        localStorage.setItem("mamulengo.layout", JSON.stringify(layout));
      } catch {}
      savePrefs({ layout: { ...layout } });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
  function resetSize(key: keyof typeof LAYOUT0) {
    layout[key] = LAYOUT0[key];
    try {
      localStorage.setItem("mamulengo.layout", JSON.stringify(layout));
    } catch {}
    savePrefs({ layout: { ...layout } });
  }
  let guide = $state(false);
  let showMeshes = $state(false);
  let saving = $state(false);

  const dirty = $derived((app.version, app.doc?.dirty ?? false));
  const canUndo = $derived((app.version, app.doc?.canUndo() ?? false));
  const canRedo = $derived((app.version, app.doc?.canRedo() ?? false));

  // Acompanhar o agente: ligado (padrao), ao abrir ou ao ligar o selo, se um agente esta
  // trabalhando, vai para a cena dele (bancada em outra porta: espectador de la; agente
  // nesta porta em outra aba: esta aba vira espectadora). Desligado, fica onde esta. A
  // escolha fica guardada no navegador (o selo no topo liga e desliga).
  let follow = $state(true);
  try {
    // ?acompanhar=0|1 vem do selo de outra porta (o espectador da bancada) e vale aqui tambem
    const pedido = new URLSearchParams(location.search).get("acompanhar");
    if (pedido === "0" || pedido === "1") localStorage.setItem("mamulengo.acompanhar", pedido);
    follow = localStorage.getItem("mamulengo.acompanhar") !== "0";
  } catch {}
  async function followAgent(): Promise<boolean> {
    const q = new URLSearchParams(location.search);
    if (q.has("espectador") || !follow) return false;
    try {
      const s = await fetch("/api/sessoes").then((r) => r.json());
      const fora = (s.outras ?? []).find((o: any) => String(o.port) !== location.port);
      if (fora) {
        location.href = `http://localhost:${fora.port}/?espectador&volta=${encodeURIComponent(location.origin + location.pathname)}`;
        return true;
      }
      // so vira espectadora se o agente trabalha num editor sem janela (headless); ligado direto
      // na ponte, ele trabalha nesta aba
      if (s.local?.ativo && (s.local.headless ?? 0) > 0) {
        location.href = `${location.pathname}?espectador`;
        return true;
      }
    } catch {}
    return false;
  }
  async function toggleFollow() {
    follow = !follow;
    try {
      localStorage.setItem("mamulengo.acompanhar", follow ? "1" : "0");
    } catch {}
    if (!follow && app.spectator) {
      // desligou dentro do acompanhamento: volta ao editor de onde veio (ou a este, sem espelho)
      const volta = new URLSearchParams(location.search).get("volta");
      location.href = (volta ?? location.pathname) + "?acompanhar=0";
    } else if (follow && !app.spectator && !(await followAgent()))
      app.toast(app.agentHere && app.agentConnected ? "o Claude esta trabalhando aqui, nesta janela: nao ha outra para acompanhar" : "nenhum agente trabalhando agora: o editor acompanha quando um comecar (ao abrir)");
  }
  // titulo da aba: quem e quem quando ha varias abas abertas
  $effect(() => {
    const name = app.asset?.name ?? "";
    document.title = app.spectator ? `👁 acompanhando ${name || "o Claude"}` : app.agentHere && app.agentConnected ? `🤖 ${name} · Mamulengo` : name ? `${name} · Mamulengo` : "Mamulengo";
  });
  // legenda some sozinha depois de um tempo sem fala nova
  let now = $state(Date.now());
  setInterval(() => (now = Date.now()), 1000);
  try {
    app.showNarration = localStorage.getItem("mamulengo.legenda") !== "0";
  } catch {}
  function toggleNarration() {
    app.showNarration = !app.showNarration;
    try {
      localStorage.setItem("mamulengo.legenda", app.showNarration ? "1" : "0");
    } catch {}
    savePrefs({ legenda: app.showNarration });
  }

  onMount(async () => {
    if (await followAgent()) return;
    connectBridge();
    await app.loadAssets();
    let last: string | null = null;
    try {
      last = localStorage.getItem("mamulengo.last");
    } catch {}
    // o espectador mostra o que o agente tiver aberto, nao o ultimo personagem desta aba
    const a = last && !app.spectator ? app.assets.find((x) => x.id === last) : null;
    // espera o viewer existir (montado pelo Viewport)
    const wait = (): Promise<void> => (app.viewer ? Promise.resolve() : new Promise((r) => setTimeout(r, 30)).then(wait));
    await wait();
    if (a) app.open(a).catch(() => {});
  });

  $effect(() => {
    if (!app.viewer) return;
    app.viewer.view.showBones = showBones;
    app.viewer.view.showMeshes = showMeshes;
    app.viewer.onion.enabled = app.onion;
  });

  async function save() {
    saving = true;
    try {
      await app.save();
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      saving = false;
    }
  }

  function keys(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? app.redo() : app.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      app.redo();
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!app.spectator) save();
    } else if (!mod && e.key === "f") app.viewer?.frameAll();
    else if (!mod && (e.key === "PageUp" || e.key === "PageDown") && app.selection.slot) {
      // ordem de desenho da camada escolhida: passo inteligente; com Shift, topo ou fundo
      e.preventDefault();
      const s = app.selection.slot;
      if (e.shiftKey) app.moveLayer(s, e.key === "PageUp" ? app.layerOrder().length - 1 : 0);
      else app.stepLayer(s, e.key === "PageUp" ? 1 : -1);
    } else if (!mod && e.key === "1") app.tool = "move";
    else if (!mod && e.key === "2") app.tool = "rotate";
    else if (!mod && e.key === "3") app.tool = "scale";
    else if (!mod && e.key === "4") app.tool = "deform";
    else if (!mod && e.key === "5") (app.tool = "bone"), (app.mode = "setup");
    else if (!mod && (e.key === "6" || e.key === "h")) app.tool = "pan";
    else if (!mod && e.key === "[") app.brushRadius = Math.max(15, app.brushRadius / 1.2);
    else if (!mod && e.key === "]") app.brushRadius = Math.min(250, app.brushRadius * 1.2);
    else if (app.meshEdit && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      deleteVertex();
    } else if (app.meshEdit && e.key === "Escape") {
      if (app.meshEdit.vertex !== null) app.meshEdit.vertex = null;
      else stopMeshEdit();
    } else if (!mod && e.key === "Escape") app.select({});
  }

  $effect(() => {
    if (!app.toastMsg) return;
    const at = app.toastMsg.at;
    const t = setTimeout(() => app.toastMsg?.at === at && (app.toastMsg = null), 4000);
    return () => clearTimeout(t);
  });
</script>

<svelte:window onkeydown={keys} />

<div class="app" style:grid-template-columns="{layout.left}px minmax(0, 1fr) {layout.right}px" style:grid-template-rows="auto minmax(0, 1fr) {layout.foot}px">
  <header>
    <div class="brand"><img src="/favicon.svg" alt="" /> Mamulengo</div>
    <AssetPicker />
    <PsdImport />
    <div class="seg tools">
      <button class:on={app.tool === "move"} onclick={() => (app.tool = "move")} title="Mover (1)">✥ Mover</button>
      <button class:on={app.tool === "rotate"} onclick={() => (app.tool = "rotate")} title="Girar (2)">⟳ Girar</button>
      <button class:on={app.tool === "scale"} onclick={() => (app.tool = "scale")} title="Esticar (3)">⤢ Esticar</button>
      <button class:on={app.tool === "deform"} onclick={() => (app.tool = "deform")} title="Deformar a imagem (4)">🖌 Deformar</button>
      <button class:on={app.tool === "bone"} onclick={() => ((app.tool = "bone"), (app.mode = "setup"))} title="Criar osso arrastando (5). Leva para a Pose base: osso novo vale para todas as animacoes">🦴 Osso</button>
      <button class:on={app.tool === "pan"} onclick={() => (app.tool = "pan")} title="Mover a camera arrastando (6 ou H). Tambem: botao do meio ou direito, ou segurar Espaco">✋ Camera</button>

    </div>
    <div class="seg">
      <button disabled={!canUndo} onclick={() => app.undo()} title="Desfazer (Ctrl+Z)">↶</button>
      <button disabled={!canRedo} onclick={() => app.redo()} title="Refazer (Ctrl+Shift+Z)">↷</button>
    </div>
    <div class="seg">
      <button class:on={showBones} onclick={() => (showBones = !showBones)}>ossos</button>
      <button class:on={showMeshes} onclick={() => (showMeshes = !showMeshes)}>malhas</button>
      <button class:on={app.onion} onclick={() => (app.onion = !app.onion)} title="Fantasmas dos quadros vizinhos (pausado)">cebola</button>
      <button onclick={() => app.viewer?.frameAll()} title="Enquadrar (F)">enquadrar</button>
      <select class="runtime" value={app.runtime} onchange={(e) => app.setRuntime((e.currentTarget as HTMLSelectElement).value as any)} title="Quem desenha o viewport. godot: como o spine-godot dos jogos de hoje (com os defeitos medidos); spine: como o editor do Spine; nucleo: o nucleo proprio (wasm) com a semantica do jogo novo">
        <option value="godot">desenho: godot</option>
        <option value="spine">desenho: spine</option>
        <option value="nucleo">desenho: nucleo</option>
      </select>
      <GodotCheck />
    </div>
    <div class="spacer"></div>
    <button class="help" title="Como usar" onclick={() => (guide = true)}>?</button>
    <div class="agent" class:on={app.agentConnected} title="O Claude esta operando este editor">🤖 {app.agentConnected ? "Claude conectado" : "Claude"}</div>
    {#if app.narration.text}<button class="talk" class:off={!app.showNarration} onclick={toggleNarration} title="Mostrar ou esconder a legenda com o que o Claude diz">💬</button>{/if}
    {#if app.spectator}
      <div class="spect" title="Esta aba so assiste ao editor que o Claude esta usando: navegue a vontade (animacao, instante, camera, partes); nada aqui e salvo">acompanhando o Claude</div>
    {/if}
    <button class="follow" class:on={follow} onclick={toggleFollow} title={follow ? "Acompanhar o Claude: ligado. Ao abrir, se ele estiver trabalhando, o editor vai para a cena dele. Clique para desligar e trabalhar em outro lugar" : "Acompanhar o Claude: desligado. Clique para ligar"}>👁 acompanhar {follow ? "✓" : "✗"}</button>
    {#if !app.spectator}
      <button class="save" class:dirty disabled={!app.doc || saving} onclick={save} title="Salvar no projeto (Ctrl+S)">{saving ? "salvando…" : dirty ? "● Salvar" : "Salvo"}</button>
    {/if}
  </header>

  <aside class="left panel">
    <div class="tabs">
      <button class:on={leftTab === "bones"} onclick={() => (leftTab = "bones")} title="Esqueleto: o que mexe o que (hierarquia dos ossos)">Esqueleto</button>
      <button class:on={leftTab === "layers"} onclick={() => (leftTab = "layers")} title="Ordem de desenho: o que fica na frente do que, e o osso que move cada imagem">Ordem</button>
      <button class:on={leftTab === "images"} onclick={() => (leftTab = "images")}>Imagens</button>
      <button class:on={leftTab === "versions"} onclick={() => (leftTab = "versions")} title="Versoes salvas: marcar, comparar, restaurar">Versoes</button>
    </div>
    {#if leftTab === "bones"}<Tree />{:else if leftTab === "layers"}<Layers />{:else if leftTab === "images"}<Images />{:else}<Versions />{/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grip col right-edge" title="Arraste para mudar a largura (clique duplo: padrao)" onpointerdown={(e) => resize(e, "left", 1, "x")} ondblclick={() => resetSize("left")}></div>
  </aside>
  <main class="view"><Viewport /></main>
  <aside class="right panel">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grip col left-edge" title="Arraste para mudar a largura (clique duplo: padrao)" onpointerdown={(e) => resize(e, "right", -1, "x")} ondblclick={() => resetSize("right")}></div>
    <div class="tabs">
      <button class:on={app.rightTab === "edit"} onclick={() => (app.rightTab = "edit")}>Mexer</button>
      <button class:on={app.rightTab === "ficha"} onclick={() => (app.rightTab = "ficha")} title="O que a animacao deve fazer, limites e regras conferidas"
        >Ficha{#if app.fichaFails}<span class="fails">{app.fichaFails}</span>{/if}</button
      >
      <button class:on={app.rightTab === "notas"} onclick={() => (app.rightTab = "notas")} title="Anotacoes da equipe e do Claude neste personagem"
        >Notas{#if app.notes.some((n) => n.estado === "aberta")}<span class="fails notes">{app.notes.filter((n) => n.estado === "aberta").length}</span>{/if}</button
      >
    </div>
    <div class="scroll" class:hidden={app.rightTab !== "edit"}>
      {#if !app.meshEdit}<Recipes />{/if}
      <Inspector />
    </div>
    <div class="scroll" class:hidden={app.rightTab !== "ficha"}><Ficha /></div>
    <div class="scroll" class:hidden={app.rightTab !== "notas"}><Notes /></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="sep" title="Arraste para mudar a altura da Atividade (clique duplo: padrao)" onpointerdown={(e) => resize(e, "act", -1, "y")} ondblclick={() => resetSize("act")}>Atividade</div>
    <div class="act-box" style:height="{layout.act}px"><Activity /></div>
  </aside>
  <footer class="panel">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grip row top-edge" title="Arraste para mudar a altura da timeline (clique duplo: padrao)" onpointerdown={(e) => resize(e, "foot", -1, "y")} ondblclick={() => resetSize("foot")}></div>
    <Timeline />
  </footer>

  {#if !app.spectator}<Onboarding bind:open={guide} />{/if}
  {#if app.showNarration && app.narration.text && now - app.narration.at < 20000}
    <div class="caption">🤖 {app.narration.text.length > 280 ? app.narration.text.slice(0, 280) + "…" : app.narration.text}</div>
  {/if}
  {#if app.spectator && !app.doc}
    <div class="spect-wait">Modo espectador: esperando o Claude abrir um personagem no editor que ele esta usando.</div>
  {/if}

  {#if app.draft}
    <div class="draft">
      Encontrei alteracoes nao salvas de {new Date(app.draft.at).toLocaleString("pt-BR")} neste personagem.
      <button class="ok" onclick={() => app.restoreDraft()}>Recuperar</button>
      <button onclick={() => app.discardDraft()}>Descartar</button>
    </div>
  {/if}

  {#if app.toastMsg}
    <div class="toast">{app.toastMsg.text}</div>
  {/if}
</div>

<style>
  .app {
    display: grid;
    grid-template-areas:
      "head head head"
      "left view right"
      "foot foot foot";
    gap: 8px;
    padding: 8px;
    height: 100vh;
  }
  header {
    grid-area: head;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    row-gap: 6px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 17px;
    letter-spacing: 0.01em;
    margin-right: 6px;
  }
  .brand img {
    width: 26px;
    height: 26px;
  }
  .seg {
    display: flex;
    gap: 2px;
    background: var(--panel);
    padding: 3px;
    border-radius: 10px;
  }
  .seg button {
    border: none;
    background: none;
  }
  .seg button.on {
    background: var(--accent);
  }
  .seg select.runtime {
    border: none;
    background: none;
    color: inherit;
    font: inherit;
  }
  .tools button {
    font-size: 15px;
    padding: 6px 12px;
  }
  .brush {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    color: var(--dim);
  }
  .brush input {
    width: 80px;
  }
  .spacer {
    flex: 1;
  }
  .help {
    width: 32px;
    border-radius: 50%;
    font-weight: 700;
  }
  .agent {
    font-size: 12px;
    color: var(--dim);
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
  }
  .agent.on {
    color: var(--claude);
    border-color: var(--claude);
  }
  .save {
    min-width: 96px;
  }
  .save.dirty {
    background: var(--accent2);
    border-color: var(--accent2);
    color: #1d1a24;
    font-weight: 600;
  }
  .panel {
    background: var(--panel);
    border-radius: var(--radius);
    padding: 10px;
    min-height: 0;
    overflow: hidden;
  }
  .left {
    grid-area: left;
  }
  .view {
    grid-area: view;
    min-height: 0;
    min-width: 0;
  }
  .right {
    grid-area: right;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .scroll {
    overflow-y: auto;
    min-height: 0;
    flex: 1 1 auto;
  }
  .act-box {
    flex: 0 0 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .act-box :global(.act) {
    flex: 1 1 auto;
    max-height: none;
    min-height: 0;
  }
  aside.panel,
  footer.panel {
    position: relative;
  }
  .grip {
    position: absolute;
    z-index: 20;
    touch-action: none;
  }
  .grip:hover,
  .grip:active {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .grip.col {
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: col-resize;
  }
  .grip.right-edge {
    right: 0;
  }
  .grip.left-edge {
    left: 0;
  }
  .grip.row {
    left: 0;
    right: 0;
    height: 7px;
    cursor: row-resize;
  }
  .grip.top-edge {
    top: 0;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hidden {
    display: none !important;
  }
  .fails.notes {
    background: #c99a1f;
  }
  .fails {
    background: #e05561;
    color: white;
    border-radius: 9px;
    padding: 0 6px;
    margin-left: 5px;
    font-size: 11px;
  }
  .spect {
    padding: 6px 12px;
    border-radius: 8px;
    background: #2a2140;
    color: #c9b6ff;
    font-size: 13px;
    white-space: nowrap;
  }
  .talk.off {
    opacity: 0.4;
  }
  .follow {
    white-space: nowrap;
    font-size: 12px;
    opacity: 0.6;
  }
  .follow.on {
    opacity: 1;
    border-color: #6b55a8;
    color: #c9b6ff;
  }
  .caption {
    position: fixed;
    left: 50%;
    bottom: 250px;
    transform: translateX(-50%);
    max-width: min(900px, 70vw);
    padding: 10px 16px;
    border-radius: 12px;
    background: rgba(20, 16, 30, 0.88);
    border: 1px solid #4a3a6a;
    color: #eee6ff;
    font-size: 15px;
    line-height: 1.4;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    pointer-events: none;
    z-index: 50;
    white-space: pre-wrap;
  }
  .spect-wait {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 14px 18px;
    border-radius: 10px;
    background: #2a2140;
    color: #c9b6ff;
  }
  .tabs {
    display: flex;
    gap: 2px;
    background: var(--bg);
    padding: 3px;
    border-radius: 10px;
  }
  .tabs button {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    padding: 4px 2px;
    font-size: 12px;
  }
  .tabs button.on {
    background: var(--panel2);
  }
  .sep {
    cursor: row-resize;
    user-select: none;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--dim);
    border-top: 1px solid var(--line);
    padding-top: 10px;
    margin-top: 6px;
  }
  footer {
    grid-area: foot;
  }
  .draft {
    position: fixed;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    background: #2d2512;
    border: 1px solid var(--accent2);
    padding: 10px 14px;
    border-radius: 10px;
    z-index: 50;
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .draft .ok {
    background: var(--accent2);
    color: #1d1a24;
    border-color: var(--accent2);
    font-weight: 600;
  }
  .toast {
    position: fixed;
    bottom: 32vh;
    left: 50%;
    transform: translateX(-50%);
    background: #3a1820;
    border: 1px solid var(--err);
    padding: 10px 16px;
    border-radius: 10px;
    max-width: 70vw;
    z-index: 50;
  }
</style>
