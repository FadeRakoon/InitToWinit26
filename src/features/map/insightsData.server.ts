import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { and, between, eq } from 'drizzle-orm'
import { fromArrayBuffer, fromFile } from 'geotiff'
import { z } from 'zod'
import { CARIBBEAN_COUNTRY_BOUNDARIES } from './caribbeanCountryBoundaries'
import { GRID_LAT_STEP, GRID_LNG_STEP } from './config'
import { pointInPolygon } from './geometry'
import {
  deriveTileName,
  estimateBoundsAreaSqKm,
  haversineDistanceKm,
  inferTerrainPositionBand,
  round,
} from './insightMath'
import type {
  NearestSurgeStation,
  StormAggregate,
  TerrainSummaryRecord,
} from './insightMath'
import type { BoundsTuple, HistoricalAnalog, RegionInsightInput } from './types'

const DEFAULT_OUTPUT_PREFIX = 'topographical_summaries'
const DEFAULT_WORLDPOP_PREFIX = 'worldpop'
const STORM_STATS_RADIUS_KM = 250
const STORM_ANALOG_RADIUS_KM = 450
const MAX_SEARCH_ANALYSIS_AREA_SQ_KM = 400
const DEFAULT_ANALYSIS_BOUNDS: BoundsTuple = [
  [-GRID_LNG_STEP / 2, -GRID_LAT_STEP / 2],
  [GRID_LNG_STEP / 2, GRID_LAT_STEP / 2],
]

const terrainSummarySchema = z.object({
  tileName: z.string(),
  stats: z.object({
    min: z.number(),
    max: z.number(),
    mean: z.number(),
  }),
  coverage: z.object({
    landCoveragePct: z.number(),
  }),
  narrative: z.string().optional(),
})

interface StormRow {
  stormId: string
  stormName: string
  stormDate: string
  status: string
  lat: number
  lon: number
  windKt: number
  pressureMb: number | null
}

export interface StormCandidate extends StormRow {
  distanceKm: number
}

export interface TerrainLoadResult {
  record: TerrainSummaryRecord
  precision: 'cell' | 'coarse'
}

export interface PopulationLoadResult {
  count: number
  density: number
  iso3: string
  sourceYear?: number
}

export interface HistoricalAnalogCandidate extends HistoricalAnalog {
  stormId: string
}

export interface NearestSurgeStationDetails extends NearestSurgeStation {
  rp1Lower5: number
  rp1Upper95: number
  rp2Bestfit: number
  rp2Lower5: number
  rp2Upper95: number
  rp5Bestfit: number
  rp5Lower5: number
  rp5Upper95: number
  rp10Lower5: number
  rp10Upper95: number
  rp25Bestfit: number
  rp25Lower5: number
  rp25Upper95: number
  rp50Lower5: number
  rp50Upper95: number
  rp75Bestfit: number
  rp75Lower5: number
  rp75Upper95: number
}

type GeoTiffDataset = Awaited<ReturnType<typeof fromFile>>
type GeoTiffImage = Awaited<ReturnType<GeoTiffDataset['getImage']>>

interface RasterDataset {
  dataset: GeoTiffDataset
  image: GeoTiffImage
  bbox: [number, number, number, number]
  nodata: number | null
}

const rasterCache = new Map<string, Promise<RasterDataset | undefined>>()

export async function loadPopulationData(
  center: [number, number],
  bounds: BoundsTuple,
): Promise<PopulationLoadResult | undefined> {
  const country = resolveCountryByPoint(center)
  if (!country) {
    return undefined
  }

  const metadata = await loadWorldPopMetadata(country.iso3)
  const raster = await loadWorldPopRaster(country.iso3, metadata)
  if (!raster) {
    return undefined
  }

  const stats = await summarizePopulationBounds(raster, bounds)
  if (!stats) {
    return undefined
  }

  return {
    ...stats,
    iso3: country.iso3,
    sourceYear: metadata?.populationYear ?? undefined,
  }
}

