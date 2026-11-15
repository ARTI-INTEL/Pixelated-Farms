import type { Indicators, MonthlyClimate } from '../shared/types'
import type { NdviPoint, PowerDaily, PowerMonthly, SoilResult } from './nasa'

export type MonthStats = {
  month: number
  heatDays: number
  frostDays: number
  /** Mean of daily maximum temperatures in this month, °C. */
  meanTmax: number | null
  /** Mean of daily minimum temperatures in this month, °C. */
  meanTmin: number | null
  /** Mean monthly total reference evapotranspiration, mm. */
  et0Mm: number
  precipMm: number | null
}

export type IndicatorBundle = {
  indicators: Indicators
  monthStats: MonthStats[]
  /** Annual precipitation coefficient of variation, used by the risk score. */
  precipCv: number | null
  monthlyEt0Total: number | null
}

const avg = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

const round = (value: number | null, digits = 1) =>
  value === null ? null : Number(value.toFixed(digits))

/** FAO-56 Hargreaves–Samani reference evapotranspiration, mm/day. */
export function hargreavesEt0(
  lat: number,
  doy: number,
  tmean: number,
  tmax: number,
  tmin: number,
): number {
  const phi = (lat * Math.PI) / 180
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365)
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39)
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
  const ra =
    ((24 * 60) / Math.PI) *
    0.082 *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  const td = Math.max(0, tmax - tmin)
  // Hargreaves–Samani expects extraterrestrial radiation in mm/day
  // equivalent, so MJ/m²/day is converted with the latent-heat factor 0.408.
  return Math.max(0, 0.0023 * (ra * 0.408) * (tmean + 17.8) * Math.sqrt(td))
}

/** Median of pairwise slopes (Sen's estimator), robust to outliers. */
export function sensSlope(points: { x: number; y: number }[]): number | null {
  if (points.length < 3) return null
  const slopes: number[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx)
    }
  }
  if (!slopes.length) return null
  slopes.sort((a, b) => a - b)
  const mid = Math.floor(slopes.length / 2)
  return slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2
}

function percentileRank(value: number, population: number[]): number | null {
  if (!population.length) return null
  const below = population.filter((entry) => entry <= value).length
  return Math.round((below / population.length) * 100)
}

const dayOfYear = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000,
  ) + 1
}

