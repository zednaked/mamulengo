# Editor

O guia de uso do editor: rodar, o que dá para fazer, acompanhar o Claude, versões, fichas, o MCP e o desempenho. A visão geral do projeto está no [README](../README.pt-BR.md).

## Rodar

```sh
npm install
echo "MAMULENGO_ROOTS=/caminho/para/os/projetos" > .env.local   # onde procurar projetos Godot
npm run dev                                                    # http://localhost:5199
```

`.env.local` fica fora do git. `MAMULENGO_ROOTS` aceita várias pastas separadas por `:`.

**Como app, sem abas nem barra:** `chromium --app=http://localhost:5199`. Na máquina de desenvolvimento há o atalho "Mamulengo" no lançador (`~/.local/bin/mamulengo`: sobe o servidor se ele não estiver rodando e abre a janela com perfil próprio).

Mudou um arquivo de `server/`: o servidor reinicia sozinho, num processo novo (no mesmo processo o plugin do Svelte passava a servir CSS errado e o editor abria sem os painéis).

## O que da para fazer

- **Começar por um PSD:** largar o `.psd` em camadas na janela (ou o botão "📥 PSD") monta o personagem novo na composição do PSD, ou atualiza o aberto casando camada com imagem pelo nome (animações, malhas e pesos continuam valendo). Entende as tags do PhotoshopToSpine (`[bone]`, `[slot]`, `[skin]`, `[folder]`, `[ignore]`, `[merge]`, `[mesh]`...). Detalhes e decisões: `docs/RIGAR.md`.
- **Montar (aba Pose base na timeline):** criar ossos arrastando (ferramenta Osso), arrastar imagens da aba Imagens para o boneco, enviar PNGs novos ("+ imagens", o atlas e reempacotado), cor e transparencia.
- **Esqueleto e Ordem (painel da esquerda):** **Esqueleto** mostra só os ossos, a hierarquia do que mexe o quê. **Ordem** mostra as imagens na ordem de desenho (a de cima fica na frente), com miniatura, a imagem atual e o osso que de fato move cada uma (numa malha com pesos, o que mais puxa, não o dono do slot). As duas se espelham: osso escolhido marca na Ordem as imagens que ele move; imagem escolhida abre a árvore até o osso dela. As listas rolam até o item escolhido (na tela, na outra aba ou pelo Claude).
- **Olho:** ao lado de cada osso e de cada imagem, esconde na tela (o osso leva junto o que ele move); nada vai para o arquivo e o Claude continua vendo tudo. "mostrar tudo" volta.
- **Ordem de desenho (o z):** arrastar na aba Ordem; ↑ e ↓ passam pela próxima imagem que encosta na escolhida (as que não se sobrepõem não mudam nada visível); "na frente de / atrás de" uma imagem que encosta; PageUp/PageDown (Shift: topo/fundo). Na Pose base muda o setup; numa animação vira chave de ordem no instante.
- **Clique na tela:** escolhe a imagem e o osso que a move naquele ponto (numa malha, o que mais puxa o triângulo clicado).
- **Animar:** com uma animacao aberta, mover, girar e esticar viram chave sozinhos (na aba Pose base, mexem no boneco de todas as animacoes); timeline com chaves arrastaveis; curvas por nome ou no editor grafico; onion skin ("cebola"); eventos.
- **Timeline:** regua em quadros (30 fps) com zoom (Ctrl+roda) e rolagem (Shift+roda ou botao do meio). Sem nada selecionado, uma linha por parte animada (clique no nome para ver as timelines dela). Varias chaves: Shift+clique, caixa arrastando no vazio, Ctrl+A; arrastar move todas juntas (uma acao de desfazer), Del apaga, Ctrl+C/Ctrl+X/Ctrl+V copia e cola no tempo atual (em outra animacao ou, com outra parte selecionada, nela). Espaco toca/pausa fora do viewport, setas andam um quadro (Shift: proxima chave), Home/End.
- **Emenda entre animações:** na timeline, "depois desta: [animação] mistura [0,1] s" toca a animação e depois a outra, como o jogo faz com `queueAnim`; "interromper em [t]" corta no meio, como `playAnim` (um prêmio que interrompe o idle). A mistura padrão vem do `-data.tres` (`default_mix` e os mixes por par). A régua cobre a sequência inteira, a faixa rosa é a mistura e a parte hachurada é a animação seguinte. É a mesma conta do spine-godot, medida contra o Godot (abaixo). Com a prévia ligada, chaves depois do início da mistura são recusadas (o que se vê ali é a mistura das duas).
- **Exportar:** GIF ou video WebM da animacao inteira como esta na tela (botao "exportar" da timeline ou `export` na ponte), gravado na pasta escolhida ou em `~/.cache/mamulengo/exports`.
- **Deformar a textura:** "Deixar deformavel" transforma a imagem em malha; "Dobrar com os ossos" liga pesos automaticos; o pincel (ferramenta Deformar) empurra a imagem e cria chaves de deform. A primeira chave de uma timeline ja cria as pontas (inicio e fim) para o movimento ir e voltar.
- **Editar a malha:** na Pose base, "Editar malha" mostra pontos e triangulos: arrastar move o ponto, clique na borda cria ponto no contorno, clique dentro cria ponto interno, Delete apaga; a malha se retriangula sozinha. Na aba Pesos, escolha um osso e pinte quanto ele puxa cada ponto (somar ou tirar, Shift inverte), com as cores do peso na malha. Deforms das animacoes e linked meshes acompanham (comandos `mesh.vertices`, `mesh.addVertex`, `mesh.removeVertex`, `mesh.paintWeights`).
- **Movimentos prontos:** respirar, balancar, quicar, entrar estourando, tremer, pulsar brilho, piscar, flipbook; fisica pronta (cabelo, orelha, tecido, mola, pendurado); IK em um clique ("Alcancar").
- **Ver no Godot:** renderiza o quadro no Godot de verdade e compara com o editor.
- **Rascunho automatico:** alteracoes nao salvas ficam guardadas no navegador e sao oferecidas ao reabrir.

