// Quadros de um .boneco em PNG, pelo nucleo e o desenhista do editor, sem abrir o editor: sobe um
// Vite proprio (so a pagina quadro.html) e um Chromium headless, e desenha os instantes pedidos.
// Para conferir uma animacao ou um desenho em segundos, sem exportar o video inteiro.
//
//   npx tsx tools/quadro.ts <x.boneco> [--anim a] [--tempos 0,1.5,3 | --cada 0.5] [--rect x,y,w,h]
//        [--largura 960] [--fps 30] [--fundo 16131a] [--modo normal|cinza|silhueta]
//        [--saida pasta] [--folha 4] [--raiz pasta] [--port 5260] [--gpu] [--sem-camera]
//   npx tsx tools/quadro.ts <x.boneco> --anim a --video saida.mp4 [--largura 1280] [--fps 30]
//
//   --video    a animacao inteira num video (H.264 pelo ffmpeg; .webm em VP9), sem abrir o editor
//   camera     com skeleton.camera (docs/FILME.md) o quadro segue o osso da camera, no tamanho do
//              esqueleto; --rect ou --sem-camera filmam um retangulo fixo
//
//   --rect     o retangulo do mundo (y para cima, x e y do canto de baixo); padrao: o do esqueleto
//   --cada s   um quadro a cada s segundos da animacao inteira
//   --modo     cinza (valores) e silhueta (tinta em preto, sem o fundo): docs/DESENHAR.md
//   --folha c  tambem uma folha de contato com c colunas (folha.png, com o ImageMagick)
//   --raiz     a pasta que o servidor pode ler (padrao: dois niveis acima do arquivo, para os
//              filhos das instancias)
//   --referencia v.mp4  video atras do personagem (rotoscopia, N-023): --ref x,y,largura (centro e
//              largura no mundo; padrao: a altura do esqueleto), --ref-alfa 0.5, --ref-inicio s,
//              --ref-velocidade 1, --ref-cebola n (os n quadros vizinhos do video, tingidos)
//   --palco r  joga o palco (docs/PALCO.md) com o roteiro r ("direita 40, direita+pulo 30", como no
//              tools/palco.ts) e filma: o video tem o roteiro e mais 1 s; --tempos e --cada valem
//   --seguir   com --palco: o --rect so da o tamanho; a camera acompanha o jogador sem sair da fase
//   --pixel N  pixel art: desenha a 1 pixel por unidade do mundo (precisa de --rect) e amplia N vezes
//              sem suavizar (o pixel da arte cai sempre na grade, andando ou nao); quadros em PNG
//              e o video sem perda de cor. Liga sozinho (N = largura / largura do rect) quando
//              todas as paginas sao Nearest; --pixel 0 desliga
//   --gpu      a placa de video em vez do SwiftShader (mais rapido; o SwiftShader sai igual em
//              qualquer maquina)
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import sharp from "sharp";
import { passosDoRoteiro } from "../src/core/palco-roteiro.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args.splice(i, 1).length > 0;
};
const anim = opt("anim", "") || null;
const temposArg = opt("tempos", "");
const cada = Number(opt("cada", "0"));
const rectArg = opt("rect", "");
const largura = Number(opt("largura", "960"));
const fps = Number(opt("fps", "30"));
const modo = opt("modo", "normal");
const fundo = modo === "silhueta" ? null : opt("fundo", "16131a") || null;
const folha = Number(opt("folha", "0"));
const port = Number(opt("port", "5260"));
const gpu = flag("gpu");
const semCamera = flag("sem-camera");
const video = opt("video", "");
const pixelArg = opt("pixel", "");
const palcoArg = opt("palco", "");
const seguir = flag("seguir");
const palco = palcoArg ? passosDoRoteiro(palcoArg).bits : undefined;
// video de referencia atras do personagem (N-023, spike; src/render/videoref.ts): o quadro exato
// do instante (inicio + velocidade x t, repetindo) e, com --ref-cebola n, os n vizinhos do video
const referencia = opt("referencia", "");
const refRet = opt("ref", "");
const refAlfa = Number(opt("ref-alfa", "0.5"));
const refInicio = Number(opt("ref-inicio", "0"));
const refVelocidade = Number(opt("ref-velocidade", "1"));
const refCebola = Number(opt("ref-cebola", "0"));
const arq = args[0] && resolve(args[0]);
if (!arq) {
  console.error("uso: tools/quadro.ts <x.boneco> [--anim a] [--tempos 0,1 | --cada 0.5] [--rect x,y,w,h] [--largura 960] [--modo normal|cinza|silhueta] [--saida pasta] [--folha 4]");
  process.exit(2);
}
const raiz = resolve(opt("raiz", resolve(dirname(arq), "..", "..")));
const saida = resolve(opt("saida", join(dirname(arq), "quadros")));
mkdirSync(saida, { recursive: true });
const t0 = Date.now();

