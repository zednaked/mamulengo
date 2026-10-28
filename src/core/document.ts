// O documento aberto: JSON do esqueleto (formato canonico), atlas e historico.
import { applyOp, type Op, type Path, type Transaction } from "./ops.ts";
import { parseSpineJson, serializeSpineJson, type SpineJson } from "./format.ts";

export interface AtlasSource {
  text: string;
  // nome da pagina -> URL/dataURL da imagem
  pages: Record<string, string>;
}

export interface ChangeEvent {
  tx: Transaction;
  kind: "do" | "undo" | "redo";
  // true quando substitui a etapa anterior de um arrasto
  merged?: boolean;
  // a etapa anterior do arrasto, desfeita em silencio (quem acompanha caminhos
  // editados precisa dos dois)
  replaced?: Transaction;
}

export class Document {
  json: SpineJson;
  atlas: AtlasSource;
  // caminho do arquivo no disco (servidor), se veio de la
  file: { skeleton?: string; atlas?: string; tres?: string } = {};
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private listeners = new Set<(e: ChangeEvent) => void>();
  // versao incrementa a cada mudanca; o renderizador usa para reconstruir
  version = 0;
  // topo da pilha de desfazer quando foi salvo: desfazer ate ali volta a "salvo"
  private savedTop: Transaction | null = null;
  private mergeVersion = -1;

  constructor(json: SpineJson, atlas: AtlasSource) {
    this.json = json;
    this.atlas = atlas;
  }

  static fromText(skeletonText: string, atlas: AtlasSource): Document {
    return new Document(parseSpineJson(skeletonText), atlas);
  }

  serialize(): string {
    return serializeSpineJson(this.json);
  }

  markSaved() {
    this.savedTop = this.undoStack[this.undoStack.length - 1] ?? null;
  }
  get dirty() {
    return (this.undoStack[this.undoStack.length - 1] ?? null) !== this.savedTop;
  }

  onChange(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ChangeEvent) {
    this.version++;
    for (const fn of this.listeners) fn(e);
  }

  private open: { label: string; source: string; ops: Op[]; inverse: Op[]; depth: number } | null = null;

  // Edita dentro de uma transacao: cada op e aplicada na hora (o comando pode ler o
  // estado que acabou de criar) e o conjunto vira uma unidade de undo. Chamadas
  // aninhadas entram na transacao de fora. Se fn lancar, tudo e desfeito.
  edit<T>(label: string, source: string, fn: (e: Editor) => T, opts: { merge?: string } = {}): T {
    const outer = this.open === null;
    let merged: Transaction | undefined;
    if (outer && opts.merge) {
      // continua um arrasto: desfaz a etapa anterior sem avisar e refaz com o valor novo
      const top = this.undoStack[this.undoStack.length - 1];
      if (top?.merge === opts.merge && this.version === this.mergeVersion) {
        merged = this.undoStack.pop()!;
        for (const o of merged.inverse) applyOp(this.json, o);
      }
    }
    if (outer) this.open = { label, source, ops: [], inverse: [], depth: 0 };
    const tx = this.open!;
    tx.depth++;
    const editor: Editor = {
      json: this.json,
      apply: (o: Op) => {
        tx.inverse.unshift(applyOp(this.json, fresh(o)));
        tx.ops.push(fresh(o));
      },
      set: (path, value) => editor.apply({ op: "set", path, value }),
      insert: (path, index, value) => editor.apply({ op: "insert", path, index, value }),
      remove: (path, index) => editor.apply({ op: "remove", path, index }),
    };
    try {
      const r = fn(editor);
      tx.depth--;
      if (outer) {
        this.open = null;
        if (tx.ops.length) {
          const t: Transaction = { label: tx.label, source: tx.source, ops: tx.ops, inverse: tx.inverse, merge: opts.merge };
          this.undoStack.push(t);
          this.redoStack.length = 0;
          this.emit({ tx: t, kind: "do", merged: !!merged, replaced: merged });
          this.mergeVersion = this.version;
        } else if (merged) this.emit({ tx: merged, kind: "undo" });
      }
      return r;
    } catch (err) {
      tx.depth--;
      if (outer) {
        for (const o of tx.inverse) applyOp(this.json, o);
        this.open = null;
        // a etapa anterior do arrasto continua valendo
        if (merged) {
          for (const o of merged.ops) applyOp(this.json, structuredClone(o));
          this.undoStack.push(merged);
        }
      }
      throw err;
    }
  }

  transact(label: string, source: string, ops: Op[]): void {
    this.edit(label, source, (e) => ops.forEach((o) => e.apply(o)));
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(): Transaction | null {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    for (const o of tx.inverse) applyOp(this.json, o);
    this.redoStack.push(tx);
    this.emit({ tx, kind: "undo" });
    return tx;
  }

  redo(): Transaction | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    const inverse: Op[] = [];
    for (const o of tx.ops) inverse.unshift(applyOp(this.json, fresh(o)));
    tx.inverse = inverse;
    this.undoStack.push(tx);
    this.emit({ tx, kind: "redo" });
    return tx;
  }

  history(): { label: string; source: string }[] {
    return this.undoStack.map((t) => ({ label: t.label, source: t.source }));
  }
}

export interface Editor {
  readonly json: SpineJson;
  apply(o: Op): void;
  set(path: Path, value: any): void;
  insert(path: Path, index: number, value: any): void;
  remove(path: Path, index: number): void;
}

// O documento e o historico nunca compartilham objetos: a op guardada e o valor
// que entra no JSON sao copias separadas (senao uma edicao futura alteraria o historico).
function clone<T>(v: T): T {
  return v === undefined || v === null || typeof v !== "object" ? v : structuredClone(v);
}
function fresh(o: Op): Op {
  return o.op === "set" || o.op === "insert" ? { ...o, value: clone(o.value) } : o;
}

export type { Op, Path };
