// Bancada: um Claude Code de verdade, sem interface, recebe um pedido e faz o trabalho
// so pelo MCP do Mamulengo (rig, ficha, animacoes). Mede se o fluxo e as ferramentas
// bastam para chegar a qualidade das animacoes que ja temos.
//
//   npx tsx tools/bancada.ts run <caso> [--port 5331] [--model opus] [--budget 40] [--turns 400] [--editor]
//                                      [--revisoes 2] [--meta 9] [--retomar] [--gravar] [--janela|--headless]
//
// <caso> e uma pasta com PEDIDO.md, imagens/, layout.json e projeto/ (projeto Godot com o
// spine-godot; tools/acceptance-kit.ts gera tudo menos o PEDIDO). A bancada sobe um
// editor proprio (vite na porta dada, raizes so no caso), um Chromium headless com a
// pagina e roda `claude -p` dentro do caso, isolado: sem os hooks e o MCP do usuario,
// lendo e gravando so na pasta do caso. Transcricao e relatorio ficam em <caso>/.bancada/.
// Com --editor, usa o editor que ja esta aberto na porta (para a pessoa assistir); quem
// sobe esse editor deve limitar MAMULENGO_ROOTS ao caso, senao o agente ve outros projetos.
// Com --revisoes N, um diretor (outro claude -p, sem editor, so com a entrega e a rubrica de
// docs/RUBRICA.md) da nota; abaixo de --meta o animador retoma a sessao com as notas. Com
// --retomar, continua um caso ja rodado: aplica as notas do ultimo DIRETOR_n.md e segue.
// O editor proprio roda com MAMULENGO_ESTAVEL (sem recarga quando o codigo do Mamulengo muda).
// Para assistir: http://localhost:<porta>/?espectador (modo espectador, so olha).
// Com --janela o editor do agente abre numa janela de verdade na tela da pessoa (com --gravar
// e o padrao; --headless volta ao sem janela).
// Com --gravar (sem --editor), grava a tela do editor e monta processo.mp4 e .gif acelerados
// em <caso>/entrega/gravacao; enquanto grava, http://localhost:5380/ao_vivo.html (--ao-vivo
// <porta>) mostra a tela ao vivo.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, openSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, caseArg, ...rest] = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = rest.indexOf(`--${k}`);
  return i >= 0 ? rest[i + 1] : d;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (cmd !== "run" || !caseArg) {
  console.error("uso: bancada.ts run <caso> [--port 5331] [--model opus] [--budget 40] [--turns 400] [--editor] [--revisoes 2] [--meta 9]");
  process.exit(2);
}

const caso = resolve(caseArg);
if (!existsSync(join(caso, "PEDIDO.md"))) throw new Error(`falta ${join(caso, "PEDIDO.md")}`);
const port = Number(opt("port", "5331"));
const out = join(caso, ".bancada");
mkdirSync(out, { recursive: true });
mkdirSync(join(caso, "entrega"), { recursive: true });
const kids: ChildProcess[] = [];
const log = (s: string) => console.log(`[bancada] ${s}`);

function stop() {
  for (const k of kids) {
    try {
      // grupo inteiro (vite e chromium criam filhos)
      if (k.pid) process.kill(-k.pid, "SIGTERM");
    } catch {}
  }
}
process.on("SIGINT", () => (stop(), process.exit(130)));
process.on("exit", stop);

async function waitHttp(url: string, ms: number) {
  for (let t = 0; t < ms; t += 500) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`nao respondeu: ${url}`);
}

// editor conectado na ponte: o status da ponte conta as paginas abertas
async function waitEditor(ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    const n = await new Promise<number>((ok) => {
      const s = new WebSocket(`ws://localhost:${port}/__mamulengo`);
      const done = (v: number) => (s.close(), ok(v));
      s.once("error", () => ok(0));
      s.once("open", () => s.send(JSON.stringify({ t: "hello", role: "agent", name: "bancada" })));
      s.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.t === "status") done(m.editors);
      });
      setTimeout(() => done(0), 2000);
    });
    if (n > 0) return;
    await sleep(1000);
  }
  throw new Error("o editor nao conectou na ponte");
}

