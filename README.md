# Stage

![A furnished flat in Stage, seen from above](docs/overview.png)

An open-source 3D scene engine that AI agents drive and people walk through.
An agent writes one JSON scene file (rooms, doors, windows, furniture,
light) and checks, queries, and renders it from the command line or over
MCP. A person opens the same file in a browser, watches it change as the
agent works, and walks through it at eye level.

The first job it does well: turn a floor plan into a furnished home you can
walk through, to brainstorm what a place could become. Whole houses work:
several levels with slabs and stairs, double-height rooms, terraces and
gardens, the architect's drawing under each plan, and a library of about
two hundred CC0 pieces with real sizes.

| From the front door | The bedroom |
| --- | --- |
| ![Living room at eye level](docs/living-room.png) | ![Bedroom at eye level](docs/bedroom.png) |

| A two-storey glass wall onto a shared garden | The same house from the roof |
| --- | --- |
| ![A double-height living room with sliding glass](docs/home-living.jpg) | ![A roof garden between two houses](docs/home-roof.jpg) |

| Every camera and every room on one sheet | The plan, with sizes |
| --- | --- |
| ![Contact sheet](docs/contact-sheet.jpg) | ![Plan with room sizes](docs/plan-labels.jpg) |

## Try it in a browser

The two-storey example is live at <https://dvrshil.github.io/stage/two-storey/>:
press **Walk inside**, then `W` `A` `S` `D` and the mouse. No install.

## Install

Stage needs Node 22.18 or later (24 or later is best), and Chromium or
Chrome for headless renders; the viewer runs in any browser.

```sh
git clone https://github.com/dvrshil/stage
cd stage && npm install           # also builds the viewer
node bin/stage.js assets fetch    # 40 MB of CC0 textures, models, and sky, into ~/.cache/stage
```

Without `assets fetch`, everything still works: textures fall back to
patterns drawn in code and furniture to pieces built from primitives.
`npm install -g .` puts a `stage` command on your path; the examples
below spell it out as `node bin/stage.js`.

## Use it with an agent

Stage is an MCP server. One line adds it to Claude Code:

```sh
claude mcp add --scope user stage -- node /path/to/stage/bin/stage.js mcp
```

Codex is `codex mcp add stage -- node /path/to/stage/bin/stage.js mcp`;
Cursor, Claude Desktop, Gemini CLI, VS Code, and any other MCP client take
the same command in their JSON config, and [docs/mcp.md](docs/mcp.md) has
each one. Opening this repository itself in Claude Code offers the server
from its `.mcp.json`.

The server carries its own guide, so an agent that has never seen Stage
knows the format and the order of work before its first call: rooms, then
openings, then furniture, looking at a render after each step. The tools
say what they are for, `query` and `check` answer in words that name the
entity and the fix, and `render` hands the image back into the
conversation. `node bin/stage.js skill install` also installs the guide as a
skill for Claude Code and Codex, for agents that read skills before tools.

Then ask: "Start a scene from the two-storey example, open it, and move the
sofa under the window." The agent sees every render it asks for; you see
every change in your browser as it lands.

## The scene file

Meters and degrees; plan coordinates `[x, y]` with x east and y north.
Rooms are floor polygons, and walls are built from their edges, shared
where two rooms meet. Openings sit on a room's edge. Items are library
assets placed by their center and turned by `facing` (0 faces north).

```json
{
  "stage": "0.1",
  "name": "One room",
  "levels": [{ "id": "ground", "height": 2.7 }],
  "rooms": [{ "id": "room", "floor": [[0, 0], [4, 0], [4, 3], [0, 3]], "materials": { "floor": "oak-plank" } }],
  "openings": [{ "id": "door", "wall": { "room": "room", "edge": 0 }, "at": 0.5, "type": "door", "width": 0.9, "height": 2.1 }],
  "items": [{ "id": "sofa", "asset": "sofa/three-seat", "room": "room", "at": [2, 2.4], "facing": 180 }]
}
```

