import { DATASETS } from '../shared/datasets'
import type { Analysis, Farm, RecommendationSet, SourceRef } from '../shared/types'
import { ensureSchema, readCache, writeCache } from './db'
import { powerCell } from './geo'
import { buildIndicators, type MonthStats } from './indicators'
import { recommend } from './engine'
import {
  fetchNdvi,
  fetchPowerDaily,
  fetchPowerMonthly,
  fetchSoil,
  type NdviPoint,
  type PowerDaily,
  type PowerMonthly,
  type SoilResult,
} from './nasa'

export type StoredAnalysis = {
  analysis: Analysis
  recommendation: RecommendationSet
  monthStats: MonthStats[]
  precipCv: number | null
}

const DAY = 86_400_000
const TTL = {
  monthly: 30 * DAY,
  daily: 7 * DAY,
  soil: 90 * DAY,
  ndvi: 7 * DAY,
}

type Cached<T> = {
  value: T | null
  retrievedAt: string | null
  stale: boolean
}

async function withCache<T>(
  db: D1Database,
  key: string,
  ttl: number,
  fetcher: () => Promise<T | null>,
): Promise<Cached<T>> {
  const cached = await readCache<T>(db, key, ttl)
  if (cached && !cached.stale)
    return {
      value: cached.value,
      retrievedAt: new Date(cached.fetchedAt).toISOString(),
      stale: false,
    }
  let fresh: T | null = null
  try {
    fresh = await fetcher()
  } catch {
    fresh = null
  }
  if (fresh) {
    await writeCache(db, key, fresh).catch(() => undefined)
    return { value: fresh, retrievedAt: new Date().toISOString(), stale: false }
  }
  // Upstream failed: serve the last successful retrieval, clearly marked stale.
  if (cached)
    return {
      value: cached.value,
      retrievedAt: new Date(cached.fetchedAt).toISOString(),
      stale: true,
    }
  return { value: null, retrievedAt: null, stale: false }
}

const dataset = (id: string) => DATASETS.find((entry) => entry.id === id)!

function source(
  id: string,
  overrides: Partial<SourceRef> & { retrievedAt: string | null; status: SourceRef['status'] },
): SourceRef {
  const doc = dataset(id)
  const { retrievedAt, status, ...rest } = overrides
  return {
    dataset: doc.name,
    provider: doc.provider,
    product: doc.id === 'power' ? 'POWER Daily & Monthly API (MERRA-2, SYN1DEG)' : doc.name,
    variables: doc.variables,
    period: 'Not retrieved',
    resolution: doc.resolution,
    ...rest,
    retrievedAt: retrievedAt ?? new Date().toISOString(),
    status,
    sourceUrl: doc.sourceUrl,
  }
}

