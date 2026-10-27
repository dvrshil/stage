import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { findAsset } from '../core/assets.ts'
import { check, type Problem } from '../core/check.ts'
import { alongWall, centroid, distanceToSegment, pointInPolygon, sceneBounds, wallPieces, walls, type Point } from '../core/geometry.ts'
import { SKY } from '../core/materials.ts'
import type { Scene } from '../core/schema.ts'
import { applyCutaway, buildScene, toWorld, type Built } from './build.ts'
import { useSurfaces } from './furniture.ts'
import { loadLibrary, loadSky, settled, type Sky } from './library.ts'
import { speckle } from './textures.ts'

// The viewer. The same page serves a person in a browser and the command
// line's headless renders (?headless), so the agent and the person always
// see the same pixels.

const params = new URLSearchParams(location.search)
const scenePath = params.get('scene')
const headless = params.has('headless')
const BUILD = document.querySelector<HTMLMetaElement>('meta[name="stage-build"]')?.content ?? ''
const $ = (id: string) => document.getElementById(id)!
if (headless) document.body.classList.add('headless')

// Eye height and lens for walking: a 1.75 m adult's eyes, and about a 24 mm
// lens, which reads as natural on a screen without stretching the room.
const EYE = 1.6
const WALK_FOV = 58
const WALK_SPEED = 1.4
const RUN_SPEED = 3
const BODY_RADIUS = 0.22

const canvas = $('view') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: headless })
renderer.setPixelRatio(headless ? 1 : Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const world = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
world.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
// Low: a bright studio reflection washes floors out at low angles.
world.environmentIntensity = 0.18
const hemisphere = new THREE.HemisphereLight('#e3ecf7', '#8d8270', 0.9)
world.add(hemisphere)
// A drawn gradient until the photographed sky loads.
const dome = sky()
world.add(dome)
world.add(lawn())

function sky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color('#6f9ccf') },
      horizon: { value: new THREE.Color('#e6edf2') },
      below: { value: new THREE.Color('#b4bfa6') },
    },
    vertexShader: 'varying vec3 vDirection; void main() { vDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform vec3 zenith; uniform vec3 horizon; uniform vec3 below; varying vec3 vDirection; void main() { float h = vDirection.y; vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, below, pow(-h, 0.35)); gl_FragColor = vec4(c, 1.0); \n#include <colorspace_fragment>\n }',
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), material)
  mesh.renderOrder = -1
  return mesh
}

// A lawn with UVs in meters, so its texture reads at real size.
function lawn(): THREE.Mesh {
  const size = 300
  const geometry = new THREE.PlaneGeometry(size, size)
  const uv = geometry.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: speckle('#7c9160', 2, 0.1, 5), roughness: 1 }))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = -0.02
  mesh.receiveShadow = true
  return mesh
}

const perspective = new THREE.PerspectiveCamera(WALK_FOV, 1, 0.05, 900)
const plan = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500)
let active: THREE.Camera = perspective
const orbit = new OrbitControls(perspective, canvas)
orbit.enableDamping = !headless
orbit.maxPolarAngle = Math.PI * 0.495
const look = new PointerLockControls(perspective, document.body)

// Ambient occlusion: the darkening where walls meet floors and under
// furniture, which direct light alone never gives. Perspective views only.
const composer = new EffectComposer(renderer)
const renderPass = new RenderPass(world, perspective)
const ao = new GTAOPass(world, perspective, 1280, 720)
ao.updateGtaoMaterial({ radius: 0.3, distanceExponent: 2, thickness: 0.6, scale: 1, samples: 16 })
ao.blendIntensity = 0.85
composer.addPass(renderPass)
composer.addPass(ao)
composer.addPass(new OutputPass())

// High quality until frames get slow (a machine without a GPU), then fast:
// no ambient occlusion, one pixel per pixel. Q switches by hand.
let quality: 'high' | 'fast' = params.get('quality') === 'fast' ? 'fast' : 'high'
let slowFrames = 0
function setQuality(next: 'high' | 'fast', why: string) {
  quality = next
  slowFrames = 0
  renderer.setPixelRatio(headless || next === 'fast' ? 1 : Math.min(window.devicePixelRatio, 2))
  resize()
  setStatus(why)
}

