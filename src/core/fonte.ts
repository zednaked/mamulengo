// Leitor minimo de fonte TrueType (.ttf com contornos glyf): o bastante para o texto virar formas
// do Desenhar (draw.text). Le cmap (formatos 4 e 12), head, hhea, hmtx, maxp, loca e glyf, com os
// glifos compostos (os acentos). Sem kerning nem ligaduras: a fonte espaca pela largura de
// avanco de cada letra. Fontes CFF (.otf com contornos PostScript) sao recusadas.
import type { DrawPoint } from "./desenho.ts";

export interface Fonte {
  unidades: number; // unitsPerEm
  ascendente: number;
  descendente: number; // negativo
  entrelinha: number; // ascendente - descendente + lineGap
  glifo(cp: number): number;
  avanco(g: number): number;
  // contornos do glifo em unidades da fonte (y para cima): pontos com on (na curva) ou fora
  contornos(g: number): { x: number; y: number; on: boolean }[][];
}

export function lerFonte(bytes: Uint8Array): Fonte {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => v.getUint16(o),
    i16 = (o: number) => v.getInt16(o),
    u32 = (o: number) => v.getUint32(o);
  const tag = u32(0);
  if (tag === 0x4f54544f) throw new Error("fonte CFF (.otf com contornos PostScript) ainda nao: use uma .ttf");
  const n = u16(4);
  const tabelas = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tabelas.set(String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]), u32(o + 8));
  }
  const t = (nome: string) => {
    const o = tabelas.get(nome);
    if (o === undefined) throw new Error(`fonte sem a tabela ${nome}`);
    return o;
  };
  const head = t("head"),
    hhea = t("hhea"),
    maxp = t("maxp"),
    hmtx = t("hmtx"),
    loca = t("loca"),
    glyf = t("glyf"),
    cmap = t("cmap");
  const unidades = u16(head + 18);
  const locLongo = i16(head + 50) === 1;
  const nGlifos = u16(maxp + 4);
  const ascendente = i16(hhea + 4),
    descendente = i16(hhea + 6),
    lineGap = i16(hhea + 8);
  const nMetricas = u16(hhea + 34);
  const local = (g: number) => (locLongo ? u32(loca + g * 4) : u16(loca + g * 2) * 2);

  // cmap: o subtable unicode de formato 12 (todos os planos) ou 4 (BMP)
  let mapa: (cp: number) => number = () => 0;
  {
    const nt = u16(cmap + 2);
    let f4 = -1,
      f12 = -1;
    for (let i = 0; i < nt; i++) {
      const pid = u16(cmap + 4 + i * 8),
        eid = u16(cmap + 6 + i * 8),
        off = cmap + u32(cmap + 8 + i * 8);
      const fmt = u16(off);
      const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
      if (!unicode) continue;
      if (fmt === 12) f12 = off;
      if (fmt === 4) f4 = off;
    }
    if (f12 >= 0) {
      const ng = u32(f12 + 12);
      mapa = (cp) => {
        for (let i = 0; i < ng; i++) {
          const o = f12 + 16 + i * 12;
          const a = u32(o),
            z = u32(o + 4);
          if (cp >= a && cp <= z) return u32(o + 8) + (cp - a);
        }
        return 0;
      };
    } else if (f4 >= 0) {
      const segs = u16(f4 + 6) / 2;
      const fim = f4 + 14,
        ini = fim + segs * 2 + 2,
        delta = ini + segs * 2,
        rng = delta + segs * 2;
      mapa = (cp) => {
        for (let i = 0; i < segs; i++) {
          if (cp > u16(fim + i * 2)) continue;
          const a = u16(ini + i * 2);
          if (cp < a) return 0;
          const ro = u16(rng + i * 2);
          if (!ro) return (cp + i16(delta + i * 2)) & 0xffff;
          const gi = u16(rng + i * 2 + ro + (cp - a) * 2);
          return gi ? (gi + i16(delta + i * 2)) & 0xffff : 0;
        }
        return 0;
      };
    } else throw new Error("fonte sem cmap unicode (formato 4 ou 12)");
  }

  const avanco = (g: number) => u16(hmtx + Math.min(g, nMetricas - 1) * 4);

  function contornos(g: number, prof = 0): { x: number; y: number; on: boolean }[][] {
    if (g < 0 || g >= nGlifos || prof > 8) return [];
    const o = glyf + local(g),
      fim = glyf + local(g + 1);
    if (fim <= o) return [];
    const nc = i16(o);
    if (nc >= 0) {
      // glifo simples
      const fins: number[] = [];
      for (let i = 0; i < nc; i++) fins.push(u16(o + 10 + i * 2));
      const np = nc ? fins[nc - 1] + 1 : 0;
      let p = o + 10 + nc * 2;
      p += 2 + u16(p); // instrucoes
      const flags: number[] = [];
      while (flags.length < np) {
        const f = bytes[p++];
        flags.push(f);
        if (f & 8) {
          let r = bytes[p++];
          while (r-- > 0) flags.push(f);
        }
      }
      const xs: number[] = [],
        ys: number[] = [];
      let x = 0;
      for (const f of flags) {
        if (f & 2) {
          const d = bytes[p++];
          x += f & 16 ? d : -d;
        } else if (!(f & 16)) {
          x += i16(p);
          p += 2;
        }
        xs.push(x);
      }
      let y = 0;
      for (const f of flags) {
        if (f & 4) {
          const d = bytes[p++];
          y += f & 32 ? d : -d;
        } else if (!(f & 32)) {
          y += i16(p);
          p += 2;
        }
        ys.push(y);
      }
      const out: { x: number; y: number; on: boolean }[][] = [];
      let a = 0;
      for (const z of fins) {
        const c: { x: number; y: number; on: boolean }[] = [];
        for (let i = a; i <= z; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
        out.push(c);
        a = z + 1;
      }
      return out;
    }
    // glifo composto: os componentes deslocados (e escalados)
    const out: { x: number; y: number; on: boolean }[][] = [];
    let p = o + 10;
    for (;;) {
      const f = u16(p),
        gi = u16(p + 2);
      p += 4;
      let dx = 0,
        dy = 0;
      if (f & 1) {
        dx = i16(p);
        dy = i16(p + 2);
        p += 4;
      } else {
        dx = (bytes[p] << 24) >> 24;
        dy = (bytes[p + 1] << 24) >> 24;
        p += 2;
      }
      let a = 1,
        b = 0,
        c = 0,
        d = 1;
      const f2 = (q: number) => i16(q) / 16384;
      if (f & 8) {
        a = d = f2(p);
        p += 2;
      } else if (f & 0x40) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (f & 0x80) {
        a = f2(p);
        b = f2(p + 2);
        c = f2(p + 4);
        d = f2(p + 6);
        p += 8;
      }
      for (const ct of contornos(gi, prof + 1)) out.push(ct.map((q) => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on })));
      if (!(f & 0x20)) break;
    }
    return out;
  }

  return { unidades, ascendente, descendente, entrelinha: ascendente - descendente + lineGap, glifo: mapa, avanco, contornos };
}