export async function loadNearestSurgeStation(
  center: [number, number],
): Promise<NearestSurgeStationDetails | null> {
  const { db, schema } = await import('../../../db/client.ts')
  const rows = await db.select().from(schema.surgeReturnLevels)

  if (rows.length === 0) {
    return null
  }

  let best: NearestSurgeStationDetails | null = null

  for (const row of rows) {
    const distanceKm = haversineDistanceKm(center, [row.lon, row.lat])

    if (!best || distanceKm < best.distanceKm) {
      best = {
        stationId: row.stationId,
        distanceKm,
        rp1Bestfit: row.rp1Bestfit,
        rp1Lower5: row.rp1Lower5,
        rp1Upper95: row.rp1Upper95,
        rp2Bestfit: row.rp2Bestfit,
        rp2Lower5: row.rp2Lower5,
        rp2Upper95: row.rp2Upper95,
        rp5Bestfit: row.rp5Bestfit,
        rp5Lower5: row.rp5Lower5,
        rp5Upper95: row.rp5Upper95,
        rp10Bestfit: row.rp10Bestfit,
        rp10Lower5: row.rp10Lower5,
        rp10Upper95: row.rp10Upper95,
        rp25Bestfit: row.rp25Bestfit,
        rp25Lower5: row.rp25Lower5,
        rp25Upper95: row.rp25Upper95,
        rp50Bestfit: row.rp50Bestfit,
        rp50Lower5: row.rp50Lower5,
        rp50Upper95: row.rp50Upper95,
        rp75Bestfit: row.rp75Bestfit,
        rp75Lower5: row.rp75Lower5,
        rp75Upper95: row.rp75Upper95,
        rp100Bestfit: row.rp100Bestfit,
        rp100Lower5: row.rp100Lower5,
        rp100Upper95: row.rp100Upper95,
      }
    }
  }

  return best
}

export async function loadStormRows(
  center: [number, number],
  radiusKm = STORM_ANALOG_RADIUS_KM,
): Promise<StormCandidate[]> {
  const [lng, lat] = center
  const latDelta = radiusKm / 111
  const lonDelta =
    radiusKm / Math.max(111 * Math.cos((Math.abs(lat) * Math.PI) / 180), 15)

  const { db, schema } = await import('../../../db/client.ts')
  const rows = await db
    .select({
      stormId: schema.stormHistoryPoints.stormId,
      stormName: schema.stormHistoryPoints.stormName,
      stormDate: schema.stormHistoryPoints.stormDate,
      status: schema.stormHistoryPoints.status,
      lat: schema.stormHistoryPoints.lat,
      lon: schema.stormHistoryPoints.lon,
      windKt: schema.stormHistoryPoints.windKt,
      pressureMb: schema.stormHistoryPoints.pressureMb,
    })
    .from(schema.stormHistoryPoints)
    .where(
      and(
        between(schema.stormHistoryPoints.lat, lat - latDelta, lat + latDelta),
        between(schema.stormHistoryPoints.lon, lng - lonDelta, lng + lonDelta),
      ),
    )

  return rows
    .map((row) => ({
      ...row,
      distanceKm: haversineDistanceKm(center, [row.lon, row.lat]),
    }))
    .filter((row) => row.distanceKm <= radiusKm)
}

export function aggregateStorms(
  rows: StormCandidate[],
  radiusKm = STORM_STATS_RADIUS_KM,
): StormAggregate {
  const nearbyRows = rows.filter((row) => row.distanceKm <= radiusKm)
  const distinctStorms = new Set(nearbyRows.map((row) => row.stormId))

  const strongestNearbyWindKt = nearbyRows.reduce<number | undefined>(
    (highest, row) =>
      highest === undefined || row.windKt > highest ? row.windKt : highest,
    undefined,
  )

  const mostRecentNearbyStormYear = nearbyRows.reduce<number | undefined>(
    (latest, row) => {
      const year = Number(row.stormDate.slice(0, 4))
      if (!Number.isFinite(year)) {
        return latest
      }

      return latest === undefined || year > latest ? year : latest
    },
    undefined,
  )

  return {
    distinctStormCount: distinctStorms.size,
    strongestWindKt: strongestNearbyWindKt,
    mostRecentStormYear: mostRecentNearbyStormYear,
  }
}

