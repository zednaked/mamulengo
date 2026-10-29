// Palco do nucleo: toca um .boneco pelo nucleo novo (nucleo/, em wasm) com o desenho WebGL
// daqui, ao lado da referencia de hoje (spine-core + spine-webgl), no mesmo passo de tempo.
// Mostra o custo de cada um e, se pedido, a diferenca pixel a pixel.
//
//   npm run dev, depois http://localhost:5199/palco.html (os .boneco das raizes do editor)
import * as spine from "@esotericsoftware/spine-webgl";
import { exportarSpine } from "../boneco/spine.ts";
import { godotGravity } from "../core/pose.ts";
import { Desenhista, carregarNucleo, ortho, type PaginaGL } from "../render/nucleo.ts";

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

const N: any = await carregarNucleo();
const texto = (p: number) => N.UTF8ToString(p) as string;

// ---- desenho do nucleo: o desenhista do editor (src/render/nucleo.ts), WebGL2 com stencil

const gl = telaNucleo.getContext("webgl2", { stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: true })!;
const desenhista = new Desenhista(gl);

type Pagina = PaginaGL;

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
  return desenhista.desenhar(N, paginas, ortho(cam.x, cam.y, cam.escala, LADO, LADO));
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
  paginas = imgs.map((img, i) => ({ tex: desenhista.textura(img), pma: info!.paginas[i].pma }));
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
