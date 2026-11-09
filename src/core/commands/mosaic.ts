// Mosaico (so do Mamulengo; docs/NUCLEO.md "Mosaico"): uma grade de imagens do atlas presa ao
// osso de um slot, desenhada logo depois da parte dele (mapas, chao, paredes). Fica em `mosaics`
// no topo do JSON do editor, onde o spine-core nao le. Cada celula guarda o indice da imagem na
// paleta (-1: vazia); cor, altura, giro, espelho e efeitos por celula ficam em `extras`, pelo
// indice da celula (linha * colunas + coluna, linha 0 em cima).
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { EFFECTS, requireSlot } from "../model.ts";
import { round } from "./timeline.ts";

const Cor = z.string().regex(/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const Celula = z.tuple([z.number().int().min(0), z.number().int().min(0)]).describe("[coluna, linha], linha 0 em cima");

export const mosaics = (json: any): any[] => json.mosaics ?? [];
export function requireMosaic(json: any, name: string): number {
  const i = mosaics(json).findIndex((m) => m.name === name);
  if (i < 0) throw new Error(`mosaico não existe: "${name}". Mosaicos: ${mosaics(json).map((m) => m.name).join(", ") || "(nenhum)"}`);
  return i;
}

// as celulas de um retangulo (inclusive), recortado pela grade
function retangulo(m: any, de: [number, number], ate?: [number, number]): number[] {
  const [c0, r0] = de,
    [c1, r1] = ate ?? de;
  const out: number[] = [];
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) if (c < m.columns && r < m.rows) out.push(r * m.columns + c);
  return out;
}

// a imagem na paleta (acrescenta se falta); null: apagar (-1)
function indiceNaPaleta(m: any, imagem: string | number | null): number {
  if (imagem === null) return -1;
  if (typeof imagem === "number") {
    if (imagem < 0 || imagem >= (m.palette ?? []).length) throw new Error(`o mosaico ${m.name} tem ${(m.palette ?? []).length} imagens na paleta; não há a ${imagem}`);
    return imagem;
  }
  const pal: string[] = (m.palette ??= []);
  let i = pal.indexOf(imagem);
  if (i < 0) {
    pal.push(imagem);
    i = pal.length - 1;
  }
  return i;
}

