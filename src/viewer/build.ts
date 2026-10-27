import * as THREE from 'three'
import { alongWall, area, bounds, centroid, distanceToSegment, levelsByElevation, pointInPolygon, roomElevation, roomHeight, wallAngle, wallPieces, walls, type Point, type Wall } from '../core/geometry.ts'
import { FIXTURES, findAsset } from '../core/assets.ts'
import { DEFAULT_MATERIALS, MATERIALS } from '../core/materials.ts'
import type { Scene } from '../core/schema.ts'
import { floorToFloor } from '../core/walk.ts'
import { buildItem, textSprite } from './furniture.ts'
import { fitModel, hasModel, loadModel, textureSet } from './library.ts'
import { boxInMeters, planks, speckle, tiles } from './textures.ts'

// Plan coordinates [x, y] (y north) become three.js [x, -z] with y up, so
// north is -z. Everything the agent writes is in plan terms; this file is
// the only place that knows about the renderer's axes.
export const toWorld = ([x, y]: Point, height = 0) => new THREE.Vector3(x, height, -y)

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
    color: spec.tint ? spec.color : (spec.shade ?? '#ffffff'),
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
export function material(name: string | undefined, fallback: string): THREE.MeshStandardMaterial {
  const key = name && MATERIALS[name] ? name : fallback
  let m = materialCache.get(key)
  if (!m) {
    const spec = MATERIALS[key]
    m = photographed(spec) ?? new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness ?? 0 })
    materialCache.set(key, m)
  }
  return m
}

// Floors: the photographed set, or a pattern drawn at its real size. Seen
// from both sides, so a terrace over an open porch has an underside.
const floorCache = new Map<string, THREE.MeshStandardMaterial>()
export function floorMaterial(name: string | undefined, fallback = DEFAULT_MATERIALS.floor): THREE.MeshStandardMaterial {
  const key = name && MATERIALS[name] ? name : fallback
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
  m.side = THREE.DoubleSide
  floorCache.set(key, m)
  return m
}

function lit(material: THREE.Material): THREE.Material {
  const glowing = material.clone() as THREE.MeshStandardMaterial
  glowing.emissive = new THREE.Color('#fff1d8')
  glowing.emissiveIntensity = 1.6
  return glowing
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
  // The drawing under each level's plan view, by level id.
  overlays: Map<string, THREE.Object3D>
  sun?: THREE.DirectionalLight
}

export interface BuildOptions {
  // Turns a file named in the scene (a plan image) into a URL.
  fileUrl?: (relative: string) => string
}

// Lays a floor polygon's UVs in meters.
function floorShape(floor: Point[]): THREE.Shape {
  return new THREE.Shape(floor.map(([x, y]) => new THREE.Vector2(x, y)))
}

