# Backend: o Mamulengo como runtime de jogo web

**Meta:** o Godot é a baseline. Tudo o que os jogos daqui usam nele tem de existir no Mamulengo e
ser melhor em algum eixo medido (peso, carga, quadro no celular, determinismo, o agente operar).
O alvo principal é a web, com integração JS, compilado.

## Quem faz o que (2026-11-09)

- **Lógica e game dev:** o Claude, por jogo, em TypeScript compilado (pontuação, rodada, regras, rede),
  testado pela bancada de conformidade.
- **Layout e parte criativa:** a pessoa, no editor visual (posição, textos e idiomas, imagens,
  animação, efeitos, cores), sem tocar no código.
- **Por isso a interface é pequena:** em vez de reproduzir os `Control` do Godot, um layout em dados
  no `.boneco` com poucos elementos (imagem, texto com chave de tradução, área de toque, nove-fatias,
  âncora na tela), cada um com nome; o código acha pelo nome (`tela.texto("saldo")`,
  `tela.botao("girar").aoTocar(...)`).

## A escolha da linguagem (2026-11-09)

O núcleo continua em **C++ compilado para wasm (Emscripten)**: já é o runtime de referência
(460 KB de wasm), roda no Godot (módulo e GDExtension) e no nativo, é determinístico e está conferido
contra o oráculo. Rust (wasm-bindgen) é a alternativa madura (tipos JS gerados, ecossistema de jogos),
mas trocar jogaria fora a paridade medida; Zig promete binário menor sem números sólidos;
AssemblyScript é o caminho fácil de TypeScript, mais lento; MoonBit ainda não chegou à 1.0; Odin é
nicho. A casca web fica em TypeScript e Vite, com o desenhista WebGL2.

## A meta-linguagem

Não é uma linguagem nova. São três coisas, juntas, que deixam um agente portar o runtime para
qualquer linguagem e provar que ficou igual:
1. **o formato:** `.boneco` com os blocos de palco, regras e textos, em dados declarativos;
2. **a especificação de sala limpa:** `FORMATO.md`, `NUCLEO.md`, `PALCO.md` (cada conta descrita);
3. **a conformidade:** entradas e saídas esperadas, independentes de linguagem (pose, lista de
   desenho, jogo quadro a quadro, texto em cada idioma), como os testes contra o oráculo de hoje.

As regras dos jogos entram como dados ou uma linguagem pequena de expressões determinísticas, não
como código numa linguagem específica.

## Recurso por recurso, contra o Godot

| recurso | Godot | Mamulengo hoje | para superar |
|---|---|---|---|
| peso na web | template de 30 a 40 MB | wasm de 460 KB; o jogo de exemplo inteiro em 740 KB | manter; medir carga no A52s |
| animação 2D | AnimationPlayer, Skeleton2D, spine-godot | ossos, IK, física, malha, efeitos, instâncias; paridade com o Spine | ok |
| partículas | GPUParticles2D | presas a osso, raio, órbita | sub-emissores, colisão com o mapa |
| shaders | linguagem própria | efeitos prontos (linha, brilho, dissolver, tingir), blends que leem a tela, ajuste | efeito por receita dos dados, sem escrever shader |
| luz 2D | Light2D, normal map | luzes presas a osso, relevo gerado da arte | sombra 2D |
| mapa | TileMap, TileSet, terrenos | mosaico (grade, iso, perspectiva), pintado no editor | terreno automático (as bordas se escolhem), ladrilho animado |
| física | Godot Physics 2D | palco: caixa contra ladrilho, determinístico | plataforma de uma via, plataforma que anda, rampa, corpo com corpo |
| lógica | GDScript, sinais | tipos de ator fixos | regras e eventos em dados; script como escape |
| interface | Control, temas, containers | a tela (`src/tela`) e a cena (`src/cena`): o layout dos `Control` calculado como o Godot, qualquer janela, variantes por proporção | editar o layout no editor e sair em `.tscn` ou direto para a tela |
| tradução | TranslationServer, CSV/PO, pseudo-localização, fonte de reserva, RTL | chaves nos textos, tabela lida do CSV do Godot, troca na hora, RTL e devanágari pelo navegador, fontes por escrita | aviso de texto que estoura, testes em todos os idiomas |
| som | AudioStreamPlayer, buses, efeitos | `tools/som.ts` (eventos para trilha offline) | som ao vivo pelos eventos, buses e volume, mix |
| cenas e fases | PackedScene, change_scene | um `.boneco` por fase | fases e telas, transição, estado entre fases |
| tween | Tween | chaves de animação | tween por código e por regra |
| entrada | InputMap, toque, controle | teclado e toque no tocador | mapa de ações, controle, gestos |
| salvar | ConfigFile, FileAccess | não há | estado salvo no navegador |
| exportar | um template por plataforma | uma página HTML só; GDExtension para o Godot | PWA instalável, celular (Capacitor ou igual) |
| ferramenta | editor do Godot | editor web, MCP, agente que joga e mede | ok: aqui ganhamos |

