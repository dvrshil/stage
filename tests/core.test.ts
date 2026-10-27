import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { measureGltf } from '../src/cli/assets.ts'
import { searchAssets } from '../src/core/assets.ts'
import { check } from '../src/core/check.ts'
import { walls, wallPieces } from '../src/core/geometry.ts'
import { query } from '../src/core/query.ts'
import { format, readScene, writeScene } from '../src/core/store.ts'

const example = async () => (await readScene(new URL('../examples/flat/scene.json', import.meta.url).pathname)) as any
const clone = <T>(value: T): T => structuredClone(value)
const messages = (raw: unknown) => check(raw).problems.map((p) => `${p.severity} ${p.entity ?? ''}: ${p.message}`)

test('the example flat checks clean', async () => {
  const result = check(await example())
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('ids must be unique across collections', async () => {
  const raw = await example()
  raw.cameras.push({ id: 'kitchen', type: 'plan' })
  assert.match(messages(raw).join('\n'), /error kitchen: "kitchen" is already used by rooms\.1/)
})

test('an opening too wide for its wall says how to fix it', async () => {
  const raw = await example()
  raw.openings.push({ id: 'wide', wall: { room: 'living', edge: 0 }, at: 4, type: 'door', width: 2, height: 2.1 })
  assert.match(messages(raw).join('\n'), /lower "at" to 3\.50 or less, or "width" to 1\.50 or less/)
})

test('an item outside its room is an error', async () => {
  const raw = await example()
  raw.items.push({ id: 'lost', asset: 'bed/double', room: 'living', at: [8, 8] })
  assert.match(messages(raw).join('\n'), /error lost: "lost" at \[8, 8\] is outside "living"/)
})

test('an unknown asset is an error without a size and a labeled box with one', async () => {
  const raw = await example()
  raw.items.push({ id: 'mystery', asset: 'thing/unknown', room: 'living', at: [1, 1] })
  assert.match(messages(raw).join('\n'), /error mystery: asset "thing\/unknown" is not in the library/)
  raw.items.at(-1).size = [1, 1, 1]
  const result = check(raw)
  assert.equal(result.ok, true)
  assert.match(result.problems.map((p) => p.message).join('\n'), /renders as a labeled box/)
})

test('a room with no way in is a warning', async () => {
  const raw = await example()
  raw.rooms.push({ id: 'closet', floor: [[0, 4], [2, 4], [2, 6], [0, 6]] })
  assert.match(messages(raw).join('\n'), /warning closet: "closet" has no door or opening/)
})

test('rooms sharing an edge share one interior wall', async () => {
  const scene = check(await example()).scene!
  const all = walls(scene)
  const shared = all.filter((w) => w.rooms.length === 2)
  assert.equal(all.length, 7)
  assert.equal(shared.length, 1)
  assert.equal(shared[0].exterior, false)
  assert.ok(shared[0].thickness < all.find((w) => w.exterior)!.thickness)
})

test('a door leaves a lintel and a window leaves a sill', async () => {
  const scene = check(await example()).scene!
  const doorWall = walls(scene).find((w) => w.openings.some((o) => o.opening.id === 'front-door'))!
  assert.equal(wallPieces(doorWall).length, 3)
  const windowWall = walls(scene).find((w) => w.openings.some((o) => o.opening.id === 'living-window'))!
  const pieces = wallPieces(windowWall)
  assert.equal(pieces.length, 4)
  assert.ok(pieces.some((p) => p.bottom === 0 && p.top === 0.9))
})

test('query answers sizes, neighbors, and bounds', async () => {
  const scene = check(await example()).scene!
  const rooms = query(scene, ['rooms']) as { id: string; area: number }[]
  assert.deepEqual(rooms.map((r) => [r.id, r.area]), [['living', 22], ['kitchen', 14]])
  const kitchen = query(scene, ['room', 'kitchen']) as { edges: { sharedWith: string | null }[] }
  assert.equal(kitchen.edges.filter((e) => e.sharedWith === 'living').length, 1)
  assert.deepEqual(query(scene, ['bounds']), { min: [0, 0], max: [9, 4], width: 9, depth: 4 })
  assert.throws(() => query(scene, ['room', 'attic']), /no room is called "attic"/)
})

test('formatting is canonical and stable', async () => {
  const raw = await example()
  const once = format(raw)
  assert.equal(format(JSON.parse(once)), once)
  assert.ok(once.indexOf('"stage"') < once.indexOf('"rooms"'))
})

test('writes are atomic and leave nothing behind', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stage-test-'))
  const path = join(dir, 'scene.json')
  await writeScene(path, await example())
  assert.deepEqual(await readdir(dir), ['scene.json'])
  assert.equal(JSON.parse(await readFile(path, 'utf8')).name, 'Two-room flat')
})

test('asset search needs every word to match', () => {
  assert.deepEqual(searchAssets('dining chair').map((a) => a.id), ['chair/dining'])
  assert.ok(searchAssets('sofa').length >= 2)
  assert.deepEqual(searchAssets('chair', { maxSize: [0.5, 0.6, 1] }).map((a) => a.id), ['chair/dining'])
})

test('model sizes come from glTF bounds through node transforms', () => {
  // A unit cube scaled by 2 and turned a quarter around y: 2 m on every side.
  const gltf = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ children: [1], scale: [2, 2, 2] }, { mesh: 0, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [-0.5, 0, -0.25], max: [0.5, 1, 0.25] }],
  }
  // Width 1 by depth 0.5, turned 90 degrees, then doubled: 1 wide, 2 deep, 2 high.
  assert.deepEqual(measureGltf(gltf), [1, 2, 2])
})