// 1. editor proprio, so com o caso nas raizes
const useOpen = rest.includes("--editor");
let stopRec: (() => Promise<void>) | null = null;
if (useOpen && rest.includes("--gravar")) throw new Error("--gravar usa o Chromium da bancada: rode sem --editor");
let profile: string | null = null;
if (!useOpen) {
  const env = { ...process.env, MAMULENGO_ROOTS: caso, MAMULENGO_PORT: String(port), MAMULENGO_ESTAVEL: "1" };
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: REPO, env, detached: true, stdio: ["ignore", openSync(join(out, "vite.log"), "w"), openSync(join(out, "vite.log"), "a")] });
  kids.push(vite);
  await waitHttp(`http://localhost:${port}/`, 60_000);
  log(`editor em http://localhost:${port}/`);

  // 2. pagina do editor num Chromium headless com WebGL (swiftshader)
  profile = mkdtempSync(join(tmpdir(), "bancada-chromium-"));
  // com janela (--janela, padrao de --gravar): a pessoa ve o editor do agente na tela dela,
  // ao vivo; sem janela (headless), so pelo ?espectador ou pelo ao vivo da gravacao
  const windowed = rest.includes("--janela") || (rest.includes("--gravar") && !rest.includes("--headless"));
  const chromeArgs = windowed
    ? [`--app=http://localhost:${port}/?acompanhar=0`, "--window-size=1600,1000", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0"]
    : ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,1000", `--user-data-dir=${profile}`, "--no-first-run", "--remote-debugging-port=0", `http://localhost:${port}/?acompanhar=0`];
  if (windowed) log("abrindo o editor do agente numa janela (feche so no fim: fechar a janela derruba a rodada)");
  const chrome = spawn(
    "chromium",
    chromeArgs,
    { detached: true, stdio: ["ignore", openSync(join(out, "chromium.log"), "w"), openSync(join(out, "chromium.log"), "a")] },
  );
  kids.push(chrome);
  await waitEditor(60_000);
  log("pagina conectada na ponte");
  if (rest.includes("--gravar")) {
    stopRec = await recorder(profile, join(caso, "entrega", "gravacao"));
    await waitEditor(60_000);
    log("gravando a tela do editor");
  }
} else {
  await waitEditor(10_000);
  log(`usando o editor aberto em http://localhost:${port}/`);
}

// sessao anunciada: um editor aberto em outra porta acompanha este agente automaticamente
const sessoes = join(homedir(), ".cache", "mamulengo", "sessoes");
const sessaoFile = join(sessoes, `${port}.json`);
if (!useOpen) {
  mkdirSync(sessoes, { recursive: true });
  writeFileSync(sessaoFile, JSON.stringify({ port, caso: basename(caso), inicio: new Date().toISOString(), pid: process.pid }));
  process.on("exit", () => rmSync(sessaoFile, { force: true }));
}

// 3. MCP do Mamulengo apontado para este editor
const mcp = join(out, "mcp.json");
writeFileSync(mcp, JSON.stringify({ mcpServers: { mamulengo: { command: "npx", args: ["tsx", join(REPO, "mcp", "server.ts")], env: { MAMULENGO_PORT: String(port) } } } }, null, 1));

// 4. o pedido, com o minimo de moldura: o resto o Claude tira do guia do MCP
const pedido = readFileSync(join(caso, "PEDIDO.md"), "utf8");
const prompt = `${pedido}

---
Voce trabalha so com o MCP "mamulengo" (editor de animacao Spine 4.3 para jogos Godot) e com
os arquivos desta pasta. Comece lendo o guia (mamulengo_guia). O projeto Godot de trabalho
esta em ./projeto; crie o asset la dentro. Grave a ficha ao lado do .spine-json do asset.
Exporte um GIF de cada animacao para ./entrega (mamulengo_export com dir). No fim, escreva
./entrega/RELATORIO.md: o que fez, o que conferiu (com numeros), onde travou e o que faltou
no Mamulengo ou nos guias.`;
writeFileSync(join(out, "prompt.md"), prompt);

