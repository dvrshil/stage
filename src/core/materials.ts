// The built-in materials, by the names the scene file uses. Each is a
// photographed texture set when downloaded, and a pattern drawn in code
// until then, so a scene renders either way.

export interface Material {
  color: string
  roughness: number
  metalness?: number
  // A photographed CC0 texture set from Poly Haven, mapped at the real size
  // Poly Haven records for it. Used once `stage assets fetch` has it.
  texture?: string
  // Paint over a texture: the photographed color is multiplied by `color`,
  // so one plaster relief serves every paint.
  tint?: boolean
  // The pattern drawn in code when the texture set isn't downloaded:
  // planks 18 cm wide, or tiles of `tile` meters.
  pattern?: 'planks' | 'tiles' | 'speckle'
  tile?: number
}

// The sky: a photographed, sky-only HDRI, for daylight, reflections, and
// the view out of the windows.
export const SKY = 'kloofendal_48d_partly_cloudy_puresky'

export const MATERIALS: Record<string, Material> = {
  'plaster-white': { color: '#f1ede6', roughness: 0.95, texture: 'plastered_wall_04', tint: true },
  'paint-sage': { color: '#bfcbb4', roughness: 0.9, texture: 'plastered_wall_04', tint: true },
  'paint-navy': { color: '#34446a', roughness: 0.9, texture: 'plastered_wall_04', tint: true },
  'paint-terracotta': { color: '#c97558', roughness: 0.9, texture: 'plastered_wall_04', tint: true },
  'oak-plank': { color: '#b48a5a', roughness: 0.7, texture: 'laminate_floor_02', pattern: 'planks' },
  'herringbone-oak': { color: '#b8894f', roughness: 0.7, texture: 'herringbone_parquet', pattern: 'planks' },
  'wood-dark': { color: '#6a4a33', roughness: 0.65, texture: 'dark_wooden_planks', pattern: 'planks' },
  'tile-grey': { color: '#a3a3a0', roughness: 0.45, texture: 'granite_tile', pattern: 'tiles', tile: 0.6 },
  'tile-white': { color: '#e4e4e0', roughness: 0.4, pattern: 'tiles', tile: 0.3 },
  'terrazzo': { color: '#c9b39a', roughness: 0.4, texture: 'terrazzo_tiles', pattern: 'speckle' },
  'concrete': { color: '#8c8c88', roughness: 0.85, texture: 'concrete_floor_02', pattern: 'speckle' },
  'carpet-beige': { color: '#c9bba4', roughness: 1, pattern: 'speckle' },
  'marble-white': { color: '#efede8', roughness: 0.3, texture: 'marble_01', pattern: 'tiles', tile: 0.8 },
  'brick-red': { color: '#9a4a3a', roughness: 0.9 },
}

export const DEFAULT_MATERIALS = {
  floor: 'oak-plank',
  walls: 'plaster-white',
  ceiling: 'plaster-white',
}

export function materialNames(): string[] {
  return Object.keys(MATERIALS)
}
