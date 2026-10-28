# Fluxo: do pedido à animação no jogo

Mapa do trabalho com personagens Spine nos jogos Godot, do pedido à manutenção. Cada etapa tem o que entra, o que sai, quem faz e como conferir. Gente e Claude Code seguem o mesmo fluxo, e todos os passos estão no Mamulengo.

| etapa | entra | sai | conferência |
|---|---|---|---|
| 0. Pedido | ideia, referência, onde o personagem aparece | resumo de uma página | o usuário confirma |
| 1. Ficha | resumo, arte (camadas), código do jogo | `<nome>.ficha.md` | o usuário lê; as regras rodam |
| 2. Rig | arte em camadas, ficha | `.spine-json`, atlas, `-data.tres` | `query.rig`, poses de teste, Godot |
| 3. Animar | rig, ficha | animações no `.spine-json` | `ficha.check`, `query.motion`, `query.transition`, `look`, GIF |
| 4. Entrega | asset conferido | arquivos no projeto do jogo | Godot de verdade, código do jogo |
| 5. Manutenção | pedido de mudança | ficha e asset atualizados | `ficha.check` em tudo |

## 0. Pedido

Antes de tocar em arquivo, responda:
- o que o personagem é e como se move;
- onde aparece, em que tamanho e com o que em volta;
- quais animações o jogo precisa e quando cada uma toca;
- o que já existe e o que é novo.

Num jogo existente, leia o código que toca as animações. Dele sai metade da ficha: nomes, loop ou não, o que vem depois, mix, time scale e enquadramento.

## 1. Ficha (`docs/FICHA.md`)

O documento que diz o que deve acontecer. Fica ao lado do `.spine-json` e vai junto para o jogo.
- **Personagem novo:** escreva a ficha antes do rig. Ela diz o que o rig precisa permitir: quais peças mexem, quanto, que trocas de imagem existem, o que é preso a quê.
- **Personagem que já existe:** `npm run ficha -- draft <x-data.tres>` mede o rig e as animações, lê o código do jogo e gera o rascunho. Depois complete a intenção.
- **Regras:** cada seção tem um bloco de regras verificáveis (limites, peças presas, loop, pose final). Elas transformam "não pode quebrar" em teste.

## 2. Rig (`docs/RIGAR.md`)

Montar ossos, slots, malhas, pesos, constraints e física a partir da arte, guiado pela ficha. No fim, o `query.rig` mostra o rig do jeito que a ficha previu, e poses extremas (os limites da ficha) não quebram a arte.

## 3. Animar (`docs/ANIMAR.md`)

1. **Estudar:** leia a ficha e rode `query.rig`.
2. **Roteiro:** batidas com tempo, escritas na seção da animação na ficha **antes** de criar as chaves.
3. **Construir:** gerador reprodutível; `pose.follow` para peças presas.
4. **Conferir:** `ficha.check`, `query.motion`, `query.relation`, `look` grande, quadros do GIF.

A animação só está pronta quando a ficha passa e os quadros grandes foram vistos.

## 4. Entrega

- **Trabalhe numa cópia** (o sandbox, por exemplo). Grave no projeto do jogo só com pedido explícito; o Mamulengo faz backup de cada arquivo que sobrescreve (`~/.cache/mamulengo/backups`).
- **"Ver no Godot":** renderiza no Godot de verdade e compara com o editor. Prova o render, não a animação.
- **Nomes e cabeçalho:** não mude o nome de animação que o código chama nem os bounds do cabeçalho (o jogo enquadra o personagem por eles).
- **Rode o jogo:** a animação nova precisa ser chamada pelo código, ou documentada na ficha como reserva.

## 5. Manutenção

- **Mudou o rig:** rode `ficha.check` em todas as animações; regra que quebrou é animação que quebrou.
- **Animação nova:** primeiro a seção na ficha, depois as chaves.
- **Comportamento mudou de propósito:** mude a ficha no mesmo commit.

## Ferramentas por etapa

| precisa de | ferramenta |
|---|---|
| rascunho da ficha com contexto do jogo | `npm run ficha -- draft <x-data.tres>` |
| conferir a ficha | `npm run ficha -- check <ficha.md>` ou o comando `ficha.check` |
| estudar o rig | `query.rig`, `query.tree`, `query.bone`, `query.animation` |
| movimento real na tela | `query.motion` |
| peça presa a outra | `query.relation`, `pose.follow` |
| emenda com a próxima animação, interrupção | "depois desta" na timeline, `look`/`export` com `sequence`, `query.transition`, regras `transicao` e `corte` |
| ver | `mamulengo_look` (`fit:false, scale:2`), `mamulengo_export` |
| comparar com o Godot | "ver no Godot", `tools/parity.ts` |
| paridade e regressão do editor | `npm test`, `npx tsx tests/corpus.ts` |
