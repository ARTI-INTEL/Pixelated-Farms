import { isSameOriginRequest } from '@freebuff/auth'
import type { FreebuffUser } from '@freebuff/auth'
import { Hono, type Handler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cropById, CROPS } from '../shared/crops'
import { DATASETS } from '../shared/datasets'
import type { Farm, FarmInput, GeoResult, Irrigation } from '../shared/types'
import { answerQuestion } from './assistant'
import { appOrigin, currentUser, isLocalPreview, type Env } from './auth'
import { ensureSchema, mapFarm, readCache, writeCache, type FarmRow } from './db'
import { centroid, geocode, normalizeRing, ringAreaHa } from './geo'
import { analyzeFarm, readAnalysis } from './service'

type AppContext = {
  Bindings: Env
  Variables: { user: FreebuffUser; db: D1Database }
}
type Authenticate = (request: Request, env: Env) => Promise<FreebuffUser | null>

const IRRIGATION: Irrigation[] = ['rainfed', 'irrigated', 'mixed']
const isIrrigation = (value: unknown): value is Irrigation =>
  typeof value === 'string' && IRRIGATION.includes(value as Irrigation)

function parseFarmBody(body: unknown): { value: FarmInput; error?: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const input = body as Record<string, unknown>
  const allowed = new Set([
    'name',
    'boundary',
    'previousCrop',
    'irrigation',
    'country',
    'notes',
  ])
  if (Object.keys(input).some((key) => !allowed.has(key))) return null

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 2 || name.length > 80)
    return { value: {} as FarmInput, error: 'Give the field a name between 2 and 80 characters.' }

  const boundary = normalizeRing(input.boundary)
  if (!boundary)
    return {
      value: {} as FarmInput,
      error: 'Draw a field boundary with at least 3 valid points (and no more than 500).',
    }
  const areaHa = ringAreaHa(boundary)
  if (areaHa < 0.05 || areaHa > 100_000)
    return { value: {} as FarmInput, error: 'The field area must be between 0.05 and 100,000 ha.' }

  if (input.irrigation !== undefined && !isIrrigation(input.irrigation))
    return { value: {} as FarmInput, error: 'Choose rainfed, irrigated or mixed.' }

  let previousCrop: string | null = null
  if (input.previousCrop !== undefined && input.previousCrop !== null) {
    if (typeof input.previousCrop !== 'string' || !cropById(input.previousCrop))
      return { value: {} as FarmInput, error: 'Select a previous crop from the list.' }
    previousCrop = input.previousCrop
  }

  const country =
    typeof input.country === 'string' && input.country.trim()
      ? input.country.trim().slice(0, 80)
      : null
  const notes =
    typeof input.notes === 'string' && input.notes.trim()
      ? input.notes.trim().slice(0, 500)
      : null

  return {
    value: {
      name,
      boundary,
      previousCrop,
      irrigation: isIrrigation(input.irrigation) ? input.irrigation : 'rainfed',
      country,
      notes,
    },
  }
}

