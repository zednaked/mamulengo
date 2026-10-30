# Jogos web no celular

Medido num Android intermediário (Galaxy A52s: Snapdragon 778G, Adreno 642L, tela 1080 x 2177 a 60 Hz,
`devicePixelRatio` 2,81, Chrome 156) com um jogo do Godot 4 exportado para a web, feito em
700 x 1370 (`stretch canvas_items`, `aspect expand`), com personagens animados em toda a tela.

## O que pesa

| runtime de animação | quadros acima de 25 ms em 30 s (3 rodadas) | p95 | thread principal |
|---|---|---|---|
| núcleo do Mamulengo (`.boneco`) | 241 / 119 / 109 | 32,5 ms | 84 a 94% |
| spine-godot (o plugin oficial) | 155 / 128 / 149 | 32,5 ms | 89 a 93% |

Os dois perdem quadro igual. No perfil, 35% da thread principal fica parada em `getParameter` (2
chamadas por quadro: é onde o navegador espera a GPU terminar), com 15 a 23% de tempo ocioso sobrando;
o wasm inteiro da animação aparece com poucos por cento. O jogo está preso na GPU, não na CPU nem na
animação.

A causa é o tamanho do canvas. O Godot web multiplica o canvas pelo `devicePixelRatio` da tela, então
o jogo de 700 px de largura é desenhado com 1080 px (mais que o dobro de pixels), sem ganhar
nitidez: a arte é do tamanho base.

| densidade do canvas | canvas | quadros acima de 25 ms em 30 s | p95 | thread principal |
|---|---|---|---|---|
| a da tela (2,81) | 1080 x 2112 | 183 / 125 / 127 | 32,6 ms | 87 a 93% |
| **a do tamanho base (1,875)** | **720 x 1408** | **10 / 9 / 13** | **16,4 ms** | **64 a 65%** |
| 1 | 384 x 751 | 7 | 16,4 ms | 60% |

Rodadas alternadas em 29/10, densidade emulada pelo DevTools (`--dpr` do medidor, abaixo). No
tamanho base a captura fica igual à da densidade da tela, texto e bordas incluídos.

## No dia seguinte (30/10)

O Chrome do celular se atualizou (156.0.8078.47 para 156.0.8078.79) e a medida mudou. Com o
trecho abaixo já dentro do export (não emulado), em rodadas alternadas, pelo `medir-web.ts` e
pelo medidor da primeira série:

| canvas | quadros acima de 25 ms em 30 s | p95 | thread principal |
|---|---|---|---|
| a da tela, 1080 x 2112 | 20 / 19 / 15 / 15 / 15 | 16,4 ms | 74% |
| o tamanho base, 700 x 1370 (trecho) | 17 / 18 / 17 / 10 / 15 | 16,4 ms | 67 a 71% |

Sem a correção o jogo já não perdia quadro como no dia anterior; com ela, uns 3 pontos a menos
de thread principal. Não dá para dizer com certeza que foi o navegador (pode ter sido o estado
do aparelho), mas a conclusão vale para os dois casos: o ganho depende do aparelho e do
navegador, e o tamanho base nunca custa nada visível. Vale como seguro para aparelhos em que
a GPU é o gargalo.

## A correção

Um script no **Head Include** do preset web (Exportar > Web > HTML > Head Include, ou
`html/head_include` no `export_presets.cfg`): antes do motor carregar, `devicePixelRatio` passa a
devolver no máximo o necessário para o canvas ter o tamanho base do jogo. Não muda o motor nem o
template; em telas menores que o tamanho base nada muda.

```html
<script>
// desenha o canvas no maximo no tamanho base do jogo: numa tela densa, o resto e so custo de GPU
(() => {
  const LARGURA = 700, ALTURA = 1370; // window/size/viewport_width e viewport_height
  const nativo = window.devicePixelRatio || 1;
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    get: () => Math.min(nativo, Math.max(1, LARGURA / innerWidth, ALTURA / innerHeight)),
  });
})();
</script>
```

Troque `LARGURA` e `ALTURA` pelo tamanho base do seu projeto. Arte feita em resolução maior que a
base (texturas 2x) perde parte dessa nitidez extra: nesse caso, multiplique os dois números.

## Medir

`tools/medir-web.ts` mede qualquer página (um jogo exportado, a demo, o palco): intervalo entre
quadros, ocupação da thread principal, tamanho do canvas, chamadas WebGL por quadro (`--gl`) e perfil
de CPU (`--perfil`). No celular, pelo Chrome dele:

```sh
# celular com a depuração USB ligada e o Chrome aberto; o jogo servido aqui na porta 8000
adb forward tcp:9222 localabstract:chrome_devtools_remote
adb reverse tcp:8000 tcp:8000
npx tsx tools/medir-web.ts http://127.0.0.1:8000/index.html saida.json 30 --cdp http://127.0.0.1:9222
npx tsx tools/medir-web.ts http://127.0.0.1:8000/index.html saida-720.json 30 --cdp http://127.0.0.1:9222 --dpr 1.875
```

O aparelho esquenta e varia de uma rodada para outra: alterne as variantes e repita. Deixe a tela
ligada e o Chrome na frente (com a tela apagada o navegador quase para de desenhar). Sem celular,
`--janela --lento 4` aproxima num desktop, mas não mostra a GPU do aparelho.

A demo ao vivo (`src/demo`) já limita a densidade a 2: no mesmo aparelho, 17,5% de thread principal e
o p95 em 16,4 ms.
