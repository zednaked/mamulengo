# Lista do Mamulengo

O que está aberto, em ordem de prioridade.

## Agora

1. **O editor desenhando pelo núcleo:** o núcleo C++ compilado para wasm no lugar do renderizador de referência, para que o editor e o jogo desenhem com o mesmo código.
2. **`.boneco` binário,** para pacotes menores.
3. **GDExtension para macOS.**
4. **Teste com uma pessoa:** levar para o editor o que a pessoa achou.

## Qualidade das animações (medidas que faltam)

- **Rosto:** olhos, sobrancelhas, focinho, boca e óculos mantendo a relação com a cabeça, salvo trocas de expressão.
- **Fluidez:** velocidade das articulações contra a casa e micromovimento nas poses seguradas (quantos ossos ainda se mexem).
- **Faixa segura por articulação:** girar cada osso de braço, perna e pescoço medindo a torção da malha para achar até onde a arte aguenta, e gerar regras `limite` automáticas.
- **Deform corretivo:** passo a passo no guia de como esculpir a forma do braço nas poses extremas.

## Além do Spine

- Shaders por parte (brilho, contorno, dissolve, cor por evento), materiais, partículas presas a ossos.
- Bake: assar animações (poses por quadro, deform, física) para tocar barato em mobile e web, ou para spritesheet.
- Novos tipos de constraint, de timeline e de attachment.
