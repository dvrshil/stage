import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { measureGltf } from '../src/cli/assets.ts'
import { searchAssets } from '../src/core/assets.ts'
import { check } from '../src/core/check.ts'
import { distanceToSegment, walls, wallPieces } from '../src/core/geometry.ts'
import { query } from '../src/core/query.ts'
import { materialSpec } from '../src/core/materials.ts'
import { format, readScene, writeScene } from '../src/core/store.ts'
import { BODY_RADIUS, ground, obstacles, resolve } from '../src/core/walk.ts'

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
  assert.equal(searchAssets('dining chair').map((a) => a.id)[0], 'chair/dining', 'the curated chair comes first')
  assert.ok(searchAssets('sofa').length >= 2)
  const small = searchAssets('chair', { maxSize: [0.5, 0.6, 1] })
  assert.ok(small.some((a) => a.id === 'chair/dining'))
  assert.ok(small.every((a) => a.size[0] <= 0.5 && a.size[1] <= 0.6 && a.size[2] <= 1))
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

// Walking: a person of radius 0.2 m, stepping 2 cm at a time.

const walk = (start: [number, number], direction: [number, number], steps: number, blocking: ReturnType<typeof obstacles>) => {
  const path: [number, number][] = [start]
  let p = start
  for (let i = 0; i < steps; i++) {
    p = resolve([p[0] + direction[0] * 0.02, p[1] + direction[1] * 0.02], blocking)
    path.push(p)
  }
  return path
}

test('walking into a wall at an angle glides along it, never into it', async () => {
  const scene = check(await example()).scene!
  const blocking = obstacles({ ...scene, items: [] })
  // From mid living room, heading north-east into the north wall.
  const path = walk([2.5, 3.0], [Math.SQRT1_2, Math.SQRT1_2], 120, blocking)
  const north = blocking.walls.find((w) => w.a[1] === 4 && w.b[1] === 4)!
  for (const [, y] of path) assert.ok(4 - y >= north.half + BODY_RADIUS - 1e-6, `stays clear of the wall at y ${y}`)
  // Still moving east once against the wall: sliding, not stuck.
  const tail = path.slice(-20)
  assert.ok(tail.at(-1)![0] - tail[0][0] > 0.2)
})

test('a position inside a wall is pushed out, and a corner holds still', async () => {
  const scene = check(await example()).scene!
  const blocking = obstacles({ ...scene, items: [] })
  const [x, y] = resolve([0.05, 0.05], blocking)
  for (const w of blocking.walls) assert.ok(distanceToSegment([x, y], w.a, w.b) >= w.half + BODY_RADIUS - 1e-6)
  const path = walk([1, 1], [-Math.SQRT1_2, -Math.SQRT1_2], 100, blocking)
  const [a, b] = path.slice(-2)
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, 'settles in the corner without jitter')
})

test('a person walks through the pass-through but not the wall beside it', async () => {
  const scene = check(await example()).scene!
  const blocking = obstacles({ ...scene, items: [] })
  // The opening spans y 0.75 to 3.25 on the wall at x 5.5.
  assert.ok(walk([4.5, 2.0], [1, 0], 100, blocking).at(-1)![0] > 6)
  assert.ok(walk([4.5, 3.7], [1, 0], 100, blocking).at(-1)![0] < 5.5)
})

test('furniture stops a person; rugs do not', async () => {
  const scene = check(await example()).scene!
  const blocking = obstacles(scene)
  assert.ok(!blocking.solids.some((s) => s.x === 2.2 && s.y === 2.3), 'the rug is passable')
  // Walking north from the TV into the coffee table at [2.2, 2.1].
  const end = walk([2.2, 1.2], [0, 1], 60, blocking).at(-1)!
  assert.ok(end[1] < 2.1 - 0.3)
})

// Several levels: walls stack, edges split where rooms meet, stairs climb.

const house = async () => (await readScene(new URL('../examples/two-storey/scene.json', import.meta.url).pathname)) as any

test('rooms stacked on two levels get one wall per level, not one tall wall', async () => {
  const scene = check(await house()).scene!
  const all = walls(scene)
  // The hall's south edge (y 0, x 0..6) is also the lounge's, one floor up.
  const south = all.filter((w) => w.a[1] === 0 && w.b[1] === 0 && Math.min(w.a[0], w.b[0]) === 0)
  // Hall, lounge, and the roof terrace's parapet: three walls, one above the other.
  assert.equal(south.length, 3)
  assert.deepEqual(south.map((w) => w.elevation).sort(), [0, 3.15, 6])
  // The ground floor wall stands on the ground, through the plinth, and rises through the slab above.
  const ground = south.find((w) => w.elevation === 0)!
  assert.ok(Math.abs(ground.height - 3.15) < 0.01)
})

test('an edge that meets a shorter room is split, so the shared part is one wall', async () => {
  const scene = check(await house()).scene!
  const all = walls(scene)
  // The hall's north edge runs 0..6; the stair (0..5) and store (5..6) meet it.
  const north = all.filter((w) => w.a[1] === 4 && w.b[1] === 4 && w.elevation === 0)
  assert.equal(north.length, 2)
  const shared = north.find((w) => Math.max(w.a[0], w.b[0]) === 5)!
  assert.deepEqual([...shared.rooms].sort(), ['hall', 'stair-g'])
  assert.equal(shared.exterior, false)
})

