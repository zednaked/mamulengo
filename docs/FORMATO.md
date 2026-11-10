# Formato do Mamulengo: .boneco (v0)

Status: v0 implementado na conversão (`src/boneco/`, `tools/boneco.ts`). O editor abre e grava `.boneco` (o servidor converte na hora: `server/boneco.ts`); o núcleo próprio está em construção (docs/NUCLEO.md). Nada do editor nem do runtime atual muda por causa deste
documento: o formato novo, o núcleo novo e o importador nascem em paralelo e só substituem o
que existe depois de passar nos testes de aceitação (seção final).

## Princípios

1. **Nosso.** Formato, núcleo e editor escritos por nós, a partir desta especificação. O
   Spine é só compatibilidade: o Mamulengo **lê e exporta** o JSON 4.3 do Spine.
2. **Parecido onde não há motivo para mudar.** Mesmos conceitos (osso, slot, imagem, malha,
   constraint, animação, curva), mesmas unidades e, onde der, os mesmos nomes de campo. Quem
   conhece o Spine lê um `.boneco` sem manual, e a conversão é direta.
3. **Mudar só quando melhora:** o que o jogo precisa e o Spine não dá, o que hoje é passo
   manual e dá erro, ou o que deixa carregar e desenhar mais rápido.
4. **Feito do que se usa.** O v0 cobre o que aparece nos 102 assets medidos (85 do corpus
   privado e 17 de um jogo novo); o resto entra quando um asset pedir.

## Arquivo

- `<nome>.boneco`: JSON, UTF-8. Tudo que o personagem é: esqueleto, imagens (atlas
  incluído), animações, mix, ficha.
- `<nome>.png|webp` (e `_2`, `_3`...): as páginas de textura.
- O mesmo `<nome>.boneco` pode estar em binário (abaixo, "Binário"): a forma de entrega ao
  jogo, menor e mais rápida de carregar. O núcleo, o Godot e o editor reconhecem pelo começo
  do arquivo; o nome não muda, então o jogo não muda nada para usar.

Um arquivo só no lugar de quatro (`.json`, `.atlas`, `-data.tres` e a ficha ao lado): o par
json/atlas que não se acha pelo nome, o mix que mora num recurso do Godot e a compressão da
página ajustada à mão deixam de existir como erro possível.

## Conteúdo

Unidades como no Spine: pixels, y para cima, graus no sentido anti-horário, segundos. Os
campos do esquema são em português; os nomes dados pelo artista (ossos, slots, partes,
animações, eventos) ficam como estão. O dicionário completo, de mão dupla, está em
`src/boneco/dicionario.ts`; campo que ele não conhece passa com o nome original nos dois
sentidos (nada se perde numa ida e volta).

```jsonc
{
  "boneco": 0,
  "nome": "monstro",
  "paginas": [ { "arquivo": "monstro.webp", "tamanho": [187, 494],
                 "jogo": { "compressao": "perda", "qualidade": 0.7 } } ],   // pma, filtro, escala, relevo se houver
  "imagens": [ { "nome": "antena", "pagina": 0, "ret": [147, 403, 38, 58] } ], // girada, corte, indice se houver
  "esqueleto": { "versao_spine": "4.3.23", "x": -95, "y": -4, "largura": 190, "altura": 250 },
  "ossos": [ { "nome": "root" }, { "nome": "base", "pai": "root" },
             { "nome": "topo", "pai": "corpo", "comprimento": 80, "rotacao": 90, "escala_x": 1.1 } ],
  "slots": [ { "nome": "antena", "osso": "antena", "parte": "antena", "blend": "aditivo" } ],
  "skins": [ { "nome": "default", "partes": { "corpo": { "corpo": {
      "tipo": "malha", "uvs": [...], "triangulos": [...], "contorno": 8, "arestas": [...],
      "pesos": [ [ ["topo", 91, 21.56, 0.93], ["corpo", 171, 21.56, 0.07] ], ... ] } } } } ],
  "restricoes": [ { "tipo": "fisica", "nome": "antena_fisica", "osso": "antena", "girar": 1,
                    "inercia": 0.8, "forca": 60, "amortecimento": 0.6 } ],
  "eventos": { "passo": { "inteiro": 1 } },
  "luzes": [ { "nome": "chave", "osso": "root", "x": 300, "y": 460, "cor": "fff0dcff", "forca": 0.6, "raio": 1100, "altura": 260 } ],
  "ambiente": { "cor": "c9d3eeff", "forca": 0.8 },   // luzes e relevo da pagina: docs/NUCLEO.md "Luzes"
  "animacoes": { "idle": { "ossos": { "topo": { "girar": [
      { "valor": -5, "curva": [0.125, -5, 0.375, 0] }, { "tempo": 0.5, ... } ] } },
      "slots": { "olho": { "parte": [ { "tempo": 1.2, "nome": "olho_fechado" } ] } } } },
  "mix": { "padrao": 0.1, "pares": [ { "de": "ganhou", "para": "idle", "tempo": 0.2 } ] },
  "ficha": { "texto": "# monstro ..." }
}
```

