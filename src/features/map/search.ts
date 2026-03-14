import { GEOCODER_ENDPOINT } from './config'
import type { SearchResult } from './types'

interface PhotonFeature {
  geometry?: {
    coordinates?: [number, number]
  }
  bbox?: [number, number, number, number]
  properties?: {
    name?: string
    street?: string
    city?: string
    county?: string
    state?: string
    country?: string
  }
}

interface PhotonResponse {
  features?: PhotonFeature[]
}

export async function searchPlaces(query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    return []
  }

  const url = new URL(GEOCODER_ENDPOINT)
  url.searchParams.set('q', trimmedQuery)
  url.searchParams.set('limit', '5')

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Location lookup failed.')
  }

  const payload = (await response.json()) as PhotonResponse

  return (payload.features ?? [])
    .map((feature) => {
      const coordinates = feature.geometry?.coordinates
      if (!coordinates || coordinates.length < 2) {
        return null
      }

      const [lng, lat] = coordinates

      return {
        label: formatLabel(feature),
        center: [lng, lat] as const,
        bounds: feature.bbox
          ? [
              [feature.bbox[0], feature.bbox[1]],
              [feature.bbox[2], feature.bbox[3]],
            ]
          : undefined,
      }
    })
    .filter((result): result is SearchResult => result !== null)
}

function formatLabel(feature: PhotonFeature) {
  const properties = feature.properties ?? {}
  const primary = properties.name ?? properties.street ?? 'Pinned location'
  const detail = [
    properties.city,
    properties.county,
    properties.state,
    properties.country,
  ].filter(Boolean)

  return [primary, ...detail].join(', ')
}
