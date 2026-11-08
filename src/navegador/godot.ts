// Projetos Godot no editor pelo navegador, como o servidor le (server/godot.ts, texture.ts,
// ficha-context.ts): o personagem do spine-godot e o SpineSkeletonDataResource (-data.tres), que
// aponta o .spine-json e o .atlas por res:// (relativo ao project.godot). A textura e a que o
// jogo ve (o .ctex importado pelo Godot, quando esta em dia com a fonte), com o filtro do projeto e
// o two-color tint do binario do spine-godot. Roda no service worker (lista e texturas) e na pagina
// (o contexto do jogo para a ficha).
import * as fs from "./fs.ts";
import { md5 } from "./md5.ts";

export type AssetGodot = { tres: string; skeleton: string; atlas: string; defaultMix: number; mixes: { from: string; to: string; mix: number }[]; raiz: string };

// a pasta do project.godot acima de `de` (dentro da mesma raiz das pastas abertas)
export async function projetoDe(de: string): Promise<string | null> {
  let d = fs.normalizar(de);
  for (;;) {
    if (await fs.existe(`${d}/project.godot`).catch(() => false)) return d;
    const acima = fs.pastaDe(d);
    if (acima === d || acima === "/" || acima === fs.OPFS || acima === fs.PASTAS) return null;
    d = acima;
  }
}

export const resDe = (raiz: string, p: string) => (p.startsWith("res://") ? fs.normalizar(`${raiz}/${p.slice(6)}`) : fs.normalizar(p.startsWith("/") ? p : `${raiz}/${p}`));
export const paraRes = (raiz: string, abs: string) => "res://" + fs.normalizar(abs).slice(raiz.length + 1);

// [sub_resource type="SpineAnimationMix"] usados em animation_mixes (como server/godot.ts)
function mixes(texto: string) {
  const usados = /^animation_mixes\s*=\s*\[([^\]]*)\]/m.exec(texto)?.[1] ?? "";
  const out: { from: string; to: string; mix: number }[] = [];
  for (const m of texto.matchAll(/\[sub_resource[^\]]*type="SpineAnimationMix"[^\]]*\]([\s\S]*?)(?=\n\[|$)/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    if (!id || !usados.includes(`"${id}"`)) continue;
    const corpo = m[1];
    const from = /^from\s*=\s*"([^"]*)"/m.exec(corpo)?.[1];
    const to = /^to\s*=\s*"([^"]*)"/m.exec(corpo)?.[1];
    const mix = /^mix\s*=\s*([\d.eE+-]+)/m.exec(corpo)?.[1];
    if (from !== undefined && to !== undefined) out.push({ from, to, mix: mix ? Number(mix) : 0 });
  }
  return out;
}

export async function lerTres(arquivo: string): Promise<AssetGodot | null> {
  const texto = await fs.lerTexto(arquivo);
  if (!texto || !/type="SpineSkeletonDataResource"/.test(texto.split("\n")[0])) return null;
  const raiz = await projetoDe(fs.pastaDe(arquivo));
  if (!raiz) return null;
  const ext = new Map<string, string>();
  for (const m of texto.matchAll(/\[ext_resource[^\]]*\]/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    const p = /\bpath="([^"]+)"/.exec(m[0])?.[1];
    if (id && p) ext.set(id, p);
  }
  const ref = (k: string) => {
    const id = new RegExp(`^${k}\\s*=\\s*ExtResource\\("([^"]+)"\\)`, "m").exec(texto)?.[1];
    const p = id ? ext.get(id) : undefined;
    return p ? resDe(raiz, p) : null;
  };
  const skeleton = ref("skeleton_file_res"),
    atlas = ref("atlas_res");
  if (!skeleton || !atlas) return null;
  const mix = /^default_mix\s*=\s*([\d.]+)/m.exec(texto)?.[1];
  return { tres: arquivo, skeleton, atlas, defaultMix: mix ? Number(mix) : 0, mixes: mixes(texto), raiz };
}

