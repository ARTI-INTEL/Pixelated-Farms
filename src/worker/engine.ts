import { CROPS, cropById, type CropProfile } from '../shared/crops'
import type {
  Analysis,
  CropCandidate,
  Farm,
  Indicators,
  Irrigation,
  RecommendationSet,
  RotationPlan,
  RotationSeason,
  ScoreComponent,
} from '../shared/types'
import { seasonAggregate, type MonthStats } from './indicators'

type EngineInput = {
  farm: Farm
  analysis: Analysis
  monthStats: MonthStats[]
  precipCv: number | null
}

const WEIGHTS = {
  thermal: 0.22,
  water: 0.24,
  season: 0.11,
  soil: 0.13,
  rotation: 0.18,
  risk: 0.12,
} as const

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const pct = (value: number) => Math.round(clamp(value) * 100)

/** Trapezoid membership: 0 below floor, 1 inside the optimal plateau, 0 above ceiling. */
function trapezoid(value: number, floor: number, low: number, high: number, ceiling: number) {
  if (value <= floor || value >= ceiling) return 0
  if (value < low) return (value - floor) / (low - floor)
  if (value <= high) return 1
  return (ceiling - value) / (ceiling - high)
}

function soilTextureScore(crop: CropProfile, texture: string | null): number {
  if (!texture) return 0.55
  const scores: Record<string, [number, number, number]> = {
    // [well-drained crops, moderate, poor/intermediate drainage crops]
    sandy: [0.8, 0.55, 0.25],
    'sandy loam': [0.95, 0.7, 0.35],
    loam: [0.95, 0.9, 0.5],
    'silt loam': [0.75, 0.95, 0.75],
    'clay loam': [0.6, 0.9, 0.85],
    clay: [0.3, 0.6, 0.95],
  }
  const row = scores[texture] ?? [0.7, 0.7, 0.6]
  return crop.drainage === 'well' ? row[0] : crop.drainage === 'moderate' ? row[1] : row[2]
}

function phScore(crop: CropProfile, ph: number | null): number {
  if (ph === null) return 0.55
  if (ph >= crop.phRange[0] && ph <= crop.phRange[1]) return 1
  const distance =
    ph < crop.phRange[0] ? crop.phRange[0] - ph : ph - crop.phRange[1]
  return distance <= 0.5 ? 0.6 : distance <= 1.2 ? 0.3 : 0.08
}

function rotationScore(crop: CropProfile, previousId: string | null): { score: number; detail: string } {
  if (!previousId)
    return {
      score: 0.6,
      detail:
        'No previous crop supplied, so the rotation score is neutral. Adding it sharpens the recommendation.',
    }
  const previous = cropById(previousId)
  if (!previous)
    return { score: 0.6, detail: 'Previous crop was not recognised; rotation score is neutral.' }
  if (previous.id === crop.id)
    return {
      score: 0.08,
      detail: `Repeating ${previous.name} back-to-back concentrates the same root diseases, weeds and nutrient demand.`,
    }
  if (previous.family === crop.family)
    return {
      score: 0.2,
      detail: `Both crops are ${crop.family}s, so the rotation keeps the same disease and pest cycle.`,
    }
  if (previous.nFixer)
    return {
      score: 0.88,
      detail: `${previous.name} is a legume and leaves roughly ${previous.nCreditKgHa} kg N/ha plus a different rooting depth.`,
    }
  if (crop.nFixer && previous.family === 'cereal')
    return {
      score: 0.92,
      detail: `A legume after ${previous.name} uses the cereal break and returns nitrogen instead of depleting it.`,
    }
  return {
    score: 0.72,
    detail: `${previous.name} (${previous.family}) to ${crop.name} (${crop.family}) changes family, root depth and residue.`,
  }
}

function riskProfile(
  indicators: Indicators,
  precipCv: number | null,
  irrigation: Irrigation,
) {
  const heat = clamp(((indicators.heatDays35 ?? 8) - 8) / 45)
  const variability = clamp(((precipCv ?? 0.2) - 0.12) / 0.4)
  const drying = clamp(-(indicators.precipTrendMmPerDecade ?? 0) / 60)
  const aridity = clamp((1.45 - (indicators.aridityIndex ?? 0.9)) / 0.9)
  const exposure = irrigation === 'irrigated' ? aridity * 0.35 : aridity
  const risk = 0.3 * heat + 0.28 * variability + 0.2 * drying + 0.22 * exposure
  const detail =
    `Heat days ≥35 °C: ${Math.round(indicators.heatDays35 ?? 0)}/yr · ` +
    `rainfall variability CV ${precipCv === null ? 'n/a' : precipCv.toFixed(2)} · ` +
    `precip trend ${indicators.precipTrendMmPerDecade ?? 0} mm/decade · ` +
    `aridity index ${indicators.aridityIndex ?? 'n/a'}`
  return { score: clamp(1 - risk), detail }
}

