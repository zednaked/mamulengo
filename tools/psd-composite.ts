// Prova da importacao de PSD: o setup do asset, renderizado pelo editor (ponte) e pelo
// Godot de verdade, bate com a composicao do PSD pixel a pixel?
//
//   npx tsx tools/psd-composite.ts <x-data.tres> <arte.psd> [--out dir] [--godot] [--skin nome]
//
// Tres referencias, todas no enquadramento do PSD (1 px do PSD = 1 px da imagem):
//  - psd: composicao feita pelo ImageMagick a partir das camadas do arquivo (independente
//    do Mamulengo), so com as camadas que a importacao leva (sem [ignore], fundo, [origin]);
//  - export: as imagens que a importacao gravou, compostas nos retangulos do plano (isola
//    o render e o posicionamento do baking das camadas);
//  - editor e godot: o setup renderizado.
// Tudo sobre fundo cinza opaco (o render do editor e opaco).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import WebSocket from "ws";
import { readPsd, writePsdBuffer, type Layer } from "ag-psd";
import { readPsdPlan } from "../server/psd.ts";

const argv = process.argv.slice(2);
const opt = (k: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
const [tresArg, psdArg] = argv.filter((a, i) => !a.startsWith("--") && !["--out", "--skin"].includes(argv[i - 1]));
if (!tresArg || !psdArg) {
  console.error("uso: psd-composite.ts <x-data.tres> <arte.psd> [--out dir] [--godot]");
  process.exit(2);
}
const tres = resolve(tresArg),
  psdFile = resolve(psdArg);
const out = resolve(opt("out") ?? join(tmpdir(), "mamulengo-psd-composite"));
mkdirSync(out, { recursive: true });
const BG = [51, 51, 51];

const { plan, images } = readPsdPlan(readFileSync(psdFile), psdFile);
const W = plan.width,
  H = plan.height;
const rect = [-plan.origin[0], plan.origin[1] - H, W, H];

type Img = { w: number; h: number; d: Uint8ClampedArray | Buffer };
const blank = (): Img => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) d.set([...BG, 255], i * 4);
  return { w: W, h: H, d };
};

// 1) export: imagens do plano nos retangulos, com o blend do slot (alpha simples, como o spine-godot)
const exp = blank();
for (const { piece: p, raster: r } of images) {
  if (!p.visible || p.skin !== "default") continue;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const X = r.x + x,
        Y = r.y + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const s = (y * r.w + x) * 4,
        d = (Y * W + X) * 4;
      const a = r.d[s + 3] / 255;
      for (let c = 0; c < 3; c++) {
        const S = r.d[s + c],
          D = exp.d[d + c];
        const v = p.blend === "additive" ? D + S * a : p.blend === "multiply" ? D * (1 - a) + ((S * D) / 255) * a : p.blend === "screen" ? D + (S * a * (255 - D)) / 255 : S * a + D * (1 - a);
        exp.d[d + c] = Math.min(255, Math.round(v));
      }
    }
}

// 2) psd: ImageMagick nas camadas do arquivo, escondendo o que a importacao nao leva
{
  const psd = readPsd(readFileSync(psdFile), { useImageData: true, skipThumbnail: true });
  const skip = new Set([...plan.ignored.map((i) => i.layer)]);
  const walk = (ls: Layer[] | undefined, path: string, hidden: boolean) => {
    for (const l of ls ?? []) {
      const p = path ? `${path}/${l.name}` : l.name!;
      const h = hidden || !!l.hidden || skip.has(p) || /\[(origin|ignore)\]/i.test(l.name ?? "");
      // o ImageMagick nao segue a visibilidade dos grupos: esconde camada a camada
      if (h) l.hidden = true;
      walk(l.children, p, h);
    }
  };
  walk(psd.children, "", false);
  const tmp = join(out, "visiveis.psd");
  writeFileSync(tmp, writePsdBuffer(psd, { noBackground: true }));
  execFileSync("magick", [tmp, "-delete", "0", "-background", `rgb(${BG.join(",")})`, "-layers", "flatten", "-alpha", "off", join(out, "psd.png")]);
}
const readPng = (f: string): Img => {
  const p = PNG.sync.read(readFileSync(f));
  return { w: p.width, h: p.height, d: p.data };
};
const writePng = (f: string, im: Img) => {
  const p = new PNG({ width: im.w, height: im.h });
  for (let i = 0; i < im.w * im.h; i++) {
    p.data[i * 4] = im.d[i * 4];
    p.data[i * 4 + 1] = im.d[i * 4 + 1];
    p.data[i * 4 + 2] = im.d[i * 4 + 2];
    p.data[i * 4 + 3] = 255;
  }
  writeFileSync(f, PNG.sync.write(p));
};
writePng(join(out, "export.png"), exp);
const psdImg = readPng(join(out, "psd.png"));

