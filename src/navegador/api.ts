// O /api do servidor (server/plugin.ts) dentro do navegador: o service worker (sw.ts) responde
// as mesmas rotas, com as mesmas respostas, lendo e gravando nas pastas de fs.ts. Assim o editor
// nao muda: fetch, miniaturas (<img src="/api/region...">) e texturas passam por aqui.
//
// O que precisa de programa de fora (Godot, sharp, as ferramentas de tools/) responde 501 com o
// motivo: PSD, empacotar atlas, arte HD, relevo, versao leve, efeitos e render no Godot.
import { atlasTexto, exportarSpine, importarSpine, type Boneco } from "../boneco/spine.ts";
import { parseAtlas, type AtlasRegion } from "../core/atlas-text.ts";
import { serializeSpineJson } from "../core/format.ts";
import { diffSpine } from "../core/versions.ts";
import * as fs from "./fs.ts";
import * as idb from "./idb.ts";

// o nucleo em wasm (so para o .boneco binario); quem cria e o sw.ts
let nucleo: () => Promise<any> = async () => {
  throw new Error("o nucleo nao foi ligado ao /api do navegador");
};
export const usarNucleo = (f: () => Promise<any>) => (nucleo = f);

const json = (corpo: any, status = 200, cabecalhos: Record<string, string> = {}) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...cabecalhos } });
const erro = (status: number, msg: string) => json({ error: msg }, status);

