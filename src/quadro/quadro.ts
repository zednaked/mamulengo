// Quadros de um .boneco pelo nucleo (wasm) e o desenhista WebGL do editor, sem a interface:
// tools/quadro.ts abre esta pagina num Chromium headless e chama window.quadro. O tempo anda do
// zero em passos de 1/fps ate cada instante pedido (fisica, particulas e instancias como no
// export), e cada quadro sai em PNG; os modos cinza e silhueta servem a conferencia do desenho
// (docs/DESENHAR.md).
import { Desenhista, carregarNucleo, ortho, type PaginaGL } from "../render/nucleo.ts";
import { diretorio, normalizarCaminho } from "../render/nucleo.ts";
import { projecaoDaVista, vistaDaCamera } from "../core/camera.ts";
import { DesenhoVideo, VideoReferencia, desenharRefVideo, type RefVideo } from "../render/videoref.ts";

const arquivo = (p: string) => `/api/file?p=${encodeURIComponent(p)}`;
const N: any = await carregarNucleo();
const texto = (p: number) => N.UTF8ToString(p) as string;
const tela = document.createElement("canvas");
document.body.append(tela);
const gl = tela.getContext("webgl2", { stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true })!;
const desenhista = new Desenhista(gl);

type Info = { paginas: { arquivo: string; pma: boolean; relevo?: string }[]; animacoes: { nome: string; duracao: number }[]; slots: unknown[] };
let modelo = -1;
let info: Info | null = null;
let paginas: PaginaGL[] = [];
let esqueleto: any = {};

