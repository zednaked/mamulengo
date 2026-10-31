# Núcleo do Mamulengo (especificação de cálculo)

O núcleo calcula a pose de um `.boneco` (docs/FORMATO.md) num instante: a matriz de cada
osso, a parte e a cor de cada slot, a ordem de desenho e os vértices de cada parte visível.
Um código só, em C++17 sem dependências, em `nucleo/`: vira wasm no editor e módulo no
Godot.

É escrito a partir deste documento e conferido contra um oráculo (`tools/oraculo.ts`), que
dá os números do runtime que os jogos usam hoje. Quem escreve o núcleo não lê o código desse
runtime; lê este documento e compara números. Onde este
texto e o oráculo discordarem, o oráculo manda e o texto é corrigido.

## Contrato da ferramenta de teste

```sh
nucleo/build/nucleo-pose <x.boneco> <animacao|-> <t1,t2,...>
```

Escreve em stdout o mesmo JSON do oráculo:

```jsonc
{ "quadros": [ { "t": 0.5,
    "ossos": { "<nome>": [a, b, c, d, x, y] },          // matriz de mundo (y para cima)
    "slots": [ { "nome", "parte": "<nome>|null", "cor": [r, g, b, a] } ],  // na ordem de desenho
    "vertices": { "<slot>": [x0, y0, ...] } } ] }        // região e malha visíveis
```

`-` é a pose de setup. Conferência: `npx tsx tools/nucleo-compara.ts <arquivos ou pastas>`,
com tolerância de 0,01 px em ossos e vértices, 1e-4 na matriz, 1/255 na cor e igualdade nas
partes e na ordem.

Com trilhas, fila e mix (seção "Estado"), a ferramenta é outra:

```sh
nucleo/build/nucleo-estado <x.boneco> <roteiro.json>
npx tsx tools/nucleo-estado.ts <arquivos ou pastas> [--mix 0.2] [--roteiro r.json] [--detalhe]
```

O roteiro é `{ "quadros": N, "passo": 1/60, "mix": {padrao, pares}?, "acoes": [ {"quadro", "tipo",
"trilha"?, "animacao"?, "loop"?, "atraso"?, "mix"?, "valor"?, "slot"?, "cor"?} ] }`, com os tipos
`tocar`, `enfileirar`, `vazio`, `enfileirar_vazio`, `limpar`, `limpar_trilha`, `escala_tempo`
(antes do passo do quadro) e `cor`, `esconder` (o jogo mexendo no slot depois do aplicar). A saída
tem a pose de cada quadro (o mesmo formato, com `"q"` no lugar de `"t"`) e `"eventos"`, cada um
com `quadro`, `tipo` (`inicio`, `interrompida`, `completa`, `fim`, `usuario`), `trilha`,
`animacao` (`null` para a vazia) e, nos de usuário, `nome`, `tempo`, `inteiro`, `decimal`,
`texto`, `volume` e `balanco`. O comparador gera os roteiros padrão de cada `.boneco` (loop por
3 voltas e meia, A sem loop com B enfileirada em loop, A cortada no meio por B, A e depois vazio,
fila com atraso, slot mudado pelo jogo; com `--mix`, o mix padrão trocado e um corte no meio de
um mix) e exige, além das tolerâncias da pose em todos os quadros, a mesma lista de eventos
(quadro, tipo, trilha, animação, valores).

## Relógio

Cada instante pedido é calculado do zero (como um personagem novo no jogo): pose de setup,
física reiniciada, e o tempo avança de 0 até `t` em passos de 1/64 s, mais um passo final com
o resto. Em cada passo: aplica a animação no tempo acumulado, avança o relógio do esqueleto e
recalcula o mundo. Sem física, um passo só até `t` dá o mesmo resultado.

A animação toca em loop: o tempo dentro dela é `t mod duração` (a duração é o maior tempo de
chave de qualquer timeline).

**Relógio em float32** (opção, desligada: `Esqueleto::relogio_float` e `Estado::relogio_float`).
O oráculo soma o tempo em `double`. Um runtime que guarda o tempo em `float` dá o passo da
física em outro quadro quando a soma dos `dt` cruza o passo por um arredondamento: num
personagem com dezenas de físicas de rotação, depois de alguns segundos a 60 quadros por
segundo, um passo um quadro antes já leva as pontas a dezenas de px. Com a opção, cada conta de relógio é arredondada a `float`:
o relógio do esqueleto, o `dt` e a `sobra` da física e o próprio passo; no Estado, o `dt` com a
escala, o `tempo`, o `atraso` e o `mix_tempo` de cada entrada. As contas da pose continuam em
`double`. O nó do Godot liga isso com `float_clock` (para ficar igual a um jogo que usava esse
runtime); a conferência contra o oráculo é sem a opção.

## Pose local

Cada osso tem no setup `x`, `y`, `rotacao`, `escala_x`, `escala_y`, `cisalha_x`,
`cisalha_y` (padrões 0, 0, 0, 1, 1, 0, 0). As timelines da animação, no tempo dela:

- `girar`: soma o valor ao setup (graus);
- `mover` (e `mover_x`, `mover_y`): soma ao setup;
- `escalar`: multiplica o setup (`x` e `y` da chave, padrão 1);
- `cisalhar`: soma ao setup;
- osso sem timeline fica no setup.

Antes da primeira chave vale o setup; depois da última, o valor da última.

## Curvas

Entre duas chaves, o valor sai da curva da primeira:
- sem `curva`: linear;
- `"degrau"`: fica no valor da primeira até a segunda;
- bezier: 4 números por canal `[cx1, cy1, cx2, cy2]` (tempo e valor absolutos dos dois
  pontos de controle); a curva vai de (tempo1, valor1) a (tempo2, valor2). Para o instante
  `t`, acha o parâmetro em que o tempo da curva vale `t` e devolve o valor da curva nesse
  parâmetro. Timeline com dois canais (`x`, `y`) tem 8 números, um grupo por canal.

O runtime de referência aproxima a bezier por segmentos de reta; o núcleo pode resolver
exato, desde que a diferença medida fique dentro da tolerância (anotar a medida aqui).

## Mundo

Matriz local de um osso, com `r` = rotação, `sx`, `sy` = escala, `hx`, `hy` = cisalha (graus):

```
a = cos(r + hx) * sx      b = cos(r + 90 + hy) * sy
c = sin(r + hx) * sx      d = sin(r + 90 + hy) * sy
```

Osso raiz: mundo = local, com a posição `(x, y)`. Filho: `mundo = pai ⊗ local`, isto é
`a = pa*la + pb*lc`, `b = pa*lb + pb*ld`, `c = pc*la + pd*lc`, `d = pc*lb + pd*ld`,
`x = pa*lx + pb*ly + px`, `y = pc*lx + pd*ly + py`. Contas em `double`.

`heranca` `noScale` e `noScaleOrReflection` (a mão do zumbi e o braço do monstro2 CC0): a
posição segue o pai como no normal; o eixo x do osso é a direção que a rotação local `r` tem
no mundo do pai, `(pa*cos r + pb*sin r, pc*cos r + pd*sin r)` normalizada, e o eixo y é o
perpendicular (+90 graus), invertido em `noScale` quando o pai espelha (`pa*pd - pb*pc < 0`).
A escala e a cisalha locais entram por cima desses dois eixos, como na matriz local sem a
rotação. Conferido contra o oráculo nos dois personagens (todas as animações e emendas). As
outras heranças e a timeline `heranca`: fora do v0 (nenhum asset medido usa).

## Ordem de atualização

Ossos em ordem de hierarquia (pai antes de filho). Cada restrição roda na ordem do campo
`ordem` (ou na ordem da lista): depois que estão prontos o seu alvo e os pais dos ossos que
ela controla. Depois dela, os ossos controlados e todos os descendentes são recalculados.
Restrição com `skin` só vale se a skin estiver ativa.

O recálculo parte da pose local de cada osso, então o que uma restrição faz tem de estar
nela. IK e transformação com `alvo_local` já mexem na pose local; física, caminho e
transformação no mundo mexem no mundo, e depois o mundo de cada osso controlado volta para a
pose local (rotação, escala e cisalha em y, cisalha em x zero; a escala em y é o comprimento
do eixo y, com o sinal do determinante). Sem isso, uma restrição num ancestral que viesse
depois na ordem desfazia a anterior: medido com a física da cabeça antes do IK do tronco
(3,2°), e com caminho e transformação no mundo antes do IK do pai (até 440 px). Casos em
`tests/nucleo/ordem-restricoes`. Na herança diferente da normal, só a rotação da física vai
para a pose local (nenhum personagem medido junta as duas coisas).

## Slots

No setup, cada slot mostra a `parte` do setup (ou nenhuma) com a `cor` do setup (hex
`rrggbbaa`, padrão branco opaco). Timelines:
- `parte`: troca para a parte da última chave já passada (`nome` nulo esconde); antes da
  primeira chave, a do setup;
- `rgba`, `rgb`, `alfa`: interpolam a cor com as curvas acima.

`ordem_desenho`: cada chave lista deslocamentos `{slot, deslocamento}` a partir da ordem do
setup; vale a última chave já passada.

## Partes e vértices

**Região:** um retângulo de `largura` x `altura` centrado em `(x, y)` do osso do slot,
girado por `rotacao` e escalado por `escala_x`, `escala_y`. Se a imagem no atlas foi cortada
(`corte` em `imagens`), o retângulo é só a parte que tem pixels, na posição dela dentro do
original. Os 4 vértices vão para o mundo pela matriz do osso. A ordem dos cantos é a do
oráculo (conferir e anotar aqui).

**Malha sem pesos:** `vertices` em coordenadas do osso do slot, levados ao mundo pela
matriz dele. **Com pesos:** cada vértice é a soma, para cada `[osso, x, y, peso]`, de
`peso * (mundo do osso aplicado a (x, y))`.

**Deformar:** a timeline `deformar` de uma malha (por skin, slot e parte) soma deslocamentos
aos vértices do setup antes de ir ao mundo: sem pesos, em coordenadas do osso; com pesos, um
deslocamento por entrada de peso, somado ao `(x, y)` dela. A chave traz `deslocamento`
(índice do primeiro valor) e os `vertices` a partir dali; os demais são zero. Interpola
entre chaves com a curva.

## Restrições

**IK:** um ou dois ossos tentam alcançar o osso alvo.
- Um osso: gira para apontar o alvo, misturado por `mix`. Com `comprime`/`estica`, a escala
  ao longo do osso muda para encostar no alvo (`uniforme`: as duas escalas).
- Dois ossos (pai e filho): acha os ângulos pelo triângulo (lei dos cossenos) com os
  comprimentos efetivos (comprimento x escala), dobrando para o lado de `dobra_positiva`.
  Alvo fora de alcance: estica a cadeia em linha. `suavidade`: perto do alcance máximo, a
  distância usada cresce suavemente em vez de travar.
- O resultado vira a pose local dos ossos, misturada com a anterior por `mix`.

**Física** (sentido do jogo: y para cima, a gravidade já com o sinal do jogo): cada restrição
acompanha um osso. Guarda a posição (e, conforme os campos, rotação, escala, cisalha) que o
osso teria e a deixa atrasar como uma massa presa por uma mola:
- `inercia`: quanto do movimento do osso pai a massa herda;
- `forca`: rigidez da mola que puxa de volta para a pose;
- `amortecimento`: perda de velocidade por segundo;
- `massa`: divide as forças;
- `vento` e `gravidade`: forças constantes (eixo x e eixo y);
- `limite`: velocidade máxima;
- `passo`: a física integra em passos fixos de `1 / passo` segundos (padrão 60),
  acumulando o tempo do relógio do esqueleto;
- `mix`: mistura o resultado com a pose sem física.
Reinicia na pose de setup no instante 0. É a parte mais sensível ao detalhe da conta:
ajustar contra o oráculo e anotar aqui o que for descoberto.

**Caminho:** os ossos são distribuídos ao longo da curva bezier da parte `caminho` do slot
alvo. `posicao` (fixa em px, ou percentual do comprimento), `espacamento` (comprimento,
fixo, percentual ou proporcional), `modo_girar` (`tangent`: o osso gira para a tangente;
`chain`: aponta para o próximo). `velocidade_constante`: a posição corre pelo comprimento
(`comprimentos` acumulados), não pelo parâmetro da curva. `fechado`: a curva volta ao
começo. Misturado por `mix_girar`, `mix_x`, `mix_y`.

