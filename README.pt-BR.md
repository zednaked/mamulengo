# Mamulengo

**[Experimente ao vivo](https://zednaked.github.io/mamulengo/)**: seis personagens animados pelo núcleo no seu navegador; arraste e veja a física reagir.

![Um robô, um zumbi e um monstro, rigados e animados pelo Claude Code no Mamulengo](docs/media/elenco.webp)

**Um kit de animação 2D por esqueleto para jogos, operado por gente e pelo Claude
Code ao mesmo tempo.** Monte um personagem a partir de um PSD em camadas, anime
numa timeline, ou peça ao Claude pelo MCP e veja cada osso que ele mexe, ao vivo,
no mesmo editor. O personagem é gravado em `.boneco`, um arquivo só e legível,
com o atlas, as transições e uma ficha escrita. Um núcleo em C++, escrito do
zero, toca esses arquivos no Godot (módulo do motor ou GDExtension) e no
navegador (220 KB de WebAssembly). Abre e grava projetos do Spine 4.3, então nada
do que já foi feito fica para trás.

[Read in English](README.md) · Godot 4.5+ · Linux, Windows e macOS

```
466 de 466 roteiros batem com o runtime de referência em todo quadro, eventos também
20 personagens posados em 0,043 ms por quadro (nativo), cerca de 5x mais rápido que o runtime que ele substitui
102 de 102 projetos Spine 4.3 de produção vão e voltam pelo .boneco sem mudar nada
um jogo de slot em staging roda no núcleo: 1 wasm em vez de 3
objetos de GPU criados por quadro nesse jogo: 160 antes, 0,3 agora
```

**Nesta página:** [o que faz](#o-que-faz) · [Claude Code](#com-o-claude-code) ·
[a bancada de agentes](#a-bancada-de-agentes) · [o formato .boneco](#o-formato-boneco) ·
[o núcleo](#o-núcleo) · [use no seu jogo Godot](#use-no-seu-jogo-godot) ·
[num jogo Godot](#num-jogo-godot) · [rodar](#rodar) ·
[estado](#estado)

![O Claude Code montando e animando um robô a partir de peças soltas, sozinho, pelo MCP](docs/media/robo-processo.webp)

*O Claude Code montando e animando um robô a partir de peças soltas, sozinho,
pelo MCP, em 3x a velocidade. Arte: Toon Characters, de Kenney (CC0).*

Mamulengo é o boneco de mão do Nordeste, entalhado em madeira e manejado por
baixo da empanada. Este é manejado dos dois lados: um animador com o mouse e um
agente com ferramentas dividem o mesmo documento, o mesmo histórico de desfazer e
as mesmas regras do que é uma boa animação.

## O que faz

- **Do PSD ao rig.** Largue um `.psd` em camadas e ele monta o personagem na
  composição do PSD, ou atualiza o aberto camada por camada, mantendo animações,
  malhas e pesos. Entende as tags de camada de sempre (`[bone]`, `[slot]`,
  `[skin]`, `[mesh]`...).
- **Animar.** Ossos, timeline com chaves arrastáveis, editor de curvas, cebola,
  eventos, emendas entre animações vistas exatamente como o jogo toca, malhas com
  pesos pintados, pincel de deformar, IK, física, recorte, caminhos, skins.
  Movimentos prontos (respirar, balançar, quicar, entrar estourando, tremer,
  piscar, flipbook) e física pronta (cabelo, orelha, tecido, mola, pendurado).
- **Tudo é comando.** A interface e o Claude chamam o mesmo registro de comandos
  tipados, então desfazer, histórico e "ver o Claude trabalhando" saem de graça.
- **Versões e notas.** Cada gravação vira uma versão que dá para nomear, comparar
  e restaurar; qualquer um prende notas numa animação, num instante e numa parte.
- **Uma ficha por personagem.** `<nome>.ficha.md` diz o que o rig permite e o que
  cada animação deve fazer, com regras que a ferramenta confere: amplitude e
  silhueta contra a mediana da casa, limite de junta depois do IK, malha que
  dobra demais, borda escondida que aparece, emenda que pula.
- **Exportar** GIF ou WebM de qualquer animação ou emenda, como está na tela.

![Dois personagens saindo do ganho e voltando ao idle, a emenda que o jogo toca](docs/media/emendas.webp)

*Do ganho para o idle, visto do jeito que o jogo mistura.*

Guia completo: [docs/EDITOR.md](docs/EDITOR.md).

## Com o Claude Code

Abra o Claude Code nesta pasta e o servidor MCP `mamulengo` está lá
(`.mcp.json`); ele sobe o editor se não estiver rodando.

| ferramenta | para quê |
|---|---|
| `mamulengo_open`, `mamulengo_assets` | achar e abrir um personagem |
| `mamulengo_run` | comandos em lote, um passo de desfazer, tudo ou nada |
| `mamulengo_look` | um quadro ou folha de contato, sozinha ou numa emenda |
| `mamulengo_guia` | o fluxo: ficha, rigar, animar, conferir |
| `mamulengo_notas`, `mamulengo_versoes` | notas da equipe e versões |
| `mamulengo_export` | GIF ou WebM, devolve o caminho do arquivo |
| `mamulengo_psd` | personagem novo a partir de um PSD, ou o aberto atualizado |

Enquanto um agente trabalha, qualquer outra aba do editor o acompanha: o
personagem, a animação e os ossos que ele toca acendem conforme ele avança, e o
que ele escreve entre os comandos aparece como legenda.

![O editor do Mamulengo enquanto o Claude Code trabalha: ferramentas no topo, o robô no palco, versões à esquerda, a atividade do agente à direita e a timeline embaixo](docs/media/editor.webp)

*O editor enquanto o Claude trabalha: cada gravação vira uma versão (à esquerda), cada
comando e nota do agente aparece na atividade (à direita).*

O que o `mamulengo_look` devolve é o que o agente usa para julgar, uma folha de contato
com as poses-chave:

![Folha de contato do ganho do robô, sete poses-chave](docs/media/poses.webp)

## A bancada de agentes

Um Claude Code sem interface recebe um pedido escrito e faz o rig, a ficha e as
animações só pelo MCP, numa pasta isolada. Um agente diretor dá nota pela
rubrica e devolve com observações. A tela pode ser gravada, e é daí que vêm
estes timelapses.

| robô: `ganhou` | zumbi: `anda` | monstro: `ganhou` |
|---|---|---|
| ![robô ganhou](docs/media/robo-ganhou.webp) | ![zumbi anda](docs/media/zumbi-anda.webp) | ![monstro ganhou](docs/media/monstro2-ganhou.webp) |

<details>
<summary>Os outros dois timelapses: o zumbi e o monstro</summary>

![O zumbi sendo montado e animado](docs/media/zumbi-processo.webp)

![O monstro sendo montado e animado a partir de um PSD](docs/media/monstro2-processo.webp)

</details>

Arte: [Toon Characters](https://kenney.nl/assets/toon-characters-1) e
[Monster Builder Pack](https://kenney.nl/assets/monster-builder-pack), de Kenney
(CC0). Rigs, fichas e animações feitos pelo agente. Guia:
[docs/BANCADA.md](docs/BANCADA.md).

## O formato .boneco

Um JSON por personagem: esqueleto, regiões do atlas, animações, os tempos de
emenda que o jogo usa, a compressão das páginas no jogo e a ficha. Os campos são
em português e cada um tem ida e volta com o Spine 4.3, então um `.boneco`
exporta de volta exatamente o JSON e o atlas de onde veio (102 de 102 projetos de
produção, com mediana de 1,05x o tamanho). Onde os dois runtimes que os jogos
usavam discordavam (multiply ignorando o alfa, gravidade da física com sinal
trocado), o formato diz qual vale. Especificação: [docs/FORMATO.md](docs/FORMATO.md).

```sh
npx tsx tools/boneco.ts importar <x-data.tres|x.json> <x.boneco>
npx tsx tools/boneco.ts exportar <x.boneco> <pasta>
```

## O núcleo

`nucleo/` é C++17 sem dependências, escrito em sala limpa: a partir de uma
especificação escrita e de números medidos num runtime de referência usado como
caixa-preta, nunca do código dele. Faz pose (ossos, curvas, slots, regiões,
malhas com pesos, deformar, IK, transformação, caminho e física), estado de
animação (trilhas, fila, mix, eventos) e lista de desenho (lotes por página e
blend, recorte no stencil da GPU ou na CPU).

| medido contra o runtime de referência | resultado |
|---|---|
| pose, 78 animações de 20 personagens, todo quadro a 30 fps | pior osso a 0,00005 px |
| estado de animação, 466 roteiros (tocar, enfileirar, cortar, vazio, mix 0 e 0,2) | todo quadro a menos de 0,0005 px, mesmos eventos no mesmo quadro |
| desenho no navegador, 20 personagens lado a lado | só nas bordas, de 0 a 1,1% dos pixels |
| velocidade, 20 personagens | 0,043 ms por quadro, nativo |

A especificação, e o que foi preciso descobrir para bater (pi em float32, bezier
amostrada em 9 pontos, um passo de física zero no primeiro quadro):
[docs/NUCLEO.md](docs/NUCLEO.md). O `palco.html` toca qualquer `.boneco` pelo
núcleo ao lado da referência, com a diferença pixel a pixel.

## Use no seu jogo Godot

Baixe o `mamulengo-boneco-<versão>.zip` da
[última release](../../releases/latest) (ou pegue o "Boneco" na Asset Library
do Godot) e copie a pasta `addons/boneco` dele para o seu projeto. Godot 4.5 ou
mais novo, no Linux x86_64, Windows x86_64 e macOS (universal). Depois:

```gdscript
var sprite := BonecoSprite.new()
sprite.data = BonecoData.carregar("res://heroi/heroi.boneco")
add_child(sprite); sprite.set_animation("idle", true, 0)
```

Mix, fila, trilhas e os sinais (eventos também):
[addons/boneco/README.md](addons/boneco/README.md) (em inglês). Um projeto com
três personagens CC0, um clique que troca a animação e os eventos na tela:
[exemplos/godot-boneco](exemplos/godot-boneco).

## Num jogo Godot

`nucleo/godot` compila o mesmo código de dois jeitos:

- **módulo do motor**, dentro de um template de exportação web: um wasm só, sem
  carregar GDExtension no navegador;
- **GDExtension** (Linux, Windows e macOS) para o editor, o F5 e o CI headless com o
  Godot oficial.

O `BonecoSprite` guarda uma malha por lote e só regrava os vértices a cada
quadro. Num jogo de slot com 17 personagens animados, em staging, o módulo do motor
substituiu o plugin oficial: um wasm em vez de três, export de 51 MB em vez de 64
MB, primeiro quadro em 3,4 s em vez de 6,7 s. Esses tempos foram medidos com uma
versão anterior do módulo; o do núcleo sai com o mesmo wasm de 38,6 MB e o mesmo
download comprimido, e no nativo agora custa menos por quadro (0,54 ms para os 17
personagens, contra 0,63 ms). No navegador, com os dois a 120 fps, ele ocupa cerca
de 3 pontos a mais da thread principal que aquela versão (eram 6 a 8 antes de um
perfil do desenho e do recorte), e com a CPU 4x mais lenta os quadros acima de
25 ms empatam. Guardar as malhas levou os objetos de GPU criados por quadro de 160
para 0,3, e peça parada não envia nada. De 153 quadros comparados pixel a pixel com o renderizador
anterior, 142 são iguais; os outros 11 vêm de flipbooks um passo adiante (4 acima
de 1% dos pixels, 7 abaixo de 0,5%), e onde foi conferido, é o núcleo que bate com
a referência.

```sh
nucleo/godot/compilar.sh linux    # GDExtension (também windows, macos), como o CI faz
nucleo/godot/montar-addon.sh out  # o zip do addon, a partir de nucleo/godot/bin
scons platform=web target=template_release threads=no custom_modules=<repo>/nucleo/godot  # template web, no código do Godot
```

## Rodar

No modo de desenho "núcleo" o editor não usa o `spine-core`: o desenho, a pose, a interação, as
medidas, a ficha e os comandos vêm do núcleo em wasm. Os modos "godot" e "spine" (o padrão ainda
é o "godot") e o oráculo dos testes usam o `spine-core` e o `spine-webgl` (instalados pelo npm),
que exigem uma [licença do Spine](https://esotericsoftware.com/spine-purchase). O núcleo em
`nucleo/` e o formato `.boneco` não dependem deles.

```sh
npm install
echo "MAMULENGO_ROOTS=/caminho/dos/projetos" > .env.local
npm run dev                                   # http://localhost:5199
npm test                                      # todos os comandos, sem assets externos
cmake -S nucleo -B nucleo/build -G Ninja && cmake --build nucleo/build
npx tsx tools/nucleo-compara.ts tests/boneco  # o núcleo contra a referência
```

`tests/assets` tem três personagens CC0 de Kenney (cartoon, mascote, humano), montados
só com comandos do Mamulengo; `tests/boneco` tem esses três mais o robô, o zumbi e o
monstro que a bancada de agentes fez, seis ao todo (o elenco da demo ao vivo). Testes de paridade e as
diferenças de motor que o editor reproduz: [docs/PARIDADE.md](docs/PARIDADE.md).

## Estado

Funcionando: o editor, o servidor MCP, a bancada de agentes, o `.boneco`, o
núcleo com o módulo e a GDExtension do Godot. Um jogo de slot roda em staging com
o módulo do motor, e a versão `.boneco` dele, toda no núcleo, passa nos testes.
Próximos: o editor desenhando pelo núcleo no lugar do renderizador de referência,
e um `.boneco` binário para pacotes menores. Plano:
[docs/ROADMAP.md](docs/ROADMAP.md).

## Licença

MIT, ver [LICENSE](LICENSE). A arte CC0 em `tests/` e as bibliotecas do Spine que o
editor instala do npm seguem as licenças delas (listadas no [NOTICE](NOTICE)).