let skyImage: Sky | undefined
async function applySky() {
  skyImage = await loadSky(SKY)
  if (!skyImage) return
  world.remove(dome)
  world.background = skyImage.texture
  world.environment = pmrem.fromEquirectangular(skyImage.texture).texture
  alignSky()
  applyView(view, $('camera').textContent ?? '')
}

// Turns the photographed sky so its sun stands where the scene's sun does,
// and the light from the sky agrees with the shadows.
function alignSky() {
  if (!skyImage || !scene) return
  const sun = scene.lights.find((light) => light.type === 'sun')
  const azimuth = THREE.MathUtils.degToRad(sun?.azimuth ?? 220)
  const turn = skyImage.sunAngle - Math.atan2(-Math.cos(azimuth), Math.sin(azimuth))
  world.environmentRotation.y = turn
  world.backgroundRotation.y = turn
}

type View = 'orbit' | 'plan' | 'camera' | 'walk' | 'focus'
let view: View = 'orbit'
let scene: Scene | undefined
let built: Built | undefined
let previous = new Map<string, string>()
const highlights: { helper: THREE.BoxHelper; until: number }[] = []
let labelsOn = true
let selected: string | undefined
let lastUpdate = 0

function resize() {
  const width = headless ? Number(params.get('w') ?? 1280) : window.innerWidth
  const height = headless ? Number(params.get('h') ?? 720) : window.innerHeight
  renderer.setSize(width, height, !headless)
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(width, height)
  perspective.aspect = width / height
  perspective.updateProjectionMatrix()
  fitPlan()
}
window.addEventListener('resize', resize)

function fitPlan() {
  if (!scene) return
  const b = sceneBounds(scene)
  const margin = 1
  const cx = (b.min[0] + b.max[0]) / 2
  const cy = (b.min[1] + b.max[1]) / 2
  let halfW = (b.max[0] - b.min[0]) / 2 + margin
  let halfH = (b.max[1] - b.min[1]) / 2 + margin
  if (halfW / halfH > perspective.aspect) halfH = halfW / perspective.aspect
  else halfW = halfH * perspective.aspect
  plan.left = -halfW
  plan.right = halfW
  plan.top = halfH
  plan.bottom = -halfH
  plan.position.copy(toWorld([cx, cy], 50))
  plan.up.set(0, 0, -1)
  plan.lookAt(toWorld([cx, cy], 0))
  plan.updateProjectionMatrix()
}

// What each view shows: ceilings and room lights inside, room labels and
// the dollhouse cutaway from above.
function applyView(next: View, label: string) {
  view = next
  if (built) {
    built.labels.visible = labelsOn && (view === 'plan' || view === 'orbit')
    for (const object of built.indoor) object.visible = view === 'camera' || view === 'walk'
  }
  // Outdoors the sky fills the overviews; inside, the windows and room
  // lights do the work, and sky light that would leak through walls is cut.
  const inside = view === 'camera' || view === 'walk'
  hemisphere.intensity = skyImage ? (inside ? 0.5 : 0.45) : inside ? 0.55 : 0.9
  world.environmentIntensity = skyImage ? (inside ? 0.55 : 0.85) : 0.18
  $('camera').textContent = label
  for (const button of document.querySelectorAll<HTMLButtonElement>('#toolbar button')) {
    button.classList.toggle('active', button.dataset.camera === label.replace(/^.*: /, ''))
  }
}

// The overview: from the southwest, high enough to see into every room.
function overview() {
  if (!scene) return
  const b = sceneBounds(scene)
  const cx = (b.min[0] + b.max[0]) / 2
  const cy = (b.min[1] + b.max[1]) / 2
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 4)
  const target = toWorld([cx, cy], 0.5)
  perspective.fov = 40
  perspective.updateProjectionMatrix()
  orbit.target.copy(target)
  perspective.position.copy(target).add(new THREE.Vector3(-0.42, 0.8, 0.66).normalize().multiplyScalar(size * 1.35))
}

function useCamera(id: string) {
  if (!scene) return
  if (look.isLocked) look.unlock()
  const camera = scene.cameras.find((c) => c.id === id)
  if (id === 'plan' || camera?.type === 'plan') {
    active = plan
    orbit.enabled = false
    fitPlan()
    applyView('plan', 'camera: plan')
    return
  }
  active = perspective
  orbit.enabled = true
  if (id === 'orbit' || !camera?.at || !camera.look) {
    overview()
    applyView('orbit', 'camera: orbit')
  } else {
    perspective.fov = camera.fov
    perspective.updateProjectionMatrix()
    perspective.position.copy(toWorld([camera.at[0], camera.at[1]], camera.at[2]))
    orbit.target.copy(toWorld([camera.look[0], camera.look[1]], camera.look[2]))
    applyView('camera', `camera: ${id}`)
  }
  orbit.update()
}

