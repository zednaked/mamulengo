<script lang="ts">
  // O papel do osso para o código do jogo (docs/EDITOR.md "Papéis"; docs/NUCLEO.md "Papeis"): botão
  // (área de toque com estados, cada estado uma animação), toque (só a área) ou texto do código (a
  // parte de texto que o jogo troca). O código acha pelo nome: tela.botao("jogar").aoTocar(...). A
  // área desenhada no viewport e o teste de toque são do núcleo; aqui só o comando role.set.
  import { app } from "./state.svelte.ts";
  import { execute } from "../core/commands/index.ts";
  import { NOME_ESTADO, STATES, groupSlots, rolesOf, type Role, type StateName } from "../core/papeis.ts";

  let { osso }: { osso: string } = $props();

  const NOMES_TIPO: Record<string, string> = { "": "nenhum", button: "botão", touch: "toque", text: "texto do código" };
  const DICA_ESTADO: Record<StateName, string> = {
    normal: "parado (em laço: o botão que pulsa)",
    hover: "o mouse em cima (no celular não há)",
    pressed: "apertado (até soltar)",
    disabled: "desligado pelo código (tela.botao(nome).desligar())",
  };

  const json = $derived.by(() => {
    app.version;
    return app.doc?.json as any;
  });
  // o papel deste osso: botão ou toque com este osso, ou texto num slot do grupo
  const meu = $derived.by((): Role | null => {
    if (!json) return null;
    const rs = rolesOf(json);
    const doGrupo = new Set(groupSlots(json, osso));
    return rs.find((r) => r.bone === osso) ?? rs.find((r) => r.type === "text" && r.slot && doGrupo.has(r.slot) && json.slots.find((s: any) => s.name === r.slot)?.bone === osso) ?? null;
  });
  const anims = $derived(json ? Object.keys(json.animations ?? {}) : []);
  const slotsGrupo = $derived(json ? groupSlots(json, osso) : []);
  const slotsTexto = $derived(slotsGrupo.filter((s) => (json?.skins ?? []).some((k: any) => Object.values<any>(k.attachments?.[s] ?? {}).some((a) => a?.type === "text"))));

  const run = (args: any, rotulo: string, merge?: string) => app.run({ cmd: "role.set", args }, rotulo, merge);
  function tipo(t: string) {
    if (!t) {
      if (meu) run({ name: meu.name, off: true }, `${meu.name} sem papel`);
      return;
    }
    const nome = meu?.name ?? osso.replace(/^(btn|bt|botao|button|toque|area|hit|txt|texto|text)[_\-. ]/i, "");
    if (t === "text") {
      const slot = slotsTexto[0];
      if (!slot) return app.toast("Este osso não tem parte de texto (+ texto antes).");
      if (meu) run({ name: meu.name, off: true }, "troca o papel");
      run({ name: nome, type: "text", slot }, `${nome}: texto do código`);
      return;
    }
    if (meu && meu.type === "text") run({ name: meu.name, off: true }, "troca o papel");
    const r = run({ name: nome, type: t, bone: osso, ...(t === "button" && !meu?.states ? { defaultStates: true } : {}) }, `${nome}: ${NOMES_TIPO[t]}`);
    if (r && t === "button" && !meu?.states) app.avisar(`${nome} é um botão. Os 4 estados ganharam poses curtas (${nome}/normal, ${nome}/em_cima...): anime cada um como quiser. Para testar, ▶ jogar a tela no viewport.`);
  }
  function renomear(n: string) {
    n = n.trim();
    if (!meu || !n || n === meu.name) return;
    run({ name: meu.name, to: n }, `papel ${meu.name} -> ${n}`);
  }
  function estado(s: StateName, a: string) {
    if (!meu) return;
    run({ name: meu.name, states: { [s]: a || null } }, `${meu.name}: ${NOME_ESTADO[s]} = ${a || "nada"}`);
  }
  function area(v: string) {
    if (!meu) return;
    if (v === "") run({ name: meu.name, area: null }, `${meu.name}: área do grupo`);
    else if (v === "#caixa") {
      // a caixa do que o grupo desenha agora, no osso (o meio e o tamanho), para começar
      const c = app.viewer?.nucleo?.papelCaixaNoOsso(meu.name) ?? [0, 0, 100, 60];
      run({ name: meu.name, area: { box: c } }, `${meu.name}: área em caixa`);
    } else run({ name: meu.name, area: { slot: v } }, `${meu.name}: área do slot ${v}`);
  }
  function caixa(i: number, v: number) {
    if (!meu?.area?.box || !Number.isFinite(v)) return;
    const b = [...meu.area.box];
    b[i] = v;
    if (b[2] > 0 && b[3] > 0) run({ name: meu.name, area: { box: b } }, `${meu.name}: caixa`, `papel-caixa-${meu.name}`);
  }
  // a prévia: a animação do estado no viewport (a escolhida na régua)
  function previa(a: string | undefined) {
    if (a) app.viewer?.setAnimation(a);
  }
  const codigo = $derived(meu ? (meu.type === "button" ? `tela.botao("${meu.name}").aoTocar(...)` : meu.type === "touch" ? `tela.toque("${meu.name}", ...)` : `tela.texto("${meu.name}", ...)`) : "");
