import { defineEventHandler, readBody } from 'h3'
import {
  createWinstonChatResponse,
  validateWinstonMessages,
} from '../../src/features/map/winston.server'
import { winstonChatRequestSchema } from '../../src/features/map/winstonChatSchema'

export default defineEventHandler(async (event) => {
  const json = await readBody(event).catch(() => null)

  if (json === null) {
    return Response.json(
      {
        error: 'Invalid JSON request body.',
      },
      { status: 400 },
    )
  }

  const parsed = winstonChatRequestSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json(
      {
        error: 'Invalid Winston chat payload.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const result = await validateWinstonMessages(
    parsed.data.messages,
    parsed.data.region,
  )

  if (!result.success) {
    return Response.json(
      {
        error: 'Invalid chat messages.',
        message: result.error.message,
      },
      { status: 400 },
    )
  }

  return createWinstonChatResponse({
    messages: result.data,
    region: parsed.data.region,
    sidebarInsight: parsed.data.sidebarInsight,
  })
})
