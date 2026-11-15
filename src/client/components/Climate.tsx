import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Analysis, Farm } from '../../shared/types'
import { n, signed } from '../format'
import { Card, Empty, Pill, Stat, monthShort } from './ui'

const axis = { stroke: '#5d7385', fontSize: 11 }
const tooltipStyle = {
  background: '#0d1b26',
  border: '1px solid #23394a',
  borderRadius: 8,
  fontSize: 12,
  color: '#e6f0ea',
}

export function Climate({ farm, analysis }: { farm: Farm; analysis: Analysis }) {
  const i = analysis.indicators
  const annual = analysis.climate?.annual ?? []
  const normals = analysis.climate?.normals ?? []
  const meanPrecip = annual.length
    ? annual.reduce((sum, row) => sum + row.precipMm, 0) / annual.length
    : 0
  const monthly = normals.map((row) => ({
    month: monthShort(row.month),
    precip: row.precipMm === null ? null : Math.round(row.precipMm),
    tmean: row.tmean,
    tmax: row.tmax,
    tmin: row.tmin,
    wetness: row.soilWetness === null ? null : Number((row.soilWetness * 100).toFixed(0)),
  }))

  if (!analysis.climate)
    return (
      <Card title="Climate record unavailable" subtitle="NASA POWER">
        <Empty title="No climate data for this retrieval">
          The POWER monthly service did not return data, so no trend or indicator is estimated.
          Try “Refresh analysis” — the app never fills missing observations.
        </Empty>
      </Card>
    )

  return (
    <div className="stack">
      <div className="field-head">
        <div>
          <span className="eyebrow">Environmental analysis</span>
          <h1>Climate &amp; water</h1>
          <p className="field-meta">
            {farm.name} · NASA POWER monthly means {analysis.climate.baselinePeriod} · ~50 km grid cell
          </p>
        </div>
        <Pill tone="info">MERRA-2 / SYN1DEG</Pill>
      </div>

      <div className="stat-grid">
        <Stat
          label="Precipitation trend"
          value={signed(i.precipTrendMmPerDecade)}
          unit="mm/decade"
          hint="Sen's slope on annual totals"
          tone={(i.precipTrendMmPerDecade ?? 0) < -10 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Temperature trend"
          value={signed(i.tempTrendCPerDecade, 2)}
          unit="°C/decade"
          hint="Sen's slope on annual means"
          tone={(i.tempTrendCPerDecade ?? 0) > 0.3 ? 'warn' : 'neutral'}
        />
        <Stat label="Reference ET₀" value={n(i.et0Mm)} unit="mm/yr" hint="Daily Hargreaves–Samani, ~5-year mean" />
        <Stat
          label="Frost-free period"
          value={n(i.frostFreeDays)}
          unit="days"
          hint="Daily data, last ~5 years"
        />
        <Stat label="Frost days" value={n(i.frostDays)} unit="/yr" hint="Minimum ≤ 0 °C" />
        <Stat
          label="Growing degree days"
          value={n(i.gdd10)}
          unit="GDD"
          hint="Base 10 °C, 5-year mean of annual totals"
        />
      </div>

      <Card
        title="Annual precipitation"
        subtitle={`${analysis.climate.baselinePeriod} annual totals from monthly values, mm`}
        right={<Pill tone="good">Observed record</Pill>}
      >
        <div className="chart">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={annual} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#1c2f3d" vertical={false} />
              <XAxis dataKey="year" {...axis} tickLine={false} />
              <YAxis {...axis} tickLine={false} width={48} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${Number(value)} mm`, 'Annual']} />
              <ReferenceLine
                y={meanPrecip}
                stroke="#7aa2b8"
                strokeDasharray="4 4"
                label={{ value: 'mean', fill: '#7aa2b8', fontSize: 10, position: 'insideTopRight' }}
              />
              <Bar dataKey="precipMm" fill="#3f8f6b" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="fineprint">
          Bars are model-assimilated grid-cell totals; the dashed line is the period mean
          ({Math.round(meanPrecip)} mm). Annual totals are sums of monthly means, not gauge records.
        </p>
      </Card>

      <div className="two-col">
        <Card title="Seasonal rainfall and root-zone wetness" subtitle="Monthly means, climatological">
          <div className="chart">
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={monthly} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#1c2f3d" vertical={false} />
                <XAxis dataKey="month" {...axis} tickLine={false} />
                <YAxis yAxisId="left" {...axis} tickLine={false} width={44} />
                <YAxis yAxisId="right" orientation="right" {...axis} tickLine={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar yAxisId="left" dataKey="precip" name="Precip (mm)" fill="#3f8f6b" radius={[2, 2, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="wetness"
                  name="Root wetness (%)"
                  stroke="#7fb4d8"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fineprint">
            Wetness is POWER root-zone soil wetness as a fraction ×100 — a land-surface model output,
            not SMAP. High wetness with low rainfall indicates stored water.
          </p>
        </Card>

        <Card title="Temperature envelope" subtitle="Monthly mean, and mean daily max/min from the daily record">
          <div className="chart">
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={monthly} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#1c2f3d" vertical={false} />
                <XAxis dataKey="month" {...axis} tickLine={false} />
                <YAxis {...axis} tickLine={false} width={44} unit="°" />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="tmax" name="Max" stroke="#f0a878" strokeWidth={1.6} dot={false} />
                <Line type="monotone" dataKey="tmean" name="Mean" stroke="#9fd8b8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="tmin" name="Min" stroke="#7fb4d8" strokeWidth={1.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="fineprint">
            Daily means use the 25-year monthly product; the max/min curves are means of daily
            extremes from the ~5-year daily record. POWER's monthly product reports the maximum of
            daily maxima and minimum of daily minima, so those values are deliberately not plotted
            as means. Frost risk appears where the minimum curve crosses 0 °C.
          </p>
        </Card>
      </div>

      <Card title="Indicator definitions" subtitle="What each derived number means">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Value</th>
                <th>Method</th>
                <th>Class</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Aridity index</td>
                <td className="mono">{n(i.aridityIndex, 2)}</td>
                <td>Mean annual precipitation ÷ annual reference ET₀</td>
                <td><Pill tone="warn">Derived</Pill></td>
              </tr>
              <tr>
                <td>12-month rainfall percentile</td>
                <td className="mono">{i.precipPercentile === null ? 'n/a' : `${i.precipPercentile}%`}</td>
                <td>Rank of the latest 12-month total among all rolling windows in the daily record</td>
                <td><Pill tone="warn">Derived</Pill></td>
              </tr>
              <tr>
                <td>Heat days ≥35 °C</td>
                <td className="mono">{n(i.heatDays35)}</td>
                <td>Mean annual count of daily maxima in the last ~5 complete years</td>
                <td><Pill tone="good">Observed (modelled grid)</Pill></td>
              </tr>
              <tr>
                <td>Dry spell</td>
                <td className="mono">{n(i.maxDrySpellDays)} days</td>
                <td>Mean of the longest run of days under 1 mm per year</td>
                <td><Pill tone="warn">Derived</Pill></td>
              </tr>
              <tr>
                <td>Root-zone wetness</td>
                <td className="mono">{n(i.soilWetnessMean, 2)}</td>
                <td>POWER GWETROOT monthly mean, 0–1 fraction</td>
                <td><Pill tone="warn">Modelled</Pill></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="fineprint">
          Sen's slope is the median of pairwise slopes across annual values; it describes the observed
          record, not a forecast. All values are for the POWER grid cell containing the field centroid.
        </p>
      </Card>
    </div>
  )
}
