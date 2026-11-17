// Por onde o Atelie abre (N-030): uma entrada so (as teclas 7 e 8, o botao, os dois cliques na peca,
// o "Desenhar" do inspetor), e o que ela abre vem da selecao e do modo:
//   'peca'          uma peca desenhada (ou o desenho ja aberto numa peca): o Atelie em volta dela
//   'pintar-imagem' uma peca do atlas: vira pintura (draw.from_region) e abre nela
//   'nova-peca'     na Pose base, so um osso escolhido: uma peca desenhada nova nele
//   'quadro'        o resto: o quadro a quadro (uma camada de quadros escolhida, a animacao aberta,
//                   ou a Pose base sem osso, que ganha a animacao 'desenho')
export type ContextoDoAtelie = "peca" | "nova-peca" | "quadro" | "pintar-imagem";

export interface EntradaDoAtelie {
  mode: "setup" | "animate" | string;
  // a parte e o osso escolhidos
  slot?: string | null;
  bone?: string | null;
  // as camadas de quadros do personagem
  camadas: string[];
  // a parte escolhida mostra um desenho / uma imagem do atlas
  desenhada?: boolean;
  atlas?: boolean;
  // o desenho aberto agora (fora o Atelie): numa peca, ou num quadro
  desenhando?: "peca" | "quadro" | null;
}

export function contextoDoAtelie(e: EntradaDoAtelie): ContextoDoAtelie {
  if (e.desenhando === "peca") return "peca";
  if (e.desenhando === "quadro") return "quadro";
  const sel = e.slot && !e.camadas.includes(e.slot) ? e.slot : null;
  if (sel && e.atlas) return "pintar-imagem";
  if (sel && e.desenhada) return "peca";
  if (e.mode === "setup" && e.bone && !e.slot) return "nova-peca";
  return "quadro";
}
