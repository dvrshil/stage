import { z } from 'zod'

// The scene format, version 0.1. Everything an agent writes is validated
// here first, so an error names the exact entity and field.
//
// Conventions: meters and degrees. Positions are plan coordinates [x, y] on
// the floor, x east and y north, plus an elevation. `facing` 0 points north
// and 90 east. Every entity has a lowercase id, unique in the file.

export const FORMAT_VERSION = '0.1'

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'an id is lowercase letters, digits, and hyphens')

const point = z.tuple([z.number(), z.number()])
const point3 = z.tuple([z.number(), z.number(), z.number()])

export const Level = z.object({
  id,
  elevation: z.number().default(0),
  height: z.number().positive().default(2.7),
})

export const Room = z.object({
  id,
  level: id.default('ground'),
  name: z.string().optional(),
  floor: z.array(point).min(3, 'a floor needs at least three corners'),
  height: z.number().positive().optional(),
  materials: z
    .object({
      floor: z.string().optional(),
      walls: z.string().optional(),
      ceiling: z.string().optional(),
    })
    .optional(),
})

// An opening sits on edge n of a room, which runs from floor[n] to
// floor[n+1]; `at` is measured along that edge from floor[n].
export const Opening = z.object({
  id,
  wall: z.object({ room: id, edge: z.number().int().min(0) }),
  at: z.number().min(0),
  type: z.enum(['door', 'window', 'opening']),
  width: z.number().positive(),
  height: z.number().positive(),
  sill: z.number().min(0).optional(),
  swing: z.enum(['in-left', 'in-right', 'out-left', 'out-right']).optional(),
})

export const Item = z.object({
  id,
  asset: z.string(),
  room: id,
  at: point,
  facing: z.number().default(0),
  elevation: z.number().default(0),
  // Width (x), depth (y), height (z) in meters; used when the asset is unknown.
  size: point3.optional(),
  scale: z.number().positive().default(1),
})

export const Light = z.object({
  id,
  type: z.enum(['sun', 'point']),
  azimuth: z.number().default(220),
  elevation: z.number().default(35),
  intensity: z.number().min(0).default(1),
  color: z.string().optional(),
  at: point3.optional(),
})

export const Camera = z.object({
  id,
  type: z.enum(['perspective', 'plan', 'orbit']).default('perspective'),
  at: point3.optional(),
  look: point3.optional(),
  fov: z.number().min(10).max(150).default(70),
})

export const Scene = z.object({
  stage: z.literal(FORMAT_VERSION),
  name: z.string().min(1),
  units: z.literal('m').default('m'),
  levels: z.array(Level).min(1),
  rooms: z.array(Room).min(1),
  openings: z.array(Opening).default([]),
  items: z.array(Item).default([]),
  lights: z.array(Light).default([]),
  cameras: z.array(Camera).default([]),
})

export type Scene = z.infer<typeof Scene>
export type Level = z.infer<typeof Level>
export type Room = z.infer<typeof Room>
export type Opening = z.infer<typeof Opening>
export type Item = z.infer<typeof Item>
export type Light = z.infer<typeof Light>
export type Camera = z.infer<typeof Camera>

// The order keys are written in, so a formatted file reads top-down the
// way the schema does and a diff shows only real changes.
export const KEY_ORDER: Record<string, string[]> = {
  scene: ['stage', 'name', 'units', 'levels', 'rooms', 'openings', 'items', 'lights', 'cameras'],
  level: ['id', 'elevation', 'height'],
  room: ['id', 'level', 'name', 'floor', 'height', 'materials'],
  opening: ['id', 'wall', 'at', 'type', 'width', 'height', 'sill', 'swing'],
  item: ['id', 'asset', 'room', 'at', 'facing', 'elevation', 'size', 'scale'],
  light: ['id', 'type', 'azimuth', 'elevation', 'intensity', 'color', 'at'],
  camera: ['id', 'type', 'at', 'look', 'fov'],
}

export const COLLECTIONS = ['levels', 'rooms', 'openings', 'items', 'lights', 'cameras'] as const
export type Collection = (typeof COLLECTIONS)[number]

export function jsonSchema(): unknown {
  return z.toJSONSchema(Scene)
}
