# Animar com o Mamulengo

Guia para o Claude Code criar ou mudar animações num rig que outra pessoa montou. Objetivo: explorar tudo o que o rig oferece sem quebrá-lo, com movimento coerente, e só mostrar ao usuário o que foi conferido.

O fluxo inteiro (pedido, ficha, rig, animação, entrega) está em `docs/FLUXO.md`; a ficha do personagem, em `docs/FICHA.md`.

Regra geral: anime como o animador do rig animaria. Se o usuário pedir algo incoerente de propósito (cartoon exagerado, membro girando 360°, peça saindo do corpo), faça, e diga em uma linha o que foge do rig.

## 1. Estudar antes de mexer

0. Leia as **notas abertas** do personagem (`mamulengo_notas listar abertas`): são pedidos e avisos da equipe. Ao terminar, responda e resolva as que fez. Antes de mexer pesado, **marque uma versão** (`mamulengo_versoes marcar`).
0. Leia a **ficha** do personagem (`<nome>.ficha.md`, ao lado do `.spine-json`). Se não existir, gere com `npm run ficha -- draft <x-data.tres>` (lê também o código do jogo) e complete a intenção antes de animar.
1. `mamulengo_open` no asset. Nunca edite os arquivos do jogo direto: trabalhe numa cópia, a menos que o usuário peça para gravar no jogo.
2. `query.tree`: hierarquia de ossos e slots.
3. `query.rig` (com `exclude` nas suas próprias animações) é o mapa do que pode e do que não pode:
   - **constraints:** o que cada uma liga e em quais animações o animador a deixa ligada ou desligada. Uma constraint desligada em quase tudo indica que é um truque para um gesto específico. Num personagem de óculos, `oculos_na_mao` prende os óculos na mão só na animação em que ele tira os óculos; no resto, os óculos são da cabeça.
   - **faixas:** os valores (relativos ao setup) que o animador usou em cada osso. É o limite natural do movimento. Passar muito disso sem motivo costuma quebrar a arte: aparecem costuras, recortes e articulações impossíveis.
   - **trocas:** as imagens alternativas de cada slot (mãos em outras poses, olhos fechados, objetos). São os gestos prontos do rig, e vale a pena usá-los.
   - **atencao:** peças que passam por baixo de outras (pupila sob a cabeça, sorriso sob o focinho), que somem se andarem demais, e física sem comprimento.
4. Veja as animações existentes do jeito que o usuário vê: `mamulengo_look` com `fit:false, scale:2` nos momentos fortes, e `query.animation {detail:true}` nas que se parecem com o pedido. Repare no ritmo (duração, quantas batidas), na amplitude e em quais partes o animador nunca mexe.

## 2. Planejar como animador

**Quanto mexer** vem do estilo da casa (`docs/ESTILO.md`): ache o tipo e o papel da sua animação (personagem/ganho, símbolo/queda, popup/entrada...) e mire na mediana: quanto o corpo anda, o maior giro, quanto amassa, quantas batidas por segundo, quanto segura parado. Quem anima do zero tende a fazer tudo certo e tímido; a régua existe para isso.

**Qualidade** vem da rubrica (`docs/RUBRICA.md`): silhueta, pose clara, antecipação, contraste de tempo, squash, arcos, assentamento, rosto e mãos, personalidade e emenda. A meta é nota 9; avalie-se por ela antes de entregar.

Escreva o roteiro **na ficha**, na seção `## Animacao: <nome>`, antes das chaves: para que serve, quando toca, batidas com tempo em segundos (uma ideia por batida), comportamento esperado, o que não fazer e as regras verificáveis (`termina_como` se o jogo emenda em outra, `constraint`, `preso`, `fisica`, `troca` e `estilo <papel>`, que reprova animação abaixo da mediana da casa em amplitude, silhueta e ritmo).

**Poses primeiro.** Antes de qualquer intermediário, monte só as poses-chave (3 a 5: entrada, antecipação, pose principal, passada do ponto, saída), com chaves stepped, e olhe cada uma grande (`look` com `time`) e todas juntas pequenas (`look` com `times`). Pergunte: a silhueta muda? A pose principal lê de longe? Está forte o bastante para o papel? Só depois troque stepped por curvas e acrescente atraso, arcos e assentamento. Pose fraca não melhora com intermediário bom.

