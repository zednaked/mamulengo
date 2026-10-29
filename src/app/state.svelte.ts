// Estado do app (Svelte 5 runes). Um unico documento aberto por vez.
import { slotWorldBox } from "./interact.ts";
import { Document, type ChangeEvent } from "../core/document.ts";
import { execute, executeAsync, type AssetProvider, type Call } from "../core/commands/index.ts";
import { parseAtlas } from "../core/atlas-text.ts";
import { dropDraft, getDraft, putDraft, type Draft } from "./drafts.ts";
import type { Runtime, Viewer } from "../render/viewer.ts";
import type { Op } from "../core/ops.ts";
import { fichaPath } from "../core/ficha.ts";

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

export const fileUrl =(p: string) => `/api/file?p=${encodeURIComponent(p)}`;

function initialRuntime(): Runtime {
  const ok = (r: string | null): r is Runtime => r === "godot" || r === "spine" || r === "nucleo";
  try {
    const q = new URLSearchParams(location.search).get("runtime");
    if (ok(q)) return q;
    const s = localStorage.getItem("mamulengo.runtime");
    if (ok(s)) return s;
  } catch {}
  return "godot";
}

class AppState {
  assets = $state<AssetInfo[]>([]);
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
  // modo de desenho do viewport (godot, spine ou nucleo); ?runtime=nucleo no endereco ou o
  // ultimo escolhido (guardado no navegador)
  runtime = $state<Runtime>(initialRuntime());
  async setRuntime(r: Runtime) {
    this.runtime = r;
    try {
      localStorage.setItem("mamulengo.runtime", r);
    } catch {}
    await this.viewer?.setRuntime(r);
  }
  // editar malha (na Pose base): pontos ou pintura de pesos do slot escolhido
  meshEdit = $state<MeshEdit | null>(null);
  // chaves copiadas na timeline (resultado de keys.copy): vale entre animacoes e personagens
  keyClipboard = $state.raw<{ time: number; items: any[] } | null>(null);
  private seq = 0;
  private unsub: (() => void) | null = null;

  log(a: Omit<Activity, "id" | "at">) {
    this.activity = [{ ...a, id: ++this.seq, at: Date.now() }, ...this.activity].slice(0, 200);
  }

  async loadAssets(refresh = false) {
    const r = await fetch("/api/assets" + (refresh ? "?refresh=1" : ""));
    this.assets = await r.json();
  }

  async open(asset: AssetInfo) {
    this.loading = true;
    this.error = null;
    // o que estava escondido era de outro personagem
    this.hidden = { bones: [], slots: [] };
    this.applyHidden();
    try {
      const [sk, at] = await Promise.all([fetch(fileUrl(asset.skeleton)).then(okText), fetch(fileUrl(asset.atlas)).then(okText)]);
      this.fileText = sk;
      const doc = Document.fromText(sk, { text: at, pages: {} });
      doc.file = { skeleton: asset.skeleton, atlas: asset.atlas, tres: asset.tres };
      this.unsub?.();
      this.unsub = doc.onChange((e) => this.onChange(e));
      this.doc = doc;
      this.asset = asset;
      this.selection = {};
      this.meshEdit = null;
      this.version++;
      const dir = asset.atlas.slice(0, asset.atlas.lastIndexOf("/") + 1);
      await this.viewer?.setDocument(doc, (page) => `/api/texture?p=${encodeURIComponent(dir + page)}`);
      this.log({ label: `abriu ${asset.project} / ${asset.name}`, source: "ui", kind: "info", ops: 0 });
      const d = await getDraft(asset.id);
      this.draft = d && d.base === sk && d.text !== sk ? { ...d, id: asset.id } : null;
      if (d && d.base !== sk) dropDraft(asset.id);
      try {
        localStorage.setItem("mamulengo.last", asset.id);
      } catch {}
      await this.loadFicha();
      await this.loadNotes();
    } catch (e: any) {
      this.error = String(e?.message ?? e);
      throw e;
    } finally {
      this.loading = false;
    }
  }

  private onChange(e: ChangeEvent) {
    this.version++;
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
    region: (name) => {
      const text = this.doc?.atlas.text;
      if (!text) return null;
      const r = parseAtlas(text).regions.find((x) => x.name === name);
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
      return execute(this.doc, calls, "ui", label, { merge }, this.pixels);
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
      return await executeAsync(this.doc, calls, source, label, {}, this.pixels);
    } catch (e: any) {
      if (source !== "ui") throw e;
      this.toast(String(e?.message ?? e));
      return null;
    }
  }

  // Liga um viewer (novo, ex: viewport remontado) ao documento ja aberto.
  async attachViewer(v: Viewer) {
    this.viewer = v;
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
    if (!doc?.file.skeleton) throw new Error("nada aberto");
    const text = doc.serialize();
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
      return !!this.run({ cmd: "draworder.key", args: { anim: this.play.animation, time: +this.play.time.toFixed(4), order: next } }, `ordem de ${slot}`);
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
    if (!this.asset) throw new Error("nenhum personagem aberto");
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
    if (!this.asset || !this.doc) throw new Error("nenhum personagem aberto");
    if (this.doc.dirty) await this.save(source);
    const r = await fetch("/api/versions", { method: "POST", body: JSON.stringify({ skeleton: this.asset.skeleton, label, source }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    this.versionsTick++;
    this.log({ label: `marcou a versao "${label}"`, source, kind: "info", ops: 0 });
    return j;
  }

  async diffVersion(id: string, against?: string) {
    if (!this.asset) throw new Error("nenhum personagem aberto");
    const q = new URLSearchParams({ skeleton: this.asset.skeleton, id, ...(against ? { against } : {}) });
    const r = await fetch(`/api/versions/diff?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  }

  // restaura no disco (o estado atual vira versao antes) e reabre o personagem
  async restoreVersion(id: string, source = "ui") {
    if (!this.asset || !this.doc) throw new Error("nenhum personagem aberto");
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
    if (!this.doc || !this.asset) throw new Error("nenhum personagem aberto");
    const r = await fetch("/api/ficha/draft", { method: "POST", body: JSON.stringify({ json: this.doc.json, skeleton: this.asset.skeleton, name: this.asset.name }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `nao gerou o rascunho (${r.status})`);
    return r.text();
  }

  toastMsg = $state<{ text: string; at: number } | null>(null);
  toast(text: string) {
    this.toastMsg = { text, at: Date.now() };
    this.log({ label: text, source: "ui", kind: "error", ops: 0 });
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
