import { CROPS } from '../../shared/crops'
import { DATASETS } from '../../shared/datasets'
import { Card, Pill } from './ui'

const WEIGHTS = [
  { key: 'thermal', label: 'Temperature & heat', weight: 22 },
  { key: 'water', label: 'Seasonal water balance', weight: 24 },
  { key: 'season', label: 'Season length (GDD fit)', weight: 11 },
  { key: 'soil', label: 'Soil screening', weight: 13 },
  { key: 'rotation', label: 'Rotation compatibility', weight: 18 },
  { key: 'risk', label: 'Climate risk', weight: 12 },
]

const statusTone = {
  verified: 'good',
  degraded: 'warn',
  credentialed: 'warn',
} as const

export function Methods() {
  return (
    <div className="stack">
      <div className="field-head">
        <div>
          <span className="eyebrow">Scientific basis</span>
          <h1>Data &amp; methods</h1>
          <p className="field-meta">
            Every dataset, variable, resolution and limitation behind the recommendations
          </p>
        </div>
        <Pill tone="info">NASA Space Apps 2026 · Field Shift</Pill>
      </div>

      <Card title="How a field becomes a recommendation" subtitle="Four steps, all visible in the interface">
        <ol className="pipeline">
          <li>
            <span>01</span>
            <strong>Boundary</strong>
            <p>The drawn polygon is measured (approximate geodesic area) and reduced to a centroid.</p>
          </li>
          <li>
            <span>02</span>
            <strong>Retrieval</strong>
            <p>
              The centroid is queried against NASA POWER (climate), MODIS NDVI via ORNL DAAC, NASA
              GIBS (imagery) and ISRIC SoilGrids. Each response is cached in D1 with its retrieval time.
            </p>
          </li>
          <li>
            <span>03</span>
            <strong>Indicators</strong>
            <p>
              Growing-degree days, water balance, ET₀, aridity, dry spells, heat and frost exposure,
              trends and vegetation anomalies are derived and labelled as observed, derived or modelled.
            </p>
          </li>
          <li>
            <span>04</span>
            <strong>Ranking</strong>
            <p>
              Six weighted components score each crop, then a heuristic planner assembles three-season
              sequences and compares them with the farmer's current practice.
            </p>
          </li>
        </ol>
      </Card>

      <Card title="Dataset catalogue" subtitle="Status reflects what this deployment can actually retrieve">
        <div className="dataset-list">
          {DATASETS.map((dataset) => (
            <article key={dataset.id} className="dataset">
              <header>
                <div>
                  <h3>{dataset.name}</h3>
                  <p className="crop-sub">{dataset.provider}</p>
                </div>
                <Pill tone={statusTone[dataset.status]}>
                  {dataset.status === 'verified'
                    ? 'Verified live'
                    : dataset.status === 'degraded'
                      ? 'Intermittent'
                      : 'Needs Earthdata login'}
                </Pill>
              </header>
              <p>{dataset.purpose}</p>
              <dl className="dataset-grid">
                <div>
                  <dt>Variables</dt>
                  <dd>
                    <ul>
                      {dataset.variables.map((variable) => (
                        <li key={variable}>{variable}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>Resolution</dt>
                  <dd>{dataset.resolution}</dd>
                </div>
                <div>
                  <dt>Cadence</dt>
                  <dd>{dataset.cadence}</dd>
                </div>
                <div>
                  <dt>Access</dt>
                  <dd>{dataset.access}</dd>
                </div>
                <div>
                  <dt>Limitations</dt>
                  <dd>
                    <ul>
                      {dataset.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>Role in the engine</dt>
                  <dd>{dataset.contribution}</dd>
                </div>
              </dl>
              <a className="prov-link" href={dataset.sourceUrl} target="_blank" rel="noreferrer">
                Official documentation ↗
              </a>
            </article>
          ))}
        </div>
      </Card>

      <div className="two-col">
        <Card title="Scoring weights" subtitle="Fixed, published, and shown on every crop card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {WEIGHTS.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td className="mono">{row.weight}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fineprint">
            Final score = Σ (component score × weight). Confidence is reported separately and rises
            with data completeness — climate record, daily extremes, soil, NDVI and a known previous
            crop. A high score on thin data still shows low confidence.
          </p>
        </Card>

        <Card title="What the labels mean" subtitle="No number is shown without one of these">
          <ul className="bullet-list">
            <li><strong>Observed (modelled grid)</strong> — an upstream product's value, e.g. POWER precipitation. Modelled from satellite and reanalysis inputs, not a gauge in the field.</li>
            <li><strong>Derived</strong> — computed here from observations, e.g. aridity index, ET₀, frost-free period, Sen's slope.</li>
            <li><strong>Modelled</strong> — a secondary model output, e.g. POWER root-zone wetness or SoilGrids pH.</li>
            <li><strong>Prediction</strong> — the crop score. It is a heuristic ranking, not a forecast of yield, revenue or soil chemistry.</li>
          </ul>
          <p className="fineprint">
            Missing data is never filled. When a service fails, the interface states which panel is
            unavailable, keeps a stale cached value only if one exists and marks it, and lowers
            confidence.
          </p>
        </Card>
      </div>

      <Card title="Crop parameter sources" subtitle="Reference agronomy, explicitly not NASA data">
        <p>
          {CROPS.length} crops are modelled with mid-season crop coefficients, rooting depths, season
          lengths and temperature/water ranges compiled from FAO Irrigation &amp; Drainage Paper 56 and
          FAO ECOCROP. These are reference ranges rounded for screening, not local variety trials, and
          they are labelled as such in every crop card.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Crop</th>
                <th>Family</th>
                <th>Cycle</th>
                <th>Season</th>
                <th>GDD</th>
                <th>Kc mid</th>
                <th>Water</th>
                <th>pH</th>
                <th>N credit</th>
              </tr>
            </thead>
            <tbody>
              {CROPS.map((crop) => (
                <tr key={crop.id}>
                  <td>{crop.name}</td>
                  <td>{crop.family}</td>
                  <td>{crop.lifecycle}</td>
                  <td className="mono">{crop.seasonDays} d</td>
                  <td className="mono">{crop.gddMaturity}</td>
                  <td className="mono">{crop.kcMid}</td>
                  <td className="mono">
                    {crop.waterReqMm[0]}–{crop.waterReqMm[1]} mm
                  </td>
                  <td className="mono">
                    {crop.phRange[0]}–{crop.phRange[1]}
                  </td>
                  <td className="mono">{crop.nFixer ? `${crop.nCreditKgHa} kg/ha` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Known limitations, stated plainly" subtitle="What this tool cannot do">
        <ul className="bullet-list caveat-list">
          <li>No yield, revenue or profit prediction: that requires local trials, prices and management data.</li>
          <li>No nutrient measurement: satellites and SoilGrids cannot replace a laboratory soil test for N, P, K.</li>
          <li>Climate values are a ~50 km grid cell and NDVI is 250 m; within-field variability is invisible.</li>
          <li>SMAP soil moisture is not available in this deployment because it requires NASA Earthdata credentials; the app labels the gap instead of substituting modelled values.</li>
          <li>MODIS/VIIRS NDVI depends on the ORNL DAAC subsetting service, which has been intermittent; when it fails the vegetation panel says so.</li>
          <li>Rotation sequences are heuristic three-season proposals, not a multi-year optimisation with prices, labour or machinery constraints.</li>
          <li>Crop parameters are global reference ranges; local varieties and planting dates will shift the outcomes.</li>
          <li>Demand for the POWER API is paced and cached; a first analysis of a new location takes a few seconds.</li>
        </ul>
      </Card>

      <Card title="Attribution">
        <p>
          Climate and soil-moisture fields: NASA POWER (NASA LaRC), including MERRA-2 and SYN1DEG
          inputs. Vegetation indices: MODIS MOD13Q1, NASA LP DAAC, served by the ORNL DAAC TESViS
          subsetting service. Imagery: NASA EOSDIS GIBS / Worldview. Soil: ISRIC SoilGrids 2.0
          (non-NASA). Basemap: © OpenStreetMap contributors © CARTO. Place search: Photon / OpenStreetMap.
        </p>
        <p className="fineprint">
          Fieldshift is an independent NASA Space Apps Challenge entry. It is not affiliated with or
          endorsed by NASA. Values are for decision support and demonstration, not regulatory or
          financial advice.
        </p>
      </Card>
    </div>
  )
}
