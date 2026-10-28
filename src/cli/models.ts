import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { measureGltf } from './assets.ts'

// Models from the open libraries, for anything the built-in library lacks:
// search by words across every source, look at thumbnails, fetch one
// beside the scene as a glTF the `model` object kind loads. Every source
// is a small adapter; the agent sees one list.

export interface ModelHit {
  source: string
  id: string
  name: string
  // The license's short name and who to credit, as the source states them.
  license: string
  credit: string
  // The page a person can open.
  url: string
  thumbnail?: string
  triangles?: number
  // Width, depth, height in meters when the source knows.
  size?: [number, number, number]
}

export interface Fetched {
  // The main file, relative to the scene: a .glb, or a .gltf with its
  // buffers and textures beside it.
  file: string
  size: [number, number, number]
  license: string
  credit: string
  source: string
}

export interface ModelSource {
  id: string
  name: string
  // What the agent should know: licenses, what it is good for, the key.
  about: string
  // The environment variable holding a key, when the source needs one.
  key?: string
  search(words: string, limit: number): Promise<ModelHit[]>
  fetch(hit: ModelHit, folder: string): Promise<string>
}

const HEADERS = { 'user-agent': 'stage/0.1 (https://github.com/dvrshil/stage; model search)' }

export async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const response = await fetch(url, { headers: { ...HEADERS, ...headers } })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
  return response.json()
}

export async function getBytes(url: string, headers: Record<string, string> = {}): Promise<{ data: Buffer; type: string }> {
  const response = await fetch(url, { headers: { ...HEADERS, ...headers } })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
  return { data: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') ?? 'application/octet-stream' }
}

export async function saveTo(url: string, path: string, headers: Record<string, string> = {}): Promise<void> {
  const { data } = await getBytes(url, headers)
  mkdirSync(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, data)
  await rename(`${path}.tmp`, path)
}

// A file name a source's id can become.
export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || createHash('md5').update(text).digest('hex').slice(0, 8)

// The JSON of a .gltf or the JSON chunk of a .glb.
export async function readGltfJson(path: string): Promise<any> {
  const data = await readFile(path)
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'glTF') {
    let at = 12
    while (at + 8 <= data.length) {
      const length = data.readUInt32LE(at)
      const type = data.readUInt32LE(at + 4)
      if (type === 0x4e4f534a) return JSON.parse(data.toString('utf8', at + 8, at + 8 + length))
      at += 8 + length
    }
    throw new Error(`${path}: no JSON chunk in the glb`)
  }
  return JSON.parse(data.toString('utf8'))
}

export async function measureFile(path: string): Promise<[number, number, number]> {
  const size = measureGltf(await readGltfJson(path))
  if (!size.every((n) => Number.isFinite(n))) throw new Error(`${path}: could not measure the model`)
  return size
}

// --- Poly Haven: CC0 scans, photographic quality, heavy; furniture,
// props, plants, rocks, vehicles. No key.
const POLYHAVEN = 'https://api.polyhaven.com'
let polyhavenIndex: Promise<Record<string, any>> | undefined
const polyhaven: ModelSource = {
  id: 'polyhaven',
  name: 'Poly Haven',
  about: 'CC0 photoscanned models (furniture, props, plants, rocks, vehicles), high quality and heavy; no key needed',
  async search(words, limit) {
    polyhavenIndex ??= getJson(`${POLYHAVEN}/assets?type=models`)
    const index = await polyhavenIndex
    const terms = words.toLowerCase().split(/\s+/).filter(Boolean)
    const hits: (ModelHit & { score: number })[] = []
    for (const [id, a] of Object.entries<any>(index)) {
      const haystack = `${id} ${a.name} ${(a.tags ?? []).join(' ')} ${(a.categories ?? []).join(' ')}`.toLowerCase()
      const score = terms.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0)
      if (terms.length && score < terms.length) continue
      hits.push({
        source: 'polyhaven',
        id,
        name: a.name,
        license: 'CC0',
        credit: Object.keys(a.authors ?? {}).join(', '),
        url: `https://polyhaven.com/a/${id}`,
        thumbnail: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`,
        score: score + Math.min(1, (a.download_count ?? 0) / 1e6),
      })
    }
    return hits.sort((p, q) => q.score - p.score).slice(0, limit)
  },
  async fetch(hit, folder) {
    const files = await getJson(`${POLYHAVEN}/files/${hit.id}`)
    const entry = files.gltf?.['1k']?.gltf as { url: string; include: Record<string, { url: string }> } | undefined
    if (!entry) throw new Error(`${hit.id} has no glTF`)
    const base = join('models', 'polyhaven', hit.id)
    await saveTo(entry.url, join(folder, base, `${hit.id}.gltf`))
    await Promise.all(Object.entries(entry.include).map(([path, file]) => saveTo(file.url, join(folder, base, path))))
    return `${base}/${hit.id}.gltf`
  },
}

export const SOURCES: ModelSource[] = [polyhaven]

export function sourceById(id: string): ModelSource {
  const found = SOURCES.find((s) => s.id === id)
  if (!found) throw new Error(`no source is called "${id}"; sources are ${SOURCES.map((s) => s.id).join(', ')}.`)
  return found
}

// Sources that can be used now: the ones needing a key only when it is set.
export const available = () => SOURCES.filter((s) => !s.key || process.env[s.key])

export async function findModels(words: string, options: { source?: string; limit?: number } = {}): Promise<{ hits: ModelHit[]; skipped: string[] }> {
  const limit = options.limit ?? 8
  const sources = options.source ? [sourceById(options.source)] : available()
  const skipped = SOURCES.filter((s) => !sources.includes(s)).map((s) => `${s.name} (set ${s.key})`)
  const results = await Promise.allSettled(sources.map((s) => s.search(words, limit)))
  const hits: ModelHit[] = []
  for (let round = 0; hits.length < limit; round++) {
    let any = false
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const hit = result.value[round]
      if (!hit) continue
      any = true
      if (hits.length < limit) hits.push(hit)
    }
    if (!any) break
  }
  for (const result of results) if (result.status === 'rejected') skipped.push(String((result.reason as Error).message))
  return { hits, skipped }
}

// Fetch one hit beside the scene file and measure it.
export async function fetchModelBesideScene(scenePath: string, source: string, id: string): Promise<Fetched> {
  const adapter = sourceById(source)
  const hits = await adapter.search(id, 50)
  const hit = hits.find((h) => h.id === id) ?? hits.find((h) => slug(h.id) === slug(id))
  if (!hit) throw new Error(`${adapter.name} has no model with id "${id}"; find_model first and use the id it gives.`)
  const folder = dirname(resolve(scenePath))
  const file = await adapter.fetch(hit, folder)
  const size = await measureFile(join(folder, file))
  return { file, size, license: hit.license, credit: hit.credit, source: hit.url }
}

// Thumbnails as image content for the model to look at.
export async function thumbnailImage(hit: ModelHit): Promise<{ data: string; mimeType: string } | undefined> {
  if (!hit.thumbnail) return undefined
  try {
    const { data, type } = await getBytes(hit.thumbnail)
    const mimeType = type.split(';')[0].trim()
    if (!mimeType.startsWith('image/')) return undefined
    return { data: data.toString('base64'), mimeType }
  } catch {
    return undefined
  }
}

export const hasFile = (path: string) => existsSync(path)
