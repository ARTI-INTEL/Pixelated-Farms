import { cropById } from '../shared/crops'
import type {
  Analysis,
  AssistantAnswer,
  Farm,
  RecommendationSet,
} from '../shared/types'

type Fact = { label: string; value: string; source: string }

const fmt = (value: number | null | undefined, unit = '', digits = 0) =>
  value === null || value === undefined ? 'not available' : `${value.toFixed(digits)}${unit}`

const monthLabel = (month: number) =>
  new Date(Date.UTC(2024, month - 1, 1)).toLocaleString('en', {
    month: 'short',
    timeZone: 'UTC',
  })

export function farmFacts(
  farm: Farm,
  analysis: Analysis,
  rec: RecommendationSet,
): Fact[] {
  const i = analysis.indicators
  const top = rec.crops[0]
  const facts: Fact[] = [
    {
      label: 'Field',
      value: `${farm.name} — ${farm.areaHa.toFixed(1)} ha near ${farm.centroid[1].toFixed(3)}°, ${farm.centroid[0].toFixed(3)}°`,
      source: 'Field boundary drawn by the farmer',
    },
    {
      label: 'Climate baseline',
      value: `${fmt(i.normalPrecipMm, ' mm/yr')} mean annual precipitation and ${fmt(i.normalTmean, ' °C', 1)} mean temperature over ${analysis.climate?.baselinePeriod ?? 'the POWER baseline'}`,
      source: 'NASA POWER monthly (MERRA-2), ~50 km cell',
    },
    {
      label: 'Recent 12 months',
      value: `${fmt(i.last12PrecipMm, ' mm')} precipitation (${i.precipAnomalyPct === null ? 'anomaly not available' : `${i.precipAnomalyPct > 0 ? '+' : ''}${i.precipAnomalyPct}% vs the recent baseline`}), temperature anomaly ${fmt(i.tempAnomalyC, ' °C', 1)}`,
      source: 'NASA POWER daily (MERRA-2)',
    },
    {
      label: 'Heat and dry spells',
      value: `${fmt(i.heatDays35, ' days/yr')} above 35 °C, longest dry spell ${fmt(i.maxDrySpellDays, ' days')}, ${fmt(i.frostDays, ' frost days/yr')}`,
      source: 'NASA POWER daily, last ~5 years',
    },
    {
      label: 'Water balance',
      value: `Aridity index ${fmt(i.aridityIndex, '', 2)} (precipitation ÷ estimated ET₀ ${fmt(i.et0Mm, ' mm')}); 12-month rainfall percentile ${i.precipPercentile === null ? 'not available' : `${i.precipPercentile}%`}`,
      source: 'Derived: POWER precipitation with Hargreaves–Samani ET₀',
    },
    {
      label: 'Soil wetness',
      value: `${fmt(i.soilWetnessMean, '', 2)} mean root-zone wetness (fraction), recent anomaly ${fmt(i.soilWetnessAnomaly, '', 2)}`,
      source: 'NASA POWER GWETROOT — land-surface model output, not SMAP',
    },
    {
      label: 'Vegetation',
      value:
        analysis.vegetation && i.ndviLatest !== null
          ? `Latest NDVI ${fmt(i.ndviLatest, '', 2)}, mean ${fmt(i.ndviMean, '', 2)}, anomaly ${fmt(i.ndviAnomaly, '', 2)}`
          : 'NDVI unavailable for this retrieval (ORNL TESViS returned no data)',
      source: 'MODIS MOD13Q1 250 m 16-day NDVI (greenness, not nutrients)',
    },
    {
      label: 'Soil screening',
      value: analysis.soil
        ? `${analysis.soil.texture}, pH ${analysis.soil.ph}, organic carbon ${analysis.soil.socGKg} g/kg (0–30 cm)`
        : 'No soil data available; a soil test is needed',
      source: 'ISRIC SoilGrids 2.0 model (non-NASA)',
    },
  ]
  if (top)
    facts.push({
      label: 'Top recommendation',
      value: `${top.name} — score ${top.score}/100, confidence ${Math.round(top.confidence * 100)}%${top.window ? `, window ${monthLabel(top.window.startMonth)}–${monthLabel(top.window.endMonth)}` : ''}`,
      source: 'Fieldshift scoring engine (FAO-56 / ECOCROP parameters + NASA inputs)',
    })
  return facts
}

function findCrop(question: string, rec: RecommendationSet) {
  const lower = question.toLowerCase()
  return rec.crops.find(
    (crop) => lower.includes(crop.name.toLowerCase().split(' ')[0]) || lower.includes(crop.cropId),
  )
}

/**
 * Deterministic, fully grounded answers. These work without any LLM key and use
 * only values computed for this field; the LLM path below receives the same
 * facts and is instructed to invent nothing.
 */