// ---- Walking --------------------------------------------------------------

interface Wall2D { a: Point; b: Point; half: number }
interface Solid { x: number; y: number; halfW: number; halfD: number; angle: number }
let blockers: Wall2D[] = []
let solids: Solid[] = []

function computeObstacles(s: Scene) {
  blockers = []
  for (const wall of walls(s)) {
    // Anything solid below waist height stops you; a lintel over a door does not.
    for (const piece of wallPieces(wall)) {
      if (piece.bottom < 1) blockers.push({ a: alongWall(wall, piece.from), b: alongWall(wall, piece.to), half: wall.thickness / 2 })
    }
  }
  solids = []
  for (const item of s.items) {
    if (item.asset === 'rug/area' || item.asset === 'kitchen/wall-cabinets') continue
    const size = findAsset(item.asset)?.size ?? item.size
    if (!size) continue
    solids.push({ x: item.at[0], y: item.at[1], halfW: (size[0] * item.scale) / 2, halfD: (size[1] * item.scale) / 2, angle: THREE.MathUtils.degToRad(item.facing) })
  }
}

function blocked([x, y]: Point): boolean {
  for (const w of blockers) if (distanceToSegment([x, y], w.a, w.b) < w.half + BODY_RADIUS) return true
  for (const s of solids) {
    // Into the item's own frame: facing turns it clockwise from north.
    const dx = x - s.x
    const dy = y - s.y
    const lx = dx * Math.cos(s.angle) - dy * Math.sin(s.angle)
    const ly = dx * Math.sin(s.angle) + dy * Math.cos(s.angle)
    if (Math.abs(lx) < s.halfW + 0.12 && Math.abs(ly) < s.halfD + 0.12) return true
  }
  return false
}

function insideAnyRoom(p: Point): boolean {
  return !!scene?.rooms.some((room) => pointInPolygon(p, room.floor))
}

// The nearest free spot to `p`, searching outward in rings.
function freeSpot(p: Point): Point {
  if (!blocked(p)) return p
  for (let r = 0.2; r < 3; r += 0.2) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const q: Point = [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)]
      if (!blocked(q) && insideAnyRoom(q)) return q
    }
  }
  return p
}

function startWalk() {
  if (!scene) return
  active = perspective
  orbit.enabled = false
  perspective.fov = WALK_FOV
  perspective.updateProjectionMatrix()
  let at: Point = [perspective.position.x, -perspective.position.z]
  // From an overview, step in at the first eye-level camera, or the middle
  // of the first room.
  if (view === 'orbit' || view === 'plan' || view === 'focus' || !insideAnyRoom(at)) {
    const camera = scene.cameras.find((c) => c.type === 'perspective' && c.at && c.look)
    at = camera?.at ? [camera.at[0], camera.at[1]] : centroid(scene.rooms[0].floor)
    perspective.position.copy(toWorld(freeSpot(at), EYE))
    if (camera?.look) perspective.lookAt(toWorld([camera.look[0], camera.look[1]], EYE))
  } else {
    perspective.position.copy(toWorld(freeSpot(at), EYE))
  }
  applyView('walk', 'camera: walk')
  look.lock()
}

const keys = new Set<string>()
function walkStep(delta: number) {
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED) * delta
  const direction = perspective.getWorldDirection(new THREE.Vector3())
  const forward: Point = [direction.x, -direction.z]
  const length = Math.hypot(forward[0], forward[1]) || 1
  forward[0] /= length
  forward[1] /= length
  const right: Point = [forward[1], -forward[0]]
  let f = 0
  let r = 0
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1
  if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1
  if (f === 0 && r === 0) return
  const norm = Math.hypot(f, r)
  const dx = ((forward[0] * f + right[0] * r) / norm) * speed
  const dy = ((forward[1] * f + right[1] * r) / norm) * speed
  const here: Point = [perspective.position.x, -perspective.position.z]
  // Slide along whatever stops you instead of sticking to it.
  const candidates: Point[] = [[here[0] + dx, here[1] + dy], [here[0] + dx, here[1]], [here[0], here[1] + dy]]
  const next = candidates.find((p) => !blocked(p))
  if (next) perspective.position.set(next[0], EYE, -next[1])
}

