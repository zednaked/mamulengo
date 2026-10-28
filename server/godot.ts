// Le um projeto Godot do jeito que o spine-godot le: o par esqueleto + atlas
// vem do SpineSkeletonDataResource (*.tres), nao da pasta onde o json esta.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { bonecoAsset } from "./boneco.ts";

export interface SpineAsset {
  tres: string; // caminho absoluto do SpineSkeletonDataResource
  skeleton: string; // .spine-json absoluto
  atlas: string; // .atlas absoluto
  defaultMix: number;
  // mixes por par (animation_mixes: SpineAnimationMix com from, to e mix)
  mixes: { from: string; to: string; mix: number }[];
}

export function findProjectRoot(from: string): string | null {
  let d = resolve(from);
  for (;;) {
    if (existsSync(join(d, "project.godot"))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export function resPath(root: string, p: string): string {
  return p.startsWith("res://") ? join(root, p.slice(6)) : resolve(root, p);
}

export function toRes(root: string, abs: string): string {
  return "res://" + relative(root, abs).split("\\").join("/");
}

export function parseSkeletonDataTres(file: string): SpineAsset | null {
  const text = readFileSync(file, "utf8");
  if (!/type="SpineSkeletonDataResource"/.test(text.split("\n")[0])) return null;
  const root = findProjectRoot(dirname(file));
  if (!root) return null;
  const ext = new Map<string, string>();
  for (const m of text.matchAll(/\[ext_resource[^\]]*\]/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    const path = /\bpath="([^"]+)"/.exec(m[0])?.[1];
    if (id && path) ext.set(id, path);
  }
  const ref = (key: string) => {
    const id = new RegExp(`^${key}\\s*=\\s*ExtResource\\("([^"]+)"\\)`, "m").exec(text)?.[1];
    const p = id ? ext.get(id) : undefined;
    return p ? resPath(root, p) : null;
  };
  const skeleton = ref("skeleton_file_res");
  const atlas = ref("atlas_res");
  if (!skeleton || !atlas) return null;
  const mix = /^default_mix\s*=\s*([\d.]+)/m.exec(text)?.[1];
  return { tres: file, skeleton, atlas, defaultMix: mix ? Number(mix) : 0, mixes: parseMixes(text) };
}

// [sub_resource type="SpineAnimationMix"] com from/to/mix, so os que o resource usa em
// animation_mixes (o AnimationStateData do spine-godot so recebe esses)
export function parseMixes(text: string): { from: string; to: string; mix: number }[] {
  const used = /^animation_mixes\s*=\s*\[([^\]]*)\]/m.exec(text)?.[1] ?? "";
  const out: { from: string; to: string; mix: number }[] = [];
  for (const m of text.matchAll(/\[sub_resource[^\]]*type="SpineAnimationMix"[^\]]*\]([\s\S]*?)(?=\n\[|$)/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    if (!id || !used.includes(`"${id}"`)) continue;
    const body = m[1];
    const from = /^from\s*=\s*"([^"]*)"/m.exec(body)?.[1];
    const to = /^to\s*=\s*"([^"]*)"/m.exec(body)?.[1];
    const mix = /^mix\s*=\s*([\d.eE+-]+)/m.exec(body)?.[1];
    if (from !== undefined && to !== undefined) out.push({ from, to, mix: mix ? Number(mix) : 0 });
  }
  return out;
}

const SKIP = new Set(["node_modules", ".godot", ".git", ".import"]);

export function scanSpineAssets(dir: string, out: SpineAsset[] = []): SpineAsset[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const name = e.name;
    if (SKIP.has(name) || e.isSymbolicLink()) continue;
    const p = join(dir, name);
    if (e.isDirectory()) scanSpineAssets(p, out);
    else if (name.endsWith(".tres")) {
      const a = parseSkeletonDataTres(p);
      if (a) out.push(a);
    } else if (name.endsWith(".boneco")) {
      const a = bonecoAsset(p);
      if (a) out.push(a);
    }
  }
  return out;
}
