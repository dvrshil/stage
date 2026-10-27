import { findAsset } from './assets.ts'
import { area, bounds, centroid, edges, roomHeight, sceneBounds, walls } from './geometry.ts'
import type { Scene } from './schema.ts'

// Answers to `stage query`, so an agent can ask about the scene instead of
// reading the whole file. Every answer is plain JSON.

export const QUESTIONS = [
  'rooms',
  'room <id>',
  'items [in <room>]',
  'walls <room>',
  'openings [in <room>]',
  'cameras',
  'bounds',
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
    case 'cameras':
      return scene.cameras.map((c) => ({ id: c.id, type: c.type, at: c.at ?? null, look: c.look ?? null }))
    case 'bounds': {
      const b = sceneBounds(scene)
      return { min: b.min, max: b.max, width: b.max[0] - b.min[0], depth: b.max[1] - b.min[1] }
    }
    default:
      throw new Error(`"${words.join(' ')}" is not a question; ask one of: ${QUESTIONS.join(', ')}.`)
  }
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
