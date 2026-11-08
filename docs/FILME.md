# Filme com o Mamulengo

Guia para o Claude Code produzir um vídeo curto (VT, trailer, vinheta, post) com o Mamulengo: do roteiro à entrega, com a conferência de cada etapa. O desenho segue `docs/DESENHAR.md` e a animação `docs/ANIMAR.md`; aqui fica o que é de filme: câmera, planos, cortes, texto na tela, som e o fluxo inteiro.

## O fluxo

1. **Pedido em uma frase** e o público: o que a pessoa precisa sentir e fazer no fim (jogar, clicar, lembrar o nome). Duração exata (30 s de VT costumam ser 26 a 28 s de cena mais a vinheta).
2. **Referências:** 5 a 8 vídeos do mesmo tipo (trailers do gênero, VTs da marca), anotando estrutura, ritmo de cortes e o fim. Quem pesquisa entrega links conferidos e marca o que não viu. Material do produto (capturas, textos, paleta, fontes, sons) vale mais que referência de fora.
3. **Roteiro em batidas**, com tempos: uma ideia por plano, gancho nos primeiros 2 a 3 s, a virada ou o pico perto de 2/3 e o nome com a chamada nos últimos 4 a 5 s. Escreva o roteiro num arquivo antes de desenhar (o diário do filme) e confira se cabe no tempo lendo em voz alta.
4. **Quadros-chave (animatic):** um quadro por plano, só com manchas e texto, na proporção final. Dá para ver o filme inteiro com `tools/quadro.ts --cada 1 --folha 6` antes de animar qualquer coisa.
5. **Arte** (docs/DESENHAR.md): personagens, cenários por camada (fundo, meio, frente), objetos e letreiros. Assets de fora só com licença lida e anotada (CC0 de preferência; CC-BY com a atribuição nos créditos).
6. **Rig e animação** por gerador reprodutível (`exemplos/vt/gerar.ts` é o modelo): a cena é um `.boneco`, os personagens entram como instâncias.
7. **Câmera, planos e transições** (abaixo).
8. **Conferir** quadros grandes nos momentos de cada plano e a folha do filme inteiro; corrigir; repetir.
9. **Vídeo, som e vinheta:** `tools/quadro.ts --video` (com `--gpu`, mais rápido que o tempo real), `tools/som.ts` (eventos com áudio e trilha) e `tools/vinheta.ts` (abertura e fechamento do Mamulengo; o som do vídeo entra atrasado pela abertura).
10. **Entrega:** o MP4 final, o diário com as dificuldades e o que mudar na ferramenta (ROADMAP).

## Câmera

- `camera.set {width: 1280, height: 720}` cria os ossos `camera` (o que anda) e `camera_tremor` (o que sacode) e marca `skeleton.camera`. O quadro filmado é `width x height` vezes a escala do mundo do osso: escala 0,5 aproxima duas vezes. O que estiver preso à câmera (cortina, flash, legenda, a moldura de um visor) cobre o quadro em qualquer zoom.
- `camera.key {anim, time, x, y, zoom, rotation, curve, cut}`: o centro do quadro, o zoom (2 aproxima duas vezes) e o giro. `cut: true` é um corte seco: o quadro fica parado até o instante e pula.
- `camera.shake {anim, time, duration, strength, frequency, rotation}`: tremor decaindo (aterrissagem, impacto, explosão), por cima das chaves da câmera.
- `tools/quadro.ts` filma pela câmera (posição, zoom e giro); a exportação do editor segue posição e zoom, sem o giro. `--rect` ou `--sem-camera` filmam um retângulo fixo.
- **Profundidade de campo:** ainda à mão, com camadas de ajuste (`efeitos.ajuste.desfoque`) entre os planos de profundidade: tudo que fica atrás de uma camada de ajuste borra junto (a frente desfocada ainda não dá).

## Planos e cortes

- **Um plano por grupo de partes:** cada plano é um grupo de slots (cenário, personagens) ou uma instância de outro `.boneco`. `shot.show {anim, time, show: ["cidade_*"], hide: ["rua_*"]}` corta de um para o outro (chaves em degrau). Instância em slot escondido nem é calculada.
- **Transições:** `shot.transition {anim, time, kind}`: `preto` (escurece até o instante e abre), `branco`, `flash` (branco cheio e some) e `corte_preto` (um quadro preto). A cortina é uma parte presa à câmera, na frente de tudo.
- **Mergulho e zoom num ponto:** chaves de câmera com zoom crescente centradas no ponto (a lente, a tela), cortando para o plano de dentro no pico.
- **Ritmo:** em 30 s cabem de 8 a 14 planos. Plano com texto fica no ar o tempo de ler duas vezes (umas 3 palavras por segundo).

