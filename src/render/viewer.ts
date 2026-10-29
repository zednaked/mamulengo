// Viewport: desenha o documento com o runtime oficial (spine-webgl 4.3), o mesmo
// codigo de pose/deform/fisica/clipping do spine-godot, ou (modo "nucleo") pelo nucleo
// proprio em wasm com o desenhista de src/render/nucleo.ts. A cada mudanca do documento
// reconstroi o SkeletonData; edicoes so de animacao ou de transformacao de osso na
// setup (o arrasto) sao aplicadas no SkeletonData existente, sem reler o resto. No modo
// "nucleo" nao ha esqueleto do spine-core: a pose, o desenho, a cebola, os gizmos, o clique
// e as caixas vem do nucleo (NucleoCena e a pose dela), e as edicoes rapidas vao direto ao
// modelo do nucleo (NucleoCena.remendar). Quem le a pose usa `pose` (src/render/pose.ts),
// igual nos tres modos; `skeleton` so existe nos modos "godot" e "spine" (e no modo
// "nucleo" quando o nucleo recusa o documento e o desenho volta ao spine-webgl).
import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  GLTexture,
  ManagedWebGLRenderingContext,
  Physics,
  ResizeMode,
  SceneRenderer,
  Skeleton,
  SkeletonData,
  SkeletonJson,
  TextureAtlas,
  Color,
  BlendMode,
  TextureFilter,
  MixFrom,
  type Texture,
} from "@esotericsoftware/spine-webgl";
import type { ChangeEvent, Document, Path } from "../core/document.ts";
import { PoseSim, likeSpineGodot, sequenceTimes, type Sequence } from "../core/sim.ts";
import { patchSkeletonData } from "../core/patch.ts";
import { NucleoCena } from "./nucleo.ts";
import { SpinePose, drawDebug, type PoseView, type SlotView } from "./pose.ts";

export type Runtime = "godot" | "spine" | "nucleo";

export interface ViewState {
  animation: string | null;
  time: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  showBones: boolean;
  showMeshes: boolean;
  showBounds: boolean;
  background: [number, number, number];
  // previa de transicao: depois da animacao (ou interrompendo-a) vem outra, com mix.
  // O tempo da timeline cobre a sequencia inteira.
  sequence: Sequence | null;
}

