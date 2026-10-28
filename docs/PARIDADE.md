# Paridade com o motor

Como o Mamulengo confere que o que o editor mostra é o que o jogo mostra: os testes de paridade, o corpus livre e as diferenças medidas entre o editor do Spine e o runtime que os jogos usavam (spine-godot), que o editor reproduz. A visão geral está no [README](../README.pt-BR.md).

## Gates de paridade

Rodam contra um corpus de projetos que **não** fica no repo (passe o caminho), ou contra o corpus livre `tests/assets` (seção seguinte):

```sh
npm run gate:parse -- <raiz>         # o runtime oficial lê e toca todo asset Spine
npm run gate:roundtrip -- <raiz>     # abrir/salvar devolve os mesmos bytes; editar gera diff mínimo
npx tsx tools/atlas-roundtrip.ts <raiz> <tmp>   # desempacotar e reempacotar atlas sem perda
npx tsx tools/parity.ts <x-data.tres>           # editor vs Godot com spine-godot, frame a frame
npx tsx tools/parity.ts <x-data.tres> --anim A --next B [--mix 0.1|jogo] [--at t] [--loop]   # a emenda A -> B, pixels e ossos
tools/parity-all.sh <raiz> <saida>              # o anterior no corpus inteiro
npm test                                         # fixture sintetica: todos os comandos, sem assets externos
npx tsx tests/corpus.ts                          # corpus livre do repo (abaixo)
npx tsx tools/acceptance-kit.ts <x-data.tres> <saida> --anims a,b [--spine <projeto>]   # kit do teste de aceitacao (imagens + layout + referencias)
npx tsx tools/compare-anim.ts <a-data.tres> <b-data.tres> <saida> --anims a,b   # lado a lado em GIF
npx tsx tools/blend-fixture.ts <saida> <projeto de jogo>   # fixture de blend/cor escura para o parity.ts
npx tsx tools/bench.ts <x-data.tres>[@anim] ...      # desempenho no navegador aberto (ms por edicao, quadro, poseAt, salvar)
npx tsx tools/psd-composite.ts <x-data.tres> <arte.psd> [--godot]   # setup no editor (e no Godot) vs composicao do PSD, pixel a pixel
npx tsx tools/psd-fixture.ts                     # regera os PSDs de teste (tests/assets/psd)
npx tsx tools/boneco.ts importar|exportar ...   # formato proprio .boneco (docs/FORMATO.md): ler e exportar Spine
npx tsx tools/diario.ts <abrir|etapa|nota|medida|cmd|fechar|md> ...   # diario de processo (DIARIO=<pasta>): etapas com duracao, medidas, notas por tipo, comandos com saida
```

## Corpus livre (tests/assets)

Três personagens com arte CC0 (Kenney; fontes e licenças em `tests/assets/LICENSES.md`), em estilos diferentes: `aventureiro` (cartoon), `monstro` (mascote, estilo símbolo de slot) e `pessoa` (corpo humano com mangas que dobram). `tests/assets` é um projeto Godot mínimo; cada personagem tem:

- `partes/`: as imagens soltas, com nomes claros (o que a arte entrega);
- `rig/`: o asset montado só com comandos do Mamulengo (`tools/corpus-build.ts`): ossos, slots, imagens posicionadas pelo mundo, malha com pesos, física e animações (`idle` e mais uma). Sai no formato do jogo: `.spine-json`, `.atlas`, página `.webp` e `-data.tres`.

```sh
npx tsx tests/corpus.ts                 # runtime toca tudo, bytes do formato, atlas sem perda, layout, rig == build
npx tsx tools/corpus-build.ts           # remonta os rigs (depois de mudar um comando: rode e revise o diff)
```

`tests/assets/psd/` tem o aventureiro em camadas (`aventureiro.psd`, com grupos, camadas escondidas e as tags do PhotoshopToSpine) e a mesma arte retocada (`aventureiro-v2.psd`), gerados por `tools/psd-fixture.ts` a partir das partes CC0. O `npm test` monta o personagem pelo primeiro e atualiza com o segundo.

Use no lugar de assets privados, que não podem entrar no repo:

```sh
npm run gate:parse -- tests/assets
npm run gate:roundtrip -- tests/assets
npx tsx tools/atlas-roundtrip.ts tests/assets <tmp>

# paridade com o Godot de verdade: copia o corpus e empresta o spine-godot de um projeto que o tenha
npx tsx tools/corpus-project.ts <dir> --spine <projeto Godot com spine-godot>
npx tsx tools/parity.ts <dir>/monstro/rig/monstro-data.tres --anim all   # editor aberto, <dir> em MAMULENGO_ROOTS
npx tsx tools/parity.ts <dir>/monstro/rig/monstro-data.tres --anim ganhou --next idle --mix 0.2            # emenda enfileirada
npx tsx tools/parity.ts <dir>/monstro/rig/monstro-data.tres --anim ganhou --next idle --mix 0.15 --at 0.37 # interrompida

# kits do teste de aceitação (um por personagem), com o editor aberto e o corpus em MAMULENGO_ROOTS
npx tsx tools/corpus-kit.ts <saida> [--from <dir>] [--spine <projeto>]
```

