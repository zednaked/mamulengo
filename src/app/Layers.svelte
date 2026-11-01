<script lang="ts">
  // Ordem: as imagens do personagem na ordem de desenho (a de cima fica na frente),
  // como as camadas do Photoshop. Cada uma diz qual imagem mostra agora e qual osso a
  // move; clicar escolhe a camada e esse osso (arrastar na tela move o osso).
  import { app } from "./state.svelte.ts";
  import { movingBone } from "./interact.ts";

  let filter = $state("");

  // skins: variacoes de visual (outra roupa, outra cor). A escolhida e a mostrada, e imagem nova
  // numa camada entra nela
  const skins = $derived((app.version, (app.doc?.json.skins ?? []).map((s: any) => s.name as string)));
  let renSkin = $state<string | null>(null);
  let textoSkin = $state("");
  const livre = (base: string) => {
    let n = base;
    for (let k = 2; skins.includes(n); k++) n = `${base}_${k}`;
    return n;
  };
  function novaSkin(copia: boolean) {
    const de = app.skinEdicao;
    const nome = livre(copia ? `${de}_copia` : "skin");
    if (app.run({ cmd: "skin.create", args: { name: nome, ...(copia ? { copyFrom: de } : {}) } }, copia ? `duplica a skin ${de}` : "skin nova")) {
      app.verSkin(nome);
      app.avisar(copia ? `${nome} é uma cópia de ${de}: troque as imagens das camadas (aba Imagens ou o inspetor) e elas mudam só nela.` : `${nome} está vazia: as imagens que você puser nas camadas agora entram nela (o que ela não tem vem da padrão).`);
    }
  }
  function renomearSkin() {
    const de = renSkin;
    renSkin = null;
    const para = textoSkin.trim();
    if (!de || !para || para === de) return;
    if (app.run({ cmd: "skin.rename", args: { name: de, to: para } }, `renomeia a skin ${de}`)) app.verSkin(para);
  }
  function apagarSkin(nome: string) {
    if (app.run({ cmd: "skin.delete", args: { name: nome } }, `apaga a skin ${nome}`)) {
      app.verSkin(null);
      app.avisar(`A skin ${nome} foi apagada. Ctrl+Z desfaz.`);
    }
  }
  // trocas que ainda nao entraram e brilhos apagados: so com o filtro ou pedindo
  let showHidden = $state(false);

  type Row = { slot: string; image: string | null; region: string | null; bone: string; hidden: boolean; glow: boolean; related: boolean; boneHidden: boolean };

  // a ordem vem do desenho ja calculado (o viewer), que so pega a mudanca no quadro seguinte: a
  // lista se refaz de novo depois dele. Sem isso, na Pose base (nada tocando) ela ficava com a
  // ordem velha ate trocar de aba
  let quadro = $state(0);
  $effect(() => {
    app.version;
    let id = requestAnimationFrame(() => (id = requestAnimationFrame(() => quadro++)));
    return () => cancelAnimationFrame(id);
  });

  const rows = $derived.by((): Row[] => {
    app.version;
    quadro;
    app.play.time;
    app.play.animation;
    const sk = app.viewer?.pose;
    if (!sk) return [];
    const f = filter.trim().toLowerCase();
    const out: Row[] = [];
    const order = sk.drawOrder();
    app.hidden.bones;
    // osso escolhido no Esqueleto: as camadas que ele (ou um filho dele) move ficam marcadas
    const sel = app.selection.slot ? null : app.selection.bone;
    const under = (b: string) => {
      if (!sel) return false;
      for (let x: any = sk.findBone(b); x; x = x.parent) if (x.name === sel) return true;
      return false;
    };
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i];
      const att = s.part;
      const name = s.name;
      if (f && !name.toLowerCase().includes(f) && !(att?.name ?? "").toLowerCase().includes(f)) continue;
      const hidden = !att || s.color.a < 0.05;
      if (hidden && !showHidden && !f) continue;
      out.push({
        slot: name,
        image: att?.name ?? null,
        region: att?.image ?? null,
        bone: movingBone(sk, name),
        hidden,
        glow: s.blend === "additive" || s.blend === "screen",
        related: under(movingBone(sk, name)),
        boneHidden: !app.hidden.slots.includes(name) && !!app.viewer?.isSlotHidden(s),
      });
    }
    return out;
  });

  // arrastar e soltar: a lista mostra da frente para tras; o indice da ordem de desenho
  // (0 = mais atras) e o inverso da posicao na lista completa
  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);
  function drop(target: string) {
    const from = dragging;
    dragging = over = null;
    if (!from || from === target) return;
    const order = app.layerOrder().filter((x) => x !== from);
    const k = order.indexOf(target);
    // soltar sobre uma camada coloca na frente dela (acima na lista)
    if (k >= 0) app.moveLayer(from, k + 1);
  }

  // a lista rola ate a camada escolhida e a centraliza, se ela estiver fora de vista
  let listEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    const sl = app.selection.slot;
    rows;
    if (!sl || !listEl) return;
    requestAnimationFrame(() => {
      const el = listEl?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(sl)}"]`);
      if (!el || !listEl) return;
      const r = el.getBoundingClientRect(),
        box = listEl.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });

  const thumb = (region: string) => `/api/region?atlas=${encodeURIComponent(app.doc!.file.atlas!)}&name=${encodeURIComponent(region)}&v=${app.version}`;