export class Viewer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: ManagedWebGLRenderingContext;
  readonly scene: SceneRenderer;
  doc: Document | null = null;
  atlas: TextureAtlas | null = null;
  data: SkeletonData | null = null;
  skeleton: Skeleton | null = null;
  // esqueleto separado para o onion skin (fantasmas dos quadros vizinhos)
  ghost: Skeleton | null = null;
  onion = { enabled: false, count: 2, step: 1 / 10 };
  state: AnimationState | null = null;
  sim: PoseSim | null = null;
  error: string | null = null;
  // o spine-godot do projeto desenha a cor escura (two-color tint)? O binario que os
  // jogos usam hoje nao desenha (medido: tools/blend-fixture.ts); o upstream 4.3 mais
  // novo desenha. Vem do servidor (x-godot-tint-black), que olha o binario do projeto.
  godotTintBlack = false;
  // copia sem premultiplicar de cada pagina (modo godot): o multiply do Godot usa o RGB
  // da textura mesmo onde o alpha e 0
  private straight = new Map<Texture, { bmp: ImageBitmap; page: any; tex: GLTexture | null }>();
  // caminhos editados desde a ultima reconstrucao (null: reconstruir tudo)
  private pending: Path[] | null = null;
  private unsubDoc: (() => void) | null = null;
  // contadores (tools/bench.ts)
  stats = { rebuilds: 0, patches: 0 };
  // "godot": reproduz o spine-godot (medido com tools/parity.ts): alpha simples mesmo
  // com pma:true, esqueleto com scaleY -1 (inverte a gravidade da fisica).
  // "spine": como o editor do Spine (respeita pma, y para cima).
  // "nucleo": o nucleo proprio (wasm) e o nosso desenho, com a semantica do jogo (o template
  // web e o modulo Godot): multiply e screen certos, pma desfeito, fisica no sentido do jogo.
  // Troque com setRuntime (recarrega as texturas).
  runtime: Runtime = "godot";
  nucleo: NucleoCena | null = null;
  // o nucleo recusou o documento (o desenho volta ao spine-webgl enquanto isso)
  nucleoError: string | null = null;
  // tempo do nucleo no ultimo quadro (pose e desenho), em ms
  nucleoMs = { pose: 0, draw: 0 };
  private urlFor: ((page: string) => string) | null = null;
  // o nucleo da a pose e o desenho (modo "nucleo" com o documento aceito)
  get useNucleo() {
    return this.runtime === "nucleo" && !!this.nucleo && !this.nucleoError;
  }
  private spinePose: SpinePose | null = null;
  // a pose atual para ler (clique, gizmos, caixas, camadas), do nucleo ou do spine-core
  get pose(): PoseView | null {
    if (this.useNucleo) return this.nucleo!.pose;
    return this.skeleton ? (this.spinePose ??= new SpinePose(this.skeleton)) : null;
  }
  // experimento: o Godot gera mipmaps em runtime para filtro "com mipmaps"? (parity)
  godotMipmaps = false;
  get flip() {
    return this.runtime === "godot";
  }
  // de onde veio cada pagina do atlas (godot-import ou source)
  textureInfo: Record<string, { origin: string; note: string | null }> = {};
  view: ViewState = { animation: null, time: 0, playing: true, loop: true, speed: 1, showBones: false, showMeshes: false, showBounds: false, background: [0.13, 0.12, 0.16], sequence: null };
  // camera: centro em coordenadas do esqueleto e zoom (pixels por unidade)
  cam = { x: 0, y: 0, zoom: 1 };
  private builtVersion = -1;
  private last = 0;
  private raf = 0;
  private listeners = new Set<() => void>();
  // destaques temporarios (o que o Claude acabou de mexer)
  highlights: { bone?: string; slot?: string; until: number; color: Color }[] = [];
  selection: { bone?: string; slot?: string } = {};
  // desenhos extras por cima (gizmos), chamados dentro do frame
  overlays: ((v: Viewer) => void)[] = [];
  // mostra so a setup pose (editar malha): a animacao fica escolhida mas parada
  setupOnly = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // stencil: o recorte do desenho do nucleo
    this.ctx = new ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, stencil: true });
    this.scene = new SceneRenderer(canvas, this.ctx, true);
    this.scene.skeletonDebugRenderer.drawRegionAttachments = false;
    this.scene.skeletonDebugRenderer.drawClipping = true;
    this.scene.skeletonDebugRenderer.drawPaths = true;
    this.scene.skeletonDebugRenderer.drawBoundingBoxes = false;
    // no modo godot o esqueleto roda invertido (scaleY -1): projecao * diag(1,-1) leva
    // de volta para a tela em y para cima. Precisa estar no update da camera porque o
    // SceneRenderer.begin() o chama de novo.
    // o spine-godot desenha o blend screen com o material BLEND_MODE_SUB do Godot
    // (SpineSprite.cpp): resultado = destino - cor * alpha. A equacao de subtracao fica
    // ativa so durante slots screen.
    const batcher = this.scene.batcher as any;
    const setBlend = batcher.setBlendMode.bind(batcher);
    let subtracting = false;
    // multiply do Godot (CanvasItemMaterial BLEND_MODE_MUL, alvo opaco): destino *
    // cor da fonte, sem premultiplicar e sem olhar o alpha. Desenha com a copia sem
    // premultiplicar da textura e alpha 1 no vertice (drawMain forca); o alpha do
    // destino fica como esta.
    let multiplying = false;
    const draw = batcher.draw.bind(batcher);
    batcher.draw = (texture: Texture, vertices: Float32Array, indices: number[]) => {
      if (multiplying) {
        texture = this.straightOf(texture);
        // two-color: dark.a 0 faz o shader do spine-webgl virar a formula do Godot
        // sem premultiplicar: tex*light + (1 - tex)*dark
        for (let i = 11; i < vertices.length; i += 12) vertices[i] = 0;
      }
      draw(texture, vertices, indices);
    };
    const equation = (sub: boolean) => {
      if (sub === subtracting) return;
      if (batcher.isDrawing) batcher.flush();
      const gl = this.ctx.gl;
      gl.blendEquation(sub ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_ADD);
      subtracting = sub;
    };
    batcher.setBlendMode = (mode: BlendMode) => {
      const sub = this.flip && mode === BlendMode.Screen;
      const mul = this.flip && mode === BlendMode.Multiply;
      equation(sub);
      if (mul !== multiplying && batcher.isDrawing) batcher.flush();
      multiplying = mul;
      if (mul) {
        this.ctx.gl.blendFuncSeparate(this.ctx.gl.DST_COLOR, this.ctx.gl.ZERO, this.ctx.gl.ZERO, this.ctx.gl.ONE);
        batcher.srcColorBlend = -1;
        return;
      }
      if (!sub) return setBlend(mode);
      if (batcher.isDrawing) batcher.flush();
      // cor ja vem multiplicada pelo alpha (pipeline premultiplicado): dst - src
      this.ctx.gl.blendFuncSeparate(this.ctx.gl.ONE, this.ctx.gl.ONE, this.ctx.gl.ZERO, this.ctx.gl.ONE);
      batcher.srcColorBlend = -1; // forca o proximo setBlendMode normal a reaplicar
    };
    const begin = this.scene.begin.bind(this.scene);
    this.scene.begin = () => {
      equation(false);
      multiplying = false;
      begin();
    };
    const cam = this.scene.camera;
    const update = cam.update.bind(cam);
    cam.update = () => {
      update();
      if (this.flip) {
        const m = cam.projectionView.values;
        for (let i = 4; i < 8; i++) m[i] = -m[i];
      }
    };
  }

  onFrame(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Carrega texturas das paginas do atlas. urlFor resolve o nome da pagina.
  async setDocument(doc: Document, urlFor: (page: string) => string) {
    this.doc = doc;
    this.urlFor = urlFor;
    const nucleo = this.runtime === "nucleo";
    // texels do arquivo (sem pre-multiplicar, com o fix_alpha_border se for o caso) para o nucleo
    const crus = new Map<string, ImageBitmap>();
    this.unsubDoc?.();
    this.unsubDoc = doc.onChange((e) => this.noteChange(e));
    const atlas = new TextureAtlas(doc.atlas.text);
    for (const s of this.straight.values()) (s.tex?.dispose(), s.bmp.close());
    this.straight.clear();
    let tintBlack = false;
    // Texels como o jogo ve: a ponte serve o .ctex importado pelo Godot quando existe;
    // senao a fonte, e aqui emulamos o fix_alpha_border do import.
    // O spine-webgl desenha sempre premultiplicado: paginas tratadas como pma sobem cruas;
    // as demais sao premultiplicadas no createImageBitmap, porque
    // UNPACK_PREMULTIPLY_ALPHA_WEBGL (que o GLTexture usaria) e ignorado para ImageBitmap.
    this.textureInfo = {};
    await Promise.all(
      atlas.pages.map(async (page) => {
        const r = await fetch(urlFor(page.name));
        if (!r.ok) throw new Error(`pagina do atlas nao carregou: ${page.name}`);
        const origin = r.headers.get("x-texture-origin") ?? "source";
        const fix = r.headers.get("x-fix-alpha-border") === "true";
        const note = r.headers.get("x-texture-note");
        if (r.headers.get("x-godot-tint-black") === "true") tintBlack = true;
        this.textureInfo[page.name] = { origin, note: note ? decodeURIComponent(note) : null };
        // "godot": o spine-godot (medido com tools/parity.ts) ignora pma:true do atlas e
        // desenha com alpha simples; "atlas" respeita o pma declarado (como o Spine).
        const pma = page.pma && this.runtime !== "godot";
        const premultiplyAlpha = pma ? "none" : "premultiply";
        let bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
        if (nucleo) crus.set(page.name, fix ? await fixAlphaBorder(bmp, false) : bmp);
        let premultiplied = pma;
        if (fix) {
          // fix_alpha_border poe cor sob alpha 0; premultiplica na mao (recriar o
          // ImageBitmap com premultiplyAlpha nao zera essa cor e ela vazaria no blend)
          bmp = await fixAlphaBorder(bmp, !pma);
          premultiplied = true;
        }
        // copia sem premultiplicar (com o fix_alpha_border, se for o caso) para o multiply
        let straight: ImageBitmap | null = null;
        if (this.runtime === "godot") {
          const raw = { premultiplyAlpha: "none", colorSpaceConversion: "none" } as const;
          straight = fix ? await fixAlphaBorder(await createImageBitmap(bmp, raw), false) : await createImageBitmap(bmp, raw);
        }
        if (!premultiplied) bmp = await createImageBitmap(bmp, { premultiplyAlpha });
        // modo godot: o filtro vem do projeto Godot, nao do atlas
        const gf = r.headers.get("x-godot-filter") ?? "linear";
        const mip = this.runtime === "godot" && gf.endsWith("mipmaps") && this.godotMipmaps;
        const tex = new GLTexture(this.ctx, bmp, true, mip);
        if (this.runtime === "godot") {
          const near = gf.startsWith("nearest");
          page.magFilter = near ? TextureFilter.Nearest : TextureFilter.Linear;
          page.minFilter = mip ? (near ? TextureFilter.MipMapNearestNearest : TextureFilter.MipMapLinearLinear) : page.magFilter;
        }
        page.setTexture(tex);
        if (straight) this.straight.set(tex, { bmp: straight, page, tex: null });
      }),
    );
    this.godotTintBlack = tintBlack;
    this.nucleo?.limparTexturas();
    this.nucleoError = null;
    if (nucleo) {
      try {
        this.nucleo ??= await NucleoCena.criar(this.ctx.gl);
        const gl = this.ctx.gl;
        for (const page of atlas.pages) {
          const img = crus.get(page.name);
          // o filtro da pagina do atlas (o mesmo que o spine-webgl usa)
          if (img) this.nucleo.poeTextura(page.name, img, { min: page.minFilter ?? gl.LINEAR, mag: page.magFilter ?? gl.LINEAR });
        }
      } catch (e: any) {
        this.nucleoError = String(e?.message ?? e);
      }
    }
    this.atlas = atlas;
    this.builtVersion = -1;
    this.view.animation = null;
    this.rebuild();
    this.frameAll();
  }

  // Reconstroi a partir do JSON mantendo animacao e tempo.
  rebuild() {
    if (!this.doc || !this.atlas) return;
    this.pending = [];
    this.stats.rebuilds++;
    this.mover.clear();
    if (this.runtime === "nucleo" && this.nucleo && this.loadNucleo()) {
      // o nucleo aceitou: nada do spine-core (nem SkeletonData, nem Skeleton)
      this.dropSpine();
      this.error = null;
      const has = (n: string) => this.nucleo!.temAnimacao(n);
      if (this.view.animation && !has(this.view.animation)) this.view.animation = null;
      if (this.view.sequence && (!this.view.animation || !has(this.view.sequence.next))) this.view.sequence = null;
      // a primeira animacao so ao abrir o documento: depois, sem animacao e a Pose base
      const first = this.nucleo.info?.animacoes[0]?.nome;
      if (!this.view.animation && first && this.builtVersion === -1) this.view.animation = first;
      this.poseAt(this.view.time);
      this.builtVersion = this.doc.version;
      return;
    }
    try {
      const data = new SkeletonJson(new AtlasAttachmentLoader(this.atlas)).readSkeletonData(this.doc.json);
      this.data = data;
      this.skeleton = new Skeleton(data);
      this.spinePose = null;
      // o spine-godot desenha com y para baixo invertendo o esqueleto; a projecao da
      // camera desfaz a inversao (draw), entao a tela continua em y para cima
      if (this.flip) this.skeleton.scaleY = -1;
      this.ghost = new Skeleton(data);
      if (this.flip) this.ghost.scaleY = -1;
      this.state = new AnimationState(new AnimationStateData(data));
      // mix como o spine-godot (so faz diferenca na previa de transicao)
      if (this.flip) likeSpineGodot(this.state);
      this.sim = new PoseSim(this.skeleton, this.state);
      if (this.view.animation && !data.findAnimation(this.view.animation)) this.view.animation = null;
      if (this.view.sequence && (!this.view.animation || !data.findAnimation(this.view.sequence.next))) this.view.sequence = null;
      // a primeira animacao so ao abrir o documento: depois, sem animacao e a Pose base (uma
      // edicao estrutural na Pose base, como mexer na malha, nao pode abrir uma animacao)
      if (!this.view.animation && data.animations.length && this.builtVersion === -1) this.view.animation = data.animations[0].name;
      this.error = null;
      this.poseAt(this.view.time);
    } catch (e: any) {
      // documento invalido para o runtime: mostra o erro e mantem o ultimo esqueleto
      this.error = String(e?.message ?? e);
    }
    this.builtVersion = this.doc.version;
  }

  // o documento inteiro no nucleo (modo "nucleo"); em erro o desenho volta ao spine-webgl
  private loadNucleo(): boolean {
    if (this.runtime !== "nucleo" || !this.nucleo || !this.doc) return false;
    try {
      this.nucleo.carregar(this.doc.json, this.doc.atlas.text, this.doc.file?.skeleton?.split("/").pop() ?? "");
      this.nucleoError = null;
      return true;
    } catch (e: any) {
      this.nucleoError = String(e?.message ?? e);
      return false;
    }
  }

  private dropSpine() {
    this.data = null;
    this.skeleton = null;
    this.ghost = null;
    this.state = null;
    this.sim = null;
    this.spinePose = null;
  }

  // Troca o modo de desenho mantendo animacao, tempo e camera (recarrega as texturas, que
  // dependem do modo).
  async setRuntime(r: Runtime) {
    if (r === this.runtime) return;
    this.runtime = r;
    if (!this.doc || !this.urlFor) return;
    const keep = { view: { ...this.view }, cam: { ...this.cam } };
    await this.setDocument(this.doc, this.urlFor);
    Object.assign(this.view, keep.view);
    Object.assign(this.cam, keep.cam);
    // a animacao e a sequencia so valem se existem no que foi carregado
    if (this.view.animation && !this.hasAnimation(this.view.animation)) this.view.animation = null;
    if (this.view.sequence && !this.hasAnimation(this.view.sequence.next)) this.view.sequence = null;
    this.invalidatePose();
    this.poseAt(this.view.time);
  }

  // esquece os atalhos da pose (checkpoints): o estado mudou por fora
  invalidatePose() {
    this.sim?.invalidate();
    this.nucleo?.invalidar();
  }

  hasAnimation(name: string): boolean {
    return this.useNucleo ? this.nucleo!.temAnimacao(name) : !!this.data?.findAnimation(name);
  }

  // nomes das animacoes do que esta carregado
  animationNames(): string[] {
    if (this.useNucleo) return this.nucleo!.info?.animacoes.map((a) => a.nome) ?? [];
    return this.data?.animations.map((a) => a.name) ?? [];
  }

  // caminhos tocados por uma mudanca (para saber se da para remendar)
  private noteChange(e: ChangeEvent) {
    const pending = this.pending;
    if (pending === null) return;
    const add = (ops: { path: Path }[]) => {
      for (const o of ops) pending.push(o.path);
    };
    add(e.tx.ops);
    add(e.tx.inverse);
    // etapa de arrasto: a anterior foi desfeita em silencio
    if (e.replaced) add(e.replaced.ops);
    if (pending.length > 2000) this.pending = null;
  }

  // Remenda o SkeletonData existente quando a mudanca e so em animacoes (rele so
  // essas animacoes) ou em transformacao de osso na setup. Devolve false se precisa
  // reconstruir tudo.
  private patch(): boolean {
    const paths = this.pending;
    const doc = this.doc;
    const data = this.data;
    if (!paths || !doc || this.error) return false;
    if (this.useNucleo) {
      // as mesmas mudancas direto no modelo do nucleo; se nao der, rebuild rele o documento
      if (!this.nucleo!.remendar(doc.json, paths)) return false;
    } else {
      if (!data || !this.atlas || !this.skeleton) return false;
      if (!patchSkeletonData(data, doc.json, paths, new SkeletonJson(new AtlasAttachmentLoader(this.atlas)))) return false;
    }
    this.pending = [];
    this.stats.patches++;
    this.invalidatePose();
    this.poseAt(this.view.time);
    this.builtVersion = doc.version;
    return true;
  }

  // reconstroi ja se o documento mudou (sem esperar o proximo frame)
  sync() {
    if (this.doc && this.doc.version !== this.builtVersion && !this.patch()) this.rebuild();
  }

  // duracao do que a timeline mostra: a animacao, ou a sequencia inteira
  duration(): number {
    return this.sequenceTimes()?.total ?? this.animDuration();
  }

  animDuration(name = this.view.animation): number {
    if (!name) return 0;
    if (this.useNucleo) return this.nucleo!.duracao(name);
    return this.data?.findAnimation(name)?.duration ?? 0;
  }

  // onde o mix comeca e termina na sequencia (null sem sequencia)
  sequenceTimes() {
    const s = this.view.sequence;
    if (!s || !this.view.animation || !this.hasAnimation(s.next)) return null;
    return { ...sequenceTimes(this.animDuration(), this.animDuration(s.next), s), next: s.next, durA: this.animDuration() };
  }

  // liga, muda ou desliga a previa de transicao, mantendo o tempo
  setSequence(seq: Sequence | null) {
    if (seq && !this.hasAnimation(seq.next)) throw new Error(`animacao nao existe: ${seq.next}`);
    this.view.sequence = seq ? { ...seq } : null;
    this.invalidatePose();
    this.poseAt(Math.min(this.view.time, this.duration()));
  }

  // Pose deterministica no tempo t: setup + animacao desde 0 em passos fixos, para
  // a fisica chegar no mesmo estado que chegaria tocando (igual ao jogo). Ver PoseSim.
  poseAt(t: number) {
    this.view.time = t;
    if (this.useNucleo) {
      const t0 = performance.now();
      // a sequencia so vale se a animacao seguinte existe (a mesma checagem do sequenceTimes)
      const seq = this.view.sequence && this.view.animation && this.hasAnimation(this.view.sequence.next) ? this.view.sequence : null;
      this.nucleo!.poseAt(this.view.animation, this.view.loop, t, seq);
      this.nucleoMs.pose = performance.now() - t0;
    } else this.sim?.poseAt(this.view.animation, this.view.loop, t, this.view.sequence);
  }

  // trocar de animacao desliga a previa de transicao
  setAnimation(name: string | null) {
    if (name !== this.view.animation) this.view.sequence = null;
    this.view.animation = name;
    this.poseAt(0);
  }

  seek(t: number) {
    this.view.playing = false;
    this.poseAt(Math.max(0, t));
  }

  start() {
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  frame(dt: number) {
    this.sync();
    const sk = this.skeleton;
    const st = this.state;
    if ((this.useNucleo || (sk && st)) && this.view.playing && this.view.animation && !this.setupOnly) {
      const dur = this.duration();
      // animacao sem chaves (duracao 0): tocar nao tem o que mostrar, o relogio fica parado
      // onde a pessoa escolheu na regua (a primeira chave pode ir em qualquer instante)
      const d = dur > 0 ? dt * this.view.speed : 0;
      let t = this.view.time + d;
      if (dur > 0 && t > dur) {
        if (this.view.loop) {
          // volta ao inicio de forma deterministica (mesmo estado que poseAt)
          this.poseAt(t % dur);
          t = this.view.time;
        } else {
          this.poseAt(dur);
          this.view.playing = false;
          t = dur;
        }
      } else if (this.view.sequence) {
        // sequencia: sempre a conta deterministica (a troca depende do passo); tocando
        // para frente e barato (continua do ultimo passo inteiro)
        this.poseAt(t);
      } else {
        // passo de tamanho livre: o estado sai da sequencia de passos fixos
        if (this.useNucleo) {
          const t0 = performance.now();
          this.nucleo!.passo(d);
          this.nucleoMs.pose = performance.now() - t0;
        } else if (sk && st) {
          this.sim?.invalidate();
          st.update(d);
          st.apply(sk);
          sk.update(d);
          sk.updateWorldTransform(Physics.update);
        }
      }
      this.view.time = t;
    }
    this.draw();
    for (const fn of this.listeners) fn();
  }

  // render fora da tela com tamanho exato (comparacao com o Godot, snapshots)
  fixed: { w: number; h: number } | null = null;

  draw() {
    const { scene, canvas } = this;
    const dpr = this.fixed ? 1 : window.devicePixelRatio || 1;
    const w = this.fixed?.w ?? Math.round(canvas.clientWidth * dpr);
    const h = this.fixed?.h ?? Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const gl = this.ctx.gl;
    gl.viewport(0, 0, w, h);
    const [r, g, b] = this.view.background;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    scene.camera.position.x = this.cam.x;
    scene.camera.position.y = this.cam.y;
    scene.camera.viewportWidth = w;
    scene.camera.viewportHeight = h;
    scene.camera.zoom = 1 / (this.cam.zoom * dpr);
    scene.begin();
    const pose = this.pose;
    if (pose) {
      if (this.useNucleo) {
        // o desenho do nucleo (cebola e personagem) no mesmo contexto e com a mesma camera; o
        // spine-webgl volta depois so para os gizmos
        scene.end();
        this.drawOnionNucleo();
        this.drawNucleo();
        scene.begin();
      } else {
        this.drawOnion();
        this.drawMain(this.skeleton!);
      }
      const dbg = scene.skeletonDebugRenderer;
      if (this.view.showBones || this.view.showMeshes || this.view.showBounds) {
        if (this.useNucleo) {
          const shapes = (scene as any).shapes;
          (scene as any).enableRenderer(shapes);
          drawDebug(shapes, this.ctx.gl, pose, { bones: this.view.showBones, meshHull: this.view.showMeshes, meshTriangles: this.view.showMeshes, boundingBoxes: this.view.showBounds, paths: dbg.drawPaths, clipping: dbg.drawClipping, scale: dbg.scale, boneWidth: dbg.boneWidth });
        } else {
          dbg.drawBones = this.view.showBones;
          dbg.drawMeshHull = this.view.showMeshes;
          dbg.drawMeshTriangles = this.view.showMeshes;
          dbg.drawBoundingBoxes = this.view.showBounds;
          scene.drawSkeletonDebug(this.skeleton!);
        }
      }
      this.drawHighlights(pose);
      for (const o of this.overlays) o(this);
    }
    scene.end();
  }

  // Esqueleto principal com as diferencas do spine-godot que dependem do slot: sem
  // two-color tint no binario do jogo a cor escura nao aparece; no multiply o Godot
  // ignora o alpha (do slot, do attachment e da textura).
  // so na tela: ossos (com tudo o que pende deles) e camadas que a pessoa escondeu com o
  // olho; nada disso vai para o arquivo
  hiddenBones = new Set<string>();
  hiddenSlots = new Set<string>();
  // o osso que move a imagem: o dono do slot, ou numa malha com pesos o que mais puxa
  // (em rigs de animador as imagens ficam na raiz e quem move e o osso do braco)
  // por slot e parte (`indice|nome`): o indice do osso que mais puxa a malha com pesos
  private mover = new Map<string, number>();
  private moverOf(pose: PoseView, slot: SlotView) {
    const part = slot.part;
    if (!part?.weighted) return slot.bone;
    const key = `${slot.index}|${part.name}`;
    let idx = this.mover.get(key);
    if (idx === undefined) {
      const sum = new Map<number, number>();
      for (const v of pose.weights(slot) ?? []) for (const [b, w] of v) sum.set(b, (sum.get(b) ?? 0) + w);
      idx = [...sum].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
      this.mover.set(key, idx);
    }
    return idx >= 0 ? (pose.bones[idx] ?? slot.bone) : slot.bone;
  }
  isSlotHidden(slot: SlotView): boolean {
    if (this.hiddenSlots.has(slot.name)) return true;
    const pose = this.pose;
    if (!this.hiddenBones.size || !pose) return false;
    for (const start of [slot.bone, this.moverOf(pose, slot)]) for (let b: any = start; b; b = b.parent) if (this.hiddenBones.has(b.name)) return true;
    return false;
  }

  private drawNucleo() {
    const t0 = performance.now();
    const pose = this.nucleo!.pose!;
    const hidden = this.hiddenBones.size || this.hiddenSlots.size ? (i: number) => this.isSlotHidden(pose.slots[i]) : null;
    this.nucleo!.desenhar(this.scene.camera.projectionView.values, hidden);
    this.nucleoMs.draw = performance.now() - t0;
  }

  private drawMain(sk: Skeleton) {
    const hide: (() => void)[] = [];
    if ((this.hiddenBones.size || this.hiddenSlots.size) && this.spinePose)
      for (const sv of this.spinePose.slots) {
        if (!this.isSlotHidden(sv)) continue;
        const pose = sv.slot.appliedPose;
        const att = pose.attachment;
        (pose as any).attachment = null;
        hide.push(() => ((pose as any).attachment = att));
      }
    try {
      this.drawMainVisible(sk);
    } finally {
      for (const r of hide) r();
    }
  }

  private drawMainVisible(sk: Skeleton) {
    if (!this.flip) return this.scene.drawSkeleton(sk);
    const restore: (() => void)[] = [];
    for (const slot of sk.slots) {
      const pose = slot.appliedPose;
      if (pose.darkColor && !this.godotTintBlack) {
        const dark = pose.darkColor;
        pose.darkColor = null;
        restore.push(() => (pose.darkColor = dark));
      }
      if (slot.data.blendMode === BlendMode.Multiply) {
        const att = pose.attachment as any;
        const ca = pose.color.a;
        const aa = att?.color?.a;
        pose.color.a = 1;
        if (att?.color) att.color.a = 1;
        restore.push(() => {
          pose.color.a = ca;
          if (att?.color) att.color.a = aa;
        });
      }
    }
    try {
      this.scene.drawSkeleton(sk);
    } finally {
      for (const r of restore) r();
    }
  }

  // textura sem premultiplicar equivalente a uma pagina (criada no primeiro uso)
  private straightOf(t: Texture): Texture {
    const s = this.straight.get(t);
    if (!s) return t;
    if (!s.tex) {
      s.tex = new GLTexture(this.ctx, s.bmp, true, (t as any).useMipMaps);
      s.tex.setFilters(s.page.minFilter, s.page.magFilter);
      s.tex.setWraps(s.page.uWrap, s.page.vWrap);
    }
    return s.tex;
  }

  // fantasmas antes (vermelho) e depois (verde) do tempo atual; sem fisica (pose direta)
  private drawOnion() {
    const g = this.ghost;
    const anim = this.view.animation ? this.data?.findAnimation(this.view.animation) : null;
    if (!g || !anim) return;
    for (const f of this.onionFrames()) {
      g.setupPose();
      anim.apply(g, 0, f.t, this.view.loop, [], 1, MixFrom.setup, false, false, false);
      g.updateWorldTransform(Physics.pose);
      g.color.set(...f.color);
      this.scene.drawSkeleton(g);
    }
  }

  // os instantes e as cores dos fantasmas da cebola (vazio quando ela nao aparece)
  private onionFrames(): { t: number; color: [number, number, number, number] }[] {
    const name = this.view.animation;
    if (!this.onion.enabled || !name || !this.hasAnimation(name) || this.view.playing || this.setupOnly || this.view.sequence) return [];
    const dur = this.animDuration(name) || 1;
    const out: { t: number; color: [number, number, number, number] }[] = [];
    for (let k = -this.onion.count; k <= this.onion.count; k++) {
      if (!k) continue;
      let t = this.view.time + k * this.onion.step;
      if (this.view.loop) t = ((t % dur) + dur) % dur;
      else if (t < 0 || t > dur) continue;
      const fade = 0.35 * (1 - (Math.abs(k) - 1) / this.onion.count);
      out.push({ t, color: k < 0 ? [1, 0.45, 0.45, fade] : [0.4, 1, 0.55, fade] });
    }
    return out;
  }

  // a cebola pelo nucleo: a mesma pose direta (sem fisica) numa instancia so dos fantasmas
  private drawOnionNucleo() {
    const name = this.view.animation;
    if (!name) return;
    for (const f of this.onionFrames()) this.nucleo!.desenharFantasma(name, f.t, this.view.loop, f.color, this.scene.camera.projectionView.values);
  }

  private drawHighlights(pose: PoseView) {
    const now = performance.now();
    this.highlights = this.highlights.filter((h) => h.until > now);
    const marks = [...this.highlights];
    if (this.selection.bone) marks.push({ bone: this.selection.bone, until: Infinity, color: new Color(1, 0.35, 0.75, 1) });
    for (const h of marks) {
      if (!h.bone) continue;
      const p = pose.findBone(h.bone);
      if (!p) continue;
      const len = Math.max(p.length, 12 / this.cam.zoom);
      const x2 = p.worldX + p.a * len;
      const y2 = p.worldY + p.c * len;
      const fade = h.until === Infinity ? 1 : Math.min(1, (h.until - now) / 400);
      const c = new Color(h.color.r, h.color.g, h.color.b, fade);
      const thick = 3 / this.cam.zoom;
      this.scene.line(p.worldX, p.worldY, x2, y2, c);
      this.scene.circle(true, p.worldX, p.worldY, thick * 2, c);
    }
  }

  highlight(target: { bone?: string; slot?: string }, ms = 900, color = new Color(0.3, 0.9, 1, 1)) {
    this.highlights.push({ ...target, until: performance.now() + ms, color });
  }

  // Enquadra o esqueleto inteiro (bounds da pose atual, ou do skeleton.json).
  frameAll(margin = 1.15) {
    this.sync();
    let x = 0,
      y = 0,
      w = 0,
      h = 0;
    const b = this.pose?.bounds();
    if (b) [x, y, w, h] = b;
    // bounds do runtime estao no espaco do esqueleto (invertido no modo godot)
    if (w && h && this.flip) y = -(y + h);
    const s = this.doc?.json.skeleton;
    if ((!w || !h) && s?.width) [x, y, w, h] = [s.x ?? 0, s.y ?? 0, s.width, s.height];
    if (!w || !h) [x, y, w, h] = [-200, -200, 400, 400];
    this.cam.x = x + w / 2;
    this.cam.y = y + h / 2;
    const cw = this.canvas.clientWidth || 800;
    const ch = this.canvas.clientHeight || 600;
    this.cam.zoom = Math.min(cw / (w * margin), ch / (h * margin));
  }

  // Enquadra um retangulo do mundo [x,y,w,h] (y para cima), com folga
  frameRect(r: number[], margin = 1.15) {
    this.cam.x = r[0] + r[2] / 2;
    this.cam.y = r[1] + r[3] / 2;
    const cw = this.canvas.clientWidth || 800;
    const ch = this.canvas.clientHeight || 600;
    this.cam.zoom = Math.min(cw / (r[2] * margin), ch / (r[3] * margin));
  }

  // Retangulo do mundo [x,y,w,h] (y para cima) de tudo o que aparece na pose atual.
  currentBounds(): number[] | null {
    const b = this.pose?.bounds();
    if (!b) return null;
    const y = this.flip ? -(b[1] + b[3]) : b[1];
    return [b[0], y, b[2], b[3]];
  }

  // Retangulo do mundo [x,y,w,h] (y para cima) das imagens visiveis de um osso (com os
  // filhos) e/ou de partes, na pose atual: para recortar mao, rosto, oculos de perto.
  partBounds(p: { bones?: string[]; slots?: string[] }): number[] | null {
    const pose = this.pose;
    if (!pose) return null;
    const want = new Set<string>(p.slots ?? []);
    if (p.bones?.length) {
      const under = (b: any): boolean => !!b && (p.bones!.includes(b.name) || under(b.parent));
      const idx = new Set(pose.bones.filter(under).map((b) => b.index));
      for (const s of pose.slots) {
        if (under(s.bone)) want.add(s.name);
        // malha com pesos presa a outro osso (o braco no root) mas puxada por estes ossos
        const k = s.part?.kind;
        if (k === "mesh" || k === "linkedmesh") for (const w of pose.weights(s) ?? []) if (w.some(([b]) => idx.has(b))) want.add(s.name);
      }
    }
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const v: number[] = [];
    for (const s of pose.slots) {
      if (!want.has(s.name)) continue;
      const k = s.part?.kind;
      if (!k || s.color.a <= 0) continue;
      if (k !== "region" && k !== "mesh" && k !== "linkedmesh") continue;
      const n = pose.vertices(s, v);
      for (let i = 0; i < n; i += 2) {
        const y = this.flip ? -v[i + 1] : v[i + 1];
        x0 = Math.min(x0, v[i]);
        x1 = Math.max(x1, v[i]);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    return isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
  }

  // tela (px CSS) -> coordenadas do esqueleto
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: this.cam.x + (sx - r.left - r.width / 2) / this.cam.zoom, y: this.cam.y - (sy - r.top - r.height / 2) / this.cam.zoom };
  }

  // tela -> espaco do esqueleto em runtime (onde estao bone.worldX/Y e os vertices)
  screenToSkel(sx: number, sy: number): { x: number; y: number } {
    const w = this.screenToWorld(sx, sy);
    return this.flip ? { x: w.x, y: -w.y } : w;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + r.width / 2 + (x - this.cam.x) * this.cam.zoom, y: r.top + r.height / 2 - (y - this.cam.y) * this.cam.zoom };
  }

  // Renderiza o retangulo do mundo [x,y,w,h] (y para cima) num tamanho exato.
  renderRect(rect: number[], size: number[], background?: number[]): HTMLCanvasElement {
    const saved = { cam: { ...this.cam }, bg: this.view.background };
    this.fixed = { w: size[0], h: size[1] };
    this.cam.x = rect[0] + rect[2] / 2;
    this.cam.y = rect[1] + rect[3] / 2;
    this.cam.zoom = size[0] / rect[2];
    if (background) this.view.background = background as [number, number, number];
    this.draw();
    const out = document.createElement("canvas");
    out.width = size[0];
    out.height = size[1];
    out.getContext("2d")!.drawImage(this.canvas, 0, 0, size[0], size[1], 0, 0, size[0], size[1]);
    this.fixed = null;
    Object.assign(this.cam, saved.cam);
    this.view.background = saved.bg;
    return out;
  }

  // PNG do frame atual (para o Claude ver o que fez)
  snapshot(): string {
    this.draw();
    return this.canvas.toDataURL("image/png");
  }
}

