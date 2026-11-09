// Leitor de cenas do Godot 4 (.tscn, format=3): as secoes, os valores (Vector2, Color, ExtResource,
// SubResource, arrays tipados, dicionarios, StringName, NodePath) e a arvore de nos com as cenas
// instanciadas abertas. So le: nao executa script. O layout sai de layout.ts.

export type Valor =
  | number
  | string
  | boolean
  | null
  | Valor[]
  | { [k: string]: Valor }
  | { _: string; args: Valor[] } // construtor: Vector2(1, 2), Color(...), PackedStringArray(...)
  | { ext: Recurso } // ExtResource resolvido
  | { sub: SubRecurso }; // SubResource resolvido

export type Recurso = { tipo: string; caminho: string; id: string };
// os casos do Valor, para o TypeScript estreitar
export const ehExt = (v: Valor | undefined): v is { ext: Recurso } => !!v && typeof v === "object" && !Array.isArray(v) && "ext" in v && typeof v.ext === "object";
export const ehSub = (v: Valor | undefined): v is { sub: SubRecurso } => !!v && typeof v === "object" && !Array.isArray(v) && "sub" in v && typeof v.sub === "object";
export const ehConstrutor = (v: Valor | undefined): v is { _: string; args: Valor[] } => {
  const o = v as { _?: unknown; args?: unknown } | null | undefined;
  return !!o && typeof o === "object" && typeof o._ === "string" && Array.isArray(o.args);
};
export type SubRecurso = { tipo: string; id: string; props: Record<string, Valor> };

export type NoCena = {
  nome: string;
  tipo: string; // classe do Godot (o tipo da raiz da cena instanciada quando e instancia)
  props: Record<string, Valor>;
  filhos: NoCena[];
  caminho: string; // a partir da raiz da cena principal ("Layout/Retrato/...")
  grupos?: string[];
  cena: string; // o arquivo .tscn de onde veio o no (para resolver recursos)
};

// ---- lexico
type Tok = { t: "num" | "str" | "id" | "sym" | "sn" | "np"; v: string };
function lexico(s: string, i: number, fim: number): Tok[] {
  const out: Tok[] = [];
  while (i < fim) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === ";") {
      while (i < fim && s[i] !== "\n") i++;
      continue;
    }
    if (c === '"' || ((c === "&" || c === "^") && s[i + 1] === '"')) {
      const tipo = c === "&" ? "sn" : c === "^" ? "np" : "str";
      if (c !== '"') i++;
      i++;
      let v = "";
      while (i < fim && s[i] !== '"') {
        if (s[i] === "\\") {
          const e = s[i + 1];
          v += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
          i += 2;
        } else v += s[i++];
      }
      i++;
      out.push({ t: tipo, v });
      continue;
    }
    if ("[]{}(),:=".includes(c)) {
      out.push({ t: "sym", v: c });
      i++;
      continue;
    }
    if (/[-0-9.]/.test(c)) {
      const m = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(s.slice(i, i + 40));
      if (m) {
        out.push({ t: "num", v: m[0] });
        i += m[0].length;
        continue;
      }
    }
    const m = /^[A-Za-z_][A-Za-z0-9_/.\-]*/.exec(s.slice(i, i + 200));
    if (!m) throw new Error(`tscn: caractere inesperado '${c}' em ${i}`);
    out.push({ t: "id", v: m[0] });
    i += m[0].length;
  }
  return out;
}

// ---- valores
class Leitor {
  k = 0;
  constructor(
    private toks: Tok[],
    private resolver: (tipo: "ext" | "sub", id: string) => Valor,
  ) {}
  fim() {
    return this.k >= this.toks.length;
  }
  olha() {
    return this.toks[this.k];
  }
  pega(sym?: string) {
    const t = this.toks[this.k++];
    if (sym && (t?.t !== "sym" || t.v !== sym)) throw new Error(`tscn: esperava '${sym}', veio '${t?.v}'`);
    return t;
  }
  valor(): Valor {
    const t = this.pega();
    if (t.t === "num") return Number(t.v);
    if (t.t === "str" || t.t === "sn" || t.t === "np") return t.v;
    if (t.t === "sym" && t.v === "[") {
      const a: Valor[] = [];
      while (!(this.olha().t === "sym" && this.olha().v === "]")) {
        a.push(this.valor());
        if (this.olha().t === "sym" && this.olha().v === ",") this.pega();
      }
      this.pega("]");
      return a;
    }
    if (t.t === "sym" && t.v === "{") {
      const o: Record<string, Valor> = {};
      while (!(this.olha().t === "sym" && this.olha().v === "}")) {
        const k = this.valor();
        this.pega(":");
        o[String(k)] = this.valor();
        if (this.olha().t === "sym" && this.olha().v === ",") this.pega();
      }
      this.pega("}");
      return o;
    }
    if (t.t === "id") {
      if (t.v === "true") return true;
      if (t.v === "false") return false;
      if (t.v === "null") return null;
      if (t.v === "inf") return Infinity;
      if (t.v === "nan") return NaN;
      // Array[Tipo]([...]) e Dictionary[A, B]({...}): o tipo nao importa aqui
      if ((t.v === "Array" || t.v === "Dictionary") && this.olha()?.v === "[") {
        let n = 0;
        do {
          const x = this.pega();
          if (x.v === "[") n++;
          if (x.v === "]") n--;
        } while (n > 0);
      }
      if (this.olha()?.t === "sym" && this.olha().v === "(") {
        this.pega("(");
        const args: Valor[] = [];
        while (!(this.olha().t === "sym" && this.olha().v === ")")) {
          args.push(this.valor());
          if (this.olha().t === "sym" && this.olha().v === ",") this.pega();
        }
        this.pega(")");
        if (t.v === "ExtResource") return this.resolver("ext", String(args[0]));
        if (t.v === "SubResource") return this.resolver("sub", String(args[0]));
        if ((t.v === "Array" || t.v === "Dictionary") && args.length === 1) return args[0];
        return { _: t.v, args };
      }
      return t.v;
    }
    throw new Error(`tscn: valor inesperado '${t.v}'`);
  }
}

