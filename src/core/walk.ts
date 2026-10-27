import { findAsset } from './assets.ts'
import { alongWall, levelsByElevation, pointInPolygon, roomElevation, wallPieces, walls, type Point } from './geometry.ts'
import type { Scene } from './schema.ts'
import { stair, type Stair } from './stairs.ts'

// Walking through a scene: what stops a person, how they slide off it, and
// what they stand on, floor by floor and up the stairs. Pure plan geometry,
// so the viewer walks with it and the tests check it.

export const BODY_RADIUS = 0.2
// How much room furniture gets beyond its footprint.
const FURNITURE_MARGIN = 0.08
// The most a step can climb or drop without a stair.
export const STEP = 0.45

export interface Obstacles {
  walls: { a: Point; b: Point; half: number; bottom: number; top: number }[]
  solids: { x: number; y: number; halfW: number; halfD: number; angle: number; bottom: number; top: number }[]
  floors: { polygon: Point[]; elevation: number }[]
  stairs: { x: number; y: number; angle: number; elevation: number; stair: Stair }[]
}

// Pieces flat on the floor or hung above head height don't stop anyone.
const PASSABLE = new Set(['rug/area', 'kitchen/wall-cabinets', 'tv/wall', 'screen/projection'])

export function obstacles(scene: Scene): Obstacles {
  const result: Obstacles = { walls: [], solids: [], floors: [], stairs: [] }
  for (const wall of walls(scene)) {
    for (const piece of wallPieces(wall)) {
      result.walls.push({ a: alongWall(wall, piece.from), b: alongWall(wall, piece.to), half: wall.thickness / 2, bottom: wall.elevation + piece.bottom, top: wall.elevation + piece.top })
    }
  }
  const rooms = new Map(scene.rooms.map((room) => [room.id, room]))
  for (const room of scene.rooms) {
    if (!room.well) result.floors.push({ polygon: room.floor, elevation: roomElevation(scene, room) })
  }
  for (const item of scene.items) {
    const room = rooms.get(item.room)
    const base = (room ? roomElevation(scene, room) : 0) + item.elevation
    const info = findAsset(item.asset)
    const size = info && !info.resizable ? info.size : (item.size ?? info?.size)
    if (!size) continue
    const angle = (item.facing * Math.PI) / 180
    if (info?.category === 'stairs') {
      const rise = item.size?.[2] ?? (room ? floorToFloor(scene, room.level) : size[2])
      result.stairs.push({ x: item.at[0], y: item.at[1], angle, elevation: base, stair: stair(item.asset, size[0] * item.scale, size[1] * item.scale, rise) })
      continue
    }
    if (PASSABLE.has(item.asset) || info?.passable) continue
    result.solids.push({ x: item.at[0], y: item.at[1], halfW: (size[0] * item.scale) / 2, halfD: (size[1] * item.scale) / 2, angle, bottom: base, top: base + size[2] * item.scale })
  }
  return result
}

// From a level's floor to the next level's floor, or to its own roof.
export function floorToFloor(scene: Scene, levelId: string): number {
  const ordered = levelsByElevation(scene)
  const index = ordered.findIndex((l) => l.id === levelId)
  const level = ordered[index]
  if (!level) return 2.7
  const above = ordered[index + 1]
  return above ? above.elevation - level.elevation : level.height + level.slab
}

function closestOnSegment([x, y]: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared))
  return [a[0] + t * dx, a[1] + t * dy]
}

// Into an item's own frame: facing turns it clockwise from north.
function toLocal([x, y]: Point, s: { x: number; y: number; angle: number }): Point {
  const c = Math.cos(s.angle)
  const n = Math.sin(s.angle)
  return [(x - s.x) * c - (y - s.y) * n, (x - s.x) * n + (y - s.y) * c]
}

// Whether something spanning bottom..top is in the way of a person whose
// feet are at `foot`: anything from the shins up to head height.
function inTheWay(bottom: number, top: number, foot: number): boolean {
  return bottom < foot + 1.4 && top > foot + 0.25
}

// Pushes a position out of every wall and piece of furniture it overlaps,
// along the shortest way out. Walking into a wall at an angle then glides
// along it, and no position is ever stuck: a step is never refused, only
// corrected. Only what is at the person's own height counts.
export function resolve(p: Point, { walls, solids }: Obstacles, radius = BODY_RADIUS, foot = 0): Point {
  let [x, y] = p
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const w of walls) {
      if (!inTheWay(w.bottom, w.top, foot)) continue
      const reach = w.half + radius
      const [cx, cy] = closestOnSegment([x, y], w.a, w.b)
      const d = Math.hypot(x - cx, y - cy)
      if (d >= reach || d < 1e-9) continue
      x = cx + ((x - cx) / d) * reach
      y = cy + ((y - cy) / d) * reach
      moved = true
    }
    for (const s of solids) {
      if (!inTheWay(s.bottom, s.top, foot)) continue
      const c = Math.cos(s.angle)
      const n = Math.sin(s.angle)
      let [lx, ly] = toLocal([x, y], s)
      const hw = s.halfW + FURNITURE_MARGIN + radius * 0.5
      const hd = s.halfD + FURNITURE_MARGIN + radius * 0.5
      if (Math.abs(lx) >= hw || Math.abs(ly) >= hd) continue
      if (hw - Math.abs(lx) < hd - Math.abs(ly)) lx = Math.sign(lx || 1) * hw
      else ly = Math.sign(ly || 1) * hd
      x = s.x + lx * c + ly * n
      y = s.y - lx * n + ly * c
      moved = true
    }
    if (!moved) break
  }
  return [x, y]
}

// What a person standing at `p` with their feet at `foot` would stand on
// after a step: the nearest floor or stair within a step's reach, or
// undefined over a well, a void, or off the edge of a mezzanine. Stairs
// win ties, so stepping onto the first tread climbs.
export function ground(p: Point, { floors, stairs }: Obstacles, foot: number): number | undefined {
  let best: number | undefined
  let bestGap = STEP
  for (const s of stairs) {
    const h = s.stair.height(toLocal(p, s))
    if (h === undefined) continue
    const gap = Math.abs(s.elevation + h - foot)
    if (gap < bestGap + 0.2) {
      best = s.elevation + h
      bestGap = gap - 0.2
    }
  }
  for (const f of floors) {
    const gap = Math.abs(f.elevation - foot)
    if (gap < bestGap && pointInPolygon(p, f.polygon)) {
      best = f.elevation
      bestGap = gap
    }
  }
  return best
}