O formato completo do Spine 4.3 esta disponivel como comandos (`mamulengo_help`): malhas, pesos, linked mesh, clipping, bounding box, point, path, sequence, IK, transform, physics, path constraint, slider, draw order, eventos, skins, renomear e apagar com referencias.

## Acompanhar o Claude

- **Espectador:** `?espectador` no endereço (ou automático, abaixo) transforma a aba numa espectadora do editor que o agente está usando: o personagem, as animações e a atividade chegam ao vivo; os ossos que ele mexe acendem; você navega à vontade (animação, instante, câmera, partes), sem salvar nada.
- **Acompanhar automático:** ao abrir o editor com um agente trabalhando (nesta porta, em outra aba, ou numa bancada em outra porta), a tela vai para a cena dele. O selo "👁 acompanhar" no topo liga e desliga (guardado no navegador).
- **Narração:** na bancada, o que o agente escreve entre os comandos aparece como legenda embaixo do personagem e na atividade (💬). O botão 💬 esconde a legenda.
- **Qual aba é qual:** o título vira "🤖 personagem · Mamulengo" na aba do agente e "👁 acompanhando ..." no espectador. Cada agente fica preso ao editor em que fez a primeira chamada.

## Versões e anotações

- **Versões, além do Ctrl+Z:** cada gravação vira uma versão do personagem; dá para marcar uma com nome, ver o que mudou em cada uma, comparar qualquer versão com a atual e restaurar (o estado atual vira versão antes, então dá para voltar). Ficam em `~/.local/share/mamulengo/versoes`, fora dos repositórios dos jogos; atlas e imagens iguais não ocupam espaço de novo. Aba **Versões** no editor; `mamulengo_versoes` no MCP.
- **Anotações:** qualquer pessoa (ou o Claude) deixa notas no personagem, presas a uma animação, um instante e uma parte, ou gerais; com respostas e "resolvida". Ficam em `<nome>.notas.json` ao lado do `.spine-json` (viajam com o projeto). Aba **Notas** no editor, marcadores amarelos na régua da timeline; `mamulengo_notas` no MCP.

## Ficha do personagem e fluxo

Cada personagem tem uma ficha (`<nome>.ficha.md`, ao lado do `.spine-json`) que diz o que o rig permite e o que cada animação deve fazer, com regras que o Mamulengo confere:

```sh
npm run ficha -- draft <x-data.tres>     # rascunho medido, com onde o jogo chama cada animacao e os mixes
npm run ficha -- check <x.ficha.md>      # confere todas as animacoes contra as regras
```

O fluxo inteiro está em `docs/`: `FLUXO.md` (do pedido à manutenção), `FICHA.md` (formato, regras e o que pensar além do óbvio), `RIGAR.md`, `ANIMAR.md`, `RUBRICA.md` (como dar nota), `ESTILO.md` (a régua da casa), `BANCADA.md` (agentes) e `ROADMAP.md` (o que falta). Exemplos de ficha: `tests/assets/*/rig/*.ficha.md`.

## Claude Code

O repo tem `.mcp.json`: abrindo o Claude Code nesta pasta, o servidor MCP `mamulengo` fica disponível. Se o editor não estiver aberto, o MCP sobe o servidor e abre o navegador.

