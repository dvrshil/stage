import { mkdirSync, readFileSync, symlinkSync, lstatSync, unlinkSync, existsSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { searchAssets } from '../core/assets.ts'
import { formatProblem, type CheckResult } from '../core/check.ts'
import { materialNames } from '../core/materials.ts'
import { QUESTIONS, query } from '../core/query.ts'
import { COLLECTIONS, jsonSchema, type Collection } from '../core/schema.ts'
import { readScene, writeScene } from '../core/store.ts'
import { ROOT, checkScene, control, newScene, openViewer, removeEntity, upsert } from './ops.ts'
import { Renderer } from './render.ts'
import { DEFAULT_PORT, VERSION, startServer } from './server.ts'

// The `stage` command. Every command but `open`, `serve`, and `mcp` needs
// no display, takes --json, exits 0 or 1, and prints errors on stderr.

const USAGE = `Usage: stage <command> [options]

Viewer:
  open <scene>                         Open the scene in your browser; it updates as the file changes
  serve [--port ${DEFAULT_PORT}]                   Run the viewer server in the foreground

Commands that need no display:
  new <path> [--name N] [--from flat]  Start a scene, empty or from an example
  check <scene>                        Report every problem, with its entity and a fix
  render <scene> -o out.png [--camera id] [--size 1280x720]
  query <scene> <question...>          ${QUESTIONS.join(' | ')}
  set <scene> <collection> '<json>'    Add an entity, or replace the one with its id
  remove <scene> <id>                  Remove an entity
  show <scene> [--camera id] [--focus id]  Point every open viewer at a camera or an entity
  assets [words...] [--category c]     Search the asset library
  assets fetch [--resolution 1k]       Download the CC0 textures and sky into the local cache
  materials                            List the built-in materials
  fmt <scene>                          Rewrite the scene in canonical form
  schema                               Print the scene format as JSON Schema
  mcp                                  Run as an MCP server over stdio
  skill [install]                      Print the agent skill, or install it

Add --json to any command for machine-readable output.`

function print(value: unknown) {
  process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`)
}

function fail(message: string): number {
  process.stderr.write(`stage: ${message}\n`)
  return 1
}

function reportCheck(result: CheckResult, json: boolean): void {
  if (json) {
    print({ ok: result.ok, problems: result.problems })
    return
  }
  if (result.problems.length === 0) print('ok: no problems')
  for (const problem of result.problems) print(formatProblem(problem))
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      json: { type: 'boolean' },
      out: { type: 'string', short: 'o' },
      camera: { type: 'string' },
      focus: { type: 'string' },
      size: { type: 'string' },
      name: { type: 'string' },
      from: { type: 'string' },
      category: { type: 'string' },
      port: { type: 'string' },
      resolution: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const json = values.json === true
  const scene = positionals[0]

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      print(USAGE)
      return 0

    case '--version':
    case 'version':
      print(VERSION)
      return 0

    case 'new': {
      if (!scene) return fail('name the scene to create: stage new <path>')
      const name = (values.name as string | undefined) ?? 'Untitled scene'
      const path = await newScene(scene, name, (values.from as string | undefined) ?? 'empty')
      json ? print({ ok: true, scene: path }) : print(`Created ${path}`)
      return 0
    }

    case 'check': {
      if (!scene) return fail('name a scene: stage check <scene>')
      const result = await checkScene(scene)
      reportCheck(result, json)
      return result.ok ? 0 : 1
    }

    case 'render': {
      if (!scene) return fail('name a scene: stage render <scene> -o out.png')
      const out = (values.out as string | undefined) ?? 'render.png'
      const [width, height] = ((values.size as string | undefined) ?? '1280x720').split('x').map(Number)
      if (!width || !height) return fail('--size is WIDTHxHEIGHT, like 1280x720')
      const result = await checkScene(scene)
      if (!result.ok) {
        reportCheck(result, json)
        return fail('fix the errors above before rendering')
      }
      const renderer = await Renderer.start()
      try {
        const png = await renderer.render(scene, { camera: values.camera as string | undefined, width, height })
        const target = resolve(out)
        mkdirSync(dirname(target), { recursive: true })
        const temporary = `${target}.${process.pid}.tmp`
        await writeFile(temporary, png)
        await rename(temporary, target)
        json ? print({ ok: true, image: target, warnings: result.problems }) : print(`Rendered ${target}`)
      } finally {
        await renderer.close()
      }
      return 0
    }

    case 'query': {
      if (!scene || positionals.length < 2) return fail(`ask a question: stage query <scene> ${QUESTIONS.join(' | ')}`)
      const result = await checkScene(scene)
      if (!result.scene) {
        reportCheck(result, json)
        return fail('the scene has errors that stop it from being read')
      }
      print(query(result.scene, positionals.slice(1)))
      return 0
    }

    case 'set': {
      const [, collection, entityJson] = positionals
      if (!scene || !collection || !entityJson) return fail(`stage set <scene> <${COLLECTIONS.join('|')}> '<json>'`)
      if (!(COLLECTIONS as readonly string[]).includes(collection)) return fail(`collections are ${COLLECTIONS.join(', ')}`)
      const { replaced, result } = await upsert(scene, collection as Collection, JSON.parse(entityJson))
      if (!json) print(replaced ? 'Replaced' : 'Added')
      reportCheck(result, json)
      return 0
    }

    case 'remove': {
      const id = positionals[1]
      if (!scene || !id) return fail('stage remove <scene> <id>')
      const { collection, result } = await removeEntity(scene, id)
      if (!json) print(`Removed ${id} from ${collection}`)
      reportCheck(result, json)
      return 0
    }

    case 'show': {
      if (!scene) return fail('stage show <scene> --camera <id> | --focus <id>')
      const viewers = await control(scene, { camera: values.camera as string | undefined, focus: values.focus as string | undefined })
      json ? print({ ok: true, viewers }) : print(viewers ? `Showed it in ${viewers} viewer${viewers === 1 ? '' : 's'}` : 'No viewer has this scene open; run: stage open <scene>')
      return 0
    }

    case 'open': {
      if (!scene) return fail('name a scene: stage open <scene>')
      if (!existsSync(scene)) return fail(`${scene} does not exist`)
      const url = await openViewer(scene)
      json ? print({ ok: true, url }) : print(`Opened ${url}`)
      return 0
    }

    case 'serve': {
      const port = Number(values.port ?? DEFAULT_PORT)
      const server = await startServer(port)
      print(`Serving the viewer at ${server.url}`)
      await new Promise(() => {})
      return 0
    }

    case 'assets': {
      if (positionals[0] === 'fetch') {
        const { fetchAssets, CACHE } = await import('./assets.ts')
        const lock = await fetchAssets((values.resolution as string | undefined) ?? '1k', json ? undefined : (line) => print(line))
        json ? print({ ok: true, cache: CACHE, textures: Object.keys(lock.textures), skies: Object.keys(lock.skies) }) : print(`Fetched into ${CACHE}`)
        return 0
      }
      const found = searchAssets(positionals.join(' '), { category: values.category as string | undefined })
      if (json) print(found)
      else for (const a of found) print(`${a.id.padEnd(28)} ${a.size.join(' x ')} m   ${a.name}`)
      return 0
    }

    case 'materials':
      json ? print(materialNames()) : print(materialNames().join('\n'))
      return 0

    case 'fmt': {
      if (!scene) return fail('name a scene: stage fmt <scene>')
      const raw = await readScene(scene)
      await writeScene(scene, raw)
      json ? print({ ok: true }) : print(`Formatted ${scene}`)
      return 0
    }

    case 'schema':
      print(jsonSchema())
      return 0

    case 'mcp': {
      const { runMcp } = await import('./mcp.ts')
      await runMcp()
      return 0
    }

    case 'skill': {
      const text = readFileSync(join(ROOT, 'src/skill.md'), 'utf8')
      if (positionals[0] !== 'install') {
        process.stdout.write(text)
        return 0
      }
      const directory = join(homedir(), '.agents/skills/stage')
      mkdirSync(directory, { recursive: true })
      await writeFile(join(directory, 'SKILL.md'), text)
      print(`Installed ${join(directory, 'SKILL.md')}`)
      const link = join(homedir(), '.claude/skills/stage')
      if (existsSync(join(homedir(), '.claude'))) {
        try {
          if (lstatSync(link).isSymbolicLink()) unlinkSync(link)
          else return fail(`${link} exists and is not a link; leaving it alone`)
        } catch {}
        mkdirSync(dirname(link), { recursive: true })
        symlinkSync('../../.agents/skills/stage', link)
        print(`Linked ${link}`)
      }
      return 0
    }

    default:
      return fail(`"${command}" is not a command\n\n${USAGE}`)
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (process.argv[2] !== 'serve' && process.argv[2] !== 'mcp') process.exit(code)
  },
  (error) => process.exit(fail((error as Error).message)),
)

