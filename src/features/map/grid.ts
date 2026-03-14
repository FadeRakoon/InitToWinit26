import type { GridCellFeature, GridFeatureCollection, LngLatTuple } from './types'
import {
  GRID_COLUMNS,
  GRID_LAT_STEP,
  GRID_LNG_STEP,
  GRID_ROWS,
} from './config'

interface GridOptions {
  center: LngLatTuple
  rows?: number
  cols?: number
  latStep?: number
  lngStep?: number
}

const COLUMN_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export function createGridFeatureCollection({
  center,
  rows = GRID_ROWS,
  cols = GRID_COLUMNS,
  latStep = GRID_LAT_STEP,
  lngStep = GRID_LNG_STEP,
}: GridOptions): GridFeatureCollection {
  const [centerLng, centerLat] = center
  const startLat = centerLat + (rows / 2) * latStep
  const startLng = centerLng - (cols / 2) * lngStep

  const features: GridCellFeature[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const north = startLat - row * latStep
      const south = startLat - (row + 1) * latStep
      const west = startLng + col * lngStep
      const east = startLng + (col + 1) * lngStep
      const id = row * cols + col

      features.push({
        type: 'Feature',
        id,
        properties: {
          cellId: `${COLUMN_LABELS[col % COLUMN_LABELS.length]}${row + 1}`,
          centerLng: west + lngStep / 2,
          centerLat: south + latStep / 2,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, north],
              [east, north],
              [east, south],
              [west, south],
              [west, north],
            ],
          ],
        },
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}
