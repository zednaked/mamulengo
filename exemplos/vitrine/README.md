# Showcase: what Mamulengo does beyond Spine

![the showcase animation](vitrine.gif)

`vitrine.boneco` is the CC0 robot from `tests/boneco/robo` with the two features Spine does not
have, in one looping animation (`vitrine`, 8.6 s):

| time | body | features |
|---|---|---|
| 0.0 to 2.0 s | idle | **2.5D**: the head looks left and right (the mesh turned like a cylinder by `deform.turn`), and every part keeps a subtle turn for depth through the whole loop; **tint**: the body flashes red |
| 2.3 to 3.6 s | celebration | **jets** under the feet (a fake-light halo, a white core, flame tongues swapped every frame, masked to come out only below the soles, with a flash and smoke on ignition), **glow** around the body, sparks from the hands, star bursts from the head and a ring of stars in **orbit** that passes behind and in front of the body; the arms and hands **smear** as they swing and the hands leave a **trail**; the jets' fire **lights** the legs from below |
| 3.9 to 5.9 s | idle | **dissolve**: both arms break apart with an orange edge and come back |
| 6.2 to 7.5 s | celebration | everything together, with the body tinted gold, an **outline** on the head and a **lightning** arc between the hands that flashes the face blue |
| 7.8 to 8.6 s | idle | everything fades out and the loop starts again |

The whole loop is **lit**: a normal map built from the art by `tools/relevo.ts` (`robo-hd_relevo.png`), a warm key light from the top right, a blue rim light from the left and the jet and lightning lights. Effects are per slot (outline, glow, dissolve, tint, smear, trail); particles are emitters attached to bones
(sprites with color ramps, additive blend and sway for fire, or procedural lightning between two
bones). All of them are keyed on the timeline like any other property. The format and the math are in
[docs/NUCLEO.md](../../docs/NUCLEO.md) ("Efeitos" and "Partículas"). Exporting to Spine drops
them with a warning.

The file is generated: `npx tsx exemplos/vitrine/gerar.ts`. The robot page (`robo-hd.webp`) is
the same CC0 art at 3x, rasterized from the pack's vector file (`Robot/Vector/character_robot.svg`)
by `npx tsx tools/atlas-hd.ts robo.boneco character_robot.svg --id "{nome}_0_Layer0_*_FILL"`, so it
stays sharp when zoomed in; the generator also fixes the rig against Kenney's reference pose (feet pointing
out, a gap between the legs, hands centered on the arms). The star image (`estrela.png`) is drawn
by the generator. To see it live, open the editor with this folder in `MAMULENGO_ROOTS`
(it opens in the core's own renderer), or load it in Godot with the `BonecoSprite` node from
`addons/boneco`.

The GIF above comes straight from the editor's export, with a fixed crop of the world and a frame
(title, captions per stretch, footer), through the bridge:

```sh
npx tsx tools/ponte.ts chamar export '{"format":"gif","animation":"vitrine","fps":20,"rect":[-200,-105,400,370],"maxWidth":640,"dir":"<this folder>","name":"vitrine","moldura":{"titulo":"Mamulengo","legendas":[{"de":0,"ate":2.25,"texto":"..."}],"rodape":"...","credito":"..."}}'
```

The same frame fields are in the export panel of the timeline.
