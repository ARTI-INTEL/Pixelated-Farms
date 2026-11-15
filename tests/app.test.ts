import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Miniflare } from 'miniflare'
import { createApp } from '../src/worker/app'
import { currentUser, type Env } from '../src/worker/auth'

const runtime = new Miniflare({
  workers: [
    {
      config: {
        name: 'test-db',
        compatibilityDate: '2026-11-11',
        manifest: {
          mainModule: 'index.js',
          modules: {
            'index.js': {
              type: 'esm',
              contents:
                'export default { fetch() { return new Response("test") } }',
            },
          },
        },
        env: { DB: { type: 'd1', name: 'pixelated-farming-test' } },
      },
    },
  ],
  port: 0,
})
let env: Env
beforeAll(async () => {
  const db = await runtime.getD1Database('DB')
  env = {
    DB: db as unknown as D1Database,
    APP_ORIGIN: 'https://app.example.test',
    ASSETS: {
      fetch: async () => new Response('public page'),
    } as unknown as Fetcher,
  }
}, 20_000)
afterAll(() => runtime.dispose())

// Test identities are injected into the app factory only; the shipped Worker
// always uses the real auth SDK.
const app = createApp(async (request) => {
  const sub = request.headers.get('test-user')
  return sub ? { sub } : null
})
const call = (
  path: string,
  user?: string,
  method = 'GET',
  body?: unknown,
  origin = env.APP_ORIGIN!,
) =>
  app.request(
    `https://app.example.test${path}`,
    {
      method,
      headers: {
        ...(user ? { 'test-user': user } : {}),
        Origin: origin,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  )

const square = (lng: number, lat: number, size = 0.01) => [
  [lng - size / 2, lat - size / 2],
  [lng + size / 2, lat - size / 2],
  [lng + size / 2, lat + size / 2],
  [lng - size / 2, lat + size / 2],
]

test('private routes refuse anonymous access while public routes stay open', async () => {
  for (const [path, method] of [
    ['/api/farms', 'GET'],
    ['/api/farms', 'POST'],
    ['/api/farms/absent/analysis', 'GET'],
    ['/api/farms/absent/analyze', 'POST'],
    ['/api/farms/absent/assistant', 'POST'],
  ]) {
    const response = await call(path!, undefined, method)
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
  expect(await (await call('/')).text()).toBe('public page')
  expect((await call('/api/health')).status).toBe(200)
  const datasets = await call('/api/datasets')
  expect(datasets.status).toBe(200)
  const body = (await datasets.json()) as { datasets: { id: string }[] }
  expect(body.datasets.map((entry) => entry.id)).toContain('power')
  expect(body.datasets.map((entry) => entry.id)).toContain('smap')
})

test('fields are created, listed, updated and deleted per owner with a computed area', async () => {
  const created = await call('/api/farms', 'alice', 'POST', {
    name: '  North quarter  ',
    boundary: square(-93.6, 42.0),
    previousCrop: 'maize',
    irrigation: 'rainfed',
  })
  expect(created.status).toBe(201)
  const { farm } = (await created.json()) as {
    farm: { id: string; name: string; areaHa: number; centroid: [number, number] }
  }
  expect(farm.name).toBe('North quarter')
  // A 0.01° square near 42°N is roughly 110 ha; allow the spherical approximation.
  expect(farm.areaHa).toBeGreaterThan(80)
  expect(farm.areaHa).toBeLessThan(140)
  expect(farm.centroid[1]).toBeCloseTo(42.0, 3)

  const listed = (await (await call('/api/farms', 'alice')).json()) as {
    farms: { id: string }[]
  }
  expect(listed.farms).toHaveLength(1)
  expect(
    ((await (await call('/api/farms', 'bob')).json()) as { farms: unknown[] }).farms,
  ).toHaveLength(0)

  expect(
    (
      await call(`/api/farms/${farm.id}`, 'bob', 'PATCH', {
        name: 'Stolen field',
      })
    ).status,
  ).toBe(404)
  expect((await call(`/api/farms/${farm.id}`, 'bob', 'DELETE')).status).toBe(404)

  const updated = await call(`/api/farms/${farm.id}`, 'alice', 'PATCH', {
    name: 'North quarter',
    boundary: square(-93.6, 42.0),
    previousCrop: 'soybean',
    irrigation: 'irrigated',
  })
  expect(updated.status).toBe(200)
  expect(await updated.json()).toMatchObject({
    farm: { previousCrop: 'soybean', irrigation: 'irrigated' },
  })

  // No NASA call is made here: analysis is absent until requested.
  expect((await call(`/api/farms/${farm.id}/analysis`, 'alice')).status).toBe(404)
  expect(
    (
      await call(`/api/farms/${farm.id}/assistant`, 'alice', 'POST', {
        question: 'What should I plant?',
      })
    ).status,
  ).toBe(409)

  expect((await call(`/api/farms/${farm.id}`, 'alice', 'DELETE')).status).toBe(200)
  expect(
    ((await (await call('/api/farms', 'alice')).json()) as { farms: unknown[] }).farms,
  ).toHaveLength(0)
})

test('rejects foreign origins, owner spoofing, bad geometry and oversized bodies', async () => {
  expect(
    (
      await call(
        '/api/farms',
        'alice',
        'POST',
        { name: 'Bad origin', boundary: square(10, 10) },
        'https://foreign.example',
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await app.request(
        'https://app.example.test/api/farms',
        {
          method: 'POST',
          headers: { 'test-user': 'alice' },
          body: JSON.stringify({ name: 'No origin', boundary: square(10, 10) }),
        },
        env,
      )
    ).status,
  ).toBe(403)

  const invalidBodies: unknown[] = [
    { name: 'x', boundary: square(10, 10) },
    { name: 'Two points', boundary: [[1, 1], [2, 2]] },
    { name: 'Out of range', boundary: [[0, 0], [0, 91], [1, 1]] },
    { name: 'Bad crop', boundary: square(10, 10), previousCrop: 'banana' },
    { name: 'Bad water', boundary: square(10, 10), irrigation: 'flooded' },
    { name: 'Owner spoof', boundary: square(10, 10), owner_sub: 'bob' },
    { name: 'Tiny', boundary: [[0, 0], [0.00001, 0], [0.00001, 0.00001]] },
  ]
  for (const body of invalidBodies)
    expect((await call('/api/farms', 'alice', 'POST', body)).status).toBe(400)

  const huge = {
    name: 'Huge',
    boundary: square(10, 10),
    notes: 'x'.repeat(120_000),
  }
  expect((await call('/api/farms', 'alice', 'POST', huge)).status).toBe(413)
})

test('missing database reports setup while the local preview identity never activates on hosted origins', async () => {
  const noDb = await app.request(
    'https://app.example.test/api/farms',
    { headers: { 'test-user': 'alice' } },
    { ...env, DB: undefined },
  )
  expect(noDb.status).toBe(503)
  expect(
    await currentUser(new Request('https://app.example.test/'), {} as Env),
  ).toBeNull()
  expect(
    await currentUser(new Request('http://localhost:5000/'), {
      APP_ORIGIN: 'https://app.example.test',
    } as Env),
  ).toBeNull()
  expect(
    await currentUser(new Request('http://localhost:5000/'), {} as Env),
  ).toMatchObject({ sub: 'local-preview' })
})
