// Monta o kit do teste de aceitacao a partir de um asset existente: o que um animador
// teria antes de abrir o Spine. Imagens soltas (desempacotadas do atlas), folhas de
// contato das animacoes de referencia e um projeto Godot minimo de trabalho com a
// GDExtension do spine-godot. O .spine-json original NAO entra no kit.
//
//   npx tsx tools/acceptance-kit.ts <-data.tres> <saida> --anims a,b,c [--frames 8] [--spine <projeto>]
//
// Precisa do editor aberto (as folhas de contato sao renderizadas por ele).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import WebSocket from "ws";
import { findProjectRoot, parseSkeletonDataTres } from "../server/godot.ts";
import { unpackAtlas } from "../server/atlas.ts";
import { linkSpineExtension } from "../server/godot-run.ts";
import { artLayout, LAYOUT_NOTE } from "./layout.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const tres = resolve(argv[0]);
const out = resolve(argv[1]);
const asset = parseSkeletonDataTres(tres)!;
const project = findProjectRoot(dirname(tres))!;
const json = JSON.parse(readFileSync(asset.skeleton, "utf8"));
const anims = (opt("anims") ?? Object.keys(json.animations).join(",")).split(",");
const frames = Number(opt("frames", "8"));

mkdirSync(join(out, "imagens"), { recursive: true });
const imgs = await unpackAtlas(asset.atlas, readFileSync(asset.atlas, "utf8"), join(out, "imagens"));

writeFileSync(join(out, "layout.json"), JSON.stringify({ note: LAYOUT_NOTE, layers: artLayout(json, readFileSync(asset.atlas, "utf8")) }, null, 1));

// projeto Godot de trabalho: so o necessario para o spine-godot carregar
const work = join(out, "projeto");
mkdirSync(join(work, "assets"), { recursive: true });
writeFileSync(
  join(work, "project.godot"),
  `config_version=5\n\n[application]\n\nconfig/name="aceitacao"\nconfig/features=PackedStringArray("4.7", "GL Compatibility")\n\n[rendering]\n\nrenderer/rendering_method="gl_compatibility"\n`,
);
// GDExtension do spine-godot: do projeto do asset ou de --spine <projeto> (o corpus
// livre de tests/assets nao traz os binarios); binarios por link, nao copia
const spineFrom = opt("spine") ? resolve(opt("spine")!) : project;
if (!linkSpineExtension(work, spineFrom)) console.log(`aviso: sem spine-godot em ${spineFrom}; projeto/ sai sem a GDExtension (use --spine)`);

// folhas de contato da referencia (render do editor, igual ao jogo)
const ws = new WebSocket(`ws://localhost:${process.env.MAMULENGO_PORT ?? 5199}/__mamulengo`);
await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
ws.send(JSON.stringify({ t: "hello", role: "agent", name: "kit" }));
let seq = 0;
const call = (method: string, params: any) =>
  new Promise<any>((ok, fail) => {
    const id = String(++seq);
    const h = (raw: any) => {
      const r = JSON.parse(String(raw));
      if (r.t !== "reply" || r.id !== id) return;
      ws.off("message", h);
      r.ok ? ok(r.result) : fail(new Error(r.error));
    };
    ws.on("message", h);
    ws.send(JSON.stringify({ t: "call", id, method, params }));
  });
await call("open", { id: tres });
mkdirSync(join(out, "referencia"), { recursive: true });
const durations: Record<string, number> = {};
{
  const r = await call("look", { animation: null, time: 0, fit: true, scale: 0.7 });
  writeFileSync(join(out, "layout.png"), Buffer.from(r.image.split(",")[1], "base64"));
}
for (const a of anims) {
  const r = await call("look", { animation: a, frames, fit: true, scale: 0.5 });
  writeFileSync(join(out, "referencia", `${a.replace(/[^\w.-]+/g, "_")}.png`), Buffer.from(r.image.split(",")[1], "base64"));
  durations[a] = r.times.length > 1 ? +(r.times[1] * frames).toFixed(3) : 0;
}
ws.close();

writeFileSync(
  join(out, "KIT.md"),
  `# Kit de aceitacao: ${basename(asset.skeleton)}

- imagens/: ${imgs.length} imagens soltas (o que o animador recebe da arte)
- layout.json + layout.png: posicao/rotacao/ordem de cada imagem na composicao (o que o PSD daria)
- referencia/: folha de contato de cada animacao a recriar (${frames} instantes igualmente espacados)
- projeto/: projeto Godot vazio com o spine-godot, para criar o asset

Animacoes: ${anims.map((a) => `${a} (${durations[a]}s)`).join(", ")}
`,
);
console.log(`kit em ${out}: ${imgs.length} imagens, ${anims.length} referencias`);
