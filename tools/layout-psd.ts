// Monta um PSD em camadas a partir de imagens soltas e do layout.json do kit de
// aceitacao (tools/acceptance-kit.ts): o que a arte entregaria. Cada imagem entra girada,
// escalada e espelhada como na composicao, na ordem de desenho; camadas escondidas no
// setup ficam escondidas; o 0,0 do personagem vira uma camada [origin].
//
//   npx tsx tools/layout-psd.ts <pasta-do-kit> [saida.psd]    (padrao: <kit>/arte.psd)
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { initializeCanvas, writePsdBuffer, type Layer } from "ag-psd";

initializeCanvas((() => { throw new Error("sem canvas"); }) as any, ((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })) as any);

const kit = resolve(process.argv[2] ?? "");
const out = resolve(process.argv[3] ?? join(kit, "arte.psd"));
const layout = JSON.parse(readFileSync(join(kit, "layout.json"), "utf8"));
const BLEND: Record<string, string> = { normal: "normal", additive: "linear dodge", multiply: "multiply", screen: "screen" };

interface Placed {
  name: string;
  hidden: boolean;
  blend: string;
  x: number; // centro no mundo
  y: number;
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

const placed: Placed[] = [];
for (const l of [...layout.layers].sort((a: any, b: any) => a.order - b.order)) {
  const file = join(kit, "imagens", `${l.image}.png`);
  const meta = await sharp(file).metadata();
  const sx = Math.abs(l.scale[0]),
    sy = Math.abs(l.scale[1]);
  let img = sharp(file)
    .ensureAlpha()
    .resize(Math.max(1, Math.round((meta.width ?? 1) * sx)), Math.max(1, Math.round((meta.height ?? 1) * sy)), { fit: "fill" });
  if (l.scale[0] < 0) img = img.flop();
  if (l.scale[1] < 0) img = img.flip();
  // rotacao do mundo (y para cima, anti-horario) = horario negativo na imagem (y para baixo)
  const buf = await img.png().toBuffer();
  const { data, info } = await sharp(buf).rotate(-l.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true });
  // nome da camada = parte; cada camada e um desenho proprio (no PSD, a mesma imagem
  // espelhada em outra parte e outra camada), entao o arquivo segue o nome da parte
  const name = l.layer;
  placed.push({ name, hidden: !l.visible, blend: BLEND[l.blend] ?? "normal", x: l.center[0], y: l.center[1], w: info.width, h: info.height, data: new Uint8ClampedArray(data) });
}

// enquadramento do PSD: tudo, mais uma margem; y do PSD cresce para baixo
const pad = 40;
const minX = Math.min(...placed.map((p) => p.x - p.w / 2), 0) - pad;
const maxX = Math.max(...placed.map((p) => p.x + p.w / 2), 0) + pad;
const minY = Math.min(...placed.map((p) => p.y - p.h / 2), 0) - pad;
const maxY = Math.max(...placed.map((p) => p.y + p.h / 2), 0) + pad;
const W = Math.ceil(maxX - minX),
  H = Math.ceil(maxY - minY);
const toPsd = (x: number, y: number) => [x - minX, maxY - y];

const children: Layer[] = placed.map((p) => {
  const [cx, cy] = toPsd(p.x, p.y);
  const left = Math.round(cx - p.w / 2),
    top = Math.round(cy - p.h / 2);
  return { name: p.name, hidden: p.hidden, blendMode: p.blend as any, left, top, right: left + p.w, bottom: top + p.h, imageData: { width: p.w, height: p.h, data: p.data } as any };
});
const [ox, oy] = toPsd(0, 0);
const dot = new Uint8ClampedArray(2 * 2 * 4).fill(255);
children.push({ name: "[origin]", left: Math.round(ox) - 1, top: Math.round(oy) - 1, right: Math.round(ox) + 1, bottom: Math.round(oy) + 1, imageData: { width: 2, height: 2, data: dot } as any });

writeFileSync(out, writePsdBuffer({ width: W, height: H, children }, { noBackground: true }));
console.log(`${out}: ${placed.length} camadas (${placed.filter((p) => p.hidden).length} escondidas), ${W}x${H}`);