defineCommand({
  name: "mosaic.set",
  group: "slot",
  summary:
    "Cria ou muda um mosaico (so do Mamulengo, para .boneco; o Spine nao tem): uma grade de imagens do atlas presa ao osso do slot, desenhada logo depois da parte dele, com a cor e o blend do slot. shape grid (vista de cima, cada celula esticada no tamanho cell) ou iso (losangos de cell [largura, altura], a imagem no tamanho dela vezes scale, o ponto anchor dela no centro do losango, de tras para a frente). x, y: grid, o canto de cima e da esquerda; iso, o centro da celula [0, 0]. corners (so grid): os 4 cantos da grade no espaco do osso (baixo-esquerda, cima-esquerda, cima-direita, baixo-direita) para a perspectiva forcada (chao visto em angulo); null volta ao retangulo. Mudar columns ou rows mantem o canto de cima e da esquerda. Pintar: mosaic.paint; cor, altura, giro e efeitos por celula: mosaic.cell.",
  params: z.object({
    name: z.string().min(1),
    slot: z.string().optional().describe("o slot (lugar na ordem de desenho e osso); obrigatorio ao criar"),
    shape: z.enum(["grid", "iso"]).optional(),
    cell: z.tuple([z.number().positive(), z.number().positive()]).optional().describe("tamanho da celula; ao criar, o padrao e o da primeira imagem da paleta"),
    columns: z.number().int().min(1).max(1024).optional(),
    rows: z.number().int().min(1).max(1024).optional(),
    palette: z.array(z.string()).optional().describe("imagens do atlas, na ordem dos indices das celulas"),
    fill: z.union([z.string(), z.number().int()]).optional().describe("ao criar: a imagem de todas as celulas (sem ele, vazias)"),
    x: z.number().optional(),
    y: z.number().optional(),
    scale: z.number().positive().optional().describe("iso: a imagem no tamanho dela vezes isto"),
    anchor: z.tuple([z.number(), z.number()]).optional().describe("iso: o ponto da imagem (fracao, de cima e da esquerda) que vai no centro do losango"),
    corners: z.array(z.number()).length(8).nullable().optional(),
  }),
  label: (p) => `mosaico ${p.name}`,
  run({ e, assets }, p) {
    const lista = mosaics(e.json);
    const i = lista.findIndex((x) => x.name === p.name);
    if (p.slot) requireSlot(e.json, p.slot);
    const m: any = i >= 0 ? structuredClone(lista[i]) : { name: p.name };
    if (i < 0) {
      if (!p.slot) throw new Error("mosaico novo: diga o slot (lugar na ordem de desenho e osso)");
      m.slot = p.slot;
      m.shape = p.shape ?? "grid";
      m.palette = [...(p.palette ?? [])];
      const primeira = m.palette[0] ? assets?.region(m.palette[0]) : null;
      m.cell = p.cell ?? (primeira ? [primeira.width, m.shape === "iso" ? primeira.width / 2 : primeira.height] : [32, 32]);
      m.columns = p.columns ?? 8;
      m.rows = p.rows ?? 8;
      const v = p.fill === undefined ? -1 : indiceNaPaleta(m, p.fill);
      m.cells = new Array(m.columns * m.rows).fill(v);
    } else {
      if (p.slot) m.slot = p.slot;
      if (p.shape) m.shape = p.shape;
      if (p.palette) m.palette = [...p.palette];
      if (p.cell) m.cell = p.cell.map(round);
      // nova grade: o que cabe fica no lugar (linha, coluna), e os extras vao junto
      const nc = p.columns ?? m.columns,
        nr = p.rows ?? m.rows;
      if (nc !== m.columns || nr !== m.rows) {
        const cells = new Array(nc * nr).fill(-1);
        const extras: Record<string, any> = {};
        for (let r = 0; r < Math.min(nr, m.rows); r++)
          for (let c = 0; c < Math.min(nc, m.columns); c++) {
            cells[r * nc + c] = m.cells[r * m.columns + c] ?? -1;
            const x = m.extras?.[r * m.columns + c];
            if (x) extras[r * nc + c] = x;
          }
        m.columns = nc;
        m.rows = nr;
        m.cells = cells;
        if (Object.keys(extras).length) m.extras = extras;
        else delete m.extras;
      }
    }
    if (p.x !== undefined) m.x = round(p.x);
    if (p.y !== undefined) m.y = round(p.y);
    if (p.scale !== undefined) m.escala = round(p.scale);
    if (p.anchor) m.anchor = p.anchor.map(round);
    if (p.corners === null) delete m.corners;
    else if (p.corners) m.corners = p.corners.map(round);
    if (m.shape === "iso" && m.corners) throw new Error("corners e so da forma grid (no iso as imagens ficam em pe)");
    // celulas que apontam para fora da paleta ficam vazias
    m.cells = m.cells.map((v: number) => (v >= 0 && v < m.palette.length ? v : -1));
    if (i < 0) e.set(["mosaics"], [...lista, m]);
    else if (JSON.stringify(m) !== JSON.stringify(lista[i])) e.set(["mosaics", i], m);
    return { index: i < 0 ? lista.length : i, columns: m.columns, rows: m.rows, cell: m.cell, palette: m.palette };
  },
});

defineCommand({
  name: "mosaic.paint",
  group: "slot",
  summary:
    "Pinta celulas de um mosaico com uma imagem (nome do atlas, acrescentado a paleta se falta, ou indice da paleta); image null apaga. at sozinho: uma celula; at e to: o retangulo entre elas; at com flood: o balde (as celulas ligadas com a mesma imagem de at); cells: uma lista de [coluna, linha]. Linha 0 em cima.",
  params: z.object({
    name: z.string(),
    image: z.union([z.string(), z.number().int(), z.null()]),
    at: Celula.optional(),
    to: Celula.optional(),
    flood: z.boolean().optional(),
    cells: z.array(Celula).optional(),
  }),
  label: (p) => `pinta ${p.name}`,
  run({ e }, p) {
    const i = requireMosaic(e.json, p.name);
    const m = structuredClone(mosaics(e.json)[i]);
    const alvo = new Set<number>();
    if (p.cells) for (const c of p.cells) for (const k of retangulo(m, c)) alvo.add(k);
    if (p.at && p.flood) {
      const k0 = retangulo(m, p.at)[0];
      if (k0 !== undefined) {
        const de = m.cells[k0];
        const fila = [k0];
        alvo.add(k0);
        while (fila.length) {
          const k = fila.pop()!;
          const c = k % m.columns,
            r = Math.floor(k / m.columns);
          for (const [dc, dr] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const cc = c + dc,
              rr = r + dr;
            if (cc < 0 || rr < 0 || cc >= m.columns || rr >= m.rows) continue;
            const kk = rr * m.columns + cc;
            if (!alvo.has(kk) && m.cells[kk] === de) {
              alvo.add(kk);
              fila.push(kk);
            }
          }
        }
      }
    } else if (p.at) for (const k of retangulo(m, p.at, p.to)) alvo.add(k);
    if (!alvo.size) throw new Error("nada a pintar: diga at (com to ou flood) ou cells, dentro da grade " + `${m.columns} x ${m.rows}`);
    const v = indiceNaPaleta(m, p.image);
    let mudou = 0;
    for (const k of alvo)
      if (m.cells[k] !== v) {
        m.cells[k] = v;
        mudou++;
      }
    if (mudou || JSON.stringify(m.palette) !== JSON.stringify(mosaics(e.json)[i].palette)) {
      if (JSON.stringify(m.palette) !== JSON.stringify(mosaics(e.json)[i].palette)) e.set(["mosaics", i, "palette"], m.palette);
      e.set(["mosaics", i, "cells"], m.cells);
    }
    return { painted: mudou, image: v };
  },
});

