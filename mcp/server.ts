// Servidor MCP (stdio) do Mamulengo para o Claude Code. Fala com o editor aberto no
// navegador pela ponte WebSocket do servidor de dev; se nada estiver rodando, sobe o
// servidor e abre o navegador. Tudo que o Claude faz acontece na tela do usuario.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MAMULENGO_PORT ?? 5199);
const URL_HTTP = `http://localhost:${PORT}/`;
const URL_WS = `ws://localhost:${PORT}/__mamulengo`;

let ws: WebSocket | null = null;
let editors = 0;
let seq = 0;
const pending = new Map<string, { ok: (v: any) => void; fail: (e: Error) => void }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(): Promise<WebSocket> {
  return new Promise((ok, fail) => {
    const s = new WebSocket(URL_WS);
    s.once("open", () => {
      s.send(JSON.stringify({ t: "hello", role: "agent", name: "claude-code" }));
      ok(s);
    });
    s.once("error", fail);
    s.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === "status") editors = m.editors;
      if (m.t === "reply") {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        m.ok ? p.ok(m.result) : p.fail(new Error(m.error));
      }
    });
    s.on("close", () => {
      if (ws === s) ws = null;
      for (const [, p] of pending) p.fail(new Error("conexao com o editor caiu"));
      pending.clear();
    });
  });
}

async function ensureEditor(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN && editors > 0) return ws;
  try {
    ws = ws?.readyState === WebSocket.OPEN ? ws : await connect();
  } catch {
    // servidor de dev fora do ar: sobe em segundo plano
    const logDir = join(homedir(), ".cache", "mamulengo");
    mkdirSync(logDir, { recursive: true });
    const out = openSync(join(logDir, "vite.log"), "a");
    spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: REPO, detached: true, stdio: ["ignore", out, out] }).unref();
    for (let i = 0; i < 60 && !ws; i++) {
      await sleep(500);
      ws = await connect().catch(() => null);
    }
    if (!ws) throw new Error(`nao consegui subir o editor (veja ${join(logDir, "vite.log")})`);
  }
  await sleep(150);
  if (editors === 0) {
    spawn("xdg-open", [URL_HTTP], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 60 && editors === 0; i++) await sleep(500);
    if (editors === 0) throw new Error(`o editor nao abriu no navegador. Abra ${URL_HTTP}`);
  }
  return ws!;
}

async function call(method: string, params: any = {}, timeoutMs = 60_000): Promise<any> {
  const s = await ensureEditor();
  const id = String(++seq);
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      fail(new Error(`sem resposta do editor em ${timeoutMs / 1000}s (${method})`));
    }, timeoutMs);
    pending.set(id, {
      ok: (v) => (clearTimeout(timer), ok(v)),
      fail: (e) => (clearTimeout(timer), fail(e)),
    });
    s.send(JSON.stringify({ t: "call", id, method, params }));
  });
}

const text = (v: any) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
const wrap =
  <A>(fn: (a: A) => Promise<any>) =>
  async (a: A) => {
    try {
      return await fn(a);
    } catch (e: any) {
      return { ...text(`ERRO: ${e?.message ?? e}`), isError: true };
    }
  };

// previa de transicao: a animacao e depois outra, como o jogo toca
const sequence = z
  .object({
    next: z.string().describe("animacao que vem depois"),
    mix: z.number().min(0).optional().describe("segundos; padrao: o mix do jogo (-data.tres)"),
    at: z.number().min(0).nullable().optional().describe("interromper a animacao neste instante (play/set_animation); sem: enfileira (queue/add_animation), B entra quando faltar o mix"),
    loop: z.boolean().optional().describe("a primeira em loop (padrao false)"),
    nextLoop: z.boolean().optional().describe("a segunda em loop (padrao true)"),
  })
  .nullable()
  .optional()
  .describe("previa de transicao: o tempo cobre a sequencia inteira (A, mix, B). null desliga; sem: a da tela");

