import * as THREE from 'three'
import { alongWall, area, centroid, roomElevation, roomHeight, wallAngle, wallPieces, walls, type Point, type Wall } from '../core/geometry.ts'
import { DEFAULT_MATERIALS, MATERIALS } from '../core/materials.ts'
import type { Scene } from '../core/schema.ts'
import { buildItem, textSprite } from './furniture.ts'
import { textureSet } from './library.ts'
import { planks, speckle, tiles } from './textures.ts'

// Plan coordinates [x, y] (y north) become three.js [x, -z] with y up, so
// north is -z. Everything the agent writes is in plan terms; this file is
// the only place that knows about the renderer's axes.
export const toWorld = ([x, y]: Point, height = 0) => new THREE.Vector3(x, height, -y)

const EXTERIOR = new THREE.MeshStandardMaterial({ color: '#d6cfc2', roughness: 0.95 })
const GLASS = new THREE.MeshPhysicalMaterial({ color: '#cfe3ee', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28 })
const FRAME = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.5 })
const DOOR = new THREE.MeshStandardMaterial({ color: '#b08a62', roughness: 0.6 })
const TRIM = new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.45 })
const FIXTURE = new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff1d6', emissiveIntensity: 2.2, roughness: 0.4 })

// A photographed texture set, when downloaded. Every surface carries UVs
// in meters, so it lands at the size Poly Haven measured.
function photographed(spec: (typeof MATERIALS)[string]): THREE.MeshStandardMaterial | undefined {
  const set = textureSet(spec.texture)
  if (!set) return undefined
  return new THREE.MeshStandardMaterial({
    // Paint keeps its own color: only the plaster's relief and sheen show
    // through, the way paint on a real wall looks.
    color: spec.tint ? spec.color : '#ffffff',
    map: spec.tint ? null : set.color,
    normalMap: set.normal,
    // Poly Haven's "arm" packs ambient occlusion, roughness, and metalness
    // in red, green, and blue: the channels three.js reads for each.
    aoMap: set.arm,
    aoMapIntensity: spec.tint ? 0.4 : 0.8,
    roughnessMap: set.arm,
    roughness: 1,
    metalness: 0,
  })
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()
function material(name: string | undefined, fallback: string): THREE.MeshStandardMaterial {
  const key = name && MATERIALS[name] ? name : fallback
  let m = materialCache.get(key)
  if (!m) {
    const spec = MATERIALS[key]
    m = photographed(spec) ?? new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness ?? 0 })
    materialCache.set(key, m)
  }
  return m
}

// Floors: the photographed set, or a pattern drawn at its real size.
const floorCache = new Map<string, THREE.MeshStandardMaterial>()
function floorMaterial(name: string | undefined): THREE.MeshStandardMaterial {
  const key = name && MATERIALS[name] ? name : DEFAULT_MATERIALS.floor
  let m = floorCache.get(key)
  if (m) return m
  const spec = MATERIALS[key]
  m = photographed(spec)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ roughness: spec.roughness, metalness: spec.metalness ?? 0 })
    if (spec.pattern === 'planks') m.map = planks(spec.color)
    else if (spec.pattern === 'tiles') m.map = tiles(spec.color, spec.tile ?? 0.6)
    else if (spec.pattern === 'speckle') m.map = speckle(spec.color, 1)
    else m.color.set(spec.color)
  }
  floorCache.set(key, m)
  return m
}

// A box's UVs run 0 to 1 on every face; rescale them to meters so a
// texture repeats at its real size whatever the piece's dimensions.
function boxInMeters(width: number, height: number, depth: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const uv = geometry.attributes.uv
  // Faces in order: +x, -x, +y, -y, +z, -z, four vertices each.
  const spans: [number, number][] = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]]
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v
      uv.setXY(i, uv.getX(i) * spans[face][0], uv.getY(i) * spans[face][1])
    }
  }
  return geometry
}

// Built scenes are cached by material name, so a rebuild after an edit
// reuses textures already on the GPU; a new library means new materials.
export function resetMaterials() {
  materialCache.clear()
  floorCache.clear()
}