// args comuns: so a pasta do caso, sem os hooks e o MCP do usuario, sem shell
const base = (tools: string[], mcpCfg: string | null) => [
  ...(mcpCfg ? ["--mcp-config", mcpCfg] : []),
  "--strict-mcp-config",
  "--setting-sources",
  "local",
  "--permission-mode",
  "dontAsk",
  "--allowedTools",
  ...tools,
  // dontAsk ainda deixa passar o que as configuracoes globais liberam: o shell sai daqui
  "--disallowedTools",
  "Bash",
  "--output-format",
  "stream-json",
  "--verbose",
  "--max-turns",
  opt("turns", "400")!,
  ...(opt("model") ? ["--model", opt("model")!] : []),
  ...(opt("budget") ? ["--max-budget-usd", opt("budget")!] : []),
];
// gravar arquivo (Write e Edit) e liberado pela regra Edit(...): uma regra Write(...) sozinha
// nao libera nada no modo sem perguntas (medido: era o que recusava a escrita na entrega)
const animTools = ["mcp__mamulengo__*", "Read(./**)", "Edit(./**)", "Glob", "Grep"];

// Narracao: o que o agente escreve entre os comandos vai para o editor (legenda e
// atividade) pela ponte, enquanto ele trabalha
let narrador: WebSocket | null = null;
function narrar(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return;
  if (!narrador || narrador.readyState > 1) {
    narrador = new WebSocket(`ws://localhost:${port}/__mamulengo`);
    narrador.on("error", () => {});
    narrador.once("open", () => narrador!.send(JSON.stringify({ t: "hello", role: "narrador" })));
  }
  const send = () => narrador!.send(JSON.stringify({ t: "narracao", text: t }));
  narrador.readyState === 1 ? send() : narrador.once("open", () => setTimeout(send, 50));
}

// roda um claude -p e devolve as linhas da transcricao
async function runClaude(args: string[], name: string, narrate = false) {
  const file = join(out, `${name}.jsonl`);
  const child = spawn("claude", args, { cwd: caso, stdio: ["ignore", openSync(file, "w"), openSync(join(out, `${name}.err`), "w")] });
  // le as linhas novas da transcricao a cada segundo e narra os textos do agente
  let readUpTo = 0;
  const tail = narrate
    ? setInterval(() => {
        try {
          const all = readFileSync(file, "utf8");
          const end = all.lastIndexOf("\n") + 1;
          const fresh = all.slice(readUpTo, end);
          readUpTo = end;
          for (const line of fresh.split("\n").filter(Boolean)) {
            const m = JSON.parse(line);
            if (m.type !== "assistant") continue;
            for (const c of m.message?.content ?? []) if (c.type === "text") narrar(c.text);
          }
        } catch {}
      }, 1000)
    : null;
  const code: number = await new Promise((ok) => child.on("exit", (c) => ok(c ?? 1)));
  if (tail) clearInterval(tail);
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { code, lines, result: lines.find((m) => m.type === "result") };
}

