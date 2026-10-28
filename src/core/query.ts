import { placeObjects, round3, type Placed } from './objects.ts'
import { findAsset } from './assets.ts'
import { allCameras } from './cameras.ts'
import { area, bounds, centroid, edges, levelsByElevation, pointInPolygon, roomHeight, sceneBounds, walls, type Point } from './geometry.ts'
import type { Room, Scene } from './schema.ts'

// Answers to `stage query`, so an agent can ask about the scene instead of
// reading the whole file. Every answer is plain JSON.

export const QUESTIONS = [
  'rooms',
  'room <id>',
  'items [in <room>]',
  'walls <room>',
  'openings [in <room>]',
  'cameras',
  'objects',
  'object <id>',
  'bounds',
  'adjacent <room>',
  'areas [level]',
  'free <room>',
  'fits <asset> in <room>',
]

export function query(scene: Scene, words: string[]): unknown {
  const [what, ...rest] = words
  switch (what) {
    case 'rooms':
      return scene.rooms.map((room) => summarizeRoom(scene, room.id))
    case 'room': {
      const room = scene.rooms.find((r) => r.id === rest[0])
      if (!room) throw new Error(`no room is called "${rest[0]}"; rooms are ${scene.rooms.map((r) => r.id).join(', ')}.`)
      return describeRoom(scene, room.id)
    }
    case 'items': {
      const inRoom = rest[0] === 'in' ? rest[1] : undefined
      if (inRoom && !scene.rooms.some((r) => r.id === inRoom)) {
        throw new Error(`no room is called "${inRoom}"; rooms are ${scene.rooms.map((r) => r.id).join(', ')}.`)
      }
      return scene.items
        .filter((item) => !inRoom || item.room === inRoom)
        .map((item) => ({
          id: item.id,
          asset: item.asset,
          name: findAsset(item.asset)?.name ?? null,
          room: item.room,
          at: item.at,
          facing: item.facing,
          size: findAsset(item.asset)?.size ?? item.size ?? null,
        }))
    }
    case 'walls': {
      const room = scene.rooms.find((r) => r.id === rest[0])
      if (!room) throw new Error(`no room is called "${rest[0]}"; rooms are ${scene.rooms.map((r) => r.id).join(', ')}.`)
      return describeRoom(scene, room.id).edges
    }
    case 'openings': {
      const inRoom = rest[0] === 'in' ? rest[1] : undefined
      return scene.openings
        .filter((o) => !inRoom || o.wall.room === inRoom || isShared(scene, o, inRoom))
        .map((o) => ({ id: o.id, type: o.type, room: o.wall.room, edge: o.wall.edge, at: o.at, width: o.width, height: o.height }))
    }
    case 'objects':
      return placeObjects(scene).map((p) => summarizeObject(p))
    case 'object': {
      const placed = placeObjects(scene).find((p) => p.object.id === rest[0])
      if (!placed) throw new Error(`no object is called "${rest[0]}"; objects are ${scene.objects.map((o) => o.id).join(', ') || 'none'}.`)
      const children = scene.objects.filter((o) => o.parent === placed.object.id).map((o) => o.id)
      return { ...summarizeObject(placed), children, flat: placed.flat, box: { min: round3(placed.box.min), max: round3(placed.box.max) } }
    }
    case 'cameras':
      return allCameras(scene).map((c) => ({ id: c.id, type: c.type, at: c.at ?? null, look: c.look ?? null, auto: c.id.startsWith('room:') }))
    case 'bounds': {
      const b = sceneBounds(scene)
      return { min: b.min, max: b.max, width: b.max[0] - b.min[0], depth: b.max[1] - b.min[1] }
    }
    case 'adjacent': {
      const room = roomOrThrow(scene, rest[0])
      return adjacent(scene, room)
    }
    case 'areas': {
      const level = rest[0]
      if (level && !scene.levels.some((l) => l.id === level)) throw new Error(`no level is called "${level}"; levels are ${scene.levels.map((l) => l.id).join(', ')}.`)
      const rooms = scene.rooms.filter((r) => !level || r.level === level).map((r) => ({ id: r.id, name: r.name ?? null, level: r.level, open: !!r.open, area: round(area(r.floor)) }))
      const sum = (list: { area: number }[]) => round(list.reduce((t, r) => t + r.area, 0))
      const levels = scene.levels.filter((l) => !level || l.id === level).map((l) => ({ level: l.id, indoor: sum(rooms.filter((r) => r.level === l.id && !r.open)), outdoor: sum(rooms.filter((r) => r.level === l.id && r.open)) }))
      return { rooms, levels, indoor: sum(rooms.filter((r) => !r.open)), outdoor: sum(rooms.filter((r) => r.open)) }
    }
    case 'free': {
      const room = roomOrThrow(scene, rest[0])
      return freeSpace(scene, room)
    }
    case 'fits': {
      const inAt = rest.indexOf('in')
      const assetId = rest.slice(0, inAt < 0 ? rest.length : inAt).join(' ')
      const room = roomOrThrow(scene, rest[inAt + 1])
      const asset = findAsset(assetId)
      if (!asset) throw new Error(`no asset is called "${assetId}"; search with the assets tool.`)
      return fits(scene, room, asset.id, asset.size)
    }
    default:
      throw new Error(`"${words.join(' ')}" is not a question; ask one of: ${QUESTIONS.join(', ')}.`)
  }
}

