// Texto com traducao (docs/NUCLEO.md "Texto"): o que vale em qualquer lugar, sem navegador - a
// tabela de idiomas (e o CSV do Godot, `keys,pt,en,...`), o texto de uma parte num idioma (chave,
// texto livre e parametros "{nome}") e a diagramacao na caixa (linhas, alinhamento, encolher,
// quebrar, cortar e o estouro). Quem mede as letras e quem chama: o navegador pelo Canvas 2D (com
// o shaping de verdade: arabe, devanagari), o node pela largura de avanco da fonte (aproximada).

// os 12 idiomas da frota, na ordem do translations.csv dos jogos
export const IDIOMAS_FROTA = ["pt", "en", "es", "hi", "ru", "fr", "it", "ne", "ar", "fil", "de", "nl"];
export const NOMES_IDIOMA: Record<string, string> = {
  pt: "português",
  en: "English",
  es: "español",
  hi: "हिन्दी",
  ru: "русский",
  fr: "français",
  it: "italiano",
  ne: "नेपाली",
  ar: "العربية",
  fil: "Filipino",
  de: "Deutsch",
  nl: "Nederlands",
};
// da direita para a esquerda (o paragrafo inteiro, como o Godot; o alinhamento fica o declarado)
export const RTL = /^(ar|fa|he|ur|ps|sd|ug|ckb|yi)(_|-|$)/;

// a tabela no JSON do editor: `translations: { languages, strings: { chave: [um por idioma] } }`
export type Traducoes = { languages: string[]; strings: Record<string, string[]> };

// a parte de texto no JSON do editor (no .boneco: tipo "texto", docs/FORMATO.md)
export type ParteTexto = {
  type: "text";
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  width: number;
  height: number;
  string?: string; // o texto livre (vale sem chave, ou quando falta a traducao)
  key?: string;
  font?: string;
  size?: number;
  minSize?: number;
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  overflow?: "shrink" | "wrap" | "clip" | "none";
  outline?: { width: number; color?: string };
  shadow?: { color?: string; x?: number; y?: number };
};

// ---- CSV (o translations.csv do Godot: a primeira coluna e a chave, as outras um idioma cada)

export function lerCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let cur = "",
    q = false;
  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") linha.push(cur), (cur = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(cur);
      if (linha.length > 1 || linha[0] !== "") linhas.push(linha);
      (linha = []), (cur = "");
    } else cur += c;
  }
  if (cur !== "" || linha.length) linha.push(cur), linhas.push(linha);
  return linhas;
}

const campoCsv = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function escreverCsv(tr: Traducoes): string {
  const ls = [["keys", ...tr.languages], ...Object.entries(tr.strings).map(([k, v]) => [k, ...tr.languages.map((_, i) => v[i] ?? "")])];
  return ls.map((l) => l.map(campoCsv).join(",")).join("\n") + "\n";
}

// o CSV vira a tabela (a coluna de chaves pode ter qualquer nome; "keys" no Godot)
export function traducoesDoCsv(texto: string): Traducoes {
  const ls = lerCsv(texto);
  if (!ls.length || ls[0].length < 2) throw new Error("CSV de traducoes: a primeira linha e `keys,pt,en,...`");
  const languages = ls[0].slice(1).map((s) => s.trim());
  const strings: Record<string, string[]> = {};
  for (const l of ls.slice(1)) {
    const k = l[0].trim();
    if (!k) continue;
    strings[k] = languages.map((_, i) => l[i + 1] ?? "");
  }
  return { languages, strings };
}

// junta duas tabelas: os idiomas novos entram no fim, e o que a nova tem (nao vazio) vale
export function juntarTraducoes(a: Traducoes | undefined, b: Traducoes): Traducoes {
  const languages = [...(a?.languages ?? [])];
  for (const l of b.languages) if (!languages.includes(l)) languages.push(l);
  const strings: Record<string, string[]> = {};
  const de = (t: Traducoes | undefined, k: string) => languages.map((l) => t?.strings[k]?.[t.languages.indexOf(l)] ?? "");
  for (const k of new Set([...Object.keys(a?.strings ?? {}), ...Object.keys(b.strings)])) {
    const va = de(a, k),
      vb = de(b, k);
    strings[k] = languages.map((_, i) => vb[i] || va[i] || "");
  }
  return { languages, strings };
}

// o idioma pelo codigo: igual, ou so a lingua ("pt_BR" acha "pt")
export function indiceIdioma(languages: string[], idioma: string): number {
  const i = languages.indexOf(idioma);
  if (i >= 0) return i;
  const l = idioma.split(/[_-]/)[0];
  return l !== idioma ? languages.indexOf(l) : -1;
}

// ---- o texto de uma parte

// "{nome}" pelos parametros (os que nao vieram ficam como estao)
export function formatar(t: string, params?: Record<string, string | number> | null): string {
  if (!params) return t;
  return t.replace(/\{([A-Za-z_][\w.]*)\}/g, (m, n) => (n in params ? String(params[n]) : m));
}