export function buildScene(scene: Scene, options: BuildOptions = {}): Built {
  const root = new THREE.Group()
  const labels = new THREE.Group()
  const entities = new Map<string, THREE.Object3D>()
  const indoor: THREE.Object3D[] = []
  const overlays = new Map<string, THREE.Object3D>()
  root.add(labels)
  const levels = levelsByElevation(scene)
  const levelIndex = (id: string) => Math.max(0, levels.findIndex((l) => l.id === id))
  const lowest = levels[0]?.id

  for (const room of scene.rooms) {
    const group = new THREE.Group()
    group.name = room.id
    group.userData.level = levelIndex(room.level)
    const elevation = roomElevation(scene, room)
    const level = levels.find((l) => l.id === room.level)
    const shape = floorShape(room.floor)
    if (!room.well) {
      const slab = room.level === lowest || elevation <= 0.05 ? 0 : (level?.slab ?? 0)
      const finish = floorMaterial(room.materials?.floor, room.open ? DEFAULT_MATERIALS.ground : DEFAULT_MATERIALS.floor)
      if (slab > 0) {
        // Upper floors are slabs: a terrace over a porch has an underside
        // and an edge, plastered like a ceiling.
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: slab, bevelEnabled: false })
        const underside = material(DEFAULT_MATERIALS.ceiling, DEFAULT_MATERIALS.ceiling)
        const floor = new THREE.Mesh(geometry, [finish, underside])
        // ExtrudeGeometry: group 0 is the caps, 1 the sides. Both caps get
        // the finish; the top is what shows.
        floor.rotation.x = -Math.PI / 2
        floor.position.y = elevation - slab
        floor.castShadow = true
        floor.receiveShadow = true
        group.add(floor)
      } else {
        const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), finish)
        // The shape is drawn in plan x/y; lay it down so plan y becomes -z.
        floor.rotation.x = -Math.PI / 2
        floor.position.y = elevation
        floor.receiveShadow = true
        group.add(floor)
      }
    }
    root.add(group)
    entities.set(room.id, group)

    const height = roomHeight(scene, room)
    if (!room.open && room.ceiling) {
      // A thin ceiling just under the slab above, so the room's own paint
      // shows from inside and the slab's underside from an open porch.
      const ceiling = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.01, bevelEnabled: false }), material(room.materials?.ceiling, DEFAULT_MATERIALS.ceiling))
      ceiling.rotation.x = -Math.PI / 2
      ceiling.position.y = elevation + height - 0.012
      ceiling.castShadow = true
      ceiling.receiveShadow = true
      group.add(ceiling)
      indoor.push(ceiling)

      // Ceiling lights: one, or a grid of them in a big room.
      for (const [lx, ly] of lightSpots(room.floor)) {
        const fixture = new THREE.Group()
        fixture.position.copy(toWorld([lx, ly], elevation))
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 32), FIXTURE)
        disc.position.y = height - 0.03
        fixture.add(disc)
        group.add(fixture)
        indoor.push(fixture)
        // A globe pendant once downloaded, its glass at 2.15 m so nobody
        // walks into it; any cord longer than that disappears into the ceiling.
        const globeBottom = Math.min(2.15, height - 0.45)
        if (hasModel(FIXTURES.ceilingLamp)) {
          loadModel(FIXTURES.ceilingLamp).then((model) => {
            if (!model) return
            fixture.remove(disc)
            const pendant = fitModel(model, [0.43, 0.43, 0.95], 0)
            pendant.position.y = globeBottom
            // The globe glows: it is the light. Its material is cloned, so
            // the glow stays on lit fixtures and off the shared model.
            pendant.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return
              object.castShadow = false
              const glows = (m: THREE.Material) => /glass|globe/i.test(m.name)
              object.material = Array.isArray(object.material)
                ? object.material.map((m) => (glows(m) ? lit(m) : m))
                : glows(object.material) ? lit(object.material) : object.material
            })
            fixture.add(pendant)
          })
        }
        const share = area(room.floor) / lightSpots(room.floor).length
        const lamp = new THREE.PointLight('#ffe6c4', 5 * Math.sqrt(Math.max(4, share)), 0, 2)
        lamp.position.copy(toWorld([lx, ly], elevation + (hasModel(FIXTURES.ceilingLamp) ? globeBottom + 0.2 : height - 0.35)))
        group.add(lamp)
        indoor.push(lamp)
      }
    }

    const [cx, cy] = centroid(room.floor)
    const label = textSprite(room.name ?? room.id, 0.05, 0.42)
    label.position.copy(toWorld([cx, cy], elevation + 0.05))
    label.userData.room = room.id
    label.userData.level = group.userData.level
    labels.add(label)
  }

  // The drawing under each level, for the plan view.
  for (const level of levels) {
    if (!level.plan || !options.fileUrl) continue
    const plan = level.plan
    const texture = new THREE.TextureLoader().load(options.fileUrl(plan.image), (loaded) => {
      const w = loaded.image.width / plan.scale
      const h = loaded.image.height / plan.scale
      mesh.geometry.dispose()
      mesh.geometry = new THREE.PlaneGeometry(w, h)
      // The image's top-left pixel lands at plan [-ox, +oy] over its scale.
      mesh.position.copy(toWorld([-plan.origin[0] / plan.scale + w / 2, plan.origin[1] / plan.scale - h / 2], level.elevation + 0.03))
    })
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: plan.opacity, depthWrite: false }))
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = 2
    mesh.visible = false
    mesh.userData.level = levelIndex(level.id)
    root.add(mesh)
    overlays.set(level.id, mesh)
  }

  const roomsById = new Map(scene.rooms.map((r) => [r.id, r]))
  for (const wall of walls(scene)) {
    const group = buildWall(wall, roomsById, (id) => roomElevation(scene, roomsById.get(id)!))
    const level = levels.filter((l) => l.elevation <= wall.elevation + 0.02).at(-1) ?? levels[0]
    group.userData.level = levelIndex(level.id)
    root.add(group)
    for (const hole of wall.openings) {
      const opening = buildOpening(wall, hole)
      if (opening) group.add(opening)
      entities.set(hole.opening.id, opening ?? group)
    }
  }

  for (const item of scene.items) {
    const room = roomsById.get(item.room)
    const info = findAsset(item.asset)
    const rise = info?.category === 'stairs' ? (item.size?.[2] ?? (room ? floorToFloor(scene, room.level) : info.size[2])) : undefined
    const group = buildItem(item.asset, item.id, item.size, { rise })
    group.name = item.id
    group.userData.level = room ? levelIndex(room.level) : 0
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
      sun.position.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)).multiplyScalar(60)
      sun.castShadow = true
      sun.shadow.mapSize.set(4096, 4096)
      sun.shadow.bias = -0.0004
      sun.shadow.normalBias = 0.03
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

  return { root, entities, labels, indoor, overlays, sun }
}

