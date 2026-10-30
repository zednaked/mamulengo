# Lista do Mamulengo

O que está aberto, em ordem de prioridade.

## Agora

1. **Desempenho no celular:** medir de novo com o canvas no tamanho base (docs/CELULAR.md) e o `.boneco` binário, e ver o que sobra para o núcleo.
2. **O addon na Godot Asset Library,** e o build de macOS conferido num Mac.
3. **Teste com uma pessoa:** levar para o editor o que a pessoa achou.

Feito há pouco: as instâncias, um `.boneco` dentro de outro, no núcleo, no editor e no Godot
(docs/NUCLEO.md "Instâncias", `exemplos/vinheta`); a luz dinâmica 2D com relevo calculado da arte
(docs/NUCLEO.md "Luzes", `exemplos/vagalume`); o rastro e o borrar; o `.boneco` binário; a
timeline que toca milhares de chaves sem engasgar; e a interface compacta para tela pequena.

## Qualidade das animações (medidas que faltam)

- **Rosto:** olhos, sobrancelhas, focinho, boca e óculos mantendo a relação com a cabeça, salvo trocas de expressão.
- **Fluidez:** velocidade das articulações contra a casa e micromovimento nas poses seguradas (quantos ossos ainda se mexem).
- **Faixa segura por articulação:** girar cada osso de braço, perna e pescoço medindo a torção da malha para achar até onde a arte aguenta, e gerar regras `limite` automáticas.
- **Deform corretivo:** passo a passo no guia de como esculpir a forma do braço nas poses extremas.

## Além do Spine

- Feito: efeitos por parte (contorno, brilho, dissolver, tingir), borrar, rastro, partículas presas a ossos (com raio e órbita), giro em 2,5D, luz dinâmica 2D e instâncias; ver `exemplos/vitrine`, `exemplos/jogo`, `exemplos/vagalume` e `exemplos/vinheta`.
- Instâncias, o que falta: extrair ossos para um `.boneco` novo (e o caminho de volta), entrar na instância no editor para editá-la, misturar (mix) ao trocar a animação do filho e luz por camada (profundidade).
- Depois: cor por evento, materiais, partículas que andam com o osso, colisão com o chão.
- Bake: assar animações (poses por quadro, deform, física) para tocar barato em mobile e web, ou para spritesheet.
- Novos tipos de constraint, de timeline e de attachment.