// Gravacao (--gravar): captura a tela inteira do editor (o Chromium headless da bancada,
// pelo protocolo DevTools) a cada segundo e guarda so os quadros que mudaram, com o
// instante. No fim o ffmpeg monta um MP4 e um GIF acelerados; os quadros ficam para editar.
async function recorder(profileDir: string, dir: string) {
  mkdirSync(join(dir, "quadros"), { recursive: true });
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let i = 0; i < 60 && !existsSync(portFile); i++) await sleep(500);
  const dport = readFileSync(portFile, "utf8").split("\n")[0].trim();
  const targets: any[] = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
  const page = targets.find((t) => t.type === "page" && String(t.url).includes(`localhost:${port}`));
  if (!page) throw new Error("gravacao: pagina do editor nao encontrada no Chromium");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
  let id = 0;
  const waiting = new Map<number, (r: any) => void>();
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.id && waiting.has(m.id)) (waiting.get(m.id)!(m.result), waiting.delete(m.id));
  });
  const send = (method: string, params: any = {}) => new Promise<any>((ok) => (waiting.set(++id, ok), ws.send(JSON.stringify({ id, method, params }))));
  // sem a apresentacao inicial cobrindo a tela; janela do tamanho do video
  // sem a apresentacao inicial e sem acompanhamento automatico: esta pagina E o editor do
  // agente (acompanhando, ela viraria espectadora de si mesma ao recarregar)
  await send("Runtime.evaluate", { expression: `localStorage.setItem("mamulengo.onboarded","1"); localStorage.setItem("mamulengo.acompanhar","0")` });
  await send("Page.reload", {});
  await sleep(4000);
  // ao vivo: http://localhost:<--ao-vivo, padrao 5380>/ao_vivo.html mostra o ultimo quadro,
  // para a pessoa acompanhar no proprio navegador enquanto o agente trabalha sem janela
  copyFileSync(join(REPO, "tools", "ao_vivo.html"), join(dir, "ao_vivo.html"));
  const live = createServer((req, res) => {
    const f = join(dir, (req.url ?? "/").split("?")[0].replace(/^\/+/, "") || "ao_vivo.html");
    if (!f.startsWith(dir) || !existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html; charset=utf-8" : "image/jpeg", "cache-control": "no-store" }).end(readFileSync(f));
  });
  const livePort = Number(opt("ao-vivo", "5380"));
  live.listen(livePort, "127.0.0.1", () => log(`ao vivo em http://localhost:${livePort}/ao_vivo.html`));
  live.on("error", (e) => log(`ao vivo: ${e.message}`));
  const t0 = Date.now();
  let last = "",
    n = 0,
    running = true;
  const times: string[] = [];
  const loop = (async () => {
    while (running) {
      try {
        const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
        const h = createHash("md5").update(r.data).digest("hex");
        if (h !== last) {
          last = h;
          const jpg = Buffer.from(r.data, "base64");
          writeFileSync(join(dir, "quadros", `${String(++n).padStart(6, "0")}.jpg`), jpg);
          // a tela ao vivo le sempre o ultimo quadro (grava ao lado e troca, sem quadro pela metade)
          writeFileSync(join(dir, "ao_vivo.tmp.jpg"), jpg);
          renameSync(join(dir, "ao_vivo.tmp.jpg"), join(dir, "ao_vivo.jpg"));
          times.push(`${n}\t${((Date.now() - t0) / 1000).toFixed(1)}`);
        }
      } catch {}
      await sleep(1000);
    }
  })();
  return async () => {
    running = false;
    await loop;
    ws.close();
    live.close();
    writeFileSync(join(dir, "tempos.tsv"), "quadro\tsegundos\n" + times.join("\n") + "\n");
    if (!n) return;
    // video: todos os quadros a 15 por segundo; GIF: no maximo ~40 s a 10 por segundo
    spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "15", "-i", join(dir, "quadros", "%06d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1600:-2", join(dir, "processo.mp4")]);
    const every = Math.max(1, Math.ceil(n / 400));
    spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "15", "-i", join(dir, "quadros", "%06d.jpg"), "-vf", `select='not(mod(n\\,${every}))',setpts=N/10/TB,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer`, "-r", "10", join(dir, "processo.gif")]);
    log(`gravacao: ${n} quadros em ${((Date.now() - t0) / 60000).toFixed(1)} min -> ${join(dir, "processo.mp4")} e .gif`);
  };
}

// chamada na ponte do editor (o mesmo que o MCP usa)
function call(method: string, params: any): Promise<any> {
  return new Promise((ok, fail) => {
    const s = new WebSocket(`ws://localhost:${port}/__mamulengo`);
    const t = setTimeout(() => (s.close(), fail(new Error(`${method}: sem resposta`))), 60_000);
    s.once("error", fail);
    s.once("open", () => {
      s.send(JSON.stringify({ t: "hello", role: "agent", name: "bancada" }));
      s.send(JSON.stringify({ t: "call", id: "1", method, params }));
    });
    s.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t !== "reply") return;
      clearTimeout(t);
      s.close();
      m.ok ? ok(m.result) : fail(new Error(m.error));
    });
  });
}

