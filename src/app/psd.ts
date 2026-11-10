// Importar PSD no editor (UI e ponte usam o mesmo caminho): personagem novo montado a
// partir das camadas, ou o asset aberto atualizado (camada casada com imagem pelo nome).
import { app } from "./state.svelte.ts";
import { psdCalls, psdSummary, type PsdPlan, type PsdReport } from "../core/psd.ts";

export interface PsdImportResult {
  mode: "create" | "update";
  summary: string[];
  report: PsdReport;
  plan: PsdPlan;
  asset?: string;
  saved?: boolean;
}

async function post(url: string, body: any) {
  const r = await fetch(url, { method: "POST", body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}

// envia um .psd do computador; devolve o caminho no servidor
export async function uploadPsd(file: File): Promise<string> {
  const r = await fetch(`/api/psd/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: await file.arrayBuffer() });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j.path;
}

// pasta sugerida para um personagem novo: ao lado do que esta aberto
export function suggestDir(name: string): string {
  const a = app.asset ?? app.assets[0];
  if (!a) return "";
  const dir = a.skeleton.slice(0, a.skeleton.lastIndexOf("/"));
  const parent = dir.slice(0, dir.lastIndexOf("/"));
  // pasta que ja tem personagem: sugere outra (criar nunca sobrescreve, mas misturaria)
  let out = `${parent}/${name}`;
  for (let i = 2; app.assets.some((x) => x.skeleton.startsWith(out + "/")); i++) out = `${parent}/${name}_${i}`;
  return out;
}

// mapa: caminho de um .json (ou o objeto) com tags e ossos que o PSD nao traz (docs/RIGAR.md)
// tela (docs/LAYOUT-PSD.md): true, ou as escolhas sobre a proposta ({off, on, change, art, fit})
export async function createFromPsd(p: { psd: string; dir: string; name: string; ignoreHidden?: boolean; mapa?: string | object; tela?: boolean | object }): Promise<PsdImportResult> {
  if (app.doc?.dirty) throw new Error(`${app.asset?.name} tem alterações não salvas. Salve (Ctrl+S) ou descarte antes de importar.`);
  const j = await post("/api/psd/create", p);
  await app.loadAssets(true);
  const a = app.assets.find((x) => x.tres === j.tres);
  if (!a) throw new Error(`Personagem criado em ${j.tres}, mas essa pasta não está entre as que o editor procura. Crie dentro de uma delas, ou acrescente a pasta em MAMULENGO_ROOTS e reinicie o editor.`);
  await app.open(a);
  app.viewer?.frameAll();
  app.log({ label: `PSD: ${p.tela ? "tela" : "personagem"} ${a.name} criado (${j.report.added.length} imagens)`, source: "ui", kind: "info", ops: 0 });
  return { mode: "create", summary: j.summary, report: j.report, plan: j.plan, asset: `${a.project}/${a.name}`, saved: true };
}

// imagens usadas por malhas no documento (a imagem nova cobre a area antiga tambem)
function meshImages(json: any): string[] {
  const out = new Set<string>();
  for (const s of json.skins ?? []) for (const m of Object.values<any>(s.attachments ?? {})) for (const [name, a] of Object.entries<any>(m)) if (a.type === "mesh" || a.type === "linkedmesh") out.add(a.path ?? name);
  return [...out];
}

export async function updateFromPsd(p: { psd: string; ignoreHidden?: boolean; mapa?: string | object }, source = "ui"): Promise<PsdImportResult> {
  const doc = app.doc;
  if (!doc?.file.atlas) throw new Error("Abra um personagem primeiro.");
  // o atlas e as imagens mudam no disco: o esqueleto e salvo junto para nao ficar desencontrado
  if (doc.dirty) throw new Error(`${app.asset?.name} tem alterações não salvas. Salve (Ctrl+S) ou descarte antes de atualizar pelo PSD.`);
  const j = await post("/api/psd/update", { psd: p.psd, atlas: doc.file.atlas, meshImages: meshImages(doc.json), ignoreHidden: p.ignoreHidden, mapa: p.mapa });
  await app.reloadAtlas(j.atlasText);
  const { calls, report } = psdCalls(doc.json, j.plan);
  if (calls.length) {
    const r = await app.runAsync(calls, `PSD ${j.plan.file}`, source);
    if (!r) throw new Error("Não consegui aplicar o PSD: o motivo está na Atividade, no painel da direita.");
    for (const x of r) if (x?.warnings?.length) report.warnings.push(...x.warnings);
  }
  const changed = calls.length > 0 || report.repainted.length > 0;
  if (doc.dirty) await app.save();
  app.log({ label: `PSD: ${app.asset?.name} atualizado`, source, kind: "info", ops: 0 });
  return { mode: "update", summary: psdSummary(j.plan, report, "update"), report, plan: j.plan, asset: app.asset ? `${app.asset.project}/${app.asset.name}` : undefined, saved: changed };
}

// A proposta da tela (sem mudar nada): o que cada camada vira, com o porque
export interface PropostaResult {
  proposta: import("../core/psd-tela.ts").PropostaTela;
  linhas: string[];
  mapa: object;
  mapaArquivo: string | null;
}
export async function proposeScreen(p: { psd: string; mapa?: string | object; escolhas?: object }): Promise<PropostaResult> {
  return post("/api/psd/tela", p);
}