export function listHistoricalAnalogs(
  rows: StormCandidate[],
  {
    radiusKm = STORM_ANALOG_RADIUS_KM,
    limit = 3,
  }: { radiusKm?: number; limit?: number } = {},
): HistoricalAnalogCandidate[] {
  const analogRows = rows.filter((row) => row.distanceKm <= radiusKm)

  if (analogRows.length === 0) {
    return []
  }

  const grouped = new Map<
    string,
    {
      stormName: string
      closestApproachKm: number
      peakWindKt?: number
      eventDate?: string
    }
  >()

  for (const row of analogRows) {
    const current = grouped.get(row.stormId)
    const nextPeakWind =
      current?.peakWindKt === undefined || row.windKt > current.peakWindKt
        ? row.windKt
        : current.peakWindKt
    const nextDate =
      !current || row.distanceKm < current.closestApproachKm
        ? row.stormDate
        : current.eventDate

    if (!current || row.distanceKm < current.closestApproachKm) {
      grouped.set(row.stormId, {
        stormName: row.stormName,
        closestApproachKm: row.distanceKm,
        peakWindKt: nextPeakWind,
        eventDate: nextDate,
      })
      continue
    }

    grouped.set(row.stormId, {
      ...current,
      peakWindKt: nextPeakWind,
    })
  }

  return Array.from(grouped.entries())
    .map(([stormId, summary]) => {
      const year = summary.eventDate?.slice(0, 4)
      const baseLabel =
        summary.stormName.toUpperCase() === 'UNNAMED'
          ? `Unnamed storm${year ? ` (${year})` : ''}`
          : summary.stormName

      return {
        stormId,
        label: `${baseLabel} [${stormId}]`,
        closestApproachKm: round(summary.closestApproachKm),
        peakWindKt: summary.peakWindKt,
        eventDate: summary.eventDate,
      }
    })
    .sort((left, right) => {
      if (left.closestApproachKm !== right.closestApproachKm) {
        return left.closestApproachKm - right.closestApproachKm
      }

      if ((left.peakWindKt ?? 0) !== (right.peakWindKt ?? 0)) {
        return (right.peakWindKt ?? 0) - (left.peakWindKt ?? 0)
      }

      return (right.eventDate ?? '').localeCompare(left.eventDate ?? '')
    })
    .slice(0, Math.max(limit, 0))
}

export function selectHistoricalAnalog(
  rows: StormCandidate[],
): HistoricalAnalog | undefined {
  return listHistoricalAnalogs(rows, { limit: 1 })[0]
}

export async function loadTerrainSummary(
  center: [number, number],
  bounds: BoundsTuple,
): Promise<TerrainLoadResult | undefined> {
  const cellScale = await loadRasterTerrainSummary(center, bounds)
  if (cellScale) {
    return {
      record: cellScale,
      precision: 'cell',
    }
  }

  const tileName = deriveTileName(center)
  const databasePayload = await loadDatabaseTerrainSummary(tileName)

  if (databasePayload) {
    return {
      record: {
        ...databasePayload,
        positionBand: inferTerrainPositionBand(databasePayload),
      },
      precision: 'coarse',
    }
  }

  const localPayload = await loadLocalTerrainSummary(tileName)

  if (localPayload) {
    return {
      record: {
        ...localPayload,
        positionBand: inferTerrainPositionBand(localPayload),
      },
      precision: 'coarse',
    }
  }

  const remotePayload = await loadRemoteTerrainSummary(tileName)
  if (!remotePayload) {
    return undefined
  }

  return {
    record: {
      ...remotePayload,
      positionBand: inferTerrainPositionBand(remotePayload),
    },
    precision: 'coarse',
  }
}

