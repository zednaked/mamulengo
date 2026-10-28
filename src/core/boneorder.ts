// Malhas com pesos guardam INDICES de osso (nao nomes). Todo comando que insere,
// remove ou reordena ossos precisa remapear esses indices, senao as malhas passam a
// seguir o osso errado sem nenhum aviso.
import type { Editor } from "./document.ts";

export function withBoneOrder<T>(e: Editor, fn: () => T): T {
  const before: string[] = (e.json.bones ?? []).map((b: any) => b.name);
  const r = fn();
  const after: string[] = (e.json.bones ?? []).map((b: any) => b.name);
  if (before.join("\u0000") === after.join("\u0000")) return r;
  const index = new Map(after.map((n, i) => [n, i]));
  const map = before.map((n) => index.get(n) ?? -1);
  (e.json.skins ?? []).forEach((s: any, si: number) => {
    for (const [slot, atts] of Object.entries<any>(s.attachments ?? {}))
      for (const [name, a] of Object.entries<any>(atts)) {
        if (!a.vertices || !a.uvs || a.vertices.length <= a.uvs.length) continue;
        const v: number[] = a.vertices;
        const out = v.slice();
        let changed = false;
        for (let i = 0; i < v.length; ) {
          const n = v[i++];
          for (let k = 0; k < n; k++, i += 4) {
            const to = map[v[i]];
            if (to < 0) throw new Error(`a malha ${slot}/${name} usa o osso ${before[v[i]]}, que deixou de existir`);
            if (to !== v[i]) (out[i] = to), (changed = true);
          }
        }
        if (changed) e.set(["skins", si, "attachments", slot, name, "vertices"], out);
      }
  });
  return r;
}
