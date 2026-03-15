import { Output, generateText } from 'ai'
import { aiInsightSchema, regionInsightResponseSchema } from './contracts'
import {
  aggregateStorms,
  loadNearestSurgeStation,
  loadPopulationData,
  loadStormRows,
  loadTerrainSummary,
  resolveAnalysisBounds,
  selectHistoricalAnalog,
} from './insightsData.server'
import {
  buildFallbackInsight,
  buildMetrics,
  buildRiskProfile,
  formatHistoricalAnalog,
  round,
} from './insightMath'
import { resolveOpenRouterModel } from './openrouter.server'
import type { HistoricalAnalog, RegionInsightInput, RegionInsightResponse } from './types'

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

async function generateHydrologicalInsight(input: {
  label: string
  riskProfile: RegionInsightResponse['riskProfile']
  metrics: RegionInsightResponse['metrics']
  historicalAnalog?: HistoricalAnalog
  confidenceNotes: string[]
}) {
  const fallback = buildFallbackInsight(input)
  const model = resolveOpenRouterModel()

  if (!model) {
    return fallback
  }

  try {
    const facts = buildPromptFacts(input)

    const { output } = await generateText({
      model,
      system: [
        'Your name is Winston.',
        'You explain flood and storm exposure for a public-facing Caribbean map sidebar.',
        'Write with clear and concise wording.',
        'Give definite answers when the available data supports one.',
        'Do not end with follow-up prompts or invitation language.',
        'Keep the response below 150 words.',
        'Prefer qualitative, plain-language descriptions over dense numeric detail unless a precise value is necessary.',
        'Avoid emphasizing large numbers when a subjective description communicates the risk more clearly.',
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
