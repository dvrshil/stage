import * as THREE from 'three'
import { alongWall, centroid, roomElevation, wallAngle, wallPieces, walls, type Point, type Wall } from '../core/geometry.ts'
import { DEFAULT_MATERIALS, MATERIALS } from '../core/materials.ts'
import type { Scene } from '../core/schema.ts'
import { buildItem, textSprite } from './furniture.ts'

// Plan coordinates [x, y] (y north) become three.js [x, -z] with y up, so
// north is -z. Everything the agent writes is in plan terms; this file is
// the only place that knows about the renderer's axes.
export const toWorld = ([x, y]: Point, height = 0) => new THREE.Vector3(x, height, -y)

const EXTERIOR = new THREE.MeshStandardMaterial({ color: '#d6cfc2', roughness: 0.95 })
const GLASS = new THREE.MeshPhysicalMaterial({ color: '#cfe3ee', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28 })
const FRAME = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.5 })
const DOOR = new THREE.MeshStandardMaterial({ color: '#b08a62', roughness: 0.6 })

const materialCache = new Map<string, THREE.MeshStandardMaterial>()
function material(name: string | undefined, fallback: string): THREE.MeshStandardMaterial {
  const key = name && MATERIALS[name] ? name : fallback
  let m = materialCache.get(key)
  if (!m) {
    const spec = MATERIALS[key]
    m = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness ?? 0 })
    materialCache.set(key, m)
  }
  return m
}

export interface Built {
  root: THREE.Group
  // Every entity's objects by id, for highlighting and focusing.
  entities: Map<string, THREE.Object3D>
  labels: THREE.Group
  sun?: THREE.DirectionalLight
}

export function buildScene(scene: Scene): Built {
  const root = new THREE.Group()
  const labels = new THREE.Group()
  const entities = new Map<string, THREE.Object3D>()
  root.add(labels)

  for (const room of scene.rooms) {
    const group = new THREE.Group()
    group.name = room.id
    const elevation = roomElevation(scene, room)
    const shape = new THREE.Shape(room.floor.map(([x, y]) => new THREE.Vector2(x, y)))
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), material(room.materials?.floor, DEFAULT_MATERIALS.floor))
    // The shape is drawn in plan x/y; lay it down so plan y becomes -z.
    floor.rotation.x = -Math.PI / 2
    floor.position.y = elevation
    floor.receiveShadow = true
    group.add(floor)
    root.add(group)
    entities.set(room.id, group)

    const [cx, cy] = centroid(room.floor)
    const label = textSprite(room.name ?? room.id, 0.05, 0.42)
    label.position.copy(toWorld([cx, cy], elevation + 0.05))
    label.userData.room = room.id
    labels.add(label)
  }

  const roomsById = new Map(scene.rooms.map((r) => [r.id, r]))
  for (const wall of walls(scene)) {
    const group = buildWall(wall, roomsById)
    root.add(group)
    for (const hole of wall.openings) {
      const opening = buildOpening(wall, hole)
      if (opening) group.add(opening)
      entities.set(hole.opening.id, opening ?? group)
    }
  }

  for (const item of scene.items) {
    const room = roomsById.get(item.room)
    const group = buildItem(item.asset, item.id, item.size)
    group.name = item.id
    group.scale.setScalar(item.scale)
    group.position.copy(toWorld(item.at, (room ? roomElevation(scene, room) : 0) + item.elevation))
    // Facing is clockwise from north; three.js rotates counterclockwise.
    group.rotation.y = -THREE.MathUtils.degToRad(item.facing)
    root.add(group)
    entities.set(item.id, group)
  }

  let sun: THREE.DirectionalLight | undefined
  const lights = scene.lights.length > 0 ? scene.lights : [{ id: 'default-sun', type: 'sun' as const, azimuth: 220, elevation: 35, intensity: 1 }]
  for (const light of lights) {
    if (light.type === 'sun') {
      sun = new THREE.DirectionalLight(light.color ?? '#fff4e0', 2.6 * light.intensity)
      const azimuth = THREE.MathUtils.degToRad(light.azimuth)
      const elevation = THREE.MathUtils.degToRad(light.elevation)
      // Azimuth is the compass direction the sun is in, clockwise from north.
      sun.position.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)).multiplyScalar(30)
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.bias = -0.0004
      sun.shadow.normalBias = 0.02
      root.add(sun)
      root.add(sun.target)
      entities.set(light.id, sun)
    } else {
      const point = new THREE.PointLight(light.color ?? '#ffe2b8', 6 * light.intensity, 8, 1.6)
      const [x, y, z] = light.at ?? [0, 0, 2.4]
      point.position.copy(toWorld([x, y], z))
      point.castShadow = true
      root.add(point)
      entities.set(light.id, point)
    }
  }

  return { root, entities, labels, sun }
}

