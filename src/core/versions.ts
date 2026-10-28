// O que mudou entre duas versoes de um personagem, em frases curtas: animacoes criadas,
// apagadas ou alteradas (e o que nelas), ossos, partes, imagens, constraints e skins.
import type { SpineJson } from "./format.ts";
import { parseAtlas } from "./atlas-text.ts";

const names = (arr: any[] | undefined) => new Set((arr ?? []).map((x) => x.name));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// feminino: "animacoes novas"; masculino: "ossos novos"
const FEM = new Set(["animacoes", "partes", "imagens das partes", "constraints", "skins", "imagens no atlas"]);
function setDiff(label: string, a: Set<string>, b: Set<string>, out: string[]) {
  const [novos, apagados] = FEM.has(label) ? ["novas", "apagadas"] : ["novos", "apagados"];
  const add = [...b].filter((x) => !a.has(x)),
    del = [...a].filter((x) => !b.has(x));
  const list = (xs: string[]) => xs.slice(0, 6).join(", ") + (xs.length > 6 ? ` (+${xs.length - 6})` : "");
  if (add.length) out.push(`${label} ${novos}: ${list(add)}`);
  if (del.length) out.push(`${label} ${apagados}: ${list(del)}`);
}

// timelines de uma animacao como "alvo/timeline" -> json, para contar o que mudou
function timelines(a: any): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (prefix: string, node: any, depth: number) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries<any>(node)) {
      if (Array.isArray(v)) m.set(prefix + k, JSON.stringify(v));
      else if (depth < 4) walk(prefix + k + "/", v, depth + 1);
    }
  };
  walk("", a, 0);
  return m;
}

export function diffSpine(a: SpineJson, b: SpineJson, atlasA?: string | null, atlasB?: string | null): string[] {
  const out: string[] = [];
  const aa = a.animations ?? {},
    ab = b.animations ?? {};
  setDiff("animacoes", new Set(Object.keys(aa)), new Set(Object.keys(ab)), out);
  for (const n of Object.keys(ab)) {
    if (!(n in aa) || same(aa[n], ab[n])) continue;
    const ta = timelines(aa[n]),
      tb = timelines(ab[n]);
    let mud = 0,
      nov = 0,
      apa = 0;
    for (const [k, v] of tb) ta.has(k) ? ta.get(k) !== v && mud++ : nov++;
    for (const k of ta.keys()) if (!tb.has(k)) apa++;
    const parts = [mud && `${mud} alterada(s)`, nov && `${nov} nova(s)`, apa && `${apa} apagada(s)`].filter(Boolean).join(", ");
    out.push(`animacao ${n} mudou: ${parts || "detalhes"} (timelines)`);
  }
  setDiff("ossos", names(a.bones), names(b.bones), out);
  const ba = new Map((a.bones ?? []).map((x: any) => [x.name, x]));
  const movedBones = (b.bones ?? []).filter((x: any) => ba.has(x.name) && !same(ba.get(x.name), x)).map((x: any) => x.name);
  if (movedBones.length) out.push(`ossos alterados no setup: ${movedBones.slice(0, 6).join(", ")}${movedBones.length > 6 ? ` (+${movedBones.length - 6})` : ""}`);
  setDiff("partes", names(a.slots), names(b.slots), out);
  if (!same((a.slots ?? []).map((s: any) => s.name), (b.slots ?? []).map((s: any) => s.name)) && same(names(a.slots), names(b.slots))) out.push("ordem das partes mudou");
  const atts = (j: SpineJson): Set<string> => new Set<string>((j.skins ?? []).flatMap((s: any) => Object.entries<any>(s.attachments ?? {}).flatMap(([slot, m]) => Object.keys(m).map((n) => `${s.name}/${slot}/${n}`))));
  setDiff("imagens das partes", atts(a), atts(b), out);
  const changedAtts = [...atts(b)].filter((k) => {
    const [skin, slot, n] = k.split("/");
    const ga = (a.skins ?? []).find((s: any) => s.name === skin)?.attachments?.[slot]?.[n];
    const gb = (b.skins ?? []).find((s: any) => s.name === skin)?.attachments?.[slot]?.[n];
    return ga && gb && !same(ga, gb);
  });
  if (changedAtts.length) out.push(`imagens ajustadas (posicao, malha ou pesos): ${changedAtts.slice(0, 5).map((k) => k.split("/").slice(1).join("/")).join(", ")}${changedAtts.length > 5 ? ` (+${changedAtts.length - 5})` : ""}`);
  setDiff("constraints", names(a.constraints), names(b.constraints), out);
  const ca = new Map((a.constraints ?? []).map((x: any) => [x.name, x]));
  const cc = (b.constraints ?? []).filter((x: any) => ca.has(x.name) && !same(ca.get(x.name), x)).map((x: any) => x.name);
  if (cc.length) out.push(`constraints alteradas: ${cc.join(", ")}`);
  setDiff("skins", names(a.skins), names(b.skins), out);
  setDiff("eventos", new Set(Object.keys(a.events ?? {})), new Set(Object.keys(b.events ?? {})), out);
  const box = (j: SpineJson) => ["x", "y", "width", "height"].map((k) => Math.round(j.skeleton?.[k] ?? 0));
  if (!same(box(a), box(b))) out.push(`bounds do cabecalho mudaram (${box(a).join(",")} -> ${box(b).join(",")}): desloca o enquadramento no jogo`);
  if (atlasA != null && atlasB != null && atlasA !== atlasB) {
    const ra = new Set(parseAtlas(atlasA).regions.map((r) => r.name));
    const rb = new Set(parseAtlas(atlasB).regions.map((r) => r.name));
    const before = out.length;
    setDiff("imagens no atlas", ra, rb, out);
    if (out.length === before) out.push("atlas reempacotado (mesmas imagens)");
  }
  return out.length ? out : ["nada mudou"];
}
