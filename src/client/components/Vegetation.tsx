import {
  CartesianGrid,
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
import { Card, Empty, Pill, Provenance, Stat } from './ui'

const axis = { stroke: '#5d7385', fontSize: 11 }
const tooltipStyle = {
  background: '#0d1b26',
  border: '1px solid #23394a',
  borderRadius: 8,
  fontSize: 12,
  color: '#e6f0ea',
}

export function Vegetation({ farm, analysis }: { farm: Farm; analysis: Analysis }) {
  const i = analysis.indicators
  const source = analysis.sources.find((entry) => entry.dataset.includes('MODIS'))
  const series = (analysis.vegetation?.series ?? []).map((point) => ({
    date: point.date.slice(2),
    ndvi: point.ndvi,
  }))

  return (
    <div className="stack">
      <div className="field-head">
        <div>
          <span className="eyebrow">Vegetation condition</span>
          <h1>Canopy &amp; seasonality</h1>
          <p className="field-meta">
            {farm.name} · {analysis.vegetation?.product ?? 'MODIS NDVI'} ·{' '}
            {analysis.vegetation?.resolution ?? '250 m'}
          </p>
        </div>
        <Pill tone={analysis.vegetation ? 'good' : 'warn'}>
          {analysis.vegetation ? 'NDVI retrieved' : 'NDVI unavailable'}
        </Pill>
      </div>

      {!analysis.vegetation ? (
        <Card title="Vegetation index unavailable" subtitle="No values are estimated or interpolated">
          <Empty title="ORNL DAAC didn't return NDVI for this retrieval">
            The MODIS/VIIRS subsetting service returned no usable data, so the app shows no NDVI
            value. The map still renders dated NASA GIBS imagery, which is a visualisation rather
            than an analysis layer.
          </Empty>
          <p className="fineprint">
            NDVI measures vegetation greenness, not soil nutrients, yield or crop type. See “Data &
            methods” for the service and its limits.
          </p>
          {source && <Provenance source={source} />}
        </Card>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Latest NDVI" value={n(i.ndviLatest, 2)} hint={analysis.vegetation.series.at(-1)?.date ?? ''} />
            <Stat label="Record mean" value={n(i.ndviMean, 2)} hint="All retrieved composites" />
            <Stat
              label="Recent anomaly"
              value={signed(i.ndviAnomaly, 3)}
              hint="Latest year vs earlier years in the record"
              tone={(i.ndviAnomaly ?? 0) < -0.05 ? 'warn' : 'good'}
            />
            <Stat label="Composites" value={analysis.vegetation.series.length} hint="16-day, QC-filtered" />
          </div>

          <Card
            title="NDVI time series"
            subtitle={`${analysis.vegetation.series[0]?.date ?? ''} → ${analysis.vegetation.series.at(-1)?.date ?? ''} · 3×3 pixel window at the field centroid`}
          >
            <div className="chart chart-tall">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={series} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="#1c2f3d" vertical={false} />
                  <XAxis dataKey="date" {...axis} tickLine={false} minTickGap={40} />
                  <YAxis {...axis} tickLine={false} width={44} domain={[0, 1]} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => [Number(value).toFixed(3), 'NDVI']} />
                  <ReferenceLine y={i.ndviMean ?? 0.5} stroke="#7aa2b8" strokeDasharray="4 4" />
                  <Line
                    type="monotone"
                    dataKey="ndvi"
                    stroke="#7dd3a8"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="fineprint">
              Gaps are real: missing or QC-failed composites are left empty instead of interpolated.
              Peaks show the growing season; a lower peak than previous years is a vegetation signal,
              not a drought measurement on its own.
            </p>
          </Card>

          <Card title="How this is used" subtitle="And what it is not used for">
            <ul className="bullet-list">
              <li>Describes vegetation vigour and seasonality for the field pixel; it does not identify the crop.</li>
              <li>Never used as a soil-nutrient measurement, and not converted into a yield estimate.</li>
              <li>Contributes to confidence, and appears in the assistant's evidence, but does not directly alter crop scoring.</li>
              <li>250 m pixels mix the field with field margins, tracks and neighbouring crops.</li>
            </ul>
            {source && <Provenance source={source} />}
          </Card>
        </>
      )}
    </div>
  )
}
