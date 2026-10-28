# Ficha: aventureiro

> Ficha de exemplo do corpus livre: gerada com `npm run ficha -- draft` e completada a mao. `npx tsx tests/corpus.ts` confere as regras.

## Personagem

- **Quem e:** Aventureiro cartoon (arte CC0 da Kenney), exemplo do corpus. Leve e expressivo, exagero de cartoon aceito.
- **Onde aparece no jogo:** Personagem de teste: sem jogo. Imagine-o de corpo inteiro no canto da tela.
- **Projeto:** tests/assets
- **Transicoes no jogo:** mix padrao 0s. Poses de inicio e fim precisam combinar com isso.

## Rig

10 ossos, 8 slots, 1 constraints.

### O que e preso a que

- `cabeca_fisica` (physics): cabeca (rotacao). ligada em idle, susto.

### Gestos prontos (trocas de imagem)

- `cabeca`: cabeca, cabeca_susto; usado em susto

### Cuidados


### Faixas usadas pelo animador (relativas ao setup)

Limite natural do movimento. Ir alem pede motivo.

- `quadril`: translate 0..0 / 0..30; scale 0.9..1.1 / 0.8..1.1
- `tronco`: scale 1..1.1 / 1..1
- `cabeca`: rotate -4..4; translate -8..7 / -2.8..3.2
- `braco_e`: rotate -6..6
- `braco_d`: rotate -6..6

```regras
# limites (faixa do animador com folga); ajuste se o personagem permitir mais
limite cabeca rotate -7..7
limite braco_e rotate -9..9
limite braco_d rotate -9..9
fisica cabeca 25
```

## Animacoes

Cada animacao: para que serve, quando toca, roteiro em batidas, comportamento esperado e o que nao fazer. As regras de cada secao somam com as do Rig.

## Animacao: idle

- **Para que serve:** Respiracao de espera.
- **Quando toca:** Em loop enquanto nada acontece.
- **Duracao:** 1.6s; emenda em loop
- **Mexe em:** tronco, cabeca, braco_e, braco_d
- **Roteiro (batidas):** Tronco respira, cabeca balanca, bracos acompanham com atraso; 1,6 s.
- **Comportamento esperado:** Vivo e calmo.
- **Nao fazer:** Trocar o rosto ou mover os pes (o rig nao tem pernas articuladas).

```regras
duracao 1.6..1.6
loop
```

## Animacao: susto

- **Para que serve:** Reacao de susto.
- **Quando toca:** Uma vez, voltando para idle.
- **Duracao:** 0.6s; emenda em loop
- **Mexe em:** quadril, cabeca; troca cabeca
- **Roteiro (batidas):** Troca o rosto para o assustado, pula com o quadril e treme a cabeca; 0,6 s.
- **Comportamento esperado:** Leitura imediata do susto pelo rosto.
- **Nao fazer:** Esquecer de voltar ao rosto normal no fim.

```regras
duracao 0.6..0.6
loop
troca cabeca cabeca_susto
```
