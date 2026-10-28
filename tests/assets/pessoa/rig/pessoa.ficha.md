# Ficha: pessoa

> Ficha de exemplo do corpus livre: gerada com `npm run ficha -- draft` e completada a mao. `npx tsx tests/corpus.ts` confere as regras.

## Personagem

- **Quem e:** Pessoa de corpo inteiro com mangas que dobram (CC0), exemplo do corpus. Movimento natural, sem cartoon.
- **Onde aparece no jogo:** Personagem de teste: sem jogo.
- **Projeto:** tests/assets
- **Transicoes no jogo:** mix padrao 0s. Poses de inicio e fim precisam combinar com isso.

## Rig

15 ossos, 14 slots, 1 constraints.

### O que e preso a que

- `cabelo_fisica` (physics): cabelo (rotacao). ligada em idle, acenar.

### Gestos prontos (trocas de imagem)

- nenhuma

### Cuidados

- mao_e passa por baixo de manga_e (osso ombro_e): se andar demais, some atras
- mao_d passa por baixo de manga_d (osso ombro_d): se andar demais, some atras

### Faixas usadas pelo animador (relativas ao setup)

Limite natural do movimento. Ir alem pede motivo.

- `tronco`: scale 1..1 / 1..1
- `cabeca`: rotate -3..3
- `ombro_e`: rotate -5..5
- `cotovelo_e`: rotate -4.9..4.9
- `ombro_d`: rotate -5..100
- `cotovelo_d`: rotate -25..25

```regras
# limites (faixa do animador com folga); ajuste se o personagem permitir mais
limite cabeca rotate -6..6
limite ombro_e rotate -8..8
limite cotovelo_e rotate -7.9..7.9
limite ombro_d rotate -21..116
limite cotovelo_d rotate -33..33
fisica cabelo 25
```

## Animacoes

Cada animacao: para que serve, quando toca, roteiro em batidas, comportamento esperado e o que nao fazer. As regras de cada secao somam com as do Rig.

## Animacao: idle

- **Para que serve:** Respiracao de espera.
- **Quando toca:** Em loop.
- **Duracao:** 2.4s; emenda em loop
- **Mexe em:** tronco, cabeca, ombro_e, cotovelo_e, ombro_d, cotovelo_d
- **Roteiro (batidas):** Tronco respira, cabeca balanca, bracos balancam com atraso; 2,4 s.
- **Comportamento esperado:** Natural.
- **Nao fazer:** Cotovelo dobrar para tras.

```regras
duracao 2.4..2.4
loop
```

## Animacao: acenar

- **Para que serve:** Acena para o jogador.
- **Quando toca:** Uma vez ou em loop curto.
- **Duracao:** 1.8s; emenda em loop
- **Mexe em:** ombro_d, cotovelo_d
- **Roteiro (batidas):** Levanta o braco direito e balanca o antebraco; 1,8 s.
- **Comportamento esperado:** Simpatia clara.
- **Nao fazer:** Girar o ombro alem da faixa (a manga abre).

```regras
duracao 1.8..1.8
loop
```
