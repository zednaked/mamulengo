<script lang="ts">
  // Esqueleto: so ossos, que e o que se mexe. As imagens ficam na aba Ordem.
  import { app } from "./state.svelte.ts";

  let filter = $state("");
  let collapsed = $state<Record<string, boolean>>({});

  // trilhas: para cada nivel acima, se ainda vem irmao depois (linha vertical continua); ultimo:
  // o ultimo filho do pai (o canto da linha fecha)
  type Node = { name: string; depth: number; kids: number; animated: boolean; parent?: string; trilhas: boolean[]; ultimo: boolean };

  const nodes = $derived.by((): Node[] => {
    app.version;
    const j = app.doc?.json;
    if (!j) return [];
    const kids = new Map<string, string[]>();
    for (const b of j.bones) if (b.parent) kids.set(b.parent, [...(kids.get(b.parent) ?? []), b.name]);
    const anim = app.play.animation ? j.animations?.[app.play.animation] : null;
    const animated = new Set<string>(Object.keys(anim?.bones ?? {}));
    const f = filter.trim().toLowerCase();
    const out: Node[] = [];
    const pai = new Map<string, string>(j.bones.filter((b: any) => b.parent).map((b: any) => [b.name, b.parent]));
    const walk = (n: string, d: number, trilhas: boolean[], ultimo: boolean) => {
      if (!f || n.toLowerCase().includes(f)) out.push({ name: n, depth: f ? 0 : d, kids: kids.get(n)?.length ?? 0, animated: animated.has(n), parent: pai.get(n), trilhas: f ? [] : trilhas, ultimo });
      if (!f && collapsed[n]) return;
      const cs = kids.get(n) ?? [];
      cs.forEach((c, i) => walk(c, d + 1, d ? [...trilhas, !ultimo] : [], i === cs.length - 1));
    };
    if (j.bones[0]) walk(j.bones[0].name, 0, [], true);
    return out;
  });

  // escolher uma camada (aba Ordem) aponta para o osso que a move: abre os pais para ele
  // aparecer na arvore
  $effect(() => {
    const b = app.selection.bone;
    const j = app.doc?.json;
    if (!b || !j) return;
    const parent = new Map<string, string>(j.bones.filter((x: any) => x.parent).map((x: any) => [x.name, x.parent]));
    for (let p = parent.get(b); p; p = parent.get(p)) if (collapsed[p]) collapsed[p] = false;
  });

  // a lista rola ate o osso escolhido (na tela, na aba Ordem ou pelo Claude) e o
  // centraliza, se ele estiver fora de vista
  let listEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    const b = app.selection.bone;
    nodes;
    if (!b || !listEl) return;
    requestAnimationFrame(() => {
      const el = listEl?.querySelector<HTMLElement>(`[data-bone="${CSS.escape(b)}"]`);
      if (!el || !listEl) return;
      const r = el.getBoundingClientRect(),
        box = listEl.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });

  function pick(bone: string) {
    app.select({ bone });
  }

  // arrastar um osso sobre outro troca o pai (so na Pose base: muda o esqueleto de todas as
  // animacoes); o osso fica parado na tela
  let arrastando = $state<string | null>(null);
  let sobre = $state<string | null>(null);
  function soltar(alvo: string) {
    const osso = arrastando;
    arrastando = sobre = null;
    if (!osso || osso === alvo) return;
    if (app.mode !== "setup" && app.play.animation) return app.toast("Trocar o pai de um osso muda o esqueleto: faça isso na Pose base.");
    if (app.run({ cmd: "bone.reparent", args: { bone: osso, parent: alvo, keepWorld: true } }, `pai de ${osso} = ${alvo}`)) {
      app.select({ bone: osso });
      app.avisar(`${osso} agora é filho de ${alvo} (ficou parado na tela). Ctrl+Z desfaz.`);
    }
  }
</script>

