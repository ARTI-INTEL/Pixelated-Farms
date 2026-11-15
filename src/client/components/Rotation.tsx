import { useState } from 'react'
import { cropById } from '../../shared/crops'
import type { Analysis, Farm, RecommendationSet } from '../../shared/types'
import { pct } from '../format'
import { Bar, Card, Empty, Pill } from './ui'

export function Rotation({
  farm,
  analysis,
  recommendation,
}: {
  farm: Farm
  analysis: Analysis
  recommendation: RecommendationSet
}) {
  const [open, setOpen] = useState<string | null>(recommendation.crops[0]?.cropId ?? null)
  const [openPlan, setOpenPlan] = useState<string>('balanced')

  return (
    <div className="stack">
      <div className="field-head">
        <div>
          <span className="eyebrow">Recommendation engine</span>
          <h1>What to plant next</h1>
          <p className="field-meta">
            {farm.name} · {farm.irrigation} · previous{' '}
            {cropById(farm.previousCrop)?.name ?? 'crop not supplied'} · soil{' '}
            {analysis.soil?.texture ?? 'unavailable'}
          </p>
        </div>
        <Pill tone="info">{recommendation.crops[0]?.confidence ? `${pct(recommendation.crops[0].confidence)} top confidence` : 'Low confidence'}</Pill>
      </div>

      {!recommendation.crops.length ? (
        <Card title="No recommendation available">
          <Empty title="Climate data is required">
            The engine needs at least the POWER climate record before it will score a crop.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="notice">
            <strong>How to read the scores.</strong> Each score is a weighted sum of six components,
            each traceable to a dataset. It ranks agronomic suitability for this field's modelled
            conditions — it is not a yield forecast, a profit estimate or an agronomic guarantee.
          </div>

          <div className="crop-cards">
            {recommendation.crops.map((crop, index) => {
              const expanded = open === crop.cropId
              return (
                <article key={crop.cropId} className={`crop-card ${expanded ? 'crop-card-open' : ''}`}>
                  <header>
                    <div>
                      <span className="rank">#{index + 1}</span>
                      <h3>{crop.name}</h3>
                      <p className="crop-sub">
                        {crop.family} · {crop.lifecycle}
                      </p>
                    </div>
                    <div className="score-block">
                      <strong>{crop.score}</strong>
                      <small>/100</small>
                    </div>
                  </header>

                  <div className="crop-card-facts">
                    <span>{crop.window ? `Window ${crop.window.label}` : 'Window n/a'}</span>
                    <span>{crop.waterDeficitMm !== null ? `${crop.waterDeficitMm} mm deficit` : 'Water n/a'}</span>
                    <span>{pct(crop.confidence)} confidence</span>
                    {crop.role === 'primary' ? <Pill tone="good">Top pick</Pill> : <Pill>Alternative</Pill>}
                  </div>

                  <Bar value={crop.score} />

                  <ul className="mini-components">
                    {crop.components.map((component) => (
                      <li key={component.key}>
                        <span>{component.label}</span>
                        <strong className="mono">{component.score}</strong>
                      </li>
                    ))}
                  </ul>

                  <button
                    className="link"
                    onClick={() => setOpen(expanded ? null : crop.cropId)}
                    aria-expanded={expanded}
                  >
                    {expanded ? 'Hide reasoning' : 'Why this crop?'}
                  </button>

                  {expanded && (
                    <div className="reasoning">
                      <h4>Component scoring</h4>
                      <ul className="component-list">
                        {crop.components.map((component) => (
                          <li key={component.key}>
                            <div className="component-head">
                              <strong>{component.label}</strong>
                              <span className="mono">
                                {component.score}/100 · weight {Math.round(component.weight * 100)}%
                              </span>
                            </div>
                            <Bar value={component.score} tone="muted" />
                            <p>{component.detail}</p>
                          </li>
                        ))}
                      </ul>
                      <h4>Why it ranks here</h4>
                      <ul className="bullet-list">
                        {crop.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      <h4>Caveats</h4>
                      <ul className="bullet-list caveat-list">
                        {crop.caveats.map((caveat) => (
                          <li key={caveat}>{caveat}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              )
            })}
          </div>

          <Card title="Rotation sequences" subtitle="Heuristic planning, compared with current practice">
            <div className="plan-tabs">
              {recommendation.rotations.map((plan) => (
                <button
                  key={plan.id}
                  className={openPlan === plan.id ? 'tab tab-active' : 'tab'}
                  onClick={() => setOpenPlan(plan.id)}
                >
                  {plan.name}
                </button>
              ))}
            </div>
            {recommendation.rotations
              .filter((plan) => plan.id === openPlan)
              .map((plan) => (
                <div key={plan.id} className="plan-detail">
                  <div className="plan-head">
                    <div>
                      <h3>{plan.name}</h3>
                      <p className="crop-sub">{plan.resilience}</p>
                    </div>
                    <div className="score-block">
                      <strong>{plan.score}</strong>
                      <small>/100</small>
                    </div>
                  </div>
                  <ol className="season-row">
                    {plan.seasons.map((season) => (
                      <li key={season.index}>
                        <span className="season-label">Season {season.index}</span>
                        <strong>{season.cropName}</strong>
                        <span className="crop-sub">{season.family}</span>
                        {season.waterDeficitMm !== null && (
                          <span className="season-stat">{season.waterDeficitMm} mm deficit</span>
                        )}
                        {season.nitrogenCreditKgHa > 0 && (
                          <span className="season-stat season-good">+{season.nitrogenCreditKgHa} kg N/ha credit</span>
                        )}
                        <p>{season.note}</p>
                      </li>
                    ))}
                  </ol>
                  <ul className="bullet-list">
                    {plan.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </Card>

          <Card title="Limitations of this recommendation" subtitle="Stated up front, not buried">
            <ul className="bullet-list caveat-list">
              {recommendation.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
