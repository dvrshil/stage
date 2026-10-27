// The asset library. Pieces with a `model` use a CC0 glTF model from Poly
// Haven once `stage assets fetch` has it, and a piece built from primitives
// until then, so a scene renders either way. Sizes are width (x), depth (y),
// height (z) in meters at facing 0, front toward +y (north); for models they
// are the model's real size, which the viewer fits the model to, because a
// few models are exported at the wrong scale.

export interface AssetInfo {
  id: string
  name: string
  category: string
  size: [number, number, number]
  tags: string[]
  // A CC0 glTF model from Poly Haven, used once downloaded; the piece built
  // from primitives stands in until then. `size` is the model's own.
  model?: string
  // Turns the model so its front faces north at facing 0, in degrees.
  yaw?: number
}

export const ASSETS: AssetInfo[] = [
  { id: 'sofa/three-seat', model: 'sofa_02', name: 'Three-seat sofa', category: 'sofa', size: [1.81, 0.82, 0.71], tags: ['sofa', 'couch', 'living', 'seating', 'three-seat'] },
  { id: 'sofa/two-seat', model: 'Sofa_01', name: 'Two-seat sofa', category: 'sofa', size: [1.57, 0.66, 0.8], tags: ['sofa', 'couch', 'loveseat', 'living', 'seating'] },
  { id: 'chair/armchair', model: 'modern_arm_chair_01', name: 'Armchair', category: 'chair', size: [0.82, 0.99, 1.02], tags: ['chair', 'armchair', 'living', 'seating', 'reading'] },
  { id: 'chair/dining', model: 'dining_chair_02', name: 'Dining chair', category: 'chair', size: [0.43, 0.58, 0.97], tags: ['chair', 'dining', 'kitchen', 'seating'] },
  { id: 'table/dining-six', model: 'dining_table', name: 'Dining table for six', category: 'table', size: [2.26, 1.39, 0.88], tags: ['table', 'dining', 'kitchen', 'six'] },
  { id: 'table/coffee', model: 'modern_coffee_table_01', yaw: 90, name: 'Coffee table', category: 'table', size: [1.2, 0.6, 0.39], tags: ['table', 'coffee', 'living', 'low'] },
  { id: 'table/desk', model: 'metal_office_desk', name: 'Desk', category: 'table', size: [2.0, 0.95, 0.79], tags: ['desk', 'table', 'office', 'work', 'study'] },
  { id: 'bed/double', name: 'Double bed', category: 'bed', size: [1.6, 2.1, 0.95], tags: ['bed', 'double', 'queen', 'bedroom', 'sleep'] },
  { id: 'bed/single', name: 'Single bed', category: 'bed', size: [0.9, 2.0, 0.95], tags: ['bed', 'single', 'bedroom', 'kids', 'sleep'] },
  { id: 'plant/fiddle-leaf', name: 'Fiddle-leaf fig', category: 'plant', size: [0.6, 0.6, 1.6], tags: ['plant', 'tree', 'green', 'decor', 'pot'] },
  { id: 'lamp/floor', name: 'Floor lamp', category: 'lamp', size: [0.4, 0.4, 1.6], tags: ['lamp', 'light', 'floor', 'living', 'reading'] },
  { id: 'kitchen/counter-two-meter', name: 'Kitchen counter, 2 m', category: 'kitchen', size: [2.0, 0.6, 0.9], tags: ['kitchen', 'counter', 'cabinet', 'worktop', 'units'] },
  { id: 'kitchen/island-two-meter', name: 'Kitchen island, 2 m', category: 'kitchen', size: [2.0, 0.9, 0.9], tags: ['kitchen', 'island', 'counter', 'worktop'] },
  { id: 'kitchen/fridge', name: 'Fridge', category: 'kitchen', size: [0.7, 0.7, 1.8], tags: ['kitchen', 'fridge', 'refrigerator', 'appliance'] },
  { id: 'shelf/bookcase', model: 'steel_frame_shelves_01', name: 'Bookcase', category: 'shelf', size: [1.1, 0.5, 2.14], tags: ['shelf', 'bookcase', 'books', 'storage', 'living', 'office'] },
  { id: 'rug/area', name: 'Area rug', category: 'rug', size: [2.4, 1.7, 0.02], tags: ['rug', 'carpet', 'living', 'floor', 'textile'] },
  { id: 'tv/stand', name: 'TV on a stand', category: 'tv', size: [1.6, 0.45, 1.2], tags: ['tv', 'television', 'media', 'living', 'stand', 'console'] },
  { id: 'wardrobe/double', name: 'Double wardrobe', category: 'wardrobe', size: [1.2, 0.6, 2.1], tags: ['wardrobe', 'closet', 'storage', 'bedroom', 'clothes'] },
  { id: 'bath/toilet', name: 'Toilet', category: 'bath', size: [0.4, 0.7, 0.8], tags: ['toilet', 'wc', 'bathroom'] },
  { id: 'bath/basin', name: 'Basin on a cabinet', category: 'bath', size: [0.6, 0.5, 0.85], tags: ['basin', 'sink', 'bathroom', 'vanity'] },
  { id: 'bath/tub', name: 'Bathtub', category: 'bath', size: [1.7, 0.75, 0.6], tags: ['bath', 'tub', 'bathtub', 'bathroom'] },
  { id: 'kitchen/wall-cabinets', name: 'Wall cabinets, 2 m (hung 1.45 to 2.15 m)', category: 'kitchen', size: [2.0, 0.35, 2.15], tags: ['kitchen', 'cabinet', 'wall', 'upper', 'storage'] },
  { id: 'table/side', model: 'side_table_01', name: 'Side table', category: 'table', size: [0.55, 0.45, 0.55], tags: ['table', 'side', 'end', 'living', 'bedside', 'nightstand'] },
  { id: 'chair/lounge', model: 'mid_century_lounge_chair', name: 'Mid-century lounge chair', category: 'chair', size: [1.01, 1.19, 1.17], tags: ['chair', 'lounge', 'armchair', 'swivel', 'leather', 'living', 'reading'] },
  { id: 'plant/large-potted', model: 'potted_plant_02', name: 'Large potted plant', category: 'plant', size: [0.7, 0.66, 0.84], tags: ['plant', 'pot', 'green', 'decor', 'floor'] },
  { id: 'lamp/desk', model: 'desk_lamp_arm_01', name: 'Desk lamp', category: 'lamp', size: [0.2, 0.61, 0.89], tags: ['lamp', 'desk', 'light', 'office', 'study'] },
  { id: 'person/standing', name: 'Standing person, 1.75 m', category: 'person', size: [0.5, 0.3, 1.75], tags: ['person', 'human', 'people', 'figure', 'scale', 'adult'] },
]

// Models the engine places itself, rather than the scene file.
export const FIXTURES = { ceilingLamp: 'modern_ceiling_lamp_01' }

export function findAsset(id: string): AssetInfo | undefined {
  return ASSETS.find((asset) => asset.id === id)
}

// Every word must match something: the id, the name, a tag, or the category.
export function searchAssets(words: string, options: { category?: string; maxSize?: [number, number, number] } = {}): AssetInfo[] {
  const terms = words.toLowerCase().split(/[\s,]+/).filter(Boolean)
  return ASSETS.filter((asset) => {
    if (options.category && asset.category !== options.category) return false
    if (options.maxSize && asset.size.some((dimension, i) => dimension > options.maxSize![i])) return false
    const haystack = [asset.id, asset.name, asset.category, ...asset.tags].join(' ').toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
