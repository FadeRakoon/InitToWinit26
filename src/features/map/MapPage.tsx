import { Link } from '@tanstack/react-router'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  CloudLightning,
  LoaderCircle,
  MapPinned,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
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
  WATER_FILL_LAYER_ID,
  WATER_SOURCE_ID,
} from './config'
import { createGridFeatureCollection } from './grid'
import { searchPlaces } from './search'
import { getRegionInsights } from './insights'
import { fetchGridElevations, computeWaterDepths } from './rain-sim'
import { RainControls } from './RainControls'
import type {
  GridCellFeature,
  LngLatTuple,
  RegionInsightResponse,
  SearchResult,
} from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

type PanelState =
  | { status: 'empty' }
  | { status: 'loading'; label: string }
  | { status: 'ready'; insight: RegionInsightResponse; label: string }
  | { status: 'error'; title: string; message: string }

interface FocusTarget {
  id:     string
  result: SearchResult
}

interface WaterLayerProps {
  waterDepths: number[]
}

const BAND_CLASS: Record<string, string> = {
  Low:      'is-low',
  Moderate: 'is-moderate',
  High:     'is-high',
  Severe:   'is-critical',
}

// ─── MapPage ──────────────────────────────────────────────────────────────────

export default function MapPage() {
  const [panelState, setPanelState]       = useState<PanelState>({ status: 'empty' })
  const [gridCenter, setGridCenter]       = useState<LngLatTuple>(DEFAULT_MAP_CENTER)
  const [focusTarget, setFocusTarget]     = useState<FocusTarget | null>(null)
  const [searchQuery, setSearchQuery]     = useState('')
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [isSearching, setIsSearching]     = useState(false)
  const [clearSelectionVersion, setClearSelectionVersion] = useState(0)

  // Rain sim state
  const [elevations, setElevations]             = useState<number[] | null>(null)
  const [elevationLoading, setElevationLoading] = useState(false)
  const [mmPerHr, setMmPerHr]                   = useState(0)
  const [waterDepths, setWaterDepths]           = useState<number[]>([])

  const analysisAbortRef    = useRef<AbortController | null>(null)
  const elevationCenterRef  = useRef<LngLatTuple | null>(null)

  // ── Fetch elevations on center change ─────────────────────────────────────
  useEffect(() => {
    const [a, b] = gridCenter
    const prev   = elevationCenterRef.current
    if (prev && prev[0] === a && prev[1] === b) return

    let cancelled = false
    setElevationLoading(true)
    setElevations(null)
    setWaterDepths([])

    fetchGridElevations(gridCenter).then((elev) => {
      if (cancelled) return
      setElevations(elev)
      setElevationLoading(false)
      elevationCenterRef.current = gridCenter
      setWaterDepths(computeWaterDepths(elev, mmPerHr))
    }).catch(() => {
      if (!cancelled) setElevationLoading(false)
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridCenter])

  // ── Recompute water on slider change ──────────────────────────────────────
  const handleRainChange = useCallback((newMm: number) => {
    setMmPerHr(newMm)
    if (elevations) setWaterDepths(computeWaterDepths(elevations, newMm))
  }, [elevations])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => { analysisAbortRef.current?.abort() }
  }, [])

  const queueAnalysis = useEffectEvent(
    (payload: { kind: 'cell' | 'search'; label: string; center: LngLatTuple }) => {
      analysisAbortRef.current?.abort()
      analysisAbortRef.current = new AbortController()
      const { signal } = analysisAbortRef.current

      setPanelState({ status: 'loading', label: payload.label })

      getRegionInsights({ data: { ...payload, gridCellId: null } })
        .then((insight) => {
          if (signal.aborted) return
          setPanelState({ status: 'ready', insight, label: payload.label })
        })
        .catch((err) => {
          if (signal.aborted) return
          console.error('Insight fetch failed:', err)
          setPanelState({
            status: 'error',
            title: 'Analysis unavailable',
            message: 'Could not load region data. Please try again.',
          })
        })
    },
  )

  const handleCellSelect = useEffectEvent((feature: GridCellFeature) => {
    setSearchMessage(null)
    queueAnalysis({
      kind:   'cell',
      label:  feature.properties.cellId,
      center: [feature.properties.centerLng, feature.properties.centerLat],
    })
  })

  const handleSearchSubmit = useEffectEvent(async () => {
    const q = searchQuery.trim()
    if (!q) { setSearchMessage('Enter a place or landmark to reposition the map.'); return }
    setIsSearching(true)
    setSearchMessage(null)
    setClearSelectionVersion((v) => v + 1)
    try {
      const results = await searchPlaces(q)
      const hit = results[0]
      if (!hit) {
        setPanelState({ status: 'error', title: 'No results found', message: 'Try a broader city, parish, or landmark name.' })
        setSearchMessage('No results matched that search.')
        return
      }
      setGridCenter(hit.center)
      setFocusTarget({ id: `${hit.label}:${Date.now()}`, result: hit })
      setSearchQuery('')
      queueAnalysis({ kind: 'search', label: hit.label, center: hit.center })
    } catch {
      setPanelState({ status: 'error', title: 'Search unavailable', message: 'The location service could not be reached. Try again in a moment.' })
      setSearchMessage('Search request failed. Please retry.')
    } finally {
      setIsSearching(false)
    }
  })

  const closeSidebar = useEffectEvent(() => {
    analysisAbortRef.current?.abort()
    setPanelState({ status: 'empty' })
    setSearchMessage(null)
    setClearSelectionVersion((v) => v + 1)
  })

  const waterLayerProps: WaterLayerProps | null =
    waterDepths.length > 0 ? { waterDepths } : null

  return (
    <main className="map-page">
      <MapTopbar />
      <section className="map-page__shell">
        <MapCanvas
          gridCenter={gridCenter}
          focusTarget={focusTarget}
          clearSelectionVersion={clearSelectionVersion}
          onCellSelect={handleCellSelect}
          waterLayerProps={waterLayerProps}
        />

        {/* Search bar */}
        <div className="map-page__search">
          <form
            className="map-page__search-box"
            onSubmit={(e) => { e.preventDefault(); void handleSearchSubmit() }}
          >
            <Search aria-hidden="true" className="map-page__search-icon" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search coordinates, regions, or landmarks…"
              aria-label="Search locations"
            />
            <button type="submit" disabled={isSearching}>
              {isSearching
                ? <LoaderCircle aria-hidden="true" size={18} className="is-spinning" />
                : <Sparkles aria-hidden="true" size={18} />}
              <span className="sr-only">Search the map</span>
            </button>
          </form>
          {searchMessage ? <p className="map-page__search-note">{searchMessage}</p> : null}
        </div>

        {/* Sidebar */}
        <aside className="map-page__sidebar">
          <div className="map-page__sidebar-header">
            <div>
              <p className="map-page__eyebrow">Region Analysis</p>
              <h1>Operational view</h1>
            </div>
            <button type="button" onClick={closeSidebar} aria-label="Reset sidebar">
              <X size={18} />
            </button>
          </div>

          <div className="map-page__sidebar-body">

            {/* Rain simulation controls */}
            <RainControls
              mmPerHr={mmPerHr}
              onChange={handleRainChange}
              isLoading={elevationLoading}
              hasElevation={elevations !== null}
            />

            <hr className="map-page__divider" />

            {/* Panel states */}
            {panelState.status === 'empty' && (
              <div className="map-page__state map-page__state--empty">
                <MapPinned aria-hidden="true" size={40} />
                <p>Select a grid cell or search for a place to generate insights.</p>
              </div>
            )}

            {panelState.status === 'loading' && (
              <div className="map-page__state map-page__state--loading">
                <LoaderCircle aria-hidden="true" size={36} className="is-spinning" />
                <p>Analyzing {panelState.label}…</p>
              </div>
            )}

            {panelState.status === 'error' && (
              <div className="map-page__state map-page__state--error">
                <AlertTriangle aria-hidden="true" size={32} />
                <h2>{panelState.title}</h2>
                <p>{panelState.message}</p>
              </div>
            )}

            {panelState.status === 'ready' && (
              <InsightPanel insight={panelState.insight} label={panelState.label} />
            )}

          </div>
        </aside>
      </section>
    </main>
  )
}