export function createApp(authenticate: Authenticate = currentUser) {
  const app = new Hono<AppContext>()
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 96 * 1024,
      onError: (c) => c.json({ error: 'Request is too large.' }, 413),
    }),
  )
  app.get('/api/session', async (c) =>
    c.json({
      user: await authenticate(c.req.raw, c.env),
      mode: isLocalPreview(c.req.raw, c.env)
        ? 'local'
        : c.env.FREEBUFF_CLIENT_ID && c.env.APP_ORIGIN
          ? 'freebuff'
          : 'setup',
      database: Boolean(c.env.DB),
    }),
  )

  app.get('/api/datasets', (c) => c.json({ datasets: DATASETS }))
  app.get('/api/crops', (c) =>
    c.json({
      crops: CROPS.map((crop) => ({
        id: crop.id,
        name: crop.name,
        family: crop.family,
        seasonDays: crop.seasonDays,
      })),
    }),
  )

  app.get('/api/geo/search', async (c) => {
    if (!c.env.DB) return c.json({ results: [] satisfies GeoResult[] })
    const query = (c.req.query('q') ?? '').trim()
    if (query.length < 2) return c.json({ results: [] })
    if (query.length > 120) return c.json({ error: 'Search text is too long.' }, 400)
    await ensureSchema(c.env.DB)
    const key = `geo:v1:${query.toLowerCase()}`
    const cached = await readCache<GeoResult[]>(c.env.DB, key, 30 * 86_400_000)
    if (cached && !cached.stale) return c.json({ results: cached.value, cached: true })
    try {
      const results = await geocode(query)
      await writeCache(c.env.DB, key, results).catch(() => undefined)
      return c.json({ results })
    } catch {
      return c.json(
        { results: cached?.value ?? [], error: 'Place search is unavailable. Drop a point on the map instead.' },
        200,
      )
    }
  })

  app.use('/api/farms/*', async (c, next) => {
    const user = await authenticate(c.req.raw, c.env)
    if (!user) return c.json({ error: 'Sign in required.' }, 401)
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = appOrigin(c.req.raw, c.env)
      if (!origin || !isSameOriginRequest(c.req.raw, origin))
        return c.json({ error: 'Cross-origin request refused.' }, 403)
    }
    if (!c.env.DB)
      return c.json(
        { error: 'This app is still being set up. Please try again later.' },
        503,
      )
    await ensureSchema(c.env.DB)
    c.set('user', user)
    c.set('db', c.env.DB)
    await next()
  })

  app.get('/api/farms', async (c) => {
    const rows = await c
      .get('db')
      .prepare(
        'SELECT id, name, boundary, area_ha, centroid_lng, centroid_lat, previous_crop, irrigation, country, notes, created_at, updated_at FROM farms WHERE owner_sub = ? ORDER BY created_at DESC',
      )
      .bind(c.get('user').sub)
      .all<FarmRow>()
    return c.json({ farms: rows.results.map(mapFarm) })
  })

  app.post('/api/farms', async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    const parsed = parseFarmBody(body)
    if (!parsed) return c.json({ error: 'Invalid field payload.' }, 400)
    if (parsed.error || !parsed.value.name)
      return c.json({ error: parsed.error ?? 'Invalid field.' }, 400)
    const input = parsed.value
    const [lng, lat] = centroid(input.boundary)
    const farm: Farm = {
      id: crypto.randomUUID(),
      name: input.name,
      boundary: input.boundary,
      areaHa: Number(ringAreaHa(input.boundary).toFixed(2)),
      centroid: [lng, lat],
      previousCrop: input.previousCrop ?? null,
      irrigation: input.irrigation ?? 'rainfed',
      country: input.country ?? null,
      notes: input.notes ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await c
      .get('db')
      .prepare(
        'INSERT INTO farms (id, owner_sub, name, boundary, area_ha, centroid_lng, centroid_lat, previous_crop, irrigation, country, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        farm.id,
        c.get('user').sub,
        farm.name,
        JSON.stringify(farm.boundary),
        farm.areaHa,
        lng,
        lat,
        farm.previousCrop,
        farm.irrigation,
        farm.country,
        farm.notes,
        farm.createdAt,
        farm.updatedAt,
      )
      .run()
    return c.json({ farm }, 201)
  })

  app.patch('/api/farms/:id', async (c) => {
    const db = c.get('db')
    const owner = c.get('user').sub
    const existing = await db
      .prepare('SELECT * FROM farms WHERE id = ? AND owner_sub = ?')
      .bind(c.req.param('id'), owner)
      .first<FarmRow>()
    if (!existing) return c.json({ error: 'Field not found.' }, 404)
    const current = mapFarm(existing)
    const body: unknown = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return c.json({ error: 'Invalid field payload.' }, 400)
    const raw = body as Record<string, unknown>
    const editable = new Set([
      'name',
      'boundary',
      'previousCrop',
      'irrigation',
      'country',
      'notes',
    ])
    if (Object.keys(raw).some((key) => !editable.has(key)))
      return c.json({ error: 'Invalid field payload.' }, 400)
    const parsed = parseFarmBody({
      name: current.name,
      boundary: current.boundary,
      previousCrop: current.previousCrop,
      irrigation: current.irrigation,
      country: current.country,
      notes: current.notes,
      ...raw,
    })
    if (!parsed) return c.json({ error: 'Invalid field payload.' }, 400)
    if (parsed.error) return c.json({ error: parsed.error }, 400)
    const input = parsed.value
    const [lng, lat] = centroid(input.boundary)
    await db
      .prepare(
        'UPDATE farms SET name = ?, boundary = ?, area_ha = ?, centroid_lng = ?, centroid_lat = ?, previous_crop = ?, irrigation = ?, country = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_sub = ?',
      )
      .bind(
        input.name,
        JSON.stringify(input.boundary),
        Number(ringAreaHa(input.boundary).toFixed(2)),
        lng,
        lat,
        input.previousCrop ?? null,
        input.irrigation ?? 'rainfed',
        input.country ?? null,
        input.notes ?? null,
        Date.now(),
        c.req.param('id'),
        owner,
      )
      .run()
    const updated = await db
      .prepare('SELECT * FROM farms WHERE id = ? AND owner_sub = ?')
      .bind(c.req.param('id'), owner)
      .first<FarmRow>()
    return c.json({ farm: mapFarm(updated!) })
  })

  app.delete('/api/farms/:id', async (c) => {
    const removed = await c
      .get('db')
      .prepare('DELETE FROM farms WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), c.get('user').sub)
      .first()
    if (!removed) return c.json({ error: 'Field not found.' }, 404)
    await c
      .get('db')
      .prepare('DELETE FROM analyses WHERE farm_id = ? AND owner_sub = ?')
      .bind(c.req.param('id'), c.get('user').sub)
      .run()
    return c.json({ ok: true })
  })

  app.post('/api/farms/:id/analyze', async (c) => {
    const db = c.get('db')
    const owner = c.get('user').sub
    const row = await db
      .prepare('SELECT * FROM farms WHERE id = ? AND owner_sub = ?')
      .bind(c.req.param('id'), owner)
      .first<FarmRow>()
    if (!row) return c.json({ error: 'Field not found.' }, 404)
    const payload = await analyzeFarm(db, mapFarm(row), owner)
    return c.json(payload)
  })

  app.get('/api/farms/:id/analysis', async (c) => {
    const payload = await readAnalysis(
      c.get('db'),
      c.req.param('id'),
      c.get('user').sub,
    )
    if (!payload) return c.json({ error: 'No analysis yet for this field.' }, 404)
    return c.json(payload)
  })

  const ask: Handler<AppContext> = async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof (body as { question?: unknown }).question !== 'string' ||
      Object.keys(body).some((key) => key !== 'question')
    )
      return c.json({ error: 'Ask a question as plain text.' }, 400)
    const question = (body as { question: string }).question.trim()
    if (question.length < 3 || question.length > 500)
      return c.json({ error: 'Questions must be 3–500 characters.' }, 400)

    const db = c.get('db')
    const owner = c.get('user').sub
    const row = await db
      .prepare('SELECT * FROM farms WHERE id = ? AND owner_sub = ?')
      .bind(c.req.param('id'), owner)
      .first<FarmRow>()
    if (!row) return c.json({ error: 'Field not found.' }, 404)
    const stored = await readAnalysis(db, c.req.param('id')!, owner)
    if (!stored)
      return c.json(
        { error: 'Run the field analysis first so the assistant has real data to reason over.' },
        409,
      )
    const answer = await answerQuestion(
      c.env,
      question,
      mapFarm(row),
      stored.analysis,
      stored.recommendation,
    )
    return c.json(answer)
  }
  app.post('/api/farms/:id/assistant', ask)

  app.notFound((c) =>
    c.req.path === '/api' || c.req.path.startsWith('/api/')
      ? c.json({ error: 'Endpoint not found.' }, 404)
      : c.env.ASSETS.fetch(c.req.raw),
  )
  app.onError((error, c) => {
    console.error('Fieldshift error', error)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  })
  return app
}
