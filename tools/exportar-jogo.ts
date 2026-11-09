// Exporta o jogo de um .boneco com palco (docs/PALCO.md) numa pagina HTML so, sem servidor: o
// nucleo (wasm), o .boneco, os filhos das instancias e as paginas do atlas vao dentro, com o
// tocador (src/jogo/jogo.ts): teclado, botoes de toque no celular, camera e placar. Abre direto
// do disco ou de qualquer hospedagem estatica.
//
//   npx tsx tools/exportar-jogo.ts <x.boneco> <saida.html> [--titulo "nome"] [--fundo cfe8f7] [--vista 1280,720]
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const titulo = opt("titulo", "");
const fundo = opt("fundo", "cfe8f7").replace(/^#/, "");
const vistaArg = opt("vista", "");
const [arq, saida] = args.map((a) => resolve(a));
if (!arq || !saida) {
  console.error('uso: tools/exportar-jogo.ts <x.boneco> <saida.html> [--titulo "nome"] [--fundo cfe8f7] [--vista 1280,720]');
  process.exit(2);
}

// os arquivos num disco virtual: o principal em /jogo/<nome>, os filhos pelo caminho relativo a ele
const base = dirname(arq);
const virtual = (abs: string) => "/jogo/" + abs.slice(base.length + 1).split("\\").join("/");
const arquivos: Record<string, string> = {};
const imagens: Record<string, string> = {};
const filtros: Record<string, string> = {};
const MIME: Record<string, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };
function juntar(abs: string) {
  if (!abs.startsWith(base + "/")) throw new Error(`fora da pasta do jogo: ${abs} (os filhos e as paginas tem de ficar em ${base})`);
  const v = virtual(abs);
  if (arquivos[v]) return;
  const texto = readFileSync(abs, "utf8");
  arquivos[v] = texto;
  const b = JSON.parse(texto);
  if (!b.palco && abs === arq) throw new Error(`${basename(arq)} nao tem palco (docs/PALCO.md)`);
  for (const pg of b.paginas ?? []) {
    for (const f of [pg.arquivo, pg.relevo].filter(Boolean) as string[]) {
      const p = resolve(dirname(abs), f);
      const iv = virtual(p);
      imagens[iv] ??= `data:${MIME[p.split(".").pop()!.toLowerCase()] ?? "image/png"};base64,${readFileSync(p).toString("base64")}`;
      if (pg.filtro) filtros[iv] = pg.filtro;
    }
  }
  for (const i of b.instancias ?? []) juntar(resolve(dirname(abs), i.boneco));
}
juntar(arq);

// o tocador, num arquivo so (o nucleo.mjs junto; o wasm vai em base64)
const tocador = await build({
  entryPoints: [join(RAIZ, "src/jogo/jogo.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
  external: ["module", "fs", "path", "url", "worker_threads", "node:*"],
  define: { __NAVEGADOR__: "false" },
  alias: { "mamulengo-nucleo": join(RAIZ, "nucleo/build-web/nucleo.mjs") },
  logLevel: "error",
});
const js = tocador.outputFiles[0].text;
const wasm = readFileSync(join(RAIZ, "nucleo/build-web/nucleo.wasm")).toString("base64");
const nome = titulo || basename(arq, ".boneco");
const jogo = { titulo: nome, principal: virtual(arq), arquivos, imagens, filtros, wasm, fundo, ...(vistaArg ? { vista: vistaArg.split(",").map(Number) } : {}) };
// nos dados (JSON), o < vira \u003c; no codigo, so o fim de script precisa de escape
const esc = (s: string) => s.replace(/</g, "\\u003c");
const escJs = (s: string) => s.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>${nome.replace(/</g, "&lt;")}</title>
<style>
  html, body { margin: 0; height: 100%; background: #${fundo}; overflow: hidden; touch-action: none; font-family: system-ui, sans-serif; }
  #tela { width: 100vw; height: 100vh; display: block; }
  #placar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #000a; color: #ffe27a; font-weight: 700; font-size: 20px; padding: 4px 16px; border-radius: 10px; pointer-events: none; }
  #recomeca { position: fixed; top: 12px; right: 12px; background: #000a; color: #fff; border: 0; border-radius: 10px; font-size: 18px; padding: 4px 12px; }
  #dica { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); color: #0008; font-size: 13px; }
  .toque { position: fixed; bottom: 18px; display: none; gap: 14px; }
  .toque button { width: 72px; height: 72px; border-radius: 50%; border: 0; background: #0005; color: #fff; font-size: 30px; user-select: none; -webkit-user-select: none; }
  #esq { left: 18px; } #dir { right: 18px; }
  @media (pointer: coarse) { .toque { display: flex; } #dica { display: none; } }
  #erro { position: fixed; inset: 0; display: none; place-items: center; background: #000c; color: #fff; padding: 24px; text-align: center; }
</style>
</head>
<body>
<canvas id="tela"></canvas>
<div id="placar">🪙 0</div>
<button id="recomeca" title="recomeçar (R)">↺</button>
<div id="dica">setas ou A/D andam · espaço, W ou ↑ pulam · R recomeça</div>
<div class="toque" id="esq"><button data-tecla="1">◀</button><button data-tecla="2">▶</button></div>
<div class="toque" id="dir"><button data-tecla="4">⤒</button></div>
<div id="erro"></div>
<script>window.JOGO = ${esc(JSON.stringify(jogo))};
addEventListener("error", (e) => { const d = document.getElementById("erro"); d.style.display = "grid"; d.textContent = "o jogo não abriu: " + (e.message || e); });
addEventListener("unhandledrejection", (e) => { const d = document.getElementById("erro"); d.style.display = "grid"; d.textContent = "o jogo não abriu: " + (e.reason?.message || e.reason); });</script>
<script type="module">${escJs(js)}</script>
</body>
</html>
`;
writeFileSync(saida, html);
console.log(`${saida}: ${(html.length / 1024).toFixed(0)} KB (${Object.keys(arquivos).length} .boneco, ${Object.keys(imagens).length} paginas, wasm ${(wasm.length / 1024).toFixed(0)} KB em base64)`);
