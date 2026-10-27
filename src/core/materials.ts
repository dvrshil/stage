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
  // A color multiplied over the photograph, keeping its detail: greener
  // grass, warmer stone.
  shade?: string
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
  // Outdoors: the house's own skin, and what the ground is made of.
  'stucco-white': { color: '#ece6da', roughness: 0.9, texture: 'white_stucco', tint: true },
  'stucco-warm': { color: '#e3d3bb', roughness: 0.9, texture: 'white_stucco', tint: true },
  'concrete-wall': { color: '#a9a7a2', roughness: 0.9, texture: 'concrete_wall_007', pattern: 'speckle' },
  'grass': { color: '#6f8f4e', roughness: 1, texture: 'leafy_grass', shade: '#a9d884', pattern: 'speckle' },
  'roof-tile': { color: '#8a4a34', roughness: 0.8, texture: 'ceramic_roof_01', pattern: 'tiles', tile: 0.3 },
  'pavers': { color: '#9d968c', roughness: 0.9, texture: 'interlocking_concrete_pavers', pattern: 'tiles', tile: 0.2 },
  'paving-stone': { color: '#b0a79a', roughness: 0.85, texture: 'precast_stone_paving', pattern: 'tiles', tile: 0.6 },
  'gravel': { color: '#c9c2b4', roughness: 1, texture: 'gravel_floor_02', pattern: 'speckle' },
  'asphalt': { color: '#3e3f41', roughness: 0.95, texture: 'asphalt_02', pattern: 'speckle' },
  'deck': { color: '#a4784e', roughness: 0.7, texture: 'wood_floor_deck', pattern: 'planks' },
  // Furniture surfaces, which floors and walls can use too.
  'oak-veneer': { color: '#b8925f', roughness: 0.6, texture: 'oak_veneer_01', pattern: 'planks' },
  'walnut-veneer': { color: '#5d4330', roughness: 0.55, texture: 'mocha_oak_veneer', pattern: 'planks' },
  'linen': { color: '#e8e2d6', roughness: 1, texture: 'rough_linen', pattern: 'speckle' },
  'wool-herringbone': { color: '#b9ab96', roughness: 1, texture: 'poly_wool_herringbone', pattern: 'speckle' },
}

export const DEFAULT_MATERIALS = {
  floor: 'oak-plank',
  walls: 'plaster-white',
  ceiling: 'plaster-white',
  exterior: 'stucco-white',
  ground: 'grass',
}

export function materialNames(): string[] {
  return Object.keys(MATERIALS)
}
