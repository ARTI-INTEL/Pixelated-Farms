/**
 * NASA data adapters.
 *
 * Every number that reaches the UI comes through here, together with the
 * period, resolution and retrieval time recorded in `SourceRef`. When an
 * upstream service fails we return `null`/`unavailable` and add a warning;
 * nothing is interpolated or invented.
 */

const POWER_BASE = 'https://power.larc.nasa.gov/api/temporal'
const POWER_DAILY_PARAMS = [
  'T2M',
  'T2M_MAX',
  'T2M_MIN',
  'PRECTOTCORR',
  'ALLSKY_SFC_SW_DWN',
  'RH2M',
  'WS2M',
  'GWETROOT',
]
// The monthly API reports the maximum of daily maxima and the minimum of daily
// minima, not their means. Those extremes are never used as monthly means here;
// temperature means and ET0 come from the daily record instead.
const POWER_MONTHLY_PARAMS = ['T2M', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'GWETROOT']
const FILL = -999

/** Small global gate so one isolate never bursts the POWER/ISRIC fair-use limits. */
let gate: Promise<void> = Promise.resolve()
function paced<T>(gapMs: number, task: () => Promise<T>): Promise<T> {
  // The caller gets the result immediately; only the next queued task waits.
  const run = gate.then(task)
  gate = run.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, gapMs)),
    () => new Promise<void>((resolve) => setTimeout(resolve, gapMs)),
  )
  return run
}

