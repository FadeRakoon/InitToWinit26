import { GRID_ROWS, GRID_COLUMNS, GRID_LAT_STEP, GRID_LNG_STEP } from './config'
import type { LngLatTuple } from './types'

// ─── Tile math ────────────────────────────────────────────────────────────────

const ZOOM      = 14
const TILE_SIZE = 256

function lngLatToTile(lng: number, lat: number, z: number) {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const latR = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n,
  )
  return { x, y }
}

function lngLatToGlobalPixel(lng: number, lat: number, z: number) {
  const n = 2 ** z
  const px = ((lng + 180) / 360) * n * TILE_SIZE
  const latR = (lat * Math.PI) / 180
  const py =
    ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) *
    n *
    TILE_SIZE
  return { px, py }
}

function decodeTerrainRGB(r: number, g: number, b: number): number {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1
}

// ─── Elevation fetch ──────────────────────────────────────────────────────────

interface CellSpec {
  row: number
  col: number
  lat: number
  lng: number
}

interface TileGroup {
  tx: number
  ty: number
  cells: Array<CellSpec & { subX: number; subY: number }>
}

function buildCellSpecs(center: LngLatTuple): CellSpec[] {
  const [cLng, cLat] = center
  const originLat = cLat + (GRID_ROWS / 2) * GRID_LAT_STEP
  const originLng = cLng - (GRID_COLUMNS / 2) * GRID_LNG_STEP
  const specs: CellSpec[] = []

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLUMNS; col++) {
      specs.push({
        row,
        col,
        lat: originLat - row * GRID_LAT_STEP - GRID_LAT_STEP / 2,
        lng: originLng + col * GRID_LNG_STEP + GRID_LNG_STEP / 2,
      })
    }
  }
  return specs
}

function groupByTile(specs: CellSpec[]): TileGroup[] {
  const map = new Map<string, TileGroup>()

  for (const spec of specs) {
    const { x: tx, y: ty } = lngLatToTile(spec.lng, spec.lat, ZOOM)
    const key = `${tx}:${ty}`

    if (!map.has(key)) map.set(key, { tx, ty, cells: [] })

    const { px, py } = lngLatToGlobalPixel(spec.lng, spec.lat, ZOOM)
    const subX = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(px - tx * TILE_SIZE)))
    const subY = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(py - ty * TILE_SIZE)))

    map.get(key)!.cells.push({ ...spec, subX, subY })
  }

  return Array.from(map.values())
}

async function sampleTile(group: TileGroup): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const url = `/api/tiles/${ZOOM}/${group.tx}/${group.ty}.png`

  try {
    const res = await fetch(url)
    if (!res.ok) return result

    const blob   = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width  = TILE_SIZE
    canvas.height = TILE_SIZE
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)

    for (const cell of group.cells) {
      const [r, g, b] = ctx.getImageData(cell.subX, cell.subY, 1, 1).data
      const raw = decodeTerrainRGB(r, g, b)
      // Clamp nodata / deep-ocean values to sea level
      result.set(`${cell.row}:${cell.col}`, raw < -500 || raw > 9000 ? 0 : raw)
    }
  } catch {
    // Tile unavailable — cells will keep default 0 (sea level)
  }

  return result
}

export async function fetchGridElevations(
  center: LngLatTuple,
  onProgress?: (pct: number) => void,
): Promise<number[]> {
  const specs  = buildCellSpecs(center)
  const groups = groupByTile(specs)
  const out    = new Array<number>(GRID_ROWS * GRID_COLUMNS).fill(0)

  let done = 0
  const maps = await Promise.all(
    groups.map(async (g) => {
      const m = await sampleTile(g)
      onProgress?.(Math.round((++done / groups.length) * 100))
      return m
    }),
  )

  for (const m of maps) {
    for (const [key, elev] of m) {
      const [row, col] = key.split(':').map(Number)
      out[row * GRID_COLUMNS + col] = elev
    }
  }

  return out
}

// ─── Water pooling physics ────────────────────────────────────────────────────

const TICK_HR        = 5 / 60   // 5-minute ticks
const SPILL_PASSES   = 4        // cascade passes per tick
const BASE_ABSORB_MHR = 0.008   // 8 mm/hr base absorption

export interface SimOptions {
  /** 0–1 from Open-Meteo soil moisture — high = saturated = less absorption */
  soilMoistureRatio?: number
}

function tick(
  elevations: number[],
  depths: Float32Array,
  mmPerHr: number,
  opts: SimOptions,
): void {
  const count      = GRID_ROWS * GRID_COLUMNS
  const addM       = (mmPerHr / 1000) * TICK_HR
  const absorb     = BASE_ABSORB_MHR * (1 - (opts.soilMoistureRatio ?? 0.3)) * TICK_HR

  // 1. Add rain, subtract absorption
  for (let i = 0; i < count; i++) {
    depths[i] = Math.max(0, depths[i] + addM - absorb)
  }

  // 2. Spill downhill — multiple passes so water cascades across ridges
  for (let pass = 0; pass < SPILL_PASSES; pass++) {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLUMNS; col++) {
        const i = row * GRID_COLUMNS + col
        const surf = elevations[i] + depths[i]

        const neighbours: number[] = []
        if (row > 0)                neighbours.push((row - 1) * GRID_COLUMNS + col)
        if (row < GRID_ROWS - 1)    neighbours.push((row + 1) * GRID_COLUMNS + col)
        if (col > 0)                neighbours.push(row * GRID_COLUMNS + (col - 1))
        if (col < GRID_COLUMNS - 1) neighbours.push(row * GRID_COLUMNS + (col + 1))

        for (const j of neighbours) {
          const nSurf = elevations[j] + depths[j]
          if (surf > nSurf) {
            const move = Math.min((surf - nSurf) * 0.25, depths[i])
            depths[i] -= move
            depths[j] += move
          }
        }
      }
    }
  }

  // 3. Sea / coast cells (elevation ≤ 0) act as infinite drains
  for (let i = 0; i < count; i++) {
    if (elevations[i] <= 0) depths[i] = 0
  }
}

export function computeWaterDepths(
  elevations: number[],
  mmPerHr: number,
  opts: SimOptions = {},
  ticks = 120,
): number[] {
  if (mmPerHr === 0) return new Array<number>(elevations.length).fill(0)

  const depths = new Float32Array(elevations.length)
  for (let t = 0; t < ticks; t++) tick(elevations, depths, mmPerHr, opts)
  return Array.from(depths)
}

// ─── Storm categories ─────────────────────────────────────────────────────────

export interface StormCategory {
  label:   string
  mmPerHr: number
  color:   string
}

export const STORM_CATEGORIES: StormCategory[] = [
  { label: 'No Rain',        mmPerHr: 0,   color: '#94a3b8' },
  { label: 'Tropical Storm', mmPerHr: 13,  color: '#60d4ff' },
  { label: 'Cat 1',          mmPerHr: 25,  color: '#4ade80' },
  { label: 'Cat 2',          mmPerHr: 50,  color: '#fbbf24' },
  { label: 'Cat 3',          mmPerHr: 75,  color: '#f97316' },
  { label: 'Cat 4',          mmPerHr: 100, color: '#fb7185' },
  { label: 'Cat 5',          mmPerHr: 178, color: '#f43f5e' },
]

export function getCategory(mmPerHr: number): StormCategory {
  for (let i = STORM_CATEGORIES.length - 1; i >= 0; i--) {
    if (mmPerHr >= STORM_CATEGORIES[i].mmPerHr) return STORM_CATEGORIES[i]
  }
  return STORM_CATEGORIES[0]
}