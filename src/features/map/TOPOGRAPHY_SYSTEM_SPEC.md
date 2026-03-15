# Topography System Specification

## Overview

The topography system provides 3D terrain visualization for selected grid cells on the map. It converts Copernicus DEM (Digital Elevation Model) GeoTIFF files into Terrain-RGB tiles that can be rendered by MapLibre GL with 3D pitch and rotation capabilities.

This specification enables downstream systems (e.g., water flow simulation, runoff analysis) to understand and extend the terrain data infrastructure.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐ │
│  │  Copernicus DEM │      │ Railway Cloud   │      │  S3 Bucket B    │ │
│  │  GeoTIFF Files  │─────▶│ Function        │─────▶│  Terrain Tiles  │ │
│  │  (Source)       │      │ (terrain-tiler) │      │  (PNG/Raster)   │ │
│  │  ~213 files     │      │                 │      │  z10-z15        │ │
│  │  ~2GB total     │      │                 │      │                 │ │
│  └─────────────────┘      └─────────────────┘      └─────────────────┘ │
│         │                                                   │           │
│         │                                                   │           │
│  ┌──────▼──────┐                                    ┌──────▼──────┐   │
│  │ S3 Bucket A │                                    │ Signed URLs │   │
│  │ (Source)    │                                    │ (Future)    │   │
│  └─────────────┘                                    └─────────────┘   │
│                                                            │           │
│  ┌─────────────────────────────────────────────────────────▼─────────┐ │
│  │                        FRONTEND                                    │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │ │
│  │  │ MapPage     │───▶│ Grid Cell   │───▶│ TerrainPopup       │   │ │
│  │  │ (Main Map)  │    │ Selection    │    │ (3D Terrain View)   │   │ │
│  │  └─────────────┘    └─────────────┘    │ - MapLibre 3D       │   │ │
│  │                                         │ - Pitch/Rotation    │   │ │
│  │                                         │ - Hillshade         │   │ │
│  │                                         └─────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Sources

### Input: Copernicus DEM GeoTIFF Files

| Property             | Value                                       |
| -------------------- | ------------------------------------------- |
| Source               | Copernicus DEM GLO-30                       |
| Resolution           | 1 arc-second (~30m)                         |
| Format               | GeoTIFF (Cloud Optimized)                   |
| Naming Convention    | `Copernicus_DSM_COG_10_<lat>_<lon>_DEM.tif` |
| Coordinate Reference | EPSG:4326 (WGS84)                           |
| Coverage             | Caribbean region (~213 tiles)               |
| File Size            | ~45MB per 5 tiles (Jamaica), ~2GB total     |

#### Naming Convention Breakdown

```
Copernicus_DSM_COG_10_N26_00_W083_00_DEM.tif
                  │    │   │    │
                  │    │   │    └── Longitude: 83°00' West
                  │    │   └── Longitude position (00' = 0 arc-minutes)
                  │    └── Latitude: 26°00' North
                  └── Latitude position (00' = 0 arc-minutes)

Coverage per file: 1° latitude × 1° longitude
Bottom-left corner: Named coordinates
```

#### Geographic Coverage per TIFF

Each TIFF covers approximately:

- Latitude span: 1 degree (111 km)
- Longitude span: 1 degree (~105 km at Caribbean latitude 18°N)
- Contains ~3,350 potential grid cells (at 0.015° × 0.02° resolution)

### Output: Terrain-RGB Tiles

| Property     | Value                            |
| ------------ | -------------------------------- |
| Format       | PNG (RGB encoded elevation)      |
| Tile Size    | 256 × 256 pixels                 |
| Zoom Levels  | z10 (regional) to z15 (detailed) |
| Encoding     | Mapbox Terrain-RGB               |
| Storage Path | `tiles/{z}/{x}/{y}.png`          |
| Projection   | Web Mercator (EPSG:3857)         |

#### Terrain-RGB Encoding Formula

