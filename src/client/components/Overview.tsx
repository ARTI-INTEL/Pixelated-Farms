import { cropById } from '../../shared/crops'
import type { Analysis, Farm, RecommendationSet } from '../../shared/types'
import { n, signed, when } from '../format'
import { Bar, Card, Empty, Pill, Provenance, Stat } from './ui'

export function Overview({
  farm,
  analysis,
  recommendation,
  onOpen,
}: {
  farm: Farm
  analysis: Analysis
  recommendation: RecommendationSet
  onOpen: (view: 'climate' | 'vegetation' | 'rotation' | 'assistant' | 'methods') => void
}) {
  const i = analysis.indicators
  const top = recommendation.crops.slice(0, 3)

  return (
    <div className="stack">
      <div className="field-head">
        <div>
          <span className="eyebrow">Field intelligence</span>
          <h1>{farm.name}</h1>
          <p className="field-meta">
            {farm.areaHa.toFixed(1)} ha · {farm.centroid[1].toFixed(3)}°, {farm.centroid[0].toFixed(3)}° ·{' '}
            {farm.irrigation} · previous crop {cropById(farm.previousCrop)?.name ?? 'not supplied'}
          </p>
        </div>
        <div className="field-head-side">
          <Pill tone="info">Retrieved {when(analysis.retrievedAt)}</Pill>
          <button className="btn-ghost" onClick={() => onOpen('methods')}>
            Data & methods
          </button>
        </div>
      </div>

      {analysis.warnings.length > 0 && (
        <div className="notice notice-warn" role="status">
          <strong>Data limitations for this retrieval</strong>
          <ul>
            {analysis.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <Card
        title="Current conditions"
        subtitle={`NASA POWER baseline ${analysis.climate?.baselinePeriod ?? 'unavailable'} · grid cell, not in-field sensors`}
        right={
          <Pill tone={analysis.indicators.soilWetnessAnomaly !== null && analysis.indicators.soilWetnessAnomaly < -0.03 ? 'warn' : 'good'}>
            {analysis.indicators.soilWetnessAnomaly === null
              ? 'Moisture n/a'
              : analysis.indicators.soilWetnessAnomaly < -0.03
                ? 'Below-baseline wetness'
                : 'Wetness near baseline'}
          </Pill>
        }
      >
        <div className="stat-grid">
          <Stat
            label="Annual precipitation"
            value={n(i.normalPrecipMm)}
            unit="mm"
            hint={`Baseline ${analysis.climate?.baselinePeriod ?? 'n/a'}`}
          />
          <Stat
            label="Last 12 months rain"
            value={n(i.last12PrecipMm)}
            unit="mm"
            hint={i.precipAnomalyPct === null ? 'Anomaly n/a' : `${signed(i.precipAnomalyPct)}% vs recent baseline`}
            tone={(i.precipAnomalyPct ?? 0) < -20 ? 'bad' : (i.precipAnomalyPct ?? 0) < -10 ? 'warn' : 'good'}
          />
          <Stat
            label="Mean temperature"
            value={n(i.normalTmean, 1)}
            unit="°C"
            hint={i.tempAnomalyC === null ? 'Anomaly n/a' : `Last 12 months ${signed(i.tempAnomalyC, 1)} °C`}
          />
          <Stat
            label="Aridity index"
            value={n(i.aridityIndex, 2)}
            hint="Precipitation ÷ Hargreaves ET₀"
            tone={(i.aridityIndex ?? 1) < 0.5 ? 'bad' : (i.aridityIndex ?? 1) < 0.75 ? 'warn' : 'good'}
          />
          <Stat
            label="Heat days ≥35 °C"
            value={n(i.heatDays35)}
            unit="/yr"
            hint="NASA POWER daily, last ~5 years"
            tone={(i.heatDays35 ?? 0) > 40 ? 'bad' : (i.heatDays35 ?? 0) > 20 ? 'warn' : 'good'}
          />
          <Stat
            label="Longest dry spell"
            value={n(i.maxDrySpellDays)}
            unit="days"
            hint="Consecutive days <1 mm"
            tone={(i.maxDrySpellDays ?? 0) > 30 ? 'warn' : 'neutral'}
          />
          <Stat
            label="Root-zone wetness"
            value={i.soilWetnessMean === null ? null : i.soilWetnessMean.toFixed(2)}
            hint="Modelled fraction (not SMAP)"
          />
          <Stat
            label="Vegetation NDVI"
            value={i.ndviLatest === null ? null : i.ndviLatest.toFixed(2)}
            hint={
              i.ndviAnomaly === null
                ? 'MODIS 250 m'
                : `Anomaly ${signed(i.ndviAnomaly, 2)} vs earlier years`
            }
            tone={i.ndviAnomaly === null ? 'neutral' : i.ndviAnomaly < -0.05 ? 'warn' : 'good'}
          />
        </div>
        <p className="fineprint">
          POWER values are modelled ~50 km grid-cell estimates (MERRA-2/GLDAS), not measurements taken
          in this field. Soil wetness is a land-surface model output; SMAP is not configured. ET₀ is
          derived with FAO-56 Hargreaves–Samani from monthly means.
        </p>
      </Card>

      <div className="two-col">
        <Card
          title="Crop suitability"
          subtitle="Weighted, explainable screening — not a yield forecast"
          right={
            <button className="link" onClick={() => onOpen('rotation')}>
              Full ranking →
            </button>
          }
        >
          {top.length ? (
            <ul className="crop-list">
              {top.map((crop, index) => (
                <li key={crop.cropId}>
                  <div className="crop-row">
                    <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="crop-main">
                      <div className="crop-title">
                        <strong>{crop.name}</strong>
                        <Pill tone="good">{crop.score}/100</Pill>
                      </div>
                      <Bar value={crop.score} />
                      <p className="crop-sub">
                        {crop.window ? `Window ${crop.window.label}` : 'Window unavailable'}
                        {crop.waterDeficitMm !== null ? ` · deficit ${crop.waterDeficitMm} mm` : ''} ·
                        confidence {Math.round(crop.confidence * 100)}%
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No climate data, no ranking">The engine needs at least the POWER climate record to score crops.</Empty>
          )}
          <p className="fineprint">
            Scores combine temperature, seasonal water balance, season length, soil screening, rotation
            fit and climate risk. Open a crop in the Rotation tab to see every component and its
            weight.
          </p>
        </Card>

        <Card title="Rotation direction" subtitle="Three-season sequences compared with current practice">
          <ul className="plan-list">
            {(recommendation.rotations.length
              ? recommendation.rotations
              : []
            ).map((plan) => (
              <li key={plan.id}>
                <div className="plan-head">
                  <strong>{plan.name}</strong>
                  <span className="mono">{plan.score}/100</span>
                </div>
                <p className="plan-seq">
                  {plan.seasons.map((season) => season.cropName).join(' → ')}
                </p>
              </li>
            ))}
            {!recommendation.rotations.length && <li className="muted">Rotation plans need climate data.</li>}
          </ul>
          <button className="link" onClick={() => onOpen('rotation')}>
            Compare with current practice →
          </button>
        </Card>
      </div>

      <div className="two-col">
        <Card title="Soil screening" subtitle="ISRIC SoilGrids 2.0 model · non-NASA">
          {analysis.soil ? (
            <div className="stat-grid stat-grid-3">
              <Stat label="Texture" value={analysis.soil.texture} hint={`${analysis.soil.clayPct}% clay · ${analysis.soil.sandPct}% sand`} />
              <Stat label="pH" value={analysis.soil.ph.toFixed(1)} hint="0–30 cm weighted" />
              <Stat label="Organic carbon" value={analysis.soil.socGKg} unit="g/kg" hint="Modelled, not a soil test" />
            </div>
          ) : (
            <Empty title="Soil data unavailable">
              No soil value is estimated. Add a laboratory soil test to improve the soil component.
            </Empty>
          )}
          <p className="fineprint">
            SoilGrids does not provide nitrogen, phosphorus or potassium. This app never presents
            satellite or modelled soil chemistry as measured nutrients.
          </p>
        </Card>

        <Card title="Ask the field assistant" subtitle="Grounded in this field's retrieved data">
          <p className="assistant-teaser">
            “What should I plant next season?” · “Why is {recommendation.crops[0]?.name ?? 'this crop'}
            recommended?” · “Is my field under drought stress?”
          </p>
          <button onClick={() => onOpen('assistant')}>Open assistant</button>
          <button className="btn-ghost" onClick={() => onOpen('vegetation')}>
            Vegetation detail
          </button>
        </Card>
      </div>

      <Card title="Dataset provenance" subtitle="Every number above traces back to one of these records">
        <div className="prov-grid-wrap">
          {analysis.sources.map((source, index) => (
            <Provenance key={`${source.dataset}-${index}`} source={source} />
          ))}
        </div>
      </Card>
    </div>
  )
}
