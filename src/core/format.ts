// Formato canonico: o proprio JSON de export do Spine 4.3. O documento em memoria
// e esse objeto puro; nada e convertido, entao campos desconhecidos passam intactos.
//
// Fidelidade de bytes: o parser guarda, para cada objeto/array, o trecho original
// do arquivo. Na hora de salvar, toda sub-arvore que nao mudou e escrita com esse
// trecho verbatim; so o que foi editado e reserializado, imitando o estilo do arquivo
// (compacto ou pretty, e o estilo de numero que cada chave usa no arquivo).
// Resultado: diff de git mostra so a edicao.

export type SpineJson = Record<string, any>;

interface Source {
  text: string;
  spans: WeakMap<object, [number, number]>;
  // JSON.stringify de cada no no momento do load, para detectar o que mudou
  snap: WeakMap<object, string>;
  style: Style;
}

export interface Style {
  pretty: boolean;
  // separadores do modo compacto: "," e ":" do Spine, ou ", " e ": " de quem
  // regravou o arquivo com json.dumps do Python
  comma: string;
  colon: string;
  indent: string;
  // "chave@profundidade:tipo" (tipo = campo "type" do objeto dono) em que o arquivo escreve inteiros como "50.0" (o resto sai "50").
  // A mesma chave muda de estilo conforme o lugar: width do skeleton sai "1179",
  // width de mesh sai "50.0", width de region sai "1621".
  dotZero: Set<string>;
  // como o arquivo escreve numeros pequenos: "1.0E-5" (Float.toString do Java),
  // "1e-05" (repr do Python) ou decimal
  sci: "java" | "python" | "none";
  eol: string;
}

const sources = new WeakMap<object, Source>();

// Ordem original das chaves de cada objeto. Objetos JS poem chaves numericas
// ("0", "1": attachments de digitos) na frente; o arquivo nao.
const keyOrder = new WeakMap<object, string[]>();

export function renameKeyOrder(o: object, from: string, to: string) {
  const orig = keyOrder.get(o);
  if (orig) keyOrder.set(o, orig.map((k) => (k === from ? to : k)));
}

export function orderedKeys(o: object): string[] {
  const keys = Object.keys(o);
  const orig = keyOrder.get(o);
  if (!orig) return keys;
  const live = new Set(keys);
  const out = orig.filter((k) => live.has(k));
  if (out.length === keys.length) return out;
  const seen = new Set(out);
  for (const k of keys) if (!seen.has(k)) out.push(k);
  return out;
}

export const DEFAULT_STYLE: Style = { pretty: false, comma: ",", colon: ":", indent: "", dotZero: new Set(), sci: "none", eol: "" };

export function parseSpineJson(text: string): SpineJson {
  const { doc, spans, votes } = scan(text);
  const snap = new WeakMap<object, string>();
  const walk = (n: any): string => {
    if (n === null || typeof n !== "object") return JSON.stringify(n);
    const s = Array.isArray(n) ? "[" + n.map(walk).join(",") + "]" : "{" + orderedKeys(n).map((k) => JSON.stringify(k) + ":" + walk(n[k])).join(",") + "}";
    snap.set(n, s);
    return s;
  };
  walk(doc);
  sources.set(doc, { text, spans, snap, style: styleOf(text, votes) });
  return doc;
}

