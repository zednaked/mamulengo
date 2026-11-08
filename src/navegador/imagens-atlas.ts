// Rotas de imagem do editor pelo navegador: trocar e acrescentar imagens soltas (reempacota o
// atlas), criar um .boneco de uma pasta de imagens e a biblioteca de efeitos. A mesma resposta das
// rotas do servidor (server/plugin.ts); o trabalho comum em src/core/imagens-atlas.ts.
import { criarBonecoDeImagens, fontesDoAtlas, reempacotar } from "../core/imagens-atlas.ts";
import { copia, erro, gravarBoneco, gravarVirtual, json, lerBoneco, lerTextoOuVirtual, virtual } from "./api.ts";
import * as fs from "./fs.ts";
import { decodificar, gravarPng } from "./imagens.ts";
import { ioNavegador } from "./psd.ts";

const io = () => ioNavegador({ gravarBoneco, copia });

// o atlas de verdade ou o virtual de um .boneco: ler e regravar
async function abrirAtlas(atlas: string) {
  const atlasTexto = await lerTextoOuVirtual(atlas);
  if (atlasTexto == null) throw Object.assign(new Error(`nao existe: ${atlas}`), { code: 404 });
  const gravarAtlas = async (t: string) => (virtual(atlas) ? gravarVirtual(atlas, t) : (await copia(atlas), fs.gravarArquivo(atlas, t)));
  return { atlasTexto, gravarAtlas };
}

// ---- biblioteca de efeitos (biblioteca/efeitos, vai junto do build em biblioteca/efeitos/)

type Efeito = { tipo?: "olho"; titulo: string; texto: string; imagens: string[]; emissor?: Record<string, any>; olho?: Record<string, any> };
const PREFIXO = "efeito_";
const BIBLIOTECA = () => new URL("biblioteca/efeitos/", new URL("./", (self as any).location.href));
let lidos: Promise<Record<string, Efeito>> | null = null;
const efeitos = (): Promise<Record<string, Efeito>> =>
  (lidos ??= fetch(new URL("efeitos.json", BIBLIOTECA())).then((r) => {
    if (!r.ok) throw new Error("a biblioteca de efeitos nao veio junto do editor");
    return r.json();
  }));

// como server/efeitos.ts porEfeito: as imagens do efeito numa pagina so dos efeitos, refeita com
// todas as que o personagem ja tinha, em prateleiras de 1024 px
async function porEfeito(boneco: string, nome: string) {
  const ef = (await efeitos())[nome];
  if (!ef) throw new Error(`efeito desconhecido: ${nome} (ha ${Object.keys(await efeitos()).join(", ")})`);
  const lido = await lerBoneco(boneco);
  if (!lido) throw Object.assign(new Error(`nao existe: ${boneco}`), { code: 404 });
  const b = lido.b as any;
  const arquivo = fs.nomeDe(boneco).replace(/\.boneco$/, "") + "-efeitos.png";
  const nomes = ef.imagens.map((i) => PREFIXO + i);
  const imagens: any[] = b.imagens ?? [];
  const faltam = nomes.filter((n) => !imagens.some((im) => im.nome === n));
  if (!faltam.length) return { imagens: nomes, emissor: ef.emissor, olho: ef.olho, pagina: arquivo, novas: 0 };
  let pi = (b.paginas ?? []).findIndex((p: any) => p.arquivo === arquivo);
  const ja = pi >= 0 ? imagens.filter((im) => (im.pagina ?? 0) === pi && im.nome.startsWith(PREFIXO)).map((im) => im.nome) : [];
  const pecas = [];
  for (const n of [...new Set([...ja, ...nomes])]) {
    const r = await fetch(new URL(n.slice(PREFIXO.length) + ".png", BIBLIOTECA()));
    if (!r.ok) throw new Error(`a biblioteca nao tem ${n.slice(PREFIXO.length)}.png`);
    const img = await decodificar(new Uint8Array(await r.arrayBuffer()));
    pecas.push({ nome: n, img, w: img.width, h: img.height });
  }
  const LARG = 1024;
  pecas.sort((a, c) => c.h - a.h);
  let [x, y, alt] = [0, 0, 0];
  const lugares: { nome: string; img: (typeof pecas)[0]["img"]; ret: number[] }[] = [];
  for (const p of pecas) {
    if (x + p.w > LARG) [x, y, alt] = [0, y + alt + 2, 0];
    lugares.push({ nome: p.nome, img: p.img, ret: [x, y, p.w, p.h] });
    x += p.w + 2;
    alt = Math.max(alt, p.h);
  }
  const altura = y + alt;
  const pagina = new Uint8Array(LARG * altura * 4);
  for (const l of lugares)
    for (let yy = 0; yy < l.ret[3]; yy++) pagina.set(l.img.data.subarray(yy * l.ret[2] * 4, (yy + 1) * l.ret[2] * 4), ((l.ret[1] + yy) * LARG + l.ret[0]) * 4);
  await gravarPng(fs.pastaDe(boneco) + "/" + arquivo, { width: LARG, height: altura, data: pagina });
  if (pi < 0) {
    b.paginas = [...(b.paginas ?? []), { arquivo, tamanho: [LARG, altura] }];
    pi = b.paginas.length - 1;
  } else b.paginas[pi] = { ...b.paginas[pi], tamanho: [LARG, altura] };
  b.imagens = [...imagens.filter((im) => !((im.pagina ?? 0) === pi && im.nome.startsWith(PREFIXO))), ...lugares.map((l) => ({ nome: l.nome, pagina: pi, ret: l.ret }))];
  await copia(boneco);
  await gravarBoneco(boneco, b, lido.binario);
  return { imagens: nomes, emissor: ef.emissor, olho: ef.olho, pagina: arquivo, novas: faltam.length };
}