export { ResizeMode };

// Image::fix_alpha_edges do Godot (import com process/fix_alpha_border): pixels com
// alpha < 20 recebem o RGB do pixel opaco mais proximo num raio de 4.
export async function fixAlphaBorder(bmp: ImageBitmap, premultiply = false): Promise<ImageBitmap> {
  const w = bmp.width,
    h = bmp.height;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d", { colorSpace: "srgb", willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  // getImageData devolve nao-premultiplicado; com alpha 0 o RGB se perderia, mas e
  // justamente o RGB que vamos sobrescrever
  const src = g.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(src);
  const R = 4,
    T = 20;
  for (let i = 0; i < h; i++)
    for (let j = 0; j < w; j++) {
      const p = (i * w + j) * 4;
      if (src[p + 3] >= T) continue;
      let best = 0x7fffffff,
        bi = -1;
      for (let k = Math.max(0, i - R); k <= Math.min(h - 1, i + R); k++)
        for (let l = Math.max(0, j - R); l <= Math.min(w - 1, j + R); l++) {
          const d = (i - k) * (i - k) + (j - l) * (j - l);
          if (d >= best) continue;
          const q = (k * w + l) * 4;
          if (src[q + 3] < T) continue;
          best = d;
          bi = q;
        }
      if (bi >= 0) {
        out[p] = src[bi];
        out[p + 1] = src[bi + 1];
        out[p + 2] = src[bi + 2];
      }
    }
  if (premultiply)
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      out[i] = (out[i] * a + 127) / 255;
      out[i + 1] = (out[i + 1] * a + 127) / 255;
      out[i + 2] = (out[i + 2] * a + 127) / 255;
    }
  return createImageBitmap(new ImageData(out, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

// estado vivo (documento, ponte, WebGL): mudanca aqui recarrega a pagina inteira
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
