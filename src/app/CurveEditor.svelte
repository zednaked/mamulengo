<script lang="ts">
  // Grafico da curva entre a chave selecionada e a proxima, com duas alcas.
  // A forma e normalizada (0..1 em tempo e valor, como o cubic-bezier do CSS).
  import { app } from "./state.svelte.ts";
  import { keyValues, normalize, type Bezier } from "../core/model.ts";

  let { anim, target, timeline, time, keys }: { anim: string; target: any; timeline: string; time: number; keys: any[] } = $props();

  const W = 150,
    H = 100,
    PAD = 18;
  // espaco do grafico: y vai de -0.4 a 1.4 para caber overshoot
  const X = (x: number) => PAD + x * (W - 2 * PAD);
  const Y = (y: number) => H - PAD / 2 - ((y + 0.4) / 1.8) * (H - PAD);
  const fromScreen = (px: number, py: number): [number, number] => [Math.max(0, Math.min(1, (px - PAD) / (W - 2 * PAD))), ((H - PAD / 2 - py) / (H - PAD)) * 1.8 - 0.4];

  const shape = $derived.by((): Bezier | "stepped" | "linear" | null => {
    const i = keys.findIndex((k) => Math.abs((k.time ?? 0) - time) < 1e-4);
    const k = keys[i],
      next = keys[i + 1];
    if (!k || !next) return null;
    if (k.curve === "stepped") return "stepped";
    if (!Array.isArray(k.curve)) return "linear";
    const v0 = timeline === "deform" ? [0] : keyValues(timeline, k);
    const v1 = timeline === "deform" ? [1] : keyValues(timeline, next);
    // usa o canal que mais muda (o primeiro pode ser constante)
    let ch = 0;
    v0.forEach((v, j) => Math.abs(v1[j] - v) > Math.abs(v1[ch] - v0[ch]) && (ch = j));
    return normalize(k.curve.slice(ch * 4, ch * 4 + 4), k.time ?? 0, v0[ch], next.time ?? 0, v1[ch]);
  });

  let drag: { h: 0 | 1; merge: string } | null = null;
  let seq = 0;
  let svg: SVGSVGElement | undefined = $state();

  function down(e: PointerEvent, h: 0 | 1) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { h, merge: `curva${++seq}` };
  }
  function move(e: PointerEvent) {
    if (!drag || !svg || !Array.isArray(shape)) return;
    const r = svg.getBoundingClientRect();
    const [x, y] = fromScreen(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    const c = [...shape] as Bezier;
    c[drag.h * 2] = +x.toFixed(3);
    c[drag.h * 2 + 1] = +y.toFixed(3);
    app.run({ cmd: "curve.set", args: { anim, target, timeline, time, curve: c } }, `curva ${timeline} @${time}`, drag.merge);
  }
</script>

{#if shape}
  <div class="ce">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg bind:this={svg} width={W} height={H} viewBox="0 0 {W} {H}" onpointermove={move} onpointerup={() => (drag = null)}>
      <rect x={X(0)} y={Y(1)} width={X(1) - X(0)} height={Y(0) - Y(1)} class="box" />
      {#if shape === "stepped"}
        <path d="M{X(0)} {Y(0)} H{X(1)} V{Y(1)}" class="curve" />
      {:else if shape === "linear"}
        <path d="M{X(0)} {Y(0)} L{X(1)} {Y(1)}" class="curve" />
        <text x={W / 2} y={H - 2} class="hint">linear: escolha uma curva</text>
      {:else}
        <line x1={X(0)} y1={Y(0)} x2={X(shape[0])} y2={Y(shape[1])} class="arm" />
        <line x1={X(1)} y1={Y(1)} x2={X(shape[2])} y2={Y(shape[3])} class="arm" />
        <path d="M{X(0)} {Y(0)} C{X(shape[0])} {Y(shape[1])} {X(shape[2])} {Y(shape[3])} {X(1)} {Y(1)}" class="curve" />
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <circle cx={X(shape[0])} cy={Y(shape[1])} r="6" class="h" onpointerdown={(e) => down(e, 0)} />
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <circle cx={X(shape[2])} cy={Y(shape[3])} r="6" class="h" onpointerdown={(e) => down(e, 1)} />
      {/if}
    </svg>
  </div>
{/if}

<style>
  .ce {
    background: #14121a;
    border-radius: 8px;
    padding: 2px;
  }
  svg {
    display: block;
    touch-action: none;
  }
  .box {
    fill: none;
    stroke: #2c2834;
  }
  .curve {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.5;
  }
  .arm {
    stroke: #6b6478;
    stroke-width: 1;
  }
  .h {
    fill: var(--accent2);
    cursor: grab;
  }
  .hint {
    fill: var(--dim);
    font-size: 9px;
    text-anchor: middle;
  }
</style>
