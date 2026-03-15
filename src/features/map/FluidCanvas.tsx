import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { WeatherData } from './fluid_types'
import {
  GRID_ROWS,
  GRID_COLS,
  GRID_LAT_STEP,
  GRID_LNG_STEP,
} from './config'
import type { LngLatTuple } from './types'

const MAX_PARTICLES = 2800

interface Particle {
  row: number
  col: number
  fx: number   // fractional position within cell [0,1)
  fy: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

interface FluidCanvasProps {
  map: maplibregl.Map
  center: LngLatTuple
  elevations: number[]
  weather: WeatherData
  running: boolean
}

export function FluidCanvas({
  map,
  center,
  elevations,
  weather,
  running,
}: FluidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef    = useRef<FluidSim | null>(null)
  const runningRef = useRef(running)

  // Keep runningRef in sync without restarting the sim
  useEffect(() => {
    runningRef.current = running
    if (simRef.current) simRef.current.running = running
  }, [running])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || elevations.length === 0) return

    // Destroy any previous instance
    simRef.current?.destroy()
    simRef.current = new FluidSim(canvas, map, center, elevations, weather)
    simRef.current.running = runningRef.current

    // Redraw whenever the map moves so particles stay glued to geography
    const redraw = () => { simRef.current?.redraw() }
    map.on('move',   redraw)
    map.on('zoom',   redraw)
    map.on('resize', redraw)

    return () => {
      map.off('move',   redraw)
      map.off('zoom',   redraw)
      map.off('resize', redraw)
      simRef.current?.destroy()
      simRef.current = null
    }
  // Re-create the sim when the data actually changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, center, elevations, weather])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:      'absolute',
        inset:         0,
        zIndex:        2,
        pointerEvents: 'none',   // clicks pass through to the map
        width:         '100%',
        height:        '100%',
      }}
      aria-hidden="true"
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Imperative simulation class (no React inside)
═══════════════════════════════════════════════════════════════════ */
class FluidSim {
  running = true

  private canvas:    HTMLCanvasElement
  private ctx:       CanvasRenderingContext2D
  private map:       maplibregl.Map
  private center:    LngLatTuple
  private elevGrid:  number[]
  private weather:   WeatherData
  private particles: Particle[] = []
  private slopeX:    Float32Array
  private slopeY:    Float32Array
  private raf:       number | null = null
  private elevMax:   number

  constructor(
    canvas: HTMLCanvasElement,
    map: maplibregl.Map,
    center: LngLatTuple,
    elevations: number[],
    weather: WeatherData,
  ) {
    this.canvas   = canvas
    this.ctx      = canvas.getContext('2d')!
    this.map      = map
    this.center   = center
    this.elevGrid = elevations
    this.weather  = weather
    this.elevMax  = Math.max(...elevations)

    this.slopeX   = new Float32Array(GRID_ROWS * GRID_COLS)
    this.slopeY   = new Float32Array(GRID_ROWS * GRID_COLS)

    this._buildSlopeField()
    this._spawnInitial()
    this._loop()
  }