**Transformação:** os ossos copiam (com deslocamento e escala por propriedade) a rotação,
posição, escala ou cisalha do osso fonte, em mundo ou local (`fonte_local`, `alvo_local`),
somando (`somar`) ou substituindo, com `limitar`. Fora do marco 1 se nenhum asset dele usar.

Os campos do topo da restrição (`rotacao`, `x`, `y`, `escala_x`, `escala_y`, `cisalha_y`) são
deslocamentos **da fonte**, medidos no oráculo com um osso fonte e um alvo:
- somam no valor que a fonte entrega, antes do deslocamento e da escala de cada propriedade;
  valem só para a propriedade de mesmo nome da fonte (o `x` do topo não mexe numa fonte
  `girar` que vai para `x`);
- em mundo, `x` e `y` são um ponto no espaço da fonte: o valor de `x` é
  `x + a·dx + b·dy` e o de `y`, `y + c·dx + d·dy` (gira e escala com ela); em `fonte_local`,
  somam direto;
- a rotação de mundo com o deslocamento volta a [0, 360); com a fonte espelhada (determinante
  da matriz de mundo negativo) o deslocamento de rotação entra com o sinal trocado.

Conferido em casos gerados (`tools/nucleo-fixtures.ts`, `transformacao/`): 144 dirigidos (um
deslocamento por vez, para cada propriedade do alvo, em mundo, fonte local, alvo local e
somando), todos iguais. Nos 200 aleatórios (várias propriedades, escala e deslocamento por
alvo, limites, mixes, fonte que fica espelhada na animação), 183 iguais; os 17 que diferem já
diferem sem os deslocamentos do topo (18 sem eles): são combinações de `limitar`, `somar` e
escala que a conta acima ainda não cobre (em aberto). Um asset privado com a fonte em mundo
girando e movendo outro osso diferia centenas de px antes e agora bate em todas as animações.

## Desenho

`mamulengo/desenho.h`: a lista do que vai para a placa de vídeo, na ordem de desenho. Cada
região e malha visível entra com os vértices em mundo, a uv na página e a cor (slot vezes
parte). Os trechos seguidos com a mesma página e o mesmo blend viram um lote só. O recorte
vira dois comandos: o polígono, que o desenhista marca no stencil como leque com inversão
(serve para polígono côncavo), e o fim.

- **uv da página:** a imagem tem `ret` (posição e tamanho com pixels, na orientação
  original), `girada` (graus no atlas) e `corte` (deslocamento a partir do canto de baixo
  e da esquerda, e tamanho original). Na região, os 4 cantos são o retângulo com pixels.
  Na malha, as uvs do arquivo vão de 0 a 1 sobre a imagem original, com v para baixo.
  A malha ligada usa a geometria e as uvs da fonte com a imagem dela mesma.
- **Recorte:** vale do slot seguinte até o slot `fim`, inclusive. Quando o `fim` é o próprio
  slot do recorte, vale até o fim do desenho.
- **Blend** (cor pré-multiplicada na saída): normal `1, 1-a`; aditivo `1, 1`; multiplica
  `destino, 1-a`, que dá `destino x mix(1, cor, alfa)`; multiplica do motor `destino, 0`,
  sem o alfa; tela `1, 1-cor`.

As fórmulas da uv girada e do fim do recorte vieram do conhecimento geral de atlas, não de
medida. Foram conferidas no palco (`palco.html`): os 20 personagens desenhados pelo núcleo
e pela referência (spine-webgl) diferem só nas bordas, de 0 a 1,1% dos pixels acima de
8/255. Isso inclui personagens com caminho e recorte, com recorte convexo, com multiply e
com imagens giradas e cortadas no atlas.

O palco: `npm run dev` e `/palco.html` (os `.boneco` das raízes do editor). O wasm:
`emcmake cmake -S nucleo -B nucleo/build-web -G Ninja && cmake --build nucleo/build-web --target nucleo`
(244 KB).

## Efeitos

O primeiro recurso que o Spine não tem. Cada slot pode ter seis efeitos, todos desligados
por padrão, com valores de setup (`efeitos` no slot) e animáveis (`efeitos` na animação, por
slot). A exportação para o Spine tira os efeitos e avisa.

| efeito | campos (padrão) | ligado quando |
|---|---|---|
| `linha` (contorno) | `cor` (`ffffffff`), `largura` (0, em pixels da textura) | `largura > 0` e alfa da cor > 0 |
| `brilho` (halo) | `cor` (`ffffffff`), `forca` (0), `raio` (8, em pixels da textura) | `forca > 0` e alfa da cor > 0 |
| `dissolver` | `valor` (0 a 1), `cor` da borda (`ff8000ff`), `borda` (0,05), `grao` (8: o tamanho dos pedaços, em pixels da textura) | `valor > 0` |
| `tingir` | `cor` (`ffffffff`), `forca` (0 a 1) | `forca > 0` e alfa da cor > 0 |
| `borrar` (smear) | `forca` (0, em segundos de movimento), `limite` (60, em pixels do mundo), `esmaecer` (0,5, de 0 a 1) | `forca > 0` e `limite > 0` |
| `rastro` (ghosting) | `copias` (0; até 16, a parte inteira), `intervalo` (0,05 s), `alfa` (0,5, de 0 a 1) | `copias >= 1`, `intervalo > 0` e `alfa > 0` |

**Timelines.** `animacoes.<a>.efeitos.<slot>.<efeito>`: chaves com `tempo`, os campos do
efeito e `curva` (como no `rgba`: `"degrau"` ou 4 números por canal). Os canais, na ordem da
curva: linha `r g b a largura`; brilho `r g b a forca raio`; dissolver `valor r g b a borda grao`;
tingir `r g b a forca`; borrar `forca limite esmaecer`; rastro `copias intervalo alfa`. Campo que falta na chave vale o da chave anterior (na primeira, o do
setup): uma chave pode mudar só a `forca`. A mistura com o que já está
na pose é a da cor (Estado, "Mistura"). Cores ficam entre 0 e 1; `valor` e `borda` entre 0 e
1; `largura`, `raio`, as `forca`, `limite`, `copias` e `intervalo` a partir de 0; `grao` a partir de 1;
`esmaecer` e `alfa` entre 0 e 1. São 29 canais: os 23 primeiros (linha, brilho, dissolver, tingir)
são os de shader, que o desenhista recebe por lote; os 6 do borrar e do rastro só mexem na
geometria e não mudam o lote.

**No desenho.** Um slot com algum efeito ligado sai num lote só dele, com os valores dos
efeitos e a caixa da imagem na página (uv mínima e máxima). Uma região com linha ou brilho
cresce para fora (os quatro cantos, em posição e uv) pela margem `max(largura, raio)` dos
ligados, em pixels da textura, para o halo ter onde aparecer. A malha cresce pelo contorno
(os `contorno` primeiros vértices, em ordem): cada um anda para fora pela normal média das duas
arestas vizinhas (no espaço da textura), a margem em pixels da textura; a uv anda junto e a
posição anda pela transformação local textura para mundo dada pelos dois vizinhos. Sem
`contorno`, a malha não cresce (o efeito fica dentro dela). O desenhista amostra a textura só dentro da caixa (fora dela, transparente),
então a margem não mostra a imagem vizinha do atlas. Por fragmento, com `T(uv)` a textura (pma
desfeito; fora da caixa, 0), `px` o tamanho de um pixel da página e `cv` a cor do vértice:

1. `C = T(uv) * cv`; tingir: `C.rgb = mix(C.rgb, tingir.rgb, forca * tingir.a)`.
2. linha: `A = max` do alfa de `T` a `largura`, `2 largura / 3` e `largura / 3` em 24
   direções (com 16 direções e duas distâncias, um canto vivo de linha larga saía em degraus);
   camada `L = (linha.rgb, linha.a * A)`.
3. brilho: `B = max` de `alfa(T) * (1 - (i - 1) / 6)²` a `raio * i / 6`, `i` de 1 a 6, em 16
   direções (nos anéis pares, giradas meio passo); camada
   `H = (brilho.rgb, min(1, brilho.a * forca * B))`. Uma borda que cai com a distância (a
   média das amostras mostrava cópias deslocadas da imagem).
4. `F = C sobre (L sobre H)`, com o alfa de `L` e `H` vezes `cv.a` (o slot apagando apaga o
   halo junto).
5. dissolver: `n` é um ruído de valor em células de `grao` pixels da página (hash inteiro dos
   cantos da célula e interpolação suave); `n < valor` some; `n < valor + borda` pinta
   `F.rgb = mix(F.rgb, dissolver.rgb, dissolver.a)`.

**Leituras que não mudam o resultado ficam de fora** (o mesmo pixel, conferido pixel a pixel no
editor e no Godot): num pixel com `C.a = 1` a linha e o halo ficam por baixo e `F = C`, então nem
são calculados; o brilho percorre os anéis de perto para longe e para quando `B` já alcança o peso
do anel (nenhum anel seguinte, de peso menor, passa dele); a linha para quando `A` chega a 1. Na
vitrine, isso tira de 2 a 3,4 vezes as leituras de textura por pixel (brilho de raio 48: de 97 para
44; linha de 10,5: de 73 para 22), o que conta no celular, em que a GPU é o gargalo
(docs/CELULAR.md).

O hash do ruído: `x = i * 1664525 + j * 1013904223` (inteiros de 32 bits sem sinal), depois
`x ^= x >> 16; x *= 0x7feb352d; x ^= x >> 15; x *= 0x846ca68b; x ^= x >> 16`, e
`x / (2^32 - 1)`. Com inteiros, o mesmo padrão sai igual na web e no Godot, inclusive em placa
de celular com float de meia precisão.

Conferência: `npx tsx tools/nucleo-efeitos.ts` calcula os canais das timelines de
`tests/nucleo/efeitos/efeitos.boneco` (o robô CC0 com os quatro efeitos) por conta própria e
compara com o núcleo. O desenho foi olhado no editor (modo núcleo) e no Godot 4.7.2
(Compatibility): os mesmos quatro efeitos, iguais nos dois.

### Borrar

O smear dos desenhos animados: quando a imagem anda rápido, a traseira dela estica para trás,
na direção de onde veio, e fica mais transparente; parada, volta ao normal sozinha. Não usa
shader nem desenha mais nada: só move os vértices da peça (região ou malha) e baixa o alfa
deles, então custa quase nada na GPU.

**Memória.** A cada `atualizar_mundo`, um slot com borrar ligado guarda os vértices em mundo
(com deformar) e o relógio do esqueleto. Quando o relógio andou desde a última vez, os
guardados viram os anteriores (`A`, no relógio `t0`); vários `atualizar_mundo` no mesmo relógio
só trocam os atuais. Relógio que volta, `setup` ou borrar desligado apagam a memória: só há
anterior se o borrar já estava ligado no quadro anterior.

**A conta**, no desenho, com `P` os vértices agora (relógio `t1`), `n` vértices:

1. Nada se não há anterior, se o número de vértices mudou (troca de imagem), ou se
   `dt = t1 - t0` não está em (0; 0,25] s (parado ou um salto).
2. Por vértice, `D = (P - A) / dt * forca`; se `|D| > limite`, `D` encolhe para `limite`.
3. `M` é a soma dos `D` (o sentido do movimento); nada se `|M| < 1e-9`. `u = M / |M|`, `c` o
   centro (média dos `P`), `s = -(P - c) · u` o quanto o vértice está para trás e `S` o maior
   `s`; nada se `S <= 0`.
4. `w = clamp(s / S, 0, 1)`: 0 do centro para a frente, 1 no vértice mais atrás.
   `P' = P - w D` e o alfa do vértice vezes `1 - esmaecer * w * min(1, |D| / limite)`.

Com `forca` 0,05 a traseira fica onde estava 50 ms antes, o rastro de uns três quadros a 60
fps. Como o anterior vem do quadro de verdade, o borrar segue o que o jogo faz (mix, fila,
física, o jogo movendo ossos), não só a animação.

Conferência do borrar: `npx tsx tools/nucleo-borrar.ts` refaz a conta pela especificação, com os
vértices do `nucleo-pose` no instante e no passo anterior dele, em
`tests/nucleo/borrar/borrar.boneco` (o robô CC0 com um balanço rápido, malha e regiões, um
borrar animado e um que liga no meio), e compara com os vértices esticados e o alfa que o
núcleo desenha.

### Rastro

