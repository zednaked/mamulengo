// Palco do nucleo: toca um .boneco pelo nucleo novo (nucleo/, em wasm) com o desenho WebGL
// daqui, ao lado da referencia de hoje (spine-core + spine-webgl), no mesmo passo de tempo.
// Mostra o custo de cada um e, se pedido, a diferenca pixel a pixel.
//
//   npm run dev, depois http://localhost:5199/palco.html (os .boneco das raizes do editor)
import * as spine from "@esotericsoftware/spine-webgl";
import { exportarSpine } from "../boneco/spine.ts";
import { godotGravity } from "../core/pose.ts";

type Asset = { id: string; name: string; project: string; formato?: string };
type Info = { nome: string; paginas: { arquivo: string; largura: number; altura: number; pma: boolean }[]; animacoes: { nome: string; duracao: number }[] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const selAsset = $<HTMLSelectElement>("asset");
const selAnim = $<HTMLSelectElement>("anim");
const selVel = $<HTMLSelectElement>("vel");
const inCopias = $<HTMLInputElement>("copias");
const chkRef = $<HTMLInputElement>("ref");
const chkDif = $<HTMLInputElement>("dif");
const telaNucleo = $<HTMLCanvasElement>("tela-nucleo");
const telaRef = $<HTMLCanvasElement>("tela-ref");
const telaDif = $<HTMLCanvasElement>("tela-dif");
const LADO = 720;
for (const t of [telaNucleo, telaRef, telaDif]) t.width = t.height = LADO;

const erro = (e: unknown) => ($("erro").textContent = String((e as any)?.stack ?? e));
const arquivo = (p: string) => `/api/file?p=${encodeURIComponent(p)}`;
const pasta = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
const carregarImagem = (url: string) =>
  new Promise<HTMLImageElement>((ok, falha) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => falha(new Error(`imagem nao carregou: ${url}`));
    i.src = url;
  });

// ---- nucleo (wasm)

// gerado por emscripten (nucleo/build-web, fora do git); import pela URL para o tsc nao ler
const urlNucleo = new URL("../../nucleo/build-web/nucleo.mjs", import.meta.url).href;
const N: any = await (await import(/* @vite-ignore */ urlNucleo)).default();
const texto = (p: number) => N.UTF8ToString(p) as string;

// ---- desenho do nucleo: WebGL2 com stencil para o recorte

