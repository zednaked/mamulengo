// Video de referencia (N-023, spike): um .mp4 atras do personagem, preso ao mundo e ao tempo da
// timeline, para rotoscopia. So o editor e o tools/quadro.ts: nao vai para o .boneco, o nucleo
// nem o jogo.
//
// Quadro exato: o mp4 e lido pelo mp4box (as amostras com os tempos de apresentacao) e
// decodificado pelo WebCodecs, todo de uma vez, em ImageBitmap. O quadro do instante t da
// timeline e o da amostra com o maior tempo de apresentacao <= inicio + velocidade x t (com o
// primeiro quadro no 0); um <video> com currentTime nao garante o quadro, e rotoscopia precisa
// dele. Clipe curto (ate MAX_QUADROS): a memoria e largura x altura x 4 bytes por quadro.
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Sample } from "mp4box";

export const MAX_QUADROS = 900;

export interface Medida {
  quadros: number;
  largura: number;
  altura: number;
  fps: number;
  duracao: number;
  codec: string;
  // qual decodificador do WebCodecs serviu (hoje so "software": ver abrir)
  decodificador: string;
  // decodificar o clipe inteiro (demux + decode + ImageBitmap), por quadro
  msPorQuadro: number;
  msTotal: number;
  memoriaMB: number;
  // subir um quadro para a GPU (texImage2D), medido no uso: media e pior
  msUpload: number;
  msUploadPior: number;
}

export class VideoReferencia {
  // inicio de cada quadro (s, com o primeiro no 0), em ordem de apresentacao
  readonly tempos: number[];
  readonly quadros: ImageBitmap[];
  readonly medida: Medida;
  private constructor(tempos: number[], quadros: ImageBitmap[], medida: Medida) {
    this.tempos = tempos;
    this.quadros = quadros;
    this.medida = medida;
  }

  get largura() {
    return this.medida.largura;
  }
  get altura() {
    return this.medida.altura;
  }

  static async abrir(url: string): Promise<VideoReferencia> {
    if (typeof VideoDecoder === "undefined") throw new Error("este navegador não tem WebCodecs (VideoDecoder): use o Chromium");
    const t0 = performance.now();
    const r = await fetch(url);
    if (!r.ok) throw new Error(`não abriu o vídeo (${r.status})`);
    const buf = await r.arrayBuffer();
    const { config, amostras, timescale } = await demux(buf);
    if (amostras.length > MAX_QUADROS) throw new Error(`vídeo com ${amostras.length} quadros: o spike decodifica tudo na memória, até ${MAX_QUADROS} (corte o trecho antes)`);
    // so o decodificador de software: no Chromium do Linux (ANGLE GL) o da placa falhou neste
    // H.264 ("Decoding error.") e reiniciou o processo da GPU, levando junto o contexto WebGL do
    // editor (medido em 05/11). Num clipe curto o de software basta (cerca de 7 ms/quadro).
    let saida: { ts: number; bmp: ImageBitmap }[] = [];
    let via = "";
    let ultimoErro: unknown = null;
    for (const hardwareAcceleration of ["prefer-software"] as const) {
      const c = { ...config, hardwareAcceleration };
      if (!(await VideoDecoder.isConfigSupported(c)).supported) continue;
      try {
        saida = await decodificar(c, amostras, timescale);
        via = "software";
        break;
      } catch (e) {
        ultimoErro = e;
      }
    }
    if (!via) throw ultimoErro ?? new Error(`codec não suportado pelo WebCodecs: ${config.codec}`);
    saida.sort((a, b) => a.ts - b.ts);
    const base = saida[0]?.ts ?? 0;
    const tempos = saida.map((x) => (x.ts - base) / 1e6);
    const ultima = amostras.reduce((m, s) => (s.cts > m.cts ? s : m), amostras[0]);
    const duracao = (ultima.cts + ultima.duration) / timescale - base / 1e6;
    const ms = performance.now() - t0;
    const w = config.codedWidth!,
      h = config.codedHeight!;
    const bw = saida[0]?.bmp.width ?? w,
      bh = saida[0]?.bmp.height ?? h;
    const medida: Medida = {
      quadros: saida.length,
      largura: bw,
      altura: bh,
      fps: +(saida.length / duracao).toFixed(3),
      duracao: +duracao.toFixed(4),
      codec: config.codec,
      decodificador: via,
      msPorQuadro: +(ms / Math.max(1, saida.length)).toFixed(2),
      msTotal: Math.round(ms),
      memoriaMB: +((bw * bh * 4 * saida.length) / 2 ** 20).toFixed(1),
      msUpload: 0,
      msUploadPior: 0,
    };
    return new VideoReferencia(
      tempos,
      saida.map((x) => x.bmp),
      medida,
    );
  }

