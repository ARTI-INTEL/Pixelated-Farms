import 'maplibre-gl/dist/maplibre-gl.css'
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'
import { cropById } from '../shared/crops'
import { DEMO_FARMS } from '../shared/demo'
import type {
  Analysis,
  Farm,
  FarmInput,
  RecommendationSet,
  Session,
} from '../shared/types'
import { patchJson, postJson, request } from './api'
import { Assistant } from './components/Assistant'
import { Climate } from './components/Climate'
import { FieldMap } from './components/FieldMap'
import { Methods } from './components/Methods'
import { Overview } from './components/Overview'
import { Rotation } from './components/Rotation'
import { Empty, Pill } from './components/ui'
import { Vegetation } from './components/Vegetation'
import './style.css'

type View = 'overview' | 'climate' | 'vegetation' | 'rotation' | 'assistant' | 'methods'
type Stored = { analysis: Analysis; recommendation: RecommendationSet }

const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'climate', label: 'Climate' },
  { id: 'vegetation', label: 'Vegetation' },
  { id: 'rotation', label: 'Rotation' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'methods', label: 'Data & methods' },
]

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [farms, setFarms] = useState<Farm[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stored, setStored] = useState<Stored | null>(null)
  const [view, setView] = useState<View>('overview')
  const [showMap, setShowMap] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [error, setError] = useState('')

  const farm = useMemo(
    () => farms.find((entry) => entry.id === selectedId) ?? null,
    [farms, selectedId],
  )

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const current = await request<Session>('/api/session')
        if (!live) return
        setSession(current)
        if (current.user) {
          const body = await request<{ farms: Farm[] }>('/api/farms')
          if (!live) return
          setFarms(body.farms)
          if (body.farms.length) setSelectedId(body.farms[0].id)
        }
      } catch (caught) {
        if (live)
          setError(caught instanceof Error ? caught.message : 'Could not load the workspace.')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  // Load the last stored analysis whenever the selected field changes.
  useEffect(() => {
    if (!selectedId) {
      setStored(null)
      return
    }
    let live = true
    setLoadingAnalysis(true)
    void (async () => {
      try {
        const body = await request<Stored>(`/api/farms/${selectedId}/analysis`)
        if (live) setStored(body)
      } catch {
        if (live) setStored(null)
      } finally {
        if (live) setLoadingAnalysis(false)
      }
    })()
    return () => {
      live = false
    }
  }, [selectedId])

  async function analyze(farmId: string) {
    setBusy(true)
    setError('')
    try {
      const body = await postJson<Stored>(`/api/farms/${farmId}/analyze`, {})
      setStored(body)
      setView('overview')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Analysis failed.')
    } finally {
      setBusy(false)
    }
  }

  async function createField(input: FarmInput) {
    setBusy(true)
    setError('')
    try {
      const body = await postJson<{ farm: Farm }>('/api/farms', input)
      setFarms((previous) => [body.farm, ...previous])
      setSelectedId(body.farm.id)
      setShowMap(false)
      await analyze(body.farm.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the field.')
      setBusy(false)
    }
  }

  async function updateField(patch: Partial<FarmInput>) {
    if (!farm) return
    setBusy(true)
    setError('')
    try {
      const body = await patchJson<{ farm: Farm }>(`/api/farms/${farm.id}`, {
        name: patch.name ?? farm.name,
        boundary: patch.boundary ?? farm.boundary,
        previousCrop: patch.previousCrop ?? farm.previousCrop,
        irrigation: patch.irrigation ?? farm.irrigation,
        country: patch.country ?? farm.country,
        notes: patch.notes ?? farm.notes,
      })
      setFarms((previous) =>
        previous.map((entry) => (entry.id === body.farm.id ? body.farm : entry)),
      )
      await analyze(body.farm.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the field.')
      setBusy(false)
    }
  }

  async function removeField(id: string) {
    setBusy(true)
    try {
      await request(`/api/farms/${id}`, { method: 'DELETE' })
      setFarms((previous) => previous.filter((entry) => entry.id !== id))
      if (selectedId === id) {
        setSelectedId(null)
        setStored(null)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the field.')
    } finally {
      setBusy(false)
    }
  }

  async function addDemo(demo: (typeof DEMO_FARMS)[number]) {
    setBusy(true)
    setError('')
    try {
      const body = await postJson<{ farm: Farm }>('/api/farms', {
        name: demo.name,
        boundary: demo.boundary,
        previousCrop: demo.previousCrop,
        irrigation: demo.irrigation,
        country: demo.country,
        notes: demo.blurb,
      })
      setFarms((previous) => [body.farm, ...previous])
      setSelectedId(body.farm.id)
      await analyze(body.farm.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the demo field.')
      setBusy(false)
    }
  }

  const signedIn = Boolean(session?.user)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◈
          </span>
          <div>
            <strong>FIELDSHIFT</strong>
            <span>NASA-data crop rotation intelligence</span>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {farm &&
            VIEWS.map((entry) => (
              <button
                key={entry.id}
                className={view === entry.id && !showMap ? 'tab tab-active' : 'tab'}
                onClick={() => {
                  setView(entry.id)
                  setShowMap(false)
                }}
              >
                {entry.label}
              </button>
            ))}
        </nav>
        <div className="account">
          {session?.mode === 'local' && <Pill tone="info">Local preview identity</Pill>}
          {session?.user ? (
            <>
              <span className="account-name">{session.user.name || session.user.email || 'Signed in'}</span>
              <form method="post" action="/auth/freebuff/signout">
                <button className="btn-ghost">Sign out</button>
              </form>
            </>
          ) : session?.mode === 'freebuff' ? (
            <a className="btn-primary" href="/auth/freebuff/signin?returnTo=%2F">
              Sign in
            </a>
          ) : null}
        </div>
      </header>

      <div className="body-grid">
        {signedIn && (
          <aside className="sidebar">
            <div className="sidebar-head">
              <span>Fields</span>
              <button
                className="btn-ghost"
                onClick={() => {
                  setShowMap(true)
                  setError('')
                }}
              >
                + New
              </button>
            </div>
            <ul className="field-list">
              {farms.map((entry) => (
                <li key={entry.id}>
                  <button
                    className={entry.id === selectedId && !showMap ? 'field-item field-item-active' : 'field-item'}
                    onClick={() => {
                      setSelectedId(entry.id)
                      setShowMap(false)
                      setView('overview')
                    }}
                  >
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.areaHa.toFixed(1)} ha · {cropById(entry.previousCrop)?.name ?? 'no history'}
                    </span>
                  </button>
                </li>
              ))}
              {!farms.length && <li className="field-empty">No fields yet.</li>}
            </ul>

            <div className="sidebar-demos">
              <span>Demo districts</span>
              {DEMO_FARMS.map((demo) => (
                <button
                  key={demo.id}
                  className="demo-button"
                  title={demo.blurb}
                  disabled={busy}
                  onClick={() => void addDemo(demo)}
                >
                  {demo.name}
                </button>
              ))}
            </div>

            <p className="sidebar-note">
              Demo boundaries are approximate rectangles around real farming districts, not surveyed
              fields.
            </p>
          </aside>
        )}

        <main className="main">
          {error && (
            <p role="alert" className="notice notice-error">
              {error}
            </p>
          )}

          {loading ? (
            <div className="loading">Loading workspace…</div>
          ) : !signedIn ? (
            <section className="landing">
              <span className="eyebrow">NASA Space Apps Challenge 2026 · Field Shift</span>
              <h1>
                Satellite evidence for the
                <br />
                next crop you plant.
              </h1>
              <p className="landing-lede">
                Fieldshift turns NASA Earth observations into an explainable rotation plan: climate
                history from POWER, vegetation condition from MODIS, dated imagery from GIBS, and a
                transparent crop engine that shows its reasoning.
              </p>
              <div className="landing-actions">
                {session?.mode === 'freebuff' ? (
                  <a className="btn-primary" href="/auth/freebuff/signin?returnTo=%2F">
                    Sign in to map a field
                  </a>
                ) : (
                  <span className="muted">Sign-in is being configured for this deployment.</span>
                )}
                <button className="btn-ghost" onClick={() => setView('methods')}>
                  Read the methodology
                </button>
              </div>
              <div className="landing-grid">
                <article>
                  <span>01</span>
                  <h3>Map the field</h3>
                  <p>Search a place, draw the boundary and get an approximate area in hectares.</p>
                </article>
                <article>
                  <span>02</span>
                  <h3>Retrieve NASA data</h3>
                  <p>POWER climate, MODIS vegetation, dated GIBS imagery and a soil screening.</p>
                </article>
                <article>
                  <span>03</span>
                  <h3>Read the reasoning</h3>
                  <p>Six weighted components, the dataset behind each one, and the caveats.</p>
                </article>
                <article>
                  <span>04</span>
                  <h3>Plan the rotation</h3>
                  <p>Three-season sequences compared with continuing the current crop.</p>
                </article>
              </div>
              <p className="fineprint">
                NASA POWER and GIBS are open services. SMAP requires an Earthdata login and is shown as
                unavailable in this deployment rather than replaced with a modelled value.
              </p>
            </section>
          ) : showMap || !farm ? (
            <div className="stack">
              <div className="field-head">
                <div>
                  <span className="eyebrow">{farm ? 'Edit field' : 'New field'}</span>
                  <h1>{farm ? farm.name : 'Map your farmland'}</h1>
                  <p className="field-meta">
                    Click corners on the map, name the field, then retrieve NASA data for its centroid.
                  </p>
                </div>
                {farm && (
                  <div className="field-head-side">
                    <button className="btn-ghost" onClick={() => void analyze(farm.id)} disabled={busy}>
                      Refresh analysis
                    </button>
                    <button className="btn-ghost danger" onClick={() => void removeField(farm.id)} disabled={busy}>
                      Delete field
                    </button>
                  </div>
                )}
              </div>
              <FieldMap
                key={farm?.id ?? 'new'}
                initial={
                  farm
                    ? {
                        name: farm.name,
                        boundary: farm.boundary,
                        previousCrop: farm.previousCrop,
                        irrigation: farm.irrigation,
                        country: farm.country,
                        notes: farm.notes,
                      }
                    : null
                }
                busy={busy}
                onSave={(input) => {
                  if (farm) void updateField(input)
                  else void createField(input)
                }}
              />
              {!farm && (
                <div className="demo-strip">
                  <span>Or start from a demo district:</span>
                  {DEMO_FARMS.map((demo) => (
                    <button key={demo.id} className="chip" disabled={busy} onClick={() => void addDemo(demo)}>
                      {demo.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : loadingAnalysis && !stored ? (
            <div className="loading">Loading stored analysis…</div>
          ) : !stored ? (
            <div className="stack">
              <div className="field-head">
                <div>
                  <span className="eyebrow">Awaiting data</span>
                  <h1>{farm.name}</h1>
                  <p className="field-meta">
                    {farm.areaHa.toFixed(1)} ha · {cropById(farm.previousCrop)?.name ?? 'no previous crop'}
                  </p>
                </div>
              </div>
              <div className="panel">
                <Empty title="No NASA retrieval stored for this field">
                  Run the analysis to fetch POWER climate, MODIS vegetation and soil screening for this
                  field's centroid.
                </Empty>
                <button onClick={() => void analyze(farm.id)} disabled={busy}>
                  {busy ? 'Retrieving NASA data…' : 'Run NASA analysis'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {busy && <div className="busy-bar">Retrieving NASA services… this can take a few seconds.</div>}
              {view === 'overview' && (
                <Overview
                  farm={farm}
                  analysis={stored.analysis}
                  recommendation={stored.recommendation}
                  onOpen={(next) => setView(next)}
                />
              )}
              {view === 'climate' && <Climate farm={farm} analysis={stored.analysis} />}
              {view === 'vegetation' && <Vegetation farm={farm} analysis={stored.analysis} />}
              {view === 'rotation' && (
                <Rotation
                  farm={farm}
                  analysis={stored.analysis}
                  recommendation={stored.recommendation}
                />
              )}
              {view === 'assistant' && <Assistant farm={farm} ready />}
              {view === 'methods' && <Methods />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