const MIME: Record<string, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json", "spine-json": "application/json", atlas: "text/plain", tres: "text/plain", gif: "image/gif", webm: "video/webm", md: "text/markdown; charset=utf-8" };
const mimeDe = (p: string) => MIME[p.slice(p.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
const GRAVAVEIS = /\.(spine-json|json|atlas|png|webp|tres|boneco|ficha\.md|notas\.json)$/;
const IMAGEM = /\.(png|webp|jpe?g)$/i;

// ---- .boneco: texto ou binario, e os tres arquivos virtuais (como server/boneco.ts)

const ehBinario = (b: Uint8Array) => b.length >= 5 && b[0] === 0x42 && b[1] === 0x4e && b[2] === 0x43 && b[3] === 0x42 && b[4] === 1;

async function lerBoneco(arquivo: string): Promise<{ b: Boneco; binario: boolean } | null> {
  const f = await fs.lerArquivo(arquivo);
  if (!f) return null;
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (!ehBinario(bytes)) return { b: JSON.parse(new TextDecoder().decode(bytes)), binario: false };
  const N = await nucleo();
  const p = N._malloc(bytes.length);
  try {
    N.HEAPU8.set(bytes, p);
    const t = N._mm_boneco_texto(p, bytes.length);
    if (!t) throw new Error(`${arquivo}: ${N.UTF8ToString(N._mm_erro())}`);
    return { b: JSON.parse(N.UTF8ToString(t)), binario: true };
  } finally {
    N._free(p);
  }
}

async function gravarBoneco(arquivo: string, b: Boneco, binario: boolean) {
  const texto = JSON.stringify(b, null, 1) + "\n";
  if (!binario) return fs.gravarArquivo(arquivo, texto);
  const N = await nucleo();
  const p = N.stringToNewUTF8(texto);
  try {
    const n = N._mm_boneco_binario(p);
    if (n < 0) throw new Error(`${arquivo}: ${N.UTF8ToString(N._mm_erro())}`);
    await fs.gravarArquivo(arquivo, N.HEAPU8.slice(N._mm_bytes(), N._mm_bytes() + n));
  } finally {
    N._free(p);
  }
}

const VIRTUAIS = /\.boneco\.(spine-json|atlas|ficha\.md)$/;
function virtual(p: string): { arquivo: string; parte: "spine-json" | "atlas" | "ficha.md" } | null {
  const m = VIRTUAIS.exec(p);
  return m ? { arquivo: p.slice(0, -m[1].length - 1), parte: m[1] as any } : null;
}

async function lerVirtual(p: string): Promise<string | null> {
  const v = virtual(p);
  const lido = v && (await lerBoneco(v.arquivo));
  if (!v || !lido) return null;
  if (v.parte === "atlas") return atlasTexto(lido.b);
  if (v.parte === "ficha.md") return lido.b.ficha?.texto ?? null;
  return serializeSpineJson(exportarSpine(lido.b).json, undefined, { reuse: false });
}

// regrava o .boneco com a parte nova, guardando o que so ele tem (como server/boneco.ts)
async function gravarVirtual(p: string, corpo: string) {
  const v = virtual(p)!;
  const lido = await lerBoneco(v.arquivo);
  if (!lido) throw Object.assign(new Error(`nao existe: ${v.arquivo}`), { code: 404 });
  const antigo = lido.b;
  const atual = exportarSpine(antigo);
  const [jsonNovo, atlasNovo, ficha] = v.parte === "spine-json" ? [JSON.parse(corpo), atual.atlas, antigo.ficha] : v.parte === "atlas" ? [atual.json, corpo, antigo.ficha] : [atual.json, atual.atlas, { ...(antigo.ficha ?? {}), texto: corpo }];
  const novo = importarSpine(jsonNovo, atlasNovo, antigo.nome);
  const motor = new Set((antigo.slots ?? []).filter((s: any) => s.blend === "multiplica_motor").map((s: any) => s.nome));
  for (const s of novo.slots ?? []) if (s.blend === "multiplica" && motor.has(s.nome)) s.blend = "multiplica_motor";
  for (const pg of novo.paginas) {
    const velha = (antigo.paginas ?? []).find((x: any) => x.arquivo === pg.arquivo);
    if (velha?.jogo) pg.jogo = velha.jogo;
  }
  if (antigo.mix) novo.mix = antigo.mix;
  if (ficha) novo.ficha = ficha;
  await copia(v.arquivo);
  await gravarBoneco(v.arquivo, novo, lido.binario);
}

const lerTextoOuVirtual = async (p: string) => (virtual(p) ? lerVirtual(p) : fs.lerTexto(p));

// ---- copias de seguranca: antes de sobrescrever, o arquivo vai para o IndexedDB (as 300 ultimas)

async function copia(p: string) {
  const f = await fs.lerArquivo(p).catch(() => null);
  if (!f) return;
  await idb.gravar("copias", `${new Date().toISOString()}|${p}`, f);
  const todas = (await idb.chaves("copias")).sort();
  for (const k of todas.slice(0, Math.max(0, todas.length - 300))) await idb.apagar("copias", k);
}

// ---- personagens nas pastas (como scanSpineAssets, so .boneco: o formato do navegador)

async function personagens() {
  const out: any[] = [];
  for (const r of await fs.raizes()) {
    if (!(await fs.permissao(r))) continue;
    for (const tres of await fs.percorrer(r.caminho, (n) => n.endsWith(".boneco"))) {
      try {
        const lido = await lerBoneco(tres);
        if (!lido || typeof lido.b.boneco !== "number") continue;
        const b = lido.b;
        const rel = tres.slice(r.caminho.length + 1);
        out.push({
          id: tres,
          name: fs.nomeDe(tres).replace(/\.boneco$/, ""),
          formato: "boneco",
          project: rel.includes("/") ? rel.split("/")[0] : r.nome,
          res: rel,
          skeleton: tres + ".spine-json",
          atlas: tres + ".atlas",
          tres,
          defaultMix: b.mix?.padrao ?? 0,
          mixes: (b.mix?.pares ?? []).map((m: any) => ({ from: m.de, to: m.para, mix: m.tempo })),
        });
      } catch {}
    }
  }
  return out;
}

// ---- imagens

async function bitmap(p: string): Promise<ImageBitmap | null> {
  const f = await fs.lerArquivo(p);
  return f ? createImageBitmap(f, { premultiplyAlpha: "none", colorSpaceConversion: "none" }) : null;
}

const png = (c: OffscreenCanvas) => c.convertToBlob({ type: "image/png" });

// imagem original de uma regiao do atlas (desrotacionada e com a transparencia recortada de
// volta, como server/atlas.ts extractRegion)
async function regiao(atlasPath: string, nome: string): Promise<Response> {
  const texto = await lerTextoOuVirtual(atlasPath);
  if (texto == null) return erro(404, `nao existe: ${atlasPath}`);
  const { pages, regions } = parseAtlas(texto);
  const r = regions.find((x) => x.name === nome) as AtlasRegion | undefined;
  if (!r) return erro(404, `regiao nao existe no atlas: ${nome}`);
  const page = pages.find((p) => p.name === r.page)!;
  const img = await bitmap(fs.pastaDe(atlasPath) + "/" + page.name);
  if (!img) return erro(404, `pagina nao existe: ${page.name}`);
  const rot = r.degrees === 90;
  const w = rot ? r.height : r.width,
    h = rot ? r.width : r.height;
  // a regiao em pe, no tamanho que ocupa
  const solta = new OffscreenCanvas(r.width, r.height);
  const g = solta.getContext("2d")!;
  if (rot) {
    // o Spine guarda "rotate:90" girada 90 graus no sentido anti-horario
    g.translate(r.width, 0);
    g.rotate(Math.PI / 2);
  }
  g.drawImage(img, r.x, r.y, w, h, 0, 0, w, h);
  let dados = g.getImageData(0, 0, r.width, r.height);
  if (page.pma) {
    const d = dados.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) d[i] = d[i + 1] = d[i + 2] = 0;
      else if (a < 255) for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.round((d[i + c] * 255) / a));
    }
  }
  const out = new OffscreenCanvas(r.originalWidth, r.originalHeight);
  out.getContext("2d")!.putImageData(dados, r.offsetX, r.originalHeight - r.offsetY - r.height);
  dados = null as any;
  return new Response(await png(out), { headers: { "content-type": "image/png" } });
}

