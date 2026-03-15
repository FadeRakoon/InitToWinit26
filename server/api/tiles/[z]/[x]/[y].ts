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

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  try {
    const response = await s3Client.send(command)
    console.log(
      '[tiles] S3 response received, ContentLength:',
      response.ContentLength,
    )

    const stream = response.Body
    if (!stream) {
      console.log('[tiles] No body in S3 response')
      throw createError({
        statusCode: 404,
        statusMessage: 'Tile not found',
      })
    }

    const chunks: Uint8Array[] = []
    const reader = stream.transformToWebStream().getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const buffer = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.length
    }

    console.log('[tiles] Tile fetched successfully, size:', buffer.length)

    setResponseHeader(event, 'Content-Type', 'image/png')
    setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
    setResponseHeader(event, 'Access-Control-Allow-Origin', '*')

    return buffer
  } catch (error) {
    console.error('[tiles] Error fetching tile from S3:', key, error)
    throw createError({
      statusCode: 404,
      statusMessage: 'Tile not found',
    })
  }
})
