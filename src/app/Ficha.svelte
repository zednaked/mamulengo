<script lang="ts">
  // Ficha do personagem: o que a animacao aberta deve fazer e se esta cumprindo.
  // Regras conferidas a cada mudanca; a parte selecionada mostra o valor de agora
  // contra o limite da ficha.
  import { app } from "./state.svelte.ts";
  import { checkAnimation, fichaSections, parseFicha, wrapDeg, fmt, type RuleResult } from "../core/ficha.ts";

  let editing = $state(false);
  let text = $state("");
  let busy = $state(false);
  let showOk = $state(false);

  const anim = $derived(app.play.animation);
  const parsed = $derived(app.ficha?.text ? { rules: parseFicha(app.ficha.text), sections: fichaSections(app.ficha.text) } : null);
  const section = $derived(anim && parsed ? parsed.sections.anims[anim] : undefined);
  const rules = $derived(anim && parsed ? [...parsed.rules.all, ...(parsed.rules.byAnim[anim] ?? [])].filter((r) => !r.except.includes(anim)) : []);

  // conferir custa amostrar a animacao inteira: espera o documento parar de mudar
  let results = $state<RuleResult[]>([]);
  let checking = $state(false);
  let timer = 0;
  $effect(() => {
    app.version;
    const a = anim,
      rs = rules,
      doc = app.doc;
    clearTimeout(timer);
    if (!a || !doc || !rs.length) {
      results = [];
      return;
    }
    checking = true;
    timer = window.setTimeout(() => {
      try {
        results = checkAnimation(doc.json, a, rs);
      } catch (e: any) {
        results = [{ rule: "ficha", ok: false, detail: String(e?.message ?? e) }];
      }
      checking = false;
    }, 450);
  });
  const fails = $derived(results.filter((r) => !r.ok).length);
  $effect(() => {
    app.fichaFails = fails;
  });

  // ao vivo: limites da parte selecionada no tempo atual
  const live = $derived.by(() => {
    app.play.time;
    app.version;
    const b = app.selection.bone;
    const sk = app.viewer?.skeleton;
    if (!b || !sk) return [];
    const bone = sk.findBone(b);
    if (!bone) return [];
    const p = bone.pose,
      s = bone.data.setupPose;
    const val: Record<string, number> = {
      rotate: wrapDeg(p.rotation - s.rotation),
      x: p.x - s.x,
      y: p.y - s.y,
      scaleX: p.scaleX / (s.scaleX || 1),
      scaleY: p.scaleY / (s.scaleY || 1),
      shearX: p.shearX - s.shearX,
      shearY: p.shearY - s.shearY,
    };
    return rules
      .filter((r) => r.kind === "limite" && r.args[0] === b && r.args[1] in val)
      .map((r) => {
        const [lo, hi] = r.args[2].split("..").map(Number);
        const v = val[r.args[1]];
        return { channel: r.args[1], v, lo, hi, ok: v >= lo - 1e-3 && v <= hi + 1e-3 };
      });
  });

  // "em t=0.63" no detalhe vira botao para ir ao instante
  function timeOf(detail: string): number | null {
    const m = /t=([\d.]+)/.exec(detail);
    return m ? +m[1] : null;
  }

  async function create() {
    busy = true;
    try {
      text = await app.draftFicha();
      editing = true;
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      busy = false;
    }
  }

  async function save() {
    busy = true;
    try {
      await app.saveFicha(text);
      editing = false;
    } catch (e: any) {
      app.toast(String(e?.message ?? e));
    } finally {
      busy = false;
    }
  }
</script>