export interface Built {
  root: THREE.Group
  // Every entity's objects by id, for highlighting and focusing.
  entities: Map<string, THREE.Object3D>
  labels: THREE.Group
  // Ceilings and their lights: shown at eye level, hidden in the overviews
  // so a person can see into every room from above.
  indoor: THREE.Object3D[]
  sun?: THREE.DirectionalLight
}

export function buildScene(scene: Scene): Built {
  const root = new THREE.Group()
  const labels = new THREE.Group()
  const entities = new Map<string, THREE.Object3D>()
  const indoor: THREE.Object3D[] = []
  root.add(labels)

  for (const room of scene.rooms) {
    const group = new THREE.Group()
    group.name = room.id
    const elevation = roomElevation(scene, room)
    const shape = new THREE.Shape(room.floor.map(([x, y]) => new THREE.Vector2(x, y)))
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial(room.materials?.floor))
    // The shape is drawn in plan x/y; lay it down so plan y becomes -z.
    floor.rotation.x = -Math.PI / 2
    floor.position.y = elevation
    floor.receiveShadow = true
    group.add(floor)
    root.add(group)
    entities.set(room.id, group)

    // The ceiling is a thin slab, so it also shades the room from the sun.
    const height = roomHeight(scene, room)
    const ceiling = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }), material(room.materials?.ceiling, DEFAULT_MATERIALS.ceiling))
    ceiling.rotation.x = -Math.PI / 2
    ceiling.position.y = elevation + height
    ceiling.castShadow = true
    ceiling.receiveShadow = true
    group.add(ceiling)
    indoor.push(ceiling)

    // One ceiling light per room, brighter for bigger rooms.
    const [lx, ly] = centroid(room.floor)
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 32), FIXTURE)
    fixture.position.copy(toWorld([lx, ly], elevation + height - 0.02))
    group.add(fixture)
    indoor.push(fixture)
    const lamp = new THREE.PointLight('#ffe6c4', 5 * Math.sqrt(Math.max(4, area(room.floor))), 0, 2)
    lamp.position.copy(toWorld([lx, ly], elevation + height - 0.35))
    group.add(lamp)
    indoor.push(lamp)

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

  return { root, entities, labels, indoor, sun }
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
    const mesh = new THREE.Mesh(boxInMeters(length, height, wall.thickness), faces)
    const center = alongWall(wall, (piece.from - extendStart + piece.to + extendEnd) / 2)
    mesh.position.copy(toWorld(center, wall.elevation + piece.bottom + height / 2))
    mesh.rotation.y = angle
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (outward) mesh.userData.cutaway = { outward, bottom: piece.bottom, top: piece.top, base: wall.elevation }
    group.add(mesh)

    if (piece.bottom === 0 && piece.to - piece.from > 0.02) {
      // Baseboards, 8 cm, on each side that has a room. Local +z is the
      // plan's right side of a -> b.
      const across = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
      const middle = alongWall(wall, (piece.from + piece.to) / 2)
      for (const [room, sign] of [[rightRoom, 1], [leftRoom, -1]] as const) {
        if (!room) continue
        const board = new THREE.Mesh(new THREE.BoxGeometry(piece.to - piece.from, 0.08, 0.014), TRIM)
        board.position.copy(toWorld(middle, wall.elevation + 0.04)).addScaledVector(across, sign * (wall.thickness / 2 + 0.007))
        board.rotation.y = angle
        board.receiveShadow = true
        group.add(board)
      }
    }
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
    const sill = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.03, wall.thickness + 0.06), TRIM)
    sill.position.y = -0.015
    sill.receiveShadow = true
    group.add(sill)
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
    // A 7 cm casing on both faces, standing 1.5 cm proud of the wall.
    const depth = wall.thickness + 0.03
    const jamb = (x: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, opening.height + 0.07, depth), TRIM)
      mesh.position.set(x, (opening.height + 0.07) / 2, 0)
      mesh.castShadow = true
      group.add(mesh)
    }
    jamb(-width / 2 - 0.035)
    jamb(width / 2 + 0.035)
    const head = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, 0.07, depth), TRIM)
    head.position.set(0, opening.height + 0.035, 0)
    group.add(head)
    return group
  }

  return group
}
