import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMPTY_LOCK, type Lock } from '../core/library.ts'
import { ASSETS, FIXTURES } from '../core/assets.ts'
import { MATERIALS, SKY } from '../core/materials.ts'

// Downloads the CC0 texture sets and sky the built-in materials name, from
// Poly Haven, into the local cache, and records them in assets/lock.json.

export const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'stage', 'assets')
export const LOCK_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/lock.json')
const API = 'https://api.polyhaven.com'
const HEADERS = { 'user-agent': 'stage/0.1 (https://github.com; asset fetch)' }

export async function readLock(): Promise<Lock> {
  try {
    return { ...structuredClone(EMPTY_LOCK), ...(JSON.parse(await readFile(LOCK_PATH, 'utf8')) as Lock) }
  } catch {
    return structuredClone(EMPTY_LOCK)
  }
}

type Matrix = number[]
const identity = (): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}
// A glTF node's local matrix, column-major, from `matrix` or translation,
// rotation (a quaternion), and scale.
function local(node: any): Matrix {
  if (node.matrix) return node.matrix
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

// A model's size, from the bounds glTF stores for every mesh position
// accessor, through each node's transform. No geometry needs reading.
export function measureGltf(gltf: any): [number, number, number] {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const visit = (index: number, parent: Matrix) => {
    const node = gltf.nodes[index]
    const world = multiply(parent, local(node))
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION]
        if (!accessor?.min || !accessor?.max) continue
        for (let corner = 0; corner < 8; corner++) {
          const p = [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? accessor.max[axis] : accessor.min[axis]))
          for (let axis = 0; axis < 3; axis++) {
            const v = world[axis] * p[0] + world[4 + axis] * p[1] + world[8 + axis] * p[2] + world[12 + axis]
            min[axis] = Math.min(min[axis], v)
            max[axis] = Math.max(max[axis], v)
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world)
  }
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) visit(index, identity())
  const round = (n: number) => Math.round(n * 100) / 100
  return [round(max[0] - min[0]), round(max[2] - min[2]), round(max[1] - min[1])]
}

// The lock, limited to what is actually in the cache, for the viewer.
export async function availableLock(): Promise<Lock> {
  const lock = await readLock()
  const has = (file: string) => existsSync(join(CACHE, file))
  const textures = Object.fromEntries(Object.entries(lock.textures).filter(([, t]) => has(t.maps.color.file) && has(t.maps.normal.file) && has(t.maps.arm.file)))
  const skies = Object.fromEntries(Object.entries(lock.skies).filter(([, s]) => has(s.hdr.file)))
  const models = Object.fromEntries(Object.entries(lock.models ?? {}).filter(([, m]) => has(m.gltf.file) && m.files.every((f) => has(f.file))))
  return { version: 1, textures, skies, models }
}

export async function json(url: string): Promise<any> {
  const response = await fetch(url, { headers: HEADERS })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
  return response.json()
}

export async function download(url: string, file: string, md5: string): Promise<void> {
  const target = join(CACHE, file)
  if (existsSync(target) && createHash('md5').update(await readFile(target)).digest('hex') === md5) return
  const response = await fetch(url, { headers: HEADERS })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
  const data = Buffer.from(await response.arrayBuffer())
  const actual = createHash('md5').update(data).digest('hex')
  if (actual !== md5) throw new Error(`${url} arrived damaged (md5 ${actual}, expected ${md5}); try again`)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, data)
  await rename(`${target}.tmp`, target)
}

export interface FetchOptions {
  resolution?: string
  // Model or texture ids to fetch, besides the built-in materials and sky.
  ids?: string[]
  // Every model the library knows, not just the ones the examples use.
  all?: boolean
  log?: (line: string) => void
}

export async function fetchTexture(id: string, resolution: string, lock: Lock): Promise<void> {
  const [info, files] = await Promise.all([json(`${API}/info/${id}`), json(`${API}/files/${id}`)])
  const pick = (key: string) => {
    const entry = files[key]?.[resolution]?.jpg
    if (!entry) throw new Error(`${id} has no ${key} map at ${resolution}`)
    return entry as { url: string; md5: string }
  }
  const color = pick('Diffuse')
  const normal = pick('nor_gl')
  const arm = pick('arm')
  const base = `polyhaven/${id}/${resolution}`
  await Promise.all([
    download(color.url, `${base}/color.jpg`, color.md5),
    download(normal.url, `${base}/normal.jpg`, normal.md5),
    download(arm.url, `${base}/arm.jpg`, arm.md5),
  ])
  const [w, h] = (info.dimensions as [number, number] | undefined) ?? [2000, 2000]
  lock.textures[id] = {
    source: `https://polyhaven.com/a/${id}`,
    license: 'CC0',
    size: [Math.round(w) / 1000, Math.round(h) / 1000],
    resolution,
    maps: {
      color: { file: `${base}/color.jpg`, md5: color.md5 },
      normal: { file: `${base}/normal.jpg`, md5: normal.md5 },
      arm: { file: `${base}/arm.jpg`, md5: arm.md5 },
    },
  }
}

