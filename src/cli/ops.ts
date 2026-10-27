import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { z } from 'zod'
import { check, type CheckResult } from '../core/check.ts'
import { Camera, Item, Level, Light, Opening, Room, type Collection } from '../core/schema.ts'
import { readScene, writeScene } from '../core/store.ts'
import { DEFAULT_PORT, healthy, viewerUrl } from './server.ts'

// What the command line and the MCP server both do to a scene, so the two
// can never drift apart.

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const EXAMPLES = join(ROOT, 'examples')
const CLI = join(ROOT, 'src/cli/index.ts')

const SCHEMAS: Record<Collection, z.ZodType> = {
  levels: Level,
  rooms: Room,
  openings: Opening,
  items: Item,
  lights: Light,
  cameras: Camera,
}

export async function newScene(path: string, name: string, from = 'empty'): Promise<string> {
  const target = resolve(path.endsWith('.json') ? path : join(path, 'scene.json'))
  if (existsSync(target)) throw new Error(`${target} already exists; open it, or pick another path`)
  mkdirSync(dirname(target), { recursive: true })
  if (from !== 'empty') {
    const example = join(EXAMPLES, from, 'scene.json')
    if (!existsSync(example)) throw new Error(`no example is called "${from}"; examples: flat, or empty`)
    await copyFile(example, target)
    return target
  }
  await writeScene(target, {
    stage: '0.1',
    name,
    units: 'm',
    levels: [{ id: 'ground', elevation: 0, height: 2.7 }],
    rooms: [{ id: 'room', level: 'ground', name: 'Room', floor: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
    openings: [{ id: 'door', wall: { room: 'room', edge: 0 }, at: 0.5, type: 'door', width: 0.9, height: 2.1 }],
    items: [],
    lights: [{ id: 'sun', type: 'sun', azimuth: 220, elevation: 35, intensity: 1 }],
    cameras: [{ id: 'plan', type: 'plan' }],
  })
  return target
}

export async function checkScene(path: string): Promise<CheckResult> {
  return check(await readScene(path))
}

// Adds an entity, or replaces the one with the same id. The entity is
// validated alone first, and nothing is written if it is malformed;
// problems with the scene as a whole are written and reported, so an agent
// can build up a scene in any order.
export async function upsert(path: string, collection: Collection, entity: unknown): Promise<{ replaced: boolean; result: CheckResult }> {
  const parsed = SCHEMAS[collection].safeParse(entity)
  if (!parsed.success) {
    throw new Error(`not a valid ${collection.slice(0, -1)}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(entity)'}: ${i.message}`).join('; ')}`)
  }
  const raw = (await readScene(path)) as Record<string, unknown[]>
  const list = (raw[collection] ??= [])
  const id = (entity as { id: string }).id
  const index = list.findIndex((e) => (e as { id?: string }).id === id)
  if (index >= 0) list[index] = entity
  else list.push(entity)
  await writeScene(path, raw)
  return { replaced: index >= 0, result: check(raw) }
}

export async function removeEntity(path: string, id: string): Promise<{ collection: string; result: CheckResult }> {
  const raw = (await readScene(path)) as Record<string, unknown[]>
  for (const collection of ['items', 'openings', 'rooms', 'cameras', 'lights', 'levels']) {
    const list = raw[collection]
    if (!Array.isArray(list)) continue
    const index = list.findIndex((e) => (e as { id?: string }).id === id)
    if (index < 0) continue
    list.splice(index, 1)
    await writeScene(path, raw)
    return { collection, result: check(raw) }
  }
  throw new Error(`nothing in ${path} has the id "${id}"`)
}

// The live viewer runs as its own small background process, so it outlives
// any one command and every client (CLI, MCP, a person) talks to the same one.
export async function ensureLiveServer(port = DEFAULT_PORT): Promise<string> {
  const url = `http://127.0.0.1:${port}`
  if (await healthy(port)) return url
  const logs = join(homedir(), '.cache', 'stage')
  mkdirSync(logs, { recursive: true })
  const log = openSync(join(logs, 'server.log'), 'a')
  const child = spawn(process.execPath, ['--no-warnings', CLI, 'serve', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', log, log],
  })
  child.unref()
  for (let i = 0; i < 50; i++) {
    if (await healthy(port)) return url
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`the viewer server did not start; see ${join(logs, 'server.log')}`)
}

export function openInBrowser(url: string): void {
  const launcher = existsSync('/usr/share/omarchy/bin/omarchy-launch-browser') ? 'omarchy-launch-browser' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawn(launcher, [url], { detached: true, stdio: 'ignore' }).unref()
}

export async function openViewer(scene: string, browser = true): Promise<string> {
  const base = await ensureLiveServer()
  const url = viewerUrl(base, scene)
  if (browser) openInBrowser(url)
  return url
}

// Asks every open viewer of this scene to switch camera or focus an entity.
export async function control(scene: string, message: { camera?: string; focus?: string }): Promise<number> {
  const base = await ensureLiveServer()
  const response = await fetch(`${base}/api/control?path=${encodeURIComponent(resolve(scene))}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  })
  const body = (await response.json()) as { viewers?: number; error?: string }
  if (body.error) throw new Error(body.error)
  return body.viewers ?? 0
}
