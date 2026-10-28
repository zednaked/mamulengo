<script lang="ts">
  import { app } from "./state.svelte.ts";

  // animacao alvo: a atual, ou uma nova "1.idle"
  function anim(): string {
    return app.play.animation ?? "1.idle";
  }

  async function apply(cmd: string, args: Record<string, any>, label: string) {
    const a = anim();
    const r = await app.runAsync([{ cmd, args: { anim: a, ...args } }], label);
    if (r && app.viewer) {
      if (app.viewer.view.animation !== a) app.viewer.setAnimation(a);
      app.viewer.view.loop = true;
      app.viewer.view.playing = true;
    }
  }

  // sobreposicao: a cadeia de filhos (primeiro filho de cada nivel) repete o giro
  function overlap() {
    const from = app.selection.bone!;
    const bones = app.doc!.json.bones;
    const chain: string[] = [];
    let cur = from;
    for (;;) {
      const kid = bones.find((x: any) => x.parent === cur);
      if (!kid) break;
      chain.push(kid.name);
      cur = kid.name;
    }
    if (!chain.length) return app.toast(`${from} nao tem ossos filhos para arrastar.`);
    const a = anim();
    if (!app.doc!.json.animations?.[a]?.bones?.[from]?.rotate) return app.toast(`Anime o giro de ${from} primeiro (ou use Balancar).`);
    app.run({ cmd: "anim.overlap", args: { anim: a, from, chain } }, `sobreposicao em ${chain.join(", ")}`);
  }

  async function physics(preset: string) {
    const bone = app.selection.bone!;
    await app.runAsync([{ cmd: "physics.preset", args: { bone, preset, name: `${bone}_${preset}` } }], `fisica ${preset} em ${bone}`);
    if (app.viewer) app.viewer.view.playing = true;
  }

  // olhos: precisa de duas imagens no slot (aberto/fechado)
  const slotAtts = $derived.by(() => {
    app.version;
    const s = app.selection.slot;
    if (!s || !app.doc) return [];
    const out: string[] = [];
    for (const sk of app.doc.json.skins ?? []) for (const n of Object.keys(sk.attachments?.[s] ?? {})) if (!out.includes(n)) out.push(n);
    return out;
  });
  const current = $derived.by(() => {
    app.version;
    return app.doc?.json.slots.find((x: any) => x.name === app.selection.slot)?.attachment ?? null;
  });
</script>

{#if app.doc && (app.selection.bone || app.selection.slot)}
  <div class="rec">
    <div class="head">Movimentos prontos <span class="dim">em {anim()}</span></div>
    {#if app.selection.bone}
      {@const b = app.selection.bone}
      <div class="grid">
        <button onclick={() => apply("recipe.breathe", { bone: b }, `respirar ${b}`)}>🫁 Respirar</button>
        <button onclick={() => apply("recipe.sway", { bone: b }, `balancar ${b}`)}>〰 Balancar</button>
        <button onclick={() => apply("recipe.bounce", { bone: b }, `quicar ${b}`)}>⤒ Quicar</button>
        <button onclick={() => apply("recipe.popin", { bone: b, slot: app.selection.slot }, `entrar ${b}`)}>💥 Entrar</button>
        <button onclick={() => apply("recipe.shake", { bone: b }, `tremer ${b}`)}>〽 Tremer</button>
        <button onclick={overlap} title="Os ossos filhos repetem o giro deste com atraso (rabo, cabelo, orelha)">🐍 Arrastar a ponta</button>
      </div>
      <div class="head">Balanco sozinho (fisica)</div>
      <div class="grid">
        <button onclick={() => physics("cabelo")}>💇 Cabelo</button>
        <button onclick={() => physics("orelha")}>👂 Orelha</button>
        <button onclick={() => physics("tecido")}>👕 Tecido</button>
        <button onclick={() => physics("mola")}>🌀 Mola</button>
        <button onclick={() => physics("pendurado")}>🎐 Pendurado</button>
      </div>
    {/if}
    {#if app.selection.slot}
      {@const s = app.selection.slot}
      <div class="grid">
        <button onclick={() => apply("recipe.pulse", { slot: s }, `pulsar ${s}`)}>✨ Pulsar brilho</button>
        {#if slotAtts.length >= 2}
          <button
            onclick={() => {
              const open = current ?? slotAtts[0];
              const closed = slotAtts.find((x) => x !== open)!;
              apply("recipe.blink", { slot: s, open, closed }, `piscar ${s}`);
            }}>😉 Piscar</button
          >
          <button onclick={() => apply("recipe.flipbook", { slot: s, frames: slotAtts }, `flipbook ${s}`)}>🎞 Flipbook</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .rec {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .head {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent2);
    margin-top: 4px;
  }
  .head .dim {
    text-transform: none;
    letter-spacing: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }
  .grid button {
    text-align: left;
    padding: 7px 8px;
    font-size: 13px;
  }
</style>
