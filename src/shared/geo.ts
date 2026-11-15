export type LngLat = [number, number]

const EARTH_RADIUS_M = 6_371_008.8

/**
 * Approximate geodesic area of a polygon ring using the spherical excess
 * formula (Chamberlain & Duquette). Accurate to well under 1% for field-sized
 * parcels; the UI always labels it as an approximation.
 */
export function ringAreaHa(ring: LngLat[]): number {
  if (ring.length < 3) return 0
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % ring.length]
    total +=
      toRadians(lng2 - lng1) *
      (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)))
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2) / 10_000
}

export function centroid(ring: LngLat[]): LngLat {
  if (!ring.length) return [0, 0]
  let lng = 0
  let lat = 0
  for (const point of ring) {
    lng += point[0]
    lat += point[1]
  }
  return [
    Number((lng / ring.length).toFixed(6)),
    Number((lat / ring.length).toFixed(6)),
  ]
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}
