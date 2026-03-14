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

export type ActivityTone = 'low' | 'moderate' | 'high' | 'critical'

export interface RegionAnalysisInput {
  kind: 'cell' | 'search'
  label: string
  center: LngLatTuple
}

export interface RegionAnalysis {
  badge: string
  heading: string
  summary: string[]
  activityLabel: string
  activityTone: ActivityTone
  anomaliesLabel: string
  recommendation: string
}
