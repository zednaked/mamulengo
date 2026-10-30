# Lista do Mamulengo

O que está aberto, em ordem de prioridade.

## Agora

1. **Desempenho no celular:** medir de novo com o canvas no tamanho base (docs/CELULAR.md) e o `.boneco` binário, e ver o que sobra para o núcleo.
2. **O addon na Godot Asset Library,** e o build de macOS conferido num Mac.
3. **Teste com uma pessoa:** levar para o editor o que a pessoa achou.

Feito há pouco: o núcleo como modo padrão do editor (o spine-core só nos modos de comparação), o
`.boneco` binário (docs/FORMATO.md "Binário") e o borrar (docs/NUCLEO.md "Borrar").

## Qualidade das animações (medidas que faltam)

- **Rosto:** olhos, sobrancelhas, focinho, boca e óculos mantendo a relação com a cabeça, salvo trocas de expressão.
- **Fluidez:** velocidade das articulações contra a casa e micromovimento nas poses seguradas (quantos ossos ainda se mexem).
- **Faixa segura por articulação:** girar cada osso de braço, perna e pescoço medindo a torção da malha para achar até onde a arte aguenta, e gerar regras `limite` automáticas.
- **Deform corretivo:** passo a passo no guia de como esculpir a forma do braço nas poses extremas.

## Além do Spine

- Feito: efeitos por parte (contorno, brilho, dissolver, tingir), partículas presas a ossos (com raio e órbita) e giro em 2,5D; ver `exemplos/vitrine` e `exemplos/jogo`.
- Depois: cor por evento, materiais, partículas que andam com o osso, colisão com o chão.
- Bake: assar animações (poses por quadro, deform, física) para tocar barato em mobile e web, ou para spritesheet.
- Novos tipos de constraint, de timeline e de attachment.