```typescript
// Encoding elevation to RGB
const encoded = Math.round((elevation + 10000) / 0.1)
const r = (encoded >> 16) & 0xff
const g = (encoded >> 8) & 0xff
const b = encoded & 0xff

// Decoding RGB to elevation
const elevation = -10000 + (r * 256 * 256 + g * 256 + b) * 0.1

// Valid elevation range: -10,000m to +100,000m
// Precision: 0.1 meters
```

---

## Terrain Tile Generation (Railway Cloud Function)

### Endpoint

```
POST https://function-bun-production-6756.up.railway.app/generate-tiles
```

### Environment Variables

| Variable                | Description                        | Example                    |
| ----------------------- | ---------------------------------- | -------------------------- |
| `SOURCE_BUCKET`         | S3 bucket containing GeoTIFF files | `copernicus-dem-caribbean` |
| `DEST_BUCKET`           | S3 bucket for terrain tiles        | `terrain-tiles-caribbean`  |
| `AWS_REGION`            | AWS region for S3                  | `us-east-1`                |
| `AWS_ACCESS_KEY_ID`     | IAM access key                     | `AKIAIOSFODNN7EXAMPLE`     |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key                     | `wJalrXUtnFEMI/K7...`      |

### Request Body

```json
{
  "dryRun": false, // If true, process without uploading tiles
  "maxTiles": 5 // Optional: limit number of TIFFs processed
}
```

### Response

```json
{
  "total": 213,
  "processed": 45,
  "skipped": 168,
  "tilesGenerated": 156720,
  "results": [
    {
      "sourceFile": "caribbean_tiles/Copernicus_DSM_COG_10_N26_00_W083_00_DEM.tif",
      "skipped": false,
      "tilesGenerated": 3492
    },
    {
      "sourceFile": "caribbean_tiles/Copernicus_DSM_COG_10_N25_00_W080_00_DEM.tif",
      "skipped": true,
      "reason": "All elevations below sea level (max: -5.2m)"
    }
  ]
}
```

### Water-Only Detection

Files are skipped if:

1. All pixel values are nodata or below -1000m
2. Maximum elevation < 0m (fully submerged)
3. Elevation variance < 1m AND maximum < 5m (flat water surface)

---

## Frontend Implementation

### File Structure

```
src/features/map/
├── config.ts           # Terrain configuration constants
├── types.ts            # TypeScript type definitions
├── TerrainPopup.tsx    # 3D terrain view component
├── MapPage.tsx         # Main map page with terrain integration
├── grid.ts             # Grid cell generation
├── analysis.ts         # Region analysis generation
└── search.ts           # Geocoding search
```

### Configuration (config.ts)

```typescript
// Terrain tile source
export const TERRAIN_TILE_URL =
  'https://your-s3-bucket.s3.region.amazonaws.com/tiles/{z}/{x}/{y}.png'

// MapLibre source configuration
export const TERRAIN_SOURCE_ID = 'terrain-dem-source'
export const TERRAIN_MIN_ZOOM = 10
export const TERRAIN_MAX_ZOOM = 15
export const TERRAIN_EXAGGERATION = 1.5 // Vertical scale factor

// Grid configuration (affects cell selection)
export const GRID_ROWS = 20
export const GRID_COLUMNS = 20
export const GRID_LAT_STEP = 0.015 // ~1.67 km
export const GRID_LNG_STEP = 0.02 // ~2.22 km
```

### Types (types.ts)

```typescript
// Coordinate types
export type LngLatTuple = [number, number] // [longitude, latitude]
export type BoundsTuple = [LngLatTuple, LngLatTuple] // [SW, NE]

// Grid cell metadata
export interface GridCellProperties {
  cellId: string // e.g., "A1", "B3"
  centerLng: number // Longitude of cell center
  centerLat: number // Latitude of cell center
}

// Terrain view state
export interface TerrainView {
  cellId: string // Selected cell identifier
  center: LngLatTuple // Cell center coordinates
  bounds: BoundsTuple // Cell boundary coordinates
}
```

### TerrainPopup Component

**File:** `src/features/map/TerrainPopup.tsx`

```typescript
interface TerrainPopupProps {
  cellId: string // Cell identifier for display
  center: LngLatTuple // Center coordinates for camera
  bounds: BoundsTuple // Cell boundaries for fitBounds
  onClose: () => void // Close handler
}
```

