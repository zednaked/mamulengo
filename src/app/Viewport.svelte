<script lang="ts">
  // efeitos e particulas (so do Mamulengo): fora do modo nucleo, avisa que nao aparecem
  const extras = $derived.by(() => {
    app.version;
    const j: any = app.doc?.json;
    if (!j) return "";
    const ef = (j.slots ?? []).some((x: any) => x.effects) || Object.values<any>(j.animations ?? {}).some((a) => a.effects);
    const pa = !!j.particles?.length;
    return ef && pa ? "efeitos e particulas" : ef ? "efeitos" : pa ? "particulas" : "";
  });

  import { onMount } from "svelte";
  import { Viewer } from "../render/viewer.ts";
  import { app } from "./state.svelte.ts";
  import { ajudaFerramenta, passoSeta, beginDrag, beginStroke, cursor, drawGizmo, drawHover, drawLigacoes, drawTools, endDrag, endStroke, hover, leituraArrasto, moveDrag, moveStroke, pickBone, pickPart } from "./interact.ts";
  import { currentMesh, drawMeshEdit, meshDown, meshDragging, meshMove, meshUp, stopMeshEdit } from "./meshedit.ts";
  import { drawDown, drawDragging, drawDrawEdit, drawHelp, drawKey, drawMove, drawUp, startDrawEdit, stopDrawEdit } from "./drawedit.ts";
  import { drawingOfSlot } from "../core/commands/desenho.ts";
  import { drawMosaicEdit, mosaicDown, mosaicDragging, mosaicMove, mosaicUp, stopMosaicEdit } from "./mosaicedit.ts";
  import { mosaics } from "../core/commands/mosaic.ts";
  import { auditoriaPixel } from "../core/commands/pixel.ts";

  // pixel perfeito ligado: o que foge da grade de pixel inteiro (docs/ANIMAR.md, secao 6), no
  // setup e na animacao aberta; o botao encaixa (pixel.snap, um passo de desfazer)
  const pixelAvisos = $derived.by(() => {
    app.version;
    const anim = app.play.animation;
    if (!app.doc || !(app.pixel > 0) || app.spectator) return null;
    const r = auditoriaPixel(app.doc.json, anim ?? "\u0000");
    return r.avisos.length ? { total: r.avisos.length, consertaveis: r.avisos.filter((a) => a.conserto).length, lista: r.avisos.map((a) => `${a.onde}: ${a.problema}${a.conserto ? "" : " (só aviso)"}`) } : null;
  });
  // o palco (docs/PALCO.md): jogar a fase no editor, com o teclado
  const temPalco = $derived.by(() => {
    app.version;
    return !!(app.doc?.json as any)?.stage?.actors?.length;
  });
  const jogando = $derived(app.jogando);
  let placar = $state<{ pontos: number; venceu: boolean; morreu: boolean } | null>(null);
  let placarTimer = 0;
  function jogar() {
    const v = app.viewer;
    if (!v) return;
    if (jogando) return pararJogo();
    if (app.runtime !== "nucleo") return app.toast("O palco roda no modo núcleo (ver → núcleo).");
    if (!v.comecarJogo()) return app.toast("Este personagem não tem palco (docs/PALCO.md).");
    app.jogando = true;
  }
  function pararJogo() {
    app.jogando = false;
    app.viewer?.pararJogo();
  }
  // o placar acompanha o jogo, quem quer que jogue (o botao ou a ponte)
  $effect(() => {
    if (!app.jogando) {
      placar = null;
      return;
    }
    const lerPlacar = () => {
      const e = app.viewer?.jogo?.estado;
      placar = e ? { pontos: e.pontos, venceu: e.venceu, morreu: e.morreu } : null;
      placarTimer = requestAnimationFrame(lerPlacar);
    };
    lerPlacar();
    return () => cancelAnimationFrame(placarTimer);
  });
  // as teclas do jogo: setas ou A/D andam, espaco, W ou seta para cima pulam; R recomeca; Esc sai
  const TECLAS: Record<string, number> = { ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, Space: 4, KeyW: 4, ArrowUp: 4 };
  function teclaJogo(e: KeyboardEvent, apertou: boolean): boolean {
    const j = app.viewer?.jogo;
    if (!jogando || !j) return false;
    if (apertou && e.code === "Escape") return (pararJogo(), true);
    if (apertou && e.code === "KeyR") return (app.viewer!.comecarJogo(), true);
    const b = TECLAS[e.code];
    if (!b) return false;
    j.teclas = apertou ? j.teclas | b : j.teclas & ~b;
    return true;
  }
  function encaixarPixel() {
    const anim = app.play.animation;
    const r = app.run({ cmd: "pixel.snap", args: anim ? { anim } : { anim: "\u0000" } }, "encaixa na grade de pixel");
    if (r?.[0]) app.avisar(`${r[0].encaixados} valor(es) encaixado(s) no pixel inteiro${r[0].avisosRestantes.length ? `; ficam ${r[0].avisosRestantes.length} aviso(s) de giro ou escala (decisão de quem anima)` : ""}. Ctrl+Z desfaz.`);
  }
  import { Color } from "@esotericsoftware/spine-webgl";
  import type { Viewer as V } from "../render/viewer.ts";

  // os pontos clicados de uma parte especial e o trecho ate o cursor
  function drawCaptura(v: V) {
    const c = app.captura;
    if (!c) return;
    const s = v.scene;
    const z = v.cam.zoom;
    const fy = v.flip ? -1 : 1;
    const cor = new Color(1, 0.82, 0.3, 1);
    const P = c.pontos.map(([x, y]) => [x, y * fy]);
    const cur = cursor.inside ? [cursor.x, cursor.y] : null;
    const lista = cur && c.tipo !== "point" ? [...P, cur] : P;
    for (let i = 0; i + 1 < lista.length; i++) s.line(lista[i][0], lista[i][1], lista[i + 1][0], lista[i + 1][1], cor);
    if (c.tipo !== "path" && lista.length > 2) s.line(lista[lista.length - 1][0], lista[lista.length - 1][1], lista[0][0], lista[0][1], new Color(1, 0.82, 0.3, 0.4));
    for (const p of P) {
      s.circle(true, p[0], p[1], 5 / z, new Color(0.1, 0.08, 0.12, 1), 12);
      s.circle(true, p[0], p[1], 3.5 / z, cor, 12);
    }
  }

  let canvas: HTMLCanvasElement;
  let panning = $state<{ x: number; y: number; cx: number; cy: number } | null>(null);
  let space = $state(false);
  let downAt: { x: number; y: number } | null = null;
  let dragged = false;
  // o quanto o arrasto mudou, junto do cursor
  let leitura = $state<{ t: string; x: number; y: number } | null>(null);

  // a referencia acompanha a camera: recalcula o retangulo dela a cada quadro de tela
  let refBox = $state<{ left: number; top: number; width: number } | null>(null);
  let refArrasto: { x: number; y: number; rx: number; ry: number } | null = null;
  let refQuadro = $state(-1);
  $effect(() => {
    if (!app.referencia) return;
    let vivo = true;
    const passo = () => {
      const r = app.referencia,
        v = app.viewer;
      if (!vivo) return;
      if (r && v) {
        const w = canvas.clientWidth,
          h = canvas.clientHeight;
        refBox = { left: w / 2 + (r.x - r.largura / 2 - v.cam.x) * v.cam.zoom, top: h / 2 - (r.y - v.cam.y) * v.cam.zoom, width: r.largura * v.cam.zoom };
        // video: o viewer desenha atras do personagem; aqui so passa onde e como anda
        v.refVideo = r.video ? { video: r.video, x: r.x, y: r.y, largura: r.largura, opacidade: r.opacidade, inicio: r.inicio ?? 0, velocidade: r.velocidade ?? 1, repetir: r.repetir !== false, frente: !!r.frente } : null;
        if (r.video && refQuadro !== v.refQuadro) refQuadro = v.refQuadro;
      } else if (v) v.refVideo = null;
      requestAnimationFrame(passo);
    };
    passo();
    return () => (vivo = false);
  });
  function refDown(e: PointerEvent) {
    const r = app.referencia;
    if (!r?.mover) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    refArrasto = { x: e.clientX, y: e.clientY, rx: r.x, ry: r.y };
  }
  function refMove(e: PointerEvent) {
    const r = app.referencia,
      v = app.viewer;
    if (!r || !refArrasto || !v) return;
    r.x = refArrasto.rx + (e.clientX - refArrasto.x) / v.cam.zoom;
    r.y = refArrasto.ry - (e.clientY - refArrasto.y) / v.cam.zoom;
  }

  onMount(() => {
    const v = new Viewer(canvas);
    v.runtime = app.runtime;
    // editando malha, os gizmos de osso saem e entra o desenho da malha
    v.overlays.push((v) => {
      if (app.meshEdit) return drawMeshEdit(v);
      if (app.captura) return drawCaptura(v);
      if (app.drawEdit) return drawDrawEdit(v);
      if (app.mosaicEdit) return drawMosaicEdit(v);
      drawLigacoes(v);
      drawHover(v);
      drawGizmo(v);
      drawTools(v);
    });
    v.onFrame(() => {
      const p = app.play;
      const nv = v.view;
      const st = v.sequenceTimes();
      const seq = st && nv.sequence ? { next: st.next, mix: st.mix, at: nv.sequence.at ?? null, loop: !!nv.sequence.loop, start: st.start, end: st.end, total: st.total, durA: st.durA } : null;
      // campo a campo, so o que mudou: trocar o objeto inteiro a cada quadro fazia tudo que le
      // app.play.animation (as linhas da timeline, com todas as chaves) se refazer tocando
      if (JSON.stringify(seq) !== JSON.stringify(p.seq)) p.seq = seq;
      if (p.animation !== nv.animation) p.animation = nv.animation;
      if (p.time !== nv.time) p.time = nv.time;
      if (p.playing !== nv.playing) p.playing = nv.playing;
      if (p.loop !== nv.loop) p.loop = nv.loop;
      if (p.speed !== nv.speed) p.speed = nv.speed;
      if (p.duration !== v.duration()) p.duration = v.duration();
    });
    v.start();
    // ja ha documento aberto (viewport remontado): reconecta
    if (app.doc) app.attachViewer(v);
    else app.viewer = v;
    const keyDown = (e: KeyboardEvent) => {
      if (!(e.target instanceof HTMLInputElement) && teclaJogo(e, true)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) space = true;
      // setas com o mouse sobre o desenho: a ferramenta em passos (fora dele, a timeline anda)
      const el = e.target as HTMLElement;
      // clicando pontos: Enter conclui, Esc cancela, Backspace tira o ultimo
      if (app.captura && !(el instanceof HTMLInputElement)) {
        if (e.key === "Enter") app.concluirCaptura();
        else if (e.key === "Escape") app.captura = null;
        else if (e.key === "Backspace") app.captura.pontos = app.captura.pontos.slice(0, -1);
        else return;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // desenhando: as teclas da caneta e da selecao (V, P, R, O, Esc, Enter, Delete, setas)
      if (app.drawEdit && !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) && drawKey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (app.mosaicEdit && e.key === "Escape" && !(el instanceof HTMLInputElement)) {
        stopMosaicEdit();
        e.preventDefault();
        return;
      }
      if (e.key.startsWith("Arrow") && cursor.inside && !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && app.viewer && !app.meshEdit) {
        if (passoSeta(app.viewer, e.key, e.shiftKey, e.altKey, e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (teclaJogo(e, false)) return;
      if (e.code === "Space") space = false;
    };
    // na captura: antes da timeline, que usa as setas para andar no tempo
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp);
    return () => {
      v.stop();
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp);
    };
  });

  // editar malha mostra a setup pose; sai sozinho se a peca ou o modo mudarem
  $effect(() => {
    const v = app.viewer;
    const on = !!app.meshEdit || !!app.drawEdit;
    if (v && v.setupOnly !== on) {
      v.setupOnly = on;
      v.poseAt(v.view.time);
    }
  });
  $effect(() => {
    app.version;
    const me = app.meshEdit;
    if (me && (app.mode !== "setup" || app.selection.slot !== me.slot || !currentMesh())) stopMeshEdit();
    // o desenho sai se a animacao abrir ou a parte deixar de mostrar o desenho (desfazer)
    const de = app.drawEdit;
    if (de && (app.mode !== "setup" || !app.doc || drawingOfSlot(app.doc.json, de.slot)?.image !== de.image)) stopDrawEdit();
    // o mosaico sai se deixar de existir (apagado, desfeito)
    const mo = app.mosaicEdit;
    if (mo && (!app.doc || !mosaics(app.doc.json).some((m) => m.name === mo.name))) stopMosaicEdit();
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
    if (app.drawEdit) {
      if (!drawDown(v, w, { shift: e.shiftKey, alt: e.altKey })) downAt = null;
      return;
    }
    if (app.mosaicEdit) {
      if (!mosaicDown(v, w)) downAt = null;
      return;
    }
    // clicando os pontos de uma parte especial (o ponto conclui no primeiro clique)
    if (app.captura) {
      app.captura.pontos = [...app.captura.pontos, [w.x, w.y]];
      if (app.captura.tipo === "point") app.concluirCaptura();
      downAt = null;
      return;
    }
    // ferramentas de traco (pincel de deform, criar osso) trabalham em coordenadas visuais
    if (app.tool === "deform" || app.tool === "bone") {
      if (!beginStroke(v, v.screenToWorld(e.clientX, e.clientY))) downAt = null;
      return;
    }
    // clicar perto do osso selecionado ja comeca a arrastar; senao seleciona
    const sel = app.selection.bone ? v.pose?.findBone(app.selection.bone) : null;
    const near = sel ? Math.hypot(w.x - sel.worldX, w.y - sel.worldY) * v.cam.zoom < 60 : false;
    if (!near) select(w.x, w.y);
    if (app.selection.bone) {
      v.view.playing = false;
      beginDrag(v, w, app.tool, e.ctrlKey || e.metaKey);
    }
  }

  // o que um clique em (x, y) escolheria: o osso perto (com os ossos a vista), a imagem e o osso
  // que a move naquele ponto (numa malha com pesos, nao o dono do slot), ou o osso mais perto
  function alvoEm(x: number, y: number): { bone?: string; slot?: string } {
    const v = app.viewer!;
    if (v.view.showBones) {
      const b = pickBone(v, x, y);
      if (b) return { bone: b };
    }
    const pose = v.pose;
    const part = pose ? pickPart(pose, x, y, (sl) => v.isSlotHidden(sl)) : null;
    if (part) return { bone: part.bone, slot: part.slot };
    const b = pickBone(v, x, y, 16);
    return b ? { bone: b } : {};
  }
  function select(x: number, y: number) {
    app.select(alvoEm(x, y));
  }

  // a linha de ajuda da ferramenta (o que o arrasto vai fazer agora)
  const ajuda = $derived.by(() => {
    app.version;
    app.tool;
    app.mode;
    app.play.animation;
    const s = app.selection;
    void s.bone, s.slot;
    if (app.drawEdit) return (app.drawEdit.tool, app.drawEdit.pen, drawHelp());
    if (app.mosaicEdit) {
      const t = app.mosaicEdit.tool;
      return `Mosaico ${app.mosaicEdit.name}: ${t === "brush" ? "arraste para pintar" : t === "erase" ? "arraste para apagar" : t === "rect" ? "arraste de um canto ao outro" : t === "fill" ? "clique para o balde" : "clique numa célula"} · Esc conclui`;
    }
    return app.doc && app.viewer && !app.meshEdit ? ajudaFerramenta(app.viewer) : "";
  });

  // passando o mouse: o contorno do que o clique vai pegar e o nome junto do cursor
  let dica = $state<{ t: string; x: number; y: number } | null>(null);
  function mostraAlvo(e: PointerEvent) {
    const v = app.viewer;
    if (!v || !app.doc || app.meshEdit || app.drawEdit || app.mosaicEdit || !["move", "rotate", "scale"].includes(app.tool)) return limpaAlvo();
    const w = v.screenToSkel(e.clientX, e.clientY);
    const a = alvoEm(w.x, w.y);
    const igual = a.bone === app.selection.bone && a.slot === app.selection.slot;
    hover.bone = igual ? undefined : a.bone;
    hover.slot = igual ? undefined : a.slot;
    const r = canvas.getBoundingClientRect();
    dica = !igual && (a.bone || a.slot) ? { t: a.slot ? `${a.slot} · 🦴 ${a.bone}` : `🦴 ${a.bone}`, x: e.clientX - r.left, y: e.clientY - r.top } : null;
  }
  function limpaAlvo() {
    hover.bone = hover.slot = undefined;
    dica = null;
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
    if (drawDragging()) {
      drawMove(v, v.screenToSkel(e.clientX, e.clientY), { shift: e.shiftKey, alt: e.altKey });
      return;
    }
    if (mosaicDragging()) {
      mosaicMove(v, v.screenToSkel(e.clientX, e.clientY));
      return;
    }
    if (downAt && app.mosaicEdit) return;
    if (downAt && app.drawEdit) return;
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
    if (!downAt) return mostraAlvo(e);
    if (downAt && !dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 3) return;
    if (downAt) {
      limpaAlvo();
      dragged = true;
      moveDrag(v, v.screenToSkel(e.clientX, e.clientY), e.shiftKey, e.altKey);
      const t = leituraArrasto();
      const r = canvas.getBoundingClientRect();
      leitura = t ? { t: t + (e.shiftKey ? "" : " · Shift: fino"), x: e.clientX - r.left, y: e.clientY - r.top } : null;
    }
  }

  // dois cliques numa peca desenhada abrem o Desenhar nela (dentro do Desenhar, os dois cliques
  // sao do ponto: canto <-> curva)
  function dblclick(e: MouseEvent) {
    const v = app.viewer;
    if (!v || !app.doc || app.drawEdit || app.meshEdit || app.spectator) return;
    const w = v.screenToSkel(e.clientX, e.clientY);
    const pose = v.pose;
    const part = pose ? pickPart(pose, w.x, w.y, (sl) => v.isSlotHidden(sl)) : null;
    if (part && drawingOfSlot(app.doc.json, part.slot)) startDrawEdit(part.slot);
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
        { cmd: "attachment.region", args: { slot, name, skin: app.skinEdicao, world: { center: [at.x, at.y] } } },
      ],
      `nova parte ${slot}`,
    );
    if (r) app.select({ bone, slot });
  }

  function up() {
    leitura = null;
    panning = null;
    downAt = null;
    endDrag();
    endStroke();
    meshUp();
    drawUp();
    mosaicUp();
  }
</script>

<div class="wrap" class:setup={app.doc && app.mode === "setup"}>
  {#if app.doc && app.mode === "setup"}<div class="base-tag" title="Mexer aqui muda o boneco em todas as animações">POSE BASE</div>
  {:else if app.doc && app.play.animation && !app.spectator}<div class="base-tag anima" title="Mexer numa parte grava uma chave no instante da régua">ANIMANDO {app.play.animation} · mexer grava chave</div>{/if}
  {#if temPalco && !app.spectator}
    <button class="jogar-tag" class:on={jogando} onclick={jogar} title={jogando ? "parar o jogo (Esc)" : "jogar a fase: setas ou A/D andam, espaço ou W pula, R recomeça, Esc sai"}>{jogando ? "■ parar" : "🎮 jogar"}</button>
    {#if jogando && placar}
      <div class="placar">🪙 {placar.pontos}{placar.venceu ? " · venceu! (R recomeça)" : placar.morreu ? " · morreu (R recomeça)" : ""}</div>
    {/if}
  {/if}
  {#if pixelAvisos}
    <button class="pixel-tag" title={"Fora da grade de pixel inteiro (pixel art: docs/ANIMAR.md, seção 6):\n" + pixelAvisos.lista.slice(0, 30).join("\n") + (pixelAvisos.lista.length > 30 ? `\n(+${pixelAvisos.lista.length - 30})` : "") + (pixelAvisos.consertaveis ? "\n\nClique para encaixar." : "")} onclick={encaixarPixel} disabled={!pixelAvisos.consertaveis}>
      ▦ {pixelAvisos.total} fora da grade{pixelAvisos.consertaveis ? " · encaixar" : ""}
    </button>
  {/if}
  <canvas bind:this={canvas} onmousedown={(e) => e.button === 1 && e.preventDefault()} onwheel={wheel} onpointerdown={down} onpointermove={move} onpointerup={up} ondblclick={dblclick} onpointerleave={() => ((cursor.inside = false), limpaAlvo())} oncontextmenu={(e) => e.preventDefault()} ondragover={(e) => e.preventDefault()} ondrop={drop} class:pan={space || app.tool === "pan"} class:panning={!!panning}></canvas>
  {#if ajuda}<div class="ajuda" role="status">{ajuda}</div>{/if}
  {#if dica && !leitura}<div class="leitura alvo" style:left="{dica.x + 16}px" style:top="{dica.y + 16}px">{dica.t}</div>{/if}
  {#if leitura}<div class="leitura" style:left="{leitura.x + 16}px" style:top="{leitura.y + 16}px">{leitura.t}</div>{/if}
  {#if app.referencia && refBox}
    {#if app.referencia.video}
      <!-- o video e desenhado no canvas, atras do personagem; esta caixa so pega o arrasto -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="ref refvideo"
        class:mover={app.referencia.mover}
        style:left="{refBox.left}px"
        style:top="{refBox.top}px"
        style:width="{refBox.width}px"
        style:height="{(refBox.width * app.referencia.video.altura) / app.referencia.video.largura}px"
        style:transform="translateY(-50%)"
        onpointerdown={refDown}
        onpointermove={refMove}
        onpointerup={() => (refArrasto = null)}
      ></div>
    {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <img
      class="ref"
      class:mover={app.referencia.mover}
      src={app.referencia.src}
      alt="referencia"
      style:left="{refBox.left}px"
      style:top="{refBox.top}px"
      style:width="{refBox.width}px"
      style:opacity={app.referencia.opacidade}
      style:transform="translateY(-50%)"
      onpointerdown={refDown}
      onpointermove={refMove}
      onpointerup={() => (refArrasto = null)}
      draggable="false"
    />
    {/if}
    <div class="refbar">
      {#if app.referencia.video}
        <span title="vídeo de referência atrás do personagem, no quadro exato do instante da régua; a cebola mostra os quadros vizinhos do vídeo">vídeo {refQuadro + 1}/{app.referencia.video.quadros.length}</span>
      {:else}
        <span title="imagem de referência por cima do personagem">referência</span>
      {/if}
      <input type="range" min="0.05" max="1" step="0.05" bind:value={app.referencia.opacidade} title="transparência" />
      <button onclick={() => app.referencia && (app.referencia.largura *= 1.05)} title="maior">+</button>
      <button onclick={() => app.referencia && (app.referencia.largura /= 1.05)} title="menor">−</button>
      {#if app.referencia.video}<button class:on={app.referencia.frente} onclick={() => app.referencia && (app.referencia.frente = !app.referencia.frente)} title="vídeo por cima do personagem (posar sobre ele) ou atrás">frente</button>{/if}
      <button class:on={app.referencia.mover} onclick={() => app.referencia && (app.referencia.mover = !app.referencia.mover)} title="arrastar a referência com o mouse">mover</button>
      <button onclick={() => app.tirarReferencia()} title="tirar a referência">✕</button>
    </div>
  {/if}
  {#if app.viewer?.error}
    <div class="err">O runtime recusou o documento: {app.viewer.error}</div>
  {:else if app.runtime === "nucleo" && app.viewer?.nucleoError && (app.version, true)}
    <div class="err">O núcleo recusou o documento (desenhando pelo spine-webgl): {app.viewer.nucleoError}</div>
  {/if}
  {#if app.doc && app.runtime !== "nucleo" && extras}
    <div class="aviso-nucleo">
      Este personagem tem {extras}, que só aparecem no desenho do núcleo (o {app.runtime === "godot" ? "spine-godot" : "Spine"} não tem).
      <button onclick={() => app.setRuntime("nucleo")}>ver no núcleo</button>
    </div>
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
  {#if app.captura}
    {@const c = app.captura}
    <div class="meshbar drawbar">
      <b>{({ clipping: "✂ Recorte", boundingbox: "▢ Caixa", path: "〰 Caminho", point: "• Ponto" })[c.tipo]} em {c.bone}</b>
      <span class="dim">{c.tipo === "point" ? "clique onde fica o ponto" : `clique os pontos (${c.pontos.length}) · Enter conclui · Backspace tira o último · Esc cancela`}</span>
      {#if c.tipo !== "point"}<button class="ok" onclick={() => app.concluirCaptura()}>Pronto</button>{/if}
      <button onclick={() => (app.captura = null)}>Cancelar</button>
    </div>
  {/if}
  {#if app.drawEdit}
    {@const de = app.drawEdit}
    <div class="meshbar drawbar">
      <b>✏️ Desenhando {de.image}</b>
      <span class="ferr">
        <button class:on={de.tool === "select"} onclick={() => ((de.tool = "select"), (de.pen = null))} title="Selecionar (V)">↖</button>
        <button class:on={de.tool === "pen"} onclick={() => (de.tool = "pen")} title="Caneta (P)">✒️</button>
        <button class:on={de.tool === "rect"} onclick={() => ((de.tool = "rect"), (de.pen = null))} title="Retângulo (R)">▭</button>
        <button class:on={de.tool === "ellipse"} onclick={() => ((de.tool = "ellipse"), (de.pen = null))} title="Elipse (O)">◯</button>
        <button class:on={de.hole} disabled={de.shape === null && !de.hole} onclick={() => ((de.hole = !de.hole), (de.pen = null), de.tool === "select" && (de.tool = "pen"))} title="Modo furo: a caneta, o retângulo e a elipse furam a forma escolhida (Esc sai)">⊘</button>
      </span>
      <button class="ok" onclick={stopDrawEdit}>Pronto</button>
    </div>
  {/if}
  {#if app.offerMesh}
    <div class="offer">
      <b>{app.offerMesh.attachment}</b> ainda não é deformável.
      <button
        class="ok"
        onclick={async () => {
          const o = app.offerMesh!;
          const bone = app.doc?.json.slots.find((s: any) => s.name === o.slot)?.bone;
          const ok = await app.runAsync([{ cmd: "mesh.create", args: { slot: o.slot, name: o.attachment, detail: 1.8 } }], `deixar ${o.attachment} deformavel`);
          app.offerMesh = null;
          if (ok) app.avisar(`${o.slot} agora é deformável: passe o pincel de novo.`);
          void bone;
        }}>Deixar deformável</button
      >
      <button onclick={() => (app.offerMesh = null)}>Agora não</button>
    </div>
  {/if}
  {#if app.abrindo}
    <div class="abrindo" role="status">Abrindo {app.abrindo}…</div>
  {/if}
  {#if !app.doc && !app.abrindo}
    <div class="empty">
      {#if app.assetsLidos && !app.assets.length}
        <div class="big">Nenhum personagem encontrado</div>
        <div class="dim">O editor procura {app.roots.length > 1 ? "nestas pastas" : "nesta pasta"}: <code>{app.roots.join(", ")}</code></div>
        <div class="dim">Arraste um PSD em camadas para a janela para montar um, ou abra o editor com <code>MAMULENGO_ROOTS=/sua/pasta npm run dev</code>.</div>
      {:else}
        <div class="big">Escolha um personagem ali em cima</div>
        <div class="dim">ou peça ao Claude: "abre o personagem do monstro"</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ref {
    position: absolute;
    pointer-events: none;
    z-index: 2;
  }
  .ref.mover {
    pointer-events: auto;
    cursor: move;
    outline: 1px dashed #ff4d94;
  }
  .refbar {
    position: absolute;
    right: 10px;
    bottom: 10px;
    z-index: 3;
    display: flex;
    gap: 4px;
    align-items: center;
    background: rgba(24, 20, 34, 0.85);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
  }
  .refbar input {
    width: 80px;
  }
  .refbar button.on {
    background: #ff4d94;
    color: #fff;
  }
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
  .abrindo {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 7;
    background: #16141b99;
    font-size: 15px;
    pointer-events: none;
  }
  .leitura {
    position: absolute;
    z-index: 6;
    pointer-events: none;
    background: #1d1b22e6;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ajuda {
    position: absolute;
    left: 8px;
    bottom: 8px;
    right: 8px;
    z-index: 5;
    pointer-events: none;
    font-size: 12px;
    color: var(--dim);
    background: #1a1820cc;
    border-radius: 6px;
    padding: 3px 8px;
    width: fit-content;
    max-width: calc(100% - 16px);
  }
  .leitura.alvo {
    color: #9ee8ff;
  }
  .jogar-tag {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    background: #2a2533;
    color: #b8f5c8;
    border: 1px solid #b8f5c866;
    font-size: 12px;
    padding: 3px 12px;
    border-radius: 6px;
    cursor: pointer;
  }
  .jogar-tag.on {
    background: #ff3d8b;
    color: #fff;
  }
  .placar {
    position: absolute;
    top: 40px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    background: #000a;
    color: #ffe27a;
    font-weight: 700;
    font-size: 18px;
    padding: 4px 14px;
    border-radius: 8px;
    pointer-events: none;
  }
  .pixel-tag {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 5;
    background: #2a2533;
    color: #ffd27a;
    border: 1px solid #ffd27a66;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .pixel-tag:disabled {
    cursor: help;
    opacity: 0.8;
  }
  .base-tag.anima {
    background: #ff3d8b33;
    color: #ffb3d1;
    font-weight: 600;
    letter-spacing: 0.02em;
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
  .aviso-nucleo {
    position: absolute;
    left: 50%;
    top: 10px;
    transform: translateX(-50%);
    background: rgba(255, 210, 60, 0.95);
    color: #1d1a24;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 12px;
    display: flex;
    gap: 8px;
    align-items: center;
    z-index: 3;
  }
  .aviso-nucleo button {
    padding: 3px 10px;
    background: #1d1a24;
    color: #ffd23c;
    border: none;
    border-radius: 4px;
    white-space: nowrap;
    cursor: pointer;
  }
  /* abaixo do selo do modo (POSE BASE / ANIMANDO), no mesmo canto */
  .brush {
    position: absolute;
    left: 8px;
    top: 36px;
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
  .drawbar {
    background: #121c26dd;
    border-color: #0c99ff;
  }
  .meshbar.drawbar .ok {
    background: #0c99ff;
    border-color: #0c99ff;
    color: #fff;
    font-weight: 600;
  }
  .drawbar .ferr {
    display: flex;
    gap: 3px;
  }
  .drawbar .ferr button {
    padding: 3px 8px;
  }
  .drawbar .ferr button.on {
    background: #0c99ff44;
    border-color: #0c99ff;
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