Os binários do spine-godot não entram no repo: `--spine` só os liga por symlink.

Emendas medidas (spine-godot dos jogos, quadros espalhados e densos na mistura): nos três personagens, enfileirada (mix 0,2) e interrompida (0,37 s, mix 0,15), e no monstro com o idle em loop interrompido, os ossos ficam a menos de 0,0002 unidade do Godot e o erro médio de pixel fica entre 0,12 e 0,25/255. Num personagem de slot (cinco emendas do jogo com o mix do `-data.tres`), ossos a menos de 0,0002; os pixels ficam no mesmo nível da animação sozinha (1,4% de bordas finas no enquadramento de 600 px, que já aparece sem emenda).

## Diferenças do spine-godot que o editor reproduz

Medidas com `tools/parity.ts` e `tools/bones-parity.ts`:

- **Alpha:** o spine-godot ignora `pma:true` do atlas e desenha com alpha simples. Atlas novos saem com `pma:false` (assim as bordas ficam certas no jogo).
- **Texturas:** o jogo usa o `.ctex` do import do Godot (`fix_alpha_border`, compressão), não o arquivo-fonte.
- **Física:** o spine-godot roda o esqueleto com `scaleY = -1`, o que inverte a gravidade das físicas de **rotação** em relação ao editor do Spine (a de posição segue o `scaleY` e fica igual). As medidas do editor (`query.motion`, `ficha.check`, `query.relation`) simulam como o jogo (`godotGravity` em `src/core/pose.ts`). Consequência vista: um pingente com gravidade terminava 60° torto no jogo; os membros pendurados de um personagem sobem no jogo e pendem no Spine. A casa usa gravity 0 (só a mola); o preset `pendurado` também.
- **Blend screen:** o spine-godot desenha screen com `BLEND_MODE_SUB` (subtracao).
- **Filtro de textura:** vem do projeto Godot (`default_texture_filter`), nao do atlas.
- **Multiply:** `BLEND_MODE_MUL` do Godot: destino x cor da textura x tint, sem premultiplicar e sem olhar alpha nenhum (do slot, do attachment ou da textura). Uma imagem com borda transparente escurece o retangulo inteiro, com o RGB que estiver sob o alpha 0. Reproduzido com uma copia da pagina sem premultiplicar (um asset privado com multiply: erro medio 17.4 para 0.8/255). No jogo, isso aparece como um retangulo escuro sobre a imagem; um shader de multiply com alpha (`cor * alfa + 1 - alfa`, como o editor do Spine mostra) corrige (testado no Godot, numa copia; a correcao no jogo e da equipe).
- **Cor escura (two-color tint, `dark`, `rgba2`/`rgb2`):** o binario do spine-godot que os jogos usam nao tem o shader "tint black" e ignora a cor escura. O upstream 4.3 mais novo desenha `tex.rgb * light + (1 - tex.rgb) * dark` (igual ao spine-webgl, algebricamente). O servidor olha o binario do projeto (`x-godot-tint-black`) e o editor segue o que ele faz. Fixture: `tools/blend-fixture.ts` (erro medio 0.33/255 com multiply, add, screen e cor escura).
- **Relogio do esqueleto:** cada quadro comparado parte de um SpineSprite novo (tempo 0). A fisica mede o passo por diferenca de tempo; o editor zera o relogio a cada pose.
- **Física de rotação precisa de comprimento no osso:** o balanço é da ponta do osso. Com comprimento 0, o osso dá voltas inteiras. `physics.create`/`physics.preset` estimam o comprimento pelas imagens do osso quando ele não tem.
- **Mix (dona da propriedade):** o binário do spine-godot dos jogos é um 4.3 mais antigo que o spine-ts. Nele, a dona de cada propriedade é a entrada da trilha, não a trilha: na animação que está entrando, o que a anterior anima vira "current" em vez de "first". Antes da primeira chave da nova, a peça fica inteira com o valor da que sai; o spine-ts a puxaria para o setup na proporção do mix. Depois da primeira chave, as fórmulas são iguais. Num personagem de slot (idle interrompido por um ganho), os óculos ficavam 2,65 unidades fora sem isto e ficam a 0,0002 com isto. O editor reproduz no modo godot (`likeSpineGodot` em `src/core/sim.ts`).
- **Troca de animação no passo seguinte:** o AnimationState só troca para a animação enfileirada no `update` seguinte ao que passou do ponto, e a sobra do passo vai para a nova. A emenda depende do tamanho do passo, então a prévia anda sempre em passos de 1/64 desde 0 (na interrupção, o passo é cortado no instante da troca), igual no harness do Godot.
- **Enfileirar com delay 0** (`add_animation(nome, 0, ...)`, o `queueAnim` dos jogos): a seguinte entra quando falta o mix para a atual acabar (delay = duração - mix). A atual, se não for loop, segura o último quadro durante a mistura. Interromper (`set_animation`) mistura a partir do instante do corte, com a anterior continuando a andar durante o mix.
- **Passo fixo:** comparações usam passo de 1/64 s. Com 1/60, três passos somam exatamente o passo da física a 20 fps, e float32 (Godot) e float64 (JS) decidem de lados opostos.
