<script lang="ts">
  import { app, type AssetInfo } from "./state.svelte.ts";
  import { NAVEGADOR, baixarZipPasta, baixarZipPersonagem, darAcesso, escolherPasta, importarZip, semPermissao, temEscolherPasta, tirarPasta } from "../navegador/pagina.ts";
  import type { Raiz } from "../navegador/fs.ts";

  // no editor pelo navegador: as pastas do computador que pedem a permissao de novo
  let pedindo = $state<Raiz[]>([]);
  const verPermissoes = async () => {
    if (NAVEGADOR) pedindo = await semPermissao();
  };
  async function abrirPasta() {
    if (!(await escolherPasta())) return;
    await verPermissoes();
    await app.loadAssets(true);
  }
  async function acesso(r: Raiz) {
    if (await darAcesso(r)) {
      await verPermissoes();
      await app.loadAssets(true);
    }
  }
  async function esquecer(r: Raiz) {
    await tirarPasta(r.caminho);
    await verPermissoes();
    await app.loadAssets(true);
  }

  // .zip: levar o trabalho para fora do navegador e trazer de volta (no Firefox e no Safari e o
  // unico caminho entre o navegador e o computador)
  let zipInput = $state<HTMLInputElement>();
  let destinoZip = $state("/navegador");
  let zipando = $state(false);
  const msg = (e: any) => app.toast(String(e?.message ?? e));
  async function baixarPersonagem() {
    const a = app.asset;
    if (!a?.tres.endsWith(".boneco")) return;
    if (app.doc?.dirty) app.toast("Há alterações não salvas: o .zip leva o que está gravado. Salve (Ctrl+S) e baixe de novo para levar tudo.");
    zipando = true;
    try {
      const r = await baixarZipPersonagem(a.tres);
      if (r.faltando.length) app.toast(`O .zip foi sem ${r.faltando.length === 1 ? "este arquivo, que não existe" : "estes arquivos, que não existem"}: ${r.faltando.map((f) => f.slice(f.lastIndexOf("/") + 1)).join(", ")}`);
    } catch (e) {
      msg(e);
    } finally {
      zipando = false;
    }
  }
  // a pasta de um grupo da lista (o primeiro nivel abaixo da raiz, ou a propria raiz)
  function pastaDoGrupo(a: AssetInfo) {
    const raiz = a.tres.slice(0, a.tres.length - a.res.length - 1);
    return a.res.includes("/") ? `${raiz}/${a.res.split("/")[0]}` : raiz;
  }
  async function baixarPasta(a: AssetInfo) {
    zipando = true;
    try {
      await baixarZipPasta(pastaDoGrupo(a));
    } catch (e) {
      msg(e);
    } finally {
      zipando = false;
    }
  }
  async function importar(f: FileList | null) {
    const arq = f?.[0];
    if (zipInput) zipInput.value = "";
    if (!arq) return;
    zipando = true;
    try {
      const r = await importarZip(arq, destinoZip);
      await app.loadAssets(true);
      app.toast(`${arq.name}: ${r.arquivos.length} ${r.arquivos.length === 1 ? "arquivo" : "arquivos"} em ${r.pasta}`);
      // um personagem so, ou o que tem o nome do .zip: abre
      const nome = arq.name.replace(/\.zip$/i, "");
      const alvo = r.bonecos.length === 1 ? r.bonecos[0] : r.bonecos.find((b) => b.slice(b.lastIndexOf("/") + 1) === `${nome}.boneco`);
      const asset = alvo && app.assets.find((x) => x.tres === alvo);
      if (asset) await choose(asset);
    } catch (e) {
      msg(e);
    } finally {
      zipando = false;
    }
  }

  let open = $state(false);
  let q = $state("");

  const groups = $derived.by(() => {
    const f = q.trim().toLowerCase();
    const m = new Map<string, AssetInfo[]>();
    for (const a of app.assets) {
      if (f && !`${a.project}/${a.name}`.toLowerCase().includes(f)) continue;
      m.set(a.project, [...(m.get(a.project) ?? []), a]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  async function choose(a: AssetInfo) {
    if (app.doc?.dirty && !confirmDiscard()) return;
    open = false;
    await app.open(a);
  }

  // sem dialogo do navegador: um segundo clique confirma
  let armed = 0;
  function confirmDiscard() {
    if (Date.now() - armed < 3000) return true;
    armed = Date.now();
    app.toast("Há alterações não salvas. Salve (Ctrl+S), ou clique de novo para trocar e perder as alterações.");
    return false;
  }
</script>

<div class="picker">
  <button class="current" onclick={() => ((open = !open), open && verPermissoes())}>
    {#if app.asset}
      <span class="dim">{app.asset.project} /</span> <b>{app.asset.name}</b>
    {:else}
      Abrir personagem…
    {/if}
    <span class="dim">▾</span>
  </button>
  {#if open}
    <div class="pop">
      <!-- svelte-ignore a11y_autofocus -->
      <input placeholder="procurar ({app.assets.length} {app.assets.length === 1 ? 'personagem' : 'personagens'})" bind:value={q} autofocus />
      {#if !app.spectator}<button class="novo" onclick={() => ((open = false), (app.novoAberto = true))} title="Um personagem em branco, só com o osso raiz, para desenhar e animar do zero">＋ Novo em branco…</button>{/if}
      {#if NAVEGADOR}
        <div class="pastas">
          {#if temEscolherPasta}<button onclick={abrirPasta}>Abrir pasta do computador…</button>{/if}
          <div class="zip">
            <button disabled={zipando} onclick={() => zipInput?.click()} title="Traz um personagem (ou uma pasta inteira) de um .zip para uma pasta nova; nada existente é sobrescrito">Importar .zip…</button>
            {#if app.roots.length > 1}
              <select bind:value={destinoZip} title="Onde criar a pasta do .zip">
                {#each app.roots as r}<option value={r}>em {r}</option>{/each}
              </select>
            {/if}
            {#if app.asset?.tres.endsWith(".boneco")}<button disabled={zipando} onclick={baixarPersonagem} title="O .boneco aberto e tudo o que ele usa: páginas, relevo, images/, notas e os personagens das instâncias">Baixar {app.asset.name} (.zip)</button>{/if}
          </div>
          <input bind:this={zipInput} type="file" accept=".zip,application/zip" hidden onchange={(e) => importar((e.target as HTMLInputElement).files)} />
          {#each pedindo as r}
            <div class="pede">
              <span>{r.nome}</span>
              <button onclick={() => acesso(r)}>Dar acesso</button>
              <button class="dim" onclick={() => esquecer(r)}>tirar</button>
            </div>
          {/each}
          {#if !temEscolherPasta}<div class="dim vazio">Este navegador só guarda os personagens dentro dele (os exemplos e o que você criar). Para abrir pastas do computador, use o Chrome ou o Edge.</div>{/if}
        </div>
      {/if}
      <div class="list">
        {#if app.assetsLidos && !app.assets.length && NAVEGADOR}<div class="dim vazio">Nenhum personagem nas pastas abertas. Abra uma pasta com arquivos .boneco.</div>{:else if app.assetsLidos && !app.assets.length}<div class="dim vazio">Nenhum personagem em {app.roots.join(", ")}. Crie um em branco (＋ Novo em branco), arraste um PSD para a janela, ou abra o editor com MAMULENGO_ROOTS apontando para as suas pastas.</div>{/if}
        {#each groups as [proj, list]}
          <div class="proj">
            <span>{proj}</span>
            {#if NAVEGADOR}<button class="dim mini" disabled={zipando} onclick={() => baixarPasta(list[0])} title="Baixar a pasta {pastaDoGrupo(list[0])} inteira em .zip">⇩ .zip</button>{/if}
          </div>
          {#each list as a}
            <button class="item" class:on={a.id === app.asset?.id} onclick={() => choose(a)}>{a.name}<span class="dim res">{a.res.replace("res://", "")}</span></button>
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .novo {
    text-align: left;
    color: var(--accent);
    font-weight: 600;
  }
  .pastas {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pede {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .pede span {
    flex: 1;
  }
  .vazio {
    padding: 8px;
    font-size: 12px;
    white-space: normal;
  }
  .picker {
    position: relative;
  }
  .current {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 260px;
    justify-content: space-between;
  }
  .pop {
    position: absolute;
    top: 40px;
    left: 0;
    width: 440px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    z-index: 20;
    box-shadow: 0 16px 40px #0009;
  }
  .list {
    overflow: auto;
  }
  .zip {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .zip select {
    flex: 0 1 auto;
    min-width: 0;
  }
  .proj {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent2);
    margin: 8px 4px 4px;
  }
  .proj .mini {
    font-size: 11px;
    padding: 0 6px;
    text-transform: none;
    letter-spacing: 0;
    background: none;
    border: none;
  }
  .item {
    display: flex;
    justify-content: space-between;
    width: 100%;
    background: none;
    border: none;
    text-align: left;
  }
  .item:hover {
    background: var(--panel2);
  }
  .item.on {
    background: #3a2433;
  }
  .res {
    font-size: 11px;
    margin-left: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