Timelines: nos ossos `girar`, `mover` (`mover_x`, `mover_y`), `escalar`, `cisalhar`,
`heranca`; nos slots `parte`, `rgba`, `rgb`, `alfa`; nas partes `deformar`; mais
`ordem_desenho`, `eventos` e as das restrições (`mix`, `posicao`, `espacamento`, `inercia`,
`gravidade`...). Chave: `tempo`, `valor` (ou `x`/`y`, `cor`, `nome`), `curva` (`"degrau"` ou
os 4 valores da bezier por canal, como no Spine).

Valores que mudam de nome: blend `aditivo`, `multiplica`, `multiplica_motor`, `tela` e os que
leem a tela, só do Mamulengo (`sobrepor`, `luz_suave`, `escurecer`, `clarear`, `diferenca`,
`subexpor`; docs/NUCLEO.md "Blends"); tipo de
parte `regiao`, `malha`, `malha_ligada`, `recorte`, `caminho`, `ponto`, `caixa`; tipo de
restrição `ik`, `transformacao`, `caminho`, `fisica`, `slider`.

Desenhos (o ambiente Desenhar do editor): `desenhos` guarda, por imagem, as formas vetoriais de
que ela é feita. A imagem continua sendo uma região de uma página (`<personagem>-desenhos.png`),
refeita pelo editor a cada mudança e gravada ao salvar; quem só lê imagem (o jogo, o Spine) não
precisa das formas. Coordenadas em pixels da imagem, origem no canto de cima, y para baixo, como
no SVG; as alças são relativas ao ponto; ponto sem alças é canto, e `raio` o arredonda quando os
dois lados são retos. `hd` (padrão 2) é quantos pixels de textura por pixel da imagem.

```jsonc
"desenhos": { "mao": { "largura": 120, "altura": 100, "hd": 3, "formas": [
  { "nome": "palma", "fechado": true, "preenchimento": "f4a261ff",
    "pontos": [ { "x": 60, "y": 10, "entrada": [-22, 0], "saida": [22, 0] }, { "x": 100, "y": 50, "raio": 6 }, ... ],
    "traco": { "cor": "3d2b1fff", "largura": 4, "alinhar": "dentro", "quina": "redonda", "ponta": "redonda" } },
  { "nome": "aro", "fechado": true, "pontos": [...], "furos": [ { "pontos": [...], "fechado": true } ] },
  { "nome": "brilho", "escondida": true, ... } ] } }
```

Tela (o boneco inteiro como a tela de um jogo; a conta em docs/NUCLEO.md, "Tela"):

```jsonc
"tela": { "arte": [-350, 0, 700, 1370], "encaixe": "caber",          // caber, cobrir, largura, altura
          "ancoras": [ { "osso": "placar", "ancora": [0.5, 0] },       // x: 0 esquerda, 1 direita; y: 0 em cima, 1 embaixo
                       { "osso": "barra", "ancora": [0.5, 0], "estica": "x" },     // estica: x, y ou xy
                       { "osso": "cenario", "ancora": [0.5, 1], "cobre": [-1103, 0, 2205, 2975] } ] }
                       // cobre: a caixa (mundo da arte base) que o osso escala por igual, em volta dele, ate
                       // cobrir a janela (nunca menos que 1); nao combina com estica
```

