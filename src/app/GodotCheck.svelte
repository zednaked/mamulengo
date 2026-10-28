<script lang="ts">
  import { app } from "./state.svelte.ts";

  let open = $state(false);
  let busy = $state(false);
  let editorImg = $state<string | null>(null);
  let godotImg = $state<string | null>(null);
  let diff = $state<number | null>(null);
  let note = $state("");

  // compara o enquadramento atual: editor e Godot no mesmo instante
  async function check() {
    const v = app.viewer;
    const doc = app.doc;
    if (!v || !doc?.file.tres) return;
    if (doc.dirty) return app.toast("Salve antes de ver no Godot: ele le o arquivo do disco.");
    busy = true;
    open = true;
    editorImg = godotImg = null;
    diff = null;
    note = "renderizando no Godot…";
    try {
      v.view.playing = false;
      const w = Math.round(v.canvas.clientWidth),
        h = Math.round(v.canvas.clientHeight);
      const rect = [v.cam.x - w / 2 / v.cam.zoom, v.cam.y - h / 2 / v.cam.zoom, w / v.cam.zoom, h / v.cam.zoom];
      const bg = [0.2, 0.2, 0.2];
      const ed = v.renderRect(rect, [w, h], bg);
      editorImg = ed.toDataURL("image/png");
      const r = await fetch("/api/godot/render", { method: "POST", body: JSON.stringify({ tres: doc.file.tres, animation: v.view.animation, time: v.view.time, rect, size: [w, h], background: bg }) });
      if (!r.ok) throw new Error((await r.json()).error);
      if (r.headers.get("x-imported") === "true") note = "o Godot importou o projeto antes (primeira vez). ";
      else note = "";
      const blob = await r.blob();
      godotImg = URL.createObjectURL(blob);
      // diferenca: pixels com algum canal diferindo mais de 24
      const gb = await createImageBitmap(blob);
      const c1 = new OffscreenCanvas(w, h).getContext("2d")!;
      c1.drawImage(ed, 0, 0);
      const c2 = new OffscreenCanvas(w, h).getContext("2d")!;
      c2.drawImage(gb, 0, 0);
      const a = c1.getImageData(0, 0, w, h).data,
        b = c2.getImageData(0, 0, w, h).data;
      let bad = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) bad++;
      diff = (100 * bad) / (w * h);
      note += diff < 0.5 ? "igual ao jogo." : diff < 3 ? "praticamente igual (diferencas de borda)." : "ha diferencas visiveis: veja as imagens.";
    } catch (e: any) {
      note = String(e?.message ?? e);
    } finally {
      busy = false;
    }
  }
</script>

<button onclick={check} disabled={!app.doc || busy} title="Renderiza este quadro no Godot e compara com o editor">{busy ? "Godot…" : "ver no Godot"}</button>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal" onclick={() => !busy && (open = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="box" onclick={(e) => e.stopPropagation()}>
      <div class="row">
        <figure><figcaption>Mamulengo</figcaption>{#if editorImg}<img src={editorImg} alt="editor" />{/if}</figure>
        <figure><figcaption>Godot (spine-godot do projeto)</figcaption>{#if godotImg}<img src={godotImg} alt="godot" />{:else}<div class="wait">{busy ? "…" : ""}</div>{/if}</figure>
      </div>
      <div class="foot">
        {#if diff !== null}<b>{diff.toFixed(2)}%</b> dos pixels diferem ·{/if}
        {note}
        <button onclick={() => (open = false)} disabled={busy}>fechar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: #000a;
    display: grid;
    place-items: center;
    z-index: 100;
  }
  .box {
    background: var(--panel);
    border-radius: 14px;
    padding: 14px;
    max-width: 94vw;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  figure {
    margin: 0;
    flex: 1;
  }
  figcaption {
    font-size: 12px;
    color: var(--dim);
    margin-bottom: 4px;
  }
  img,
  .wait {
    max-width: 44vw;
    max-height: 70vh;
    border-radius: 8px;
    display: block;
  }
  .wait {
    width: 40vw;
    height: 40vh;
    background: #1a1820;
  }
  .foot {
    margin-top: 10px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .foot button {
    margin-left: auto;
  }
</style>
