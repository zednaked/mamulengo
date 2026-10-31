// Exporta o que esta na tela (enquadramento do viewport) como GIF, video WebM ou WebP animado,
// com a animacao inteira, pronta para repetir em loop. O arquivo e gravado pelo
// servidor (pasta escolhida ou ~/.cache/mamulengo/exports).
import { app } from "./state.svelte.ts";
import { GifEncoder, Histogram } from "../render/gif.ts";
import { encodeWebm } from "../render/webm.ts";
import { encodeWebpAnim } from "../render/webp.ts";
import { applySequence, type SequenceParam } from "./sequence.ts";

export interface ExportOptions {
  format: "gif" | "webm" | "webp";
  // webp: qualidade de 0 a 1 (padrao 0,8)
  quality?: number;
  animation?: string | null;
  fps?: number;
  // escala sobre o tamanho do viewport em px CSS; maxWidth limita a largura
  scale?: number;
  maxWidth?: number;
  // repeticoes da animacao dentro do video (o GIF sempre repete sozinho)
  loops?: number;
  dir?: string;
  name?: string;
  // previa de transicao (como no look); sem: a da tela
  sequence?: SequenceParam;
  // enquadra a animacao inteira (uniao de todos os quadros, com margem) em vez da tela
  fit?: boolean;
  // o retangulo do mundo a filmar [x, y, largura, altura] (y para cima), no lugar da tela ou do
  // fit: a tela de um jogo, um recorte fixo
  rect?: [number, number, number, number];
  // acabamento para mostrar: titulo e subtitulo numa faixa em cima, legendas por trecho de tempo
  // (com fade) e um rodape com credito numa faixa embaixo
  moldura?: Moldura;
  onProgress?: (done: number, total: number) => void;
}

export interface Moldura {
  titulo?: string;
  subtitulo?: string;
  legendas?: { de: number; ate: number; texto: string }[];
  rodape?: string;
  credito?: string;
  // cor de destaque (titulo e borda da legenda) e do fundo das faixas
  destaque?: string;
  fundo?: string;
}

// a moldura em volta de um quadro w x h (as faixas somam altura; tudo par para o video)
function molduraTamanho(m: Moldura, w: number, h: number) {
  const topo = m.titulo || m.subtitulo ? Math.round(w * 0.11) : 0;
  const base = m.rodape || m.credito ? Math.round(w * 0.045) : 0;
  return { topo, base, W: w, H: Math.round((h + topo + base) / 2) * 2 };
}
function emoldurar(m: Moldura, quadro: HTMLCanvasElement, t: number, out: HTMLCanvasElement) {
  const w = quadro.width,
    h = quadro.height;
  const { topo, base, W, H } = molduraTamanho(m, w, h);
  out.width = W;
  out.height = H;
  const g = out.getContext("2d")!;
  const destaque = m.destaque ?? "#ff4d94";
  g.fillStyle = m.fundo ?? "#181422";
  g.fillRect(0, 0, W, H);
  g.drawImage(quadro, 0, topo);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const fonte = (peso: number, px: number) => `${peso} ${Math.round(px)}px "Noto Sans", system-ui, sans-serif`;
  if (m.titulo) {
    g.font = fonte(900, topo * 0.42);
    g.fillStyle = destaque;
    g.fillText(m.titulo, W / 2, topo * (m.subtitulo ? 0.38 : 0.5));
  }
  if (m.subtitulo) {
    g.font = fonte(500, topo * 0.2);
    g.fillStyle = "#beb6d2";
    g.fillText(m.subtitulo, W / 2, topo * 0.78);
  }
  const leg = m.legendas?.find((l) => t >= l.de && t < l.ate);
  if (leg) {
    const al = Math.max(0, Math.min(1, (t - leg.de) / 0.25, (leg.ate - t) / 0.25));
    g.font = fonte(700, w * 0.032);
    const tw = g.measureText(leg.texto).width,
      ph = w * 0.06,
      y = topo + h - ph * 0.9;
    g.globalAlpha = al;
    g.fillStyle = "rgba(24, 20, 34, 0.55)";
    g.strokeStyle = destaque;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(W / 2 - tw / 2 - ph * 0.4, y - ph / 2, tw + ph * 0.8, ph, ph / 2);
    g.fill();
    g.stroke();
    g.fillStyle = "#ffffff";
    g.fillText(leg.texto, W / 2, y + 1);
    g.globalAlpha = 1;
  }
  if (base) {
    const y = topo + h + base / 2;
    g.font = fonte(500, base * 0.42);
    if (m.rodape) {
      g.textAlign = m.credito ? "left" : "center";
      g.fillStyle = "#cdc6de";
      g.fillText(m.rodape, m.credito ? base * 0.5 : W / 2, y);
    }
    if (m.credito) {
      g.textAlign = "right";
      g.fillStyle = "#968eac";
      g.fillText(m.credito, W - base * 0.5, y);
    }
  }
  return out;
}

