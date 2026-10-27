import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { KEY_ORDER } from './schema.ts'

// Reading and writing scene files. Writes go to a temporary file beside the
// target and are renamed into place, so a crash never leaves half a scene.

export async function readScene(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`could not read ${path}: ${(error as Error).message}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`)
  }
}

export async function writeScene(path: string, scene: unknown): Promise<void> {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, format(scene))
  await rename(temporary, target)
}

// Canonical text: schema key order, two-space indent, short arrays on one
// line, and a trailing newline.
export function format(scene: unknown): string {
  return `${render(order(scene), 0)}\n`
}

function order(value: unknown, kind = 'scene'): unknown {
  if (Array.isArray(value)) return value.map((entry) => order(entry, kind))
  if (typeof value !== 'object' || value === null) return value
  const object = value as Record<string, unknown>
  const keys = KEY_ORDER[kind] ?? []
  const sorted = [...keys.filter((k) => k in object), ...Object.keys(object).filter((k) => !keys.includes(k))]
  const out: Record<string, unknown> = {}
  for (const key of sorted) {
    const childKind = kind === 'scene' ? singular(key) : key === 'wall' || key === 'materials' ? key : kind
    out[key] = order(object[key], childKind)
  }
  return out
}

function singular(collection: string): string {
  return collection.endsWith('s') ? collection.slice(0, -1) : collection
}

function render(value: unknown, depth: number): string {
  const pad = '  '.repeat(depth)
  const inner = '  '.repeat(depth + 1)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const flat = value.every((v) => typeof v !== 'object' || v === null)
    const pointList = value.every((v) => Array.isArray(v) && v.length <= 3 && v.every((n) => typeof n === 'number'))
    if (flat || pointList) return `[${value.map((v) => render(v, depth + 1)).join(', ')}]`
    return `[\n${value.map((v) => `${inner}${render(v, depth + 1)}`).join(',\n')}\n${pad}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const short = entries.every(([, v]) => typeof v !== 'object' || v === null || (Array.isArray(v) && v.every((n) => typeof n === 'number')))
    if (short && depth > 0) return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${render(v, depth + 1)}`).join(', ')} }`
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${render(v, depth + 1)}`).join(',\n')}\n${pad}}`
  }
  return JSON.stringify(value)
}
