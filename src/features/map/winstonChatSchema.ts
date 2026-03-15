import type { UIMessage, UITools } from 'ai'
import { z } from 'zod'
import {
  boundsSchema,
  lngLatSchema,
  regionInsightInputSchema,
  regionInsightResponseSchema,
} from './contracts'

export const winstonRegionSchema = regionInsightInputSchema.extend({
  kind: z.literal('cell'),
  bounds: boundsSchema,
  gridCellId: z.string().trim().min(1),
})

export const getTerrainSummaryInputSchema = z.object({
  center: lngLatSchema,
  bounds: boundsSchema,
  gridCellId: z.string().trim().min(1).optional(),
})

export const getTerrainSummaryOutputSchema = z.object({
  tileName: z.string(),
  precision: z.enum(['cell', 'coarse']),
  reliefM: z.number(),
  stats: z.object({
    min: z.number(),
    max: z.number(),
    mean: z.number(),
  }),
  coverage: z.object({
    landCoveragePct: z.number(),
  }),
  positionBand: z.string().optional(),
})

export const getNearestSurgeLevelsInputSchema = z.object({
  center: lngLatSchema,
})

export const getNearestSurgeLevelsOutputSchema = z.object({
  stationId: z.number(),
  distanceKm: z.number(),
  rp1Bestfit: z.number(),
  rp1Lower5: z.number(),
  rp1Upper95: z.number(),
  rp2Bestfit: z.number(),
  rp2Lower5: z.number(),
  rp2Upper95: z.number(),
  rp5Bestfit: z.number(),
  rp5Lower5: z.number(),
  rp5Upper95: z.number(),
  rp10Bestfit: z.number(),
  rp10Lower5: z.number(),
  rp10Upper95: z.number(),
  rp25Bestfit: z.number(),
  rp25Lower5: z.number(),
  rp25Upper95: z.number(),
  rp50Bestfit: z.number(),
  rp50Lower5: z.number(),
  rp50Upper95: z.number(),
  rp75Bestfit: z.number(),
  rp75Lower5: z.number(),
  rp75Upper95: z.number(),
  rp100Bestfit: z.number(),
  rp100Lower5: z.number(),
  rp100Upper95: z.number(),
})

export const getNearbyStormHistoryInputSchema = z.object({
  center: lngLatSchema,
  radiusKm: z.number().positive().max(800).optional(),
  limit: z.number().int().positive().max(10).optional(),
})

export const getNearbyStormHistoryOutputSchema = z.object({
  radiusKm: z.number(),
  stormCount: z.number().int().nonnegative(),
  strongestWindKt: z.number().optional(),
  mostRecentStormYear: z.number().optional(),
  analogs: z.array(
    z.object({
      stormId: z.string(),
      label: z.string(),
      closestApproachKm: z.number(),
      peakWindKt: z.number().optional(),
      eventDate: z.string().optional(),
    }),
  ),
})

export const getPopulationContextInputSchema = z.object({
  center: lngLatSchema,
  bounds: boundsSchema,
})

export const getPopulationContextOutputSchema = z.object({
  iso3: z.string(),
  sourceYear: z.number().optional(),
  estimatedPopulation: z.number(),
  density: z.number(),
})

export const winstonChatRequestSchema = z.object({
  messages: z.array(z.unknown()),
  region: winstonRegionSchema,
  sidebarInsight: regionInsightResponseSchema.optional(),
})

export type WinstonRegion = z.infer<typeof winstonRegionSchema>
export type GetTerrainSummaryInput = z.infer<typeof getTerrainSummaryInputSchema>
export type GetTerrainSummaryOutput = z.infer<typeof getTerrainSummaryOutputSchema>
export type GetNearestSurgeLevelsInput = z.infer<
  typeof getNearestSurgeLevelsInputSchema
>
export type GetNearestSurgeLevelsOutput = z.infer<
  typeof getNearestSurgeLevelsOutputSchema
>
export type GetNearbyStormHistoryInput = z.infer<
  typeof getNearbyStormHistoryInputSchema
>
export type GetNearbyStormHistoryOutput = z.infer<
  typeof getNearbyStormHistoryOutputSchema
>
export type GetPopulationContextInput = z.infer<
  typeof getPopulationContextInputSchema
>
export type GetPopulationContextOutput = z.infer<
  typeof getPopulationContextOutputSchema
>
export type WinstonSidebarInsight = z.infer<typeof regionInsightResponseSchema>
export type WinstonChatRequest = z.infer<typeof winstonChatRequestSchema>

export interface WinstonChatTools extends UITools {
  getTerrainSummary: {
    input: GetTerrainSummaryInput
    output: GetTerrainSummaryOutput | undefined
  }
  getNearestSurgeLevels: {
    input: GetNearestSurgeLevelsInput
    output: GetNearestSurgeLevelsOutput | undefined
  }
  getNearbyStormHistory: {
    input: GetNearbyStormHistoryInput
    output: GetNearbyStormHistoryOutput
  }
  getPopulationContext: {
    input: GetPopulationContextInput
    output: GetPopulationContextOutput | undefined
  }
}

export type WinstonChatMessage = UIMessage<never, never, WinstonChatTools>

export function buildWinstonGreeting(region: WinstonRegion): WinstonChatMessage {
  return {
    id: `winston-greeting-${region.gridCellId}`,
    role: 'assistant',
    parts: [
      {
        type: 'text',
        state: 'done',
        text: `Hi there! You selected Region ${region.gridCellId}. I'm Winston. What would you like to know about the hydrological patterns or terrain here?`,
      },
    ],
  }
}