const filhos: ChildProcess[] = [];
const perfil = mkdtempSync(join(tmpdir(), "quadro-"));
const parar = () => {
  for (const k of filhos)
    try {
      if (k.pid) process.kill(-k.pid, "SIGTERM");
    } catch {}
  // o chromium pode ainda estar gravando no perfil: tenta de novo e, no pior caso, deixa
  try {
    rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
};
process.on("exit", parar);
process.on("SIGINT", () => process.exit(130));

// o Vite (so serve a pagina e os arquivos das raizes; sem vigiar nem recarregar)
const vite = spawn(join(REPO, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort"], {
  cwd: REPO,
  env: { ...process.env, MAMULENGO_ROOTS: referencia ? `${raiz}:${dirname(resolve(referencia))}` : raiz, MAMULENGO_PORT: String(port), MAMULENGO_ESTAVEL: "1" },
  detached: true,
  stdio: "ignore",
});
filhos.push(vite);
const base = `http://localhost:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/quadro.html`)).ok) break;
  } catch {}
  if (i > 200) throw new Error(`o Vite nao subiu na porta ${port}`);
  await new Promise((r) => setTimeout(r, 100));
}

const gl = gpu ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=gl"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const chrome = spawn("chromium", ["--headless=new", `--user-data-dir=${perfil}`, "--remote-debugging-port=0", ...gl, "--no-first-run", "about:blank"], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
filhos.push(chrome);
const wsUrl = await new Promise<string>((ok, falha) => {
  let b = "";
  chrome.stderr!.on("data", (d) => {
    b += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(b);
    if (m) ok(m[1]);
  });
  chrome.once("exit", () => falha(new Error(`o chromium saiu: ${b.slice(-400)}`)));
});
const ws = new WebSocket(wsUrl, { maxPayload: 1 << 30 });
await new Promise((ok) => ws.once("open", ok));
let id = 0;
const pend = new Map<number, (x: any) => void>();
const erros: string[] = [];
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pend.has(m.id)) pend.get(m.id)!(m.result ?? m.error);
  if (m.method === "Runtime.exceptionThrown") erros.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