window.addEventListener('keydown', (event) => {
  keys.add(event.code)
  if (event.ctrlKey || event.metaKey || event.altKey || look.isLocked) return
  const key = event.key.toLowerCase()
  if (key === 'c') cycleCamera()
  else if (key === 'o') useCamera('orbit')
  else if (key === 'p') useCamera('plan')
  else if (key === 'v') startWalk()
  else if (key === 'q') setQuality(quality === 'high' ? 'fast' : 'high', quality === 'high' ? 'Fast rendering: press Q for high quality.' : 'High quality.')
  else if (key === 'l') {
    labelsOn = !labelsOn
    applyView(view, $('camera').textContent ?? '')
  } else if (event.key === '?') $('help').classList.toggle('hidden')
})
window.addEventListener('keyup', (event) => keys.delete(event.code))
look.addEventListener('lock', () => document.body.classList.add('walking'))
look.addEventListener('unlock', () => {
  document.body.classList.remove('walking')
  keys.clear()
  // Stay where you stopped walking, looking where you looked.
  if (view === 'walk') {
    orbit.target.copy(perspective.position).add(perspective.getWorldDirection(new THREE.Vector3()).multiplyScalar(1.5))
    orbit.enabled = true
    applyView('camera', 'camera: where you stopped')
  }
})

function cameraIds(): string[] {
  return ['orbit', 'plan', ...(scene?.cameras.filter((c) => c.type === 'perspective').map((c) => c.id) ?? [])]
}

function cycleCamera() {
  const ids = cameraIds()
  const current = ($('camera').textContent ?? '').replace(/^.*: /, '')
  useCamera(ids[(ids.indexOf(current) + 1) % ids.length])
}

function buildToolbar() {
  const toolbar = $('toolbar')
  const ids = cameraIds()
  const label = (id: string) => (id === 'orbit' ? 'Overview' : id === 'plan' ? 'Plan' : id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()))
  toolbar.innerHTML = ''
  for (const id of ids) {
    const button = document.createElement('button')
    button.textContent = label(id)
    button.dataset.camera = id
    button.addEventListener('click', () => useCamera(id))
    toolbar.append(button)
  }
  const walk = document.createElement('button')
  walk.textContent = 'Walk inside'
  walk.className = 'walk'
  walk.dataset.camera = 'walk'
  walk.addEventListener('click', () => startWalk())
  toolbar.append(walk)
}

// ---- Selecting and showing -------------------------------------------------

// Click an item to learn its id, so a person can say "move the sofa" and
// the agent knows exactly which entity that is.
const raycaster = new THREE.Raycaster()
canvas.addEventListener('click', (event) => {
  if (!built || look.isLocked) return
  const rect = canvas.getBoundingClientRect()
  const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, active)
  const ids = new Set(built.entities.keys())
  for (const hit of raycaster.intersectObjects(built.root.children, true)) {
    if (!hit.object.visible) continue
    let object: THREE.Object3D | null = hit.object
    while (object && !(object.name && ids.has(object.name))) object = object.parent
    if (object) return select(object.name)
  }
  select(undefined)
})

function select(id: string | undefined) {
  selected = id
  const panel = $('selection')
  if (!id || !scene) {
    panel.classList.add('hidden')
    return
  }
  const item = scene.items.find((i) => i.id === id)
  const room = scene.rooms.find((r) => r.id === id)
  const opening = scene.openings.find((o) => o.id === id)
  const size = item ? (findAsset(item.asset)?.size ?? item.size) : undefined
  const detail = item
    ? `${findAsset(item.asset)?.name ?? item.asset} in ${item.room} at [${item.at.join(', ')}]${size ? `, ${size.map((n) => n.toFixed(2)).join(' × ')} m` : ''}`
    : room
      ? `room${room.name ? `, ${room.name}` : ''}`
      : opening
        ? `${opening.type} on ${opening.wall.room} edge ${opening.wall.edge}, ${opening.width} m wide`
        : ''
  panel.innerHTML = `<code>${escape(id)}</code> ${escape(detail)}`
  panel.classList.remove('hidden')
  highlight([id], 1600)
}

