import * as THREE from 'three'
import { findAsset } from '../core/assets.ts'
import { fitModel, hasModel, loadModel } from './library.ts'
import { contactShadow } from './textures.ts'

// Furniture built from primitives, by asset id. Each builder returns a group
// with its footprint centered on the origin, the floor at y = 0, and the
// front of the piece toward -z (north in plan), which is facing 0.
// Version 0.1 only; Milestone 1 swaps these for real glTF models.

type Builder = (size: [number, number, number]) => THREE.Group

const mat = (color: string, roughness = 0.8, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })

const FABRIC = mat('#6f7f8f', 0.95)
const FABRIC_WARM = mat('#a8836a', 0.95)
const WOOD = mat('#a07850', 0.6)
const WOOD_DARK = mat('#5a3d2b', 0.55)
const WHITE = mat('#f2f0ea', 0.4)
const METAL = mat('#8a8d91', 0.35, 0.8)
const BLACK = mat('#1c1d20', 0.3)
const LINEN = mat('#e8e2d6', 0.95)
const LEAF = mat('#3e6b3a', 0.85)
const POT = mat('#c4a484', 0.8)
const SHADE = new THREE.MeshStandardMaterial({ color: '#f4ead2', roughness: 0.9, emissive: '#ffe8b0', emissiveIntensity: 0.4 })

// A box whose bottom sits at `y`, centered on x and z.
function box(group: THREE.Group, material: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y + h / 2, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function cylinder(group: THREE.Group, material: THREE.Material, radiusTop: number, radiusBottom: number, h: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, 24), material)
  mesh.position.set(x, y + h / 2, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function legs(group: THREE.Group, material: THREE.Material, w: number, d: number, h: number, inset: number, thickness = 0.04) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(group, material, thickness, h, thickness, sx * (w / 2 - inset), 0, sz * (d / 2 - inset))
    }
  }
}

const sofa = (fabric: THREE.Material): Builder => ([w, d, h]) => {
  const g = new THREE.Group()
  const arm = 0.18
  box(g, WOOD_DARK, w - 0.1, 0.12, d - 0.1, 0, 0, 0)
  box(g, fabric, w - 2 * arm, 0.3, d * 0.75, 0, 0.12, -d * 0.1)
  box(g, fabric, w, h - 0.12, 0.22, 0, 0.12, d / 2 - 0.11)
  box(g, fabric, arm, 0.5, d, -(w / 2 - arm / 2), 0.12, 0)
  box(g, fabric, arm, 0.5, d, w / 2 - arm / 2, 0.12, 0)
  return g
}

