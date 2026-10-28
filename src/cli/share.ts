import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ASSETS, FIXTURES } from '../core/assets.ts'
import { MATERIALS } from '../core/materials.ts'
import type { Scene } from '../core/schema.ts'
import { format } from '../core/store.ts'
import { CACHE, availableLock } from './assets.ts'
import { DIST } from './server.ts'

// A folder any static host serves as a link: the viewer, the scene, the
// plan drawings, and only the library files this scene needs. Opened
// without ?scene=, the viewer reads them from beside itself.
export async function shareScene(scenePath: string, scene: Scene, outDir: string, log: (line: string) => void = () => {}): Promise<{ dir: string; files: number; bytes: number }> {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('the viewer is not built; run npm run build first')
  const dir = resolve(outDir)
  await mkdir(dir, { recursive: true })
  await cp(DIST, dir, { recursive: true })
  await writeFile(join(dir, 'scene.json'), format(scene))

  // The drawings under the plan views.
  let files = 2
  let bytes = 0
  for (const level of scene.levels) {
    if (!level.plan) continue
    const source = resolve(dirname(scenePath), level.plan.image)
    if (!existsSync(source)) {
      log(`skipping missing plan image ${level.plan.image}`)
      continue
    }
    const target = join(dir, 'files', level.plan.image)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target)
    files++
  }

  // The library, cut down to this scene: the models its items use, the
  // fixtures, every texture a material can name, and the sky.
  const lock = await availableLock()
  const models = new Set<string>(Object.values(FIXTURES))
  for (const item of scene.items) {
    const model = ASSETS.find((a) => a.id === item.asset)?.model
    if (model) models.add(model)
  }
  const textures = new Set<string>([...Object.values(MATERIALS).map((m) => m.texture).filter((t): t is string => !!t), ...scene.materials.map((m) => m.texture).filter((t): t is string => !!t)])
  const shared = {
    version: 1,
    textures: Object.fromEntries(Object.entries(lock.textures).filter(([id]) => textures.has(id))),
    skies: lock.skies,
    models: Object.fromEntries(Object.entries(lock.models).filter(([id]) => models.has(id))),
  }
  const copies: string[] = []
  for (const t of Object.values(shared.textures)) copies.push(t.maps.color.file, t.maps.normal.file, t.maps.arm.file)
  for (const s of Object.values(shared.skies)) copies.push(s.hdr.file)
  for (const m of Object.values(shared.models)) copies.push(m.gltf.file, ...m.files.map((f) => f.file))
  for (const file of copies) {
    const target = join(dir, 'library', file)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(CACHE, file), target)
    bytes += (await readFile(target)).length
    files++
  }
  await writeFile(join(dir, 'library.json'), `${JSON.stringify(shared, null, 2)}\n`)
  const missing = [...models].filter((m) => !shared.models[m])
  if (missing.length) log(`not fetched, so they ship as placeholders: ${missing.join(', ')} (stage assets fetch ${scenePath})`)
  return { dir, files, bytes }
}
