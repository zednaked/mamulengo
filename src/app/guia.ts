// O guia das ferramentas: um assunto por ferramenta, em passos curtos, com as teclas. Aparece pelo
// "?" da barra, pelo "?" do Atelie e sozinho na primeira vez de cada lugar (src/app/Guia.svelte).
export interface Assunto {
  id: string;
  icone: string;
  titulo: string;
  // para que serve, em uma frase
  serve: string;
  passos: string[];
  teclas?: [string, string][];
  // o que ainda nao da para fazer, dito sem rodeio
  falta?: string;
  // botao que leva ao lugar ("novo" abre o dialogo, "atelie" e "desenhar" entram no modo)
  ir?: { rotulo: string; acao: "novo" | "atelie" | "desenhar" };
}

export const ASSUNTOS: Assunto[] = [
  {
    id: "comecar",
    icone: "🌱",
    titulo: "Começar do zero",
    serve: "Criar um personagem em branco para ilustrar e animar, sem PSD e sem Godot.",
    passos: [
      "Clique no nome do personagem lá em cima (ou em “Abrir personagem…”) e em ＋ Novo em branco. Dê um nome; ele vira uma pasta com o arquivo .boneco dentro.",
      "O personagem novo tem só um osso, a raiz, no centro da tela. Com “abrir no Ateliê” marcado, você já cai na tela limpa com o lápis na mão.",
      "Há dois jeitos de desenhar, e eles se combinam. Quadro a quadro (Ateliê, tecla 8): cada desenho vale por um instante da animação. Peça do boneco (Desenhar, tecla 7): o desenho é uma parte fixa, presa a um osso, que você anima girando e movendo.",
      "Para ilustrar e depois animar com ossos: desenhe cada parte que se mexe como uma peça separada (corpo, cabeça, braço), cada uma no seu osso. Para animação desenhada: fique no Ateliê e faça um quadro depois do outro.",
      "Ctrl+S grava. Os desenhos ficam dentro do .boneco e a imagem deles sai ao lado, num PNG.",
    ],
    falta: "Já tem arte pronta? Arraste um PSD em camadas para a janela: cada camada vira uma parte.",
    ir: { rotulo: "＋ Novo em branco", acao: "novo" },
  },
  {
    id: "lapis",
    icone: "✏️",
    titulo: "Lápis e borracha",
    serve: "Desenhar à mão livre com a caneta da mesa. O traço vira uma curva de poucos pontos, que continua editável.",
    passos: [
      "Escolha ✏️ (L) e desenhe. Com a mesa, apertar mais engrossa o traço; com o mouse a largura é igual.",
      "À esquerda, o estilo diz como a pressão vira largura: Uniforme (igual), Lápis (pouca variação), Nanquim (fino e grosso, pontas afiadas), Pincel (muita variação), Marcador (grosso e reto).",
      "Tamanho: a largura máxima do traço. Estável: a ponta segue a caneta com atraso e o tremor some (bom para linhas longas; alto demais encolhe curvas rápidas). Liso: o quanto a curva pode se afastar da mão (mais liso, menos pontos).",
      "◖ mancha: o traço fecha e enche de cor, para pintar áreas. As bolinhas e o quadrado de cor escolhem a cor.",
      "🧽 (E) apaga o traço inteiro por onde passa. O botão de borracha da caneta faz o mesmo sem trocar de ferramenta.",
      "Errou? Ctrl+Z. Cada traço é um passo.",
    ],
    teclas: [["L ou B", "lápis"], ["E", "borracha"], ["[ ]", "tamanho"], ["Ctrl+Z", "desfazer"], ["Ctrl+Shift+Z", "refazer"], ["Espaço + arrastar", "andar pela tela"], ["roda", "zoom"]],
    falta: "Para pintura em pixels com os pincéis do ProCraft, use o Pincel (B), no assunto seguinte.",
    ir: { rotulo: "Abrir o Ateliê", acao: "atelie" },
  },
  {
    id: "pincel",
    icone: "🖌",
    titulo: "Pincel (pintura)",
    serve: "Pintar em pixels com os pincéis do ProCraft: os mesmos da sua biblioteca, com grão, mistura e borrado.",
    passos: [
      "No Ateliê, escolha 🖌 (B). Na primeira vez depois de abrir o editor, os pincéis levam uns 30 segundos para carregar; o aviso some quando estão prontos.",
      "À esquerda, o botão com o nome do pincel abre o seletor: os conjuntos da sua biblioteca, a amostra de cada pincel, a busca por nome e os usados por último. Dois cliques escolhem e fecham.",
      "Tamanho e opacidade são as réguas do ProCraft (0 a 100). [ e ] mudam o tamanho. A cor é a da barra de cima.",
      "👆 (S) borra a tinta que já está no quadro. 🧽 (E), com o pincel em uso, é a borracha de tinta: apaga pixels com um pincel (o botão de borracha da caneta faz o mesmo). Cada uma das três guarda o pincel dela.",
      "Cada pincelada é um passo de Ctrl+Z. A pintura fica por baixo das formas do lápis vetorial, no mesmo quadro: dá para pintar a massa e riscar o contorno por cima.",
      "Ctrl+S grava cada quadro pintado num PNG, na pasta <personagem>-pinturas ao lado do arquivo.",
    ],
    teclas: [["B", "pincel"], ["S", "borrar"], ["E", "borracha de tinta"], ["[ ]", "tamanho"], ["L", "voltar ao lápis vetorial"]],
    falta: "A folha começa com 1024 px e cresce sozinha quando a pincelada passa da borda (até 2048 px de lado, o máximo que o pintor lê; durante a pincelada, o que passa da borda só aparece ao soltar). Ainda não há cursor com o tamanho do pincel.",
    ir: { rotulo: "Abrir o Ateliê", acao: "atelie" },
  },
  {
    id: "retoque",
    icone: "🪣",
    titulo: "Balde e laço",
    serve: "Encher áreas de cor e mexer num pedaço do desenho: mover, mudar de tamanho, girar, apagar.",
    passos: [
      "🪣 (G) e um clique numa área fechada: a cor entra na pintura, por baixo das linhas, sejam elas do lápis vetorial ou do pincel. Em cima de uma forma vetorial (uma mancha, um traço), o balde troca a cor dela.",
      "O limiar, à esquerda, diz o quanto a cor pode variar para ainda ser a mesma área. Vazou para fora? A linha tem uma fresta: feche a fresta ou baixe o limiar. Sobrou uma beirada sem cor? Suba o limiar.",
      "➰ (Q): contorne o pedaço. Aparece uma caixa: arraste dentro para mover, um canto para esticar (com Shift, por igual; com Alt, a partir do centro), um lado para esticar só numa direção, a bolinha de cima para girar. Passar um lado por cima do outro espelha; H espelha direto, Shift+H vira de cabeça para baixo. A pintura dentro do laço e os traços vetoriais que estão inteiros dentro dele vão juntos.",
      "Levou o pedaço para fora da folha? Ao assentar, a folha cresce até ele (o que passa aparece enquanto você arrasta).",
      "Enter assenta o pedaço. Esc devolve para onde estava. Delete apaga o que está dentro. Clicar fora recomeça o laço.",
      "T escolhe o quadro inteiro: bom para, depois de ⧉ cópia, deslocar ou girar o desenho todo no quadro seguinte.",
      "Com um laço feito, o balde, o pincel, o borrar e a borracha de tinta só mexem dentro dele: troque para 🖌 (B) e pinte por cima da borda sem medo.",
    ],
    teclas: [["G", "balde"], ["Q", "laço"], ["T", "o quadro inteiro"], ["Enter", "assentar"], ["Esc", "devolver, tirar a seleção"], ["Delete", "apagar o que está dentro"], ["H", "espelhar"], ["Shift+H", "virar de cabeça para baixo"], ["Shift", "mover reto, esticar por igual, girar de 15 em 15°"], ["Alt", "esticar a partir do centro"]],
    falta: "O lápis vetorial não respeita o laço (só as ferramentas de pixels). A folha cresce até 2048 px de lado.",
    ir: { rotulo: "Abrir o Ateliê", acao: "atelie" },
  },
  {
    id: "quadros",
    icone: "🎞️",
    titulo: "Quadro a quadro",
    serve: "Uma sequência de desenhos, cada um num instante da animação: um flipbook dentro da timeline.",
    passos: [
      "No Ateliê (tecla 8), a tira de baixo é a animação em células. Cada célula é um quadro na cadência escolhida (qps, à direita: 12 é o comum).",
      "Desenhe: o primeiro traço cria a camada de quadros e o quadro 1. A camada é uma parte do boneco que fica vazia na Pose base e mostra um desenho por vez.",
      "＋ quadro (N) abre o quadro seguinte em branco. ⧉ cópia (Shift+N) abre com o desenho anterior, para mudar só um pedaço.",
      "🧅 liga o papel de cebola: o quadro de antes aparece em rosa, o de depois em verde. Os números ao lado dizem quantos de cada lado.",
      ", e . andam entre os quadros; as setas andam uma célula. Enter toca.",
      "＋ segura faz o quadro durar mais uma célula (o resto anda junto); － segura encurta. ∅ fim faz o desenho sumir dali em diante. ✕ tirar apaga o quadro à mostra.",
      "✨ meio: desenhe duas chaves e, no primeiro, peça os intermediários (quantos, o espaçamento, e se é só este par ou todos os pares da camada). O RIFE desenha os do meio como pintura, num passo de desfazer, para você limpar por cima. Funciona bem com movimento, escala e deformação; um giro que revela o outro lado sai fraco (desenhe uma chave a mais no meio do giro).",
      "Gire a tela como no ProCraft: R gira 15° no sentido do relógio, Shift+R volta (o anel da sua mesa já manda R e F14), e R segurado com um arrasto gira livre. O ângulo aparece no topo; um clique nele desvira. Só a vista gira: o desenho e o jogo não mudam, e ao sair do Ateliê a tela fica em pé.",
      "Na tira, arraste um quadro pelo meio para mudar a célula em que ele entra; solto em cima de outro, os dois trocam de lugar. Arraste a borda direita para ele durar mais ou menos. Arrastar na régua de cima (ou no vazio) só passeia pelo tempo.",
    ],
    teclas: [["R", "gira a tela 15° (o anel da mesa)"], ["Shift+R ou F14", "gira de volta"], ["R + arrastar", "gira livre (Shift: de 15 em 15°)"], ["N", "quadro novo"], ["Shift+N", "cópia do anterior"], [", .", "quadro anterior, próximo"], ["← →", "uma célula"], ["Enter", "tocar"], ["8", "entrar e sair do Ateliê"]],
    ir: { rotulo: "Abrir o Ateliê", acao: "atelie" },
  },
  {
    id: "acento",
    icone: "💥",
    titulo: "Acento por cima do boneco",
    serve: "Um desenho quadro a quadro em cima da animação de ossos: rastro, impacto, fumaça, uma expressão.",
    passos: [
      "Abra o personagem e a animação que vai ganhar o acento. Escolha o osso que deve carregar o desenho (a mão, para um rastro de soco); sem osso escolhido, vai na raiz.",
      "Entre no Ateliê (8). O boneco aparece por trás, no instante da tira. 🎭 é a mesa de luz: o quanto ele aparece.",
      "Vá ao instante do acento (os pontos azuis na tira são as chaves dos ossos) e desenhe: o quadro nasce ali.",
      "Faça dois ou três quadros e termine com ∅ fim, para o desenho sumir depois do acento.",
      "‹ Editor volta para a timeline: a camada aparece lá como uma linha de troca de imagem. Toca no jogo como qualquer outra parte.",
    ],
    ir: { rotulo: "Abrir o Ateliê", acao: "atelie" },
  },
  {
    id: "formas",
    icone: "✒️",
    titulo: "Formas e pontos",
    serve: "Desenho preciso, como no Figma: caneta de pontos, retângulo, elipse, e o ajuste do que já foi desenhado.",
    passos: [
      "✒️ Caneta (P): clique faz canto, arrastar faz curva. Clicar no primeiro ponto fecha a forma; Enter ou Esc termina aberta.",
      "▭ (R) e ◯ (O): arraste. Shift mantém a proporção, Alt desenha a partir do centro.",
      "↖ Selecionar (V): clique escolhe a forma e arrastar move. Na forma escolhida aparecem os pontos e as alças; clique duplo num ponto troca canto e curva; Delete apaga.",
      "Traço do lápis também é forma: com ↖ você conserta um ponto em vez de redesenhar.",
      "Fora do Ateliê, o painel da direita mostra a lista de formas (ordem, esconder, apagar) e o estilo: preenchimento, traço, espessura, furos.",
    ],
    teclas: [["P", "caneta"], ["V", "selecionar"], ["R", "retângulo"], ["O", "elipse"], ["Delete", "apagar"], ["setas", "empurrar 1 px (Shift: 10)"]],
  },
  {
    id: "peca",
    icone: "🧩",
    titulo: "Desenhar uma peça do boneco",
    serve: "Uma parte fixa (cabeça, braço, corpo) desenhada dentro do editor e presa a um osso, para animar com chaves.",
    passos: [
      "Embaixo, fique em Pose base. Clique no osso que vai segurar a peça (à esquerda, em Ossos).",
      "✒️ Desenhar (tecla 7) cria uma peça nova naquele osso e abre o modo de desenho, com as mesmas ferramentas do Ateliê.",
      "Desenhe a peça com sobra onde ela encontra a vizinha (o braço entra um pouco no ombro), para a junta não abrir ao girar.",
      "Esc sai do desenho. A peça aparece em Ordem; arraste ali para pôr na frente ou atrás das outras.",
      "Repita para cada parte. Dois cliques numa peça desenhada abrem ela de novo.",
    ],
    teclas: [["7", "desenhar"], ["Esc", "sair do desenho"], ["Page Up / Down", "peça para frente ou para trás"]],
    ir: { rotulo: "Desenhar no osso escolhido", acao: "desenhar" },
  },
  {
    id: "ossos",
    icone: "🦴",
    titulo: "Ossos",
    serve: "O esqueleto: cada osso gira em torno do começo dele e leva junto os filhos e as peças presas nele.",
    passos: [
      "Em Pose base, escolha o osso que será o pai (o corpo, para criar a cabeça) e pegue a ferramenta Osso (5).",
      "Arraste do ponto de giro até a ponta: o osso nasce como filho do escolhido. O começo do osso é a junta; ponha no meio da sobreposição das duas peças.",
      "Para prender uma peça a outro osso, escolha a peça e troque o osso no painel da direita.",
      "Dois cliques no nome renomeiam; 🗑 apaga (leva os filhos).",
    ],
    teclas: [["5", "criar osso"], ["1", "mover"], ["2", "girar"], ["Esc", "tirar a seleção"]],
  },
  {
    id: "animar",
    icone: "🎬",
    titulo: "Animar com chaves",
    serve: "Fazer o boneco se mexer: você põe a pose em alguns instantes e o editor faz o caminho entre elas.",
    passos: [
      "Embaixo, escolha uma animação ou ＋ nova. Fora da Pose base, tudo o que você mexe vira chave no instante da régua.",
      "Ande na régua até o instante, pegue Girar (2) ou Mover (1) e arraste a parte. Puxar a mão dobra o braço inteiro; Alt move a junta solta.",
      "Vá a outro instante e mude a pose. Espaço toca.",
      "As chaves são os losangos na timeline: arraste para mudar o tempo, Del apaga, Ctrl+C e Ctrl+V copiam.",
      "No painel da direita há movimentos prontos (Respirar, Balançar, Quicar) para começar.",
    ],
    teclas: [["1 2 3", "mover, girar, esticar"], ["Espaço", "tocar e pausar"], ["← →", "um quadro (com o mouse fora do desenho)"], ["Shift + ← →", "chave anterior, próxima"], ["Home / End", "início, fim"]],
  },
  {
    id: "deformar",
    icone: "🖌",
    titulo: "Deformar e malha",
    serve: "Dobrar a própria imagem: massinha com o pincel, ou uma malha que acompanha os ossos.",
    passos: [
      "Escolha a peça e, no painel da direita, “Deixar deformável”: a imagem vira uma malha de triângulos.",
      "Numa animação, o pincel Deformar (4) empurra a imagem e cria chaves; [ e ] mudam o tamanho do pincel.",
      "“Dobrar com os ossos” liga a malha aos ossos: a manga dobra no cotovelo em vez de quebrar.",
      "“Editar malha”, na Pose base, mostra os pontos: arrastar move, clicar cria, Delete apaga.",
    ],
    teclas: [["4", "deformar"], ["[ ]", "tamanho do pincel"]],
  },
  {
    id: "salvar",
    icone: "💾",
    titulo: "Salvar e exportar",
    serve: "Gravar o trabalho e tirar um GIF ou vídeo dele.",
    passos: [
      "Ctrl+S grava o .boneco, com cópia de segurança. O botão lá em cima mostra ● Salvar quando há algo por gravar.",
      "A aba Versões, à esquerda, guarda cada salvamento: dá para comparar e voltar.",
      "“exportar”, na timeline, gera GIF, WebP ou vídeo da animação como está na tela.",
    ],
    teclas: [["Ctrl+S", "salvar"]],
  },
];

// ja viu este assunto? (o guia abre sozinho na primeira vez de cada lugar)
export function visto(id: string): boolean {
  try {
    return !!localStorage.getItem(`mamulengo.guia.${id}`);
  } catch {
    return true;
  }
}
export function marcarVisto(id: string) {
  try {
    localStorage.setItem(`mamulengo.guia.${id}`, "1");
  } catch {}
}
