import type { ReactNode } from 'react'
import type { SourceRef } from '../../shared/types'

export function Card({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="panel-sub">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string | number | null
  unit?: string
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value === null || value === undefined ? <em>unavailable</em> : value}
        {value !== null && value !== undefined && unit ? <small>{unit}</small> : null}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}

export function Pill({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info'
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function Bar({ value, tone = 'good' }: { value: number; tone?: string }) {
  return (
    <div className="bar" role="presentation">
      <span className={`bar-fill bar-${tone}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Provenance({ source }: { source: SourceRef }) {
  return (
    <div className={`prov ${source.status === 'unavailable' ? 'prov-off' : ''}`}>
      <div className="prov-head">
        <strong>{source.dataset}</strong>
        <Pill tone={source.status === 'ok' ? 'good' : 'warn'}>
          {source.status === 'ok' ? 'retrieved' : 'unavailable'}
        </Pill>
      </div>
      <dl className="prov-grid">
        <div>
          <dt>Period</dt>
          <dd>{source.period}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>{source.resolution}</dd>
        </div>
        <div>
          <dt>Retrieved</dt>
          <dd>{source.retrievedAt ? new Date(source.retrievedAt).toLocaleString() : 'not retrieved'}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{source.provider}</dd>
        </div>
      </dl>
      {source.note && <p className="prov-note">{source.note}</p>}
      <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="prov-link">
        Dataset documentation ↗
      </a>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export const monthShort = (month: number) =>
  new Date(Date.UTC(2024, month - 1, 1)).toLocaleString('en', {
    month: 'short',
    timeZone: 'UTC',
  })