  // o quadro do instante t da timeline (inicio e velocidade como numa instancia: inicio + velocidade x t)
  indice(t: number, o: { inicio?: number; velocidade?: number; repetir?: boolean } = {}): number {
    const n = this.tempos.length;
    if (!n) return -1;
    let s = (o.inicio ?? 0) + (o.velocidade ?? 1) * t;
    const d = this.medida.duracao;
    if (o.repetir !== false) s = ((s % d) + d) % d;
    else if (s < 0) s = 0;
    // folga para o tempo da timeline em ponto flutuante (k/12 pode dar 0,08333332)
    s += 1e-6;
    let lo = 0,
      hi = n - 1;
    if (s >= this.tempos[hi]) return hi;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.tempos[m] <= s) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  fechar() {
    for (const b of this.quadros) b.close();
    this.quadros.length = 0;
  }
}

// todas as amostras em ImageBitmap (em ordem de chegada; quem chama ordena pelo tempo)
async function decodificar(config: VideoDecoderConfig, amostras: Sample[], timescale: number) {
  const saida: { ts: number; bmp: ImageBitmap }[] = [];
  const pendentes: Promise<void>[] = [];
  let erro: unknown = null;
  const dec = new VideoDecoder({
    output: (f) => {
      const ts = f.timestamp;
      pendentes.push(
        createImageBitmap(f).then((bmp) => {
          saida.push({ ts, bmp });
          f.close();
        }),
      );
    },
    error: (e) => (erro = e),
  });
  dec.configure(config);
  for (const s of amostras)
    dec.decode(new EncodedVideoChunk({ type: s.is_sync ? "key" : "delta", timestamp: (s.cts * 1e6) / timescale, duration: (s.duration * 1e6) / timescale, data: s.data! }));
  try {
    await dec.flush();
  } catch (e) {
    erro ??= e;
  }
  if (dec.state !== "closed") dec.close();
  await Promise.all(pendentes);
  if (erro) {
    for (const x of saida) x.bmp.close();
    throw erro;
  }
  return saida;
}

// le as amostras de video do mp4 e a configuracao do decodificador
function demux(buf: ArrayBuffer): Promise<{ config: VideoDecoderConfig; amostras: Sample[]; timescale: number }> {
  return new Promise((resolve, reject) => {
    const f = createFile();
    let config: VideoDecoderConfig | null = null;
    let total = 0;
    let timescale = 1;
    const amostras: Sample[] = [];
    f.onError = (_m: string, e: string) => reject(new Error(`mp4 inválido: ${e}`));
    f.onReady = (info) => {
      const tr = info.videoTracks[0];
      if (!tr) return reject(new Error("o arquivo não tem trilha de vídeo (só .mp4 com H.264/H.265/VP9/AV1)"));
      total = tr.nb_samples;
      timescale = tr.timescale;
      config = { codec: tr.codec.startsWith("vp08") ? "vp8" : tr.codec, codedWidth: tr.video!.width, codedHeight: tr.video!.height, description: descricao(f, tr.id) };
      f.setExtractionOptions(tr.id, null, { nbSamples: Infinity });
      f.start();
    };
    f.onSamples = (_id, _u, ss) => {
      amostras.push(...ss);
      if (amostras.length >= total && config) resolve({ config, amostras, timescale });
    };
    f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buf, 0));
    f.flush();
    // sem amostras (arquivo cortado): onSamples nunca fecha
    setTimeout(() => (config ? resolve({ config, amostras, timescale }) : reject(new Error("mp4 sem trilha de vídeo legível"))), 0);
  });
}

