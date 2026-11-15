import type { Farm, LngLat } from '../shared/types'

const schema = [
  `CREATE TABLE IF NOT EXISTS farms (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    name TEXT NOT NULL,
    boundary TEXT NOT NULL,
    area_ha REAL NOT NULL,
    centroid_lng REAL NOT NULL,
    centroid_lat REAL NOT NULL,
    previous_crop TEXT,
    irrigation TEXT NOT NULL,
    country TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS farms_owner_created ON farms(owner_sub, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS analyses (
    farm_id TEXT NOT NULL,
    owner_sub TEXT NOT NULL,
    payload TEXT NOT NULL,
    retrieved_at INTEGER NOT NULL,
    PRIMARY KEY (farm_id, owner_sub)
  )`,
  `CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS geocache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  )`,
]

const ready = new WeakMap<D1Database, Promise<void>>()
export function ensureSchema(db: D1Database): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = db
      .batch(schema.map((sql) => db.prepare(sql)))
      .then(() => undefined)
      .catch((error) => {
        ready.delete(db)
        throw error
      })
    ready.set(db, pending)
  }
  return pending
}

export type FarmRow = {
  id: string
  name: string
  boundary: string
  area_ha: number
  centroid_lng: number
  centroid_lat: number
  previous_crop: string | null
  irrigation: string
  country: string | null
  notes: string | null
  created_at: number
  updated_at: number
}

export const mapFarm = (row: FarmRow): Farm => ({
  id: row.id,
  name: row.name,
  boundary: JSON.parse(row.boundary) as LngLat[],
  areaHa: row.area_ha,
  centroid: [row.centroid_lng, row.centroid_lat],
  previousCrop: row.previous_crop,
  irrigation:
    row.irrigation === 'irrigated' || row.irrigation === 'mixed'
      ? row.irrigation
      : 'rainfed',
  country: row.country,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function readCache<T>(
  db: D1Database,
  key: string,
  maxAgeMs: number,
): Promise<{ value: T; fetchedAt: number; stale: boolean } | null> {
  const row = await db
    .prepare('SELECT payload, fetched_at FROM cache WHERE key = ?')
    .bind(key)
    .first<{ payload: string; fetched_at: number }>()
  if (!row) return null
  try {
    return {
      value: JSON.parse(row.payload) as T,
      fetchedAt: row.fetched_at,
      stale: Date.now() - row.fetched_at > maxAgeMs,
    }
  } catch {
    return null
  }
}

export async function writeCache(db: D1Database, key: string, value: unknown) {
  await db
    .prepare(
      'INSERT INTO cache (key, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at',
    )
    .bind(key, JSON.stringify(value), Date.now())
    .run()
}