export function buildIndicators(input: {
  monthly: PowerMonthly | null
  daily: PowerDaily | null
  ndvi: NdviPoint[] | null
  soil: SoilResult | null
  lat: number
}): IndicatorBundle {
  const { monthly, daily, ndvi, lat } = input
  const normals: MonthlyClimate[] = monthly?.normals ?? []

  const monthStats: MonthStats[] = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const row = normals.find((entry) => entry.month === month)
    return {
      month,
      heatDays: 0,
      frostDays: 0,
      meanTmax: null,
      meanTmin: null,
      et0Mm: 0,
      precipMm: row?.precipMm ?? null,
    }
  })

  const indicators: Indicators = {
    normalPrecipMm: null,
    last12PrecipMm: null,
    precipAnomalyPct: null,
    normalTmean: null,
    last12Tmean: null,
    tempAnomalyC: null,
    gdd10: null,
    frostFreeDays: null,
    heatDays35: null,
    frostDays: null,
    maxDrySpellDays: null,
    aridityIndex: null,
    et0Mm: null,
    precipPercentile: null,
    precipTrendMmPerDecade: null,
    tempTrendCPerDecade: null,
    soilWetnessMean: null,
    soilWetnessAnomaly: null,
    ndviLatest: null,
    ndviMean: null,
    ndviAnomaly: null,
  }

  // ---- monthly product: 25-year means, rainfall, wetness, annual history ----
  const annualPrecip = (monthly?.annual ?? []).map((row) => row.precipMm)
  const annualTmean = (monthly?.annual ?? []).map((row) => row.tmean)
  indicators.normalPrecipMm = round(avg(annualPrecip), 0)
  indicators.normalTmean = round(avg(annualTmean), 1)
  if (monthly?.annual.length) {
    const last = monthly.annual[monthly.annual.length - 1]
    indicators.gdd10 = Math.round(
      avg(monthly.annual.slice(-5).map((row) => row.gdd)) ?? last.gdd,
    )
    const pSlope = sensSlope(monthly.annual.map((row) => ({ x: row.year, y: row.precipMm })))
    indicators.precipTrendMmPerDecade = round(pSlope === null ? null : pSlope * 10, 0)
    const tSlope = sensSlope(monthly.annual.map((row) => ({ x: row.year, y: row.tmean })))
    indicators.tempTrendCPerDecade = round(tSlope === null ? null : tSlope * 10, 2)
  }

  let precipCv: number | null = null
  if (annualPrecip.length >= 5) {
    const mean = avg(annualPrecip) ?? 0
    const variance = avg(annualPrecip.map((value) => (value - mean) ** 2)) ?? 0
    precipCv = mean > 0 ? Number((Math.sqrt(variance) / mean).toFixed(2)) : null
  }

  const monthlyWetness = normals
    .map((row) => row.soilWetness)
    .filter((value): value is number => value !== null)
  indicators.soilWetnessMean = round(avg(monthlyWetness), 2)

  // ---- daily record: means of extremes, ET0, heat/frost, dry spells ---------
  if (daily?.days.length) {
    const byYear = new Map<number, PowerDaily['days']>()
    for (const day of daily.days) {
      const year = Number(day.date.slice(0, 4))
      if (!byYear.has(year)) byYear.set(year, [])
      byYear.get(year)!.push(day)
    }
    const allYears = [...byYear.entries()]
    const complete = allYears.filter(([, days]) => days.length > 300)
    const years = complete.length ? complete : allYears

    const tmaxByMonth: number[][] = Array.from({ length: 12 }, () => [])
    const tminByMonth: number[][] = Array.from({ length: 12 }, () => [])
    const et0ByMonthYear: number[][] = Array.from({ length: 12 }, () => [])
    const heatByMonthYear: number[][] = Array.from({ length: 12 }, () => [])
    const frostByMonthYear: number[][] = Array.from({ length: 12 }, () => [])
    const heatAnnual: number[] = []
    const frostAnnual: number[] = []
    const drySpellAnnual: number[] = []
    const frostFreeAnnual: number[] = []
    const wetnessDaily: number[] = []

    for (const [, days] of years) {
      const tmaxMonth = Array.from({ length: 12 }, () => [] as number[])
      const tminMonth = Array.from({ length: 12 }, () => [] as number[])
      const et0Month = Array.from({ length: 12 }, () => 0)
      const heatMonth = Array.from({ length: 12 }, () => 0)
      const frostMonth = Array.from({ length: 12 }, () => 0)
      let heatCount = 0
      let frostCount = 0
      let run = 0
      let maxRun = 0
      let lastSpringFrost = -1
      let firstAutumnFrost = days.length

      days.forEach((day, index) => {
        const month = Number(day.date.slice(5, 7)) - 1
        if (day.tmax !== null) {
          tmaxMonth[month].push(day.tmax)
          if (day.tmax >= 35) {
            heatCount++
            heatMonth[month]++
          }
        }
        if (day.tmin !== null) {
          tminMonth[month].push(day.tmin)
          if (day.tmin <= 0) {
            frostCount++
            frostMonth[month]++
            if (index < days.length / 2) lastSpringFrost = Math.max(lastSpringFrost, index)
            else firstAutumnFrost = Math.min(firstAutumnFrost, index)
          }
        }
        if (day.tmean !== null && day.tmax !== null && day.tmin !== null)
          et0Month[month] += hargreavesEt0(
            lat,
            dayOfYear(day.date),
            day.tmean,
            day.tmax,
            day.tmin,
          )
        if (day.precipMm !== null && day.precipMm < 1) {
          run++
          maxRun = Math.max(maxRun, run)
        } else run = 0
        if (day.wetness !== null) wetnessDaily.push(day.wetness)
      })

      heatAnnual.push(heatCount)
      frostAnnual.push(frostCount)
      drySpellAnnual.push(maxRun)
      frostFreeAnnual.push(Math.max(0, firstAutumnFrost - lastSpringFrost))
      for (let month = 0; month < 12; month++) {
        tmaxByMonth[month].push(...tmaxMonth[month])
        tminByMonth[month].push(...tminMonth[month])
        et0ByMonthYear[month].push(et0Month[month])
        heatByMonthYear[month].push(heatMonth[month])
        frostByMonthYear[month].push(frostMonth[month])
      }
    }

    monthStats.forEach((row, index) => {
      row.meanTmax = round(avg(tmaxByMonth[index]), 1)
      row.meanTmin = round(avg(tminByMonth[index]), 1)
      row.et0Mm = Math.round(avg(et0ByMonthYear[index]) ?? 0)
      row.heatDays = Number((avg(heatByMonthYear[index]) ?? 0).toFixed(2))
      row.frostDays = Number((avg(frostByMonthYear[index]) ?? 0).toFixed(2))
      // Replace the monthly product's extremes in the chart data with genuine
      // means of daily maxima/minima. The monthly value is the monthly extreme.
      const normal = normals.find((entry) => entry.month === index + 1)
      if (normal) {
        normal.tmax = row.meanTmax
        normal.tmin = row.meanTmin
      }
    })

    const annualEt0 = monthStats.reduce((sum, row) => sum + row.et0Mm, 0)
    indicators.et0Mm = annualEt0 > 0 ? Math.round(annualEt0) : null
    indicators.heatDays35 = round(avg(heatAnnual), 0)
    indicators.frostDays = round(avg(frostAnnual), 0)
    indicators.maxDrySpellDays = round(avg(drySpellAnnual), 0)
    indicators.frostFreeDays = round(avg(frostFreeAnnual), 0)
    if (wetnessDaily.length) indicators.soilWetnessMean = round(avg(wetnessDaily), 2)

    const recent = daily.days.slice(-365)
    const last12Precip = recent.reduce((sum, day) => sum + (day.precipMm ?? 0), 0)
    const last12Temp = avg(
      recent.map((day) => day.tmean).filter((value): value is number => value !== null),
    )
    const prior = daily.days.slice(0, -365)
    const priorPerYear = prior.length
      ? (prior.reduce((sum, day) => sum + (day.precipMm ?? 0), 0) / prior.length) * 365
      : null
    indicators.last12PrecipMm = Math.round(last12Precip)
    if (priorPerYear && priorPerYear > 0)
      indicators.precipAnomalyPct = Math.round(
        ((last12Precip - priorPerYear) / priorPerYear) * 100,
      )
    indicators.last12Tmean = round(last12Temp, 1)
    if (last12Temp !== null && indicators.normalTmean !== null)
      indicators.tempAnomalyC = Number((last12Temp - indicators.normalTmean).toFixed(1))

    const recentWetness = avg(
      recent.map((day) => day.wetness).filter((value): value is number => value !== null),
    )
    if (recentWetness !== null && indicators.soilWetnessMean !== null)
      indicators.soilWetnessAnomaly = Number(
        (recentWetness - indicators.soilWetnessMean).toFixed(2),
      )

    if (daily.days.length > 800) {
      const windows: number[] = []
      for (let start = 0; start + 365 <= daily.days.length; start += 30) {
        let total = 0
        for (let offset = 0; offset < 365; offset++)
          total += daily.days[start + offset].precipMm ?? 0
        windows.push(total)
      }
      indicators.precipPercentile = percentileRank(last12Precip, windows)
    }
  }

  if (
    indicators.aridityIndex === null &&
    indicators.et0Mm &&
    indicators.normalPrecipMm !== null
  )
    indicators.aridityIndex = Number(
      (indicators.normalPrecipMm / indicators.et0Mm).toFixed(2),
    )

  // ---- vegetation ---------------------------------------------------------
  const ndviValues =
    ndvi?.filter(
      (point): point is { date: string; ndvi: number } => point.ndvi !== null,
    ) ?? []
  if (ndviValues.length) {
    indicators.ndviMean = round(avg(ndviValues.map((point) => point.ndvi)), 2)
    indicators.ndviLatest = ndviValues[ndviValues.length - 1].ndvi
    const latestYear = ndviValues[ndviValues.length - 1].date.slice(0, 4)
    const recentMean = avg(
      ndviValues.filter((point) => point.date.slice(0, 4) === latestYear).map((point) => point.ndvi),
    )
    const earlierMean = avg(
      ndviValues.filter((point) => point.date.slice(0, 4) !== latestYear).map((point) => point.ndvi),
    )
    if (recentMean !== null && earlierMean !== null)
      indicators.ndviAnomaly = round(recentMean - earlierMean, 3)
  }

  return {
    indicators,
    monthStats,
    precipCv,
    monthlyEt0Total: indicators.et0Mm,
  }
}