function highlight(ids: string[], duration: number) {
  if (!built) return
  for (const id of ids) {
    const object = built.entities.get(id)
    if (!object || object instanceof THREE.Light) continue
    const helper = new THREE.BoxHelper(object, new THREE.Color('#e8b43a'))
    world.add(helper)
    highlights.push({ helper, until: performance.now() + duration })
  }
}

function focus(id: string) {
  if (!built || !scene) return
  const object = built.entities.get(id)
  if (!object) return
  if (look.isLocked) look.unlock()
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = Math.max(2.5, box.getSize(new THREE.Vector3()).length() * 1.6)
  active = perspective
  orbit.enabled = true
  perspective.fov = 45
  perspective.updateProjectionMatrix()
  orbit.target.copy(center)
  perspective.position.copy(center).add(new THREE.Vector3(-0.5, 0.75, 0.9).normalize().multiplyScalar(size))
  orbit.update()
  applyView('focus', `focus: ${id}`)
  select(id)
}

function entityFingerprints(s: Scene): Map<string, string> {
  const map = new Map<string, string>()
  for (const list of [s.rooms, s.openings, s.items, s.lights, s.cameras]) {
    for (const entity of list) map.set(entity.id, JSON.stringify(entity))
  }
  return map
}

function showProblems(problems: Problem[]) {
  const panel = $('problems')
  if (problems.length === 0) {
    panel.classList.add('hidden')
    return
  }
  panel.innerHTML = problems
    .map((p) => `<div class="${p.severity}">${p.severity}: ${p.entity ? `<code>${escape(p.entity)}</code> ` : ''}${escape(p.message)}</div>`)
    .join('')
  panel.classList.remove('hidden')
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

// ---- Loading and live updates ----------------------------------------------

async function load(first: boolean): Promise<void> {
  if (!scenePath) throw new Error('no scene: open this page with ?scene=/path/to/scene.json')
  const response = await fetch(`./api/scene?path=${encodeURIComponent(scenePath)}`, { cache: 'no-store' })
  const body = (await response.json()) as { scene?: unknown; error?: string }
  if (body.error) throw new Error(body.error)
  const result = check(body.scene)
  showProblems(result.problems)
  if (!result.scene) {
    // Keep showing the last good build; the problems say what to fix.
    setStatus(first ? 'The scene has errors and cannot be built yet.' : 'The last change has errors; showing the previous version.')
    if (first) throw new Error(result.problems.map((p) => p.message).join('; '))
    return
  }

  const next = result.scene
  const fingerprints = entityFingerprints(next)
  const changed = first ? [] : [...fingerprints].filter(([id, json]) => previous.get(id) !== json).map(([id]) => id)
  previous = fingerprints

  if (built) world.remove(built.root)
  scene = next
  built = buildScene(next)
  world.add(built.root)
  computeObstacles(next)
  alignSky()
  if (built.sun) {
    const b = sceneBounds(next)
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 + 3
    const cx = (b.min[0] + b.max[0]) / 2
    const cy = (b.min[1] + b.max[1]) / 2
    built.sun.target.position.copy(toWorld([cx, cy], 0))
    built.sun.position.add(built.sun.target.position)
    const shadow = built.sun.shadow.camera
    shadow.left = -size
    shadow.right = size
    shadow.top = size
    shadow.bottom = -size
    shadow.far = 80
    shadow.updateProjectionMatrix()
  }
  $('title').textContent = next.name
  document.title = `${next.name} · Stage`
  buildToolbar()

  if (first) {
    resize()
    if (!restoreView()) useCamera(params.get('camera') ?? 'orbit')
  } else {
    fitPlan()
    applyView(view, $('camera').textContent ?? '')
    if (changed.length > 0) highlight(changed, 2500)
    if (selected && !fingerprints.has(selected)) select(undefined)
  }
  lastUpdate = Date.now()
  setStatus(changed.length > 0 ? `Changed: ${changed.map((id) => `<code>${escape(id)}</code>`).join(', ')}` : '')
  if (!first) {
    $('status').classList.add('flash')
    setTimeout(() => $('status').classList.remove('flash'), 900)
  }
}

// The view survives a reload (a new build, or F5), so iterating doesn't
// throw the person back to the overview every time.
const stateKey = `stage:view:${scenePath}`
function saveView() {
  if (headless || !scene) return
  try {
    sessionStorage.setItem(stateKey, JSON.stringify({ view, label: $('camera').textContent, position: perspective.position.toArray(), target: orbit.target.toArray(), fov: perspective.fov }))
  } catch {}
}
function restoreView(): boolean {
  if (headless || params.has('camera')) return false
  try {
    const saved = JSON.parse(sessionStorage.getItem(stateKey) ?? 'null') as { view: View; label: string; position: number[]; target: number[]; fov: number } | null
    if (!saved) return false
    if (saved.view === 'plan') {
      useCamera('plan')
      return true
    }
    active = perspective
    orbit.enabled = true
    perspective.fov = saved.fov
    perspective.updateProjectionMatrix()
    perspective.position.fromArray(saved.position)
    orbit.target.fromArray(saved.target)
    orbit.update()
    applyView(saved.view === 'walk' ? 'camera' : saved.view, saved.label)
    return true
  } catch {
    return false
  }
}
setInterval(saveView, 1000)

let statusDetail = ''
function setStatus(detail: string) {
  statusDetail = detail
  renderStatus()
}
function renderStatus() {
  const ago = lastUpdate ? Math.round((Date.now() - lastUpdate) / 1000) : 0
  const when = lastUpdate ? (ago < 2 ? 'updated just now' : ago < 60 ? `updated ${ago}s ago` : `updated ${Math.round(ago / 60)} min ago`) : ''
  $('status').innerHTML = `<span class="live">● Live</span> ${when}${statusDetail ? ` · ${statusDetail}` : ''}`
}
setInterval(() => !headless && renderStatus(), 1000)

function listen() {
  if (!scenePath) return
  const events = new EventSource(`./api/events?path=${encodeURIComponent(scenePath)}`)
  events.addEventListener('change', () => load(false).catch((error) => setStatus(escape(String(error.message ?? error)))))
  events.addEventListener('control', (event) => {
    const message = JSON.parse((event as MessageEvent).data) as { camera?: string; focus?: string }
    if (message.camera) useCamera(message.camera)
    if (message.focus) focus(message.focus)
  })
  // A new viewer build reloads the page, keeping the view.
  events.addEventListener('hello', (event) => {
    const { build } = JSON.parse((event as MessageEvent).data) as { build?: string }
    if (build && BUILD && build !== BUILD) {
      saveView()
      location.reload()
    }
  })
}

const clock = new THREE.Clock()
function frame() {
  const delta = Math.min(clock.getDelta(), 0.1)
  if (look.isLocked) walkStep(delta)
  else if (orbit.enabled) orbit.update()
  const now = performance.now()
  for (let i = highlights.length - 1; i >= 0; i--) {
    const h = highlights[i]
    if (now > h.until) {
      world.remove(h.helper)
      highlights.splice(i, 1)
    } else {
      h.helper.update()
    }
  }
  if (built) applyCutaway(built.root, active, view === 'orbit' || view === 'focus')
  if (quality === 'high' && active === perspective) {
    renderPass.camera = perspective
    ao.camera = perspective
    composer.render(delta)
  } else {
    renderer.render(world, active)
  }
  if (!headless && quality === 'high') {
    slowFrames = delta > 0.05 ? slowFrames + 1 : Math.max(0, slowFrames - 2)
    if (slowFrames > 90) setQuality('fast', 'Switched to fast rendering because this machine draws slowly. Press Q for high quality.')
  }
}

async function start() {
  try {
    // Each phase is recorded, so a render that times out says where it stopped.
    const phase = (name: string) => (document.body.dataset.phase = name)
    resize()
    phase('library')
    await loadLibrary()
    useSurfaces()
    phase('scene')
    await load(true)
    phase('sky')
    await applySky()
    if (headless) {
      phase('textures')
      await settled()
      phase('frames')
      // A few frames: the first fills the shadow maps.
      frame()
      frame()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      frame()
      document.body.dataset.ready = '1'
    } else {
      listen()
      renderer.setAnimationLoop(frame)
    }
  } catch (error) {
    document.body.dataset.ready = 'error'
    document.body.dataset.error = String((error as Error).message ?? error)
    setStatus(escape(document.body.dataset.error))
  }
}

start()