export function resolveAnalysisBounds(input: RegionInsightInput): BoundsTuple {
  if (input.bounds) {
    const normalized = normalizeBounds(input.bounds)
    if (estimateBoundsAreaSqKm(normalized) <= MAX_SEARCH_ANALYSIS_AREA_SQ_KM) {
      return normalized
    }
  }

  const [lng, lat] = input.center
  return [
    [lng + DEFAULT_ANALYSIS_BOUNDS[0][0], lat + DEFAULT_ANALYSIS_BOUNDS[0][1]],
    [lng + DEFAULT_ANALYSIS_BOUNDS[1][0], lat + DEFAULT_ANALYSIS_BOUNDS[1][1]],
  ]
}

export function normalizeBounds(bounds: BoundsTuple): BoundsTuple {
  const [[lngA, latA], [lngB, latB]] = bounds
  return [
    [Math.min(lngA, lngB), Math.min(latA, latB)],
    [Math.max(lngA, lngB), Math.max(latA, latB)],
  ]
}

async function loadWorldPopMetadata(iso3: string) {
  try {
    const { db, schema } = await import('../../../db/client.ts')
    return await db.query.worldpopCountryPayloads.findFirst({
      where: eq(schema.worldpopCountryPayloads.iso3, iso3),
      orderBy: (table, { desc }) => [desc(table.populationYear)],
    })
  } catch {
    return null
  }
}

async function loadRasterTerrainSummary(
  center: [number, number],
  bounds: BoundsTuple,
): Promise<TerrainSummaryRecord | undefined> {
  const raster = await loadTerrainRaster()
  if (!raster) {
    return undefined
  }

  const summary = await summarizeTerrainBounds(raster, bounds)
  if (!summary) {
    return undefined
  }

  const record: TerrainSummaryRecord = {
    tileName: `cell_${center[1].toFixed(4)}_${center[0].toFixed(4)}`,
    stats: summary.stats,
    coverage: {
      landCoveragePct: summary.landCoveragePct,
    },
  }

  return {
    ...record,
    positionBand: inferTerrainPositionBand(record),
  }
}

async function loadTerrainRaster() {
  const localCandidates = [
    process.env.TERRAIN_RASTER_PATH,
    path.join(process.cwd(), 'data', 'terrain.tif'),
    path.join(process.cwd(), 'data', 'terrain.tiff'),
    path.join(process.cwd(), 'public', 'terrain.tif'),
    path.join(process.cwd(), 'public', 'terrain.tiff'),
  ].filter(Boolean) as string[]

  for (const localPath of localCandidates) {
    const raster = await loadRasterFromPath(localPath)
    if (raster) {
      return raster
    }
  }

  const terrainRasterKey = process.env.TERRAIN_RASTER_KEY
  if (!terrainRasterKey) {
    return undefined
  }

  return loadRasterFromS3Key(terrainRasterKey)
}

async function loadWorldPopRaster(
  iso3: string,
  metadata: Awaited<ReturnType<typeof loadWorldPopMetadata>>,
) {
  const fileCandidates = buildWorldPopRasterCandidates(iso3, metadata)
  const rasterDirCandidates = [
    process.env.WORLDPOP_RASTER_DIR,
    path.join(process.cwd(), 'data', 'worldpop'),
    path.join(process.cwd(), 'public', 'worldpop'),
  ].filter(Boolean) as string[]

  for (const directory of rasterDirCandidates) {
    for (const filename of fileCandidates) {
      const raster = await loadRasterFromPath(path.join(directory, filename))
      if (raster) {
        return raster
      }
    }
  }

  const prefix = (process.env.WORLDPOP_RASTER_PREFIX ?? DEFAULT_WORLDPOP_PREFIX)
    .replace(/\/+$/, '')

  for (const filename of fileCandidates) {
    const raster = await loadRasterFromS3Key(`${prefix}/${filename}`)
    if (raster) {
      return raster
    }
  }

  return undefined
}

