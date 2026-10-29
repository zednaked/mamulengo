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
- Depois do v0: `<nome>.bonecob`, a mesma coisa em binário (carregar rápido no jogo); o
  editor salva os dois.

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
                 "jogo": { "compressao": "perda", "qualidade": 0.7 } } ],   // pma, filtro, escala se houver
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

Valores que mudam de nome: blend `aditivo`, `multiplica`, `multiplica_motor`, `tela`; tipo de
parte `regiao`, `malha`, `malha_ligada`, `recorte`, `caminho`, `ponto`, `caixa`; tipo de
restrição `ik`, `transformacao`, `caminho`, `fisica`, `slider`.

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