## O que os jogos de produção usam (inventário de 2026-11-09)

Um levantamento só de leitura de 21 jogos web feitos no Godot (o relatório com os nomes fica fora do
repositório) mostrou:
- **interface é o grosso:** os nós mais usados são `Label` (971), `TextureRect` (911), `Control`
  (737), `Button` e `TouchScreenButton` (789), `Panel`, `AspectRatioContainer` e os containers;
- **todos traduzem** (13 arquivos de tradução cada) e todos usam a mesma base comum de código (um
  addon): portada uma vez, serve a todos;
- **animação:** Spine (que já portamos), `AnimationPlayer` (~105) e alguns jogos inteiros animados
  com `Polygon2D` e `Bone2D` (1.326 polígonos);
- **lógica:** de 1.200 a 6.500 linhas de GDScript por jogo;
- **peso na web:** 55 a 100 MB por jogo (o `side.wasm` de 44 MB, o `index.wasm` de 1,5 a 38 MB, o
  `.pck` de 7 a 15 MB); o motor do Mamulengo cabe em menos de 1 MB.

## A tela (2026-11-09)

`src/tela/tela.ts`: a interface como dados (`.tela.json`), desenhada num passo WebGL2 só. Cada
elemento tem nome e a transformação final: imagem (recorte e repetição já resolvidos), caixa
(fundo, borda, cantos), texto (com a chave de tradução), boneco (pelo núcleo, na ordem) e área de
toque. Textos e caixas são montados pelo Canvas 2D do navegador num atlas só: árabe e devanágari
saem certos sem nenhum byte de montador de texto. O código do jogo usa os nomes
(`tela.texto(nome, valor)`, `tela.mostrar`, `tela.tocado(x, y)`, `tela.lingua = "ar"`).

O primeiro caminho para uma tela foi o próprio Godot (hoje serve para conferir; ver a cena abaixo): um script de autoload grava o layout que ele
calculou (retângulos, texturas, textos, ordem por z) e um conversor o transforma em `.tela.json`
com as contas de esticar do Godot, sem reimplementar os containers. Regras medidas contra ele:
contorno do texto com raio de `outline_size / 4`; medidas da fonte arredondadas para fora;
`show_behind_parent`; num idioma RTL o parágrafo inteiro é RTL e o alinhamento fica o declarado.

**Alinhamento:** `tools/comparar-tela.ts` abre a página num Chromium sem janela no tamanho da foto
de referência e dá o erro global e o de cada elemento, com o deslocamento (até 4 px) que mais o
aproxima: separa "fora do lugar" de "desenhado diferente". Primeira tela de produção: 4,8% dos
pixels acima de 32 (as letras a ±1 px; o Godot arredonda a posição dos glifos) em português,
árabe e hindi, e as imagens mais nítidas que as do Godot (sem a compressão de VRAM).

## A cena do Mamulengo: do `.tscn` à tela, em qualquer janela (2026-11-09)

A captura pelo autoload continua para conferir, mas a tela agora sai direto do projeto do Godot,
sem rodar o Godot:

- `src/cena/tscn.ts` lê o `.tscn` (format=3), com os valores do Godot, os recursos e as cenas
  instanciadas abertas (inclusive filhos editáveis).
