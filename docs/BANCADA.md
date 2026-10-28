# Bancada de agentes

A bancada (`tools/bancada.ts`) entrega um pedido de verdade a um Claude Code sem interface (`claude -p`) que trabalha **só** pelo MCP do Mamulengo e pelos arquivos da pasta do caso: lê o PSD, monta o rig, escreve a ficha, anima, confere e exporta. Serve para medir se o fluxo e as ferramentas bastam para chegar ao nível de um animador da casa, e para gravar o processo.

![O monstrinho sendo feito pelo agente, do PSD ao pulo](media/monstro2-processo.webp)

<sub>Arte: [Monster Builder Pack](https://kenney.nl/assets/monster-builder-pack), de Kenney (CC0). Rig, ficha e animações feitos pelo agente no Mamulengo.</sub>

## Rodar

```sh
npx tsx tools/bancada.ts run <caso> [opcoes]
```

O caso é uma pasta com:

- `PEDIDO.md`: o pedido, como a equipe escreveria (personagem, uso no jogo, animações, qualidade esperada);
- `arte.psd` (ou imagens soltas e `layout.json`, de `tools/acceptance-kit.ts` + `tools/layout-psd.ts`);
- `projeto/`: projeto Godot mínimo de trabalho (o kit já monta).

| opção | o que faz |
|---|---|
| `--port 5331` | porta do editor da bancada |
| `--model opus`, `--budget 12`, `--turns 400` | modelo, teto em US$ por chamada, turnos |
| `--revisoes N`, `--meta 9` | diretor dá nota pela rubrica; abaixo da meta o animador revisa (até N vezes); sempre há nota final |
| `--retomar` | continua um caso já rodado: aplica as notas do último `DIRETOR_n.md` |
| `--gravar` | grava a tela inteira do editor do agente (um quadro por mudança) e monta `processo.mp4` e `processo.gif` acelerados |
| `--janela` / `--headless` | o editor do agente abre numa janela de verdade na tela (padrão com `--gravar`) ou sem janela |
| `--ao-vivo 5380` | porta da página que mostra o último quadro da gravação |
| `--editor` | usa o editor já aberto nessa porta (o da pessoa) em vez de subir um próprio |

## Isolamento

- O agente lê e grava só na pasta do caso (regras `Read(./**)` e `Edit(./**)`; gravar arquivo é liberado pela regra `Edit`, uma regra `Write(...)` sozinha não libera nada no modo sem perguntas). Sem shell.
- O editor da bancada lista só o caso (`MAMULENGO_ROOTS` = o caso): o agente não vê outros personagens nem as animações originais (pedido explícito: não copiar o animador).
- Com `--editor`, quem sobe o editor deve limitar as raízes ao caso. Cada agente fica preso ao editor em que fez a primeira chamada.
- O editor próprio roda com `MAMULENGO_ESTAVEL=1`: sem recarga nem reinício quando o código do Mamulengo muda, para mexer no editor não derrubar a rodada.

## Assistir

- **Janela:** com `--gravar` (ou `--janela`) o editor do agente abre como app (sem abas nem barra) na tela da pessoa. Não feche nem clique nela até o fim.
- **Acompanhar:** abrindo o Mamulengo (atalho do lançador ou `http://localhost:5199`), se há um agente trabalhando o editor vai para a cena dele no modo espectador. A bancada se anuncia em `~/.cache/mamulengo/sessoes/`. O selo "👁 acompanhar" no topo liga e desliga isso.
- **Narração:** o que o agente escreve entre os comandos aparece como legenda embaixo do personagem e na atividade (💬); vai junto para o espectador e para a gravação.
- **Ao vivo:** `http://localhost:5380/ao_vivo.html` mostra o último quadro da gravação, atualizando a cada segundo.

## O diretor

Outro `claude -p`, sem editor e sem ver nenhuma animação de referência, dá a nota pela rubrica (`docs/RUBRICA.md`) olhando:

- `entrega/folhas/*_pequena.png` (silhueta) e `*_grande.png` (poses), geradas dos GIFs;
- `entrega/folhas/atencao_<anim>.png`: os instantes de maior torção de malha (`query.malha`) e de recorte à mostra acima de 10% da altura (`query.recorte`), grandes;
- o pedido e o relatório.

O parecer é a resposta final dele (a bancada grava `entrega/DIRETOR_n.md`) e vai colado no pedido de revisão. Arte quebrada em qualquer quadro (malha dobrada, articulação impossível, recorte à mostra, rosto que se desmonta) limita a nota a 6. A rubrica tem exemplos com notas dadas por quem conhece o jogo, para calibrar.

## Saída

```
<caso>/entrega/          GIFs das animações, RELATORIO.md, DIRETOR_n.md, folhas/
<caso>/entrega/gravacao/ processo.mp4, processo.gif, quadros/ (originais), tempos.tsv
<caso>/.bancada/         transcrições (transcript, revisao_n, diretor_n), resumo.json (custo, tempo, notas)
<caso>/projeto/          o personagem pronto (.spine-json, atlas, -data.tres, ficha)
```

## O caso do monstrinho

Arte CC0 do corpus livre (`tests/assets/monstro`), transformada em PSD de 9 camadas. Pedido: rig do zero, braços com tom próprio (eram da mesma cor do corpo), ficha, `idle` (2 s, loop) e `ganhou` (pulo de 1 a 1,5 s).

| | |
|---|---|
| tempo e custo | 25 min, US$ 14 (animador + 1 revisão + 2 pareceres) |
| gravação | 1141 quadros, vídeo de 76 s |
| diretor | 7 na primeira passada; 6 (veto) depois da revisão: a bolota do ombro aparece nos braços no pulo |
| avaliação de quem viu | "esse case ficou muito bom" |

![ganhou emendando no idle, no robô e no monstrinho](media/emendas.webp)

## Lições das rodadas

- **O "quanto" vem da casa.** Sem a régua do estilo, os agentes animam tímido; a regra `estilo` na ficha e a medida de silhueta pegam isso.
- **Diretor sem medida não vê defeito.** Ele só pegou o braço torcido da `show` depois de receber os quadros de atenção; pulso virado por IK só apareceu quando a regra `limite` passou a medir o ângulo final.
- **A arte limita o gesto.** Malhas pesadas para a pose de repouso não aguentam braço acima da cabeça: o agente precisa ficar na faixa segura, corrigir com deform ou pedir arte nova.
- **Custo:** revisões custam caro (a `show` com duas revisões passou de US$ 50). Uma revisão costuma bastar; mais que isso, revise a ferramenta ou o pedido.
