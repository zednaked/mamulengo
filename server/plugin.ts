// Plugin do Vite: API de arquivos (restrita as raizes configuradas) e a ponte
// WebSocket entre o editor (browser) e agentes (o servidor MCP do Claude).
//
// Protocolo da ponte (JSON por mensagem):
//   hello  {t:"hello", role:"editor"|"agent", name?}
//   call   {t:"call", id, method, params}         agente -> editor (via servidor)
//   reply  {t:"reply", id, ok, result?, error?}    editor -> agente
//   event  {t:"event", ...}                        editor -> todos os agentes
import type { Plugin, ViteDevServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { findProjectRoot, parseSkeletonDataTres, scanSpineAssets, toRes, type SpineAsset } from "./godot.ts";
import { gameContext, skeletonOf } from "./ficha-context.ts";
import { getVersion, listVersions, readBlob, restoreVersion, saveVersion } from "./versions.ts";
import { changeNotes, listNotes } from "./notes.ts";
import { diffSpine } from "../src/core/versions.ts";
import { draftFicha } from "../src/core/ficha.ts";

function parseSkeletonDataTresSafe(tres: string) {
  const a = parseSkeletonDataTres(tres);
  if (!a) throw new Error(`nao e um SpineSkeletonDataResource: ${tres}`);
  return a;
}
import { textureFor } from "./texture.ts";
import { addImages, createAsset, imageInfo, listImages } from "./assets.ts";
import { ensureImported, renderInGodot } from "./godot-run.ts";
import { extractRegion, parseAtlas, unpackAtlas } from "./atlas.ts";
import { createFromPsd, updateFromPsd } from "./psd.ts";
import sharp from "sharp";
import { bonecoVirtual, gravarVirtual, lerVirtual } from "./boneco.ts";

export const BRIDGE_PATH = "/__mamulengo";
const EXPORTS = join(homedir(), ".cache", "mamulengo", "exports");
// PSDs enviados pelo navegador (largar ou escolher arquivo)
const PSD_UPLOADS = join(homedir(), ".cache", "mamulengo", "psd");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
  ".spine-json": "application/json",
  ".atlas": "text/plain",
  ".tres": "text/plain",
};
const WRITABLE = new Set([".spine-json", ".json", ".atlas", ".png", ".webp", ".tres", ".boneco"]);