## Texto na tela

- `draw.text` (fonte .ttf do produto, vira formas nítidas) e `draw.balloon` (fala, grito, legenda, com o pop de entrada). Tamanho mínimo: 1/25 da altura do quadro; com contorno ou caixa sobre fundo movimentado.
- Cartela de mecânica: uma linha, verbo forte, no máximo 6 palavras. O nome do produto e a chamada no fim, parados por pelo menos 2 s.

## Som

- Eventos com `audio` (`event.create {name, audio, volume}` e `event.key`) nos instantes que pedem som: passo, impacto, glitch, digitação, o flash. Os das instâncias tocam no tempo delas; instância escondida cala.
- `tools/som.ts x.boneco --anim a --video v.mp4 --musica trilha.ogg --musica-volume 0.5`. `--listar` mostra a trilha para conferir os instantes.
- Música com licença anotada; corte no fim com fade (o padrão) e sem estourar (o limitador já está na mistura).

## Conferir antes de mostrar

1. `tools/quadro.ts x.boneco --anim a --cada 0.5 --folha 6 --gpu`: o filme inteiro numa folha. Cada plano lê? O corte está onde o roteiro diz?
2. Quadros grandes (`--tempos ... --largura 1600`) no primeiro e no último quadro de cada plano, e em todo corte e transição: o quadro antes e o depois. Nada piscando, peça fora do lugar, plano vazado.
3. Texto: legível na largura de um celular (olhe o quadro a 400 px de largura).
4. O vídeo final, do começo ao fim, com som, no player (não só a folha): ritmo, sincronia do som, o fim.
5. Rubrica do filme (meta 9; cada item 1 ponto): gancho em 3 s; uma ideia por plano; ritmo com contraste (planos rápidos e um respiro); câmera com intenção (cada movimento conta algo); continuidade (posição, olhar, objetos de um plano para o outro); arte e animação nas rubricas delas; texto legível e curto; som sincronizado e mixado; identidade do produto; fim com nome e chamada claros.

## Lições de cada passe (o VT do Ciberteia, 2026-11-02: notas 5, 5,5, 6,7)

Regras que valem para qualquer filme, tiradas de quatro versões do mesmo VT:

1. **Estilo definido antes de desenhar.** A versão 1 juntou personagem chapado, cenário de retângulos e interface sem uma regra comum (nota 5). Antes do primeiro quadro: uma bíblia de estilo de uma página (paleta, formas, luz, traço, tipografia, como a câmera se move, o que nunca fazer) e dois ou três quadros de estilo aprovados.
2. **Contar com recursos de cinema, não só mostrar telas.** Interface animada informa, mas não emociona: falta personagem, plano e contraplano, reação, escala. Cada batida do roteiro precisa de um tipo de plano escolhido (geral para situar, médio para a ação, close para a emoção ou o detalhe que importa, plano-detalhe para o objeto) e de um motivo para o corte (ação, olhar, som, contraste).
3. **Diagramação por grade, medida.** Margem segura, padding fixo, texto centrado pela altura das maiúsculas da fonte, tabelas por coluna. Alinhar a olho e por espaços deu títulos cobertos, colunas tortas e margens diferentes (nota 5,5).
4. **Conferir o desenho, não a intenção.** Uma conferência de diagramação que compara as posições pedidas deixou passar um erro de sinal que afundava todo texto. Medir os pixels do quadro.
5. **Olhar em tamanho cheio.** A folha de contato pequena escondeu todos os problemas de alinhamento; os quadros em 1920 mostraram.
6. **Montagem: cortar na batida, ir perto.** Planos de 4 a 5 s com um empurrão lento arrastam; texto de 24 px não lê no celular. Closes cortados na música (o número subindo, a barra caindo, o nome) dão ritmo e leitura.
7. **Gancho e fecho que se respondem.** O tubo que acende no começo e apaga no fim amarra o filme.
8. **Tom é decisão do cliente.** "Mais sério" mudou texto, glitch, ritmo e trilha juntos: o tom é um conjunto de escolhas, não um ajuste.

## Lições

- **VT dos monstros (exemplos/vt):** sem câmera nem planos, cada plano ligava pela transparência e o mergulho era uma conta de zoom à mão; a selfie pequena não lia como selfie (de perto, com as pernas escondidas pela borda, leu); a câmera trocando de mão precisava de um objeto preso à mão de outra instância (hoje `follow`); exportar 26 s levava minutos (hoje 24 s com `--gpu`).
