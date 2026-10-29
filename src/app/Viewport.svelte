<script lang="ts">
  import { onMount } from "svelte";
  import { Viewer } from "../render/viewer.ts";
  import { app } from "./state.svelte.ts";
  import { beginDrag, beginStroke, cursor, drawGizmo, drawTools, endDrag, endStroke, moveDrag, moveStroke, pickBone, pickPart } from "./interact.ts";
  import { currentMesh, drawMeshEdit, meshDown, meshDragging, meshMove, meshUp, stopMeshEdit } from "./meshedit.ts";

  let canvas: HTMLCanvasElement;
  let panning = $state<{ x: number; y: number; cx: number; cy: number } | null>(null);
  let space = false;
  let downAt: { x: number; y: number } | null = null;
  let dragged = false;

  onMount(() => {
    const v = new Viewer(canvas);
    v.runtime = app.runtime;
    // editando malha, os gizmos de osso saem e entra o desenho da malha
    v.overlays.push((v) => {
      if (app.meshEdit) return drawMeshEdit(v);
      drawGizmo(v);
      drawTools(v);
    });
    v.onFrame(() => {
      const p = app.play;
      const nv = v.view;
      const st = v.sequenceTimes();
      const seq = st && nv.sequence ? { next: st.next, mix: st.mix, at: nv.sequence.at ?? null, loop: !!nv.sequence.loop, start: st.start, end: st.end, total: st.total, durA: st.durA } : null;
      const seqChanged = JSON.stringify(seq) !== JSON.stringify(p.seq);
      if (p.time !== nv.time || p.playing !== nv.playing || p.animation !== nv.animation || p.loop !== nv.loop || p.speed !== nv.speed || seqChanged) {
        app.play = { animation: nv.animation, time: nv.time, duration: v.duration(), playing: nv.playing, loop: nv.loop, speed: nv.speed, seq };
      } else if (p.duration !== v.duration()) app.play = { ...p, duration: v.duration() };
    });
    v.start();
    // ja ha documento aberto (viewport remontado): reconecta
    if (app.doc) app.attachViewer(v);
    else app.viewer = v;
    const keyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) space = true;
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      v.stop();
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  });

  // editar malha mostra a setup pose; sai sozinho se a peca ou o modo mudarem
  $effect(() => {
    const v = app.viewer;
    const on = !!app.meshEdit;
    if (v && v.setupOnly !== on) {
      v.setupOnly = on;
      v.poseAt(v.view.time);
    }
  });
  $effect(() => {
    app.version;
    const me = app.meshEdit;
    if (me && (app.mode !== "setup" || app.selection.slot !== me.slot || !currentMesh())) stopMeshEdit();
  });

  function wheel(e: WheelEvent) {
    const v = app.viewer;
    if (!v) return;
    e.preventDefault();
    const before = v.screenToWorld(e.clientX, e.clientY);
    v.cam.zoom *= Math.exp(-e.deltaY * 0.0015);
    v.cam.zoom = Math.max(0.02, Math.min(40, v.cam.zoom));
    const after = v.screenToWorld(e.clientX, e.clientY);
    v.cam.x += before.x - after.x;
    v.cam.y += before.y - after.y;
  }

  function down(e: PointerEvent) {
    const v = app.viewer;
    if (!v) return;
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || space || app.tool === "pan") {
      panning = { x: e.clientX, y: e.clientY, cx: v.cam.x, cy: v.cam.y };
      return;
    }
    const w = v.screenToSkel(e.clientX, e.clientY);
    downAt = { x: e.clientX, y: e.clientY };
    dragged = false;
    if (app.meshEdit) {
      if (!meshDown(v, v.screenToWorld(e.clientX, e.clientY), e.shiftKey)) downAt = null;
      return;
    }
    // ferramentas de traco (pincel de deform, criar osso) trabalham em coordenadas visuais
    if (app.tool === "deform" || app.tool === "bone") {
      if (!beginStroke(v, v.screenToWorld(e.clientX, e.clientY))) downAt = null;
      return;
    }
    // clicar perto do osso selecionado ja comeca a arrastar; senao seleciona
    const sel = app.selection.bone ? v.skeleton?.findBone(app.selection.bone) : null;
    const near = sel ? Math.hypot(w.x - sel.appliedPose.worldX, w.y - sel.appliedPose.worldY) * v.cam.zoom < 60 : false;
    if (!near) select(w.x, w.y);
    if (app.selection.bone) {
      v.view.playing = false;
      beginDrag(v, w, app.tool);
    }
  }

  function select(x: number, y: number) {
    const v = app.viewer!;
    if (v.view.showBones) {
      const b = pickBone(v, x, y);
      if (b) return app.select({ bone: b });
    }
    // a imagem clicada e o osso que a move naquele ponto (numa malha com pesos, nao o dono do slot)
    const part = v.skeleton ? pickPart(v.skeleton, x, y, (sl) => v.isSlotHidden(sl)) : null;
    if (part) return app.select({ bone: part.bone, slot: part.slot });
    const b = pickBone(v, x, y, 16);
    app.select(b ? { bone: b } : {});
  }

  function move(e: PointerEvent) {
    const v = app.viewer;
    if (!v) return;
    const vis = v.screenToWorld(e.clientX, e.clientY);
    cursor.x = vis.x;
    cursor.y = vis.y;
    cursor.inside = true;
    if (meshDragging()) {
      meshMove(v, vis);
      return;
    }
    if (downAt && app.meshEdit) return;
    if (downAt && (app.tool === "deform" || app.tool === "bone")) {
      moveStroke(v, vis);
      return;
    }
    if (panning) {
      v.cam.x = panning.cx - (e.clientX - panning.x) / v.cam.zoom;
      v.cam.y = panning.cy + (e.clientY - panning.y) / v.cam.zoom;
      return;
    }
    if (downAt && !dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 3) return;
    if (downAt) {
      dragged = true;
      moveDrag(v, v.screenToSkel(e.clientX, e.clientY), e.shiftKey);
    }
  }

  // imagem arrastada da paleta: vira uma parte nova (slot + imagem) onde caiu
  function drop(e: DragEvent) {
    const name = e.dataTransfer?.getData("text/mamulengo-image");
    const v = app.viewer;
    if (!name || !v || !app.doc) return;
    e.preventDefault();
    const at = v.screenToWorld(e.clientX, e.clientY);
    const bone = app.selection.bone ?? app.doc.json.bones[0].name;
    let slot = name.replace(/[^\w.-]+/g, "_");
    for (let n = 2; app.doc.json.slots?.some((x: any) => x.name === slot); n++) slot = `${name}_${n}`;
    const r = app.run(
      [
        { cmd: "slot.add", args: { name: slot, bone, attachment: name } },
        { cmd: "attachment.region", args: { slot, name, world: { center: [at.x, at.y] } } },
      ],
      `nova parte ${slot}`,
    );
    if (r) app.select({ bone, slot });
  }

  function up() {
    panning = null;
    downAt = null;
    endDrag();
    endStroke();
    meshUp();
  }
