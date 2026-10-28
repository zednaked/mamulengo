// Fixture sintetica para medir blend e two-color tint contra o spine-godot de verdade:
// um projeto Godot minimo (GDExtension linkada de um jogo) com um asset que tem slots
// multiply, additive e screen, cores escuras (dark) na setup e timelines rgba2/rgb2.
// Nenhum asset de jogo entra: as imagens sao geradas aqui.
//
//   npx tsx tools/blend-fixture.ts <saida> <projeto de jogo com spine-godot>
//   npx tsx tools/parity.ts <saida>/fixture/fixture-data.tres --frames 3
import { existsSync, mkdirSync, symlinkSync, cpSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { createAsset } from "../server/assets.ts";
import { ensureImported } from "../server/godot-run.ts";

const [outArg, gameArg] = process.argv.slice(2);
if (!outArg || !gameArg) throw new Error("uso: blend-fixture.ts <saida> <projeto de jogo>");
const out = resolve(outArg);
const game = resolve(gameArg);
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "project.godot"),
  `config_version=5\n\n[application]\n\nconfig/name="fixture"\nconfig/features=PackedStringArray("4.7", "GL Compatibility")\n\n[rendering]\n\nrenderer/rendering_method="gl_compatibility"\n`,
);
const ext = join(game, "spine_godot_extension.gdextension");
if (!existsSync(ext)) throw new Error(`sem spine_godot_extension.gdextension em ${game}`);
cpSync(ext, join(out, "spine_godot_extension.gdextension"));
// os binarios ficam onde o .gdextension do jogo aponta (res://<pasta>/bin/...): a mesma
// pasta, no mesmo caminho relativo, entra por link no projeto da fixture
const binDir = /res:\/\/([^"]+?)\/bin\//.exec(readFileSync(ext, "utf8"))?.[1];
if (!binDir) throw new Error(`sem caminho res://.../bin/ em ${ext}`);
mkdirSync(dirname(join(out, binDir)), { recursive: true });
if (!existsSync(join(out, binDir))) symlinkSync(join(game, binDir), join(out, binDir));

// imagens: pixels brutos (RGBA nao premultiplicado), com RGB colorido sob alpha 0 na
// imagem do multiply (o Godot multiplica sem olhar o alpha)
const src = join(out, "src_images");
mkdirSync(src, { recursive: true });
async function raw(name: string, w: number, h: number, f: (x: number, y: number) => [number, number, number, number]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = f(x, y);
      buf.set(p.map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * w + x) * 4);
    }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(join(src, name + ".png"));
}
// fundo: gradiente opaco em xadrez (o multiply e o screen precisam de destino variado)
await raw("fundo", 256, 256, (x, y) => {
  const c = ((x >> 5) + (y >> 5)) & 1 ? 1 : 0.6;
  return [x * c, y * c, (255 - x) * c, 255];
});
// disco com borda suave e margem transparente com cor (vai aparecer no multiply)
const disc = (r: number, g: number, b: number) => (x: number, y: number): [number, number, number, number] => {
  const d = Math.hypot(x - 63.5, y - 63.5);
  const a = d < 40 ? 255 : d < 56 ? 255 * (1 - (d - 40) / 16) : 0;
  return a > 0 ? [r, g * (1 - d / 90), b + d, a] : [200, 60, 220, 0];
};
await raw("disco", 128, 128, disc(240, 200, 40));
await raw("disco2", 128, 128, disc(60, 220, 120));
// faixa em tons de cinza (o dark tint aparece nos tons escuros, o light nos claros)
await raw("faixa", 192, 64, (x, y) => {
  const v = (x / 191) * 255;
  const a = y < 4 || y > 59 ? 0 : 255;
  return [v, v, v, a];
});

const name = "fixture";
const dir = join(out, name);
if (!existsSync(join(dir, `${name}.spine-json`))) await createAsset({ dir, name, imagesFrom: src });

