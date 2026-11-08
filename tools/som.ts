// O som de um video exportado: os eventos com `audio` da animacao (src/core/som.ts: descendo nas
// instancias e calando as escondidas), mais uma trilha de fundo opcional, misturados e postos no
// video com o ffmpeg.
//
//   npx tsx tools/som.ts <x.boneco> --anim a --video v.webm [--saida v-som.mp4] [--musica m.ogg]
//        [--musica-volume 0.5] [--musica-inicio 0] [--fade 1.2] [--listar]
//
//   --listar      so mostra a trilha (instante, arquivo, volume, balanco, de onde)
//   --musica      fundo do comeco ao fim (cortado no tamanho do video, com fade no fim)
//   --fade        segundos de fade no fim (musica e efeitos)
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { trilhaDeSom, duracaoDaAnimacao } from "../src/core/som.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args.splice(i, 1).length > 0;
};
const anim = opt("anim", "");
const video = opt("video", "");
const musica = opt("musica", "");
const volMusica = Number(opt("musica-volume", "0.5"));
const iniMusica = Number(opt("musica-inicio", "0"));
const fade = Number(opt("fade", "1.2"));
const listar = flag("listar");
const arq = args[0] && resolve(args[0]);
if (!arq || !anim || (!video && !listar)) {
  console.error("uso: tools/som.ts <x.boneco> --anim a --video v.webm [--saida v-som.mp4] [--musica m.ogg] [--musica-volume 0.5] [--fade 1.2] [--listar]");
  process.exit(2);
}
const saida = resolve(opt("saida", video ? video.replace(/\.[^.]+$/, "") + "-som.mp4" : "som.mp4"));
const le = (c: string) => JSON.parse(readFileSync(c, "utf8"));
const b = le(arq);
if (!b.animacoes?.[anim]) throw new Error(`animacao desconhecida: ${anim}`);
const ffprobe = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());
const dur = video ? ffprobe(resolve(video)) : duracaoDaAnimacao(b.animacoes[anim]);
const sons = trilhaDeSom(b, arq, anim, dur, (rel, pai) => {
  const c = resolve(dirname(pai), rel);
  return { b: le(c), caminho: c };
});
const arquivo = (s: (typeof sons)[number]) => resolve(s.pasta, s.audio);
for (const s of sons) console.log(`${s.tempo.toFixed(3).padStart(7)}  ${s.evento.padEnd(16)} ${s.audio}  vol ${s.volume} bal ${s.balanco}${s.onde ? `  (${s.onde})` : ""}${existsSync(arquivo(s)) ? "" : "  FALTA O ARQUIVO"}`);
if (listar) process.exit(0);
const usados = sons.filter((s) => existsSync(arquivo(s)) && s.tempo < dur);
if (!usados.length && !musica) throw new Error("nenhum som: eventos com audio (event.create audio) ou --musica");

// cada som atrasado ate o instante dele, no volume e no balanco; tudo somado (sem normalizar), o
// fade no fim, e o video copiado quando ja e H.264
const ent: string[] = ["-i", resolve(video)];
const fil: string[] = [];
const rotulos: string[] = [];
usados.forEach((s, k) => {
  ent.push("-i", arquivo(s));
  const ms = Math.round(s.tempo * 1000);
  const l = Math.min(1, 1 - s.balanco),
    r = Math.min(1, 1 + s.balanco);
  fil.push(`[${k + 1}:a]aformat=channel_layouts=stereo,pan=stereo|c0=${l.toFixed(3)}*c0|c1=${r.toFixed(3)}*c1,volume=${s.volume},adelay=${ms}|${ms}[s${k}]`);
  rotulos.push(`[s${k}]`);
});
if (musica) {
  ent.push("-ss", String(iniMusica), "-i", resolve(musica));
  fil.push(`[${usados.length + 1}:a]aformat=channel_layouts=stereo,volume=${volMusica}[m]`);
  rotulos.push("[m]");
}
fil.push(`${rotulos.join("")}amix=inputs=${rotulos.length}:normalize=0:duration=longest,atrim=0:${dur.toFixed(3)},afade=t=out:st=${Math.max(0, dur - fade).toFixed(3)}:d=${fade},alimiter=limit=0.95[a]`);
const h264 = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", resolve(video)], { encoding: "utf8" }).stdout.trim() === "h264";
const cod = h264 && saida.endsWith(".mp4") ? ["-c:v", "copy"] : saida.endsWith(".webm") ? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30"] : ["-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p"];
const aud = saida.endsWith(".webm") ? ["-c:a", "libopus", "-b:a", "160k"] : ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...ent, "-filter_complex", fil.join(";"), "-map", "0:v", "-map", "[a]", ...cod, ...aud, "-t", dur.toFixed(3), saida], { encoding: "utf8", maxBuffer: 1 << 26 });
if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
console.log(`${saida}: ${usados.length} sons${musica ? " e a musica" : ""}, ${dur.toFixed(1)} s`);
