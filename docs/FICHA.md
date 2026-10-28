# Ficha do personagem

Um `.md` ao lado do `.spine-json` (`pessoa.spine-json` → `pessoa.ficha.md`) que diz o que o personagem é, o que o rig permite e o que cada animação deve fazer. Serve a três leitores:
- **quem riga:** o que o rig precisa permitir;
- **quem anima** (gente ou Claude): intenção, limites e o que não fazer;
- **a máquina:** regras verificáveis que o Mamulengo confere.

Exemplos: `tests/assets/*/rig/*.ficha.md` (personagens CC0).

## Gerar e conferir

```sh
npm run ficha -- draft <x-data.tres>        # rascunho: rig medido, código do jogo, uma seção por animação
npm run ficha -- check <x.ficha.md>         # confere todas as animações; sai com 1 se alguma regra falhar
npm run ficha -- check <x.ficha.md> --anims festa
```

- **O rascunho** mede o asset (constraints e onde o animador as liga, faixa usada em cada osso, trocas de imagem, peças que somem atrás de outras), procura no projeto Godot onde cada animação é chamada e o que toca depois, lê o mix do `-data.tres` e propõe regras que as animações de hoje cumprem (a `transicao` que hoje pula fica comentada, com a medida).
- **O que falta preencher** fica marcado com **(descrever)**: intenção, personalidade, o que não fazer.
- **Pelo editor:** os comandos `ficha.draft` (sem o contexto do jogo) e `ficha.check {text}`.

## Estrutura

```markdown
# Ficha: <nome>

## Personagem
- Quem é, jeito de mexer, exagero aceito
- Onde aparece no jogo, tamanho na tela, ciclo (o que toca quando), transições
- O que não mudar (nomes, bounds)

## Rig
### O que é preso a que      (constraints e quando ligam)
### Gestos prontos           (trocas de imagem)
### Cuidados                 (costuras, camadas, física, peças soltas no rosto)
### Faixas usadas pelo animador
```regras
(regras que valem para todas as animações)
```

## Animacao: <nome>
- Para que serve / Quando toca / Duração / Mexe em
- Roteiro (batidas): tempo -> o que acontece
- Comportamento esperado: o que o jogador sente e lê
- Não fazer
```regras
(regras desta animação; somam com as do Rig)
```
```

A seção precisa começar com `## Animacao: <nome>` (com ou sem acento) para as regras valerem para aquela animação. `## Rig` vale para todas.

## Regras

Uma por linha, dentro de um bloco cercado por três crases e a palavra `regras`. `#` inicia comentário. Nomes com espaço vão entre aspas.

| regra | confere |
|---|---|
| `duracao 0.9..1.1` ou `duracao 4` | duração em segundos (faixa ou valor exato) |
| `loop [tol]` | o fim emenda no começo (ossos no mesmo lugar, física fora) |
| `termina_como 1.idle [tol]` | a pose final fica perto do começo de `1.idle`. Use em toda animação que o jogo emenda em outra: o mix é curto e o salto aparece. |
| `comeca_como 1.idle [tol]` | o começo combina com outra animação |
| `transicao 1.idle 0.1 [tol]` | tocada uma vez e enfileirada em `1.idle` com mix de 0,1 s (o `queueAnim` do jogo), nenhum osso pula na emenda. Mede, para cada osso, a maior velocidade e o maior giro durante a mistura contra o resto da sequência (antes, nesta animação, e depois, em `1.idle`). Pula quando passa de `tol` vezes o resto (padrão 1,5) mais um piso (10% do tamanho do personagem por segundo, 90°/s). O mix é o do `-data.tres`. |
| `corte 3.win 0.1 [tol]` | interrompida por `3.win` (o `playAnim` do jogo) em 10 instantes espalhados, nenhum corte pula. Vale o pior. |
| `limite braco_e rotate -63..44` | valor local relativo ao setup, amostrado a 30 fps (canais: rotate, x, y, scaleX, scaleY, shearX, shearY) |
| `preso oculos cabeca 8` | a peça não sai mais que 8 unidades da relação de setup com a outra |
| `fisica orelha 25` | ponta com física não passa de 25° do setup, em relação ao pai |
| `parado tronco` | o osso não tem timeline nesta animação |
| `constraint oculos_na_mao desligada` | `ligada`, `desligada` ou `"liga e desliga"` |
| `evento passo 0.2..0.4` | o evento acontece nesse intervalo |
| `troca mao_aberta mao_joinha` | o slot mostra essa imagem em algum momento (`nenhuma` = esconde) |
| `exceto 4.win,5.win` | na seção Rig: a próxima regra não vale para essas animações |

