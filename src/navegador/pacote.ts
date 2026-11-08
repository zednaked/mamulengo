// Levar personagens para fora e para dentro do navegador em .zip (rotas do /api, em ROTAS de
// api.ts). No Firefox e no Safari nao ha pasta do computador: sem isto o trabalho fica preso na
// pasta propria do navegador.
//   GET  /api/zip/personagem?p=<.boneco>   o .boneco e tudo o que ele usa: paginas (e as de
//                                          relevo), images/ ao lado, as notas e os .boneco das
//                                          instancias (com as paginas deles), caminhos relativos
//   GET  /api/zip/pasta?p=<pasta>          tudo abaixo de uma pasta
//   POST /api/zip/importar?nome=<x.zip>&destino=<pasta>   corpo: o .zip; abre em <destino>/<x>/
//                                          (destino padrao: a pasta do navegador), sem sobrescrever
import { lerBoneco } from "./api.ts";
import * as fs from "./fs.ts";
import { caminhoSeguro, deszipar, zipar, type Entrada } from "./zip.ts";

const json = (corpo: any, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const erro = (status: number, msg: string) => json({ error: msg }, status);

// nome de arquivo ou pasta sem barra nem caractere estranho
const limpar = (s: string) => s.replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim() || "pacote";

// os arquivos de um personagem (caminhos absolutos) e os que ele cita mas nao existem
export async function arquivosDoPersonagem(tres: string): Promise<{ arquivos: string[]; faltando: string[] }> {
  const arquivos = new Set<string>();
  const faltando = new Set<string>();
  const vistos = new Set<string>();
  const pedir = async (p: string) => {
    if (arquivos.has(p) || faltando.has(p)) return;
    if (await fs.existe(p)) arquivos.add(p);
    else faltando.add(p);
  };
  const visitar = async (b: string) => {
    if (vistos.has(b)) return;
    vistos.add(b);
    const lido = await lerBoneco(b);
    if (!lido) return void faltando.add(b);
    arquivos.add(b);
    const dir = fs.pastaDe(b);
    for (const pg of lido.b.paginas ?? []) {
      if (pg.arquivo) await pedir(fs.normalizar(`${dir}/${pg.arquivo}`));
      if (pg.relevo) await pedir(fs.normalizar(`${dir}/${pg.relevo}`));
    }
    // as fontes das imagens (importacao do PSD), as notas
    if (await fs.existePasta(`${dir}/images`)) for (const f of await fs.percorrer(`${dir}/images`)) arquivos.add(f);
    for (const n of [`${b}.notas.json`, b.replace(/\.boneco$/, "") + ".notas.json"]) if (await fs.existe(n)) arquivos.add(n);
    for (const i of lido.b.instancias ?? []) if (typeof i?.boneco === "string") await visitar(fs.normalizar(`${dir}/${i.boneco}`));
  };
  await visitar(fs.normalizar(tres));
  return { arquivos: [...arquivos].sort(), faltando: [...faltando].sort() };
}

// a pasta comum a todos (as instancias podem estar acima do personagem)
function pastaComum(caminhos: string[]): string {
  let comum = fs.pastaDe(caminhos[0]).split("/");
  for (const c of caminhos) {
    const d = fs.pastaDe(c).split("/");
    let i = 0;
    while (i < comum.length && i < d.length && comum[i] === d[i]) i++;
    comum = comum.slice(0, i);
  }
  return comum.join("/") || "/";
}

async function empacotar(caminhos: string[], base: string, topo: string): Promise<Blob> {
  const entradas: Entrada[] = [];
  for (const c of caminhos) {
    const f = await fs.lerArquivo(c);
    if (!f) continue;
    const rel = c.slice(base === "/" ? 1 : base.length + 1);
    entradas.push({ nome: `${topo}/${rel}`, dados: new Uint8Array(await f.arrayBuffer()), data: new Date(f.lastModified) });
  }
  return zipar(entradas);
}

const baixavel = (zip: Blob, nome: string, extra: Record<string, string> = {}) =>
  new Response(zip, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`, "cache-control": "no-store", ...extra } });

// abre o .zip numa pasta nova; devolve a pasta, os arquivos e os .boneco
export async function importar(zip: Uint8Array, nomeZip: string, destino: string): Promise<{ pasta: string; arquivos: string[]; bonecos: string[] }> {
  const entradas = (await deszipar(zip)).filter((e) => !/(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/.test(e.nome.replace(/\\/g, "/")));
  const ruins = entradas.filter((e) => caminhoSeguro(e.nome) == null).map((e) => e.nome);
  if (ruins.length) throw Object.assign(new Error(`o .zip tem caminhos que saem da pasta (com .. ou absolutos), nada foi gravado: ${ruins.slice(0, 5).join(", ")}`), { code: 400 });
  if (!entradas.length) throw Object.assign(new Error("o .zip está vazio"), { code: 400 });
  let rels = entradas.map((e) => caminhoSeguro(e.nome)!);
  // tudo dentro de uma pasta so (o zip -r de uma pasta, ou o que o editor grava): sem ela
  const topo = rels[0].split("/")[0];
  if (rels.every((r) => r.startsWith(topo + "/"))) rels = rels.map((r) => r.slice(topo.length + 1));
  if (new Set(rels).size !== rels.length) throw Object.assign(new Error("o .zip tem o mesmo arquivo duas vezes"), { code: 400 });
  // pasta nova: nunca grava por cima do que ja existe
  const nome = limpar(nomeZip.replace(/\.zip$/i, ""));
  let pasta = fs.normalizar(`${destino}/${nome}`);
  for (let i = 2; (await fs.existePasta(pasta)) || (await fs.existe(pasta)); i++) pasta = fs.normalizar(`${destino}/${nome}-${i}`);
  const arquivos: string[] = [];
  for (let i = 0; i < entradas.length; i++) {
    const p = `${pasta}/${rels[i]}`;
    await fs.gravarArquivo(p, entradas[i].dados);
    arquivos.push(p);
  }
  return { pasta, arquivos, bonecos: arquivos.filter((a) => a.endsWith(".boneco")) };
}

export async function rotaZip(rota: string, req: Request, url: URL): Promise<Response | null> {
  if (!rota.startsWith("/api/zip/")) return null;
  const p = fs.normalizar(url.searchParams.get("p") ?? "");
  if (rota === "/api/zip/personagem" && req.method === "GET") {
    if (!p.endsWith(".boneco") || !(await fs.existe(p))) return erro(404, `nao e um .boneco: ${p}`);
    const { arquivos, faltando } = await arquivosDoPersonagem(p);
    const nome = fs.nomeDe(p).replace(/\.boneco$/, "");
    const zip = await empacotar(arquivos, pastaComum(arquivos), limpar(nome));
    const rels = (l: string[]) => encodeURIComponent(JSON.stringify(l));
    return baixavel(zip, `${nome}.zip`, { "x-arquivos": String(arquivos.length), "x-faltando": rels(faltando) });
  }
  if (rota === "/api/zip/pasta" && req.method === "GET") {
    if (!(await fs.existePasta(p))) return erro(404, `nao existe a pasta: ${p}`);
    const arquivos = await fs.percorrer(p);
    if (!arquivos.length) return erro(404, `pasta vazia: ${p}`);
    const nome = limpar(fs.nomeDe(p) || "pasta");
    return baixavel(await empacotar(arquivos, p, nome), `${nome}.zip`, { "x-arquivos": String(arquivos.length) });
  }
  if (rota === "/api/zip/importar" && req.method === "POST") {
    const destino = fs.normalizar(url.searchParams.get("destino") || fs.OPFS);
    const corpo = new Uint8Array(await req.arrayBuffer());
    if (!corpo.length) return erro(400, "arquivo vazio");
    try {
      return json(await importar(corpo, url.searchParams.get("nome") ?? "importado.zip", destino));
    } catch (e: any) {
      if (e instanceof fs.SemPermissao || e?.code === 403) throw e;
      return erro(400, String(e?.message ?? e));
    }
  }
  return null;
}
