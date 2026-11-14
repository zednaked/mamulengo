<script lang="ts">
  // O atelie: a tela limpa de desenhar e animar quadro a quadro. Os paineis do editor somem e ficam
  // so a barra de ferramentas, as reguas do lapis (tamanho, estabilizar) e a tira de quadros, que
  // anda junto com a timeline da animacao aberta: o personagem animado por ossos aparece por tras,
  // no mesmo instante, e os quadros desenhados entram por cima dele. Por cima do viewport, um
  // canvas 2D mostra o papel de cebola (quadros vizinhos tingidos), a mesa de luz e o traco ao vivo.
  import { onMount } from "svelte";
  import { app } from "./state.svelte.ts";
  import { agora, camadas, celulaDe, desvirar, fimAqui, intermediarios, teclaGiro, irPara, moverQuadro, novaCamada, novoQuadro, sairAtelie, segurar, segurarEm, sincronizar, tempoDe, tirarQuadro, tocar, vizinho } from "./atelie.ts";
  import { RASTER, matrizDeTela, tracoVivo } from "./drawedit.ts";
  import { ligarPintor, prepararFolha, remendos } from "./pintura.ts";
  import { apagarSelecao, espelhar, pecaSolta, selecao, selecionarTudo, semSelecao, soltar } from "./retoque.ts";
  import Pinceis from "./Pinceis.svelte";
  import { drawDrawing } from "./desenho.ts";
  import { chavesDoSlot, duracao, quadroEm, quadrosDoSlot } from "../core/commands/quadros.ts";
  import { drawingsOf, type Drawing } from "../core/desenho.ts";
  import { ESTILOS, contornoDoTraco, larguraDaPressao } from "../core/lapis.ts";

  const a = $derived(app.atelie!);
  const de = $derived(app.drawEdit);
  const l = $derived(app.lapis);
  const anim = $derived(app.play.animation);
  const anims = $derived.by(() => (app.version, Object.keys(app.doc?.json.animations ?? {})));
  const listaCamadas = $derived.by(() => (app.version, camadas()));
  const ks = $derived.by(() => (app.version, a.layer && anim && app.doc ? chavesDoSlot(app.doc.json, anim, a.layer) : []));
  const celAtual = $derived(celulaDe(app.play.time));
  const dur = $derived.by(() => (app.version, anim && app.doc ? duracao(app.doc.json, anim) : 0));
  const nCel = $derived(Math.max(celulaDe(dur) + 1, celAtual + 1, 12) + 6);
  const W = 30; // largura de uma celula da tira, em px

  // os blocos da tira: cada quadro do instante em que entra ate o proximo
  const blocos = $derived.by(() => {
    const fim = Math.max(celulaDe(dur), 0);
    return ks
      .map((k, i) => {
        const c0 = celulaDe(k.time);
        const c1 = ks[i + 1] ? celulaDe(ks[i + 1].time) : Math.max(c0 + 1, fim);
        return { name: k.name, time: k.time, c0, n: Math.max(1, c1 - c0), i };
      })
      .filter((b) => b.name);
  });
  // onde a animacao de ossos tem chaves (para ver o desenho casar com o movimento)
  const chavesOssos = $derived.by(() => {
    app.version;
    const an = anim ? app.doc?.json.animations?.[anim] : null;
    const set = new Set<number>();
    for (const tl of Object.values<any>(an?.bones ?? {})) for (const arr of Object.values<any>(tl)) for (const k of arr) set.add(celulaDe(k.time ?? 0));
    return [...set].sort((x, y) => x - y);
  });
  const quadroAgora = $derived(quadroEm(ks, app.play.time));
  // intermediarios: do quadro a mostra ate o seguinte (precisa ser desenhado)
  let ibN = $state(1);
  let ibCurva = $state<"lin" | "sai" | "entra" | "ambos">("lin");
  let ibTodos = $state(false);
  const podeIb = $derived.by(() => {
    if (ibTodos) return ks.some((k, i) => k.name && ks[i + 1]?.name);
    if (!quadroAgora?.name) return false;
    const i = ks.findIndex((k) => Math.abs(k.time - quadroAgora.from) < 1e-4);
    return !!ks[i + 1]?.name;
  });
  const podeDesfazer = $derived.by(() => (app.version, !!app.doc?.canUndo()));
  const podeRefazer = $derived.by(() => (app.version, !!app.doc?.canRedo()));

  // o quadro em edicao acompanha a timeline
  $effect(() => {
    app.play.time;
    app.play.animation;
    app.play.playing;
    app.version;
    a.layer;
    sincronizar();
  });
  // a ferramenta escolhida vale no quadro aberto
  function ferramenta(t: typeof a.tool) {
    a.tool = t;
    if (t !== "lasso" && t !== "bucket" && !RASTER[t]) semSelecao();
    if (de) {
      de.tool = t;
      de.pen = null;
    }
  }
  const tool = $derived(de?.tool ?? a.tool);

  // ---- pintura (raster): o pincel, a borracha de tinta e o borrar usam os pinceis do ProCraft
  const pinta = $derived(RASTER[tool] ?? null);
  const p = $derived(app.pincel);
  let seletor = $state(false);
  // na primeira vez o pintor le a biblioteca de pinceis (demora); a folha do quadro a mostra fica
  // aberta de antemao, para a primeira pincelada nao esperar
  $effect(() => {
    if (!pinta) return;
    if (p.estado === "parado") void ligarPintor();
    app.version;
    if (p.estado === "pronto" && de?.image) prepararFolha(de.image);
  });
  function reg(k: "tamanho" | "opacidade", v: number) {
    if (!pinta) return;
    app.pincel[k][pinta] = v;
    app.guardarPincel();
  }

  const retoque = $derived(tool === "bucket" || tool === "lasso");
  function tudo() {
    if (de && selecionarTudo(de.image)) ferramenta("lasso");
    else app.toast("Este quadro ainda está vazio.");
  }

  function lap(k: keyof typeof l, v: any) {
    (app.lapis as any)[k] = v;
    app.guardarLapis();
  }
  // tamanho em escala de potencia (fino tem mais curso)
  const tamDe = (u: number) => Math.round((0.5 + 119.5 * u ** 2.2) * 2) / 2;
  const uDe = (w: number) => Math.max(0, Math.min(1, ((w - 0.5) / 119.5) ** (1 / 2.2)));

  function trocaAnim(n: string) {
    if (n === "+") {
      let nome = "desenho";
      for (let i = 2; anims.includes(nome); i++) nome = `desenho${i}`;
      if (!app.run({ cmd: "animation.create", args: { name: nome } }, `animação ${nome}`)) return;
      n = nome;
    }
    app.viewer?.setAnimation(n);
    app.play.animation = n;
    irPara(0);
  }
  function trocaCamada(n: string) {
    if (n === "+") return void novaCamada();
    a.layer = n;
    sincronizar();
  }

  // ---- a tira
  let tira = $state<HTMLDivElement>();
  let arrasta = false;
  // arrastar um bloco: o corpo muda o quadro de celula, a borda direita muda quanto ele dura
  let pega = $state<{ modo: "mover" | "segurar"; time: number; c0: number; n: number; x0: number; d: number; andou: boolean } | null>(null);
  const tiraX = (e: PointerEvent) => e.clientX - tira!.getBoundingClientRect().left + tira!.scrollLeft;
  function tiraEm(e: PointerEvent) {
    irPara(tempoDe(Math.max(0, Math.floor(tiraX(e) / W))));
  }
  function blocoEm(e: PointerEvent) {
    const y = e.clientY - tira!.getBoundingClientRect().top;
    if (y < 22) return null;
    const x = tiraX(e);
    const b = blocos.find((q) => x >= q.c0 * W && x < (q.c0 + q.n) * W);
    if (!b) return null;
    const borda = !!ks[b.i + 1] && x > (b.c0 + b.n) * W - 8;
    return { b, borda };
  }
  function tiraDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    tira!.setPointerCapture(e.pointerId);
    if (app.viewer) app.viewer.view.playing = false;
    const em = blocoEm(e);
    if (em) {
      pega = { modo: em.borda ? "segurar" : "mover", time: em.b.time, c0: em.b.c0, n: em.b.n, x0: tiraX(e), d: 0, andou: false };
      if (!em.borda) tiraEm(e);
      return;
    }
    arrasta = true;
    tiraEm(e);
  }
  function tiraMove(e: PointerEvent) {
    if (pega) {
      const dx = tiraX(e) - pega.x0;
      if (Math.abs(dx) > 5) pega.andou = true;
      if (pega.andou) pega.d = pega.modo === "segurar" ? Math.max(1 - pega.n, Math.round(dx / W)) : Math.max(-pega.c0, Math.round(dx / W));
    } else if (arrasta) tiraEm(e);
    else if (tira) tira.style.cursor = blocoEm(e)?.borda ? "ew-resize" : blocoEm(e) ? "grab" : "";
  }
  function tiraUp() {
    const g = pega;
    pega = null;
    arrasta = false;
    if (!g?.andou || !g.d) return;
    if (g.modo === "segurar") segurarEm(g.time, g.d);
    else moverQuadro(g.time, g.c0 + g.d);
  }
  // a celula atual fica a vista
  $effect(() => {
    const x = celAtual * W;
    if (!tira || arrasta) return;
    if (x < tira.scrollLeft + W) tira.scrollLeft = Math.max(0, x - W * 3);
    else if (x > tira.scrollLeft + tira.clientWidth - W * 2) tira.scrollLeft = x - tira.clientWidth + W * 4;
  });

  // miniatura de um quadro
  function mini(node: HTMLCanvasElement, p: { d: Drawing | undefined; img?: string; v: number }) {
    const pinta = (q: { d: Drawing | undefined; img?: string }) => {
      const g = node.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, node.width, node.height);
      if (!q.d) return;
      const s = Math.min(node.width / q.d.width, node.height / q.d.height);
      drawDrawing(g, q.d, (node.width - q.d.width * s) / 2, (node.height - q.d.height * s) / 2, s, q.img ? app.pinturas.base(q.img, q.d) : null);
    };
    pinta(p);
    return { update: pinta };
  }
  const imagemDoQuadro = (nome: string | null) => (nome && a.layer && app.doc ? quadrosDoSlot(app.doc.json, a.layer).find((x) => x.name === nome)?.image : undefined);
  const desenhoDe = (nome: string | null) => {
    const img = imagemDoQuadro(nome);
    return img && app.doc ? drawingsOf(app.doc.json)[img] : undefined;
  };

  // ---- por cima do viewport: mesa de luz, papel de cebola, traco ao vivo
  let lona = $state<HTMLCanvasElement>();
  const cache = new Map<string, { v: number; r: number; c: OffscreenCanvas; hd: number }>();
  function imagemDe(image: string, d: Drawing, cor: string | null): OffscreenCanvas {
    const chave = image + "|" + (cor ?? "");
    const tem = cache.get(chave);
    // (os remendos de uma pincelada em andamento tambem contam)
    const r = remendos();
    if (tem && tem.v === app.version && tem.r === r) return tem.c;
    const hd = Math.min(2, 2048 / Math.max(d.width, d.height));
    const c = new OffscreenCanvas(Math.max(1, Math.ceil(d.width * hd)), Math.max(1, Math.ceil(d.height * hd)));
    const g = c.getContext("2d")!;
    drawDrawing(g, d, 0, 0, hd, app.pinturas.base(image, d));
    if (cor) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = cor;
      g.fillRect(0, 0, c.width, c.height);
    }
    cache.set(chave, { v: app.version, r, c, hd });
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    return c;
  }
  const ANTES = "#ff3b6b",
    DEPOIS = "#2bd4a4";

  function pintar() {
    const v = app.viewer;
    const c = lona;
    const at = app.atelie;
    const j = app.doc?.json;
    if (!v || !c || !at || !j) return;
    const dpr = window.devicePixelRatio || 1;
    const w = v.canvas.clientWidth,
      h = v.canvas.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const ds = drawingsOf(j);
    const poe = (slot: string, nome: string, cor: string | null, alfa: number) => {
      const q = quadrosDoSlot(j, slot).find((x) => x.name === nome);
      const d = q ? ds[q.image] : null;
      const m = q && d ? matrizDeTela(v, slot, q.name, q.image) : null;
      if (!q || !d || !m) return;
      const img = imagemDe(q.image, d, cor);
      const k = d.width / img.width;
      g.setTransform(m[0] * k * dpr, m[1] * k * dpr, m[2] * k * dpr, m[3] * k * dpr, m[4] * dpr, m[5] * dpr);
      g.globalAlpha = alfa;
      g.drawImage(img, 0, 0);
      g.globalAlpha = 1;
    };
    const tocando = v.view.playing;
    const edit = app.drawEdit;
    // mesa de luz: o personagem esmaece por baixo de um veu da cor do fundo
    if (at.boneco < 1 && !tocando) {
      const bg = v.view.background;
      g.fillStyle = `rgba(${Math.round(bg[0] * 255)},${Math.round(bg[1] * 255)},${Math.round(bg[2] * 255)},${1 - at.boneco})`;
      g.fillRect(0, 0, c.width, c.height);
    }
    if (at.layer && anim && !tocando) {
      const todas = chavesDoSlot(j, anim, at.layer);
      const nomeadas = todas.filter((k) => k.name);
      const t = v.view.time;
      const q = quadroEm(todas, t);
      const i = q?.name ? nomeadas.findIndex((k) => Math.abs(k.time - q.from) < 1e-4) : -1;
      const antes = nomeadas.filter((k) => k.time < (q?.name ? q.from : t) - 1e-4);
      const depois = nomeadas.filter((k) => k.time > t + 1e-4 && (i < 0 || k.time > q!.from + 1e-4));
      if (at.cebola) {
        for (let n = Math.min(at.antes, antes.length); n >= 1; n--) poe(at.layer, antes[antes.length - n].name!, ANTES, 0.42 * (1 - (n - 1) / (at.antes + 0.5)));
        for (let n = Math.min(at.depois, depois.length); n >= 1; n--) poe(at.layer, depois[n - 1].name!, DEPOIS, 0.36 * (1 - (n - 1) / (at.depois + 0.5)));
      }
      // com a mesa de luz, o quadro atual volta por cima do veu
      if (at.boneco < 1 && q?.name) poe(at.layer, q.name, null, 1);
    } else if (at.boneco < 1 && edit && !tocando) poe(edit.slot, edit.attachment, null, 1);
    // o pedaco do laco que passou da folha (a folha so cresce ao assentar)
    const ps = pecaSolta();
    if (ps && edit && ps.image === edit.image) {
      const d = ds[ps.image];
      const m = d ? matrizDeTela(v, edit.slot, edit.attachment, edit.image) : null;
      if (d && m) {
        g.save();
        g.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
        g.beginPath();
        g.rect(-1e5, -1e5, 2e5, 2e5);
        g.rect(0, 0, d.width, d.height);
        g.clip("evenodd");
        g.transform(ps.m[0], ps.m[1], ps.m[2], ps.m[3], ps.m[4], ps.m[5]);
        g.drawImage(ps.peca, 0, 0);
        g.restore();
      }
    }
    // o traco ao vivo
    const tv = tracoVivo();
    if (tv && edit) {
      const m = matrizDeTela(v, edit.slot, edit.attachment, edit.image);
      if (m) {
        const est = ESTILOS[app.lapis.estilo] ?? ESTILOS.lapis;
        const larg = app.lapis.width;
        const pts = tv.pontos.map((p) => ({ x: p[0], y: p[1], press: tv.pressao && est.pressao > 0 ? larguraDaPressao(p[2] ?? 1, est) : undefined }));
        g.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
        g.fillStyle = "#" + app.lapis.color;
        const escala = Math.hypot(m[0], m[1]);
        if (app.lapis.mancha && pts.length > 2) {
          g.beginPath();
          pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
          g.closePath();
          g.fill();
        } else {
          for (const anel of contornoDoTraco({ points: pts, stroke: { color: app.lapis.color, width: larg, cap: "round", taper: [est.afinar[0] * larg, est.afinar[1] * larg] } }, Math.max(0.5, 1.5 / escala))) {
            g.beginPath();
            anel.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
            g.closePath();
            g.fill("nonzero");
          }
        }
      }
    }
  }
  onMount(() => {
    let vivo = true;
    const laco = () => {
      if (!vivo) return;
      pintar();
      requestAnimationFrame(laco);
    };
    laco();
    return () => (vivo = false);
  });

  function teclas(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) return;
    // girar a tela (R, Shift+R, F14 do anel da mesa): antes do R do retangulo
    if (teclaGiro(e, false)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ",") vizinho(-1);
    else if (k === ".") vizinho(1);
    else if (k === "ArrowLeft" && !de?.shape) irPara(tempoDe(Math.max(0, celAtual - 1)));
    else if (k === "ArrowRight" && !de?.shape) irPara(tempoDe(celAtual + 1));
    else if (k === "n" || k === "N") novoQuadro(e.shiftKey);
    else if (k === "Enter" && !(de?.pen !== null && de?.pen !== undefined) && !selecao()) tocar();
    // com um laco feito, H espelha (sem laco, H e a mao do editor)
    else if ((k === "h" || k === "H") && selecao()) espelhar(e.shiftKey);
    else if (!de && k === "l") a.tool = "pencil";
    else if (!de && k === "b") a.tool = "brush";
    else if (!de && k === "s") a.tool = "smudge";
    else if (!de && k === "g") a.tool = "bucket";
    else if (!de && k === "q") a.tool = "lasso";
    else if (!de && k === "e") a.tool = RASTER[a.tool] ? "rubber" : "eraser";
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  const rgb = (c: string) => "#" + c.slice(0, 6);
  const PALETA = ["1a1a2eff", "ffffffff", "ff2e88ff", "ffd166ff", "2bd4a4ff", "3a86ffff", "ff7b00ff", "8338ecff"];
