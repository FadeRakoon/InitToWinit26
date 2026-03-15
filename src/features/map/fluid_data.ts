import { GEOCODER_ENDPOINT } from './config'
import type { LngLatTuple } from './types'
import type { WeatherData } from './fluid_types'
import {
  GRID_ROWS,
  GRID_COLS,
  GRID_LAT_STEP,
  GRID_LNG_STEP,
} from './config'

/* ── Grid cell centres ─────────────────────────────────────────── */
export function buildGridCells(center: LngLatTuple) {
  const [cLng, cLat] = center
  const startLat = cLat + (GRID_ROWS / 2) * GRID_LAT_STEP
  const startLng = cLng - (GRID_COLS / 2) * GRID_LNG_STEP
  const cells: Array<{ lat: number; lng: number }> = []

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      cells.push({
        lat: startLat - r * GRID_LAT_STEP - GRID_LAT_STEP / 2,
        lng: startLng + c * GRID_LNG_STEP + GRID_LNG_STEP / 2,
      })
    }
  }
  return cells
}

/* ── Synthetic elevation fallback (no API needed) ──────────────── */
function syntheticElev(lat: number, lng: number, center: LngLatTuple) {
  const x = (lng - center[0]) * 60
  const y = (lat - center[1]) * 60
  return Math.max(
    0,
    120 * Math.sin(x * 0.4) * Math.cos(y * 0.35) +
      60 * Math.sin(x * 0.9 + 1.2) * Math.sin(y * 0.8 + 0.7) +
      30 * Math.cos(x * 1.8 + y * 1.4) +
      80,
  )
}

/* ── Open-Elevation (free, no key) ─────────────────────────────── */
export async function fetchElevations(
  center: LngLatTuple,
  onProgress?: (msg: string) => void,
): Promise<number[]> {
  const cells = buildGridCells(center)
  const elevations = new Array<number>(cells.length).fill(0)
  const chunkSize = 100
  const chunks: typeof cells[] = []
  for (let i = 0; i < cells.length; i += chunkSize) {
    chunks.push(cells.slice(i, i + chunkSize))
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    onProgress?.(`Elevation ${ci + 1}/${chunks.length}…`)
    const chunk = chunks[ci]
    const locations = chunk.map((c) => ({
      latitude: c.lat,
      longitude: c.lng,
    }))

    try {
      const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ locations }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as {
        results: Array<{ elevation: number }>
      }
      json.results.forEach((r, i) => {
        elevations[ci * chunkSize + i] = r.elevation ?? 0
      })
    } catch {
      // Fallback: synthetic noise for this chunk
      chunk.forEach((c, i) => {
        elevations[ci * chunkSize + i] = syntheticElev(c.lat, c.lng, center)
      })
    }
  }

  return elevations
}

/* ── Open-Meteo (free, no key) ─────────────────────────────────── */
export async function fetchWeather(center: LngLatTuple): Promise<WeatherData> {
  const [lng, lat] = center
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lng))
  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'precipitation',
      'wind_speed_10m',
      'wind_direction_10m',
      'soil_moisture_0_to_1cm',
    ].join(','),
  )
  url.searchParams.set('daily', 'precipitation_sum')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '1')

  try {
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as {
      current?: {
        temperature_2m?: number
        precipitation?: number
        wind_speed_10m?: number
        wind_direction_10m?: number
        soil_moisture_0_to_1cm?: number
      }
      daily?: { precipitation_sum?: number[] }
    }
    const c = json.current ?? {}
    const d = json.daily ?? {}
    return {
      temp: c.temperature_2m ?? null,
      precip: c.precipitation ?? 0,
      windSpeed: c.wind_speed_10m ?? 0,
      windDir: c.wind_direction_10m ?? 0,
      soil: c.soil_moisture_0_to_1cm ?? null,
      precip24: (d.precipitation_sum ?? [0])[0] ?? 0,
    }
  } catch {
    return {
      temp: 28,
      precip: 4.2,
      windSpeed: 18,
      windDir: 95,
      soil: 0.38,
      precip24: 6.1,
    }
  }
}

/* ── Risk score ─────────────────────────────────────────────────── */
export function computeRiskScore(
  weather: WeatherData,
  elevations: number[],
): { score: number; label: 'Low' | 'Moderate' | 'High' | 'Critical' } {
  const minE = Math.min(...elevations)
  const maxE = Math.max(...elevations)
  const precipF = Math.min(weather.precip24 / 50, 1)
  const soilF = weather.soil != null ? Math.min(weather.soil / 0.6, 1) : 0.4
  const elevF = maxE > minE ? Math.min((maxE - minE) / 500, 1) : 0
  const windF = Math.min(weather.windSpeed / 80, 1)
  const score = precipF * 0.45 + soilF * 0.25 + elevF * 0.2 + windF * 0.1

  const label: 'Low' | 'Moderate' | 'High' | 'Critical' =
    score < 0.25
      ? 'Low'
      : score < 0.5
        ? 'Moderate'
        : score < 0.75
          ? 'High'
          : 'Critical'

  return { score, label }
}