export async function fetchModel(id: string, resolution: string, lock: Lock): Promise<[number, number, number]> {
  const files = await json(`${API}/files/${id}`)
  const entry = files.gltf?.[resolution]?.gltf as { url: string; md5: string; include: Record<string, { url: string; md5: string }> } | undefined
  if (!entry) throw new Error(`${id} has no glTF at ${resolution}`)
  const base = `polyhaven/${id}/${resolution}`
  const gltfFile = `${base}/${id}.gltf`
  await download(entry.url, gltfFile, entry.md5)
  const included = Object.entries(entry.include).map(([path, file]) => ({ path: `${base}/${path}`, ...file }))
  await Promise.all(included.map((file) => download(file.url, file.path, file.md5)))
  const size = measureGltf(JSON.parse(await readFile(join(CACHE, gltfFile), 'utf8')))
  lock.models[id] = {
    source: `https://polyhaven.com/a/${id}`,
    license: 'CC0',
    resolution,
    gltf: { file: gltfFile, md5: entry.md5 },
    files: included.map((file) => ({ file: file.path, md5: file.md5 })),
    size,
  }
  return size
}

// Skies want more pixels than textures: they fill the whole background.
export async function fetchSky(id: string, lock: Lock, resolution = '2k'): Promise<void> {
  const files = await json(`${API}/files/${id}`)
  const hdr = files.hdri?.[resolution]?.hdr as { url: string; md5: string } | undefined
  if (!hdr) throw new Error(`${id} has no ${resolution} HDR`)
  const file = `polyhaven/${id}/${resolution}/sky.hdr`
  await download(hdr.url, file, hdr.md5)
  lock.skies[id] = { source: `https://polyhaven.com/a/${id}`, license: 'CC0', resolution, hdr: { file, md5: hdr.md5 } }
}

export async function writeLock(lock: Lock): Promise<void> {
  mkdirSync(dirname(LOCK_PATH), { recursive: true })
  await writeFile(`${LOCK_PATH}.tmp`, `${JSON.stringify(lock, null, 2)}\n`)
  await rename(`${LOCK_PATH}.tmp`, LOCK_PATH)
}

// Poly Haven ids a library asset or a scene names: its models, and the
// texture sets behind its materials.
export function wanted(ids: string[]): { textures: string[]; models: string[] } {
  const textures = new Set<string>()
  const models = new Set<string>()
  for (const id of ids) {
    const asset = ASSETS.find((a) => a.id === id)
    if (asset?.model) models.add(asset.model)
    else if (MATERIALS[id]?.texture) textures.add(MATERIALS[id].texture!)
    else if (ASSETS.some((a) => a.model === id)) models.add(id)
    else textures.add(id)
  }
  return { textures: [...textures], models: [...models] }
}

// The built-in materials and sky always; the models the examples use by
// default, every model with --all, and any ids asked for.
export async function fetchAssets(options: FetchOptions = {}): Promise<Lock> {
  const resolution = options.resolution ?? '1k'
  const log = options.log ?? (() => {})
  const lock = await readLock()
  const asked = wanted(options.ids ?? [])
  const textures = [...new Set([...Object.values(MATERIALS).map((m) => m.texture).filter((t): t is string => !!t), ...asked.textures])]
  for (const id of textures) {
    await fetchTexture(id, resolution, lock)
    log(`texture ${id}: ${lock.textures[id].size.join(' x ')} m`)
  }
  const models = new Set<string>([...Object.values(FIXTURES), ...asked.models])
  for (const asset of ASSETS) if (asset.model && (options.all || !asset.generated)) models.add(asset.model)
  for (const id of models) {
    const size = await fetchModel(id, resolution, lock)
    log(`model ${id}: ${size.join(' x ')} m`)
  }
  await fetchSky(SKY, lock)
  log(`sky ${SKY}`)
  await writeLock(lock)
  return lock
}