type Secao = { tag: string; attrs: Record<string, Valor>; props: Record<string, Valor>; ordem: string[] };

// um arquivo .tscn em secoes, com os recursos resolvidos na ordem em que aparecem
export function lerTscn(texto: string, arquivo = ""): { secoes: Secao[]; ext: Map<string, Recurso>; sub: Map<string, SubRecurso> } {
  const ext = new Map<string, Recurso>();
  const sub = new Map<string, SubRecurso>();
  const resolver = (tipo: "ext" | "sub", id: string): Valor => {
    if (tipo === "ext") {
      const r = ext.get(id);
      if (!r) throw new Error(`${arquivo}: ExtResource ${id} nao declarado`);
      return { ext: r };
    }
    const r = sub.get(id);
    if (!r) throw new Error(`${arquivo}: SubResource ${id} nao declarado`);
    return { sub: r };
  };
  const secoes: Secao[] = [];
  // os cabecalhos comecam no inicio da linha com "[" e um nome
  const cab = /^\[(\w+)/gm;
  const posicoes: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = cab.exec(texto))) posicoes.push(m.index);
  posicoes.push(texto.length);
  for (let s = 0; s + 1 < posicoes.length; s++) {
    const toks = lexico(texto, posicoes[s], posicoes[s + 1]);
    const L = new Leitor(toks, resolver);
    L.pega("[");
    const tag = L.pega().v;
    const attrs: Record<string, Valor> = {};
    while (!(L.olha().t === "sym" && L.olha().v === "]")) {
      const k = L.pega().v;
      L.pega("=");
      attrs[k] = L.valor();
    }
    L.pega("]");
    const props: Record<string, Valor> = {};
    const ordem: string[] = [];
    while (!L.fim()) {
      const k = L.pega().v;
      L.pega("=");
      props[k] = L.valor();
      ordem.push(k);
    }
    if (tag === "ext_resource") ext.set(String(attrs.id), { tipo: String(attrs.type), caminho: String(attrs.path), id: String(attrs.id) });
    if (tag === "sub_resource") sub.set(String(attrs.id), { tipo: String(attrs.type), id: String(attrs.id), props });
    secoes.push({ tag, attrs, props, ordem });
  }
  return { secoes, ext, sub };
}

// ---- a arvore, com as cenas instanciadas abertas
// ler(caminho res://) devolve o texto de outro .tscn
export function carregarCena(arquivo: string, ler: (res: string) => string): NoCena {
  const { secoes } = lerTscn(ler(arquivo), arquivo);
  const nos = secoes.filter((s) => s.tag === "node");
  let raiz: NoCena | null = null;
  const porCaminho = new Map<string, NoCena>();
  for (const s of nos) {
    const nome = String(s.attrs.name);
    const pai = s.attrs.parent as string | undefined;
    const inst = s.attrs.instance as { ext: Recurso } | undefined;
    let no: NoCena;
    if (inst?.ext) {
      // a cena instanciada inteira, renomeada, com as propriedades daqui por cima
      no = carregarCena(inst.ext.caminho, ler);
      no.nome = nome;
      Object.assign(no.props, s.props);
    } else no = { nome, tipo: String(s.attrs.type ?? "Node"), props: { ...s.props }, filhos: [], caminho: "", cena: arquivo };
    if (Array.isArray(s.attrs.groups)) no.grupos = s.attrs.groups.map(String);
    if (pai === undefined) {
      raiz = no;
      no.caminho = "";
      porCaminho.set(".", no);
      continue;
    }
    // filho de um no desta cena ou de dentro de uma instancia ("Retrato/Painel")
    let p = porCaminho.get(pai);
    if (!p && raiz) p = acharPorCaminho(raiz, pai);
    if (!p) throw new Error(`${arquivo}: pai '${pai}' de '${nome}' nao achado`);
    // um no que ja existe (sobrescrita de filho editavel de instancia) so recebe as propriedades
    const existente = p.filhos.find((f) => f.nome === nome);
    if (existente && !inst && s.attrs.type === undefined) {
      Object.assign(existente.props, s.props);
      continue;
    }
    p.filhos.push(no);
    porCaminho.set(pai === "." ? nome : `${pai}/${nome}`, no);
  }
  if (!raiz) throw new Error(`${arquivo}: sem no raiz`);
  const caminhos = (n: NoCena, base: string) => {
    n.caminho = base;
    for (const f of n.filhos) caminhos(f, base ? `${base}/${f.nome}` : f.nome);
  };
  caminhos(raiz, "");
  return raiz;
}
function acharPorCaminho(raiz: NoCena, caminho: string): NoCena | undefined {
  let n: NoCena | undefined = raiz;
  for (const parte of caminho.split("/")) {
    if (parte === ".") continue;
    n = n?.filhos.find((f) => f.nome === parte);
  }
  return n;
}