test('an open room gets a parapet only where nothing else stands', async () => {
  const scene = check(await house()).scene!
  const all = walls(scene)
  const terrace = all.filter((w) => w.rooms.includes('roof-terrace'))
  assert.ok(terrace.length > 0)
  for (const w of terrace) if (w.rooms.length === 1) assert.ok(Math.abs(w.height - 1) < 1e-6, `parapet is 1 m, not ${w.height}`)
  // The porch (parapet 0) and the garden (0.5) meet: no wall between open rooms.
  assert.ok(!all.some((w) => w.rooms.includes('porch') && w.rooms.includes('garden')))
})

test('a person climbs the horseshoe stair and cannot step into the well', async () => {
  const scene = check(await house()).scene!
  const blocking = obstacles(scene)
  // Up from the south-west corner of the stair, around, and east: the top
  // lands at the first floor.
  const bottom = ground([0.5, 4.05], blocking, 0.3)!
  assert.ok(bottom < 0.5, `starts near the floor, got ${bottom}`)
  let foot = 0.3
  const corners: [number, number][] = [[0.5, 4.1], [0.5, 4.3], [0.6, 4.9], [1.2, 5.3], [2.5, 5.3], [3.8, 5.3], [4.4, 4.9], [4.5, 4.3]]
  // Ten-centimeter steps along the walking line, the way a person moves.
  for (let i = 0; i + 1 < corners.length; i++) {
    const [a, b] = [corners[i], corners[i + 1]]
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1)
    for (let k = 1; k <= steps; k++) {
      const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]
      const h = ground(p, blocking, foot)
      assert.ok(h !== undefined && h >= foot - 0.01, `climbs at [${p}]: ${h} from ${foot}`)
      foot = h
    }
  }
  assert.ok(Math.abs(foot - 3.15) < 0.3, `arrives at the first floor, got ${foot}`)
  // The well in the middle has no floor on the first level: nowhere to stand.
  assert.equal(ground([2.5, 4.3], blocking, 3.15), undefined)
  // And from the ground floor, the well is just floor.
  assert.equal(ground([2.5, 4.3], blocking, 0.3), 0.3)
})

test('walls on another level never block a person', async () => {
  const scene = check(await house()).scene!
  const blocking = obstacles(scene)
  // The lounge upstairs has no wall at x 5 (the store is below); walking
  // east across it at the first floor passes, at the ground floor it stops.
  const upstairs = walk([4.5, 4.5], [1, 0], 60, { ...blocking, walls: blocking.walls.filter((w) => w.bottom < 3.15 + 1.4 && w.top > 3.15 + 0.25) })
  assert.ok(upstairs.at(-1)![0] > 5.3, 'nothing in the way upstairs')
  const [x] = resolve([5.5, 4.5], blocking, undefined, 0.3)
  assert.ok(x <= 5.5, 'the store wall is there on the ground floor')
})

test('an item in a doorway is reported', async () => {
  const raw = await example()
  // The front door is on the living room's south wall; a bookcase right inside it.
  const door = raw.openings.find((o: any) => o.id === 'front-door')
  const room = raw.rooms.find((r: any) => r.id === door.wall.room)
  const [ax, ay] = room.floor[door.wall.edge]
  const [bx, by] = room.floor[(door.wall.edge + 1) % room.floor.length]
  const t = (door.at + door.width / 2) / Math.hypot(bx - ax, by - ay)
  const cx = ax + (bx - ax) * t
  const cy = ay + (by - ay) * t
  const nx = -(by - ay) / Math.hypot(bx - ax, by - ay)
  const ny = (bx - ax) / Math.hypot(bx - ax, by - ay)
  // Inside the room is the side the room's centroid is on.
  const [mx, my] = room.floor.reduce(([sx, sy]: number[], [x, y]: number[]) => [sx + x / room.floor.length, sy + y / room.floor.length], [0, 0])
  const sign = (mx - cx) * nx + (my - cy) * ny > 0 ? 1 : -1
  raw.items.push({ id: 'blocker', asset: 'shelf/bookcase', room: room.id, at: [cx + nx * sign * 0.4, cy + ny * sign * 0.4] })
  assert.match(messages(raw).join('\n'), /warning blocker: "blocker" stands in the way of door "front-door"/)
})

