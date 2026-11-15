export type LngLat = [number, number]

export type Irrigation = 'rainfed' | 'irrigated' | 'mixed'

export type FarmInput = {
  name: string
  /** Closed or open ring of [lng, lat] vertices, WGS84. */
  boundary: LngLat[]
  previousCrop?: string | null
  irrigation?: Irrigation
  country?: string | null
  notes?: string | null
}

export type Farm = {
  id: string
  name: string
  boundary: LngLat[]
  areaHa: number
  centroid: LngLat
  previousCrop: string | null
  irrigation: Irrigation
  country: string | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

export type Session = {
  user: { sub: string; name?: string; email?: string } | null
  mode: 'local' | 'freebuff' | 'setup'
  database: boolean
}

/** Provenance for every dataset surface, so the UI can never show a bare number. */
export type SourceRef = {
  dataset: string
  provider: string
  product: string
  variables: string[]
  period: string
  resolution: string
  retrievedAt: string | null
  status: 'ok' | 'unavailable'
  sourceUrl: string
  note?: string
}

export type MonthlyClimate = {
  month: number
  tmean: number | null
  tmax: number | null
  tmin: number | null
  precipMm: number | null
  solarMj: number | null
  soilWetness: number | null
}

export type AnnualClimate = {
  year: number
  precipMm: number
  tmean: number
  gdd: number
}

export type VegetationPoint = { date: string; ndvi: number | null }

export type Soil = {
  clayPct: number
  sandPct: number
  siltPct: number
  ph: number
  socGKg: number
  texture: string
  depthNote: string
}

export type Indicators = {
  normalPrecipMm: number | null
  last12PrecipMm: number | null
  precipAnomalyPct: number | null
  normalTmean: number | null
  last12Tmean: number | null
  tempAnomalyC: number | null
  gdd10: number | null
  frostFreeDays: number | null
  heatDays35: number | null
  frostDays: number | null
  maxDrySpellDays: number | null
  aridityIndex: number | null
  et0Mm: number | null
  precipPercentile: number | null
  precipTrendMmPerDecade: number | null
  tempTrendCPerDecade: number | null
  soilWetnessMean: number | null
  soilWetnessAnomaly: number | null
  ndviLatest: number | null
  ndviMean: number | null
  ndviAnomaly: number | null
}

export type Analysis = {
  farmId: string
  retrievedAt: string
  /** Time span actually covered by the retrieved observations, per dataset. */
  sources: SourceRef[]
  climate: {
    normals: MonthlyClimate[]
    annual: AnnualClimate[]
    baselinePeriod: string
  } | null
  vegetation: {
    series: VegetationPoint[]
    product: string
    resolution: string
    landCover: string | null
  } | null
  soil: Soil | null
  indicators: Indicators
  warnings: string[]
}

export type ScoreComponent = {
  key: string
  label: string
  score: number
  weight: number
  detail: string
}

export type CropCandidate = {
  cropId: string
  name: string
  family: string
  lifecycle: string
  score: number
  confidence: number
  role: 'primary' | 'alternative'
  components: ScoreComponent[]
  window: { startMonth: number; endMonth: number; label: string } | null
  waterDeficitMm: number | null
  et0SeasonMm: number | null
  effectiveRainMm: number | null
  gddSeason: number | null
  reasons: string[]
  caveats: string[]
}

export type RotationSeason = {
  index: number
  cropId: string
  cropName: string
  family: string
  waterDeficitMm: number | null
  nitrogenCreditKgHa: number
  note: string
}

export type RotationPlan = {
  id: string
  name: string
  seasons: RotationSeason[]
  score: number
  resilience: string
  notes: string[]
}

export type RecommendationSet = {
  farmId: string
  generatedAt: string
  crops: CropCandidate[]
  rotations: RotationPlan[]
  context: {
    previousCrop: string | null
    irrigation: Irrigation
    soilTexture: string | null
    climateZoneNote: string
  }
  limitations: string[]
}

export type AssistantAnswer = {
  answer: string
  mode: 'llm' | 'grounded'
  facts: { label: string; value: string; source: string }[]
  suggestions: string[]
  refusals: string[]
}

export type DatasetDoc = {
  id: string
  name: string
  provider: string
  purpose: string
  variables: string[]
  resolution: string
  cadence: string
  access: string
  limitations: string[]
  contribution: string
  status: 'verified' | 'credentialed' | 'degraded'
  sourceUrl: string
}

export type GeoResult = {
  label: string
  lng: number
  lat: number
  type: string
}