const BUILDERS: Record<string, Builder> = {
  'sofa/three-seat': sofa(FABRIC),
  'sofa/two-seat': sofa(FABRIC_WARM),
  'chair/armchair': sofa(FABRIC_WARM),
  'chair/dining': ([w, d, h]) => {
    const g = new THREE.Group()
    legs(g, WOOD, w, d, 0.45, 0.03, 0.035)
    box(g, WOOD, w, 0.04, d, 0, 0.45, 0)
    box(g, WOOD, w, h - 0.49, 0.04, 0, 0.49, d / 2 - 0.02)
    return g
  },
  'table/dining-six': ([w, d, h]) => {
    const g = new THREE.Group()
    legs(g, WOOD_DARK, w, d, h - 0.04, 0.08, 0.06)
    box(g, WOOD, w, 0.04, d, 0, h - 0.04, 0)
    return g
  },
  'table/coffee': ([w, d, h]) => {
    const g = new THREE.Group()
    legs(g, WOOD_DARK, w, d, h - 0.04, 0.06)
    box(g, WOOD, w, 0.04, d, 0, h - 0.04, 0)
    return g
  },
  'table/desk': ([w, d, h]) => {
    const g = new THREE.Group()
    legs(g, METAL, w, d, h - 0.03, 0.05, 0.035)
    box(g, WHITE, w, 0.03, d, 0, h - 0.03, 0)
    return g
  },
  'bed/double': bed,
  'bed/single': bed,
  'plant/fiddle-leaf': ([w, , h]) => {
    const g = new THREE.Group()
    cylinder(g, POT, w * 0.32, w * 0.26, 0.35)
    cylinder(g, WOOD_DARK, 0.02, 0.025, h * 0.5, 0, 0.35)
    const leaves = new THREE.SphereGeometry(1, 16, 12)
    const spots: [number, number, number, number][] = [
      [0, h * 0.78, 0, w * 0.42],
      [w * 0.18, h * 0.65, w * 0.1, w * 0.3],
      [-w * 0.16, h * 0.68, -w * 0.12, w * 0.32],
      [w * 0.05, h * 0.92, -w * 0.05, w * 0.28],
    ]
    for (const [x, y, z, r] of spots) {
      const mesh = new THREE.Mesh(leaves, LEAF)
      mesh.position.set(x, y, z)
      mesh.scale.set(r, r * 0.85, r)
      mesh.castShadow = true
      g.add(mesh)
    }
    return g
  },
  'lamp/floor': ([w, , h]) => {
    const g = new THREE.Group()
    cylinder(g, METAL, w * 0.4, w * 0.45, 0.03)
    cylinder(g, METAL, 0.012, 0.012, h - 0.3, 0, 0.03)
    cylinder(g, SHADE, w * 0.32, w * 0.48, 0.3, 0, h - 0.3)
    return g
  },
  'kitchen/counter-two-meter': counter,
  'kitchen/island-two-meter': counter,
  'kitchen/wall-cabinets': wallCabinets,
  'person/standing': person,
  'kitchen/fridge': ([w, d, h]) => {
    const g = new THREE.Group()
    box(g, mat('#d9dcdf', 0.3, 0.4), w, h, d)
    box(g, METAL, 0.03, 0.5, 0.03, w / 2 - 0.08, h * 0.55, -d / 2 - 0.02)
    box(g, METAL, 0.03, 0.3, 0.03, w / 2 - 0.08, h * 0.2, -d / 2 - 0.02)
    box(g, mat('#bfc3c7', 0.4), w - 0.01, 0.01, 0.005, 0, h * 0.42, -d / 2 - 0.003)
    return g
  },
  'shelf/bookcase': ([w, d, h]) => {
    const g = new THREE.Group()
    const t = 0.025
    box(g, WOOD, t, h, d, -w / 2 + t / 2)
    box(g, WOOD, t, h, d, w / 2 - t / 2)
    box(g, WOOD, w, t, d, 0, h - t)
    box(g, WOOD, w, h, 0.012, 0, 0, d / 2 - 0.006)
    const shelves = 5
    const colors = ['#8c3b2f', '#2f4c6e', '#c8a24a', '#4d6b4a', '#6b4f7a', '#d9d2c1']
    for (let i = 0; i < shelves; i++) {
      const y = (i * (h - t)) / shelves
      box(g, WOOD, w - 2 * t, t, d, 0, y)
      // Books: a fixed pattern, so every render of the same scene matches.
      let x = -w / 2 + t + 0.02
      let k = i
      while (x < w / 2 - t - 0.08) {
        const bw = 0.03 + ((k * 7) % 4) * 0.008
        const bh = 0.2 + ((k * 5) % 5) * 0.025
        box(g, mat(colors[k % colors.length], 0.8), bw, Math.min(bh, (h - t) / shelves - 0.04), d * 0.8, x + bw / 2, y + t)
        x += bw + 0.004
        k++
      }
    }
    return g
  },
  'rug/area': ([w, d, h]) => {
    const g = new THREE.Group()
    const mesh = box(g, mat('#9b5d4a', 1), w, h, d)
    mesh.castShadow = false
    box(g, mat('#e3d2b8', 1), w - 0.2, h + 0.002, d - 0.2).castShadow = false
    return g
  },
  'tv/stand': ([w, d, h]) => {
    // A 55-inch screen: 1.22 by 0.69 m, 16:9, on a stand 45 cm high.
    const g = new THREE.Group()
    const stand = 0.45
    box(g, WOOD_DARK, w, stand, d)
    box(g, BLACK, 0.32, 0.02, 0.2, 0, stand, 0.05)
    box(g, BLACK, 0.05, 0.1, 0.03, 0, stand + 0.02, 0.06)
    const screenW = Math.min(1.22, w * 0.85)
    const screenH = (screenW * 9) / 16
    box(g, BLACK, screenW, screenH, 0.035, 0, Math.min(h - screenH, stand + 0.1), 0.06)
    box(g, new THREE.MeshStandardMaterial({ color: '#0b0d12', roughness: 0.08, metalness: 0.2 }), screenW - 0.02, screenH - 0.02, 0.002, 0, Math.min(h - screenH, stand + 0.1) + 0.01, 0.04)
    return g
  },
  'wardrobe/double': ([w, d, h]) => {
    const g = new THREE.Group()
    box(g, WHITE, w, h, d)
    box(g, mat('#d8d4cc', 0.5), 0.005, h - 0.1, 0.005, 0, 0.05, -d / 2 - 0.003)
    box(g, METAL, 0.02, 0.25, 0.02, -0.06, h * 0.5, -d / 2 - 0.015)
    box(g, METAL, 0.02, 0.25, 0.02, 0.06, h * 0.5, -d / 2 - 0.015)
    return g
  },
  'bath/toilet': ([w, d, h]) => {
    const g = new THREE.Group()
    box(g, WHITE, w * 0.9, 0.4, d * 0.65, 0, 0, -d * 0.1)
    box(g, WHITE, w, h - 0.4, 0.18, 0, 0.4, d / 2 - 0.09)
    return g
  },
  'bath/basin': ([w, d, h]) => {
    const g = new THREE.Group()
    box(g, WOOD, w, h - 0.12, d)
    box(g, WHITE, w, 0.12, d, 0, h - 0.12)
    box(g, METAL, 0.03, 0.18, 0.03, 0, h, d / 2 - 0.08)
    return g
  },
  'bath/tub': ([w, d, h]) => {
    const g = new THREE.Group()
    box(g, WHITE, w, h, d)
    box(g, mat('#dfe9ee', 0.1), w - 0.12, 0.01, d - 0.12, 0, h - 0.04)
    return g
  },
}

