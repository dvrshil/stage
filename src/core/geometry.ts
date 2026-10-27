import type { Opening, Room, Scene } from './schema.ts'

// Pure plan geometry: no renderer here. The viewer turns these results into
// meshes and the command line answers queries from them, so both agree.

export type Point = [number, number]

export interface Edge {
  index: number
  a: Point
  b: Point
  length: number
}

export interface WallOpening {
  opening: Opening
  // Along the wall from its own `a`, whichever room the opening was given on.
  from: number
  to: number
  bottom: number
  top: number
}

export interface Wall {
  id: string
  a: Point
  b: Point
  length: number
  thickness: number
  height: number
  elevation: number
  // Rooms on each side; one room means an exterior wall.
  rooms: string[]
  exterior: boolean
  openings: WallOpening[]
}

// A solid piece of wall between and around openings, in wall coordinates:
// `from` and `to` along the wall, `bottom` and `top` above the floor.
export interface WallPiece {
  from: number
  to: number
  bottom: number
  top: number
}

export const INTERIOR_THICKNESS = 0.12
export const EXTERIOR_THICKNESS = 0.25
export const DEFAULT_SILL = 0.9

export function edges(room: Room): Edge[] {
  const n = room.floor.length
  return room.floor.map((a, index) => {
    const b = room.floor[(index + 1) % n]
    return { index, a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]) }
  })
}

export function area(polygon: Point[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i]
    const [x2, y2] = polygon[(i + 1) % polygon.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

export function centroid(polygon: Point[]): Point {
  let x = 0
  let y = 0
  for (const [px, py] of polygon) {
    x += px
    y += py
  }
  return [x / polygon.length, y / polygon.length]
}

export interface Bounds {
  min: Point
  max: Point
}

export function bounds(points: Point[]): Bounds {
  const min: Point = [Infinity, Infinity]
  const max: Point = [-Infinity, -Infinity]
  for (const [x, y] of points) {
    min[0] = Math.min(min[0], x)
    min[1] = Math.min(min[1], y)
    max[0] = Math.max(max[0], x)
    max[1] = Math.max(max[1], y)
  }
  return { min, max }
}

export function sceneBounds(scene: Scene): Bounds {
  return bounds(scene.rooms.flatMap((room) => room.floor))
}

// Ray casting, with points on an edge counted as inside, so an item pushed
// flush against a wall is still in its room.
export function pointInPolygon([x, y]: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (distanceToSegment([x, y], [xi, yi], [xj, yj]) < 1e-6) return true
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  let t = lengthSquared === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

export function roomHeight(scene: Scene, room: Room): number {
  const level = scene.levels.find((l) => l.id === room.level)
  return room.height ?? level?.height ?? 2.7
}

export function roomElevation(scene: Scene, room: Room): number {
  return scene.levels.find((l) => l.id === room.level)?.elevation ?? 0
}

function edgeKey(a: Point, b: Point): string {
  const p = `${a[0].toFixed(4)},${a[1].toFixed(4)}`
  const q = `${b[0].toFixed(4)},${b[1].toFixed(4)}`
  return p < q ? `${p}|${q}` : `${q}|${p}`
}

// One wall per distinct edge. Two rooms that share an edge share the wall,
// so it is built once and openings from either room land on it.
export function walls(scene: Scene): Wall[] {
  const byKey = new Map<string, Wall>()
  const roomsById = new Map(scene.rooms.map((room) => [room.id, room]))

  for (const room of scene.rooms) {
    for (const edge of edges(room)) {
      const key = edgeKey(edge.a, edge.b)
      const existing = byKey.get(key)
      if (existing) {
        existing.rooms.push(room.id)
        existing.height = Math.max(existing.height, roomHeight(scene, room))
        continue
      }
      byKey.set(key, {
        id: `${room.id}/${edge.index}`,
        a: edge.a,
        b: edge.b,
        length: edge.length,
        thickness: EXTERIOR_THICKNESS,
        height: roomHeight(scene, room),
        elevation: roomElevation(scene, room),
        rooms: [room.id],
        exterior: true,
        openings: [],
      })
    }
  }

  for (const wall of byKey.values()) {
    wall.exterior = wall.rooms.length === 1
    wall.thickness = wall.exterior ? EXTERIOR_THICKNESS : INTERIOR_THICKNESS
  }

  for (const opening of scene.openings) {
    const room = roomsById.get(opening.wall.room)
    if (!room) continue
    const edge = edges(room)[opening.wall.edge]
    if (!edge) continue
    const wall = byKey.get(edgeKey(edge.a, edge.b))
    if (!wall) continue
    // The opening's `at` runs from the room's edge start; the wall may run
    // the other way if it was first seen from the neighboring room.
    const sameDirection = Math.hypot(wall.a[0] - edge.a[0], wall.a[1] - edge.a[1]) < 1e-6
    const from = sameDirection ? opening.at : wall.length - opening.at - opening.width
    const bottom = opening.type === 'window' ? (opening.sill ?? DEFAULT_SILL) : 0
    wall.openings.push({
      opening,
      from,
      to: from + opening.width,
      bottom,
      top: bottom + opening.height,
    })
  }

  for (const wall of byKey.values()) wall.openings.sort((p, q) => p.from - q.from)
  return [...byKey.values()]
}

// Solid pieces of a wall: full height between openings, a lintel above each
// opening, and a sill piece below a window. No CSG needed.
export function wallPieces(wall: Wall): WallPiece[] {
  const pieces: WallPiece[] = []
  let cursor = 0
  for (const hole of wall.openings) {
    const from = Math.max(0, Math.min(wall.length, hole.from))
    const to = Math.max(0, Math.min(wall.length, hole.to))
    if (from > cursor) pieces.push({ from: cursor, to: from, bottom: 0, top: wall.height })
    if (hole.top < wall.height) pieces.push({ from, to, bottom: hole.top, top: wall.height })
    if (hole.bottom > 0) pieces.push({ from, to, bottom: 0, top: hole.bottom })
    cursor = Math.max(cursor, to)
  }
  if (cursor < wall.length) pieces.push({ from: cursor, to: wall.length, bottom: 0, top: wall.height })
  return pieces
}

// Plan coordinates of a point `along` a wall from `a`.
export function alongWall(wall: Wall, along: number): Point {
  const t = wall.length === 0 ? 0 : along / wall.length
  return [wall.a[0] + (wall.b[0] - wall.a[0]) * t, wall.a[1] + (wall.b[1] - wall.a[1]) * t]
}

export function wallAngle(wall: Wall): number {
  return Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0])
}
