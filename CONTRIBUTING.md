# Contributing

Thanks for looking. Stage is small on purpose: one scene format, one
viewer, one command line, and an MCP server over the same operations.

## Where things live

- `src/core`: everything that needs no renderer. The schema (`schema.ts`),
  free objects and their placement (`objects.ts`), walls and geometry
  (`geometry.ts`), the rules (`check.ts`), the questions (`query.ts`),
  walking (`walk.ts`), framing cameras (`cameras.ts`), the library
  (`assets.ts`, `generated-assets.ts`), materials, and the file store.
- `src/viewer`: the browser page, drawn with Three.js and bundled by Vite.
  `build.ts` turns a scene into meshes; `main.ts` is the page.
- `src/cli`: the commands (`index.ts`), the live server, headless renders,
  asset fetching, the open model libraries (`models.ts`, one adapter per
  source), share bundles, and the MCP server (`mcp.ts`).
- `src/skill.md`: the agent guide. The MCP server sends it as its
  instructions, and `stage skill install` installs it as a skill. Change it
  when the format or the order of work changes.
- `examples/`: complete scenes. `tests/golden/`: their renders.

## Running

```sh
npm install            # also builds the viewer
npm test               # core, in about a second
npm run typecheck
npm run test:render    # headless Chromium; needs Chromium or Chrome
```

A render test compares every example against `tests/golden`. After a
deliberate change to how things look, `UPDATE_GOLDENS=1 npm run test:render`
rewrites them; commit the new images with the change.

## Changes we like

- A new check rule: add it to `check.ts` with a test, and make sure its
  message names the entity and the fix.
- A new question for `query`: the same, plus a line in `QUESTIONS`.
- Library pieces: curated entries go in `src/core/assets.ts` with a real
  size; `scripts/grow-library.ts` regenerates the rest from Poly Haven.
  Only CC0 sources.
- Format changes: update `schema.ts`, `KEY_ORDER`, the guide, and the
  README together, and keep old files loading.

Keep commits small and their messages about what changed and why. Formatting
is Prettier's defaults with a wide line; there is no lint step to fight.