// An object as it stands in the world: its own fields, then where it
// ended up after its parents' turns and scales.
function summarizeObject(p: Placed) {
  const o = p.object
  const size = round3([p.box.max[0] - p.box.min[0], p.box.max[1] - p.box.min[1], p.box.max[2] - p.box.min[2]])
  return { id: o.id, kind: o.kind, name: o.name ?? null, parent: o.parent ?? null, room: o.room ?? null, at: o.at, facing: o.facing, world: { position: round3(p.position), yaw: Math.round(p.yaw * 10) / 10, size } }
}

function roomOrThrow(scene: Scene, id: string | undefined): Room {
  const room = scene.rooms.find((r) => r.id === id)
  if (!room) throw new Error(`no room is called "${id}"; rooms are ${scene.rooms.map((r) => r.id).join(', ')}.`)
  return room
}

// Rooms sharing a wall with this one, with the openings between them, and
// the rooms directly above and below.
function adjacent(scene: Scene, room: Room) {
  const byWall = new Map<string, { sharedWall: number; openings: string[] }>()
  for (const wall of walls(scene)) {
    if (!wall.rooms.includes(room.id)) continue
    for (const other of wall.rooms) {
      if (other === room.id) continue
      const entry = byWall.get(other) ?? { sharedWall: 0, openings: [] }
      entry.sharedWall = round(entry.sharedWall + wall.length)
      for (const o of wall.openings) if (!entry.openings.includes(o.opening.id)) entry.openings.push(o.opening.id)
      byWall.set(other, entry)
    }
  }
  const ordered = levelsByElevation(scene)
  const index = ordered.findIndex((l) => l.id === room.level)
  const overlapping = (levelId: string | undefined) =>
    levelId ? scene.rooms.filter((r) => r.level === levelId && polygonsOverlap(r.floor, room.floor)).map((r) => r.id) : []
  return {
    room: room.id,
    neighbors: [...byWall].map(([id, e]) => ({ room: id, sharedWall: e.sharedWall, openings: e.openings, connected: e.openings.length > 0 })),
    above: overlapping(ordered[index + 1]?.id),
    below: overlapping(ordered[index - 1]?.id),
  }
}

function polygonsOverlap(p: Point[], q: Point[]): boolean {
  const c = centroid(p)
  const d = centroid(q)
  return pointInPolygon(c, q) || pointInPolygon(d, p) || p.some((v) => pointInPolygon(v, q)) || q.some((v) => pointInPolygon(v, p))
}

// The floor of a room as a 10 cm grid: a cell is free when it lies inside
// the room, under no solid piece, and off the clear zone in front of a
// door; the walker's view of the room, for free-space questions.
const CELL = 0.1
const DOOR_CLEAR = 0.7
interface Grid {
  minX: number
  minY: number
  cols: number
  rows: number
  free: Uint8Array
  // Cells covered by furniture, as opposed to doors or walls.
  furnished: number
}