  /* ── Slope field (central-difference gradient) ───────────────── */
  private _buildSlopeField() {
    const e = (r: number, c: number): number | null => {
      if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return null
      return this.elevGrid[r * GRID_COLS + c]
    }

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const idx  = r * GRID_COLS + c
        const self = e(r, c)!
        const dLng = ((e(r, c + 1) ?? self) - (e(r, c - 1) ?? self)) / 2
        const dLat = ((e(r + 1, c) ?? self) - (e(r - 1, c) ?? self)) / 2
        // Water flows DOWN the gradient → negate
        this.slopeX[idx] = -dLng
        this.slopeY[idx] =  dLat   // +row = south = down on canvas
      }
    }
  }

  /* ── Spawn ───────────────────────────────────────────────────── */
  private _spawnOne(): void {
    const row  = Math.floor(Math.random() * GRID_ROWS)
    const col  = Math.floor(Math.random() * GRID_COLS)
    const elev = this.elevGrid[row * GRID_COLS + col]

    // Bias toward high-elevation cells (water originates at peaks)
    if (Math.random() > (elev / Math.max(this.elevMax, 1)) * 0.8 + 0.2) {
      return this._spawnOne()
    }

    const life = 0.55 + Math.random() * 0.45
    this.particles.push({
      row, col,
      fx: Math.random(), fy: Math.random(),
      vx: (Math.random() - 0.5) * 0.015,
      vy: (Math.random() - 0.5) * 0.015,
      life, maxLife: life,
    })
  }

  private _spawnInitial() {
    for (let i = 0; i < MAX_PARTICLES; i++) this._spawnOne()
  }

  /* ── Geo → canvas projection ─────────────────────────────────── */
  private _cellToCanvas(
    row: number, col: number, fx: number, fy: number,
  ): [number, number] {
    const [cLng, cLat] = this.center
    const startLat = cLat + (GRID_ROWS / 2) * GRID_LAT_STEP
    const startLng = cLng - (GRID_COLS / 2) * GRID_LNG_STEP

    const lat = startLat - row * GRID_LAT_STEP - fy * GRID_LAT_STEP
    const lng = startLng + col * GRID_LNG_STEP + fx * GRID_LNG_STEP

    const pt = this.map.project([lng, lat])
    return [pt.x, pt.y]
  }

  /* ── Speed → colour ──────────────────────────────────────────── */
  private _speedColor(speed: number, alpha: number): string {
    const t = Math.min(speed / 0.06, 1)
    const stops: [number, number, number][] = [
      [74,  222, 128],   // green  – safe
      [134, 239, 172],   // lime
      [251, 191,  36],   // yellow – moderate
      [249, 115,  22],   // orange – high
      [251, 113, 133],   // red    – critical
    ]
    const seg = (stops.length - 1) * t
    const lo  = Math.floor(seg)
    const hi  = Math.min(lo + 1, stops.length - 1)
    const f   = seg - lo
    const r   = Math.round(stops[lo][0] * (1 - f) + stops[hi][0] * f)
    const g   = Math.round(stops[lo][1] * (1 - f) + stops[hi][1] * f)
    const b   = Math.round(stops[lo][2] * (1 - f) + stops[hi][2] * f)
    return `rgba(${r},${g},${b},${alpha})`
  }

  /* ── Physics tick ────────────────────────────────────────────── */
  private _tick() {
    const windRad   = (this.weather.windDir * Math.PI) / 180
    const windPush  = this.weather.windSpeed * 0.00004
    const rainBoost = 1 + Math.min(this.weather.precip24 / 20, 2)

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p   = this.particles[i]!
      const idx = p.row * GRID_COLS + p.col

      const gravity = 0.0018 * rainBoost
      p.vx += this.slopeX[idx]! * gravity
      p.vy += this.slopeY[idx]! * gravity

      // Wind nudge
      p.vx += Math.sin(windRad) * windPush
      p.vy -= Math.cos(windRad) * windPush

      // Friction
      p.vx *= 0.93
      p.vy *= 0.93

      // Speed cap
      const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      if (spd > 0.08) {
        p.vx = (p.vx / spd) * 0.08
        p.vy = (p.vy / spd) * 0.08
      }

      p.fx += p.vx
      p.fy += p.vy

      // Cell boundary crossing
      if (p.fx >= 1) { p.fx -= 1; p.col = Math.min(p.col + 1, GRID_COLS - 1) }
      if (p.fx <  0) { p.fx += 1; p.col = Math.max(p.col - 1, 0) }
      if (p.fy >= 1) { p.fy -= 1; p.row = Math.min(p.row + 1, GRID_ROWS - 1) }
      if (p.fy <  0) { p.fy += 1; p.row = Math.max(p.row - 1, 0) }

      p.life -= 0.003
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        this._spawnOne()
      }
    }
  }

  /* ── Draw ────────────────────────────────────────────────────── */
  private _draw() {
    const canvas = this.canvas
    canvas.width  = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    const ctx = this.ctx
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const p of this.particles) {
      const [px, py] = this._cellToCanvas(p.row, p.col, p.fx, p.fy)
      const spd      = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      const alpha    = (p.life / p.maxLife) * 0.75
      const radius   = 1.8 + spd * 40

      ctx.beginPath()
      ctx.arc(px, py, radius, 0, Math.PI * 2)
      ctx.fillStyle = this._speedColor(spd, alpha)
      ctx.fill()

      // Motion trail
      if (spd > 0.005) {
        const [tx, ty] = this._cellToCanvas(
          p.row, p.col,
          p.fx - p.vx * 4,
          p.fy - p.vy * 4,
        )
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(tx, ty)
        ctx.strokeStyle = this._speedColor(spd, alpha * 0.35)
        ctx.lineWidth   = 1
        ctx.stroke()
      }
    }
  }

  /* ── Loop ────────────────────────────────────────────────────── */
  private _loop() {
    if (this.running) {
      this._tick()
      this._draw()
    }
    this.raf = requestAnimationFrame(() => this._loop())
  }

  /** Called by the map event listeners to force a redraw on pan/zoom */
  redraw() {
    if (!this.running) this._draw()
  }

  destroy() {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
  }
}