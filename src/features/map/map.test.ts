import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateRegionAnalysis } from './analysis'
import { createGridFeatureCollection } from './grid'
import { searchPlaces } from './search'

describe('createGridFeatureCollection', () => {
  it('builds a stable 20x20 grid around the provided center', () => {
    const collection = createGridFeatureCollection({
      center: [-74.006, 40.7128],
    })

    expect(collection.features).toHaveLength(400)
    expect(collection.features[0]?.properties.cellId).toBe('A1')
    expect(collection.features[399]?.properties.cellId).toBe('T20')
  })
})

describe('generateRegionAnalysis', () => {
  it('returns deterministic analysis for the same input', () => {
    const input = {
      kind: 'search' as const,
      label: 'Kingston, Jamaica',
      center: [-76.7936, 17.9712] as const,
    }

    expect(generateRegionAnalysis(input)).toEqual(generateRegionAnalysis(input))
  })
})

describe('searchPlaces', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps Photon results into SearchResult values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              geometry: { coordinates: [-76.7936, 17.9712] },
              bbox: [-76.9, 17.9, -76.7, 18.1],
              properties: {
                name: 'Kingston',
                state: 'Kingston',
                country: 'Jamaica',
              },
            },
          ],
        }),
      }),
    )

    await expect(searchPlaces('Kingston')).resolves.toEqual([
      {
        label: 'Kingston, Kingston, Jamaica',
        center: [-76.7936, 17.9712],
        bounds: [
          [-76.9, 17.9],
          [-76.7, 18.1],
        ],
      },
    ])
  })

  it('returns an empty list for blank queries without calling fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(searchPlaces('   ')).resolves.toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