function occupancy(scene: Scene, room: Room): Grid {
  const b = bounds(room.floor)
  const minX = b.min[0]
  const minY = b.min[1]
  const cols = Math.max(1, Math.ceil((b.max[0] - minX) / CELL))
  const rows = Math.max(1, Math.ceil((b.max[1] - minY) / CELL))
  const free = new Uint8Array(cols * rows)
  const boxes = scene.items
    .filter((item) => item.room === room.id)
    .map((item) => {
      const info = findAsset(item.asset)
      if (!info || info.passable || info.category === 'rug') return undefined
      const size = info.resizable && item.size ? item.size : info.size
      // Nothing hung above head height blocks the floor.
      if (item.elevation > 1.9) return undefined
      return { x: item.at[0], y: item.at[1], halfW: (size[0] * item.scale) / 2, halfD: (size[1] * item.scale) / 2, angle: (item.facing * Math.PI) / 180 }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  const doors: typeof boxes = []
  for (const opening of scene.openings) {
    if (opening.type === 'window') continue
    const wall = walls(scene).find((w) => w.rooms.includes(room.id) && w.openings.some((o) => o.opening === opening))
    const hole = wall?.openings.find((o) => o.opening === opening)
    if (!wall || !hole) continue
    const mid = hole.from + (hole.to - hole.from) / 2
    const t = wall.length === 0 ? 0 : mid / wall.length
    const cx = wall.a[0] + (wall.b[0] - wall.a[0]) * t
    const cy = wall.a[1] + (wall.b[1] - wall.a[1]) * t
    const angle = Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0])
    doors.push({ x: cx, y: cy, halfW: (hole.to - hole.from) / 2, halfD: DOOR_CLEAR, angle: -angle })
  }
  const inside = (p: Point, r: (typeof boxes)[number]) => {
    const c = Math.cos(r.angle)
    const n = Math.sin(r.angle)
    const lx = (p[0] - r.x) * c - (p[1] - r.y) * n
    const ly = (p[0] - r.x) * n + (p[1] - r.y) * c
    return Math.abs(lx) <= r.halfW && Math.abs(ly) <= r.halfD
  }
  let furnished = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const p: Point = [minX + (col + 0.5) * CELL, minY + (row + 0.5) * CELL]
      if (!pointInPolygon(p, room.floor)) continue
      if (boxes.some((box) => inside(p, box))) {
        furnished++
        continue
      }
      if (doors.some((d) => inside(p, d))) continue
      free[row * cols + col] = 1
    }
  }
  return { minX, minY, cols, rows, free, furnished }
}

// The largest empty rectangle on the grid, by the histogram method.
function largestRectangle(grid: Grid): { col: number; row: number; cols: number; rows: number } {
  const heights = new Int32Array(grid.cols)
  let best = { col: 0, row: 0, cols: 0, rows: 0 }
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) heights[col] = grid.free[row * grid.cols + col] ? heights[col] + 1 : 0
    const stack: number[] = []
    for (let col = 0; col <= grid.cols; col++) {
      const h = col === grid.cols ? 0 : heights[col]
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!
        const width = stack.length ? col - stack[stack.length - 1] - 1 : col
        if (heights[top] * width > best.cols * best.rows) best = { col: stack.length ? stack[stack.length - 1] + 1 : 0, row: row - heights[top] + 1, cols: width, rows: heights[top] }
      }
      stack.push(col)
    }
  }
  return best
}

function freeSpace(scene: Scene, room: Room) {
  const grid = occupancy(scene, room)
  const big = largestRectangle(grid)
  const freeCells = grid.free.reduce((t, v) => t + v, 0)
  return {
    room: room.id,
    area: round(area(room.floor)),
    furnished: round(grid.furnished * CELL * CELL),
    clear: round(freeCells * CELL * CELL),
    largestClearRectangle: {
      at: [round(grid.minX + (big.col + big.cols / 2) * CELL), round(grid.minY + (big.row + big.rows / 2) * CELL)],
      width: round(big.cols * CELL),
      depth: round(big.rows * CELL),
    },
    wallSpace: edges(room).map((edge) => ({ edge: edge.index, direction: compass(edge.a, edge.b), longestClearRun: round(clearRun(grid, room, edge)) })),
  }
}

// The longest stretch along an edge with 60 cm of free floor beside it.
function clearRun(grid: Grid, room: Room, edge: { a: Point; b: Point; length: number }): number {
  const ux = (edge.b[0] - edge.a[0]) / (edge.length || 1)
  const uy = (edge.b[1] - edge.a[1]) / (edge.length || 1)
  const c = centroid(room.floor)
  // The inward normal points toward the room.
  let nx = -uy
  let ny = ux
  if ((c[0] - edge.a[0]) * nx + (c[1] - edge.a[1]) * ny < 0) [nx, ny] = [-nx, -ny]
  let best = 0
  let run = 0
  for (let t = CELL / 2; t < edge.length; t += CELL) {
    const ok = [0.15, 0.35, 0.55].every((d) => isFree(grid, [edge.a[0] + ux * t + nx * d, edge.a[1] + uy * t + ny * d]))
    run = ok ? run + CELL : 0
    best = Math.max(best, run)
  }
  return best
}

function isFree(grid: Grid, p: Point): boolean {
  const col = Math.floor((p[0] - grid.minX) / CELL)
  const row = Math.floor((p[1] - grid.minY) / CELL)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false
  return grid.free[row * grid.cols + col] === 1
}