const gl = telaNucleo.getContext("webgl2", { stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: true })!;
const sombra = (tipo: number, src: string) => {
  const s = gl.createShader(tipo)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
};
const prog = gl.createProgram()!;
gl.attachShader(
  prog,
  sombra(
    gl.VERTEX_SHADER,
    `#version 300 es
in vec2 pos; in vec2 uv; in vec4 cor;
uniform vec4 cam; // centro x, y e escala x, y (mundo -> recorte)
out vec2 vuv; out vec4 vcor;
void main() { vuv = uv; vcor = cor; gl_Position = vec4((pos - cam.xy) * cam.zw, 0.0, 1.0); }`,
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
gl.useProgram(prog);
const uCam = gl.getUniformLocation(prog, "cam");
const uPma = gl.getUniformLocation(prog, "pma");
const uMotor = gl.getUniformLocation(prog, "motor");
const vbo = gl.createBuffer();
const ibo = gl.createBuffer();
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
for (const [nome, n, off] of [["pos", 2, 0], ["uv", 2, 8], ["cor", 4, 16]] as const) {
  const l = gl.getAttribLocation(prog, nome);
  gl.enableVertexAttribArray(l);
  gl.vertexAttribPointer(l, n, gl.FLOAT, false, 32, off);
}

// blend na ordem do enum Blend do nucleo: normal, aditivo, multiplica, multiplica do motor, tela
const BLENDS: [number, number][] = [
  [gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
  [gl.ONE, gl.ONE],
  [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA],
  [gl.DST_COLOR, gl.ZERO],
  [gl.ONE, gl.ONE_MINUS_SRC_COLOR],
];

type Pagina = { tex: WebGLTexture; pma: boolean };

function texturaNucleo(img: HTMLImageElement): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// ---- camera comum: o retangulo do esqueleto (com folga) cabe no quadrado

let cam = { x: 0, y: 0, escala: 1 };
function enquadrar(b: any) {
  const e = b.esqueleto ?? {};
  const w = e.largura || 400,
    h = e.altura || 400;
  cam = { x: (e.x ?? -w / 2) + w / 2, y: (e.y ?? 0) + h / 2, escala: (LADO * 0.9) / Math.max(w, h) };
}

function desenharNucleo(paginas: Pagina[]) {
  gl.viewport(0, 0, LADO, LADO);
  gl.clearColor(0.169, 0.145, 0.192, 1);
  gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  const nv = N._mm_num_vertices(),
    ni = N._mm_num_indices(),
    nl = N._mm_num_lotes();
  if (!nl) return { lotes: 0, chamadas: 0, vertices: 0 };
  const v = N.HEAPF32.subarray(N._mm_vertices() / 4, N._mm_vertices() / 4 + nv * 8);
  const ind = N.HEAPU32.subarray(N._mm_indices() / 4, N._mm_indices() / 4 + ni);
  const pl = N._mm_lotes() / 4;
  const lotes = N.HEAP32.subarray(pl, pl + nl * 5);
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, v, gl.STREAM_DRAW);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STREAM_DRAW);
  gl.uniform4f(uCam, cam.x, cam.y, (cam.escala * 2) / LADO, (cam.escala * 2) / LADO);
  gl.enable(gl.BLEND);
  gl.disable(gl.STENCIL_TEST);
  let chamadas = 0;
  for (let i = 0; i < nl; i++) {
    const [cmd, pag, blend, inicio, quantos] = lotes.subarray(i * 5, i * 5 + 5);
    if (cmd === 1) {
      // recorte: marca o poligono no stencil (leque com inversao serve para poligono concavo)
      gl.enable(gl.STENCIL_TEST);
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
    if (!p || !quantos) continue;
    gl.bindTexture(gl.TEXTURE_2D, p.tex);
    gl.uniform1i(uPma, p.pma ? 1 : 0);
    gl.uniform1i(uMotor, blend === 3 ? 1 : 0);
    const [s, d] = BLENDS[blend] ?? BLENDS[0];
    gl.blendFuncSeparate(s, d, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, quantos, gl.UNSIGNED_INT, inicio * 4);
    chamadas++;
  }
  gl.disable(gl.STENCIL_TEST);
  return { lotes: nl, chamadas, vertices: nv };
}

// ---- referencia: spine-core + spine-webgl

const ctxRef = new spine.ManagedWebGLRenderingContext(telaRef, { preserveDrawingBuffer: true, alpha: false });
const cena = new spine.SceneRenderer(telaRef, ctxRef, true);

type Ref = { sk: spine.Skeleton; st: spine.AnimationState };

function refPasso(r: Ref, dt: number) {
  r.st.update(dt);
  r.st.apply(r.sk);
  r.sk.update(dt);
  r.sk.updateWorldTransform(spine.Physics.update);
}

function desenharRef(r: Ref) {
  const c = cena.camera;
  c.position.x = cam.x;
  c.position.y = cam.y;
  c.setViewport(LADO, LADO);
  c.zoom = 1 / cam.escala;
  c.update();
  const g = ctxRef.gl;
  g.viewport(0, 0, LADO, LADO);
  g.clearColor(0.169, 0.145, 0.192, 1);
  g.clear(g.COLOR_BUFFER_BIT);
  cena.begin();
  cena.drawSkeleton(r.sk);
  cena.end();
}

// ---- estado

let modelo = -1;
let info: Info | null = null;
let paginas: Pagina[] = [];
let refData: spine.SkeletonData | null = null;
let refs: Ref[] = [];
let copias = 1;
let pausado = false;

async function abrir(asset: Asset) {
  $("erro").textContent = "";
  const b = await (await fetch(arquivo(asset.id))).json();
  const p = N.stringToNewUTF8(JSON.stringify(b));
  const m = N._mm_carregar(p);
  N._free(p);
  if (m < 0) throw new Error(`o nucleo nao leu ${asset.name}: ${texto(N._mm_erro())}`);
  modelo = m;
  info = JSON.parse(texto(N._mm_info(m))) as Info;
  enquadrar(b);
  const imgs = await Promise.all(info.paginas.map((pg) => carregarImagem(arquivo(pasta(asset.id) + pg.arquivo))));
  paginas = imgs.map((img, i) => ({ tex: texturaNucleo(img), pma: info!.paginas[i].pma }));
  // a mesma figura pela referencia: o .boneco exportado para o JSON do Spine e o atlas texto
  const e = exportarSpine(b);
  const atlas = new spine.TextureAtlas(e.atlas);
  for (const pg of atlas.pages) {
    const i = info.paginas.findIndex((x) => x.arquivo === pg.name);
    pg.setTexture(new spine.GLTexture(ctxRef, imgs[Math.max(0, i)], pg.pma));
  }
  refData = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(godotGravity(e.json));
  selAnim.innerHTML = `<option value="-1">(setup)</option>` + info.animacoes.map((a, i) => `<option value="${i}">${a.nome} (${a.duracao.toFixed(2)} s)</option>`).join("");
  const pedida = info.animacoes.findIndex((a) => a.nome === params.get("anim"));
  const comDuracao = info.animacoes.findIndex((a) => a.duracao > 0);
  if (info.animacoes.length) selAnim.value = String(pedida >= 0 ? pedida : Math.max(0, comDuracao));
  reiniciar();
}

function reiniciar() {
  if (modelo < 0 || !info || !refData) return;
  copias = Math.max(1, Math.min(200, Number(inCopias.value) || 1));
  const anim = Number(selAnim.value);
  N._mm_limpar_instancias();
  refs = [];
  for (let i = 0; i < copias; i++) {
    const k = N._mm_instancia(modelo);
    N._mm_tocar(k, anim, 1);
    const sk = new spine.Skeleton(refData);
    const st = new spine.AnimationState(new spine.AnimationStateData(refData));
    sk.setupPose();
    if (anim >= 0) st.setAnimation(0, info.animacoes[anim].nome, true);
    const r = { sk, st };
    refPasso(r, 0);
    refs.push(r);
  }
}

// ---- laco: o mesmo dt para os dois; medias a cada meio segundo

const soma = { nucleo: 0, desenho: 0, ref: 0, quadros: 0, desde: performance.now() };
let ultimo = performance.now();
const fmt = (ms: number) => (ms < 0.1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`);

let ultimaDif = "";
const ctxDif = telaDif.getContext("2d")!;
const tmpA = document.createElement("canvas"),
  tmpB = document.createElement("canvas");
tmpA.width = tmpA.height = tmpB.width = tmpB.height = LADO;

function diferenca() {
  const a = tmpA.getContext("2d", { willReadFrequently: true })!,
    b = tmpB.getContext("2d", { willReadFrequently: true })!;
  a.drawImage(telaNucleo, 0, 0);
  b.drawImage(telaRef, 0, 0);
  const da = a.getImageData(0, 0, LADO, LADO),
    db = b.getImageData(0, 0, LADO, LADO);
  const out = ctxDif.createImageData(LADO, LADO);
  let dif = 0,
    pior = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
    if (d > 8) dif++;
    pior = Math.max(pior, d);
    out.data[i] = out.data[i + 1] = out.data[i + 2] = Math.min(255, d * 4);
    out.data[i + 3] = 255;
  }
  ctxDif.putImageData(out, 0, 0);
  $("info-dif").textContent = ultimaDif = `${((100 * dif) / (LADO * LADO)).toFixed(2)}% dos pixels com diferença acima de 8/255; pior ${pior}`;
}

function quadro(agora: number) {
  const dt = pausado ? 0 : (Math.min(0.1, (agora - ultimo) / 1000) * Number(selVel.value));
  ultimo = agora;
  if (modelo >= 0 && refs.length) {
    let t0 = performance.now();
    if (dt > 0) for (let i = 0; i < copias; i++) N._mm_avancar(i, dt);
    let t1 = performance.now();
    N._mm_limpar_desenho();
    N._mm_desenhar(0);
    let t2 = performance.now();
    const est = desenharNucleo(paginas);
    soma.nucleo += t1 - t0;
    soma.desenho += t2 - t1;
    if (chkRef.checked) {
      t0 = performance.now();
      if (dt > 0) for (const r of refs) refPasso(r, dt);
      soma.ref += performance.now() - t0;
      desenharRef(refs[0]);
    }
    soma.quadros++;
    if (agora - soma.desde > 500) {
      const q = soma.quadros;
      const t = N._mm_tempo(0);
      $("info-nucleo").textContent = `pose de ${copias} ${copias > 1 ? "cópias" : "cópia"}: ${fmt(soma.nucleo / q)} · desenho: ${fmt(soma.desenho / q)} · ${est.vertices} vértices em ${est.chamadas} chamadas · t ${t.toFixed(2)} s`;
      $("info-ref").textContent = chkRef.checked ? `pose de ${copias} ${copias > 1 ? "cópias" : "cópia"}: ${fmt(soma.ref / q)}` : "";
      soma.nucleo = soma.desenho = soma.ref = soma.quadros = 0;
      soma.desde = agora;
    }
    if (chkDif.checked && chkRef.checked) diferenca();
  }
  requestAnimationFrame(quadro);
}

// ---- controles

const assets: Asset[] = (await (await fetch("/api/assets")).json()).filter((a: Asset) => a.formato === "boneco");
assets.sort((a, b) => (a.project + a.name).localeCompare(b.project + b.name));
selAsset.innerHTML = assets.map((a, i) => `<option value="${i}">${a.project} / ${a.name}</option>`).join("");
// ?boneco=nome&anim=nome&dif=1: abre direto (a conferencia automatica usa)
const params = new URLSearchParams(location.search);
const pedido = params.get("boneco");
if (params.get("dif")) {
  chkDif.checked = true;
  $("diferenca-fig").hidden = false;
  setInterval(() => console.log(`dif ${pedido}: ${ultimaDif}`), 1000);
}
const inicial = Math.max(0, assets.findIndex((a) => a.name === pedido));
selAsset.value = String(inicial);
selAsset.onchange = () => abrir(assets[Number(selAsset.value)]).catch(erro);
selAnim.onchange = reiniciar;
inCopias.onchange = reiniciar;
$("reinicia").onclick = reiniciar;
$("pausa").onclick = () => {
  pausado = !pausado;
  $("pausa").textContent = pausado ? "tocar" : "pausar";
};
chkRef.onchange = () => ($("ref-fig").hidden = !chkRef.checked);
chkDif.onchange = () => ($("diferenca-fig").hidden = !chkDif.checked);
if (assets.length) await abrir(assets[inicial]).catch(erro);
else erro("nenhum .boneco nas raizes do editor (MAMULENGO_ROOTS)");
requestAnimationFrame(quadro);
