import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { EMPTY_LOCK, type Lock } from '../core/library.ts'

// The downloaded CC0 assets, as the server reports them. Everything here is
// optional: a missing texture set falls back to the pattern drawn in code.

let lock: Lock = EMPTY_LOCK
const pending: Promise<unknown>[] = []
const textureSets = new Map<string, TextureSet>()

export interface TextureSet {
  color: THREE.Texture
  normal: THREE.Texture
  arm: THREE.Texture
}

export async function loadLibrary(): Promise<void> {
  try {
    lock = (await (await fetch('./api/library', { cache: 'no-store' })).json()) as Lock
  } catch {
    lock = EMPTY_LOCK
  }
}

// Resolves once every texture and sky requested so far has loaded, so a
// headless render never captures a half-textured frame.
export async function settled(): Promise<void> {
  await Promise.allSettled(pending)
}

const loader = new THREE.TextureLoader()
function load(file: string, color: boolean, size: [number, number]): THREE.Texture {
  let done: () => void = () => {}
  pending.push(new Promise<void>((resolve) => (done = resolve)))
  const texture = loader.load(`./library/${file}`, () => done(), undefined, () => done())
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // Every surface carries UVs in meters, so one repeat spans the texture's
  // real size, and a plank is as wide as the photographed plank.
  texture.repeat.set(1 / size[0], 1 / size[1])
  texture.anisotropy = 8
  return texture
}

export function textureSet(id: string | undefined): TextureSet | undefined {
  if (!id) return undefined
  const entry = lock.textures[id]
  if (!entry) return undefined
  let set = textureSets.get(id)
  if (!set) {
    set = {
      color: load(entry.maps.color.file, true, entry.size),
      normal: load(entry.maps.normal.file, false, entry.size),
      arm: load(entry.maps.arm.file, false, entry.size),
    }
    textureSets.set(id, set)
  }
  return set
}

export interface Sky {
  texture: THREE.DataTexture
  // The sun's direction around the vertical, as an angle in three.js's
  // equirectangular convention (atan2 of z over x).
  sunAngle: number
}

export function loadSky(id: string): Promise<Sky | undefined> {
  const entry = lock.skies[id]
  if (!entry) return Promise.resolve(undefined)
  const task = new HDRLoader()
    .setDataType(THREE.FloatType)
    .loadAsync(`./library/${entry.hdr.file}`)
    .then((texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      const sunAngle = findSun(texture)
      tameSun(texture)
      return { texture, sunAngle }
    })
    .catch(() => undefined)
  pending.push(task)
  return task
}

// The brightest pixel above the horizon is the sun.
function findSun(texture: THREE.DataTexture): number {
  const { data, width, height } = texture.image as unknown as { data: Float32Array; width: number; height: number }
  let best = -1
  let bestX = 0
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      if (luminance > best) {
        best = luminance
        bestX = x
      }
    }
  }
  return ((bestX + 0.5) / width - 0.5) * Math.PI * 2
}

// The photographed sun is brighter than a half float can hold (65,504), so
// lighting built from it fills with infinities and renders black. The
// scene's own sun light already carries the sun; the sky keeps its glow.
const SKY_LIMIT = 64
function tameSun(texture: THREE.DataTexture) {
  const data = (texture.image as unknown as { data: Float32Array }).data
  for (let i = 0; i < data.length; i++) if (data[i] > SKY_LIMIT) data[i] = SKY_LIMIT
  texture.needsUpdate = true
}

const gltfLoader = new GLTFLoader()
const models = new Map<string, Promise<THREE.Object3D | undefined>>()

export function hasModel(id: string | undefined): boolean {
  return !!id && !!lock.models?.[id]
}

// Each model loads once; every placement clones it, sharing its geometry
// and textures on the GPU.
export function loadModel(id: string): Promise<THREE.Object3D | undefined> {
  const entry = lock.models?.[id]
  if (!entry) return Promise.resolve(undefined)
  let task = models.get(id)
  if (!task) {
    task = gltfLoader
      .loadAsync(`./library/${entry.gltf.file}`)
      .then((gltf) => {
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true
            object.receiveShadow = true
          }
        })
        return gltf.scene as THREE.Object3D
      })
      .catch(() => undefined)
    models.set(id, task)
    pending.push(task)
  }
  return task
}

// A clone of the model turned by `yaw` degrees, scaled to fit `size`
// ([width, depth, height] in meters), centered, and standing on y = 0.
export function fitModel(model: THREE.Object3D, size: [number, number, number], yaw: number): THREE.Group {
  const holder = new THREE.Group()
  const instance = model.clone(true)
  instance.rotation.y = THREE.MathUtils.degToRad(yaw)
  holder.add(instance)
  holder.updateMatrixWorld(true)
  let box = new THREE.Box3().setFromObject(holder)
  const measured = box.getSize(new THREE.Vector3())
  instance.scale.setScalar(Math.min(size[0] / measured.x, size[2] / measured.y, size[1] / measured.z))
  holder.updateMatrixWorld(true)
  box = new THREE.Box3().setFromObject(holder)
  const center = box.getCenter(new THREE.Vector3())
  instance.position.set(-center.x, -box.min.y, -center.z)
  return holder
}
