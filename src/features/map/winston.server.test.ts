import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWinstonChatStream } from './winston.server'
import {
  buildWinstonGreeting,
  type WinstonChatMessage,
  type WinstonRegion,
} from './winstonChatSchema'

vi.mock('./insightsData.server', () => ({
  aggregateStorms: vi.fn((rows: Array<{ stormId: string; windKt: number; stormDate: string }>) => ({
    distinctStormCount: rows.length,
    strongestWindKt: rows[0]?.windKt,
    mostRecentStormYear: rows[0] ? Number(rows[0].stormDate.slice(0, 4)) : undefined,
  })),
  listHistoricalAnalogs: vi.fn(() => []),
  loadNearestSurgeStation: vi.fn(async () => ({
    stationId: 7,
    distanceKm: 12.3,
    rp1Bestfit: 0.5,
    rp1Lower5: 0.4,
    rp1Upper95: 0.6,
    rp2Bestfit: 0.7,
    rp2Lower5: 0.6,
    rp2Upper95: 0.8,
    rp5Bestfit: 0.9,
    rp5Lower5: 0.8,
    rp5Upper95: 1.0,
    rp10Bestfit: 1.1,
    rp10Lower5: 1.0,
    rp10Upper95: 1.2,
    rp25Bestfit: 1.3,
    rp25Lower5: 1.2,
    rp25Upper95: 1.4,
    rp50Bestfit: 1.5,
    rp50Lower5: 1.4,
    rp50Upper95: 1.6,
    rp75Bestfit: 1.7,
    rp75Lower5: 1.6,
    rp75Upper95: 1.8,
    rp100Bestfit: 1.9,
    rp100Lower5: 1.8,
    rp100Upper95: 2.0,
  })),
  loadPopulationData: vi.fn(async () => undefined),
  loadStormRows: vi.fn(async () => []),
  loadTerrainSummary: vi.fn(async () => undefined),
}))

function usage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: 0,
    },
  }
}

const region: WinstonRegion = {
  kind: 'cell',
  label: 'Region A1',
  center: [-76.8, 18],
  bounds: [
    [-76.81, 17.99],
    [-76.79, 18.01],
  ],
  gridCellId: 'A1',
}

function createMessages(): WinstonChatMessage[] {
  return [
    buildWinstonGreeting(region),
    {
      id: 'user-1',
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'How bad is the surge risk here?',
        },
      ],
    },
  ]
}

async function collectAssistantSnapshots(stream: ReadableStream<UIMessageChunk>) {
  const snapshots: WinstonChatMessage[] = []

  for await (const message of readUIMessageStream<WinstonChatMessage>({ stream })) {
    snapshots.push(message)
  }

  return snapshots
}

describe('winston.server', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_MODEL
    delete process.env.OPENROUTER_HTTP_REFERER
    delete process.env.OPENROUTER_APP_TITLE
  })

  it('streams a friendly unavailable assistant response when the AI model is not configured', async () => {
    const snapshots = await collectAssistantSnapshots(
      await createWinstonChatStream({
        messages: createMessages(),
        region,
      }),
    )

    const finalMessage = snapshots.at(-1)
    const text = finalMessage?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ')

    expect(text).toContain('Winston is offline right now')
  })

  it('streams tool calls and the final assistant answer with a mock model', async () => {
    const dataModule = await import('./insightsData.server')
    const toolInput = JSON.stringify({ center: region.center })
    const streams = [
      {
        stream: simulateReadableStream<any>({
          chunks: [
            { type: 'stream-start', warnings: [] },
            {
              type: 'tool-input-start',
              id: 'tool-call-1',
              toolName: 'getNearestSurgeLevels',
            },
            {
              type: 'tool-input-delta',
              id: 'tool-call-1',
              delta: toolInput,
            },
            {
              type: 'tool-input-end',
              id: 'tool-call-1',
            },
            {
              type: 'tool-call',
              toolCallId: 'tool-call-1',
              toolName: 'getNearestSurgeLevels',
              input: toolInput,
            },
            {
              type: 'finish',
              finishReason: 'tool-calls' as const,
              usage: usage(),
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream<any>({
          chunks: [
            { type: 'stream-start', warnings: [] },
            {
              type: 'text-start',
              id: 'text-1',
            },
            {
              type: 'text-delta',
              id: 'text-1',
              delta: 'The nearest surge station is 12.3 km away, with a 100-year return level near 1.9 m.',
            },
            {
              type: 'text-end',
              id: 'text-1',
            },
            {
              type: 'finish',
              finishReason: 'stop' as const,
              usage: usage(),
            },
          ],
        }),
      },
    ]
    let streamIndex = 0
    const model = new MockLanguageModelV3({
      doStream: async () => streams[streamIndex++]!,
    })

    const snapshots = await collectAssistantSnapshots(
      await createWinstonChatStream({
        messages: createMessages(),
        region,
        model,
      }),
    )

    const finalMessage = snapshots.at(-1)
    const assistantText = finalMessage?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ')

    expect(dataModule.loadNearestSurgeStation).toHaveBeenCalledWith(region.center)
    expect(assistantText).toContain('12.3 km away')
  })
})