<div class="tree">
  <div class="top">
    <input class="search" placeholder="procurar osso" bind:value={filter} />
    {#if app.hidden.bones.length || app.hidden.slots.length}<button class="all" onclick={() => app.showAll()} title="mostrar tudo de novo">mostrar tudo</button>{/if}
  </div>
  <div class="list" bind:this={listEl}>
    {#each nodes as n (n.name)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="bone"
        data-bone={n.name}
        class:sel={app.selection.bone === n.name}
        class:sobre={sobre === n.name && arrastando !== n.name}
        style:padding-left="{6 + n.depth * 14}px"
        ondragover={(e) => arrastando && (e.preventDefault(), (sobre = n.name))}
        ondragleave={() => sobre === n.name && (sobre = null)}
        ondrop={(e) => (e.preventDefault(), soltar(n.name))}
      >
        {#each n.trilhas as t, k}{#if t}<span class="trilha" style:left="{6 + (k + 1) * 14 - 6}px"></span>{/if}{/each}
        {#if n.depth > 0}<span class="ramo" class:ultimo={n.ultimo} style:left="{6 + n.depth * 14 - 6}px"></span>{/if}
        {#if n.kids}
          <button class="tw" onclick={() => (collapsed[n.name] = !collapsed[n.name])}>{collapsed[n.name] ? "▸" : "▾"}</button>
        {:else}
          <span class="tw"></span>
        {/if}
        <button
          class="name"
          class:off={app.hidden.bones.includes(n.name)}
          onclick={() => pick(n.name)}
          draggable={n.depth > 0}
          ondragstart={(e) => ((arrastando = n.name), e.dataTransfer?.setData("text/plain", n.name))}
          ondragend={() => (arrastando = sobre = null)}
          title={n.parent ? `filho de ${n.parent} · arraste sobre outro osso (na Pose base) para trocar o pai` : "a raiz do esqueleto"}
        >
          <span class="ico">🦴</span>{n.name}
          {#if n.animated}<span class="dot" title="animado nesta animação"></span>{/if}
        </button>
        <button class="eye" class:shut={app.hidden.bones.includes(n.name)} onclick={() => app.toggleHidden("bones", n.name)} title={app.hidden.bones.includes(n.name) ? "mostrar este osso (e o que pende dele)" : "esconder este osso e o que pende dele (so na tela)"}>{app.hidden.bones.includes(n.name) ? "◡" : "👁"}</button>
      </div>
    {/each}
  </div>
</div>

<style>
  .tree {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 8px;
  }
  .top {
    display: flex;
    gap: 6px;
  }
  .search {
    width: 100%;
    min-width: 0;
  }
  .all {
    white-space: nowrap;
    font-size: 11px;
    color: var(--accent);
  }
  .eye {
    flex: none;
    width: 24px;
    text-align: center;
    font-size: 12px;
    opacity: 0.35;
  }
  .bone:hover .eye,
  .eye.shut {
    opacity: 1;
  }
  .name.off {
    opacity: 0.4;
    text-decoration: line-through;
  }
  .list {
    overflow: auto;
    flex: 1;
    font-size: 13px;
  }
  .bone {
    display: flex;
    align-items: center;
    border-radius: 6px;
    position: relative;
  }
  .bone.sobre {
    outline: 1px dashed var(--accent2);
    background: #2c2834;
  }
  /* linhas de quem e filho de quem: a vertical dos niveis de cima e o ramo ate este osso */
  .trilha,
  .ramo {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: #4a4356;
    pointer-events: none;
  }
  .ramo.ultimo {
    bottom: 50%;
  }
  .ramo::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    width: 8px;
    height: 1px;
    background: #4a4356;
  }
  .sel {
    background: #3a2433;
  }
  button {
    background: none;
    border: none;
    padding: 3px 4px;
    border-radius: 6px;
    text-align: left;
  }
  button:hover {
    background: #2c2834;
  }
  .tw {
    width: 18px;
    color: var(--dim);
    flex: none;
    font-size: 11px;
  }
  .name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .ico {
    font-size: 11px;
    opacity: 0.7;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
</style>