</script>

<div class="layers">
  {#if app.doc}
    <div class="skins" title="Skins: variações de visual do personagem (outra roupa, outra cor). A escolhida é a mostrada, e imagem nova numa camada entra nela">
      <span class="dim">skin</span>
      {#if renSkin}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="ren-skin" bind:value={textoSkin} onkeydown={(e) => (e.key === "Enter" ? renomearSkin() : e.key === "Escape" && (renSkin = null))} onblur={renomearSkin} autofocus />
      {:else}
        <select value={app.skinEdicao} onchange={(e) => app.verSkin((e.target as HTMLSelectElement).value)}>
          {#each skins as n}<option value={n}>{n}</option>{/each}
        </select>
      {/if}
      <button onclick={() => novaSkin(true)} title="duplicar esta skin (para trocar só algumas imagens)">⧉</button>
      <button onclick={() => novaSkin(false)} title="skin nova vazia (o que ela não tem vem da padrão)">+</button>
      {#if app.skin}
        <button onclick={() => ((renSkin = app.skin), (textoSkin = app.skin ?? ""))} title="renomear esta skin">✎</button>
        <button onclick={() => apagarSkin(app.skin!)} title="apagar esta skin (Ctrl+Z desfaz)">🗑</button>
      {/if}
    </div>
  {/if}
  <input class="search" placeholder="procurar" title="Procurar camada ou imagem" bind:value={filter} />
  <div class="hint" title="A lista vai da frente (em cima) para trás (embaixo). Arraste uma linha para mudar a ordem; numa animação isso vira chave no instante atual. Embaixo do nome: a imagem e o osso que move a peça.">↑ frente · arraste para reordenar</div>
  <label class="hint"><input type="checkbox" bind:checked={showHidden} /> mostrar as escondidas agora</label>
  <div class="list" bind:this={listEl}>
    {#each rows as r (r.slot)}
      <div class="line" data-slot={r.slot} class:over={over === r.slot} draggable="true" role="listitem" ondragstart={() => (dragging = r.slot)} ondragover={(e) => (e.preventDefault(), (over = r.slot))} ondragleave={() => over === r.slot && (over = null)} ondrop={(e) => (e.preventDefault(), drop(r.slot))} ondragend={() => (dragging = over = null)}>
      <button class="row" class:sel={app.selection.slot === r.slot} class:rel={r.related} class:hidden={r.hidden || r.boneHidden || app.hidden.slots.includes(r.slot)} onclick={() => app.select({ bone: r.bone, slot: r.slot })} title={r.hidden ? "escondida neste instante" : r.slot}>
        <span class="th">{#if r.region && app.doc?.file.atlas}<img src={thumb(r.region)} alt="" loading="lazy" />{/if}</span>
        <span class="txt">
          <span class="name">{r.slot}{#if r.glow}<span class="tag">brilho</span>{/if}</span>
          <span class="sub">{r.hidden ? "escondida" : r.image !== r.slot ? r.image : ""}{r.hidden || r.image !== r.slot ? " · " : ""}🦴 {r.bone}</span>
        </span>
      </button>
      <button class="eye" class:shut={app.hidden.slots.includes(r.slot) || r.boneHidden} onclick={() => app.toggleHidden("slots", r.slot)} title={r.boneHidden ? `escondida pelo olho do osso ${r.bone} (Esqueleto)` : app.hidden.slots.includes(r.slot) ? "mostrar esta camada" : "esconder esta camada (so na tela)"}>{app.hidden.slots.includes(r.slot) || r.boneHidden ? "◡" : "👁"}</button>
      </div>
    {/each}
    {#if rows.length > 3}<div class="hint fundo">↓ trás</div>{/if}
  </div>
</div>

<style>
  .skins {
    display: flex;
    gap: 4px;
    align-items: center;
    margin-bottom: 6px;
    font-size: 12px;
  }
  .skins select,
  .ren-skin {
    flex: 1;
    min-width: 0;
  }
  .skins button {
    padding: 2px 6px;
    font-size: 12px;
  }
  .layers {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 6px;
  }
  .search {
    width: 100%;
  }
  .hint {
    font-size: 11px;
    color: var(--dim);
  }
  .hint.fundo {
    padding: 4px 2px;
  }
  .list {
    overflow: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .line {
    display: flex;
    align-items: center;
    border-top: 2px solid transparent;
  }
  .line.over {
    border-top-color: var(--accent);
  }
  .line .row {
    flex: 1;
    min-width: 0;
  }
  .eye {
    flex: none;
    width: 24px;
    background: none;
    border: none;
    font-size: 12px;
    opacity: 0.35;
  }
  .line:hover .eye,
  .eye.shut {
    opacity: 1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 3px 4px;
    text-align: left;
  }
  .row:hover {
    background: #2c2834;
  }
  .row.rel {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .row.sel {
    background: #3a2433;
  }
  .row.hidden {
    opacity: 0.45;
  }
  .th {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    background: #15131b;
    border-radius: 4px;
    overflow: hidden;
  }
  .th img {
    max-width: 100%;
    max-height: 100%;
  }
  .txt {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    gap: 5px;
    align-items: center;
  }
  .sub {
    font-size: 11px;
    color: var(--dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    font-size: 9px;
    padding: 0 4px;
    border-radius: 4px;
    background: #4a3a1a;
    color: #f2c94c;
  }
</style>
