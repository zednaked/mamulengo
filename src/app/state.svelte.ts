// Estado do app (Svelte 5 runes). Um unico documento aberto por vez.
import type { MosaicEdit } from "./mosaicedit.ts";
import { slotWorldBox } from "./interact.ts";
import { Document, type ChangeEvent } from "../core/document.ts";
import { execute, executeAsync, type AssetProvider, type Call } from "../core/commands/index.ts";
import { parseAtlas } from "../core/atlas-text.ts";
import { dropDraft, getDraft, putDraft, type Draft } from "./drafts.ts";
import type { Runtime, Viewer } from "../render/viewer.ts";
import type { Op } from "../core/ops.ts";
import { draftFicha, fichaPath } from "../core/ficha.ts";
import { NAVEGADOR } from "../navegador/pagina.ts";
import { contextoDoJogo } from "../navegador/godot.ts";
import { drawingsOf } from "../core/desenho.ts";
import { Desenhos, drawingPixels } from "./desenho.ts";
import { VideoReferencia } from "../render/videoref.ts";

export interface AssetInfo {
  id: string;
  name: string;
  project: string;
  res: string;
  skeleton: string;
  atlas: string;
  tres: string;
  defaultMix: number;
  // o .tres aponta para arquivos que nao existem
  broken?: string;
  mixes?: { from: string; to: string; mix: number }[];
}

export interface SeqInfo {
  next: string;
  mix: number;
  at: number | null;
  loop: boolean;
  start: number;
  end: number;
  total: number;
  durA: number;
}

export interface Activity {
  id: number;
  at: number;
  label: string;
  source: string;
  kind: "do" | "undo" | "redo" | "error" | "info";
  ops: number;
}

export interface MeshEdit {
  slot: string;
  attachment: string;
  skin: string;
  tab: "points" | "weights";
  // vertice escolhido (aba pontos)
  vertex: number | null;
  // osso sendo pintado (aba pesos)
  bone: string | null;
  paint: "add" | "sub";
  // forca do pincel de pesos, 0..1
  strength: number;
  // mover ponto estica a imagem junto (senao anda sobre ela)
  stretch: boolean;
}

// o ambiente Desenhar (src/app/drawedit.ts): a imagem desenhada em edicao, na Pose base
export interface DrawEdit {
  image: string;
  slot: string;
  skin: string;
  attachment: string;
  tool: "select" | "pen" | "rect" | "ellipse";
  // forma e ponto escolhidos (indices em drawings.<image>.shapes); contour: de qual contorno e o
  // ponto (0 = o principal, 1.. = os furos)
  shape: number | null;
  point: number | null;
  contour: number;
  // contorno aberto sendo feito com a caneta (o proximo clique acrescenta um ponto no fim)
  pen: number | null;
  penContour: number;
  // modo furo: caneta, retangulo e elipse furam a forma escolhida
  hole: boolean;
}

export const fileUrl =(p: string) => `/api/file?p=${encodeURIComponent(p)}`;

const RUNTIMES: Runtime[] = ["godot", "spine", "nucleo"];
const ehRuntime = (r: string | null): r is Runtime => RUNTIMES.includes(r as Runtime);

// ?runtime= no endereco vale para tudo o que abrir
function runtimeDoEndereco(): Runtime | null {
  try {
    const q = new URLSearchParams(location.search).get("runtime");
    if (ehRuntime(q)) return q;
  } catch {}
  return null;
}

// modo de desenho de um personagem: o do endereco, o escolhido antes no projeto dele (guardado
// no navegador) ou o nucleo, para qualquer formato (os modos godot e spine, que usam o
// spine-core, ficam para comparar com o jogo antigo e com o editor do Spine)
export function runtimeDe(asset: AssetInfo): Runtime {
  const q = runtimeDoEndereco();
  if (q) return q;
  try {
    const s = localStorage.getItem(`mamulengo.runtime.${asset.project}`);
    if (ehRuntime(s)) return s;
  } catch {}
  return "nucleo";
}

