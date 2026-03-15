import { CARIBBEAN_COUNTRY_BOUNDARIES } from './caribbeanCountryBoundaries'
import type { LngLatTuple } from './types'

export function pointInPolygon(
  [lng, lat]: LngLatTuple,
  polygon: Array<[number, number]>,
) {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

export function isPointOnCaribbeanLand(point: LngLatTuple) {
  return CARIBBEAN_COUNTRY_BOUNDARIES.some((country) =>
    country.polygons.some((polygon) => pointInPolygon(point, polygon)),
  )
}
