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
  todos os algarismos (`simularDiff` 0 no bench). É a base para as medidas da etapa C.

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

**Etapa C (o que ainda usa o spine-core no modo núcleo e o que ela vai precisar):**

- As medidas (`query.motion`, `query.relation` e as outras `query.*`), a ficha
  (`src/core/ficha.ts`, inclusive o painel que confere as regras a cada edição), a transição
  (`src/core/transition.ts`), o recorte (`src/core/recorte.ts`) e os comandos que calculam a
  Pose base pelo spine-core (`skeletonAt` em `src/core/pose.ts`: os de malha em
  `commands/meshedit.ts`, `commands/setup.ts`) criam esqueletos próprios. `meshView` já aceita o
  mundo dos ossos de fora (`SetupWorld`); os comandos podem receber o mesmo.
- Para as medidas: `mm_simular` dá o mundo dos ossos em vários instantes; faltam, pelo mesmo
  caminho, os vértices dos slots (para `query.relation` e o recorte), a cor e a parte (para a
  ficha) e a emenda (A e B com mix, com o corte) em vários instantes, e os eventos do intervalo.
- O `look`, o `render`, o GIF e o vídeo exportados já saem pelo núcleo (usam o viewer); só os
  números que acompanham (`query.*` pedidas junto) ainda vêm do spine-core.
- O seletor "desenho" pode passar a ter o núcleo como padrão quando a etapa C tirar o resto.

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
