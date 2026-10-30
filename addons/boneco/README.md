# Boneco: 2D skeletal animation for Godot

Plays `.boneco` characters, the format of the Mamulengo animation toolkit, through
its C++ core: bones, meshes, constraints, physics, mixing between animations, a
queue per track and events. GDExtension for Godot 4.5+ on Linux x86_64, Windows
x86_64 and macOS (universal).

## Install

- From the Asset Library: search for "Boneco" in the AssetLib tab and install it.
- By hand: download `mamulengo-boneco-<version>.zip` from the releases page and
  copy its `addons/boneco` folder into your project, so you end up with
  `res://addons/boneco/boneco.gdextension`.

Restart the editor once after installing. There is no plugin to enable.

## Load a character

A `.boneco` sits next to its texture pages (`name.webp`, `name_2.webp`...). Load it
in code:

```gdscript
var data := BonecoData.carregar("res://characters/hero/hero.boneco")
if data.get_error() != "":
    push_error(data.get_error())
```

or, since the addon registers a loader, with `load("res://.../hero.boneco")` and by
dragging the file onto the `data` property of a `BonecoSprite` in the inspector.

## Play it

`BonecoSprite` is a `Node2D` that steps and draws the character every frame.

```gdscript
var sprite := BonecoSprite.new()
sprite.data = data
add_child(sprite)

sprite.set_default_mix(0.2)              # seconds of blending between animations
sprite.set_mix("run", "idle", 0.4)       # a specific pair
sprite.set_animation("run", true, 0)     # name, loop, track: cuts to it now (with mix)
sprite.add_animation("jump", 0.0, false) # queued after the current one on track 0
sprite.add_animation("idle", 0.0, true)
```

Other calls: `get_current(track)`, `get_animation_names()`, `set_to_setup_pose()`,
`time_scale`, `playing`, `get_bone_world(bone)`, `set_slot_color(slot, color)`,
`set_slot_attachment(slot, part)`, `get_skeleton_bounds()`. With `manual = true`
the node stops stepping itself and you call `update_skeleton(delta)`.

## Signals

Every signal carries a `BonecoEntrada` (`get_animation_name()`,
`get_track_index()`, `get_loop()`).

```gdscript
sprite.animation_event.connect(func(entry, name, int_value, float_value, text):
    print(entry.get_animation_name(), ": ", name, " ", text))
sprite.animation_completed.connect(func(entry): print("loop or end of ", entry.get_animation_name()))
```

- `animation_started`, `animation_interrupted`, `animation_completed`,
  `animation_ended`
- `animation_event(entry, name, int, float, string)`: the events keyed in the
  animation
- `before_world_transforms_change(sprite)`: each frame after the animation is
  applied and before physics and world transforms, to move bones or slots from
  the game

## Lights

A `.boneco` can carry point lights tied to bones and an ambient light (keyed on the
timeline), and a normal map per atlas page that the Mamulengo tools build from the
art itself (`npx tsx tools/relevo.ts hero.boneco --gravar`). `BonecoSprite` lights
the parts with them in its own shader, the same math as the editor: no Light2D nodes
needed, and the normal map follows parts that turn, flip or bend.

## Binary .boneco

A `.boneco` can also be stored in binary: the same data, about 5 times smaller on disk and
faster to load, with exactly the same numbers (the pose comes out byte for byte the same).
`BonecoData` reads both, by the first bytes, so the path does not change. Convert with the
Mamulengo tools: `npx tsx tools/boneco.ts binario hero.boneco hero.boneco`.

## Web export on phones

The Godot web export sizes its canvas by the screen's pixel ratio, so on a phone a
game made at 700 px is drawn 1080 px wide or more. On a mid-range Android phone a
700 x 1370 game once dropped 130 to 180 frames in 30 s that way, the same with
`BonecoSprite` or the official Spine plugin (the GPU was the bottleneck, not the
animation), and about 10 when drawn at its base size; after a browser update the
difference shrank to a few frames. It never costs anything visible. Cap the canvas at the base size in the web preset's Head Include
(Export > Web > HTML), with your project's base size:

```html
<script>
// draw the canvas at most at the game's base size: on a dense screen the rest is only GPU cost
(() => {
  const WIDTH = 700, HEIGHT = 1370; // window/size/viewport_width and viewport_height
  const native = window.devicePixelRatio || 1;
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    get: () => Math.min(native, Math.max(1, WIDTH / innerWidth, HEIGHT / innerHeight)),
  });
})();
</script>
```

Measurements and a tool to measure on a phone over `adb`: `docs/CELULAR.md` in the
Mamulengo repository.

## Make characters

`.boneco` files come from the Mamulengo editor, which also imports Spine 4.3
projects. Source, format spec and an example project: the Mamulengo repository.

## License

MIT (see `LICENSE`).
