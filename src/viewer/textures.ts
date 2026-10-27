import * as THREE from 'three'

// Procedural textures drawn at real-world sizes: planks 18 cm wide, tiles
// 60 cm square. Floors carry UVs in meters, so a texture covering `size`
// meters repeats every `size` meters and a plank is a plank's width
// whatever the room. Seeded, so every render of a scene matches.

function random(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex)
  c.offsetHSL(0, 0, amount)
  return `#${c.getHexString()}`
}

function finish(canvas: HTMLCanvasElement, meters: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1 / meters, 1 / meters)
  texture.anisotropy = 8
  return texture
}

const cache = new Map<string, THREE.Texture>()

// Staggered planks 18 cm by 1.2 m over a 2.4 m square, with a little grain.
export function planks(color: string): THREE.Texture {
  const key = `planks:${color}`
  if (cache.has(key)) return cache.get(key)!
  const meters = 2.4
  const px = 1024
  const scale = px / meters
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const g = canvas.getContext('2d')!
  const rand = random(7)
  const plankWidth = 0.18
  const plankLength = 1.2
  const rows = Math.round(meters / plankWidth)
  for (let row = 0; row <= rows; row++) {
    const offset = ((row * 0.37) % 1) * plankLength
    for (let x = -offset; x < meters; x += plankLength) {
      g.fillStyle = shade(color, (rand() - 0.5) * 0.08)
      g.fillRect(x * scale, row * plankWidth * scale, plankLength * scale, plankWidth * scale)
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = `rgba(60, 35, 15, ${0.04 + rand() * 0.05})`
        g.lineWidth = 1 + rand() * 1.5
        const y = (row * plankWidth + rand() * plankWidth) * scale
        g.beginPath()
        g.moveTo(x * scale, y)
        g.bezierCurveTo((x + 0.4) * scale, y + (rand() - 0.5) * 6, (x + 0.8) * scale, y + (rand() - 0.5) * 6, (x + plankLength) * scale, y)
        g.stroke()
      }
      g.fillStyle = 'rgba(40, 25, 12, 0.55)'
      g.fillRect(x * scale, row * plankWidth * scale, 2, plankWidth * scale)
    }
    g.fillStyle = 'rgba(40, 25, 12, 0.5)'
    g.fillRect(0, row * plankWidth * scale - 1, px, 2)
  }
  const texture = finish(canvas, meters)
  cache.set(key, texture)
  return texture
}

// Square tiles with grout lines; `size` meters per tile.
export function tiles(color: string, size: number): THREE.Texture {
  const key = `tiles:${color}:${size}`
  if (cache.has(key)) return cache.get(key)!
  const count = 4
  const meters = size * count
  const px = 1024
  const cell = px / count
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const g = canvas.getContext('2d')!
  const rand = random(11)
  g.fillStyle = shade(color, -0.12)
  g.fillRect(0, 0, px, px)
  const grout = Math.max(2, (0.004 / meters) * px)
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      g.fillStyle = shade(color, (rand() - 0.5) * 0.05)
      g.fillRect(i * cell + grout / 2, j * cell + grout / 2, cell - grout, cell - grout)
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(255, 255, 255, ${rand() * 0.04})`
        g.fillRect(i * cell + rand() * cell, j * cell + rand() * cell, 3 + rand() * 6, 3 + rand() * 6)
      }
    }
  }
  const texture = finish(canvas, meters)
  cache.set(key, texture)
  return texture
}

// Fine noise for carpet, concrete, and grass; `meters` square per repeat.
export function speckle(color: string, meters: number, strength = 0.06, seed = 3): THREE.Texture {
  const key = `speckle:${color}:${meters}:${strength}`
  if (cache.has(key)) return cache.get(key)!
  const px = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const g = canvas.getContext('2d')!
  const rand = random(seed)
  g.fillStyle = color
  g.fillRect(0, 0, px, px)
  for (let k = 0; k < 9000; k++) {
    const light = rand() > 0.5
    g.fillStyle = light ? `rgba(255, 255, 255, ${rand() * strength})` : `rgba(0, 0, 0, ${rand() * strength})`
    g.fillRect(rand() * px, rand() * px, 1 + rand() * 3, 1 + rand() * 3)
  }
  const texture = finish(canvas, meters)
  cache.set(key, texture)
  return texture
}

// A soft dark shape for the floor under furniture, where light can't reach.
let blob: THREE.Texture | undefined
export function contactShadow(): THREE.Texture {
  if (blob) return blob
  const px = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const g = canvas.getContext('2d')!
  const gradient = g.createRadialGradient(px / 2, px / 2, px * 0.18, px / 2, px / 2, px / 2)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)')
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.7)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = gradient
  g.fillRect(0, 0, px, px)
  blob = new THREE.CanvasTexture(canvas)
  return blob
}