export function mamulengo(opts: { roots: string[] }): Plugin {
  const roots = opts.roots.map((r) => resolve(r));
  const inside = (p: string) => roots.some((r) => p === r || p.startsWith(r + sep));
  let cache: { at: number; list: SpineAsset[] } | null = null;

  const assets = () => {
    if (!cache || Date.now() - cache.at > 10_000) cache = { at: Date.now(), list: roots.flatMap((r) => (existsSync(r) ? scanSpineAssets(r) : [])) };
    return cache.list;
  };

  // mesmas rotas e ponte no dev server e no preview (build congelado para medicoes)
  const install = (server: { middlewares: any; httpServer: any }) => {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (!url.pathname.startsWith("/api/")) return next();
        const send = (code: number, body: any, type = "application/json") => {
          res.statusCode = code;
          res.setHeader("content-type", type);
          res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
        };
        try {
          if (url.pathname === "/api/assets") {
            if (url.searchParams.has("refresh")) cache = null;
            return send(
              200,
              assets().map((a) => {
                // .boneco pode viver fora de um projeto Godot (sem res://)
                const proj = findProjectRoot(dirname(a.tres));
                const root = roots.find((r) => inside(a.tres) && a.tres.startsWith(r + sep)) ?? roots[0];
                return {
                  id: a.tres,
                  name: basename(a.skeleton).replace(/\.boneco\.spine-json$|\.spine-json$|\.json$/, ""),
                  ...(a.tres.endsWith(".boneco") ? { formato: "boneco" } : {}),
                  // primeira pasta abaixo da raiz (ex: MeuJogo)
                  project: relative(root, a.tres).split(sep)[0],
                  res: proj ? toRes(proj, a.skeleton) : a.skeleton,
                  skeleton: a.skeleton,
                  atlas: a.atlas,
                  tres: a.tres,
                  defaultMix: a.defaultMix,
                  mixes: a.mixes,
                  // o .tres aponta para arquivos que nao existem (copiado de outro projeto, res:// errado)
                  ...(!existsSync(a.skeleton) || !existsSync(a.atlas)
                    ? a.tres.endsWith(".boneco")
                      ? {}
                      : { broken: `o ${basename(a.tres)} aponta para ${!existsSync(a.skeleton) ? toRes(proj!, a.skeleton) : toRes(proj!, a.atlas)}, que nao existe neste projeto Godot (res:// e relativo ao project.godot)` }
                    : {}),
                };
              }),
            );
          }
          if (url.pathname === "/api/roots") return send(200, roots);
          if (url.pathname === "/api/prefs") {
            // preferencias da interface (paineis, abas, legenda): valem em qualquer janela,
            // porta ou perfil do navegador (o localStorage e separado por endereco)
            const file = join(homedir(), ".local", "share", "mamulengo", "preferencias.json");
            const cur = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
            if (req.method === "PUT") {
              const next = { ...cur, ...JSON.parse(String(await readBody(req)) || "{}") };
              mkdirSync(dirname(file), { recursive: true });
              writeFileSync(file, JSON.stringify(next, null, 1) + "\n");
              return send(200, next);
            }
            return send(200, cur);
          }
          if (url.pathname === "/api/sessoes") {
            // agente neste servidor (chamou no ultimo minuto e meio) e bancadas em outros
            const outras: any[] = [];
            for (const f of existsSync(SESSOES) ? readdirSync(SESSOES) : []) {
              try {
                const j = JSON.parse(readFileSync(join(SESSOES, f), "utf8"));
                process.kill(j.pid, 0);
                outras.push(j);
              } catch {}
            }
            return send(200, { local: { ativo: Date.now() - live.lastCallAt < 90_000, asset: live.asset, fala: live.fala, headless: live.headless }, outras });
          }
          const json = async () => JSON.parse(String(await readBody(req)) || "{}");
          const guard = (...ps: string[]) => {
            for (const p of ps) if (!inside(resolve(p))) throw Object.assign(new Error(`fora das raizes configuradas: ${p}`), { code: 403 });
          };
          if (url.pathname === "/api/images") {
            const dir = resolve(url.searchParams.get("dir") ?? "");
            guard(dir);
            return send(200, await imageInfo(listImages(dir)));
          }
          // imagem original de uma regiao do atlas (alpha simples), para malha automatica
          if (url.pathname === "/api/region") {
            const atlasPath = resolve(url.searchParams.get("atlas") ?? "");
            guard(atlasPath);
            const name = url.searchParams.get("name") ?? "";
            // o atlas de um .boneco e virtual (x.boneco.atlas): o texto vem do .boneco
            const texto = bonecoVirtual(atlasPath) ? lerVirtual(atlasPath)! : readFileSync(atlasPath, "utf8");
            const { pages, regions } = parseAtlas(texto);
            const r = regions.find((x) => x.name === name);
            if (!r) return send(404, { error: `regiao nao existe no atlas: ${name}` });
            const page = pages.find((p) => p.name === r.page)!;
            const png = await extractRegion(sharp(join(dirname(atlasPath), page.name)), r, { unpremultiply: page.pma });
            return send(200, png, "image/png");
          }
          // quadro renderizado no Godot de verdade (importa o projeto antes, se preciso)
          if (url.pathname === "/api/godot/render" && req.method === "POST") {
            const b = await json();
            guard(b.tres);
            const a = parseSkeletonDataTresSafe(b.tres);
            const project = findProjectRoot(dirname(b.tres))!;
            const pages = parseAtlas(readFileSync(a.atlas, "utf8")).pages.map((p) => join(dirname(a.atlas), p.name));
            const imported = await ensureImported(project, [a.skeleton, a.atlas, ...pages]);
            const shots = await renderInGodot({ tres: b.tres, animation: b.animation ?? null, times: [b.time ?? 0], rect: b.rect, size: b.size, background: b.background ?? [0.2, 0.2, 0.2] });
            res.setHeader("x-imported", String(imported));
            return send(200, shots[0].png, "image/png");
          }
          if (url.pathname === "/api/asset/create" && req.method === "POST") {
            const b = await json();
            guard(b.dir, b.imagesFrom);
            const r = await createAsset({ dir: resolve(b.dir), name: b.name, imagesFrom: resolve(b.imagesFrom) });
            cache = null;
            return send(200, r);
          }
          // PSD enviado pelo navegador: guarda em ~/.cache/mamulengo/psd e devolve o caminho
          if (url.pathname === "/api/psd/upload" && req.method === "POST") {
            const name = (url.searchParams.get("name") ?? "arte.psd").replace(/[^\w .-]+/g, "_").replace(/^\.+/, "") || "arte.psd";
            const body = await readBody(req);
            if (!body.length) return send(400, { error: "arquivo vazio" });
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            const dir = join(PSD_UPLOADS, stamp);
            mkdirSync(dir, { recursive: true });
            const p = join(dir, name);
            writeFileSync(p, body);
            return send(200, { path: p, bytes: body.length });
          }
          // PSD: dentro das raizes ou enviado pelo navegador
          const guardPsd = (p: string) => {
            const r = resolve(p ?? "");
            if (!r.startsWith(PSD_UPLOADS + sep)) guard(r);
            if (!existsSync(r)) throw new Error(`PSD nao encontrado: ${r}`);
            return r;
          };
          // personagem novo montado a partir de um PSD
          if (url.pathname === "/api/psd/create" && req.method === "POST") {
            const b = await json();
            guard(b.dir);
            const r = await createFromPsd({ psd: guardPsd(b.psd), dir: resolve(b.dir), name: String(b.name ?? "").trim(), read: { ignoreHidden: !!b.ignoreHidden } });
            cache = null;
            return send(200, { tres: r.tres, skeleton: r.skeleton, atlas: r.atlas, pages: r.pages, report: r.report, summary: r.summary, plan: r.plan });
          }
          // asset aberto: grava as imagens do PSD e reempacota; os comandos rodam no editor
          if (url.pathname === "/api/psd/update" && req.method === "POST") {
            const b = await json();
            guard(b.atlas);
            const r = await updateFromPsd({ psd: guardPsd(b.psd), atlas: resolve(b.atlas), meshImages: b.meshImages ?? [], read: { ignoreHidden: !!b.ignoreHidden }, backup });
            return send(200, r);
          }
          // imagem enviada pelo navegador: grava em <pasta do atlas>/images/<nome>.png
          if (url.pathname === "/api/atlas/upload" && req.method === "POST") {
            const atlasPath = resolve(url.searchParams.get("atlas") ?? "");
            guard(atlasPath);
            const name = (url.searchParams.get("name") ?? "").replace(/[^\w .-]+/g, "_");
            if (!name) return send(400, { error: "nome vazio" });
            const imagesDir = join(dirname(atlasPath), "images");
            // asset vindo do Spine sem a pasta de fontes: extrai do atlas antes
            if (!listImages(imagesDir).length) await unpackAtlas(atlasPath, readFileSync(atlasPath, "utf8"), imagesDir);
            const body = await readBody(req);
            const png = await sharp(body).png().toBuffer();
            mkdirSync(imagesDir, { recursive: true });
            writeFileSync(join(imagesDir, name + ".png"), png);
            return send(200, { ok: true, name });
          }
          if (url.pathname === "/api/atlas/add" && req.method === "POST") {
            const b = await json();
            guard(b.atlas, ...(b.files ?? []));
            for (const f of b.files ?? []) backup(f);
            backup(b.atlas);
            return send(200, await addImages({ atlas: resolve(b.atlas), files: (b.files ?? []).map((f: string) => resolve(f)), names: b.names }));
          }
          // pagina de atlas como o jogo a ve (import do Godot), com metadados em cabecalhos
          if (url.pathname === "/api/texture") {
            const p = resolve(url.searchParams.get("p") ?? "");
            if (!inside(p)) return send(403, { error: `fora das raizes configuradas: ${p}` });
            if (!existsSync(p)) return send(404, { error: `nao existe: ${p}` });
            const t = textureFor(p);
            res.setHeader("cache-control", "no-store");
            res.setHeader("x-texture-origin", t.origin);
            res.setHeader("x-fix-alpha-border", String(t.fixAlphaBorder));
            res.setHeader("x-godot-filter", t.godotFilter);
            res.setHeader("x-godot-tint-black", String(t.tintBlack));
            if (t.note) res.setHeader("x-texture-note", encodeURIComponent(t.note));
            return send(200, t.body, t.mime);
          }
          // GIF/WebM exportado pelo editor: grava na pasta pedida (dentro das raizes)
          // ou em ~/.cache/mamulengo/exports, e devolve o caminho
          if (url.pathname === "/api/export" && req.method === "POST") {
            const format = url.searchParams.get("format");
            if (format !== "gif" && format !== "webm") return send(400, { error: `formato invalido: ${format} (gif ou webm)` });
            const dirParam = url.searchParams.get("dir");
            const dir = dirParam ? resolve(dirParam.replace(/^~(?=\/|$)/, homedir())) : EXPORTS;
            if (dirParam) guard(dir);
            const name = (url.searchParams.get("name") ?? "animacao").replace(/[^\w .-]+/g, "_").replace(/^\.+/, "") || "animacao";
            const p = join(dir, `${name}.${format}`);
            const body = await readBody(req);
            if (!body.length) return send(400, { error: "arquivo vazio" });
            mkdirSync(dir, { recursive: true });
            backup(p);
            writeFileSync(p, body);
            return send(200, { ok: true, path: p, bytes: body.length });
          }
          // rascunho da ficha do personagem com o contexto do jogo (codigo Godot, mixes);
          // o documento vem do editor (pode ter mudancas nao salvas)
          if (url.pathname === "/api/ficha/draft" && req.method === "POST") {
            const { json, skeleton, name } = JSON.parse((await readBody(req)).toString("utf8"));
            const p = resolve(skeleton ?? "");
            if (!inside(p)) return send(403, { error: `fora das raizes configuradas: ${p}` });
            const { tres } = skeletonOf(p);
            const md = draftFicha(json, name ?? basename(p).replace(/\.(spine-json|json)$/, ""), gameContext(p, tres, Object.keys(json.animations ?? {})));
            return send(200, md, "text/markdown; charset=utf-8");
          }
          // anotacoes do personagem (<nome>.notas.json): listar e mudar (criar, responder, resolver...)
          if (url.pathname === "/api/notes") {
            const b = req.method === "POST" ? JSON.parse((await readBody(req)).toString("utf8")) : {};
            const skel = resolve(b.skeleton ?? url.searchParams.get("skeleton") ?? "");
            if (!inside(skel)) return send(403, { error: `fora das raizes configuradas: ${skel}` });
            if (req.method === "GET") return send(200, listNotes(skel));
            const { skeleton: _, ...action } = b;
            return send(200, changeNotes(skel, action, backup));
          }
          // versoes do personagem (alem do desfazer): listar, marcar, comparar, restaurar
          if (url.pathname.startsWith("/api/versions")) {
            const b = req.method === "POST" ? JSON.parse((await readBody(req)).toString("utf8")) : {};
            const skel = resolve(b.skeleton ?? url.searchParams.get("skeleton") ?? "");
            if (!inside(skel)) return send(403, { error: `fora das raizes configuradas: ${skel}` });
            const asset = assets().find((a) => resolve(a.skeleton) === skel);
            const atlas = asset?.atlas ?? null;
            const text = (h: string | null) => (h ? readBlob(h).toString("utf8") : null);
            const describe = (v: any, prev: any) => ({
              id: v.id,
              at: v.at,
              label: v.label,
              source: v.source,
              bytes: v.bytes,
              changes: prev ? diffSpine(JSON.parse(text(prev.skeleton)!), JSON.parse(text(v.skeleton)!), text(prev.atlas), text(v.atlas)) : ["primeira versao"],
            });
            if (url.pathname === "/api/versions" && req.method === "GET") {
              const vs = listVersions(skel);
              const n = Number(url.searchParams.get("limit") ?? 50);
              return send(200, vs.map((v, i) => describe(v, vs[i - 1])).reverse().slice(0, n));
            }
            if (url.pathname === "/api/versions" && req.method === "POST") {
              const r = saveVersion({ skeleton: skel, atlas, label: b.label, source: b.source });
              const all = listVersions(skel);
              const i = all.findIndex((v) => v.id === r.entry.id);
              return send(200, { ...describe(r.entry, i > 0 ? all[i - 1] : null), created: r.created });
            }
            if (url.pathname === "/api/versions/diff") {
              // id contra o arquivo atual no disco (ou contra outra versao: against)
              const v = getVersion(skel, b.id ?? url.searchParams.get("id"));
              const against = b.against ?? url.searchParams.get("against");
              const cur = against ? getVersion(skel, against) : null;
              const curJson = cur ? JSON.parse(text(cur.skeleton)!) : JSON.parse(readFileSync(skel, "utf8"));
              const curAtlas = cur ? text(cur.atlas) : atlas && existsSync(atlas) ? readFileSync(atlas, "utf8") : null;
              return send(200, { id: v.id, label: v.label, against: against ?? "atual", changes: diffSpine(JSON.parse(text(v.skeleton)!), curJson, text(v.atlas), curAtlas) });
            }
            if (url.pathname === "/api/versions/restore" && req.method === "POST") {
              const r = restoreVersion({ skeleton: skel, atlas, id: b.id, source: b.source, backup });
              cache = null;
              return send(200, { restored: r.restored.id, label: r.restored.label, before: r.before.id });
            }
          }
          if (url.pathname === "/api/file") {
            const p = resolve(url.searchParams.get("p") ?? "");
            if (!inside(p)) return send(403, { error: `fora das raizes configuradas: ${p}` });
            // x.boneco aparece como .spine-json, .atlas e .ficha.md virtuais (server/boneco.ts)
            if (bonecoVirtual(p)) {
              if (req.method === "GET") {
                res.setHeader("cache-control", "no-store");
                return send(200, lerVirtual(p)!, "text/plain; charset=utf-8");
              }
              if (req.method === "PUT") {
                const body = await readBody(req);
                gravarVirtual(p, body);
                cache = null;
                return send(200, { ok: true, bytes: body.length, path: p });
              }
            }
            if (req.method === "GET") {
              if (!existsSync(p)) return send(404, { error: `nao existe: ${p}` });
              res.setHeader("cache-control", "no-store");
              return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
            }
            if (req.method === "PUT") {
              if (!WRITABLE.has(extname(p)) && !p.endsWith(".ficha.md")) return send(403, { error: `tipo nao gravavel: ${extname(p)}` });
              const body = await readBody(req);
              backup(p);
              // grava atomico: arquivo temporario + rename
              const tmp = p + ".mamulengo-tmp";
              mkdirSync(dirname(p), { recursive: true });
              writeFileSync(tmp, body);
              renameSync(tmp, p);
              cache = null;
              // gravou o esqueleto de um personagem: vira versao automatica
              let version: string | undefined;
              const asset = /\.(spine-json|json)$/.test(p) ? assets().find((a) => resolve(a.skeleton) === p) : undefined;
              if (asset) version = saveVersion({ skeleton: p, atlas: asset.atlas, source: String(req.headers["x-mamulengo-source"] ?? "ui") }).entry.id;
              return send(200, { ok: true, bytes: body.length, path: p, ...(version ? { version } : {}) });
            }
          }
          return send(404, { error: "rota desconhecida" });
        } catch (e: any) {
          return send(e?.code === 403 || e?.code === 404 ? e.code : 500, { error: String(e?.message ?? e) });
        }
      });

      bridge(server);
  };

  return {
    name: "mamulengo",
    configureServer: (server: ViteDevServer) => {
      install(server);
      // o codigo do servidor (rotas, ponte, versoes) roda dentro do Vite: mudou um arquivo
      // de server/, reinicia o servidor para valer (antes ficava o codigo velho ate alguem
      // reiniciar a mao). O editor e o MCP reconectam sozinhos.
      const dir = fileURLToPath(new URL(".", import.meta.url));
      if (process.env.MAMULENGO_ESTAVEL) return;
      server.watcher.add(dir);
      let timer: ReturnType<typeof setTimeout> | null = null;
      server.watcher.on("change", (f) => {
        if (!f.startsWith(dir) || !f.endsWith(".ts")) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          // processo novo, nao server.restart(): reiniciado no mesmo processo, o plugin do
          // Svelte passava a servir o .svelte cru como CSS e o layout do editor desmontava
          server.config.logger.info(`[mamulengo] ${f.slice(dir.length)} mudou: reiniciando o servidor (processo novo)`, { timestamp: true });
          await server.close();
          spawn(process.execPath, process.argv.slice(1), { cwd: process.cwd(), env: process.env, detached: true, stdio: "inherit" }).unref();
          process.exit(0);
        }, 150);
      });
    },
    configurePreviewServer: (server) => install(server),
  };
}

