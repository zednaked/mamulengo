// Importacao de PSD (parte pura, roda no navegador e no Node): as tags do script
// oficial PhotoshopToSpine nos nomes de camada e o plano de comandos que monta ou
// atualiza o esqueleto a partir das camadas. Ler o arquivo e gerar as imagens fica em
// server/psd.ts; aqui so entram nomes, retangulos e decisoes.
//
// Coordenadas: "px" sao pixels do PSD (origem no canto de cima, y para baixo); o mundo
// do Spine tem y para cima, com o zero na origem do plano (camada [origin] ou, sem ela,
// o meio da borda de baixo do PSD).
import type { Call } from "./commands/registry.ts";
import type { SpineJson } from "./format.ts";
import { skins, slots } from "./model.ts";
import { apply, boneWorld, skeletonAt } from "./pose.ts";

// esquerda, topo, largura, altura (px do PSD, escala 1)
export type Rect = [number, number, number, number];

// tags do script oficial (mais [origin], nossa) que o Mamulengo entende
export const PSD_TAGS = ["bone", "slot", "skin", "folder", "ignore", "merge", "path", "scale", "trim", "mesh", "name", "overlay", "origin"] as const;

export interface Tag {
  key: string;
  value?: string;
}

// "[bone:braco] braco [mesh]" -> nome limpo "braco" e as tags (chave em minusculas)
export function parseTags(name: string): { clean: string; tags: Tag[] } {
  const tags: Tag[] = [];
  for (const m of name.matchAll(/\[([^\]]+)\]/g)) {
    const raw = m[1];
    const i = raw.indexOf(":");
    if (i < 0) tags.push({ key: raw.trim().toLowerCase() });
    else tags.push({ key: raw.slice(0, i).trim().toLowerCase(), value: raw.slice(i + 1).trim() });
  }
  return { clean: name.replace(/\[[^\]]+\]/g, "").trim(), tags };
}

// Uma imagem do PSD: camada (ou grupo [merge]) que vira attachment.
export interface PsdPiece {
  layer: string; // caminho da camada no PSD, para mensagens ("grupo/camada")
  slot: string;
  attachment: string; // chave na skin (placeholder, como o Spine chama)
  image: string; // regiao no atlas / arquivo em images/ (sem extensao)
  skin: string; // "default" ou o nome da skin
  bone: string; // "root" ou o osso de um grupo [bone]
  visible: boolean; // aparece na composicao do PSD (ela e as pastas acima)
  blend?: "additive" | "multiply" | "screen";
  rect: Rect; // area da imagem gravada, em px do PSD
  scale: number; // [scale:x]: a imagem foi gravada nessa escala
  size: [number, number]; // tamanho da imagem gravada (px)
  mesh?: true | string; // [mesh] / [mesh:fonte] (linked mesh)
  // atualizacao: o que mudou na imagem em relacao ao asset
  status?: "new" | "changed" | "same";
  from?: Rect; // onde a imagem antiga estava (no referencial deste PSD)
  art?: Rect; // malha: o desenho da camada (rect cobre tambem a area antiga)
}

export interface PsdBone {
  name: string;
  parent: string;
  at: [number, number]; // px do PSD (centro das camadas do grupo)
}

export interface PsdPlan {
  file: string;
  width: number;
  height: number;
  origin: [number, number]; // px do PSD que vira (0,0) no mundo
  originFrom: "tag" | "padrao" | "anterior";
  bones: PsdBone[]; // pais antes dos filhos
  pieces: PsdPiece[]; // de baixo para cima (ordem de desenho)
  ignored: { layer: string; why: string }[];
  tags: Record<string, number>; // quantas vezes cada tag apareceu
  warnings: string[];
  // sem importacao anterior (asset montado de outro jeito): alinha as camadas novas
  // pelas imagens que ja existem no asset
  align?: boolean;
  kept?: string[]; // imagens da importacao anterior que nao estao mais no PSD
}

export function toWorld(plan: Pick<PsdPlan, "origin">, p: [number, number]): [number, number] {
  return [p[0] - plan.origin[0], plan.origin[1] - p[1]];
}

export const rectCenter = (r: Rect): [number, number] => [r[0] + r[2] / 2, r[1] + r[3] / 2];
export const sameRect = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

export interface PsdReport {
  bones: string[]; // ossos criados
  slots: string[]; // partes (slots) criadas
  added: string[]; // imagens novas no esqueleto ("slot/imagem")
  refit: string[]; // imagens que mudaram de tamanho ou lugar (ajustadas)
  repainted: string[]; // so o desenho mudou (mesmo tamanho e lugar)
  unchanged: number;
  hidden: string[]; // imagens que entraram escondidas (trocas)
  meshes: string[]; // [mesh] convertidas em malha
  kept: string[]; // imagens do asset que nao estao no PSD (ficaram como estavam)
  shift?: [number, number]; // alinhamento inferido (sem importacao anterior)
  warnings: string[];
}

