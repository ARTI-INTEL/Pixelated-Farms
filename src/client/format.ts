export const n = (
  value: number | null | undefined,
  digits = 0,
  fallback = 'n/a',
) =>
  value === null || value === undefined
    ? fallback
    : value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })

export const signed = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined
    ? 'n/a'
    : `${value > 0 ? '+' : ''}${n(value, digits)}`

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'n/a'

export const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? 'n/a' : `${Math.round(value * 100)}%`