// Where a piece of the given size fits: its back to each wall first (the
// way furniture usually stands), then the middle of the largest clear
// floor. Up to six suggestions.
function fits(scene: Scene, room: Room, assetId: string, size: [number, number, number]) {
  const grid = occupancy(scene, room)
  const [w, d] = size
  const places: { at: [number, number]; facing: number; edge: number | null; note: string }[] = []
  const clearAt = (x: number, y: number, hw: number, hd: number, angle: number) => {
    const c = Math.cos(angle)
    const n = Math.sin(angle)
    for (let lx = -hw + CELL / 2; lx < hw; lx += CELL) {
      for (let ly = -hd + CELL / 2; ly < hd; ly += CELL) {
        if (!isFree(grid, [x + lx * c + ly * n, y - lx * n + ly * c])) return false
      }
    }
    return true
  }
  for (const edge of edges(room)) {
    if (edge.length < w) continue
    const ux = (edge.b[0] - edge.a[0]) / edge.length
    const uy = (edge.b[1] - edge.a[1]) / edge.length
    const c = centroid(room.floor)
    let nx = -uy
    let ny = ux
    if ((c[0] - edge.a[0]) * nx + (c[1] - edge.a[1]) * ny < 0) [nx, ny] = [-nx, -ny]
    // Back to the wall: the front faces the inward normal.
    const facing = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360
    const angle = (facing * Math.PI) / 180
    const gap = 0.05
    for (let t = w / 2 + gap; t <= edge.length - w / 2 - gap; t += 0.25) {
      const x = edge.a[0] + ux * t + nx * (d / 2 + gap)
      const y = edge.a[1] + uy * t + ny * (d / 2 + gap)
      if (!clearAt(x, y, w / 2, d / 2, angle)) continue
      places.push({ at: [round(x), round(y)], facing: Math.round(facing), edge: edge.index, note: `back to the ${compass(edge.a, edge.b).split(',')[0]}` })
      break
    }
    if (places.length >= 5) break
  }
  const big = largestRectangle(grid)
  if (big.cols * CELL >= w && big.rows * CELL >= d) {
    places.push({ at: [round(grid.minX + (big.col + big.cols / 2) * CELL), round(grid.minY + (big.row + big.rows / 2) * CELL)], facing: 0, edge: null, note: 'free-standing, in the largest clear area' })
  }
  return { asset: assetId, room: room.id, size: [w, d], fits: places.length > 0, places }
}

function summarizeRoom(scene: Scene, id: string) {
  const room = scene.rooms.find((r) => r.id === id)!
  const b = bounds(room.floor)
  return {
    id: room.id,
    name: room.name ?? null,
    level: room.level,
    area: round(area(room.floor)),
    width: round(b.max[0] - b.min[0]),
    depth: round(b.max[1] - b.min[1]),
    height: roomHeight(scene, room),
    center: centroid(room.floor).map(round),
    items: scene.items.filter((i) => i.room === room.id).length,
  }
}

function describeRoom(scene: Scene, id: string) {
  const room = scene.rooms.find((r) => r.id === id)!
  const allWalls = walls(scene)
  const roomEdges = edges(room).map((edge) => {
    const wall = allWalls.find((w) => w.rooms.includes(room.id) && sameEdge(w, edge))
    const neighbors = wall?.rooms.filter((r) => r !== room.id) ?? []
    return {
      edge: edge.index,
      from: edge.a,
      to: edge.b,
      length: round(edge.length),
      direction: compass(edge.a, edge.b),
      sharedWith: neighbors[0] ?? null,
      openings: scene.openings
        .filter((o) => wall && wallHas(scene, wall, o))
        .map((o) => ({ id: o.id, type: o.type, at: o.wall.room === room.id ? o.at : null, width: o.width })),
    }
  })
  return {
    ...summarizeRoom(scene, id),
    floor: room.floor,
    materials: room.materials ?? {},
    edges: roomEdges,
    items: scene.items.filter((i) => i.room === room.id).map((i) => ({ id: i.id, asset: i.asset, at: i.at, facing: i.facing })),
  }
}

function sameEdge(wall: { a: [number, number]; b: [number, number] }, edge: { a: [number, number]; b: [number, number] }): boolean {
  const near = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6
  return (near(wall.a, edge.a) && near(wall.b, edge.b)) || (near(wall.a, edge.b) && near(wall.b, edge.a))
}

function wallHas(scene: Scene, wall: { rooms: string[]; a: [number, number]; b: [number, number] }, opening: Scene['openings'][number]): boolean {
  const room = scene.rooms.find((r) => r.id === opening.wall.room)
  const edge = room && edges(room)[opening.wall.edge]
  return edge ? sameEdge(wall, edge) : false
}

function isShared(scene: Scene, opening: Scene['openings'][number], roomId: string): boolean {
  const wall = walls(scene).find((w) => wallHas(scene, w, opening))
  return wall?.rooms.includes(roomId) ?? false
}

// The side of the room an edge is on, as a person would say it.
function compass(a: [number, number], b: [number, number]): string {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'south side, running east' : 'north side, running west'
  return dy > 0 ? 'east side, running north' : 'west side, running south'
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