**Features:**

- MapLibre GL map instance with terrain source
- 3D perspective view (pitch: 45°, bearing: -30°)
- Hillshade layer with custom styling
- Loading indicator while tiles initialize
- Error handling for failed tile loads
- Responsive modal with dark theme

---

## Grid System

### Grid Configuration

The map overlay uses a 20×20 grid centered on the search location or default center.

```typescript
// Default center: Kingston, Jamaica
export const DEFAULT_MAP_CENTER: LngLatTuple = [-76.7928, 17.9714]

// Cell dimensions at 18°N latitude
// 0.015° latitude ≈ 1.67 km
// 0.02° longitude ≈ 2.22 km
// Each cell ≈ 3.7 km² area
```

### Cell ID Generation

```typescript
// Cell labels: A-T columns (horizontal), 1-20 rows (vertical)
// Column labels cycle through A-Z
const COLUMN_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function getCellId(col: number, row: number): string {
  return `${COLUMN_LABELS[col % COLUMN_LABELS.length]}${row + 1}`
}

// Examples: A1, B3, Z20, AA1 (wraps at 26 columns)
```

### Cell Bounds Calculation

```typescript
// Calculate bounds from center and step values
function getCellBounds(center: LngLatTuple): BoundsTuple {
  const [lng, lat] = center
  const halfLatStep = GRID_LAT_STEP / 2 // 0.0075°
  const halfLngStep = GRID_LNG_STEP / 2 // 0.01°

  return [
    [lng - halfLngStep, lat - halfLatStep], // SW corner
    [lng + halfLngStep, lat + halfLatStep], // NE corner
  ]
}

// For cell "J10" centered at [-76.75, 17.95]:
// SW: [-76.76, 17.9425]
// NE: [-76.74, 17.9575]
```

---

## Water Flow Simulation Extension

### Available Data for Simulation

The terrain tiles provide elevation data that can be used for hydrological simulations:

1. **Elevation values** - Encoded in RGB, 0.1m precision
2. **Cell boundaries** - Known grid cell extents
3. **Geographic projection** - Web Mercator to lat/lng conversion

### Recommended Approach for Water Flow

```typescript
// 1. Decode elevation from Terrain-RGB tile
function decodeElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
}

// 2. Calculate flow direction using D8 algorithm
// For each cell, find the steepest descent to neighbor
function calculateFlowDirection(elevationGrid: number[][]): number[][] {
  // D8 direction: 0-7 representing flow to one of 8 neighbors
  // Or use D-infinity for more nuanced flow
}

// 3. Accumulate flow to identify streams and valleys
function calculateFlowAccumulation(flowDirection: number[][]): number[][] {
  // Count cells that drain through each point
}

// 4. Identify depression/water collection areas
function findDepressions(elevationGrid: number[][]): Polygon[] {
  // Cells that have no outlet (pit filling)
}
```

### Data Access Patterns for Simulation

#### Option A: Server-side Processing (Recommended)

```typescript
// API endpoint for water flow data
GET /api/terrain/{cellId}/flow-analysis

// Response
{
  "cellId": "J10",
  "bounds": { "sw": [-76.76, 17.9425], "ne": [-76.74, 17.9575] },
  "elevation": {
    "min": 12.4,
    "max": 287.3,
    "mean": 156.7,
    "resolution": 30  // meters per pixel
  },
  "flowLines": [
    { "type": "LineString", "coordinates": [...], "accumulation": 1250 }
  ],
  "depressions": [
    { "type": "Polygon", "coordinates": [...], "depth": 2.3, "volume": 45000 }
  ],
  "runoffPotential": {
    "infiltrationRate": 0.12,  // m/day
    "surface runoff": 0.65     // fraction
  }
}
```

#### Option B: Client-side Processing

```typescript
// Fetch terrain tile directly
const tileUrl = `https://your-bucket.s3.amazonaws.com/tiles/14/4825/6752.png`
const response = await fetch(tileUrl)
const imageData = await createImageBitmap(response)

// Decode elevation values
const elevations = decodeTerrainRGB(imageData)