Cópias da peça nos quadros anteriores, desenhadas por trás dela e mais fracas quanto mais
antigas: o rastro de um golpe, de um pulo, de uma peça que gira. Usa a mesma imagem, o mesmo
lote e o mesmo recorte da peça; cada cópia é só mais geometria.

**Memória.** A cada `atualizar_mundo`, um slot com rastro ligado guarda os vértices em mundo
(com deformar) e o relógio. Relógio novo acrescenta um quadro; o mesmo relógio troca o último;
relógio que volta, `setup` ou rastro desligado apagam tudo. Depois de guardar, fica só o que as
cópias podem pedir: o quadro mais novo com relógio até `agora - copias * intervalo` e os
seguintes (com os canais daquele quadro: diminuir as cópias descarta, e voltar a aumentar não
traz de volta).

**As cópias**, no desenho, com `c` a parte inteira de `copias` (até 16) e `agora` o relógio do
último quadro guardado: nada se há menos de dois quadros. Para `k` de `c` até 1 (da mais antiga
para a mais nova), a cópia `k` usa o quadro guardado mais novo com relógio até
`agora - k * intervalo` (com folga de `1e-9`); sem quadro, ou com outra quantidade de vértices
(troca de imagem), ela não sai. O alfa da cópia é o da peça vezes `alfa * (c - k + 1) / c`. Elas
vão antes da peça, sem os efeitos de shader e sem o borrar (que são da peça).

Conferência do rastro: `npx tsx tools/nucleo-rastro.ts` refaz a memória passo a passo e as
cópias pela especificação, com os vértices e os canais do `nucleo-pose` em cada passo, em
`tests/nucleo/rastro/rastro.boneco` (o robô CC0 com o mesmo balanço do borrar, rastro numa malha
e em regiões, um que liga no meio e um que diminui as cópias e volta a aumentar), e compara com
as cópias que o núcleo desenha.

## Luzes

O terceiro recurso além do Spine: luz dinâmica 2D sem o artista pintar nada. Cada página do
atlas pode ter um **relevo** (um mapa de normais ao lado dela, `paginas[i].relevo`), que
`tools/relevo.ts` calcula da própria imagem; as **luzes** (`luzes` no topo) são pontos presos a
ossos, e a **ambiente** (`ambiente`) é a luz que chega em tudo. A exportação para o Spine tira
luzes, ambiente e relevo, com aviso.

| campo | padrão | o quê |
|---|---|---|
| `nome`, `osso` | (obrigatório), a raiz | `x`, `y` (0) é o ponto no osso |
| `cor` | `ffffffff` | a cor da luz (o alfa multiplica a força) |
| `forca` | 1 | quanto ela soma (a partir de 0) |
| `raio` | 300 | em pixels do mundo: a luz some nessa distância no plano (a partir de 0) |
| `altura` | 80 | acima do plano; baixa ilumina rasante, negativa vira contraluz |
| `profundidade` | 0 | a camada da luz, em px (positiva para perto de quem assiste) |

**Camadas.** Cada slot tem `profundidade` (0; px, positiva para perto de quem assiste), a camada
dele para a luz; numa instância, a do slot dela soma na de todos os slots do filho (e nas luzes
do filho). Uma luz atrás do personagem ilumina mais o que está no fundo que o personagem, e, para
ele, vira contraluz. Com tudo em 0, a conta é a de antes.

A ambiente tem `cor` (`ffffffff`) e `forca` (1); o padrão não muda nada. Animáveis:
`animacoes.<a>.luzes.<nome>` (canais `r g b a forca raio altura profundidade`) e `animacoes.<a>.ambiente`
(`r g b a forca`), com chaves como as dos efeitos (o campo que falta vale o da chave anterior; a
mistura é a da cor). Limites: cor de 0 a 1, força e raio a partir de 0.

**O relevo** (`tools/relevo.ts`). Para cada imagem das partes das skins (fora dos slots aditivo e
tela, que são luz): a altura sobe da borda da **silhueta do personagem montado** (o padrão): as
partes da pose de montagem (os ossos pelo `nucleo-pose`; regiões e malhas com pesos) postas no
mundo, a união dos pontos opacos delas (cada célula do mundo lê a textura no ponto dela, sem
furos) e, para cada texel de cada parte, a distância no mundo até a borda dessa união, em texels
(dividida pelo tamanho do texel ali). Onde as peças se juntam (punho e mão, pescoço e corpo) a
superfície continua, sem vinco; as trocas de imagem de um slot usam o lugar que teriam nele, e a
média vale para a mesma imagem em dois lugares (o braço dos dois lados). Texels que nenhum
triângulo cobre pegam a média dos vizinhos. Imagem fora de slot, girada ou cortada no atlas (e o
`--modo peca`) usa a borda dela mesma: a distância euclidiana até o transparente (alfa < 128).
Nos dois casos, o perfil de almofada é `sqrt(1 - (1 - t)^2)` com `t = min(d / borda, 1)`,
vezes `profundidade`, mais `detalhe * luminancia * 0,25`, tudo vezes `borda` pixels; suaviza e
a normal é `normalize(-dh/dx, dh/dy, 1)` (o y da imagem desce, o do relevo sobe), em RGB
`n * 0,5 + 0,5` (a suavização é 5 x 5 pela silhueta, 3 x 3 pela peça). Fora das imagens, plano. Padrões: borda 12, profundidade 1,
detalhe 0,2 (numa página 2x ou 3x, a borda vezes isso).

**No desenho.** Um personagem monta um grupo de luz se alguma página tem relevo e a luz muda
alguma coisa (alguma luz acesa ou a ambiente diferente de branco inteiro): a ambiente
`cor * alfa * forca` e as luzes acesas (força, raio e alfa maiores que 0), na ordem do arquivo,
até 8, cada uma com a posição em mundo (o ponto pela matriz do osso), a altura, `cor * alfa *
forca`, o raio e a profundidade. Um lote de página com relevo e blend que não é aditivo nem tela
aponta para o grupo (lotes com e sem luz não se juntam) e leva a profundidade do slot (lotes de
camadas diferentes não se juntam). Por fragmento, com `n` o relevo, `p` o ponto em mundo
e `uv` a textura:

1. a normal vai para o mundo pelas derivadas de tela: `J` leva `(du, dv)` a `(dx, dy)` (de
   `dFdx` e `dFdy` de `p` e `uv`), e `N = normalize(n.x * Ju - n.y * Jv, n.z)` com `Ju`, `Jv` as
   colunas de `J` normalizadas (o y do relevo sobe e o v da textura desce). Vale para peça
   girada, espelhada ou deformada por malha, sem dado por vértice; com `J` degenerado, `N = (0, 0, 1)`;
2. com `dz = luz.profundidade - lote.profundidade`: `L = (luz.xy - p, altura + dz)`, atenuação
   `a = clamp(1 - |(L.xy, dz)| / raio, 0, 1)`;
3. a cor da imagem (depois do tingir, antes da linha e do halo) vezes
   `ambiente + soma(cor * max(N . normalize(L), 0) * a^2)`.

Conferência: `npx tsx tools/nucleo-luzes.ts` calcula os canais das luzes e da ambiente pelas
timelines, põe cada luz em mundo pela matriz do osso (a do `nucleo-pose`) e compara com o grupo
que o desenho do núcleo monta, em `tests/nucleo/luzes/luzes.boneco` (o robô CC0 com relevo,
quatro luzes, uma apagada, uma contraluz numa camada atrás com a profundidade animada, um slot
numa camada e a ambiente animada). O desenho foi olhado no editor
e no Godot 4.7.2 (Compatibility), com o mesmo resultado.

## Partículas

O segundo recurso além do Spine: emissores de imagens pequenas (brilhos, moedas, faíscas) que
nascem de um osso e vivem no espaço do esqueleto. Ficam numa lista própria, `particulas`, fora
das skins (um tipo de parte novo quebraria o leitor do Spine); a exportação para o Spine os
tira e avisa.

| campo | padrão | o quê |
|---|---|---|
| `nome`, `slot`, `imagem` | (obrigatórios) | o slot dá o lugar na ordem de desenho (logo depois da parte dele), a cor e o blend; `imagem` é um nome de `imagens` |
| `osso` | o osso do slot | de onde nascem; `x`, `y` (0) é o ponto no osso |
| `taxa` | 10 | partículas por segundo (animável) |
| `vida` | `[1, 1]` | segundos, sorteado entre os dois |
| `velocidade` | `[100, 100]` | px/s, sorteada |
| `angulo`, `abertura` | 90, 30 | direção em graus no espaço do osso (0 = eixo x do osso) e a abertura total do leque |
| `gravidade` | 0 | px/s² para baixo (y negativo) |
| `arrasto` | 0 | por segundo: `v *= exp(-arrasto * dt)` |
| `escala` | `[1, 1]` | no nascimento e no fim da vida |
| `giro` | `[0, 0]` | graus/s, sorteado |
| `cor` | `["ffffffff", "ffffff00"]` | dois ou mais tons, espalhados por igual pela vida (o primeiro no nascimento, o último no fim); some no fim, por padrão |
| `blend` | o do slot | `normal`, `aditivo`, `multiplica`, `tela`: o do emissor (fogo e brilho somam luz sem mudar a camada) |
| `onda` | `[0, 0]` | balanço lateral do desenho: amplitude em px e frequência em Hz, com fase sorteada por partícula (a chama treme) |
| `maximo` | 200 | vivas ao mesmo tempo (as que passam não nascem) |
| `semente` | 0 | muda o sorteio |

**Timelines:** `animacoes.<a>.particulas.<emissor>.taxa` (chaves com `valor`, curvas como as
outras) e `.rajada` (chaves com `quantidade`: nascem de uma vez quando o tempo passa pela
chave). A `taxa` mistura como a cor; a rajada vale só da animação que está entrando ou tocando
(não da que sai num mix).

**Simulação** (no fim do `atualizar_mundo`, pelo relógio do esqueleto, como a física; o setup
zera tudo). Com `dt` o tempo desde a última vez:
1. cada partícula envelhece `dt`; a que passou da vida some;
2. `v *= exp(-arrasto * dt)`, `v.y -= gravidade * dt`, `pos += v * dt`, `rot += giro * dt`;
3. nascem `floor(acumulado)` partículas, com `acumulado += taxa * dt` (e o que sobra fica), mais
   as rajadas. A `k`-ésima do emissor (contando desde o setup) nasce no ponto do osso, com idade
   0, direção `angulo + (s - 0,5) * abertura` levada ao mundo pela matriz do osso (só a direção),
   e vida, velocidade e giro interpolados pelos sorteios `s`.

O sorteio `s` de cada campo (`c` = 0 vida, 1 velocidade, 2 direção, 3 giro) é o hash dos efeitos
(acima) com `i = k`, `j = semente * 8 + c`. Inteiro, então igual na web, no Godot e no editor.

**Desenho:** a partícula é o retângulo com pixels da imagem, centrado nela, escalado pela escala
do momento (interpolada pela idade), girado por `rot` e posto em `pos`, mais o balanço
`amplitude * sin(2π * frequencia * idade + 2π * s)` no eixo x do mundo (`s`: o sorteio de campo 4);
a cor é a do momento (entre os dois tons vizinhos da lista) vezes a cor do slot. Entra logo
depois da parte do slot, com o blend do emissor (ou o do slot); slot com alfa 0 não desenha as
partículas (mas elas seguem vivendo).

### Raio

Um emissor com `tipo: "raio"`: uma linha quebrada, refeita de tempos em tempos, sem partículas
vivas. Do emissor valem `nome`, `slot`, `osso`, `x`, `y`, `imagem`, `blend`, `semente` e a `taxa`,
que aqui é a intensidade (0 apaga, 1 cheio; animável como sempre). Campos próprios:

| campo | padrão | o quê |
|---|---|---|
| `ate` | (nenhum) | osso do fim (o ponto `ate_x`, `ate_y` nele); sem ele, `comprimento` na direção `angulo` (no osso) |
| `comprimento`, `angulo` | 100, 0 | quando não há `ate` |
| `segmentos` | 10 | pedaços da linha principal |
| `desvio` | 0,15 | quanto os pontos do meio fogem para os lados, em fração do comprimento |
| `largura` | 6 | px |
| `troca` | 0,06 | segundos entre um desenho e o seguinte |
| `ramos` | 2 | galhos (cada um sai de um ponto do meio da linha principal) |
| `cor` | `["ffffffff"]` | a primeira cor da lista (vezes a do slot e a intensidade) |

