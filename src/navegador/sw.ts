// Service worker do editor pelo navegador (vite.navegador.config.ts): guarda o editor inteiro
// para abrir sem internet (PWA) e atende o /api no lugar do servidor (api.ts).
/// <reference lib="webworker" />
// pelo apelido do vite.navegador.config.ts: o tsc nao le o .mjs gerado (src/navegador/nucleo.d.ts)
import criarNucleo from "@mamulengo/nucleo";
import { responder, usarNucleo } from "./api.ts";

declare const self: ServiceWorkerGlobalScope;
// a lista dos arquivos do build, posta pelo vite.navegador.config.ts
declare const __PRECACHE__: string[];
declare const __VERSAO__: string;

const CACHE = `mamulengo-${__VERSAO__}`;
const base = new URL("./", self.location.href);

// o nucleo (para o .boneco binario): o wasm fica em nucleo/ ao lado do sw.js
let nucleo: Promise<any> | null = null;
usarNucleo(() => (nucleo ??= criarNucleo({ locateFile: (f: string) => new URL(`nucleo/${f}`, base).href })));

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(__PRECACHE__.map((f) => new URL(f, base).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("mamulengo-") && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return e.respondWith(responder(e.request));
  if (e.request.method !== "GET") return;
  // o editor: do cache (abre sem internet); a pagina, da rede quando ha (pega a versao nova)
  e.respondWith(
    (async () => {
      const c = await caches.open(CACHE);
      if (e.request.mode === "navigate") {
        try {
          return await fetch(e.request);
        } catch {
          return (await c.match(new URL("./", base).href)) ?? (await c.match(new URL("index.html", base).href)) ?? Response.error();
        }
      }
      return (await c.match(e.request, { ignoreSearch: true })) ?? fetch(e.request);
    })(),
  );
});
