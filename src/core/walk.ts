import { findAsset } from './assets.ts'
import { alongWall, wallPieces, walls, type Point } from './geometry.ts'
import type { Scene } from './schema.ts'

// Walking through a scene: what stops a person, and how they slide off it.
// Pure plan geometry, so the viewer walks with it and the tests check it.

export const BODY_RADIUS = 0.2
// How much room furniture gets beyond its footprint.
const FURNITURE_MARGIN = 0.08

export interface Obstacles {
  walls: { a: Point; b: Point; half: number }[]
  solids: { x: number; y: number; halfW: number; halfD: number; angle: number }[]
}

// Pieces flat on the floor or hung above head height don't stop anyone.
const PASSABLE = new Set(['rug/area', 'kitchen/wall-cabinets'])

export function obstacles(scene: Scene): Obstacles {
  const result: Obstacles = { walls: [], solids: [] }
  for (const wall of walls(scene)) {
    // Anything solid below waist height stops you; a lintel over a door does not.
    for (const piece of wallPieces(wall)) {
      if (piece.bottom < 1) result.walls.push({ a: alongWall(wall, piece.from), b: alongWall(wall, piece.to), half: wall.thickness / 2 })
    }
  }
  for (const item of scene.items) {
    if (PASSABLE.has(item.asset) || item.elevation > 1) continue
    const size = findAsset(item.asset)?.size ?? item.size
    if (!size) continue
    result.solids.push({ x: item.at[0], y: item.at[1], halfW: (size[0] * item.scale) / 2, halfD: (size[1] * item.scale) / 2, angle: (item.facing * Math.PI) / 180 })
  }
  return result
}

function closestOnSegment([x, y]: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared))
  return [a[0] + t * dx, a[1] + t * dy]
}

// Pushes a position out of every wall and piece of furniture it overlaps,
// along the shortest way out. Walking into a wall at an angle then glides
// along it, and no position is ever stuck: a step is never refused, only
// corrected.
export function resolve(p: Point, { walls, solids }: Obstacles, radius = BODY_RADIUS): Point {
  let [x, y] = p
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const w of walls) {
      const reach = w.half + radius
      const [cx, cy] = closestOnSegment([x, y], w.a, w.b)
      const d = Math.hypot(x - cx, y - cy)
      if (d >= reach || d < 1e-9) continue
      x = cx + ((x - cx) / d) * reach
      y = cy + ((y - cy) / d) * reach
      moved = true
    }
    for (const s of solids) {
      // Into the item's own frame: facing turns it clockwise from north.
      const c = Math.cos(s.angle)
      const n = Math.sin(s.angle)
      let lx = (x - s.x) * c - (y - s.y) * n
      let ly = (x - s.x) * n + (y - s.y) * c
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
