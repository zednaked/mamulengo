// Versoes de cada personagem, alem do desfazer: toda gravacao vira uma versao automatica
// e da para marcar versoes com nome, comparar e restaurar. Fica fora dos repositorios dos
// jogos (~/.local/share/mamulengo/versoes), com o conteudo guardado por hash: o que nao
// mudou entre versoes (atlas, paginas) nao ocupa espaco de novo.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseAtlas } from "./atlas.ts";

export const VERSIONS_ROOT = process.env.MAMULENGO_VERSIONS ?? join(homedir(), ".local", "share", "mamulengo", "versoes");

export interface VersionEntry {
  id: string;
  at: string; // ISO
  label: string | null; // nome dado por alguem; null = automatica (gravacao)
  source: string; // "ui", "claude", ...
  skeleton: string; // blob
  atlas: string | null; // blob
  pages: Record<string, string>; // nome da pagina -> blob
  bytes: number;
}

interface Index {
  skeleton: string;
  atlas: string | null;
  versions: VersionEntry[];
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const keyOf = (skeleton: string) => sha(resolve(skeleton)).slice(0, 16);
const dirOf = (skeleton: string) => join(VERSIONS_ROOT, keyOf(skeleton));
const blobPath = (h: string) => join(VERSIONS_ROOT, "blobs", h.slice(0, 2), h);

function putBlob(data: Buffer | string): string {
  const h = sha(data);
  const p = blobPath(h);
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
  return h;
}
export const readBlob = (h: string) => readFileSync(blobPath(h));

function readIndex(skeleton: string): Index {
  const p = join(dirOf(skeleton), "index.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { skeleton: resolve(skeleton), atlas: null, versions: [] };
}
function writeIndex(skeleton: string, idx: Index) {
  mkdirSync(dirOf(skeleton), { recursive: true });
  writeFileSync(join(dirOf(skeleton), "index.json"), JSON.stringify(idx, null, 1));
}

// guarda o estado do disco (esqueleto, atlas e paginas) como versao. Automatica igual a
// ultima nao duplica; marcada (label) sempre entra, mesmo sem mudanca.
export function saveVersion(o: { skeleton: string; atlas?: string | null; label?: string | null; source?: string }): { entry: VersionEntry; created: boolean } {
  const idx = readIndex(o.skeleton);
  const atlasPath = o.atlas ?? idx.atlas;
  const skel = putBlob(readFileSync(o.skeleton));
  let atlas: string | null = null;
  const pages: Record<string, string> = {};
  if (atlasPath && existsSync(atlasPath)) {
    const text = readFileSync(atlasPath, "utf8");
    atlas = putBlob(text);
    for (const pg of parseAtlas(text).pages) {
      const f = join(dirname(atlasPath), pg.name);
      if (existsSync(f)) pages[pg.name] = putBlob(readFileSync(f));
    }
  }
  const last = idx.versions[idx.versions.length - 1];
  const same = last && last.skeleton === skel && last.atlas === atlas && JSON.stringify(last.pages) === JSON.stringify(pages);
  if (same && !o.label) return { entry: last, created: false };
  const at = new Date().toISOString();
  const entry: VersionEntry = { id: at.replace(/[-:.TZ]/g, "").slice(0, 17) + "-" + skel.slice(0, 6), at, label: o.label?.trim() || null, source: o.source ?? "ui", skeleton: skel, atlas, pages, bytes: readFileSync(o.skeleton).length };
  idx.atlas = atlasPath ?? null;
  idx.versions.push(entry);
  writeIndex(o.skeleton, idx);
  return { entry, created: true };
}

export function listVersions(skeleton: string): VersionEntry[] {
  return readIndex(skeleton).versions;
}

export function getVersion(skeleton: string, id: string): VersionEntry {
  const v = readIndex(skeleton).versions.find((x) => x.id === id);
  if (!v) throw new Error(`versao nao existe: ${id}`);
  return v;
}

// restaura uma versao no disco: antes, guarda o estado atual (da para voltar)
export function restoreVersion(o: { skeleton: string; atlas?: string | null; id: string; source?: string; backup: (p: string) => void }): { restored: VersionEntry; before: VersionEntry } {
  const v = getVersion(o.skeleton, o.id);
  const before = saveVersion({ skeleton: o.skeleton, atlas: o.atlas, label: `antes de restaurar ${v.label ?? v.id}`, source: o.source }).entry;
  const atlasPath = o.atlas ?? readIndex(o.skeleton).atlas;
  o.backup(o.skeleton);
  writeFileSync(o.skeleton, readBlob(v.skeleton));
  if (atlasPath && v.atlas) {
    o.backup(atlasPath);
    writeFileSync(atlasPath, readBlob(v.atlas));
    for (const [name, h] of Object.entries(v.pages)) {
      const f = join(dirname(atlasPath), name);
      o.backup(f);
      writeFileSync(f, readBlob(h));
    }
  }
  return { restored: v, before };
}