// Todos os attachments que usam uma imagem (regiao), em todas as skins.
export function usesOfImage(json: SpineJson, image: string): { skin: string; slot: string; name: string; a: any }[] {
  const out: { skin: string; slot: string; name: string; a: any }[] = [];
  for (const s of skins(json))
    for (const [slot, m] of Object.entries<any>(s.attachments ?? {}))
      for (const [name, a] of Object.entries<any>(m)) {
        const t = a.type ?? "region";
        if (t !== "region" && t !== "mesh" && t !== "linkedmesh") continue;
        if ((a.path ?? a.name ?? name) === image) out.push({ skin: s.name, slot, name, a });
      }
  return out;
}

// Centro no mundo (setup) de um attachment region.
function regionWorldCenter(json: SpineJson, slot: string, a: any): [number, number] | null {
  const s = slots(json).find((x) => x.name === slot);
  if (!s) return null;
  try {
    return apply(boneWorld(skeletonAt(json, null, 0), s.bone), a.x ?? 0, a.y ?? 0) as [number, number];
  } catch {
    return null;
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Plano -> comandos (um lote, uma acao de desfazer). Serve para criar (documento so com
// o root) e para atualizar um asset que ja existe: casa camada com imagem pelo nome e
// so cria o que falta; o que ja existe so e ajustado (attachment.refit).
export function psdCalls(json: SpineJson, plan: PsdPlan): { calls: Call[]; report: PsdReport } {
  const report: PsdReport = { bones: [], slots: [], added: [], refit: [], repainted: [], unchanged: 0, hidden: [], meshes: [], kept: [], warnings: [] };
  // sem importacao anterior: desloca as camadas novas para cair onde as imagens que
  // ja existem estao (mediana do desvio das regioes casadas, do mesmo tamanho)
  let shift: [number, number] = [0, 0];
  if (plan.align) {
    const dx: number[] = [],
      dy: number[] = [];
    for (const p of plan.pieces) {
      if (p.status === "new" || (p.from && !sameRect(p.from, p.rect))) continue;
      for (const u of usesOfImage(json, p.image)) {
        if ((u.a.type ?? "region") !== "region" || u.a.rotation || (u.a.scaleX ?? 1) < 0) continue;
        const c = regionWorldCenter(json, u.slot, u.a);
        if (!c) continue;
        const w = toWorld(plan, rectCenter(p.rect));
        dx.push(c[0] - w[0]);
        dy.push(c[1] - w[1]);
      }
    }
    if (dx.length) {
      shift = [median(dx), median(dy)];
      report.shift = [+shift[0].toFixed(2), +shift[1].toFixed(2)];
    }
  }
  const world = (p: [number, number]): [number, number] => {
    const w = toWorld(plan, p);
    return [+(w[0] + shift[0]).toFixed(4), +(w[1] + shift[1]).toFixed(4)];
  };

  const calls: Call[] = [];
  const boneNames = new Set((json.bones ?? []).map((b: any) => b.name));
  for (const b of plan.bones) {
    if (boneNames.has(b.name)) continue;
    if (!boneNames.has(b.parent)) throw new Error(`osso pai nao existe: ${b.parent}`);
    calls.push({ cmd: "bone.add", args: { name: b.name, parent: b.parent, at: world(b.at) } });
    boneNames.add(b.name);
    report.bones.push(b.name);
  }

  const slotNames = new Set(slots(json).map((s) => s.name));
  const setupOf = new Map(slots(json).map((s) => [s.name, s.attachment ?? null]));
  // slots novos: a imagem visivel da setup e a primeira visivel de baixo para cima (como o Spine)
  const firstVisible = new Map<string, string>();
  for (const p of plan.pieces) if (p.visible && !firstVisible.has(p.slot)) firstVisible.set(p.slot, p.attachment);
  const has = (skin: string, slot: string, name: string) => skins(json).find((s) => s.name === skin)?.attachments?.[slot]?.[name];
  const refitDone = new Set<string>();
  const meshes: Call[] = [];
  const linked: Call[] = [];
  const hideAfter = new Set<string>();
  let below: string | null = null;

  for (const p of plan.pieces) {
    const uses = usesOfImage(json, p.image);
    // imagem que ja existe: ajusta tamanho e lugar se mudaram, senao so o desenho mudou
    if (uses.length) {
      if (!refitDone.has(p.image)) {
        refitDone.add(p.image);
        if (p.from && !sameRect(p.from, p.rect)) {
          calls.push({ cmd: "attachment.refit", args: { image: p.image, from: p.from, to: p.rect } });
          report.refit.push(p.image);
          // malha nao cresce sozinha: o desenho novo fora da area antiga fica cortado
          const a = p.art ?? p.rect,
            f = p.from;
          const out = a[0] < f[0] - 0.5 || a[1] < f[1] - 0.5 || a[0] + a[2] > f[0] + f[2] + 0.5 || a[1] + a[3] > f[1] + f[3] + 0.5;
          if (out && uses.some((u) => u.a.type === "mesh" || u.a.type === "linkedmesh"))
            report.warnings.push(`o desenho de ${p.image} cresceu para fora da malha: a parte nova fica cortada ate voce aumentar a malha (Montar > Editar malha)`);
        } else if (p.status === "changed") report.repainted.push(p.image);
        else report.unchanged++;
      }
      below = uses.find((u) => slotNames.has(u.slot))?.slot ?? below;
      continue;
    }
    if (has(p.skin, p.slot, p.attachment)) {
      report.warnings.push(`"${p.layer}": a parte ${p.slot} ja tem uma imagem chamada ${p.attachment} com outro desenho (${has(p.skin, p.slot, p.attachment).path ?? p.attachment}); a camada ficou de fora`);
      continue;
    }
    if (!slotNames.has(p.slot)) {
      const args: any = { name: p.slot, bone: p.bone };
      if (p.blend) args.blend = p.blend;
      const vis = firstVisible.get(p.slot);
      if (vis) args.attachment = vis;
      else hideAfter.add(p.slot);
      // ordem de desenho: logo na frente da parte de baixo no PSD
      if (below && slotNames.has(below)) args.above = below;
      else args.index = 0;
      calls.push({ cmd: "slot.add", args });
      slotNames.add(p.slot);
      setupOf.set(p.slot, vis ?? null);
      report.slots.push(p.slot);
    } else if (!setupOf.get(p.slot) && p.skin === "default") hideAfter.add(p.slot); // nao muda a setup de quem ja existe
    below = p.slot;
    const path = p.image !== p.attachment ? p.image : undefined;
    if (typeof p.mesh === "string") {
      linked.push({ cmd: "linkedmesh.create", args: { slot: p.slot, name: p.attachment, source: p.mesh, skin: p.skin, ...(path ? { path } : {}) } });
    } else {
      calls.push({ cmd: "attachment.region", args: { slot: p.slot, name: p.attachment, skin: p.skin, ...(path ? { path } : {}), world: { center: world(rectCenter(p.rect)), rotation: 0, size: [p.rect[2], p.rect[3]] } } });
      if (p.mesh === true) {
        meshes.push({ cmd: "mesh.create", args: { slot: p.slot, name: p.attachment, skin: p.skin, mode: "auto" } });
        report.meshes.push(`${p.slot}/${p.attachment}`);
      }
    }
    report.added.push(`${p.slot}/${p.attachment}`);
    if (!p.visible) report.hidden.push(`${p.slot}/${p.attachment}`);
  }
  calls.push(...meshes, ...linked);
  // attachment.region mostra a primeira imagem de um slot vazio; aqui ele continua vazio
  for (const s of hideAfter) calls.push({ cmd: "slot.set", args: { slot: s, attachment: null } });
  report.kept = plan.kept ?? [];
  return { calls, report };
}

// Resumo em portugues simples (UI e ponte).
export function psdSummary(plan: PsdPlan, r: PsdReport, mode: "create" | "update"): string[] {
  const out: string[] = [];
  const n = plan.pieces.length;
  const list = (xs: string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join(", ")} e mais ${xs.length - max}` : xs.join(", "));
  out.push(`${n} camada(s) lida(s) de ${plan.file} (${plan.width}x${plan.height} px).`);
  if (mode === "create") out.push(`${r.added.length} imagem(ns) montada(s) em ${r.slots.length} parte(s), na ordem das camadas.`);
  else {
    if (r.added.length) out.push(`Novas: ${list(r.added)}.`);
    if (r.refit.length) out.push(`Mudaram de tamanho ou lugar (ajustadas, animacoes mantidas): ${list(r.refit)}.`);
    if (r.repainted.length) out.push(`Desenho atualizado: ${list(r.repainted)}.`);
    if (r.unchanged) out.push(`${r.unchanged} imagem(ns) sem mudanca.`);
    if (r.kept.length) out.push(`No asset mas nao no PSD (ficaram como estavam): ${list(r.kept)}.`);
    if (!r.added.length && !r.refit.length && !r.repainted.length) out.push("Nada mudou.");
  }
  if (r.bones.length) out.push(`Ossos criados: ${list(r.bones)}.`);
  if (r.hidden.length) out.push(`Escondidas (para trocar na animacao): ${list(r.hidden)}.`);
  if (r.meshes.length) out.push(`Viraram malha deformavel: ${list(r.meshes)}.`);
  if (plan.ignored.length) out.push(`Ignoradas: ${list(plan.ignored.map((i) => `${i.layer} (${i.why})`), 6)}.`);
  const tags = Object.entries(plan.tags);
  if (tags.length) out.push(`Tags lidas: ${tags.map(([k, v]) => `[${k}] x${v}`).join(", ")}.`);
  out.push(plan.originFrom === "tag" ? "Origem do personagem: camada [origin]." : plan.originFrom === "anterior" ? "Origem: a mesma da importacao anterior." : "Origem do personagem: meio da borda de baixo do PSD.");
  if (r.shift) out.push(`Asset sem importacao anterior: camadas novas alinhadas pelas imagens que ja existiam (desvio ${r.shift[0]}, ${r.shift[1]}).`);
  for (const w of [...plan.warnings, ...r.warnings]) out.push(`Atencao: ${w}`);
  return out;
}
