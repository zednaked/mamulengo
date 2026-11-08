# Desenhar com o Mamulengo

Guia para o Claude Code criar ilustração (personagem, cenário, objeto, texto na tela) que vai ser rigada e animada. É o par do `docs/ANIMAR.md`: a mesma ideia de estudar, planejar, construir e conferir antes de mostrar, com uma rubrica de nota 9 no fim. Animação boa em desenho fraco continua fraca; desenho bom que não se dobra também.

Duas ferramentas, escolha pela peça:

- **Desenhar** (`draw.*`, docs/EDITOR.md): formas vetoriais editáveis presas a uma parte, com preenchimento chapado, traço (alinhamento, quina, ponta), raio por ponto e furos. Fica editável no editor e vira malha. Use para personagem e objeto que o usuário vai querer mexer depois.
- **SVG gerado por script** (como `exemplos/vt/gerar.ts`, `exemplos/foco/gerar.ts`): o SVG inteiro, com gradientes, filtros e texto, vira PNG (sharp) e entra numa página do atlas. Use para cenário, céu, luz, textura, interface e letreiro: o que pede gradiente e não vai ser redesenhado na mão. Para nitidez, gere no dobro ou triplo do tamanho de tela (`tools/atlas-hd.ts` faz isso a partir do SVG original).

Num gerador (Node, sem o editor), as formas viram a página `<base>-desenhos.png` por `gravarPaginaDesenhos` (server/desenhos.ts), com o mesmo resultado do canvas do editor: o gerador desenha pelos comandos `draw.*` e `draw.text` e grava o `.boneco` pronto.

O Desenhar ainda não tem gradiente, desfoque nem sombra. Sombra e luz nele são formas por cima, com cor sólida ou transparência (sombreamento em células). O que precisa de gradiente vai para o SVG gerado ou para uma camada de ajuste (`efeitos.ajuste`) por cima.

## 1. Estudar antes de desenhar

1. **O pedido em uma frase:** o que a imagem precisa comunicar em 1 segundo de tela. "Um hacker que rouba sem ser visto" pede silhueta encolhida e rosto escondido, não pose de herói.
2. **O mundo que já existe:** paleta, tipografia e regras do projeto (no jogo: o tema, as capturas, o guia de voz). Desenho que ignora a identidade do produto destoa do resto, por bonito que seja.
3. **Referências:** junte de 5 a 10 imagens (estilo, pose, luz, materiais) num arquivo de notas, com o link e o que tirar de cada uma. Copie princípio, nunca o desenho de alguém.
4. **Onde vai aparecer:** o tamanho na tela (personagem a 200 px pede menos detalhe que um close de 900 px), o fundo atrás, o que se mexe e como (vira malha? gira nas juntas? troca de imagem?).

## 2. Planejar como ilustrador

**Silhueta primeiro.** Faça 3 a 5 miniaturas só de mancha preta (ou um polígono por peça) e escolha a que se lê de longe. Personagens da mesma cena precisam ter silhuetas diferentes entre si: alto e fino, baixo e largo, redondo, anguloso. A turma dos monstros funciona porque cada um tem uma forma (quadrado, gota, pera, ciclope de corpo alto, bola peluda).

**Linguagem de formas.** Círculo é amigável e mole; quadrado é estável e forte; triângulo é perigo, velocidade e tensão. Misture com intenção: um vilão tem pontas, um ajudante tem curvas. Varie o tamanho das formas (grande, médio, pequeno), porque tudo do mesmo tamanho fica chato.

**Valor antes de cor.** A imagem tem que funcionar em cinza: o ponto focal com o maior contraste de claro e escuro, o fundo com pouco. Teste em cinza antes de pintar e depois de pintar (seção 4).

**Paleta curta.** De 3 a 5 cores principais, mais 1 de acento, que só aparece no que importa (o botão, o olho, o perigo). Sombra não é preto: é a cor puxada para a cor do ambiente, mais escura e mais saturada. Luz puxa para a cor da fonte de luz.

**Profundidade em camadas.** Fundo, meio e frente. Quanto mais longe, menos contraste, menos saturação, mais a cor do ar (céu, neblina, neon) e menos detalhe. A frente pode ter o contraste máximo, ou sair de foco. Cada camada é uma peça separada (paralaxe e desfoque por camada na câmera).

**Luz de uma direção.** Escolha de onde vem a luz principal e mantenha em tudo: sombra do lado oposto, brilho do lado da luz, luz de recorte (rim) de cor contrastante para destacar o personagem do fundo escuro.

**Leitura e ponto focal.** O olho vai para o maior contraste, a cor de acento, o rosto e o texto. Ponha um só ponto focal por plano e conduza até ele com linhas (perspectiva, braço, olhar).

## 3. Construir pronto para rigar

- **Uma peça por coisa que se mexe:** corpo, cabeça, cada braço (braço e antebraço se dobra), mãos, pernas, olhos, pálpebras, boca (com trocas), sobrancelhas, cabelo e pontas com física. O que não se mexe pode ficar junto.
- **Sobra escondida nas juntas:** cada peça continua por baixo da vizinha (o ombro é uma bola inteira sob o tronco; o topo da perna entra no quadril). Sem essa sobra, a junta abre um buraco ao girar (`query.recorte` mede depois).
- **Ordem pensada:** o que fica atrás (o braço de trás, a bola do ombro) é desenhado como peça de trás. Nos monstros da Kenney, os braços vão atrás do corpo; na frente, a bola do ombro aparece.
- **Pivô no lugar certo:** o centro de giro de cada peça é a junta (ombro, cotovelo, pescoço). Desenhe a peça já sabendo onde fica o osso.
- **Peça fina vira malha em grade**, não pelo contorno automático (corta a arte; ver docs/RIGAR.md).
- **Trocas desenhadas juntas:** olho aberto, meio e fechado; boca nas vogais e nas expressões; mãos em 2 ou 3 poses. É a atuação do rosto e das mãos, e desenhar junto mantém o estilo igual.
- **Traço consistente:** a mesma espessura de traço para peças do mesmo tamanho na tela; mais grosso no contorno de fora que nos detalhes de dentro. Escalar uma peça escala o traço: confira depois de mudar tamanhos.
- **Nitidez:** a imagem precisa de pelo menos 1 pixel de textura por pixel de tela no maior tamanho em que aparece (`hd` 2x ou 3x no Desenhar; SVG gerado em 2x ou 3x).
- **Texto na tela:** fonte do projeto, no mínimo 1/25 da altura do quadro para ler no celular, com contorno ou caixa quando o fundo é movimentado. Balão de fala cresce com o texto e aponta para quem fala.

