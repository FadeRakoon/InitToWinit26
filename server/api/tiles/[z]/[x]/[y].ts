import {
  defineEventHandler,
  getRouterParam,
  createError,
  sendRedirect,
} from 'h3'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const S3_BUCKET = 'organized-satchel-dyu5zvi'

const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
})

export default defineEventHandler(async (event) => {
  const z = getRouterParam(event, 'z')
  const x = getRouterParam(event, 'x')
  const y = getRouterParam(event, 'y')

  if (!z || !x || !y) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing tile parameters',
    })
  }

  const yClean = y.replace('.png', '')
  const key = `tiles/${z}/${x}/${yClean}.png`

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  try {
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    })

    return sendRedirect(event, signedUrl, 302)
  } catch (error) {
    console.error('Error generating signed URL for tile:', key, error)
    throw createError({
      statusCode: 404,
      statusMessage: 'Tile not found',
    })
  }
})