function readBody(req: any): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", fail);
  });
}

// Copia o arquivo antes de sobrescrever. Fica fora dos projetos para nao sujar o git deles.
function backup(p: string) {
  if (!existsSync(p) || !statSync(p).isFile()) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(homedir(), ".cache", "mamulengo", "backups", stamp);
  mkdirSync(dir, { recursive: true });
  copyFileSync(p, join(dir, basename(p)));
}

// O que o agente esta fazendo neste servidor (para a rota /api/sessoes e o acompanhamento
// automatico): ultima chamada, personagem aberto no editor dele e a ultima fala
// `headless`: quantos editores sem janela (os que o agente usa para fotos e testes) estao ligados
export const live = { lastCallAt: 0, asset: null as null | { id: string; name: string; project: string }, fala: "", headless: 0 };
// sessoes de agente em outros servidores (a bancada se anuncia aqui ao comecar)
export const SESSOES = join(homedir(), ".cache", "mamulengo", "sessoes");

function bridge(server: { httpServer: any }) {
  const wss = new WebSocketServer({ noServer: true });
  const editors: { ws: WebSocket; name: string; focusedAt: number }[] = [];
  const agents = new Set<WebSocket>();
  // espectadores: abas que so assistem ao editor que o agente esta usando (?espectador)
  const spectators = new Set<WebSocket>();
  let lastMirror: string | null = null;
  // cada agente fica no editor da primeira chamada (a aba focada por ultimo podia ser outra
  // pessoa mexendo em outro personagem); o espelho mostra o editor usado por ultimo
  const bound = new Map<WebSocket, WebSocket>();
  let lastUsed: WebSocket | null = null;
  const tellEditors = () => {
    const on = JSON.stringify({ t: "espelhar", on: spectators.size > 0 });
    for (const e of editors) e.ws.send(on);
  };
  // id do servidor -> quem chamou
  const pending = new Map<string, { ws: WebSocket; id: string; editor: WebSocket }>();
  let seq = 0;

  // ao reiniciar o Vite, o servidor http antigo fecha: derruba as conexoes da ponte junto,
  // senao o editor e o MCP ficam presos num socket que ninguem mais atende
  server.httpServer?.on("close", () => {
    for (const c of wss.clients) c.terminate();
    wss.close();
  });
  server.httpServer?.on("upgrade", (req: any, socket: any, head: any) => {
    if (!req.url?.startsWith(BRIDGE_PATH)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  const activeEditor = () => editors.slice().sort((a, b) => b.focusedAt - a.focusedAt)[0];
  const status = () => JSON.stringify({ t: "status", editors: editors.length });

  wss.on("connection", (ws) => {
    let role: "editor" | "agent" | "espectador" | null = null;
    ws.on("message", (raw) => {
      let m: any;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.t === "hello") {
        role = m.role;
        if (role === "editor") {
          editors.push({ ws, name: m.name ?? "editor", focusedAt: Date.now() });
          live.headless = editors.filter((e) => e.name === "headless").length;
          for (const a of agents) a.send(status());
          if (spectators.size) ws.send(JSON.stringify({ t: "espelhar", on: true }));
        } else if (role === "espectador") {
          spectators.add(ws);
          tellEditors();
          if (lastMirror) ws.send(lastMirror);
          // estado completo agora (sem esperar o proximo comando do agente)
          const src = lastUsed && editors.some((e) => e.ws === lastUsed) ? lastUsed : activeEditor()?.ws;
          src?.send(JSON.stringify({ t: "espelhar", on: true, again: true }));
        } else {
          agents.add(ws);
          ws.send(status());
        }
        return;
      }
      if (m.t === "focus" && role === "editor") {
        const e = editors.find((x) => x.ws === ws);
        if (e) e.focusedAt = Date.now();
        return;
      }
      if (m.t === "narracao") {
        // fala do agente (a bancada le a transcricao): vai para os editores e espectadores
        live.fala = String(m.text ?? "").slice(0, 600);
        const msg = JSON.stringify({ t: "narracao", text: live.fala, at: Date.now() });
        for (const e of editors) e.ws.send(msg);
        for (const sp of spectators) sp.send(msg);
        return;
      }
      if (m.t === "espelho" && role === "editor") {
        // so o editor que o agente esta usando (ou o focado, sem agente) aparece
        const src = lastUsed && editors.some((e) => e.ws === lastUsed) ? lastUsed : activeEditor()?.ws;
        if (ws !== src) return;
        if (m.asset) live.asset = { id: m.asset.id, name: m.asset.name, project: m.asset.project };
        lastMirror = String(raw);
        for (const sp of spectators) sp.send(lastMirror);
        return;
      }
      if (m.t === "call" && role === "agent") {
        live.lastCallAt = Date.now();
        const mine = bound.get(ws);
        const ed = mine && editors.find((e) => e.ws === mine) ? editors.find((e) => e.ws === mine)! : activeEditor();
        if (ed) {
          bound.set(ws, ed.ws);
          if (lastUsed !== ed.ws) for (const e of editors) e.ws.send(JSON.stringify({ t: "agente", aqui: e.ws === ed.ws }));
          if (lastUsed !== ed.ws) {
            lastUsed = ed.ws;
            // o espelho passa a mostrar este editor: ele manda o estado inteiro de novo
            if (spectators.size) ed.ws.send(JSON.stringify({ t: "espelhar", on: true, again: true }));
          }
        }
        if (!ed) {
          ws.send(JSON.stringify({ t: "reply", id: m.id, ok: false, error: "nenhum editor aberto. Abra o Mamulengo no navegador (npm run dev)." }));
          return;
        }
        const sid = String(++seq);
        pending.set(sid, { ws, id: m.id, editor: ed.ws });
        ed.ws.send(JSON.stringify({ t: "call", id: sid, method: m.method, params: m.params }));
        return;
      }
      if (m.t === "reply" && role === "editor") {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        p.ws.send(JSON.stringify({ ...m, id: p.id }));
        return;
      }
      if (m.t === "event" && role === "editor") for (const a of agents) a.send(String(raw));
    });
    ws.on("close", () => {
      const i = editors.findIndex((x) => x.ws === ws);
      if (i >= 0) {
        editors.splice(i, 1);
        // chamadas em voo para esse editor falham em vez de ficar penduradas
        for (const [sid, p] of pending) {
          if (p.editor !== ws) continue;
          p.ws.send(JSON.stringify({ t: "reply", id: p.id, ok: false, error: "o editor fechou" }));
          pending.delete(sid);
        }
        live.headless = editors.filter((e) => e.name === "headless").length;
        for (const a of agents) a.send(status());
      }
      agents.delete(ws);
      bound.delete(ws);
      if (spectators.delete(ws)) tellEditors();
      if (lastUsed === ws) lastUsed = null;
    });
  });
}
