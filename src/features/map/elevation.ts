import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { fromArrayBuffer, fromFile } from 'geotiff'
import path from 'node:path'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

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
  const latInt = Math.floor(Math.abs(lat))
  const latDir = lat >= 0 ? 'N' : 'S'
  const latStr = latInt.toString().padStart(2, '0')

  const lngInt = Math.ceil(Math.abs(lng))
  const lngDir = lng <= 0 ? 'W' : 'E'
  const lngStr = lngInt.toString().padStart(3, '0')

  return `Copernicus_DSM_COG_10_${latDir}${latStr}_00_${lngDir}${lngStr}_00_DEM.tif`
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

  for (const localPath of localCandidates) {
    const raster = await loadRasterFromPath(localPath)
    if (raster) {
      return raster
    }
  }

  return loadRasterFromS3Key(s3Key)
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
    const raster = await loadTerrainRaster(tileFilename)

    if (!raster) {
      return {
        success: false,
        error: `Terrain tile not found: ${tileFilename}`,
        elevations: [],
      }
    }

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
        interleave: true,
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
