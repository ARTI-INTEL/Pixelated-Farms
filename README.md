# Pixelated Farming

**NASA-data crop rotation intelligence** — a NASA Space Apps Challenge 2026 entry for
*Field Shift: Adapting Farms with NASA Data*.

Pixelated Farming turns NASA Earth observations into an explainable, season-by-season crop
rotation plan for a specific field. A farmer draws a boundary, the app retrieves climate,
vegetation, imagery and soil context, and a transparent scoring engine recommends crops and
rotations — showing the dataset, period, weight and caveat behind every number.

---

## The problem

Farmers are choosing next season's crop under shifting rainfall, more heat, water limits and
declining soil health. Satellite data exists, but it arrives as rasters, grids and variables that
do not answer the question a farmer actually asks: *what should I plant, and why?*

## What the app does

1. **Map a field** — search a place, click a boundary, get an approximate geodesic area in hectares.
   Multiple fields are saved per account.
2. **Retrieve NASA data** — POWER climate (25-year monthly means plus ~5 years daily),
   MODIS NDVI via the ORNL DAAC subsetting service, dated NASA GIBS imagery, and an ISRIC
   SoilGrids soil screening.
3. **Derive indicators** — growing-degree days, FAO-56 Hargreaves–Samani ET₀, aridity index,
   12-month rainfall percentile, Sen's slope trends, heat and frost days, dry spells, frost-free
   period, root-zone wetness and NDVI anomaly.
4. **Score and explain** — 15 crops scored on six weighted components, with confidence reported
   separately, component arithmetic exposed, three-season rotation plans compared against
   continuing the current crop.
5. **Ask questions** — a grounded assistant answers only from the stored field facts, refuses
   yield/profit/fertiliser-rate questions, and never claims satellites measure soil nutrients.

## Data sources and honest status

| Source | What it provides | Resolution / period | Status in this app |
|---|---|---|---|
| **NASA POWER** (MERRA-2, SYN1DEG) | Temperature, precipitation, solar irradiance, humidity, wind, root-zone wetness | 0.5° × 0.625° (~50 km); 1981 → near-real-time | Verified live. Modelled grid cell, not in-field sensors |
| **MODIS MOD13Q1 NDVI/EVI** (NASA LP DAAC, ORNL DAAC TESViS) | Vegetation condition and seasonality | 250 m, 16-day composites; 2000 → present | Intermittent — the service returned HTTP 502 during development, so the UI shows vegetation as **unavailable** rather than estimating |
| **NASA GIBS** (EOSDIS) | Dated MODIS/VIIRS true-colour imagery | 250 m–1 km rendered tiles | Verified live. Visualisation only, never used in scoring |
| **ISRIC SoilGrids 2.0** (non-NASA) | Clay/sand/silt, pH, organic carbon | 250 m global model | Verified live; 5 calls/min fair use. Model prediction, not a soil test |
| **NASA SMAP SPL3SMP_E** | Surface soil moisture | 9 km, daily | **Not configured** — requires NASA Earthdata Login. Shown as unavailable; no modelled value is substituted |

POWER's monthly product returns the *maximum of daily maxima* and *minimum of daily minima*, so
monthly temperature means and ET₀ are derived from the daily record instead.

## Recommendation method

Each crop is scored 0–100 as a weighted sum of six components:

| Component | Weight | Inputs |
|---|---|---|
| Temperature & heat | 22% | Seasonal mean temperature, days above the crop's heat limit, frost exposure |
| Seasonal water balance | 24% | Crop ET (Kc × ET₀) versus 75% effective rainfall, adjusted for irrigation |
| Season length (GDD fit) | 11% | Accumulated GDD versus crop requirement |
| Soil screening | 13% | pH range and texture/drainage preference (SoilGrids) |
| Rotation compatibility | 18% | Previous crop family, legume nitrogen credit, root-depth change |
| Climate risk | 12% | Heat days, rainfall variability, drying trend, aridity |

Confidence rises with data completeness (climate, daily extremes, soil, NDVI, known previous
crop) and is reported separately. Every component can be expanded in the UI to show its score,
weight, the arithmetic and the caveat. Rotation plans — balanced, soil-building, water-resilient
and "continue current crop" — are heuristic three-season proposals, not an optimisation.

Crop parameters (15 crops: Kc, root depth, season length, temperature/water ranges, legume N
credits) are reference ranges compiled from FAO Irrigation & Drainage Paper 56 and FAO ECOCROP.
They are labelled **non-NASA reference data** everywhere they appear.

## Architecture

```
Browser (React 19 + TypeScript + Tailwind + MapLibre + Recharts)
        │  same-origin REST
        ▼
Worker API (Hono)  ── Sign in with Freebuff, same-origin checks
        │
        ├── NASA POWER adapter      ┐
        ├── MODIS/ORNL adapter      │ paced requests, timeouts,
        ├── ISRIC SoilGrids adapter │ D1 cache + stale-cache fallback
        ├── NASA GIBS (browser tiles)
        └── Indicators → Engine → Grounded assistant
        │
        ▼
D1 (farms, analyses, cache)
```

