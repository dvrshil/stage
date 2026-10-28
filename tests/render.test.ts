import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, test } from 'node:test'
import { Renderer } from '../src/cli/render.ts'

// Renders through headless Chromium, so slower than the core tests. Run
// with: npm run test:render

const scene = new URL('../examples/flat/scene.json', import.meta.url).pathname
let renderer: Renderer

before(async () => {
  renderer = await Renderer.start()
})

after(async () => {
  await renderer.close()
})

test('the same scene renders the same pixels', async () => {
  const hash = (png: Buffer) => createHash('sha256').update(png).digest('hex')
  const first = await renderer.render(scene, { camera: 'plan', width: 640, height: 360, timeout: 90000 })
  const second = await renderer.render(scene, { camera: 'plan', width: 640, height: 360, timeout: 90000 })
  assert.ok(first.length > 20000, 'a real image, not a blank frame')
  assert.equal(hash(first), hash(second))
})

test('a plan of one level renders over the levels below', async () => {
  const house = new URL('../examples/two-storey/scene.json', import.meta.url).pathname
  const png = await renderer.render(house, { camera: 'plan:first', width: 480, height: 270, timeout: 90000 })
  assert.ok(png.length > 10000)
})

test('every example camera renders', async () => {
  for (const camera of ['orbit', 'plan', 'from-door', 'kitchen-view']) {
    const png = await renderer.render(scene, { camera, width: 480, height: 270, timeout: 90000 })
    assert.ok(png.length > 10000, `${camera} rendered an image`)
  }
})

// Golden renders: every example, from above and from the overview, against
// the images in tests/golden. A missing golden is written; set
// UPDATE_GOLDENS=1 to rewrite them all after a deliberate change.
test('every example matches its golden renders', async () => {
  const { mkdir, readFile, writeFile } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  const { meanDifference } = await import('./png.ts')
  const dir = new URL('./golden/', import.meta.url).pathname
  await mkdir(dir, { recursive: true })
  for (const example of ['flat', 'flat-with-bedroom', 'two-storey', 'desk']) {
    for (const camera of ['orbit', 'plan']) {
      const path = `${dir}${example}-${camera}.png`
      const png = await renderer.render(new URL(`../examples/${example}/scene.json`, import.meta.url).pathname, { camera, width: 480, height: 270, timeout: 120000 })
      if (!existsSync(path) || process.env.UPDATE_GOLDENS) {
        await writeFile(path, png)
        continue
      }
      const difference = meanDifference(await readFile(path), png)
      assert.ok(difference < 8, `${example} from ${camera} drifted from its golden by ${difference.toFixed(1)} (of 255); UPDATE_GOLDENS=1 if that was intended`)
    }
  }
})
