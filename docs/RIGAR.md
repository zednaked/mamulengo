# Rigar com o Mamulengo

Montar o rig a partir da arte, guiado pela ficha (`docs/FICHA.md`). Um rig bom deixa as animações da ficha acontecerem sem quebrar a arte, e nada além do que é preciso.

## Antes

- **Ficha:** escreva primeiro as seções Personagem e Animações, com os roteiros. Cada batida diz o que o rig precisa: "baixa os óculos" pede óculos separados do rosto e presos à mão; "hang loose" pede uma mão alternativa; "pisca" pede olho fechado ou malha deformável.
- **Arte:** venha em camadas, uma por peça que mexe sozinha, com sobra de pintura onde peças se sobrepõem (ombro sob o braço, pescoço sob a cabeça), para não abrir buraco ao girar. Mãos e rostos alternativos vêm como camadas extras (escondidas no PSD).
- **PSD:** o jeito mais curto de começar é largar o `.psd` no editor (ou o botão **📥 PSD**; pela ponte, `psd` / `mamulengo_psd`). Ver "Começar por um PSD" abaixo.
- **Faltou algo na arte?** Isso aparece aqui, não na animação. Peça antes de rigar.

## Começar por um PSD

Largar o `.psd` no editor oferece duas coisas:

- **Criar personagem novo:** cada camada visível vira uma imagem numa parte (slot), na ordem das camadas (a de baixo é desenhada atrás) e no lugar exato da composição. O setup reproduz o PSD: medido com `tools/psd-composite.ts`, o editor e o Godot ficam a no máximo 8/255 da composição do PSD feita pelo ImageMagick, com erro médio 0.02/255. Camadas escondidas entram como imagens de troca, escondidas no setup. Sai no formato do jogo (`.spine-json`, `.atlas`, página `.webp`, `-data.tres`) e já abre.
- **Atualizar o personagem aberto:** casa cada camada com a imagem de mesmo nome. Desenho retocado é reempacotado no lugar; imagem que mudou de tamanho ou de lugar é ajustada (`attachment.refit`); camada nova vira imagem nova, logo acima da camada de baixo dela no PSD. Nada é apagado nem reordenado: imagens que saíram do PSD ficam como estavam (o resumo lista). Salva no fim, porque o atlas já mudou no disco. Desfazer volta o esqueleto, mas o atlas fica com as imagens novas.

O resumo mostra camadas importadas, ignoradas, tags lidas e avisos (efeito de camada, modo de mistura que o Spine não tem, malha que ficou menor que o desenho).

**Malha cuja imagem mudou de tamanho** (o caso difícil): os vértices, os pesos, os deforms e os triângulos ficam exatamente onde estavam; só as UVs mudam, para cada vértice continuar no mesmo ponto do desenho. A imagem gravada cobre a área antiga e a nova, para nenhuma UV sair dela. Se o desenho cresceu para fora da malha (um topete novo), a parte nova fica cortada até alguém aumentar a malha (Montar > Editar malha); o resumo avisa. Mover os vértices junto com o desenho estragaria os deforms e o encaixe com as outras peças, então a escolha é não mexer no que já está rigado.

**Region que mudou:** tamanho e posição seguem a arte; a rotação, a escala e o espelho que o rig deu ficam.

**Onde cada imagem estava no PSD** fica em `images/psd-import.json`, ao lado das imagens-fonte. É o que permite ajustar só o que mudou. Asset que não veio de PSD (montado à mão) não tem esse registro: imagem que mudou de tamanho fica com o mesmo centro, e as camadas novas são alinhadas pelas imagens que já existem (mediana do desvio).

**Origem do personagem** (o 0,0 do Spine): o centro de uma camada `[origin]`; sem ela, o meio da borda de baixo do PSD. Na atualização sem `[origin]`, vale a da importação anterior.

### Tags nos nomes de camada e grupo (PhotoshopToSpine)

As mesmas do script oficial do Spine, entre colchetes em qualquer lugar do nome. Sem `:nome`, vale o nome da camada ou do grupo.

| tag | efeito |
|---|---|
| `[bone]`, `[bone:nome]` | as camadas de dentro ficam presas a um osso, criado no centro delas; grupos `[bone]` dentro de outros viram ossos filhos |
| `[slot]`, `[slot:nome]` | as camadas de dentro ficam na mesma parte (trocas: rosto normal visível, rosto assustado escondido) |
| `[skin]`, `[skin:nome]` | as camadas de dentro vão para essa skin (imagens na subpasta da skin) |
| `[folder]`, `[folder:nome]` | as imagens vão para uma subpasta (o nome da imagem leva a pasta) |
| `[ignore]` | a camada ou o grupo fica de fora (rascunho, guia, referência) |
| `[merge]` | grupo: as camadas visíveis de dentro viram uma imagem só |
| `[path:nome]` | nome do arquivo da imagem, quando difere do nome da camada |
| `[scale:x]` | a imagem é gravada nessa escala e o attachment compensa (mesmo tamanho na tela) |
| `[trim]`, `[trim:false]` | recorta a transparência em volta (padrão) ou grava do tamanho do PSD |
| `[mesh]`, `[mesh:fonte]` | vira malha deformável; com nome, linked mesh da malha `fonte` da mesma parte |
| `[name:pre*suf]` | grupo: prefixo e sufixo nos nomes de dentro (`[name:*_e]` faz braço_e, mão_e) |
| `[overlay]` | a camada pinta por cima de todas as de baixo, só onde elas têm desenho (como máscara de recorte) |
| `[origin]` | (do Mamulengo) o centro dessa camada é a origem do personagem; a camada não vira imagem |