- `src/cena/layout.ts` calcula os `Control` como o Godot 4: âncoras e offsets, tamanho mínimo e
  máximo com a direção de crescimento, pivô, rotação e escala, `AspectRatioContainer`,
  `ScrollContainer`, `HFlowContainer` e os size flags. O tamanho mínimo do `Label` vem das medidas
  da fonte (`src/cena/fonte.ts`: subida e descida arredondadas para cima, avanços arredondados).
- `src/cena/para-tela.ts` transforma a árvore calculada em tela, com o tema padrão do Godot 4,
  `z_as_relative`, `show_behind_parent`, `clip_contents`, blends e os gradientes gerados na hora.
- `src/cena/montar.ts` guarda a **cena do Mamulengo** (um JSON: a árvore com os nomes de
  propriedade do Godot, as medidas que o layout precisa e os arquivos) e monta a tela para a janela
  exata. O jogo passa os ajustes que o código dele faz no `_ready` (`ajustar`), os estados de layout
  (`estados`, interpolados pela tela) e o que refaz quando um nó muda de tamanho (`aoRedimensionar`).
  A janela mudou: `Tela.aplicarLayout` troca só a geometria; o estado que o jogo pôs nos nós fica.
- **Variantes:** propriedades por nó que valem numa faixa de proporção (o Godot não tem). Exemplo
  medido: no desktop, o jogo numa coluna centrada com o fundo e as barras de ponta a ponta, em vez de
  esticar.

Conferido contra o Godot no primeiro jogo de produção portado: 1310 de 1330 nós no mesmo lugar
(até 0,5 px) em 7 proporções; telas e transições com 2 a 6% de pixels diferentes (letras a 1 px).

**O que a tela ganhou no caminho:** nós com estado herdado (mostrar, cor, mover, recorte, z),
clonar e remover nó (as cópias acompanham a janela nova), estados de layout somados, boneco com
trilhas e fila como o Spine (reverso, slots escondidos e tingidos, osso no mundo), carga adiada do
que começa escondido, fontes de uma escrita só no idioma dela. O atlas de textos sobe cada pedaço
com uma moldura transparente (sem sangria de pedaços antigos) e faz numa escala menor o que não
cabe nele.

## O primeiro jogo de produção portado (2026-11-09)

Um jogo com interface pesada, 12 idiomas e Spine, portado inteiro: a lógica em
TypeScript, a tela gerada do projeto do Godot no próprio deploy, dentro do shell web do estúdio sem
mudar o shell. Contra o export do Godot:

| medida | Godot | Mamulengo |
|---|---|---|
| pacote | 63,5 MB | 10,8 MB |
| baixado até a primeira tela | 23,4 MB | 3,2 MB |
| pronto em 4G 10 Mbit/s com CPU 4x lenta | 35,2 s | 6,8 s |
| deploy no CI (gerar, empacotar, testar, publicar) | 6m08s | 2m31s |

O mesmo projeto do Godot continua sendo a fonte: o workflow escolhe o motor, e voltar ao Godot é
rodar o deploy com o outro. Falta medir a fluidez no celular.

## Ordem

Portar os jogos de produção dirige a ordem:
1. ~~**Layout:** a tela em dados e o layout dos `Control` do Godot~~ (feito: `src/tela`, `src/cena`).
2. **Editor de layout:** abrir a cena, mover, ancorar, textos e idiomas, ver em vários tamanhos, e
   sair em `.tscn` (para o Godot) ou direto para a tela.
3. **Tradução:** aviso de texto que estoura e conformidade em todos os idiomas (a tabela e a troca
   na hora já existem).
4. **Importador do resto da cena do Godot:** `Sprite2D`, `AnimatedSprite2D`, `Polygon2D` com
   `Bone2D`, `AnimationPlayer` virando animação.
5. **A lógica:** a base comum do estúdio portada uma vez (já existe para o primeiro jogo); regras e
   eventos em dados, mais o escape de script.
6. **Som ao vivo, fases e telas, salvar, PWA instalável.**
7. **Medida contra o Godot em cada jogo portado:** peso, tempo de carga e quadro no celular.

Cada item entra como os outros recursos: formato, núcleo, editor, comandos, conformidade e Godot.