**Personagem novo, sem animações:** o rascunho não tem faixas do animador para propor limites. Use as do estilo da casa (`docs/ESTILO.md`) para o tipo de personagem e ajuste com poses extremas no rig.

Escolha de tolerância:
- **Animação que existe:** a medida dela (o rascunho já faz isso e anota em comentário).
- **Animação nova:** o que a intenção pede. Um "preso" de verdade fica em menos de 8; um balanço que o animador faz de propósito, no que ele faz.

## O que pensar além do óbvio

Ao escrever ou completar uma ficha, passe por esta lista. Nem tudo vira regra, mas o que importa vira pelo menos uma linha em "Cuidados" ou "Não fazer".

**No jogo**
- **Quem chama e como:** por nome (renomear quebra o jogo); `play` substitui a animação atual, `queue` espera; loop ou uma vez.
- **O que toca depois e o mix:** pose final compatível (`termina_como`) e emenda sem pulo (`transicao`). Veja na timeline com "depois desta" e meça com `query.transition`.
- **Interrupção:** um prêmio pode cortar o idle_break no meio. Qualquer quadro precisa misturar bem com a próxima animação: sem pose impossível no meio (`corte`; na timeline, "interromper em").
- **Primeiro quadro e setup:** o jogo pode mostrar a pose de setup ou o quadro 0 no carregamento (`poseNow`). Os dois precisam estar apresentáveis.
- **Time scale:** turbo ou modo rápido acelera tudo. Gesto de 0,1 s some a 2x.
- **Frequência:** o idle roda o tempo todo, então nada nele pode cansar; uma quebra que aparece a cada 10 s não pode ser chamativa.
- **Hierarquia de intensidade:** ganho normal < big < mega; perda menor que ganho. A animação nova precisa caber nessa escada.
- **Enquadramento:** o jogo encaixa o personagem pelos bounds do cabeçalho. Mudar os bounds desloca o personagem; passar deles invade a interface (não há recorte).
- **Espelhamento:** se o jogo vira o personagem (scale x -1), assimetrias e textos aparecem ao contrário.
- **Som e efeitos:** eventos Spine nos tempos em que o som deve tocar; nomes combinados com quem programa.
- **Tracks:** algo em track separada (piscar, por exemplo) não pode brigar com as chaves da animação principal.

**Na tela**
- **Tamanho real:** no celular, detalhe pequeno (pupila, sobrancelha) só lê se for claro e segurado (0,3 s ou mais).
- **Legibilidade:** cada gesto precisa ser visível. O que está atrás de outra peça não conta.
- **Silhueta:** gestos fortes leem melhor longe do corpo (o hang loose fora do tronco).
- **Acessibilidade:** sem flashes rápidos de tela inteira nem tremor longo.

**No rig**
- **Costuras:** malhas com pesos abrem se girarem além das faixas.
- **Camadas:** peças que passam por baixo de outras e somem.
- **Constraints com limite** (`max`): saturam e descolam.
- **Física:** precisa de comprimento no osso; no spine-godot a gravidade é invertida. Ligada no setup, roda em todas as animações; com mix por animação, roda só onde se quer.
- **Trocas de imagem:** ao mostrar uma mão alternativa, esconda a mão normal inteira (dedos, polegar, relógio).
- **Deforms:** copiados de outra animação dependem das chaves que os acompanhavam.

**No runtime**
- **O que o spine-godot faz diferente:** pma, screen, multiply, cor escura. O docs/PARIDADE.md lista.
- **Desempenho:** muita física, deform pesado e clipping custam no celular.

**Na marca e na cultura**
- **Gestos:** têm significado (joinha, hang loose). Confira se o gesto é bem lido no público do jogo.
- **Coerência entre personagens:** papéis com os mesmos nomes (o código busca por papel: "1.idle" ou "2.idle").