- **Frontend:** React 19, TypeScript, Tailwind CSS 4, MapLibre GL, Recharts.
- **Backend:** TypeScript Worker (Hono) — a REST API with per-user scoping.
- **Storage:** D1 for fields, stored analyses and upstream response cache.
- **Auth:** Sign in with Freebuff (one clearly labelled local preview identity in development).
- **Imagery:** keyless Esri satellite/OSM basemaps with optional dated NASA GIBS overlay.
- **AI (optional):** server-side `OPENAI_API_KEY` calls an OpenAI-compatible endpoint; without a
  key, or on any failure, the deterministic grounded answers are used. The key never reaches the
  browser.

### Why the hosted backend is TypeScript, not FastAPI

The deployment target (Freebuff Sites) runs Workers and static assets, not Python servers. The
data retrieval, indicator derivation and scoring therefore live in the Worker, which also keeps
one deployable artifact for judges. A Python/FastAPI + GeoPandas/Rasterio ingest service for
credentialed Earthdata work (SMAP, AppEEARS zonal statistics) is **not included** in this
repository; it is listed under future work.

## Run locally

```sh
bun install
bun run dev        # http://localhost:5173, local D1, local preview identity
bun run typecheck  # client + worker TypeScript
bun test           # 11 tests: auth isolation, validation, geometry, engine, assistant
bun run build      # client bundle + Worker bundle in dist/
```

No NASA API keys are required. With no auth configuration on a loopback origin the app uses a
single labelled local preview identity; hosted deployments always use the real SDK.

### Configuration

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Optional. Enables LLM-phrased assistant answers |
| `ASSISTANT_MODEL` | Optional. Model id for that endpoint |
| `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER`, `APP_ORIGIN` | Injected by Sites; never set by hand |

Earthdata credentials are not used by this deployment. SMAP is displayed as unavailable.

### Deploying to Sites

1. Create the site and enable Sign in with Freebuff (preview environment first).
2. Provision D1 as the `DB` binding.
3. `bun run build`, then deploy with `deploy.json` (`dist/client` assets,
   `dist/pixelated_farming/index.js` worker).

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/session` | Session, auth mode, database availability |
| `GET` | `/api/datasets` | Dataset catalogue with limitations |
| `GET` | `/api/crops` | Crop reference profiles |
| `GET` | `/api/geo/search?q=` | Cached place search |
| `GET`/`POST` | `/api/farms` | List / create fields |
| `PATCH`/`DELETE` | `/api/farms/:id` | Update / delete a field |
| `POST` | `/api/farms/:id/analyze` | Retrieve NASA data, derive indicators, score crops |
| `GET` | `/api/farms/:id/analysis` | Last stored analysis and recommendation |
| `POST` | `/api/farms/:id/assistant` | Grounded question answering |

All field routes authenticate, scope queries by the signed-in user's `sub`, refuse foreign-origin
mutations and return `Cache-Control: private, no-store`.

## Demo fields

Story County (Iowa), Ludhiana (Punjab), Nakuru (Kenya) and Sorriso (Mato Grosso) ship as demo
districts. Their boundaries are **approximate rectangles around real farming districts**, not
surveyed fields.

## Limitations

- Scores rank agronomic suitability for modelled conditions. They are **not** yield, revenue or
  profit forecasts.
- POWER values describe a ~50 km grid cell; MODIS NDVI describes 250 m pixels. Neither measures
  inside-field soil nutrients, and the app says so in every relevant panel.
- SoilGrids is a global statistical model; a laboratory soil test should override it (the soil
  component accepts a neutral placeholder when data is missing and lowers confidence).
- NDVI is subject to upstream service availability and is never interpolated across gaps.
- SMAP requires Earthdata Login and is not available here.
- Crop parameters are global reference ranges, not local variety trials.
- Rotation planning is heuristic over three seasons; prices, labour and machinery are not modelled.

## Future work

- Earthdata-authenticated SMAP and AppEEARS ingest (Python/GeoPandas/Rasterio service) for
  measured soil moisture and field-scale zonal statistics.
- Local soil-test entry and calibration against farmer records.
- Wider crop library with regional variety parameters and planting-date optimisation.
- Price/cost and water-cost layers for whole-farm planning.
- Field validation with extension services and farmer cooperatives.

## Credits

Climate and soil-moisture fields: **NASA POWER** (NASA Langley Research Center), including MERRA-2
and SYN1DEG inputs. Vegetation indices: **MODIS MOD13Q1**, NASA LP DAAC, served by the **ORNL DAAC
TESViS** subsetting service. Imagery: **NASA EOSDIS GIBS / Worldview**. Soil: **ISRIC SoilGrids
2.0** (non-NASA). Basemaps: Esri World Imagery / OpenStreetMap contributors. Place search:
Photon / OpenStreetMap.

Pixelated Farming is an independent NASA Space Apps Challenge entry. It is not affiliated with or
endorsed by NASA. Outputs are for decision support and demonstration, not regulatory, financial or
agronomic advice.

## Authors

**Faiq, Aysha, Esha, Ayyan, Adeena**
