---
name: stage
description: |
  Build and change 3D scenes with Stage: houses, flats, rooms, and furniture
  from a floor plan or a description, that a person walks through in their
  browser. Use for any request to visualize a home, a floor plan, an interior,
  a room layout, or furniture placement in 3D.
---

# Stage

A Stage scene is one JSON file. You write it with `set`, `remove`, or
`write_scene` (or `stage set` on the command line); `check` validates it;
`render` returns an image you look at; `query` answers questions so you
never need to reread the file. A person may have the scene open in their
browser: it updates the moment you write, and outlines what you changed.

## Start

- A new scene: `new_scene` (from an example when the person wants something
  to react to), then `open_viewer` right away so they watch it take shape.
  With no path given, use `~/stage-scenes/<name>/scene.json`.
- An existing scene: `check` it, then `query "rooms"` for the lay of the
  land. `read_scene` only when you must; `query` is cheaper.
- Before the first `render` of a scene with library pieces, `fetch_assets`
  with the scene once, so the picture shows the real models and surfaces.
- The tools: `new_scene`, `open_viewer`, `show` (fly the person's view),
  `check`, `render` (an image you look at), `query`, `set`, `remove`,
  `write_scene`, `read_scene`, `assets`, `fetch_assets`, `materials`,
  `schema`, `export` (glTF). Resources `stage://guide`, `stage://schema`,
  and `stage://examples/<name>` hold this guide, the format, and the
  example scenes.

## The format

- Meters and degrees. Plan coordinates `[x, y]`: x east, y north.
- `rooms`: `floor` is a polygon of corners. Edge n runs from `floor[n]` to
  `floor[n+1]` (the last edge closes back to the first corner). Rooms that
  share an edge share one wall; walls are built for you.
- `openings`: on `{ "room": id, "edge": n }`, starting `at` meters along that
  edge from `floor[n]`. `type` is door, window, opening (a stretch of
  missing wall), or slider (a sliding glass door from the floor up, its
  middle panels standing open). Windows take a `sill` height (default 0.9).
- `items`: an `asset` from the library (`assets` tool), placed by its center
  `at` [x, y] in a `room`, rotated by `facing` (0 = its front faces north,
  90 = east, 180 = south). An unknown asset with a `size` [w, d, h] renders
  as a labeled box, so you can lay out first and resolve later.
- `cameras`: `plan` and `orbit` always exist. Add perspective cameras with
  `at` [x, y, z] and `look` [x, y, z]; z is absolute: a level's elevation
  plus 1.6 is eye height there.
- Ids are lowercase with hyphens and unique across the file.

## Several floors

- `levels`: each has `elevation` (its floor), `height` (floor to ceiling),
  and `slab` (its floor slab, below the elevation). Put the next level at
  elevation + height + slab. A room's `level` places it; a room on the
  lowest level with closed rooms stands on the ground, plinth and all.
- Rooms on different levels may share edges: walls stack on their own. A
  tall room (`height` of two floors) beside a normal one gets the right wall
  above its neighbor's ceiling.
- `well: true` on a room draws no floor: the hole a stair comes up through,
  on every level above the one it starts on. `ceiling: false` leaves the
  room below it open. The stair itself is an item: `stairs/horseshoe` (up
  the west side, across the north, down the east, around a well; its open
  side faces south at facing 0) or `stairs/straight`. Give it a `size`
  [width, depth, rise]; the rise is the floor-to-floor height.
- Walls are 23 cm outside and 11.5 cm between rooms. A room's `thickness`
  makes all of its walls at least that thick (a lift shaft, a hall that
  shares a house's outside wall).
- `materials` (optional): the scene's own surfaces, used by name like the
  built-in ones: `{ "id": "lime-plaster", "color": "#e9e2d3", "roughness": 0.9 }`,
  or with `"texture": "<Poly Haven texture id>"` and `"size"` meters per
  repeat for a photographed set (fetch it with `fetch_assets` first; until
  then it renders as the color).
- `open: true` is outdoors: a terrace, a roof, a garden, a drive. No ceiling;
  a `parapet` (default 1 m, 0 for none) on edges that touch nothing; no wall
  at all where two open rooms meet. Outdoor floors: grass, pavers,
  paving-stone, gravel, asphalt, deck, concrete.
- A level may carry a `roof`: `{ "kind": "gable", "pitch": 30, "overhang": 0.4 }`
  puts a pitched roof over its rooms, ridge along their longer side; the
  top is flat without it.
- A level may carry a `plan`: `{ "image": "plans/first.jpg", "scale":
  <pixels per meter>, "origin": [px, py] }`, the drawing under the plan
  view, with `origin` the pixel at plan [0, 0]. Render camera `plan:<level>`
  to see that level's walls over its drawing; `render` and `show` also take
  a `level`, which hides everything above it.
- Items built to measure (stairs, railings, counters, wardrobes, rugs,
  walls, columns, screens) take their own `size`; the rest have fixed sizes
  and `scale`.

## How to work

1. Rooms first. Get their sizes and how they connect right, then `check` and
   `render` with camera `plan`. Look at the image before going on.
2. Doors, openings, windows. `check` names any opening that does not fit its
   wall and says what to change.
3. Furniture. `query "room <id>"` gives each edge's direction, its neighbor,
   and its openings; `query "fits <asset> in <room>"` names positions where
   a piece stands clear of doors and other pieces, back to a wall; `query
   "free <room>"` gives the clear floor and the longest free run along each
   wall. Put a piece's back against a wall by facing it away from that
   wall. `check` reports pieces that run into each other, wardrobes and
   cabinets without room to open, and things standing on windows.
4. Render `orbit` and a camera at eye level, or `sheet: true` for every
   camera and one standing in each room at once. Fix what looks wrong. Call
   `fetch_assets` with the scene once, so renders show the real models and
   photographed surfaces instead of stand-ins.
5. When a person is watching, use `show` to fly their view to what you are
   describing, and keep each change small so they can follow along.

Keep edits small and use `query` instead of reading the whole file.