<div class="ficha">
  {#if !app.doc}
    <p class="dim">Abra um personagem.</p>
  {:else if editing}
    <div class="row">
      <b>Editando a ficha</b>
      <span class="spacer"></span>
      <button onclick={() => (editing = false)} disabled={busy}>cancelar</button>
      <button class="go" onclick={save} disabled={busy}>{busy ? "salvando…" : "salvar"}</button>
    </div>
    <textarea bind:value={text} spellcheck="false"></textarea>
    <p class="dim small">Grava em {app.ficha?.path} (com cópia de segurança). Regras: blocos ```regras; formato em docs/FICHA.md.</p>
  {:else if !app.ficha?.text}
    <p>Este personagem ainda não tem ficha.</p>
    <p class="dim">A ficha diz o que cada animação deve fazer, os limites do boneco e regras que o editor confere sozinho. O rascunho mede o boneco e lê o código do jogo; você completa a intenção.</p>
    <button class="go" onclick={create} disabled={busy}>{busy ? "gerando…" : "Criar ficha"}</button>
  {:else}
    <div class="row">
      <b>{anim ?? "pose de montagem"}</b>
      <span class="spacer"></span>
      <button onclick={() => app.loadFicha()} title="Reler do disco">reler</button>
      <button
        onclick={() => {
          text = app.ficha?.text ?? "";
          editing = true;
        }}>editar</button
      >
    </div>

    {#if live.length}
      <div class="live">
        {#each live as l (l.channel)}
          <div class:bad={!l.ok}>
            <b>{app.selection.bone}</b> {l.channel} agora <b>{fmt(l.v)}</b> <span class="dim">(ficha: {fmt(l.lo)} a {fmt(l.hi)})</span>
            {#if !l.ok}<span class="tag">passou do limite</span>{/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if anim && !section}
      <p class="dim">A ficha não descreve esta animação. Escreva a seção <code>## Animacao: {anim}</code> (para que serve, roteiro, o que não fazer).</p>
    {/if}
    {#if section}
      {#each section.fields as f (f.label)}
        <div class="field"><span class="label">{f.label}</span> {f.text}</div>
      {/each}
    {/if}

    {#if rules.length}
      <div class="rules">
        <div class="row">
          <b>Regras</b>
          <span class="spacer"></span>
          {#if checking}<span class="dim small">conferindo…</span>{:else if fails}<span class="bad small">{fails} falhando</span>{:else}<span class="ok small">todas ok</span>{/if}
        </div>
        {#each results.filter((r) => !r.ok) as r, i (i)}
          {@const t = timeOf(r.detail)}
          <div class="rule bad">
            <span class="mark">✗</span>
            <code>{r.rule}</code>
            <span class="dim">{r.detail}</span>
            {#if t !== null}<button class="mini" onclick={() => app.viewer?.seek(t)}>ver</button>{/if}
          </div>
        {/each}
        {#if results.some((r) => r.ok)}
          <button class="mini more" onclick={() => (showOk = !showOk)}>{showOk ? "esconder" : "mostrar"} {results.filter((r) => r.ok).length} regras ok</button>
          {#if showOk}
            {#each results.filter((r) => r.ok) as r, i (i)}
              <div class="rule"><span class="mark">✓</span> <code>{r.rule}</code> <span class="dim">{r.detail}</span></div>
            {/each}
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .ficha {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    font-size: 13px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .spacer {
    flex: 1;
  }
  .dim {
    color: var(--dim);
  }
  .small {
    font-size: 12px;
  }
  .field {
    line-height: 1.4;
  }
  .label {
    color: var(--accent);
    font-weight: 600;
  }
  .live {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
  }
  .live .bad,
  .rule.bad,
  .bad {
    color: #ff8a8a;
  }
  .ok {
    color: #7ddc8f;
  }
  .tag {
    background: #ff8a8a33;
    border-radius: 4px;
    padding: 0 4px;
    margin-left: 4px;
  }
  .rules {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-top: 1px solid var(--line);
    padding-top: 8px;
  }
  .rule {
    display: flex;
    gap: 6px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .rule code {
    font-size: 12px;
  }
  .mark {
    width: 12px;
  }
  .more {
    align-self: flex-start;
    margin-top: 2px;
  }
  .mini {
    padding: 0 6px;
    font-size: 11px;
  }
  .go {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  textarea {
    width: 100%;
    min-height: 360px;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    background: var(--bg, #15131b);
    color: inherit;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px;
    resize: vertical;
  }
</style>
