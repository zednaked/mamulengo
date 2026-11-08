// Os arquivos do editor sem servidor: caminhos absolutos como os do servidor, cada raiz uma pasta
// que o navegador deixa ler e gravar.
//   /navegador/...        a pasta propria do navegador (OPFS): sempre existe, sem pedir nada;
//                         e onde ficam os exemplos e o trabalho de quem nao escolheu pasta
//   /pastas/<nome>/...    uma pasta do computador escolhida pela pessoa (showDirectoryPicker,
//                         so no Chromium); o acesso vale ate fechar o navegador, ou para sempre
//                         se ela escolher "permitir sempre"
// Roda na pagina e no service worker (que atende o /api: src/navegador/api.ts).
import * as idb from "./idb.ts";

export const OPFS = "/navegador";
export const PASTAS = "/pastas";
// pastas que nunca tem personagem (e sao enormes)
const PULAR = new Set(["node_modules", ".git", ".godot", ".import", "dist", ".claude"]);

export type Raiz = { caminho: string; nome: string; handle: FileSystemDirectoryHandle; opfs: boolean };
type PastaGuardada = { nome: string; handle: FileSystemDirectoryHandle };

export class SemPermissao extends Error {
  constructor(readonly raiz: string) {
    super(`o navegador precisa da sua permissao de novo para mexer em ${raiz} (botao "Dar acesso" na lista de personagens)`);
  }
}

export async function raizes(): Promise<Raiz[]> {
  const out: Raiz[] = [];
  try {
    out.push({ caminho: OPFS, nome: "navegador", handle: await navigator.storage.getDirectory(), opfs: true });
  } catch {}
  for (const p of (await idb.ler<PastaGuardada[]>("kv", "pastas")) ?? []) out.push({ caminho: `${PASTAS}/${p.nome}`, nome: p.nome, handle: p.handle, opfs: false });
  return out;
}

// a pasta escolhida entra na lista (nome repetido ganha um numero)
export async function adicionarPasta(handle: FileSystemDirectoryHandle): Promise<string> {
  const lista = (await idb.ler<PastaGuardada[]>("kv", "pastas")) ?? [];
  for (const p of lista) if (await p.handle.isSameEntry(handle)) return `${PASTAS}/${p.nome}`;
  let nome = handle.name.replace(/[\/\\]/g, "_") || "pasta";
  for (let i = 2; lista.some((p) => p.nome === nome); i++) nome = `${handle.name}-${i}`;
  lista.push({ nome, handle });
  await idb.gravar("kv", "pastas", lista);
  return `${PASTAS}/${nome}`;
}

export async function tirarPasta(caminho: string) {
  const lista = (await idb.ler<PastaGuardada[]>("kv", "pastas")) ?? [];
  await idb.gravar(
    "kv",
    "pastas",
    lista.filter((p) => `${PASTAS}/${p.nome}` !== caminho),
  );
}

// pode ler e gravar? `pedir` so na pagina, num clique (o navegador mostra a pergunta)
export async function permissao(r: Raiz, pedir = false): Promise<boolean> {
  if (r.opfs) return true;
  const h = r.handle as any;
  if ((await h.queryPermission?.({ mode: "readwrite" })) === "granted") return true;
  if (!pedir) return false;
  return (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
}

export const normalizar = (p: string) => {
  const out: string[] = [];
  for (const s of p.split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return "/" + out.join("/");
};
export const pastaDe = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
export const nomeDe = (p: string) => p.slice(p.lastIndexOf("/") + 1);

// a raiz do caminho e o resto dele
async function partir(caminho: string): Promise<{ raiz: Raiz; partes: string[] }> {
  const c = normalizar(caminho);
  for (const r of await raizes())
    if (c === r.caminho || c.startsWith(r.caminho + "/")) {
      if (!(await permissao(r))) throw new SemPermissao(r.nome);
      return { raiz: r, partes: c.slice(r.caminho.length).split("/").filter(Boolean) };
    }
  throw Object.assign(new Error(`fora das pastas abertas: ${caminho}`), { code: 403 });
}

async function pasta(caminho: string, criar = false): Promise<FileSystemDirectoryHandle | null> {
  const { raiz, partes } = await partir(caminho);
  let d = raiz.handle;
  try {
    for (const p of partes) d = await d.getDirectoryHandle(p, { create: criar });
    return d;
  } catch {
    return null;
  }
}

async function arquivo(caminho: string, criar = false): Promise<FileSystemFileHandle | null> {
  const d = await pasta(pastaDe(caminho), criar);
  if (!d) return null;
  try {
    return await d.getFileHandle(nomeDe(caminho), { create: criar });
  } catch {
    return null;
  }
}

export async function lerArquivo(caminho: string): Promise<File | null> {
  const h = await arquivo(caminho);
  return h ? h.getFile() : null;
}

export async function lerTexto(caminho: string): Promise<string | null> {
  const f = await lerArquivo(caminho);
  return f ? f.text() : null;
}

export const existe = async (caminho: string) => !!(await arquivo(caminho));

// grava inteiro: o createWritable escreve numa copia e troca ao fechar (atomico como o rename do
// servidor)
export async function gravarArquivo(caminho: string, dados: BufferSource | Blob | string) {
  const h = await arquivo(caminho, true);
  if (!h) throw new Error(`nao consegui criar ${caminho}`);
  const w = await (h as any).createWritable();
  await w.write(dados);
  await w.close();
}

export async function apagarArquivo(caminho: string) {
  const d = await pasta(pastaDe(caminho));
  await d?.removeEntry(nomeDe(caminho)).catch(() => {});
}

// os arquivos de uma pasta so (sem descer), em caminhos absolutos
export async function listar(caminho: string): Promise<string[]> {
  const d = await pasta(caminho).catch(() => null);
  const out: string[] = [];
  if (d) for await (const [nome, h] of (d as any).entries() as AsyncIterable<[string, FileSystemHandle]>) if (h.kind === "file") out.push(`${normalizar(caminho)}/${nome}`);
  return out.sort();
}

// os arquivos abaixo de uma pasta (recursivo), em caminhos absolutos
export async function percorrer(caminho: string, filtro: (nome: string) => boolean = () => true): Promise<string[]> {
  const out: string[] = [];
  const andar = async (d: FileSystemDirectoryHandle, base: string) => {
    for await (const [nome, h] of (d as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (h.kind === "directory") {
        if (!PULAR.has(nome)) await andar(h as FileSystemDirectoryHandle, `${base}/${nome}`);
      } else if (filtro(nome)) out.push(`${base}/${nome}`);
    }
  };
  const d = await pasta(caminho);
  if (d) await andar(d, normalizar(caminho));
  return out.sort();
}

export const existePasta = async (caminho: string) => !!(await pasta(caminho));
