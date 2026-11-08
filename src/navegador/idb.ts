// IndexedDB minimo para o editor sem servidor (src/navegador): as pastas escolhidas (os
// FileSystemDirectoryHandle sobrevivem no IndexedDB), as preferencias, as versoes e as copias de
// seguranca. A mesma base serve a pagina e o service worker.

const BASE = "mamulengo-navegador";
export const LOJAS = ["kv", "blobs", "versoes", "copias"] as const;
export type Loja = (typeof LOJAS)[number];

let aberta: Promise<IDBDatabase> | null = null;
function abrir(): Promise<IDBDatabase> {
  aberta ??= new Promise((ok, falha) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => {
      for (const l of LOJAS) if (!r.result.objectStoreNames.contains(l)) r.result.createObjectStore(l);
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => {
      aberta = null;
      falha(r.error);
    };
  });
  return aberta;
}

function pedido<T>(loja: Loja, modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((ok, falha) => {
        const t = db.transaction(loja, modo);
        const r = f(t.objectStore(loja));
        t.oncomplete = () => ok(r.result as T);
        t.onerror = () => falha(t.error);
        t.onabort = () => falha(t.error);
      }),
  );
}

export const ler = <T = any>(loja: Loja, chave: string) => pedido<T | undefined>(loja, "readonly", (s) => s.get(chave));
export const gravar = (loja: Loja, chave: string, valor: any) => pedido<void>(loja, "readwrite", (s) => s.put(valor, chave));
export const apagar = (loja: Loja, chave: string) => pedido<void>(loja, "readwrite", (s) => s.delete(chave));
export const chaves = (loja: Loja) => pedido<string[]>(loja, "readonly", (s) => s.getAllKeys());
