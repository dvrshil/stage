// The built-in materials, by the names the scene file uses. Floors carry
// real-size procedural patterns; image textures arrive with Milestone 1.

export interface Material {
  color: string
  roughness: number
  metalness?: number
  // A real-size surface pattern for floors: planks 18 cm wide, or tiles of
  // `tile` meters. Plain colors otherwise.
  pattern?: 'planks' | 'tiles' | 'speckle'
  tile?: number
}

export const MATERIALS: Record<string, Material> = {
  'plaster-white': { color: '#ece8e0', roughness: 0.95 },
  'paint-sage': { color: '#b7c4ad', roughness: 0.9 },
  'paint-navy': { color: '#2f3d5c', roughness: 0.9 },
  'paint-terracotta': { color: '#c0674b', roughness: 0.9 },
  'oak-plank': { color: '#b48a5a', roughness: 0.7, pattern: 'planks' },
  'wood-dark': { color: '#6a4a33', roughness: 0.65, pattern: 'planks' },
  'tile-grey': { color: '#a3a3a0', roughness: 0.45, pattern: 'tiles', tile: 0.6 },
  'tile-white': { color: '#e4e4e0', roughness: 0.4, pattern: 'tiles', tile: 0.3 },
  'concrete': { color: '#8c8c88', roughness: 0.85, pattern: 'speckle' },
  'carpet-beige': { color: '#c9bba4', roughness: 1, pattern: 'speckle' },
  'marble-white': { color: '#efede8', roughness: 0.3, pattern: 'tiles', tile: 0.8 },
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