// 3) editor (ponte) e Godot
const port = process.env.MAMULENGO_PORT ?? 5199;
const ws = new WebSocket(`ws://localhost:${port}/__mamulengo`);
await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
ws.send(JSON.stringify({ t: "hello", role: "agent", name: "psd-composite" }));
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
const st = await call("state", {});
if (st.file?.tres !== tres) await call("open", { id: tres });
const r = await call("render", { animation: null, times: [0], rect, size: [W, H], background: BG.map((v) => v / 255) });
writeFileSync(join(out, "editor.png"), Buffer.from(String(r.images[0]).split(",")[1], "base64"));
const editor = readPng(join(out, "editor.png"));
let godot: Img | null = null;
if (argv.includes("--godot")) {
  const g = await fetch(`http://localhost:${port}/api/godot/render`, { method: "POST", body: JSON.stringify({ tres, animation: null, time: 0, rect, size: [W, H], background: BG.map((v) => v / 255) }) });
  if (!g.ok) throw new Error(await g.text());
  writeFileSync(join(out, "godot.png"), Buffer.from(await g.arrayBuffer()));
  godot = readPng(join(out, "godot.png"));
}
ws.close();

// pixels sob camadas com modo especial (linear dodge etc.): o ImageMagick compoe esses
// modos como normal, entao a comparacao com "psd" tambem sai sem eles
const special = new Uint8Array(W * H);
for (const { piece: p, raster: r } of images) {
  if (!p.visible || p.skin !== "default" || !p.blend) continue;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.d[(y * r.w + x) * 4 + 3] > 0 && r.x + x >= 0 && r.y + y >= 0 && r.x + x < W && r.y + y < H) special[(r.y + y) * W + r.x + x] = 1;
}

function compare(name: string, a: Img, b: Img, skipSpecial = false) {
  let sum = 0,
    max = 0,
    over2 = 0,
    over8 = 0,
    over24 = 0;
  const diff: Img = { w: W, h: H, d: new Uint8ClampedArray(W * H * 4) };
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (skipSpecial && special[i]) continue;
    n++;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.d[i * 4 + c] - b.d[i * 4 + c]));
    sum += d;
    if (d > max) max = d;
    if (d > 2) over2++;
    if (d > 8) over8++;
    if (d > 24) over24++;
    diff.d.set([Math.min(255, d * 8), 0, Math.min(255, d * 8), 255], i * 4);
  }
  const pct = (k: number) => +((100 * k) / n).toFixed(3);
  writePng(join(out, `diff-${name}${skipSpecial ? "-normal" : ""}.png`), diff);
  return { comparacao: name + (skipSpecial ? " (sem modos especiais)" : ""), pixels: n, media: +(sum / n).toFixed(3), max, "%>2": pct(over2), "%>8": pct(over8), "%>24": pct(over24) };
}

const rows = [compare("editor-vs-psd", editor, psdImg), compare("editor-vs-psd", editor, psdImg, true), compare("editor-vs-export", editor, exp), compare("export-vs-psd", exp, psdImg, true)];
if (godot) rows.push(compare("godot-vs-psd", godot, psdImg, true), compare("godot-vs-export", godot, exp), compare("godot-vs-editor", godot, editor));
console.table(rows);
// folha lado a lado: psd | editor | godot
const sheet: Img = { w: W * (godot ? 3 : 2), h: H, d: new Uint8ClampedArray(W * (godot ? 3 : 2) * H * 4) };
[psdImg, editor, ...(godot ? [godot] : [])].forEach((im, k) => {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) sheet.d[(y * sheet.w + k * W + x) * 4 + c] = c === 3 ? 255 : im.d[(y * W + x) * 4 + c];
});
writePng(join(out, "lado-a-lado.png"), sheet);
console.log(`imagens em ${out}`);
writeFileSync(join(out, "resultado.json"), JSON.stringify(rows, null, 1));
