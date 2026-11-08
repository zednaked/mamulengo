// O editor pelo navegador: um site estatico, sem o servidor do editor (server/), que abre por um
// link e funciona sem internet depois da primeira vez (PWA). O /api e atendido por um service
// worker dentro do proprio navegador (src/navegador/), que le e grava numa pasta do computador
// escolhida pela pessoa (Chromium) ou na pasta propria do navegador (OPFS, todos).
//
//   npm run build:navegador     dist-navegador/ (base relativa: serve em qualquer pasta)
//   npm run preview:navegador   http://localhost:5214/
//
// O que precisa de programa de fora (PSD, empacotar atlas, Godot, arte HD, relevo...) responde que
// precisa do Mamulengo instalado (npm run dev). O wasm vem de nucleo/build-web (docs/NUCLEO.md).
// Na primeira visita, os personagens CC0 de tests/boneco entram em /navegador/exemplos/.
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const WASM = resolve("nucleo/build-web");
const BONECOS = resolve("tests/boneco");
const LISTA = "__LISTA_PRECACHE__";

// os arquivos que vao junto, pelo caminho relativo a pagina
function arquivos(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of ["nucleo.mjs", "nucleo.wasm"]) m.set(`nucleo/${f}`, join(WASM, f));
  for (const pasta of readdirSync(BONECOS)) for (const f of readdirSync(join(BONECOS, pasta))) if (/\.(boneco|webp|png|md)$/.test(f)) m.set(`exemplos/${pasta}/${f}`, join(BONECOS, pasta, f));
  return m;
}

const MANIFESTO = {
  name: "Mamulengo",
  short_name: "Mamulengo",
  description: "Editor de animação 2D por esqueleto",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#211e29",
  theme_color: "#211e29",
  icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
};

function navegador(): Plugin {
  return {
    name: "mamulengo-navegador",
    transformIndexHtml: () => [
      { tag: "link", attrs: { rel: "manifest", href: "manifest.webmanifest" }, injectTo: "head" },
      { tag: "meta", attrs: { name: "theme-color", content: MANIFESTO.theme_color }, injectTo: "head" },
    ],
    generateBundle(_, bundle) {
      for (const [fileName, arq] of arquivos()) {
        if (!existsSync(arq)) this.error(`falta ${arq} (compile o wasm: docs/NUCLEO.md)`);
        this.emitFile({ type: "asset", fileName, source: readFileSync(arq) });
      }
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(MANIFESTO, null, 1) });
      // o service worker guarda tudo o que o editor carrega (os exemplos vao para a pasta do
      // navegador na primeira visita, nao precisam do cache)
      const todos = [...Object.keys(bundle), "nucleo/nucleo.mjs", "nucleo/nucleo.wasm", "manifest.webmanifest", "favicon.svg"].filter((f) => f !== "sw.js" && !f.startsWith("exemplos/") && !f.endsWith(".map") && !/^assets\/nucleo-.*\.wasm$/.test(f));
      const lista = ["./", ...new Set(todos)];
      const sw = bundle["sw.js"];
      if (!sw || sw.type !== "chunk" || !sw.code.includes(LISTA)) this.error("o sw.js nao tem a marca da lista do cache");
      sw.code = sw.code.replace(new RegExp(`\\[\\s*["'\`]${LISTA}["'\`]\\s*\\]`), JSON.stringify(lista));
    },
  };
}

const exemplos = [...arquivos().keys()].filter((k) => k.startsWith("exemplos/"));

export default defineConfig({
  base: "./",
  plugins: [svelte(), navegador()],
  // o nucleo gerado entra no sw.js (o service worker nao pode import() dinamico)
  resolve: { alias: { "@mamulengo/nucleo": join(WASM, "nucleo.mjs") } },
  define: {
    __NAVEGADOR__: "true",
    __EXEMPLOS__: JSON.stringify(exemplos),
    __PRECACHE__: JSON.stringify([LISTA]),
    __VERSAO__: JSON.stringify(new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)),
  },
  build: {
    outDir: "dist-navegador",
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve("index.html"), sw: resolve("src/navegador/sw.ts") },
      output: { entryFileNames: (c) => (c.name === "sw" ? "sw.js" : "assets/[name]-[hash].js") },
    },
  },
  server: { port: 5213, strictPort: true },
  preview: { port: 5214, strictPort: true },
});