defineCommand({
  name: "mosaic.cell",
  group: "slot",
  summary:
    "O que muda numa celula do mosaico (ou no retangulo at..to): color (multiplica a cor, hex), height (sobe na tela, px), spin (quartos de volta anti-horario, 0 a 3), flip (espelha na horizontal), effects (os do slot: outline, glow, dissolve, tint, cada um com os campos do slot.effect; null tira). null em qualquer campo volta ao padrao.",
  params: z.object({
    name: z.string(),
    at: Celula,
    to: Celula.optional(),
    color: Cor.nullable().optional(),
    height: z.number().nullable().optional(),
    spin: z.number().int().nullable().optional(),
    flip: z.boolean().nullable().optional(),
    effects: z.record(z.string(), z.record(z.string(), z.any()).nullable()).nullable().optional(),
  }),
  label: (p) => `celula ${p.name}`,
  run({ e }, p) {
    const i = requireMosaic(e.json, p.name);
    const m = mosaics(e.json)[i];
    const extras: Record<string, any> = structuredClone(m.extras ?? {});
    for (const ef of Object.keys(p.effects ?? {})) if (!(ef in EFFECTS) || ef === "smear" || ef === "trail" || ef === "adjust") throw new Error(`efeito de celula desconhecido: ${ef} (outline, glow, dissolve, tint)`);
    const cells = retangulo(m, p.at, p.to);
    if (!cells.length) throw new Error(`fora da grade ${m.columns} x ${m.rows}`);
    for (const k of cells) {
      const x: any = { ...(extras[k] ?? {}) };
      const poe = (campo: string, v: any) => {
        if (v === undefined) return;
        if (v === null) delete x[campo];
        else x[campo] = v;
      };
      poe("color", p.color);
      poe("height", p.height === null || p.height === undefined ? p.height : round(p.height));
      poe("spin", p.spin === null || p.spin === undefined ? p.spin : ((p.spin % 4) + 4) % 4 || null);
      poe("flip", p.flip === false ? null : p.flip);
      if (p.effects === null) delete x.effects;
      else if (p.effects) {
        const efs = { ...(x.effects ?? {}) };
        for (const [k2, v] of Object.entries(p.effects)) {
          if (v === null) delete efs[k2];
          else efs[k2] = { ...(efs[k2] ?? {}), ...v };
        }
        if (Object.keys(efs).length) x.effects = efs;
        else delete x.effects;
      }
      if (Object.keys(x).length) extras[k] = x;
      else delete extras[k];
    }
    const novo = Object.keys(extras).length ? extras : undefined;
    if (JSON.stringify(novo) !== JSON.stringify(m.extras)) e.set(["mosaics", i, "extras"], novo);
    return { cells: cells.length };
  },
});

defineCommand({
  name: "mosaic.delete",
  group: "slot",
  summary: "Apaga um mosaico.",
  params: z.object({ name: z.string() }),
  label: (p) => `apaga mosaico ${p.name}`,
  run({ e }, p) {
    const i = requireMosaic(e.json, p.name);
    const resto = mosaics(e.json).filter((_, k) => k !== i);
    e.set(["mosaics"], resto.length ? resto : undefined);
    return { deleted: p.name };
  },
});

defineCommand({
  name: "mosaic.rename",
  group: "slot",
  summary: "Renomeia um mosaico.",
  params: z.object({ name: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia mosaico ${p.name}`,
  run({ e }, p) {
    const i = requireMosaic(e.json, p.name);
    if (mosaics(e.json).some((m) => m.name === p.to)) throw new Error(`já existe o mosaico ${p.to}`);
    e.set(["mosaics", i, "name"], p.to);
    return { renamed: p.to };
  },
});
