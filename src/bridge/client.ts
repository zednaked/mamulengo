// Lado do editor na ponte: recebe chamadas do agente (MCP) e executa no documento
// aberto, com origem "claude", para o usuario ver acontecendo.
import { app, fileUrl } from "../app/state.svelte.ts";
import { execute, describeCommands, type Call } from "../core/commands/index.ts";
import { exportAnimation, type ExportOptions } from "../app/exporter.ts";
import { applySequence, type SequenceParam } from "../app/sequence.ts";
import { createFromPsd, updateFromPsd } from "../app/psd.ts";
void execute;

type Handler = (params: any) => Promise<any> | any;

const handlers: Record<string, Handler> = {
  help({ group, name }: { group?: string; name?: string } = {}) {
    const all = describeCommands(group);
    if (name) {
      const c = all.filter((x) => x.name === name);
      if (!c.length) throw new Error(`comando desconhecido: ${name}`);
      return c;
    }
    return group ? all : all.map(({ params, ...rest }) => rest);
  },

  async assets({ filter }: { filter?: string } = {}) {
    if (!app.assets.length) await app.loadAssets();
    const f = filter?.toLowerCase();
    return app.assets
      .filter((a) => !f || `${a.project}/${a.name}`.toLowerCase().includes(f))
      .map((a: any) => ({ id: a.id, project: a.project, name: a.name, res: a.res, ...(a.broken ? { broken: a.broken } : {}) }));
  },

  async open({ id, query }: { id?: string; query?: string }) {
    if (!app.assets.length) await app.loadAssets();
    const byId = () => (id ? app.assets.find((x) => x.id === id || x.skeleton === id || x.res === id || x.tres === id) : undefined);
    let a = byId();
    // asset criado depois da varredura (fora do editor): varre de novo antes de desistir
    if (!a && id) {
      await app.loadAssets(true);
      a = byId();
    }
    if (!a && query) {
      const q = query.toLowerCase();
      const hits = app.assets.filter((x) => `${x.project}/${x.name}`.toLowerCase().includes(q));
      if (hits.length > 1) throw new Error(`"${query}" e ambiguo: ${hits.map((h) => `${h.project}/${h.name}`).join(", ")}`);
      a = hits[0];
    }
    if (!a) throw new Error(`asset nao encontrado: ${id ?? query}. Use o id (caminho do -data.tres) que mamulengo_assets lista.`);
    if ((a as any).broken) throw new Error(`nao da para abrir: ${(a as any).broken}`);
    if (app.doc?.dirty) throw new Error(`o documento aberto tem alteracoes nao salvas (${app.asset?.name}). Salve ou descarte antes (save / discard).`);
    await app.open(a);
    return { opened: `${a.project}/${a.name}`, info: execute(app.doc!, { cmd: "skeleton.info" }, "claude")[0] };
  },

  discard() {
    const a = app.asset;
    if (!a) return { ok: true };
    app.doc!.markSaved();
    return app.open(a).then(() => ({ reopened: a.name }));
  },

  async exec({ calls, label }: { calls: Call | Call[]; label?: string }) {
    if (!app.doc) throw new Error("nenhum documento aberto (use open)");
    const results = await app.runAsync(calls, label, "claude");
    return { results, version: app.doc.version, dirty: app.doc.dirty };
  },

  // Renderiza no Godot de verdade e compara com o editor (enquadramento: fit).
  async godotCheck(p: { animation?: string | null; time?: number }) {
    const v = app.viewer;
    const doc = app.doc;
    if (!v?.skeleton || !doc?.file.tres) throw new Error("nada aberto");
    if (doc.dirty) throw new Error("ha alteracoes nao salvas: salve antes (o Godot le o arquivo do disco)");
    v.sync();
    const saved = { view: { ...v.view }, cam: { ...v.cam } };
    try {
      if (p.animation !== undefined && p.animation !== v.view.animation) v.setAnimation(p.animation);
      v.view.playing = false;
      const t = p.time ?? v.view.time;
      v.poseAt(t);
      v.frameAll();
      const w = 640,
        h = 480;
      const rect = [v.cam.x - (w / 2) / v.cam.zoom * (v.canvas.clientWidth / w), 0, 0, 0];
      // mesmo retangulo visivel do viewport, renderizado em 640x480
      const vw = v.canvas.clientWidth / v.cam.zoom,
        vh = (vw * h) / w;
      rect.splice(0, 4, v.cam.x - vw / 2, v.cam.y - vh / 2, vw, vh);
      const bg = [0.2, 0.2, 0.2];
      const ed = v.renderRect(rect, [w, h], bg);
      const r = await fetch("/api/godot/render", { method: "POST", body: JSON.stringify({ tres: doc.file.tres, animation: v.view.animation, time: t, rect, size: [w, h], background: bg }) });
      if (!r.ok) throw new Error((await r.json()).error);
      const blob = await r.blob();
      const gb = await createImageBitmap(blob);
      const c1 = new OffscreenCanvas(w, h).getContext("2d")!;
      c1.drawImage(ed, 0, 0);
      const c2 = new OffscreenCanvas(w, h).getContext("2d")!;
      c2.drawImage(gb, 0, 0);
      const a = c1.getImageData(0, 0, w, h).data,
        b = c2.getImageData(0, 0, w, h).data;
      let bad = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) bad++;
      // lado a lado: editor | godot
      const out = new OffscreenCanvas(w * 2, h);
      const g = out.getContext("2d")!;
      g.drawImage(ed, 0, 0);
      g.drawImage(gb, w, 0);
      const png = await out.convertToBlob({ type: "image/png" });
      const image = await new Promise<string>((ok) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result));
        fr.readAsDataURL(png);
      });
      return { diffPct: +((100 * bad) / (w * h)).toFixed(3), time: t, animation: v.view.animation, image, verdict: bad / (w * h) < 0.005 ? "igual ao jogo" : bad / (w * h) < 0.03 ? "praticamente igual (bordas)" : "diferente: veja a imagem" };
    } finally {
      Object.assign(v.view, saved.view);
      Object.assign(v.cam, saved.cam);
      v.poseAt(saved.view.time);
    }
  },

  async images({ dir }: { dir: string }) {
    const r = await fetch(`/api/images?dir=${encodeURIComponent(dir)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j.map((x: any) => ({ name: x.name, width: x.width, height: x.height, file: x.file }));
  },

  async createAsset(p: { dir: string; name: string; imagesFrom: string }) {
    if (app.doc?.dirty) throw new Error(`o documento aberto tem alteracoes nao salvas (${app.asset?.name}). Salve ou descarte antes.`);
    const r = await fetch("/api/asset/create", { method: "POST", body: JSON.stringify(p) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await app.loadAssets(true);
    const a = app.assets.find((x) => x.tres === j.tres);
    if (!a) throw new Error(`asset criado mas nao encontrado na varredura (a pasta esta dentro de MAMULENGO_ROOTS?): ${j.tres}`);
    await app.open(a);
    const regions = app.doc!.atlas.text ? (await import("../core/atlas-text.ts")).parseAtlas(app.doc!.atlas.text).regions.map((x) => ({ name: x.name, width: x.originalWidth, height: x.originalHeight })) : [];
    return { ...j, opened: a.name, regions };
  },

  async addImages(p: { files: string[]; names?: string[] }) {
    const atlas = app.doc?.file.atlas;
    if (!atlas) throw new Error("nenhum documento aberto");
    const r = await fetch("/api/atlas/add", { method: "POST", body: JSON.stringify({ atlas, ...p }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await app.reloadAtlas(j.atlasText);
    app.log({ label: `atlas reempacotado (${j.regions} regioes)`, source: "claude", kind: "info", ops: 0 });
    return { regions: j.regions, pages: j.pages };
  },

  // PSD em camadas: create monta um personagem novo (dir + name); update atualiza o
  // aberto (casa camada com imagem pelo nome) e salva
  async psd(p: { file: string; mode?: "create" | "update"; dir?: string; name?: string; ignoreHidden?: boolean }) {
    if (!p.file) throw new Error("file: caminho do .psd");
    const mode = p.mode ?? (p.dir ? "create" : "update");
    if (mode === "create") {
      if (!p.dir || !p.name) throw new Error("create precisa de dir (pasta do personagem dentro do projeto Godot) e name");
      const r = await createFromPsd({ psd: p.file, dir: p.dir, name: p.name, ignoreHidden: p.ignoreHidden });
      return { mode, asset: r.asset, summary: r.summary, report: r.report };
    }
    const r = await updateFromPsd({ psd: p.file, ignoreHidden: p.ignoreHidden }, "claude");
    return { mode, asset: r.asset, saved: r.saved, summary: r.summary, report: r.report };
  },

  // GIF ou WebM da animacao inteira como esta na tela; devolve o caminho gravado
  async export(p: ExportOptions) {
    if (p.format !== "gif" && p.format !== "webm") throw new Error('format: "gif" ou "webm"');
    const { onProgress: _, ...opts } = p;
    return exportAnimation(opts);
  },

  undo() {
    const t = app.doc?.undo();
    return { undone: t?.label ?? null };
  },
  redo() {
    const t = app.doc?.redo();
    return { redone: t?.label ?? null };
  },

  async save() {
    return app.save("claude");
  },

  // anotacoes do personagem: listar {abertas?} | criar {texto, anim?, tempo?, osso?} |
  // responder {id, texto} | resolver {id} | reabrir {id}. O Claude assina como "Claude".
  async notes(p: { acao: "listar" | "criar" | "responder" | "resolver" | "reabrir"; abertas?: boolean; id?: string; texto?: string; anim?: string | null; tempo?: number | null; osso?: string | null }) {
    if (!app.asset) throw new Error("nenhum personagem aberto");
    if (p.acao === "listar") {
      await app.loadNotes();
      return p.abertas ? app.notes.filter((n) => n.estado === "aberta") : app.notes;
    }
    const { acao, abertas: _, ...rest } = p;
    return app.noteAction({ acao, autor: "Claude", ...rest });
  },

  // versoes do personagem: acao listar | marcar {label} | comparar {id, against?} | restaurar {id}
  async versions(p: { acao: "listar" | "marcar" | "comparar" | "restaurar"; label?: string; id?: string; against?: string; limit?: number }) {
    if (p.acao === "listar") return (await app.versions()).slice(0, p.limit ?? 20);
    if (p.acao === "marcar") {
      if (!p.label) throw new Error("marcar precisa de label (nome da versao)");
      return app.markVersion(p.label, "claude");
    }
    if (!p.id) throw new Error(`${p.acao} precisa do id (veja listar)`);
    if (p.acao === "comparar") return app.diffVersion(p.id, p.against);
    return app.restoreVersion(p.id, "claude");
  },

  state() {
    const v = app.viewer;
    return {
      asset: app.asset ? `${app.asset.project}/${app.asset.name}` : null,
      file: app.doc?.file ?? null,
      dirty: app.doc?.dirty ?? false,
      view: v ? { ...v.view, duration: v.duration(), animationDuration: v.animDuration(), sequenceTimes: v.sequenceTimes(), camera: v.cam } : null,
      selection: app.selection,
      runtimeError: v?.error ?? null,
      history: app.doc?.history().slice(-15) ?? [],
    };
  },

  view(p: { animation?: string | null; time?: number; playing?: boolean; loop?: boolean; speed?: number; showBones?: boolean; showMeshes?: boolean; select?: { bone?: string; slot?: string }; fit?: boolean; sequence?: SequenceParam }) {
    const v = app.viewer;
    if (!v) throw new Error("viewer nao iniciado");
    // o viewer so reconstroi ao desenhar: numa aba sem quadros, a animacao recem-criada
    // ainda nao estaria nele
    v.sync();
    if (p.animation !== undefined) {
      if (p.animation && !v.data?.findAnimation(p.animation)) throw new Error(`animacao nao existe: ${p.animation}`);
      v.setAnimation(p.animation);
    }
    applySequence(v, p.sequence);
    for (const k of ["loop", "speed", "showBones", "showMeshes"] as const) if (p[k] !== undefined) (v.view as any)[k] = p[k];
    if (p.time !== undefined) v.seek(p.time);
    if (p.playing !== undefined) v.view.playing = p.playing;
    if (p.select) {
      app.selection = p.select;
      v.selection = p.select;
    }
    if (p.fit) v.frameAll();
    return handlers.state({});
  },

  // Imagem do que esta na tela. times = varios instantes numa folha de contato.
  // Frames com enquadramento exato, um PNG por instante (comparacao com o Godot).
  render(p: { animation?: string | null; times: number[]; rect?: number[]; size?: number[]; focus?: { bones?: string[]; slots?: string[]; margin?: number }; background?: number[]; shift?: number[]; sequence?: SequenceParam }) {
    const v = app.viewer;
    v?.sync();
    if (!v?.skeleton) throw new Error("nada para mostrar (abra um asset)");
    const saved = { view: { ...v.view } };
    const hid = [v.hiddenBones, v.hiddenSlots];
    v.hiddenBones = new Set();
    v.hiddenSlots = new Set();
    try {
      if (p.animation !== undefined && p.animation !== v.view.animation) v.setAnimation(p.animation);
      applySequence(v, p.sequence);
      v.view.playing = false;
      v.view.showBones = v.view.showMeshes = v.view.showBounds = false;
      const sel = v.selection;
      const overlays = v.overlays;
      v.selection = {};
      v.overlays = [];
      // marcas de "osso mexido agora" sao da tela ao vivo, nao do quadro pedido
      v.highlights = [];
      // focus: o retangulo das partes pedidas, unido em todos os instantes (mesmo quadro
      // em todos), com margem e na proporcao do tamanho pedido
      if (!p.rect && p.focus) {
        let r: number[] | null = null;
        for (const t of p.times) {
          v.poseAt(t);
          const b = v.partBounds(p.focus);
          if (!b) continue;
          if (!r) r = b;
          else {
            const x0 = Math.min(r[0], b[0]),
              y0 = Math.min(r[1], b[1]);
            r = [x0, y0, Math.max(r[0] + r[2], b[0] + b[2]) - x0, Math.max(r[1] + r[3], b[1] + b[3]) - y0];
          }
        }
        if (!r) throw new Error("nenhuma imagem visivel nessas partes (confira os nomes com query.tree)");
        const m = p.focus.margin ?? 0.25;
        const size = p.size ?? [480, 480];
        let [x, y, w, h] = [r[0] - r[2] * m, r[1] - r[3] * m, r[2] * (1 + 2 * m), r[3] * (1 + 2 * m)];
        const want = size[0] / size[1];
        if (w / h < want) (x -= (h * want - w) / 2), (w = h * want);
        else (y -= (w / want - h) / 2), (h = w / want);
        p.rect = [x, y, w, h];
        p.size = size;
      }
      if (!p.rect || !p.size) throw new Error("render precisa de rect e size, ou de focus");
      const rect0 = p.rect,
        size0 = p.size;
      const images = p.times.map((t) => {
        v.poseAt(t);
        // shift: deslocamento em pixels de tela (experimentos de alinhamento com o Godot)
        const rect = p.shift ? [rect0[0] - (p.shift[0] * rect0[2]) / size0[0], rect0[1] + (p.shift[1] * rect0[3]) / size0[1], rect0[2], rect0[3]] : rect0;
        return v.renderRect(rect, size0, p.background).toDataURL("image/png");
      });
      v.selection = sel;
      v.overlays = overlays;
      return { images, times: p.times, rect: rect0.map((x) => +x.toFixed(1)) };
    } finally {
      Object.assign(v.view, saved.view);
      [v.hiddenBones, v.hiddenSlots] = hid;
      v.poseAt(saved.view.time);
    }
  },

  // Medidas de desempenho no navegador (tools/bench.ts): reconstrucao, quadro tocando,
  // passo de arrasto (comando com merge + sync), poseAt no fim da animacao e salvar.
  // Mexe so em copias de estado e desfaz o que editou.
  async bench(p: { animation?: string; time?: number; n?: number; bone?: string }) {
    const v = app.viewer;
    const doc = app.doc;
    if (!v?.skeleton || !doc) throw new Error("nada aberto");
    const n = p.n ?? 10;
    const clean = !doc.dirty;
    const saved = { view: { ...v.view }, mode: app.mode };
    const ms = (f: () => void, k = n) => {
      f();
      const t0 = performance.now();
      for (let i = 0; i < k; i++) f();
      return +((performance.now() - t0) / k).toFixed(2);
    };
    try {
      if (p.animation !== undefined) v.setAnimation(p.animation);
      const anim = v.view.animation;
      const dur = v.duration();
      const t = p.time ?? Math.max(0, dur - 0.05);
      v.view.playing = false;
      const out: Record<string, any> = { animation: anim, duration: dur, time: t, slots: v.skeleton.slots.length, bones: v.skeleton.bones.length };
      out.rebuildMs = ms(() => v.rebuild());
      out.poseAtEndMs = ms(() => v.poseAt(t));
      // sem o atalho incremental (fisica refeita desde 0)
      out.poseAtColdMs = ms(() => (v.sim?.invalidate(), v.poseAt(t)));
      // tocando: quadro inteiro (pose + desenho), sem esperar o rAF
      v.poseAt(0);
      v.view.playing = true;
      out.frameMs = ms(() => v.frame(1 / 60), 60);
      v.view.playing = false;
      // passo de arrasto com animacao aberta: chave no tempo t, merge com a etapa anterior
      const bone = p.bone ?? v.skeleton.bones[Math.min(1, v.skeleton.bones.length - 1)].data.name;
      const merge = `bench${Date.now()}`;
      v.poseAt(t);
      let k = 0;
      const step = () => {
        execute(doc, { cmd: "key.set", args: { anim, target: { bone }, timeline: "rotate", time: +t.toFixed(4), value: ++k % 30 } }, "ui", "bench", { merge });
        v.sync();
      };
      const s0 = { ...v.stats };
      out.dragStepMs = anim ? ms(step) : null;
      // setup: mexe no osso (reconstroi e repoe no tempo atual)
      const merge2 = `bench2${Date.now()}`;
      const stepSetup = () => {
        execute(doc, { cmd: "bone.set", args: { bone, rotation: ++k % 30 } }, "ui", "bench", { merge: merge2 });
        v.sync();
      };
      out.setupStepMs = ms(stepSetup);
      out.rebuildsInDrag = v.stats.rebuilds - s0.rebuilds;
      out.serializeMs = ms(() => doc.serialize(), 5);
      out.serializedBytes = doc.serialize().length;
      // fps de verdade (rAF), tocando por 1.5 s
      v.view.playing = true;
      const f0 = performance.now();
      let frames = 0;
      await new Promise<void>((ok) => {
        const tick = () => {
          frames++;
          if (performance.now() - f0 < 1500) requestAnimationFrame(tick);
          else ok();
        };
        requestAnimationFrame(tick);
      });
      out.fps = +((frames * 1000) / (performance.now() - f0)).toFixed(1);
      return out;
    } finally {
      while (doc.history().length && doc.history()[doc.history().length - 1].label === "bench") doc.undo();
      if (clean) doc.markSaved();
      app.mode = saved.mode;
      Object.assign(v.view, saved.view);
      v.sync();
      v.poseAt(saved.view.time);
    }
  },

  look(p: { animation?: string; time?: number; times?: number[]; frames?: number; fit?: boolean; bones?: boolean; meshes?: boolean; scale?: number; sequence?: SequenceParam }) {
    const v = app.viewer;
    v?.sync();
    if (!v?.skeleton) throw new Error("nada para mostrar (abra um asset)");
    const saved = { view: { ...v.view }, cam: { ...v.cam }, selection: v.selection, overlays: v.overlays };
    // o Claude ve o personagem inteiro, mesmo com partes escondidas na tela da pessoa
    const hid = [v.hiddenBones, v.hiddenSlots];
    v.hiddenBones = new Set();
    v.hiddenSlots = new Set();
    try {
      if (p.animation !== undefined && p.animation !== v.view.animation) v.setAnimation(p.animation);
      applySequence(v, p.sequence);
      const seq = v.sequenceTimes();
      v.view.playing = false;
      // so o que foi pedido: sem selecao, gizmos ou overlays herdados da tela
      v.selection = {};
      v.overlays = [];
      // marcas de "osso mexido agora" sao da tela ao vivo, nao do quadro pedido
      v.highlights = [];
      v.view.showBones = !!p.bones;
      v.view.showMeshes = !!p.meshes;
      v.view.showBounds = false;
      let times = p.times;
      if (!times && p.frames) {
        const d = v.duration();
        // sequencia: do comeco ao fim dela (o ultimo quadro e o fim, nao o comeco de novo)
        times = Array.from({ length: p.frames }, (_, i) => +((d * i) / Math.max(1, p.frames! - (v.view.loop && !seq ? 0 : 1))).toFixed(4));
      }
      if (!times) times = [p.time ?? v.view.time];
      if (p.fit) {
        // enquadra todos os instantes pedidos (a pose do primeiro cortaria um braco erguido
        // depois), com a mesma conta do frameAll
        let box: number[] | null = null;
        for (const t of times) {
          v.poseAt(t);
          const b = v.currentBounds();
          if (b) box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[0] + box[2], b[0] + b[2]), Math.max(box[1] + box[3], b[1] + b[3])] : [b[0], b[1], b[0] + b[2], b[1] + b[3]];
        }
        if (box) v.frameRect([box[0], box[1], box[2] - box[0], box[3] - box[1]]);
        else v.frameAll();
      }
      // desenha antes de medir: o canvas so acompanha o tamanho do painel quando desenha, e
      // numa aba em segundo plano (sem quadros) ele fica com o tamanho antigo; medir antes
      // espremia cada quadro na proporcao velha
      v.poseAt(times[0]);
      v.draw();
      const scale = p.scale ?? (times.length > 1 ? 0.5 : 1);
      const cw = Math.round(v.canvas.width * scale);
      const ch = Math.round(v.canvas.height * scale);
      const cols = Math.min(times.length, times.length <= 4 ? times.length : Math.ceil(Math.sqrt(times.length)));
      const rows = Math.ceil(times.length / cols);
      const out = document.createElement("canvas");
      out.width = cw * cols;
      out.height = ch * rows;
      const g = out.getContext("2d")!;
      times.forEach((t, i) => {
        v.poseAt(t);
        v.draw();
        const x = (i % cols) * cw;
        const y = Math.floor(i / cols) * ch;
        g.drawImage(v.canvas, x, y, cw, ch);
        // na sequencia, cada quadro diz o que esta tocando: A, mix ou B
        const tag = seq ? (t < seq.start ? "" : t <= seq.end + 1e-4 ? " mix" : ` ${seq.next}`) : "";
        if (times!.length > 1 || tag) {
          g.font = "14px monospace";
          const label = `${t.toFixed(2)}s${tag}`;
          g.fillStyle = tag === " mix" ? "rgba(160,40,110,.85)" : "rgba(0,0,0,.6)";
          g.fillRect(x, y, Math.max(70, g.measureText(label).width + 12), 22);
          g.fillStyle = "#fff";
          g.fillText(label, x + 6, y + 16);
        }
      });
      // mapeamento mundo -> pixel de cada quadro (y para cima no mundo, para baixo na imagem)
      const ppu = v.cam.zoom * (v.canvas.width / v.canvas.clientWidth) * (cw / v.canvas.width);
      const map = { pixelsPerUnit: +ppu.toFixed(5), center: [+v.cam.x.toFixed(2), +v.cam.y.toFixed(2)], frame: [cw, ch], note: "px = (x - center.x)*ppu + frame.w/2; py = frame.h/2 - (y - center.y)*ppu (por quadro)" };
      const sequence = seq ? { next: seq.next, mix: seq.mix, at: v.view.sequence?.at ?? null, mixStart: +seq.start.toFixed(4), mixEnd: +seq.end.toFixed(4), total: +seq.total.toFixed(4) } : null;
      return { image: out.toDataURL("image/png"), times, animation: v.view.animation, sequence, size: [out.width, out.height], map };
    } finally {
      Object.assign(v.view, saved.view);
      Object.assign(v.cam, saved.cam);
      v.selection = saved.selection;
      v.overlays = saved.overlays;
      [v.hiddenBones, v.hiddenSlots] = hid;
      v.poseAt(saved.view.time);
    }
  },
};

export function connectBridge() {
  // ?espectador no endereco: a aba so assiste ao editor que o agente esta usando
  const spectator = new URLSearchParams(location.search).has("espectador");
  app.spectator = spectator;
  let ws: WebSocket | null = null;
  let retry = 500;
  // editor: manda o estado para os espectadores enquanto houver algum (a ponte avisa)
  let mirroring = false;
  let sentVersion = -1;
  let sentAtlas = "";
  const open = () => {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__mamulengo`);
    ws.onopen = () => {
      retry = 500;
      ws!.send(JSON.stringify({ t: "hello", role: spectator ? "espectador" : "editor", name: navigator.userAgent.includes("Headless") ? "headless" : "browser" }));
    };
    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "espelho" && spectator) return app.applyMirror(m).catch((e) => app.toast(String(e?.message ?? e)));
      if (m.t === "narracao") return app.narrate(m.text);
      if (m.t === "agente") return void (app.agentHere = !!m.aqui);
      if (m.t === "espelhar") {
        mirroring = !!m.on;
        if (m.again) (sentVersion = -1), (sentAtlas = "");
        return;
      }
      if (m.t !== "call") return;
      const h = handlers[m.method];
      app.agentConnected = true;
      try {
        // nome de comando chamado direto (ex: "query.tree"): executa como um exec de uma chamada
        let result: any;
        if (!h && m.method.includes(".")) result = (await handlers.exec({ calls: [{ cmd: m.method, args: m.params ?? {} }] })).results[0];
        else if (!h) throw new Error(`metodo desconhecido: ${m.method}. Metodos: ${Object.keys(handlers).join(", ")} (ou o nome de um comando, ex: query.tree)`);
        else result = await h(m.params ?? {});
        ws!.send(JSON.stringify({ t: "reply", id: m.id, ok: true, result }));
      } catch (e: any) {
        const error = String(e?.message ?? e);
        if (m.method === "exec") app.log({ label: error, source: "claude", kind: "error", ops: 0 });
        ws!.send(JSON.stringify({ t: "reply", id: m.id, ok: false, error }));
      }
    };
    ws.onclose = () => {
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 5000);
    };
  };
  open();
  // a janela em foco e a que recebe as chamadas
  window.addEventListener("focus", () => ws?.readyState === 1 && !spectator && ws.send(JSON.stringify({ t: "focus" })));
  // espelho: no maximo ~3 por segundo, so quando o documento mudou; o atlas vai junto so
  // quando muda (imagem nova, reempacotou)
  if (!spectator)
    setInterval(() => {
      const doc = app.doc;
      if (!mirroring || !doc || !app.asset || ws?.readyState !== 1 || app.version === sentVersion) return;
      sentVersion = app.version;
      const atlas = doc.atlas.text !== sentAtlas ? doc.atlas.text : null;
      if (atlas) sentAtlas = doc.atlas.text;
      ws.send(JSON.stringify({ t: "espelho", asset: app.asset, skeleton: doc.serialize(), atlas, activity: app.activity.slice(0, 30), animation: app.play.animation }));
    }, 330);
}

export { fileUrl };

// estado vivo (documento, ponte, WebGL): mudanca aqui recarrega a pagina inteira
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
