// O editor pelo navegador (um link so, sem instalar nada), do lado da pagina: liga o service
// worker que atende o /api (sw.ts, api.ts), escolhe pastas do computador e, na primeira vez, poe
// os personagens CC0 de exemplo na pasta propria do navegador.
import * as fs from "./fs.ts";

// definido pelo vite.navegador.config.ts; no editor com servidor (npm run dev) nao existe
declare const __NAVEGADOR__: boolean | undefined;
declare const __EXEMPLOS__: string[] | undefined;
export const NAVEGADOR = typeof __NAVEGADOR__ !== "undefined" && __NAVEGADOR__;

// o navegador deixa escolher uma pasta do computador? (Chromium; no Firefox e no Safari so a
// pasta propria do navegador)
export const temEscolherPasta = typeof window !== "undefined" && "showDirectoryPicker" in window;

// liga o service worker e espera ele controlar a pagina (na primeira visita, a pagina recarrega
// uma vez quando ele fica pronto)
export async function iniciar() {
  if (!("serviceWorker" in navigator)) throw new Error("Este navegador não tem service worker: abra o Mamulengo no Chrome, no Edge ou no Firefox.");
  const reg = await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { type: "module" });
  if (!navigator.serviceWorker.controller) {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((ok) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => ok(), { once: true });
        // ja ativo mas sem controlar (recarregar forcado): uma recarga normal resolve
        setTimeout(() => location.reload(), 3000);
      });
  }
  // versao nova do editor publicada: atualiza no proximo abrir
  void reg.update().catch(() => {});
  // o armazenamento do navegador nao some sozinho quando o disco aperta
  void navigator.storage?.persist?.().catch(() => false);
  await semearExemplos();
}

// os exemplos (tests/boneco e exemplos/coelho, CC0) na primeira vez: /navegador/exemplos/<pasta>/. A
// marca muda quando entra um exemplo novo: so os arquivos que faltam sao trazidos
async function semearExemplos() {
  const lista = typeof __EXEMPLOS__ !== "undefined" ? __EXEMPLOS__ : [];
  if (!lista.length || localStorage.getItem("mamulengo.exemplos") === "2") return;
  for (const rel of lista) {
    const destino = `${fs.OPFS}/${rel}`;
    if (await fs.existe(destino)) continue;
    const r = await fetch(new URL(rel, document.baseURI));
    if (r.ok) await fs.gravarArquivo(destino, await r.blob());
  }
  localStorage.setItem("mamulengo.exemplos", "2");
}

// escolher uma pasta do computador (num clique)
export async function escolherPasta(): Promise<string | null> {
  let h: FileSystemDirectoryHandle;
  try {
    h = await (window as any).showDirectoryPicker({ mode: "readwrite", id: "mamulengo" });
  } catch {
    return null;
  }
  const caminho = await fs.adicionarPasta(h);
  const r = (await fs.raizes()).find((x) => x.caminho === caminho);
  if (r) await fs.permissao(r, true);
  return caminho;
}

// pastas que pedem a permissao de novo (o navegador esquece ao fechar, se a pessoa nao escolheu
// "permitir sempre")
export async function semPermissao(): Promise<fs.Raiz[]> {
  const out: fs.Raiz[] = [];
  for (const r of await fs.raizes()) if (!(await fs.permissao(r))) out.push(r);
  return out;
}

export const darAcesso = (r: fs.Raiz) => fs.permissao(r, true);
export const tirarPasta = fs.tirarPasta;

// baixar um arquivo das pastas (o "abrir pasta" do servidor nao existe no navegador)
export async function baixar(caminho: string) {
  const f = await fs.lerArquivo(caminho);
  if (!f) throw new Error(`nao existe: ${caminho}`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(f);
  a.download = fs.nomeDe(caminho);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ---- .zip (src/navegador/pacote.ts): levar o trabalho para fora e para dentro do navegador

// pede o .zip ao /api e o entrega para baixar; devolve quantos arquivos foram e os citados que
// nao existem
async function baixarZip(rota: string, p: string): Promise<{ arquivos: number; faltando: string[] }> {
  const r = await fetch(`/api/zip/${rota}?p=${encodeURIComponent(p)}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `erro ${r.status}`);
  const nome = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "mamulengo.zip");
  const faltando: string[] = JSON.parse(decodeURIComponent(r.headers.get("x-faltando") ?? "%5B%5D"));
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  return { arquivos: Number(r.headers.get("x-arquivos") ?? 0), faltando };
}

export const baixarZipPersonagem = (boneco: string) => baixarZip("personagem", boneco);
export const baixarZipPasta = (pasta: string) => baixarZip("pasta", pasta);

// abre o .zip escolhido numa pasta nova dentro de `destino` (padrao: a pasta do navegador)
export async function importarZip(arquivo: File, destino: string = fs.OPFS): Promise<{ pasta: string; arquivos: string[]; bonecos: string[] }> {
  const r = await fetch(`/api/zip/importar?nome=${encodeURIComponent(arquivo.name)}&destino=${encodeURIComponent(destino)}`, { method: "POST", body: arquivo });
  const j = await r.json().catch(() => ({ error: `erro ${r.status}` }));
  if (!r.ok) throw new Error(j.error);
  return j;
}
