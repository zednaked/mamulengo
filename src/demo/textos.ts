// Os textos da demo, em ingles (padrao) e portugues. As chaves com {n} recebem valores.
export type Lingua = "en" | "pt";

export const TEXTOS = {
  en: {
    titulo: "Mamulengo: live demo",
    lema: "2D skeletal animation for games, run by people and Claude Code together",
    dica: "Drag a character. Throw it.",
    elenco: "Characters",
    todos: "All six",
    animacoes: "Animations",
    emenda: "Transition",
    emendaAjuda: "Play A once, then blend into B. This is how a game chains animations.",
    mix: "mix",
    tocarEmenda: "Play A, then B",
    copias: "100 copies",
    copiasSair: "Back to six",
    reiniciar: "Reset",
    selo: "No Spine runtime. A C++ core written from scratch, {kb} KB of WebAssembly ({gz} KB gzipped).",
    medidor: "{fps} fps · {n} · pose {pose} · draw {des} per frame",
    um: "1 character",
    varios: "{n} characters",
    sobre:
      "Each character is one .boneco file (skeleton, atlas, animations, transitions and a written brief) played by the Mamulengo core, compiled to WebAssembly and drawn by a small WebGL2 renderer. The robot, the zombie and the cyclops were rigged and animated by Claude Code on its own, over MCP.",
    arte: "Art: Kenney (CC0): Toon Characters, Monster Builder Pack, Modular Characters.",
    repo: "Source on GitHub",
    readme: "Read the README",
    lingua: "Português",
    semWebgl: "This demo needs WebGL2, which this browser does not offer.",
    erro: "Something went wrong loading the demo: {e}",
  },
  pt: {
    titulo: "Mamulengo: demo ao vivo",
    lema: "Animação 2D por esqueleto para jogos, operada por gente e pelo Claude Code juntos",
    dica: "Arraste um personagem. Jogue-o.",
    elenco: "Personagens",
    todos: "Os seis",
    animacoes: "Animações",
    emenda: "Emenda",
    emendaAjuda: "Toca A uma vez e depois mistura em B. É assim que o jogo encadeia animações.",
    mix: "mix",
    tocarEmenda: "Tocar A, depois B",
    copias: "100 cópias",
    copiasSair: "Voltar aos seis",
    reiniciar: "Recomeçar",
    selo: "Sem runtime do Spine. Um núcleo em C++ escrito do zero, {kb} KB de WebAssembly ({gz} KB com gzip).",
    medidor: "{fps} fps · {n} · pose {pose} · desenho {des} por quadro",
    um: "1 personagem",
    varios: "{n} personagens",
    sobre:
      "Cada personagem é um arquivo .boneco (esqueleto, atlas, animações, emendas e uma ficha escrita) tocado pelo núcleo do Mamulengo, compilado para WebAssembly e desenhado por um desenhista WebGL2 pequeno. O robô, o zumbi e o ciclope foram rigados e animados pelo Claude Code sozinho, pelo MCP.",
    arte: "Arte: Kenney (CC0): Toon Characters, Monster Builder Pack, Modular Characters.",
    repo: "Código no GitHub",
    readme: "Leia o README",
    lingua: "English",
    semWebgl: "Esta demo precisa de WebGL2, que este navegador não oferece.",
    erro: "Algo deu errado ao carregar a demo: {e}",
  },
} satisfies Record<Lingua, Record<string, string>>;

export type Chave = keyof (typeof TEXTOS)["en"];

export function texto(l: Lingua, k: Chave, v: Record<string, string | number> = {}): string {
  return TEXTOS[l][k].replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ""));
}
