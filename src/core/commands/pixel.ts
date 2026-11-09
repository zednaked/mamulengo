// Pixel art com ossos (docs/ANIMAR.md, secao 6): o que foge da grade de pixel inteiro. Em pixel
// perfeito, posicao fracionaria dobra e some colunas da arte (a peca de largura par e a de impar
// arredondam para lados diferentes), e deslocamento com curva suave passa por essas posicoes.
// query.pixel lista; pixel.snap arredonda os numeros e troca o deslocamento suave por degraus de
// 1 pixel (no mesmo tempo da curva). Giro fora de 0/45/90 e escala fracionaria so sao avisados
// (mudam a arte: a decisao e de quem anima).
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { parseAtlas } from "../atlas-text.ts";

const EPS = 1e-4;
const inteiro = (v: number) => Math.abs(v - Math.round(v)) < EPS;
const fmt = (v: number) => String(+v.toFixed(3));

type Aviso = { onde: string; problema: string; conserto?: { path: (string | number)[]; valor: any }[] };

// o valor de um canal de bezier do Spine (pontos absolutos de tempo e valor) no instante t
function bezierEm(t0: number, v0: number, c: number[], t1: number, v1: number, t: number): number {
  const [cx1, cy1, cx2, cy2] = c;
  const tempo = (s: number) => (1 - s) ** 3 * t0 + 3 * (1 - s) ** 2 * s * cx1 + 3 * (1 - s) * s * s * cx2 + s ** 3 * t1;
  let a = 0,
    b = 1;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (tempo(m) < t) a = m;
    else b = m;
  }
  const s = (a + b) / 2;
  return (1 - s) ** 3 * v0 + 3 * (1 - s) ** 2 * s * cy1 + 3 * (1 - s) * s * s * cy2 + s ** 3 * v1;
}

// os canais de uma timeline de deslocamento
const CANAIS: Record<string, string[]> = { translate: ["x", "y"], translatex: ["value"], translatey: ["value"] };

// um trecho com curva entre duas chaves com valores diferentes vira degraus de 1 pixel: uma chave
// em degrau a cada vez que o valor arredondado muda, no instante da curva original
function degraus(keys: any[], i: number, canais: string[]): any[] {
  const a = keys[i],
    b = keys[i + 1];
  const t0 = a.time ?? 0,
    t1 = b.time ?? 0;
  const v0 = canais.map((c) => a[c] ?? 0),
    v1 = canais.map((c) => b[c] ?? 0);
  const curva = Array.isArray(a.curve) ? a.curve : null;
  const valor = (t: number) =>
    canais.map((_, k) => {
      if (curva && curva.length >= (k + 1) * 4) return bezierEm(t0, v0[k], curva.slice(k * 4, k * 4 + 4), t1, v1[k], t);
      return v0[k] + ((v1[k] - v0[k]) * (t - t0)) / (t1 - t0 || 1);
    });
  const novas: any[] = [];
  let atual = v0.map(Math.round);
  novas.push({ ...a, ...Object.fromEntries(canais.map((c, k) => [c, atual[k]])), curve: "stepped" });
  const passos = Math.max(8, Math.ceil((t1 - t0) * 240));
  for (let s = 1; s < passos; s++) {
    const t = t0 + ((t1 - t0) * s) / passos;
    const r = valor(t).map(Math.round);
    if (r.some((x, k) => x !== atual[k])) {
      atual = r;
      novas.push({ time: +t.toFixed(4), ...Object.fromEntries(canais.map((c, k) => [c, r[k]])), curve: "stepped" });
    }
  }
  return novas;
}

