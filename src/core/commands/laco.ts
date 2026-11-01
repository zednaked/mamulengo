// O laco de uma animacao, em chaves (o jogo so toca para frente: nem o Spine nem o spine-godot
// tem "vai e volta", entao a volta precisa existir nas chaves):
// - anim.closeLoop: cada timeline que termina diferente de como comecou ganha uma copia da
//   primeira chave depois da ultima, e a repeticao emenda sem pulo;
// - anim.pingPong: acrescenta a volta, as chaves de tras para a frente depois do fim, com as
//   curvas espelhadas; a animacao fica com o dobro da duracao.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import type { Editor } from "../document.ts";
import type { Path } from "../ops.ts";
import type { Bezier } from "../model.ts";
import { requireAnimation } from "../model.ts";
import { animDuration } from "../ficha.ts";
import { AnimName } from "./animate.ts";
import { getKeys, readShape, round, timeOf, writeShape } from "./timeline.ts";

const EPS = 1e-4;
// trocas (o estado vale da chave ate a proxima) e instantes (acontecem na hora da chave)
const TROCA = new Set(["attachment", "drawOrder", "sequence", "instance", "inherit"]);
const INSTANTE = new Set(["events", "burst", "reset"]);

// todas as timelines de uma animacao: caminho e tipo (o nome que readShape/writeShape entendem)
function timelines(a: any, anim: string): { path: Path; kind: string }[] {
  const out: { path: Path; kind: string }[] = [];
  const base: Path = ["animations", anim];
  const dois = (grupo: string, kind = (tl: string) => tl) => {
    for (const [dono, tls] of Object.entries<any>(a[grupo] ?? {})) for (const [tl, keys] of Object.entries<any>(tls ?? {})) if (Array.isArray(keys)) out.push({ path: [...base, grupo, dono, tl], kind: kind(tl) });
  };
  dois("bones");
  dois("slots");
  dois("effects");
  dois("particles");
  dois("physics");
  dois("slider");
  dois("path", (tl) => (tl === "mix" ? "pathmix" : tl));
  for (const tipo of ["ik", "transform"]) for (const [n, keys] of Object.entries<any>(a[tipo] ?? {})) if (Array.isArray(keys)) out.push({ path: [...base, tipo, n], kind: tipo });
  for (const [n, keys] of Object.entries<any>(a.lights ?? {})) if (Array.isArray(keys)) out.push({ path: [...base, "lights", n], kind: "light" });
  for (const [n, keys] of Object.entries<any>(a.instances ?? {})) if (Array.isArray(keys)) out.push({ path: [...base, "instances", n], kind: "instance" });
  if (Array.isArray(a.ambient)) out.push({ path: [...base, "ambient"], kind: "ambient" });
  for (const [skin, sl] of Object.entries<any>(a.attachments ?? {}))
    for (const [slot, atts] of Object.entries<any>(sl ?? {}))
      for (const [att, tls] of Object.entries<any>(atts ?? {})) for (const [tl, keys] of Object.entries<any>(tls ?? {})) if (Array.isArray(keys)) out.push({ path: [...base, "attachments", skin, slot, att, tl], kind: tl });
  for (const tl of ["drawOrder", "events"]) if (Array.isArray(a[tl])) out.push({ path: [...base, tl], kind: tl });
  return out;
}

// a chave sem tempo nem curva (o que ela vale)
const valores = (k: any) => {
  const { time: _t, curve: _c, ...v } = k ?? {};
  return v;
};
const iguais = (a: any, b: any) => JSON.stringify(valores(a)) === JSON.stringify(valores(b));
// tempo primeiro, como o exportador do Spine escreve (0 fica implicito)
const comTempo = (k: any, t: number) => {
  const { time: _t, curve: _c, ...rest } = k;
  t = round(t);
  return t ? { time: t, ...rest } : rest;
};
// a curva de i para i+1 vista de tras para a frente: o segmento espelhado no tempo e no valor
const espelha = (sh: Bezier[] | "stepped" | null): Bezier[] | "stepped" | null => (sh === null || sh === "stepped" ? sh : sh.map(([x1, y1, x2, y2]) => [1 - x2, 1 - y2, 1 - x1, 1 - y1] as Bezier));

function grava(e: Editor, path: Path, keys: any[]) {
  if (JSON.stringify(getKeys(e.json, path)) !== JSON.stringify(keys)) e.set(path, keys);
}

