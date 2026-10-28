import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { searchAssets } from '../core/assets.ts'
import { formatProblem, type CheckResult } from '../core/check.ts'
import { allCameras } from '../core/cameras.ts'
import { materialNames } from '../core/materials.ts'
import { QUESTIONS, query } from '../core/query.ts'
import { COLLECTIONS, type Collection } from '../core/schema.ts'
import { format, readScene, writeScene } from '../core/store.ts'
import { ROOT, checkScene, control, newScene, openViewer, removeEntity, upsert } from './ops.ts'
import { Renderer } from './render.ts'
import { VERSION } from './server.ts'

// The same operations as the command line, as MCP tools. `render` returns
// the image itself, so the model sees the result in the same turn, and every
// write lands in the file the person's open viewer is watching.

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

const text = (value: unknown): Content => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) })
const problems = (result: CheckResult): string =>
  result.problems.length === 0 ? 'check: no problems' : `check: ${result.ok ? 'ok with warnings' : 'errors'}\n${result.problems.map(formatProblem).join('\n')}`

async function guarded(work: () => Promise<Content[]>): Promise<{ content: Content[]; isError?: boolean }> {
  try {
    return { content: await work() }
  } catch (error) {
    return { content: [text(`stage: ${(error as Error).message}`)], isError: true }
  }
}

// One headless browser, started on the first render and closed again
// after two idle minutes, so it never sits on a gigabyte between calls.
// A browser that died takes its promise with it.
let renderer: Promise<Renderer> | undefined
let idle: NodeJS.Timeout | undefined
const getRenderer = () => (renderer ??= Renderer.start().catch((error) => {
  renderer = undefined
  throw error
}))
async function withRenderer<T>(work: (r: Renderer) => Promise<T>): Promise<T> {
  clearTimeout(idle)
  const r = await getRenderer()
  try {
    return await work(r)
  } catch (error) {
    if (/connect|closed|socket|target/i.test(String((error as Error).message))) {
      renderer = undefined
      await r.close().catch(() => {})
    }
    throw error
  } finally {
    idle = setTimeout(() => {
      const closing = renderer
      renderer = undefined
      closing?.then((r) => r.close()).catch(() => {})
    }, 120_000)
  }
}

const scenePath = z.string().describe('Path to the scene file, ideally absolute, e.g. /home/me/scenes/flat/scene.json')

