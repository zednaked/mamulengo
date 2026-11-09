// Pose de video no navegador (docs/ANIMAR.md, "Pose de video"): o MediaPipe Pose Landmarker acha
// os 33 pontos do corpo em cada quadro do video de referencia ja decodificado (src/render/videoref.ts),
// e o comando pose.fromLandmarks (src/core/rotoscopia.ts) faz as chaves. O MediaPipe (Apache 2.0)
// so e baixado quando alguem usa: o modulo e o wasm do jsDelivr, o modelo do armazenamento do
// Google; o navegador guarda no cache.
import type { VideoReferencia } from "../render/videoref.ts";

const VERSAO = "1.1.1";
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSAO}`;
const MODELO = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task";

let detector: Promise<any> | null = null;
// o detector de video quer os instantes sempre crescendo, por toda a vida dele (uma segunda leitura
// que recomecasse do 0 seria recusada): cada leitura continua deste relogio
let relogio = 0;
function carregar(): Promise<any> {
  detector ??= (async () => {
    const v: any = await import(/* @vite-ignore */ `${BASE}/vision_bundle.mjs`);
    const arquivos = await v.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const criar = (delegate: "GPU" | "CPU") => v.PoseLandmarker.createFromOptions(arquivos, { baseOptions: { modelAssetPath: MODELO, delegate }, runningMode: "VIDEO", numPoses: 1 });
    // a placa de video quando da; senao o processador
    return criar("GPU").catch(() => criar("CPU"));
  })().catch((e) => {
    detector = null;
    throw new Error(`o detector de pose nao carregou (precisa de internet na primeira vez): ${e?.message ?? e}`);
  });
  return detector;
}

export type QuadroDetectado = { t: number; points: number[][] | null };

// os pontos de cada quadro do video, em pixels (y para baixo); t no relogio da animacao: o video
// toca de `inicio` na velocidade `velocidade` (como a referencia: tempo do video = inicio + velocidade * t)
export async function detectarPose(video: VideoReferencia, o: { inicio?: number; velocidade?: number; ate?: number } = {}, progresso?: (feito: number, total: number) => void): Promise<QuadroDetectado[]> {
  const pl = await carregar();
  const inicio = o.inicio ?? 0,
    vel = o.velocidade || 1;
  const out: QuadroDetectado[] = [];
  const idx = video.tempos.map((t, i) => [t, i] as const).filter(([t]) => t >= inicio - 1e-6 && (o.ate === undefined || (t - inicio) / vel <= o.ate + 1e-6));
  const base = relogio + 1000;
  let ultimo = base - 1;
  for (const [k, [tv, i]] of idx.entries()) {
    const ms = Math.max(ultimo + 1, base + Math.round(tv * 1000));
    ultimo = relogio = ms;
    const r = pl.detectForVideo(video.quadros[i], ms);
    const lm = r?.landmarks?.[0];
    out.push({ t: (tv - inicio) / vel, points: lm ? lm.map((p: any) => [p.x * video.largura, p.y * video.altura, p.z ?? 0, p.visibility ?? 1]) : null });
    progresso?.(k + 1, idx.length);
    // devolve a tela entre um quadro e outro (a barra de progresso anda)
    if (k % 4 === 3) await new Promise((r) => setTimeout(r));
  }
  return out;
}