export function groundedAnswer(
  question: string,
  farm: Farm,
  analysis: Analysis,
  rec: RecommendationSet,
): AssistantAnswer {
  const q = question.toLowerCase()
  const facts = farmFacts(farm, analysis, rec)
  const i = analysis.indicators
  const suggestions = [
    'What should I plant next season?',
    'Why is the top crop recommended?',
    'Is my field experiencing drought stress?',
    'Which crops need less water?',
    'How has rainfall changed?',
  ]
  const refusals: string[] = []
  const base = {
    mode: 'grounded' as const,
    facts,
    suggestions,
    refusals,
  }

  if (/(yield|profit|revenue|price|income|fertiliz|fertilis|npk rate|pesticide)/.test(q)) {
    refusals.push(
      'I cannot forecast yield, profit or a fertiliser application rate: this app has no local yield trials, market data or soil-test nutrient values, and satellite data cannot supply them.',
    )
  }

  if (/(nutrient|nitrogen|phosphorus|potassium|fertiliz|fertilis)/.test(q)) {
    const soil = analysis.soil
    return {
      ...base,
      answer:
        (refusals.length ? `${refusals.join(' ')}\n\n` : '') +
        `No satellite in this app measures soil nutrients. NASA POWER and MODIS describe climate and vegetation greenness; the only soil chemistry shown is ISRIC SoilGrids' modelled organic carbon` +
        (soil ? ` of ${soil.socGKg} g/kg for ${soil.texture} with pH ${soil.ph}.` : ', which was unavailable for this retrieval.') +
        ` A laboratory soil test is the correct source for nitrogen, phosphorus and potassium, and the rotation engine treats legume nitrogen credits (reference values) as an estimate only.`,
    }
  }

  if (/(why|reason|explain|justify)/.test(q)) {
    const crop = findCrop(q, rec) ?? rec.crops[0]
    if (!crop) return { ...base, answer: 'No crop recommendation is available for this field yet.' }
    const parts = crop.components.map(
      (component) =>
        `• ${component.label} — ${component.score}/100 (weight ${Math.round(component.weight * 100)}%): ${component.detail}`,
    )
    return {
      ...base,
      answer:
        (refusals.length ? `${refusals.join(' ')}\n\n` : '') +
        `${crop.name} scores ${crop.score}/100 with ${Math.round(crop.confidence * 100)}% confidence. Component breakdown:\n\n${parts.join('\n')}\n\nCaveats: ${crop.caveats.join(' ')}`,
    }
  }

  if (/(drought|stress|dry|moisture|water stress)/.test(q) && !/less water/.test(q)) {
    const signals: string[] = []
    if (i.precipPercentile !== null)
      signals.push(`the last 12 months sit at the ${i.precipPercentile}th percentile of 12-month rainfall totals in the record`)
    if (i.precipAnomalyPct !== null)
      signals.push(`recent precipitation is ${i.precipAnomalyPct > 0 ? 'above' : 'below'} the recent baseline by ${Math.abs(i.precipAnomalyPct)}%`)
    if (i.soilWetnessAnomaly !== null)
      signals.push(`root-zone soil wetness is ${i.soilWetnessAnomaly < 0 ? 'below' : 'above'} its baseline by ${Math.abs(i.soilWetnessAnomaly).toFixed(2)} (modelled)`)
    if (i.ndviAnomaly !== null)
      signals.push(`NDVI is ${i.ndviAnomaly < 0 ? 'below' : 'above'} the earlier years by ${Math.abs(i.ndviAnomaly).toFixed(3)}`)
    signals.push(`the longest dry spell in the recent record was ${i.maxDrySpellDays ?? 'not available'} days`)
    const severity =
      (i.precipPercentile ?? 50) < 20 || (i.precipAnomalyPct ?? 0) < -25
        ? 'The indicators point to a meaningful rainfall deficit.'
        : 'The indicators do not show a strong rainfall deficit.'
    return {
      ...base,
      answer:
        (refusals.length ? `${refusals.join(' ')}\n\n` : '') +
        `${severity} For ${farm.name}: ${signals.join('; ')}. These are ${analysis.climate ? 'grid-cell climate statistics and modelled soil wetness' : 'limited data'}, not an in-field sensor reading, and NDVI shows greenness rather than water availability.`,
    }
  }

  if (/(less water|low water|drought tolerant|save water|irrigation)/.test(q)) {
    const ranked = [...rec.crops]
      .filter((crop) => crop.waterDeficitMm !== null)
      .sort((a, b) => (a.waterDeficitMm ?? 0) - (b.waterDeficitMm ?? 0))
      .slice(0, 4)
    return {
      ...base,
      answer:
        (refusals.length ? `${refusals.join(' ')}\n\n` : '') +
        (ranked.length
          ? `Lowest estimated seasonal water deficits for this field (crop ET minus 75% of rainfall):\n${ranked
              .map(
                (crop) =>
                  `• ${crop.name}: ${crop.waterDeficitMm} mm deficit (ET ${crop.et0SeasonMm} mm vs ${crop.effectiveRainMm} mm effective rain)`,
              )
              .join('\n')}\n\nThese use FAO-56 crop coefficients and Hargreaves ET₀ from a ~50 km climate cell; a local irrigation schedule needs field measurements.`
          : 'Water deficits could not be computed because the climate data was unavailable.'),
    }
  }

  if (/(rain|precip|climate change|trend|temperature)/.test(q)) {
    const annual = analysis.climate?.annual ?? []
    const years = annual.slice(-5)
    return {
      ...base,
      answer:
        (refusals.length ? `${refusals.join(' ')}\n\n` : '') +
        (annual.length
          ? `Over ${analysis.climate?.baselinePeriod}, mean annual precipitation is ${fmt(i.normalPrecipMm, ' mm')} with a Sen's-slope trend of ${fmt(i.precipTrendMmPerDecade, ' mm/decade')}, and mean temperature is ${fmt(i.normalTmean, ' °C', 1)} with a trend of ${fmt(i.tempTrendCPerDecade, ' °C/decade')}.\n\nRecent years (POWER, mm): ${years.map((row) => `${row.year}: ${row.precipMm}`).join(' · ')}.\n\nThe trend is a statistical estimate on a modelled grid-cell series, not a forecast, and the record length limits confidence.`
          : 'The climate record was unavailable for this retrieval, so I cannot describe rainfall trends.'),
    }
  }

  if (/(rotation|rotate|sequence|next season|plant|grow|crop)/.test(q)) {
    const top = rec.crops.slice(0, 3)
    return {
      ...base,
      answer:
        (refusals.length ? `${refusals.join(' ')}\n\n` : '') +
        (top.length
          ? `For ${farm.name} (${farm.areaHa.toFixed(1)} ha, ${farm.irrigation}, previous crop: ${cropById(farm.previousCrop)?.name ?? 'not supplied'}):\n\n${top
              .map(
                (crop, index) =>
                  `${index + 1}. ${crop.name} — ${crop.score}/100${crop.window ? `, window ${crop.window.label}` : ''}${crop.waterDeficitMm !== null ? `, seasonal deficit ${crop.waterDeficitMm} mm` : ''}. ${crop.reasons[0] ?? ''}`,
              )
              .join('\n')}\n\nRecommended sequences: ${rec.rotations.map((plan) => plan.name).join(', ') || 'not available'}. Open the Rotation tab for the season-by-season reasoning and caveats.`
          : 'No recommendation is available yet — run the field analysis first.'),
    }
  }

  return {
    ...base,
    answer:
      (refusals.length ? `${refusals.join(' ')}\n\n` : '') +
      `${farm.name}: ${fmt(i.normalPrecipMm, ' mm/yr')} mean rainfall, aridity index ${fmt(i.aridityIndex, '', 2)}, ${fmt(i.heatDays35, ' heat days/yr')}, soil ${analysis.soil?.texture ?? 'unavailable'} at pH ${fmt(analysis.soil?.ph, '', 1)}.\n\nTop recommendation: ${rec.crops[0]?.name ?? 'not available'}${rec.crops[0] ? ` (${rec.crops[0].score}/100, ${Math.round(rec.crops[0].confidence * 100)}% confidence)` : ''}. Ask about the recommendation's reasons, drought stress, water demand, rainfall trends or rotation options.`,
  }
}