// A standing adult, 1.75 m, eyes at about 1.63 m: the scale figure that
// lets a viewer judge every other size at a glance. One matte finish, the
// way architects draw scale figures, so it reads as a measure rather than
// a character next to photographed furniture.
function person([, , h]: [number, number, number]): THREE.Group {
  const g = new THREE.Group()
  const k = h / 1.75
  const figure = mat('#d9d6d0', 0.55)
  const skin = figure
  const top = figure
  const trousers = figure
  const shoes = mat('#bdb9b2', 0.6)
  const hair = figure
  const capsule = (material: THREE.Material, radius: number, length: number, x: number, y: number, z = 0, tilt = 0, scaleZ = 1) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius * k, length * k, 6, 16), material)
    mesh.position.set(x * k, y * k, z * k)
    mesh.rotation.z = tilt
    mesh.scale.z = scaleZ
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }
  for (const side of [-1, 1]) {
    box(g, shoes, 0.1 * k, 0.07 * k, 0.26 * k, side * 0.1 * k, 0, -0.04 * k)
    capsule(trousers, 0.068, 0.72, side * 0.1, 0.07 + 0.068 + 0.36)
    capsule(top, 0.05, 0.46, side * 0.235, 1.15, 0, side * 0.08)
    capsule(skin, 0.042, 0.04, side * 0.255, 0.86, 0)
  }
  capsule(trousers, 0.16, 0.06, 0, 0.94, 0, 0, 0.7)
  capsule(top, 0.19, 0.3, 0, 1.22, 0, 0, 0.62)
  cylinder(g, skin, 0.05 * k, 0.055 * k, 0.09 * k, 0, 1.46 * k)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1 * k, 24, 16), skin)
  head.scale.set(0.92, 1.18, 1)
  head.position.set(0, 1.63 * k, 0)
  head.castShadow = true
  g.add(head)
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.106 * k, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair)
  hairCap.scale.set(0.94, 1.12, 1.04)
  hairCap.position.set(0, 1.645 * k, 0.012 * k)
  g.add(hairCap)
  return g
}

function bed([w, d, h]: [number, number, number]): THREE.Group {
  const g = new THREE.Group()
  box(g, WOOD, w, 0.3, d)
  box(g, LINEN, w - 0.06, 0.22, d - 0.1, 0, 0.3, 0.02)
  box(g, mat('#7d8fa3', 0.95), w - 0.04, 0.05, d * 0.6, 0, 0.52, -d * 0.18)
  box(g, WOOD, w, h, 0.06, 0, 0, d / 2 - 0.03)
  const pillows = w > 1.2 ? [-w / 4, w / 4] : [0]
  for (const x of pillows) box(g, WHITE, Math.min(0.6, w / pillows.length - 0.1), 0.12, 0.38, x, 0.52, d / 2 - 0.3)
  return g
}

function counter([w, d, h]: [number, number, number]): THREE.Group {
  const g = new THREE.Group()
  const plinth = 0.1
  box(g, mat('#2e2f33', 0.8), w - 0.04, plinth, d - 0.08, 0, 0, 0.04)
  box(g, mat('#e9e6df', 0.5), w, h - 0.04 - plinth, d - 0.02, 0, plinth, 0.01)
  const worktop = mat('#3c3f44', 0.3)
  box(g, worktop, w + 0.02, 0.04, d, 0, h - 0.04)
  const doors = Math.max(1, Math.round(w / 0.6))
  for (let i = 1; i < doors; i++) box(g, mat('#c9c5bc', 0.5), 0.004, h - 0.18 - plinth, 0.004, -w / 2 + (i * w) / doors, plinth + 0.04, -d / 2 + 0.01)
  for (let i = 0; i < doors; i++) box(g, METAL, 0.12, 0.012, 0.02, -w / 2 + ((i + 0.5) * w) / doors, h - 0.16, -d / 2 - 0.005)
  if (w >= 1.2 && d < 0.8) {
    // A sink on the left third, a hob on the right, tiles behind.
    box(g, mat('#b9bcc0', 0.25, 0.8), 0.5, 0.005, 0.4, -w / 4, h, -0.02)
    box(g, mat('#8d9094', 0.3, 0.8), 0.44, 0.006, 0.34, -w / 4, h + 0.001, -0.02)
    cylinder(g, METAL, 0.012, 0.012, 0.25, -w / 4, h, d / 2 - 0.08)
    box(g, METAL, 0.02, 0.02, 0.16, -w / 4, h + 0.23, d / 2 - 0.15)
    box(g, mat('#111214', 0.1), 0.58, 0.006, 0.5, w / 4, h, -0.02)
    for (const [x, z] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.1], [0.14, 0.1]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.004, 6, 32), mat('#3a3d42', 0.4))
      ring.rotation.x = -Math.PI / 2
      ring.position.set(w / 4 + x, h + 0.008, -0.02 + z)
      g.add(ring)
    }
    box(g, mat('#e6e2da', 0.3), w, 0.55, 0.012, 0, h, d / 2 - 0.006)
  }
  return g
}