No JSON do editor: `screen: { art, fit: contain|cover|width|height, anchors: [{ bone, anchor, stretch }] }`.
A ida e volta pelo texto, pelo binário (`tools/nucleo-tela.ts`) e pelo JSON do editor
(`tests/features.ts`) devolvem o mesmo bloco.

Texto (a parte de texto, as fontes e a tabela de idiomas; a conta e o desenho em docs/NUCLEO.md,
"Texto"):

```jsonc
"skins": [ { "nome": "default", "partes": { "jogar": { "jogar": {
    "tipo": "texto", "x": 0, "y": 6, "largura": 250, "altura": 60,        // a caixa no osso do slot (o meio em x, y)
    "chave": "JOGAR", "texto": "JOGAR",                                  // a chave na tabela; o texto livre vale sem ela
    "familia": "kenney", "tamanho": 40, "minimo": 24, "cor": "ffffffff",
    "alinhar": "centro", "alinhar_v": "meio", "estouro": "encolher",     // esquerda|centro|direita; cima|meio|baixo; encolher|quebrar|cortar|nada
    "linha": { "largura": 3, "cor": "1d7a4aff" }, "sombra": { "cor": "1d7a4aff", "x": 0, "y": 3 } } } } } ],
"fontes": [ { "nome": "kenney", "arquivo": "kenney/kenney-future.ttf" },      // ao lado do .boneco; a primeira e a padrao,
            { "nome": "arabe", "arquivo": "fontes/NotoSansArabic-Bold.ttf" } ], // as outras sao reserva das letras que faltam
"traducoes": { "idiomas": ["pt", "en", "ar", "hi"],
               "textos": { "JOGAR": ["JOGAR", "PLAY", "العب", "खेलें"], "MOEDAS": ["{n} moedas", "{n} coins", "{n} عملات", "{n} सिक्के"] } }
```

No JSON do editor: a parte `{type: "text", width, height, string, key, font, size, minSize, color,
align: left|center|right, valign: top|middle|bottom, overflow: shrink|wrap|clip|none, outline: {width,
color}, shadow: {color, x, y}}`, `fonts: [{name, file}]` e `translations: {languages, strings}`. A tabela
importa e exporta o `translations.csv` do Godot (`keys,pt,en,...`). Na parte de texto, `cor` é a cor das
letras (não a tinta da parte; a do slot continua multiplicando). A exportação para o Spine tira as partes
de texto (o slot fica sem a parte), as fontes e a tabela, com aviso. A ida e volta pelo texto, pelo
binário e pelo JSON do editor: `tests/features.ts` e `tools/nucleo-texto.ts`.

Nove-fatias (a região cortada por 4 margens em 9 pedaços: os cantos não esticam; a conta em
docs/NUCLEO.md, "Nove-fatias"):

```jsonc
"painel": { "painel": { "largura": 200, "altura": 160,
    "fatias": { "esquerda": 40, "cima": 30, "direita": 50, "baixo": 20,     // nas unidades da parte
                "eixo_x": "esticar", "eixo_y": "repetir" } } },              // esticar|repetir|repetir_caber
"fundo_botao": { "botao": { "largura": 192, "altura": 64,                // a imagem
    "fatias": { "largura": 260, "altura": 90,                                 // a caixa (padrao: a imagem)
                "esquerda": 16, "cima": 14, "direita": 16, "baixo": 20,
                "acompanha": { "slot": "jogar", "respiro": [36, 14] } } } }  // cresce com o texto do slot
```

No JSON do editor: `slice: {width, height, left, top, right, bottom, axisX, axisY: stretch|tile|tileFit, fitText: {slot,
padding}}` na região. A exportação para o Spine tira as `fatias`, com aviso: a região sai inteira, esticada para a
caixa. A ida e volta pelo texto e pelo binário: `tools/nucleo-fatias.ts`; pelo JSON do editor:
`tests/features.ts`.

Papéis (o que cada elemento é para o código do jogo; docs/NUCLEO.md, "Papeis"), no topo:

```jsonc
"papeis": [
  { "nome": "jogar", "tipo": "botao", "osso": "botao", "area": { "slot": "botao" },
    "estados": { "normal": "jogar/normal", "em_cima": "jogar/em_cima",
                 "apertado": "jogar/apertado", "desligado": "jogar/desligado" },
    "mix": 0.12 },                                                  // trilha: 10 + a ordem
  { "nome": "fundo", "tipo": "toque", "osso": "fundo", "area": { "caixa": [0, 685, 700, 1370] } },
  { "nome": "placar", "tipo": "texto", "slot": "pontos" }
]
```

No JSON do editor: `roles: [{name, type: button|touch|text, bone, slot, area: {slot, box}, states: {normal,
hover, pressed, disabled}, mix, track, disabled}]`. A exportação para o Spine tira os papéis, com aviso (as
animações dos estados ficam). A ida e volta pelo texto, pelo binário e pelo JSON do editor:
`tests/features.ts`; o núcleo: `tools/nucleo-papeis.ts`.

Malha mole: a parte `malha` pode ter `geleia` (`rigidez`, `contagio`, `amortecimento`,
`gravidade`, `massa`, `moleza` por vértice e os slots que `seguem`); a conta está em
docs/NUCLEO.md, "Geleia". A exportação para o Spine a tira, com aviso (a malha fica dura).

`furos` são contornos que tiram do preenchimento da forma (par-ímpar, como `fill-rule: evenodd`).

`alinhar`: `dentro`, `centro` (padrão) ou `fora`; `quina`: `viva` (padrão), `redonda` ou
`chanfrada`; `ponta` (traço aberto): `reta` (padrão), `redonda` ou `quadrada`. A exportação para
o Spine tira os desenhos, com aviso, e leva a página como qualquer outra.

Malha, caminho, recorte e caixa com pesos: `pesos` com, por vértice, a lista
`[osso, x, y, peso]` (o osso pelo nome), em vez do vetor misto do Spine em que o leitor
descobre se há pesos comparando tamanhos. Sem pesos: `vertices` como no Spine.

## O que muda em relação ao Spine (e por quê)

| | no Spine | no `.boneco` | por quê |
|---|---|---|---|
| Atlas | arquivo texto à parte, pareado pelo nome | dentro do arquivo | um arquivo só; sem par errado |
| Mix | recurso do motor (`-data.tres`) | `mix` no arquivo | o personagem leva o próprio ritmo de emenda |
| Compressão da página no jogo | ajuste manual no `.import` | `paginas[].jogo` | hoje é esquecido e muda o tamanho do jogo |
| Multiply | depende do runtime: no Godot ignora a transparência (retângulo escuro) | definido: `destino x mix(1, cor, alfa)` | é o que o artista vê no editor |
| Gravidade da física | sinal diferente entre o editor do Spine e o runtime do Godot | um sentido só, o do jogo, escrito no arquivo | o editor mostra o que o jogo faz |
| Malha com pesos | vetor misto | pesos explícitos | leitor simples, menos erro |
| Ficha e regras | arquivo `.md` ao lado | `ficha` no arquivo | a intenção e os limites viajam com o personagem |
| Efeitos por slot | não existem | `efeitos` no slot e na animação: linha, brilho, dissolver e tingir (docs/NUCLEO.md, "Efeitos") | destaque de prêmio, aparecer e sumir, dano, sem arte nova; a exportação para o Spine os tira e avisa |
| Partículas | não existem | `particulas` (emissores presos a ossos) e `particulas` na animação (taxa e rajadas); docs/NUCLEO.md, "Partículas" | brilho de prêmio, moedas, faíscas, sem vídeo nem nó à parte no jogo; a exportação para o Spine as tira e avisa |
| Instâncias | não existem | `instancias` (um `.boneco` dentro de outro, preso a slot e osso) e `instancias` na animação (troca animação e tempo); docs/NUCLEO.md, "Instâncias" | repetir uma peça animada (letras, multidão), compor cenas; o filho é lido uma vez e dividido; a exportação para o Spine as tira e avisa |
| Mosaico | não existe | `mosaicos`: grade de imagens do atlas presa a um slot (grade, iso ou perspectiva forçada), com cor, altura, giro, espelho e efeitos por célula; docs/NUCLEO.md, "Mosaico" | mapas, chão e paredes sem uma parte por ladrilho; a exportação para o Spine os tira e avisa |
| Tela | não existe | `tela`: a arte base, o encaixe numa janela de outro tamanho (caber, cobrir, largura, altura) e os ossos presos a pontos da janela, com esticar; docs/NUCLEO.md, "Tela" | montar a tela de um jogo (placar no topo, botão no rodapé, painel ao lado no desktop) sem Godot; a exportação para o Spine a tira e avisa (os ossos ficam no lugar da arte base) |
| Texto | não existe | parte `texto` (caixa no osso, chave de tradução ou texto livre, fonte, tamanho, cor, alinhamento, estouro), `fontes` e `traducoes` (a tabela de idiomas, o `translations.csv` do Godot); docs/NUCLEO.md, "Texto" | placar, botões e painéis em 12 idiomas sem uma imagem por idioma; o jogo troca o texto pelo nome; a exportação para o Spine o tira e avisa |
| Nove-fatias | não existe | `fatias` na região: 4 margens, esticar ou repetir o miolo, e `acompanha` (a caixa cresce com o texto de um slot); docs/NUCLEO.md, "Nove-fatias" | painel, barra e botão que esticam com a janela ou com o texto sem deformar as bordas; a exportação para o Spine as tira e avisa (a região inteira, igual no tamanho base) |
| Papéis | não existe | `papeis`: botão (área de toque com os estados normal, em cima, apertado e desligado, cada um uma animação), toque e texto do código, pelo nome; docs/NUCLEO.md, "Papeis" | o código do jogo acha cada elemento pelo nome e o toque é o mesmo no Godot e na web; a exportação para o Spine os tira e avisa |
| Binário | `.skel` fechado | `.bonecob`, especificado aqui | carregar rápido no jogo |