// votes: "chave@profundidade" -> saldo (+1 para inteiro escrito "50.0", -1 para "50")
function scan(text: string) {
  const spans = new WeakMap<object, [number, number]>();
  const votes = new Map<string, number>();
  let i = 0;
  const ws = () => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const fail = (m: string): never => {
    throw new SyntaxError(`${m} na posicao ${i}`);
  };
  const str = (): string => {
    const start = i;
    i++;
    let simple = true;
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 34) break;
      if (c === 92) {
        simple = false;
        i += 2;
        continue;
      }
      if (Number.isNaN(c)) fail("string sem fim");
      i++;
    }
    i++;
    return simple ? text.slice(start + 1, i - 1) : JSON.parse(text.slice(start, i));
  };
  const value = (key: string | null, depth: number, kind: string): any => {
    ws();
    const c = text[i];
    if (c === "{") {
      const start = i++;
      const o: Record<string, any> = {};
      const order: string[] = [];
      ws();
      if (text[i] === "}") i++;
      else
        for (;;) {
          ws();
          if (text[i] !== '"') fail("esperava chave");
          const k = str();
          ws();
          if (text[i++] !== ":") fail("esperava ':'");
          o[k] = value(k, depth + 1, typeof o.type === "string" ? o.type : "");
          order.push(k);
          ws();
          const d = text[i++];
          if (d === "}") break;
          if (d !== ",") fail("esperava ',' ou '}'");
        }
      spans.set(o, [start, i]);
      keyOrder.set(o, order);
      return o;
    }
    if (c === "[") {
      const start = i++;
      const a: any[] = [];
      ws();
      if (text[i] === "]") i++;
      else
        for (;;) {
          a.push(value(key, depth + 1, kind));
          ws();
          const d = text[i++];
          if (d === "]") break;
          if (d !== ",") fail("esperava ',' ou ']'");
        }
      spans.set(a, [start, i]);
      return a;
    }
    if (c === '"') return str();
    const m = /-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null/y;
    m.lastIndex = i;
    const r = m.exec(text);
    if (!r) fail("valor invalido");
    i += r![0].length;
    const t = r![0];
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    const x = Number(t);
    if (Number.isInteger(x) && key !== null) {
      const id = key + "@" + depth + ":" + kind;
      votes.set(id, (votes.get(id) ?? 0) + (r![1] || r![2] ? 1 : -1));
    }
    return x;
  };
  const doc = value(null, 0, "");
  ws();
  if (i !== text.length) fail("lixo depois do JSON");
  return { doc, spans, votes };
}

export function detectStyle(text: string): Style {
  return styleOf(text, scan(text).votes);
}