</script>

<div class="wrap" class:setup={app.doc && app.mode === "setup"}>
  {#if app.doc && app.mode === "setup"}<div class="base-tag" title="Mexer aqui muda o boneco em todas as animacoes">POSE BASE</div>{/if}
  <canvas bind:this={canvas} onmousedown={(e) => e.button === 1 && e.preventDefault()} onwheel={wheel} onpointerdown={down} onpointermove={move} onpointerup={up} onpointerleave={() => (cursor.inside = false)} oncontextmenu={(e) => e.preventDefault()} ondragover={(e) => e.preventDefault()} ondrop={drop} class:pan={space || app.tool === "pan"} class:panning={!!panning}></canvas>
  {#if app.viewer?.error}
    <div class="err">O runtime recusou o documento: {app.viewer.error}</div>
  {:else if app.runtime === "nucleo" && app.viewer?.nucleoError && (app.version, true)}
    <div class="err">O nucleo recusou o documento (desenhando pelo spine-webgl): {app.viewer.nucleoError}</div>
  {/if}
  {#if app.tool === "deform" && app.doc}
    <label class="brush" title="Tamanho do pincel ( [ e ] )">pincel <input type="range" min="15" max="250" bind:value={app.brushRadius} /></label>
  {/if}
  {#if app.meshEdit}
    <div class="meshbar">
      <b>✏️ Editando a malha de {app.meshEdit.attachment}</b>
      <span class="dim">{app.meshEdit.tab === "points" ? "arraste os pontos · clique na borda ou dentro para criar · Delete apaga" : `pinte para ${app.meshEdit.paint === "add" ? "dar" : "tirar"} peso de ${app.meshEdit.bone ?? "um osso"} · Shift inverte`}</span>
      <button class="ok" onclick={stopMeshEdit}>Pronto</button>
    </div>
  {/if}
  {#if app.offerMesh}
    <div class="offer">
      <b>{app.offerMesh.attachment}</b> ainda nao e deformavel.
      <button
        class="ok"
        onclick={async () => {
          const o = app.offerMesh!;
          const bone = app.doc?.json.slots.find((s: any) => s.name === o.slot)?.bone;
          await app.runAsync([{ cmd: "mesh.create", args: { slot: o.slot, name: o.attachment, detail: 1.8 } }], `deixar ${o.attachment} deformavel`);
          app.offerMesh = null;
          void bone;
        }}>Deixar deformavel</button
      >
      <button onclick={() => (app.offerMesh = null)}>Agora nao</button>
    </div>
  {/if}
  {#if !app.doc}
    <div class="empty">
      <div class="big">Escolha um personagem ali em cima</div>
      <div class="dim">ou peça ao Claude: "abre o personagem do monstro"</div>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--radius);
    background: #201d27;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: crosshair;
    touch-action: none;
  }
  .wrap.setup {
    outline: 2px solid #e08a2e;
    outline-offset: -2px;
  }
  .base-tag {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 5;
    background: #e08a2e;
    color: #1d1b22;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.06em;
    padding: 2px 8px;
    border-radius: 4px;
    pointer-events: none;
  }
  canvas.pan {
    cursor: grab;
  }
  canvas.panning {
    cursor: grabbing;
  }
  .err {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    background: #3a1820;
    border: 1px solid var(--err);
    color: #ffd0d0;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
  }
  .brush {
    position: absolute;
    left: 12px;
    top: 12px;
    display: flex;
    gap: 6px;
    align-items: center;
    background: #1a1820cc;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12px;
    color: var(--dim);
  }
  .offer {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: #12262a;
    border: 1px solid #5ee0d0;
    padding: 8px 12px;
    border-radius: 10px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .meshbar {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: #12262acc;
    border: 1px solid #5ee0d0;
    padding: 8px 12px;
    border-radius: 10px;
    display: flex;
    gap: 10px;
    align-items: center;
    white-space: nowrap;
    font-size: 13px;
  }
  .meshbar .ok {
    background: #5ee0d0;
    color: #10201f;
    border-color: #5ee0d0;
    font-weight: 600;
  }
  .offer .ok {
    background: #5ee0d0;
    color: #10201f;
    border-color: #5ee0d0;
    font-weight: 600;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
    gap: 6px;
    pointer-events: none;
  }
  .big {
    font-size: 22px;
    font-weight: 600;
  }
</style>