export function auditoriaPixel(j: any, soAnim?: string): { nearest: boolean; avisos: Aviso[] } {
  const avisos: Aviso[] = [];
  // ossos no setup
  (j.bones ?? []).forEach((b: any, i: number) => {
    const fora = (["x", "y"] as const).filter((k) => !inteiro(b[k] ?? 0));
    if (fora.length) avisos.push({ onde: `osso ${b.name}`, problema: `posição fracionária (${fora.map((k) => `${k} ${fmt(b[k])}`).join(", ")})`, conserto: fora.map((k) => ({ path: ["bones", i, k], valor: Math.round(b[k]) })) });
    if ((b.rotation ?? 0) % 45) avisos.push({ onde: `osso ${b.name}`, problema: `giro ${fmt(b.rotation)}° no setup (pixel limpo só em 0°, 45° ou 90°)` });
    for (const k of ["scaleX", "scaleY"]) if (!inteiro(b[k] ?? 1)) avisos.push({ onde: `osso ${b.name}`, problema: `escala ${k} ${fmt(b[k])} (pixel art pede escala inteira)` });
  });
  // regioes: as bordas na grade
  (j.skins ?? []).forEach((sk: any, si: number) => {
    for (const [slot, atts] of Object.entries<any>(sk.attachments ?? {}))
      for (const [nome, a] of Object.entries<any>(atts)) {
        if (a.type && a.type !== "region") continue;
        const rot = a.rotation ?? 0;
        const onde = `parte ${slot}/${nome}`;
        if (rot % 90) {
          avisos.push({ onde, problema: `giro ${fmt(rot)}° (pixel limpo só em múltiplos de 90° na peça)` });
          continue;
        }
        const w = (a.width ?? 0) * Math.abs(a.scaleX ?? 1),
          h = (a.height ?? 0) * Math.abs(a.scaleY ?? 1);
        const [lw, lh] = rot % 180 ? [h, w] : [w, h];
        if (!inteiro(lw) || !inteiro(lh)) {
          avisos.push({ onde, problema: `tamanho na tela ${fmt(lw)} x ${fmt(lh)} (escala da peça não inteira)` });
          continue;
        }
        const ex = (a.x ?? 0) - lw / 2,
          ey = (a.y ?? 0) - lh / 2;
        const conserto: { path: (string | number)[]; valor: any }[] = [];
        if (!inteiro(ex)) conserto.push({ path: ["skins", si, "attachments", slot, nome, "x"], valor: +((a.x ?? 0) + Math.round(ex) - ex).toFixed(4) });
        if (!inteiro(ey)) conserto.push({ path: ["skins", si, "attachments", slot, nome, "y"], valor: +((a.y ?? 0) + Math.round(ey) - ey).toFixed(4) });
        if (conserto.length) avisos.push({ onde, problema: `borda fora da grade (canto em ${fmt(ex)}, ${fmt(ey)}): meio pixel some ou dobra`, conserto });
      }
  });
  // animacoes
  for (const [an, a] of Object.entries<any>(j.animations ?? {})) {
    if (soAnim && an !== soAnim) continue;
    for (const [bone, tls] of Object.entries<any>(a.bones ?? {}))
      for (const [tl, keys] of Object.entries<any>(tls)) {
        if (!Array.isArray(keys)) continue;
        const onde = `${an}: ${bone} ${tl}`;
        if (CANAIS[tl]) {
          const canais = CANAIS[tl];
          const fracionarias = keys.filter((k) => canais.some((c) => !inteiro(k[c] ?? 0))).length;
          const suaves: number[] = [];
          for (let i = 0; i + 1 < keys.length; i++)
            if (keys[i].curve !== "stepped" && canais.some((c) => Math.abs((keys[i][c] ?? 0) - (keys[i + 1][c] ?? 0)) > EPS)) suaves.push(i);
          if (!fracionarias && !suaves.length) continue;
          // conserto: a timeline inteira refeita (valores inteiros; os trechos suaves em degraus)
          const nova: any[] = [];
          for (let i = 0; i < keys.length; i++) {
            if (suaves.includes(i)) nova.push(...degraus(keys, i, canais));
            else nova.push({ ...keys[i], ...Object.fromEntries(canais.map((c) => [c, Math.round(keys[i][c] ?? 0)])) });
          }
          const partes = [fracionarias ? `${fracionarias} chave(s) com valor fracionário` : "", suaves.length ? `${suaves.length} trecho(s) com curva suave (passa por posições fracionárias)` : ""].filter(Boolean);
          avisos.push({ onde, problema: partes.join("; "), conserto: [{ path: ["animations", an, "bones", bone, tl], valor: nova }] });
        } else if (tl === "rotate") {
          const fora = keys.filter((k) => (k.value ?? 0) % 45 && Math.abs(k.value ?? 0) < 360).map((k) => fmt(k.value));
          if (fora.length) avisos.push({ onde, problema: `giro em ${fora.slice(0, 6).join("°, ")}°${fora.length > 6 ? "…" : ""} (pose segurada só em 0°, 45°, 90°; giro pequeno serrilha a peça)` });
        } else if (tl.startsWith("scale")) {
          const fora = keys.filter((k) => ["x", "y", "value"].some((c) => k[c] !== undefined && !inteiro(k[c]))).length;
          if (fora) avisos.push({ onde, problema: `${fora} chave(s) de escala fracionária` });
        }
      }
  }
  // mosaicos e instancias
  ((j as any).mosaics ?? []).forEach((m: any, i: number) => {
    const fora = (["x", "y"] as const).filter((k) => !inteiro(m[k] ?? 0));
    if (fora.length && !m.corners) avisos.push({ onde: `mosaico ${m.name}`, problema: `posição fracionária`, conserto: fora.map((k) => ({ path: ["mosaics", i, k], valor: Math.round(m[k]) })) });
    if (!m.cell?.every(inteiro)) avisos.push({ onde: `mosaico ${m.name}`, problema: `célula ${m.cell?.join(" x ")} fracionária` });
  });
  ((j as any).instances ?? []).forEach((x: any, i: number) => {
    const fora = (["x", "y"] as const).filter((k) => !inteiro(x[k] ?? 0));
    if (fora.length) avisos.push({ onde: `instância ${x.name}`, problema: `posição fracionária`, conserto: fora.map((k) => ({ path: ["instances", i, k], valor: Math.round(x[k]) })) });
    for (const k of ["scaleX", "scaleY"]) if (!inteiro(x[k] ?? 1)) avisos.push({ onde: `instância ${x.name}`, problema: `escala ${k} ${fmt(x[k])}` });
  });
  return { nearest: false, avisos };
}

