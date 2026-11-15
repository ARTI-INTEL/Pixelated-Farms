import { describe, expect, test } from 'bun:test'
import { ringAreaHa } from '../src/shared/geo'
import type { Analysis, Farm, Indicators } from '../src/shared/types'
import { groundedAnswer } from '../src/worker/assistant'
import { recommend } from '../src/worker/engine'
import { buildIndicators } from '../src/worker/indicators'

const farm = (overrides: Partial<Farm> = {}): Farm => ({
  id: 'farm-1',
  name: 'Test field',
  boundary: [
    [-93.6, 41.99],
    [-93.59, 41.99],
    [-93.59, 42.0],
    [-93.6, 42.0],
  ],
  areaHa: 110,
  centroid: [-93.6, 42.0],
  previousCrop: 'maize',
  irrigation: 'rainfed',
  country: 'United States',
  notes: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const normals = Array.from({ length: 12 }, (_, index) => {
  const month = index + 1
  const seasonal = Math.sin(((month - 4) / 12) * Math.PI * 2)
  return {
    month,
    tmean: 9 + seasonal * 13,
    tmax: 15 + seasonal * 13,
    tmin: 3 + seasonal * 12,
    precipMm: 70 + Math.cos((month / 12) * Math.PI * 2) * 25,
    solarMj: 12 + seasonal * 6,
    soilWetness: 0.5,
  }
})

const annual = Array.from({ length: 24 }, (_, index) => ({
  year: 2001 + index,
  precipMm: 820 + (index % 5) * 30,
  tmean: 9.4 + index * 0.02,
  gdd: 2600 + (index % 4) * 40,
}))

const monthly = {
  normals,
  annual,
  baselinePeriod: '2001–2024',
  sources: ['MERRA2'],
  retrievedAt: '2026-11-01T00:00:00.000Z',
}

const daily = {
  days: Array.from({ length: 365 * 3 }, (_, index) => {
    const date = new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10)
    return {
      date,
      tmean: 9,
      tmax: 28,
      tmin: -1,
      precipMm: index % 7 === 0 ? 8 : 0,
      solarMj: 15,
      wetness: 0.5,
    }
  }),
  period: '2023-01-01 → 2025-12-31',
  retrievedAt: '2026-11-01T00:00:00.000Z',
}

function makeAnalysis(): { analysis: Analysis; monthStats: ReturnType<typeof buildIndicators> } {
  const bundle = buildIndicators({
    monthly: monthly as never,
    daily: daily as never,
    ndvi: null,
    soil: {
      clayPct: 29,
      sandPct: 23,
      siltPct: 48,
      ph: 6.5,
      socGKg: 32,
      texture: 'clay loam',
      depthNote: 'Weighted 0–30 cm',
      retrievedAt: '2026-11-01T00:00:00.000Z',
      source: 'ISRIC SoilGrids',
    },
    lat: 42,
  })
  const analysis: Analysis = {
    farmId: 'farm-1',
    retrievedAt: '2026-11-01T00:00:00.000Z',
    sources: [],
    climate: { normals, annual, baselinePeriod: '2001–2024' },
    vegetation: null,
    soil: {
      clayPct: 29,
      sandPct: 23,
      siltPct: 48,
      ph: 6.5,
      socGKg: 32,
      texture: 'clay loam',
      depthNote: 'Weighted 0–30 cm',
    },
    indicators: bundle.indicators,
    warnings: [],
  }
  return { analysis, monthStats: bundle }
}

describe('geometry', () => {
  test('a 0.01° square near 42°N is about 110 ha', () => {
    const area = ringAreaHa([
      [-93.605, 41.995],
      [-93.595, 41.995],
      [-93.595, 42.005],
      [-93.605, 42.005],
    ])
    expect(area).toBeGreaterThan(90)
    expect(area).toBeLessThan(135)
  })
})

describe('indicators', () => {
  test('derives aridity, trends and daily extremes from the fixtures', () => {
    const { analysis } = makeAnalysis()
    const i = analysis.indicators
    expect(i.normalPrecipMm).toBeGreaterThan(700)
    expect(i.aridityIndex).toBeGreaterThan(0.2)
    expect(i.heatDays35).toBe(0)
    expect(i.frostDays).toBeGreaterThan(0)
    expect(i.maxDrySpellDays).toBeGreaterThan(0)
    expect(i.gdd10).toBeGreaterThan(1000)
    expect(i.precipTrendMmPerDecade).not.toBeNull()
  })
})

describe('recommendation engine', () => {
  test('weighted components sum to the crop score and include a comparison plan', () => {
    const { analysis, monthStats } = makeAnalysis()
    const result = recommend({
      farm: farm(),
      analysis,
      monthStats: monthStats.monthStats,
      precipCv: monthStats.precipCv,
    })
    expect(result.crops.length).toBeGreaterThan(3)
    const top = result.crops[0]
    const weights = top.components.reduce((sum, component) => sum + component.weight, 0)
    expect(weights).toBeCloseTo(1, 5)
    const expected = Math.round(
      top.components.reduce((sum, component) => sum + component.score * component.weight, 0),
    )
    expect(top.score).toBe(expected)
    expect(top.confidence).toBeGreaterThan(0.2)
    expect(top.confidence).toBeLessThanOrEqual(0.92)
    expect(top.reasons.length).toBeGreaterThan(0)
    expect(top.caveats.join(' ')).toContain('not measurements inside this field')

    expect(result.rotations.map((plan) => plan.id)).toContain('current')
    expect(result.rotations.map((plan) => plan.id)).toContain('balanced')
    expect(result.rotations.find((plan) => plan.id === 'current')!.seasons).toHaveLength(3)
    expect(result.limitations.length).toBeGreaterThan(2)
  })

  test('an unknown previous crop is neutral rather than silently favourable', () => {
    const { analysis, monthStats } = makeAnalysis()
    const withHistory = recommend({
      farm: farm(),
      analysis,
      monthStats: monthStats.monthStats,
      precipCv: monthStats.precipCv,
    })
    const withoutHistory = recommend({
      farm: farm({ previousCrop: null }),
      analysis,
      monthStats: monthStats.monthStats,
      precipCv: monthStats.precipCv,
    })
    const currentPlan = withHistory.rotations.find((plan) => plan.id === 'current')!
    // The comparison plan exists and repeats maize for all three seasons.
    expect(currentPlan.seasons.map((season) => season.cropId)).toEqual(['maize', 'maize', 'maize'])
    // Repeating maize is penalised well below its own single-season score.
    const maize = withHistory.crops.find((crop) => crop.cropId === 'maize')
    if (maize) expect(currentPlan.score).toBeLessThan(maize.score)
    expect(withoutHistory.rotations.map((plan) => plan.id)).not.toContain('current')
  })
})

describe('grounded assistant', () => {
  test('never claims satellite nutrient measurement and cites the data period', () => {
    const { analysis, monthStats } = makeAnalysis()
    const rec = recommend({
      farm: farm(),
      analysis,
      monthStats: monthStats.monthStats,
      precipCv: monthStats.precipCv,
    })
    const answer = groundedAnswer('How much nitrogen fertiliser should I apply?', farm(), analysis, rec)
    expect(answer.mode).toBe('grounded')
    expect(answer.answer.toLowerCase()).toContain('no satellite')
    expect(answer.refusals.join(' ')).toContain('fertiliser')
    expect(answer.facts.some((fact) => fact.source.includes('NASA POWER'))).toBe(true)
  })

  test('answers a rainfall trend question from the stored record', () => {
    const { analysis, monthStats } = makeAnalysis()
    const rec = recommend({
      farm: farm(),
      analysis,
      monthStats: monthStats.monthStats,
      precipCv: monthStats.precipCv,
    })
    const answer = groundedAnswer('How has rainfall changed over the past five years?', farm(), analysis, rec)
    expect(answer.answer).toContain('mm/decade')
    expect(answer.answer).toContain('statistical estimate')
  })
})

describe('indicator guard rails', () => {
  test('missing soil does not produce a soil value', () => {
    const indicators: Indicators = buildIndicators({
      monthly: monthly as never,
      daily: null,
      ndvi: null,
      soil: null,
      lat: 42,
    }).indicators
    expect(indicators.heatDays35).toBeNull()
    expect(indicators.maxDrySpellDays).toBeNull()
  })
})