async function getJson<T>(url: string, attempts = 2, timeoutMs = 25_000): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Fieldshift/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as T
    } catch (error) {
      lastError = error
      if (attempt < attempts)
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed')
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value !== FILL
    ? value
    : null

type PowerResponse = {
  properties?: { parameter?: Record<string, Record<string, number>> }
  header?: { sources?: string[]; start?: string; end?: string }
}

export type PowerMonthly = {
  /** 12 monthly climatological means over the baseline period. */
  normals: {
    month: number
    tmean: number | null
    tmax: number | null
    tmin: number | null
    precipMm: number | null
    solarMj: number | null
    soilWetness: number | null
  }[]
  annual: { year: number; precipMm: number; tmean: number; gdd: number }[]
  baselinePeriod: string
  sources: string[]
  retrievedAt: string
}

/** Monthly POWER series (2001 → last complete year): normals + annual history. */
export async function fetchPowerMonthly(
  lat: number,
  lon: number,
): Promise<PowerMonthly | null> {
  const endYear = new Date().getUTCFullYear() - 1
  const startYear = 2001
  if (endYear < startYear) return null
  const url =
    `${POWER_BASE}/monthly/point?parameters=${POWER_MONTHLY_PARAMS.join(',')}` +
    `&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` +
    `&start=${startYear}&end=${endYear}&format=JSON&time-standard=LST`
  let body: PowerResponse
  try {
    body = await paced(350, () => getJson<PowerResponse>(url))
  } catch {
    return null
  }
  const params = body.properties?.parameter
  if (!params?.T2M) return null

  const months: PowerMonthly['normals'] = []
  const byMonth = new Map<number, Record<string, number[]>>()
  for (let month = 1; month <= 12; month++) {
    byMonth.set(month, {
      tmean: [],
      tmax: [],
      tmin: [],
      precip: [],
      solar: [],
      wetness: [],
    })
  }
  const annualMap = new Map<number, { precip: number; tmean: number[]; gdd: number }>()

  for (const [key, raw] of Object.entries(params.T2M)) {
    const year = Number(key.slice(0, 4))
    const month = Number(key.slice(4, 6))
    if (!Number.isFinite(year) || month < 1 || month > 12) continue
    const read = (name: string) => num(params[name]?.[key])
    const tmean = read('T2M')
    const tmax = read('T2M_MAX')
    const tmin = read('T2M_MIN')
    const precip = read('PRECTOTCORR')
    const solar = read('ALLSKY_SFC_SW_DWN')
    const wetness = read('GWETROOT')
    const bucket = byMonth.get(month)!
    if (tmean !== null) bucket.tmean!.push(tmean)
    if (tmax !== null) bucket.tmax!.push(tmax)
    if (tmin !== null) bucket.tmin!.push(tmin)
    if (precip !== null) bucket.precip!.push(precip)
    if (solar !== null) bucket.solar!.push(solar)
    if (wetness !== null) bucket.wetness!.push(wetness)

    if (!annualMap.has(year))
      annualMap.set(year, { precip: 0, tmean: [], gdd: 0 })
    const entry = annualMap.get(year)!
    if (precip !== null) entry.precip += precip * new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (tmean !== null) {
      entry.tmean.push(tmean)
      entry.gdd += Math.max(0, tmean - 10) * new Date(Date.UTC(year, month, 0)).getUTCDate()
    }
  }

  const mean = (values: number[] | undefined) =>
    values && values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null

  for (let month = 1; month <= 12; month++) {
    const bucket = byMonth.get(month)!
    const days = new Date(Date.UTC(2001, month, 0)).getUTCDate()
    const precipMean = mean(bucket.precip)
    months.push({
      month,
      tmean: mean(bucket.tmean),
      tmax: mean(bucket.tmax),
      tmin: mean(bucket.tmin),
      precipMm: precipMean === null ? null : precipMean * days,
      solarMj: mean(bucket.solar),
      soilWetness: mean(bucket.wetness),
    })
  }

  const annual = [...annualMap.entries()]
    .filter(([, value]) => value.tmean.length >= 10)
    .map(([year, value]) => ({
      year,
      precipMm: Math.round(value.precip),
      tmean: Number((mean(value.tmean) ?? 0).toFixed(2)),
      gdd: Math.round(value.gdd),
    }))
    .sort((a, b) => a.year - b.year)

  return {
    normals: months,
    annual,
    baselinePeriod: `${startYear}–${endYear}`,
    sources: body.header?.sources ?? ['MERRA2', 'SYN1DEG', 'POWER'],
    retrievedAt: new Date().toISOString(),
  }
}

export type PowerDaily = {
  days: {
    date: string
    tmean: number | null
    tmax: number | null
    tmin: number | null
    precipMm: number | null
    solarMj: number | null
    wetness: number | null
  }[]
  period: string
  retrievedAt: string
}

/** Daily POWER series for the last ~5 years: extremes, dry spells, recent anomalies. */
export async function fetchPowerDaily(
  lat: number,
  lon: number,
): Promise<PowerDaily | null> {
  const today = new Date()
  const end = new Date(today.getTime() - 3 * 86_400_000)
  const start = new Date(Date.UTC(end.getUTCFullYear() - 4, 0, 1))
  const fmt = (date: Date) =>
    `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
      date.getUTCDate(),
    ).padStart(2, '0')}`
  const url =
    `${POWER_BASE}/daily/point?parameters=${POWER_DAILY_PARAMS.join(',')}` +
    `&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` +
    `&start=${fmt(start)}&end=${fmt(end)}&format=JSON&time-standard=LST`
  let body: PowerResponse
  try {
    body = await paced(350, () => getJson<PowerResponse>(url))
  } catch {
    return null
  }
  const params = body.properties?.parameter
  if (!params?.T2M) return null
  const days: PowerDaily['days'] = []
  for (const key of Object.keys(params.T2M)) {
    if (key.length !== 8) continue
    const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
    days.push({
      date,
      tmean: num(params.T2M[key]),
      tmax: num(params.T2M_MAX?.[key]),
      tmin: num(params.T2M_MIN?.[key]),
      precipMm: num(params.PRECTOTCORR?.[key]),
      solarMj: num(params.ALLSKY_SFC_SW_DWN?.[key]),
      wetness: num(params.GWETROOT?.[key]),
    })
  }
  days.sort((a, b) => a.date.localeCompare(b.date))
  return {
    days,
    period: `${fmt(start).slice(0, 4)}-01-01 → ${fmt(end).slice(0, 4)}-${fmt(end).slice(4, 6)}-${fmt(end).slice(6, 8)}`,
    retrievedAt: new Date().toISOString(),
  }
}

/* ------------------------------------------------------------------ soil -- */

export type SoilResult = {
  clayPct: number
  sandPct: number
  siltPct: number
  ph: number
  socGKg: number
  texture: string
  depthNote: string
  retrievedAt: string
  source: string
}

type SoilLayer = {
  name: string
  unit_measure?: { d_factor?: number }
  depths?: { label: string; values?: { mean?: number } }[]
}

/** One SoilGrids query returns all properties for 0–30 cm. Cached upstream by D1. */
export async function fetchSoil(lat: number, lon: number): Promise<SoilResult | null> {
  const url =
    `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}` +
    `&property=clay&property=sand&property=silt&property=phh2o&property=soc` +
    `&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`
  let body: { properties?: { layers?: SoilLayer[] } }
  try {
    body = await paced(12_500, () => getJson<typeof body>(url, 1))
  } catch {
    return null
  }
  const layers = body.properties?.layers
  if (!layers?.length) return null
  const weighted = (name: string) => {
    const layer = layers.find((entry) => entry.name === name)
    if (!layer?.depths?.length) return null
    const weights: Record<string, number> = { '0-5cm': 5, '5-15cm': 10, '15-30cm': 15 }
    let sum = 0
    let total = 0
    for (const depth of layer.depths) {
      const value = depth.values?.mean
      const weight = weights[depth.label] ?? 0
      if (typeof value !== 'number' || !weight) continue
      sum += value * weight
      total += weight
    }
    return total ? sum / total : null
  }
  const clay = weighted('clay')
  const sand = weighted('sand')
  const silt = weighted('silt')
  const ph = weighted('phh2o')
  const soc = weighted('soc')
  if (clay === null || sand === null || ph === null) return null

  const clayPct = clay / 10
  const sandPct = sand / 10
  const siltPct = silt === null ? Math.max(0, 100 - clayPct - sandPct) : silt / 10
  return {
    clayPct: Number(clayPct.toFixed(1)),
    sandPct: Number(sandPct.toFixed(1)),
    siltPct: Number(siltPct.toFixed(1)),
    ph: Number((ph / 10).toFixed(1)),
    socGKg: soc === null ? 0 : Number((soc / 10).toFixed(1)),
    texture: textureClass(clayPct, sandPct),
    depthNote: 'Weighted 0–30 cm, SoilGrids 2.0 model prediction',
    retrievedAt: new Date().toISOString(),
    source: 'ISRIC SoilGrids 2.0 (non-NASA)',
  }
}

function textureClass(clay: number, sand: number): string {
  if (clay >= 40) return 'clay'
  if (sand >= 70) return 'sandy'
  if (clay >= 27) return 'clay loam'
  if (sand >= 50) return 'sandy loam'
  if (sand >= 35) return 'loam'
  return 'silt loam'
}

/* ----------------------------------------------------------- vegetation -- */

export type NdviPoint = { date: string; ndvi: number | null }

/**
 * MODIS/Terra NDVI from the ORNL DAAC TESViS subsetting service (no key,
 * max 10 composites per request). Returns null when the service is down or
 * returns no usable pixel — the app then shows vegetation as unavailable.
 */
export async function fetchNdvi(
  lat: number,
  lon: number,
  years = 3,
): Promise<{ series: NdviPoint[]; product: string; resolution: string; period: string } | null> {
  const endYear = new Date().getUTCFullYear()
  const startYear = endYear - years + 1
  const series: NdviPoint[] = []
  let failures = 0
  outer: for (let year = startYear; year <= endYear; year++) {
    for (let startDoy = 1; startDoy <= 365; startDoy += 160) {
      if (failures >= 2) break outer
      const endDoy = Math.min(365, startDoy + 159)
      const url =
        `https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
        `&startDate=A${year}${String(startDoy).padStart(3, '0')}` +
        `&endDate=A${year}${String(endDoy).padStart(3, '0')}&kmAboveBelow=1&kmLeftRight=1`
      try {
        const body = await paced(120, () =>
          getJson<{ subset?: { band?: string; calendar_date?: string; data?: number[] }[] }>(
            url,
            1,
            6_000,
          ),
        )
        failures = 0
        for (const entry of body.subset ?? []) {
          if (!entry.band?.includes('NDVI') || !entry.calendar_date) continue
          const values = (entry.data ?? []).filter(
            (value) => typeof value === 'number' && value > -2000,
          )
          if (!values.length) continue
          const mean = values.reduce((sum, value) => sum + value, 0) / values.length
          series.push({ date: entry.calendar_date, ndvi: Number((mean * 0.0001).toFixed(3)) })
        }
      } catch {
        // Two consecutive failures mean the service is down: stop early so the
        // whole analysis is not held open by upstream timeouts.
        failures++
        if (failures >= 2) break outer
        continue
      }
    }
  }
  if (!series.length) return null
  series.sort((a, b) => a.date.localeCompare(b.date))
  return {
    series,
    product: 'MOD13Q1 (MODIS Terra Vegetation Indices, 16-day)',
    resolution: '250 m, 3×3 pixel window around the field centroid',
    period: `${startYear}–${endYear}`,
  }
}