/** Seasonal aggregation over a planting window, used by the crop engine. */
export function seasonAggregate(
  monthStats: MonthStats[],
  startMonth: number,
  seasonDays: number,
  gddBase = 10,
) {
  const daysPerMonth = monthStats.map((_, index) =>
    new Date(Date.UTC(2001, index + 1, 0)).getUTCDate(),
  )
  let remaining = seasonDays
  let month = startMonth - 1
  let et0 = 0
  let rain = 0
  let gdd = 0
  let heatDays = 0
  let frostDays = 0
  let tmeanWeighted = 0
  let weight = 0
  let tmaxMax = -Infinity
  let tminMin = Infinity
  let guard = 0
  while (remaining > 0 && guard++ < 24) {
    const index = month % 12
    const stats = monthStats[index]
    const fraction = Math.min(1, remaining / daysPerMonth[index])
    const days = fraction * daysPerMonth[index]
    et0 += stats.et0Mm * fraction
    rain += (stats.precipMm ?? 0) * fraction
    heatDays += stats.heatDays * fraction
    frostDays += stats.frostDays * fraction
    if (stats.meanTmax !== null) tmaxMax = Math.max(tmaxMax, stats.meanTmax)
    if (stats.meanTmin !== null) tminMin = Math.min(tminMin, stats.meanTmin)
    if (stats.meanTmax !== null && stats.meanTmin !== null) {
      const mean = (stats.meanTmax + stats.meanTmin) / 2
      gdd += Math.max(0, mean - gddBase) * days
      tmeanWeighted += mean * days
      weight += days
    }
    remaining -= days
    month++
  }
  return {
    et0: Number(et0.toFixed(0)),
    rain: Number(rain.toFixed(0)),
    gdd: Math.round(gdd),
    heatDays: Number(heatDays.toFixed(1)),
    frostDays: Number(frostDays.toFixed(1)),
    tmean: weight ? tmeanWeighted / weight : null,
    tmaxMax: tmaxMax === -Infinity ? null : tmaxMax,
    tminMin: tminMin === Infinity ? null : tminMin,
  }
}
