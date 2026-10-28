// Previa de transicao pedida de fora (ponte, exportar): liga a sequencia no viewer com
// o mix do jogo quando nao vem um.
import { app } from "./state.svelte.ts";
import type { Viewer } from "../render/viewer.ts";

// Previa de transicao pedida pela ponte: {next, mix?, at?, loop?, nextLoop?}. Sem mix,
// o do jogo (par no -data.tres ou default_mix). null desliga; undefined deixa como esta.
export type SequenceParam = { next: string; mix?: number; at?: number | null; loop?: boolean; nextLoop?: boolean } | null | undefined;
export function applySequence(v: Viewer, s: SequenceParam) {
  if (s === undefined) return;
  if (s === null) return v.setSequence(null);
  if (!v.view.animation) throw new Error("sequence precisa de uma animacao (animation)");
  if (!v.data?.findAnimation(s.next)) throw new Error(`animacao nao existe: ${s.next}`);
  v.setSequence({ next: s.next, mix: s.mix ?? app.mixFor(v.view.animation, s.next), at: s.at ?? null, loop: s.loop ?? false, nextLoop: s.nextLoop ?? true });
}