/** Optional LLM layer. Falls back to the grounded answer on any failure. */
export async function answerQuestion(
  env: { OPENAI_API_KEY?: string; ASSISTANT_MODEL?: string },
  question: string,
  farm: Farm,
  analysis: Analysis,
  rec: RecommendationSet,
): Promise<AssistantAnswer> {
  const fallback = groundedAnswer(question, farm, analysis, rec)
  if (!env.OPENAI_API_KEY) return fallback
  const facts = farmFacts(farm, analysis, rec)
  const cropFacts = rec.crops.map((crop) => ({
    crop: crop.name,
    score: crop.score,
    confidence: crop.confidence,
    window: crop.window?.label ?? null,
    waterDeficitMm: crop.waterDeficitMm,
    components: crop.components.map((component) => ({
      label: component.label,
      score: component.score,
      detail: component.detail,
    })),
    caveats: crop.caveats,
  }))
  try {
    const response = await fetch('https://freebuff.com/api/v1/paid/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.ASSISTANT_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are Fieldshift, an agricultural decision-support assistant. Use ONLY the supplied field facts and recommendations. Never invent measurements, dates, yields, prices or nutrient values. Always name the dataset and period behind a number. Distinguish measured observations, derived indicators and model predictions. Say plainly when data is unavailable. Never claim satellite data measures soil nutrients. Do not forecast yield or profit. Keep answers under 200 words, plain text, no markdown tables.',
          },
          {
            role: 'user',
            content: `FACTS:\n${facts.map((fact) => `- ${fact.label}: ${fact.value} [source: ${fact.source}]`).join('\n')}\n\nCROPS:\n${JSON.stringify(cropFacts)}\n\nLIMITATIONS:\n${rec.limitations.join('\n')}\n\nQUESTION: ${question}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) return fallback
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = body.choices?.[0]?.message?.content?.trim()
    if (!content) return fallback
    return { ...fallback, answer: content, mode: 'llm' }
  } catch {
    return fallback
  }
}
