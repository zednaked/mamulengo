// Compatibilidade com o Spine: le o JSON 4.3 (com o atlas texto) e escreve um .boneco, e o
// caminho de volta. Codigo nosso, sem o runtime do Spine: e so troca de formato.
//
// Alem de traduzir os campos (dicionario.ts), muda quatro coisas (docs/FORMATO.md):
// - o atlas entra no arquivo (paginas e imagens);
// - malha, caminho, recorte e caixa com pesos guardam os pesos explicitos por vertice;
// - a gravidade das fisicas de rotacao fica no sentido do jogo (o Godot roda o esqueleto
//   invertido e essa gravidade puxa para o outro lado; ver src/core/pose.ts godotGravity);
// - blend multiply vira "multiplica" (com transparencia, o que o artista ve no editor) ou
//   "multiplica_motor" (o do Godot, que ignora a transparencia), conforme o jogo.
// Os efeitos (que o Spine nao tem) vao e voltam como `effects` no slot e na animacao, onde o
// spine-core nao le; so a exportacao para o Spine de verdade (`soSpine`) os tira.
import { CAMPOS, CAMPOS_VOLTA, VALORES, VALORES_VOLTA } from "./dicionario.ts";
import { parseAtlas } from "../core/atlas-text.ts";

export const VERSAO = 0;

// caminhos (so as chaves do esquema, sem indices) cujas chaves sao nomes do artista
const MAPA_DE_NOMES = /^(events|animations|animations\/\*\/(bones|slots|ik|transform|path|physics|slider|attachments|effects)|animations\/\*\/attachments\/\*|skins\/attachments|skins\/attachments\/\*)$/;

function traduz(n: any, campos: Record<string, string>, valores: Record<string, Record<string, string>>, eNome: (p: string) => boolean, p: string[] = []): any {
  if (Array.isArray(n)) return n.map((x) => traduz(x, campos, valores, eNome, p));
  if (!n || typeof n !== "object") return n;
  const nomes = eNome(p.join("/"));
  const out: any = {};
  for (const [k, v] of Object.entries(n)) {
    const k2 = nomes ? k : (campos[k] ?? k);
    let v2 = traduz(v, campos, valores, eNome, [...p, nomes ? "*" : k]);
    if (!nomes && typeof v2 === "string" && valores[k]?.[v2]) v2 = valores[k][v2];
    out[k2] = v2;
  }
  return out;
}

// caminho em portugues -> o mesmo em ingles, para achar os mapas de nomes na volta
const voltaCaminho = (p: string) => p.split("/").map((x) => (x === "*" ? x : (CAMPOS_VOLTA[x] ?? x))).join("/");

export interface Boneco {
  boneco: number;
  [k: string]: any;
}

export interface OpcoesImportar {
  // multiply como o artista ve (certo) ou como o motor do jogo desenhava (para um jogo
  // ajustado contando com o retangulo escuro)
  multiply?: "certo" | "motor";
}

// ---- pesos explicitos

// vetor do Spine com pesos: por vertice, n, depois n x (osso, x, y, peso)
function pesosDe(v: number[], nVert: number, ossos: string[]): [string, number, number, number][][] | null {
  if (v.length === nVert * 2) return null;
  const out: [string, number, number, number][][] = [];
  let i = 0;
  while (i < v.length) {
    const n = v[i++];
    const vert: [string, number, number, number][] = [];
    for (let k = 0; k < n; k++, i += 4) vert.push([ossos[v[i]], v[i + 1], v[i + 2], v[i + 3]]);
    out.push(vert);
  }
  if (out.length !== nVert) throw new Error(`vertices com pesos: esperava ${nVert} vertices, li ${out.length}`);
  return out;
}

function vetorDe(pesos: [string, number, number, number][][], ossos: string[]): number[] {
  const idx = new Map(ossos.map((o, i) => [o, i]));
  const v: number[] = [];
  for (const vert of pesos) {
    v.push(vert.length);
    for (const [o, x, y, w] of vert) {
      const i = idx.get(o);
      if (i === undefined) throw new Error(`peso aponta para osso que nao existe: ${o}`);
      v.push(i, x, y, w);
    }
  }
  return v;
}

