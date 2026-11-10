# O PSD chegando como tela

Guia curto para quem desenha a tela no Photoshop (ou em outro programa que grave PSD em camadas) e
para quem importa. O designer solta o PSD no editor do Mamulengo e a tela já chega quase pronta: a
arte base, as âncoras de cada elemento, os botões com os estados, os textos de verdade e as
nove-fatias. A pessoa só ajusta, anima os estados, e o Claude escreve a lógica pelo manifesto
(docs/BACKEND.md, "Papéis").

## A convenção de nomes

| no PSD | vira | exemplo |
|---|---|---|
| grupo de cima (ou camada solta no topo) | um **elemento**: um osso, com uma âncora na janela | `placar`, `painel`, `fundo` |
| qualquer grupo | um osso (o que se move junto); as camadas dele são as partes | `heroi/coelho` |
| `btn_x` (ou `botao_`, `button_`, `bt_`) | o **botão** `x` | `btn_jogar` |
| dentro do grupo `btn_x`, camadas `normal`, `em_cima`, `apertado`, `desligado` | os **estados** do botão (cada um uma imagem; o normal visível, os outros escondidos) | `btn_jogar/apertado` |
| irmãs `x`, `x_apertado`, `x_desligado` (ou `_off`, `_on`, `_hover`, `_pressed`, `_disabled`) | o mesmo: o botão `x` com os estados | `play`, `play_off` |
| `toque_x` (ou `area_`, `hit_`) | uma **área de toque** `x` | `toque_fundo` |
| camada de **texto** do Photoshop | uma parte de texto: o texto, a fonte, o tamanho, a cor, o alinhamento, o contorno e a sombra | `MISSOES` |
| texto chamado `txt_x` (ou `texto_`) | o **texto do código** `x` (o jogo troca: `tela.texto("x", ...)`) | `txt_placar` |
| `9_x` (ou `fatia_x`) | **nove-fatias**: as margens pela imagem (bordas iguais) | `9_painel` |
| `[9:16]` ou `[9:16,14,16,20]` no nome | nove-fatias com as margens escritas (uma, ou esquerda, cima, direita, baixo) | `barra [9:16,14,16,20]` |

As tags do script PhotoshopToSpine (`[bone]`, `[slot]`, `[ignore]`, `[merge]`...; docs/RIGAR.md)
continuam valendo e vencem a convenção: um grupo `[slot:x]` não vira osso, `[ignore]` fica de fora.

Os estados em português ou inglês: `normal` (`idle`, `up`, `on`), `em_cima` (`hover`, `over`),
`apertado` (`pressed`, `down`), `desligado` (`disabled`, `off`, `inativo`). Estado que falta vira a pose
curta padrão (6% maior em cima, menor e mais escuro apertado, escuro desligado) mostrando a imagem normal.

**Textos.** A chave na tabela de idiomas é o nome da camada, quando ela foi renomeada (`MISSOES` com o
texto "MISSÕES"), ou o próprio texto (o Photoshop dá à camada o nome do conteúdo: "JOGAR" vira a chave
`JOGAR`). A chave nova entra na tabela com o texto do PSD no idioma dele (padrão `pt`). A fonte é
procurada pelo nome de dentro do arquivo (ou pelo nome do arquivo) ao lado do PSD, numa pasta `fontes/`
(ou `fonts/`) ao lado dele e em `fontes/` na pasta da tela; achada, é copiada para `<tela>/fontes/` e
ligada. **Fonte que falta gera aviso** e o texto usa a padrão até alguém pôr o arquivo. Texto de ponto
ganha uma caixa com folga para as traduções (meia letra de cada lado, ou 30% da largura) e encolhe se
estourar; texto de parágrafo usa a caixa do PSD e quebra nas palavras. Texto rasterizado (uma imagem com
cara de texto) continua imagem: mande a camada de texto, ou diga no mapa (`textos`, abaixo) que a imagem
é um texto, e ela vira texto de verdade.

