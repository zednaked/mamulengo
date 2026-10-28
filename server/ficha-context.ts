// Contexto do jogo para a ficha (o editor nao ve): onde o codigo Godot chama cada
// animacao, o que toca depois e os mixes do -data.tres. Usado pelo CLI e pelo servidor.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { GameContext } from "../src/core/ficha.ts";

export function skeletonOf(p: string): { json: string; tres?: string } {
  const abs = resolve(p);
  if (abs.endsWith(".spine-json") || abs.endsWith(".json")) {
    const tres = readdirSync(dirname(abs)).find((f) => f.endsWith("-data.tres"));
    return { json: abs, tres: tres ? join(dirname(abs), tres) : undefined };
  }
  const t = readFileSync(abs, "utf8");
  const m = /skeleton_file_res.*?path="res:\/\/([^"]+)"/s.exec(t) ?? /path="res:\/\/([^"]+\.(?:spine-json|json))"/.exec(t);
  if (!m) throw new Error(`nao achei o skeleton em ${p}`);
  return { json: join(projectRoot(abs) ?? dirname(abs), m[1]), tres: abs };
}

export function projectRoot(from: string): string | undefined {
  for (let d = dirname(resolve(from)); d !== dirname(d); d = dirname(d)) if (existsSync(join(d, "project.godot"))) return d;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f.startsWith(".") || f === "addons" || f === "node_modules") continue;
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(gd|tscn|cs)$/.test(f)) out.push(p);
  }
  return out;
}

export function gameContext(jsonPath: string, tres: string | undefined, anims: string[]): GameContext {
  const root = projectRoot(jsonPath);
  const ctx: GameContext = { usage: {}, returnsTo: {} };
  if (tres) {
    const t = readFileSync(tres, "utf8");
    const dm = /default_mix\s*=\s*([\d.]+)/.exec(t);
    ctx.mix = { defaultMix: dm ? +dm[1] : undefined, pairs: [] };
    for (const m of t.matchAll(/from\s*=\s*"([^"]+)"[\s\S]*?to\s*=\s*"([^"]+)"[\s\S]*?mix\s*=\s*([\d.]+)/g)) ctx.mix.pairs!.push(`${m[1]} -> ${m[2]} ${m[3]}s`);
  }
  if (!root) return ctx;
  ctx.project = root;
  const quoted = (line: string) => anims.filter((a) => line.includes(`"${a}"`) || line.includes(`'${a}'`));
  const queued: string[] = [];
  for (const f of walk(root)) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.trim().startsWith("#")) return;
      const hits = quoted(line);
      for (const a of hits) (ctx.usage![a] ??= []).push(`${relative(root, f)}:${i + 1} \`${line.trim().slice(0, 70)}\``);
      // "toca X ... depois enfileira Y": X volta para Y
      if (/queue|add_animation/i.test(line) && hits.length) {
        const y = hits[0];
        queued.push(y);
        for (let k = Math.max(0, i - 4); k < i; k++) for (const x of quoted(lines[k])) if (x !== y) ctx.returnsTo![x] = y;
      }
    });
  }
  // animacoes tocadas por variavel (ex: tabela de vitorias) que nao pareamos: se o jogo
  // so enfileira uma animacao, as que tocam uma vez voltam para ela
  const back = [...new Set(queued)];
  if (back.length === 1) for (const a of anims) if (a !== back[0] && !ctx.returnsTo![a]) ctx.returnsTo![a] = back[0];
  return ctx;
}
