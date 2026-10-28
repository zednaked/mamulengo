<script lang="ts">
  import { CURVE_PRESETS } from "../core/model.ts";
  let { preset, size = 18 }: { preset: string; size?: number } = $props();
  const c = $derived(CURVE_PRESETS[preset]);
  // desenha a curva normalizada num quadrado com margem para overshoot
  const path = $derived.by(() => {
    const m = 0.25;
    const X = (x: number) => (x * size).toFixed(1);
    const Y = (y: number) => ((1 - (y + m) / (1 + 2 * m)) * size).toFixed(1);
    if (c === "stepped") return `M0 ${Y(0)} H${size} M${size} ${Y(0)} V${Y(1)}`;
    if (c === "linear") return `M0 ${Y(0)} L${size} ${Y(1)}`;
    const [x1, y1, x2, y2] = c;
    return `M0 ${Y(0)} C${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)} ${size} ${Y(1)}`;
  });
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}"><path d={path} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
