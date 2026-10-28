// Remenda um SkeletonData ja lido quando a edicao e so em animacoes (rele so essas
// animacoes) ou em transformacao de osso na setup (o arrasto mais comum). Reler o
// documento inteiro custa dezenas de ms nos maiores assets; isto custa quase nada.
// O resultado e o mesmo de reler tudo (conferido em tests/features.ts).
import { SkeletonJson, SliderData, type SkeletonData } from "@esotericsoftware/spine-core";
import type { Path } from "./ops.ts";
import type { SpineJson } from "./format.ts";

// campos de osso que a setup pode mudar sem reler o SkeletonData
const BONE_SETUP = new Set(["x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY", "length"]);
const BONE_DEFAULT: Record<string, number> = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, length: 0 };

// paths: caminhos tocados pelas ops (e pelos inversos) desde a ultima leitura.
// Devolve false sem mexer em nada se precisar reler tudo.
export function patchSkeletonData(data: SkeletonData, json: SpineJson, paths: Path[], reader: SkeletonJson): boolean {
  const anims = new Set<string>();
  const bones: [number, string][] = [];
  for (const p of paths) {
    if (p[0] === "animations" && typeof p[1] === "string" && p.length >= 3) anims.add(p[1]);
    else if (p[0] === "bones" && typeof p[1] === "number" && p.length === 3 && BONE_SETUP.has(p[2] as string)) bones.push([p[1], p[2] as string]);
    else return false;
  }
  for (const a of anims) {
    if (!json.animations?.[a] || !data.findAnimation(a)) return false;
    // slider guarda a referencia da animacao
    if (data.constraints.some((c) => c instanceof SliderData && c.animation?.name === a)) return false;
  }
  for (const [i] of bones) if (!json.bones?.[i] || data.bones[i]?.name !== json.bones[i].name) return false;
  // le tudo antes de trocar (se uma animacao falhar, nada muda)
  const fresh = [];
  try {
    for (const a of anims) {
      (reader as any).readAnimation(json.animations[a], a, data);
      fresh.push(data.animations.pop()!);
    }
  } catch {
    return false;
  }
  for (const f of fresh) data.animations[data.animations.findIndex((x) => x.name === f.name)] = f;
  const scale = reader.scale;
  for (const [i, k] of bones) {
    const v = json.bones[i][k] ?? BONE_DEFAULT[k];
    const scaled = k === "x" || k === "y" || k === "length" ? v * scale : v;
    if (k === "length") data.bones[i].length = scaled;
    else (data.bones[i].setupPose as any)[k] = scaled;
  }
  return true;
}