</script>

<svelte:window
  onkeydowncapture={teclas}
  onkeyupcapture={(e) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) return;
    if (teclaGiro(e, true)) e.stopImmediatePropagation();
  }}
/>

<canvas class="lona" bind:this={lona}></canvas>

<div class="topo">
  <button class="sair" onclick={sairAtelie} title="Voltar ao editor">‹ Editor</button>
  {#if !de || de.quadro}
    <select value={a.layer ?? ""} onchange={(e) => trocaCamada((e.target as HTMLSelectElement).value)} title="A camada de quadros: os desenhos dela entram na animação nos instantes da tira">
      {#if !a.layer}<option value="">sem camada</option>{/if}
      {#each listaCamadas as c}<option value={c}>{c}</option>{/each}
      <option value="+">+ camada nova…</option>
    </select>
    <select value={anim ?? ""} onchange={(e) => trocaAnim((e.target as HTMLSelectElement).value)} title="A animação em que os quadros entram">
      {#each anims as n}<option value={n}>{n}</option>{/each}
      <option value="+">+ animação nova</option>
    </select>
  {:else}
    <b class="peca">{de.image}</b>
  {/if}
  <span class="sep"></span>
  <span class="ferr">
    <button class:on={tool === "brush"} onclick={() => ferramenta("brush")} title="Pincel (B): pintura em pixels com os pincéis do ProCraft">🖌</button>
    <button class:on={tool === "smudge"} onclick={() => ferramenta("smudge")} title="Borrar a tinta (S)">👆</button>
    <button class:on={tool === "pencil"} onclick={() => ferramenta("pencil")} title="Lápis vetorial (L): o traço vira uma curva editável">✏️</button>
    <button class:on={tool === "eraser" || tool === "rubber"} onclick={() => ferramenta(pinta ? "rubber" : "eraser")} title={pinta ? "Borracha de tinta (E): apaga os pixels com um pincel" : "Borracha (E): apaga o traço vetorial inteiro"}>🧽</button>
    <button class:on={tool === "bucket"} onclick={() => ferramenta("bucket")} title="Balde (G): enche de cor uma área fechada, por baixo das linhas">🪣</button>
    <button class:on={tool === "lasso"} onclick={() => ferramenta("lasso")} title="Laço (Q): contorne um pedaço para mover, mudar de tamanho, girar ou apagar. T escolhe o quadro inteiro">➰</button>
    <button class:on={tool === "select"} onclick={() => ferramenta("select")} title="Escolher e ajustar formas e pontos (V)">↖</button>
    <button class:on={tool === "pen"} onclick={() => ferramenta("pen")} title="Caneta de pontos (P)">✒️</button>
    <button class:on={tool === "rect"} onclick={() => ferramenta("rect")} title="Retângulo (no Ateliê, R gira a tela)">▭</button>
    <button class:on={tool === "ellipse"} onclick={() => ferramenta("ellipse")} title="Elipse (O)">◯</button>
  </span>
  <span class="sep"></span>
  <span class="cores">
    <input type="color" value={rgb(l.color)} oninput={(e) => lap("color", (e.target as HTMLInputElement).value.slice(1) + "ff")} title="Cor do lápis" />
    {#each PALETA as c}<button class="cor" class:on={l.color === c} style:background={rgb(c)} onclick={() => lap("color", c)} aria-label="cor {c}"></button>{/each}
  </span>
  {#if !pinta && !retoque}<button class:on={l.mancha} onclick={() => lap("mancha", !l.mancha)} title="Mancha: o traço fecha e preenche com a cor">◖ mancha</button>{/if}
  <span class="sep"></span>
  <button onclick={() => (app.guia = retoque ? "retoque" : pinta ? "pincel" : tool === "pencil" || tool === "eraser" ? "lapis" : "formas")} title="Como usar: o guia desta ferramenta (F1)">📖</button>
  <button disabled={!podeDesfazer} onclick={() => app.undo()} title="Desfazer (Ctrl+Z)">↶</button>
  <button disabled={!podeRefazer} onclick={() => app.redo()} title="Refazer (Ctrl+Shift+Z)">↷</button>
  <span class="sep"></span>
  {#if app.giro}<button class="giro" onclick={desvirar} title="A tela está girada {app.giro}°: clique para desvirar. R gira 15° (Shift+R volta), R segurado e arrastar gira livre">↻ {app.giro}°</button>{/if}
  <label class="mesa" title="Mesa de luz: o quanto o personagem aparece por trás do desenho">🎭 <input type="range" min="0" max="1" step="0.05" value={a.boneco} oninput={(e) => (a.boneco = +(e.target as HTMLInputElement).value)} /></label>
</div>

{#if pinta}
  <div class="regua">
    <button class="qual" onclick={() => (seletor = !seletor)} disabled={p.estado !== "pronto"} title="Escolher o pincel desta ferramenta">
      <span class="ic">{pinta === "pintar" ? "🖌" : pinta === "apagar" ? "🧽" : "👆"}</span>
      <span class="nm">{p.escolha[pinta]?.[1] ?? (pinta === "pintar" ? "escolher" : "o do ProCraft")}</span>
    </button>
    <label title="Tamanho do pincel ([ e ]): a régua do ProCraft">
      <span class="val">{Math.round(p.tamanho[pinta] * 100)}</span>
      <input class="vert" type="range" min="0.01" max="1" step="0.01" value={p.tamanho[pinta]} oninput={(e) => reg("tamanho", +(e.target as HTMLInputElement).value)} />
      <span class="nome">tamanho</span>
    </label>
    <label title="Opacidade do pincel">
      <span class="val">{Math.round(p.opacidade[pinta] * 100)}</span>
      <input class="vert" type="range" min="0.02" max="1" step="0.01" value={p.opacidade[pinta]} oninput={(e) => reg("opacidade", +(e.target as HTMLInputElement).value)} />
      <span class="nome">opacidade</span>
    </label>
  </div>
  {#if seletor && p.estado === "pronto"}<Pinceis ferramenta={pinta} fechar={() => (seletor = false)} />{/if}
  {#if p.estado !== "pronto"}
    <div class="aviso-pincel" role="status">
      {#if p.estado === "falta"}
        A pintura com os pincéis do ProCraft roda num programa ao lado do editor instalado, que não está aqui: na pasta do Mamulengo, rode <code>tools/pintor.sh</code> e recarregue (no editor pelo navegador ela ainda não existe). O lápis vetorial (L) funciona sem ele.
      {:else if p.estado === "erro"}
        O pintor não ligou: {p.erro}
        <button onclick={() => ((app.pincel.estado = "parado"), void ligarPintor())}>tentar de novo</button>
      {:else}
        <span class="gira"></span> Carregando os pincéis do ProCraft… Só na primeira vez depois de abrir o editor; com uma biblioteca grande leva uns 30 segundos.
      {/if}
    </div>
  {/if}
{:else if retoque}
  <div class="regua">
    {#if tool === "bucket"}
      <span class="ic-grande">🪣</span>
      <label title="Limiar do balde: o quanto a cor pode variar para ainda ser a mesma área. Baixo para parar em qualquer linha, alto para passar por cima de linhas claras e encher até a beirada">
        <span class="val">{Math.round(l.limiar * 100)}</span>
        <input class="vert" type="range" min="0.02" max="0.9" step="0.01" value={l.limiar} oninput={(e) => lap("limiar", +(e.target as HTMLInputElement).value)} />
        <span class="nome">limiar</span>
      </label>
    {:else}
      <span class="ic-grande">➰</span>
      <div class="estilos">
        <button onclick={tudo} disabled={!de} title="Escolhe tudo o que há no quadro (T)">tudo</button>
        <button onclick={() => espelhar(false)} title="Espelha o pedaço escolhido, esquerda e direita (H)">⇋ espelhar</button>
        <button onclick={() => espelhar(true)} title="Espelha o pedaço de cabeça para baixo (Shift+H)">⇵ virar</button>
        <button onclick={() => soltar()} title="Assenta o pedaço onde está (Enter)">assentar</button>
        <button onclick={() => apagarSelecao()} title="Apaga o que está dentro do laço (Delete)">apagar</button>
        <button onclick={() => semSelecao()} title="Tira a seleção (Esc)">soltar</button>
      </div>
    {/if}
  </div>
{:else}
<div class="regua">
  <div class="estilos">
    {#each Object.entries(ESTILOS) as [id, e]}
      <button class:on={l.estilo === id} onclick={() => lap("estilo", id)} title="{e.rotulo}: {e.pressao ? 'a pressão engrossa' : 'largura igual'}{e.afinar[0] ? ', pontas afinadas' : ''}">{e.rotulo}</button>
    {/each}
  </div>
  <label title="Tamanho do lápis ([ e ])">
    <span class="val">{l.width}</span>
    <input class="vert" type="range" min="0" max="1" step="0.005" value={uDe(l.width)} oninput={(e) => lap("width", tamDe(+(e.target as HTMLInputElement).value))} />
    <span class="nome">tamanho</span>
  </label>
  <label title="Estabilizar: a ponta segue a caneta com atraso e o tremor some">
    <span class="val">{Math.round(l.estabilizar * 100)}</span>
    <input class="vert" type="range" min="0" max="1" step="0.01" value={l.estabilizar} oninput={(e) => lap("estabilizar", +(e.target as HTMLInputElement).value)} />
    <span class="nome">estável</span>
  </label>
  <label title="Suavizar: o quanto a curva pode se afastar do que a mão fez (mais = mais liso, menos pontos)">
    <span class="val">{l.suavizar}</span>
    <input class="vert" type="range" min="0.2" max="8" step="0.1" value={l.suavizar} oninput={(e) => lap("suavizar", +(e.target as HTMLInputElement).value)} />
    <span class="nome">liso</span>
  </label>
</div>
{/if}

{#if !de || de.quadro}
  <div class="pe">
    <div class="botoes">
      <button onclick={() => (app.guia = "quadros")} title="Como usar a tira de quadros (F1)">📖</button>
      <button onclick={() => vizinho(-1)} title="Quadro anterior (,)">⏮</button>
      <button class="play" onclick={tocar} title="Tocar a animação com os quadros (Enter)">{app.play.playing ? "⏸" : "▶"}</button>
      <button onclick={() => vizinho(1)} title="Próximo quadro (.)">⏭</button>
      <span class="sep"></span>
      <button class="novo" onclick={() => novoQuadro(false)} title="Quadro novo em branco (N). Desenhar onde não há quadro também cria">＋ quadro</button>
      <button onclick={() => novoQuadro(true)} disabled={!a.layer} title="Quadro novo com a cópia do anterior (Shift+N)">⧉ cópia</button>
      <span class="ib" title="Intermediários: o RIFE desenha os quadros entre este e o próximo, como pintura, para você limpar por cima. Bom para movimento, escala e deformação; um giro que mostra o outro lado sai fraco">
        <button onclick={() => intermediarios(ibN, ibCurva, ibTodos)} disabled={!podeIb || !!a.gerando}>{a.gerando ? `✨ ${a.gerando}…` : "✨ meio"}</button>
        <select value={ibN} onchange={(e) => (ibN = +(e.target as HTMLSelectElement).value)} title="Quantos intermediários">{#each [1, 2, 3, 4] as k}<option value={k}>{k}</option>{/each}</select>
        <select value={ibCurva} onchange={(e) => (ibCurva = (e.target as HTMLSelectElement).value as any)} title="Espaçamento: igual, saindo devagar do quadro, chegando devagar no próximo, ou os dois">
          <option value="lin">igual</option><option value="sai">sai devagar</option><option value="entra">chega devagar</option><option value="ambos">devagar nos dois</option>
        </select>
        <select value={ibTodos ? "todos" : "par"} onchange={(e) => (ibTodos = (e.target as HTMLSelectElement).value === "todos")} title="Só do quadro à mostra até o próximo, ou entre todos os pares de quadros desenhados da camada">
          <option value="par">este par</option><option value="todos">todos os pares</option>
        </select>
      </span>
      <button onclick={() => segurar(1)} disabled={!quadroAgora || quadroAgora.to === null} title="Segura o quadro mais uma célula (o que vem depois anda)">＋ segura</button>
      <button onclick={() => segurar(-1)} disabled={!quadroAgora || quadroAgora.to === null} title="Segura o quadro uma célula a menos">－ segura</button>
      <button onclick={fimAqui} disabled={!quadroAgora?.name} title="A camada fica vazia a partir daqui (o desenho some neste instante)">∅ fim</button>
      <button onclick={tirarQuadro} disabled={!quadroAgora} title="Tira o quadro que está à mostra">✕ tirar</button>
      <span class="sep"></span>
      <button class:on={a.cebola} onclick={() => (a.cebola = !a.cebola)} title="Papel de cebola: os quadros vizinhos por baixo (antes em rosa, depois em verde)">🧅</button>
      <label title="Quantos quadros antes">‹ <input type="number" min="0" max="6" value={a.antes} onchange={(e) => (a.antes = Math.max(0, Math.min(6, +(e.target as HTMLInputElement).value)))} /></label>
      <label title="Quantos quadros depois"><input type="number" min="0" max="6" value={a.depois} onchange={(e) => (a.depois = Math.max(0, Math.min(6, +(e.target as HTMLInputElement).value)))} /> ›</label>
      <span class="sep"></span>
      <label title="Quadros por segundo da tira: o passo de cada célula (12 = animar em dois num jogo a 24)"
        ><select value={a.fps} onchange={(e) => ((a.fps = +(e.target as HTMLSelectElement).value), irPara(agora()))}>{#each [6, 8, 12, 15, 24, 30] as f}<option value={f}>{f} qps</option>{/each}</select></label
      >
      <span class="onde">{(celAtual / a.fps).toFixed(2)} s · célula {celAtual + 1}{quadroAgora?.name ? ` · ${quadroAgora.name}` : " · vazio"}</span>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tira" bind:this={tira} onpointerdown={tiraDown} onpointermove={tiraMove} onpointerup={tiraUp} onpointercancel={() => ((pega = null), (arrasta = false))}>
      <div class="trilho" style:width="{nCel * W}px">
        <div class="ossos" title="Onde a animação de ossos tem chaves">
          {#each chavesOssos as c}<i style:left="{c * W + W / 2 - 2}px"></i>{/each}
        </div>
        <div class="celulas">
          {#each Array(nCel) as _, c}<span class="cel" class:seg={c % a.fps === 0} class:fora={c > celulaDe(dur)} style:width="{W}px">{c % a.fps === 0 ? `${c / a.fps}s` : ""}</span>{/each}
        </div>
        {#each blocos as b (b.i)}
          <div class="bloco" class:atual={quadroAgora?.name === b.name && Math.abs((quadroAgora?.from ?? -1) - b.time) < 1e-4} style:left="{b.c0 * W}px" style:width="{b.n * W - 2}px">
            <canvas width="56" height="42" use:mini={{ d: desenhoDe(b.name), img: imagemDoQuadro(b.name), v: app.version }}></canvas>
            <span>{b.name?.replace(/^.*_/, "")}</span>
          </div>
        {/each}
        {#if pega?.andou}
          <div class="fantasma" class:dura={pega.modo === "segurar"} style:left="{(pega.modo === "segurar" ? pega.c0 : pega.c0 + pega.d) * W}px" style:width="{(pega.modo === "segurar" ? pega.n + pega.d : pega.n) * W - 2}px"></div>
        {/if}
        <div class="agulha" style:left="{celAtual * W}px" style:width="{W}px"></div>
      </div>
    </div>
    {#if !a.layer}<div class="dica">Desenhe na tela: o primeiro traço cria a camada de quadros no osso escolhido (ou na raiz) e o quadro neste instante.</div>{/if}
  </div>
{/if}

<style>
  .lona {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .topo,
  .pe,
  .regua {
    position: absolute;
    background: #1b1822e6;
    border: 1px solid var(--line);
    border-radius: 12px;
    backdrop-filter: blur(8px);
    font-size: 13px;
  }
  .topo {
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    white-space: nowrap;
    max-width: calc(100% - 20px);
  }
  .topo button,
  .pe button {
    padding: 5px 9px;
    border-radius: 8px;
  }
  .sair {
    color: var(--dim);
  }
  .peca {
    padding: 0 6px;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--line);
    margin: 2px 4px;
  }
  .ferr {
    display: flex;
    gap: 2px;
  }
  button.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .cores {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .cores input[type="color"] {
    width: 30px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
  }
  .cor {
    width: 18px;
    height: 18px;
    padding: 0 !important;
    border-radius: 50% !important;
    border: 2px solid #0006;
  }
  .cor.on {
    border-color: #fff;
  }
  .giro {
    color: var(--accent2);
    font-variant-numeric: tabular-nums;
  }
  .mesa {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .mesa input {
    width: 70px;
  }
  .regua {
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 10px 6px;
    width: 76px;
  }
  .qual {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 64px;
    padding: 6px 2px;
    border-radius: 10px;
  }
  .qual .ic {
    font-size: 20px;
  }
  .qual .nm {
    font-size: 10.5px;
    line-height: 1.15;
    text-align: center;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .ic-grande {
    font-size: 22px;
  }
  .aviso-pincel {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    max-width: min(560px, calc(100% - 220px));
    padding: 9px 14px;
    background: #1b1822f0;
    border: 1px solid var(--accent2);
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.4;
  }
  .gira {
    display: inline-block;
    width: 11px;
    height: 11px;
    margin-right: 4px;
    border: 2px solid var(--accent);
    border-top-color: transparent;
    border-radius: 50%;
    vertical-align: -1px;
    animation: gira 0.9s linear infinite;
  }
  @keyframes gira {
    to {
      transform: rotate(360deg);
    }
  }
  .regua label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .regua .val {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .regua .nome {
    color: var(--dim);
    font-size: 11px;
  }
  .vert {
    writing-mode: vertical-lr;
    direction: rtl;
    height: 120px;
    width: 22px;
  }
  .estilos {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
  }
  .estilos button {
    padding: 4px 2px;
    font-size: 11px;
    border-radius: 7px;
  }
  .pe {
    left: 96px;
    right: 10px;
    bottom: 10px;
    padding: 6px 8px 8px;
  }
  .botoes {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .botoes input[type="number"] {
    width: 38px;
  }
  .play {
    min-width: 40px;
  }
  .novo {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .ib {
    display: inline-flex;
    gap: 2px;
    align-items: center;
  }
  .onde {
    margin-left: auto;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }
  .tira {
    overflow-x: auto;
    overflow-y: hidden;
    border-radius: 8px;
    background: #121017;
    cursor: pointer;
    touch-action: none;
  }
  .trilho {
    position: relative;
    height: 78px;
  }
  .ossos {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 8px;
  }
  .ossos i {
    position: absolute;
    top: 2px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--claude);
    opacity: 0.8;
  }
  .celulas {
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 0;
    display: flex;
  }
  .cel {
    flex: none;
    border-left: 1px solid #ffffff0d;
    font-size: 10px;
    color: var(--dim);
    padding: 1px 2px;
    user-select: none;
  }
  .cel.seg {
    border-left-color: #ffffff38;
  }
  .cel.fora {
    background: #0000002e;
  }
  .bloco {
    position: absolute;
    top: 22px;
    height: 52px;
    background: #2c2738;
    border: 1px solid #4a4360;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 3px;
    pointer-events: none;
  }
  .bloco canvas {
    flex: none;
    height: 42px;
    width: auto;
    max-width: calc(100% - 4px);
    background: #6f6a7c;
    border-radius: 4px;
    margin-left: 2px;
  }
  .bloco span {
    font-size: 10px;
    color: var(--dim);
  }
  .bloco::after {
    content: "";
    position: absolute;
    right: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background: #ffffff30;
  }
  .fantasma {
    position: absolute;
    top: 20px;
    height: 56px;
    border: 2px dashed var(--accent);
    border-radius: 7px;
    background: #ff2e8822;
    pointer-events: none;
  }
  .fantasma.dura {
    border-color: var(--accent2);
    background: #ffd16622;
  }
  .bloco.atual {
    border-color: var(--accent);
    background: #3a2440;
  }
  .agulha {
    position: absolute;
    top: 0;
    bottom: 0;
    background: #ff2e8826;
    border-left: 2px solid var(--accent);
    pointer-events: none;
  }
  .dica {
    color: var(--dim);
    margin-top: 6px;
  }
</style>
