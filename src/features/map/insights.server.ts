import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { openai } from '@ai-sdk/openai'
import { Output, generateText } from 'ai'
import { and, between, eq } from 'drizzle-orm'
import { fromArrayBuffer, fromFile } from 'geotiff'
import { z } from 'zod'
import { CARIBBEAN_COUNTRY_BOUNDARIES } from './caribbeanCountryBoundaries'
import { GRID_LAT_STEP, GRID_LNG_STEP } from './config'
import { aiInsightSchema, regionInsightResponseSchema } from './contracts'
import {
  buildFallbackInsight,
  buildMetrics,
  buildRiskProfile,
  deriveTileName,
  estimateBoundsAreaSqKm,
  formatHistoricalAnalog,
  haversineDistanceKm,
  inferTerrainPositionBand,
  round,
} from './insightMath'
import type {
  NearestSurgeStation,
  StormAggregate,
  TerrainSummaryRecord,
} from './insightMath'
import type {
  BoundsTuple,
  HistoricalAnalog,
  RegionInsightInput,
  RegionInsightResponse,
} from './types'

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

interface StormCandidate extends StormRow {
  distanceKm: number
}

interface TerrainLoadResult {
  record: TerrainSummaryRecord
  precision: 'cell' | 'coarse'
}

interface PopulationLoadResult {
  count: number
  density: number
  iso3: string
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

export async function calculateRegionInsights(
  input: RegionInsightInput,
): Promise<RegionInsightResponse> {
  const confidenceNotes: string[] = []
  const analysisBounds = resolveAnalysisBounds(input)

  const [terrainResult, nearestSurge, stormRows, populationData] =
    await Promise.all([
      loadTerrainSummary(input.center, analysisBounds).catch(() => undefined),
      loadNearestSurgeStation(input.center).catch(() => null),
      loadStormRows(input.center).catch(() => []),
      loadPopulationData(input.center, analysisBounds).catch(() => undefined),
    ])

  const terrain = terrainResult?.record

  if (!terrain) {
    confidenceNotes.push(
      'No topographical summary was available for this location.',
    )
  } else if (terrainResult.precision === 'coarse') {
    confidenceNotes.push(
      'Cell-scale DEM data was unavailable, so terrain scoring falls back to a coarse regional summary.',
    )
  }

  if (!nearestSurge) {
    confidenceNotes.push(
      'No nearby surge station was available for this location.',
    )
  } else if (nearestSurge.distanceKm > 120) {
    confidenceNotes.push(
      `Nearest surge station is ${round(nearestSurge.distanceKm)} km away, so coastal estimates are less precise.`,
    )
  }

  if (!populationData) {
    confidenceNotes.push(
      'Local population context could not be reliably determined for this analysis window.',
    )
  }

  const stormAggregate = aggregateStorms(stormRows)
  const historicalAnalog = selectHistoricalAnalog(stormRows)

  if (!stormAggregate.distinctStormCount) {
    confidenceNotes.push(
      'Historical storm coverage is sparse near this coordinate.',
    )
  }

  const metrics = buildMetrics({
    terrain,
    nearestSurge: nearestSurge ?? undefined,
    storms: stormAggregate,
    populationDensityPerSqKm: populationData?.density,
    estimatedPopulation: populationData?.count,
  })

  const riskProfile = buildRiskProfile({
    terrain,
    nearestSurge: nearestSurge ?? undefined,
    storms: stormAggregate,
    populationDensityPerSqKm: populationData?.density,
    estimatedPopulation: populationData?.count,
    confidenceNotes,
  })

  const aiInsight = await generateHydrologicalInsight({
    label: input.label,
    riskProfile,
    metrics,
    historicalAnalog,
    confidenceNotes,
  })

  return regionInsightResponseSchema.parse({
    riskProfile,
    aiInsight,
    metrics,
    historicalAnalog,
    dataQuality: {
      terrainAvailable: Boolean(terrain),
      surgeAvailable: Boolean(nearestSurge),
      stormHistoryAvailable: stormAggregate.distinctStormCount > 0,
      confidenceNotes,
    },
  })
}

async function loadPopulationData(
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
  }
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

async function loadNearestSurgeStation(
  center: [number, number],
): Promise<NearestSurgeStation | null> {
  const { db, schema } = await import('../../../db/client.ts')
  const rows = await db.select().from(schema.surgeReturnLevels)

  if (rows.length === 0) {
    return null
  }

  let best: NearestSurgeStation | null = null

  for (const row of rows) {
    const distanceKm = haversineDistanceKm(center, [row.lon, row.lat])

    if (!best || distanceKm < best.distanceKm) {
      best = {
        stationId: row.stationId,
        distanceKm,
        rp1Bestfit: row.rp1Bestfit,
        rp10Bestfit: row.rp10Bestfit,
        rp50Bestfit: row.rp50Bestfit,
        rp100Bestfit: row.rp100Bestfit,
        rp100Lower5: row.rp100Lower5,
        rp100Upper95: row.rp100Upper95,
      }
    }
  }

  return best
}

async function loadStormRows(
  center: [number, number],
): Promise<StormCandidate[]> {
  const [lng, lat] = center
  const latDelta = STORM_ANALOG_RADIUS_KM / 111
  const lonDelta =
    STORM_ANALOG_RADIUS_KM /
    Math.max(111 * Math.cos((Math.abs(lat) * Math.PI) / 180), 15)

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
    .filter((row) => row.distanceKm <= STORM_ANALOG_RADIUS_KM)
}

function aggregateStorms(rows: StormCandidate[]): StormAggregate {
  const nearbyRows = rows.filter(
    (row) => row.distanceKm <= STORM_STATS_RADIUS_KM,
  )
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

function selectHistoricalAnalog(
  rows: StormCandidate[],
): HistoricalAnalog | undefined {
  const analogRows = rows.filter(
    (row) => row.distanceKm <= STORM_ANALOG_RADIUS_KM,
  )

  if (analogRows.length === 0) {
    return undefined
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

  const best = Array.from(grouped.entries())
    .map(([stormId, summary]) => ({
      stormId,
      ...summary,
    }))
    .sort((left, right) => {
      if (left.closestApproachKm !== right.closestApproachKm) {
        return left.closestApproachKm - right.closestApproachKm
      }

      if ((left.peakWindKt ?? 0) !== (right.peakWindKt ?? 0)) {
        return (right.peakWindKt ?? 0) - (left.peakWindKt ?? 0)
      }

      return (right.eventDate ?? '').localeCompare(left.eventDate ?? '')
    })[0]

  const year = best.eventDate?.slice(0, 4)
  const baseLabel =
    best.stormName.toUpperCase() === 'UNNAMED'
      ? `Unnamed storm${year ? ` (${year})` : ''}`
      : best.stormName

  return {
    label: `${baseLabel} [${best.stormId}]`,
    closestApproachKm: round(best.closestApproachKm),
    peakWindKt: best.peakWindKt,
    eventDate: best.eventDate,
  }
}

async function loadTerrainSummary(
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

function pointInPolygon(
  [lng, lat]: [number, number],
  polygon: Array<[number, number]>,
) {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function resolveAnalysisBounds(input: RegionInsightInput): BoundsTuple {
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

function normalizeBounds(bounds: BoundsTuple): BoundsTuple {
  const [[lngA, latA], [lngB, latB]] = bounds
  return [
    [Math.min(lngA, lngB), Math.min(latA, latB)],
    [Math.max(lngA, lngB), Math.max(latA, latB)],
  ]
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

async function generateHydrologicalInsight(input: {
  label: string
  riskProfile: RegionInsightResponse['riskProfile']
  metrics: RegionInsightResponse['metrics']
  historicalAnalog?: HistoricalAnalog
  confidenceNotes: string[]
}) {
  const fallback = buildFallbackInsight(input)
  const apiKey = process.env.OPENAI_API_KEY
  const modelName = process.env.OPENAI_MODEL

  if (!apiKey || !modelName) {
    return fallback
  }

  try {
    const facts = buildPromptFacts(input)

    const { output } = await generateText({
      model: openai(modelName),
      system: [
        'You explain flood and storm exposure for a public-facing Caribbean map sidebar.',
        'Use only the provided facts.',
        'Do not invent numbers, events, telemetry, or certainty.',
        'Keep wording plain, compact, and concrete.',
        'If confidence is not high, the caution field must mention uncertainty.',
      ].join(' '),
      prompt: [
        `Region: ${input.label}`,
        `Risk band: ${input.riskProfile.band}`,
        `Risk score: ${input.riskProfile.score}/100`,
        `Confidence: ${input.riskProfile.confidence}`,
        'Facts:',
        ...facts.map((fact) => `- ${fact}`),
      ].join('\n'),
      output: Output.object({
        name: 'HydrologicalInsight',
        description: 'Short public-facing flood insight for a map sidebar.',
        schema: aiInsightSchema,
      }),
    })

    return output
  } catch {
    return fallback
  }
}

function buildPromptFacts(input: {
  riskProfile: RegionInsightResponse['riskProfile']
  metrics: RegionInsightResponse['metrics']
  historicalAnalog?: HistoricalAnalog
  confidenceNotes: string[]
}) {
  const facts: string[] = [...input.riskProfile.topDrivers]

  if (input.metrics.elevationMeanM !== undefined) {
    facts.push(
      `Average land elevation is ${input.metrics.elevationMeanM.toFixed(1)} m.`,
    )
  }

  if (input.metrics.reliefM !== undefined) {
    facts.push(
      `Local relief inside the analysis window is ${input.metrics.reliefM.toFixed(1)} m.`,
    )
  }

  if (input.metrics.surgeRp100M !== undefined) {
    facts.push(
      `Nearest 100-year surge return level is ${input.metrics.surgeRp100M.toFixed(2)} m.`,
    )
  }

  if (input.metrics.nearestSurgeStationKm !== undefined) {
    facts.push(
      `Nearest surge station is ${input.metrics.nearestSurgeStationKm.toFixed(1)} km away.`,
    )
  }

  if (input.metrics.nearbyStormCount !== undefined) {
    facts.push(
      `${input.metrics.nearbyStormCount} historical storms were counted within the nearby analysis radius.`,
    )
  }

  if (input.metrics.strongestNearbyWindKt !== undefined) {
    facts.push(
      `Strongest nearby historical wind reached ${input.metrics.strongestNearbyWindKt} kt.`,
    )
  }

  if (input.metrics.estimatedPopulation !== undefined) {
    facts.push(
      `Estimated population inside the analysis window is ${input.metrics.estimatedPopulation.toLocaleString()}.`,
    )
  }

  if (input.metrics.populationDensityPerSqKm !== undefined) {
    facts.push(
      `Estimated local population density is ${input.metrics.populationDensityPerSqKm.toFixed(1)} people per sq km.`,
    )
  }

  const analogSummary = formatHistoricalAnalog(input.historicalAnalog)
  if (analogSummary) {
    facts.push(`Historical analog: ${analogSummary}`)
  }

  if (input.confidenceNotes.length > 0) {
    facts.push(`Confidence notes: ${input.confidenceNotes.join(' ')}`)
  }

  return facts
}