defineCommand({
  name: "anim.closeLoop",
  group: "animation",
  summary:
    "Fecha o laco: cada timeline cuja ultima chave e diferente da primeira ganha uma copia da primeira chave em `at` (padrao: o fim da animacao mais o espacamento medio entre as chaves), e a repeticao emenda sem pulo. Eventos e rajadas ficam como estao.",
  params: z.object({ anim: AnimName, at: z.number().positive().optional().describe("segundos da chave que fecha (padrao: depois do fim)") }),
  label: (p) => `fecha o laco de ${p.anim}`,
  run({ e }, p) {
    const a = requireAnimation(e.json, p.anim);
    const T = animDuration(a);
    const tempos = [...new Set(timelines(a, p.anim).filter((t) => !INSTANTE.has(t.kind)).flatMap((t) => getKeys(e.json, t.path).map((k) => round(timeOf(k)))))].sort((x, y) => x - y);
    const passo = tempos.length > 1 ? (tempos[tempos.length - 1] - tempos[0]) / (tempos.length - 1) : 1 / 3;
    // no quadro (30 por segundo) mais perto, nunca colado no fim
    const at = round(p.at ?? T + Math.max(1 / 30, Math.round(passo * 30) / 30));
    let fechadas = 0;
    for (const { path, kind } of timelines(a, p.anim)) {
      if (INSTANTE.has(kind)) continue;
      const keys = getKeys(e.json, path);
      if (keys.length < 2 || iguais(keys[0], keys[keys.length - 1])) continue;
      const novas = keys.filter((k) => Math.abs(timeOf(k) - at) > EPS).map((k) => structuredClone(k));
      if (timeOf(novas[novas.length - 1]) > at) throw new Error(`há chaves depois de ${at}s; escolha um 'at' depois da última (${T}s)`);
      novas.push(comTempo(structuredClone(keys[0]), at));
      grava(e, path, novas);
      fechadas++;
    }
    return { at, closed: fechadas, duration: Math.max(T, fechadas ? at : T) };
  },
});

defineCommand({
  name: "anim.pingPong",
  group: "animation",
  summary:
    "Vai e volta: acrescenta, depois do fim, as chaves de tras para a frente com as curvas espelhadas (a animacao dobra de duracao e termina como comecou). Trocas (imagem, ordem de desenho, instancia) voltam pela mesma sequencia; eventos e rajadas se repetem espelhados.",
  params: z.object({ anim: AnimName }),
  label: (p) => `vai e volta em ${p.anim}`,
  run({ e }, p) {
    const a = requireAnimation(e.json, p.anim);
    const T = animDuration(a);
    if (T <= 0) throw new Error(`${p.anim} não tem duração: ponha pelo menos duas chaves em instantes diferentes`);
    let mexidas = 0;
    for (const { path, kind } of timelines(a, p.anim)) {
      const keys = getKeys(e.json, path).map((k) => structuredClone(k));
      if (!keys.length) continue;
      const n = keys.length;
      const t = keys.map(timeOf);
      let novas: any[];
      if (INSTANTE.has(kind)) {
        // o instante t volta em 2T - t (o do fim nao repete)
        novas = [...keys, ...keys.filter((_, i) => t[i] < T - EPS).reverse().map((k) => comTempo(k, 2 * T - timeOf(k)))];
      } else if (TROCA.has(kind)) {
        // o estado S_j vale em [t_j, t_j+1); na volta vale em [2T - t_j+1, 2T - t_j): a chave
        // em 2T - t_j+1 traz S_j
        novas = [...keys];
        for (let j = n - 2; j >= 0; j--) novas.push(comTempo(keys[j], 2 * T - t[j + 1]));
      } else {
        // continua: a chave j volta em 2T - t_j; o segmento j -> j+1 volta de 2T - t_j+1 a 2T - t_j
        // com a curva espelhada, guardada na chave de onde ele sai
        const formas = keys.map((_, j) => (j < n - 1 ? readShape(kind, keys, j) : null));
        novas = [...keys];
        const fimNoFim = Math.abs(t[n - 1] - T) < EPS;
        if (!fimNoFim) {
          // a ultima chave segura o valor ate o fim; na volta, segura de T ate 2T - t_n-1
          delete novas[n - 1].curve;
          novas.push(comTempo(keys[n - 1], 2 * T - t[n - 1]));
        }
        for (let j = n - 2; j >= 0; j--) novas.push(comTempo(keys[j], 2 * T - t[j]));
        // curvas da volta: a chave que espelha j+1 leva a forma espelhada do segmento j
        const i0 = fimNoFim ? n - 1 : n; // indice (em novas) da chave que espelha n-1
        for (let j = n - 2; j >= 0; j--) {
          const idx = i0 + (n - 2 - j);
          const forma = espelha(formas[j]);
          const w = writeShape(kind, novas, idx, forma);
          if (w === undefined) delete novas[idx].curve;
          else novas[idx].curve = w;
        }
        // a ultima chave da volta nao tem segmento
        delete novas[novas.length - 1].curve;
      }
      grava(e, path, novas);
      mexidas++;
    }
    return { timelines: mexidas, duration: round(2 * T) };
  },
});
