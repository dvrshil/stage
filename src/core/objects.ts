import { findAsset } from './assets.ts'
import { bounds, roomElevation, type Point } from './geometry.ts'
import type { Scene, SceneObject } from './schema.ts'

// Where free objects stand in the world. Plan coordinates throughout: x
// east, y north, z up, meters and degrees. An object's own frame has its
// anchor (bottom center) at the origin and its front toward +y; `facing`
// turns it clockwise from north, `pitch` lifts the front, `roll` drops the
// right side, in that order. A child's frame is placed inside its parent's.
// The viewer applies the same three turns, so a box here and a box there
// are the same box.

export type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

const IDENTITY: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const rad = (deg: number) => (deg * Math.PI) / 180

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]
  return out
}

function apply(m: Mat3, [x, y, z]: Vec3): Vec3 {
  return [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z]
}

// Clockwise about z (north toward east), then front up about x, then
// right side down about y.
export function rotation(facing: number, pitch: number, roll: number): Mat3 {
  const [cf, sf] = [Math.cos(rad(facing)), Math.sin(rad(facing))]
  const [cp, sp] = [Math.cos(rad(pitch)), Math.sin(rad(pitch))]
  const [cr, sr] = [Math.cos(rad(roll)), Math.sin(rad(roll))]
  const yaw: Mat3 = [[cf, sf, 0], [-sf, cf, 0], [0, 0, 1]]
  const tilt: Mat3 = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]]
  const bank: Mat3 = [[cr, 0, sr], [0, 1, 0], [-sr, 0, cr]]
  return multiply(multiply(yaw, tilt), bank)
}

export interface Extent {
  min: Vec3
  max: Vec3
}

// The box an object fills in its own frame, before scale: anchor at the
// bottom center, so min z is 0 for everything that stands.
export function extent(object: SceneObject): Extent {
  const centered = (w: number, d: number, h: number): Extent => ({ min: [-w / 2, -d / 2, 0], max: [w / 2, d / 2, h] })
  switch (object.kind) {
    case 'box':
      return centered(...object.size)
    case 'sphere':
      return centered(object.radius * 2, object.radius * 2, object.radius * 2)
    case 'cylinder': {
      const r = Math.max(object.radius, object.top ?? object.radius)
      return centered(r * 2, r * 2, object.height)
    }
    case 'plane':
      return centered(object.size[0], object.size[1], 0)
    case 'extrude': {
      const b = bounds(object.polygon)
      return { min: [b.min[0], b.min[1], 0], max: [b.max[0], b.max[1], object.height] }
    }
    case 'model':
      return centered(...(object.size ?? [1, 1, 1]))
    case 'asset': {
      const info = findAsset(object.asset)
      const size = info && !info.resizable ? info.size : (object.size ?? info?.size ?? [0.5, 0.5, 0.5])
      return centered(...size)
    }
    case 'group':
      return { min: [0, 0, 0], max: [0, 0, 0] }
  }
}

export interface Placed {
  object: SceneObject
  index: number
  // The anchor in the world, and the frame it stands in.
  position: Vec3
  rotation: Mat3
  scale: Vec3
  // The sum of the turns about z down the chain; exact when `flat`.
  yaw: number
  // No pitch or roll anywhere up the chain: footprints are rectangles.
  flat: boolean
  extent: Extent
  // World-aligned box around the object alone (not its children).
  box: Extent
  // A plan rectangle for walking and overlap: the exact turned one when
  // flat, the aligned box otherwise.
  footprint: { x: number; y: number; halfW: number; halfD: number; angle: number }
  depth: number
}

const scaleOf = (s: number | Vec3): Vec3 => (typeof s === 'number' ? [s, s, s] : s)

