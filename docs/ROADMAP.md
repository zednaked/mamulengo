# Lista do Mamulengo

O que está aberto, em ordem de prioridade.

## Agora

1. **Desempenho no celular:** medir de novo com o canvas no tamanho base (docs/CELULAR.md) e o `.boneco` binário, e ver o que sobra para o núcleo.
2. **O addon na Godot Asset Library,** e o build de macOS conferido num Mac.
3. **Teste com uma pessoa:** levar para o editor o que a pessoa achou.
4. **Editor de layout:** abrir uma cena de interface, mover, ancorar, editar textos e traduções, ver em vários tamanhos e idiomas, e salvar em `.tscn` (para o Godot) ou direto na cena do Mamulengo.

Feito agora: a interface de jogo web sem o Godot (docs/BACKEND.md "A cena do Mamulengo"). `src/cena`
lê o `.tscn`, calcula os `Control` como o Godot 4 e `src/tela` desenha em WebGL2 no tamanho exato
da janela, com variantes por proporção, estados de layout interpolados e bonecos com trilhas. Um
jogo de produção portado assim (1310 de 1330 nós iguais ao Godot) baixa 7x menos até a primeira
tela e fica pronto 5x mais rápido em 4G que o export do Godot.

Feito há pouco: o editor revisado com testes acompanhados (Mover numa junta dobra o membro, Alt
solta, Ctrl ajusta a imagem no osso, setas em passos, linha de ajuda da ferramenta, árvore com
linhas de ligação e arrastar para trocar o pai, alvo do IK entre os ossos existentes, fechar o
laço e vai e volta em chaves, reordenar com chaves de ordem, versões em `.boneco`, PSD sem
projeto Godot, atalhos, mensagens e acentos); o exemplo `exemplos/abducao` (paralaxe em nove
camadas com dois packs CC0 da Kenney, abertura e fechamento com o nome); a camada de ajuste (matiz, saturação, luminosidade, contraste e desfoque animados
pela timeline, sobre o que já foi desenhado; docs/NUCLEO.md "Ajuste"); o export em WebP animado
pelo editor; a vinheta nova em `exemplos/vinheta` (teatro de mamulengo feito de instâncias); as instâncias, um `.boneco` dentro de outro, no núcleo, no editor e no Godot
(docs/NUCLEO.md "Instâncias", `exemplos/vinheta`), com extrair ossos para um `.boneco` novo (e
embutir de volta), entrar na instância no editor e mistura ao trocar a animação do filho; a luz
por camada (profundidade no slot e na luz); a luz dinâmica 2D com relevo calculado da arte
(docs/NUCLEO.md "Luzes", `exemplos/vagalume`); o rastro e o borrar; o `.boneco` binário; a
timeline que toca milhares de chaves sem engasgar; e a interface compacta para tela pequena.

## Qualidade das animações (medidas que faltam)

- **Rosto:** olhos, sobrancelhas, focinho, boca e óculos mantendo a relação com a cabeça, salvo trocas de expressão.
- **Fluidez:** velocidade das articulações contra a casa e micromovimento nas poses seguradas (quantos ossos ainda se mexem).
- **Faixa segura por articulação:** girar cada osso de braço, perna e pescoço medindo a torção da malha para achar até onde a arte aguenta, e gerar regras `limite` automáticas.
- **Deform corretivo:** passo a passo no guia de como esculpir a forma do braço nas poses extremas.

## Além do Spine

- Feito: efeitos por parte (contorno, brilho, dissolver, tingir), borrar, rastro, partículas presas a ossos (com raio e órbita), giro em 2,5D, luz dinâmica 2D (com camadas), instâncias e camada de ajuste; ver `exemplos/vitrine`, `exemplos/jogo`, `exemplos/vagalume` e `exemplos/vinheta`.
- Depois: cor por evento, materiais, partículas que andam com o osso, colisão com o chão.
- Bake: assar animações (poses por quadro, deform, física) para tocar barato em mobile e web, ou para spritesheet.
- Novos tipos de constraint, de timeline e de attachment.
