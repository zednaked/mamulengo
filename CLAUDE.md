# Mamulengo

Kit de animação 2D por esqueleto para jogos (editor, MCP, formato .boneco e núcleo C++ para Godot e web). Visão geral: README.md (inglês) e README.pt-BR.md. Guia do editor: docs/EDITOR.md. Testes de paridade e diferenças medidas do spine-godot: docs/PARIDADE.md.

## Ao animar ou rigar

Fluxo completo: docs/FLUXO.md. Cada personagem tem uma ficha (`<nome>.ficha.md`, ao lado do `.spine-json`; formato em docs/FICHA.md) com intenção, limites e regras verificáveis. Rigar: docs/RIGAR.md. Animar: docs/ANIMAR.md. Em resumo:

0. **Leia a ficha** do personagem. Se não houver, `npm run ficha -- draft <x-data.tres>` e complete; animação nova ganha a seção dela na ficha antes das chaves.
1. **Estude o rig:** `query.rig` mostra constraints e quando o animador as liga, a faixa usada em cada osso, as trocas de imagem e as armadilhas de camada.
2. **Planeje** um roteiro em batidas legíveis, com antecipação, atraso da hierarquia e assentamento. Reaproveite poses do animador.
3. **Construa** com um gerador reprodutível; para peças presas, use `pose.follow` ou ligue e desligue as constraints como o animador.
4. **Confira antes de mostrar:** `ficha.check` (todas as animações), `query.motion`, `query.relation`, `look` grande e quadros do GIF exportado. "Igual ao Godot" não valida animação.

Não edite as animações nem o setup existentes sem pedido. Pedido incoerente de propósito: faça e avise o que foge do rig.

## Ao mexer no código

- Todo comando novo passa por `src/core/commands` e ganha um caso em `tests/features.ts` (`npm test`).
- `npm run check` antes de commit.
- Assets privados (de jogos) nunca entram no repo; use `tests/assets` (CC0).