- **Legibilidade:** cada gesto precisa aparecer na tela. Olhar de lado com óculos escuros não se lê; primeiro baixe os óculos e depois mova as pupilas.
- **Antecipação, ação, continuidade, assentamento.** A ação principal pede um contra-movimento antes e um passar do ponto depois (`anim.anticipate`, `anim.overshoot`).
- **Hierarquia:** o corpo lidera e o resto chega depois. Cabeça e braços atrasam de 0,03 a 0,08 s; pontas (orelha, cabelo, aba, rabo) ficam com a física ou com `anim.overlap`. Cabeça e corpo inclinam para o mesmo lado, com atraso, e não um contra o outro.
- **Arcos e volume:** membros giram em arco; agachar e esticar preservam o volume (scale x sobe quando y desce).
- **Peças presas continuam presas:** mão no objeto, óculos no rosto, chapéu na cabeça. Quando o corpo se move e a peça depende de outra cadeia, use `pose.follow`.
- **Reaproveite o animador:** poses, mãos e deforms dele valem mais que os inventados (`keys.copy` e `keys.paste`). Um deform copiado só funciona junto das chaves que o acompanhavam na origem (boca, sobrancelha, boné); confira.
- **Loop:** o fim é igual ao começo, e o último quadro não pode dar salto.
- **Emendas:** animação que o jogo toca e depois volta ao idle começa e termina na pose de entrada dele. Use `anim.match {anim, like:"1.idle", at:"ambos"}` e confira com `termina_como` e `comeca_como` na ficha. A comparação inclui rotação e escala: um corpo que termina achatado salta, mesmo com os ossos no lugar.
- **Tempo:** 30 fps. Gestos de 0,1 a 0,3 s, poses seguradas de 0,3 a 0,6 s; nada de tremer sem querer. Animação de ganho da casa dura uns 1 a 1,3 s: curta e densa, com 4 batidas por segundo.
- **Contraste de curvas:** o impacto entra seco (`sai-rapido`, linear ou stepped) e a chegada desacelera. O animador da casa usa linear e stepped em boa parte das chaves de ganho; tudo `suave` deixa a animação flutuando.
- **Squash:** amasse o corpo no impacto e estique no salto (escala no osso do corpo ou deform de malha), preservando volume.

## 3. Construir

- **Gerador reprodutível:** gere o lote de comandos por script, em vez de digitar chave por chave. Rodar `animation.delete` e o gerador de novo refaz tudo do zero; ajustar é mudar um número e repetir.
- **`space:"world"`:** use em `key.set` de translate para pensar na tela (y para cima). Sem ele o x/y é do osso pai: num pai que aponta para cima (tronco, cabeça), y local é "para a esquerda", e uma respiração em y vira balanço de lado. As regras `limite` da ficha também medem no espaço do pai. Prefira curvas por nome: suave, forte, sai-rapido, elastico, stepped.
- **Constraints:** ligue e desligue como o animador faz, com chave de mix na própria animação (ex: `{constraint:"oculos_na_mao"}`, timeline `transform`, `mixRotate/mixX/mixY`). Não mude o setup de uma constraint se uma chave resolve.
- **Física:** `physics.preset` já dá comprimento ao osso. Se o setup tem mix 0, ligue com uma chave de mix 1 só na sua animação. A amplitude depende da violência do movimento: conferir sempre.
- **`pose.follow`:** para cadeias que seguram algo. Ele grava rotate na cadeia a cada 1/fps e confere entre as chaves. Se responder `atencao`, ponha mais chaves no trecho rápido ou verifique se um constraint com limite (`max`) está saturando.
- **Setup e animações existentes:** não toque nelas sem pedido. Acréscimos são aceitáveis: seus ossos, slots e efeitos, ou comprimento em osso de física (não muda o desenho).

## 4. Conferir antes de mostrar (obrigatório)

Folha de contato pequena e "igual ao Godot" não validam animação. "Ver no Godot" só prova que o editor desenha como o jogo.

