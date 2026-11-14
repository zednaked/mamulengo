// A pintura (raster) do Atelie: a conversa com o pintor (server/pintor.ts, o renderer do ProCraft
// num processo ao lado, que recebe as amostras da caneta e devolve o retangulo que mudou) e a
// pincelada em andamento. Os pixels e o desfazer ficam em src/app/pinturas.ts.
import { app } from "./state.svelte.ts";
import { drawingsOf, type Drawing } from "../core/desenho.ts";
import { NAVEGADOR } from "../navegador/pagina.ts";
import { FOLHA_MAX, contornoDaSelecao, crescimento, deslocarSelecao, selecao } from "./retoque.ts";

// ---- a conversa com o pintor

type Resposta = [any, Uint8Array];

class Cliente {
  private ws: WebSocket | null = null;
  private abrindo: Promise<WebSocket> | null = null;
  private espera = new Map<number, { ok: (r: Resposta) => void; erro: (e: Error) => void }>();
  private n = 0;

  private conectar(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    return (this.abrindo ??= new Promise<WebSocket>((ok, erro) => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__pintor`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => ((this.ws = ws), (this.abrindo = null), ok(ws));
      ws.onerror = () => ((this.abrindo = null), erro(new Error("sem conexão com o pintor")));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        for (const e of this.espera.values()) e.erro(new Error("a conexão com o pintor caiu"));
        this.espera.clear();
        folha = null;
      };
      ws.onmessage = (ev) => {
        const b = new Uint8Array(ev.data as ArrayBuffer);
        const nj = new DataView(b.buffer).getUint32(0, true);
        const j = JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + nj)));
        const e = this.espera.get(j.id);
        this.espera.delete(j.id);
        if (!e) return;
        if (j.erro) e.erro(new Error(j.erro));
        else e.ok([j, b.subarray(4 + nj)]);
      };
    }));
  }

  async pede(m: any, bin?: Uint8Array | Uint8ClampedArray): Promise<Resposta> {
    const ws = await this.conectar();
    const id = ++this.n;
    const t = new TextEncoder().encode(JSON.stringify({ ...m, id }));
    const msg = new Uint8Array(4 + t.length + (bin?.length ?? 0));
    new DataView(msg.buffer).setUint32(0, t.length, true);
    msg.set(t, 4);
    if (bin) msg.set(bin, 4 + t.length);
    return new Promise((ok, erro) => {
      this.espera.set(id, { ok, erro });
      ws.send(msg);
    });
  }
}

const cliente = new Cliente();

// a folha aberta no pintor: de qual imagem e em que estado dos pixels. A folha do pintor tem `pad`
// pixels de margem em volta da imagem: a pincelada pode passar da borda, e ao terminar a imagem cresce
// ate o que foi pintado (a margem diz o quanto cabe de uma vez)
let folha: { image: string; rev: string | null; w: number; h: number; pad: number } | null = null;
// o laco que o pintor conhece (a pintura so entra dentro dele)
let selMandada = "";
// os pedidos vao um depois do outro (abrir, ajustar, pincelada)
let cadeia: Promise<unknown> = Promise.resolve();
const naFila = <T>(f: () => Promise<T>): Promise<T> => {
  const p = cadeia.then(f, f);
  cadeia = p.catch(() => {});
  return p;
};

export type Ferramenta = "pintar" | "apagar" | "borrar";
const cor = (c: string): [number, number, number] => [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255];

// o que o pintor ja sabe (para mandar so o que mudou)
let mandado = "";
async function ajustar(f: Ferramenta) {
  const p = app.pincel;
  const escolha = p.escolha[f];
  const agora = JSON.stringify([f, escolha, p.tamanho[f], p.opacidade[f], f === "pintar" ? app.lapis.color : ""]);
  if (agora === mandado) return;
  await cliente.pede({ op: "ajuste", ferramenta: f });
  if (escolha) {
    const at = indiceDe(escolha);
    if (at) await cliente.pede({ op: "pincel", set: at[0], i: at[1] }).catch(() => {});
  }
  await cliente.pede({ op: "ajuste", tamanho: p.tamanho[f], opacidade: p.opacidade[f], ...(f === "pintar" ? { cor: cor(app.lapis.color) } : {}) });
  mandado = agora;
}

// [conjunto, pincel] pelos nomes (a biblioteca pode ter mudado de ordem desde a escolha)
function indiceDe(e: [string, string]): [number, number] | null {
  const cs = app.pincel.conjuntos;
  const s = cs.findIndex((c) => c.nome === e[0] && c.pinceis.includes(e[1]));
  return s < 0 ? null : [s, cs[s].pinceis.indexOf(e[1])];
}

// liga o pintor (na primeira vez ele le a biblioteca de pinceis, o que demora) e traz a lista
export function ligarPintor(): Promise<boolean> {
  const p = app.pincel;
  if (p.estado === "pronto") return Promise.resolve(true);
  return (ligando ??= (async () => {
    // no editor pelo navegador nao ha processo ao lado
    if (NAVEGADOR) {
      p.estado = "falta";
      return false;
    }
    try {
      p.estado = "ligando";
      const [e] = await cliente.pede({ op: "estado" });
      if (!e.disponivel) {
        p.estado = "falta";
        return false;
      }
      p.daBiblioteca = !!e.biblioteca;
      await naFila(async () => {
        await cliente.pede({ op: "abrir", w: 8, h: 8 });
        folha = null;
        mandado = "";
        const [l] = await cliente.pede({ op: "pinceis" });
        p.conjuntos = l.conjuntos;
      });
      // escolhas guardadas que nao existem mais saem; sem escolha de pintar, o primeiro pincel
      for (const f of ["pintar", "apagar", "borrar"] as Ferramenta[]) if (p.escolha[f] && !indiceDe(p.escolha[f]!)) p.escolha[f] = null;
      if (!p.escolha.pintar && p.conjuntos[0]?.pinceis[0]) p.escolha.pintar = [p.conjuntos[0].nome, p.conjuntos[0].pinceis[0]];
      p.estado = "pronto";
      return true;
    } catch (err: any) {
      p.estado = "erro";
      p.erro = String(err?.message ?? err);
      return false;
    } finally {
      ligando = null;
    }
  })());
}
let ligando: Promise<boolean> | null = null;

// a amostra de um pincel (um traco de exemplo), como imagem
const previas = new Map<string, Promise<string | null>>();
export function previaDoPincel(conjunto: string, pincel: string, w = 220, h = 56): Promise<string | null> {
  const k = `${conjunto}\n${pincel}`;
  let p = previas.get(k);
  if (!p) {
    p = naFila(async () => {
      const at = indiceDe([conjunto, pincel]);
      if (!at) return null;
      const [j, b] = await cliente.pede({ op: "previa", set: at[0], i: at[1], w, h });
      const c = new OffscreenCanvas(j.w, j.h);
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(b.buffer, b.byteOffset, b.length).slice(), j.w, j.h), 0, 0);
      return URL.createObjectURL(await c.convertToBlob({ type: "image/png" }));
    }).catch(() => null);
    previas.set(k, p);
  }
  return p;
}

// abre no pintor a folha da imagem, com os pixels de agora (se ja nao e ela)
async function garantirFolha(image: string, d: Drawing) {
  const t = app.pinturas.de(image, d);
  if (folha && folha.image === image && folha.rev === t.rev && folha.w === t.w && folha.h === t.h) return;
  // o pintor so devolve a imagem ate FOLHA_MAX de lado (o ProCraft le no maximo 2048): a margem
  // encolhe quando a imagem cresce
  const pad = Math.max(0, Math.min(MARGEM, Math.floor((FOLHA_MAX - Math.max(t.w, t.h)) / 2)));
  const W = t.w + pad * 2,
    H = t.h + pad * 2;
  let px: Uint8ClampedArray | undefined;
  if (t.rev !== null) {
    const g = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true })!;
    g.drawImage(t.canvas, pad, pad);
    px = g.getImageData(0, 0, W, H).data;
  }
  await cliente.pede({ op: "abrir", w: W, h: H }, px);
  folha = { image, rev: t.rev, w: t.w, h: t.h, pad };
  mandado = "";
  selMandada = "";
}
const MARGEM = 512;

// o laco desta imagem vai ao pintor (ou sai dele), se mudou
async function mandarSelecao(image: string) {
  const pad = folha?.pad ?? 0;
  const pts = selecao()?.image === image ? contornoDaSelecao() : null;
  const k = pts ? JSON.stringify(pts) : "";
  if (k === selMandada) return;
  await cliente.pede({ op: "selecao", pontos: pts ? pts.map((p) => [p[0] + pad, p[1] + pad]) : null });
  selMandada = k;
}
// as amostras em pixels da folha do pintor (com a margem)
const naFolha = (a: AmostraPincel[]): AmostraPincel[] => {
  const pad = folha?.pad ?? 0;
  return pad ? a.map((x) => [x[0] + pad, x[1] + pad, x[2], x[3], x[4], x[5]]) : a;
};

// a folha do quadro a mostra aberta de antemao, para a primeira pincelada nao esperar
export function prepararFolha(image: string) {
  if (app.pincel.estado !== "pronto" || viva) return;
  const d = app.doc && drawingsOf(app.doc.json)[image];
  if (!d) return;
  void naFila(() => garantirFolha(image, d)).catch(() => {});
}

// ---- a pincelada

export type AmostraPincel = [x: number, y: number, pressao: number, ms: number, inclinacao: number, direcao: number];

interface Viva {
  image: string;
  ferramenta: Ferramenta;
  antes: ImageData | null;
  // o que mudou, na imagem (cortado nela) e na folha do pintor (inteiro, com a margem)
  ret: [number, number, number, number] | null;
  retFolha: [number, number, number, number] | null;
  pad: number;
  // amostras ainda nao mandadas (um pedido por vez: as que chegam enquanto isso vao juntas)
  espera: AmostraPincel[];
  mandando: boolean;
  fim: boolean;
  falhou: boolean;
}
let viva: Viva | null = null;

export const pincelando = () => viva !== null;

const une = (a: [number, number, number, number] | null, b: [number, number, number, number]): [number, number, number, number] => {
  if (!a) return b;
  const x0 = Math.min(a[0], b[0]),
    y0 = Math.min(a[1], b[1]);
  return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
};

// quantos remendos ja chegaram (quem guarda imagem pronta de um quadro confere)
let nRemendos = 0;
export const remendos = () => nRemendos;
// (o balde e o laco mexem nos pixels sem o pintor: src/app/retoque.ts)
export const remendou = () => void nRemendos++;

function chegou(v: Viva, j: any, b: Uint8Array) {
  const doc = app.doc;
  const d = doc && drawingsOf(doc.json)[v.image];
  if (!d || !j.ret) return;
  v.retFolha = une(v.retFolha, j.ret);
  // na imagem: o retangulo menos a margem, cortado na borda
  const [fx, fy, fw, fh] = j.ret as [number, number, number, number];
  const P = v.pad;
  const t = app.pinturas.de(v.image, d);
  const x0 = Math.max(0, fx - P),
    y0 = Math.max(0, fy - P),
    x1 = Math.min(t.w, fx - P + fw),
    y1 = Math.min(t.h, fy - P + fh);
  if (x1 <= x0 || y1 <= y0) return;
  let px = b;
  if (x0 !== fx - P || y0 !== fy - P || x1 - x0 !== fw || y1 - y0 !== fh) {
    px = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
    for (let y = y0; y < y1; y++) {
      const de = ((y - (fy - P)) * fw + (x0 - (fx - P))) * 4;
      px.set(b.subarray(de, de + (x1 - x0) * 4), (y - y0) * (x1 - x0) * 4);
    }
  }
  const ret: [number, number, number, number] = [x0, y0, x1 - x0, y1 - y0];
  app.pinturas.remendo(v.image, d, ret, px);
  v.ret = une(v.ret, ret);
  nRemendos++;
  app.desenhos.pintar(doc!, app.viewer, v.image, ret);
}

function bombear(v: Viva) {
  if (v.mandando || v.falhou) return;
  if (!v.espera.length && !v.fim) return;
  v.mandando = true;
  const lote = v.espera.splice(0);
  const ultimo = v.fim;
  void naFila(async () => {
    const [j, b] = await cliente.pede({ op: ultimo ? "termina" : "segue", amostras: naFolha(lote) });
    chegou(v, j, b);
  })
    .catch((e) => falhar(v, e))
    .finally(() => {
      v.mandando = false;
      if (ultimo) return fechar(v);
      bombear(v);
    });
}

function falhar(v: Viva, e: any) {
  if (v.falhou) return;
  v.falhou = true;
  folha = null;
  app.toast(`A pincelada não saiu: ${e?.message ?? e}`);
  if (viva === v) viva = null;
}

// o fim: os pixels ja estao na tela; o documento ganha o rev novo (um passo de desfazer). Se a
// pincelada passou da borda, a imagem cresce ate ela, no mesmo passo
function fechar(v: Viva) {
  if (viva === v) viva = null;
  const doc = app.doc;
  const d = doc && drawingsOf(doc.json)[v.image];
  if (!d || !v.antes || v.falhou) return;
  const rf = v.retFolha;
  const P = v.pad;
  const cresce = rf && P ? crescimento(d.width, d.height, [rf[0] - P, rf[1] - P, rf[0] - P + rf[2], rf[1] - P + rf[3]], 16) : null;
  if (cresce && rf) return void crescerComPincelada(v, d, cresce.map((x) => Math.min(P, x)) as [number, number, number, number], rf);
  if (!v.ret) return;
  const rev = app.pinturas.registrar(v.image, d, v.antes, v.ret);
  if (folha?.image === v.image) folha.rev = rev;
  const nome = v.ferramenta === "apagar" ? "apaga a tinta" : v.ferramenta === "borrar" ? "borra" : "pincelada";
  app.run({ cmd: "paint.set", args: { image: v.image, rev } }, nome);
}

// a pincelada passou da borda: a imagem cresce (os pixels de antes andam junto) e recebe o que o
// pintor tem na margem
function crescerComPincelada(v: Viva, d: Drawing, [l, tp, r, b]: [number, number, number, number], rf: [number, number, number, number]) {
  const P = v.pad;
  void naFila(async () => {
    const [j, px] = await cliente.pede({ op: "ler" });
    const t = app.pinturas.de(v.image, d);
    t.g.putImageData(v.antes!, 0, 0);
    const revCresce = app.pinturas.crescer(v.image, d, l, tp, r, b);
    deslocarSelecao(v.image, l, tp);
    const antesGrande = t.g.getImageData(0, 0, t.w, t.h);
    // a folha do pintor (com a margem) recortada no tamanho novo
    const g = new OffscreenCanvas(j.w, j.h).getContext("2d", { willReadFrequently: true })!;
    g.putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.length).slice(), j.w, j.h), 0, 0);
    t.g.clearRect(0, 0, t.w, t.h);
    t.g.drawImage(g.canvas, -(P - l), -(P - tp));
    const x0 = Math.max(0, rf[0] - P + l),
      y0 = Math.max(0, rf[1] - P + tp);
    const ret: [number, number, number, number] = [x0, y0, Math.min(t.w, rf[0] - P + l + rf[2]) - x0, Math.min(t.h, rf[1] - P + tp + rf[3]) - y0];
    const rev = app.pinturas.registrar(v.image, { width: t.w, height: t.h } as Drawing, antesGrande, ret);
    // a folha do pintor e de outro tamanho agora: reabre na proxima pincelada
    folha = null;
    const nome = v.ferramenta === "apagar" ? "apaga a tinta" : v.ferramenta === "borrar" ? "borra" : "pincelada";
    app.run(
      [
        { cmd: "paint.grow", args: { image: v.image, left: l, top: tp, right: r, bottom: b, rev: revCresce } },
        { cmd: "paint.set", args: { image: v.image, rev } },
      ],
      `${nome} (a folha cresce)`,
    );
    nRemendos++;
    if (app.doc) app.desenhos.pintar(app.doc, app.viewer, v.image);
  }).catch((e) => app.toast(`A pincelada passou da borda e a folha não cresceu: ${e?.message ?? e}`));
}

export function pinceladaComeca(image: string, ferramenta: Ferramenta, ponteiro: "caneta" | "borracha" | "mouse" | "dedo", primeira: AmostraPincel[]) {
  const doc = app.doc;
  const d = doc && drawingsOf(doc.json)[image];
  if (!d || viva) return false;
  if (app.pincel.estado !== "pronto") {
    void ligarPintor();
    app.toast(app.pincel.estado === "falta" ? "A pintura precisa do pintor (tools/pintor.sh), que não está nesta máquina. O lápis vetorial (L) funciona sem ele." : "Os pincéis ainda estão carregando (só na primeira vez). Tente de novo em alguns segundos.");
    return false;
  }
  const v: Viva = { image, ferramenta, antes: null, ret: null, retFolha: null, pad: 0, espera: [], mandando: true, fim: false, falhou: false };
  viva = v;
  void naFila(async () => {
    await garantirFolha(image, d);
    await ajustar(ferramenta);
    await mandarSelecao(image);
    v.pad = folha?.pad ?? 0;
    v.antes = app.pinturas.copia(image, d);
    const [j, b] = await cliente.pede({ op: "comeca", ponteiro, amostras: naFolha(primeira) });
    chegou(v, j, b);
  })
    .catch((e) => falhar(v, e))
    .finally(() => {
      v.mandando = false;
      bombear(v);
    });
  return true;
}

export function pinceladaSegue(amostras: AmostraPincel[]) {
  if (!viva || !amostras.length) return;
  viva.espera.push(...amostras);
  bombear(viva);
}

export function pinceladaTermina() {
  if (!viva) return;
  viva.fim = true;
  bombear(viva);
}