// Every object with its world placement, parents before children. An
// object whose parent is missing, or part of a loop, stands in the world
// on its own; check reports that.
export function placeObjects(scene: Scene): Placed[] {
  const byId = new Map(scene.objects.map((o, index) => [o.id, { object: o, index }]))
  const rooms = new Map(scene.rooms.map((r) => [r.id, r]))
  const done = new Map<string, Placed>()
  const visiting = new Set<string>()
  const place = (id: string): Placed | undefined => {
    const found = done.get(id)
    if (found) return found
    const entry = byId.get(id)
    if (!entry || visiting.has(id)) return undefined
    visiting.add(id)
    const { object, index } = entry
    const parent = object.parent ? place(object.parent) : undefined
    visiting.delete(id)
    const room = object.room ? rooms.get(object.room) : undefined
    const local: Vec3 = [object.at[0], object.at[1], object.at[2] + (room && !parent ? roomElevation(scene, room) : 0)]
    const own = rotation(object.facing, object.pitch, object.roll)
    const ownScale = scaleOf(object.scale)
    let position = local
    let frame = own
    let scale = ownScale
    if (parent) {
      const offset = apply(parent.rotation, [local[0] * parent.scale[0], local[1] * parent.scale[1], local[2] * parent.scale[2]])
      position = [parent.position[0] + offset[0], parent.position[1] + offset[1], parent.position[2] + offset[2]]
      frame = multiply(parent.rotation, own)
      scale = [parent.scale[0] * ownScale[0], parent.scale[1] * ownScale[1], parent.scale[2] * ownScale[2]]
    }
    const flat = (parent?.flat ?? true) && object.pitch === 0 && object.roll === 0
    const yaw = (parent?.yaw ?? 0) + object.facing
    const ext = extent(object)
    const corners: Vec3[] = []
    for (const x of [ext.min[0], ext.max[0]]) for (const y of [ext.min[1], ext.max[1]]) for (const z of [ext.min[2], ext.max[2]]) {
      const p = apply(frame, [x * scale[0], y * scale[1], z * scale[2]])
      corners.push([position[0] + p[0], position[1] + p[1], position[2] + p[2]])
    }
    const box: Extent = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    for (const c of corners) for (let i = 0; i < 3; i++) {
      box.min[i] = Math.min(box.min[i], c[i])
      box.max[i] = Math.max(box.max[i], c[i])
    }
    let footprint: Placed['footprint']
    if (flat) {
      const cx = ((ext.min[0] + ext.max[0]) / 2) * scale[0]
      const cy = ((ext.min[1] + ext.max[1]) / 2) * scale[1]
      const center = apply(frame, [cx, cy, 0])
      footprint = { x: position[0] + center[0], y: position[1] + center[1], halfW: ((ext.max[0] - ext.min[0]) / 2) * scale[0], halfD: ((ext.max[1] - ext.min[1]) / 2) * scale[1], angle: -rad(yaw) }
    } else {
      footprint = { x: (box.min[0] + box.max[0]) / 2, y: (box.min[1] + box.max[1]) / 2, halfW: (box.max[0] - box.min[0]) / 2, halfD: (box.max[1] - box.min[1]) / 2, angle: 0 }
    }
    const placed: Placed = { object, index, position, rotation: frame, scale, yaw, flat, extent: ext, box, footprint, depth: parent ? parent.depth + 1 : 0 }
    done.set(id, placed)
    return placed
  }
  for (const object of scene.objects) place(object.id)
  return scene.objects.map((o) => done.get(o.id)!).filter(Boolean)
}

// The plan corners of every object's footprint, for the scene's bounds.
export function objectCorners(scene: Scene): Point[] {
  return placeObjects(scene).flatMap((p) => footprintCorners(p.footprint))
}

export function footprintCorners(r: { x: number; y: number; halfW: number; halfD: number; angle: number }): Point[] {
  const c = Math.cos(r.angle)
  const s = Math.sin(r.angle)
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([i, j]) => [r.x + i * r.halfW * c - j * r.halfD * s, r.y + i * r.halfW * s + j * r.halfD * c])
}

// Loops in `parent`, by the ids on them.
export function parentLoops(scene: Scene): string[] {
  const parents = new Map(scene.objects.map((o) => [o.id, o.parent]))
  const looped: string[] = []
  for (const start of parents.keys()) {
    const seen = new Set<string>()
    let at: string | undefined = start
    while (at && parents.has(at) && !seen.has(at)) {
      seen.add(at)
      at = parents.get(at)
    }
    if (at && seen.has(at) && at === start) looped.push(start)
  }
  return looped
}

export const round3 = (v: Vec3): Vec3 => v.map((n) => Math.round(n * 1000) / 1000) as Vec3