function monthName(month: number) {
  return new Date(Date.UTC(2024, month - 1, 1)).toLocaleString('en', {
    month: 'short',
    timeZone: 'UTC',
  })
}

function evaluateCrop(
  crop: CropProfile,
  input: EngineInput,
): CropCandidate {
  const { farm, analysis, monthStats } = input
  const climateOk = Boolean(analysis.climate)
  let best:
    | {
        month: number
        aggregate: ReturnType<typeof seasonAggregate>
        thermal: number
        water: number
        season: number
      }
    | null = null

  if (climateOk) {
    for (let startMonth = 1; startMonth <= 12; startMonth++) {
      const aggregate = seasonAggregate(
        monthStats,
        startMonth,
        crop.seasonDays,
        crop.gddBase,
      )
      const tmean = aggregate.tmean ?? 0
      const tempFit = trapezoid(
        tmean,
        crop.tempRange[0] - 5,
        crop.tempRange[0],
        crop.tempRange[1],
        crop.tempRange[1] + 7,
      )
      const heatFit = clamp(1 - aggregate.heatDays / Math.max(18, crop.seasonDays * 0.25))
      const frostFit = crop.frostSensitive
        ? clamp(1 - aggregate.frostDays / 8)
        : clamp(1 - aggregate.frostDays / 25)
      const thermal = clamp(0.55 * tempFit + 0.25 * heatFit + 0.2 * frostFit)

      const etc = aggregate.et0 * crop.kcMid
      const effectiveRain = aggregate.rain * 0.75
      const rawDeficit = Math.max(0, etc - effectiveRain)
      const residual =
        farm.irrigation === 'irrigated'
          ? rawDeficit * 0.25
          : farm.irrigation === 'mixed'
            ? rawDeficit * 0.6
            : rawDeficit
      const supply = crop.waterReqMm[1]
      // Without a reference ET0 there is no water balance to judge: stay neutral
      // rather than awarding a perfect score to an unmeasured season.
      let water =
        aggregate.et0 > 0 ? clamp(1 - residual / (supply * 0.9)) : 0.5
      // Waterlogging penalty where drainage is limited and rainfall is high.
      if (crop.drainage !== 'poor' && effectiveRain > etc * 1.5) water *= 0.75

      const ratio = aggregate.gdd / crop.gddMaturity
      const season =
        ratio >= 0.95 && ratio <= 1.25
          ? 1
          : ratio < 0.95
            ? clamp(ratio / 0.95)
            : clamp(1 - (ratio - 1.25) * 0.5, 0.35, 1)

      if (!best || thermal + water + season > best.thermal + best.water + best.season)
        best = { month: startMonth, aggregate, thermal, water, season }
    }
  }

  const components: ScoreComponent[] = []
  const reasons: string[] = []
  const caveats: string[] = []

  if (best) {
    const { aggregate } = best
    const etc = aggregate.et0 * crop.kcMid
    const effectiveRain = aggregate.rain * 0.75
    components.push({
      key: 'thermal',
      label: 'Temperature & heat',
      score: pct(best.thermal),
      weight: WEIGHTS.thermal,
      detail:
        `Season mean ${aggregate.tmean?.toFixed(1) ?? 'n/a'} °C against a ${crop.tempRange[0]}–${crop.tempRange[1]} °C ` +
        `preferred range; ${aggregate.heatDays.toFixed(0)} days above ${crop.heatLimit} °C in the window; ` +
        `frost exposure ${aggregate.frostDays.toFixed(1)} days.`,
    })
    components.push({
      key: 'water',
      label: 'Seasonal water balance',
      score: pct(best.water),
      weight: WEIGHTS.water,
      detail:
        aggregate.et0 > 0
          ? `Estimated crop ET ${Math.round(etc)} mm vs ${Math.round(effectiveRain)} mm effective rainfall ` +
            `(75% of ${Math.round(aggregate.rain)} mm). Deficit ${Math.round(Math.max(0, etc - effectiveRain))} mm, ` +
            `management: ${farm.irrigation}.`
          : 'Reference ET₀ is unavailable because the daily POWER record could not be retrieved, so the water balance is a neutral placeholder.',
    })
    components.push({
      key: 'season',
      label: 'Season length',
      score: pct(best.season),
      weight: WEIGHTS.season,
      detail: `Window accumulates ${aggregate.gdd} GDD (base ${crop.gddBase} °C) against a ${crop.gddMaturity} GDD requirement for ${crop.seasonDays} days.`,
    })
    reasons.push(
      `Best planting window ${monthName(best.month)}–${monthName(((best.month + Math.round(crop.seasonDays / 30) - 2) % 12) + 1)} from monthly 2001–2025 normals.`,
    )
    if (best.water < 0.55)
      caveats.push(
        farm.irrigation === 'rainfed'
          ? `Rainfed water deficit of about ${Math.round(Math.max(0, etc - effectiveRain))} mm; irrigation or a lower-demand crop would change the ranking.`
          : `Water deficit of about ${Math.round(Math.max(0, etc - effectiveRain))} mm still needs to be met by irrigation.`,
      )
    if (best.thermal < 0.55)
      caveats.push('Temperature or heat exposure is marginal for this crop in the modelled climate.')
  } else {
    for (const key of ['thermal', 'water', 'season'] as const)
      components.push({
        key,
        label:
          key === 'thermal'
            ? 'Temperature & heat'
            : key === 'water'
              ? 'Seasonal water balance'
              : 'Season length',
        score: 0,
        weight: WEIGHTS[key],
        detail: 'Climate data unavailable for this field, so this component cannot be scored.',
      })
  }

  const ph = analysis.soil?.ph ?? null
  const texture = analysis.soil?.texture ?? null
  const soilComponent = clamp(0.6 * phScore(crop, ph) + 0.4 * soilTextureScore(crop, texture))
  components.push({
    key: 'soil',
    label: 'Soil screening',
    score: pct(soilComponent),
    weight: WEIGHTS.soil,
    detail: analysis.soil
      ? `pH ${analysis.soil.ph} against ${crop.phRange[0]}–${crop.phRange[1]}; ${texture} texture against ${crop.drainage} drainage preference; organic carbon ${analysis.soil.socGKg} g/kg. Model prediction (SoilGrids), not a soil test.`
      : 'No soil data available; this component is a neutral placeholder and should be replaced with a soil test.',
  })
  if (!analysis.soil)
    caveats.push('No soil test or SoilGrids value: soil suitability is a neutral placeholder.')

  const rotation = rotationScore(crop, farm.previousCrop)
  components.push({
    key: 'rotation',
    label: 'Rotation fit',
    score: pct(rotation.score),
    weight: WEIGHTS.rotation,
    detail: rotation.detail,
  })
  reasons.push(rotation.detail)

  const risk = riskProfile(analysis.indicators, input.precipCv, farm.irrigation)
  components.push({
    key: 'risk',
    label: 'Climate risk',
    score: pct(risk.score),
    weight: WEIGHTS.risk,
    detail: risk.detail,
  })

  const score = Math.round(
    components.reduce((sum, component) => sum + component.score * component.weight, 0),
  )

  let confidence = 0.3
  if (analysis.climate) confidence += 0.3
  if (analysis.indicators.heatDays35 !== null) confidence += 0.1
  if (analysis.soil) confidence += 0.2
  if (analysis.vegetation) confidence += 0.1
  if (farm.previousCrop) confidence += 0.05

  if (!analysis.vegetation)
    caveats.push('Vegetation-index data was unavailable for this retrieval, so NDVI is not part of the score.')
  caveats.push(
    `Crop parameters are FAO-56 / ECOCROP reference ranges (${crop.kcMid} Kc, ${crop.rootDepthCm} cm roots), not local variety trials.`,
  )
  caveats.push('Climate inputs are a ~50 km modelled grid cell, not measurements inside this field.')

  return {
    cropId: crop.id,
    name: crop.name,
    family: crop.family,
    lifecycle: crop.lifecycle,
    score,
    confidence: Number(clamp(confidence, 0.2, 0.92).toFixed(2)),
    role: 'alternative',
    components,
    window: best
      ? {
          startMonth: best.month,
          endMonth: ((best.month + Math.round(crop.seasonDays / 30) - 2) % 12) + 1,
          label: `${monthName(best.month)} – ${monthName(((best.month + Math.round(crop.seasonDays / 30) - 2) % 12) + 1)}`,
        }
      : null,
    waterDeficitMm: best
      ? Math.round(Math.max(0, best.aggregate.et0 * crop.kcMid - best.aggregate.rain * 0.75))
      : null,
    et0SeasonMm: best ? Math.round(best.aggregate.et0 * crop.kcMid) : null,
    effectiveRainMm: best ? Math.round(best.aggregate.rain * 0.75) : null,
    gddSeason: best ? best.aggregate.gdd : null,
    reasons,
    caveats,
  }
}

