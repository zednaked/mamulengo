<script lang="ts">
  import { app } from "./state.svelte.ts";

  // a secao recolhe (lembrado no navegador); em tela baixa comeca recolhida, para os campos do
  // osso aparecerem sem rolar
  let aberto = $state(window.innerHeight > 860);
  try {
    const g = localStorage.getItem("mamulengo.receitas");
    if (g) aberto = g === "1";
  } catch {}
  function alterna() {
    aberto = !aberto;
    try {
      localStorage.setItem("mamulengo.receitas", aberto ? "1" : "0");
    } catch {}
  }

  // animacao alvo: a atual, ou uma nova "1.idle"
  function anim(): string {
    return app.play.animation ?? "1.idle";
  }

  async function apply(cmd: string, args: Record<string, any>, label: string) {
    const a = anim();
    const nova = !app.doc?.json.animations?.[a];
    const r = await app.runAsync([{ cmd, args: { anim: a, ...args } }], label);
    if (r) {
      const n = r[0]?.keys;
      app.avisar(`${label.charAt(0).toUpperCase() + label.slice(1).replace(" ", " em ")}: ${n ? `${n} chaves` : "pronto"} em ${a}${nova ? " (animação nova)" : ""}. Ctrl+Z desfaz.`);
    }
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
    if (!chain.length) return app.toast(`${from} não tem ossos filhos para arrastar junto.`);
    const a = anim();
    if (!app.doc!.json.animations?.[a]?.bones?.[from]?.rotate) return app.toast(`Anime o giro de ${from} primeiro (ou use Balançar).`);
    if (app.run({ cmd: "anim.overlap", args: { anim: a, from, chain } }, `sobreposicao em ${chain.join(", ")}`)) app.avisar(`${chain.join(", ")} agora repetem o giro de ${from} com atraso. Ctrl+Z desfaz.`);
  }

  async function physics(preset: string) {
    const bone = app.selection.bone!;
    if (await app.runAsync([{ cmd: "physics.preset", args: { bone, preset, name: `${bone}_${preset}` } }], `fisica ${preset} em ${bone}`))
      app.avisar(`${bone} agora balança sozinho (${preset}) quando o corpo se mexe. Ctrl+Z desfaz.`);
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
    <button class="head abre" onclick={alterna} aria-expanded={aberto} title={aberto ? "Recolher os movimentos prontos" : "Mostrar os movimentos prontos: respirar, balançar, quicar, física..."}
      >{aberto ? "▾" : "▸"} Movimentos prontos <span class="dim">{app.play.animation ? `em ${anim()}` : `criam a animação ${anim()}`}</span></button
    >
    {#if aberto && app.selection.bone}
      {@const b = app.selection.bone}
      <div class="grid">
        <button onclick={() => apply("recipe.breathe", { bone: b }, `respirar ${b}`)}>🫁 Respirar</button>
        <button onclick={() => apply("recipe.sway", { bone: b }, `balancar ${b}`)}>〰 Balançar</button>
        <button onclick={() => apply("recipe.bounce", { bone: b }, `quicar ${b}`)}>⤒ Quicar</button>
        <button onclick={() => apply("recipe.popin", { bone: b, slot: app.selection.slot }, `entrar ${b}`)}>💥 Entrar</button>
        <button onclick={() => apply("recipe.shake", { bone: b }, `tremer ${b}`)}>〽 Tremer</button>
        <button onclick={overlap} title="Os ossos filhos repetem o giro deste com atraso (rabo, cabelo, orelha)">🐍 Arrastar a ponta</button>
      </div>
      <div class="head">Balanço sozinho (física)</div>
      <div class="grid">
        <button onclick={() => physics("cabelo")}>💇 Cabelo</button>
        <button onclick={() => physics("orelha")}>👂 Orelha</button>
        <button onclick={() => physics("tecido")}>👕 Tecido</button>
        <button onclick={() => physics("mola")}>🌀 Mola</button>
        <button onclick={() => physics("pendurado")}>🎐 Pendurado</button>
      </div>
    {/if}
    {#if aberto && app.selection.slot}
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
  button.head.abre {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 0;
    font-weight: inherit;
    cursor: pointer;
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
