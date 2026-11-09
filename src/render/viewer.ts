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
import { usarMedidas } from "../core/instantes.ts";
import { parseAtlas } from "../core/atlas-text.ts";
import { NucleoCena, diretorio, normalizarCaminho, ortho } from "./nucleo.ts";
import { SpinePose, drawDebug, type PoseView, type SlotView } from "./pose.ts";
import { DesenhoVideo, desenharRefVideo, type RefVideo } from "./videoref.ts";

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
  // pixel perfeito: o personagem desenhado na resolucao da arte (este numero de pixels da textura
  // por unidade do mundo) e ampliado sem suavizar, como um jogo de pixel art (posicoes e giros
  // presos na grade). 0 desliga. So no modo nucleo.
  pixel?: number;
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
  // video de referencia atras do personagem (N-023, spike; src/render/videoref.ts): preso ao
  // mundo e ao tempo da timeline; refQuadro e o quadro do video desenhado por ultimo
  refVideo: RefVideo | null = null;
  refQuadro = -1;
  private desenhoVideo: DesenhoVideo | null = null;
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
  runtime: Runtime = "nucleo";
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

  // a skin mostrada (null: a padrao)
  skin: string | null = null;
  setSkin(nome: string | null) {
    this.skin = nome;
    if (this.nucleo) this.nucleo.usarSkin(nome);
    if (this.skeleton && this.data) {
      for (const sk of [this.skeleton, this.ghost].filter(Boolean) as Skeleton[]) {
        if (nome && this.data.findSkin(nome)) sk.setSkin(nome);
        else sk.setSkin(this.data.defaultSkin);
        sk.setupPoseSlots();
      }
    }
    this.invalidatePose();
    this.poseAt(this.view.time);
  }

  // paginas que o editor desenha (src/app/desenho.ts) em vez de buscar no servidor
  paginaPropria: ((page: string) => Promise<ImageBitmap | null>) | null = null;

  // troca a textura de uma pagina ja carregada (a dos desenhos, a cada mudanca nas formas)
  async trocarPagina(page: string, img: OffscreenCanvas | HTMLCanvasElement | ImageBitmap) {
    if (this.nucleo && this.runtime === "nucleo") {
      const gl = this.ctx.gl;
      this.nucleo.poeTextura(page, img, { min: gl.LINEAR, mag: gl.LINEAR });
    }
    const p = this.atlas?.pages.find((x) => x.name === page);
    if (p) {
      const bmp = await createImageBitmap(img, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
      (p.texture as GLTexture | null)?.dispose();
      p.setTexture(new GLTexture(this.ctx, bmp, true, false));
    }
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
        // pagina feita no editor (os desenhos): sem servidor
        const propria = await this.paginaPropria?.(page.name);
        if (propria) {
          if (nucleo) crus.set(page.name, propria);
          const bmp = await createImageBitmap(propria, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
          page.setTexture(new GLTexture(this.ctx, bmp, true, false));
          this.textureInfo[page.name] = { origin: "desenho", note: null };
          return;
        }
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
        // os filhos das instancias de novo a cada abertura (podem ter mudado no disco)
        this.instArquivos.clear();
        this.instFalhou.clear();
        await this.prepararInstancias();
        const gl = this.ctx.gl;
        for (const page of atlas.pages) {
          const img = crus.get(page.name);
          // o filtro da pagina do atlas (o mesmo que o spine-webgl usa)
          if (img) this.nucleo.poeTextura(page.name, img, { min: page.minFilter ?? gl.LINEAR, mag: page.magFilter ?? gl.LINEAR });
        }
        // o relevo das paginas (docs/NUCLEO.md "Luzes"): a linha relevo:<arquivo> do atlas; sem o
        // arquivo, a pagina fica sem luz
        for (const p of parseAtlas(doc.atlas.text).pages) {
          const rel = p.extra.find((x) => x.startsWith("relevo:"))?.slice(7);
          if (!rel) continue;
          try {
            const r = await fetch(urlFor(rel));
            if (r.ok) this.nucleo.poeTextura(rel, await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }));
          } catch {}
        }
      } catch (e: any) {
        this.nucleoError = String(e?.message ?? e);
      }
    }
    this.atlas = atlas;
    this.builtVersion = -1;
    this.view.animation = null;
    this.medidas();
    this.rebuild();
    this.frameAll();
  }

  // as medidas (query.*, ficha, transicao, recorte, comandos de setup e de malha) seguem o modo
  // de desenho: no modo "nucleo", pelo nucleo (o mesmo modulo wasm); sem o nucleo, pelo spine-core
  private medidas() {
    if (this.runtime === "nucleo") usarMedidas(this.nucleo ? "nucleo" : "spine", this.nucleo?.N);
    else usarMedidas(this.runtime);
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
      // a skin escolhida (a que nao existe mais fica na padrao)
      if (this.skin && data.findSkin(this.skin))
        for (const sk of [this.skeleton, this.ghost]) {
          sk.setSkin(this.skin);
          sk.setupPoseSlots();
        }
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
    // instancias de arquivos que ainda nao vieram (acabaram de ser postas): busca e refaz; o que
    // nao existe fica anotado (sem buscar de novo a cada quadro) ate recarregarInstancias
    const faltam = this.arquivosFaltando();
    if (faltam.length) {
      const novos = faltam.filter((c) => !this.instFalhou.has(c));
      this.nucleoError = novos.length ? "carregando os arquivos das instancias" : `instancia: nao achei ${faltam.join(", ")}`;
      if (novos.length) void this.prepararInstancias().then(() => this.rebuild());
      return false;
    }
    try {
      this.nucleo.carregar(this.doc.json, this.doc.atlas.text, this.doc.file?.skeleton?.split("/").pop() ?? "", this.caminhoDoc());
      this.nucleoError = null;
      void this.texturasInstancias();
      return true;
    } catch (e: any) {
      this.nucleoError = String(e?.message ?? e);
      return false;
    }
  }

  // ---- instancias (docs/NUCLEO.md "Instancias"): os .boneco filhos vao para o nucleo antes de
  // carregar o pai, e as paginas deles depois

  private instArquivos = new Set<string>();
  private instFalhou = new Set<string>();
  // um arquivo de instancia apareceu ou mudou (instance.extract gravou o filho): busca de novo
  recarregarInstancias() {
    this.instFalhou.clear();
    this.instArquivos.clear();
    void this.prepararInstancias().then(() => this.rebuild());
  }
  private caminhoDoc() {
    return this.doc?.file?.tres ?? this.doc?.file?.skeleton ?? "";
  }
  // os arquivos que as instancias pedem (do documento, no formato do editor) ainda nao registrados
  private arquivosFaltando(): string[] {
    const insts: any[] = this.doc?.json?.instances ?? [];
    if (!insts.length) return [];
    const dir = diretorio(this.caminhoDoc());
    return insts.map((i) => normalizarCaminho(dir + (i.boneco ?? ""))).filter((c) => !this.instArquivos.has(c));
  }
  private async prepararInstancias() {
    const N = this.nucleo;
    if (!N || !this.doc) return;
    // os filhos, e os filhos deles (o .boneco do filho ja e o formato do nucleo)
    const fila = this.arquivosFaltando();
    while (fila.length) {
      const c = fila.shift()!;
      if (this.instArquivos.has(c)) continue;
      const r = await fetch(`/api/file?p=${encodeURIComponent(c)}`);
      if (!r.ok) {
        this.instFalhou.add(c);
        continue;
      }
      const texto = await r.text();
      N.registrarArquivo(c, texto);
      this.instArquivos.add(c);
      try {
        for (const i of JSON.parse(texto).instancias ?? []) fila.push(normalizarCaminho(diretorio(c) + (i.boneco ?? "")));
      } catch {}
    }
  }
  // as paginas dos filhos (relativas ao pai, como as dele). Cada recarga do modelo pede de novo
  // as que faltam: a que ja esta a caminho nao e buscada outra vez (num arrasto, cada passo
  // baixava e subia para a placa todas as paginas dos filhos ate a primeira chegar)
  private texturasACaminho = new Set<string>();
  private async texturasInstancias() {
    const N = this.nucleo;
    if (!N || !this.urlFor) return;
    for (const arq of N.paginasSemTextura()) {
      if (this.texturasACaminho.has(arq)) continue;
      this.texturasACaminho.add(arq);
      try {
        const r = await fetch(this.urlFor(arq));
        if (r.ok) N.poeTextura(arq, await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }));
      } catch {
      } finally {
        this.texturasACaminho.delete(arq);
      }
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
    this.medidas();
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
    // as formas dos desenhos nao mexem no esqueleto: so a textura muda (src/app/desenho.ts)
    if (this.pending) this.pending = this.pending.filter((p) => p[0] !== "drawings");
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
    // no nucleo, o remendo ja tirou da grade de checkpoints so o que a edicao mudou
    this.sim?.invalidate();
    this.nucleo?.invalidarAtual();
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

  // o jogo (docs/PALCO.md): as teclas apertadas agora e o tempo que sobrou do ultimo passo
  // roteiro: a entrada de cada passo (o agente jogando, docs/PALCO.md); fins: os passos onde o
  // estado e guardado em `marcas`; acabou: o roteiro chegou ao fim
  // seguir: a camera acompanha o jogador (quando a fase nao cabe na tela)
  jogo: { teclas: number; sobra: number; estado: any; roteiro?: number[]; i: number; fins?: number[]; marcas: any[]; seguir: boolean } | null = null;
  comecarJogo(): boolean {
    if (!this.useNucleo || !this.nucleo?.palcoComecar()) return false;
    this.view.playing = false;
    // a camera so segue se a fase nao cabe no que se ve agora
    const b = this.pose?.bounds();
    const r = this.canvas.getBoundingClientRect();
    const seguir = !!b && (b[2] * this.cam.zoom > r.width * 1.05 || b[3] * this.cam.zoom > r.height * 1.05);
    this.jogo = { teclas: 0, sobra: 0, estado: this.nucleo.palcoEstado(), i: 0, marcas: [], seguir };
    return true;
  }
  pararJogo() {
    if (!this.jogo) return;
    this.jogo = null;
    this.nucleo?.invalidar();
    this.poseAt(this.view.time);
  }

  frame(dt: number) {
    this.sync();
    if (this.jogo && this.nucleo) {
      // passos fixos de 1/60 s (no maximo 6 por quadro: uma aba parada nao vira avalanche)
      const j = this.jogo;
      j.sobra = Math.min(j.sobra + dt, 6 / 60);
      let n = 0;
      while (j.sobra >= 1 / 60 - 1e-9) {
        const passo = j.i;
        this.nucleo.palcoPasso(j.roteiro ? (j.roteiro[passo] ?? 0) : j.teclas);
        j.i++;
        if (j.fins?.includes(passo)) j.marcas.push(this.nucleo.palcoEstado());
        j.sobra -= 1 / 60;
        n++;
      }
      if (n) j.estado = this.nucleo.palcoEstado();
      // a camera vai atras do jogador, macia (o jogador um pouco abaixo do meio)
      const jog = j.seguir ? j.estado?.atores?.find((a: any) => a.tipo === "jogador") : null;
      if (jog) {
        const r = this.canvas.getBoundingClientRect();
        const alvoY = jog.y + (r.height / this.cam.zoom) * 0.15;
        const k = Math.min(1, dt * 5);
        this.cam.x += (jog.x - this.cam.x) * k;
        this.cam.y += ((this.flip ? -alvoY : alvoY) - this.cam.y) * k;
      }
      this.draw();
      return;
    }
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
    if (this.refVideo && !this.refVideo.frente) this.drawRefVideo();
    scene.begin();
    const pose = this.pose;
    if (pose) {
      if (this.useNucleo) {
        // o desenho do nucleo (cebola e personagem) no mesmo contexto e com a mesma camera; o
        // spine-webgl volta depois so para os gizmos
        scene.end();
        if (this.view.pixel && this.view.pixel > 0) this.drawPixel(this.view.pixel, w, h);
        else {
          this.drawOnionNucleo();
          this.drawNucleo();
        }
        scene.begin();
      } else {
        this.drawOnion();
        this.drawMain(this.skeleton!);
      }
      // o video de referencia na frente: por cima do personagem, antes dos ossos e gizmos
      if (this.refVideo?.frente) {
        scene.end();
        this.drawRefVideo();
        scene.begin();
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

  // ---- pixel perfeito (view.pixel): cebola e personagem num quadro pequeno, um pixel por pixel da
  // arte, e o quadro ampliado sem suavizar para a tela. O centro da camera fica preso na grade da
  // arte, entao o personagem parado nao treme ao mover a camera.
  private pixelFbo: { fb: WebGLFramebuffer; tex: WebGLTexture; rb: WebGLRenderbuffer; w: number; h: number } | null = null;
  private drawPixel(texels: number, w: number, h: number) {
    const gl = this.ctx.gl as WebGL2RenderingContext;
    const dpr = this.fixed ? 1 : window.devicePixelRatio || 1;
    const telaPorPixel = (this.cam.zoom * dpr) / texels;
    const lw = Math.max(1, Math.ceil(w / telaPorPixel) + 2),
      lh = Math.max(1, Math.ceil(h / telaPorPixel) + 2);
    let f = this.pixelFbo;
    if (!f || f.w !== lw || f.h !== lh) {
      if (f) (gl.deleteFramebuffer(f.fb), gl.deleteTexture(f.tex), gl.deleteRenderbuffer(f.rb));
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      // stencil: o recorte do desenho do nucleo
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, lw, lh);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
      f = this.pixelFbo = { fb, tex, rb, w: lw, h: lh };
    }
    // o centro preso na grade da arte (em unidades do mundo: 1 / texels)
    const passo = 1 / texels;
    const cx = Math.round(this.cam.x / passo) * passo,
      cy = Math.round(this.cam.y / passo) * passo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    gl.viewport(0, 0, lw, lh);
    // com o video de referencia atras (ja desenhado na tela), o quadro pequeno nasce transparente e e
    // composto por cima; sem ele, com o fundo (os blends que leem a tela leem o fundo, como no jogo)
    const composto = !!this.refVideo && !this.refVideo.frente;
    const [r, g, b] = this.view.background;
    if (composto) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(r, g, b, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const proj = ortho(cx, cy, texels, lw, lh);
    const name = this.view.animation;
    if (name) for (const o of this.onionFrames()) this.nucleo!.desenharFantasma(name, o.t, this.view.loop, o.color, proj);
    const t0 = performance.now();
    const pose = this.nucleo!.pose!;
    const hidden = this.hiddenBones.size || this.hiddenSlots.size ? (i: number) => this.isSlotHidden(pose.slots[i]) : null;
    this.nucleo!.desenhar(proj, hidden);
    this.nucleoMs.draw = performance.now() - t0;
    // ampliado sem suavizar: o quadro pequeno cobre a tela com sobra; o centro dele (cx, cy) cai
    // onde a camera (cam.x, cam.y) poe esse ponto na tela
    const ox = w / 2 + (cx - this.cam.x) * this.cam.zoom * dpr - (lw / 2) * telaPorPixel,
      oy = h / 2 + (cy - this.cam.y) * this.cam.zoom * dpr - (lh / 2) * telaPorPixel;
    // um retangulo com a textura do quadro pequeno (o blitFramebuffer nao serve: a tela do editor tem
    // antisserrilhado, e o WebGL nao copia para um quadro multiamostrado)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const x0 = (Math.round(ox) / w) * 2 - 1,
      y0 = (Math.round(oy) / h) * 2 - 1,
      x1 = (Math.round(ox + lw * telaPorPixel) / w) * 2 - 1,
      y1 = (Math.round(oy + lh * telaPorPixel) / h) * 2 - 1;
    this.quadroNaTela(gl, f.tex, [x0, y0, x1, y1], composto);
  }

  private progQuadro: { prog: WebGLProgram; buf: WebGLBuffer; vao: WebGLVertexArrayObject } | null = null;
  // composto: o quadro (cor pre-multiplicada, como o nucleo desenha) por cima do que ja esta na tela;
  // sem, substitui (o quadro ja traz o fundo)
  private quadroNaTela(gl: WebGL2RenderingContext, tex: WebGLTexture, [x0, y0, x1, y1]: number[], composto = false) {
    if (!this.progQuadro) {
      const sh = (tipo: number, src: string) => {
        const s = gl.createShader(tipo)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, "#version 300 es\nin vec4 p; out vec2 uv; void main() { uv = p.zw; gl_Position = vec4(p.xy, 0.0, 1.0); }"));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, "#version 300 es\nprecision mediump float; in vec2 uv; uniform sampler2D t; out vec4 cor; void main() { cor = texture(t, uv); }"));
      gl.linkProgram(prog);
      const vao = gl.createVertexArray()!;
      const buf = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(gl.getAttribLocation(prog, "p"));
      gl.vertexAttribPointer(gl.getAttribLocation(prog, "p"), 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.progQuadro = { prog, buf, vao };
    }
    const q = this.progQuadro;
    gl.useProgram(q.prog);
    gl.bindVertexArray(q.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, q.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y1, 1, 1]), gl.STREAM_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(q.prog, "t"), 0);
    gl.disable(gl.STENCIL_TEST);
    if (composto) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(null);
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

  // o video de referencia: antes do personagem, com a camera dele (sem a inversao do modo godot:
  // o retangulo da referencia e do mundo, y para cima, como a referencia em imagem)
  private drawRefVideo() {
    const r = this.refVideo!;
    const cam = this.scene.camera;
    cam.update();
    const m = Float32Array.from(cam.projectionView.values);
    if (this.flip) for (let i = 4; i < 8; i++) m[i] = -m[i];
    this.desenhoVideo ??= new DesenhoVideo(this.ctx.gl as WebGL2RenderingContext);
    const cebola = this.onion.enabled && !this.view.playing ? this.onion.count : 0;
    this.refQuadro = desenharRefVideo(this.desenhoVideo, r, this.view.time, m, cebola);
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