**Palco (um bloco que anda junto).** Um grupo chamado `palco` (ou `stage`, `bloco_x`, `block_x`) é um
elemento só, mesmo cobrindo a arte: o grupo ancora e os filhos vão junto, sem âncora própria (um jogo de
mesa assenta o palco inteiro no rodapé). Sem o grupo no PSD, o mapa faz o bloco (`blocos`).

## As regras da proposta

Cada item vem com o porquê e pode ser desmarcado ou trocado antes de aplicar.

1. **Arte base:** o tamanho do documento, encaixe **caber** (a arte inteira cabe na janela). Se o PSD
   é maior que a tela (o fundo sangra), diga a arte no mapa (`arte`).
2. **Âncoras**, pela caixa da tinta de cada elemento (as camadas visíveis do grupo) contra a arte base:
   - cobre a arte inteira (até 5% de folga em cada borda): **fundo**, no meio, **estica nos dois eixos**;
     se ainda sangra 15% ou mais para fora nos dois eixos, no meio **cobrindo sem deformar** (cresce por
     igual, em volta do meio, até cobrir a janela; `anchor.set cover`);
   - largura de 90% da arte ou mais: **faixa**, estica em x (sem esticar se sangra para os lados), em
     cima, no meio ou embaixo pela altura do centro; altura de 90% ou mais: o mesmo em y;
   - senão, pelo centro: no primeiro terço da altura **em cima**, no último **embaixo**; no primeiro
     terço da largura **à esquerda**, no último **à direita**; os dois juntos dão o **canto**; nenhum, o meio.
   - Grupo que só organiza (cobre 60% da arte nos dois eixos, tem vários filhos e nenhum papel) passa a
     âncora para os filhos: o grupo `ui` com tudo dentro não vira um elemento só.
3. **Papéis** pelos nomes, como o `role.auto`, com os estados do botão pelas camadas (acima).
4. **Textos:** toda camada de texto (ligada); a do `txt_` também é texto do código.
5. **Nove-fatias:** pelo nome (`9_`, `fatia_`, `[9]`, `[9:...]`: ligadas) ou pela imagem: a maior faixa
   de linhas (e de colunas) iguais que passa pelo meio da imagem é o miolo que estica, o resto são as
   margens. A achada só pela imagem vem ligada quando a caixa vai mudar de tamanho (o elemento estica
   num eixo em que há margem, ou ela acompanha o texto que está em cima dela, como o fundo do botão
   JOGAR), e desligada nas outras (ligue se for esticar).

## Importar

- **Editor:** largue o `.psd` na janela (ou "📥 PSD"). Quando o nome do arquivo ou as camadas dizem
  que é uma tela (`btn_`, `txt_`, `9_`, camadas de texto, ou "tela", "ui", "hud", "menu" no nome),
  "Criar como tela de jogo" já vem marcado e a lista mostra cada item: camada, âncora, papel, texto,
  fatias e o porquê, com a caixa de ligar e, nas âncoras, o ponto e o esticar para trocar. "Criar tela"
  monta o `.boneco`, abre e grava `<nome>.manifesto.json`. Depois funcionam "lado a lado" e "▶ jogar a
  tela" (docs/EDITOR.md).
- **Ponte e MCP:** `mamulengo_psd {file, dir, name, tela: true}` (ou `tela: {off, on, change, art,
  fit}` para ajustar itens pelo id, como `{"change": {"ancora:painel": {"ancora": "right"}}}`);
  `{file, tela: true, dryRun: true}` só devolve a proposta, linha a linha e com os ids.
- **Comando:** `psd.layout {psd, dryRun}` lê o PSD e devolve a proposta; sem `dryRun` aplica no documento
  aberto (que precisa ter vindo da importação com o mapa da proposta). Também aceita `proposal` (a de
  um dryRun), `off`, `on`, `change`, `art`, `fit`, `map` e `fonts`.
- **Código:** `createScreenFromPsd` e `proposeScreenFromPsd` (server/psd.ts), `criarTelaDePsd` e
  `proporTela` (src/core/psd-importar.ts, os mesmos no editor pelo navegador), a proposta em
  `src/core/psd-tela.ts`.

## Mapa externo

