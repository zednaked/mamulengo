// Mutacoes primitivas sobre o JSON do Spine. Todo comando (da UI ou do Claude)
// vira uma lista de ops; cada op sabe gerar seu inverso, entao undo/redo,
// log de operacoes e replay saem de graca.

import { renameKeyOrder } from "./format.ts";

export type Path = (string | number)[];

export type Op =
  // value undefined remove a chave
  | { op: "set"; path: Path; value: any }
  | { op: "insert"; path: Path; index: number; value: any }
  | { op: "remove"; path: Path; index: number }
  // renomeia uma chave de objeto mantendo a posicao dela (nomes de animacao, osso em timelines...)
  | { op: "rename"; path: Path; from: string; to: string };

export function get(root: any, path: Path): any {
  let n = root;
  for (const k of path) {
    if (n == null) return undefined;
    n = n[k];
  }
  return n;
}

// Devolve o pai da ultima chave; com create, cria contenedores que faltam e informa
// o indice do primeiro criado (o desfazer precisa apagar a partir dele).
function parentOf(root: any, path: Path, create: boolean): { parent: any; created: number } {
  let n = root;
  let created = -1;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (n[k] == null) {
      if (!create) throw new Error(`caminho inexistente: ${path.slice(0, i + 1).join(".")}`);
      n[k] = typeof path[i + 1] === "number" ? [] : {};
      if (created < 0) created = i;
    }
    n = n[k];
  }
  return { parent: n, created };
}

// Aplica e devolve o inverso.
export function applyOp(root: any, o: Op): Op {
  switch (o.op) {
    case "set": {
      const { parent: p, created } = parentOf(root, o.path, true);
      const k = o.path[o.path.length - 1];
      const had = Array.isArray(p) ? (k as number) < p.length : Object.prototype.hasOwnProperty.call(p, k);
      const prev = had ? p[k] : undefined;
      if (o.value === undefined) {
        if (Array.isArray(p)) throw new Error("use remove para arrays");
        delete p[k];
      } else p[k] = o.value;
      // criou contenedores no caminho: desfazer remove a partir do primeiro criado
      if (created >= 0) return { op: "set", path: o.path.slice(0, created + 1), value: undefined };
      return { op: "set", path: o.path, value: prev };
    }
    case "insert": {
      const a = get(root, o.path) ?? (applyOp(root, { op: "set", path: o.path, value: [] }), get(root, o.path));
      if (!Array.isArray(a)) throw new Error(`nao e array: ${o.path.join(".")}`);
      a.splice(o.index, 0, o.value);
      return { op: "remove", path: o.path, index: o.index };
    }
    case "remove": {
      const a = get(root, o.path);
      if (!Array.isArray(a)) throw new Error(`nao e array: ${o.path.join(".")}`);
      const [v] = a.splice(o.index, 1);
      return { op: "insert", path: o.path, index: o.index, value: v };
    }
    case "rename": {
      const obj = get(root, o.path);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error(`nao e objeto: ${o.path.join(".")}`);
      if (!(o.from in obj)) throw new Error(`chave inexistente: ${o.from}`);
      if (o.to in obj) throw new Error(`chave ja existe: ${o.to}`);
      // recria as chaves na mesma ordem, trocando so o nome (filhos mantem identidade)
      const entries = Object.entries(obj);
      for (const [k] of entries) delete obj[k];
      for (const [k, v] of entries) obj[k === o.from ? o.to : k] = v;
      renameKeyOrder(obj, o.from, o.to);
      return { op: "rename", path: o.path, from: o.to, to: o.from };
    }
  }
}

export interface Transaction {
  label: string;
  // edicoes continuas (arrastar) com a mesma chave se fundem numa so
  merge?: string;
  // quem originou: "ui", "claude", "script"...
  source: string;
  ops: Op[];
  inverse: Op[]; // ja em ordem de desfazer
}
