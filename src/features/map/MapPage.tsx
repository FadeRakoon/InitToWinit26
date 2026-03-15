import { Link } from '@tanstack/react-router'
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import {
  CloudLightning,
  LoaderCircle,
  MapPinned,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { ChatWidget } from '@/components/ChatWidget'
import maplibregl, {
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  GRID_FILL_LAYER_ID,
  GRID_OUTLINE_LAYER_ID,
  GRID_SOURCE_ID,
  MAP_STYLE_URL,
} from './config'
import { generateRegionAnalysis } from './analysis'
import { createGridFeatureCollection } from './grid'
import { searchPlaces } from './search'
import type {
  GridCellFeature,
  LngLatTuple,
  RegionAnalysis,
  SearchResult,
} from './types'

type PanelState =
  | { status: 'empty' }
  | { status: 'loading'; label: string }
  | { status: 'ready'; analysis: RegionAnalysis }
  | { status: 'error'; title: string; message: string }

interface FocusTarget {
  id: string
  result: SearchResult
}

export default function MapPage() {
  const [panelState, setPanelState] = useState<PanelState>({ status: 'empty' })
  const [gridCenter, setGridCenter] = useState<LngLatTuple>(DEFAULT_MAP_CENTER)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [clearSelectionVersion, setClearSelectionVersion] = useState(0)
  const analysisTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (analysisTimeoutRef.current !== null) {
        window.clearTimeout(analysisTimeoutRef.current)
      }
    }
  }, [])

  const queueAnalysis = useEffectEvent(
    (payload: {
      kind: 'cell' | 'search'
      label: string
      center: LngLatTuple
    }) => {
      if (analysisTimeoutRef.current !== null) {
        window.clearTimeout(analysisTimeoutRef.current)
      }

      setPanelState({ status: 'loading', label: payload.label })
      analysisTimeoutRef.current = window.setTimeout(() => {
        startTransition(() => {
          setPanelState({
            status: 'ready',
            analysis: generateRegionAnalysis(payload),
          })
        })
      }, 900)
    },
  )

  const handleCellSelect = useEffectEvent((feature: GridCellFeature) => {
    setSearchMessage(null)
    queueAnalysis({
      kind: 'cell',
      label: feature.properties.cellId,
      center: [feature.properties.centerLng, feature.properties.centerLat],
    })
  })

  const handleSearchSubmit = useEffectEvent(async () => {
    const trimmedQuery = searchQuery.trim()

    if (!trimmedQuery) {
      setSearchMessage('Enter a place or landmark to reposition the map.')
      return
    }

    setIsSearching(true)
    setSearchMessage(null)
    setClearSelectionVersion((version) => version + 1)

    try {
      const results = await searchPlaces(trimmedQuery)
      const selectedResult = results[0]

      if (!selectedResult) {
        setPanelState({
          status: 'error',
          title: 'No results found',
          message: 'Try a broader city, parish, or landmark name.',
        })
        setSearchMessage('No results matched that search.')
        return
      }

      setGridCenter(selectedResult.center)
      setFocusTarget({
        id: `${selectedResult.label}:${Date.now()}`,
        result: selectedResult,
      })
      setSearchQuery('')
      queueAnalysis({
        kind: 'search',
        label: selectedResult.label,
        center: selectedResult.center,
      })
    } catch {
      setPanelState({
        status: 'error',
        title: 'Search unavailable',
        message:
          'The location service could not be reached. Try again in a moment.',
      })
      setSearchMessage('Search request failed. Please retry.')
    } finally {
      setIsSearching(false)
    }
  })

  const closeSidebar = useEffectEvent(() => {
    if (analysisTimeoutRef.current !== null) {
      window.clearTimeout(analysisTimeoutRef.current)
      analysisTimeoutRef.current = null
    }

    setPanelState({ status: 'empty' })
    setSearchMessage(null)
    setClearSelectionVersion((version) => version + 1)
  })

  const activityClassName =
    panelState.status === 'ready'
      ? `map-page__metric-value is-${panelState.analysis.activityTone}`
      : 'map-page__metric-value'

  return (
    <main className="map-page">
      <MapTopbar />

      <section className="map-page__shell">
        <MapCanvas
          gridCenter={gridCenter}
          focusTarget={focusTarget}
          clearSelectionVersion={clearSelectionVersion}
          onCellSelect={handleCellSelect}
        />

        <div className="map-page__search">
          <form
            className="map-page__search-box"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSearchSubmit()
            }}
          >
            <Search
              aria-hidden="true"
              className="map-page__search-icon"
              size={18}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search coordinates, regions, or landmarks..."
              aria-label="Search locations"
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? (
                <LoaderCircle
                  aria-hidden="true"
                  size={18}
                  className="is-spinning"
                />
              ) : (
                <Sparkles aria-hidden="true" size={18} />
              )}
              <span className="sr-only">Search the map</span>
            </button>
          </form>
          {searchMessage ? (
            <p className="map-page__search-note">{searchMessage}</p>
          ) : null}
        </div>

        <aside className="map-page__sidebar">
          <div className="map-page__sidebar-header">
            <div>
              <p className="map-page__eyebrow">Region Analysis</p>
              <h1>Operational view</h1>
            </div>
            <button
              type="button"
              onClick={closeSidebar}
              aria-label="Reset sidebar"
            >
              <X size={18} />
            </button>
          </div>

          <div className="map-page__sidebar-body">
            {panelState.status === 'empty' ? (
              <div className="map-page__state map-page__state--empty">
                <MapPinned aria-hidden="true" size={40} />
                <p>
                  Select a grid cell or search for a place to generate insights.
                </p>
              </div>
            ) : null}

            {panelState.status === 'loading' ? (
              <div className="map-page__state map-page__state--loading">
                <LoaderCircle
                  aria-hidden="true"
                  size={36}
                  className="is-spinning"
                />
                <p>Analyzing {panelState.label}...</p>
              </div>
            ) : null}

            {panelState.status === 'error' ? (
              <div className="map-page__state map-page__state--error">
                <p className="map-page__badge">Lookup</p>
                <h2>{panelState.title}</h2>
                <p>{panelState.message}</p>
              </div>
            ) : null}

            {panelState.status === 'ready' ? (
              <div className="map-page__data">
                <p className="map-page__badge">{panelState.analysis.badge}</p>
                <h2>{panelState.analysis.heading}</h2>
                <div className="map-page__copy">
                  {panelState.analysis.summary.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  <p>
                    Recommendation:{' '}
                    <em>{panelState.analysis.recommendation}</em>
                  </p>
                </div>

                <div className="map-page__metrics">
                  <article className="map-page__metric">
                    <span>Activity Level</span>
                    <strong className={activityClassName}>
                      {panelState.analysis.activityLabel}
                    </strong>
                  </article>
                  <article className="map-page__metric">
                    <span>Anomalies</span>
                    <strong className="map-page__metric-value">
                      {panelState.analysis.anomaliesLabel}
                    </strong>
                  </article>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <ChatWidget />
      </section>
    </main>
  )
}

function MapTopbar() {
  return (
    <header className="map-page__topbar">
      <div className="map-page__brand">
        <CloudLightning aria-hidden="true" size={20} />
        <span>Weather Guardians</span>
      </div>

      <nav className="map-page__nav" aria-label="Map page navigation">
        <Link to="/">Home</Link>
        <a href="/#technology">Technology</a>
        <a href="https://maplibre.org" target="_blank" rel="noreferrer">
          MapLibre
        </a>
        <Link to="/map" className="is-active">
          Grid Map
        </Link>
      </nav>
    </header>
  )
}

function MapCanvas({
  gridCenter,
  focusTarget,
  clearSelectionVersion,
  onCellSelect,
}: {
  gridCenter: LngLatTuple
  focusTarget: FocusTarget | null
  clearSelectionVersion: number
  onCellSelect: (feature: GridCellFeature) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredFeatureIdRef = useRef<number | null>(null)
  const activeFeatureIdRef = useRef<number | null>(null)
  const isReadyRef = useRef(false)
  const latestGridCenterRef = useRef(gridCenter)

  latestGridCenterRef.current = gridCenter

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      attributionControl: true,
    })

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'bottom-right',
    )

    const setGridData = (center: LngLatTuple) => {
      const source = map.getSource(GRID_SOURCE_ID) as GeoJSONSource | undefined
      const data = createGridFeatureCollection({ center })

      if (source) {
        source.setData(data)
        return
      }

      map.addSource(GRID_SOURCE_ID, {
        type: 'geojson',
        data,
      })
    }

    const clearHoverState = () => {
      if (hoveredFeatureIdRef.current !== null) {
        map.setFeatureState(
          { source: GRID_SOURCE_ID, id: hoveredFeatureIdRef.current },
          { hover: false },
        )
      }

      hoveredFeatureIdRef.current = null
    }

    const clearActiveState = () => {
      if (activeFeatureIdRef.current !== null) {
        map.setFeatureState(
          { source: GRID_SOURCE_ID, id: activeFeatureIdRef.current },
          { active: false },
        )
      }

      activeFeatureIdRef.current = null
    }

    const handleMouseMove = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      if (!feature || feature.id === undefined) {
        return
      }

      map.getCanvas().style.cursor = 'crosshair'
      clearHoverState()
      hoveredFeatureIdRef.current = Number(feature.id)
      map.setFeatureState(
        { source: GRID_SOURCE_ID, id: hoveredFeatureIdRef.current },
        { hover: true },
      )
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      clearHoverState()
    }

    const handleClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0] as MapGeoJSONFeature | undefined

      if (
        !feature ||
        feature.id === undefined ||
        feature.geometry.type !== 'Polygon'
      ) {
        return
      }

      const properties = feature.properties ?? {}

      clearActiveState()
      activeFeatureIdRef.current = Number(feature.id)
      map.setFeatureState(
        { source: GRID_SOURCE_ID, id: activeFeatureIdRef.current },
        { active: true },
      )

      onCellSelect({
        type: 'Feature',
        id: Number(feature.id),
        properties: {
          cellId: String(properties.cellId ?? 'Unknown'),
          centerLng: Number(properties.centerLng ?? DEFAULT_MAP_CENTER[0]),
          centerLat: Number(properties.centerLat ?? DEFAULT_MAP_CENTER[1]),
        },
        geometry: feature.geometry,
      })
    }

    map.on('load', () => {
      setGridData(latestGridCenterRef.current)

      map.addLayer({
        id: GRID_FILL_LAYER_ID,
        type: 'fill',
        source: GRID_SOURCE_ID,
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            0.4,
            ['boolean', ['feature-state', 'hover'], false],
            0.15,
            0,
          ],
        },
      })

      map.addLayer({
        id: GRID_OUTLINE_LAYER_ID,
        type: 'line',
        source: GRID_SOURCE_ID,
        paint: {
          'line-color': '#38bdf8',
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            2,
            1,
          ],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            1,
            0.15,
          ],
        },
      })

      map.on('mousemove', GRID_FILL_LAYER_ID, handleMouseMove)
      map.on('mouseleave', GRID_FILL_LAYER_ID, handleMouseLeave)
      map.on('click', GRID_FILL_LAYER_ID, handleClick)
      isReadyRef.current = true
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      isReadyRef.current = false
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current) {
      return
    }

    const source = map.getSource(GRID_SOURCE_ID) as GeoJSONSource | undefined
    if (!source) {
      return
    }

    source.setData(createGridFeatureCollection({ center: gridCenter }))
  }, [gridCenter])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current || !focusTarget) {
      return
    }

    const { bounds, center } = focusTarget.result

    if (bounds) {
      map.fitBounds(bounds, {
        padding: 80,
        duration: 1600,
      })
      return
    }

    map.flyTo({
      center,
      zoom: 13,
      duration: 1600,
      essential: true,
    })
  }, [focusTarget])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current) {
      return
    }

    if (hoveredFeatureIdRef.current !== null) {
      map.setFeatureState(
        { source: GRID_SOURCE_ID, id: hoveredFeatureIdRef.current },
        { hover: false },
      )
      hoveredFeatureIdRef.current = null
    }

    if (activeFeatureIdRef.current !== null) {
      map.setFeatureState(
        { source: GRID_SOURCE_ID, id: activeFeatureIdRef.current },
        { active: false },
      )
      activeFeatureIdRef.current = null
    }
  }, [clearSelectionVersion])

  return (
    <div
      ref={containerRef}
      className="map-page__map"
      aria-label="Interactive map"
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}
