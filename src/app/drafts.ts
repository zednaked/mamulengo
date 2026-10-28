// Rascunhos: o texto do documento nao salvo, por asset, no IndexedDB do navegador.
// Nada se perde se a aba fechar ou recarregar; ao reabrir, o editor oferece recuperar.
const DB = "mamulengo";
const STORE = "drafts";

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

export interface Draft {
  text: string;
  at: number;
  // texto do arquivo quando o rascunho comecou: se o arquivo mudou no disco desde
  // entao, o rascunho e de outra versao
  base: string;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise((ok, fail) => {
      const r = fn(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
  } catch {
    return undefined;
  }
}

export const getDraft = (id: string) => tx<Draft>("readonly", (s) => s.get(id));
export const putDraft = (id: string, d: Draft) => tx("readwrite", (s) => s.put(d, id));
export const dropDraft = (id: string) => tx("readwrite", (s) => s.delete(id));