const paginasNearest = (texto: string | undefined) => {
  if (!texto) return false;
  const p = parseAtlas(texto).pages;
  return p.length > 0 && p.every((x) => /^nearest/i.test(x.filter));
};

defineCommand({
  name: "query.pixel",
  group: "query",
  readonly: true,
  summary:
    "Pixel art (docs/ANIMAR.md, secao 6): o que foge da grade de pixel inteiro. Posicao fracionaria de osso, parte (a borda da regiao), mosaico e instancia; chaves de deslocamento fracionarias ou com curva suave entre valores diferentes (passa por posicoes fracionarias); giro fora de 0/45/90 e escala fracionaria (so aviso). Os itens com conserto saem certos pelo pixel.snap. anim: so essa animacao.",
  params: z.object({ anim: z.string().optional() }),
  run({ doc }, p) {
    const r = auditoriaPixel(doc.json, p.anim);
    const nearest = paginasNearest((doc.atlas as any)?.text);
    return {
      nearest,
      total: r.avisos.length,
      consertaveis: r.avisos.filter((a) => a.conserto).length,
      avisos: r.avisos.map((a) => `${a.onde}: ${a.problema}${a.conserto ? "" : " (só aviso)"}`),
    };
  },
});

defineCommand({
  name: "pixel.snap",
  group: "skeleton",
  summary:
    "Encaixa na grade de pixel inteiro o que o query.pixel aponta com conserto: arredonda posicoes de osso, mosaico e instancia; move a parte para a borda dela cair na grade; arredonda as chaves de deslocamento e troca cada trecho suave por degraus de 1 pixel no tempo da curva original. Giro e escala ficam (so aviso). anim: so essa animacao (o setup vai junto).",
  params: z.object({ anim: z.string().optional() }),
  label: () => "encaixa na grade de pixel",
  run({ e }, p) {
    const r = auditoriaPixel(e.json, p.anim);
    let n = 0;
    for (const a of r.avisos)
      for (const c of a.conserto ?? []) {
        e.set(c.path, c.valor);
        n++;
      }
    return { encaixados: n, avisosRestantes: auditoriaPixel(e.json, p.anim).avisos.map((a) => `${a.onde}: ${a.problema}`) };
  },
});