test('a sliding door lets a person through its open panels, not its closed ones', async () => {
  const raw = {
    stage: '0.1',
    name: 'slider',
    units: 'm',
    levels: [{ id: 'ground', elevation: 0, height: 2.7 }],
    rooms: [{ id: 'room', level: 'ground', name: 'Room', floor: [[0, 0], [6, 0], [6, 4], [0, 4]] }],
    // Three panels of 1.33 m from x 1 to 5; the middle one stands open.
    openings: [{ id: 'glass', wall: { room: 'room', edge: 0 }, at: 1, type: 'slider', width: 4, height: 2.4 }],
    items: [{ id: 'sofa', asset: 'sofa/three-seat', room: 'room', at: [3, 0.6], facing: 180 }],
  }
  const result = check(raw)
  assert.match(result.problems.map((p) => p.message).join('\n'), /"sofa".*"glass"/s, 'a sofa in front of the open panel blocks the door')
  const blocking = obstacles({ ...result.scene!, items: [] })
  assert.ok(walk([3, 1], [0, -1], 100, blocking).at(-1)![1] < -0.5, 'through the open middle panel')
  assert.ok(walk([1.6, 1], [0, -1], 100, blocking).at(-1)![1] > 0, 'stopped by the closed panel')
  assert.ok(walk([0.5, 1], [0, -1], 100, blocking).at(-1)![1] > 0, 'stopped by the wall beside it')
})

// Space: what query knows about free floor, and what check says about
// pieces in each other's way.

test('query answers adjacency, areas, free space, and where a piece fits', async () => {
  const scene = check(await example()).scene!
  const next = query(scene, ['adjacent', 'living']) as any
  assert.ok(next.neighbors.some((n: any) => n.room === 'kitchen' && n.sharedWall > 0 && n.connected), 'the living room opens to the kitchen')
  const areas = query(scene, ['areas']) as any
  assert.equal(areas.rooms.length, scene.rooms.length)
  assert.ok(areas.indoor > 20)
  const free = query(scene, ['free', 'living']) as any
  assert.ok(free.clear > 0 && free.clear < free.area, 'some of the floor is clear, not all')
  assert.ok(free.largestClearRectangle.width >= 1 && free.largestClearRectangle.depth >= 1)
  const fit = query(scene, ['fits', 'chair/armchair', 'in', 'living']) as any
  assert.ok(fit.fits && fit.places.length > 0)
  for (const place of fit.places) assert.ok(scene.rooms.find((r) => r.id === 'living')!.floor && place.at.length === 2)
  const noFit = query(scene, ['fits', 'table/dining-six', 'in', 'kitchen']) as any
  assert.ok(Array.isArray(noFit.places))
})

test('check reports pieces that run into each other and wardrobes that cannot open', async () => {
  const raw = await example()
  raw.items.push({ id: 'sofa-2', asset: 'sofa/three-seat', room: 'living', at: raw.items.find((i: any) => i.id === 'sofa').at, facing: 0 })
  const room = raw.rooms.find((r: any) => r.id === 'living')
  // A wardrobe with its front 10 cm from the west wall, facing it.
  raw.items.push({ id: 'wardrobe', asset: 'wardrobe/double', room: 'living', at: [room.floor[0][0] + 0.4, room.floor[0][1] + 2], facing: 270 })
  const messages = check(raw).problems.map((p) => p.message)
  assert.ok(messages.some((m) => /"sofa-2" runs into "sofa"/.test(m)), messages.join('\n'))
  assert.ok(messages.some((m) => /"wardrobe" faces a wall/.test(m)), messages.join('\n'))
})

test('a stair under a floor without a well has no headroom', async () => {
  const raw = await house()
  // The first floor's stair hole becomes solid floor.
  raw.rooms.find((r: any) => r.id === 'stair-1').well = false
  const messages = check(raw).problems.map((p) => p.message)
  assert.ok(messages.some((m) => /"stair-ground" has only .* m of headroom/.test(m)), messages.join('\n'))
  assert.ok(!check(await house()).problems.some((p) => /headroom/.test(p.message)), 'with the well there is headroom')
})

test('a scene can carry its own materials', async () => {
  const raw = await example()
  raw.materials = [{ id: 'lime-plaster', color: '#e9e2d3', roughness: 0.9 }, { id: 'slate', color: '#4a4e55', texture: 'slate_floor_02', size: 1.2 }]
  raw.rooms[0].materials = { ...raw.rooms[0].materials, walls: 'lime-plaster', floor: 'slate' }
  const result = check(raw)
  assert.ok(result.ok)
  assert.ok(!result.problems.some((p) => /material "lime-plaster"|material "slate"/.test(p.message)), 'own materials are not unknown')
  assert.deepEqual(materialSpec('lime-plaster', result.scene!.materials)?.color, '#e9e2d3')
  assert.equal(materialSpec('slate', result.scene!.materials)?.size, 1.2)
  assert.equal(materialSpec('oak-plank', result.scene!.materials)?.texture, 'laminate_floor_02', 'built-ins still resolve')
  assert.ok(format(raw).lastIndexOf('"materials"') > format(raw).indexOf('"cameras"'), 'the materials list is written after the cameras')
})

test('a level can carry a gable roof', async () => {
  const raw = await example()
  raw.levels[0].roof = { kind: 'gable', pitch: 35 }
  const result = check(raw)
  assert.ok(result.ok, result.problems.map((p) => p.message).join('\n'))
  assert.deepEqual(result.scene!.levels[0].roof, { kind: 'gable', pitch: 35, overhang: 0.4 })
  assert.ok(/"roof": \{\s*"kind": "gable"/.test(format(raw)), 'the roof is written with its keys in order')
})