A forma `g = floor(relogio / troca)` (o relógio do esqueleto) muda a cada troca. Com `S` o ponto de
saída, `E` o de chegada, `L = |E - S|` e `n` a perpendicular unitária, o ponto `i` (1 a
`segmentos - 1`) é `S + (E - S) * i / segmentos + n * L * desvio * (2s - 1) * sin(π i / segmentos)`,
com `s` o sorteio de `i = g * 64 + i`, `j = semente * 8 + 5`. O ramo `r` sai do ponto
`1 + floor(s1 * (segmentos - 2))`, gira `(s2 - 0,5) * 90°` da direção do raio, tem comprimento
`L * (0,25 + 0,25 * s3)` e metade dos segmentos (no mínimo 2) e do desvio (sorteios de
`i = g * 64 + 40 + r * 4 + 1, 2, 3`, mesmo `j`; os pontos do ramo como os da principal, com
`i = g * 64 + 20 + r * 16 + i`), com largura pela metade. `linhas_raio` (`desenho.h`) devolve as
linhas, que o desenho usa. Cada pedaço é um retângulo de `largura` ao longo
do segmento, com a imagem esticada: `u` ao longo, `v` de um lado ao outro (uma imagem com um
traço macio no meio dá o brilho). Desenha na mesma posição das partículas.

Conferência: `npx tsx tools/nucleo-particulas.ts` refaz a simulação de
`tests/nucleo/particulas/particulas.boneco` (o robô CC0 com faíscas na mão e rajadas na cabeça)
com os ossos do oráculo, nos passos do `nucleo-pose`, e compara cada partícula viva. As rajadas
pelo Estado (no jogo e no editor) usam o mesmo intervalo dos eventos; ali a conferência é a do
desenho: o editor (modo núcleo) e o Godot 4.7.2 mostram o mesmo. No editor, um personagem com
partículas é simulado desde o 0 em passos, como um com física.

### Órbita

Um emissor com `tipo: "orbita"`: partículas que giram numa elipse em volta de um ponto do osso,
passando por trás e pela frente do personagem (um 2,5D de partículas). Também sem estado: tudo
sai do relógio. Valem `nome`, `slot` (onde desenham as da frente), `osso`, `x`, `y` (o centro),
`imagem`, `blend`, `giro`, `semente` e a `taxa`, que é a intensidade (0 a 1). Campos próprios:

| campo | padrão | o quê |
|---|---|---|
| `atras` | (obrigatório) | slot onde desenham as que estão atrás |
| `raios` | `[80, 20]` | os raios da elipse na tela, em px (o segundo pequeno: vista de cima) |
| `volta` | 2 | segundos por volta (negativo gira ao contrário) |
| `quantidade` | 8 | partículas na órbita |
| `faixa` | 0 | quanto cada uma foge para cima ou para baixo da elipse, em px |
| `inclinacao` | 0 | graus: a elipse inclinada na tela |
| `profundidade` | 0,35 | quanto a da frente cresce e a de trás encolhe |
| `escala` | `[1, 1]` | o primeiro valor é a escala de base |
| `cor` | `["ffffffff"]` | o primeiro tom vale na frente, o último atrás, misturados pela profundidade |

A partícula `k` (0 a `quantidade - 1`), com os sorteios `s0` (`i = k`, `j = semente * 8 + 6`),
`s1` (`i = k`, `j = semente * 8 + 7`) e `s2` (`i = k + 1000`, `j = semente * 8 + 6`): o ângulo é `θ = 2π (relogio / volta + k / quantidade + 0,3 (s0 - 0,5) /
quantidade)`, a profundidade `z = sin θ` e a posição, antes de inclinar,
`(raios[0] cos θ, -raios[1] sin θ + faixa (2 s1 - 1))` somada ao centro (a da frente fica mais
embaixo: a câmera olha um pouco de cima). A escala é `escala[0] * (0,85 + 0,3 s2) *
(1 + profundidade * z)`; a cor, a mistura do tom de trás para o da frente por `(z + 1) / 2`, vezes
a cor do slot e a intensidade; o giro, `giro[0] + (giro[1] - giro[0]) s2` graus por segundo vezes
o relógio. Com `z < 0` desenha logo depois do slot `atras`; senão, logo depois do `slot`.
`posicoes_orbita` (`desenho.h`) dá as posições, que o desenho usa.

## Instâncias

Um `.boneco` dentro de outro: o que se repete (uma letra, um vagalume, uma multidão) fica num
arquivo só e a cena só posiciona e comanda as cópias. Ficam numa lista própria, `instancias`,
fora das skins (como as partículas); a exportação para o Spine as tira e avisa.

| campo | padrão | o quê |
|---|---|---|
| `nome`, `slot`, `boneco` | (obrigatórios) | o slot dá o lugar na ordem de desenho (logo depois da parte dele, antes das partículas), a cor e os efeitos; `boneco` é o arquivo do filho, relativo ao do pai |
| `osso` | o osso do slot | onde a instância fica; `x`, `y`, `rotacao`, `escala_x`, `escala_y` (0, 0, 0, 1, 1) a posicionam no osso |
| `animacao` | (nenhuma: a pose de setup) | a animação do filho |
| `skin` | a default | a skin do filho |
| `inicio`, `velocidade` | 0, 1 | o tempo do filho: `inicio + velocidade × relógio` |
| `repetir` | true | sem repetir, o filho para no fim (e antes do 0 fica no 0) |
| `mix` | 0 | segundos de mistura quando uma chave troca a animação do filho |

**Leitura.** Cada arquivo é lido uma vez e o modelo dele é dividido entre todas as instâncias
(também entre pais diferentes). Um filho pode ter instâncias (os caminhos são sempre relativos ao
arquivo que os escreve); um filho que inclui um ancestral é recusado (ciclo). O leitor abre os
filhos por uma função (`ler_boneco(texto, caminho, abrir, erro)`): o disco nas ferramentas, a
memória na web (`mm_arquivo` antes de `mm_carregar_de`), o `FileAccess` no Godot. As páginas do
desenho são as do pai e depois as de cada filho (`paginas_desenho`), com o caminho relativo ao pai.

**Timeline:** `animacoes.<a>.instancias.<nome>`: chaves em degrau com `tempo` e qualquer de
`animacao`, `inicio`, `velocidade`, `repetir` (o que falta vem da chave anterior; na primeira, da
instância). Da chave `k` em diante o tempo do filho é `inicio + velocidade × (t − tempo_k)`, com
`t` o tempo da animação do pai; antes da primeira chave vale a instância, com o relógio. A chave
manda só na animação que entra ou toca (não na que sai num mix).

**Mistura.** A chave `k` com `mix > 0` que troca a animação (a da chave `k − 1` é outra) mistura
por `mix` segundos: enquanto `t − tempo_k < mix`, a anterior continua no tempo dela
(`inicio_{k−1} + velocidade_{k−1} × (t − tempo_{k−1})`, no laço dela ou no limite) e a pose do
filho é a das duas aplicadas desde o setup, misturadas com `α = (t − tempo_k) / mix`: a pose local
de cada osso (o giro pelo menor caminho), a cor, os efeitos e o deformar (da mesma imagem) de cada
slot, as luzes, a taxa das partículas e os parâmetros das restrições; a imagem do slot e a ordem
de desenho trocam em `α = 0,5`; as rajadas são só da nova. No instante da chave a pose é a da
anterior. Como tudo sai do tempo do pai, arrastar o cursor dá a mesma mistura.

**Atualização** (no fim do `atualizar_mundo` do pai, depois das partículas), para cada instância
com o alfa do slot acima de 0: a base `B = M_osso × T(x, y) × R(rotacao) × S(escala_x, escala_y)`;
o tempo do filho (acima), no laço (`fmod`, positivo) ou limitado a `[0, duração]`; o filho volta
ao setup e aplica a animação nesse tempo e calcula o mundo, com os ossos raiz multiplicados por
`B`. O relógio do filho anda com o do pai vezes a `velocidade` (física, partículas, borrar e rastro
do filho contam nele). Escondida (alfa 0), a instância não é calculada; um filho sem memória (sem
física, partículas, borrar, rastro nem instâncias) no mesmo instante, com a mesma animação e a
mesma base, não é refeito.

**Desenho.** O filho entra no mesmo desenho do pai, depois da parte do slot: os lotes dele usam as
páginas dele na tabela do pai; a cor do slot multiplica todos os vértices que ele desenhou (cada
nível pela do slot dele, então aninhar multiplica); os efeitos de shader do slot (linha, brilho,
dissolver, tingir) valem para cada peça do filho que não tem efeitos próprios; a luz é a do pai
(o grupo de luz do pai ilumina as páginas com relevo do filho; sem grupo no pai, o filho usa as
luzes dele). Com o recorte na CPU, o recorte do pai não corta o filho.

Conferência: `npx tsx tools/nucleo-instancias.ts` refaz, por instante, a animação e o tempo de
cada instância de `tests/nucleo/instancias/instancias.boneco` (quatro instâncias do robô CC0:
livre no relógio, trocando de animação por chaves (uma com mistura), uma que some e um arquivo
intermediário com mais duas, aninhado), a fração da mistura e o mundo de cada osso do filho (no
começo da mistura, o da animação anterior) (o filho sozinho no `nucleo-pose`, vezes a
base), e compara com o que o núcleo calculou. No `nucleo-pose`, a saída ganha `relogio` e
`instancias` (por instância visível: `animacao`, `tempo` e a pose do filho, recursiva). O
desenho foi olhado no editor (modo núcleo) e no Godot 4.7.2 com `exemplos/vinheta` (nove letras e
uma marionete por instâncias): o mesmo nos dois.

## Estado

`mamulengo/estado.h`: trilhas, fila, mix e eventos (o que o jogo usa para tocar, emendar e
cortar animações). Conferido contra o AnimationState do oráculo (`tools/nucleo-estado.ts`).

**Ordem por quadro** de `d` segundos (a do oráculo, `state.update(d); state.apply(skeleton);
skeleton.update(d); skeleton.updateWorldTransform(Physics.update)`):

```cpp
estado.avancar(d);      // relógios, trocas da fila, fim dos mixes
estado.aplicar(e);      // timelines com mix sobre o esqueleto, eventos do intervalo
/* o jogo muda cor e parte dos slots aqui: e.slot(i).cor, e.mudar_parte(i, p) */
e.avancar(d);           // relógio do esqueleto (física)
e.atualizar_mundo();
estado.ler_eventos(lista);
```

No começo: `e.setup(); e.atualizar_mundo();` (a física reinicia na pose de setup). O Estado
**não** volta o esqueleto ao setup: o que nenhuma timeline toca fica como estava, inclusive a
cor e a parte que o jogo pôs (medido no roteiro "slot do jogo": a cor e o slot escondido ficam).

**API.** `tocar(trilha, anim, loop)`, `enfileirar(trilha, anim, loop, atraso)`, `vazio(trilha,
mix)`, `enfileirar_vazio(trilha, mix, atraso)`, `limpar()`, `limpar_trilha(t)`, `avancar(dt)`,
`aplicar(e)`, `atual(trilha)` (animação ou -1), `entrada(trilha)`, `escala_tempo`,
`mix_padrao`, `definir_mix(de, para, tempo)` (começam no `mix` do `.boneco`), `eventos()` e
`ler_eventos(saida)`. `tocar` e `enfileirar` devolvem a `Entrada` (vale até o evento de fim),
em que se pode mudar `mix_duracao`, `atraso`, `alfa`, `escala_tempo`, `somar`, `reverso`,
`tempo` e os limiares. `mudar_mix(entrada, mix, atraso)` muda o mix e refaz o atraso como o
`enfileirar` (atraso <= 0: do fim da anterior menos o mix; é o que emenda uma animação na volta
de um loop sem mix). Cada entrada tem um `id` único no Estado, e cada evento diz de qual
entrada é (`Evento::entrada`): a entrada pode já ter sido apagada quando o evento é lido.
`ao_descartar(dono, entrada)`, se dado, é chamado quando uma entrada deixa de valer (antes de
ser apagada), para quem guarda ponteiros (o nó do Godot) os esquecer. `copiar_de(outro)` copia o Estado inteiro de
outro do mesmo modelo (entradas novas, com a fila e o mix religados): o checkpoint do editor.