const server = new McpServer(
  { name: "mamulengo", version: "0.1.0" },
  {
    instructions: [
      "Mamulengo: editor de animacao Spine 4.3 para os jogos Godot. O documento e o proprio .spine-json que o jogo carrega.",
      "Fluxo: mamulengo_assets -> mamulengo_open -> mamulengo_run (comandos) -> mamulengo_look (veja o resultado) -> mamulengo_save.",
      "mamulengo_help lista os comandos; mamulengo_help {name} mostra o schema de um. Use query.* para entender o esqueleto antes de editar.",
      "mamulengo_run executa um lote como uma unica acao de desfazer; se uma chamada falha, nada do lote fica.",
      "Tudo aparece ao vivo na tela do usuario. Olhe (mamulengo_look) depois de mudancas visuais: frames=N da uma folha de contato da animacao.",
      "Unidades: pixels do esqueleto, graus, segundos. Y para cima. Curvas por nome de sensacao: suave, macio, forte, sai-rapido, entra-rapido, elastico, antecipa, stepped, linear.",
      "Para criar ou mudar animacao, leia antes o guia completo (mamulengo_guia). Cada personagem tem uma ficha <nome>.ficha.md ao lado do .spine-json (intencao, limites, regras): leia-a, escreva a secao da animacao nova antes das chaves e confira com mamulengo_ficha (le o arquivo); sem ficha, gere com ficha.draft e grave ao lado do .spine-json. Resumo: 1) estude o rig com query.rig (constraints e quando o animador as liga, faixa usada por osso = limite natural, trocas de imagem, pecas que somem atras de outras); 2) planeje batidas legiveis com antecipacao, atraso da hierarquia e assentamento, reaproveitando poses do animador; 3) pecas presas com pose.follow ou ligando/desligando constraints como o animador; 4) QUANTO mexer vem do estilo da casa (docs/ESTILO.md no guia): mire na mediana do papel e meca com query.estilo, que diz o que ficou ABAIXO (timido) ou ACIMA; 5) confira ANTES de mostrar com query.motion, query.relation, mamulengo_zoom (maos, rosto, trocas de perto) e a folha de contato que mamulengo_export devolve; se o jogo emenda a animacao em outra (ou a interrompe), veja com look/export sequence e meca com query.transition. 'Igual ao Godot' so prova o render, nao a animacao.",
      "Ao abrir um personagem, leia as notas abertas (mamulengo_notas listar abertas): sao pedidos da equipe; responda e resolva o que fizer. Antes de mexer pesado num personagem, marque uma versao (mamulengo_versoes marcar); se der errado, restaure. Nao altere animacoes ou setup existentes sem pedido. Se o pedido for incoerente de proposito, faca e avise em uma linha o que foge do rig.",
    ].join("\n"),
  },
);

server.registerTool(
  "mamulengo_guia",
  { description: "Guia do fluxo de trabalho: pedido, ficha do personagem (formato e regras), rigar e animar sem quebrar o rig, conferir antes de mostrar. Leia antes de rigar, criar ou mudar animacao.", inputSchema: {} },
  wrap(async () => text(["FLUXO.md", "FICHA.md", "RIGAR.md", "ANIMAR.md", "RUBRICA.md", "ESTILO.md"].map((f) => readFileSync(join(REPO, "docs", f), "utf8")).join("\n\n---\n\n"))),
);

server.registerTool(
  "mamulengo_ficha",
  {
    description:
      "Confere a ficha do personagem aberto (o <nome>.ficha.md ao lado do .spine-json, ou path) contra as animacoes: regras de duracao, loop, emendas, limites, pecas presas, fisica. anims: so estas. Sem ficha: crie com mamulengo_run ficha.draft e grave o arquivo.",
    inputSchema: { path: z.string().optional(), anims: z.array(z.string()).optional() },
  },
  wrap(async (a: { path?: string; anims?: string[] }) => {
    const st = await call("state");
    const sk: string | undefined = st?.file?.skeleton;
    const p = a.path ?? (sk ? sk.replace(/\.(spine-json|json)$/, "") + ".ficha.md" : undefined);
    if (!p) throw new Error("nenhum personagem aberto e nenhum path");
    let md: string;
    try {
      md = readFileSync(p, "utf8");
    } catch {
      throw new Error(`nao achei a ficha em ${p}. Gere com mamulengo_run {calls:[{cmd:"ficha.draft"}]} e grave nesse caminho.`);
    }
    return text({ ficha: p, ...(await call("exec", { label: "ficha", calls: [{ cmd: "ficha.check", args: { text: md, ...(a.anims ? { anims: a.anims } : {}) } }] })).results[0] });
  }),
);