// troca uma chave por outra no mesmo lugar (a ordem das chaves volta igual na exportacao)
function trocaChave(o: any, de: string, para: string, valor: any) {
  const ents = Object.entries(o).map(([k, v]) => (k === de ? [para, valor] : [k, v]));
  for (const k of Object.keys(o)) delete o[k];
  for (const [k, v] of ents) o[k as string] = v;
}

// numero de vertices de uma parte do Spine (para saber se o vetor tem pesos)
function nVertices(a: any): number | null {
  const t = a.type ?? "region";
  if (t === "mesh") return (a.uvs?.length ?? 0) / 2;
  if (t === "path" || t === "clipping" || t === "boundingbox") return a.vertexCount ?? null;
  return null;
}

// cada parte de todas as skins (chave "attachments" no Spine, "partes" no .boneco)
function partes(skins: any[], f: (a: any) => void, chave = "attachments") {
  for (const sk of skins ?? []) for (const sl of Object.values<any>(sk[chave] ?? {})) for (const a of Object.values<any>(sl)) f(a);
}

// ---- gravidade no sentido do jogo (involucao: vale para ir e voltar)

function trocaGravidade(j: any): any {
  const rot = new Set<string>();
  for (const c of j.constraints ?? []) if (c.type === "physics" && (c.rotate || c.shearX || c.scaleX)) rot.add(c.name);
  for (const c of j.physics ?? []) if (c.rotate || c.shearX || c.scaleX) rot.add(c.name);
  if (!rot.size) return j;
  for (const c of [...(j.constraints ?? []), ...(j.physics ?? [])]) if (rot.has(c.name) && c.gravity) c.gravity = -c.gravity;
  for (const a of Object.values<any>(j.animations ?? {}))
    for (const [c, tls] of Object.entries<any>(a.physics ?? {}))
      if (rot.has(c))
        for (const k of tls.gravity ?? []) {
          if (k.value) k.value = -k.value;
          if (Array.isArray(k.curve)) k.curve = k.curve.map((v: number, i: number) => (i % 2 ? -v : v));
        }
  return j;
}

// ---- atlas

function atlasParaBoneco(texto: string) {
  const { pages, regions } = parseAtlas(texto);
  const paginas = pages.map((p) => ({
    arquivo: p.name,
    tamanho: [p.width, p.height],
    ...(p.pma ? { pma: true } : {}),
    ...(p.filter !== "Linear,Linear" ? { filtro: p.filter } : {}),
    ...(p.scale !== undefined ? { escala: p.scale } : {}),
    ...(p.extra.length ? { extras: p.extra } : {}),
  }));
  const imagens = regions.map((r) => ({
    nome: r.name,
    pagina: pages.findIndex((p) => p.name === r.page),
    ret: [r.x, r.y, r.width, r.height],
    ...(r.degrees ? { girada: r.degrees } : {}),
    // corte da transparencia: deslocamento e tamanho original (so se cortou)
    ...(r.offsetX || r.offsetY || r.originalWidth !== r.width || r.originalHeight !== r.height ? { corte: [r.offsetX, r.offsetY, r.originalWidth, r.originalHeight] } : {}),
    ...(r.index >= 0 ? { indice: r.index } : {}),
    ...(r.extra.length ? { extras: r.extra } : {}),
  }));
  return { paginas, imagens };
}

export function atlasTexto(b: Boneco): string {
  const linhas: string[] = [];
  (b.paginas ?? []).forEach((p: any, i: number) => {
    if (i) linhas.push("");
    linhas.push(p.arquivo, `size:${p.tamanho[0]},${p.tamanho[1]}`, `filter:${p.filtro ?? "Linear,Linear"}`);
    if (p.pma) linhas.push("pma:true");
    if (p.escala !== undefined) linhas.push(`scale:${p.escala}`);
    linhas.push(...(p.extras ?? []));
    for (const im of (b.imagens ?? []).filter((x: any) => x.pagina === i)) {
      linhas.push(im.nome, `bounds:${im.ret.join(",")}`);
      if (im.corte) linhas.push(`offsets:${im.corte.join(",")}`);
      if (im.girada) linhas.push(`rotate:${im.girada === 90 ? "90" : im.girada}`);
      if (im.indice !== undefined) linhas.push(`index:${im.indice}`);
      linhas.push(...(im.extras ?? []));
    }
  });
  return linhas.join("\n") + "\n";
}