async function imagens(dir: string) {
  const out: any[] = [];
  for (const file of await fs.percorrer(dir, (n) => IMAGEM.test(n))) {
    const b = await bitmap(file).catch(() => null);
    out.push({ name: file.slice(fs.normalizar(dir).length + 1).replace(/\.[^.]+$/, ""), file, width: b?.width, height: b?.height });
    b?.close();
  }
  return out;
}

// ---- notas (<nome>.notas.json ao lado, como server/notes.ts)

const caminhoNotas = (skel: string) => skel.replace(/\.(spine-json|json)$/, "") + ".notas.json";
async function notas(skel: string, acao?: any) {
  const p = caminhoNotas(skel);
  const f = JSON.parse((await fs.lerTexto(p)) ?? '{"versao":1,"notas":[]}');
  if (!acao) return f.notas;
  const agora = new Date().toISOString();
  const achar = (id: string) => {
    const n = f.notas.find((x: any) => x.id === id);
    if (!n) throw new Error(`nota nao existe: ${id}`);
    return n;
  };
  let out: any;
  if (acao.acao === "criar") {
    if (!acao.texto?.trim()) throw new Error("nota vazia");
    out = { id: crypto.randomUUID().slice(0, 8), at: agora, autor: acao.autor || "alguem", texto: acao.texto.trim(), anim: acao.anim ?? null, tempo: acao.tempo ?? null, osso: acao.osso ?? null, slot: acao.slot ?? null, estado: "aberta", respostas: [] };
    f.notas.push(out);
  } else if (acao.acao === "responder") {
    if (!acao.texto?.trim()) throw new Error("resposta vazia");
    out = achar(acao.id);
    out.respostas.push({ at: agora, autor: acao.autor || "alguem", texto: acao.texto.trim() });
  } else if (acao.acao === "editar") {
    out = achar(acao.id);
    out.texto = acao.texto.trim();
  } else if (acao.acao === "apagar") {
    achar(acao.id);
    f.notas = f.notas.filter((x: any) => x.id !== acao.id);
    out = { apagada: acao.id };
  } else {
    out = achar(acao.id);
    out.estado = acao.acao === "resolver" ? "resolvida" : "aberta";
    if (acao.autor) out.respostas.push({ at: agora, autor: acao.autor, texto: acao.acao === "resolver" ? "(marcou como resolvida)" : "(reabriu)" });
  }
  await copia(p);
  await fs.gravarArquivo(p, JSON.stringify(f, null, 1) + "\n");
  return out;
}

// ---- versoes (como server/versions.ts, guardadas no IndexedDB por hash)

type Versao = { id: string; at: string; label: string | null; source: string; skeleton: string; atlas: string | null; pages: Record<string, string>; bytes: number };
type Indice = { skeleton: string; atlas: string | null; versions: Versao[] };

