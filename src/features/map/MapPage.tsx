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
  MapPin,
  MapPinned,
  Mountain,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
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
  GRID_LAT_STEP,
  GRID_LNG_STEP,
  GRID_OUTLINE_LAYER_ID,
  GRID_SOURCE_ID,
  MAP_STYLE_URL,
} from './config'
import { generateRegionAnalysis } from './analysis'
import { createGridFeatureCollection } from './grid'
import { searchPlaces } from './search'
import { useDebounce } from '../../hooks/useDebounce'
import type {
  BoundsTuple,
  GridCellFeature,
  LngLatTuple,
  RegionAnalysis,
  SearchResult,
} from './types'
import { TerrainPopup } from './TerrainPopup'

type PanelState =
  | { status: 'empty' }
  | { status: 'loading'; label: string }
  | { status: 'ready'; analysis: RegionAnalysis }
  | { status: 'error'; title: string; message: string }

interface FocusTarget {
  id: string
  result: SearchResult
}

interface TerrainView {
  cellId: string
  center: LngLatTuple
  bounds: BoundsTuple
}

export default function MapPage() {
  const [panelState, setPanelState] = useState<PanelState>({ status: 'empty' })
  const [gridCenter, setGridCenter] = useState<LngLatTuple>(DEFAULT_MAP_CENTER)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [clearSelectionVersion, setClearSelectionVersion] = useState(0)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const debouncedQuery = useDebounce(searchQuery, 600)
  const isWaiting =
    !isTyping && searchQuery.trim() !== '' && searchQuery !== debouncedQuery
  const [terrainView, setTerrainView] = useState<TerrainView | null>(null)
  const [showTerrainPopup, setShowTerrainPopup] = useState(false)
  const analysisTimeoutRef = useRef<number | null>(null)
  const typingTimeoutRef = useRef<number | null>(null)

  const placeholders = [
    'Search regions...',
    'Try "Kingston"...',
    'Try "Montego Bay"...',
    'Find locations...',
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isFocused && !searchQuery) {
        setPlaceholderIndex((prev) => (prev + 1) % placeholders.length)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [isFocused, searchQuery, placeholders.length])

  useEffect(() => {
    return () => {
      if (analysisTimeoutRef.current !== null) {
        window.clearTimeout(analysisTimeoutRef.current)
      }
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current)
      }
    }
  }, [])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setIsTyping(true)

    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      setIsTyping(false)
    }, 300)
  }

  useEffect(() => {
    const trimmedQuery = debouncedQuery.trim()
    if (!trimmedQuery) {
      setSuggestions([])
      setIsDropdownOpen(false)
      return
    }

    let isMounted = true
    setIsSearching(true)

    searchPlaces(trimmedQuery)
      .then((results) => {
        if (!isMounted) return
        setSuggestions(results)
        setIsDropdownOpen(true)
        if (results.length > 0) {
          setSearchMessage(null)
        }
      })
      .catch(() => {
        if (!isMounted) return
        setSuggestions([])
      })
      .finally(() => {
        if (!isMounted) return
        setIsSearching(false)
      })

    return () => {
      isMounted = false
    }
  }, [debouncedQuery])

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
      setIsSidebarOpen(true)
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
    setShowTerrainPopup(false)
    const centerLng = feature.properties.centerLng
    const centerLat = feature.properties.centerLat
    const halfLatStep = GRID_LAT_STEP / 2
    const halfLngStep = GRID_LNG_STEP / 2
    const bounds: BoundsTuple = [
      [centerLng - halfLngStep, centerLat - halfLatStep],
      [centerLng + halfLngStep, centerLat + halfLatStep],
    ]
    setTerrainView({
      cellId: feature.properties.cellId,
      center: [centerLng, centerLat],
      bounds,
    })
    queueAnalysis({
      kind: 'cell',
      label: feature.properties.cellId,
      center: [centerLng, centerLat],
    })
  })

  const handleResultSelect = useEffectEvent((result: SearchResult) => {
    setGridCenter(result.center)
    setFocusTarget({
      id: `${result.label}:${Date.now()}`,
      result: result,
    })
    setTerrainView(null)
    setShowTerrainPopup(false)
    setSearchQuery('')
    setSuggestions([])
    setIsDropdownOpen(false)
    setSearchMessage(null)
    setClearSelectionVersion((version) => version + 1)
    queueAnalysis({
      kind: 'search',
      label: result.label,
      center: result.center,
    })
  })

  const handleSearchSubmit = useEffectEvent(async () => {
    if (suggestions.length > 0) {
      handleResultSelect(suggestions[0]!)
      return
    }

    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery) {
      setSearchMessage('Enter a place or landmark to reposition the map.')
      return
    }

    setIsSearching(true)
    setSearchMessage(null)

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
        setIsSidebarOpen(true)
        return
      }

      handleResultSelect(selectedResult)
    } catch {
      setPanelState({
        status: 'error',
        title: 'Search unavailable',
        message:
          'The location service could not be reached. Try again in a moment.',
      })
      setSearchMessage('Search request failed. Please retry.')
      setIsSidebarOpen(true)
    } finally {
      setIsSearching(false)
    }
  })

  const closeSidebar = useEffectEvent(() => {
    if (analysisTimeoutRef.current !== null) {
      window.clearTimeout(analysisTimeoutRef.current)
      analysisTimeoutRef.current = null
    }
    setIsSidebarOpen(false)
    setShowTerrainPopup(false)
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
          <motion.div
            layout
            initial={false}
            animate={{
              width: isFocused || searchQuery || isDropdownOpen ? '100%' : '280px',
              borderColor: isFocused ? 'rgba(56, 189, 248, 0.55)' : 'rgba(255, 255, 255, 0.05)',
              boxShadow: isFocused 
                ? '0 10px 40px rgba(0, 0, 0, 0.34), 0 0 20px rgba(56, 189, 248, 0.15)' 
                : '0 8px 32px rgba(0, 0, 0, 0.15)'
            }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
            className="map-page__search-container"
          >
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
              <div className="relative flex flex-1 items-center overflow-hidden h-[1.5rem]">
                <AnimatePresence mode="popLayout">
                  {!searchQuery && (
                    <motion.div
                      key={placeholderIndex}
                      initial={{ y: 15, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -15, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="absolute inset-0 flex items-center pointer-events-none text-[var(--text-secondary)] font-medium text-[0.96rem] whitespace-nowrap overflow-hidden"
                    >
                      {placeholders[placeholderIndex]}
                    </motion.div>
                  )}
                </AnimatePresence>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  aria-label="Search locations"
                  autoComplete="off"
                  className="w-full bg-transparent border-none outline-none text-[var(--text-primary)] text-[0.96rem]"
                />
              </div>
              <button type="submit" disabled={isSearching}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={isSearching || isWaiting ? 'loading' : 'sparkles'}
                    initial={{ opacity: 0, scale: 0.8, rotate: -45 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.8, rotate: 45 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="flex items-center justify-center"
                  >
                    {isSearching || isWaiting ? (
                      <LoaderCircle
                        aria-hidden="true"
                        size={18}
                        className="is-spinning"
                      />
                    ) : (
                      <Sparkles aria-hidden="true" size={18} />
                    )}
                  </motion.div>
                </AnimatePresence>
                <span className="sr-only">Search the map</span>
              </button>
            </form>

            <AnimatePresence>
              {isDropdownOpen && suggestions.length > 0 && (
                <motion.ul
                  layout
                  className="map-page__dropdown"
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={{
                    hidden: { opacity: 0, height: 0 },
                    visible: {
                      opacity: 1,
                      height: 'auto',
                      transition: {
                        height: { duration: 0.4, type: 'spring', bounce: 0 },
                        staggerChildren: 0.1,
                        delayChildren: 0.05,
                      },
                    },
                    exit: {
                      opacity: 0,
                      height: 0,
                      transition: { duration: 0.2 },
                    },
                  }}
                >
                  {suggestions.map((result, idx) => (
                    <motion.li
                      key={`${result.label}-${idx}`}
                      variants={{
                        hidden: { opacity: 0, y: -8 },
                        visible: {
                          opacity: 1,
                          y: 0,
                          transition: { duration: 0.4 },
                        },
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleResultSelect(result)}
                      >
                        <MapPin size={16} aria-hidden="true" />
                        <span>{result.label}</span>
                      </button>
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>

          {searchMessage && !isDropdownOpen ? (
            <p className="map-page__search-note">{searchMessage}</p>
          ) : null}
        </div>

        {!isSidebarOpen && panelState.status !== 'empty' && (
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="fixed right-5 bottom-5 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(15,23,42,0.8)] text-[var(--landing-accent)] shadow-lg backdrop-blur-md transition-transform hover:scale-110 sm:right-8 sm:bottom-8"
            aria-label="Open analysis sidebar"
          >
            <MapPinned size={24} />
          </button>
        )}

        <aside
          className={`map-page__sidebar ${!isSidebarOpen ? 'map-page__sidebar--hidden' : ''}`}
        >
          <div className="map-page__sidebar-header">
            <div>
              <p className="map-page__eyebrow">Region Analysis</p>
              <h1>Operational view</h1>
            </div>
            <button
              type="button"
              onClick={closeSidebar}
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>

          <div className="map-page__sidebar-body">
            <AnimatePresence mode="wait">
              {panelState.status === 'empty' && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="map-page__state map-page__state--empty"
                >
                  <MapPinned aria-hidden="true" size={40} />
                  <p>
                    Select a grid cell or search for a place to generate
                    insights.
                  </p>
                </motion.div>
              )}

              {panelState.status === 'loading' && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="map-page__state map-page__state--loading"
                >
                  <LoaderCircle
                    aria-hidden="true"
                    size={36}
                    className="is-spinning"
                  />
                  <p>Analyzing {panelState.label}...</p>
                </motion.div>
              )}

              {panelState.status === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="map-page__state map-page__state--error"
                >
                  <p className="map-page__badge">Lookup</p>
                  <h2>{panelState.title}</h2>
                  <p>{panelState.message}</p>
                </motion.div>
              )}

              {panelState.status === 'ready' && (
                <motion.div
                  key="ready"
                  initial="hidden"
                  animate="visible"
                  variants={{
                    hidden: { opacity: 0 },
                    visible: {
                      opacity: 1,
                      transition: { staggerChildren: 0.12 },
                    },
                  }}
                  className="map-page__data"
                >
                  <motion.p
                    variants={{
                      hidden: { opacity: 0, y: 5 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__badge"
                  >
                    {panelState.analysis.badge}
                  </motion.p>
                  <motion.h2
                    variants={{
                      hidden: { opacity: 0, y: 5 },
                      visible: { opacity: 1, y: 0 },
                    }}
                  >
                    {panelState.analysis.heading}
                  </motion.h2>
                  <div className="map-page__copy">
                    {panelState.analysis.summary.map((paragraph, i) => (
                      <motion.p
                        key={i}
                        variants={{
                          hidden: { opacity: 0, y: 10 },
                          visible: { opacity: 1, y: 0 },
                        }}
                      >
                        {paragraph}
                      </motion.p>
                    ))}
                    <motion.p
                      variants={{
                        hidden: { opacity: 0, y: 10 },
                        visible: { opacity: 1, y: 0 },
                      }}
                    >
                      Recommendation:{' '}
                      <em>{panelState.analysis.recommendation}</em>
                    </motion.p>
                  </div>

                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__metrics"
                  >
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
                  </motion.div>

                  {terrainView && (
                    <motion.button
                      type="button"
                      variants={{
                        hidden: { opacity: 0, y: 10 },
                        visible: { opacity: 1, y: 0 },
                      }}
                      className="map-page__terrain-button"
                      onClick={() => setShowTerrainPopup(true)}
                    >
                      <Mountain aria-hidden="true" size={18} />
                      <span>View Terrain</span>
                    </motion.button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
      </section>

      {showTerrainPopup && terrainView && (
        <TerrainPopup
          cellId={terrainView.cellId}
          center={terrainView.center}
          bounds={terrainView.bounds}
          onClose={() => setShowTerrainPopup(false)}
        />
      )}
    </main>
  )
}

function MapTopbar() {
  return (
    <nav className="fixed top-0 left-0 z-[100] flex h-[70px] w-full items-center justify-between border-b border-white/5 bg-[rgba(8,15,26,0.3)] px-5 shadow-none backdrop-blur-md sm:px-10">
      <div className="flex items-center gap-3 text-xl font-semibold tracking-[-0.3px] text-[var(--landing-text-primary)]">
        <CloudLightning
          aria-hidden="true"
          className="h-[1.4rem] w-[1.4rem] text-[var(--landing-accent)]"
        />
        <span>Yaad Guard</span>
      </div>

      <div className="flex items-center gap-4 sm:gap-8">
        <Link
          to="/"
          className="hidden text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-primary)] no-underline transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] md:inline"
        >
          Home
        </Link>
        <a
          href="/#about"
          className="hidden text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--landing-text-primary)] md:inline"
        >
          About
        </a>
        <a
          href="/#technology"
          className="hidden text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--landing-text-primary)] md:inline"
        >
          Technology
        </a>
      </div>
    </nav>
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
