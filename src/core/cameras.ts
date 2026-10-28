import { area, centroid, pointInPolygon, roomElevation, type Point } from './geometry.ts'
import type { Camera, Scene } from './schema.ts'

// A camera for every room the scene does not give one: standing a step in
// from the corner farthest from the middle, at eye height, looking at the
// middle of the room. Ids are "room:<room id>"; they are never written to
// the file, so the scene's own cameras always win.
export function autoCameras(scene: Scene): Camera[] {
  const distance = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const round = (n: number) => Math.round(n * 100) / 100
  return scene.rooms
    .filter((room) => !room.open && !room.well && area(room.floor) >= 1)
    .map((room) => {
      const middle = centroid(room.floor)
      const corner = room.floor.reduce((best, p) => (distance(p, middle) > distance(best, middle) ? p : best), room.floor[0])
      const away = distance(corner, middle)
      const t = away > 0 ? Math.min(0.7 / away, 0.45) : 0
      let at: Point = [corner[0] + (middle[0] - corner[0]) * t, corner[1] + (middle[1] - corner[1]) * t]
      if (!pointInPolygon(at, room.floor)) at = middle
      const floor = roomElevation(scene, room)
      return {
        id: `room:${room.id}`,
        type: 'perspective' as const,
        at: [round(at[0]), round(at[1]), round(floor + 1.5)] as [number, number, number],
        look: [round(middle[0]), round(middle[1]), round(floor + 1.0)] as [number, number, number],
        fov: 70,
        level: room.level,
      }
    })
}

// The scene's cameras, then the automatic ones for rooms they do not cover.
export function allCameras(scene: Scene): Camera[] {
  const ids = new Set(scene.cameras.map((c) => c.id))
  return [...scene.cameras, ...autoCameras(scene).filter((c) => !ids.has(c.id))]
}

export function findCamera(scene: Scene, id: string): Camera | undefined {
  return scene.cameras.find((c) => c.id === id) ?? (id.startsWith('room:') ? autoCameras(scene).find((c) => c.id === id) : undefined)
}
