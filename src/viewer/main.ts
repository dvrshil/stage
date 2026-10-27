import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { check, type Problem } from '../core/check.ts'
import { sceneBounds } from '../core/geometry.ts'
import type { Scene } from '../core/schema.ts'
import { applyCutaway, buildScene, toWorld, type Built } from './build.ts'

// The viewer. The same page serves a person in a browser and the command
// line's headless renders (?headless), so the agent and the person always
// see the same pixels.

const params = new URLSearchParams(location.search)
const scenePath = params.get('scene')
const headless = params.has('headless')
const $ = (id: string) => document.getElementById(id)!
if (headless) document.body.classList.add('headless')

const canvas = $('view') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: headless })
renderer.setPixelRatio(headless ? 1 : Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const world = new THREE.Scene()
world.background = new THREE.Color('#e8e5df')
const pmrem = new THREE.PMREMGenerator(renderer)
world.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
world.environmentIntensity = 0.35
world.add(new THREE.HemisphereLight('#ffffff', '#b9b3a8', 1.1))

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#dcd8d0', roughness: 1 }))
ground.rotation.x = -Math.PI / 2
ground.position.y = -0.01
ground.receiveShadow = true
world.add(ground)

const perspective = new THREE.PerspectiveCamera(60, 1, 0.05, 500)
const plan = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500)
let active: THREE.Camera = perspective
const orbit = new OrbitControls(perspective, canvas)
orbit.enableDamping = !headless
orbit.maxPolarAngle = Math.PI * 0.495
const walk = new PointerLockControls(perspective, document.body)

let scene: Scene | undefined
let built: Built | undefined
let cameraIds: string[] = []
let cameraIndex = 0
let previous = new Map<string, string>()
const highlights: { helper: THREE.BoxHelper; until: number }[] = []
let labelsOn = true
// What the person is looking through; room labels show only in the overviews.
let view: 'orbit' | 'plan' | 'camera' | 'walk' | 'focus' = 'orbit'
let selected: string | undefined
let lastUpdate = 0

function resize() {
  const width = headless ? Number(params.get('w') ?? 1280) : window.innerWidth
  const height = headless ? Number(params.get('h') ?? 720) : window.innerHeight
  renderer.setSize(width, height, !headless)
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
  const aspect = perspective.aspect
  let halfW = (b.max[0] - b.min[0]) / 2 + margin
  let halfH = (b.max[1] - b.min[1]) / 2 + margin
  if (halfW / halfH > aspect) halfH = halfW / aspect
  else halfW = halfH * aspect
  plan.left = -halfW
  plan.right = halfW
  plan.top = halfH
  plan.bottom = -halfH
  plan.position.copy(toWorld([cx, cy], 50))
  plan.up.set(0, 0, -1)
  plan.lookAt(toWorld([cx, cy], 0))
  plan.updateProjectionMatrix()
}

// The default overview: from the southwest, high enough to see into every
// room, since ceilings are left off.
function overview() {
  if (!scene) return
  const b = sceneBounds(scene)
  const cx = (b.min[0] + b.max[0]) / 2
  const cy = (b.min[1] + b.max[1]) / 2
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1])
  const target = toWorld([cx, cy], 0.6)
  perspective.fov = 45
  perspective.position.copy(target).add(new THREE.Vector3(-0.4 * size, 1.05 * size, 0.8 * size))
  orbit.target.copy(target)
  perspective.updateProjectionMatrix()
}

function useCamera(id: string) {
  if (!scene) return
  if (walk.isLocked) walk.unlock()
  const camera = scene.cameras.find((c) => c.id === id)
  const type = id === 'plan' ? 'plan' : id === 'orbit' ? 'orbit' : camera?.type ?? 'orbit'
  if (type === 'plan') {
    active = plan
    orbit.enabled = false
    fitPlan()
  } else if (type === 'orbit' || !camera?.at || !camera.look) {
    active = perspective
    orbit.enabled = true
    overview()
  } else {
    active = perspective
    orbit.enabled = true
    perspective.fov = camera.fov
    perspective.position.copy(toWorld([camera.at[0], camera.at[1]], camera.at[2]))
    orbit.target.copy(toWorld([camera.look[0], camera.look[1]], camera.look[2]))
    perspective.updateProjectionMatrix()
  }
  orbit.update()
  cameraIndex = Math.max(0, cameraIds.indexOf(id))
  view = type === 'plan' ? 'plan' : active === perspective && (type === 'orbit' || !camera?.at) ? 'orbit' : 'camera'
  updateLabels()
  $('camera').textContent = `camera: ${id}`
}

