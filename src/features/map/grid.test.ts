import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAP_CENTER,
  GRID_COLUMNS,
  GRID_LAT_SPAN,
  GRID_LAT_STEP,
  GRID_LNG_SPAN,
  GRID_LNG_STEP,
  GRID_ROWS,
} from './config'
import { isPointOnCaribbeanLand } from './geometry'
import { createGridFeatureCollection } from './grid'

describe('createGridFeatureCollection', () => {
  it('uses the 100 by 100 grid with the original cell size', () => {
    expect(GRID_ROWS).toBe(100)
    expect(GRID_COLUMNS).toBe(100)
    expect(GRID_LAT_STEP).toBeCloseTo(0.015)
    expect(GRID_LNG_STEP).toBeCloseTo(0.02)
    expect(GRID_LAT_SPAN).toBeCloseTo(1.5)
    expect(GRID_LNG_SPAN).toBeCloseTo(2)
  })

  it('keeps column labels unique past Z', () => {
    const grid = createGridFeatureCollection({ center: DEFAULT_MAP_CENTER })
    const labels = new Set(grid.features.map((feature) => feature.properties.cellId))

    expect(labels.has('A1')).toBe(true)
    expect(labels.has('Z1')).toBe(true)
    expect(labels.has('AA1')).toBe(true)
    expect(labels.has('CV1')).toBe(true)
  })

  it('filters out cells whose centers are outside the coarse land mask', () => {
    const grid = createGridFeatureCollection({ center: DEFAULT_MAP_CENTER })

    expect(grid.features.length).toBeGreaterThan(0)
    expect(grid.features.length).toBeLessThan(GRID_ROWS * GRID_COLUMNS)

    for (const feature of grid.features) {
      expect(
        isPointOnCaribbeanLand([
          feature.properties.centerLng,
          feature.properties.centerLat,
        ]),
      ).toBe(true)
    }
  })
})