async function loadDatabaseTerrainSummary(
  tileName: string,
): Promise<TerrainSummaryRecord | undefined> {
  const { db, schema } = await import('../../../db/client.ts')
  const row = await db.query.terrainSummaries.findFirst({
    where: eq(schema.terrainSummaries.tileName, tileName),
  })

  if (!row) {
    return undefined
  }

  return {
    tileName: row.tileName,
    stats: {
      min: row.minElevationM,
      max: row.maxElevationM,
      mean: row.meanElevationM,
    },
    coverage: {
      landCoveragePct: row.landCoveragePct,
    },
  }
}

async function loadLocalTerrainSummary(
  tileName: string,
): Promise<TerrainSummaryRecord | undefined> {
  const envDir = process.env.TOPOGRAPHICAL_SUMMARY_DIR
  const candidateDirs = [
    ...(envDir ? [envDir] : []),
    path.join(process.cwd(), 'topographical_summaries'),
    path.join(process.cwd(), 'public', 'topographical_summaries'),
    path.join(process.cwd(), '.output', 'public', 'topographical_summaries'),
  ]

  for (const directory of candidateDirs) {
    try {
      const payload = await readFile(
        path.join(directory, `${tileName}.json`),
        'utf8',
      )
      return terrainSummarySchema.parse(JSON.parse(payload))
    } catch {
      continue
    }
  }

  return undefined
}

async function loadRemoteTerrainSummary(
  tileName: string,
): Promise<TerrainSummaryRecord | undefined> {
  const client = createS3Client()
  const bucket = process.env.SOURCE_BUCKET

  if (!client || !bucket) {
    return undefined
  }

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `${getOutputPrefix()}/${tileName}.json`,
      }),
    )

    const payload = await response.Body?.transformToString()
    if (!payload) {
      return undefined
    }

    return terrainSummarySchema.parse(JSON.parse(payload))
  } catch {
    return undefined
  }
}

async function loadRasterFromPath(localPath: string) {
  const cacheKey = `local:${localPath}`
  let promise = rasterCache.get(cacheKey)

  if (!promise) {
    promise = (async () => {
      try {
        const dataset = await fromFile(localPath)
        const image = await dataset.getImage()
        return {
          dataset,
          image,
          bbox: toBboxTuple(image.getBoundingBox()),
          nodata: image.getGDALNoData(),
        } satisfies RasterDataset
      } catch {
        return undefined
      }
    })()

    rasterCache.set(cacheKey, promise)
  }

  return promise
}

async function loadRasterFromS3Key(key: string) {
  const cacheKey = `s3:${key}`
  let promise = rasterCache.get(cacheKey)

  if (!promise) {
    promise = (async () => {
      const client = createS3Client()
      const bucket = process.env.SOURCE_BUCKET

      if (!client || !bucket) {
        return undefined
      }

      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        )

        const bytes = await response.Body?.transformToByteArray()
        if (!bytes) {
          return undefined
        }

        const dataset = await fromArrayBuffer(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        )
        const image = await dataset.getImage()

        return {
          dataset,
          image,
          bbox: toBboxTuple(image.getBoundingBox()),
          nodata: image.getGDALNoData(),
        } satisfies RasterDataset
      } catch {
        return undefined
      }
    })()

    rasterCache.set(cacheKey, promise)
  }

  return promise
}

