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

## The format

- Meters and degrees. Plan coordinates `[x, y]`: x east, y north.
- `rooms`: `floor` is a polygon of corners. Edge n runs from `floor[n]` to
  `floor[n+1]` (the last edge closes back to the first corner). Rooms that
  share an edge share one wall; walls are built for you.
- `openings`: on `{ "room": id, "edge": n }`, starting `at` meters along that
  edge from `floor[n]`. `type` is door, window, or opening. Windows take a
  `sill` height (default 0.9).
- `items`: an `asset` from the library (`assets` tool), placed by its center
  `at` [x, y] in a `room`, rotated by `facing` (0 = its front faces north,
  90 = east, 180 = south). An unknown asset with a `size` [w, d, h] renders
  as a labeled box, so you can lay out first and resolve later.
- `cameras`: `plan` and `orbit` always exist. Add perspective cameras with
  `at` [x, y, z] and `look` [x, y, z]; z 1.6 is eye height.
- Ids are lowercase with hyphens and unique across the file.

## How to work

1. Rooms first. Get their sizes and how they connect right, then `check` and
   `render` with camera `plan`. Look at the image before going on.
2. Doors, openings, windows. `check` names any opening that does not fit its
   wall and says what to change.
3. Furniture. `query "room <id>"` gives each edge's direction, its neighbor,
   and its openings, so you can keep doors clear. Put a piece's back against
   a wall by facing it away from that wall.
4. Render `orbit` and a camera at eye level. Fix what looks wrong.
5. When a person is watching, use `show` to fly their view to what you are
   describing, and keep each change small so they can follow along.

Keep edits small and use `query` instead of reading the whole file.