server.registerTool(
  "mamulengo_notas",
  {
    description:
      "Anotacoes do personagem aberto, deixadas pela equipe ou pelo Claude (<nome>.notas.json, viaja com o projeto). LEIA as abertas antes de trabalhar num personagem: sao pedidos e avisos de quem cuida dele. acao listar {abertas?}, criar {texto, anim?, tempo?, osso?} (presa a uma animacao/instante/parte ou geral), responder {id, texto}, resolver {id}, reabrir {id}. Responda e resolva o que fizer.",
    inputSchema: {
      acao: z.enum(["listar", "criar", "responder", "resolver", "reabrir"]),
      abertas: z.boolean().optional(),
      id: z.string().optional(),
      texto: z.string().optional(),
      anim: z.string().nullable().optional(),
      tempo: z.number().nullable().optional(),
      osso: z.string().nullable().optional(),
    },
  },
  wrap(async (a) => text(await call("notes", a))),
);

server.registerTool(
  "mamulengo_versoes",
  {
    description:
      "Versoes do personagem aberto, alem do desfazer: cada gravacao vira versao. acao listar (com o que mudou em cada uma), marcar {label} (salva e guarda com nome: faca antes de mexer pesado), comparar {id, against?} (o que muda desta versao para a atual ou outra), restaurar {id} (o estado atual vira versao antes, entao da para voltar).",
    inputSchema: { acao: z.enum(["listar", "marcar", "comparar", "restaurar"]), label: z.string().optional(), id: z.string().optional(), against: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
  },
  wrap(async (a) => text(await call("versions", a))),
);

server.registerTool(
  "mamulengo_assets",
  { description: "Lista os assets Spine dos projetos Godot (filtre por projeto ou nome).", inputSchema: { filter: z.string().optional() } },
  wrap(async (a) => text(await call("assets", a))),
);

server.registerTool(
  "mamulengo_open",
  { description: "Abre um asset no editor (por id/res path, ou query por nome: 'projeto/personagem').", inputSchema: { id: z.string().optional(), query: z.string().optional() } },
  wrap(async (a) => text(await call("open", a))),
);

server.registerTool(
  "mamulengo_help",
  { description: "Comandos disponiveis para mamulengo_run. Sem args: lista curta. {group} ou {name}: com schema de parametros.", inputSchema: { group: z.string().optional(), name: z.string().optional() } },
  wrap(async (a) => text(await call("help", a))),
);

server.registerTool(
  "mamulengo_run",
  {
    description:
      'Executa comandos no documento aberto, como uma acao de desfazer. calls: [{cmd, args}]. Ex: [{"cmd":"key.set","args":{"anim":"2.idle","target":{"bone":"head"},"timeline":"rotate","time":0.5,"value":6,"curve":"suave"}}]',
    inputSchema: {
      calls: z.array(z.object({ cmd: z.string(), args: z.record(z.string(), z.any()).optional() })).min(1),
      label: z.string().optional().describe("nome da acao no historico"),
    },
  },
  wrap(async (a) => text(await call("exec", a))),
);

server.registerTool(
  "mamulengo_look",
  {
    description:
      "Imagem do viewport renderizado pelo runtime oficial. time: um instante; frames: N instantes igualmente espacados (folha de contato); times: lista. fit enquadra tudo. bones/meshes mostram overlays. sequence: a emenda com a proxima animacao (cada quadro marca A, mix ou B); meca com query.transition.",
    inputSchema: {
      animation: z.string().optional(),
      time: z.number().optional(),
      frames: z.number().int().min(1).max(36).optional(),
      times: z.array(z.number()).max(36).optional(),
      fit: z.boolean().optional(),
      bones: z.boolean().optional(),
      meshes: z.boolean().optional(),
      scale: z.number().min(0.1).max(1).optional(),
      sequence,
    },
  },
  wrap(async (a) => {
    const r = await call("look", a);
    const b64 = String(r.image).replace(/^data:image\/png;base64,/, "");
    return {
      content: [
        { type: "image" as const, data: b64, mimeType: "image/png" },
        { type: "text" as const, text: `animacao ${r.animation ?? "(setup)"}${r.sequence ? ` -> ${r.sequence.next} (mix ${r.sequence.mix}s de ${r.sequence.mixStart}s a ${r.sequence.mixEnd}s${r.sequence.at != null ? `, interrompendo em ${r.sequence.at}s` : ""})` : ""} em ${r.times.map((t: number) => t + "s").join(", ")}` },
      ],
    };
  }),
);

server.registerTool(
  "mamulengo_zoom",
  {
    description:
      "Olhar de perto: recorta as imagens de um osso (com os filhos) e/ou de partes (slots) e renderiza nesse enquadramento, em ate 8 instantes (o mesmo quadro em todos, para comparar). Use para conferir maos, rosto, oculos, trocas de imagem e costuras em tamanho grande.",
    inputSchema: {
      animation: z.string().optional(),
      times: z.array(z.number()).min(1).max(8),
      bones: z.array(z.string()).optional().describe("ossos: as imagens deles e dos filhos"),
      slots: z.array(z.string()).optional(),
      size: z.number().int().min(128).max(1024).optional().describe("lado em px de cada quadro (padrao 480)"),
      margin: z.number().min(0).max(2).optional().describe("folga em volta, fracao do tamanho (padrao 0.25)"),
      sequence,
    },
  },
  wrap(async (a: any) => {
    const size = a.size ?? 480;
    const r = await call("render", { animation: a.animation, times: a.times, size: [size, size], focus: { bones: a.bones, slots: a.slots, margin: a.margin }, sequence: a.sequence });
    return {
      content: [
        ...r.images.map((img: string) => ({ type: "image" as const, data: String(img).replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" })),
        { type: "text" as const, text: `${a.animation ?? "(setup)"} em ${r.times.map((t: number) => t + "s").join(", ")}; recorte do mundo [x, y, largura, altura] = ${JSON.stringify(r.rect)}` },
      ],
    };
  }),
);

server.registerTool(
  "mamulengo_view",
  {
    description: "Controla a visualizacao (nao altera o documento): animation, time, playing, loop, speed, showBones, showMeshes, select {bone|slot}, fit, sequence (previa de transicao na tela do usuario).",
    inputSchema: {
      animation: z.string().nullable().optional(),
      time: z.number().optional(),
      playing: z.boolean().optional(),
      loop: z.boolean().optional(),
      speed: z.number().optional(),
      showBones: z.boolean().optional(),
      showMeshes: z.boolean().optional(),
      select: z.object({ bone: z.string().optional(), slot: z.string().optional() }).optional(),
      fit: z.boolean().optional(),
      sequence,
    },
  },
  wrap(async (a) => text(await call("view", a))),
);

server.registerTool(
  "mamulengo_godot_check",
  {
    description:
      "Renderiza o instante no Godot de verdade (spine-godot do projeto) e compara com o editor: devolve imagem lado a lado (editor | Godot) e a % de pixels diferentes. Salve antes. Na primeira vez o Godot importa o projeto (demora).",
    inputSchema: { animation: z.string().nullable().optional(), time: z.number().optional() },
  },
  wrap(async (a) => {
    const r = await call("godotCheck", a, 240_000);
    return {
      content: [
        { type: "image" as const, data: String(r.image).replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" },
        { type: "text" as const, text: `${r.verdict}: ${r.diffPct}% dos pixels diferem (${r.animation ?? "setup"} @ ${r.time}s)` },
      ],
    };
  }),
);

server.registerTool(
  "mamulengo_images",
  { description: "Lista imagens soltas (png/webp/jpg) de uma pasta, com tamanho. Use para saber o que da para montar.", inputSchema: { dir: z.string().describe("pasta absoluta") } },
  wrap(async (a) => text(await call("images", a))),
);

server.registerTool(
  "mamulengo_create_asset",
  {
    description:
      "Cria um asset Spine novo num projeto Godot a partir de uma pasta de imagens: <dir>/<name>.spine-json (so o osso root), atlas empacotado, paginas e <name>-data.tres. Depois abre no editor. Monte com bone.add, slot.add, attachment.region (width/height = tamanho da imagem).",
    inputSchema: { dir: z.string().describe("pasta do asset dentro do projeto Godot (absoluta)"), name: z.string(), imagesFrom: z.string().describe("pasta com as imagens (absoluta)") },
  },
  wrap(async (a) => text(await call("createAsset", a, 120_000))),
);

server.registerTool(
  "mamulengo_add_images",
  { description: "Adiciona ou troca imagens no atlas do asset aberto e reempacota (as fontes ficam em images/ ao lado). names opcional renomeia as regioes.", inputSchema: { files: z.array(z.string()).min(1), names: z.array(z.string()).optional() } },
  wrap(async (a) => text(await call("addImages", a, 120_000))),
);

server.registerTool(
  "mamulengo_psd",
  {
    description:
      "Importa um PSD em camadas (tags do PhotoshopToSpine: [bone], [slot], [skin], [folder], [ignore], [merge], [path], [scale], [trim], [mesh], [name], [overlay], e [origin]). mode create: personagem novo em <dir>/<name> (spine-json, atlas, webp, -data.tres), cada camada visivel numa parte na ordem do PSD e no lugar da composicao; escondidas viram trocas escondidas. mode update: atualiza o asset aberto casando camada com imagem pelo nome (imagem mudada e reempacotada sem sair do lugar, camada nova vira imagem nova, malhas mantem vertices e pesos) e salva. Devolve o resumo.",
    inputSchema: {
      file: z.string().describe("caminho absoluto do .psd (dentro das raizes)"),
      mode: z.enum(["create", "update"]).optional().describe("padrao: create se houver dir, senao update"),
      dir: z.string().optional().describe("create: pasta do personagem dentro do projeto Godot (absoluta)"),
      name: z.string().optional().describe("create: nome dos arquivos (sem espacos)"),
      ignoreHidden: z.boolean().optional().describe("camadas escondidas ficam de fora (padrao: entram como trocas)"),
    },
  },
  wrap(async (a) => text(await call("psd", a, 180_000))),
);

server.registerTool(
  "mamulengo_export",
  {
    description:
      "Exporta a animacao inteira como esta na tela (enquadramento do viewport, sem gizmos) em GIF (repete sozinho) ou video WebM. Grava pelo servidor em dir (dentro das raizes) ou em ~/.cache/mamulengo/exports e devolve o caminho. sequence: exporta a emenda com a proxima animacao (A, mix e B inteira).",
    inputSchema: {
      format: z.enum(["gif", "webm"]),
      animation: z.string().nullable().optional(),
      fps: z.number().int().min(1).max(60).optional().describe("padrao 30"),
      scale: z.number().min(0.1).max(2).optional().describe("sobre o tamanho do viewport (padrao 1)"),
      maxWidth: z.number().int().min(64).max(1920).optional().describe("largura maxima em px (padrao 960)"),
      loops: z.number().int().min(1).max(20).optional().describe("webm: repeticoes da animacao no video"),
      dir: z.string().optional().describe("pasta absoluta onde gravar"),
      name: z.string().optional().describe("nome do arquivo sem extensao"),
      fit: z.boolean().optional().describe("enquadra a animacao inteira (uniao de todos os quadros) em vez do viewport: use para nada sair cortado nem ficar pequeno"),
      sequence,
    },
  },
  wrap(async (a) => {
    const r = await call("export", a, 300_000);
    // folha de contato do proprio arquivo (GIF): 8 quadros espalhados, para conferir o que saiu
    if (a.format === "gif" && r?.path) {
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(r.path, { animated: true }).metadata();
        const n = meta.pages ?? 1,
          w = meta.width ?? 0,
          h = meta.pageHeight ?? meta.height ?? 0;
        const k = Math.min(8, n),
          s = Math.min(1, 320 / Math.max(1, w));
        const tw = Math.round(w * s),
          th = Math.round(h * s);
        const tiles = await Promise.all(
          Array.from({ length: k }, async (_, i) => ({
            input: await sharp(r.path, { page: Math.round((i * (n - 1)) / Math.max(1, k - 1)) }).resize(tw, th).png().toBuffer(),
            left: (i % 4) * tw,
            top: Math.floor(i / 4) * th,
          })),
        );
        const sheet = await sharp({ create: { width: tw * Math.min(4, k), height: th * Math.ceil(k / 4), channels: 3, background: { r: 30, g: 30, b: 40 } } }).composite(tiles).png().toBuffer();
        return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 1) + `\nfolha de contato do arquivo: ${k} de ${n} quadros` }, { type: "image" as const, data: sheet.toString("base64"), mimeType: "image/png" }] };
      } catch (e: any) {
        return text({ ...r, folha: `nao gerei a folha de contato: ${e?.message ?? e}` });
      }
    }
    return text(r);
  }),
);

server.registerTool("mamulengo_state", { description: "Estado do editor: asset aberto, alterado?, animacao/tempo, selecao, erro do runtime, historico recente." }, wrap(async () => text(await call("state"))));
server.registerTool("mamulengo_undo", { description: "Desfaz a ultima acao." }, wrap(async () => text(await call("undo"))));
server.registerTool("mamulengo_redo", { description: "Refaz." }, wrap(async () => text(await call("redo"))));
server.registerTool("mamulengo_save", { description: "Grava o .spine-json no projeto (backup automatico em ~/.cache/mamulengo/backups)." }, wrap(async () => text(await call("save"))));
server.registerTool("mamulengo_discard", { description: "Descarta alteracoes nao salvas e reabre o asset." }, wrap(async () => text(await call("discard"))));

await server.connect(new StdioServerTransport());