Several floors: each level has an `elevation`, a `height`, and a floor
`slab`; rooms stack on their own, a tall room beside a short one gets the
right walls, and `well: true` leaves the hole a stair comes up through.
Stairs are items (`stairs/horseshoe`, `stairs/straight`) that a person
climbs when walking. `open: true` makes a terrace, a roof, or a garden,
with a parapet where nothing else stands. A level can carry a `plan`
image, the architect's drawing, shown under the plan view so the walls can
be checked against it; render `plan:<level>` to see one floor at a time.

`node bin/stage.js schema` prints the whole format as JSON Schema, and
`examples/` has three complete scenes, including a two-storey house.

## Commands

Every command except `open`, `serve`, and `mcp` needs no display, takes
`--json`, exits 0 or 1, and prints errors with the entity and a fix.

| Command | Does |
| --- | --- |
| `stage new <path> [--from flat]` | Start a scene, empty or from an example |
| `stage check <scene>` | Schema, references, and spatial rules |
| `stage render <scene> -o out.png [--camera id] [--level id] [--size 1280x720]` | A deterministic image, through the same page the viewer uses; `plan:<level>` for one floor, `room:<id>` for a camera standing in any room |
| `stage render <scene> --all-cameras -o sheet.png` | Every camera, and one per room, as a contact sheet |
| `stage query <scene> rooms` | Also `room <id>`, `items in <room>`, `walls <room>`, `openings`, `cameras`, `bounds`, `adjacent <room>`, `areas [level]`, `free <room>`, `fits <asset> in <room>` |
| `stage set <scene> items '<json>'` | Add an entity, or replace the one with its id |
| `stage remove <scene> <id>` | Remove an entity |
| `stage open <scene>` | The live viewer in your browser |
| `stage show <scene> --focus <id>` | Fly every open viewer to an entity |
| `stage export <scene> -o scene.glb` | The built scene as binary glTF, for Blender or any viewer |
| `stage share <scene> -o folder` | The viewer, scene, and only the assets it needs, for any static host |
| `stage assets [words]` | Search the furniture library |
| `stage assets fetch [ids \| scene.json] [--all]` | Download the CC0 assets: the basics, what a scene uses, or everything |

## The viewer

**Walk inside** (or `V`) to walk at eye level: `W` `A` `S` `D` and the mouse,
`Shift` to hurry. Walls and furniture stop you. `O` is the overview, `P` the
plan, `C` the next camera, `Q` switches between high quality and fast
rendering, and clicking anything shows its id and size. The page reloads
itself when the viewer is rebuilt, keeping your view.

## Assets and licenses

Textures, furniture models, and the sky come from [Poly Haven](https://polyhaven.com),
all CC0. `assets/lock.json` pins every built-in file by checksum with its
source and real-world size; the files themselves stay in the local cache,
with on-demand extras recorded in the cache's own lock. The library is
about sixty curated pieces (`src/core/assets.ts`) plus every household
model Poly Haven publishes, measured and listed by
`scripts/grow-library.ts`. A few models are exported at the wrong scale,
so the viewer fits each one to its recorded size. A scene can also carry
its own `materials`: a color, or any Poly Haven texture set by id.

## Contributing

Issues and pull requests are welcome; [CONTRIBUTING.md](CONTRIBUTING.md)
says where things live and how to run the tests. Scenes you build are
yours; a scene that shows off something Stage does well makes a good
example.

## Development

```sh
npm test               # core: check, geometry, query, walking, formatting, assets
npm run test:render    # headless renders: determinism, and goldens for every example
npm run typecheck
```

The code is TypeScript, run directly by Node for the command line and
bundled by Vite for the viewer, which draws with Three.js. See
`src/core` for everything that needs no renderer, `src/viewer` for the
page, and `src/cli` for the commands, the server, and MCP.

## License

MIT. Assets are CC0, from Poly Haven.
