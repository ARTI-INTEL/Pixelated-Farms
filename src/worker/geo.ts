import type { GeoResult, LngLat } from '../shared/types'

export { ringAreaHa, centroid } from '../shared/geo'

export function normalizeRing(boundary: unknown): LngLat[] | null {
  if (!Array.isArray(boundary) || boundary.length < 3 || boundary.length > 500)
    return null
  const ring: LngLat[] = []
  for (const point of boundary) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1]) ||
      Math.abs(point[0]) > 180 ||
      Math.abs(point[1]) > 85
    )
      return null
    ring.push([point[0], point[1]])
  }
  const [firstLng, firstLat] = ring[0]
  const [lastLng, lastLat] = ring[ring.length - 1]
  if (firstLng === lastLng && firstLat === lastLat && ring.length > 3) ring.pop()
  return ring.length >= 3 ? ring : null
}

export function boundsOf(ring: LngLat[]): [number, number, number, number] {
  let west = 180
  let south = 90
  let east = -180
  let north = -90
  for (const [lng, lat] of ring) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return [west, south, east, north]
}

/** Round coordinates to the POWER grid so identical fields reuse one cache entry. */
export function powerCell(lat: number, lon: number): string {
  const latCell = Math.round(lat * 2) / 2
  const lonCell = Math.round(lon * 1.6) / 1.6
  return `${latCell.toFixed(1)}:${lonCell.toFixed(1)}`
}

/**
 * Place search via Photon (OpenStreetMap data, no key). Volume is low and each
 * query is cached in D1 by the API route.
 */
export async function geocode(query: string): Promise<GeoResult[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Fieldshift/1.0 (NASA Space Apps demo)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`Geocoder HTTP ${response.status}`)
  const body = (await response.json()) as {
    features?: {
      geometry?: { coordinates?: [number, number] }
      properties?: Record<string, unknown>
    }[]
  }
  return (body.features ?? [])
    .map((feature) => {
      const coordinates = feature.geometry?.coordinates
      const props = feature.properties ?? {}
      if (!coordinates) return null
      const parts = [props.name, props.city, props.state, props.country]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .filter((part, index, all) => all.indexOf(part) === index)
      return {
        label: parts.join(', ') || 'Selected place',
        lng: coordinates[0],
        lat: coordinates[1],
        type: typeof props.type === 'string' ? props.type : 'place',
      }
    })
    .filter((result): result is GeoResult => result !== null)
}