// Create elevation grid for analysis
const grid = createElevationGrid(elevations, cellBounds)
```

### Simulation Inputs Required

For water flow simulation, you'll need additional data:

| Data Type  | Source                   | Purpose             |
| ---------- | ------------------------ | ------------------- |
| Soil Type  | FAO Soil Map             | Infiltration rate   |
| Land Cover | ESA WorldCover           | Surface roughness   |
| Rainfall   | CHIRPS/Imerg             | Precipitation input |
| DEM        | Copernicus DEM (current) | Flow direction      |

### Recommended Libraries

```json
{
  "dependencies": {
    "geotiff": "^2.1.0", // Parse elevation data
    "d3-geo": "^3.1.0", // Geographic projections
    "turf": "^7.0.0", // Spatial analysis

    // Optional, for advanced simulation:
    "whitebox-tools": "^2.0.0", // Hydrological analysis (Node.js)
    "taudem": "^5.3.0" // Terrain analysis (requires GDAL)
  }
}
```

---

## Tile URLs and Signed Access (Future)

### Current (Public Buckets)

```typescript
const tileUrl = `https://${DEST_BUCKET}.s3.amazonaws.com/tiles/${z}/${x}/${y}.png`
```

### Future (Private Buckets with Signed URLs)

```typescript
// Generate signed URL on backend
async function getSignedTileUrl(
  z: number,
  x: number,
  y: number,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: DEST_BUCKET,
    Key: `tiles/${z}/${x}/${y}.png`,
  })
  return getSignedUrl(s3Client, command, { expiresIn: 3600 })
}

// Frontend fetches through proxy or pre-generated URLs
```

---

## Performance Considerations

### Tile Generation

- Processing time: ~30-60 seconds per TIFF file
- Total estimated time: ~3-4 hours for 213 files
- Output size: ~500MB-1GB (compressed PNG tiles)

### Frontend Rendering

- Initial tile load: prioritize z10-z12 for quick overview
- Progressive loading: higher zoom levels load on demand
- Memory: Terrain source is shared across map instances
- GPU: MapLibre uses WebGL for 3D rendering

### Optimization Recommendations

1. **Lazy load terrain tiles:** Only load when popup opens
2. **Cache tiles:** Browser caches PNG tiles automatically
3. **Precompute z14-z15:** Generate detailed tiles ahead of time
4. **Use vector tiles for analysis:** Convert to GeoJSON for simulation

---

## Testing

### Test Tile Generation

```bash
# Health check
curl https://function-bun-production-6756.up.railway.app/health

# Dry run (no uploads)
curl -X POST https://function-bun-production-6756.up.railway.app/generate-tiles \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "maxTiles": 5}'

# Full generation
curl -X POST https://function-bun-production-6756.up.railway.app/generate-tiles
```

### Test Frontend

```bash
# Start development server
npm run dev

# Navigate to /map
# Select a grid cell
# Click "View Terrain" button
# Verify 3D terrain loads with pitch/rotation
```

---

## File Manifest

### Frontend Files

| File                                | Purpose                                    |
| ----------------------------------- | ------------------------------------------ |
| `src/features/map/config.ts`        | Configuration constants                    |
| `src/features/map/types.ts`         | TypeScript type definitions                |
| `src/features/map/TerrainPopup.tsx` | 3D terrain modal component                 |
| `src/features/map/MapPage.tsx`      | Main map page with terrain integration     |
| `src/features/map/grid.ts`          | Grid cell generation logic                 |
| `src/styles.css`                    | Terrain popup styles (`.terrain-popup__*`) |

### Backend Files (Railway)

| File                         | Purpose                                |
| ---------------------------- | -------------------------------------- |
| `terrain-tiler/index.ts`     | Bun cloud function for tile generation |
| `terrain-tiler/package.json` | Dependencies                           |

---

## Contact & References

- **Copernicus DEM Documentation:** https://dataspace.copernicus.eu/
- **MapLibre Terrain Documentation:** https://maplibre.org/maplibre-gl-js/docs/
- **Terrain-RGB Specification:** https://docs.mapbox.com/data/tilesets/reference/global-elevation-coverage/