</script>

<div class="efeitos papel">
  <div class="dim small secao" title="O que este elemento é para o código do jogo: o código acha pelo nome. A lista de todos (o manifesto): query.roles.">Papel no jogo</div>
  <div class="linha">
    <select value={meu?.type ?? ""} onchange={(e) => tipo((e.target as HTMLSelectElement).value)} title="botão: área de toque com estados; toque: só a área; texto do código: a parte de texto que o jogo troca">
      {#each Object.entries(NOMES_TIPO) as [v, n]}<option value={v}>{n}</option>{/each}
    </select>
    {#if meu}
      <input class="nome" value={meu.name} onchange={(e) => renomear((e.target as HTMLInputElement).value)} title="o nome que o código usa" />
    {/if}
  </div>
  {#if meu}
    <div class="codigo" title="como o código do jogo chama (src/tela/tela-boneco.ts)">{codigo}</div>
    {#if meu.type === "text"}
      <div class="linha">
        <span class="dim small">slot</span>
        <select value={meu.slot} onchange={(e) => run({ name: meu!.name, slot: (e.target as HTMLSelectElement).value }, `${meu!.name}: slot`)}>
          {#each slotsTexto as s}<option value={s}>{s}</option>{/each}
        </select>
      </div>
    {:else}
      <div class="linha" title="onde o toque vale: as partes do osso e dos filhos (a nove-fatias que cresce com o texto inclusive; o texto só se não houver outra), uma camada só, ou uma caixa no osso">
        <span class="dim small">área</span>
        <select value={meu.area?.box ? "#caixa" : (meu.area?.slot ?? "")} onchange={(e) => area((e.target as HTMLSelectElement).value)}>
          <option value="">as partes do grupo</option>
          {#each slotsGrupo as s}<option value={s}>só {s}</option>{/each}
          <option value="#caixa">uma caixa</option>
        </select>
      </div>
      {#if meu.area?.box}
        <div class="linha" title="a caixa no osso: o meio (x, y) e o tamanho">
          {#each ["x", "y", "larg.", "alt."] as r, i}
            <input type="number" step="1" value={meu.area.box[i]} onchange={(e) => caixa(i, +(e.target as HTMLInputElement).value)} title={r} />
          {/each}
        </div>
      {/if}
      {#if meu.type === "button"}
        {#each STATES as s}
          <div class="linha estado" title={DICA_ESTADO[s]}>
            <span class="dim small rot">{NOME_ESTADO[s].replace("_", " ")}</span>
            <select value={meu.states?.[s] ?? ""} onchange={(e) => estado(s, (e.target as HTMLSelectElement).value)}>
              <option value="">{s === "normal" ? "(nenhuma)" : "(como o " + (s === "pressed" ? "em cima" : "normal") + ")"}</option>
              {#each anims as a}<option value={a}>{a}</option>{/each}
            </select>
            <button disabled={!meu.states?.[s]} onclick={() => previa(meu!.states?.[s])} title="ver o estado no viewport">▶</button>
          </div>
        {/each}
        {#if STATES.some((s) => !meu!.states?.[s])}
          <button class="pequeno" onclick={() => run({ name: meu!.name, defaultStates: true }, `${meu!.name}: estados padrão`)} title="cria poses curtas para os estados que faltam (escala e cor do grupo), para animar depois">+ estados padrão</button>
        {/if}
        <div class="linha">
          <span class="dim small" title="segundos de emenda entre um estado e outro">mix</span>
          <input type="number" min="0" step="0.05" value={meu.mix ?? 0.1} onchange={(e) => run({ name: meu!.name, mix: Math.max(0, +(e.target as HTMLInputElement).value) }, `${meu!.name}: mix`)} />
          <label class="small" title="o botão começa desligado (o código liga com tela.botao(nome).ligar())"><input type="checkbox" checked={!!meu.disabled} onchange={(e) => run({ name: meu!.name, disabled: (e.target as HTMLInputElement).checked }, `${meu!.name}: começa ${(e.target as HTMLInputElement).checked ? "desligado" : "ligado"}`)} /> começa desligado</label>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .papel {
    margin: 6px 0;
    padding: 6px 0;
    border-top: 1px solid #ffffff14;
  }
  .secao {
    font-size: 11px;
    color: #9aa0b4;
    margin-bottom: 2px;
  }
  .small {
    font-size: 11px;
  }
  .dim {
    color: #9aa0b4;
  }
  .linha {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0;
  }
  .rot {
    width: 62px;
  }
  .estado select {
    flex: 1;
    min-width: 0;
  }
  .nome {
    flex: 1;
    min-width: 0;
  }
  .codigo {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: #7fd4ff;
    margin: 2px 0 4px;
    word-break: break-all;
  }
  input[type="number"] {
    width: 52px;
  }
  select {
    font-size: 11px;
  }
  .pequeno {
    font-size: 11px;
    padding: 1px 6px;
  }
</style>
