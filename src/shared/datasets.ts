import type { DatasetDoc } from './types'

/**
 * The dataset catalogue shown in the app. Status is deliberately conservative:
 * a dataset is only "verified" when this deployment can retrieve it live.
 */
export const DATASETS: DatasetDoc[] = [
  {
    id: 'power',
    name: 'NASA POWER — Daily & Monthly Agroclimatology',
    provider: 'NASA Langley Research Center (LaRC) POWER Project',
    purpose:
      'Baseline climate, seasonal water balance, growing-degree-day accumulation, heat/frost exposure and drought history for the field.',
    variables: [
      'T2M — mean 2 m air temperature (°C)',
      'T2M_MAX / T2M_MIN — daily extremes (°C)',
      'PRECTOTCORR — bias-corrected precipitation (mm/day)',
      'ALLSKY_SFC_SW_DWN — all-sky shortwave irradiance (MJ/m²/day)',
      'RH2M — relative humidity at 2 m (%)',
      'WS2M — wind speed at 2 m (m/s)',
      'GWETROOT / GWETTOP — root-zone and surface soil wetness (fraction)',
    ],
    resolution:
      '0.5° × 0.625° meteorological grid (~50 × 70 km at mid-latitudes); solar parameters 1° × 1°. Not a field measurement.',
    cadence: 'Daily, 1981 to near-real-time; monthly and 25-year climatology products',
    access: 'Open REST API, no key required; documented 429 rate limiting',
    limitations: [
      'Values are modelled/assimilated grid-cell values (MERRA-2, with SYN1DEG solar), not sensors inside the field.',
      'The full grid cell is returned for the field centroid, so within-field variability is invisible.',
      'Recent days are preliminary and are replaced by improved climate-quality products within 2–3 months.',
      'Soil wetness is a land-surface model output, not an SMAP retrieval.',
    ],
    contribution:
      'Supplies the climate baseline and every seasonal water/temperature indicator used by the recommendation engine.',
    status: 'verified',
    sourceUrl: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
  },
  {
    id: 'modis',
    name: 'MODIS / VIIRS Vegetation Indices (MOD13Q1, VNP13A1)',
    provider: 'NASA LP DAAC, served by ORNL DAAC TESViS subsetting service',
    purpose:
      'Vegetation condition and seasonality: NDVI/EVI history for the field pixel, used to describe vegetation vigour and anomalies.',
    variables: [
      '250m_16_days_NDVI (MOD13Q1, MODIS Terra)',
      '250m_16_days_EVI',
      'VNP13A1 500 m NDVI/EVI (VIIRS, where selected)',
    ],
    resolution: '250 m (MODIS) / 500 m (VIIRS), 16-day composites, QC-filtered',
    cadence: '16-day composites, 2000–present (MODIS), 2012–present (VIIRS)',
    access:
      'ORNL DAAC TESViS web service, no key. Subset API allows at most 10 composite dates per request. Service availability is not guaranteed.',
    limitations: [
      'NDVI measures vegetation greenness, not soil nutrients, yield, or crop variety.',
      'A 250 m pixel mixes the field with roads, hedgerows and neighbouring crops.',
      'Cloud and QC filtering creates gaps; this app never interpolates across missing composites.',
      'The subsetting service has been intermittently unavailable during development (HTTP 502), so the UI can show vegetation as unavailable rather than estimated.',
    ],
    contribution:
      'Adds an observed vegetation signal on top of the climate record, and a seasonal curve that can be compared with rainfall.',
    status: 'degraded',
    sourceUrl: 'https://modis.ornl.gov/data/modis_webservice.html',
  },
  {
    id: 'gibs',
    name: 'NASA GIBS — Global Imagery Browse Services',
    provider: 'NASA EOSDIS GIBS / Worldview',
    purpose:
      'Dated true-colour satellite imagery for visual context and before/after comparison of the field area.',
    variables: [
      'MODIS_Terra_CorrectedReflectance_TrueColor',
      'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    ],
    resolution: '250 m–1 km rendered tiles, Web Mercator, zoom ≤ 9 native',
    cadence: 'Daily imagery from 2000 (MODIS) / 2012 (VIIRS)',
    access: 'Open WMTS/XYZ tile service, no key',
    limitations: [
      'GIBS serves rendered imagery for visualisation; pixel colours are not calibrated analysis values.',
      'Native resolution stops around 250 m, so individual fields appear as a few pixels.',
      'Cloud cover can obscure the target date.',
    ],
    contribution:
      'Gives the farmer and judges a visual, dated view of the landscape without pretending it is a measurement layer.',
    status: 'verified',
    sourceUrl: 'https://nasa-gibs.github.io/gibs-api-docs/access-basics/',
  },
  {
    id: 'soilgrids',
    name: 'ISRIC SoilGrids 2.0 (non-NASA soil survey)',
    provider: 'ISRIC — World Soil Information',
    purpose:
      'Soil texture, pH and organic carbon to screen crop suitability where the farmer has no soil test.',
    variables: [
      'clay, sand, silt (%, 0–30 cm)',
      'phh2o (pH, 0–30 cm)',
      'soc (soil organic carbon, g/kg, 0–30 cm)',
      '90% prediction interval (model uncertainty)',
    ],
    resolution: '250 m global prediction grid',
    cadence: 'Static global model product (no observation date)',
    access: 'Open REST API, no key; fair-use limit of 5 calls per minute',
    limitations: [
      'A global statistical model, not a laboratory test of this field.',
      'Not a NASA product and must never be labelled as satellite-measured soil chemistry.',
      'No nutrient (N-P-K) values are used; the app explicitly does not claim satellite nutrient measurement.',
      'Farmers can override texture and pH with their own soil test.',
    ],
    contribution:
      'Provides the only soil physical/chemical screening in the engine, with a confidence penalty from its prediction interval.',
    status: 'verified',
    sourceUrl: 'https://rest.isric.org/',
  },
  {
    id: 'smap',
    name: 'NASA SMAP — Soil Moisture Active Passive (SPL3SMP_E)',
    provider: 'NASA NSIDC DAAC',
    purpose:
      'Measured surface soil moisture (top ~5 cm) for field water-stress context, where credentials are configured.',
    variables: ['soil_moisture (cm³/cm³)', 'soil_moisture_qual_flag', 'retrieval quality'],
    resolution: '9 km enhanced radiometer grid, daily',
    cadence: 'Daily, 2015–present',
    access:
      'Requires a free NASA Earthdata Login; HDF5 files must be subset and read server-side (Python ingest).',
    limitations: [
      'Requires Earthdata credentials that are not configured in this deployment, so SMAP values are shown as unavailable.',
      '9 km resolution is far coarser than a field and is not usable for within-field irrigation decisions.',
      'The top ~5 cm responds to recent rain, not to root-zone plant-available water.',
      'This app never substitutes a modelled value and labels it as SMAP.',
    ],
    contribution:
      'Planned measured-moisture layer; until credentials exist, the app uses POWER modelled soil wetness, clearly labelled.',
    status: 'credentialed',
    sourceUrl: 'https://nsidc.org/data/spl3smp_e/versions/6',
  },
]