// a caixa de configuracao do codec (avcC, hvcC, vpcC, av1C) sem o cabecalho, como o WebCodecs pede
function descricao(f: any, id: number): Uint8Array | undefined {
  const trak = f.getTrackById(id);
  for (const e of trak.mdia.minf.stbl.stsd.entries) {
    const box = e.avcC ?? e.hvcC ?? e.vpcC ?? e.av1C;
    if (box) {
      const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(s);
      return new Uint8Array(s.buffer, 8);
    }
  }
  return undefined;
}

// Desenha quadros do video como um retangulo do mundo (centro x, y e largura; a altura segue a
// proporcao do video), com a projecao do desenho (a mesma matriz 4x4 do nucleo e do spine-webgl).
// Saida premultiplicada (ONE, ONE_MINUS_SRC_ALPHA), como o desenhista. Na cebola, o vizinho so
// aparece onde difere do quadro atual (o que mudou de um quadro para o outro), na cor dele.
export class DesenhoVideo {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private uProj: WebGLUniformLocation;
  private uCor: WebGLUniformLocation;
  private uDif: WebGLUniformLocation;
  // texturas dos quadros usados por ultimo (o atual e os vizinhos da cebola)
  private cache = new Map<string, WebGLTexture>();
  private donos = new WeakMap<VideoReferencia, number>();
  private proximo = 0;
  private uploads: number[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const vs = `#version 300 es
in vec2 aPos; in vec2 aUv; uniform mat4 uProj; out vec2 vUv;
void main() { vUv = aUv; gl_Position = uProj * vec4(aPos, 0.0, 1.0); }`;
    const fs = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform sampler2D uAtual; uniform vec4 uCor; uniform float uDif; out vec4 cor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  if (uDif > 0.5) {
    // o vizinho onde ele difere do atual: so a cor da cebola, com o alfa pela diferenca da
    // luminancia suavizada (9 pontos, 2 px): o grao e a exposicao de um filme antigo mudam de
    // quadro para quadro e nao sao movimento
    vec2 px = 2.0 / vec2(textureSize(uTex, 0));
    float g = 0.0, a = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vUv + vec2(float(x), float(y)) * px;
      g += dot(texture(uTex, o).rgb, vec3(0.299, 0.587, 0.114));
      a += dot(texture(uAtual, o).rgb, vec3(0.299, 0.587, 0.114));
    }
    float d = smoothstep(0.12, 0.26, abs(g - a) / 9.0);
    cor = vec4(uCor.rgb * uCor.a * d, uCor.a * d);
  } else cor = vec4(c * uCor.a, uCor.a);
}`;
    const sh = (tipo: number, src: string) => {
      const s = gl.createShader(tipo)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader do vídeo de referência: ${gl.isContextLost() ? "o contexto WebGL foi perdido" : gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.bindAttribLocation(p, 1, "aUv");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "programa");
    this.prog = p;
    this.uProj = gl.getUniformLocation(p, "uProj")!;
    this.uCor = gl.getUniformLocation(p, "uCor")!;
    this.uDif = gl.getUniformLocation(p, "uDif")!;
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, "uTex"), 0);
    gl.uniform1i(gl.getUniformLocation(p, "uAtual"), 1);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, 16 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  // a textura do quadro i (sobe para a GPU na primeira vez; guarda as 8 ultimas)
  private textura(v: VideoReferencia, i: number): WebGLTexture {
    const gl = this.gl;
    let id = this.donos.get(v);
    if (id === undefined) this.donos.set(v, (id = this.proximo++));
    const chave = `${id}:${i}`;
    let t = this.cache.get(chave);
    if (t) {
      this.cache.delete(chave);
      this.cache.set(chave, t);
      return t;
    }
    if (this.cache.size >= 8) {
      const [k, velha] = this.cache.entries().next().value!;
      this.cache.delete(k);
      gl.deleteTexture(velha);
    }
    t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, x] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, x);
    const t0 = performance.now();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v.quadros[i]);
    const ms = performance.now() - t0;
    this.uploads.push(ms);
    if (this.uploads.length > 120) this.uploads.shift();
    v.medida.msUpload = +(this.uploads.reduce((a, b) => a + b, 0) / this.uploads.length).toFixed(3);
    v.medida.msUploadPior = +Math.max(v.medida.msUploadPior, ms).toFixed(3);
    this.cache.set(chave, t);
    return t;
  }

  // um quadro com alfa (opacidade); na cebola, `dif` e o quadro atual e `cor` a cor do vizinho
  desenhar(v: VideoReferencia, i: number, ret: { x: number; y: number; largura: number }, proj: Float32Array | number[], alfa: number, cebola?: { cor: [number, number, number]; dif: number }) {
    const gl = this.gl;
    if (i < 0 || i >= v.quadros.length) return;
    const tex = this.textura(v, i);
    const atual = cebola ? this.textura(v, cebola.dif) : null;
    const w = ret.largura,
      h = (ret.largura * v.altura) / v.largura;
    const x0 = ret.x - w / 2,
      x1 = ret.x + w / 2,
      y0 = ret.y - h / 2,
      y1 = ret.y + h / 2;
    // y do mundo para cima; a linha 0 da imagem e a de cima
    const vert = new Float32Array([x0, y0, 0, 1, x1, y0, 1, 1, x0, y1, 0, 0, x1, y1, 1, 0]);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vert);
    gl.uniformMatrix4fv(this.uProj, false, proj);
    const c = cebola?.cor ?? [1, 1, 1];
    gl.uniform4f(this.uCor, c[0], c[1], c[2], alfa);
    gl.uniform1f(this.uDif, cebola ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, atual ?? tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.STENCIL_TEST);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}

// o que o editor e o quadro.ts guardam de uma referencia em video: o clipe, onde fica no mundo
// e como anda com a timeline
export interface RefVideo {
  video: VideoReferencia;
  x: number;
  y: number;
  largura: number;
  opacidade: number;
  inicio: number;
  velocidade: number;
  repetir: boolean;
  // por cima do personagem (posar sobre o video) em vez de atras
  frente?: boolean;
}

// a cebola do video: o quadro atual e, por cima dele, os quadros vizinhos DO VIDEO (k = 1..n antes
// e depois) so onde diferem do atual, na cor da cebola do personagem (antes vermelho, depois
// verde) e mais fracos longe do atual
export function desenharRefVideo(d: DesenhoVideo, r: RefVideo, t: number, proj: Float32Array | number[], cebola: number) {
  const i = r.video.indice(t, r);
  const n = r.video.quadros.length;
  d.desenhar(r.video, i, r, proj, r.opacidade);
  for (let k = cebola; k >= 1; k--)
    for (const s of [-1, 1]) {
      let j = i + s * k;
      if (r.repetir) j = ((j % n) + n) % n;
      if (j < 0 || j >= n) continue;
      const fraco = 0.65 * (1 - (k - 1) / cebola);
      d.desenhar(r.video, j, r, proj, fraco, { cor: s < 0 ? [1, 0.3, 0.3] : [0.3, 1, 0.4], dif: i });
    }
  return i;
}