// Where a room's ceiling lights go: its center, or a grid about 4.5 m
// apart in a big room, keeping only spots inside the floor.
function lightSpots(floor: Point[]): Point[] {
  const b = bounds(floor)
  const w = b.max[0] - b.min[0]
  const d = b.max[1] - b.min[1]
  const cols = Math.max(1, Math.round(w / 4.5))
  const rows = Math.max(1, Math.round(d / 4.5))
  if (cols === 1 && rows === 1) return [centroid(floor)]
  const spots: Point[] = []
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const p: Point = [b.min[0] + ((i + 0.5) * w) / cols, b.min[1] + ((j + 0.5) * d) / rows]
      if (pointInPolygon(p, floor)) spots.push(p)
    }
  }
  return spots.length > 0 ? spots : [centroid(floor)]
}

// One box per solid piece, with a material per face: the room's wall paint
// on each room side and the exterior finish outside.
function buildWall(wall: Wall, rooms: Map<string, Scene['rooms'][number]>, floorOf: (id: string) => number): THREE.Group {
  const group = new THREE.Group()
  group.name = wall.id
  const angle = wallAngle(wall)
  const exterior = material(DEFAULT_MATERIALS.exterior, DEFAULT_MATERIALS.exterior)
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
  const paint = (id: string | undefined) => {
    const room = id ? rooms.get(id) : undefined
    return room && !room.open ? material(room.materials?.walls, DEFAULT_MATERIALS.walls) : exterior
  }
  const left = paint(leftRoom)
  const right = paint(rightRoom)
  // For the dollhouse cutaway: the side with no closed room is outside.
  const closedLeft = leftRoom && !rooms.get(leftRoom)?.open
  const closedRight = rightRoom && !rooms.get(rightRoom)?.open
  const outward: Point | undefined = closedLeft && closedRight ? undefined : closedLeft ? [-normal[0], -normal[1]] : [normal[0], normal[1]]
  group.userData.wall = { a: wall.a, b: wall.b, half: wall.thickness / 2, base: wall.elevation, height: wall.height, outward: wall.exterior || !closedLeft || !closedRight ? outward : undefined } satisfies WallInfo

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
    const faces = [exterior, exterior, exterior, exterior, right, left]
    const mesh = new THREE.Mesh(boxInMeters(length, height, wall.thickness), faces)
    const center = alongWall(wall, (piece.from - extendStart + piece.to + extendEnd) / 2)
    mesh.position.copy(toWorld(center, wall.elevation + piece.bottom + height / 2))
    mesh.rotation.y = angle
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.cutaway = { bottom: piece.bottom, top: piece.top, base: wall.elevation }
    group.add(mesh)

    if (piece.bottom === 0 && piece.to - piece.from > 0.02 && wall.height > 1.5) {
      // Baseboards, 8 cm, on each side that has a room. Local +z is the
      // plan's right side of a -> b.
      const across = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
      const middle = alongWall(wall, (piece.from + piece.to) / 2)
      for (const [room, sign] of [[rightRoom, 1], [leftRoom, -1]] as const) {
        if (!room || rooms.get(room)?.open) continue
        const floor = Math.max(wall.elevation, floorOf(room))
        const board = new THREE.Mesh(new THREE.BoxGeometry(piece.to - piece.from, 0.08, 0.014), TRIM)
        board.position.copy(toWorld(middle, floor + 0.04)).addScaledVector(across, sign * (wall.thickness / 2 + 0.007))
        board.rotation.y = angle
        board.receiveShadow = true
        group.add(board)
      }
    }
  }
  return group
}

// The height exterior walls drop to when they face the camera from outside.
export const CUTAWAY_HEIGHT = 0.9

interface WallInfo {
  a: Point
  b: Point
  half: number
  base: number
  height: number
  outward?: Point
}