export interface ExportResult {
  path: string;
  bytes: number;
  format: string;
  encoder: string;
  animation: string | null;
  sequence: { next: string; mix: number; at: number | null; mixStart: number; mixEnd: number } | null;
  frames: number;
  fps: number;
  duration: number;
  size: [number, number];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function exportAnimation(o: ExportOptions): Promise<ExportResult> {
  const v = app.viewer;
  v?.sync();
  if (!v?.pose) throw new Error("nada para exportar (abra um asset)");
  const saved = { view: { ...v.view }, cam: { ...v.cam }, selection: v.selection, overlays: v.overlays, onion: v.onion.enabled };
  try {
    if (o.animation !== undefined && o.animation !== v.view.animation) {
      if (o.animation && !v.hasAnimation(o.animation)) throw new Error(`animacao nao existe: ${o.animation}`);
      v.setAnimation(o.animation);
    }
    applySequence(v, o.sequence);
    // so o boneco: sem gizmos, selecao, ossos ou fantasmas
    v.view.playing = false;
    v.view.showBones = v.view.showMeshes = v.view.showBounds = false;
    v.selection = {};
    v.overlays = [];
    // marcas de "osso mexido agora" sao da tela ao vivo, nao do quadro pedido
    v.highlights = [];
    v.onion.enabled = false;
    const fps = Math.max(1, Math.min(60, o.fps ?? 30));
    const dur = v.duration();
    const n = dur > 0 ? Math.max(1, Math.round(dur * fps)) : 1;
    const cw = v.canvas.clientWidth || 800;
    const ch = v.canvas.clientHeight || 600;
    let scale = o.scale ?? 1;
    const maxW = o.maxWidth ?? 960;
    let w: number, h: number, rect: number[];
    if (o.rect) {
      rect = [...o.rect];
      const k = Math.min(maxW, 720 * (o.scale ?? 1) * Math.max(1, rect[2] / rect[3])) / rect[2];
      w = Math.max(2, Math.round((rect[2] * k) / 2) * 2);
      h = Math.max(2, Math.round((rect[3] * k) / 2) * 2);
    } else if (o.fit) {
      // uniao das bounds de todos os quadros: nada sai cortado, nada fica minusculo
      let u: number[] | null = null;
      for (let i = 0; i <= n; i++) {
        v.poseAt(i / fps);
        const b = v.currentBounds();
        if (!b) continue;
        if (!u) u = b;
        else {
          const x0 = Math.min(u[0], b[0]),
            y0 = Math.min(u[1], b[1]);
          u = [x0, y0, Math.max(u[0] + u[2], b[0] + b[2]) - x0, Math.max(u[1] + u[3], b[1] + b[3]) - y0];
        }
      }
      if (!u) throw new Error("nada visivel para enquadrar");
      const m = 0.06;
      rect = [u[0] - u[2] * m, u[1] - u[3] * m, u[2] * (1 + 2 * m), u[3] * (1 + 2 * m)];
      // lado maior em maxW (ou 720 se menor), proporcao do enquadramento
      const long = Math.min(maxW, 720 * (o.scale ?? 1));
      const k = long / Math.max(rect[2], rect[3]);
      w = Math.max(2, Math.round((rect[2] * k) / 2) * 2);
      h = Math.max(2, Math.round((rect[3] * k) / 2) * 2);
      rect[3] = (rect[2] * h) / w;
    } else {
      if (cw * scale > maxW) scale = maxW / cw;
      // dimensoes pares (codecs de video preferem)
      w = Math.max(2, Math.round((cw * scale) / 2) * 2);
      h = Math.max(2, Math.round((ch * scale) / 2) * 2);
      const vw = cw / v.cam.zoom;
      const vh = (vw * h) / w;
      rect = [v.cam.x - vw / 2, v.cam.y - vh / 2, vw, vh];
    }
    // o quadro renderizado tem qw x qh; com moldura, o arquivo (w x h) tem as faixas em volta
    const qw = w,
      qh = h;
    if (o.moldura) ({ W: w, H: h } = molduraTamanho(o.moldura, qw, qh));
    const moldurado = document.createElement("canvas");
    const frameAt = (i: number) => {
      v.poseAt(i / fps);
      const c = v.renderRect(rect, [qw, qh]);
      return o.moldura ? emoldurar(o.moldura, c, i / fps, moldurado) : c;
    };
    const pixels = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, w, h).data;

    let blob: Blob;
    let encoder = "gif";
    if (o.format === "gif") {
      // paleta global a partir de ate 12 quadros espalhados; 255 cores, o indice que sobra e o
      // transparente dos quadros que so gravam o que mudou
      const hist = new Histogram();
      const samples = Math.min(n, 12);
      for (let s = 0; s < samples; s++) hist.add(pixels(frameAt(Math.floor((s * n) / samples))), 2);
      const gif = new GifEncoder(w, h, hist.palette(255));
      for (let i = 0; i < n; i++) {
        // atrasos inteiros em centesimos que somam a duracao certa
        const delay = Math.round((100 * (i + 1)) / fps) - Math.round((100 * i) / fps);
        gif.frame(pixels(frameAt(i)), delay);
        o.onProgress?.(i + 1, n);
        if (i % 4 === 3) await sleep(0);
      }
      blob = new Blob([gif.finish() as BlobPart], { type: "image/gif" });
    } else if (o.format === "webp") {
      // duracoes inteiras em ms que somam a duracao certa
      const dur = Array.from({ length: n }, (_, i) => Math.round((1000 * (i + 1)) / fps) - Math.round((1000 * i) / fps));
      blob = await encodeWebpAnim(n, [w, h], frameAt, dur, o.quality ?? 0.8, o.onProgress);
      encoder = "webp";
    } else {
      const loops = Math.max(1, Math.min(20, o.loops ?? 1));
      const total = n * loops;
      // WebCodecs: tempo exato e mais rapido que tempo real; sem ele, MediaRecorder
      const exact = await encodeWebm(total, fps, [w, h], (i) => frameAt(i % n), (d) => o.onProgress?.(d, total));
      encoder = exact ? "webcodecs" : "mediarecorder";
      blob = exact ?? (await recordWebm(n, total, fps, [w, h], frameAt, o.onProgress));
    }

    const anim = v.view.animation;
    const seq = v.view.sequence;
    const base = o.name ?? `${app.asset?.name ?? "boneco"}-${anim ?? "pose"}${seq ? `-para-${seq.next}` : ""}`;
    const q = new URLSearchParams({ format: o.format, name: base });
    if (o.dir) q.set("dir", o.dir);
    const r = await fetch(`/api/export?${q}`, { method: "POST", body: blob });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    app.log({ label: `exportou ${o.format.toUpperCase()} ${j.path.split("/").pop()} (${n} quadros)`, source: "ui", kind: "info", ops: 0 });
    const st = v.sequenceTimes();
    const sequence = st && seq ? { next: st.next, mix: st.mix, at: seq.at ?? null, mixStart: +st.start.toFixed(4), mixEnd: +st.end.toFixed(4) } : null;
    return { path: j.path, bytes: j.bytes, format: o.format, encoder, animation: anim, sequence, frames: n, fps, duration: dur, size: [w, h] };
  } finally {
    Object.assign(v.view, saved.view);
    Object.assign(v.cam, saved.cam);
    v.selection = saved.selection;
    v.overlays = saved.overlays;
    v.onion.enabled = saved.onion;
    v.poseAt(saved.view.time);
  }
}

