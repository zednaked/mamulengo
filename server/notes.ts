// Anotacoes do personagem: quem trabalha nele (gente ou Claude) deixa notas presas a uma
// animacao, um instante e uma parte, ou gerais; com respostas e "resolvida". Ficam ao lado
// do .spine-json (<nome>.notas.json), entao viajam com o projeto. Toda mudanca passa por
// aqui (ler, mudar, gravar atomico) para dois autores ao mesmo tempo nao se atropelarem.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export interface Reply {
  at: string;
  autor: string;
  texto: string;
}
export interface Note {
  id: string;
  at: string;
  autor: string;
  texto: string;
  anim: string | null;
  tempo: number | null;
  osso: string | null;
  slot: string | null;
  estado: "aberta" | "resolvida";
  respostas: Reply[];
}
interface File {
  versao: 1;
  notas: Note[];
}

export const notesPath = (skeleton: string) => skeleton.replace(/\.(spine-json|json)$/, "") + ".notas.json";

function read(skeleton: string): File {
  const p = notesPath(skeleton);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { versao: 1, notas: [] };
}
function write(skeleton: string, f: File, backup: (p: string) => void) {
  const p = notesPath(skeleton);
  backup(p);
  const tmp = p + ".mamulengo-tmp";
  writeFileSync(tmp, JSON.stringify(f, null, 1) + "\n");
  renameSync(tmp, p);
}

export function listNotes(skeleton: string): Note[] {
  return read(skeleton).notas;
}

export type NoteAction =
  | { acao: "criar"; autor: string; texto: string; anim?: string | null; tempo?: number | null; osso?: string | null; slot?: string | null }
  | { acao: "responder"; id: string; autor: string; texto: string }
  | { acao: "resolver" | "reabrir" | "apagar"; id: string; autor?: string }
  | { acao: "editar"; id: string; texto: string };

export function changeNotes(skeleton: string, a: NoteAction, backup: (p: string) => void): Note | { apagada: string } {
  const f = read(skeleton);
  const now = new Date().toISOString();
  const find = (id: string) => {
    const n = f.notas.find((x) => x.id === id);
    if (!n) throw new Error(`nota nao existe: ${id}`);
    return n;
  };
  let out: Note | { apagada: string };
  if (a.acao === "criar") {
    if (!a.texto?.trim()) throw new Error("nota vazia");
    const n: Note = { id: randomUUID().slice(0, 8), at: now, autor: a.autor || "alguem", texto: a.texto.trim(), anim: a.anim ?? null, tempo: a.tempo ?? null, osso: a.osso ?? null, slot: a.slot ?? null, estado: "aberta", respostas: [] };
    f.notas.push(n);
    out = n;
  } else if (a.acao === "responder") {
    if (!a.texto?.trim()) throw new Error("resposta vazia");
    const n = find(a.id);
    n.respostas.push({ at: now, autor: a.autor || "alguem", texto: a.texto.trim() });
    out = n;
  } else if (a.acao === "editar") {
    const n = find(a.id);
    n.texto = a.texto.trim();
    out = n;
  } else if (a.acao === "apagar") {
    find(a.id);
    f.notas = f.notas.filter((x) => x.id !== a.id);
    out = { apagada: a.id };
  } else {
    const n = find(a.id);
    n.estado = a.acao === "resolver" ? "resolvida" : "aberta";
    if (a.autor) n.respostas.push({ at: now, autor: a.autor, texto: a.acao === "resolver" ? "(marcou como resolvida)" : "(reabriu)" });
    out = n;
  }
  write(skeleton, f, backup);
  return out;
}
