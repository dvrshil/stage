import { findAsset } from './assets.ts'
import { area, bounds, centroid, pointInPolygon, roomElevation, roomHeight, type Point } from './geometry.ts'
import { footprintCorners, placeObjects, type Extent } from './objects.ts'
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
  return scene.cameras.find((c) => c.id === id) ?? (id.startsWith('room:') ? autoCameras(scene).find((c) => c.id === id) : id.startsWith('object:') ? frameCamera(scene, id) : undefined)
}

// --- Framing a thing: "object:<id>[:angle][:close]" is a camera that
// fills the frame with an object (and everything hung on it), an item, or
// a room, from a named side or a compass bearing. One function, so what
// the agent renders is what the person sees when told to look here.

export const ANGLES = ['front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left', 'top'] as const
const OFFSETS: Record<(typeof ANGLES)[number], number> = { front: 0, 'front-right': 45, right: 90, 'back-right': 135, back: 180, 'back-left': 225, left: 270, 'front-left': 315, top: 0 }
export const FRAME_FOV = 40

// The world box of a thing, and the way it faces.
export function targetBox(scene: Scene, id: string): { box: Extent; yaw: number; kind: 'object' | 'item' | 'room' } | undefined {
  const placed = placeObjects(scene)
  const own = placed.find((p) => p.object.id === id)
  if (own) {
    const box: Extent = { min: [...own.box.min] as Extent['min'], max: [...own.box.max] as Extent['max'] }
    const family = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const p of placed) {
        if (p.object.parent && family.has(p.object.parent) && !family.has(p.object.id)) {
          family.add(p.object.id)
          grew = true
        }
      }
    }
    for (const p of placed) {
      if (!family.has(p.object.id) || p.object.kind === 'group') continue
      for (let i = 0; i < 3; i++) {
        box.min[i] = Math.min(box.min[i], p.box.min[i])
        box.max[i] = Math.max(box.max[i], p.box.max[i])
      }
    }
    if (!Number.isFinite(box.min[0])) box.min = [own.position[0], own.position[1], own.position[2]], (box.max = [...box.min] as Extent['max'])
    return { box, yaw: own.yaw, kind: 'object' }
  }
  const item = scene.items.find((i) => i.id === id)
  if (item) {
    const info = findAsset(item.asset)
    const size = (info && !info.resizable ? info.size : (item.size ?? info?.size)) ?? [0.5, 0.5, 0.5]
    const room = scene.rooms.find((r) => r.id === item.room)
    const base = (room ? roomElevation(scene, room) : 0) + item.elevation
    const b = bounds(footprintCorners({ x: item.at[0], y: item.at[1], halfW: (size[0] * item.scale) / 2, halfD: (size[1] * item.scale) / 2, angle: (-item.facing * Math.PI) / 180 }))
    return { box: { min: [b.min[0], b.min[1], base], max: [b.max[0], b.max[1], base + size[2] * item.scale] }, yaw: item.facing, kind: 'item' }
  }
  const room = scene.rooms.find((r) => r.id === id)
  if (room) {
    const b = bounds(room.floor)
    const floor = roomElevation(scene, room)
    return { box: { min: [b.min[0], b.min[1], floor], max: [b.max[0], b.max[1], floor + (room.open ? 1 : roomHeight(scene, room))] }, yaw: 0, kind: 'room' }
  }
  return undefined
}

export function frameCamera(scene: Scene, spec: string): Camera | undefined {
  const [prefix, id, ...rest] = spec.split(':')
  if (prefix !== 'object' || !id) return undefined
  const target = targetBox(scene, id)
  if (!target) return undefined
  const close = rest.includes('close')
  const angle = rest.find((r) => r !== 'close')
  const { box, yaw } = target
  const center = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2]
  const radius = Math.max(0.05, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2)
  // Fill the frame: the box's half diagonal at the edge of the vertical
  // field of view, with a little air around it.
  const distance = (radius / Math.tan((FRAME_FOV * Math.PI) / 360)) * (close ? 0.9 : 1.25)
  let bearing: number
  let elevation: number
  if (angle === undefined) [bearing, elevation] = [yaw - 35, 22]
  else if (angle === 'top') [bearing, elevation] = [yaw, 84]
  else if ((ANGLES as readonly string[]).includes(angle)) [bearing, elevation] = [yaw + OFFSETS[angle as (typeof ANGLES)[number]], 15]
  else if (/^-?\d+(\.\d+)?$/.test(angle)) [bearing, elevation] = [Number(angle), 20]
  else return undefined
  const b = (bearing * Math.PI) / 180
  const e = (elevation * Math.PI) / 180
  const round = (n: number) => Math.round(n * 1000) / 1000
  const at: [number, number, number] = [center[0] + Math.sin(b) * Math.cos(e) * distance, center[1] + Math.cos(b) * Math.cos(e) * distance, Math.max(0.15, center[2] + Math.sin(e) * distance)]
  return { id: spec, type: 'perspective', at: at.map(round) as [number, number, number], look: center.map(round) as [number, number, number], fov: FRAME_FOV }
}

// A turntable: every side, the top, and a close three-quarter view.
export function turntable(scene: Scene, id: string): string[] {
  if (!targetBox(scene, id)) throw new Error(`nothing is called "${id}"; name an object, an item, or a room.`)
  return [...ANGLES.map((a) => `object:${id}:${a}`), `object:${id}:close`]
}