// Gets walls out of the camera's way, by where the camera is rather than
// which view is chosen:
// - a camera inside a wall, or touching it, hides that wall, so nothing is
//   ever seen sliced open;
// - from outside, an exterior wall facing the camera within 1.5 m is
//   hidden, so you look straight into the room;
// - from farther outside, walls facing the camera drop to waist height,
//   the way a dollhouse opens, and the rest of the house stays standing.
// Openings and trim go with their wall. Walking never triggers the first
// two: a person keeps 20 cm from every wall face. The dollhouse rules run
// only in the overview; a camera the scene places outside sees the whole
// facade. Walls on levels above `cap` stay hidden.
export function applyCutaway(root: THREE.Object3D, camera: THREE.Camera, outside: boolean, touching: boolean, dollhouse: boolean, cap = Infinity) {
  const eye: Point = [camera.position.x, -camera.position.z]
  for (const group of root.children) {
    const w = group.userData.wall as WallInfo | undefined
    if (!w) continue
    if ((group.userData.level ?? 0) > cap) {
      group.visible = false
      continue
    }
    let mode: 'full' | 'cut' | 'hidden' = 'full'
    if (touching || dollhouse) {
      const level = camera.position.y > w.base - 0.3 && camera.position.y < w.base + w.height + 0.3
      const gap = distanceToSegment(eye, w.a, w.b) - w.half
      if (touching && gap < 0.15 && level) mode = 'hidden'
      else if (dollhouse && outside && w.outward) {
        const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]
        const dx = eye[0] - mid[0]
        const dy = eye[1] - mid[1]
        const facing = (w.outward[0] * dx + w.outward[1] * dy) / (Math.hypot(dx, dy) || 1) > 0.15
        // Only walls near the camera's own height open up: looking down
        // on a house from above, the whole facade stands.
        const near = camera.position.y < w.base + w.height + 2.5
        if (facing && near) mode = gap < 1.5 && level ? 'hidden' : 'cut'
      }
    }
    group.visible = mode !== 'hidden'
    if (mode === 'hidden') continue
    for (const child of group.children) {
      const cut = child.userData.cutaway as { bottom: number; top: number; base: number } | undefined
      if (child.userData.opening) {
        child.visible = mode === 'full'
        continue
      }
      if (!cut) continue
      const top = mode === 'cut' ? Math.min(cut.top, CUTAWAY_HEIGHT) : cut.top
      const height = top - cut.bottom
      child.visible = height > 0.01
      if (!child.visible) continue
      child.scale.y = height / (cut.top - cut.bottom)
      child.position.y = cut.base + cut.bottom + height / 2
    }
  }
}

function buildOpening(wall: Wall, hole: Wall['openings'][number]): THREE.Object3D | undefined {
  const { opening } = hole
  const group = new THREE.Group()
  group.name = opening.id
  group.userData.opening = true
  const width = hole.to - hole.from
  const height = hole.top - hole.bottom
  const center = alongWall(wall, (hole.from + hole.to) / 2)
  group.position.copy(toWorld(center, wall.elevation + hole.bottom))
  group.rotation.y = wallAngle(wall)

  if (opening.type === 'window') {
    const frame = 0.05
    const glass = new THREE.Mesh(new THREE.BoxGeometry(width - frame, height - frame, 0.01), GLASS)
    glass.position.y = height / 2
    group.add(glass)
    const bar = (w: number, h: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), FRAME)
      mesh.position.set(x, y, 0)
      mesh.castShadow = true
      group.add(mesh)
    }
    bar(width, frame, 0, frame / 2)
    bar(width, frame, 0, height - frame / 2)
    bar(frame, height, -width / 2 + frame / 2, height / 2)
    bar(frame, height, width / 2 - frame / 2, height / 2)
    // Mullions every meter or so, so a wide window reads as panes.
    const panes = Math.max(1, Math.round(width / 0.9))
    for (let i = 1; i < panes; i++) bar(0.03, height, -width / 2 + (i * width) / panes, height / 2)
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
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width - 0.02, height - 0.01, 0.04), DOOR)
    leaf.position.set(hingeLeft ? width / 2 : -width / 2, height / 2, 0)
    leaf.castShadow = true
    hinge.add(leaf)
    const sign = (hingeLeft ? 1 : -1) * (inward ? 1 : -1)
    hinge.rotation.y = sign * THREE.MathUtils.degToRad(70)
    group.add(hinge)
    // A 7 cm casing on both faces, standing 1.5 cm proud of the wall.
    const depth = wall.thickness + 0.03
    const jamb = (x: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, height + 0.07, depth), TRIM)
      mesh.position.set(x, (height + 0.07) / 2, 0)
      mesh.castShadow = true
      group.add(mesh)
    }
    jamb(-width / 2 - 0.035)
    jamb(width / 2 + 0.035)
    const head = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, 0.07, depth), TRIM)
    head.position.set(0, height + 0.035, 0)
    group.add(head)
    return group
  }

  return group
}
