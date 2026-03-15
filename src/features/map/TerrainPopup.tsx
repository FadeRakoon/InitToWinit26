import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import {
  DEFAULT_MAP_ZOOM,
  MAP_STYLE_URL,
  TERRAIN_EXAGGERATION,
  TERRAIN_MAX_ZOOM,
  TERRAIN_MIN_ZOOM,
  TERRAIN_SOURCE_ID,
  TERRAIN_TILE_URL,
} from './config'
import type { BoundsTuple, LngLatTuple } from './types'

interface TerrainPopupProps {
  cellId: string
  center: LngLatTuple
  bounds: BoundsTuple
  onClose: () => void
}

export function TerrainPopup({
  cellId,
  center,
  bounds,
  onClose,
}: TerrainPopupProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: center,
      zoom: DEFAULT_MAP_ZOOM + 2,
      pitch: 45,
      bearing: -30,
      maxZoom: TERRAIN_MAX_ZOOM,
      minZoom: TERRAIN_MIN_ZOOM,
    })

    map.on('load', () => {
      console.log('[terrain] Map loaded, adding terrain source')
      console.log('[terrain] Tile URL:', TERRAIN_TILE_URL)
      console.log('[terrain] Center:', center)
      console.log('[terrain] Bounds:', bounds)

      try {
        map.addSource(TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          tiles: [TERRAIN_TILE_URL],
          tileSize: 256,
          encoding: 'mapbox',
          minzoom: TERRAIN_MIN_ZOOM,
          maxzoom: TERRAIN_MAX_ZOOM,
        })

        console.log('[terrain] Source added')

        map.setTerrain({
          source: TERRAIN_SOURCE_ID,
          exaggeration: TERRAIN_EXAGGERATION,
        })

        console.log('[terrain] Terrain set')

        map.addLayer({
          id: 'terrain-hillshade',
          type: 'hillshade',
          source: TERRAIN_SOURCE_ID,
          paint: {
            'hillshade-exaggeration': 0.8,
            'hillshade-shadow-color': '#1a1a2e',
            'hillshade-highlight-color': '#60d4ff',
            'hillshade-accent-color': '#38bdf8',
          },
        })

        console.log('[terrain] Hillshade layer added')

        const [sw, ne] = bounds
        map.fitBounds(
          [
            [sw[0], sw[1]],
            [ne[0], ne[1]],
          ],
          {
            padding: 50,
            duration: 1000,
            pitch: 45,
            bearing: -30,
          },
        )

        setIsLoading(false)
      } catch (err) {
        console.error('[terrain] Error setting up terrain:', err)
        setError('Failed to load terrain data')
        setIsLoading(false)
      }
    })

    map.on('error', (e) => {
      console.error('[terrain] Map error:', e.error)
      setError('Failed to initialize terrain view')
      setIsLoading(false)
    })

    map.on('sourcedata', (e) => {
      if (e.isSourceLoaded) {
        console.log('[terrain] Source loaded:', e.sourceId)
      }
    })

    mapRef.current = map

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [center, bounds])

  return (
    <div className="terrain-popup__overlay" onClick={onClose}>
      <div
        className="terrain-popup__content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="terrain-popup__header">
          <div>
            <p className="terrain-popup__eyebrow">Terrain View</p>
            <h2 className="terrain-popup__heading">Region {cellId}</h2>
          </div>
          <button
            className="terrain-popup__close"
            onClick={onClose}
            aria-label="Close terrain view"
          >
            <X size={20} />
          </button>
        </div>
        <div className="terrain-popup__body">
          {isLoading && (
            <div className="terrain-popup__loading">
              <div className="terrain-popup__spinner" />
              <span>Loading terrain...</span>
            </div>
          )}
          {error && (
            <div className="terrain-popup__error">
              <span>{error}</span>
            </div>
          )}
          <div
            ref={containerRef}
            className="terrain-popup__map"
            style={{ opacity: isLoading || error ? 0 : 1 }}
          />
        </div>
        <div className="terrain-popup__footer">
          <p>
            Drag to pan, scroll to zoom. Pitch and bearing can be adjusted by
            right-click dragging.
          </p>
        </div>
      </div>
    </div>
  )
}