## 4. Conferir antes de mostrar (obrigatório)

Folha de contato pequena esconde defeito de desenho. Confira grande. `tools/quadro.ts` tira os quadros em segundos, sem abrir o editor: `npx tsx tools/quadro.ts x.boneco --anim a --tempos 0,1.2 --largura 1600` (grande), `--modo cinza` (valores), `--modo silhueta` (forma), `--cada 0.5 --folha 4` (folha de contato), `--rect x,y,w,h` (um detalhe ampliado).

0. **`query.desenho`** (`{screen, scale}`: pixels de tela por unidade e a maior escala em que a peça aparece): mede o que dá sem olho, forma ou traço cortado pela borda da imagem, nitidez no maior tamanho, traço fora do padrão das outras peças, paleta grande e pouco contraste de valor. Zere os avisos antes de olhar.
1. **Grande, 1:1 e 4x nas bordas e juntas** (`look` com zoom, ou foto da bancada). Procure serrilhado, emenda, traço cortado pela caixa da imagem (`draw.fit` com folga), pixel borrado de imagem pequena esticada.
2. **Silhueta:** a imagem toda em preto (todas as cores no mesmo valor) e pequena. Lê o que é? As poses diferem?
3. **Valores:** a imagem em cinza (saturação 0). O ponto focal tem o maior contraste? O personagem se separa do fundo?
4. **No lugar:** no cenário de verdade, no tamanho da tela final, com a câmera, o desfoque e a luz do plano. Personagem que lê no fundo branco do editor some no fundo escuro do jogo.
5. **Rigado num extremo:** gire cada junta até o limite que a animação vai usar e olhe grande. Buraco na junta, malha torcida ou recorte à mostra se corrige no desenho (mais sobra, peça separada), não escondendo na animação.
6. **Ao lado do resto:** junto dos outros personagens e dos objetos da cena. Mesmo traço, mesma luz, mesma paleta, mesma escala de detalhe.

## Rubrica de ilustração

Nota de 0 a 10, 1 ponto por critério (0, 0,5 ou 1). A meta é **9**: nível de um ilustrador profissional num dia bom. Desenho limpo e sem ideia fica em 6 ou 7.

1. **Silhueta.** Lê em miniatura, em preto. Personagens da cena se distinguem só pela forma.
2. **Formas com intenção.** A linguagem de formas conta quem é (mole, forte, perigoso); há variedade de tamanhos.
3. **Valor.** Funciona em cinza; o ponto focal tem o maior contraste; o personagem descola do fundo.
4. **Cor.** Paleta curta e coerente com o projeto; o acento só onde importa; sombra e luz com cor, não preto e branco.
5. **Luz.** Uma direção, mantida em tudo; volume lido (sombra própria, sombra projetada, recorte).
6. **Profundidade.** Fundo, meio e frente separados por contraste, saturação, detalhe e foco.
7. **Acabamento.** Traço consistente, curvas limpas, bordas sem serrilhado, nada cortado pela caixa da imagem, nitidez no maior tamanho.
8. **Pronto para rigar.** Peças separadas, sobra escondida nas juntas, pivôs no lugar, trocas desenhadas; nada abre ao girar até o limite da animação.
9. **Personalidade e história.** O desenho conta quem é e o que quer, por detalhes (roupa gasta, cicatriz, adesivo no deck), sem precisar de texto.
10. **Identidade do produto.** Parece do mesmo mundo que o jogo ou a marca: fonte, paleta, clima, nível de detalhe.

### Veto: desenho quebrado

Com qualquer um destes, a nota máxima é 6: buraco ou emenda numa junta; traço ou peça cortada pela borda da imagem; imagem borrada por falta de pixel; peça desalinhada do vizinho (olho fora do rosto); texto ilegível no tamanho final; estilo de uma peça que não casa com as outras (vetor chapado ao lado de pintura, traço grosso ao lado de fino).

## Lições (dos exemplos)

- **Monstros, em silhueta e em cinza (tools/quadro.ts):** os cinco têm braços e pernas iguais da Kenney, então em silhueta só o corpo os distingue; em cinza o amarelo, o azul e o verde têm quase o mesmo valor. Quem separa a turma é a cor, o que falha em tela pequena e para daltônicos. Um personagem novo da turma precisa de membros com forma própria e de um valor diferente.
- **Monstros (exemplos/monstros):** o contorno automático cortou a perna fina e ninguém viu na folha pequena; os braços da Kenney na frente do corpo mostraram a bola do ombro. Ambos só aparecem grandes, no setup e num extremo.
- **VT "A foto da turma" (exemplos/vt):** o balão de fala pequeno some no celular; a selfie com a turma pequena e espremida não lia como selfie, e de perto, com as pernas escondidas na borda da Polaroid, leu. Pense no enquadramento do desenho, não só no desenho.
