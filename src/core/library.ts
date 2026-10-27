// The asset lockfile, assets/lock.json: every downloaded file with its
// source, license, real size, and checksum, so a render repeats exactly.
// The files themselves live in a local cache, never in the repository.

export interface LockedFile {
  file: string
  md5: string
}

export interface LockedTexture {
  source: string
  license: 'CC0'
  // Meters covered by one repeat of the texture, as Poly Haven measured it.
  size: [number, number]
  resolution: string
  maps: { color: LockedFile; normal: LockedFile; arm: LockedFile }
}

export interface LockedSky {
  source: string
  license: 'CC0'
  resolution: string
  hdr: LockedFile
}

export interface LockedModel {
  source: string
  license: 'CC0'
  resolution: string
  gltf: LockedFile
  files: LockedFile[]
  // Width (x), depth (z), height (y) in meters, as modeled, front toward +z.
  size: [number, number, number]
}

export interface Lock {
  version: 1
  textures: Record<string, LockedTexture>
  skies: Record<string, LockedSky>
  models: Record<string, LockedModel>
}

export const EMPTY_LOCK: Lock = { version: 1, textures: {}, skies: {}, models: {} }