// Gravacao pelo MediaRecorder (navegador sem WebCodecs). O gravador marca o tempo pelo
// relogio e renderizar um quadro pode demorar mais que 1/fps: renderiza tudo antes
// (WebP) e depois toca no ritmo certo. O primeiro quadro pode ficar um pouco mais longo.
async function recordWebm(n: number, total: number, fps: number, size: [number, number], frameAt: (i: number) => HTMLCanvasElement, progress?: (d: number, t: number) => void): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("este navegador nao grava video (sem WebCodecs nem MediaRecorder)");
  const out = document.createElement("canvas");
  [out.width, out.height] = size;
  const g = out.getContext("2d")!;
  const stream = out.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  const shots: Blob[] = [];
  for (let i = 0; i < n; i++) {
    shots.push(await new Promise<Blob>((ok, fail) => frameAt(i).toBlob((b) => (b ? ok(b) : fail(new Error("quadro nao renderizou"))), "image/webp", 0.95)));
    progress?.(i + 1, n * 2);
  }
  // o gravador so comeca com um quadro na tela
  let next = createImageBitmap(shots[0]);
  g.drawImage(await next, 0, 0);
  const started = new Promise<void>((r) => (rec.onstart = () => r()));
  rec.start();
  track.requestFrame();
  await Promise.race([started, sleep(1000)]);
  const t0 = performance.now();
  for (let k = 0; k < total; k++) {
    const bmp = await next;
    if (k + 1 < total) next = createImageBitmap(shots[(k + 1) % n]);
    g.drawImage(bmp, 0, 0);
    bmp.close();
    track.requestFrame();
    progress?.(n + Math.round(((k + 1) * n) / total), n * 2);
    await sleep(Math.max(0, t0 + ((k + 1) * 1000) / fps - performance.now()));
  }
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  return new Blob(chunks, { type: "video/webm" });
}
