import type { Feature, FeatureCollection, Polygon } from 'geojson'

export type LngLatTuple = [number, number]
export type BoundsTuple = [LngLatTuple, LngLatTuple]

export interface SearchResult {
  label: string
  center: LngLatTuple
  bounds?: BoundsTuple
}

export interface GridCellProperties {
  cellId: string
  centerLng: number
  centerLat: number
}

export type GridCellFeature = Feature<Polygon, GridCellProperties> & {
  id: number
}

export type GridFeatureCollection = FeatureCollection<Polygon, GridCellProperties>

export interface RegionInsightInput {
  kind: 'cell' | 'search'
  label: string
  center: LngLatTuple
  bounds?: BoundsTuple
  gridCellId?: string | null
}

export type RiskBand = 'Low' | 'Moderate' | 'High' | 'Severe'
export type ConfidenceBand = 'Low' | 'Medium' | 'High'

export interface RiskProfile {
  band: RiskBand
  score: number
  topDrivers: string[]
  confidence: ConfidenceBand
}

export interface AIInsight {
  headline: string
  explanation: string
  caution?: string
}

export interface RegionInsightMetrics {
  elevationMinM?: number
  elevationMeanM?: number
  elevationMaxM?: number
  reliefM?: number
  landCoveragePct?: number
  nearestSurgeStationKm?: number
  surgeRp1M?: number
  surgeRp10M?: number
  surgeRp50M?: number
  surgeRp100M?: number
  nearbyStormCount?: number
  strongestNearbyWindKt?: number
  mostRecentNearbyStormYear?: number
  estimatedPopulation?: number
  populationDensityPerSqKm?: number
}

export interface HistoricalAnalog {
  label: string
  closestApproachKm: number
  peakWindKt?: number
  eventDate?: string
}

export interface DataQuality {
  terrainAvailable: boolean
  surgeAvailable: boolean
  stormHistoryAvailable: boolean
  confidenceNotes: string[]
}

export interface RegionInsightResponse {
  riskProfile: RiskProfile
  aiInsight: AIInsight
  metrics: RegionInsightMetrics
  historicalAnalog?: HistoricalAnalog
  dataQuality: DataQuality
}
