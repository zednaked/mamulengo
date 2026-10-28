<script lang="ts">
  import { app } from "./state.svelte.ts";
  import { parseAtlas } from "../core/atlas-text.ts";

  let filter = $state("");
  let busy = $state(false);
  let input: HTMLInputElement | undefined = $state();

  const regions = $derived.by(() => {
    app.version;
    const text = app.doc?.atlas.text;
    if (!text) return [];
    const f = filter.trim().toLowerCase();
    return parseAtlas(text)
      .regions.filter((r) => !f || r.name.toLowerCase().includes(f))
      .map((r) => ({ name: r.name, w: r.originalWidth, h: r.originalHeight }));
  });

  const thumb = (name: string) => `/api/region?atlas=${encodeURIComponent(app.doc!.file.atlas!)}&name=${encodeURIComponent(name)}&v=${app.version}`;

  // envia PNGs do computador para images/ do asset e reempacota o atlas
  async function upload(files: FileList | null) {
    if (!files?.length || !app.doc?.file.atlas) return;
    busy = true;
    try {
      for (const f of files) {
        const name = f.name.replace(/\.[^.]+$/, "");
        const r = await fetch(`/api/atlas/upload?atlas=${encodeURIComponent(app.doc.file.atlas)}&name=${encodeURIComponent(name)}`, { method: "POST", body: await f.arrayBuffer() });
        if (!r.ok) throw new Error((await r.json()).error);
      }
      const r = await fetch("/api/atlas/add", { method: "POST", body: JSON.stringify({ atlas: app.doc.file.atlas, files: [] }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await app.reloadAtlas(j.atlasText);
      app.log({ label: `${files.length} imagem(ns) adicionada(s)`, source: "ui", kind: "info", ops: 0 });
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      busy = false;
    }
  }

  // com um slot escolhido, clicar troca/adiciona a imagem nele (fantasia, olho fechado...)
  function useInSlot(name: string) {
    const s = app.selection.slot;
    if (!s) return app.toast("Arraste a imagem para o personagem, ou escolha uma parte para trocar a imagem dela.");
    const slot = app.doc!.json.slots.find((x: any) => x.name === s);
    const cur = slot?.attachment ? app.doc!.json.skins?.[0]?.attachments?.[s]?.[slot.attachment] : null;
    const calls: any[] = [];
    if (!app.doc!.json.skins?.some((sk: any) => sk.attachments?.[s]?.[name])) {
      // nova imagem no mesmo lugar da atual
      const place = cur && (cur.type ?? "region") === "region" ? { x: cur.x, y: cur.y, rotation: cur.rotation, scaleX: cur.scaleX, scaleY: cur.scaleY } : {};
      calls.push({ cmd: "attachment.region", args: { slot: s, name, ...place } });
    }
    if (app.mode === "animate" && app.play.animation) calls.push({ cmd: "key.set", args: { anim: app.play.animation, target: { slot: s }, timeline: "attachment", time: +app.play.time.toFixed(4), name } });
    else calls.push({ cmd: "slot.set", args: { slot: s, attachment: name } });
    app.run(calls, `${name} em ${s}`);
  }
</script>

<div class="imgs">
  <div class="bar">
    <input placeholder="procurar imagem" bind:value={filter} />
    <button disabled={!app.doc || busy} onclick={() => input?.click()} title="Adicionar imagens do computador">{busy ? "…" : "+ imagens"}</button>
    <input bind:this={input} type="file" accept="image/png,image/webp,image/jpeg" multiple hidden onchange={(e) => upload((e.target as HTMLInputElement).files)} />
  </div>
  <div class="hint dim">Arraste para o personagem para criar uma parte nova.</div>
  <div class="grid">
    {#each regions as r (r.name)}
      <button class="cell" draggable="true" ondragstart={(e) => e.dataTransfer?.setData("text/mamulengo-image", r.name)} onclick={() => useInSlot(r.name)} title="{r.name} ({r.w}x{r.h})">
        <img src={thumb(r.name)} alt={r.name} loading="lazy" />
        <span>{r.name}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .imgs {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    flex: 1;
  }
  .bar {
    display: flex;
    gap: 6px;
  }
  .bar input {
    flex: 1;
    min-width: 0;
  }
  .hint {
    font-size: 11px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    overflow-y: auto;
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px;
    background: #1a1820;
    cursor: grab;
  }
  .cell img {
    width: 100%;
    height: 70px;
    object-fit: contain;
    background:
      repeating-conic-gradient(#2a2633 0% 25%, #221f29 0% 50%) 50% / 12px 12px;
    border-radius: 6px;
    pointer-events: none;
  }
  .cell span {
    font-size: 11px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