Fora do v0, por não aparecerem em nenhum dos 102 assets: slider, sequência de imagens, cor
escura (two color), herança de osso diferente da normal e de `noScale`/`noScaleOrReflection`
(que entraram com o zumbi e o monstro2 CC0), osso só de skin. Um import que os traga guarda o
trecho em `extras` e avisa.

## No editor

Um `x.boneco` dentro das pastas do editor aparece na lista de personagens. Para o editor,
ele é três arquivos virtuais ao lado (`x.boneco.spine-json`, `x.boneco.atlas`,
`x.boneco.ficha.md`), convertidos na hora; gravar qualquer um deles regrava o `.boneco`
(com cópia `.bak`), guardando o mix, a compressão das páginas e o multiply do motor. Ainda
sem versões automáticas e sem a conferência no Godot, que pedem um `-data.tres`.

## Importar do Spine

```sh
npx tsx tools/boneco.ts importar <x-data.tres | x.json> <saida.boneco> [--multiply certo|motor]
npx tsx tools/boneco.ts exportar <x.boneco> <pasta>
```

Importar lê o `.json` 4.3 e o `.atlas` (pelo `-data.tres`, ou o único `.atlas` ao lado), e
leva junto o mix do `-data.tres`, a ficha (`.ficha.md`) e a compressão das páginas (`.import`
do Godot); as páginas são copiadas ao lado do `.boneco`. Converte a física para o sentido do
jogo e marca o multiply: `"multiplica"` (o certo, padrão) ou `"multiplica_motor"` (o antigo
do Godot, para um jogo que foi ajustado contando com ele).

Medido nos 102 assets (85 do corpus privado, 17 de um jogo novo): a ida e volta devolve o
mesmo JSON e o mesmo atlas em todos; o `.boneco` em texto tem a mediana de 1,05 vez o tamanho
do JSON e do atlas juntos.

## Exportar para o Spine

Gera `.json` 4.3 e `.atlas` que o editor e os runtimes do Spine abrem. O que é só nosso:

