// Renderiza quadros de um asset no Godot de verdade (spine-godot do projeto), com o
// mesmo harness da medicao de paridade (tools/godot/parity.gd). Num Hyprland, o Godot
// roda num workspace especial silencioso (sem janela piscando na tela).
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot, toRes } from "./godot.ts";

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "tools", "godot", "parity.gd");

function launch(cmd: string, cwd?: string) {
  try {
    execFileSync("hyprctl", ["eval", `hl.exec_cmd("[workspace special:mamulengo silent] sh -c '${cmd}'")`], { stdio: "ignore" });
  } catch {
    spawn("sh", ["-c", cmd], { cwd, stdio: "ignore", detached: true }).unref();
  }
}

async function waitFor(file: string, log: string, timeoutMs: number) {
  const t0 = Date.now();
  while (!existsSync(file)) {
    const text = existsSync(log) ? readFileSync(log, "utf8") : "";
    const err = /SCRIPT ERROR:.*\n\s*at: .*parity\.gd.*/.exec(text);
    if (err) throw new Error(`harness do Godot quebrou: ${err[0].replace(/\s+/g, " ")}`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`o Godot nao respondeu em ${timeoutMs / 1000}s (log: ${log})`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Importa o projeto se ainda nao foi (assets criados pelo editor nunca passaram pelo Godot)
// ou se um arquivo mudou depois do ultimo import (atlas reempacotado, PSD reimportado):
// o harness roda sem o editor, que e quem reimportaria sozinho.
export async function ensureImported(project: string, files: string[]) {
  const imported = join(project, ".godot", "imported");
  // sem extension_list.cfg o Godot headless nao carrega a GDExtension do spine-godot
  // (e nao importa .atlas/.spine-json); o editor cria esse arquivo, o headless nao
  const list = join(project, ".godot", "extension_list.cfg");
  const exts = readdirSync(project).filter((f) => f.endsWith(".gdextension"));
  if (exts.length && !existsSync(list)) {
    mkdirSync(join(project, ".godot"), { recursive: true });
    writeFileSync(list, exts.map((f) => `res://${f}`).join("\n") + "\n");
  }
  const missing = files.some((f) => !existsSync(f + ".import") || statSync(f).mtimeMs > statSync(f + ".import").mtimeMs);
  if (existsSync(imported) && !missing) return false;
  const dir = mkdtempSync(join(tmpdir(), "mamulengo-import-"));
  const done = join(dir, "done");
  launch(`godot --headless --path ${project} --import > ${join(dir, "log")} 2>&1; touch ${done}`);
  await waitFor(done, join(dir, "log"), 180_000);
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export interface GodotShot {
  png: Buffer;
  bones: any;
}

export async function renderInGodot(opts: { tres: string; animation: string | null; times: number[]; rect: number[]; size: number[]; background: number[] }): Promise<GodotShot[]> {
  const project = findProjectRoot(dirname(opts.tres));
  if (!project) throw new Error(`${opts.tres} nao esta num projeto Godot`);
  // sem o spine-godot o Godot abre, nao entende o asset e nao desenha nada
  const spineExt = readdirSync(project).filter((f) => f.endsWith(".gdextension") && /spine/i.test(readFileSync(join(project, f), "utf8")));
  if (!spineExt.length)
    throw new Error(`o projeto Godot em ${project} nao tem o spine-godot (nenhum .gdextension do spine na raiz), entao o Godot nao consegue desenhar o personagem. Ligue a extensao de um jogo que a tenha: npx tsx tools/corpus-project.ts mostra como (linkSpineExtension), ou copie o .gdextension e a pasta dos binarios do spine-godot de um jogo.`);
  const dir = mkdtempSync(join(tmpdir(), "mamulengo-godot-"));
  try {
    const spec = {
      tres: toRes(project, opts.tres),
      rect: opts.rect,
      size: opts.size,
      background: opts.background,
      out_dir: dir,
      jobs: [{ animation: opts.animation ?? "", prefix: "shot", times: opts.times }],
    };
    writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
    mkdirSync(dir, { recursive: true });
    launch(`godot --path ${project} -s ${HARNESS} -- ${join(dir, "spec.json")} > ${join(dir, "godot.log")} 2>&1`);
    await waitFor(join(dir, "done.json"), join(dir, "godot.log"), 90_000);
    const shots = readdirSync(dir)
      .filter((f) => /^shot_\d+\.png$/.test(f))
      .sort()
      .map((f) => ({ png: readFileSync(join(dir, f)), bones: JSON.parse(readFileSync(join(dir, f.replace(".png", ".json")), "utf8")) }));
    if (!shots.length) {
      // o Godot rodou e nao desenhou: o motivo esta no log dele
      const log = existsSync(join(dir, "godot.log")) ? readFileSync(join(dir, "godot.log"), "utf8").trim().split("\n").filter((l) => /error|erro|fail|cannot|not found|invalid/i.test(l)).slice(-6).join(" | ") : "";
      throw new Error(`o Godot rodou mas nao desenhou nenhum quadro de ${opts.animation ?? "setup"}${log ? `. Do log do Godot: ${log}` : " (sem erro no log: confira se o asset abre no Godot)"}`);
    }
    return shots;
  } finally {
    try {
      execFileSync("pkill", ["-f", join(dir, "spec.json")]);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

// Copia o .gdextension do spine-godot de `from` para `to` e liga (symlink) a pasta dos
// binarios que ele referencia. Devolve false se `from` nao tem a extensao.
export function linkSpineExtension(to: string, from: string): boolean {
  // o projeto Godot pode estar numa subpasta do repositorio (Godot/meujogo): procura
  from = findSpineProject(from) ?? from;
  const exts = existsSync(from) ? readdirSync(from).filter((f) => f.endsWith(".gdextension")) : [];
  if (!exts.length) return false;
  for (const ext of exts) {
    cpSync(join(from, ext), join(to, ext));
    // pastas dos binarios: o trecho do caminho res:// antes de /bin/
    const dirs = new Set<string>();
    for (const m of readFileSync(join(from, ext), "utf8").matchAll(/"res:\/\/([^"]+?)\/bin\//g)) dirs.add(m[1]);
    for (const d of dirs) {
      const src = join(from, d),
        dst = join(to, d);
      if (!existsSync(src) || existsSync(dst)) continue;
      mkdirSync(dirname(dst), { recursive: true });
      symlinkSync(src, dst);
    }
  }
  return true;
}

// pasta (a propria ou ate 3 niveis abaixo) com um .gdextension do spine-godot
function findSpineProject(dir: string, depth = 0): string | null {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const items = readdirSync(dir);
  if (items.some((f) => f.endsWith(".gdextension") && /spine/i.test(readFileSync(join(dir, f), "utf8")))) return dir;
  if (depth >= 3) return null;
  for (const f of items) {
    if (f.startsWith(".") || f === "node_modules" || f === "addons") continue;
    const sub = join(dir, f);
    try {
      if (!statSync(sub).isDirectory()) continue;
    } catch {
      continue;
    }
    const r = findSpineProject(sub, depth + 1);
    if (r) return r;
  }
  return null;
}