1. **`query.estilo {anim}`** (e a regra `estilo` da ficha): mede com a régua da casa e diz o que ficou ABAIXO ou ACIMA da faixa do papel. Abaixo sem motivo é animação tímida: aumente amplitude e ritmo e troque pose parada por pose que respira.
2. **`ficha.check`** (ou `npm run ficha -- check <ficha.md> --anims <nome>`): todas as regras da ficha, as suas e as do Rig.
3. **`query.motion`** nos ossos principais: para que lado cada um gira e anda na tela, trecho a trecho. Compare com o roteiro. Valores de chave enganam, porque rotação de setup e constraints mudam o resultado.
4. **`query.relation`** em toda peça que deve ficar presa (óculos e cabeça, mão e objeto) e nas pontas com física (ângulo relativo ao pai; mais de uns 20° costuma parecer quebrado).
5. **Faixas:** compare seus valores com `query.rig`. Passou do que o animador usa? Só com motivo.
6. **Olhe de perto:** pelo MCP, `mamulengo_zoom {times, bones:["mao_e"]}` recorta um osso (com os filhos) ou partes e mostra até 8 instantes no mesmo quadro. Use nas mãos, no rosto e em toda troca de imagem.
7. **Olhe grande:** `look` com `fit:false, scale:2` ou `3` nas batidas, recortando rosto e mãos. O `look` mostra o enquadramento do viewport; para recortar uma região do mundo use o método `render` da ponte (`{animation, times:[...], rect:[x, y, largura, altura], size:[w, h]}`, y para cima; o CLI grava com `--png`), que devolve um PNG por instante. Procure peça sumindo atrás de outra, costura, imagem errada após troca, giro para o lado errado. (O primeiro `look` de uma sessão pode sair pixelado; repita.)
8. **Emenda com o que vem depois:** se o jogo enfileira outra animação (ganho que volta ao idle) ou corta esta no meio (prêmio que interrompe o idle_break), olhe a sequência como o jogo toca: `look` com `sequence: {next: "1.idle"}` (sem `mix`, o do jogo; `at` para interromper), quadros densos na faixa marcada "mix". Meça com `query.transition` (`cuts: 10` para interrupção) e ponha `transicao`/`corte` na ficha. Um osso com `score` acima de 1 anda ou gira na emenda bem mais rápido do que em qualquer outro momento: é o pulo que o jogador vê. Corrija a pose final (ou a inicial da seguinte), não o mix do jogo.
9. **Exporte** (`mamulengo_export`, com `fit:true` para enquadrar a animação inteira) e olhe quadros do próprio GIF, inclusive o primeiro e o último (loop). Com `sequence`, o GIF mostra a emenda.
10. **Torção de malha:** `query.malha {anim}` aponta os instantes em que alguma malha dobra ou estica fora do resto (braço erguido demais torce o ombro, mão vira gigante). Olhe cada um grande (`mamulengo_zoom`): se a arte quebrou, reduza o giro, corrija com deform ou troque a imagem. Arte quebrada em qualquer quadro limita a nota a 6.

    **Recorte à mostra:** `query.recorte {anim, exclude:[as suas]}` mede a borda que na pose de setup fica escondida atrás de outra imagem, perto da articulação (toco do braço sob o ombro, topo da perna sob o quadril, pescoço sob a cabeça), e que a animação descobre. O que as animações do animador também descobrem não conta. Acima de ~10% da altura, olhe grande: reduza o giro, mude a ordem de desenho no trecho ou corrija com deform.

11. **Rubrica:** dê a nota de `docs/RUBRICA.md` olhando a folha pequena e os quadros grandes, critério por critério. Abaixo de 9, corrija os três pontos que mais sobem a nota e confira de novo.
12. **Rig intacto:** `ficha.check` em todas as animações (não só na sua), e `query.rig` de novo e confira que as constraints e as animações do animador estão como antes. Melhor ainda, compare o JSON das animações originais com o do jogo.

Ao apresentar: o que fez, o que conferiu e como, e o que não conferiu.

## 5. Armadilhas já vistas

- **Física de rotação em osso de comprimento 0** dá voltas inteiras: a física balança a ponta do osso.
- **Girar um braço que tem constraint ligada** leva junto o que está preso nele (óculos voando).
- **Pupilas** passam por baixo da cabeça e somem: movimento de poucos pixels.
- **Em loop**, a pose em t = duração é a de t = 0. Ao medir o fim, use um instante um pouco antes.
- **Peças invisíveis também contam:** um brilho que termina longe, mesmo com alfa 0, salta no mix para a próxima animação (`termina_como` pega).
- **Comparações com o Godot** usam passo de 1/64 s (a física diverge com 1/60).
- **Emenda que só aparece no mix:** a pose final pode combinar com a seguinte (`termina_como` passa) e ainda assim pular, porque nos últimos 0,1 s a animação ainda se move e a mistura soma os dois movimentos (num personagem de jogo, o braço de um ganho gira o dobro do normal ao voltar ao idle). Só `query.transition` ou olhar a sequência mostram.
- **Peça que a próxima anima só depois:** no spine-godot, enquanto a animação seguinte não chega na primeira chave de uma peça, a peça fica inteira com o valor da anterior durante o mix (o editor reproduz).
- **O spine-godot** inverte a gravidade da física (scaleY -1), ignora pma e desenha screen como subtração: o editor já reproduz, então confie no que o editor mostra no modo godot. As medidas (`query.motion`, `ficha.check`, `query.transition`) também usam a física do jogo.
- **Gravidade em física de rotação:** no jogo ela puxa para o lado contrário do editor do Spine. Um pingente com gravity 40 que balança forte termina torto (num teste, 60° no fim da animação) e salta na emenda. A casa usa gravity 0 e só a mola; `query.rig` avisa. Em toda animação que mexe numa peça com física, ponha `termina_como` na ficha: é ela que pega a peça que não voltou.