async function summarizeTerrainBounds(
  raster: RasterDataset,
  bounds: BoundsTuple,
) {
  const rasterBbox = intersectBboxes(toBboxTuple(flattenBounds(bounds)), raster.bbox)
  if (!rasterBbox) {
    return undefined
  }

  const samples = await raster.dataset.readRasters({
    bbox: rasterBbox,
    interleave: true,
    fillValue: raster.nodata ?? -9999,
  })

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let validCount = 0
  const totalCount = samples.length

  for (const rawValue of samples as Iterable<number>) {
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value === raster.nodata || value <= -9999) {
      continue
    }

    min = Math.min(min, value)
    max = Math.max(max, value)
    sum += value
    validCount += 1
  }

  if (validCount === 0) {
    return undefined
  }

  return {
    stats: {
      min,
      max,
      mean: sum / validCount,
    },
    landCoveragePct: (validCount / Math.max(totalCount, 1)) * 100,
  }
}

async function summarizePopulationBounds(
  raster: RasterDataset,
  bounds: BoundsTuple,
) {
  const rasterBbox = intersectBboxes(toBboxTuple(flattenBounds(bounds)), raster.bbox)
  if (!rasterBbox) {
    return undefined
  }

  const samples = await raster.dataset.readRasters({
    bbox: rasterBbox,
    interleave: true,
    fillValue: 0,
  })

  let count = 0

  for (const rawValue of samples as Iterable<number>) {
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value <= 0 || value === raster.nodata) {
      continue
    }
    count += value
  }

  const areaSqKm = estimateBoundsAreaSqKm(bounds)

  return {
    count,
    density: areaSqKm > 0 ? count / areaSqKm : 0,
  }
}

function resolveCountryByPoint(center: [number, number]) {
  for (const country of CARIBBEAN_COUNTRY_BOUNDARIES) {
    if (country.polygons.some((polygon) => pointInPolygon(center, polygon))) {
      return country
    }
  }

  return undefined
}

function flattenBounds(bounds: BoundsTuple): [number, number, number, number] {
  const [[west, south], [east, north]] = normalizeBounds(bounds)
  return [west, south, east, north]
}

function intersectBboxes(
  left: [number, number, number, number],
  right: [number, number, number, number],
): [number, number, number, number] | null {
  const west = Math.max(left[0], right[0])
  const south = Math.max(left[1], right[1])
  const east = Math.min(left[2], right[2])
  const north = Math.min(left[3], right[3])

  if (west >= east || south >= north) {
    return null
  }

  return [west, south, east, north]
}

function toBboxTuple(value: number[]): [number, number, number, number] {
  return [value[0], value[1], value[2], value[3]]
}

function buildWorldPopRasterCandidates(
  iso3: string,
  metadata: Awaited<ReturnType<typeof loadWorldPopMetadata>>,
) {
  const candidates = new Set<string>()
  const payload = metadata?.payload

  const addCandidate = (value: string | null | undefined) => {
    if (!value) {
      return
    }

    const filename = path.basename(value)
    if (/\.(tif|tiff)$/i.test(filename)) {
      candidates.add(filename)
    }
  }

  addCandidate(payload?.data_file)
  for (const filename of payload?.files ?? []) {
    addCandidate(filename)
  }

  candidates.add(`${iso3.toLowerCase()}.tif`)
  candidates.add(`${iso3.toLowerCase()}.tiff`)
  candidates.add(`${iso3.toLowerCase()}_population.tif`)
  candidates.add(`${iso3.toLowerCase()}_population.tiff`)
  candidates.add(`${iso3.toUpperCase()}.tif`)
  candidates.add(`${iso3.toUpperCase()}.tiff`)

  return Array.from(candidates)
}

function createS3Client() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const endpoint = process.env.S3_ENDPOINT

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    return null
  }

  return new S3Client({
    region: process.env.AWS_REGION ?? 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  })
}

function getOutputPrefix() {
  return (process.env.OUTPUT_PREFIX ?? DEFAULT_OUTPUT_PREFIX).replace(
    /\/+$/,
    '',
  )
}
