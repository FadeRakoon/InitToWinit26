import {
  defineEventHandler,
  getRouterParam,
  createError,
  setResponseHeader,
} from 'h3'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const S3_ENDPOINT = process.env.S3_ENDPOINT || 'https://t3.storageapi.dev'
const S3_BUCKET = process.env.SOURCE_BUCKET || 'organized-satchel-dyu5zvi'
const S3_REGION = process.env.AWS_REGION || 'auto'
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 500

console.log('[tiles] Initializing S3 client')
console.log('[tiles] Endpoint:', S3_ENDPOINT)
console.log('[tiles] Bucket:', S3_BUCKET)
console.log('[tiles] Region:', S3_REGION)
console.log('[tiles] AWS_ACCESS_KEY_ID set:', !!process.env.AWS_ACCESS_KEY_ID)
console.log(
  '[tiles] AWS_SECRET_ACCESS_KEY set:',
  !!process.env.AWS_SECRET_ACCESS_KEY,
)

const s3Client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

async function fetchTileWithRetry(
  key: string,
  retries: number = MAX_RETRIES,
): Promise<Uint8Array | null> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      })

      const response = await s3Client.send(command)

      if (!response.Body) {
        throw new Error('Empty response body')
      }

      const bytes = await response.Body.transformToByteArray()
      console.log(
        `[tiles] Successfully fetched ${key} on attempt ${attempt}, size: ${bytes.length}`,
      )
      return bytes
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(
        `[tiles] Attempt ${attempt}/${retries} failed for ${key}:`,
        lastError.message,
      )

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
  }

  console.error(
    `[tiles] All ${retries} attempts failed for ${key}:`,
    lastError?.message,
  )
  return null
}

export default defineEventHandler(async (event) => {
  const z = getRouterParam(event, 'z')
  const x = getRouterParam(event, 'x')
  const y = getRouterParam(event, 'y')

  console.log('[tiles] Request received:', { z, x, y })

  if (!z || !x || !y) {
    console.log('[tiles] Missing parameters')
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing tile parameters',
    })
  }

  const yClean = y.replace('.png', '')
  const key = `tiles/${z}/${x}/${yClean}.png`

  console.log('[tiles] Fetching from S3:', key)

  const tileData = await fetchTileWithRetry(key)

  if (!tileData) {
    console.log('[tiles] Tile not found after retries:', key)
    throw createError({
      statusCode: 404,
      statusMessage: 'Tile not found',
    })
  }

  console.log('[tiles] Tile fetched successfully, size:', tileData.length)

  setResponseHeader(event, 'Content-Type', 'image/png')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')

  return tileData
})