function buildRotations(
  crops: CropCandidate[],
  farm: Farm,
): RotationPlan[] {
  const ranked = [...crops].sort((a, b) => b.score - a.score)
  const plans: RotationPlan[] = []
  const byId = (id: string) => cropById(id)!

  const seasonFrom = (candidate: CropCandidate, index: number, note: string): RotationSeason => {
    const crop = byId(candidate.cropId)
    return {
      index,
      cropId: crop.id,
      cropName: crop.name,
      family: crop.family,
      waterDeficitMm: candidate.waterDeficitMm,
      nitrogenCreditKgHa: crop.nFixer ? crop.nCreditKgHa : 0,
      note,
    }
  }

  const pick = (
    exclude: Set<string>,
    predicate: (candidate: CropCandidate) => boolean,
  ): CropCandidate | undefined =>
    ranked.find((candidate) => !exclude.has(candidate.cropId) && predicate(candidate))

  // Balanced rotation: best crop, then a different family, then a legume.
  const balanced = [ranked[0]]
  if (ranked[0]) {
    const used = new Set(balanced.map((entry) => entry.cropId))
    const second = pick(
      used,
      (candidate) =>
        byId(candidate.cropId).family !== byId(ranked[0].cropId).family &&
        candidate.score >= ranked[0].score - 25,
    )
    if (second) balanced.push(second)
    const used2 = new Set(balanced.map((entry) => entry.cropId))
    const third = pick(used2, (candidate) => byId(candidate.cropId).nFixer)
    if (third) balanced.push(third)
  }
  if (balanced.length >= 2)
    plans.push({
      id: 'balanced',
      name: 'Balanced rotation',
      score: Math.round(
        balanced.reduce((sum, entry) => sum + entry.score, 0) / balanced.length,
      ),
      resilience: 'Spread of crop families reduces disease and nutrient pressure.',
      seasons: balanced.map((candidate, index) =>
        seasonFrom(
          candidate,
          index + 1,
          index === 0
            ? 'Highest-scoring entry crop for the modelled climate and soil.'
            : byId(candidate.cropId).nFixer
              ? `Legume phase returns about ${byId(candidate.cropId).nCreditKgHa} kg N/ha before the next cereal.`
              : 'Changes crop family and rooting depth to interrupt pest and disease cycles.',
        ),
      ),
      notes: [
        'Ranking uses the current climate and soil evidence only; market price and contracts are not modelled.',
      ],
    })

  // Soil-first: legume, cereal, break crop.
  const legume = pick(new Set(), (candidate) => byId(candidate.cropId).nFixer)
  const cereal = pick(new Set(legume ? [legume.cropId] : []), (candidate) => byId(candidate.cropId).family === 'cereal')
  const third = pick(
    new Set([legume?.cropId, cereal?.cropId].filter(Boolean) as string[]),
    (candidate) => candidate.score > 35,
  )
  if (legume && cereal) {
    const sequence = [legume, cereal, third].filter(Boolean) as CropCandidate[]
    plans.push({
      id: 'soil-first',
      name: 'Soil-building sequence',
      score: Math.round(sequence.reduce((sum, entry) => sum + entry.score, 0) / sequence.length),
      resilience: 'Nitrogen fixation first, then a cereal that uses the residual nitrogen.',
      seasons: sequence.map((candidate, index) =>
        seasonFrom(
          candidate,
          index + 1,
          index === 0
            ? `Legume establishes first and fixes roughly ${byId(candidate.cropId).nCreditKgHa} kg N/ha.`
            : index === 1
              ? 'Cereal follows the legume break, using residual nitrogen and a different disease cycle.'
              : 'Diversifies the sequence further; choose by water availability and market.',
        ),
      ),
      notes: [
        'Nitrogen credits are reference values; confirm with a soil test before reducing fertiliser.',
      ],
    })
  }

  // Water-resilient: lowest deficits across distinct families.
  const lowWater = [...ranked]
    .filter((candidate) => candidate.waterDeficitMm !== null)
    .sort((a, b) => (a.waterDeficitMm ?? 0) - (b.waterDeficitMm ?? 0))
  const chosen: CropCandidate[] = []
  for (const candidate of lowWater) {
    if (chosen.length >= 3) break
    if (chosen.some((entry) => byId(entry.cropId).family === byId(candidate.cropId).family)) continue
    chosen.push(candidate)
  }
  if (chosen.length >= 2)
    plans.push({
      id: 'water-resilient',
      name: 'Water-resilient sequence',
      score: Math.round(chosen.reduce((sum, entry) => sum + entry.score, 0) / chosen.length),
      resilience: 'Lowest seasonal irrigation deficits among distinct crop families.',
      seasons: chosen.map((candidate, index) =>
        seasonFrom(
          candidate,
          index + 1,
          candidate.waterDeficitMm !== null
            ? `Estimated deficit ${candidate.waterDeficitMm} mm for the season.`
            : 'Water balance unavailable for this crop.',
        ),
      ),
      notes: ['Deficits are atmospheric demand minus effective rainfall, not measured soil water.'],
    })

  // Current practice, for comparison.
  if (farm.previousCrop) {
    const crop = byId(farm.previousCrop)
    const same = ranked.find((candidate) => candidate.cropId === farm.previousCrop)
    if (crop && same)
      plans.push({
        id: 'current',
        name: `Continue ${crop.name}`,
        score: Math.round(same.score * 0.55),
        resilience: 'Same crop each season: highest disease, weed and nutrient-depletion exposure.',
        seasons: [1, 2, 3].map((index) =>
          seasonFrom(
            same,
            index,
            index === 1
              ? 'Current practice retained for comparison.'
              : `Repeated ${crop.name}: same family, same root zone, same disease cycle.`,
          ),
        ),
        notes: [
          'Included as a baseline comparison, not a recommendation.',
          'Monoculture scoring is a deliberate penalty, not an agronomic prediction of yield loss.',
        ],
      })
  }

  return plans
}

