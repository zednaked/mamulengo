# Ficha: monstro

> Ficha de exemplo do corpus livre: gerada com `npm run ficha -- draft` e completada a mao. `npx tsx tests/corpus.ts` confere as regras.

## Personagem

- **Quem e:** Mascote redondo no estilo de simbolo de caca-niquel (CC0), exemplo do corpus. Elastico: squash e stretch generosos.
- **Onde aparece no jogo:** Personagem de teste: sem jogo. Pensado do tamanho de um simbolo de rolo.
- **Projeto:** tests/assets
- **Transicoes no jogo:** mix padrao 0s. Poses de inicio e fim precisam combinar com isso.

## Rig

9 ossos, 8 slots, 1 constraints.

### O que e preso a que

- `antena_fisica` (physics): antena (rotacao). ligada em idle, ganhou.

### Gestos prontos (trocas de imagem)

- `olho`: olho, olho_fechado; usado em idle

### Cuidados

- antena passa por baixo de olho (osso topo): se andar demais, some atras
- braco_e passa por baixo de corpo, boca (osso corpo): se andar demais, some atras
- braco_d passa por baixo de corpo, boca (osso corpo): se andar demais, some atras
- olho passa por baixo de boca (osso corpo): se andar demais, some atras

### Faixas usadas pelo animador (relativas ao setup)

Limite natural do movimento. Ir alem pede motivo.

- `base`: translate 0..0 / 0..60; scale 0.9..1.1 / 0.8..1.1
- `corpo`: scale 1..1 / 1..1
- `topo`: rotate -5..5
- `braco_e`: rotate -70..8
- `braco_d`: rotate -8..70

```regras
# limites (faixa do animador com folga); ajuste se o personagem permitir mais
limite topo rotate -8..8
limite braco_e rotate -82..20
limite braco_d rotate -20..82
fisica antena 25
```

## Animacoes

Cada animacao: para que serve, quando toca, roteiro em batidas, comportamento esperado e o que nao fazer. As regras de cada secao somam com as do Rig.

## Animacao: idle

- **Para que serve:** Respiracao de simbolo parado.
- **Quando toca:** Em loop.
- **Duracao:** 2s; emenda em loop
- **Mexe em:** corpo, topo, braco_e, braco_d; troca olho
- **Roteiro (batidas):** Respira, inclina o topo, balanca os bracos e pisca (troca do olho); 2 s.
- **Comportamento esperado:** Fofo e discreto: nao disputa com os outros simbolos.
- **Nao fazer:** Movimento grande no idle.

```regras
duracao 2..2
loop
troca olho olho_fechado
```

## Animacao: ganhou

- **Para que serve:** Comemoracao de simbolo premiado.
- **Quando toca:** Uma vez por premio, voltando para idle.
- **Duracao:** 0.8s; emenda em loop
- **Mexe em:** base, braco_e, braco_d
- **Roteiro (batidas):** Pula com squash na base e levanta os bracos; 0,8 s.
- **Comportamento esperado:** Alegria rapida e elastica.
- **Nao fazer:** Sair da celula do simbolo (sem recorte, invade os vizinhos).

```regras
termina_como idle 2
comeca_como idle 2
duracao 0.8..0.8
loop
```
