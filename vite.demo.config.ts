// A demo ao vivo (demo.html, src/demo/): uma pagina estatica, sem o servidor do editor e sem
// /api, que toca o elenco CC0 de tests/boneco pelo nucleo em wasm.
//
//   npm run dev:demo     http://localhost:5211/demo.html
//   npm run build:demo   dist-demo/ (base relativa: serve em qualquer pasta, como /mamulengo/)
//
// O wasm vem de nucleo/build-web (compile antes, ver docs/NUCLEO.md). No build, a pagina vira
// index.html e vao junto nucleo/nucleo.{mjs,wasm}, elenco/<nome>/ (o .boneco e as paginas) e
// social.png (docs/media, a previa: npx tsx tools/foto-demo.ts social).
import { defineConfig, type Plugin } from "vite";
import { existsSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { ELENCO } from "./src/demo/elenco.ts";

const WASM = resolve("nucleo/build-web");
const BONECOS = resolve("tests/boneco");

// os arquivos que a demo busca, pelo caminho relativo a pagina
function arquivos(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of ["nucleo.mjs", "nucleo.wasm"]) m.set(`nucleo/${f}`, join(WASM, f));
  // a imagem de previa (og:image da pagina)
  m.set("social.png", resolve("docs/media/social.png"));
  for (const p of ELENCO) {
    const dir = join(BONECOS, p.pasta);
    for (const f of readdirSync(dir)) if (/\.(boneco|webp|png)$/.test(f)) m.set(`elenco/${p.pasta}/${f}`, join(dir, f));
  }
  return m;
}

const TIPOS: Record<string, string> = { mjs: "text/javascript", wasm: "application/wasm", boneco: "application/json", webp: "image/webp", png: "image/png" };

function demoArquivos(): Plugin {
  let saida = "";
  return {
    name: "mamulengo-demo-arquivos",
    configResolved(c) {
      saida = resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const caminho = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\//, "");
        const arq = arquivos().get(caminho);
        if (!arq || !existsSync(arq)) return next();
        res.setHeader("Content-Type", TIPOS[caminho.split(".").pop() ?? ""] ?? "application/octet-stream");
        res.end(readFileSync(arq));
      });
    },
    generateBundle() {
      for (const [fileName, arq] of arquivos()) {
        if (!existsSync(arq)) {
          if (fileName === "social.png") continue;
          this.error(`falta ${arq} (compile o wasm: docs/NUCLEO.md)`);
        }
        this.emitFile({ type: "asset", fileName, source: readFileSync(arq) });
      }
    },
    // o Pages serve index.html na raiz
    writeBundle() {
      const de = join(saida, "demo.html");
      if (existsSync(de)) renameSync(de, join(saida, "index.html"));
    },
  };
}

const wasm = join(WASM, "nucleo.wasm");
const bytes = existsSync(wasm) ? statSync(wasm).size : 0;
const gzip = bytes ? gzipSync(readFileSync(wasm), { level: 9 }).length : 0;

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [demoArquivos()],
  define: { __WASM_BYTES__: String(bytes), __WASM_GZIP__: String(gzip) },
  build: { outDir: "dist-demo", emptyOutDir: true, rollupOptions: { input: { demo: resolve("demo.html") } } },
  server: { port: 5211, strictPort: true },
  preview: { port: 5212 },
});