const send = (method: string, params: any = {}, sessionId?: string) =>
  new Promise<any>((ok) => {
    const i = ++id;
    pend.set(i, ok);
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: s } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Runtime.enable", {}, s);
await send("Page.navigate", { url: `${base}/quadro.html` }, s);
const avaliar = async (expr: string) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s);
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r?.result?.value;
};
for (let i = 0; i < 300 && !(await avaliar("document.body?.dataset.pronto === '1'").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
if (erros.length) throw new Error(erros.join("\n"));

const aberto = await avaliar(`quadro.abrir(${JSON.stringify(arq)})`);
if (aberto.faltam.length) console.log(`aviso: paginas sem imagem: ${aberto.faltam.join(", ")}`);
if (referencia) {
  const [x, y, w] = refRet ? refRet.split(",").map(Number) : [NaN, NaN, NaN];
  const m = await avaliar(`quadro.referencia(${JSON.stringify(resolve(referencia))}, ${JSON.stringify({ x, y, largura: w, opacidade: refAlfa, inicio: refInicio, velocidade: refVelocidade, cebola: refCebola })})`);
  console.log(`referencia: ${m.quadros} quadros ${m.largura}x${m.altura} a ${m.fps} fps (${m.codec}), decodificada em ${m.msTotal} ms (${m.msPorQuadro} ms/quadro, ${m.memoriaMB} MB)`);
}
const dur = palco ? palco.length / 60 + 1 : anim ? (aberto.animacoes.find((a: any) => a.nome === anim)?.duracao ?? 0) : 0;
const tempos = temposArg
  ? temposArg.split(",").map(Number)
  : cada > 0
    ? Array.from({ length: Math.floor(dur / cada + 1e-9) + 1 }, (_, k) => Math.round(k * cada * 1000) / 1000)
    : [0];
const rect = rectArg ? rectArg.split(",").map(Number) : undefined;
// pixel art: todas as paginas Nearest (ou --pixel N)
let pixel = pixelArg === "" ? 0 : Math.max(0, Math.round(Number(pixelArg)) || 0);
if (pixelArg === "")
  try {
    const b = JSON.parse(readFileSync(arq, "utf8"));
    if (b.paginas?.length && b.paginas.every((p: any) => /^nearest/i.test(p.filtro ?? ""))) pixel = -1;
  } catch {}
if (pixel && !rect) {
  if (pixel > 0) console.log("aviso: --pixel precisa de --rect (o tamanho do mundo); desenhando sem ele");
  pixel = 0;
}
if (pixel < 0) pixel = Math.max(1, Math.round(largura / rect![2]));
// com pixel, a pagina desenha a 1 pixel por unidade e a ampliacao e sem suavizar
const larguraDesenho = pixel ? Math.round(rect![2]) : largura;
if (pixel) console.log(`pixel art: ${larguraDesenho} px por quadro, ampliado ${pixel} vezes`);
if (video) {
  // o video: os quadros em lotes de JPEG (a simulacao continua de um lote para o outro) direto
  // para o ffmpeg
  const total = Math.max(1, Math.round(dur * fps));
  const sai = resolve(video);
  // pixel art: quadros PNG, ampliados sem suavizar, e a ampliacao par (cada pixel da arte e um
  // bloco de N x N: a cor pela metade do yuv420 fica dentro do bloco, sem vazar para o vizinho)
  const n = pixel ? pixel + (pixel % 2) : 0;
  const cod = sai.endsWith(".webm")
    ? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", pixel ? "10" : "28", "-row-mt", "1"]
    : ["-c:v", "libx264", "-crf", pixel ? "8" : "18", "-preset", "medium", ...(pixel ? ["-tune", "animation"] : []), "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  const vf = (pixel ? `scale=iw*${n}:ih*${n}:flags=neighbor,` : "") + "pad=ceil(iw/2)*2:ceil(ih/2)*2";
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", pixel ? "png" : "mjpeg", "-i", "-", "-vf", vf, ...cod, sai], { stdio: ["pipe", "inherit", "inherit"] });
  const fim = new Promise<number>((ok) => ff.once("exit", (c) => ok(c ?? 1)));
  for (let q = 0; q < total; q += 30) {
    const tempos = Array.from({ length: Math.min(30, total - q) }, (_, k) => (q + k) / fps);
    const lote: string[] = await avaliar(`quadro.fotos(${JSON.stringify({ palco, seguir, anim, tempos, rect, largura: larguraDesenho, fps, fundo: fundo ?? "000000", modo: "normal", camera: semCamera ? false : undefined, formato: pixel ? "png" : "jpeg" })})`);
    for (const d of lote) if (!ff.stdin!.write(Buffer.from(d.slice(d.indexOf(",") + 1), "base64"))) await new Promise((ok) => ff.stdin!.once("drain", ok));
    process.stdout.write(`\r${Math.min(total, q + 30)}/${total} quadros`);
  }
  ff.stdin!.end();
  if ((await fim) !== 0) throw new Error("o ffmpeg falhou");
  console.log(`\n${sai}: ${total} quadros (${(total / fps).toFixed(1)} s) em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(0);
}
const pngs: string[] = await avaliar(`quadro.fotos(${JSON.stringify({ palco, seguir, anim, tempos, rect, largura: larguraDesenho, fps, fundo, modo, camera: semCamera ? false : undefined })})`);
const nomes: string[] = [];
for (const [k, d] of pngs.entries()) {
  const f = join(saida, `q_${String(tempos[k].toFixed(3)).padStart(7, "0")}${modo === "normal" ? "" : "_" + modo}.png`);
  let b = Buffer.from(d.slice(d.indexOf(",") + 1), "base64");
  if (pixel > 1) {
    const m = await sharp(b).metadata();
    b = await sharp(b).resize(m.width! * pixel, m.height! * pixel, { kernel: "nearest" }).png().toBuffer();
  }
  writeFileSync(f, b);
  nomes.push(f);
}
if (folha > 0 && nomes.length > 1) {
  const f = join(saida, `folha${modo === "normal" ? "" : "_" + modo}.png`);
  const r = spawnSync("magick", ["montage", ...nomes, "-tile", `${folha}x`, "-geometry", "+4+4", "-background", "#222", "-fill", "#ddd", "-pointsize", "14", f], { encoding: "utf8" });
  if (r.status !== 0) console.log(`aviso: a folha precisa do ImageMagick (${r.stderr?.trim()})`);
  else nomes.push(f);
}
console.log(`${pngs.length} quadros em ${((Date.now() - t0) / 1000).toFixed(1)} s, em ${saida}`);
for (const n of nomes) console.log(n);
process.exit(0);