export async function runMcp(): Promise<void> {
  const skill = readFileSync(join(ROOT, 'src/skill.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '')
  const server = new McpServer({ name: 'stage', version: VERSION }, { instructions: skill })

  server.registerTool(
    'new_scene',
    {
      description: 'Create a scene file, empty (one room, one door) or copied from an example ("flat": a furnished two-room flat; "flat-with-bedroom": the same with a bedroom and a person in each room). Refuses to overwrite.',
      inputSchema: { path: scenePath, name: z.string().default('Untitled scene'), from: z.enum(['empty', 'flat', 'flat-with-bedroom']).default('empty') },
    },
    ({ path, name, from }) => guarded(async () => [text({ scene: await newScene(path, name, from) })]),
  )

  server.registerTool(
    'open_viewer',
    {
      description: "Open the scene in the person's browser. The page updates live whenever the file changes, and highlights what changed. Call once per scene.",
      inputSchema: { scene: scenePath },
    },
    ({ scene }) => guarded(async () => [text({ url: await openViewer(resolve(scene)) })]),
  )

  server.registerTool(
    'show',
    {
      description: "Point the person's open viewer at a camera (a camera id, or 'orbit' or 'plan'), show a level (that one and the ones below it), or fly to an entity and outline it. Use it to show what you are talking about.",
      inputSchema: { scene: scenePath, camera: z.string().optional(), level: z.string().optional().describe('A level id: show it and the levels below it'), focus: z.string().optional().describe('An entity id to fly to and outline') },
    },
    ({ scene, camera, level, focus }) =>
      guarded(async () => {
        const viewers = await control(resolve(scene), { camera, level, focus })
        return [text(viewers ? `shown in ${viewers} viewer${viewers === 1 ? '' : 's'}` : 'no viewer has this scene open; call open_viewer first')]
      }),
  )

  server.registerTool(
    'check',
    { description: 'Validate the scene: schema, references, and spatial rules. Every problem names the entity and how to fix it.', inputSchema: { scene: scenePath } },
    ({ scene }) => guarded(async () => [text(problems(await checkScene(scene)))]),
  )

  server.registerTool(
    'render',
    {
      description: "Render the scene headlessly and return the image. Cameras: 'orbit' (overview from the southwest, the default), 'plan' (top-down with room labels, over the level's plan drawing when it has one), or any camera id in the scene. With several levels, pass `level` to look at that level with the ones above hidden. Look after every few edits.",
      inputSchema: {
        scene: scenePath,
        camera: z.string().optional(),
        level: z.string().optional().describe('A level id: show it and the levels below it'),
        width: z.number().int().min(320).max(1920).default(1024),
        height: z.number().int().min(240).max(1080).default(640),
        quality: z.enum(['high', 'fast']).optional().describe('fast skips ambient occlusion and shadows for a quick look'),
        sheet: z.boolean().optional().describe('Every camera, plus one standing in each room, as one contact sheet of small tiles'),
      },
    },
    ({ scene, camera, level, width, height, quality, sheet }) =>
      guarded(async () => {
        const result = await checkScene(scene)
        if (!result.ok) return [text(`${problems(result)}\nfix the errors before rendering`)]
        const cameras = sheet ? allCameras(result.scene!).filter((c) => c.type === 'perspective').map((c) => c.id).concat('orbit', 'plan') : undefined
        const png = await withRenderer((r) => r.render(resolve(scene), { camera, level, quality, width: cameras ? 480 : width, height: cameras ? 270 : height, sheet: cameras }))
        return [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, text(problems(result))]
      }),
  )

  server.registerTool(
    'query',
    {
      description: `Ask about the scene instead of reading the whole file. Questions: ${QUESTIONS.join(' | ')}. Example: "room kitchen" gives its size, edges (with direction and neighbor), openings, and items.`,
      inputSchema: { scene: scenePath, question: z.string() },
    },
    ({ scene, question }) =>
      guarded(async () => {
        const result = await checkScene(scene)
        if (!result.scene) return [text(problems(result))]
        return [text(query(result.scene, question.trim().split(/\s+/)))]
      }),
  )

  server.registerTool(
    'read_scene',
    { description: 'The whole scene file, in canonical form.', inputSchema: { scene: scenePath } },
    ({ scene }) => guarded(async () => [text(format(await readScene(scene)))]),
  )

  server.registerTool(
    'set',
    {
      description: `Add an entity to a collection (${COLLECTIONS.join(', ')}), or replace the one with the same id. The entity is validated first; problems with the scene as a whole are written and reported.`,
      inputSchema: {
        scene: scenePath,
        collection: z.enum(COLLECTIONS),
        entity: z.record(z.string(), z.unknown()).describe('The whole entity, including its id'),
      },
    },
    ({ scene, collection, entity }) =>
      guarded(async () => {
        const { replaced, result } = await upsert(scene, collection as Collection, entity)
        return [text(`${replaced ? 'replaced' : 'added'} ${String(entity.id)}\n${problems(result)}`)]
      }),
  )

  server.registerTool(
    'remove',
    { description: 'Remove the entity with this id.', inputSchema: { scene: scenePath, id: z.string() } },
    ({ scene, id }) =>
      guarded(async () => {
        const { collection, result } = await removeEntity(scene, id)
        return [text(`removed ${id} from ${collection}\n${problems(result)}`)]
      }),
  )

  server.registerTool(
    'write_scene',
    {
      description: 'Replace the whole scene file. Prefer set and remove for small changes; use this for a new layout. Malformed JSON is refused and nothing is written.',
      inputSchema: { scene: scenePath, json: z.string().describe('The complete scene as JSON text') },
    },
    ({ scene, json }) =>
      guarded(async () => {
        const raw = JSON.parse(json)
        await writeScene(scene, raw)
        return [text(`written\n${problems(await checkScene(scene))}`)]
      }),
  )

  server.registerTool(
    'assets',
    {
      description: 'Search the asset library by words (every word must match), with sizes as width x depth x height in meters at facing 0.',
      inputSchema: { words: z.string().default(''), category: z.string().optional() },
    },
    ({ words, category }) => guarded(async () => [text(searchAssets(words, { category }).map((a) => ({ id: a.id, name: a.name, size: a.size })))]),
  )

  server.registerTool(
    'fetch_assets',
    {
      description: 'Download CC0 models and texture sets from Poly Haven into the local cache: everything the scene uses (its items with models, the textures of its own materials), or the ids given (asset ids like "chair/armchair", or Poly Haven ids). Renders show real models and photographed surfaces only once they are fetched.',
      inputSchema: { scene: scenePath.optional(), ids: z.array(z.string()).optional() },
    },
    ({ scene, ids }) =>
      guarded(async () => {
        const { fetchAssets, sceneAssetIds } = await import('./assets.ts')
        const wanted = [...(ids ?? [])]
        if (scene) wanted.push(...sceneAssetIds((await checkScene(scene)).scene ?? { items: [] }))
        const lines: string[] = []
        await fetchAssets({ ids: wanted, log: (line) => lines.push(line) })
        return [text(lines.length ? lines.join('\n') : 'nothing new to fetch')]
      }),
  )

  server.registerTool('materials', { description: 'The built-in material names for floors, walls, and ceilings.', inputSchema: {} }, () =>
    guarded(async () => [text(materialNames())]),
  )

  await server.connect(new StdioServerTransport())
  const shutdown = async () => {
    if (renderer) await (await renderer).close().catch(() => {})
    process.exit(0)
  }
  process.stdin.on('close', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