// One box per solid piece, with a material per face: the room's wall paint
// on each room side and the exterior finish outside.
function buildWall(wall: Wall, rooms: Map<string, Scene['rooms'][number]>): THREE.Group {
  const group = new THREE.Group()
  group.name = wall.id
  const angle = wallAngle(wall)
  // Which room is on the left (+normal) side of the wall, looking from a to b.
  const normal: Point = [-(wall.b[1] - wall.a[1]) / wall.length, (wall.b[0] - wall.a[0]) / wall.length]
  const mid = alongWall(wall, wall.length / 2)
  let leftRoom: string | undefined
  let rightRoom: string | undefined
  for (const id of wall.rooms) {
    const room = rooms.get(id)
    if (!room) continue
    const [cx, cy] = centroid(room.floor)
    const side = (cx - mid[0]) * normal[0] + (cy - mid[1]) * normal[1]
    if (side > 0) leftRoom = id
    else rightRoom = id
  }
  const paint = (id: string | undefined) => (id ? material(rooms.get(id)?.materials?.walls, DEFAULT_MATERIALS.walls) : EXTERIOR)
  const left = paint(leftRoom)
  const right = paint(rightRoom)
  // For the dollhouse cutaway: the side with no room is outside. In world
  // space the plan's left normal (-dy, dx) becomes (-dy, 0, -dx).
  const outward = wall.exterior ? (leftRoom ? new THREE.Vector3(normal[0], 0, -normal[1]).negate() : new THREE.Vector3(normal[0], 0, -normal[1])) : undefined

  for (const piece of wallPieces(wall)) {
    // Pieces at either end of the wall reach half a thickness past it, so
    // corners close without gaps.
    const extendStart = piece.from <= 1e-6 ? wall.thickness / 2 : 0
    const extendEnd = piece.to >= wall.length - 1e-6 ? wall.thickness / 2 : 0
    const length = piece.to - piece.from + extendStart + extendEnd
    const height = piece.top - piece.bottom
    if (length <= 1e-4 || height <= 1e-4) continue
    // Local box axes: x along the wall, y up, z across it. In world space
    // local +z points to the plan's right side of a -> b.
    const faces = [EXTERIOR, EXTERIOR, EXTERIOR, EXTERIOR, right, left]
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, wall.thickness), faces)
    const center = alongWall(wall, (piece.from - extendStart + piece.to + extendEnd) / 2)
    mesh.position.copy(toWorld(center, wall.elevation + piece.bottom + height / 2))
    mesh.rotation.y = angle
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (outward) mesh.userData.cutaway = { outward, bottom: piece.bottom, top: piece.top, base: wall.elevation }
    group.add(mesh)
  }
  return group
}

// The height exterior walls drop to when they face the camera.
export const CUTAWAY_HEIGHT = 0.9

// Lowers the outside walls between the camera and the rooms, the way a
// dollhouse opens, so an overview shows every room. Off for plan and eye-level views.
export function applyCutaway(root: THREE.Object3D, camera: THREE.Camera, enabled: boolean) {
  const toCamera = new THREE.Vector3()
  root.traverse((object) => {
    const cut = object.userData.cutaway as { outward: THREE.Vector3; bottom: number; top: number; base: number } | undefined
    if (!cut || !(object instanceof THREE.Mesh)) return
    toCamera.subVectors(camera.position, object.position).setY(0).normalize()
    const facing = enabled && cut.outward.dot(toCamera) > 0.15
    const top = facing ? Math.min(cut.top, CUTAWAY_HEIGHT) : cut.top
    const height = top - cut.bottom
    object.visible = height > 0.01
    if (!object.visible) return
    object.scale.y = height / (cut.top - cut.bottom)
    object.position.y = cut.base + cut.bottom + height / 2
  })
}

function buildOpening(wall: Wall, hole: Wall['openings'][number]): THREE.Object3D | undefined {
  const { opening } = hole
  const group = new THREE.Group()
  group.name = opening.id
  const width = hole.to - hole.from
  const center = alongWall(wall, (hole.from + hole.to) / 2)
  group.position.copy(toWorld(center, wall.elevation + hole.bottom))
  group.rotation.y = wallAngle(wall)

  if (opening.type === 'window') {
    const frame = 0.05
    const glass = new THREE.Mesh(new THREE.BoxGeometry(width - frame, opening.height - frame, 0.01), GLASS)
    glass.position.y = opening.height / 2
    group.add(glass)
    const bar = (w: number, h: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), FRAME)
      mesh.position.set(x, y, 0)
      mesh.castShadow = true
      group.add(mesh)
    }
    bar(width, frame, 0, frame / 2)
    bar(width, frame, 0, opening.height - frame / 2)
    bar(frame, opening.height, -width / 2 + frame / 2, opening.height / 2)
    bar(frame, opening.height, width / 2 - frame / 2, opening.height / 2)
    bar(0.03, opening.height, 0, opening.height / 2)
    return group
  }

  if (opening.type === 'door') {
    // Hinged on one side and standing open, so a walk-through can pass.
    const hingeLeft = opening.swing?.endsWith('left') ?? true
    const inward = opening.swing?.startsWith('in') ?? true
    const hinge = new THREE.Group()
    hinge.position.x = hingeLeft ? -width / 2 : width / 2
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width - 0.02, opening.height - 0.01, 0.04), DOOR)
    leaf.position.set(hingeLeft ? width / 2 : -width / 2, opening.height / 2, 0)
    leaf.castShadow = true
    hinge.add(leaf)
    const sign = (hingeLeft ? 1 : -1) * (inward ? 1 : -1)
    hinge.rotation.y = sign * THREE.MathUtils.degToRad(70)
    group.add(hinge)
    return group
  }

  return group
}