export async function rotasImagens(rota: string, req: Request, url: URL): Promise<Response | null> {
  if (rota === "/api/efeitos") {
    // o menu de particulas so lista emissores (o olho maluco tem comando proprio)
    const todos: Record<string, Efeito> = await efeitos().catch(() => ({}));
    return json(
      Object.entries(todos)
        .filter(([, e]) => !e.tipo)
        .map(([nome, e]) => ({ nome, titulo: e.titulo, texto: e.texto, rajadas: !e.emissor?.rate })),
    );
  }
  if (req.method !== "POST") return null;
  if (rota === "/api/efeito") {
    const b = await req.json();
    const p = fs.normalizar(b.boneco ?? "");
    if (!p.endsWith(".boneco")) return erro(403, `so .boneco: ${p}`);
    return json(await porEfeito(p, String(b.efeito ?? "")));
  }
  if (rota === "/api/atlas/upload") {
    // imagem enviada: vira <pasta do atlas>/images/<nome>.png (PNG sem perda, de qualquer formato)
    const atlas = fs.normalizar(url.searchParams.get("atlas") ?? "");
    const nome = (url.searchParams.get("name") ?? "").replace(/[^\w .-]+/g, "_");
    if (!nome) return erro(400, "nome vazio");
    const { atlasTexto } = await abrirAtlas(atlas);
    const imagesDir = await fontesDoAtlas(io(), atlas, atlasTexto);
    const img = await decodificar(new Uint8Array(await req.arrayBuffer()));
    await copia(`${imagesDir}/${nome}.png`);
    await gravarPng(`${imagesDir}/${nome}.png`, img);
    return json({ ok: true, name: nome });
  }
  if (rota === "/api/atlas/add") {
    const b = await req.json();
    const atlas = fs.normalizar(b.atlas ?? "");
    const { atlasTexto, gravarAtlas } = await abrirAtlas(atlas);
    const imagesDir = await fontesDoAtlas(io(), atlas, atlasTexto);
    // arquivos de fora (numa das pastas): copiados para images/ com o nome pedido
    for (const [i, f] of (b.files ?? []).entries()) {
      const origem = fs.normalizar(f);
      const arq = await fs.lerArquivo(origem);
      if (!arq) return erro(404, `nao existe: ${origem}`);
      const nome = b.names?.[i] ?? fs.nomeDe(origem).replace(/\.[^.]+$/, "");
      await gravarPng(`${imagesDir}/${nome}.png`, await decodificar(new Uint8Array(await arq.arrayBuffer())));
    }
    return json(await reempacotar(io(), { atlas, atlasTexto, gravarAtlas }));
  }
  if (rota === "/api/asset/create") {
    const b = await req.json();
    return json(await criarBonecoDeImagens(io(), { dir: fs.normalizar(b.dir ?? ""), name: String(b.name ?? ""), imagesFrom: fs.normalizar(b.imagesFrom ?? "") }));
  }
  return null;
}