const region = (n: string, w: number, h: number, extra: any = {}) => ({ [n]: { width: w, height: h, ...extra } });
const doc = {
  // o fundo passa da moldura: sem borda dura (subpixel) na comparacao
  skeleton: { hash: "fixture", spine: "4.3.23", x: -250, y: -250, width: 500, height: 500, images: "./images/", audio: "" },
  bones: [{ name: "root" }, { name: "gira", parent: "root", x: 60, y: -40 }],
  slots: [
    { name: "fundo", bone: "root", attachment: "fundo" },
    { name: "mul", bone: "root", attachment: "disco", blend: "multiply" },
    { name: "mul_tinto", bone: "gira", attachment: "disco2", color: "ffb0b080", blend: "multiply" },
    { name: "add", bone: "root", attachment: "disco", blend: "additive", color: "ffffffa0" },
    { name: "scr", bone: "root", attachment: "disco2", blend: "screen" },
    { name: "escuro", bone: "root", attachment: "faixa", color: "ffe0c0ff", dark: "4020a0" },
    { name: "escuro_malha", bone: "gira", attachment: "faixa", color: "c0ffffc0", dark: "205010" },
    { name: "escuro_add", bone: "root", attachment: "disco2", color: "ffffffff", dark: "602000", blend: "additive" },
  ],
  skins: [
    {
      name: "default",
      attachments: {
        fundo: region("fundo", 256, 256, { scaleX: 2.2, scaleY: 2.2 }),
        mul: region("disco", 128, 128, { x: -140, y: 140, scaleX: 1.3, scaleY: 1.3 }),
        mul_tinto: region("disco2", 128, 128, { x: 100, y: 180 }),
        add: region("disco", 128, 128, { x: 140, y: 30 }),
        scr: region("disco2", 128, 128, { x: -150, y: -20 }),
        escuro: region("faixa", 192, 64, { x: -80, y: -170, scaleX: 1.8 }),
        escuro_malha: {
          faixa: {
            type: "mesh",
            uvs: [1, 1, 0, 1, 0, 0, 1, 0, 0.5, 0, 0.5, 1],
            triangles: [1, 2, 4, 1, 4, 5, 5, 4, 3, 5, 3, 0],
            vertices: [96, -32, -96, -32, -96, 32, 96, 32, 0, 50, 0, -10].map((v, i) => (i % 2 ? v - 230 : v + 120)),
            hull: 4,
            width: 192,
            height: 64,
          },
        },
        escuro_add: region("disco2", 128, 128, { x: 220, y: -200 }),
      },
    },
  ],
  animations: {
    escuro: {
      slots: {
        escuro: {
          rgba2: [
            { light: "ffffffff", dark: "000000", curve: [0.3, 0, 0.7, 1, 0.3, 0, 0.7, 1, 0.3, 0, 0.7, 1, 0.3, 0, 0.7, 1, 0.3, 0, 0.7, 1, 0.3, 0, 0.7, 1, 0.3, 0, 0.7, 1] },
            { time: 1, light: "80ff40c0", dark: "ff0060" },
            { time: 2, light: "ffffffff", dark: "000000" },
          ],
        },
        escuro_malha: { rgb2: [{ light: "ffffff", dark: "000000" }, { time: 1, light: "4080ff", dark: "ffff00" }, { time: 2, light: "ffffff", dark: "000000" }] },
        mul_tinto: { rgba: [{ color: "ffb0b080" }, { time: 1, color: "40ffff20" }, { time: 2, color: "ffb0b080" }] },
      },
      bones: { gira: { rotate: [{ value: 0 }, { time: 2, value: 90 }] } },
    },
  },
};
writeFileSync(join(dir, `${name}.spine-json`), JSON.stringify(doc));
const files = readdirSync(dir).filter((f) => /\.(png|atlas|spine-json)$/.test(f)).map((f) => join(dir, f));
await ensureImported(out, files);
console.log(`fixture em ${join(dir, `${name}-data.tres`)} (importado: ${existsSync(join(out, ".godot", "imported"))})`);