function updateLabels() {
  if (built) built.labels.visible = labelsOn && (view === 'plan' || view === 'orbit')
}

function startWalk() {
  if (!scene) return
  const door = scene.cameras.find((c) => c.at && c.look && c.type === 'perspective')
  active = perspective
  orbit.enabled = false
  perspective.fov = 75
  perspective.updateProjectionMatrix()
  if (door?.at) {
    perspective.position.copy(toWorld([door.at[0], door.at[1]], 1.6))
    if (door.look) perspective.lookAt(toWorld([door.look[0], door.look[1]], 1.6))
  }
  view = 'walk'
  updateLabels()
  $('camera').textContent = 'camera: walking'
  walk.lock()
}

const keys = new Set<string>()
window.addEventListener('keydown', (event) => {
  keys.add(event.code)
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'c' || event.key === 'C') {
    cameraIndex = (cameraIndex + 1) % cameraIds.length
    useCamera(cameraIds[cameraIndex])
  } else if (event.key === 'o' || event.key === 'O') useCamera('orbit')
  else if (event.key === 'p' || event.key === 'P') useCamera('plan')
  else if (event.key === 'v' || event.key === 'V') startWalk()
  else if (event.key === 'l' || event.key === 'L') {
    labelsOn = !labelsOn
    updateLabels()
  } else if (event.key === '?') $('help').classList.toggle('hidden')
})
window.addEventListener('keyup', (event) => keys.delete(event.code))
walk.addEventListener('unlock', () => useCamera(cameraIds[cameraIndex] ?? 'orbit'))

// Click an item to learn its id, so a person can say "move the sofa" and
// the agent knows exactly which entity that is.
const raycaster = new THREE.Raycaster()
canvas.addEventListener('click', (event) => {
  if (!built || walk.isLocked) return
  const rect = canvas.getBoundingClientRect()
  const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, active)
  const hits = raycaster.intersectObjects(built.root.children, true)
  const ids = new Set(built.entities.keys())
  for (const hit of hits) {
    let object: THREE.Object3D | null = hit.object
    while (object && !(object.name && ids.has(object.name))) object = object.parent
    if (object) {
      select(object.name)
      return
    }
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
  const detail = item
    ? `${item.asset} in ${item.room} at [${item.at.join(', ')}], facing ${item.facing}°`
    : room
      ? `room${room.name ? `, ${room.name}` : ''}`
      : opening
        ? `${opening.type} on ${opening.wall.room} edge ${opening.wall.edge}, ${opening.width} m wide`
        : ''
  panel.innerHTML = `<code>${id}</code> ${escape(detail)}`
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
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = Math.max(1.5, box.getSize(new THREE.Vector3()).length())
  active = perspective
  orbit.enabled = true
  perspective.fov = 50
  perspective.updateProjectionMatrix()
  orbit.target.copy(center)
  perspective.position.copy(center).add(new THREE.Vector3(-0.6 * size, 0.9 * size, 1.1 * size))
  orbit.update()
  view = 'focus'
  updateLabels()
  $('camera').textContent = `focus: ${id}`
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
  if (built.sun) {
    const b = sceneBounds(next)
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 + 2
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
  cameraIds = ['orbit', 'plan', ...next.cameras.filter((c) => c.type === 'perspective').map((c) => c.id)]

  if (first) {
    resize()
    useCamera(params.get('camera') ?? 'orbit')
  } else {
    fitPlan()
    updateLabels()
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
}

const clock = new THREE.Clock()
function frame() {
  const delta = Math.min(clock.getDelta(), 0.1)
  if (walk.isLocked) {
    const speed = (keys.has('ShiftLeft') ? 4 : 2) * delta
    if (keys.has('KeyW') || keys.has('ArrowUp')) walk.moveForward(speed)
    if (keys.has('KeyS') || keys.has('ArrowDown')) walk.moveForward(-speed)
    if (keys.has('KeyA') || keys.has('ArrowLeft')) walk.moveRight(-speed)
    if (keys.has('KeyD') || keys.has('ArrowRight')) walk.moveRight(speed)
    perspective.position.y = 1.6
  } else if (orbit.enabled) {
    orbit.update()
  }
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
  renderer.render(world, active)
}

async function start() {
  try {
    resize()
    await load(true)
    if (headless) {
      // Two frames: the first fills the shadow maps.
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
