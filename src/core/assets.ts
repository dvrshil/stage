// The asset library, version 0.1: a dozen pieces of furniture built from
// primitives in the viewer, so the spike runs offline and renders the same
// everywhere. Real glTF assets with the same manifest shape come in
// Milestone 1. Sizes are width (x), depth (y), height (z) in meters at
// facing 0, with the front of the piece toward +y (north).

export interface AssetInfo {
  id: string
  name: string
  category: string
  size: [number, number, number]
  tags: string[]
}

export const ASSETS: AssetInfo[] = [
  { id: 'sofa/three-seat', name: 'Three-seat sofa', category: 'sofa', size: [2.1, 0.9, 0.85], tags: ['sofa', 'couch', 'living', 'seating', 'three-seat'] },
  { id: 'sofa/two-seat', name: 'Two-seat sofa', category: 'sofa', size: [1.6, 0.9, 0.85], tags: ['sofa', 'couch', 'loveseat', 'living', 'seating'] },
  { id: 'chair/armchair', name: 'Armchair', category: 'chair', size: [0.9, 0.9, 0.85], tags: ['chair', 'armchair', 'living', 'seating', 'reading'] },
  { id: 'chair/dining', name: 'Dining chair', category: 'chair', size: [0.45, 0.5, 0.9], tags: ['chair', 'dining', 'kitchen', 'seating'] },
  { id: 'table/dining-six', name: 'Dining table for six', category: 'table', size: [1.8, 0.9, 0.75], tags: ['table', 'dining', 'kitchen', 'six'] },
  { id: 'table/coffee', name: 'Coffee table', category: 'table', size: [1.1, 0.6, 0.4], tags: ['table', 'coffee', 'living', 'low'] },
  { id: 'table/desk', name: 'Desk', category: 'table', size: [1.4, 0.7, 0.75], tags: ['desk', 'table', 'office', 'work', 'study'] },
  { id: 'bed/double', name: 'Double bed', category: 'bed', size: [1.6, 2.1, 0.95], tags: ['bed', 'double', 'queen', 'bedroom', 'sleep'] },
  { id: 'bed/single', name: 'Single bed', category: 'bed', size: [0.9, 2.0, 0.95], tags: ['bed', 'single', 'bedroom', 'kids', 'sleep'] },
  { id: 'plant/fiddle-leaf', name: 'Fiddle-leaf fig', category: 'plant', size: [0.6, 0.6, 1.6], tags: ['plant', 'tree', 'green', 'decor', 'pot'] },
  { id: 'lamp/floor', name: 'Floor lamp', category: 'lamp', size: [0.4, 0.4, 1.6], tags: ['lamp', 'light', 'floor', 'living', 'reading'] },
  { id: 'kitchen/counter-two-meter', name: 'Kitchen counter, 2 m', category: 'kitchen', size: [2.0, 0.6, 0.9], tags: ['kitchen', 'counter', 'cabinet', 'worktop', 'units'] },
  { id: 'kitchen/island-two-meter', name: 'Kitchen island, 2 m', category: 'kitchen', size: [2.0, 0.9, 0.9], tags: ['kitchen', 'island', 'counter', 'worktop'] },
  { id: 'kitchen/fridge', name: 'Fridge', category: 'kitchen', size: [0.7, 0.7, 1.8], tags: ['kitchen', 'fridge', 'refrigerator', 'appliance'] },
  { id: 'shelf/bookcase', name: 'Bookcase', category: 'shelf', size: [0.9, 0.35, 2.0], tags: ['shelf', 'bookcase', 'books', 'storage', 'living', 'office'] },
  { id: 'rug/area', name: 'Area rug', category: 'rug', size: [2.4, 1.7, 0.02], tags: ['rug', 'carpet', 'living', 'floor', 'textile'] },
  { id: 'tv/stand', name: 'TV on a stand', category: 'tv', size: [1.6, 0.45, 1.2], tags: ['tv', 'television', 'media', 'living', 'stand', 'console'] },
  { id: 'wardrobe/double', name: 'Double wardrobe', category: 'wardrobe', size: [1.2, 0.6, 2.1], tags: ['wardrobe', 'closet', 'storage', 'bedroom', 'clothes'] },
  { id: 'bath/toilet', name: 'Toilet', category: 'bath', size: [0.4, 0.7, 0.8], tags: ['toilet', 'wc', 'bathroom'] },
  { id: 'bath/basin', name: 'Basin on a cabinet', category: 'bath', size: [0.6, 0.5, 0.85], tags: ['basin', 'sink', 'bathroom', 'vanity'] },
  { id: 'bath/tub', name: 'Bathtub', category: 'bath', size: [1.7, 0.75, 0.6], tags: ['bath', 'tub', 'bathtub', 'bathroom'] },
  { id: 'kitchen/wall-cabinets', name: 'Wall cabinets, 2 m (hung 1.45 to 2.15 m)', category: 'kitchen', size: [2.0, 0.35, 2.15], tags: ['kitchen', 'cabinet', 'wall', 'upper', 'storage'] },
  { id: 'person/standing', name: 'Standing person, 1.75 m', category: 'person', size: [0.5, 0.3, 1.75], tags: ['person', 'human', 'people', 'figure', 'scale', 'adult'] },
]

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