**De trás para frente** (`reverso`, medido com o `reverse` da entrada do oráculo): as timelines
recebem o tempo espelhado no trecho, `fim - (t - inicio)`; o relógio, a `completa` (no fim da
volta, como para a frente), a fila e o mix andam como sempre. Os eventos de usuário saem quando
o tempo espelhado da chave, `fim - (tempo da chave - inicio)`, entra em `(ultimo, agora]` do
relógio da animação (com a volta do loop), da última chave para a primeira; chaves no mesmo
tempo saem na ordem do arquivo. A chave no 0 sai no fim da volta, antes da `completa`.

**Entrada.** Guarda `tempo` (relógio da entrada, cresce sem parar), `atraso`, `mix_tempo`,
`mix_duracao`, `tempo_fim` (infinito; na vazia, o mix), `inicio = 0`, `fim = duração`, e o
tempo e o relógio do aplicar anterior (`ultimo`, `tempo_ant`, começam em -1). Tempo dentro
da animação: em loop `fmod(tempo, duração)` (a duração 0 dá 0); sem loop `min(tempo, duração)`.
Ao ser criada, `mix_duracao` é o mix do par (da última animação da trilha para a nova), ou o
padrão, ou 0 se a trilha estava vazia.

**avancar(dt).** `dt *= escala_tempo`. Por trilha: `ultimo` e `tempo_ant` passam a ser os do
aplicar anterior; se ainda há `atraso`, desconta (sem aplicar a entrada) e o que sobra vira o
dt. Se há próxima na fila e `tempo_ant - atraso_da_próxima >= 0`, a próxima entra com
`tempo += sobra + dt` (a troca acontece no quadro **seguinte** ao que passou do ponto, com o
tempo que sobrou), a atual anda e vira a que sai (evento interrompida), e todo `mix_tempo` da
cadeia que sai ganha `dt`. Sem próxima, a entrada acaba (fim) quando `tempo_ant >= tempo_fim`
e não há mix. Cada entrada que sai anda o próprio relógio e o `mix_tempo` da que entra até o mix
acabar; quando a que entra já foi aplicada e `mix_tempo >= mix_duracao`, a que sai é
retirada (fim) se o peso total dela no último aplicar foi 0 ou se o mix é 0.

**Fila.** `enfileirar` com `atraso <= 0`: `atraso += quando a última completa - mix` (no loop, o
fim da volta em curso; sem loop, a duração), mínimo 0; com atraso > 0, ele é contado do
início da última. Em trilha vazia a entrada vira atual com o atraso dado. `enfileirar_vazio`
ajusta o atraso por `mix_da_entrada - mix` e põe o mix e o `tempo_fim` no dado. `vazio(t, mix)`
toca a animação vazia com esse mix e `tempo_fim = mix`.

**tocar.** Esvazia a fila da atual e a nova mistura a partir dela (interrompida, início).
Exceção medida: se a atual nunca foi aplicada **e é a mesma animação**, ela é trocada sem mix
(interrompida, fim) e a nova mistura a partir da de baixo dela; com animação diferente, mesmo
nunca aplicada (no mesmo quadro, ou ainda no atraso), ela é interrompida e entra no mix.

**aplicar.** Por trilha com entrada fora do atraso, a mistura é `Primeira` na trilha 0 e
`Substitui` (ou `Soma`) nas outras; o peso é `alfa` vezes o `mix` da cadeia que sai (abaixo),
ou 0 se a entrada passou do `tempo_fim` e não tem próxima. Com peso 1 na trilha 0, todas as
timelines entram com `Primeira` e peso 1. Senão, cada timeline usa o modo (abaixo): primeira
com `Setup`, seguinte com a mistura da trilha. As timelines vão na ordem partes, cores, ossos,
restrições, deformar, ordem de desenho, eventos. Ao fim, os slots cuja parte só foi mexida sem
permissão (saindo de um mix, antes da primeira chave) voltam à parte do setup.

**Misturas** (`Mistura` em `pose.h`, valor `v` da chave, `s` o setup, `x` o atual, peso `a`):
girar, mover, cisalhar somam ao setup: `Setup`: `s + v a`; `Primeira`, `Substitui`:
`x + (s + v - x) a`; `Soma`: `x + v a`. Antes da primeira chave: `Setup` dá `s`, `Primeira` dá
`x + (s - x) a`, as outras não mexem. Escala com `X = v s`: peso 1 dá `X`; misturando, entrando,
`b + (X - b) a` com `b = |s ou x| * sinal(X)`; saindo, `b + (|X| sinal(b) - b) a`. Cor: peso 1
dá a chave, senão `Setup` parte da cor do setup e soma `(c - atual) a`, cada canal em [0, 1].
Deformar (em deslocamentos): vazio conta como `Setup`; `Setup` dá `V a`, `Primeira` e
`Substitui` `D + (V - D) a`. Ordem de desenho saindo só volta ao setup (com `Setup`); entrando,
vale a chave sem peso. Parâmetros das restrições: `s + (v - s) a` ou `x + (v - x) a`.

**Girar misturando** (peso < 1) não usa a fórmula acima: `r1` é o setup (`Setup`) ou o atual,
`r2 = s + v`, `dif = r2 - r1` levado a [-180, 180) por `dif -= ceil(dif/360 - 0,5) * 360`, e
cada timeline guarda `total` e `dif` do quadro anterior (zerados no primeiro quadro da entrada e
quando ela passa a sair). `voltas = total_ant - fmod(total_ant, 360)`, `total = dif + voltas`;
se `|dif_ant| <= 90` e o sinal de `dif` mudou: com `|total_ant - voltas| > 180` soma
`360 sinal(total_ant)` e o lado passa a ser o de agora, senão com `voltas != 0` subtrai
`360 sinal(total_ant)`, senão o lado passa a ser o de agora. Se o lado (`total_ant >= 0`) não é
o de `dif >= 0`, soma `360 sinal(total_ant)`. Com `dif == 0`, `total = total_ant`. Resultado:
`r1 + total * a`. Mantém o sentido do giro quando a diferença cruza 180 graus.

**Mix da que sai** (recursivo, da mais antiga para a mais nova): `mix = mix_tempo / mix_duracao`
(máximo 1), ou 1 com mix 0 (um quadro que desfaz o que a que sai deixou). A que sai pesa
`peso = alfa` vezes o mix dela mesma, se ainda estava entrando (medido: o 4.3 não congela esse
peso no corte). Cada timeline: `peso_mix = peso * (1 - mix)`; segurando, `peso`, ou
`peso * max(0, 1 - mix_tempo/mix_duracao)` da entrada mais nova que manda (abaixo). Primeira
usa `Setup`, seguinte a mistura da trilha (a 0 continua `Primeira`, também com mix 0). Saindo,
as trocas de parte só valem acima do limiar (padrão: nunca) e, sem permissão, a timeline só
troca a parte se nenhuma timeline com permissão a pôs neste aplicar; eventos da que sai só
com `mix < limiar_eventos` (padrão: nunca); a "completa" da que sai sai com mix > 0.

**Modos** (recalculados quando há início ou fim, da mais antiga para a mais nova de cada trilha;
bits como o oráculo guarda: 1 primeira, 2 seguinte, 4 segura): primeira se nenhuma entrada mais
antiga da trilha anima a propriedade, senão seguinte; e, independente disso, segura se a
entrada que entra (`para`) também a anima (não vale para partes, ordem e eventos). Segurando,
procura acima de `para` a primeira entrada que não anima a propriedade: se ela tem mix > 0, é
ela que manda (o peso some enquanto ela entra). Medido no oráculo (`timelineMode` e
`timelineHoldMix` são campos públicos): com A(a,b), B(a,c), C(b,c), a cadeia A, B, A dá
A:[a 5, b 1], B:[a 6, c 1] e A, B, C dá A:[a 5 por C, b 1], B:[a 2, c 5]; a regra antiga
(segurar só a primeira) errava até 64 px no pessoa e 17 px no monstro num corte no meio do mix.
`manter_segura`: quando uma entrada que sai perde a de baixo (retirada com peso 0), ela e as
acima dela, menos a do topo, passam a manter o bit de segurar que tinham (o oráculo liga
`keepHold`); sem isso, um vazio de um quadro no meio de um mix devolvia o setup onde o oráculo
segura a animação de baixo por mais um quadro (90 graus de diferença num osso sintético).

**Eventos.** Ordem e quadro iguais aos do oráculo: `inicio` (tocar, ou quando a da fila
entra), `interrompida` (a que sai, também na troca natural da fila), `fim` (quando é retirada,
no `avancar`), `completa` (no `aplicar`: em loop a cada volta, `floor(tempo/dur) >
floor(tempo_ant/dur)`, ou sempre com duração 0; sem loop quando o tempo de animação chega ao fim
pela primeira vez) e `usuario`. Os de usuário disparam para as chaves com tempo em
`(ultimo, agora]` (com a volta do loop: do último até o fim, depois do começo); os de antes da
volta saem antes da `completa` e os de depois, depois. O tempo da chave é float32 (0.7333333
vira 0.73333329). Os valores que a chave não traz vêm da definição; sem `audio`, volume e
balanço são 0; com `audio`, o balanço que a chave não traz vem do **volume** da definição
(medido: definição `volume 0.7, balanco -0.3` e chave sem balanço dão balanço 0,7; parece
defeito do oráculo, mas o oráculo manda).

**Conferência** (60 quadros por segundo, os 20 assets): 272 roteiros com mix 0 (o do jogo) e
194 com `--mix 0.2`, todos dentro da tolerância em todos os quadros, com os eventos iguais.
Com os roteiros da entrada mudada pelo jogo (de trás para frente sem loop, em loop, cortado no
meio com mix próprio e na fila; mix e atraso refeitos na volta do loop; escala de tempo por
entrada; relógio da trilha adiantado: sete por animação, nas duas primeiras de cada asset) e
os de personagem escondido (roteiro com `escondido: [de, ate]`: nesses quadros só o relógio das
trilhas anda, sem aplicar, sem o relógio do esqueleto e sem o mundo; volta a aparecer no meio do laço,
com uma troca com mix escondido ou ao aparecer), os 3 CC0 dão 90 roteiros com mix 0 e 81 com
`--mix 0.2`, e o corpus privado 1105 e 925, todos iguais (a física de um personagem com dezenas de
físicas, escondido 15 s e trocando de animação ao aparecer, bate até 2e-13 px). Os eventos de usuário de trás para frente foram conferidos num asset privado com
evento e no pessoa e no monstro com cinco eventos por animação (`tools/nucleo-fixtures.ts`,
`eventos/`, dois no mesmo tempo e um no 0): 48 e 42 roteiros, iguais.
O `change` da transição sai no quadro 43 de cada volta (o 44º passo, 0,7333 s), igual. Pior
desvio de osso 4,4e-4 px (transição), de vértice 4,6e-4 px. Além disso: 600 casos aleatórios
de mix em 3 ossos (girar, mover, escalar com sinal; 599 iguais), 420 roteiros aleatórios nos 20
assets (tocar, enfileirar com e sem atraso, vazio, mix de 0 a 0,4 s; todos iguais) e 40
roteiros de duas e três trilhas com `limpar` (todos iguais). Dois casos aleatórios ainda
diferem num quadro só (anotados em "Em aberto").

Custo: o quadro do monstro custa 0,71 µs com o Estado contra 0,77 µs no `aplicar` direto; o da
transição, 28 µs contra 24 µs (nativo).

**Em aberto.** (1) Um corte com rotações de mais de 360 graus no meio de dois mixes: um quadro
com 8 graus de diferença num osso (o oráculo zera o `total` daquela timeline num quadro em que
a entrada de baixo termina o mix). (2) Na transição, um quadro com 0,12 px num osso de caminho
com a mesma posição de caminho nos dois (a conta do caminho, não do Estado). (3) Timelines de
`reiniciar` da física, `escala_tempo` negativa, `inicio` e `fim` diferentes do padrão (o
reverso usa o trecho, mas só foi medido com o padrão) e `segurar` à moda antiga
(`holdPrevious`) não foram medidos.

## No Godot (`BonecoSprite`)

`nucleo/godot/boneco`: o mesmo código como módulo do motor (template web) e como GDExtension
(editor e CI). Os nomes de métodos e sinais são os do nó C++ antigo, para o `SpineRuntime` dos
jogos tratar os dois igual. O que o nó acrescenta ao núcleo:

- **Entradas.** `set_animation`, `add_animation` e `set_empty_animation` devolvem um
  `BonecoEntrada`, e os sinais e o `get_current` entregam o mesmo objeto para a mesma entrada.
  Enquanto a entrada vale, `set_reverse`, `set_mix_duration`, `set_mix_duration_and_delay`
  (o `mudar_mix`), `set_delay`, `set_track_time`, `set_time_scale` e `set_alpha` mudam a
  entrada do Estado; depois do fim, `is_valid()` é falso e os `set_*` não fazem nada.
