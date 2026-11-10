// Os tamanhos de janela do seletor do viewport (docs/EDITOR.md "Tela"): a tela do jogo vista em
// celulares, tablet e desktop. O nucleo calcula a vista e os ossos ancorados (docs/NUCLEO.md "Tela").
import { artOf } from "../core/commands/screen.ts";

export type Janela = { nome: string; w: number; h: number };
export const JANELAS: { nome: string; rotulo: string; w: number; h: number }[] = [
  { nome: "9:16", rotulo: "celular 9:16", w: 1080, h: 1920 },
  { nome: "9:20", rotulo: "celular 9:20", w: 1080, h: 2400 },
  { nome: "3:4", rotulo: "tablet 3:4", w: 1536, h: 2048 },
  { nome: "16:9", rotulo: "desktop 16:9", w: 1920, h: 1080 },
  { nome: "21:9", rotulo: "desktop 21:9", w: 2560, h: 1080 },
];

// "arte" (o tamanho da arte base), um preset pelo nome, [largura, altura] (livre) ou null (sem
// janela)
export function janelaDe(json: any, p: string | number[] | null): Janela | null {
  if (p === null) return null;
  if (Array.isArray(p)) {
    if (p.length !== 2 || !(p[0] > 0 && p[1] > 0)) throw new Error("janela livre: [largura, altura] em pixels");
    return { nome: "livre", w: Math.round(p[0]), h: Math.round(p[1]) };
  }
  if (p === "arte") {
    const a = artOf(json);
    if (!a) throw new Error("sem arte base: screen.set {size: [largura, altura]}");
    return { nome: "arte", w: a[2], h: a[3] };
  }
  const j = JANELAS.find((x) => x.nome === p || x.rotulo === p);
  if (!j) throw new Error(`janela desconhecida: ${p} (arte, ${JANELAS.map((x) => x.nome).join(", ")} ou [largura, altura])`);
  return { nome: j.nome, w: j.w, h: j.h };
}