Quando o PSD do cliente não segue a convenção e não pode ser regravado, um `.json` diz o que cada
camada é. Com o nome `<psd>.tela.json` ao lado do PSD ele é lido sozinho; senão, passe `mapa` (caminho
ou objeto). Chave de camada: o nome limpo, o nome como está no PSD, o caminho `grupo/camada`, ou um
padrão com `*` (`"moeda_*"`, `"[bone:ui]/*"`; vale o primeiro que casa, depois dos nomes exatos).

```json
{
  "arte": [541, 758, 1125, 2217],
  "encaixe": "contain",
  "nomes": { "play": "btn_play", "menu": "btn_menu", "Saldo": "txt_saldo" },
  "ancoras": { "menu": "top", "fundo": { "ancora": "center", "cobrir": true }, "escuro": { "ancora": "center", "esticar": "xy" }, "nuvens": null, "*": "bottom" },
  "blocos": { "cenario": { "ancora": "bottom", "camadas": ["fundo", "mesa"], "ponto": [1103, 2227], "cobrir": true },
              "palco": { "ancora": "bottom", "camadas": ["*"] } },
  "fatias": { "painel": [22], "barra": [16, 14, 16, 20], "botao": null },
  "textos": { "Titulo": { "chave": "TITULO", "fonte": "Kenney Future" }, "Saldo": { "chave": null },
              "escolha": { "chave": "CHOOSE_A_CUP", "fonte": "NotoSans-Regular", "tamanho": 69, "cor": "dbc7eb", "caixa": [541, 2619, 1125, 109] },
              "barra_saldo": { "papel": "saldo", "texto": "0,00", "fonte": "NotoSans-Regular", "tamanho": 44, "contorno": { "largura": 3, "cor": "000000" } } },
  "idioma": "pt",
  "camadas": { "Lamp1": "[bone:fundo]" },
  "esconder": ["rascunho"],
  "_nota": "chaves com _ sao comentario"
}
```

- `arte` (px do PSD) e `encaixe` (`contain`, `cover`, `width`, `height`);
- `nomes`: a camada como se o designer a tivesse renomeado, para a convenção valer (a irmã `play_off`
  continua achando a base `play` renomeada);
- `ancoras`: o ponto (`top-left`... `bottom-right`, `center`), `{ancora, esticar, cobrir}` ou `null` (sem
  âncora); `cobrir`: cresce por igual até cobrir a janela (a caixa é a das partes do grupo);
- `blocos`: um osso novo com a âncora, pai dos elementos que casam com `camadas` (padrões com `*`; os que
  têm âncora própria no mapa por nome exato ficam fora; cada elemento no primeiro bloco que o pega); `ponto`
  (px do PSD, padrão o ponto da âncora na arte) é onde o osso fica, e `cobrir` faz o bloco crescer em
  volta dele;
- `fatias`: as margens (uma ou quatro) ou `null`; `textos`: a chave (`null`: texto livre) e a fonte; numa
  camada de **imagem** (texto rasterizado), a imagem vira texto: `texto`, `tamanho`, `cor`, `alinhar`,
  `caixa` (px do PSD; padrão a tinta com folga), `contorno` e `papel` (o texto do código, como `txt_`);
- `camadas`, `ossos`, `esconder`: os da importação comum (docs/RIGAR.md, "Mapa externo"), somados às
  tags da proposta.

Chave que não casa com nenhuma camada vira aviso.

## A prova

`tests/assets/psd/tela.psd` (gerado por `tools/psd-tela-fixture.ts`, arte da Kenney, CC0) é a tela de
`exemplos/coelho` (o menu do joguinho) desenhada em camadas pela convenção. Importado como tela, sem mapa, refaz as 9 âncoras do
exemplo (as mesmas de `exemplos/coelho/gerar.ts`), o JOGAR com os estados pelas camadas e o texto
acompanhado pela nove-fatias, a pausa com as poses padrão, o placar como texto do código e os 6 textos
com a fonte Kenney Future (caso em `tests/features.ts`). `exemplos/coelho/ver/?boneco=<url>` mostra
qualquer tela importada (as capturas: `exemplos/coelho/capturas/psd`).
