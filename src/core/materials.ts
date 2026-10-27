// The built-in materials, by the names the scene file uses. Version 0.1
// has colors and roughness only; textures arrive with Milestone 1.

export interface Material {
  color: string
  roughness: number
  metalness?: number
}

export const MATERIALS: Record<string, Material> = {
  'plaster-white': { color: '#ece8e0', roughness: 0.95 },
  'paint-sage': { color: '#b7c4ad', roughness: 0.9 },
  'paint-navy': { color: '#2f3d5c', roughness: 0.9 },
  'paint-terracotta': { color: '#c0674b', roughness: 0.9 },
  'oak-plank': { color: '#b48a5a', roughness: 0.65 },
  'wood-dark': { color: '#5a3d2b', roughness: 0.6 },
  'tile-grey': { color: '#9c9c9a', roughness: 0.35 },
  'tile-white': { color: '#e4e4e0', roughness: 0.3 },
  'concrete': { color: '#8c8c88', roughness: 0.8 },
  'carpet-beige': { color: '#c9bba4', roughness: 1 },
  'marble-white': { color: '#efede8', roughness: 0.2 },
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