| ferramenta | para quê |
|---|---|
| `mamulengo_assets`, `mamulengo_open` | achar e abrir um asset dos projetos |
| `mamulengo_guia` | o fluxo de trabalho: ficha, rigar, animar, conferir |
| `mamulengo_notas` | anotações da equipe no personagem: ler, criar, responder, resolver |
| `mamulengo_versoes` | versões do personagem: listar, marcar, comparar, restaurar |
| `mamulengo_help` | lista de comandos, com schema de parâmetros |
| `mamulengo_run` | executa comandos em lote (uma ação de desfazer; se uma falha, nada fica) |
| `mamulengo_look` | imagem renderizada: um instante ou folha de contato da animação; com `sequence`, da emenda com outra animação |
| `mamulengo_view`, `mamulengo_state` | controla e consulta a visualização |
| `mamulengo_export` | GIF ou WebM da animação inteira (ou da sequência, com `sequence`), devolve o caminho do arquivo |
| `mamulengo_psd` | personagem novo a partir de um PSD, ou o aberto atualizado por ele; devolve o resumo |
| `mamulengo_undo`, `mamulengo_redo`, `mamulengo_save`, `mamulengo_discard` | histórico e arquivo |

**Emendas.** `sequence: {next, mix?, at?}` em `mamulengo_look`, `mamulengo_export` e `mamulengo_view` mostra a animação seguida de outra (sem `at`, enfileirada; com `at`, interrompida; sem `mix`, o do jogo). O comando `query.transition` mede a emenda: para cada osso, a maior velocidade e o maior giro durante a mistura contra o resto da sequência (`score` acima de 1 é pulo); com `cuts`, interrompe em vários instantes e devolve o pior.

**Qualidade.** A rubrica (`docs/RUBRICA.md`, meta 9) e medidas que pegam o que o olho pega:

- `query.estilo` e a regra `estilo <papel>` na ficha: amplitude, silhueta (quanto a pose se afasta da inicial) e ritmo contra a mediana da casa; reprova animação tímida;
- regra `limite <osso> rotate a..b`: o ângulo final depois de IK e constraints (pega pulso e cotovelo impossíveis movidos por IK);
- `query.malha`: os instantes em que uma malha dobra ou estica fora do resto (braço erguido demais torce o ombro); é medida para olhar grande, não regra (animadores dobram de propósito);
- `query.recorte`: os instantes em que a borda escondida de uma imagem (toco do braço sob o ombro) aparece, em % da altura, descontando o que o animador também descobre;
- `query.transition` e as regras `termina_como`, `transicao`, `corte`: emendas, com a física simulada como no jogo (gravidade de rotação invertida, como o spine-godot).

**Conferir antes de mostrar.** Folha de contato pequena e "igual ao Godot" não validam uma animação. Use `query.motion` (para que lado cada osso gira e anda na tela, trecho a trecho, medido pelo runtime) e olhe quadros grandes. Lembre que constraints mudam o que se move: num personagem de óculos, eles seguem a mão por um transform constraint, então girar o braço tira os óculos do rosto.

Sem MCP, o mesmo protocolo está no CLI: `npm run cli -- <metodo> '<json>'` (ex: `npm run cli -- look '{"frames":6}' --png folha.png`).

## Desempenho

Medido com `tools/bench.ts` (Chromium headless com SwiftShader, ms por operacao):

| asset | operacao | antes | depois |
|---|---|---|---|
| cenário grande (266 slots) | passo de arrasto com animacao aberta | 22.6 | 1.6 |
| cenário grande | passo de arrasto na setup | 27.4 | 0.3 |
| cenário grande | poseAt no fim (4 s) | 13.3 | 0.2 |
| cenário grande | salvar (serializar 673 KB) | 65 | 17 |
| cenário com animação longa (15.7 s) | poseAt no fim | 14.6 | 0.1 |
| cenário com animação longa | passo de arrasto | 13.4 | 0.5 |
| garra mecânica (física) | poseAt avancando no tempo | 3.2 | 0.1 |

- Edicao so em animacoes ou em transformacao de osso na setup remenda o SkeletonData (`src/core/patch.ts`) em vez de reler o documento.
- `PoseSim` (`src/core/sim.ts`): sem fisica a pose sai de um passo so; com fisica ou com a prévia de transição, tempo que so avanca continua do ultimo passo inteiro (na sequência, o checkpoint guarda as entradas da trilha e a pose local). Os atalhos dao exatamente a mesma pose (tests/features.ts).
- Serializar memoriza a forma canonica de cada no (antes era O(n x profundidade)).