class AppState {
  assets = $state<AssetInfo[]>([]);
  // as pastas onde o editor procura personagens (MAMULENGO_ROOTS) e se a lista ja chegou
  roots = $state<string[]>([]);
  assetsLidos = $state(false);
  asset = $state<AssetInfo | null>(null);
  doc = $state.raw<Document | null>(null);
  // incrementa a cada mudanca do documento: componentes derivam dele
  version = $state(0);
  viewer = $state.raw<Viewer | null>(null);
  selection = $state<{ bone?: string; slot?: string }>({});
  activity = $state<Activity[]>([]);
  // espelho do estado de reproducao do viewer, atualizado por frame
  // seq: previa de transicao (onde o mix comeca e termina), ou null
  play = $state({ animation: null as string | null, time: 0, duration: 0, playing: true, loop: true, speed: 1, seq: null as SeqInfo | null });
  loading = $state(false);
  // rascunho encontrado ao abrir (alteracoes nao salvas de antes)
  draft = $state<(Draft & { id: string }) | null>(null);
  private fileText = "";
  private draftTimer = 0;
  error = $state<string | null>(null);
  agentConnected = $state(false);
  // "setup" mexe na pose de montagem; "animate" grava chaves no tempo atual
  // Nao ha mais botao de modo: a "Pose base" e uma aba na lista de animacoes. Sem
  // animacao aberta, mexer muda a pose base (todas as animacoes); com uma, vira chave.
  // Pedir "setup" leva para a Pose base; pedir "animate" volta para a ultima animacao.
  private lastAnim: string | null = null;
  get mode(): "setup" | "animate" {
    return this.play.animation ? "animate" : "setup";
  }
  set mode(m: "setup" | "animate") {
    const v = this.viewer;
    if (!v) return;
    if (m === "setup") {
      if (v.view.animation) this.lastAnim = v.view.animation;
      v.setAnimation(null);
      this.play.animation = null;
    } else if (!v.view.animation) {
      const names = Object.keys(this.doc?.json.animations ?? {});
      const a = this.lastAnim && names.includes(this.lastAnim) ? this.lastAnim : (names[0] ?? null);
      if (a) {
        v.setAnimation(a);
        this.play.animation = a;
      }
    }
  }
  tool = $state<"move" | "rotate" | "scale" | "deform" | "bone" | "pan">("rotate");
  // raio do pincel de deform, em pixels de tela
  brushRadius = $state(60);
  // a imagem sob o pincel ainda nao e malha: oferecer converter
  offerMesh = $state<{ slot: string; attachment: string } | null>(null);
  onion = $state(false);
  // imagem de referencia por cima do viewport, presa ao mundo (centro x, y e largura em
  // unidades do mundo), semitransparente: para conferir pose, proporcao e encaixe. Com `video`
  // (N-023, spike: .mp4), o clipe e desenhado atras do personagem pelo viewer, no quadro exato do
  // instante da timeline (inicio + velocidade x t, repetindo), com a cebola mostrando os quadros
  // vizinhos do video (src/render/videoref.ts)
  referencia = $state<{ src: string; x: number; y: number; largura: number; opacidade: number; mover: boolean; video?: VideoReferencia; inicio?: number; velocidade?: number; repetir?: boolean; frente?: boolean } | null>(null);
  // poe uma imagem (ou video) de referencia ajustada a altura do personagem na tela
  async porReferencia(src: string, video = /\.(mp4|m4v|mov)$/i.test(decodeURIComponent(src))) {
    let w: number, h: number;
    let v: VideoReferencia | undefined;
    if (video) {
      v = await VideoReferencia.abrir(src);
      w = v.largura;
      h = v.altura;
    } else {
      const img = new Image();
      img.src = src;
      await img.decode();
      w = img.naturalWidth;
      h = img.naturalHeight;
    }
    this.tirarReferencia();
    const b = this.viewer?.currentBounds() ?? [-100, 0, 200, 300];
    const altura = b[3] * 1.05;
    this.referencia = { src, x: b[0] + b[2] / 2, y: b[1] + b[3] / 2, largura: (altura * w) / h, opacidade: 0.5, mover: false, ...(v ? { video: v, inicio: 0, velocidade: 1, repetir: true } : {}) };
  }
  // pose de video (src/app/posevideo.ts): os pontos do corpo no video de referencia viram chaves na
  // animacao (pose.fromLandmarks); `progresso` diz quantos quadros ja foram
  poseProgresso = $state<{ feito: number; total: number } | null>(null);
  async poseDoVideo(o: { anim?: string; flip?: boolean; smooth?: number; lockFeet?: boolean; reduce?: boolean; translate?: "xy" | "y" | "none"; map?: Record<string, string> } = {}) {
    const r = this.referencia;
    if (!r?.video) throw new Error("ponha um vídeo de referência antes (arraste o vídeo para a tela)");
    if (this.poseProgresso) throw new Error("já está lendo a pose do vídeo");
    const { detectarPose } = await import("./posevideo.ts");
    const anim = o.anim ?? this.play.animation ?? "video";
    const dur = this.viewer?.hasAnimation(anim) ? this.viewer.animDuration(anim) : undefined;
    this.poseProgresso = { feito: 0, total: r.video.quadros.length };
    try {
      const frames = await detectarPose(r.video, { inicio: r.inicio, velocidade: r.velocidade, ate: dur && dur > 0 ? dur : undefined }, (feito, total) => (this.poseProgresso = { feito, total }));
      const achou = frames.filter((f) => f.points).length;
      if (achou < 2) throw new Error(`o detector achou uma pessoa em ${achou} de ${frames.length} quadros`);
      const res = this.run({ cmd: "pose.fromLandmarks", args: { ...o, anim, frames } }, `pose do vídeo em ${anim}`);
      if (!res?.[0]) return null;
      if (this.viewer && !this.viewer.hasAnimation(anim)) this.viewer.sync();
      this.play.animation !== anim && this.viewer?.setAnimation(anim);
      const rel = res[0];
      this.avisar(`Pose do vídeo em ${anim}: pessoa em ${achou} de ${frames.length} quadros, ${rel.trocas} troca(s) de lado desfeita(s), ${rel.contatos.length} apoio(s) do pé travado(s), ${rel.chavesDepois} chaves (de ${rel.chavesAntes}). Ctrl+Z desfaz.`);
      return { ...rel, quadros: frames.length, comPessoa: achou };
    } finally {
      this.poseProgresso = null;
    }
  }
  tirarReferencia() {
    this.referencia?.video?.fechar();
    if (this.viewer) this.viewer.refVideo = null;
    this.referencia = null;
  }
  // modo de desenho do viewport (godot, spine ou nucleo): segue o personagem aberto (runtimeDe);
  // escolher no seletor vale para o projeto dele
  runtime = $state<Runtime>(runtimeDoEndereco() ?? "nucleo");
  async setRuntime(r: Runtime) {
    this.runtime = r;
    try {
      if (this.asset) localStorage.setItem(`mamulengo.runtime.${this.asset.project}`, r);
    } catch {}
    await this.viewer?.setRuntime(r);
  }
  // pixel perfeito (Viewer.view.pixel): pixels da textura por unidade do mundo, 0 desliga. Liga
  // sozinho no personagem com todas as paginas em Nearest; a escolha fica por personagem
  pixel = $state(0);
  usarPixel(n: number) {
    this.pixel = Math.max(0, Number(n) || 0);
    if (this.viewer) this.viewer.view.pixel = this.pixel;
    try {
      if (this.asset) localStorage.setItem(`mamulengo.pixel.${this.asset.id}`, String(this.pixel));
    } catch {}
  }
  private pixelDoPersonagem(atlasTexto: string) {
    try {
      const s = this.asset ? localStorage.getItem(`mamulengo.pixel.${this.asset.id}`) : null;
      if (s !== null) return Number(s) || 0;
    } catch {}
    const paginas = parseAtlas(atlasTexto).pages;
    return paginas.length && paginas.every((p) => /^nearest/i.test(p.filter)) ? 1 : 0;
  }
  // editar malha (na Pose base): pontos ou pintura de pesos do slot escolhido
  meshEdit = $state<MeshEdit | null>(null);
  // desenhar uma imagem vetorial (na Pose base)
  drawEdit = $state<DrawEdit | null>(null);
  // pintar um mosaico (src/app/mosaicedit.ts)
  mosaicEdit = $state<MosaicEdit | null>(null);
  // jogando o palco (docs/PALCO.md): pelo botao, pelo teclado ou pela ponte (play)
  jogando = $state(false);
  // clicar pontos na tela para uma parte especial (recorte, caixa, caminho, ponto): os pontos em
  // pixels do mundo (espaco do esqueleto), na Pose base
  captura = $state<{ tipo: "clipping" | "boundingbox" | "path" | "point"; bone: string; slot: string | null; pontos: [number, number][] } | null>(null);
  comecarCaptura(tipo: "clipping" | "boundingbox" | "path" | "point", bone: string, slot: string | null) {
    this.mode = "setup";
    if (this.viewer) this.viewer.view.playing = false;
    this.drawEdit = null;
    this.meshEdit = null;
    this.mosaicEdit = null;
    this.captura = { tipo, bone, slot, pontos: [] };
  }
  // conclui: cria a camada nova no osso e a parte com os pontos
  concluirCaptura() {
    const c = this.captura;
    this.captura = null;
    if (!c || !this.doc) return;
    const min = c.tipo === "point" ? 1 : c.tipo === "path" ? 2 : 3;
    if (c.pontos.length < min) return this.toast(`Precisa de pelo menos ${min} ponto${min > 1 ? "s" : ""}.`);
    const NOME: Record<string, string> = { clipping: "recorte", boundingbox: "caixa", path: "caminho", point: "ponto" };
    const usados = new Set(this.doc.json.slots.map((s: any) => s.name));
    let nome = NOME[c.tipo];
    for (let k = 2; usados.has(nome); k++) nome = `${NOME[c.tipo]}_${k}`;
    // recorte: logo atras da camada escolhida, recortando ate ela; os outros na frente de tudo
    const calls: any[] = [{ cmd: "slot.add", args: { name: nome, bone: c.bone, ...(c.tipo === "clipping" && c.slot ? { below: c.slot } : {}) } }];
    const P = c.pontos.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]);
    if (c.tipo === "clipping") calls.push({ cmd: "clipping.create", args: { slot: nome, name: nome, points: P, ...(c.slot ? { end: c.slot } : {}), show: true } });
    else if (c.tipo === "boundingbox") calls.push({ cmd: "boundingbox.create", args: { slot: nome, name: nome, points: P } }, { cmd: "slot.set", args: { slot: nome, attachment: nome } });
    else if (c.tipo === "point") calls.push({ cmd: "point.create", args: { slot: nome, name: nome, at: P[0] } }, { cmd: "slot.set", args: { slot: nome, attachment: nome } });
    else {
      // caminho: alcas suaves pelos vizinhos (um sexto da distancia entre o anterior e o seguinte)
      const out: number[][] = [];
      P.forEach((p, i) => {
        const a = P[Math.max(0, i - 1)],
          b = P[Math.min(P.length - 1, i + 1)];
        const t = [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6];
        out.push([p[0] - t[0], p[1] - t[1]], p, [p[0] + t[0], p[1] + t[1]]);
      });
      calls.push({ cmd: "path.create", args: { slot: nome, name: nome, points: out } }, { cmd: "slot.set", args: { slot: nome, attachment: nome } });
    }
    if (this.run(calls, `${NOME[c.tipo]} em ${c.bone}`)) {
      this.select({ bone: c.bone, slot: nome });
      const dica: Record<string, string> = {
        clipping: c.slot ? `só o que está dentro dele aparece em ${c.slot}` : "mova a camada na Ordem para escolher o que ele recorta",
        boundingbox: "o jogo usa para clique e colisão",
        path: "um osso pode segui-lo (+ restrição › seguir um caminho)",
        point: "o jogo usa para prender efeitos",
      };
      this.avisar(`${nome} criado em ${c.bone}: ${dica[c.tipo]}.`);
    }
  }

  // a skin mostrada; imagem nova numa camada entra nela (null: a padrao)
  skin = $state<string | null>(null);
  get skinEdicao() {
    return this.skin ?? "default";
  }
  verSkin(nome: string | null) {
    this.skin = nome && nome !== "default" ? nome : null;
    this.viewer?.setSkin(this.skin);
    this.version++;
  }
  // a skin onde mora a imagem `att` da camada: a mostrada se ela tem, senao a primeira que tem
  skinDe(slot: string, att: string): string {
    const sks: any[] = this.doc?.json.skins ?? [];
    if (sks.find((s) => s.name === this.skinEdicao)?.attachments?.[slot]?.[att]) return this.skinEdicao;
    return sks.find((s) => s.attachments?.[slot]?.[att])?.name ?? "default";
  }
  // a pagina do atlas feita das formas (src/app/desenho.ts)
  desenhos = new Desenhos();
  // o atlas como esta no disco e os desenhos da ultima gravacao da pagina
  private atlasDisco = "";
  private desenhosGravados: string | null = null;
  // chaves copiadas na timeline (resultado de keys.copy): vale entre animacoes e personagens
  keyClipboard = $state.raw<{ time: number; items: any[] } | null>(null);
  private seq = 0;
  private unsub: (() => void) | null = null;

  log(a: Omit<Activity, "id" | "at">) {
    this.activity = [{ ...a, id: ++this.seq, at: Date.now() }, ...this.activity].slice(0, 200);
  }

  async loadAssets(refresh = false) {
    const [r, raizes] = await Promise.all([fetch("/api/assets" + (refresh ? "?refresh=1" : "")), fetch("/api/roots").then((x) => x.json()).catch(() => [])]);
    this.assets = await r.json();
    this.roots = raizes;
    this.assetsLidos = true;
  }

  // o nome do personagem que esta abrindo (o desenho mostra enquanto carrega)
  abrindo = $state<string | null>(null);

  async open(asset: AssetInfo) {
    this.loading = true;
    this.abrindo = asset.name;
    this.error = null;
    // o que estava escondido era de outro personagem
    this.hidden = { bones: [], slots: [] };
    this.applyHidden();
    try {
      const [sk, at] = await Promise.all([fetch(fileUrl(asset.skeleton)).then(okText), fetch(fileUrl(asset.atlas)).then(okText)]);
      this.fileText = sk;
      const doc = Document.fromText(sk, { text: at, pages: {} });
      doc.file = { skeleton: asset.skeleton, atlas: asset.atlas, tres: asset.tres };
      this.atlasDisco = at;
      this.desenhosGravados = null;
      this.desenhos.preparar(doc);
      this.unsub?.();
      this.unsub = doc.onChange((e) => this.onChange(e));
      this.doc = doc;
      this.asset = asset;
      this.selection = {};
      this.meshEdit = null;
      this.drawEdit = null;
      this.mosaicEdit = null;
      this.skin = null;
      if (this.viewer) this.viewer.skin = null;
      this.version++;
      const dir = asset.atlas.slice(0, asset.atlas.lastIndexOf("/") + 1);
      // o modo muda antes de carregar, para as texturas virem uma vez so
      this.runtime = runtimeDe(asset);
      if (this.viewer) (this.viewer.runtime = this.runtime), (this.viewer.paginaPropria = (p) => this.desenhos.bitmap(p));
      await this.viewer?.setDocument(doc, (page) => `/api/texture?p=${encodeURIComponent(dir + page)}`);
      this.pixel = this.pixelDoPersonagem(at);
      if (this.viewer) this.viewer.view.pixel = this.pixel;
      this.log({ label: `abriu ${asset.project} / ${asset.name}`, source: "ui", kind: "info", ops: 0 });
      const d = await getDraft(asset.id);
      this.draft = d && d.base === sk && d.text !== sk ? { ...d, id: asset.id } : null;
      // o arquivo no disco e o mesmo de quando o rascunho comecou: volta sozinho (era o trabalho
      // nao salvo de quem estava aqui, perdido num recarregar), desfazivel. Perguntar sem dizer o
      // que era confundia no teste acompanhado
      if (this.draft) {
        const quando = new Date(this.draft.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        await this.restoreDraft();
        this.avisar(`Recuperei as alterações não salvas de ${quando} em ${asset.name} (Ctrl+Z desfaz).`);
      }
      if (d && d.base !== sk) dropDraft(asset.id);
      try {
        localStorage.setItem("mamulengo.last", asset.id);
      } catch {}
      await this.loadFicha();
      await this.loadNotes();
    } catch (e: any) {
      this.error = String(e?.message ?? e);
      this.toast(`Não consegui abrir ${asset.name}: ${this.error}`);
      throw e;
    } finally {
      this.abrindo = null;
      this.loading = false;
    }
  }

  private onChange(e: ChangeEvent) {
    this.version++;
    // as formas de um desenho mudaram: a pagina dos desenhos e refeita
    const desenho = (ops: Op[] | undefined) => !!ops?.some((o) => o.path[0] === "drawings");
    if (this.doc && (desenho(e.tx.ops) || desenho(e.tx.inverse) || desenho(e.replaced?.ops))) {
      const doc = this.doc;
      this.desenhos.agendar(doc, this.viewer, () => this.reloadAtlas(doc.atlas.text));
    }
    // rascunho (com folga para nao serializar a cada passo de um arraste)
    clearTimeout(this.draftTimer);
    const id = this.asset?.id;
    const doc = this.doc;
    // espelho: o destaque ja foi calculado em applyMirror; sem rascunho nem atividade propria
    if (e.tx.source === "espelho") return;
    if (id && doc && !this.spectator)
      this.draftTimer = window.setTimeout(() => {
        if (doc.dirty) putDraft(id, { text: doc.serialize(), at: Date.now(), base: this.fileText });
        else dropDraft(id);
      }, 600);
    // etapas de um arrasto atualizam a mesma linha da atividade
    if (e.merged && this.activity[0]?.label === e.tx.label) this.activity[0] = { ...this.activity[0], at: Date.now(), ops: e.tx.ops.length };
    else this.log({ label: e.tx.label, source: e.tx.source, kind: e.kind, ops: e.tx.ops.length });
    if (e.tx.source !== "ui") for (const t of touched(e.tx.ops, this.doc!)) this.viewer?.highlight(t);
  }

  // Imagens para comandos que precisam de pixels: regioes do atlas aberto.
  pixels: AssetProvider = {
    image: async (region) => {
      const d = drawingsOf(this.doc?.json)[region];
      if (d) return drawingPixels(d);
      const atlas = this.doc?.file.atlas;
      if (!atlas) return null;
      const r = await fetch(`/api/region?atlas=${encodeURIComponent(atlas)}&name=${encodeURIComponent(region)}`);
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      return { width: bmp.width, height: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
    },
    text: async (path) => {
      const r = await fetch(fileUrl(path));
      return r.ok ? await r.text() : null;
    },
    bytes: async (path) => {
      const r = await fetch(fileUrl(path));
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    region: (name) => {
      // imagem desenhada: o tamanho dela (a pagina guarda em alta resolucao)
      const d = drawingsOf(this.doc?.json)[name];
      if (d) return { width: d.width, height: d.height };
      const text = this.doc?.atlas.text;
      if (!text) return null;
      const r = parseAtlas(this.desenhos.semDesenhos(text)).regions.find((x) => x.name === name);
      return r ? { width: r.originalWidth, height: r.originalHeight } : null;
    },
  };

  // Executa comandos com origem "ui"; erros viram toast + atividade (quiet: so devolve
  // null, para etapas de arrasto que podem esbarrar num limite sem incomodar).
  run(calls: Call | Call[], label?: string, merge?: string, quiet = false): any[] | null {
    if (!this.doc) return null;
    const blocked = this.blockedBySequence(calls);
    if (blocked) {
      if (!quiet) this.toast(blocked);
      return null;
    }
    try {
      const r = execute(this.doc, calls, "ui", label, { merge }, this.pixels);
      void this.gravarArquivos(r);
      return r;
    } catch (e: any) {
      if (/executeAsync/.test(String(e?.message))) {
        this.runAsync(calls, label);
        return [];
      }
      if (!quiet) this.toast(String(e?.message ?? e));
      return null;
    }
  }

  // mix que o jogo usa de "from" para "to" (o do par no -data.tres, senao o padrao)
  mixFor(from: string | null, to: string): number {
    const a = this.asset;
    return a?.mixes?.find((m) => m.from === from && m.to === to)?.mix ?? a?.defaultMix ?? 0;
  }

  // Previa de transicao: depois que a proxima animacao entra, o que se ve e a mistura
  // das duas. Chave da animacao nesse trecho sairia errada (ou esticaria a animacao).
  blockedBySequence(calls: Call | Call[]): string | null {
    const v = this.viewer;
    const st = v?.sequenceTimes();
    if (!v || !st) return null;
    const anim = v.view.animation;
    for (const c of Array.isArray(calls) ? calls : [calls]) {
      const a = c.args as any;
      if (a && a.anim === anim && typeof a.time === "number" && a.time >= st.start - 1e-4)
        return `A previa da emenda esta ligada e em ${a.time.toFixed(2)}s ja entra ${st.next}. Para editar ${anim}, volte para antes de ${st.start.toFixed(2)}s ou desligue a previa.`;
    }
    return null;
  }

  async runAsync(calls: Call | Call[], label?: string, source = "ui"): Promise<any[] | null> {
    if (!this.doc) return null;
    try {
      const r = await executeAsync(this.doc, calls, source, label, {}, this.pixels);
      await this.gravarArquivos(r);
      return r;
    } catch (e: any) {
      if (source !== "ui") throw e;
      this.toast(String(e?.message ?? e));
      return null;
    }
  }

  // Entrar numa instancia (docs/NUCLEO.md "Instancias"): abre o .boneco filho para editar; o pai
  // fica na pilha (com a animacao e o instante), e voltar o reabre, ja com o filho novo
  pilhaInstancias = $state<{ asset: AssetInfo; animation: string | null; time: number; instance: string }[]>([]);
  async entrarInstancia(nome: string) {
    const doc = this.doc;
    const inst = ((doc?.json as any)?.instances ?? []).find((x: any) => x.name === nome);
    if (!doc || !inst || !this.asset) return this.toast(`A instância ${nome} não existe.`);
    if (doc.dirty) return this.toast("Salve (Ctrl+S) antes de entrar na instância: ao voltar, o personagem relê o filho do disco.");
    const base = doc.file.tres ?? "";
    const partes: string[] = [];
    for (const x of (base.slice(0, base.lastIndexOf("/") + 1) + inst.boneco).split("/")) {
      if (x === "..") partes.pop();
      else if (x !== ".") partes.push(x);
    }
    const caminho = partes.join("/");
    let filho = this.assets.find((a) => a.tres === caminho);
    if (!filho) {
      await this.loadAssets(true);
      filho = this.assets.find((a) => a.tres === caminho);
    }
    if (!filho) return this.toast(`Não achei ${inst.boneco} entre os personagens do editor: ele está fora das pastas que o editor procura (MAMULENGO_ROOTS)?`);
    const v = this.viewer;
    this.pilhaInstancias = [...this.pilhaInstancias, { asset: this.asset, animation: v?.view.animation ?? null, time: v?.view.time ?? 0, instance: nome }];
    await this.open(filho);
    // a animacao que a instancia tocava, se o filho tem
    if (inst.animation && v) v.setAnimation(inst.animation);
  }
  async voltarInstancia() {
    const topo = this.pilhaInstancias[this.pilhaInstancias.length - 1];
    if (!topo) return;
    if (this.doc?.dirty) return this.toast("Salve (Ctrl+S) antes de voltar: o personagem de cima relê este arquivo do disco.");
    this.pilhaInstancias = this.pilhaInstancias.slice(0, -1);
    await this.open(topo.asset);
    const v = this.viewer;
    if (v) {
      v.setAnimation(topo.animation);
      v.poseAt(topo.time);
    }
  }

  // Arquivos que um comando produziu (instance.extract: o .boneco do filho), gravados ao lado do
  // documento; depois o viewer rele as instancias
  async gravarArquivos(results: any[] | null) {
    const dir = this.doc?.file.tres ? this.doc.file.tres.slice(0, this.doc.file.tres.lastIndexOf("/") + 1) : null;
    const novos = (results ?? []).map((r) => r?.arquivo).filter((a) => a?.caminho && typeof a.texto === "string");
    if (!novos.length) return;
    if (!dir) throw new Error("Salve o personagem antes: sem uma pasta, o arquivo do filho não tem onde ser gravado.");
    for (const a of novos) {
      const r = await fetch(fileUrl(dir + a.caminho), { method: "PUT", body: a.texto, headers: { "x-mamulengo-source": "comando" } });
      if (!r.ok) throw new Error(`Não consegui gravar ${a.caminho}: ${(await r.json()).error}`);
    }
    this.viewer?.recarregarInstancias();
  }

  // Liga um viewer (novo, ex: viewport remontado) ao documento ja aberto.
  async attachViewer(v: Viewer) {
    this.viewer = v;
    v.paginaPropria = (p) => this.desenhos.bitmap(p);
    this.applyHidden();
    const doc = this.doc;
    if (!doc?.file.atlas) return;
    const dir = doc.file.atlas.slice(0, doc.file.atlas.lastIndexOf("/") + 1);
    await v.setDocument(doc, (page) => `/api/texture?p=${encodeURIComponent(dir + page)}`);
    v.selection = this.selection;
  }

  // Troca o atlas do documento aberto (depois de adicionar imagens) e recarrega texturas.
  async reloadAtlas(text: string) {
    const doc = this.doc;
    const v = this.viewer;
    if (!doc || !v) return;
    doc.atlas = { ...doc.atlas, text };
    const dir = doc.file.atlas!.slice(0, doc.file.atlas!.lastIndexOf("/") + 1);
    const keep = { animation: v.view.animation, time: v.view.time, cam: { ...v.cam } };
    await v.setDocument(doc, (page) => `/api/texture?p=${encodeURIComponent(dir + page)}&t=${Date.now()}`);
    v.setAnimation(keep.animation);
    v.poseAt(keep.time);
    Object.assign(v.cam, keep.cam);
    this.version++;
  }

  async save(source = "ui"): Promise<{ bytes: number; version?: string }> {
    const doc = this.doc;
    if (!doc?.file.skeleton) throw new Error("Abra um personagem primeiro.");
    const text = doc.serialize();
    await this.gravarDesenhos(doc);
    // o servidor guarda cada gravacao como versao; source diz quem gravou
    const r = await fetch(fileUrl(doc.file.skeleton), { method: "PUT", body: text, headers: { "x-mamulengo-source": source } });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    doc.markSaved();
    this.fileText = text;
    if (this.asset) dropDraft(this.asset.id);
    this.version++;
    this.log({ label: `salvou ${doc.file.skeleton.split("/").pop()} (${j.bytes} bytes)`, source, kind: "info", ops: 0 });
    this.versionsTick++;
    return { bytes: j.bytes, version: j.version };
  }

  // a pagina dos desenhos (PNG) e o atlas, se mudaram, antes do esqueleto
  private async gravarDesenhos(doc: Document) {
    const atlas = doc.file.atlas;
    if (!atlas) return;
    const dir = atlas.slice(0, atlas.lastIndexOf("/") + 1);
    const agora = JSON.stringify(drawingsOf(doc.json));
    if (this.desenhos.layout && agora !== this.desenhosGravados) {
      // a pagina das formas de agora (o redesenho agendado pode nao ter rodado ainda)
      const png = await this.desenhos.png(doc);
      if (png) {
        const r = await fetch(fileUrl(dir + this.desenhos.page), { method: "PUT", body: png });
        if (!r.ok) throw new Error(`Não consegui gravar a página dos desenhos: ${(await r.json()).error}`);
      }
    }
    if (doc.atlas.text !== this.atlasDisco) {
      const r = await fetch(fileUrl(atlas), { method: "PUT", body: doc.atlas.text });
      if (!r.ok) throw new Error(`Não consegui gravar o atlas: ${(await r.json()).error}`);
      this.atlasDisco = doc.atlas.text;
    }
    this.desenhosGravados = agora;
  }

  // ferramentas que regravam o .boneco no servidor (relevo, arte HD, formato): salva antes, roda,
  // e o personagem reabre do disco no mesmo instante e com a mesma vista
  relevoRodando = $state(false);
  async noArquivo(nome: string, faz: (boneco: string) => Promise<any>, aviso: (r: any) => string) {
    const asset = this.asset;
    const v = this.viewer;
    if (!asset?.tres?.endsWith(".boneco") || this.relevoRodando) return null;
    this.relevoRodando = true;
    try {
      if (this.doc?.dirty) await this.save();
      const r = await faz(asset.tres);
      const vista = v ? { anim: v.view.animation, t: v.view.time, cam: { ...v.cam } } : null;
      await this.open(asset);
      if (v && vista) {
        v.setAnimation(vista.anim);
        v.poseAt(vista.t);
        Object.assign(v.cam, vista.cam);
      }
      this.versionsTick++;
      // aviso vazio: quem chamou avisa depois (efeito e olho maluco)
      const msg = aviso(r);
      if (msg) this.avisar(msg);
      return r;
    } catch (e: any) {
      this.toast(`Não consegui ${nome}: ${e?.message ?? e}`);
      return null;
    } finally {
      this.relevoRodando = false;
    }
  }
  private async postar(url: string, body: BodyInit) {
    const r = await fetch(url, { method: "POST", body });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  }
  gerarRelevo(opts: Record<string, number> = {}) {
    return this.noArquivo("gerar o relevo", (b) => this.postar("/api/relevo", JSON.stringify({ boneco: b, ...opts })), () => "O relevo das páginas foi calculado da própria arte: as luzes já iluminam as peças. Para voltar, use Versões.");
  }
  converterFormato(binario: boolean) {
    return this.noArquivo(
      "trocar o formato",
      (b) => this.postar("/api/boneco/formato", JSON.stringify({ boneco: b, binario })),
      (r) => `O .boneco agora está em ${binario ? "binário" : "texto"}: ${Math.round(r.antes / 1024)} KB → ${Math.round(r.depois / 1024)} KB. O editor lê e grava nos dois formatos.`,
    );
  }
  // efeito da biblioteca (biblioteca/efeitos) numa camada: o servidor poe as imagens numa pagina
  // de efeitos do .boneco (salva antes e reabre), e o emissor nasce pelo particles.set (desfazivel)
  efeitosLista = $state<{ nome: string; titulo: string; texto: string; rajadas: boolean }[] | null>(null);
  async carregarEfeitos() {
    if (!this.efeitosLista) this.efeitosLista = await fetch("/api/efeitos").then((r) => (r.ok ? r.json() : []));
    return this.efeitosLista;
  }
  async efeitoDaBiblioteca(efeito: string, slot: string) {
    const ef = (await this.carregarEfeitos())?.find((e) => e.nome === efeito);
    const r = await this.noArquivo("trazer o efeito", (b) => this.postar("/api/efeito", JSON.stringify({ boneco: b, efeito })), (r) => (r.novas ? `As imagens do efeito entraram na página ${r.pagina}.` : "O efeito já estava no personagem."));
    if (!r) return;
    let nome = `${slot}_${efeito}`;
    for (let n = 2; ((this.doc?.json as any).particles ?? []).some((p: any) => p.name === nome); n++) nome = `${slot}_${efeito}_${n}`;
    if (this.run({ cmd: "particles.set", args: { name: nome, slot, variants: r.imagens, ...r.emissor } }, `${efeito} em ${slot}`))
      this.avisar(`${ef?.titulo ?? efeito} em ${slot}${ef?.rajadas ? ": este sai em rajadas; ponha uma chave de rajada na timeline (botão rajada, logo abaixo)" : ""}.`);
  }
  // olho maluco (eye.googly) em lugares aleatorios da camada: as imagens vem da biblioteca (como um
  // efeito), depois o comando cola os olhos (desfazivel)
  async olhoMaluco(slot: string, count: number) {
    const r = await this.noArquivo("trazer o olho maluco", (b) => this.postar("/api/efeito", JSON.stringify({ boneco: b, efeito: "olho_maluco" })), () => "");
    if (!r) return;
    const seed = 1 + Math.floor(Math.random() * 9999);
    if (this.run({ cmd: "eye.googly", args: { slot, count, seed } }, `olho maluco em ${slot}`))
      this.avisar(`${count === 1 ? "Um olho maluco" : `${count} olhos malucos`} em ${slot}, em lugares sorteados: a pupila cai e rola quando a peça mexe. Não gostou do lugar? Desfaça e ponha de novo.`);
  }
  // versao leve ao lado (o original nao muda): salva antes, para ela sair do que esta na tela
  async versaoLeve(fator: number) {
    const asset = this.asset;
    if (!asset?.tres?.endsWith(".boneco") || this.relevoRodando) return;
    this.relevoRodando = true;
    try {
      if (this.doc?.dirty) await this.save();
      const r = await this.postar("/api/boneco/leve", JSON.stringify({ boneco: asset.tres, fator }));
      await this.loadAssets(true);
      // a ultima linha e a do proprio personagem (antes vem a dos filhos das instancias)
      const m = /: (\d+) -> (\d+) paginas, ([\d.]+) -> ([\d.]+) Mpx; (\d+) lotes.*? -> (\d+) lotes/.exec(String(r.saida.at(-1) ?? ""));
      const conta = m ? `: ${m[1]} → ${m[2]} páginas, ${m[3]} → ${m[4]} megapixels de textura, ${m[5]} → ${m[6]} lotes de desenho (somando o primeiro quadro de cada animação)` : "";
      this.avisar(`Versão leve ao lado, ${asset.name}-leve${conta}. O original não mudou.`);
    } catch (e: any) {
      this.toast(`Não consegui fazer a versão leve: ${e?.message ?? e}`);
    } finally {
      this.relevoRodando = false;
    }
  }
  arteHd(svg: Blob | null, fator: number, id: string) {
    return this.noArquivo(
      "fazer a arte HD",
      // pelo navegador a pagina rasteriza o SVG (o service worker nao sabe) e o service worker grava
      (b) => (NAVEGADOR ? import("../navegador/atlas-hd-pagina.ts").then((m) => m.arteHdNoNavegador(b, svg, fator, id)) : this.postar(`/api/atlas-hd?boneco=${encodeURIComponent(b)}&fator=${fator}&id=${encodeURIComponent(id)}`, svg ?? new Blob([]))),
      () => `A página do atlas saiu do SVG em ${fator}x (nítida de perto). Para voltar, use Versões.`,
    );
  }

  // olho das listas Esqueleto e Ordem: esconde na tela, nao grava nada
  hidden = $state({ bones: [] as string[], slots: [] as string[] });
  toggleHidden(kind: "bones" | "slots", name: string) {
    const list = this.hidden[kind];
    this.hidden[kind] = list.includes(name) ? list.filter((x) => x !== name) : [...list, name];
    this.applyHidden();
  }
  showAll() {
    this.hidden = { bones: [], slots: [] };
    this.applyHidden();
  }
  applyHidden() {
    if (!this.viewer) return;
    this.viewer.hiddenBones = new Set(this.hidden.bones);
    this.viewer.hiddenSlots = new Set(this.hidden.slots);
  }

  // Ordem de desenho (o z). Na Pose base muda a ordem de setup; numa animacao vira chave
  // de ordem no instante atual. index 0 = mais atras.
  layerOrder(): string[] {
    const names: string[] = (this.doc?.json.slots ?? []).map((x: any) => x.name);
    if (this.mode === "animate" && this.play.animation) return this.viewer?.pose?.drawOrder().map((x) => x.name) ?? names;
    return names;
  }
  moveLayer(slot: string, to: number) {
    const cur = this.layerOrder();
    const i = cur.indexOf(slot);
    to = Math.max(0, Math.min(cur.length - 1, to));
    if (i < 0 || to === i) return false;
    if (this.mode === "animate" && this.play.animation) {
      const next = cur.slice();
      next.splice(i, 1);
      next.splice(to, 0, slot);
      const t = +this.play.time.toFixed(4);
      const ok = !!this.run({ cmd: "draworder.key", args: { anim: this.play.animation, time: t, order: next } }, `ordem de ${slot}`);
      if (ok) this.avisar(`${slot} mudou de lugar só em ${this.play.animation}, a partir de ${t.toFixed(2)}s (uma chave de ordem). Para todas as animações, faça na Pose base.`);
      return ok;
    }
    return !!this.run({ cmd: "slot.order", args: { slot, index: to } }, `ordem de ${slot}`);
  }
  // sobe ou desce passando pela proxima camada que encosta nesta na tela (camadas que nao
  // se sobrepoem nao mudam nada visivel; o passo pula elas)
  stepLayer(slot: string, dir: 1 | -1) {
    const sk = this.viewer?.pose;
    const cur = this.layerOrder();
    const i = cur.indexOf(slot);
    const me = sk ? slotWorldBox(sk, slot) : null;
    const hits = (o: string) => {
      const b = sk ? slotWorldBox(sk, o) : null;
      return !me || !b ? false : me[0] < b[2] && b[0] < me[2] && me[1] < b[3] && b[1] < me[3];
    };
    for (let j = i + dir; j >= 0 && j < cur.length; j += dir)
      if (hits(cur[j])) return this.moveLayer(slot, j);
    this.toast(dir > 0 ? `nada na frente de ${slot} encosta nela` : `nada atras de ${slot} encosta nela`);
    return false;
  }
  // na frente de / atras de outra camada
  placeLayer(slot: string, other: string, where: "front" | "back") {
    const cur = this.layerOrder().filter((x) => x !== slot);
    const k = cur.indexOf(other);
    if (k < 0) return false;
    // moveLayer tira a camada e insere no indice da lista sem ela
    return this.moveLayer(slot, where === "front" ? k + 1 : k);
  }

  select(sel: { bone?: string; slot?: string }) {
    this.selection = sel;
    if (this.viewer) this.viewer.selection = sel;
  }

  // aplica o rascunho como uma acao (desfazivel) por cima do arquivo
  // Narracao: o que o agente diz enquanto trabalha (a bancada le a transcricao), mostrada
  // como legenda na tela e guardada na atividade
  narration = $state({ text: "", at: 0 });
  showNarration = $state(true);
  // esta aba e a que o agente esta usando (a ponte avisa)
  agentHere = $state(false);
  narrate(text: string) {
    if (!text?.trim()) return;
    this.narration = { text: text.trim(), at: Date.now() };
    if (!this.spectator) this.log({ label: `💬 ${text.trim()}`, source: "claude", kind: "info", ops: 0 });
  }

  // Espectador: aplica o estado que o editor do agente mandou. Mantem a animacao, o
  // instante e a camera que a pessoa escolheu; nada vai para o disco.
  spectator = $state(false);
  private mirrorAsset = "";
  async applyMirror(m: { asset: AssetInfo; skeleton: string; atlas: string | null; activity: any[]; animation: string | null }) {
    // o primeiro estado pode chegar antes de a tela (viewer) existir: espera ela
    for (let i = 0; !this.viewer && i < 200; i++) await new Promise((r) => setTimeout(r, 30));
    const sameAsset = this.asset?.id === m.asset.id && this.mirrorAsset === m.asset.id;
    if (!sameAsset || !this.doc) {
      // personagem novo (ou o primeiro): monta o documento do que chegou
      const at = m.atlas ?? (await fetch(fileUrl(m.asset.atlas)).then(okText));
      const doc = Document.fromText(m.skeleton, { text: at ?? "", pages: {} });
      doc.file = { skeleton: m.asset.skeleton, atlas: m.asset.atlas, tres: m.asset.tres };
      this.unsub?.();
      this.unsub = doc.onChange((e) => this.onChange(e));
      this.doc = doc;
      this.asset = m.asset;
      this.mirrorAsset = m.asset.id;
      this.selection = {};
      this.desenhos.preparar(doc);
      this.version++;
      const dir = m.asset.atlas.slice(0, m.asset.atlas.lastIndexOf("/") + 1);
      await this.viewer?.setDocument(doc, (page) => `/api/texture?p=${encodeURIComponent(dir + page)}&t=${Date.now()}`);
      if (m.animation) this.viewer?.setAnimation(m.animation);
    } else {
      if (m.atlas) await this.reloadAtlas(m.atlas);
      const next = JSON.parse(m.skeleton);
      // o que o agente mexeu, para acender na tela: osso com setup ou chaves mudadas, parte
      // mudada (o espelho troca secoes inteiras, entao a comparacao e feita aqui)
      const prev = this.doc.json as any;
      const lit = new Set<string>();
      const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
      const pb = new Map((prev.bones ?? []).map((b: any) => [b.name, b]));
      for (const b of next.bones ?? []) if (!same(pb.get(b.name), b)) lit.add(b.name);
      const ps = new Map((prev.slots ?? []).map((x: any) => [x.name, x]));
      for (const x of next.slots ?? []) if (!same(ps.get(x.name), x)) lit.add(x.bone);
      for (const [an, a] of Object.entries<any>(next.animations ?? {})) {
        const pa = prev.animations?.[an];
        if (same(pa, a)) continue;
        for (const [b, tl] of Object.entries<any>(a.bones ?? {})) if (!same(pa?.bones?.[b], tl)) lit.add(b);
        for (const [sl, tl] of Object.entries<any>(a.slots ?? {})) if (!same(pa?.slots?.[sl], tl)) {
          const x = (next.slots ?? []).find((y: any) => y.name === sl);
          if (x) lit.add(x.bone);
        }
      }
      for (const b of lit) this.viewer?.highlight({ bone: b }, 1600);
      this.doc.edit("espelho", "espelho", (e) => {
        for (const k of Object.keys(e.json)) if (!(k in next)) e.set([k], undefined);
        for (const [k, v] of Object.entries(next)) if (JSON.stringify(e.json[k]) !== JSON.stringify(v)) e.set([k], v);
      });
    }
    this.activity = m.activity;
  }

  async restoreDraft() {
    const d = this.draft;
    if (!d || !this.doc) return;
    const next = JSON.parse(d.text);
    this.doc.edit("recupera rascunho", "ui", (e) => {
      for (const k of Object.keys(e.json)) if (!(k in next)) e.set([k], undefined);
      // so as secoes que mudaram (o resto mantem os bytes do arquivo)
      for (const [k, v] of Object.entries(next)) if (JSON.stringify(e.json[k]) !== JSON.stringify(v)) e.set([k], v);
    });
    this.draft = null;
  }

  discardDraft() {
    if (this.draft) dropDraft(this.draft.id);
    this.draft = null;
  }

  undo() {
    this.doc?.undo();
  }
  redo() {
    this.doc?.redo();
  }

  // anotacoes do personagem (<nome>.notas.json, pelo servidor)
  notes = $state<any[]>([]);
  author = $state<string>((() => {
    try {
      return localStorage.getItem("mamulengo.autor") ?? "";
    } catch {
      return "";
    }
  })());

  async loadNotes() {
    if (!this.asset) return (this.notes = []);
    const r = await fetch(`/api/notes?skeleton=${encodeURIComponent(this.asset.skeleton)}`);
    this.notes = r.ok ? await r.json() : [];
  }

  async noteAction(action: Record<string, any>) {
    if (!this.asset) throw new Error("Abra um personagem primeiro.");
    const r = await fetch("/api/notes", { method: "POST", body: JSON.stringify({ skeleton: this.asset.skeleton, ...action }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await this.loadNotes();
    return j;
  }

  setAuthor(name: string) {
    this.author = name.trim();
    try {
      localStorage.setItem("mamulengo.autor", this.author);
    } catch {}
  }

  // muda a cada gravacao/restauracao: o painel de versoes rele a lista
  versionsTick = $state(0);

  async versions(): Promise<any[]> {
    if (!this.asset) return [];
    const r = await fetch(`/api/versions?skeleton=${encodeURIComponent(this.asset.skeleton)}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `versoes (${r.status})`);
    return r.json();
  }

  // marca uma versao com nome; o que nao foi salvo e salvo antes (versao = o que esta no disco)
  async markVersion(label: string, source = "ui") {
    if (!this.asset || !this.doc) throw new Error("Abra um personagem primeiro.");
    if (this.doc.dirty) await this.save(source);
    const r = await fetch("/api/versions", { method: "POST", body: JSON.stringify({ skeleton: this.asset.skeleton, label, source }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    this.versionsTick++;
    this.log({ label: `marcou a versao "${label}"`, source, kind: "info", ops: 0 });
    return j;
  }

  async diffVersion(id: string, against?: string) {
    if (!this.asset) throw new Error("Abra um personagem primeiro.");
    const q = new URLSearchParams({ skeleton: this.asset.skeleton, id, ...(against ? { against } : {}) });
    const r = await fetch(`/api/versions/diff?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  }

  // restaura no disco (o estado atual vira versao antes) e reabre o personagem
  async restoreVersion(id: string, source = "ui") {
    if (!this.asset || !this.doc) throw new Error("Abra um personagem primeiro.");
    if (this.doc.dirty) await this.save(source);
    const asset = this.asset;
    const r = await fetch("/api/versions/restore", { method: "POST", body: JSON.stringify({ skeleton: asset.skeleton, id, source }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await this.open(asset);
    this.versionsTick++;
    this.log({ label: `restaurou a versao ${j.label ?? j.restored}`, source, kind: "info", ops: 0 });
    return j;
  }

  // ficha do personagem (<nome>.ficha.md ao lado do .spine-json); text null = nao existe
  ficha = $state<{ path: string; text: string | null } | null>(null);
  // regras da ficha falhando na animacao aberta (o painel confere; o topo mostra)
  fichaFails = $state(0);
  rightTab = $state<"edit" | "ficha" | "notas">("edit");

  async loadFicha() {
    if (!this.asset) return;
    const path = fichaPath(this.asset.skeleton);
    const r = await fetch(fileUrl(path));
    this.ficha = { path, text: r.ok ? await r.text() : null };
  }

  async saveFicha(text: string) {
    if (!this.ficha) return;
    const r = await fetch(fileUrl(this.ficha.path), { method: "PUT", body: text });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `nao gravou a ficha (${r.status})`);
    this.ficha = { ...this.ficha, text };
    this.log({ label: "salvou a ficha", source: "ui", kind: "info", ops: 0 });
  }

  // rascunho com o contexto do jogo, do documento como esta agora
  async draftFicha(): Promise<string> {
    if (!this.doc || !this.asset) throw new Error("Abra um personagem primeiro.");
    // no navegador o contexto do jogo (usos no codigo Godot, mixes) vem das pastas abertas
    if (NAVEGADOR) return draftFicha(this.doc.json, this.asset.name, await contextoDoJogo(this.asset.skeleton, Object.keys(this.doc.json.animations ?? {})));
    const r = await fetch("/api/ficha/draft", { method: "POST", body: JSON.stringify({ json: this.doc.json, skeleton: this.asset.skeleton, name: this.asset.name }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `nao gerou o rascunho (${r.status})`);
    return r.text();
  }

  toastMsg = $state<{ text: string; at: number; ok?: boolean } | null>(null);
  toast(text: string) {
    // as mensagens dos comandos comecam em minuscula (servem tambem ao MCP): na tela, maiuscula
    text = text.charAt(0).toUpperCase() + text.slice(1);
    this.toastMsg = { text, at: Date.now() };
    this.log({ label: text, source: "ui", kind: "error", ops: 0 });
  }
  // o mesmo aviso, em verde: uma acao que deu certo e o que fazer em seguida
  avisar(text: string) {
    this.toastMsg = { text, at: Date.now(), ok: true };
  }
}

async function okText(r: Response) {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.text();
}

// Ossos/slots tocados por um conjunto de ops (para destacar no viewport).
export function touched(ops: Op[], doc: Document): { bone?: string; slot?: string }[] {
  const out = new Map<string, { bone?: string; slot?: string }>();
  for (const o of ops) {
    const p = o.path;
    if (p[0] === "bones" && typeof p[1] === "number") {
      const b = doc.json.bones?.[p[1]]?.name ?? (o.op === "insert" ? (o as any).value?.name : undefined);
      if (b) out.set("b:" + b, { bone: b });
    }
    if (p[0] === "animations" && p[2] === "bones" && typeof p[3] === "string") out.set("b:" + p[3], { bone: p[3] });
    if (p[0] === "animations" && p[2] === "slots" && typeof p[3] === "string") {
      const s = doc.json.slots?.find((x: any) => x.name === p[3]);
      if (s) out.set("b:" + s.bone, { bone: s.bone });
    }
    if (p[0] === "slots" && typeof p[1] === "number") {
      const s = doc.json.slots?.[p[1]];
      if (s) out.set("b:" + s.bone, { bone: s.bone });
    }
  }
  return [...out.values()];
}

export const app = new AppState();

// estado vivo (documento, ponte, WebGL): mudanca aqui recarrega a pagina inteira
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
