// Exporta o que esta na tela (enquadramento do viewport) como GIF ou video WebM,
// com a animacao inteira, pronta para repetir em loop. O arquivo e gravado pelo
// servidor (pasta escolhida ou ~/.cache/mamulengo/exports).
import { app } from "./state.svelte.ts";
import { GifEncoder, Histogram } from "../render/gif.ts";
import { encodeWebm } from "../render/webm.ts";
import { applySequence, type SequenceParam } from "./sequence.ts";

export interface ExportOptions {
  format: "gif" | "webm";
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
  onProgress?: (done: number, total: number) => void;
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
    if (o.fit) {
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
    const frameAt = (i: number) => {
      v.poseAt(i / fps);
      return v.renderRect(rect, [w, h]);
    };
    const pixels = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, w, h).data;

    let blob: Blob;
    let encoder = "gif";
    if (o.format === "gif") {
      // paleta global a partir de ate 12 quadros espalhados
      const hist = new Histogram();
      const samples = Math.min(n, 12);
      for (let s = 0; s < samples; s++) hist.add(pixels(frameAt(Math.floor((s * n) / samples))), 2);
      const gif = new GifEncoder(w, h, hist.palette(256));
      for (let i = 0; i < n; i++) {
        // atrasos inteiros em centesimos que somam a duracao certa
        const delay = Math.round((100 * (i + 1)) / fps) - Math.round((100 * i) / fps);
        gif.frame(pixels(frameAt(i)), delay);
        o.onProgress?.(i + 1, n);
        if (i % 4 === 3) await sleep(0);
      }
      blob = new Blob([gif.finish() as BlobPart], { type: "image/gif" });
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
