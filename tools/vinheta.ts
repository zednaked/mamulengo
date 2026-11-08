// Abertura e fechamento do Mamulengo em volta de um video exportado pelo editor, para postar: a
// vinheta curta (exemplos/vinheta/curta.boneco, animacoes abertura e fechamento, exportadas em
// curta-abertura.webm e curta-fechamento.webm) antes e depois, no tamanho do video (a vinheta
// encolhe para caber e o resto fica no fundo escuro da moldura). Precisa de ffmpeg.
//
//   npx tsx tools/vinheta.ts <video.webm|.gif|.mp4> [--saida <x-post.mp4|.webm|.gif>] [--fps 30]
//                            [--sem-abertura] [--sem-fechamento]
//
//   --saida  padrao: <video>-post.mp4 ao lado (H.264, o que as redes aceitam melhor); .webm e
//            .gif tambem
//
// O som do video, se houver, entra atrasado pela abertura (AAC no mp4, Opus no webm; o gif nao tem
// som). As vinhetas nao tem som proprio.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args.splice(i, 1).length > 0;
};
const fps = Number(opt("fps", "30"));
const saidaOpt = opt("saida", "");
const semAbertura = flag("sem-abertura"),
  semFechamento = flag("sem-fechamento");
const video = args[0] && resolve(args[0]);
if (!video || !existsSync(video)) {
  console.error("uso: tools/vinheta.ts <video.webm|.gif|.mp4> [--saida <x-post.mp4|.webm|.gif>] [--fps 30] [--sem-abertura] [--sem-fechamento]");
  process.exit(2);
}
const VINHETA = join(dirname(fileURLToPath(import.meta.url)), "..", "exemplos", "vinheta");
const abertura = join(VINHETA, "curta-abertura.webm"),
  fechamento = join(VINHETA, "curta-fechamento.webm");
for (const f of [abertura, fechamento]) if (!existsSync(f)) throw new Error(`falta ${f}: gere com exemplos/vinheta/curta.ts e exporte as animacoes abertura e fechamento`);
const saida = resolve(saidaOpt || video.replace(/\.[^.]+$/, "") + "-post.mp4");

// o tamanho do video (par, para o H.264)
const p = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", video], { encoding: "utf8" });
if (p.status !== 0) throw new Error(`ffprobe: ${p.stderr}`);
const [w0, h0] = p.stdout.trim().split("x").map(Number);
const W = Math.round(w0 / 2) * 2,
  H = Math.round(h0 / 2) * 2;

// cada parte no mesmo tamanho, quadro e taxa; a vinheta cabe inteira, com o fundo da moldura em volta
const cabe = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x181422,fps=${fps},setsar=1,format=yuv420p`;
const partes = [...(semAbertura ? [] : [abertura]), video, ...(semFechamento ? [] : [fechamento])];
const filtro = partes.map((_, i) => `[${i}:v]${cabe}[v${i}]`).join(";") + ";" + partes.map((_, i) => `[v${i}]`).join("") + `concat=n=${partes.length}:v=1:a=0[v]`;
const ext = saida.split(".").pop();

// o som do video (as vinhetas nao tem): atrasado pela abertura, para continuar junto da imagem
const temAudio =
  ext !== "gif" && spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", video], { encoding: "utf8" }).stdout.trim() !== "";
const duracao = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());
const atraso = semAbertura ? 0 : Math.round(duracao(abertura) * 1000);
const filtroA = temAudio ? `${filtro};[${semAbertura ? 0 : 1}:a]adelay=${atraso}:all=1[a]` : filtro;
const som = (c: string[]) => (temAudio ? ["-map", "[a]", ...c] : []);
const cod =
  ext === "gif"
    ? ["-filter_complex", `${filtro};[v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, "-loop", "0"]
    : ext === "webm"
      ? ["-filter_complex", filtroA, "-map", "[v]", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1", ...som(["-c:a", "libopus"])]
      : ["-filter_complex", filtroA, "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", ...som(["-c:a", "aac", "-b:a", "192k"])];
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...partes.flatMap((f) => ["-i", f]), ...cod, saida], { encoding: "utf8", maxBuffer: 1 << 26 });
if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
const d = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", saida], { encoding: "utf8" }).stdout.trim();
console.log(`${saida}: ${W}x${H}, ${Number(d).toFixed(1)} s${temAudio ? ", com o som do video" : ""} (${partes.length === 3 ? "abertura + video + fechamento" : partes.length === 2 ? (semAbertura ? "video + fechamento" : "abertura + video") : "so o video"})`);