Também como no script oficial: **grupos sem tag não viram nada** (só organizam o PSD; o osso vem de `[bone]`), a camada de fundo opaca do tamanho do PSD é ignorada, os modos Multiply, Screen e Linear Dodge viram o blend do slot, e opacidade, máscara de camada e camadas presas (clipping) são aplicadas na imagem.

Diferenças e o que ficou de fora:
- **`[mesh]`:** o oficial cria uma malha de 4 vértices; aqui é a malha automática pelo contorno (a mesma de "Deixar deformável"), que já serve para deformar.
- **Origem:** o oficial usa a origem da régua do Photoshop, que a leitura do PSD não alcança; aqui é `[origin]` ou o meio da borda de baixo.
- **`[bone]`:** o osso nasce no centro das camadas visíveis do grupo (o oficial usa o centro de uma camada).
- **`[pad:x]`** não é tag do oficial (padding é opção global) e não existe aqui: o atlas já sangra a borda.
- **Opções globais do script:** "ignorar camadas escondidas" existe só na ponte (`ignoreHidden`); escala e padding globais e `revealAll` (camada saindo do PSD) não: o que passa da borda do PSD é cortado.
- **Efeitos de camada** (sombra, contorno) e **camadas de ajuste** não entram; o resumo avisa. Rasterize no Photoshop se precisar. Outros modos de mistura viram normal, com aviso.

Exemplo com todas as tags: `tests/assets/psd/aventureiro.psd` (arte CC0, gerado por `tools/psd-fixture.ts`; `aventureiro-v2.psd` é a mesma arte depois de retocada, para testar a atualização).

## Montar

1. **Ossos:** da raiz para as pontas, com a origem do osso na articulação de verdade (ombro, cotovelo, pescoço). Use `bone.add` com `at` e `toward`, em coordenadas da tela. Comprimento ao longo da peça: IK e física dependem dele.
2. **Imagens:** vindas do PSD, já estão no lugar e na ordem. À mão: `attachment.region` com `world` (centro, rotação e escala na composição), slots na ordem de desenho da arte. Os ossos do PSD só têm posição (sem comprimento nem rotação, como no script oficial). Para pôr uma parte em outro osso, `slot.set {slot, bone}`: a imagem fica no mesmo lugar da tela (`keepWorld`, padrão).
3. **Malhas e pesos:** onde a peça dobra ou amassa (braço contínuo, barriga, rosto). Use `mesh.create`, `mesh.weights` e `mesh.paintWeights`. Teste girando os ossos até os limites da ficha.
4. **Trocas:** imagens alternativas no mesmo slot, escondidas no setup. Para gesto de mão, todas as peças da mão normal têm de poder sumir junto.
5. **Constraints:**
   - **IK:** onde a ponta precisa ficar num lugar (mão no objeto, pé no chão).
   - **Transform:** onde uma peça segue outra só às vezes (os óculos na mão). Documente na ficha quando ligar.
   - **Física:** em pontas soltas (orelha, cabelo, aba, rabo), com `physics.preset`. Se não deve rodar em tudo, deixe mix 0 no setup e ligue por animação. Sem gravidade nas físicas de rotação: no spine-godot ela puxa para o outro lado e a peça não volta ao lugar.
6. **Setup pose:** a pose de descanso, apresentável. É o que o jogo mostra ao carregar.
7. **Bounds:** `skeleton.bounds` depois que o rig estiver pronto; em personagem novo, a união do setup com as animações (`{animations:true}`), para nada sair da área que o jogo reserva. O jogo enquadra o personagem por eles; mudar depois desloca o personagem nas telas que já existem.

## Conferir

- **`query.rig`:** constraints, trocas e avisos (física sem comprimento, peça que some atrás de outra) batem com o que a ficha prevê?
- **Poses extremas:** anime uma animação de teste girando cada osso até o limite da ficha. Olhe grande (`look` com `fit:false, scale:2`) procurando costura, buraco ou peça sumindo. Apague a animação de teste.
- **Godot:** "ver no Godot" no setup e nas poses extremas.
- **Ficha:** complete "Cuidados" e as faixas com o que o rig aguenta de verdade e rode `ficha.check`.

## Mudar um rig que já tem animações

- **Reordenar ossos:** remapeia os pesos das malhas (`src/core/boneorder.ts` faz sozinho).
- **Constraint no setup:** se a mudança altera todas as animações, prefira chaves por animação.
- **Depois de qualquer mudança:** `npm run ficha -- check` em todas as animações. Regra que quebrou é animação que quebrou.
