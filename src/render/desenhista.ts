// O desenho do nucleo (nucleo/, C++ em wasm) no navegador, sem nenhuma dependencia: o
// carregamento do modulo e o desenhista WebGL2 da lista de desenho. O editor (nucleo.ts), o
// palco e a demo usam este arquivo; a demo nao leva nada do spine-core nem do spine-webgl.
//
// O desenho tem a semantica do jogo (a do template web e do modulo Godot, ver
// nucleo/godot/boneco/boneco_godot.cpp): a cor da textura com o pma desfeito, alfa simples;
// multiplica certo (destino x mix(1, cor, alfa)); tela certa (destino x (1 - s) + s); o
// multiplica do motor so quando o .boneco pede. Os defeitos do spine-godot nao entram.

// ---- modulo wasm (gerado por emscripten em nucleo/build-web, fora do git)

let modulo: Promise<any> | null = null;

// import pela URL para o tsc nao ler o .mjs gerado (e o caminho numa variavel para o vite nao
// copiar o .mjs sozinho, sem o .wasm, no build). `url`: outro lugar do nucleo.mjs (a demo
// estatica leva o .mjs e o .wasm junto da pagina)
const NO_REPO = "../../nucleo/build-web/nucleo.mjs";
export function carregarNucleo(url = new URL(NO_REPO, import.meta.url).href): Promise<any> {
  modulo ??= import(/* @vite-ignore */ url)
    .then((m) => m.default())
    .catch((e) => {
      modulo = null;
      throw new Error(`o nucleo em wasm nao carregou (compile com: emcmake cmake -S nucleo -B nucleo/build-web -G Ninja && cmake --build nucleo/build-web --target nucleo): ${e?.message ?? e}`);
    });
  return modulo;
}

// ---- desenhista: WebGL2 com stencil para o recorte

export type PaginaGL = { tex: WebGLTexture; pma: boolean };

// blend na ordem do enum Blend do nucleo: normal, aditivo, multiplica, multiplica do motor, tela
// (a cor sai pre-multiplicada do shader)
const blends = (gl: WebGL2RenderingContext): [number, number][] => [
  [gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
  [gl.ONE, gl.ONE],
  [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA],
  [gl.DST_COLOR, gl.ZERO],
  [gl.ONE, gl.ONE_MINUS_SRC_COLOR],
];

export class Desenhista {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uProj: WebGLUniformLocation | null;
  private uPma: WebGLUniformLocation | null;
  private uMotor: WebGLUniformLocation | null;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private BLENDS: [number, number][];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const sombra = (tipo: number, src: string) => {
      const s = gl.createShader(tipo)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = (this.prog = gl.createProgram()!);
    gl.attachShader(
      prog,
      sombra(
        gl.VERTEX_SHADER,
        `#version 300 es
in vec2 pos; in vec2 uv; in vec4 cor;
uniform mat4 proj; // mundo (y para cima) -> recorte
out vec2 vuv; out vec4 vcor;
void main() { vuv = uv; vcor = cor; gl_Position = proj * vec4(pos, 0.0, 1.0); }`,
      ),
    );
    gl.attachShader(
      prog,
      sombra(
        gl.FRAGMENT_SHADER,
        `#version 300 es
precision mediump float;
in vec2 vuv; in vec4 vcor;
uniform sampler2D tex; uniform bool pma; uniform bool motor;
out vec4 saida;
void main() {
  vec4 t = texture(tex, vuv);
  if (pma && t.a > 0.0) t.rgb /= t.a;
  vec3 c = t.rgb * vcor.rgb;
  float a = t.a * vcor.a;
  // multiplica do motor: so a cor, sem o alfa (o retangulo escuro do Godot)
  saida = motor ? vec4(c, 1.0) : vec4(c * a, a);
}`,
      ),
    );
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "programa");
    this.uProj = gl.getUniformLocation(prog, "proj");
    this.uPma = gl.getUniformLocation(prog, "pma");
    this.uMotor = gl.getUniformLocation(prog, "motor");
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    for (const [nome, n, off] of [["pos", 2, 0], ["uv", 2, 8], ["cor", 4, 16]] as const) {
      const l = gl.getAttribLocation(prog, nome);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, n, gl.FLOAT, false, 32, off);
    }
    gl.bindVertexArray(null);
    this.BLENDS = blends(gl);
  }

  // textura da pagina com os texels como estao no arquivo (sem pre-multiplicar)
  textura(img: TexImageSource, filtro: { min: number; mag: number } = { min: WebGL2RenderingContext.LINEAR, mag: WebGL2RenderingContext.LINEAR }): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    const mip = filtro.min !== gl.LINEAR && filtro.min !== gl.NEAREST;
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtro.min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtro.mag);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // Desenha o desenho atual do modulo (depois de mm_limpar_desenho e mm_desenhar) com a
  // projecao dada (mat4 em colunas). Nao limpa a tela; deixa o stencil desligado e nenhum
  // VAO ligado (o spine-webgl desenha depois no mesmo contexto).
  desenhar(N: any, paginas: PaginaGL[], proj: Float32Array | number[]) {
    const gl = this.gl;
    const nv = N._mm_num_vertices(),
      ni = N._mm_num_indices(),
      nl = N._mm_num_lotes();
    if (!nl) return { lotes: 0, chamadas: 0, vertices: 0 };
    const v = N.HEAPF32.subarray(N._mm_vertices() / 4, N._mm_vertices() / 4 + nv * 8);
    const ind = N.HEAPU32.subarray(N._mm_indices() / 4, N._mm_indices() / 4 + ni);
    const pl = N._mm_lotes() / 4;
    const lotes = N.HEAP32.subarray(pl, pl + nl * 5);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STREAM_DRAW);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STREAM_DRAW);
    gl.uniformMatrix4fv(this.uProj, false, proj);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.STENCIL_TEST);
    let chamadas = 0;
    for (let i = 0; i < nl; i++) {
      const cmd = lotes[i * 5],
        pag = lotes[i * 5 + 1],
        blend = lotes[i * 5 + 2],
        inicio = lotes[i * 5 + 3],
        quantos = lotes[i * 5 + 4];
      if (cmd === 1) {
        // recorte: marca o poligono no stencil (leque com inversao serve para poligono concavo)
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
        gl.clearStencil(0);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.colorMask(false, false, false, false);
        gl.stencilMask(1);
        gl.stencilFunc(gl.ALWAYS, 0, 1);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.drawElements(gl.TRIANGLES, quantos, gl.UNSIGNED_INT, inicio * 4);
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.EQUAL, 1, 1);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        chamadas++;
        continue;
      }
      if (cmd === 2) {
        gl.disable(gl.STENCIL_TEST);
        continue;
      }
      const p = paginas[pag];
      if (!p?.tex || !quantos) continue;
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.uniform1i(this.uPma, p.pma ? 1 : 0);
      gl.uniform1i(this.uMotor, blend === 3 ? 1 : 0);
      const [s, d] = this.BLENDS[blend] ?? this.BLENDS[0];
      gl.blendFuncSeparate(s, d, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, quantos, gl.UNSIGNED_INT, inicio * 4);
      chamadas++;
    }
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(null);
    return { lotes: nl, chamadas, vertices: nv };
  }
}

// projecao ortografica: centro (x, y) do mundo no meio, `escala` pixels por unidade, tela w x h
export function ortho(x: number, y: number, escala: number, w: number, h: number): Float32Array {
  const sx = (2 * escala) / w,
    sy = (2 * escala) / h;
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, -x * sx, -y * sy, 0, 1]);
}
