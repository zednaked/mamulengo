<script lang="ts">
  // Esqueleto: so ossos, que e o que se mexe. As imagens ficam na aba Ordem.
  import { app } from "./state.svelte.ts";

  let filter = $state("");
  let collapsed = $state<Record<string, boolean>>({});

  type Node = { name: string; depth: number; kids: number; animated: boolean };

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
    const walk = (n: string, d: number) => {
      if (!f || n.toLowerCase().includes(f)) out.push({ name: n, depth: f ? 0 : d, kids: kids.get(n)?.length ?? 0, animated: animated.has(n) });
      if (!f && collapsed[n]) return;
      for (const c of kids.get(n) ?? []) walk(c, d + 1);
    };
    if (j.bones[0]) walk(j.bones[0].name, 0);
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
</script>

<div class="tree">
  <div class="top">
    <input class="search" placeholder="procurar osso" bind:value={filter} />
    {#if app.hidden.bones.length || app.hidden.slots.length}<button class="all" onclick={() => app.showAll()} title="mostrar tudo de novo">mostrar tudo</button>{/if}
  </div>
  <div class="list" bind:this={listEl}>
    {#each nodes as n (n.name)}
      <div class="bone" data-bone={n.name} class:sel={app.selection.bone === n.name} style:padding-left="{6 + n.depth * 12}px">
        {#if n.kids}
          <button class="tw" onclick={() => (collapsed[n.name] = !collapsed[n.name])}>{collapsed[n.name] ? "▸" : "▾"}</button>
        {:else}
          <span class="tw"></span>
        {/if}
        <button class="name" class:off={app.hidden.bones.includes(n.name)} onclick={() => pick(n.name)}>
          <span class="ico">🦴</span>{n.name}
          {#if n.animated}<span class="dot" title="animado nesta animacao"></span>{/if}
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