export async function analyzeFarm(
  db: D1Database,
  farm: Farm,
  ownerSub: string,
): Promise<StoredAnalysis> {
  await ensureSchema(db)
  const [lon, lat] = farm.centroid
  const cell = powerCell(lat, lon)
  const warnings: string[] = []

  const monthly = await withCache<PowerMonthly>(
    db,
    `power-monthly:v2:${cell}`,
    TTL.monthly,
    () => fetchPowerMonthly(lat, lon),
  )
  const daily = await withCache<PowerDaily>(
    db,
    `power-daily:v2:${cell}`,
    TTL.daily,
    () => fetchPowerDaily(lat, lon),
  )
  const soil = await withCache<SoilResult>(
    db,
    `soil:v1:${lat.toFixed(2)}:${lon.toFixed(2)}`,
    TTL.soil,
    () => fetchSoil(lat, lon),
  )
  const ndvi = await withCache<{
    series: NdviPoint[]
    product: string
    resolution: string
    period: string
  }>(
    db,
    `ndvi:v1:${lat.toFixed(2)}:${lon.toFixed(2)}`,
    TTL.ndvi,
    () => fetchNdvi(lat, lon),
  )

  if (monthly.stale)
    warnings.push(
      `NASA POWER monthly data could not be refreshed; showing the cached retrieval from ${new Date(monthly.retrievedAt!).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC.`,
    )
  if (!monthly.value)
    warnings.push(
      'NASA POWER monthly climatology was unavailable. Climate-dependent scores are shown as unavailable rather than estimated.',
    )
  if (daily.stale)
    warnings.push('NASA POWER daily data is a cached retrieval; recent extremes may be incomplete.')
  if (!daily.value)
    warnings.push('NASA POWER daily data was unavailable; heat, frost and dry-spell indicators are omitted.')
  if (!soil.value)
    warnings.push('ISRIC SoilGrids was unavailable; soil screening uses a neutral placeholder and confidence is lower.')
  if (!ndvi.value)
    warnings.push(
      'MODIS NDVI (ORNL DAAC TESViS) returned no usable data. The vegetation panel is shown as unavailable and no NDVI value is estimated.',
    )

  const vegetationSeries = ndvi.value?.series ?? null
  const indicators = buildIndicators({
    monthly: monthly.value,
    daily: daily.value,
    ndvi: vegetationSeries,
    soil: soil.value,
    lat,
  })

  const sources: SourceRef[] = [
    source('power', {
      status: monthly.value ? 'ok' : 'unavailable',
      retrievedAt: monthly.retrievedAt,
      period: monthly.value ? `${monthly.value.baselinePeriod} monthly; annual values to ${monthly.value.annual.at(-1)?.year ?? 'n/a'}` : 'Not retrieved',
      variables: ['T2M', 'T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'GWETROOT'],
      note: monthly.stale ? 'Cached retrieval — refresh failed.' : undefined,
    }),
  ]
  if (daily.value)
    sources.push(
      source('power', {
        status: 'ok',
        retrievedAt: daily.retrievedAt,
        product: 'POWER Daily API (MERRA-2)',
        variables: ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'GWETROOT'],
        period: daily.value.period,
        note: 'Daily extremes and dry spells.',
      }),
    )
  sources.push(
    source('modis', {
      status: ndvi.value ? 'ok' : 'unavailable',
      retrievedAt: ndvi.retrievedAt,
      period: ndvi.value?.period ?? 'Not retrieved',
      resolution: ndvi.value?.resolution ?? dataset('modis').resolution,
      variables: ['NDVI (QC-filtered, 16-day composite)'],
      note: ndvi.value ? undefined : 'Service returned no data during this retrieval.',
    }),
  )
  sources.push(
    source('gibs', {
      status: 'ok',
      retrievedAt: new Date().toISOString(),
      period: 'Dated imagery selected in the map',
      note: 'Visualisation only; not used in scoring.',
    }),
  )
  sources.push(
    source('soilgrids', {
      status: soil.value ? 'ok' : 'unavailable',
      retrievedAt: soil.retrievedAt,
      period: soil.value ? 'Static model product (no observation date)' : 'Not retrieved',
      variables: ['clay', 'sand', 'silt', 'pH', 'organic carbon'],
      note: soil.value?.depthNote,
    }),
  )
  sources.push(
    source('smap', {
      status: 'unavailable',
      retrievedAt: null,
      period: 'Not retrieved',
      note: 'Requires NASA Earthdata Login credentials that this deployment does not hold. No SMAP value is shown.',
    }),
  )

  const analysis: Analysis = {
    farmId: farm.id,
    retrievedAt: new Date().toISOString(),
    sources,
    climate: monthly.value
      ? {
          normals: monthly.value.normals,
          annual: monthly.value.annual,
          baselinePeriod: monthly.value.baselinePeriod,
        }
      : null,
    vegetation: ndvi.value
      ? {
          series: ndvi.value.series,
          product: ndvi.value.product,
          resolution: ndvi.value.resolution,
          landCover: null,
        }
      : null,
    soil: soil.value
      ? {
          clayPct: soil.value.clayPct,
          sandPct: soil.value.sandPct,
          siltPct: soil.value.siltPct,
          ph: soil.value.ph,
          socGKg: soil.value.socGKg,
          texture: soil.value.texture,
          depthNote: soil.value.depthNote,
        }
      : null,
    indicators: indicators.indicators,
    warnings,
  }

  const recommendation = recommend({
    farm,
    analysis,
    monthStats: indicators.monthStats,
    precipCv: indicators.precipCv,
  })

  const payload: StoredAnalysis = {
    analysis,
    recommendation,
    monthStats: indicators.monthStats,
    precipCv: indicators.precipCv,
  }
  await db
    .prepare(
      'INSERT INTO analyses (farm_id, owner_sub, payload, retrieved_at) VALUES (?, ?, ?, ?) ON CONFLICT(farm_id, owner_sub) DO UPDATE SET payload = excluded.payload, retrieved_at = excluded.retrieved_at',
    )
    .bind(farm.id, ownerSub, JSON.stringify(payload), Date.now())
    .run()
    .catch(() => undefined)

  return payload
}

export async function readAnalysis(
  db: D1Database,
  farmId: string,
  ownerSub: string,
): Promise<StoredAnalysis | null> {
  await ensureSchema(db)
  const row = await db
    .prepare('SELECT payload FROM analyses WHERE farm_id = ? AND owner_sub = ?')
    .bind(farmId, ownerSub)
    .first<{ payload: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.payload) as StoredAnalysis
  } catch {
    return null
  }
}
