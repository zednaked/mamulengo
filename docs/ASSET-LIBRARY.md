# Envio para a Godot Asset Library

Textos e campos para o formulário de https://godotengine.org/asset-library/asset/submit
(o envio é manual, pelo site). Os textos que vão para o site estão em
inglês. Onde aparece `zednaked/mamulengo`, confira o endereço do repositório público antes de
enviar.

## Antes de enviar

1. O repositório público com este commit, e o CI `gdextension` verde nele (os três jobs de
   compilação e o `addon`, que roda o exemplo no Godot 4.5).
2. A tag `v0.2.0` empurrada: o CI cria a release `v0.2.0` com
   `mamulengo-boneco-v0.2.0.zip`. (A `v0.1.0`, de 29/10, é de antes dos efeitos, das partículas,
   do borrar e do `.boneco` binário; o envio vai com a `v0.2.0`.) Abra o zip e confira as seis bibliotecas em
   `mamulengo-boneco/addons/boneco/bin/`.
3. Se puder, abra o exemplo num Mac com o addon da release (o macOS só o CI compilou).

## Campos

| campo | valor |
|---|---|
| Asset name | `Boneco: 2D skeletal animation (Mamulengo)` |
| Category | `2D Tools` |
| Godot version | `4.5` |
| Version | `0.2.0` |
| License | `MIT` |
| Repository host | `Custom` (o download é o zip da release, com as bibliotecas; o zip do código no GitHub não as tem) |
| Repository URL | `https://github.com/zednaked/mamulengo` |
| Issues URL | `https://github.com/zednaked/mamulengo/issues` |
| Download URL (no host `Custom`, o campo do commit) | `https://github.com/zednaked/mamulengo/releases/download/v0.2.0/mamulengo-boneco-v0.2.0.zip` |
| Icon URL | `https://raw.githubusercontent.com/zednaked/mamulengo/v0.2.0/docs/media/boneco-icone.png` |

O zip tem uma pasta de cima (`mamulengo-boneco/`) com `addons/boneco/` dentro: o instalador
do Godot tira essa pasta ("Ignore asset root", marcado por padrão) e instala em
`res://addons/boneco/`. Numa versão nova: tag `vX.Y.Z`, esperar o CI, e editar o asset no
site com a versão e o download novos.

## Descrição curta

Plays .boneco skeletal characters (bones, meshes, IK, physics, mixing, events, per-part
effects and particles) through a small C++ core. GDExtension for Linux, Windows and macOS.

## Descrição longa

```
Boneco plays 2D skeletal characters saved as .boneco, the format of the Mamulengo
animation toolkit, through its own C++ core written from scratch.

- BonecoSprite, a Node2D: tracks, a queue per track, mixing between animations
  (default and per pair), time scale, setup pose
- bones, slots, region and mesh attachments, weighted meshes, IK, transform, path
  and physics constraints, clipping, blend modes, draw order
- signals: animation_started, animation_interrupted, animation_completed,
  animation_ended, animation_event (name, int, float, string) and
  before_world_transforms_change to move bones from the game
- what Spine does not have, keyed on the timeline: per-part effects (outline, glow,
  dissolve, tint, smear), particles attached to bones (sprites, lightning, orbit)
  and 2.5D turns
- one mesh per batch kept between frames: only vertices are rewritten, and pieces
  that do not move send nothing to the GPU
- .boneco in text or binary (about 5 times smaller and faster to load, same pose);
  the README shows how to keep web exports smooth on phones
- load with BonecoData.carregar("res://hero.boneco"), load(), or by dragging the
  file onto the sprite's data property

Linux x86_64 (glibc 2.28+), Windows x86_64 and macOS (universal), debug and
release. Godot 4.5 or newer. No plugin to enable.

.boneco files come from the Mamulengo editor, which also opens and writes Spine
4.3 projects. The repository has the editor, the format spec and an example
project with three CC0 characters.

MIT license.
```

## Imagens (previews)

Todas CC0 (personagens de Kenney, kenney.nl) e geradas pelo próprio Mamulengo. URLs pela tag,
para não mudarem depois:

| ordem | arquivo | o que mostra |
|---|---|---|
| 1 | `docs/media/exemplo-godot.png` | o projeto de exemplo no Godot: três personagens, um no meio da ação, e os eventos na tela |
| 2 | `docs/media/elenco.png` | robô, zumbi e monstro animados pelo núcleo |
| 3 | `docs/media/editor.png` | o editor do Mamulengo, de onde vêm os `.boneco` |

URL de cada uma: `https://raw.githubusercontent.com/zednaked/mamulengo/v0.2.0/<arquivo>`
(tipo "Image", com a mesma URL na miniatura).
