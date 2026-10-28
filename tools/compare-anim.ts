// Lado a lado de duas versoes de um personagem (ex: original x recriado), mesmos
// instantes e enquadramento, em PNGs e GIF animado.
//   npx tsx tools/compare-anim.ts <a-data.tres> <b-data.tres|-> <saida> --anims a,b [--fps 15] [--width 420]
// Com "-" no lugar do segundo asset, gera o GIF so do primeiro.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import WebSocket from "ws";
import { parseSkeletonDataTres } from "../server/godot.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const [A, B, OUT] = argv.slice(0, 3).map((p) => (p === "-" ? "-" : resolve(p)));
const pair = B !== "-";
const anims = opt("anims")!.split(",");
const fps = Number(opt("fps", "15"));
const width = Number(opt("width", "420"));
mkdirSync(OUT, { recursive: true });

const ws = new WebSocket(`ws://localhost:${process.env.MAMULENGO_PORT ?? 5199}/__mamulengo`);
await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
ws.send(JSON.stringify({ t: "hello", role: "agent", name: "compare" }));
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

// enquadramento do original (bounds do export, com margem)
const sk = JSON.parse(readFileSync(parseSkeletonDataTres(A)!.skeleton, "utf8")).skeleton;
const m = Number(opt("margin", "0.08"));
const rect = [sk.x - sk.width * m, sk.y - sk.height * m, sk.width * (1 + 2 * m), sk.height * (1 + 2 * m)];
const size = [width, Math.round((width * rect[3]) / rect[2])];
const bg = [0.13, 0.12, 0.16];
const decode = (d: string) => PNG.sync.read(Buffer.from(d.split(",")[1], "base64"));

for (const anim of anims) {
  const frames: PNG[][] = [[], []];
  let times: number[] = [];
  for (const [k, tres] of (pair ? [A, B] : [A]).entries()) {
    await call("open", { id: tres });
    const info = await call("skeleton.info", {});
    const dur = info.animations.find((a: any) => a.name === anim)?.duration ?? 0;
    if (!times.length) times = Array.from({ length: Math.max(1, Math.round(dur * fps)) }, (_, i) => +(i / fps).toFixed(4));
    const r = await call("render", { animation: anim, times, rect, size, background: bg });
    frames[k] = r.images.map(decode);
  }
  const dir = join(OUT, anim.replace(/[^\w.-]+/g, "_"));
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  times.forEach((_, i) => {
    const o = new PNG({ width: pair ? size[0] * 2 + 8 : size[0], height: size[1] });
    o.data.fill(40);
    PNG.bitblt(frames[0][i], o, 0, 0, size[0], size[1], 0, 0);
    if (pair) PNG.bitblt(frames[1][i], o, 0, 0, size[0], size[1], size[0] + 8, 0);
    const f = join(dir, `f_${String(i).padStart(3, "0")}.png`);
    writeFileSync(f, PNG.sync.write(o));
    files.push(f);
  });
  const gif = join(OUT, `${anim.replace(/[^\w.-]+/g, "_")}.gif`);
  execFileSync("magick", ["-delay", String(Math.round(100 / fps)), "-loop", "0", ...files, "-layers", "Optimize", gif]);
  console.log(`${anim}: ${times.length} quadros -> ${gif}`);
}
ws.close();