async function sha(dados: ArrayBuffer | Uint8Array | string): Promise<string> {
  const b = typeof dados === "string" ? new TextEncoder().encode(dados) : dados;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function porBlob(dados: Blob | string): Promise<string> {
  const buf = typeof dados === "string" ? dados : await dados.arrayBuffer();
  const h = await sha(buf);
  if (!(await idb.ler("blobs", h))) await idb.gravar("blobs", h, dados);
  return h;
}
async function blobTexto(h: string | null): Promise<string | null> {
  if (!h) return null;
  const b = await idb.ler<Blob | string>("blobs", h);
  return b == null ? null : typeof b === "string" ? b : b.text();
}
const indice = async (skel: string): Promise<Indice> => (await idb.ler<Indice>("versoes", skel)) ?? { skeleton: skel, atlas: null, versions: [] };

async function guardarVersao(skel: string, atlasPath: string | null, label?: string | null, source = "ui"): Promise<{ entry: Versao; created: boolean }> {
  const idx = await indice(skel);
  atlasPath ??= idx.atlas;
  const texto = (await lerTextoOuVirtual(skel)) ?? "";
  const skeleton = await porBlob(texto);
  let atlas: string | null = null;
  const pages: Record<string, string> = {};
  const atlasTexto = atlasPath ? await lerTextoOuVirtual(atlasPath) : null;
  if (atlasPath && atlasTexto != null) {
    atlas = await porBlob(atlasTexto);
    for (const pg of parseAtlas(atlasTexto).pages) {
      const f = await fs.lerArquivo(fs.pastaDe(atlasPath) + "/" + pg.name);
      if (f) pages[pg.name] = await porBlob(f);
    }
  }
  const ultima = idx.versions[idx.versions.length - 1];
  if (ultima && !label && ultima.skeleton === skeleton && ultima.atlas === atlas && JSON.stringify(ultima.pages) === JSON.stringify(pages)) return { entry: ultima, created: false };
  const at = new Date().toISOString();
  const entry: Versao = { id: at.replace(/[-:.TZ]/g, "").slice(0, 17) + "-" + skeleton.slice(0, 6), at, label: label?.trim() || null, source, skeleton, atlas, pages, bytes: new TextEncoder().encode(texto).length };
  idx.atlas = atlasPath ?? null;
  idx.versions.push(entry);
  await idb.gravar("versoes", skel, idx);
  return { entry, created: true };
}

async function descrever(v: Versao, antes: Versao | undefined) {
  const changes = antes ? diffSpine(JSON.parse((await blobTexto(antes.skeleton))!), JSON.parse((await blobTexto(v.skeleton))!), await blobTexto(antes.atlas), await blobTexto(v.atlas)) : ["primeira versão"];
  return { id: v.id, at: v.at, label: v.label, source: v.source, bytes: v.bytes, changes };
}

async function gravarCaminho(p: string, dados: string | Blob) {
  if (virtual(p)) return gravarVirtual(p, typeof dados === "string" ? dados : await dados.text());
  await copia(p);
  await fs.gravarArquivo(p, dados);
}

async function versoes(url: URL, req: Request, corpo: any): Promise<Response> {
  const skel = fs.normalizar(corpo.skeleton ?? url.searchParams.get("skeleton") ?? "");
  const atlas = skel.endsWith(".boneco.spine-json") ? skel.replace(/\.spine-json$/, ".atlas") : (await indice(skel)).atlas;
  const lista = async () => (await indice(skel)).versions;
  if (url.pathname.endsWith("/api/versions") && req.method === "GET") {
    const vs = await lista();
    const n = Number(url.searchParams.get("limit") ?? 50);
    const out = await Promise.all(vs.map((v, i) => descrever(v, vs[i - 1])));
    return json(out.reverse().slice(0, n));
  }
  if (url.pathname.endsWith("/api/versions") && req.method === "POST") {
    const r = await guardarVersao(skel, atlas, corpo.label, corpo.source);
    const vs = await lista();
    const i = vs.findIndex((v) => v.id === r.entry.id);
    return json({ ...(await descrever(r.entry, i > 0 ? vs[i - 1] : undefined)), created: r.created });
  }
  const achar = async (id: string | null) => {
    const v = (await lista()).find((x) => x.id === id);
    if (!v) throw new Error(`versao nao existe: ${id}`);
    return v;
  };
  if (url.pathname.endsWith("/api/versions/diff")) {
    const v = await achar(corpo.id ?? url.searchParams.get("id"));
    const contra = corpo.against ?? url.searchParams.get("against");
    const c = contra ? await achar(contra) : null;
    const jsonAtual = c ? JSON.parse((await blobTexto(c.skeleton))!) : JSON.parse((await lerTextoOuVirtual(skel)) ?? "{}");
    const atlasAtual = c ? await blobTexto(c.atlas) : atlas ? await lerTextoOuVirtual(atlas) : null;
    return json({ id: v.id, label: v.label, against: contra ?? "atual", changes: diffSpine(JSON.parse((await blobTexto(v.skeleton))!), jsonAtual, await blobTexto(v.atlas), atlasAtual) });
  }
  if (url.pathname.endsWith("/api/versions/restore") && req.method === "POST") {
    const v = await achar(corpo.id);
    const before = (await guardarVersao(skel, atlas, `antes de restaurar ${v.label ?? v.id}`, corpo.source)).entry;
    await gravarCaminho(skel, (await blobTexto(v.skeleton))!);
    if (atlas && v.atlas) {
      await gravarCaminho(atlas, (await blobTexto(v.atlas))!);
      for (const [nome, h] of Object.entries(v.pages)) {
        const b = await idb.ler<Blob>("blobs", h);
        if (b) await gravarCaminho(fs.pastaDe(atlas) + "/" + nome, b);
      }
    }
    return json({ restored: v.id, label: v.label, before: before.id });
  }
  return erro(404, "rota desconhecida");
}

// ---- as rotas

const SO_COM_SERVIDOR: Record<string, string> = {
  "/api/godot/render": "renderizar no Godot",
  "/api/asset/create": "criar personagem de imagens soltas",
  "/api/psd/upload": "importar PSD",
  "/api/psd/create": "importar PSD",
  "/api/psd/update": "atualizar pelo PSD",
  "/api/atlas/upload": "trocar imagens (reempacotar o atlas)",
  "/api/atlas/add": "trocar imagens (reempacotar o atlas)",
  "/api/atlas-hd": "arte HD",
  "/api/efeito": "trazer efeitos",
  "/api/boneco/leve": "versao leve",
  "/api/relevo": "gerar o relevo",
  "/api/abrir-pasta": "abrir a pasta no computador",
  "/api/ficha/draft": "rascunho da ficha",
};

export async function responder(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // o /api fica em qualquer pasta do site (o build pode morar em /mamulengo/)
  const rota = url.pathname.slice(url.pathname.indexOf("/api/"));
  try {
    const corpoJson = async () => {
      const t = await req.text();
      return t ? JSON.parse(t) : {};
    };
    if (rota === "/api/assets") return json(await personagens());
    if (rota === "/api/roots") return json((await fs.raizes()).map((r) => r.caminho));
    if (rota === "/api/sessoes") return json({ local: { ativo: false, asset: null, fala: "", headless: 0 }, outras: [] });
    if (rota === "/api/efeitos") return json([]);
    if (rota === "/api/prefs") {
      const atual = (await idb.ler("kv", "prefs")) ?? {};
      if (req.method !== "PUT") return json(atual);
      const prox = { ...atual, ...(await corpoJson()) };
      await idb.gravar("kv", "prefs", prox);
      return json(prox);
    }
    if (rota === "/api/images") return json(await imagens(url.searchParams.get("dir") ?? ""));
    if (rota === "/api/region") return await regiao(fs.normalizar(url.searchParams.get("atlas") ?? ""), url.searchParams.get("name") ?? "");
    if (rota === "/api/texture") {
      const p = fs.normalizar(url.searchParams.get("p") ?? "");
      const f = await fs.lerArquivo(p);
      if (!f) return erro(404, `nao existe: ${p}`);
      // sem projeto Godot: a fonte, com o import emulado (como o servidor fora de um projeto)
      return new Response(f, { headers: { "content-type": mimeDe(p), "cache-control": "no-store", "x-texture-origin": "source", "x-fix-alpha-border": "true", "x-godot-filter": "linear", "x-godot-tint-black": "false" } });
    }
    if (rota === "/api/boneco/info") {
      const p = fs.normalizar(url.searchParams.get("p") ?? "");
      const f = p.endsWith(".boneco") ? await fs.lerArquivo(p) : null;
      if (!f) return erro(404, `nao e um .boneco: ${p}`);
      return json({ binario: ehBinario(new Uint8Array(await f.slice(0, 5).arrayBuffer())), bytes: f.size });
    }
    if (rota === "/api/boneco/formato" && req.method === "POST") {
      const b = await corpoJson();
      const p = fs.normalizar(b.boneco ?? "");
      const antes = (await fs.lerArquivo(p))?.size ?? 0;
      const lido = await lerBoneco(p);
      if (!lido) return erro(404, `nao existe: ${p}`);
      await copia(p);
      await gravarBoneco(p, lido.b, !!b.binario);
      return json({ binario: !!b.binario, antes, depois: (await fs.lerArquivo(p))?.size ?? 0 });
    }
    if (rota === "/api/notes") {
      const b = req.method === "POST" ? await corpoJson() : {};
      const skel = fs.normalizar(b.skeleton ?? url.searchParams.get("skeleton") ?? "");
      if (req.method === "GET") return json(await notas(skel));
      const { skeleton: _, ...acao } = b;
      return json(await notas(skel, acao));
    }
    if (rota.startsWith("/api/versions")) return await versoes(url, req, req.method === "POST" ? await corpoJson() : {});
    if (rota === "/api/export" && req.method === "POST") {
      const formato = url.searchParams.get("format");
      if (formato !== "gif" && formato !== "webm" && formato !== "webp") return erro(400, `formato invalido: ${formato} (gif, webm ou webp)`);
      // a pasta pedida (numa das pastas abertas), ou "exportados" na pasta do navegador
      const dir = fs.normalizar(url.searchParams.get("dir") ?? `${fs.OPFS}/exportados`);
      const nome = (url.searchParams.get("name") ?? "animacao").replace(/[^\w .-]+/g, "_").replace(/^\.+/, "") || "animacao";
      const corpo = await req.blob();
      if (!corpo.size) return erro(400, "arquivo vazio");
      const p = `${dir}/${nome}.${formato}`;
      await fs.gravarArquivo(p, corpo);
      return json({ ok: true, path: p, bytes: corpo.size });
    }
    if (rota === "/api/file") {
      const p = fs.normalizar(url.searchParams.get("p") ?? "");
      const fonte = req.headers.get("x-mamulengo-source") ?? "ui";
      if (req.method === "GET") {
        if (virtual(p)) {
          const t = await lerVirtual(p);
          return t == null ? erro(404, `nao existe: ${p}`) : new Response(t, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
        }
        const f = await fs.lerArquivo(p);
        return f ? new Response(f, { headers: { "content-type": mimeDe(p), "cache-control": "no-store" } }) : erro(404, `nao existe: ${p}`);
      }
      if (req.method === "PUT") {
        if (!virtual(p) && !GRAVAVEIS.test(p)) return erro(403, `tipo nao gravavel: ${p.slice(p.lastIndexOf("."))}`);
        const corpo = await req.blob();
        await gravarCaminho(p, virtual(p) ? await corpo.text() : corpo);
        // gravou o esqueleto de um personagem: vira versao automatica
        let version: string | undefined;
        if (p.endsWith(".boneco.spine-json")) version = (await guardarVersao(p, p.replace(/\.spine-json$/, ".atlas"), null, fonte)).entry.id;
        return json({ ok: true, bytes: corpo.size, path: p, ...(version ? { version } : {}) });
      }
    }
    const so = SO_COM_SERVIDOR[rota];
    if (so) return erro(501, `No editor pelo navegador ainda não dá para ${so}: isso precisa do Mamulengo instalado (npm run dev).`);
    return erro(404, "rota desconhecida");
  } catch (e: any) {
    if (e instanceof fs.SemPermissao) return erro(401, e.message);
    return erro(e?.code === 403 || e?.code === 404 ? e.code : 500, String(e?.message ?? e));
  }
}