// a traducao da chave no idioma; sem ela, o texto livre da parte; sem os dois, o primeiro idioma
// com texto, e por fim a propria chave (o que falta aparece)
export function textoNoIdioma(p: { string?: string; key?: string }, tr: Traducoes | undefined, idioma: string, params?: Record<string, string | number> | null): string {
  let t: string | undefined;
  if (p.key) {
    const linha = tr?.strings[p.key];
    const i = tr ? indiceIdioma(tr.languages, idioma) : -1;
    t = (i >= 0 && linha?.[i]) || p.string || linha?.find((x) => x) || p.key;
  } else t = p.string ?? "";
  return formatar(t ?? "", params);
}

// ---- diagramacao

export type Medidor = {
  // largura da linha (o shaping do navegador, ou a soma dos avancos) com a letra em `px`
  largura(texto: string, px: number): number;
  // ascendente e descendente da fonte em `px` (positivos)
  metricas(px: number): { asc: number; desc: number };
};

export type Caixa = {
  width: number;
  height: number;
  size: number;
  minSize?: number;
  align?: string;
  valign?: string;
  overflow?: string;
};

export type Linha = { texto: string; x: number; y: number; largura: number }; // x, y: o comeco e a linha de base, da caixa (canto de cima e da esquerda, y para baixo)
export type Diagrama = {
  px: number; // a letra que ficou (encolher muda)
  linhas: Linha[];
  asc: number;
  desc: number;
  entrelinha: number;
  // o retangulo que o texto ocupa (da caixa: x, y para baixo)
  usado: [number, number, number, number];
  // nao coube: largura ou altura passam da caixa (com encolher, mesmo no minimo)
  estoura: boolean;
  quanto: [number, number]; // quanto passa, em pixels do mundo (largura, altura)
};

const ENTRELINHA = 1.15;

function quebrar(t: string, w: number, px: number, m: Medidor): string[] {
  const out: string[] = [];
  for (const par of t.split("\n")) {
    let cur = "";
    for (const p of par.split(" ")) {
      const tt = cur ? cur + " " + p : p;
      if (cur && m.largura(tt, px) > w) out.push(cur), (cur = p);
      else cur = tt;
    }
    out.push(cur);
  }
  return out;
}

function montar(t: string, c: Caixa, px: number, m: Medidor): Diagrama {
  const { asc, desc } = m.metricas(px);
  const lh = Math.max(asc + desc, px * ENTRELINHA);
  const textos = c.overflow === "wrap" ? quebrar(t, c.width, px, m) : t.split("\n");
  const total = textos.length * lh - (lh - (asc + desc));
  const y0 = c.valign === "top" ? 0 : c.valign === "bottom" ? c.height - total : (c.height - total) / 2;
  let x0 = Infinity,
    x1 = -Infinity;
  const linhas = textos.map((l, i) => {
    const w = m.largura(l, px);
    const x = c.align === "left" ? 0 : c.align === "right" ? c.width - w : (c.width - w) / 2;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x + w);
    return { texto: l, x, y: y0 + i * lh + asc, largura: w };
  });
  if (!linhas.length) (x0 = 0), (x1 = 0);
  const largura = x1 - x0;
  const quanto: [number, number] = [Math.max(0, largura - c.width), Math.max(0, total - c.height)];
  return { px, linhas, asc, desc, entrelinha: lh, usado: [x0, y0, largura, total], estoura: quanto[0] > 0.5 || quanto[1] > 0.5, quanto };
}

export function diagramar(t: string, c: Caixa, m: Medidor): Diagrama {
  let d = montar(t, c, c.size, m);
  if ((c.overflow ?? "shrink") !== "shrink" || !d.estoura) return d;
  // encolher: a letra na proporcao do que sobra, em passos de meio pixel, ate o minimo
  const min = c.minSize && c.minSize > 0 ? Math.min(c.minSize, c.size) : c.size / 2;
  let px = c.size;
  for (let i = 0; i < 12 && d.estoura && px > min; i++) {
    const f = Math.min(c.width / Math.max(d.usado[2], 1e-6), c.height / Math.max(d.usado[3], 1e-6), 0.98);
    px = Math.max(min, Math.floor(px * f * 2) / 2);
    d = montar(t, c, px, m);
  }
  return d;
}

// o medidor do navegador (o editor registra: o Canvas 2D com as fontes do projeto carregadas); sem
// ele, os comandos medem pela fonte .ttf (aproximado)
export type FabricaMedidor = (doc: any) => Promise<(familia?: string, idioma?: string) => Medidor>;
let registrado: FabricaMedidor | null = null;
export function registrarMedidor(f: FabricaMedidor | null) {
  registrado = f;
}
export const medidorRegistrado = () => registrado;