async function bitmap(p: string) {
  const r = await fetch(arquivo(p));
  if (!r.ok) throw new Error(`nao abriu ${p}`);
  return createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

// abre o .boneco (caminho absoluto) com os filhos das instancias
async function abrir(caminho: string) {
  const c0 = normalizarCaminho(caminho);
  const t0 = await (await fetch(arquivo(c0))).text();
  const b = JSON.parse(t0);
  esqueleto = b.esqueleto ?? {};
  N._mm_limpar_arquivos();
  const fila = (b.instancias ?? []).map((i: any) => normalizarCaminho(diretorio(c0) + i.boneco));
  const vistos = new Set<string>();
  while (fila.length) {
    const c = fila.shift()!;
    if (vistos.has(c)) continue;
    vistos.add(c);
    const t = await (await fetch(arquivo(c))).text();
    const pc = N.stringToNewUTF8(c),
      pt = N.stringToNewUTF8(t);
    N._mm_arquivo(pc, pt);
    N._free(pc);
    N._free(pt);
    for (const i of JSON.parse(t).instancias ?? []) fila.push(normalizarCaminho(diretorio(c) + i.boneco));
  }
  const p = N.stringToNewUTF8(t0),
    pc = N.stringToNewUTF8(c0);
  const m = N._mm_carregar_de(p, pc);
  N._free(p);
  N._free(pc);
  if (m < 0) throw new Error(texto(N._mm_erro()));
  modelo = m;
  info = JSON.parse(texto(N._mm_info(m))) as Info;
  // as paginas (as dos filhos inclusive) sao relativas a este arquivo
  const tex = new Map<string, WebGLTexture>();
  for (const pg of info.paginas)
    for (const a of [pg.arquivo, pg.relevo].filter(Boolean) as string[])
      if (!tex.has(a)) {
        try {
          tex.set(a, desenhista.textura(await bitmap(diretorio(c0) + a)));
        } catch {}
      }
  paginas = info.paginas.map((pg) => ({ tex: tex.get(pg.arquivo) as WebGLTexture, pma: pg.pma, relevo: pg.relevo ? (tex.get(pg.relevo) ?? null) : null }));
  return { esqueleto, animacoes: info.animacoes, faltam: info.paginas.map((x) => x.arquivo).filter((a) => !tex.has(a)) };
}

// video de referencia atras do personagem (N-023): o quadro do instante t do filme
let ref: (RefVideo & { cebola: number }) | null = null;
let desenhoVideo: DesenhoVideo | null = null;
async function referencia(caminho: string, o: { x?: number; y?: number; largura?: number; opacidade?: number; inicio?: number; velocidade?: number; cebola?: number }) {
  ref?.video.fechar();
  const v = await VideoReferencia.abrir(arquivo(normalizarCaminho(caminho)));
  const e = esqueleto;
  // sem posicao: no meio do esqueleto, na altura dele
  const alt = e.altura ?? 800;
  const largura = Number.isFinite(o.largura) ? o.largura! : (alt * v.largura) / v.altura;
  ref = {
    video: v,
    x: Number.isFinite(o.x) ? o.x! : (e.x ?? -(e.largura ?? 800) / 2) + (e.largura ?? 800) / 2,
    y: Number.isFinite(o.y) ? o.y! : (e.y ?? 0) + alt / 2,
    largura,
    opacidade: o.opacidade ?? 0.5,
    inicio: o.inicio ?? 0,
    velocidade: o.velocidade ?? 1,
    repetir: true,
    cebola: o.cebola ?? 0,
  };
  return v.medida;
}

type Pedido = { anim: string | null; tempos: number[]; rect?: [number, number, number, number]; largura?: number; fps?: number; fundo?: string | null; modo?: "normal" | "cinza" | "silhueta"; repetir?: boolean; camera?: boolean; formato?: "png" | "jpeg" };

// o filme continua de onde parou (quadros pedidos em lotes, em ordem): a instancia e o tempo
let corrente: { chave: string; inst: number; agora: number } | null = null;

// os quadros pedidos, em PNG (data URL), na ordem dos tempos
function fotos(p: Pedido): string[] {
  if (modelo < 0 || !info) throw new Error("abra um .boneco antes");
  const e = esqueleto;
  // a camera do filme (skeleton.camera): o quadro e o tamanho do esqueleto, seguindo o osso
  let ossoCam = -1;
  if (p.camera !== false && e.camera) {
    const nc = N.stringToNewUTF8(e.camera);
    ossoCam = N._mm_osso(modelo, nc);
    N._free(nc);
  }
  if (p.camera && e.camera && ossoCam < 0) throw new Error(`a camera ${e.camera} nao e um osso`);
  const rect = p.rect ?? [e.x ?? -(e.largura ?? 800) / 2, e.y ?? 0, e.largura ?? 800, e.altura ?? 800];
  const comCamera = ossoCam >= 0 && !p.rect;
  const w = Math.round(p.largura ?? Math.min(1280, rect[2])),
    h = Math.round(comCamera ? (w * (e.altura ?? 800)) / (e.largura ?? 800) : (w * rect[3]) / rect[2]);
  tela.width = w;
  tela.height = h;
  const escala = w / rect[2];
  const fixa = ortho(rect[0] + rect[2] / 2, rect[1] + rect[3] / 2, escala, w, h);
  const anim = p.anim ? info.animacoes.findIndex((a) => a.nome === p.anim) : -1;
  if (p.anim && anim < 0) throw new Error(`animacao desconhecida: ${p.anim}. Ha: ${info.animacoes.map((a) => a.nome).join(", ")}`);
  // o mesmo pedido em lotes seguidos continua a simulacao (o video inteiro em partes)
  const chave = JSON.stringify([p.anim, p.repetir, p.fps]);
  const continua = corrente && corrente.chave === chave && p.tempos.length && Math.min(...p.tempos) >= corrente.agora - 1e-9;
  if (!continua) {
    N._mm_limpar_instancias();
    const i0 = N._mm_instancia(modelo);
    N._mm_tocar(i0, anim, p.repetir ? 1 : 0);
    corrente = { chave, inst: i0, agora: 0 };
  }
  const inst = corrente!.inst;
  const passo = 1 / (p.fps ?? 30);
  let agora = corrente!.agora;
  const ordem = p.tempos.map((t, i) => [t, i] as const).sort((a, b) => a[0] - b[0]);
  const out: string[] = new Array(p.tempos.length);
  const cor = p.fundo ? [parseInt(p.fundo.slice(0, 2), 16) / 255, parseInt(p.fundo.slice(2, 4), 16) / 255, parseInt(p.fundo.slice(4, 6), 16) / 255] : null;
  for (const [t, i] of ordem) {
    while (agora + passo <= t + 1e-9) {
      N._mm_avancar(inst, passo);
      agora += passo;
    }
    if (t - agora > 1e-9) {
      N._mm_avancar(inst, t - agora);
      agora = t;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(cor ? cor[0] : 0, cor ? cor[1] : 0, cor ? cor[2] : 0, cor ? 1 : 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    let proj = fixa;
    if (comCamera) {
      const o = N._mm_pose_ossos(inst) / 8 + ossoCam * 14;
      proj = projecaoDaVista(vistaDaCamera(N.HEAPF64.subarray(o, o + 6), e.largura ?? 800, e.altura ?? 800), e.largura ?? 800, w, h);
    }
    if (ref) {
      desenhoVideo ??= new DesenhoVideo(gl);
      desenharRefVideo(desenhoVideo, ref, t, proj, ref.cebola);
    }
    N._mm_limpar_desenho();
    N._mm_desenhar(inst);
    desenhista.desenhar(N, paginas, proj);
    out[i] = pos(p.modo ?? "normal", w, h, p.formato);
  }
  corrente!.agora = agora;
  return out;
}

// pos-processo da conferencia: cinza (luminancia) ou silhueta (o que tem tinta, em preto)
function pos(modo: string, w: number, h: number, formato?: string): string {
  if (modo === "normal") return formato === "jpeg" ? tela.toDataURL("image/jpeg", 0.95) : tela.toDataURL("image/png");
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(tela, 0, 0);
  const d = x.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    if (modo === "silhueta") {
      const a = d.data[i + 3];
      d.data[i] = d.data[i + 1] = d.data[i + 2] = a > 24 ? 0 : 255;
      d.data[i + 3] = 255;
    } else {
      const y = 0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2];
      d.data[i] = d.data[i + 1] = d.data[i + 2] = y;
    }
  }
  x.putImageData(d, 0, 0);
  return c.toDataURL("image/png");
}

(window as any).quadro = { abrir, fotos, referencia };
document.body.dataset.pronto = "1";