- **Sinais na hora.** `animation_started`, `animation_interrupted` e `animation_ended` saem
  dentro do `set_animation` (e do `add_animation` e dos `clear_*`), não no quadro seguinte; um
  sinal que toca outra animação não reentra, e os eventos novos saem na volta seguinte do laço.
- **Escondido** (fora de `is_visible_in_tree`), com `pose_when_hidden` falso (o padrão): só
  o relógio das trilhas anda, com os sinais dele; não aplica, não anda a física e não
  redesenha. Ao reaparecer, continua da pose em que estava. É o que um jogo feito com o
  runtime de antes espera (um personagem que nasce escondido não chega adiantado).
- **Na cena:** `boneco` guarda o caminho do `.boneco` (o `data` não vai para a cena), e o
  mesmo caminho devolve o mesmo `BonecoData` enquanto ele vive (cópias de um molde não releem o
  arquivo). `preview` toca em laço só no editor; no jogo o nó nasce na pose de setup.
- `float_clock`: o relógio em float32 (acima, "Relógio").
- `get_bones_world()`: todos os ossos, `nome -> [x, y, a, b, c, d]` com o eixo y para baixo
  (`x, -y, a, b, -c, -d` do núcleo), para comparar com o jogo de antes.

## No editor

O viewport do editor calcula e desenha pelo núcleo no modo **núcleo** (seletor "desenho" na
barra, ao lado de "enquadrar"; `?runtime=nucleo` no endereço; `view {runtime: "nucleo"}` pela
ponte). Os outros modos continuam: **godot** (o spine-godot dos jogos de hoje, com os defeitos
medidos em `docs/PARIDADE.md`) e **spine** (o editor do Spine). A escolha fica guardada no
navegador.

No modo núcleo o viewport não tem esqueleto do spine-core: nem `SkeletonData`, nem `Skeleton`,
nem `AnimationState` (`viewer.skeleton`, `data`, `state` e `sim` ficam `null`). Se o núcleo
recusa o documento, o viewport volta ao spine-webgl (com o esqueleto do spine-core) e mostra o
motivo; a próxima recarga tenta o núcleo de novo.

- **Documento:** a cada mudança estrutural o JSON do Spine e o atlas viram `.boneco`
  (`importarSpine`) e entram no wasm (`mm_carregar`); o modelo anterior é solto
  (`mm_liberar_modelo`). As animações (nomes e durações) vêm do `mm_info`.
- **Pose** (`NucleoCena.poseAt`, `src/render/nucleo.ts`): a mesma conta do `PoseSim`, sobre o
  Estado: personagem novo (`mm_reiniciar`: setup, física reiniciada), `tocar` com mix 0, um
  quadro em 0 e passos de 1/64 desde 0 (sem física, um passo só até `t`). A emenda (prévia de
  transição) usa `enfileirar` com o atraso `duração de A - mix` ou `tocar` no instante do
  corte, com o mix pedido. Tocando, cada quadro é um `mm_passo` do tamanho do quadro.
- **Checkpoint:** com física ou emenda, quando o tempo só anda (agulha para frente, a prévia
  tocando), o `poseAt` continua do último passo inteiro, como o `PoseSim`: `mm_guardar` copia o
  Esqueleto (com a memória da física) e o Estado (`Estado::copiar_de`: as entradas são copiadas
  e os ponteiros da fila e do mix refeitos), `mm_restaurar` volta a eles. Vale a mesma regra do
  `PoseSim` (só com `t` depois do checkpoint; `t` igual refaz) e o checkpoint é esquecido em
  qualquer remendo, recarga ou passo livre. `NucleoCena.atalhos = false` desliga (para medir).
  Conferido: a pose andando 30 quadros com o atalho e a refeita desde 0 sem ele são iguais em
  todos os algarismos nos 3 personagens CC0, com e sem emenda (`checkpointDiff` 0 no bench).
- **Leitura da pose** (`NucleoPose`, a mesma interface `PoseView` de `src/render/pose.ts` que o
  `SpinePose` dá nos outros modos): por osso, `mm_pose_ossos` (mundo `[a, b, c, d, x, y]`,
  comprimento no mundo e pose local, 14 números) e `mm_setup_ossos` (o setup do modelo agora,
  com os remendos); por slot, `mm_pose_slots` (a parte atual, a cor e, no fim, a ordem de
  desenho); `mm_vertices_slot` (vértices em mundo da parte atual: região, malha, e também
  caminho, recorte e caixa); `mm_caixa` (a caixa das regiões e malhas, como o `getBounds` do
  spine-core); `mm_parte_triangulos` e `mm_parte_pesos`. Nomes, pais, blend, tipo de parte,
  contorno da malha e caminho fechado vêm do `mm_info`. Os números ficam em áreas do wasm que o
  JavaScript lê direto (`HEAPF64`); ossos, setup e slots são copiados uma vez por pose, na
  primeira leitura.
- **O que lê essa pose:** o clique (parte e osso sob o ponteiro, inclusive o osso que mais puxa
  uma malha com pesos), o arrasto de osso (mover, girar, esticar; a chave na animação aberta), o
  pincel de deformar, a edição de malha e pesos (o mundo dos ossos na Pose base vem do núcleo),
  os gizmos e destaques, os ossos, malhas, caixas, caminhos e recortes à mostra (um desenho de
  depuração com as cores e espessuras do spine-webgl, `drawDebug`), o olho (que esconde slots
  pelo osso, inclusive pelo osso que puxa a malha), o enquadramento (`frameAll`,
  `currentBounds`, `partBounds`), as camadas, o inspetor e os limites da ficha ao vivo.
- **Cebola:** os fantasmas são desenhados pelo núcleo numa instância só deles
  (`mm_pose_direta`: a animação no tempo sobre o setup, mundo calculado uma vez com a física
  reiniciada ali, como o `Physics.pose` do spine-core), com a cor do fantasma multiplicando a
  de cada vértice na lista de desenho.
- **Desenho** (`Desenhista`, o mesmo do palco): a lista de desenho do núcleo no mesmo canvas e
  contexto WebGL2 do viewer (com stencil para o recorte), com a projeção da câmera do
  spine-webgl. Semântica do jogo (a do template web e do módulo Godot): pma desfeito no shader,
  multiplica `destino x mix(1, cor, alfa)`, tela `destino x (1 - s) + s`, multiplica do motor só
  quando o `.boneco` pede, física de rotação no sentido do jogo. O olho esconde slots pela parte
  (`mm_desenhar_escondendo`).
- **Arrasto sem recarregar:** a ponte muda o modelo direto. `mm_osso_setup` (x, y, rotação,
  escalas, cisalhas e comprimento do setup de um osso), `mm_slot_setup` (cor e parte do setup de
  um slot) e `mm_trocar_animacao` (relê só uma animação, `ler_animacao` em `leitor.cpp`). O
  viewer usa isso no lugar de recarregar quando a mudança é só nesses campos (os mesmos que o
  `patch.ts` remenda no spine-core); o resto relê o documento.
- **Várias poses de uma vez:** `mm_simular(instância, animação, loop, instantes, n)` (e
  `NucleoCena.simular`) devolve o mundo de cada osso em cada instante, com a conta do `poseAt`
  (andando de um instante ao seguinte pelo checkpoint). Igual a um `poseAt` por instante em
  todos os algarismos (`simularDiff` 0 no bench). As medidas usam o `mm_medir`, que estende essa
  conta (abaixo).

**Paridade de imagem** (`npx tsx tools/nucleo-editor.ts`: editor próprio na porta 5207 com
`tests/assets`, Chromium headless com SwiftShader, 480x480, o personagem inteiro enquadrado,
cada modo pela pose dele): modo núcleo contra modo spine em 9 instantes de cada animação, na
fila e no corte com mix 0,2 s, e o remendo do arrasto contra a recarga. Pior quadro, em % dos
pixels com diferença acima de 8/255:

| personagem | setup | animações | emendas (fila e corte) | remendo = recarga |
|---|---|---|---|---|
| aventureiro | 0,008 | idle 0,010, susto 0,011 | 0,012 e 0,010 | igual (0 pixels) |
| monstro (física) | 0,081 | idle 0,088, ganhou 0,051 | 0,053 e 0,051 | igual |
| pessoa (física) | 0 | idle 0, acenar 0 | 0 e 0 | igual |

As diferenças são de borda (o filtro da textura sem pré-multiplicar contra a pré-multiplicada
do spine-webgl), pior canal de 4 a 58/255 em poucos pixels. Os CC0 não têm multiply, tela nem
gravidade de física; nesses casos o modo núcleo difere do modo spine de propósito (o jogo).

**Interação** (`npx tsx tools/nucleo-interacao.ts`: editor próprio na porta 5208, o mesmo
Chromium, mouse de verdade pelo protocolo de depuração do Chromium, a mesma câmera nos dois
modos). Em cada personagem, nos modos spine e núcleo: cliques numa grade de 14 x 14 pontos
sobre o personagem, na Pose base e no meio da primeira animação, e com os ossos à mostra um
clique no meio de cada osso; arrasto de um osso (mover, girar e esticar) na Pose base e com a
animação aberta (vira chave); edição da malha com pesos (arrastar um ponto, criar um no
contorno, pintar peso); a cebola e o desenho de depuração (ossos, malhas e caixas). Resultado:

| personagem | cliques iguais (acertando uma parte ou osso) | documento depois dos arrastos e da malha | imagens (pior %) | spine-core no viewer e na interação |
|---|---|---|---|---|
| aventureiro | 412 de 412 (366) | igual (0) | 0,002 | 0 leituras, 0 poses |
| monstro | 410 de 410 (315) | igual (pior 2e-7 num vértice da malha) | 0,069 (cebola) | 0 leituras, 0 poses |
| pessoa | 422 de 422 (226) | igual (pior 3e-5 numa chave de mover) | 0 | 0 leituras, 0 poses |

As nove edições (três arrastos na Pose base, três com a animação, três na malha) saem iguais nos
dois modos, com os mesmos rótulos no histórico.

A ferramenta conta, na página, cada `SkeletonJson.readSkeletonData` e cada
`Skeleton.updateWorldTransform` do spine-core e separa quem pediu: no modo núcleo o viewer e a
interação não leem nem posam nenhum esqueleto (no modo spine, o mesmo roteiro posa 1.000 a
1.600 vezes). O que ainda posa o spine-core no modo núcleo é da etapa C: a ficha (as regras
conferidas a cada edição) e os comandos de malha (`mesh.*`, que calculam a Pose base pelo
`skeletonAt`).

**Custo** (`tools/bench.ts --runtime spine,nucleo`, pela ponte, SwiftShader, ms; o relógio do
navegador tem passo de 0,1 ms, então valores abaixo de 0,1 são médias de muitas chamadas):

| personagem | modo | quadro tocando | parte do núcleo (pose + desenho) | `poseAt` andando (por quadro) | sem atalho | emenda andando | sem atalho | passo de arrasto na setup | com animação aberta | recarga |
|---|---|---|---|---|---|---|---|---|---|---|
| monstro (física) | spine | 0,09 | | 0,037 | 0,6 | 0,097 | 0,6 | 0,55 | 0,67 | 0,23 |
| monstro (física) | núcleo | 0,08 | 0,007 + 0,023 | 0,010 | 0,1 | 0,010 | 0,2 | 0,21 | 0,51 | 1,32 |
| pessoa (física) | spine | 0,15 | | 0,030 | 0,5 | 0,110 | 1,1 | 0,56 | 0,66 | 0,34 |
| pessoa (física) | núcleo | 0,05 | 0,007 + 0,016 | 0,010 | 0,2 | 0,010 | 0,2 | 0,27 | 0,63 | 1,85 |
| aventureiro | spine | 0,14 | | 0,037 | 0,4 | 0,137 | 0,7 | 0,52 | 0,68 | 0,23 |
| aventureiro | núcleo | 0,11 | 0,007 + 0,020 | 0,013 | 0,2 | 0,020 | 0,2 | 0,23 | 0,75 | 1,23 |

