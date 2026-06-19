export interface MapRegistryEntry {
  id: string
  displayName: string
  specFile: string | null
  assetDirectory: string | null
  version: string
  isDevMap: boolean
}

export const MAP_REGISTRY: MapRegistryEntry[] = [
  {
    id: 'map_0_dev',
    displayName: 'Dev Map',
    specFile: null,
    assetDirectory: null,
    version: '0.0.1',
    isDevMap: true
  },
  {
    id: 'map_1_facility',
    displayName: 'VEXEA Facility 01',
    specFile: 'shared/maps/map_1_facility.spec.json',
    assetDirectory: 'client/public/assets/maps/map_1/',
    version: '0.1.0',
    isDevMap: false
  }
]

export function getDefaultMap(): MapRegistryEntry {
  return MAP_REGISTRY.find(m => m.id === 'map_1_facility')!
}

export function getDevMap(): MapRegistryEntry {
  return MAP_REGISTRY.find(m => m.isDevMap)!
}

export function getMapById(id: string): MapRegistryEntry | undefined {
  return MAP_REGISTRY.find(m => m.id === id)
}
