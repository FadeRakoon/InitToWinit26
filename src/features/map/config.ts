import type { LngLatTuple } from './types'

export const MAP_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export const GEOCODER_ENDPOINT = 'https://photon.komoot.io/api/'

export const DEFAULT_MAP_CENTER: LngLatTuple = [-76.7928, 17.9714]
export const DEFAULT_MAP_ZOOM = 12

export const GRID_ROWS = 20
export const GRID_COLUMNS = 20
export const GRID_LAT_STEP = 0.015
export const GRID_LNG_STEP = 0.02

export const GRID_SOURCE_ID = 'map-grid-source'
export const GRID_FILL_LAYER_ID = 'map-grid-fill'
export const GRID_OUTLINE_LAYER_ID = 'map-grid-outline'