Sem o esqueleto paralelo, o quadro do modo núcleo custa o mesmo ou menos que o do modo spine, e
o passo de arrasto na setup caiu à metade (o remendo direto e nada do spine-core para posar).
O `poseAt` andando com física custa de 3 a 4 vezes menos que no spine-core, e com emenda de 7
a 11 vezes menos. Nenhum passo de arrasto recarregou o núcleo (`nucleoReloadsInDrag` 0). A
recarga continua mais cara (1,2 a 1,9 ms contra 0,2 a 0,3 ms do spine-core): é o
`importarSpine` e a leitura do `.boneco` no wasm; o remendo evita isso no arrasto.

**Etapa C: as medidas e os comandos.** No modo núcleo o editor não usa o spine-core para nada:
nem `SkeletonData`, nem `Skeleton`, nem `AnimationState`, nem `updateWorldTransform`, em nenhum
fluxo (viewer, interação, medidas, ficha e o painel dela, comandos). O spine-core fica nos modos
godot e spine e no oráculo dos testes (`tools/oraculo.ts`, `tools/parity.ts` e afins).

- **A pose em instantes** (`src/core/instantes.ts`): a camada que as medidas e os comandos leem.
  Um `Medidor` aberto sobre o documento dá, por instante, o mundo e a pose local de cada osso (e
  o setup) e, se pedidos, a parte, a cor e os vértices (região e malha) de cada slot e a ordem de
  desenho (`poses`); a emenda A e B na fila ou no corte, com mix (`sequencia`); os eventos de
  usuário até um instante, em passos de 1/64 (`eventos`); a caixa da pose direta, para o
  `skeleton.bounds` (`caixa`); e a última pose com alguns locais trocados, o mundo refeito sem
  andar a física (`reposar`, para o `pose.follow`). Duas implementações: spine-core (modos godot
  e spine: um `SkeletonData` por medidor e o `PoseSim`) e núcleo (o documento vira `.boneco` e
  entra no wasm; o medidor tem modelo e instância só dele). O modo vem de `usarMedidas`: o viewer
  o acerta com o seletor "desenho"; em Node o padrão é godot (`npm run ficha -- check ...
  --runtime nucleo` usa o núcleo). Se o núcleo recusa o documento, o medidor cai no spine-core
  (modo spine), como o viewer cai no spine-webgl. `{leve: true}` lê só o que mexe nos ossos
  (ossos, restrições, as partes de caminho, timelines sem imagem nem deformar): os comandos que
  só querem o mundo dos ossos (`skeletonAt`) e as medidas de movimento.
- **A ponte** (`nucleo/web/nucleo_web.cpp`): `mm_medir` (a conta do `poseAt`, com e sem emenda,
  em vários instantes, com o checkpoint de um instante ao seguinte; por instante, 13 números por
  osso e, se pedidos, parte e cor por slot, a ordem e os vértices), `mm_medir_eventos`,
  `mm_reposar` (uma cópia do esqueleto com a inércia da física zerada: a física mostra o que já
  tinha, como o `Physics.pose`), `mm_caixa_direta`, `mm_liberar_instancia` (o medidor abre e
  fecha a instância dele sem tocar nas do viewer) e os nomes dos eventos no `mm_info`. O
  `mm_info` passou a escrever a duração com todos os algarismos: com 6 casas, uma última chave em
  float32 (0,6000000238) saía 0,6, e a fila da emenda entrava 2e-8 s antes da do `PoseSim` (o
  bastante para o número de quadros de uma medida mudar). O módulo wasm agora também roda em Node
  (`-sENVIRONMENT=web,node`).
- **Quem passou para a camada:** `query.motion`, `query.relation`, `query.rig`, `query.estilo`,
  `query.malha`, `query.recorte`, `query.transition`, `query.mesh`, `ficha.check` e `ficha.draft`
  (com todas as regras: limite, preso, física, loop, termina_como, comeca_como, transicao, corte,
  estilo), a transição (`src/core/transition.ts`), o recorte (`src/core/recorte.ts`: a pose do
  medidor e a geometria das partes do JSON), o estilo (`src/core/estilo.ts`) e os comandos que
  calculam a pose pelo mundo (`skeletonAt`, que agora devolve um quadro do medidor:
  `bone.add`/`bone.set` com `at`, `slot.set` mantendo o lugar, `attachment.region` com `world`,
  `ik.create`, `key.set` no espaço do mundo, os de malha, pesos e deformar, `pose.follow`,
  `anim.match`, `skeleton.bounds`, o PSD). As medidas pedem todos os instantes de uma vez (antes,
  uma leitura do `SkeletonData` por instante).
- **O que muda nas medidas entre os modos.** Godot: o jogo de hoje (a gravidade das físicas de
  rotação invertida, `godotGravity`, e o mix do spine-godot, `likeSpineGodot`). Spine: o
  spine-core puro (o editor do Spine). Núcleo: o jogo novo (o `.boneco` já tem a gravidade no
  sentido do jogo, docs/FORMATO.md; o mix é o do oráculo). Nos CC0 (sem gravidade de física) os
  três modos dão a mesma `ficha.check`. Godot e núcleo diferem só no mix de uma propriedade que só
  a animação que sai anima (godot segura o valor dela; spine e núcleo puxam para o setup); spine e
  núcleo diferem só onde há gravidade numa física de rotação (o núcleo puxa como o jogo). Mudanças
  no modo godot em relação a antes: as restrições de caminho passam a contar (o `bonesOnly` antigo
  as tirava) e o pior de uma regra (ou o maior de `query.relation`) só muda de instante, ou de
  osso, se passar o anterior em mais de 0,001 (`EMPATE`): o lugar de um máximo de ruído não pode
  depender do arredondamento do runtime. Pelo mesmo motivo, a ordem dos momentos do
  `query.recorte` e do `query.malha` empata pelo valor mostrado (o mais cedo primeiro), o pior par
  do recorte empata pelo nome e a busca do `pose.follow` só aceita um passo que melhora mais que
  1e-4.

**Conferência** (`npx tsx tools/nucleo-medidas.ts [--pagina] [--detalhe]`: em Node, com o mesmo
wasm do editor, nos 3 CC0, modo spine contra modo núcleo). A pose em instantes é comparada com
as tolerâncias do `nucleo-compara`; as medidas, pelo que o Claude recebe: o texto igual e cada
número dentro de uma unidade da última casa impressa. Por quê: as poses batem a 1e-4 px; as
medidas derivam delas por somas, diferenças e velocidades a 60 quadros por segundo (1e-4 px vira
no máximo 0,006 unidades/s), abaixo da casa mostrada, mas um valor que difere em 1e-6 pode virar
a casa no arredondamento. O pior foi 0 casas em todos os casos: nenhum arredondamento virou.

| personagem | pose (setup e animações a 30 qps): osso, matriz, vértice | emendas (fila, corte, corte em 0, mix 0) | eventos | caixa | query.rig, motion, relation, estilo, malha, recorte, transition (fila, corte, cortes), mesh | ficha.check, ficha.draft | documento depois de 15 edições |
|---|---|---|---|---|---|---|---|
| aventureiro | 8e-6 px, 1e-7, 2e-5 px (73 instantes) | 9e-6 px (417) | 86 iguais | 2e-5 px | iguais | iguais | 1e-6 |
| monstro (física) | 3e-5 px, 1e-7, 3e-5 px (91) | 3e-5 px (531) | 82 iguais | 3e-5 px | iguais | iguais | 2e-6 |
| pessoa (física) | 8e-5 px, 5e-7, 1e-4 px (133) | 8e-5 px (799) | 72 iguais | 4e-5 px | iguais | iguais | 1e-4 |

Cor, parte e ordem de desenho iguais em todos os instantes; os eventos (sintéticos, quatro por
animação, dois no mesmo tempo) com nome, animação, instante e tempo da chave iguais. As 15
edições: `bone.add` (com `at` e `toward`, duas vezes), `bone.set` com `at`, `slot.add`,
`attachment.region` com `world`, `ik.create` (dobra tirada da pose), `key.set` no espaço do mundo,
`skeleton.bounds` com animações, `pose.follow`, `anim.match`, `slot.set` mantendo o lugar e, numa
malha, `mesh.vertices`, `mesh.weights`, `deform.set` e `mesh.unbind`. A `ficha.check` leva a ficha
do personagem mais regras de todos os tipos (preso, limite de rotação e de x, física, loop,
termina_como, comeca_como, transicao, corte, estilo). `npm run ficha -- check` nas fichas CC0 sai
igual, texto inteiro, nos três modos.

Com `--pagina`, as mesmas 27 a 29 medidas e as 15 edições pela ponte, no editor de verdade
(editor próprio na porta 5209, Chromium headless), com uma animação aberta (o painel da ficha
confere as regras depois de cada edição), contando na página cada
`SkeletonJson.readSkeletonData` e cada `Skeleton.updateWorldTransform` do spine-core, de qualquer
quem chama:

| personagem | resultados, núcleo contra spine | documento | spine-core no modo núcleo | no modo spine |
|---|---|---|---|---|
| aventureiro | iguais | 1e-6 | 0 leituras, 0 poses | 69 leituras, 15.632 poses |
| monstro | iguais | 2e-6 | 0 leituras, 0 poses | 70 leituras, 19.821 poses |
| pessoa | iguais | 1e-4 | 0 leituras, 0 poses | 82 leituras, 29.859 poses |

O `tools/nucleo-interacao.ts` também exige agora 0 nos comandos e na ficha (antes anotado): 0
leituras e 0 poses nos 3 personagens (no modo spine, 24 a 32 leituras e 382 a 566 poses).

**Custo** (Node, ms, o melhor de 3, somado nas animações do personagem; spine / núcleo):

| medida | aventureiro | monstro (física) | pessoa (física) |
|---|---|---|---|
| query.motion | 3,9 / 2,6 | 3,6 / 2,4 | 4,9 / 3,2 |
| query.relation (8 pares) | 6,4 / 6,1 | 6,7 / 5,6 | 9,3 / 7,5 |
| query.estilo | 4,1 / 2,6 | 3,9 / 2,3 | 5,9 / 3,4 |
| query.malha | 3,2 / 3,8 | 3,9 / 3,6 | 6,1 / 7,7 |
| query.recorte | 25 / 25 | 39 / 37 | 65 / 66 |
| query.transition (fila) | 14,7 / 3,4 | 15,5 / 3,4 | 24,4 / 8,6 |
| query.transition (6 cortes) | 52 / 12 | 63 / 12 | 98 / 24 |
| ficha.check | 115 / 27 | 141 / 30 | 229 / 61 |
| ficha.draft | 4,7 / 2,2 | 6,2 / 2,3 | 8,7 / 3,7 |
| query.rig | 0,5 / 1,1 | 0,3 / 0,7 | 0,2 / 0,7 |
| query.mesh | 0,8 / 1,4 | 0,6 / 1,3 | 1,4 / 2,9 |

O que anda (emenda, ficha) custa de 3 a 5 vezes menos no núcleo; o que lê uma pose só
(`query.rig`, `query.mesh`) custa até 1,5 ms a mais (o `importarSpine` e a leitura do `.boneco`
a cada medidor). O recorte e a malha são dominados pelos pixels e pelos triângulos, não pela pose.
Pela ponte, no navegador, as 27 a 29 medidas de um personagem levam 410 a 970 ms no núcleo contra
1.070 a 1.550 ms no spine-core. Os números do `tools/bench.ts --runtime spine,nucleo` (pose,
desenho, arrasto) ficam como os da etapa B.

**Duas descobertas no núcleo** (pela conferência das edições):

- *Restrição que mexe na pose local, tocando pelo Estado.* O IK (e a transformação com alvo
  local) escrevem na pose local para recalcular o mundo; o Estado não volta ao setup a cada
  quadro, então o que a restrição fez ficava para o quadro seguinte e somava: um IK de 2 ossos
  com mix 0,5, sem chave nos ossos, chegava ao alvo inteiro (40 px de diferença com o oráculo). O
  `nucleo-compara` não via (o `aplicar` dele volta ao setup a cada instante). Corrigido:
  `atualizar_mundo` devolve a pose local de antes das restrições (como a `pose` do oráculo, que
  as restrições não tocam). Os casos pequenos do `nucleo-medidas` (IK de 1 e 2 ossos com mix
  parcial, transformação local somando) batem a 1e-7 px; `nucleo-compara` e `nucleo-estado`
  seguem dentro da tolerância (180 de 180 roteiros).
