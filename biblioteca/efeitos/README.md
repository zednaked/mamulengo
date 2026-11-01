# Effects library

Ready-made particle effects for `.boneco` characters: the editor's "+ efeito…" menu (layer
inspector) puts one on a layer. Each effect is a set of texture variants (each particle picks one
when it is born, so the smoke does not look stamped) and an emitter preset, in `efeitos.json`:

| effect | what it is | how it plays |
|---|---|---|
| `fumaca` | dark smoke rising, growing and fading | continuous |
| `vapor` | light white smoke rising | continuous |
| `puff` | a white cloud popping at once | bursts |
| `poeira` | dust spraying sideways along the ground | bursts |
| `explosao` | a fireball spreading and burning out | bursts |
| `flash` | a short yellow flash (additive) | bursts of a few |
| `pum` | a green cloud drifting off | bursts |

`olho_maluco` is not an emitter: the editor's "+ olho maluco…" (or the `eye.googly` command) glues
googly eyes on a layer, from `googly_branco`, `googly_pupila` and `googly_brilho` (Kenney's Googly
Eyes layers, CC0, see `License-Kenney-googly.txt`). The pupil hangs at the end of a bone with
rotation physics that has gravity and almost no spring, so it falls, rolls along the rim and
shakes when the piece moves.

The textures are six variants of each kind from Kenney's Smoke Particles pack (CC0, see
`License-Kenney.txt`), scaled down to 128 px. When an effect is added, the server
(`server/efeitos.ts`) copies its images into a page `<name>-efeitos.png` next to the character
(rebuilt each time with every effect image the character already uses) and the editor creates the
emitter with `particles.set` (`variants` plus the preset), so it can be undone.
