# Rubrica de animação

Nota de 0 a 10 para uma animação de personagem. Cada critério vale 1 ponto (0, 0,5 ou 1). Quem anima usa para se avaliar antes de entregar; o diretor da bancada usa para dar as notas. A meta é **9**: o nível de um animador da casa num dia bom. Uma animação tecnicamente certa e tímida fica em 6 ou 7.

1. **Silhueta.** Em miniatura (folha de contato pequena), as poses-chave são diferentes entre si e da pose de entrada. Dá para dizer o que o personagem está fazendo só pela forma. Meça com `query.estilo` (silhueta); a casa, num ganho, muda a silhueta uns 17% da altura, e um animador forte passa de 30%.
2. **Pose clara.** Cada batida tem uma pose forte e legível: braço esticado de verdade, cabeça inclinada, corpo comprometido com a ação. Nada de "meio gesto".
3. **Antecipação.** A ação principal tem um contra-movimento visível antes (agacha antes de pular, recua antes de bater). Curto (0,1 a 0,2 s), mas lido.
4. **Contraste de tempo.** Rápido no gesto, lento na chegada. Impactos com curva seca (`sai-rapido`, linear ou stepped) e holds curtos que respiram. Tudo na mesma curva suave fica flutuando.
5. **Squash e stretch.** O corpo amassa no impacto e estica no salto, preservando volume (escala ou deform de malha). Ausência total numa animação de energia é defeito.
6. **Arcos, hierarquia e micromovimento.** Nas poses seguradas o personagem continua vivo: ombros, cabeça, sobrancelhas e pontas respiram. Velocidade acima da casa sem antecipação vira tranco. Membros andam em arco. O corpo lidera; cabeça, braços e pontas chegam depois (0,03 a 0,08 s). Nada se move em bloco.
7. **Passar do ponto e assentar.** A pose principal passa um pouco do alvo e volta. A animação termina assentada, sem tremer nem ficar flutuando.
8. **Rosto e mãos atuam.** Trocas de mão, boca, sobrancelha e olhos contam a intenção e acompanham o corpo. O personagem pensa, não só se mexe.
9. **Personalidade.** O gesto é deste personagem (o malandro confiante se mexe diferente de um robô). Usa o que o rig oferece de específico.
10. **Emenda e acabamento.** Começa e termina na pose da animação vizinha, sem salto, inclusive peças com física. Nada atravessa, descola ou rasga; trocas de imagem sem piscar errado.

## Veto: arte quebrada

Se em qualquer quadro a arte quebra, a nota final é **no máximo 6**, por melhor que seja o resto. Arte quebrada é o que o jogador vê como defeito:

- membro torcido, achatado ou esticado além do desenho (malha do ombro dobrada com o braço erguido);
- mão, cabeça ou peça que fica gigante ou minúscula sem ser um amassar de propósito;
- peça que descola do corpo, atravessa outra ou some de repente;
- costura aparecendo, imagem trocada errada, triângulo virado;
- articulação em posição impossível: cotovelo ou joelho dobrando para o lado errado (IK que vira), ombro girado além do que o corpo faz;
- recorte à mostra: parte da imagem que na pose base fica escondida atrás de outra (o pedaço do braço cortado atrás do tronco) aparece;
- rosto que se desmonta: olhos, sobrancelhas, focinho, boca ou óculos saindo do lugar em relação à cabeça sem ser troca de expressão.

`query.malha` aponta os instantes de maior torção de malha e `query.recorte` os de borda escondida à mostra (toco do braço sob o ombro, topo da perna sob o quadril), em % da altura; a bancada entrega esses quadros grandes (`folhas/atencao_*`, recorte a partir de 10%). Olhe cada um e decida: recurso (amassar, girar em 3D) ou arte quebrada.

## Exemplos para calibrar

Notas de referência dadas por quem conhece o jogo:

- **8,5:** ganhos do animador da casa num personagem de jogo. Silhueta muda de 30 a 50% da altura, pose forte em 0,2 s, contraste seco, squash por deform, mãos trocam, nada quebra em quadro nenhum.
- **5,5 (veto):** `show` de um agente, 1,45 s. Poses fortes, boa personalidade, emenda limpa; o diretor antigo deu 8,5, mas de 0,6 a 1,0 s o braço erguido torce e a mão do joinha fica gigante. Quem vê o jogo vê isso antes de tudo. (O diretor calibrado, com o veto, deu 6.)
- **4,5 a 5:** a mesma `show` depois de duas revisões (o diretor deu 8,5). Nas palavras de quem avaliou: "o braço direito está fazendo rotação do IK incorreta, numa posição não natural e impossível; o braço esquerdo subiu e expõe parte dele atrás do corpo, mostrando o recorte; no rosto várias coisas quebraram; o movimento é muito rápido, pouco fluido, com poucos micromovimentos". Lição: cotovelo que dobra para o lado errado, recorte de bastidor à mostra e rosto que se desmonta são arte quebrada (veto), e falta de micromovimento derruba fluidez.
- **6,5 a 7:** `5.colar` de um agente. Técnica limpa, emenda certa, mas tímida: silhueta muda uns 9% e o tronco não se compromete.

## Como dar a nota

- Olhe a folha de contato pequena (silhueta), quadros grandes nas batidas (pose, rosto, mãos) e **cada quadro de atenção** (torção medida). Procure arte quebrada antes de pensar em nota: um defeito visível vale mais que dez acertos.
- Para cada critério, diga o que viu e o que falta, com o instante (em segundos) e a parte do corpo.
- Notas de diretor são acionáveis: "aos 0,3 s o braço direito só sobe até o ombro; leve acima da cabeça e estique", não "falta energia".
- Abaixo de 9, liste as 3 mudanças que mais sobem a nota, em ordem.