// folhas de contato dos GIFs para o diretor: uma pequena (silhueta), uma grande (poses) e,
// para cada animacao, os quadros grandes dos instantes de maior torcao de malha
// (query.malha) e de recorte a mostra (query.recorte): o diretor tem de olhar ali, onde a
// arte costuma quebrar
async function folhas() {
  const dir = join(caso, "entrega", "folhas");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(join(caso, "entrega")).filter((x) => x.endsWith(".gif"))) {
    const b = join(dir, f.replace(/\.gif$/, ""));
    spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", join(caso, "entrega", f), "-vf", "select='not(mod(n\\,3))',scale=160:-1,tile=8x3", "-frames:v", "1", `${b}_pequena.png`]);
    spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", join(caso, "entrega", f), "-vf", "select='not(mod(n\\,6))',scale=420:-1,tile=4x3", "-frames:v", "1", `${b}_grande.png`]);
  }
  try {
    const st = await call("state", {});
    const anims: string[] = (st?.file?.animations ?? st?.animations ?? []).map((a: any) => a.name ?? a);
    const novas = anims.length ? anims : (await call("exec", { calls: [{ cmd: "skeleton.info", args: {} }] })).results[0].animations.map((a: any) => a.name);
    // as do agente sao as exportadas; as outras (do animador) servem de referencia ao recorte
    const feitas = novas.filter((an) => existsSync(join(caso, "entrega", `${an}.gif`)));
    for (const an of feitas) {
      const [q, rc] = (await call("exec", { calls: [{ cmd: "query.malha", args: { anim: an, top: 3 } }, { cmd: "query.recorte", args: { anim: an, top: 3, exclude: feitas } }] })).results;
      // recorte a partir de 10% da altura: nos personagens do animador da casa 9 em 10
      // animacoes ficam abaixo (65% em zero); os agentes que tiveram recorte vetado, acima
      const momentos = [...(q.momentos ?? []), ...(rc?.momentos ?? []).filter((m: any) => m.recorte >= 10)];
      if (!momentos.length) continue;
      const times = [...new Set(momentos.map((m: any) => m.t))].sort((a: any, b: any) => a - b);
      const r = await call("look", { animation: an, times, fit: true, scale: 1 });
      writeFileSync(join(dir, `atencao_${an}.png`), Buffer.from(String(r.image).split(",")[1], "base64"));
      writeFileSync(join(dir, `atencao_${an}.json`), JSON.stringify(momentos, null, 1));
    }
  } catch (e: any) {
    log(`quadros de atencao: ${e.message}`);
  }
}

log(`claude -p no caso ${caso}`);
const t0 = Date.now();
const runs: any[] = [];
const notas: { rodada: number; nota: number | null }[] = [];
const revisoes = Number(opt("revisoes", "0"));
const meta = Number(opt("meta", "9"));
const rubrica = readFileSync(join(REPO, "docs", "RUBRICA.md"), "utf8");
const entrega = join(caso, "entrega");
const nota = (txt: string) => {
  const n = Number(/NOTA:\s*\**\s*([\d.,]+)/.exec(txt)?.[1]?.replace(",", ".") ?? NaN);
  return Number.isFinite(n) ? n : null;
};
// o modo sem perguntas as vezes recusa gravar na entrega: o que o agente respondeu no fim
// vira o arquivo, para ninguem depender da escrita dele
const relatorio = (res: any) => {
  if (!existsSync(join(entrega, "RELATORIO.md")) && res?.result) writeFileSync(join(entrega, "RELATORIO.md"), res.result + "\n");
};

let anim: Awaited<ReturnType<typeof runClaude>>;
let code = 0;
let feitas = 0;
async function revisar(r: number, n: number | null, txt: string) {
  const rp = `Notas do diretor de animacao (rodada ${r}, nota ${n ?? "?"}; a meta e ${meta}). Elas tambem
estao em ./entrega/DIRETOR_${r}.md:

${txt}

---
Corrija a animacao no editor seguindo as notas (as poses primeiro), confira de novo (ficha.check,
query.estilo, look grande), reexporte os GIFs para ./entrega e acrescente ao ./entrega/RELATORIO.md
uma secao "Revisao ${r}" com o que mudou e os numeros novos. Se nao conseguir gravar o relatorio,
ponha a secao na sua resposta final.`;
  anim = await runClaude(["-p", rp, "--resume", anim.result.session_id, ...base(animTools, mcp)], `revisao_${r}`, true);
  runs.push({ papel: "animador", rodada: r, exit: anim.code, custo_usd: anim.result?.total_cost_usd });
  code = anim.code;
  if (anim.result?.result) writeFileSync(join(out, `revisao_${r}.md`), anim.result.result + "\n");
}