export function recommend(input: EngineInput): RecommendationSet {
  const { farm, analysis } = input
  const evaluated = CROPS.map((crop) => evaluateCrop(crop, input)).sort(
    (a, b) => b.score - a.score,
  )
  const crops = evaluated.slice(0, 8).map((candidate, index) => ({
    ...candidate,
    role: index < 3 ? ('primary' as const) : ('alternative' as const),
  }))
  const rotations = buildRotations(evaluated, farm)
  const limitations = [
    'Scores rank agronomic suitability for the modelled climate, soil and rotation context. They are not yield forecasts or profit estimates.',
    'NASA POWER values describe a ~50 km grid cell; MODIS NDVI describes 250 m pixels. Neither measures inside-field soil nutrients.',
    'Satellite observations cannot measure soil nitrogen, phosphorus or potassium. Organic carbon from SoilGrids is a modelled estimate, not a field test.',
    'Crop water requirements use FAO-56 Kc values with Hargreaves ET₀; local variety, planting date and irrigation efficiency will shift the numbers.',
    'Where a dataset is unavailable the app says so and lowers its confidence rather than filling the gap.',
  ]
  if (!analysis.vegetation)
    limitations.push(
      'Vegetation index (MODIS/VIIRS) was unavailable for this retrieval; vegetation condition did not influence the ranking.',
    )
  return {
    farmId: farm.id,
    generatedAt: new Date().toISOString(),
    crops,
    rotations,
    context: {
      previousCrop: farm.previousCrop,
      irrigation: farm.irrigation,
      soilTexture: analysis.soil?.texture ?? null,
      climateZoneNote: climateZoneNote(farm.centroid[1]),
    },
    limitations,
  }
}

function climateZoneNote(lat: number): string {
  const abs = Math.abs(lat)
  if (abs < 23.5) return 'Tropical belt (|lat| < 23.5°): frost is rare; water balance dominates.'
  if (abs < 35) return 'Subtropical belt (23.5–35°): warm-season crops dominate, heat risk rising.'
  if (abs < 50) return 'Temperate belt (35–50°): distinct cool and warm seasons drive rotation choice.'
  return 'High-latitude belt (>50°): short growing season, frost timing is the binding constraint.'
}