function wallCabinets([w, d]: [number, number, number]): THREE.Group {
  const g = new THREE.Group()
  const bottom = 1.45
  const height = 0.7
  box(g, mat('#e9e6df', 0.5), w, height, d, 0, bottom)
  const doors = Math.max(1, Math.round(w / 0.5))
  for (let i = 1; i < doors; i++) box(g, mat('#c9c5bc', 0.5), 0.004, height - 0.04, 0.004, -w / 2 + (i * w) / doors, bottom + 0.02, -d / 2 - 0.001)
  for (let i = 0; i < doors; i++) box(g, METAL, 0.012, 0.1, 0.02, -w / 2 + ((i + 0.5) * w) / doors + (i % 2 ? -0.18 : 0.18) * (w / doors), bottom + 0.06, -d / 2 - 0.008)
  // Under-cabinet light on the worktop.
  box(g, new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#fff0d0', emissiveIntensity: 1.2 }), w - 0.1, 0.01, 0.03, 0, bottom - 0.01, -d / 2 + 0.05)
  return g
}

// A labeled box for an asset the library doesn't have, so the scene always
// builds and the agent can finish the layout before resolving the asset.
function placeholder(label: string, [w, d, h]: [number, number, number]): THREE.Group {
  const g = new THREE.Group()
  const mesh = box(g, new THREE.MeshStandardMaterial({ color: '#e0b84a', roughness: 0.8, transparent: true, opacity: 0.85 }), w, h, d)
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#7a5c10' }))
  edges.position.copy(mesh.position)
  g.add(edges)
  g.add(textSprite(label, h + 0.25))
  return g
}

export function textSprite(text: string, y: number, scale = 0.35): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const font = '600 48px system-ui, sans-serif'
  context.font = font
  const width = Math.ceil(context.measureText(text).width) + 40
  canvas.width = width
  canvas.height = 80
  context.font = font
  context.fillStyle = 'rgba(20, 20, 24, 0.82)'
  context.beginPath()
  context.roundRect(0, 0, width, 80, 16)
  context.fill()
  context.fillStyle = '#ffffff'
  context.textBaseline = 'middle'
  context.fillText(text, 20, 42)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }))
  sprite.scale.set((scale * width) / 80, scale, 1)
  sprite.position.y = y
  sprite.renderOrder = 10
  return sprite
}

// Pieces that rest on something else, or lie flat, cast no contact shadow.
const NO_CONTACT = new Set(['rug/area', 'kitchen/wall-cabinets'])

export function buildItem(asset: string, label: string, size?: [number, number, number]): THREE.Group {
  const info = findAsset(asset)
  const builder = BUILDERS[asset]
  const group = info && builder ? builder(info.size) : placeholder(label, size ?? [0.5, 0.5, 0.5])
  const [w, d] = info?.size ?? size ?? [0.5, 0.5, 0.5]
  if (info?.model && hasModel(info.model)) {
    // The primitive piece stands in until the model arrives, then steps
    // aside; glTF fronts face +z, so the default turn is half a circle.
    const stand = [...group.children]
    loadModel(info.model).then((model) => {
      if (!model) return
      for (const child of stand) group.remove(child)
      group.add(fitModel(model, info.size, info.yaw ?? 180))
    })
  }
  if (!NO_CONTACT.has(asset)) {
    // Interior lights cast no shadows (too slow), so a soft dark patch
    // under each piece keeps it from looking like it floats.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.25, d * 1.25),
      new THREE.MeshBasicMaterial({ map: contactShadow(), color: '#000000', transparent: true, opacity: asset.startsWith('person/') ? 0.3 : 0.4, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.004
    shadow.renderOrder = 1
    group.add(shadow)
  }
  return group
}
