import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  tool,
} from 'ai'
import { z } from 'zod'
import {
  aggregateStorms,
  listHistoricalAnalogs,
  loadNearestSurgeStation,
  loadPopulationData,
  loadStormRows,
  loadTerrainSummary,
} from './insightsData.server'
import {
  type WinstonChatMessage,
  type WinstonRegion,
  type WinstonSidebarInsight,
} from './winstonChatSchema'
import { resolveOpenRouterModel } from './openrouter.server'

const DEFAULT_STORM_TOOL_RADIUS_KM = 250

const toolPointSchema = z.object({
  lng: z.number(),
  lat: z.number(),
})

const toolBoundsSchema = z.object({
  west: z.number(),
  south: z.number(),
  east: z.number(),
  north: z.number(),
})

const terrainSummaryToolSchema = z.object({
  center: toolPointSchema,
  bounds: toolBoundsSchema,
  gridCellId: z.string().trim().min(1).optional(),
})

const nearestSurgeToolSchema = z.object({
  center: toolPointSchema,
})

const nearbyStormHistoryToolSchema = z.object({
  center: toolPointSchema,
  radiusKm: z.number().positive().max(800).optional(),
  limit: z.number().int().positive().max(10).optional(),
})

const populationContextToolSchema = z.object({
  center: toolPointSchema,
  bounds: toolBoundsSchema,
})

function toLngLat(point: z.infer<typeof toolPointSchema>): [number, number] {
  return [point.lng, point.lat]
}

function toBounds(bounds: z.infer<typeof toolBoundsSchema>) {
  return [
    [bounds.west, bounds.south],
    [bounds.east, bounds.north],
  ] as [[number, number], [number, number]]
}

export function createWinstonTools() {
  return {
    getTerrainSummary: tool({
      description:
        'Get terrain and relief metrics for the selected grid cell. Use this before making elevation, relief, or land-coverage claims.',
      inputSchema: terrainSummaryToolSchema,
      execute: async ({ center, bounds }) => {
        const terrain = await loadTerrainSummary(
          toLngLat(center),
          toBounds(bounds),
        )

        if (!terrain) {
          return undefined
        }

        return {
          tileName: terrain.record.tileName,
          precision: terrain.precision,
          reliefM: terrain.record.stats.max - terrain.record.stats.min,
          stats: terrain.record.stats,
          coverage: terrain.record.coverage,
          positionBand: terrain.record.positionBand,
        }
      },
    }),
    getNearestSurgeLevels: tool({
      description:
        'Get the nearest coastal surge station and its return-level estimates for the current cell. Use this for surge distances and water-height numbers.',
      inputSchema: nearestSurgeToolSchema,
      execute: async ({ center }) => {
        const station = await loadNearestSurgeStation(toLngLat(center))
        if (!station) {
          return undefined
        }

        return station
      },
    }),
    getNearbyStormHistory: tool({
      description:
        'Get nearby historical storm context for the selected cell, including counts, strongest wind, latest year, and top analog storms.',
      inputSchema: nearbyStormHistoryToolSchema,
      execute: async ({ center, radiusKm, limit }) => {
        const resolvedRadiusKm = radiusKm ?? DEFAULT_STORM_TOOL_RADIUS_KM
        const rows = await loadStormRows(toLngLat(center), resolvedRadiusKm)
        const aggregate = aggregateStorms(rows, resolvedRadiusKm)
        const analogs = listHistoricalAnalogs(rows, {
          radiusKm: resolvedRadiusKm,
          limit: limit ?? 3,
        })

        return {
          radiusKm: resolvedRadiusKm,
          stormCount: aggregate.distinctStormCount,
          strongestWindKt: aggregate.strongestWindKt,
          mostRecentStormYear: aggregate.mostRecentStormYear,
          analogs,
        }
      },
    }),
    getPopulationContext: tool({
      description:
        'Get estimated population and density for the selected cell. Use this before making exposure or community-population claims.',
      inputSchema: populationContextToolSchema,
      execute: async ({ center, bounds }) => {
        const population = await loadPopulationData(
          toLngLat(center),
          toBounds(bounds),
        )
        if (!population) {
          return undefined
        }

        return {
          iso3: population.iso3,
          sourceYear: population.sourceYear,
          estimatedPopulation: population.count,
          density: population.density,
        }
      },
    }),
  }
}

export async function validateWinstonMessages(
  messages: unknown[],
  region: WinstonRegion,
) {
  const result = await safeValidateUIMessages<WinstonChatMessage>({
    messages,
    tools: createWinstonTools(),
  })

  return result
}

