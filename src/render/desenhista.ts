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

// relevo: o mapa de normais da pagina (docs/NUCLEO.md "Luzes"), se ela tem
export type PaginaGL = { tex: WebGLTexture; pma: boolean; relevo?: WebGLTexture | null };

// blend na ordem do enum Blend do nucleo: normal, aditivo, multiplica, multiplica do motor, tela
// (a cor sai pre-multiplicada do shader)
const blends = (gl: WebGL2RenderingContext): [number, number][] => [
  [gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
  [gl.ONE, gl.ONE],
  [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA],
  [gl.DST_COLOR, gl.ZERO],
  [gl.ONE, gl.ONE_MINUS_SRC_COLOR],
];

const ATRIBUTOS = [["pos", 2, 0], ["uv", 2, 8], ["cor", 4, 16]] as const;

const VERTICE = `#version 300 es
in vec2 pos; in vec2 uv; in vec4 cor;
uniform mat4 proj; // mundo (y para cima) -> recorte
out vec2 vuv; out vec4 vcor; out vec2 vmundo;
void main() { vuv = uv; vcor = cor; vmundo = pos; gl_Position = proj * vec4(pos, 0.0, 1.0); }`;

const LUZ = `// luzes (docs/NUCLEO.md "Luzes"): a normal do relevo girada para o mundo pelas derivadas de tela
// (para onde andam +u e +v da textura), ambiente mais a soma de cada luz: cor x max(N.L, 0) x
// atenuacao (1 - distancia / raio)^2; L vai do pixel a luz, com a altura dela em z. luzZ: a camada
// da luz menos a do lote (soma na altura e entra na distancia; 0 na mesma camada)
uniform bool iluminado; uniform sampler2D relevo; uniform vec3 ambiente; uniform int nluz;
uniform vec4 luzP[8]; uniform vec3 luzC[8]; uniform float luzZ[8];
vec3 luz(vec2 uv, vec2 mundo) {
  vec3 n = texture(relevo, uv).rgb * 2.0 - 1.0;
  vec2 dpx = dFdx(mundo), dpy = dFdy(mundo), dux = dFdx(uv), duy = dFdy(uv);
  float det = dux.x * duy.y - duy.x * dux.y;
  vec3 N = vec3(0.0, 0.0, 1.0);
  if (abs(det) > 1e-14) {
    vec2 ju = (dpx * duy.y - dpy * dux.y) / det, jv = (dpy * dux.x - dpx * duy.x) / det;
    // o y do relevo sobe e o v da textura desce
    N = normalize(vec3(n.x * normalize(ju) - n.y * normalize(jv), n.z));
  }
  vec3 soma = ambiente;
  for (int i = 0; i < 8; i++) {
    if (i >= nluz) break;
    vec3 L = vec3(luzP[i].xy - mundo, luzP[i].z + luzZ[i]);
    float at = clamp(1.0 - length(vec3(L.xy, luzZ[i])) / luzP[i].w, 0.0, 1.0);
    soma += luzC[i] * max(dot(N, normalize(L)), 0.0) * at * at;
  }
  return soma;
}
`;

const FRAGMENTO = `#version 300 es
precision highp float;
in vec2 vuv; in vec4 vcor; in vec2 vmundo;
uniform sampler2D tex; uniform bool pma; uniform bool motor;
out vec4 saida;
${LUZ}
void main() {
  vec4 t = texture(tex, vuv);
  if (pma && t.a > 0.0) t.rgb /= t.a;
  vec3 c = t.rgb * vcor.rgb;
  if (iluminado) c *= luz(vuv, vmundo);
  float a = t.a * vcor.a;
  // multiplica do motor: so a cor, sem o alfa (o retangulo escuro do Godot)
  saida = motor ? vec4(c, 1.0) : vec4(c * a, a);
}`;

// os efeitos de um slot (docs/NUCLEO.md "Efeitos"): ef sao os 23 canais (linha 0-4, brilho
// 5-10, dissolver 11-17, tingir 18-22); a textura so vale dentro da caixa da imagem
const FRAGMENTO_EFEITOS = `#version 300 es
precision highp float; precision highp int;
in vec2 vuv; in vec4 vcor; in vec2 vmundo;
uniform sampler2D tex; uniform bool pma; uniform bool motor;
uniform float ef[23]; uniform vec4 caixa; uniform vec2 pagina;
out vec4 saida;
vec4 T(vec2 uv) {
  if (uv.x < caixa.x || uv.y < caixa.y || uv.x > caixa.z || uv.y > caixa.w) return vec4(0.0);
  vec4 t = texture(tex, uv);
  if (pma && t.a > 0.0) t.rgb /= t.a;
  return t;
}
float hash(uint i, uint j) {
  uint x = i * 1664525u + j * 1013904223u;
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return float(x) / 4294967295.0;
}
float ruido(vec2 p) {
  vec2 c = floor(p), f = p - c;
  f = f * f * (3.0 - 2.0 * f);
  uint i = uint(int(c.x)), j = uint(int(c.y));
  return mix(mix(hash(i, j), hash(i + 1u, j), f.x), mix(hash(i, j + 1u), hash(i + 1u, j + 1u), f.x), f.y);
}
${LUZ}
vec4 sobre(vec4 cima, vec4 baixo) {
  float a = cima.a + baixo.a * (1.0 - cima.a);
  return a > 0.0 ? vec4((cima.rgb * cima.a + baixo.rgb * baixo.a * (1.0 - cima.a)) / a, a) : vec4(0.0);
}
void main() {
  vec2 px = 1.0 / pagina;
  vec4 t = T(vuv);
  vec4 C = vec4(t.rgb * vcor.rgb, t.a * vcor.a);
  float ft = ef[22] * ef[21];
  if (ft > 0.0) C.rgb = mix(C.rgb, vec3(ef[18], ef[19], ef[20]), ft);
  if (iluminado) C.rgb *= luz(vuv, vmundo);
  vec4 U = vec4(0.0);
  // miolo opaco: a linha e o halo ficam por baixo e nao aparecem (F = C); nem amostra
  bool opaco = C.a >= 1.0;
  if (!opaco && ef[9] > 0.0 && ef[8] > 0.0) {
    // aneis de perto para longe, cada um com peso menor: quando B ja alcanca o peso do anel,
    // nenhum anel seguinte passa dele e o resultado e o mesmo
    float B = 0.0;
    for (int i = 1; i <= 6; i++) {
      float w = pow(1.0 - float(i - 1) / 6.0, 2.0);
      if (B >= w) break;
      for (int k = 0; k < 16; k++) {
        float g = (float(k) + 0.5 * float(i % 2)) * 6.2831853 / 16.0;
        B = max(B, T(vuv + vec2(cos(g), sin(g)) * ef[10] * float(i) / 6.0 * px).a * w);
        if (B >= w) break;
      }
    }
    U = vec4(ef[5], ef[6], ef[7], min(1.0, ef[8] * ef[9] * B));
  }
  if (!opaco && ef[4] > 0.0 && ef[3] > 0.0) {
    float A = 0.0;
    for (int k = 0; k < 24; k++) {
      if (A >= 1.0) break;
      float g = float(k) * 6.2831853 / 24.0;
      vec2 d = vec2(cos(g), sin(g)) * ef[4] * px;
      A = max(A, max(T(vuv + d).a, max(T(vuv + d * 0.6666667).a, T(vuv + d * 0.3333333).a)));
    }
    U = sobre(vec4(ef[0], ef[1], ef[2], ef[3] * A), U);
  }
  U.a *= vcor.a;
  vec4 F = opaco ? C : sobre(C, U);
  if (ef[11] > 0.0) {
    float n = ruido(vuv * pagina / max(ef[17], 1.0));
    if (n < ef[11]) discard;
    if (n < ef[11] + ef[16]) F.rgb = mix(F.rgb, vec3(ef[12], ef[13], ef[14]), ef[15]);
  }
  saida = motor ? vec4(F.rgb, 1.0) : vec4(F.rgb * F.a, F.a);
}`;

// a camada de ajuste (docs/NUCLEO.md "Ajuste"): o que ja esta na tela (copiado para `tela`), com
// desfoque gaussiano, matiz (giro em volta do eixo do cinza), saturacao, luminosidade e
// contraste, desenhado por cima pela mascara (o alfa da imagem do slot; cheia: a tela inteira)
const VERTICE_AJUSTE = `#version 300 es
in vec2 pos; in vec2 uv; in vec4 cor;
uniform mat4 proj; uniform bool cheia;
out vec2 vuv; out vec4 vcor;
void main() {
  if (cheia) {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    vuv = vec2(0.0); vcor = vec4(1.0);
  } else { vuv = uv; vcor = cor; gl_Position = proj * vec4(pos, 0.0, 1.0); }
}`;
const FRAGMENTO_AJUSTE = `#version 300 es
precision highp float;
in vec2 vuv; in vec4 vcor;
uniform sampler2D tela; uniform sampler2D tex; uniform bool cheia;
uniform vec4 vista; uniform float aj[5]; uniform float pxMundo;
out vec4 saida;
vec3 gira(vec3 c, float graus) {
  float a = radians(graus), s = sin(a), k = cos(a);
  vec3 e = vec3(0.57735027);
  return c * k + cross(e, c) * s + e * dot(e, c) * (1.0 - k);
}
void main() {
  vec2 p = (gl_FragCoord.xy - vista.xy) / vista.zw;
  float r = aj[4] * pxMundo;
  vec3 c;
  if (r > 0.5) {
    vec3 s = vec3(0.0); float w = 0.0;
    for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
      vec2 o = vec2(float(i), float(j)) / 3.0;
      float g = exp(-dot(o, o) * 2.0);
      s += texture(tela, p + o * r / vista.zw).rgb * g; w += g;
    }
    c = s / w;
  } else c = texture(tela, p).rgb;
  c = gira(c, aj[0]);
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, aj[1]);
  c = clamp((c + aj[2] - 0.5) * aj[3] + 0.5, 0.0, 1.0);
  float m = cheia ? 1.0 : texture(tex, vuv).a * vcor.a;
  saida = vec4(c * m, m);
}`;

export class Desenhista {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private progEf: WebGLProgram;
  private uEf: Record<string, WebGLUniformLocation | null> = {};
  private uProj: WebGLUniformLocation | null;
  private uPma: WebGLUniformLocation | null;
  private uMotor: WebGLUniformLocation | null;
  // as uniformes da luz nos dois programas
  private uLuz = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>();
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private BLENDS: [number, number][];
  private progAj: WebGLProgram;
  private uAj: Record<string, WebGLUniformLocation | null> = {};
  private tela: WebGLTexture;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const sombra = (tipo: number, src: string) => {
      const s = gl.createShader(tipo)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    // os dois programas (sem e com efeitos) com os atributos nas mesmas posicoes, para um VAO so
    const programa = (frag: string, vert = VERTICE) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, sombra(gl.VERTEX_SHADER, vert));
      gl.attachShader(p, sombra(gl.FRAGMENT_SHADER, frag));
      ATRIBUTOS.forEach(([nome], i) => gl.bindAttribLocation(p, i, nome));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "programa");
      return p;
    };
    this.prog = programa(FRAGMENTO);
    this.uProj = gl.getUniformLocation(this.prog, "proj");
    this.uPma = gl.getUniformLocation(this.prog, "pma");
    this.uMotor = gl.getUniformLocation(this.prog, "motor");
    this.progEf = programa(FRAGMENTO_EFEITOS);
    for (const u of ["proj", "pma", "motor", "ef", "caixa", "pagina"]) this.uEf[u] = gl.getUniformLocation(this.progEf, u);
    for (const p of [this.prog, this.progEf]) {
      const u: Record<string, WebGLUniformLocation | null> = {};
      for (const n of ["iluminado", "relevo", "ambiente", "nluz", "luzP", "luzC", "luzZ", "tex"]) u[n] = gl.getUniformLocation(p, n);
      this.uLuz.set(p, u);
      gl.useProgram(p);
      gl.uniform1i(u.tex, 0);
      gl.uniform1i(u.relevo, 1);
    }
    this.progAj = programa(FRAGMENTO_AJUSTE, VERTICE_AJUSTE);
    for (const u of ["proj", "cheia", "tela", "tex", "vista", "aj", "pxMundo"]) this.uAj[u] = gl.getUniformLocation(this.progAj, u);
    gl.useProgram(this.progAj);
    gl.uniform1i(this.uAj.tex, 0);
    gl.uniform1i(this.uAj.tela, 2);
    this.tela = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tela);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    ATRIBUTOS.forEach(([, n, off], i) => {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, n, gl.FLOAT, false, 32, off);
    });
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
    const lotes = N.HEAP32.subarray(pl, pl + nl * 7);
    const ng = N._mm_num_grupos_luz(),
      pg = N._mm_grupos_luz() / 4;
    const grupos = ng ? N.HEAPF32.subarray(pg, pg + ng * 68) : null;
    const pz = N._mm_lotes_profundidade() / 4;
    const profs = N.HEAPF32.subarray(pz, pz + nl);
    const luzP = new Float32Array(32),
      luzC = new Float32Array(24),
      luzZ = new Float32Array(8);
    const ne = N._mm_num_efeitos(),
      pe = N._mm_efeitos() / 4;
    const efeitos = ne ? N.HEAPF32.subarray(pe, pe + ne * 29) : null;
    if (efeitos) {
      gl.useProgram(this.progEf);
      gl.uniformMatrix4fv(this.uEf.proj, false, proj);
    }
    let usando = this.prog;
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
    const na = N._mm_num_ajustes ? N._mm_num_ajustes() : 0;
    const ajustes = na ? N.HEAPF32.subarray(N._mm_ajustes() / 4, N._mm_ajustes() / 4 + na * 5) : null;
    for (let i = 0; i < nl; i++) {
      const cmd = lotes[i * 7],
        pag = lotes[i * 7 + 1],
        blend = lotes[i * 7 + 2],
        inicio = lotes[i * 7 + 3],
        quantos = lotes[i * 7 + 4],
        ef = lotes[i * 7 + 5],
        grupo = lotes[i * 7 + 6];
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
      if (cmd === 3) {
        // camada de ajuste: copia o que ja esta desenhado e desenha por cima, ajustado
        if (!ajustes) continue;
        const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.tela);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vp[0], vp[1], vp[2], vp[3], 0);
        gl.activeTexture(gl.TEXTURE0);
        const cheia = !quantos;
        if (!cheia) {
          const p = paginas[pag];
          if (!p?.tex) continue;
          gl.bindTexture(gl.TEXTURE_2D, p.tex);
        }
        if (usando !== this.progAj) gl.useProgram((usando = this.progAj));
        gl.uniformMatrix4fv(this.uAj.proj, false, proj);
        gl.uniform1i(this.uAj.cheia, cheia ? 1 : 0);
        gl.uniform4f(this.uAj.vista, vp[0], vp[1], vp[2], vp[3]);
        gl.uniform1fv(this.uAj.aj, ajustes.subarray(ef * 5, ef * 5 + 5));
        // pixels de tela por pixel do mundo (o desfoque e em pixels do mundo)
        gl.uniform1f(this.uAj.pxMundo, Math.hypot(proj[0], proj[1]) * vp[2] * 0.5);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        if (cheia) gl.drawArrays(gl.TRIANGLES, 0, 3);
        else gl.drawElements(gl.TRIANGLES, quantos, gl.UNSIGNED_INT, inicio * 4);
        chamadas++;
        continue;
      }
      const p = paginas[pag];
      if (!p?.tex || !quantos) continue;
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      const quer = ef >= 0 && efeitos ? this.progEf : this.prog;
      if (quer !== usando) gl.useProgram((usando = quer));
      if (quer === this.progEf) {
        const o = ef * 29;
        gl.uniform1fv(this.uEf.ef, efeitos!.subarray(o, o + 23));
        gl.uniform4f(this.uEf.caixa, efeitos![o + 23], efeitos![o + 24], efeitos![o + 25], efeitos![o + 26]);
        gl.uniform2f(this.uEf.pagina, efeitos![o + 27], efeitos![o + 28]);
        gl.uniform1i(this.uEf.pma, p.pma ? 1 : 0);
        gl.uniform1i(this.uEf.motor, blend === 3 ? 1 : 0);
      } else {
        gl.uniform1i(this.uPma, p.pma ? 1 : 0);
        gl.uniform1i(this.uMotor, blend === 3 ? 1 : 0);
      }
      // luz: o relevo da pagina na unidade 1 e o grupo do personagem (sem relevo carregado, sem luz)
      const ul = this.uLuz.get(quer)!;
      const acesa = grupo >= 0 && grupos && p.relevo;
      gl.uniform1i(ul.iluminado, acesa ? 1 : 0);
      if (acesa) {
        const o = grupo * 68,
          n = Math.min(8, grupos![o + 3]);
        for (let k = 0; k < n; k++) {
          const q = o + 4 + k * 8;
          luzP.set([grupos![q], grupos![q + 1], grupos![q + 2], grupos![q + 6]], k * 4);
          luzC.set([grupos![q + 3], grupos![q + 4], grupos![q + 5]], k * 3);
          luzZ[k] = grupos![q + 7] - profs[i];
        }
        gl.uniform3f(ul.ambiente, grupos![o], grupos![o + 1], grupos![o + 2]);
        gl.uniform1i(ul.nluz, n);
        gl.uniform4fv(ul.luzP, luzP);
        gl.uniform3fv(ul.luzC, luzC);
        gl.uniform1fv(ul.luzZ, luzZ);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, p.relevo!);
        gl.activeTexture(gl.TEXTURE0);
      }
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
