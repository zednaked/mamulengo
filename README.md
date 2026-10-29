# Mamulengo

![A robot, a zombie and a monster, rigged and animated by Claude Code in Mamulengo](docs/media/elenco.webp)

**A 2D skeletal animation toolkit for games, run by people and Claude Code
together.** Rig a character from a layered PSD, animate it on a timeline, or ask
Claude to do it over MCP and watch every bone it moves, live, in the same editor.
Characters are saved as `.boneco`, one readable file that carries its atlas,
transitions and a written brief. A C++ core, written from scratch, plays them in
Godot (engine module or GDExtension) and in the browser (220 KB of WebAssembly).
It opens and writes Spine 4.3 projects, so nothing already made gets left behind.

[Leia em português](README.pt-BR.md) · Godot 4.5+ · Linux and Windows

```
466 of 466 playback scripts match the reference runtime every frame, events too
20 characters posed in 0.043 ms a frame (native), about 5x faster than the runtime it replaces
102 of 102 production Spine 4.3 projects round-trip through .boneco unchanged
a slot game on staging runs on the core: 1 wasm instead of 3
GPU objects created per frame in that game: 160 before, 0.3 now
```

**On this page:** [what it does](#what-it-does) ·
[Claude Code](#working-with-claude-code) ·
[the agent bench](#the-agent-bench) · [the .boneco format](#the-boneco-format) ·
[the core](#the-core) · [in a Godot game](#in-a-godot-game) · [run it](#run-it) ·
[status](#status)

![Claude Code rigging and animating a robot from loose parts, on its own, over MCP](docs/media/robo-processo.webp)

*Claude Code rigging and animating a robot from loose parts, on its own, over
MCP, at 3x speed. Art: Toon Characters by Kenney (CC0).*

A mamulengo is the hand puppet of northeastern Brazil, carved in wood and worked
from below the stage. This one is worked from both sides: an animator with a
mouse and an agent with tools share the same document, the same undo history and
the same rules for what a good animation is.

## What it does

- **From PSD to rig.** Drop a layered `.psd` and it builds the character in the
  PSD's composition, or updates the open one layer by layer, keeping animations,
  meshes and weights. It understands the usual layer tags (`[bone]`, `[slot]`,
  `[skin]`, `[mesh]`...).
- **Animate.** Bones, timeline with draggable keys, curve editor, onion skin,
  events, transitions between animations previewed exactly as the game plays
  them, meshes with painted weights, deform brush, IK, physics, clipping, paths,
  skins. Ready-made motions (breathe, sway, bounce, pop in, shake, blink,
  flipbook) and ready-made physics (hair, ears, cloth, spring, hanging).
- **Every action is a command.** The UI and Claude call the same typed command
  registry, so undo, history and "watch Claude work" come for free.
- **Versions and notes.** Every save is a version you can name, diff and
  restore; anyone can pin notes to an animation, an instant and a part.
- **A brief per character.** `<name>.ficha.md` says what the rig allows and
  what each animation should do, with rules the tool checks: amplitude and
  silhouette against the house median, joint limits after IK, meshes that fold
  too far, hidden edges that show, transitions that jump.
- **Export** a GIF or WebM of any animation or transition, as seen on screen.

![Two characters going from their win animation back into idle, the transition the game plays](docs/media/emendas.webp)

*Win into idle, previewed the way the game blends it.*

Full guide (in Portuguese): [docs/EDITOR.md](docs/EDITOR.md).

## Working with Claude Code

Open Claude Code in this folder and the `mamulengo` MCP server is there
(`.mcp.json`); it starts the editor if it is not running.

| tool | what for |
|---|---|
| `mamulengo_open`, `mamulengo_assets` | find and open a character |
| `mamulengo_run` | run commands in a batch, one undo step, all or nothing |
| `mamulengo_look` | a rendered frame or contact sheet, alone or across a transition |
| `mamulengo_guia` | the workflow: brief, rig, animate, check |
| `mamulengo_notas`, `mamulengo_versoes` | team notes and versions |
| `mamulengo_export` | GIF or WebM, returns the file path |
| `mamulengo_psd` | new character from a PSD, or update the open one |

While an agent works, any other tab on the editor follows it: the character, the
animation and the bones it touches light up as it goes, and what it writes between
commands shows up as captions.

![The Mamulengo editor while Claude Code works: tools on top, the robot on stage, versions on the left, the agent's activity on the right and the timeline below](docs/media/editor.webp)

*The editor while Claude works: every save becomes a version (left), every command and
note the agent sends shows up in the activity feed (right).*

What `mamulengo_look` hands back is what the agent judges by, a contact sheet of the
key poses:

![Contact sheet of the robot's win animation, seven key poses](docs/media/poses.webp)

## The agent bench

A headless Claude Code takes a written request and does the rig, the brief and
the animations through MCP only, in an isolated folder. A director agent grades
the result against a rubric and sends it back with notes. The screen can be
recorded, which is where these timelapses come from.

| robot: `ganhou` (win) | zombie: `anda` (walk) | monster: `ganhou` (win) |
|---|---|---|
| ![robot win](docs/media/robo-ganhou.webp) | ![zombie walk](docs/media/zumbi-anda.webp) | ![monster win](docs/media/monstro2-ganhou.webp) |

<details>
<summary>The other two timelapses: the zombie and the monster</summary>

![The zombie being rigged and animated](docs/media/zumbi-processo.webp)

![The monster being rigged and animated from a PSD](docs/media/monstro2-processo.webp)

</details>

Art: [Toon Characters](https://kenney.nl/assets/toon-characters-1) and
[Monster Builder Pack](https://kenney.nl/assets/monster-builder-pack), by Kenney
(CC0). Rigs, briefs and animations made by the agent. Guide:
[docs/BANCADA.md](docs/BANCADA.md).

## The .boneco format

One JSON file per character: skeleton, atlas regions, animations, the transition
times the game uses, page compression for the game and the brief. Field names
are in Portuguese and every one of them maps both ways to Spine 4.3, so a
`.boneco` exports back to the exact JSON and atlas it came from (102 of 102
production projects, at a median 1.05x the size). Where the two runtimes the
games used disagreed (multiply ignoring alpha, physics gravity flipping sign),
the format says which one it means. Spec: [docs/FORMATO.md](docs/FORMATO.md).

```sh
npx tsx tools/boneco.ts importar <x-data.tres|x.json> <x.boneco>
npx tsx tools/boneco.ts exportar <x.boneco> <folder>
```

## The core

`nucleo/` is C++17 with no dependencies, written clean-room: from a written spec
and from numbers measured on a reference runtime used as a black box, never from
its source. It does poses (bones, curves, slots, regions, weighted meshes,
deform, IK, transform, path and physics constraints), animation state (tracks,
queues, mixing, events) and draw lists (batches by page and blend, clipping on
the GPU stencil or on the CPU).

| measured against the reference runtime | result |
|---|---|
| poses, 78 animations of 20 characters, every frame at 30 fps | worst bone 0.00005 px |
| animation state, 466 scripts (play, queue, cut, empty, mix 0 and 0.2) | every frame within 0.0005 px, same events at the same frame |
| drawing in the browser, 20 characters side by side | edges only, 0 to 1.1% of pixels |
| speed, 20 characters | 0.043 ms a frame, native |

The spec, and what had to be discovered to match (float32 pi, bezier sampled at
9 points, a physics step of zero on the first frame): [docs/NUCLEO.md](docs/NUCLEO.md).
`palco.html` plays any `.boneco` through the core next to the reference, with a
pixel diff.

## In a Godot game

`nucleo/godot` builds the same code two ways:

- an **engine module**, baked into a web export template: one wasm, no
  GDExtension loading in the browser;
- a **GDExtension** (Linux and Windows) for the editor, F5 and headless CI with
  the stock Godot.

`BonecoSprite` keeps one mesh per batch and only rewrites vertices each frame.
In a slot game with 17 animated characters, on staging, the engine module replaced
the official plugin: one wasm instead of three, a 51 MB export instead of 64 MB,
the first frame in 3.4 s instead of 6.7 s. Those times were measured with an
earlier build of the module; the core's module ships the same 38.6 MB wasm and the
same compressed download, and natively it is now cheaper per frame (0.54 ms for
the 17 characters, against 0.63 ms). In the browser, with both at 120 fps, it uses
about 3 points more of the main thread than that earlier build (it was 6 to 8
before a profiling pass on drawing and clipping), and on a CPU slowed 4x the
frames over 25 ms are the same. Keeping the meshes took the GPU objects created
per frame from 160 to 0.3, and pieces that do not move send nothing. Out of 153 frames compared pixel by
pixel against the previous renderer, 142 are identical; the other 11 come from
flipbooks one step apart (4 above 1% of pixels, 7 below 0.5%), and where checked,
the core is the one that matches the reference.

```sh
scons -C nucleo/godot platform=linux target=template_debug disable_exceptions=no          # GDExtension
scons platform=web target=template_release threads=no custom_modules=<repo>/nucleo/godot  # web template, from Godot's source
```

## Run it

The editor still draws through `spine-core` and `spine-webgl` (installed from npm) as its
reference renderer, until the core takes over; using them requires a
[Spine license](https://esotericsoftware.com/spine-purchase). The core in `nucleo/` and the
`.boneco` format do not depend on them.

```sh
npm install
echo "MAMULENGO_ROOTS=/path/to/your/projects" > .env.local
npm run dev                                   # http://localhost:5199
npm test                                      # every command, no external assets
cmake -S nucleo -B nucleo/build -G Ninja && cmake --build nucleo/build
npx tsx tools/nucleo-compara.ts tests/boneco  # the core against the reference
```

`tests/assets` and `tests/boneco` hold three CC0 characters by Kenney (cartoon,
mascot, human), rigged with Mamulengo commands only. Parity tests and the engine
differences the editor reproduces: [docs/PARIDADE.md](docs/PARIDADE.md).

## Status

Working: the editor, the MCP server, the agent bench, `.boneco`, the core with
its Godot module and GDExtension. A slot game runs on staging with the engine
module, and its `.boneco` build, all on the core, passes its tests. Next: the
editor drawing through the core in place of the reference renderer, a binary
`.boneco` for smaller packs, and macOS builds of the GDExtension. Plan:
[docs/ROADMAP.md](docs/ROADMAP.md).

## License

MIT, see [LICENSE](LICENSE). The CC0 art in `tests/` and the Spine libraries the
editor installs from npm keep their own licenses (listed in [NOTICE](NOTICE)).
