# Showcase: what Mamulengo does beyond Spine

![the showcase animation](vitrine.gif)

`vitrine.boneco` is the CC0 robot from `tests/boneco/robo` with the two features Spine does not
have, in one looping animation (`vitrine`, 8.6 s):

| time | body | features |
|---|---|---|
| 0.0 to 2.0 s | idle | **tint**: the body flashes red (damage); **outline**: a gold line grows around the head |
| 2.3 to 3.6 s | celebration | **glow** around the body, **particles**: sparks from both hands and two bursts of stars from the head |
| 3.9 to 5.9 s | idle | **dissolve**: both arms break apart with an orange edge and come back |
| 6.2 to 7.5 s | celebration | everything together, with the body tinted gold |
| 7.8 to 8.6 s | idle | everything fades out and the loop starts again |

Effects are per slot (outline, glow, dissolve, tint) and particles are emitters attached to
bones; both are keyed on the timeline like any other property. The format and the math are in
[docs/NUCLEO.md](../../docs/NUCLEO.md) ("Efeitos" and "Partículas"). Exporting to Spine drops
them with a warning.

The file is generated: `npx tsx exemplos/vitrine/gerar.ts`. The star image (`estrela.png`) is
drawn by the generator. To see it live, open the editor with this folder in `MAMULENGO_ROOTS`
(it opens in the core's own renderer), or load it in Godot with the `BonecoSprite` node from
`addons/boneco`.
