import type { Point } from './geometry.ts'

// Stairs as geometry both the viewer and the walker use: tread polygons to
// build, and the height of the walking line under any point, so a person
// climbs the same stair they see. Everything is in the item's own frame:
// the footprint centered on the origin, x across, y along, the open side
// (where you step on) toward -y, which is south at facing 0.

export interface Tread {
  polygon: Point[]
  // Of the top of the tread, above the stair's foot.
  top: number
  // The inner edge, from which a handrail hangs.
  inner: [Point, Point]
}

export interface Stair {
  treads: Tread[]
  riser: number
  rise: number
  // The floor under the first steps, where the stair leaves from.
  landing: Point[]
  // Height above the foot under a point, or undefined off the stair.
  height(p: Point): number | undefined
}

export const RISER = 0.17

// A straight flight running north from its open side, `w` wide, `d` long.
export function straight(w: number, d: number, rise: number): Stair {
  const n = Math.max(1, Math.round(rise / RISER))
  const riser = rise / n
  const going = d / n
  const treads: Tread[] = []
  for (let k = 0; k < n; k++) {
    const y0 = -d / 2 + k * going
    const y1 = y0 + going
    treads.push({ polygon: [[-w / 2, y0], [w / 2, y0], [w / 2, y1], [-w / 2, y1]], top: (k + 1) * riser, inner: [[w / 2, y0], [w / 2, y1]] })
  }
  return {
    treads,
    riser,
    rise,
    landing: [],
    height: ([x, y]) => (Math.abs(x) <= w / 2 && y >= -d / 2 && y <= d / 2 ? Math.min(rise, Math.max(0, ((y + d / 2) / d) * rise)) : undefined),
  }
}

// A horseshoe stair: up from the south-west corner, a quarter turn of
// winders, a straight flight east along the north side, a quarter turn
// down to the south-east corner, around a well with rounded ends. The
// common Indian house stair, climbing a full floor in a strip `d` deep.
export function horseshoe(w: number, d: number, rise: number): Stair {
  const flight = Math.min(0.95, d * 0.63)
  const r = d - flight
  const xs = -w / 2 + d
  const xe = w / 2 - d
  const walk = (r + d) / 2
  const fanLength = (Math.PI / 2) * walk
  const straightLength = Math.max(0, xe - xs)
  const total = 2 * fanLength + straightLength
  const n = Math.max(3, Math.round(rise / RISER))
  const riser = rise / n
  const nFan = Math.max(1, Math.round((n * fanLength) / total))
  const nStraight = Math.max(1, n - 2 * nFan)

  type Line = { inner: Point; outer: Point; side: 'w' | 'n' | 'e' }
  const lines: Line[] = []
  const fan = (pivot: Point, from: number, to: number, count: number, edges: ('w' | 'e')[]) => {
    for (let i = 0; i <= count; i++) {
      if (lines.length > 0 && i === 0) continue
      const a = from + ((to - from) * i) / count
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      const inner: Point = [pivot[0] + r * dx, pivot[1] + r * dy]
      let t = Infinity
      let side: 'w' | 'n' | 'e' = 'n'
      if (dy > 1e-9) {
        t = (d / 2 - pivot[1]) / dy
      }
      for (const e of edges) {
        const x = e === 'w' ? -w / 2 : w / 2
        if (Math.abs(dx) < 1e-9) continue
        const te = (x - pivot[0]) / dx
        if (te > 0 && te < t) {
          t = te
          side = e
        }
      }
      lines.push({ inner, outer: [pivot[0] + t * dx, pivot[1] + t * dy], side })
    }
  }
  fan([xs, -d / 2], Math.PI, Math.PI / 2, nFan, ['w'])
  for (let i = 1; i <= nStraight; i++) {
    const x = xs + (straightLength * i) / nStraight
    lines.push({ inner: [x, -d / 2 + r], outer: [x, d / 2], side: 'n' })
  }
  fan([xe, -d / 2], Math.PI / 2, 0, nFan, ['e'])

  const treads: Tread[] = []
  for (let k = 0; k + 1 < lines.length; k++) {
    const p = lines[k]
    const q = lines[k + 1]
    const polygon: Point[] = [p.inner, p.outer]
    if (p.side === 'w' && q.side === 'n') polygon.push([-w / 2, d / 2])
    if (p.side === 'n' && q.side === 'e') polygon.push([w / 2, d / 2])
    polygon.push(q.outer, q.inner)
    treads.push({ polygon, top: (k + 1) * riser, inner: [p.inner, q.inner] })
  }

  const landing: Point[] = [[-w / 2, -d / 2], [xs - r, -d / 2]]
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (Math.PI / 2) * (i / 8)
    landing.push([xs + r * Math.cos(a), -d / 2 + r * Math.sin(a)])
  }
  landing.push([xs, d / 2], [-w / 2, d / 2])

  const height = ([x, y]: Point): number | undefined => {
    if (Math.abs(x) > w / 2 || Math.abs(y) > d / 2) return undefined
    let s: number
    if (x < xs) {
      const dx = x - xs
      const dy = y + d / 2
      if (Math.hypot(dx, dy) < r) return undefined
      const a = Math.atan2(dy, dx)
      s = ((Math.PI - a) / (Math.PI / 2)) * fanLength
    } else if (x <= xe) {
      if (y < -d / 2 + r) return undefined
      s = fanLength + (x - xs)
    } else {
      const dx = x - xe
      const dy = y + d / 2
      if (Math.hypot(dx, dy) < r) return undefined
      const a = Math.atan2(dy, dx)
      s = fanLength + straightLength + ((Math.PI / 2 - a) / (Math.PI / 2)) * fanLength
    }
    return Math.min(rise, Math.max(0, (s / total) * rise))
  }

  return { treads, riser, rise, landing, height }
}

export function stair(kind: string, w: number, d: number, rise: number): Stair {
  return kind === 'stairs/straight' ? straight(w, d, rise) : horseshoe(w, d, rise)
}