// um contorno TrueType (quadratico, com pontos fora da curva implicitos) em pontos do Desenhar
// (cubicas com alcas relativas), ja transformado por (x, y) -> (ox + x s, oy - y s)
export function contornoEmPontos(c: { x: number; y: number; on: boolean }[], ox: number, oy: number, s: number): DrawPoint[] {
  if (c.length < 2) return [];
  // so pontos on, com o controle quadratico entre eles (null: reta)
  const pts = c.map((q) => ({ x: ox + q.x * s, y: oy - q.y * s, on: q.on }));
  // comeca num ponto on (ou no meio de dois off)
  let k = pts.findIndex((q) => q.on);
  const seq: { x: number; y: number; on: boolean }[] = [];
  if (k < 0) {
    const a = pts[0],
      b = pts[1];
    seq.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
    k = 1;
    for (let i = 0; i < pts.length; i++) seq.push(pts[(1 + i) % pts.length]);
  } else for (let i = 0; i <= pts.length; i++) seq.push(pts[(k + i) % pts.length]);
  // insere os on implicitos entre dois off
  const cheio: { x: number; y: number; on: boolean }[] = [];
  for (let i = 0; i < seq.length; i++) {
    const q = seq[i];
    if (i > 0 && !q.on && !seq[i - 1].on) cheio.push({ x: (q.x + seq[i - 1].x) / 2, y: (q.y + seq[i - 1].y) / 2, on: true });
    cheio.push(q);
  }
  const out: DrawPoint[] = [];
  const r = (x: number) => Math.round(x * 100) / 100;
  for (let i = 0; i < cheio.length; i++) {
    const q = cheio[i];
    if (!q.on) continue;
    const prev = out[out.length - 1];
    const ctl = i > 0 && !cheio[i - 1].on ? cheio[i - 1] : null;
    if (prev && ctl) {
      // quadratica P0 C P1 -> cubica: P0 + 2/3 (C - P0) e P1 + 2/3 (C - P1)
      prev.out = [r((2 / 3) * (ctl.x - prev.x)), r((2 / 3) * (ctl.y - prev.y))];
      out.push({ x: r(q.x), y: r(q.y), in: [r((2 / 3) * (ctl.x - q.x)), r((2 / 3) * (ctl.y - q.y))] });
    } else out.push({ x: r(q.x), y: r(q.y) });
  }
  // o ultimo e o mesmo que o primeiro (o contorno fecha): junta as alcas
  if (out.length > 1) {
    const a = out[0],
      z = out[out.length - 1];
    if (Math.abs(a.x - z.x) < 1e-6 && Math.abs(a.y - z.y) < 1e-6) {
      if (z.in) a.in = z.in;
      out.pop();
    }
  }
  return out;
}

// o texto (linhas por \n) em contornos do Desenhar: cada linha uma forma (o primeiro contorno e o
// resto como furos, par-impar), na caixa da imagem; x e y e o ponto de ancora (alinhamento em x,
// a linha de base da primeira linha em y)
export function textoEmContornos(f: Fonte, texto: string, o: { x: number; y: number; tamanho: number; alinhar?: "esquerda" | "centro" | "direita"; espacamento?: number; entrelinha?: number }) {
  const s = o.tamanho / f.unidades;
  const linhas = texto.split("\n");
  const passoLinha = (o.entrelinha ?? 1.15) * o.tamanho;
  return linhas.map((linha, li) => {
    const gs = [...linha].map((ch) => f.glifo(ch.codePointAt(0)!));
    const larg = gs.reduce((a, g) => a + f.avanco(g) * s + (o.espacamento ?? 0), 0) - (gs.length ? (o.espacamento ?? 0) : 0);
    let x = o.x - (o.alinhar === "centro" ? larg / 2 : o.alinhar === "direita" ? larg : 0);
    const y = o.y + li * passoLinha;
    const contornos: DrawPoint[][] = [];
    for (const g of gs) {
      for (const c of f.contornos(g)) {
        const p = contornoEmPontos(c, x, y, s);
        if (p.length >= 2) contornos.push(p);
      }
      x += f.avanco(g) * s + (o.espacamento ?? 0);
    }
    return { contornos, largura: larg };
  });
}