export async function createWinstonChatStream({
  messages,
  region,
  sidebarInsight,
  model,
}: {
  messages: WinstonChatMessage[]
  region: WinstonRegion
  sidebarInsight?: WinstonSidebarInsight
  model?: Parameters<typeof streamText>[0]['model']
}) {
  const resolvedModel = model ?? resolveOpenRouterModel()

  if (!resolvedModel) {
    return createUnavailableChatStream(messages)
  }

  const tools = createWinstonTools()
  const result = streamText({
    model: resolvedModel,
    system: buildWinstonSystemPrompt(region, sidebarInsight),
    messages: await convertToModelMessages(messages),
    tools,
    temperature: 0.3,
    stopWhen: stepCountIs(6),
  })

  return result.toUIMessageStream<WinstonChatMessage>({
    originalMessages: messages,
    onError: () =>
      'Winston ran into a problem while checking the regional data. Please try again.',
  })
}

export async function createWinstonChatResponse({
  messages,
  region,
  sidebarInsight,
  model,
}: {
  messages: WinstonChatMessage[]
  region: WinstonRegion
  sidebarInsight?: WinstonSidebarInsight
  model?: Parameters<typeof streamText>[0]['model']
}) {
  const stream = await createWinstonChatStream({
    messages,
    region,
    sidebarInsight,
    model,
  })

  return createUIMessageStreamResponse({ stream })
}

function buildWinstonSystemPrompt(
  region: WinstonRegion,
  sidebarInsight?: WinstonSidebarInsight,
) {
  const lines = [
    'You are Winston, a hydrology-focused assistant embedded in a public map experience for Jamaica and the wider Caribbean.',
    'Your name is Winston.',
    `You are answering questions only about the currently selected cell: Region ${region.gridCellId}.`,
    `Current cell label: ${region.label}.`,
    `Current cell center: longitude ${region.center[0]}, latitude ${region.center[1]}.`,
    `Current cell bounds: west ${region.bounds[0][0]}, south ${region.bounds[0][1]}, east ${region.bounds[1][0]}, north ${region.bounds[1][1]}.`,
    'Be concise, plain-spoken, and concrete.',
    'Give clear and concise answers with only the detail needed to answer the question well.',
    'Give definite answers when the available data supports one.',
    'Do not end responses with follow-up prompts such as "If you want, tell me..." or similar invitation language.',
    'Keep every response below 150 words.',
    'Prefer qualitative, plain-language descriptions over dense numeric detail unless a precise value is necessary to answer the question.',
    'Avoid throwing large numbers at the user. Summarize scale subjectively when possible, and include exact figures only when they materially help.',
    'Do not make up measurements, counts, dates, or events.',
    'Use the available tools before making numeric or data-backed claims.',
    'If a tool returns no data, say the data is unavailable instead of guessing.',
    'Keep answers grounded to the selected cell unless the user explicitly asks to compare or clarify.',
  ]

  if (sidebarInsight) {
    lines.push('Existing sidebar analysis is available as context:')
    lines.push(`Risk band: ${sidebarInsight.riskProfile.band}`)
    lines.push(`Risk score: ${sidebarInsight.riskProfile.score}/100`)
    lines.push(`Confidence: ${sidebarInsight.riskProfile.confidence}`)
    lines.push(
      `Top drivers: ${sidebarInsight.riskProfile.topDrivers.join(', ') || 'None listed'}`,
    )
    lines.push(`Headline: ${sidebarInsight.aiInsight.headline}`)
    lines.push(`Explanation: ${sidebarInsight.aiInsight.explanation}`)

    if (sidebarInsight.aiInsight.caution) {
      lines.push(`Caution: ${sidebarInsight.aiInsight.caution}`)
    }

    if (sidebarInsight.historicalAnalog) {
      lines.push(
        `Historical analog: ${sidebarInsight.historicalAnalog.label}, closest approach ${sidebarInsight.historicalAnalog.closestApproachKm} km.`,
      )
    }

    if (sidebarInsight.dataQuality.confidenceNotes.length > 0) {
      lines.push(
        `Confidence notes: ${sidebarInsight.dataQuality.confidenceNotes.join(' ')}`,
      )
    }
  }

  return lines.join('\n')
}

function createUnavailableChatStream(messages: WinstonChatMessage[]) {
  const fallbackText =
    'Winston is offline right now because the AI model is not configured on the server. The map sidebar insights still work, but live chat is unavailable until OPENROUTER_API_KEY and OPENROUTER_MODEL are set.'

  return createUIMessageStream<WinstonChatMessage>({
    originalMessages: messages,
    execute: ({ writer }) => {
      const textId = 'winston-unavailable'
      writer.write({
        type: 'text-start',
        id: textId,
      })
      writer.write({
        type: 'text-delta',
        id: textId,
        delta: fallbackText,
      })
      writer.write({
        type: 'text-end',
        id: textId,
      })
    },
  })
}