// ---- ida

export function importarSpine(json: any, atlas: string, nome: string, opts: OpcoesImportar = {}): Boneco {
  const j = trocaGravidade(structuredClone(json));
  const ossos: string[] = (j.bones ?? []).map((b: any) => b.name);
  partes(j.skins, (a) => {
    const n = nVertices(a);
    if (n === null || !a.vertices) return;
    const p = pesosDe(a.vertices, n, ossos);
    if (p) trocaChave(a, "vertices", "__pesos", p);
  });
  const multiply = opts.multiply === "motor" ? "multiplica_motor" : "multiplica";
  const t = traduz(j, CAMPOS, VALORES, (p) => MAPA_DE_NOMES.test(p));
  for (const s of t.slots ?? []) if (s.blend === "multiplica") s.blend = multiply;
  partes(
    t.skins,
    (a) => {
      if (a.__pesos) trocaChave(a, "__pesos", "pesos", a.__pesos);
    },
    "partes",
  );
  return { boneco: VERSAO, nome, ...atlasParaBoneco(atlas), ...t };
}

// Uma animacao so, como fica no .boneco (o editor remenda o nucleo sem reler o resto). A
// gravidade das fisicas de rotacao depende das restricoes, que vao junto.
export function importarAnimacao(json: any, nome: string): any {
  const parcial = { bones: [], constraints: json.constraints, physics: json.physics, animations: { [nome]: json.animations?.[nome] ?? {} } };
  return importarSpine(parcial, "", "").animacoes[nome];
}

// ---- volta

export interface Exportado {
  json: any;
  atlas: string;
  avisos: string[];
}

export interface OpcoesExportar {
  // so o que o Spine conhece: tira os efeitos (com aviso)
  soSpine?: boolean;
}

export function exportarSpine(b: Boneco, opts: OpcoesExportar = {}): Exportado {
  if (b.boneco !== VERSAO) throw new Error(`.boneco versao ${b.boneco}: este leitor e da ${VERSAO}`);
  const avisos: string[] = [];
  const { boneco, nome, paginas, imagens, mix, ficha, ...resto } = structuredClone(b);
  if (opts.soSpine) {
    for (const s of resto.slots ?? [])
      if (s.efeitos) {
        avisos.push(`slot ${s.nome}: os efeitos (${Object.keys(s.efeitos).join(", ")}) nao existem no Spine e ficaram de fora`);
        delete s.efeitos;
      }
    for (const [an, a] of Object.entries<any>(resto.animacoes ?? {}))
      if (a.efeitos) {
        avisos.push(`animacao ${an}: as timelines de efeito (${Object.keys(a.efeitos).join(", ")}) ficaram de fora`);
        delete a.efeitos;
      }
  }
  for (const s of resto.slots ?? []) {
    if (s.blend === "multiplica") {
      avisos.push(`slot ${s.nome}: multiply com transparencia sai como multiply do Spine (no Godot a parte transparente escurece); para ficar igual, pinte de branco a parte transparente da imagem`);
      s.blend = "multiplica";
    } else if (s.blend === "multiplica_motor") s.blend = "multiplica";
  }
  const ossos: string[] = (resto.ossos ?? []).map((o: any) => o.nome);
  partes(
    resto.skins,
    (a) => {
      if (a.pesos) trocaChave(a, "pesos", "vertices", vetorDe(a.pesos, ossos));
    },
    "partes",
  );
  const j = traduz(resto, CAMPOS_VOLTA, VALORES_VOLTA, (p) => MAPA_DE_NOMES.test(voltaCaminho(p)));
  trocaGravidade(j);
  return { json: j, atlas: atlasTexto(b), avisos };
}