| recurso nosso | como sai |
|---|---|
| multiply certo | página com a parte transparente pintada de branco (`cor*alfa + 1 - alfa`): com a fórmula do Godot o resultado fica igual |
| gravidade no sentido do jogo | sinal convertido para o do Spine |
| mix | `-data.tres` do Godot ao lado |
| ficha | `.ficha.md` ao lado |
| compressão da página | `.import` do Godot ao lado |
| `extras` de um import | devolvidos como vieram |

Regra: importar e exportar sem editar devolve um JSON que o Spine lê igual ao original
(conferido pelo oráculo: ossos e pixels iguais).

## Binário

A mesma árvore do texto, em bytes (`nucleo/src/binario.cpp`). Começa com `BNCB` e a versão (1);
depois, a tabela de textos (quantos, e cada um com o tamanho e os bytes em UTF-8: cada chave e
cada nome aparece uma vez só) e o valor raiz. Um valor é um byte de tipo e o que ele pede:

| tipo | o quê |
|---|---|
| 0, 1, 2 | nulo, falso, verdadeiro |
| 3 | inteiro: zigzag varint |
| 4 | decimal: zigzag varint `m` e um byte `e` (0 a 22): o número é `m / 10^e` |
| 5 | double cru: 8 bytes, little endian |
| 6 | texto: o índice na tabela (varint) |
| 7 | lista: quantos (varint) e os valores |
| 8 | objeto: quantos (varint) e os pares: índice da chave (varint) e o valor (a ordem das chaves é a do texto) |
| 9 | lista de números: quantos, um byte `e`, um byte `passo` e os zigzag varint; com passo 0 cada um é `m`, com passo `p` (1 ou 2) os `p` primeiros são `m` e os outros a diferença para o `m` de `p` antes (pares x, y andam de 2 em 2); o número é `m / 10^e` |

**O mesmo número que o texto.** Com `|m| < 2^53` e `10^e` exato em double (`e <= 22`),
`m / 10^e` é uma divisão só, arredondada certo: dá o mesmo double que o texto decimal lido
pelo leitor de JSON. O codificador procura o menor `e` em que `m / 10^e` volta exatamente ao
número e manda como double cru o que não volta (ou o `-0`). A conferência
(`npx tsx tools/boneco-binario.ts`) codifica cada `.boneco` dos testes e dos exemplos e exige a
saída do `nucleo-pose` igual byte a byte com o texto e com o binário, em todas as animações.

**Converter:** `npx tsx tools/boneco.ts binario <x.boneco> <saida.boneco>` (e `texto` para
voltar), ou direto `nucleo/build/nucleo-binario`, que confere a árvore número a número. O editor
abre os dois e grava um binário de volta em binário.

**Medido** (nos 24 personagens de dois jogos de produção, com malhas com pesos, física e 76
animações num deles): 2.245 KB de texto viram 413 KB (5,4 vezes menos); com gzip, 154 contra
123 KB; com brotli, 106 contra 98,5 KB; a carga até o modelo, 10,5 contra 6,4 ms. Nos 17 dos
testes e exemplos, 1.741 KB viram 394 KB e a carga cai de 6,5 para 3,5 ms (com brotli o
binário sai 7% maior que o texto ali: arquivos pequenos, em que o texto repete muito).

## Núcleo (runtime)

Um código só em C++, escrito a partir desta especificação: wasm no editor, módulo no Godot.
Contas da pose em `double`, ordem de atualização documentada aqui (pais antes de filhos;
constraints na ordem do arquivo; física em passo fixo de 1/60 s), para editor e jogo darem o
mesmo número. Desenho em lotes por página e blend, com o recorte (clipping) feito na malha.

## Testes de aceitação

No repositório privado, o spine-core e o spine-godot são o oráculo (só os resultados, nunca
o código):

1. Importar e exportar os 102 assets: o Spine lê o exportado igual ao original.
2. Núcleo novo contra o oráculo: ossos a menos de 0,01 px e pixels iguais pelo critério do
   `tools/parity.ts`, em todas as animações, emendas e cortes.
3. Desempenho: carregar e posar pelo menos tão rápido quanto o runtime atual (15
   personagens a 0,24 ms no nativo, 0,33 ms no wasm).
4. Marco 1: os 3 personagens CC0 e os 17 do jogo novo, no editor e no Godot.
