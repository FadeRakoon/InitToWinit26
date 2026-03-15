import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { fromArrayBuffer, fromFile } from 'geotiff'
import path from 'node:path'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { deriveTileName } from './insightMath'

const inputSchema = z.object({
  bounds: z.tuple([
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()]),
  ]),
  subGridSize: z.number().min(1).max(100).default(20),
})

type RasterDataset = {
  dataset: Awaited<ReturnType<typeof fromFile>>
  image: Awaited<ReturnType<Awaited<ReturnType<typeof fromFile>>['getImage']>>
  bbox: [number, number, number, number]
  nodata: number | null
}

const rasterCache = new Map<string, Promise<RasterDataset | undefined>>()

function toBboxTuple(value: number[]): [number, number, number, number] {
  return [value[0], value[1], value[2], value[3]]
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

function getTileFilename(lng: number, lat: number): string {
  const tileName = deriveTileName([lng, lat])
  return `${tileName}.tif`
}

async function loadTerrainRaster(
  tileFilename: string,
): Promise<RasterDataset | undefined> {
  const s3Key = `caribbean_tiles/${tileFilename}`
  const localCandidates = [
    process.env.TERRAIN_RASTER_PATH,
    path.join(process.cwd(), 'data', 'caribbean_tiles', tileFilename),
    path.join(process.cwd(), 'public', 'caribbean_tiles', tileFilename),
  ].filter(Boolean) as string[]

  console.log('[loadTerrainRaster] Trying to load:', tileFilename)
  console.log('[loadTerrainRaster] Local candidates:', localCandidates)
  console.log('[loadTerrainRaster] S3 key:', s3Key)

  for (const localPath of localCandidates) {
    const raster = await loadRasterFromPath(localPath)
    if (raster) {
      console.log('[loadTerrainRaster] Loaded from local:', localPath)
      return raster
    }
  }

  console.log('[loadTerrainRaster] No local file found, trying S3...')
  const s3Raster = await loadRasterFromS3Key(s3Key)
  if (s3Raster) {
    console.log('[loadTerrainRaster] Loaded from S3:', s3Key)
  } else {
    console.log('[loadTerrainRaster] Failed to load from S3:', s3Key)
  }
  return s3Raster
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

      console.log('[loadRasterFromS3Key] Bucket:', bucket, 'Key:', key)
      console.log('[loadRasterFromS3Key] S3Client created:', !!client)

      if (!client || !bucket) {
        console.log('[loadRasterFromS3Key] Missing client or bucket')
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
          console.log('[loadRasterFromS3Key] No response body')
          return undefined
        }

        console.log('[loadRasterFromS3Key] Received bytes:', bytes.length)

        const dataset = await fromArrayBuffer(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        )
        const image = await dataset.getImage()

        console.log(
          '[loadRasterFromS3Key] GeoTIFF loaded, size:',
          image.getWidth(),
          'x',
          image.getHeight(),
        )

        return {
          dataset,
          image,
          bbox: toBboxTuple(image.getBoundingBox()),
          nodata: image.getGDALNoData(),
        } satisfies RasterDataset
      } catch (err) {
        console.error('[loadRasterFromS3Key] Error loading from S3:', err)
        return undefined
      }
    })()

    rasterCache.set(cacheKey, promise)
  }

  return promise
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

export const fetchSubGridElevations = createServerFn({ method: 'POST' })
  .inputValidator(inputSchema)
  .handler(async ({ data }) => {
    const { bounds, subGridSize } = data
    const [[west, south], [east, north]] = bounds
    const centerLng = (west + east) / 2
    const centerLat = (south + north) / 2

    const tileFilename = getTileFilename(centerLng, centerLat)
    console.log(
      '[fetchSubGridElevations] Loading tile:',
      tileFilename,
      'for center:',
      centerLng,
      centerLat,
    )

    const raster = await loadTerrainRaster(tileFilename)

    if (!raster) {
      console.log('[fetchSubGridElevations] Failed to load tile:', tileFilename)
      return {
        success: false,
        error: `Terrain tile not found: ${tileFilename}`,
        elevations: [],
      }
    }

    console.log(
      '[fetchSubGridElevations] Loaded raster, bbox:',
      raster.bbox,
      'nodata:',
      raster.nodata,
    )

    const rasterBbox = intersectBboxes([west, south, east, north], raster.bbox)

    if (!rasterBbox) {
      return {
        success: false,
        error: 'Bounds outside raster coverage',
        elevations: [],
      }
    }

    try {
      const samples = await raster.dataset.readRasters({
        bbox: rasterBbox,
        interleave: true,
        fillValue: raster.nodata ?? -9999,
      })

      const width = raster.image.getWidth()
      const height = raster.image.getHeight()
      const pixelWidth = (raster.bbox[2] - raster.bbox[0]) / width
      const pixelHeight = (raster.bbox[3] - raster.bbox[1]) / height

      const latStep = (north - south) / subGridSize
      const lngStep = (east - west) / subGridSize

      const elevations: number[] = []

      for (let row = 0; row < subGridSize; row++) {
        for (let col = 0; col < subGridSize; col++) {
          const lng = west + lngStep * (col + 0.5)
          const lat = north - latStep * (row + 0.5)

          const px = Math.floor((lng - raster.bbox[0]) / pixelWidth)
          const py = Math.floor((raster.bbox[3] - lat) / pixelHeight)

          const clampedPx = Math.max(0, Math.min(width - 1, px))
          const clampedPy = Math.max(0, Math.min(height - 1, py))

          const idx = clampedPy * width + clampedPx
          const rawValue = Number(samples[idx])

          if (
            !Number.isFinite(rawValue) ||
            rawValue <= -9999 ||
            rawValue === raster.nodata
          ) {
            elevations.push(0)
          } else {
            elevations.push(rawValue)
          }
        }
      }

      return {
        success: true,
        elevations,
        subGridSize,
        bounds,
      }
    } catch (error) {
      console.error('[fetchSubGridElevations] Error sampling raster:', error)
      return {
        success: false,
        error: 'Failed to sample raster',
        elevations: [],
      }
    }
  })