// ─── InsightPanel ─────────────────────────────────────────────────────────────

function InsightPanel({ insight, label }: { insight: RegionInsightResponse; label: string }) {
  const { riskProfile, aiInsight, metrics, historicalAnalog, dataQuality } = insight
  const bandClass = BAND_CLASS[riskProfile.band] ?? 'is-moderate'

  return (
    <div className="map-page__data">
      {/* Risk band badge */}
      <p className={`map-page__badge ${bandClass}`}>{riskProfile.band} Risk</p>
      <h2>{aiInsight.headline}</h2>

      {/* Risk score bar */}
      <div className="map-page__risk-bar-wrap" aria-label={`Risk score ${riskProfile.score} out of 100`}>
        <div
          className="map-page__risk-bar-fill"
          style={{
            width: `${riskProfile.score}%`,
            background:
              riskProfile.score < 25 ? 'var(--success)'
              : riskProfile.score < 50 ? 'var(--warning)'
              : riskProfile.score < 75 ? 'var(--danger)'
              : '#7f1d1d',
          }}
        />
      </div>

      {/* AI explanation */}
      <div className="map-page__copy">
        <p>{aiInsight.explanation}</p>
        {aiInsight.caution && (
          <p className="map-page__caution">
            <AlertTriangle size={13} aria-hidden="true" /> {aiInsight.caution}
          </p>
        )}
      </div>

      {/* Top drivers */}
      {riskProfile.topDrivers.length > 0 && (
        <div className="map-page__drivers">
          <span className="map-page__drivers-label">Key risk factors</span>
          <ul>
            {riskProfile.topDrivers.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      )}

      {/* Metrics grid */}
      <div className="map-page__metrics">
        {metrics.elevationMeanM != null && (
          <article className="map-page__metric">
            <span>Mean Elevation</span>
            <strong className="map-page__metric-value">{metrics.elevationMeanM.toFixed(0)} m</strong>
          </article>
        )}
        {metrics.reliefM != null && (
          <article className="map-page__metric">
            <span>Relief</span>
            <strong className="map-page__metric-value">{metrics.reliefM.toFixed(0)} m</strong>
          </article>
        )}
        {metrics.surgeRp10M != null && (
          <article className="map-page__metric">
            <span>Surge 1-in-10</span>
            <strong className="map-page__metric-value">{metrics.surgeRp10M.toFixed(1)} m</strong>
          </article>
        )}
        {metrics.surgeRp100M != null && (
          <article className="map-page__metric">
            <span>Surge 1-in-100</span>
            <strong className="map-page__metric-value">{metrics.surgeRp100M.toFixed(1)} m</strong>
          </article>
        )}
        {metrics.nearbyStormCount != null && (
          <article className="map-page__metric">
            <span>Historical Storms</span>
            <strong className="map-page__metric-value">{metrics.nearbyStormCount}</strong>
          </article>
        )}
        {metrics.strongestNearbyWindKt != null && (
          <article className="map-page__metric">
            <span>Max Wind (kt)</span>
            <strong className="map-page__metric-value">{metrics.strongestNearbyWindKt}</strong>
          </article>
        )}
        {metrics.landCoveragePct != null && (
          <article className="map-page__metric">
            <span>Land Coverage</span>
            <strong className="map-page__metric-value">{metrics.landCoveragePct.toFixed(0)}%</strong>
          </article>
        )}
        <article className="map-page__metric">
          <span>Confidence</span>
          <strong className="map-page__metric-value">{riskProfile.confidence}</strong>
        </article>
      </div>

      {/* Historical analog */}
      {historicalAnalog && (
        <div className="map-page__analog">
          <span className="map-page__drivers-label">Historical analog</span>
          <p>
            <strong>{historicalAnalog.label}</strong>
            {historicalAnalog.eventDate && ` (${historicalAnalog.eventDate})`}
            {' — '}{historicalAnalog.closestApproachKm.toFixed(0)} km approach
            {historicalAnalog.peakWindKt != null && `, ${historicalAnalog.peakWindKt} kt peak winds`}
          </p>
        </div>
      )}

      {/* Data quality notes */}
      {dataQuality.confidenceNotes.length > 0 && (
        <details className="map-page__quality">
          <summary>Data quality notes</summary>
          <ul>
            {dataQuality.confidenceNotes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </details>
      )}

      <p className="map-page__region-label">{label}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Topbar
═══════════════════════════════════════════════════════════════════ */
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
        <a href="https://maplibre.org" target="_blank" rel="noreferrer">MapLibre</a>
        <Link to="/map" className="is-active">Grid Map</Link>
      </nav>
    </header>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   MapCanvas
═══════════════════════════════════════════════════════════════════ */
function MapCanvas({
  gridCenter,
  focusTarget,
  clearSelectionVersion,
  onCellSelect,
  waterLayerProps,
}: {
  gridCenter:            LngLatTuple
  focusTarget:           FocusTarget | null
  clearSelectionVersion: number
  onCellSelect:          (feature: GridCellFeature) => void
  waterLayerProps:       WaterLayerProps | null
}) {
  const containerRef        = useRef<HTMLDivElement | null>(null)
  const mapRef              = useRef<maplibregl.Map | null>(null)
  const hoveredIdRef        = useRef<number | null>(null)
  const activeIdRef         = useRef<number | null>(null)
  const isReadyRef          = useRef(false)
  const latestGridCenterRef = useRef(gridCenter)

  latestGridCenterRef.current = gridCenter

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style:     MAP_STYLE_URL,
      center:    DEFAULT_MAP_CENTER,
      zoom:      DEFAULT_MAP_ZOOM,
      attributionControl: {},
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    const setGridData = (center: LngLatTuple) => {
      const source = map.getSource(GRID_SOURCE_ID) as GeoJSONSource | undefined
      const data   = createGridFeatureCollection({ center })
      if (source) { source.setData(data); return }
      map.addSource(GRID_SOURCE_ID, { type: 'geojson', data })
    }

    const clearHover = () => {
      if (hoveredIdRef.current !== null)
        map.setFeatureState({ source: GRID_SOURCE_ID, id: hoveredIdRef.current }, { hover: false })
      hoveredIdRef.current = null
    }

    const clearActive = () => {
      if (activeIdRef.current !== null)
        map.setFeatureState({ source: GRID_SOURCE_ID, id: activeIdRef.current }, { active: false })
      activeIdRef.current = null
    }

    const handleMouseMove = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      if (!feature || feature.id === undefined) return
      map.getCanvas().style.cursor = 'crosshair'
      clearHover()
      hoveredIdRef.current = Number(feature.id)
      map.setFeatureState({ source: GRID_SOURCE_ID, id: hoveredIdRef.current }, { hover: true })
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      clearHover()
    }

    const handleClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0] as MapGeoJSONFeature | undefined
      if (!feature || feature.id === undefined || feature.geometry.type !== 'Polygon') return
      const props = feature.properties ?? {}
      clearActive()
      activeIdRef.current = Number(feature.id)
      map.setFeatureState({ source: GRID_SOURCE_ID, id: activeIdRef.current }, { active: true })
      onCellSelect({
        type: 'Feature',
        id:   Number(feature.id),
        properties: {
          cellId:    String(props.cellId    ?? 'Unknown'),
          centerLng: Number(props.centerLng ?? DEFAULT_MAP_CENTER[0]),
          centerLat: Number(props.centerLat ?? DEFAULT_MAP_CENTER[1]),
        },
        geometry: feature.geometry,
      })
    }

    map.on('load', () => {
      setGridData(latestGridCenterRef.current)

      map.addLayer({
        id: GRID_FILL_LAYER_ID, type: 'fill', source: GRID_SOURCE_ID,
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': ['case',
            ['boolean', ['feature-state', 'active'], false], 0.4,
            ['boolean', ['feature-state', 'hover'],  false], 0.15,
            0,
          ],
        },
      })

      map.addSource(WATER_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: WATER_FILL_LAYER_ID, type: 'fill', source: WATER_SOURCE_ID,
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['get', 'depth'],
            0,    '#bfdbfe',
            0.1,  '#60a5fa',
            0.25, '#2563eb',
            0.5,  '#1e3a8a',
          ],
          'fill-opacity': [
            'interpolate', ['linear'], ['get', 'depth'],
            0,    0,
            0.02, 0.3,
            0.5,  0.75,
          ],
        },
      })

      map.addLayer({
        id: GRID_OUTLINE_LAYER_ID, type: 'line', source: GRID_SOURCE_ID,
        paint: {
          'line-color':   '#38bdf8',
          'line-width':   ['case', ['boolean', ['feature-state', 'active'], false], 2, 1],
          'line-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 1, 0.15],
        },
      })

      map.on('mousemove',  GRID_FILL_LAYER_ID, handleMouseMove)
      map.on('mouseleave', GRID_FILL_LAYER_ID, handleMouseLeave)
      map.on('click',      GRID_FILL_LAYER_ID, handleClick)

      isReadyRef.current = true
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; isReadyRef.current = false }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current) return
    ;(map.getSource(GRID_SOURCE_ID) as GeoJSONSource | undefined)
      ?.setData(createGridFeatureCollection({ center: gridCenter }))
  }, [gridCenter])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current || !focusTarget) return
    const { bounds, center } = focusTarget.result
    if (bounds) { map.fitBounds(bounds, { padding: 80, duration: 1600 }); return }
    map.flyTo({ center, zoom: 13, duration: 1600, essential: true })
  }, [focusTarget])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current) return
    if (hoveredIdRef.current !== null) {
      map.setFeatureState({ source: GRID_SOURCE_ID, id: hoveredIdRef.current }, { hover: false })
      hoveredIdRef.current = null
    }
    if (activeIdRef.current !== null) {
      map.setFeatureState({ source: GRID_SOURCE_ID, id: activeIdRef.current }, { active: false })
      activeIdRef.current = null
    }
  }, [clearSelectionVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current) return
    const waterSource = map.getSource(WATER_SOURCE_ID) as GeoJSONSource | undefined
    if (!waterSource) return

    if (!waterLayerProps || waterLayerProps.waterDepths.length === 0) {
      waterSource.setData({ type: 'FeatureCollection', features: [] })
      return
    }

    const base     = createGridFeatureCollection({ center: latestGridCenterRef.current })
    const features = base.features.map((feat, i) => ({
      ...feat,
      properties: { ...feat.properties, depth: waterLayerProps.waterDepths[i] ?? 0 },
    }))
    waterSource.setData({ type: 'FeatureCollection', features })
  }, [waterLayerProps])

  return (
    <div
      ref={containerRef}
      className="map-page__map"
      aria-label="Interactive map"
      style={{ position: 'absolute', inset: 0, zIndex: 1 }}
    />
  )
}