if (rest.includes("--retomar")) {
  // continua um caso: a sessao do animador e a da ultima rodada dele; as notas pendentes
  // sao as do ultimo DIRETOR_n.md
  const last = readdirSync(out).filter((x) => /^(transcript|revisao_\d+)\.jsonl$/.test(x)).sort((a, b) => (a === "transcript.jsonl" ? -1 : b === "transcript.jsonl" ? 1 : +a.match(/\d+/)![0] - +b.match(/\d+/)![0])).pop()!;
  const lines = readFileSync(join(out, last), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  anim = { code: 0, lines, result: lines.find((m) => m.type === "result") };
  feitas = readdirSync(entrega).filter((x) => /^DIRETOR_\d+\.md$/.test(x)).length;
  if (feitas) {
    const txt = readFileSync(join(entrega, `DIRETOR_${feitas}.md`), "utf8");
    log(`retomando: revisao ${feitas} com as notas do diretor (${nota(txt)})`);
    await revisar(feitas, nota(txt), txt);
  }
} else {
  anim = await runClaude(["-p", prompt, ...base(animTools, mcp)], "transcript", true);
  runs.push({ papel: "animador", rodada: 0, exit: anim.code, custo_usd: anim.result?.total_cost_usd });
  code = anim.code;
}
relatorio(anim.result);

// 5. diretor: le so a entrega (folhas e relatorio), o pedido e a rubrica e responde com as
// notas (a bancada grava DIRETOR_n.md). Abaixo da meta o animador retoma a sessao com elas;
// depois da ultima revisao o diretor da a nota final.
for (let r = feitas + 1; revisoes && r <= revisoes + 1 && code === 0; r++) {
  await folhas();
  const dp = `Voce e o diretor de animacao da casa. Avalie a entrega de um animador pela rubrica abaixo,
sem abrir o editor e sem ver nenhuma outra animacao: olhe ./PEDIDO.md, ./entrega/RELATORIO.md e as
folhas de contato em ./entrega/folhas (as _pequena mostram a silhueta, as _grande as poses, as
atencao_* os instantes de maior torcao de malha e de recorte a mostra medidos, com os tempos, a
peca e quem a escondia no .json ao lado; leia as imagens com Read). Procure arte quebrada primeiro: ela veta a nota (no maximo 6). Nao grave arquivos: a sua resposta final e o parecer inteiro, em markdown, com a
nota de cada criterio, o que viu (instante em segundos e parte do corpo) e, se a nota final ficar
abaixo de ${meta}, as 3 mudancas que mais sobem a nota, em ordem e acionaveis. Seja exigente:
tecnicamente certo e timido e 6 ou 7. A ultima linha e "NOTA: <numero>".

${rubrica}`;
  const d = await runClaude(["-p", dp, ...base(["Read(./**)", "Glob"], null)], `diretor_${r}`);
  const txt = d.result?.result ?? "";
  writeFileSync(join(entrega, `DIRETOR_${r}.md`), txt + "\n");
  const n = nota(txt);
  notas.push({ rodada: r, nota: n });
  runs.push({ papel: "diretor", rodada: r, exit: d.code, custo_usd: d.result?.total_cost_usd, nota: n });
  log(`diretor ${r}: nota ${n}`);
  if (n === null || n >= meta || r > revisoes || !anim.result?.session_id) break;
  await revisar(r, n, txt);
}
if (revisoes) await folhas();
if (stopRec) await stopRec();
const minutes = ((Date.now() - t0) / 60000).toFixed(1);

// 6. resumo: resultado final, custo e uso de ferramentas (todas as rodadas do animador)
const uses: Record<string, number> = {};
let errors = 0;
for (const f of readdirSync(out).filter((x) => /^(transcript|revisao_\d+)\.jsonl$/.test(x)))
  for (const m of readFileSync(join(out, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) {
    for (const c of m.message?.content ?? []) {
      if (c.type === "tool_use") uses[c.name] = (uses[c.name] ?? 0) + 1;
      if (c.type === "tool_result" && c.is_error) errors++;
    }
  }
const summary = {
  caso,
  exit: code,
  minutos: +minutes,
  custo_usd: +runs.reduce((s, x) => s + (x.custo_usd ?? 0), 0).toFixed(2),
  rodadas: runs,
  notas_do_diretor: notas,
  erros_de_ferramenta: errors,
  ferramentas: uses,
  resultado: anim.result?.result?.slice?.(0, 4000),
};
writeFileSync(join(out, "resumo.json"), JSON.stringify(summary, null, 1));
log(`terminou (${code}) em ${minutes} min; resumo em ${join(out, "resumo.json")}`);
stop();
// o Chromium ainda escreve no perfil enquanto fecha
await sleep(1500);
try {
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
} catch {}
process.exit(code);
