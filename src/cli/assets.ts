import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMPTY_LOCK, type Lock } from '../core/library.ts'
import { MATERIALS, SKY } from '../core/materials.ts'

// Downloads the CC0 texture sets and sky the built-in materials name, from
// Poly Haven, into the local cache, and records them in assets/lock.json.

export const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'stage', 'assets')
export const LOCK_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/lock.json')
const API = 'https://api.polyhaven.com'
const HEADERS = { 'user-agent': 'stage/0.1 (https://github.com; asset fetch)' }

export async function readLock(): Promise<Lock> {
  try {
    return JSON.parse(await readFile(LOCK_PATH, 'utf8')) as Lock
  } catch {
    return structuredClone(EMPTY_LOCK)
  }
}

// The lock, limited to what is actually in the cache, for the viewer.
export async function availableLock(): Promise<Lock> {
  const lock = await readLock()
  const has = (file: string) => existsSync(join(CACHE, file))
  const textures = Object.fromEntries(Object.entries(lock.textures).filter(([, t]) => has(t.maps.color.file) && has(t.maps.normal.file) && has(t.maps.arm.file)))
  const skies = Object.fromEntries(Object.entries(lock.skies).filter(([, s]) => has(s.hdr.file)))
  return { version: 1, textures, skies }
}

async function json(url: string): Promise<any> {
  const response = await fetch(url, { headers: HEADERS })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
  return response.json()
}

async function download(url: string, file: string, md5: string): Promise<void> {
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

export async function fetchAssets(resolution = '1k', log: (line: string) => void = () => {}): Promise<Lock> {
  const lock = await readLock()
  const textures = [...new Set(Object.values(MATERIALS).map((m) => m.texture).filter((t): t is string => !!t))]

  for (const id of textures) {
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
    log(`texture ${id}: ${lock.textures[id].size.join(' x ')} m`)
  }

  // Skies want more pixels than textures: they fill the whole background.
  const skyResolution = '2k'
  const files = await json(`${API}/files/${SKY}`)
  const hdr = files.hdri?.[skyResolution]?.hdr as { url: string; md5: string } | undefined
  if (!hdr) throw new Error(`${SKY} has no ${skyResolution} HDR`)
  const file = `polyhaven/${SKY}/${skyResolution}/sky.hdr`
  await download(hdr.url, file, hdr.md5)
  lock.skies[SKY] = { source: `https://polyhaven.com/a/${SKY}`, license: 'CC0', resolution: skyResolution, hdr: { file, md5: hdr.md5 } }
  log(`sky ${SKY}`)

  mkdirSync(dirname(LOCK_PATH), { recursive: true })
  await writeFile(`${LOCK_PATH}.tmp`, `${JSON.stringify(lock, null, 2)}\n`)
  await rename(`${LOCK_PATH}.tmp`, LOCK_PATH)
  return lock
}
