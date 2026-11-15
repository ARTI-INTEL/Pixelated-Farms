import * as maplibregl from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CROPS } from '../../shared/crops'
import { ringAreaHa, centroid } from '../../shared/geo'
import type { FarmInput, GeoResult, Irrigation, LngLat } from '../../shared/types'
import { request } from '../api'

const GIBS_LAYERS = [
  { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', label: 'MODIS Terra true colour' },
  { id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', label: 'VIIRS S-NPP true colour' },
]
const BASEMAPS = {
  dark: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  imagery: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
}

const dateDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

const gibsTiles = (layer: string, date: string) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`

export function FieldMap({
  initial,
  onSave,
  busy,
  heading = 'Draw your field',
}: {
  initial?: FarmInput | null
  onSave: (input: FarmInput) => void
  busy: boolean
  heading?: string
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])
  const pointsRef = useRef<LngLat[]>([])
  const [points, setPoints] = useState<LngLat[]>([])
  const [name, setName] = useState(initial?.name ?? '')
  const [previousCrop, setPreviousCrop] = useState(initial?.previousCrop ?? '')
  const [irrigation, setIrrigation] = useState<Irrigation>(initial?.irrigation ?? 'rainfed')
  const [layer, setLayer] = useState(GIBS_LAYERS[0].id)
  const [basemap, setBasemap] = useState<'dark' | 'imagery'>('dark')
  const [date, setDate] = useState(dateDaysAgo(20))
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [mapReady, setMapReady] = useState(false)

  pointsRef.current = points

  useEffect(() => {
    if (!container.current || map.current) return
    const start = initial?.boundary.length
      ? centroid(initial.boundary)
      : ([-93.55, 42.05] as LngLat)
    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [BASEMAPS.dark],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors © CARTO',
          },
          gibs: {
            type: 'raster',
            tiles: [gibsTiles(GIBS_LAYERS[0].id, dateDaysAgo(20))],
            tileSize: 256,
            maxzoom: 9,
            attribution: 'Imagery: NASA GIBS / EOSDIS',
          },
        },
        layers: [
          { id: 'basemap', type: 'raster', source: 'basemap' },
          { id: 'gibs', type: 'raster', source: 'gibs', paint: { 'raster-opacity': 0.65 } },
        ],
      },
      center: start,
      zoom: initial?.boundary.length ? 14 : 11,
      attributionControl: { compact: true },
    })
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    instance.on('load', () => {
      instance.addSource('field', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      instance.addLayer({
        id: 'field-fill',
        type: 'fill',
        source: 'field',
        paint: { 'fill-color': '#4ade80', 'fill-opacity': 0.22 },
      })
      instance.addLayer({
        id: 'field-line',
        type: 'line',
        source: 'field',
        paint: { 'line-color': '#86efac', 'line-width': 2 },
      })
      setMapReady(true)
    })
    instance.on('click', (event: maplibregl.MapMouseEvent) => {
      const next = [...pointsRef.current, [event.lngLat.lng, event.lngLat.lat] as LngLat]
      pointsRef.current = next
      setPoints(next)
    })
    map.current = instance
    if (initial?.boundary.length) setPoints(initial.boundary)
    return () => {
      instance.remove()
      map.current = null
    }
    // The map is created once; later prop changes are handled by effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance || !mapReady) return
    const source = instance.getSource('field') as maplibregl.GeoJSONSource | undefined
    if (!source) return
    source.setData(
      points.length >= 2
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [[...points, points[0]]],
                },
              },
            ],
          }
        : { type: 'FeatureCollection', features: [] },
    )
  }, [points, mapReady])

  useEffect(() => {
    const instance = map.current
    if (!instance || !mapReady) return
    for (const marker of markers.current) marker.remove()
    markers.current = points.map(
      (point) =>
        new maplibregl.Marker({ color: '#4ade80', scale: 0.7 })
          .setLngLat(point)
          .addTo(instance),
    )
  }, [points, mapReady])

  useEffect(() => {
    const instance = map.current
    if (!instance || !mapReady) return
    const source = instance.getSource('gibs') as maplibregl.RasterTileSource | undefined
    if (!source) return
    source.setTiles([gibsTiles(layer, date)])
  }, [layer, date, mapReady])

  useEffect(() => {
    const instance = map.current
    if (!instance || !mapReady) return
    const source = instance.getSource('basemap') as maplibregl.RasterTileSource | undefined
    source?.setTiles([BASEMAPS[basemap]])
  }, [basemap, mapReady])

  const area = useMemo(() => (points.length >= 3 ? ringAreaHa(points) : 0), [points])

  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (query.trim().length < 2 || searching) return
    setSearching(true)
    setError('')
    try {
      const body = await request<{ results: GeoResult[]; error?: string }>(
        `/api/geo/search?q=${encodeURIComponent(query.trim())}`,
      )
      setResults(body.results)
      if (body.error) setError(body.error)
      if (!body.results.length && !body.error) setError('No place found for that search.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Place search failed.')
    } finally {
      setSearching(false)
    }
  }

  function goTo(result: GeoResult) {
    map.current?.flyTo({ center: [result.lng, result.lat], zoom: 12 })
    setResults([])
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Give the field a name first.')
      return
    }
    if (points.length < 3) {
      setError('Click at least three corners on the map to close the field.')
      return
    }
    if (area < 0.05) {
      setError('That polygon is too small to analyse. Draw a larger field.')
      return
    }
    setError('')
    onSave({
      name: name.trim(),
      boundary: points,
      previousCrop: previousCrop || null,
      irrigation,
      country: null,
      notes: null,
    })
  }

  return (
    <div className="field-map">
      <div className="map-toolbar">
        <form className="map-search" onSubmit={search}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a place, district or farm name"
            aria-label="Search for a place"
          />
          <button type="submit" className="btn-ghost" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        <div className="map-controls">
          <label>
            <span className="sr-only">Imagery layer</span>
            <select value={layer} onChange={(event) => setLayer(event.target.value)}>
              {GIBS_LAYERS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
              <option value="MODIS_Terra_SurfaceReflectance_Bands143">MODIS 143 composite</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Imagery date</span>
            <input
              type="date"
              value={date}
              max={dateDaysAgo(1)}
              min="2000-02-24"
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setBasemap(basemap === 'dark' ? 'imagery' : 'dark')}
          >
            {basemap === 'dark' ? 'Light basemap' : 'Dark basemap'}
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <ul className="search-results">
          {results.map((result, index) => (
            <li key={`${result.label}-${index}`}>
              <button type="button" onClick={() => goTo(result)}>
                {result.label} <span>{result.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div ref={container} className="map-canvas" aria-label="Field boundary map" />

      <p className="map-caption">
        Click to add corners, then finish the field. Basemap © OpenStreetMap contributors © CARTO ·
        Imagery NASA GIBS ({layer.split('_')[0]}, {date}). NASA imagery is 250 m–1 km and shown for
        context, not measurement.
      </p>

      <form className="field-form" onSubmit={submit}>
        <div className="field-form-grid">
          <label>
            Field name
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. North quarter"
            />
          </label>
          <label>
            Previous crop
            <select
              value={previousCrop}
              onChange={(event) => setPreviousCrop(event.target.value)}
            >
              <option value="">Not supplied</option>
              {CROPS.map((crop) => (
                <option key={crop.id} value={crop.id}>
                  {crop.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Water management
            <select
              value={irrigation}
              onChange={(event) => setIrrigation(event.target.value as Irrigation)}
            >
              <option value="rainfed">Rainfed</option>
              <option value="irrigated">Fully irrigated</option>
              <option value="mixed">Supplemental irrigation</option>
            </select>
          </label>
          <div className="field-area">
            <span>Approximate area</span>
            <strong>{area ? `${area.toFixed(1)} ha` : '—'}</strong>
            <small>{points.length} vertices · approximate geodesic area</small>
          </div>
        </div>
        <div className="field-actions">
          <div>
            <button type="button" className="btn-ghost" onClick={() => setPoints(points.slice(0, -1))} disabled={!points.length}>
              Undo point
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPoints([])} disabled={!points.length}>
              Clear
            </button>
          </div>
          <button type="submit" disabled={busy}>
            {busy ? 'Retrieving NASA data…' : 'Save & analyse field'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <p className="form-hint">{heading}: boundaries are approximate, drawn by hand — not a legal survey.</p>
      </form>
    </div>
  )
}