function styleOf(text: string, votes: Map<string, number>): Style {
  const pretty = /^\{\s*\n/.test(text);
  const dotZero = new Set<string>();
  for (const [id, v] of votes) if (v > 0) dotZero.add(id);
  // menor recuo usado no arquivo (o primeiro pode ja ser de nivel 2)
  let indent = "\t";
  if (pretty) {
    let min = Infinity;
    for (const m of text.matchAll(/\n([\t ]+)\S/g)) if (m[1].length < min) (min = m[1].length), (indent = m[1]);
  }
  const py = !pretty && /^\{"[^"]*": /.test(text);
  return {
    pretty,
    comma: py ? ", " : ",",
    colon: py ? ": " : ":",
    indent,
    dotZero,
    sci: /\d\.\d+E-?\d/.test(text) ? "java" : /\de-0\d/.test(text) ? "python" : "none",
    eol: /\r\n$/.test(text) ? "\r\n" : /\n$/.test(text) ? "\n" : "",
  };
}

// Float.toString do Java para |x| < 1e-3: mantissa com ponto, expoente com "E".
export function javaSci(x: number): string {
  const [m, e] = x.toExponential().split("e");
  return (m.includes(".") ? m : m + ".0") + "E" + Number(e);
}

// repr do Python para |x| < 1e-4: "1e-05", expoente com pelo menos 2 digitos.
export function pythonSci(x: number): string {
  const [m, e] = x.toExponential().split("e");
  const n = Number(e);
  return m + "e" + (n < 0 ? "-" : "+") + String(Math.abs(n)).padStart(2, "0");
}

export function serializeSpineJson(doc: SpineJson, style?: Style, opts: { reuse?: boolean } = {}): string {
  const src = opts.reuse === false ? undefined : sources.get(doc);
  const st = style ?? sources.get(doc)?.style ?? DEFAULT_STYLE;

  const num = (x: number, key: string | null, depth: number, kind: string): string => {
    if (Number.isInteger(x)) return key !== null && st.dotZero.has(key + "@" + depth + ":" + kind) ? (Object.is(x, -0) ? "-0" : String(x)) + ".0" : String(x);
    const a = Math.abs(x);
    if (st.sci === "java" && a < 1e-3) return javaSci(x);
    if (st.sci === "python" && a < 1e-4) return pythonSci(x);
    const s = String(x);
    if (!s.includes("e")) return s;
    // JS usa "1e-7"; o Spine le os dois, mas sem estilo Java preferimos decimal. Ruido de
    // conta (1e-21) some inteiro em 20 casas: vira 0 (cortar os zeros deixava "0.",
    // que nao e JSON valido)
    const d = x.toFixed(20).replace(/0+$/, "");
    return /^-?0\.$/.test(d) ? "0" : d.replace(/\.$/, "");
  };

  // forma canonica de cada no, calculada uma vez por serializacao: sem isso cada
  // nivel acima de uma edicao recalcularia a sub-arvore inteira (O(n x profundidade))
  const memo = new Map<object, string>();
  const canonOf = (n: any): string => {
    if (n === null || typeof n !== "object") return JSON.stringify(n);
    let c = memo.get(n);
    if (c === undefined) {
      c = Array.isArray(n) ? "[" + n.map(canonOf).join(",") + "]" : "{" + orderedKeys(n).map((k) => JSON.stringify(k) + ":" + canonOf(n[k])).join(",") + "}";
      memo.set(n, c);
    }
    return c;
  };
  const reuse = (n: object): string | null => {
    if (!src) return null;
    const sp = src.spans.get(n);
    const before = src.snap.get(n);
    if (!sp || before === undefined) return null;
    // a reutilizacao so vale se o conteudo continua igual
    return canonOf(n) === before ? src.text.slice(sp[0], sp[1]) : null;
  };

  const kindOf = (o: any) => (typeof o.type === "string" ? o.type : "");
  const compact = (n: any, depth: number, key: string | null, kind: string): string => {
    if (n === null || typeof n !== "object") return typeof n === "number" ? num(n, key, depth, kind) : JSON.stringify(n);
    const r = reuse(n);
    if (r !== null) return r;
    if (Array.isArray(n)) return "[" + n.map((v) => compact(v, depth + 1, key, kind)).join(st.comma) + "]";
    return "{" + orderedKeys(n).map((k) => JSON.stringify(k) + st.colon + compact(n[k], depth + 1, k, kindOf(n))).join(st.comma) + "}";
  };

  // prettyPrint do exportador do Spine, medido no corpus: objeto com ate 6 campos
  // escalares vai numa linha; array so de escalares sempre numa linha; o resto quebra.
  const scalar = (v: any) => v === null || typeof v !== "object";
  const pp = (n: any, depth: number, key: string | null, kind: string): string => {
    if (scalar(n)) return typeof n === "number" ? num(n, key, depth, kind) : JSON.stringify(n);
    const r = reuse(n);
    if (r !== null) return r;
    if (Array.isArray(n)) {
      if (n.length === 0) return "[]";
      if (n.every(scalar)) return "[ " + n.map((v) => pp(v, depth + 1, key, kind)).join(", ") + " ]";
      const pad = st.indent.repeat(depth);
      return "[\n" + n.map((v) => pad + pp(v, depth + 1, key, kind)).join(",\n") + "\n" + st.indent.repeat(Math.max(0, depth - 1)) + "]";
    }
    const keys = orderedKeys(n);
    if (keys.length === 0) return "{}";
    const item = (k: string) => JSON.stringify(k) + ": " + pp(n[k], depth + 1, k, kindOf(n));
    if (keys.length <= 6 && keys.every((k) => scalar(n[k]))) return "{ " + keys.map(item).join(", ") + " }";
    const pad = st.indent.repeat(depth);
    return "{\n" + keys.map((k) => pad + item(k)).join(",\n") + "\n" + st.indent.repeat(Math.max(0, depth - 1)) + "}";
  };

  return (st.pretty ? pp(doc, 0, null, "") : compact(doc, 0, null, "")) + st.eol;
}

// Igualdade estrutural respeitando a ordem das chaves.
export function sameDoc(a: any, b: any): boolean {
  return canon(a) === canon(b);
}

function canon(n: any): string {
  if (n === null || typeof n !== "object") return JSON.stringify(n);
  if (Array.isArray(n)) return "[" + n.map(canon).join(",") + "]";
  return "{" + orderedKeys(n).map((k) => JSON.stringify(k) + ":" + canon(n[k])).join(",") + "}";
}
