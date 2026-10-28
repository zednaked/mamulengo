# Estilo da casa (medido)

O "quanto" de uma animação, medido nas animações prontas de um estúdio e agrupado por tipo de asset e papel da animação: duração, quanto o corpo anda e gira, silhueta, amassa e estica, deform, batidas, pausas, chaves por segundo e trocas de imagem. Valores são o intervalo do meio (25% a 75%) e a mediana, relativos à altura do personagem. Nenhuma arte entra na medida.

Este repositório não traz a casa de ninguém: `src/core/estilo-casa.json` vem vazio. Gere a sua sobre os seus jogos:

```sh
npx tsx tools/estilo.ts <pasta dos jogos> [<outra> ...] --md docs/ESTILO.md --resumo src/core/estilo-casa.json
```

Com ela gerada, `query.estilo {anim, papel}` e a regra `estilo <papel>` da ficha comparam qualquer animação com a faixa do papel e dizem o que ficou abaixo ou acima. Sem ela, os dois avisam que não há referência. Os testes usam faixas inventadas (`tests/estilo-casa.exemplo.json`).

## Como usar

- **Antes das chaves:** ache a linha do tipo e do papel da sua animação e use a mediana como alvo.
- **Depois:** meça com `query.estilo`, que usa a mesma régua.
- **Fora da faixa sem motivo é defeito.** Abaixo dela é o erro mais comum de quem anima do zero: tudo certo e tímido.
- **Escala, não pixels:** as medidas são relativas à altura do personagem (bounds do cabeçalho).