- *Ordem das restrições (pendente).* Uma restrição num osso que vem antes, na lista, de uma
  restrição num ancestral dele (a física da cabeça do aventureiro e, depois dela, um IK com mix 0
  no quadril e no tronco): o oráculo mostra a física; o núcleo recalcula a cabeça depois do IK e
  a perde (3,2 graus de diferença na cabeça). Com o IK antes da física os dois batem. O
  `nucleo-medidas` mostra o caso como "anotado"; nenhum asset do corpus tem essa ordem.

**O que ainda importa `@esotericsoftware` fora dos testes e do oráculo:** `src/render/viewer.ts`
e `src/render/pose.ts` (`SpinePose`), `src/core/sim.ts` (`PoseSim`), `src/core/patch.ts` e a
metade spine-core de `src/core/instantes.ts` (todos só nos modos godot e spine),
`src/palco/palco.ts` (a referência do palco) e `Color` do spine-webgl em `src/app/interact.ts` e
`src/app/meshedit.ts` (só a classe de cor dos gizmos, que roda em qualquer modo, sem esqueleto).
`src/core/pose.ts` só importa um tipo.

**O núcleo como padrão do editor.** Dá: no modo núcleo o editor inteiro (desenho, interação,
medidas, ficha, comandos) bate com o modo spine nos CC0 e custa o mesmo ou menos. O que segura:
os jogos de hoje rodam no spine-godot, e o modo godot é o que mostra os defeitos dele (multiply,
tela, pma, a gravidade invertida e o mix); quem anima para um jogo que ainda não migrou precisa
dele. Proposta: núcleo como padrão para personagens novos e jogos já em `.boneco`, godot para os
jogos no spine-godot (uma escolha por projeto). Antes, resolver a ordem das restrições.

## Marcos

1. Ossos, curvas, slots, ordem de desenho, região, malha com e sem pesos, deformar: os 3
   personagens CC0 (`tests/boneco/`) e os símbolos do jogo novo.
2. IK e física (o monstro CC0 tem física).
3. Caminho e recorte: a transição do jogo novo.
4. Transformação e o resto do corpus privado.

## Descobertas

Medidas contra o oráculo com cenários pequenos (um osso, uma timeline, um caminho) e com os
20 assets amostrados a 30 quadros por segundo (mais instantes fora da grade), não só nos
instantes do `nucleo-compara`.

**Pi.** O oráculo converte graus com `pi = 3.1415927`, não com o pi do `double`: a matriz
de um osso a 90 graus sai com `b = -2,3205e-8` (e não `6e-17`). O núcleo usa o mesmo valor,
e as matrizes do setup batem em todos os algarismos.

**Chaves em float32.** Tempos, valores e pontos de controle das chaves são guardados em
float32. Importa nos limites: uma chave em `0.1` fica em `0.100000001`, e no instante
`0.1` (acumulado em passos) ela ainda não passou. Sem isso, trocas de parte e cores no
instante exato de uma chave saíam erradas (5 assets).

**Bezier.** O oráculo não resolve a curva: amostra o ponto da bezier em 9 parâmetros
uniformes (0,1 a 0,9, em float32) e interpola por retas entre (tempo1, valor1), as 9
amostras e (tempo2, valor2). A solução exata difere até 0,57 px numa curva de 100 px (fora da
tolerância), então o núcleo faz como o oráculo. No `deformar` a curva vai de 0 a 1 e dá a
fração entre os vértices das duas chaves.

**Cor.** Cada canal é limitado a [0, 1] depois da curva (uma bezier de alfa que passa de 0
sai 0, não negativo).

**Região.** Cantos na ordem baixo-esquerda, cima-esquerda, cima-direita, baixo-direita (no
sistema da parte, antes de girar). `ret[2]`, `ret[3]` são a largura e a altura com pixels
sem a rotação do atlas; `corte` = `[x, y, largura, altura]` do original, com `x`, `y`
medidos da esquerda e de baixo; o fator é `largura_da_parte / largura_original`. `girada`
não muda os vértices (só as uvs). Os vértices do oráculo saem em float32 (diferenças de
até 2e-5 px).

**Malha ligada.** Usa os vértices (ou pesos) da `fonte` no mesmo slot; o `deformar` da fonte
vale para ela (a menos de `"timelines": false`).

**Recorte e caminho** não entram em `vertices`; o recorte não muda os vértices das outras
partes na saída.

**Caminho, comprimentos.** Com `velocidade_constante` (o padrão), cada curva do caminho é
medida pela poligonal de **4** retas (parâmetro 0, 1/4, 1/2, 3/4, 1); o comprimento total
(que multiplica a posição percentual) é a soma. Achada a curva, a fração dentro dela
(distância / comprimento da curva) é levada ao parâmetro por **outra** poligonal, de 10 retas,
com interpolação linear do parâmetro dentro da reta; o ponto e a tangente são os da bezier
nesse parâmetro. Medido num caminho de 2 curvas: com esse esquema o osso bate a 7e-5 px;
com 10 retas nas duas etapas erra 13 px, com 4 nas duas, 16 px. Fora do caminho aberto
(posição < 0 ou > total) o osso segue em linha reta pela tangente da ponta, pela distância
que passou.

**Caminho, rotação.** `rotacao` da restrição soma à tangente; o osso gira no mundo por
`(tangente + rotacao - ângulo atual) * mix_girar`, com o ângulo dado em (-180, 180].

**Relógio (como o oráculo conta).** A física reinicia na pose de **setup** (um mundo
calculado sem animação); depois vem um quadro no instante 0 com `dt = 0` (a animação no
tempo 0) e só então os passos de 1/64 s. Sem o quadro em 0, o deslocamento entre o setup e a
primeira chave entra como movimento (o monstro errava 6 px no primeiro quadro).

**Física, padrões.** Campo ausente vale: `inercia` 0,5, `forca` 100, `amortecimento` 0,85,
`massa` 1, `passo` 60 (medidos: ausente dá o mesmo que esses valores escritos).

**Física de rotação (`girar`), o que o oráculo faz.** Medido com um osso só, gravidade,
vento, pai transladando e pai girando; bate a 1e-14 graus nos cenários e a 1e-7 na matriz
nos 3 personagens CC0.
- Estado: desvio `θ` (radianos, somado ao ângulo do osso), velocidade `ω`, o desvio do passo
  anterior e o tempo que sobrou (`sobra`). Tudo zera no reinício.
- Inércia, a cada quadro, antes dos passos: a ponta mostrada no quadro anterior (origem +
  comprimento no mundo na direção mostrada) tende a ficar onde estava. O desvio entre a
  direção da origem para essa ponta e a direção mostrada agora (`ângulo do osso + desvio
  mostrado antes`), vezes `inercia`, soma direto em `θ`, no desvio anterior e no mostrado (não
  passa pela velocidade). A origem anda no máximo `limite * dt` px em cada eixo para essa
  conta: no quadro de `dt = 0` só a rotação do osso conta.
- Passos fixos de `h = 1/passo` enquanto `sobra >= h`:
  `ω -= ((vento * sen a + gravidade * cos a) * comprimento / escala_ref + forca * θ) * h / massa`;
  `θ += ω * h`; `ω *= amortecimento ^ (60 h)`. O ângulo `a` do primeiro passo do quadro é o
  ângulo do osso mais o desvio mostrado (o do quadro anterior, com a inércia); nos passos
  seguintes, o ângulo do osso mais `θ`. `escala_ref` é a do esqueleto (padrão 100) e o
  comprimento é o do osso no arquivo.
- Mostrado: `desvio anterior + (θ - desvio anterior) * sobra / h` (a física aparece com um
  passo de atraso, interpolada), vezes `girar` e `mix`, girando a matriz do osso no mundo.
  O "desvio anterior" é o `θ` de antes do **primeiro** passo do quadro, e não o do penúltimo
  passo: num quadro com dois passos, o mostrado vai do `θ` do quadro anterior ao `θ` novo.
  Só aparece com quadros maiores que `h` ou com a soma do relógio passando do passo (a 1/64 s
  nunca há dois passos num quadro, e a medida antiga não via): a 1/60 s o monstro errava
  0,31 px a partir do 8º quadro e a 1/50 s um osso sintético errava 0,86 grau no 5º quadro;
  com a correção os dois batem a 1e-14 grau, e os 3 personagens CC0 batem a 1/50, 1/60 e
  1/64 s.
- Gravidade positiva puxa para y negativo na saída (y para cima); vento positivo empurra para
  x positivo.

Ainda não medido (nenhum asset usa): física de `x`, `y`, `escala_x`, `cisalha_x`; `passo`
diferente de 60 (o expoente `60 h` do amortecimento é suposição); `limite` pequeno o bastante
para cortar movimento real; timelines de física.

**IK (cenários sintéticos; nenhum asset usa).** Um osso: a rotação local passa a ser
`atan2` do alvo no sistema do pai (menos `cisalha_x`), misturada por `mix` pelo menor ângulo;
`comprime`/`estica` multiplicam `escala_x` por `1 + (distância / comprimento no mundo - 1) *
mix`. `uniforme` não muda nada no oráculo (medido: só a escala ao longo do osso). Dois ossos
com escala uniforme no pai: lei dos cossenos no sistema do pai do primeiro osso, com `l1` = da
origem de a à de b e `l2` = da origem de b à ponta, ambos medidos no mundo e levados a esse
sistema; cada osso mistura a própria rotação com `mix`. Suavidade: com `s = d - l1 - l2 +
suavidade > 0`, a distância usada vira `d - (s - suavidade * (1 - p²))`, `p = min(1, s / (2
suavidade)) - 1`. Bate a 1e-5 px com dobra, mix, suavidade, estica, comprime, filho fora do
eixo, avô com escala não uniforme e timeline de IK. Primeiro osso com escala **não uniforme**:
o oráculo põe o filho no eixo x do pai (y local 0) e resolve a ponta numa elipse; o núcleo faz
o mesmo numericamente e bate quando o alvo está ao alcance; com o alvo fora de alcance (longe
ou perto demais da origem) o oráculo escolhe outra configuração (até 260 px de diferença; em
aberto).

**Transformação (cenários sintéticos; nenhum asset usa).** Formato 4.3: `propriedades` é um
mapa da propriedade da fonte (`girar`, `x`, `y`, `escala_x`, `escala_y`, `cisalha_y`) para
`{deslocamento, para: {<propriedade do alvo>: {deslocamento, max, escalar}}}`. Para cada par:
`v = fonte - deslocamento_de`, `alvo = deslocamento_para + v * escalar`, com `limitar`
preso entre `deslocamento_para` e `max` (padrão de `max`: 1). No mundo, o osso vai até `alvo`
pela fração `mix` da propriedade (girar pelo menor ângulo; escala muda o comprimento do eixo;
`cisalha_y` gira o eixo y); com `somar`, soma `alvo * mix` (na escala, `(alvo - 1) * mix`).
Com `alvo_local`, a mesma conta na pose local do osso; com `fonte_local`, os valores vêm da
pose local da fonte. Medidos no oráculo: a rotação de mundo da fonte sai em [0, 360); a
cisalha de mundo da fonte não é embrulhada (pode sair -345 em vez de 15, o que só importa com
`limitar`); sem `mix_y`, vale `mix_x` só se alguma propriedade vai para `x` (senão 0), e o
mesmo para `mix_escala_y` com `escala_x`. Bate a 2e-5 px em 50 combinações (mundo e local,
somar, limitar, mix parcial, propriedades cruzadas, timeline de mix).

**Caminho, cadeia de ossos (cenários sintéticos).** Espaçamento `length` (comprimento do osso
no mundo + `espacamento`), `fixed` e `percent` (de `total`) batem a 1e-6 com 3 ossos, assim
como caminho fechado, `velocidade_constante: false` (usa `comprimentos` e o parâmetro linear)
e mix parcial. `proportional`: cada vão é `espacamento * total * comprimento_i / soma`, com a
soma só dos ossos antes do último (n - 1 vãos; medido). Nos modos `chain`/`chainScale` só o
primeiro osso vai ao ponto do caminho; cada osso aponta do seu começo para o ponto seguinte
(calcula-se um ponto a mais depois do último osso), e `chainScale` estica o osso até ele. Em
`chain` sem `rotacao`, o osso seguinte começa na ponta do anterior já girado, misturada com o
ponto do caminho por `mix_girar`; com `rotacao` (ou em `chainScale`), começa no ponto do
caminho. Em aberto (diferenças medidas, nenhum asset usa): `chain` com pontos depois do fim do
caminho e mix parcial (até 23 px), `chainScale` com `proportional` (até 500 px), posição
`fixed` muito perto do começo (0,002 na matriz).