// os personagens do spine-godot numa raiz, no formato da lista de personagens
export async function personagensGodot(raiz: fs.Raiz): Promise<any[]> {
  const out: any[] = [];
  for (const tres of await fs.percorrer(raiz.caminho, (n) => n.endsWith(".tres"))) {
    const a = await lerTres(tres).catch(() => null);
    if (!a) continue;
    const rel = tres.slice(raiz.caminho.length + 1);
    const faltando = !(await fs.existe(a.skeleton)) ? a.skeleton : !(await fs.existe(a.atlas)) ? a.atlas : null;
    out.push({
      id: tres,
      name: fs.nomeDe(a.skeleton).replace(/\.spine-json$|\.json$/, ""),
      project: rel.includes("/") ? rel.split("/")[0] : raiz.nome,
      res: paraRes(a.raiz, a.skeleton),
      skeleton: a.skeleton,
      atlas: a.atlas,
      tres,
      defaultMix: a.defaultMix,
      mixes: a.mixes,
      ...(faltando ? { broken: `o ${fs.nomeDe(tres)} aponta para ${paraRes(a.raiz, faltando)}, que nao existe neste projeto Godot (res:// e relativo ao project.godot)` } : {}),
    });
  }
  return out;
}

// ---- a textura como o jogo ve (server/texture.ts)

async function parametrosImport(arquivo: string): Promise<Record<string, string>> {
  const t = await fs.lerTexto(arquivo + ".import");
  const out: Record<string, string> = {};
  for (const linha of (t ?? "").split("\n")) {
    const m = /^([\w/]+)=(.*)$/.exec(linha.trim());
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

async function filtroDoProjeto(raiz: string | null) {
  const t = raiz ? ((await fs.lerTexto(`${raiz}/project.godot`)) ?? "") : "";
  const v = /^textures\/canvas_textures\/default_texture_filter=(\d)/m.exec(t)?.[1];
  return v === "0" ? "nearest" : v === "2" ? "linear-mipmaps" : v === "3" ? "nearest-mipmaps" : "linear";
}

// o spine-godot do projeto desenha a cor escura? So o build com o shader "tint black" (procura no
// binario do editor Linux declarado no .gdextension, como o servidor). Guardado por tamanho e data.
const tintas = new Map<string, { chave: string; valor: boolean }>();
const tintaPorProjeto = new Map<string, { em: number; valor: Promise<boolean> }>();
function tintaPreta(raiz: string | null): Promise<boolean> {
  if (!raiz) return Promise.resolve(false);
  const visto = tintaPorProjeto.get(raiz);
  if (visto && Date.now() - visto.em < 10_000) return visto.valor;
  const valor = tintaDoBinario(raiz);
  tintaPorProjeto.set(raiz, { em: Date.now(), valor });
  return valor;
}
async function tintaDoBinario(raiz: string): Promise<boolean> {
  for (const f of await fs.listar(raiz)) {
    if (!f.endsWith(".gdextension")) continue;
    const t = (await fs.lerTexto(f)) ?? "";
    if (!/spine/i.test(t)) continue;
    const lib = /^linux\.editor\.x86_64\s*=\s*"([^"]+)"/m.exec(t)?.[1] ?? /^linux\.debug\.x86_64\s*=\s*"([^"]+)"/m.exec(t)?.[1];
    if (!lib) return false;
    const bin = await fs.lerArquivo(resDe(raiz, lib));
    if (!bin) return false;
    const chave = `${bin.size}|${bin.lastModified}`;
    const visto = tintas.get(bin.name);
    if (visto?.chave === chave) return visto.valor;
    const alvo = new TextEncoder().encode("dark_color = CUSTOM0");
    const b = new Uint8Array(await bin.arrayBuffer());
    let achou = false;
    for (let i = b.indexOf(alvo[0]); i >= 0 && i <= b.length - alvo.length && !achou; i = b.indexOf(alvo[0], i + 1)) {
      let k = 1;
      while (k < alvo.length && b[i + k] === alvo[k]) k++;
      achou = k === alvo.length;
    }
    tintas.set(bin.name, { chave, valor: achou });
    return achou;
  }
  return false;
}

// CompressedTexture2D (GST2): a imagem PNG ou WebP do nivel 0 (como extractCtex do servidor)
function doCtex(b: Uint8Array): { mime: string; corpo: Uint8Array } | null {
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== "GST2") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 36;
  const formato = v.getUint32(o, true);
  o += 4 + 2 + 2 + 4 + 4;
  if (formato !== 1 && formato !== 2) return null;
  const n = v.getUint32(o, true);
  o += 4;
  return { mime: formato === 1 ? "image/png" : "image/webp", corpo: b.subarray(o, o + n) };
}

const MIME: Record<string, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };

export async function texturaComoOJogo(p: string): Promise<Response | null> {
  const f = await fs.lerArquivo(p);
  if (!f) return null;
  const raiz = await projetoDe(fs.pastaDe(p));
  const params = await parametrosImport(p);
  const cab = (origem: string, fix: boolean, nota?: string): Record<string, string> => ({
    "cache-control": "no-store",
    "x-texture-origin": origem,
    "x-fix-alpha-border": String(fix),
    ...(nota ? { "x-texture-note": encodeURIComponent(nota) } : {}),
  });
  const comuns = { "x-godot-filter": await filtroDoProjeto(raiz), "x-godot-tint-black": String(await tintaPreta(raiz)) };
  const fonte = (nota?: string) => new Response(f, { headers: { "content-type": MIME[p.slice(p.lastIndexOf(".") + 1).toLowerCase()] ?? "image/png", ...cab("source", (params["process/fix_alpha_border"] ?? "true") === "true", nota), ...comuns } });
  const destino = params["path"];
  if (!destino || !raiz) return fonte("sem .import: emulando o import do Godot");
  const ctexArq = resDe(raiz, destino);
  const ctex = await fs.lerArquivo(ctexArq);
  if (!ctex) return fonte("projeto ainda nao importado pelo Godot: emulando o import");
  // o .md5 ao lado do .ctex guarda o md5 da fonte no momento do import
  const md5Arq = await fs.lerTexto(ctexArq.replace(/\.ctex$/, ".md5"));
  const quer = md5Arq ? /source_md5="([0-9a-f]+)"/.exec(md5Arq)?.[1] : undefined;
  if (quer && quer !== md5(new Uint8Array(await f.arrayBuffer()))) return fonte("import do Godot desatualizado (fonte mudou): emulando ate reimportar");
  const x = doCtex(new Uint8Array(await ctex.arrayBuffer()));
  if (!x) return fonte("formato de .ctex sem decoder aqui (VRAM/basis): emulando o import");
  return new Response(x.corpo as BodyInit, { headers: { "content-type": x.mime, ...cab("godot-import", false), ...comuns } });
}

// ---- o contexto do jogo para a ficha (server/ficha-context.ts): onde o codigo chama cada animacao,
// o que toca depois e os mixes do -data.tres

export async function contextoDoJogo(skeleton: string, anims: string[]): Promise<{ project?: string; usage: Record<string, string[]>; returnsTo: Record<string, string>; mix?: { defaultMix?: number; pairs?: string[] } }> {
  const ctx: { project?: string; usage: Record<string, string[]>; returnsTo: Record<string, string>; mix?: { defaultMix?: number; pairs?: string[] } } = { usage: {}, returnsTo: {} };
  const pasta = fs.pastaDe(skeleton);
  const tresArq = (await fs.percorrer(pasta, (n) => n.endsWith("-data.tres")).catch(() => [] as string[])).find((f) => fs.pastaDe(f) === pasta);
  if (tresArq) {
    const t = (await fs.lerTexto(tresArq)) ?? "";
    const dm = /default_mix\s*=\s*([\d.]+)/.exec(t);
    ctx.mix = { defaultMix: dm ? +dm[1] : undefined, pairs: [] };
    for (const m of t.matchAll(/from\s*=\s*"([^"]+)"[\s\S]*?to\s*=\s*"([^"]+)"[\s\S]*?mix\s*=\s*([\d.]+)/g)) ctx.mix.pairs!.push(`${m[1]} -> ${m[2]} ${m[3]}s`);
  }
  const raiz = await projetoDe(pasta);
  if (!raiz) return ctx;
  ctx.project = raiz;
  const citadas = (l: string) => anims.filter((a) => l.includes(`"${a}"`) || l.includes(`'${a}'`));
  const enfileiradas: string[] = [];
  const codigo = (await fs.percorrer(raiz, (n) => /\.(gd|tscn|cs)$/.test(n))).filter((f) => !f.slice(raiz.length).split("/").some((s) => s.startsWith(".") || s === "addons"));
  for (const f of codigo) {
    const linhas = ((await fs.lerTexto(f)) ?? "").split("\n");
    linhas.forEach((linha, i) => {
      if (linha.trim().startsWith("#")) return;
      const achadas = citadas(linha);
      for (const a of achadas) (ctx.usage[a] ??= []).push(`${f.slice(raiz.length + 1)}:${i + 1} \`${linha.trim().slice(0, 70)}\``);
      if (/queue|add_animation/i.test(linha) && achadas.length) {
        const y = achadas[0];
        enfileiradas.push(y);
        for (let k = Math.max(0, i - 4); k < i; k++) for (const x of citadas(linhas[k])) if (x !== y) ctx.returnsTo[x] = y;
      }
    });
  }
  const volta = [...new Set(enfileiradas)];
  if (volta.length === 1) for (const a of anims) if (a !== volta[0] && !ctx.returnsTo[a]) ctx.returnsTo[a] = volta[0];
  return ctx;
}
