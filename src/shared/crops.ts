/**
 * Crop agronomic reference profiles.
 *
 * IMPORTANT: none of these values are NASA Earth-observation products. They are
 * compiled reference ranges from FAO Irrigation & Drainage Paper 56 (Kc, rooting
 * depth, season length, depletion) and FAO ECOCROP (temperature and water
 * requirement ranges), rounded for decision support. They are deliberately
 * ranges, shown to the user as reference data, and should be replaced by local
 * extension-service values before any operational use.
 */
export type CropFamily =
  | 'cereal'
  | 'legume'
  | 'oilseed'
  | 'root'
  | 'forage'

export type CropProfile = {
  id: string
  name: string
  family: CropFamily
  lifecycle: 'cool-season annual' | 'warm-season annual' | 'perennial'
  /** Base temperature for growing-degree-day accumulation, °C. */
  gddBase: number
  /** Approximate GDD to maturity. */
  gddMaturity: number
  /** Mid-season crop coefficient (FAO-56). */
  kcMid: number
  /** Typical season length in days. */
  seasonDays: number
  /** Seasonal crop water requirement range, mm. */
  waterReqMm: [number, number]
  /** Air temperature range for satisfactory growth, °C. */
  tempRange: [number, number]
  /** Temperature above which heat stress is expected, °C. */
  heatLimit: number
  /** Frost sensitivity of the growing crop. */
  frostSensitive: boolean
  phRange: [number, number]
  /** Preferred drainage; used with the SoilGrids texture class. */
  drainage: 'well' | 'moderate' | 'poor'
  rootDepthCm: number
  nFixer: boolean
  /** Approximate symbiotic nitrogen credit for the following crop, kg N/ha. */
  nCreditKgHa: number
  residue: 'high' | 'medium' | 'low'
  note: string
}

export const CROPS: CropProfile[] = [
  {
    id: 'winter-wheat',
    name: 'Winter wheat',
    family: 'cereal',
    lifecycle: 'cool-season annual',
    gddBase: 0,
    gddMaturity: 2100,
    kcMid: 1.15,
    seasonDays: 240,
    waterReqMm: [450, 650],
    tempRange: [3, 25],
    heatLimit: 32,
    frostSensitive: false,
    phRange: [6.0, 7.5],
    drainage: 'well',
    rootDepthCm: 150,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'high',
    note: 'Overwinters on stored soil moisture; grain fill is the heat-sensitive stage.',
  },
  {
    id: 'spring-wheat',
    name: 'Spring wheat',
    family: 'cereal',
    lifecycle: 'cool-season annual',
    gddBase: 0,
    gddMaturity: 1600,
    kcMid: 1.15,
    seasonDays: 120,
    waterReqMm: [400, 500],
    tempRange: [5, 24],
    heatLimit: 30,
    frostSensitive: true,
    phRange: [6.0, 7.5],
    drainage: 'well',
    rootDepthCm: 120,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'high',
    note: 'Short-season option where winter cold or water limits a full wheat cycle.',
  },
  {
    id: 'barley',
    name: 'Barley',
    family: 'cereal',
    lifecycle: 'cool-season annual',
    gddBase: 0,
    gddMaturity: 1500,
    kcMid: 1.15,
    seasonDays: 105,
    waterReqMm: [350, 450],
    tempRange: [4, 24],
    heatLimit: 30,
    frostSensitive: true,
    phRange: [6.5, 8.5],
    drainage: 'well',
    rootDepthCm: 100,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'high',
    note: 'More tolerant of alkaline soils and salinity than wheat.',
  },
  {
    id: 'maize',
    name: 'Maize (corn)',
    family: 'cereal',
    lifecycle: 'warm-season annual',
    gddBase: 10,
    gddMaturity: 2500,
    kcMid: 1.2,
    seasonDays: 130,
    waterReqMm: [500, 650],
    tempRange: [12, 32],
    heatLimit: 35,
    frostSensitive: true,
    phRange: [5.8, 7.5],
    drainage: 'well',
    rootDepthCm: 150,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'high',
    note: 'High nitrogen and water demand; pollination is the critical heat window.',
  },
  {
    id: 'sorghum',
    name: 'Sorghum',
    family: 'cereal',
    lifecycle: 'warm-season annual',
    gddBase: 10,
    gddMaturity: 2200,
    kcMid: 1.0,
    seasonDays: 120,
    waterReqMm: [400, 500],
    tempRange: [14, 34],
    heatLimit: 38,
    frostSensitive: true,
    phRange: [5.5, 8.0],
    drainage: 'well',
    rootDepthCm: 130,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'high',
    note: 'Substitutes for maize in hotter, drier seasons with lower yield potential.',
  },
  {
    id: 'pearl-millet',
    name: 'Pearl millet',
    family: 'cereal',
    lifecycle: 'warm-season annual',
    gddBase: 10,
    gddMaturity: 1800,
    kcMid: 1.0,
    seasonDays: 90,
    waterReqMm: [300, 400],
    tempRange: [16, 35],
    heatLimit: 40,
    frostSensitive: true,
    phRange: [5.5, 8.0],
    drainage: 'well',
    rootDepthCm: 120,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'medium',
    note: 'Short, drought-tolerant cereal for marginal rainfall seasons.',
  },
  {
    id: 'rice',
    name: 'Rice (paddy)',
    family: 'cereal',
    lifecycle: 'warm-season annual',
    gddBase: 10,
    gddMaturity: 2400,
    kcMid: 1.2,
    seasonDays: 130,
    waterReqMm: [900, 1200],
    tempRange: [18, 34],
    heatLimit: 36,
    frostSensitive: true,
    phRange: [5.5, 7.0],
    drainage: 'poor',
    rootDepthCm: 60,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'medium',
    note: 'Assumes ponded water; the water requirement includes paddy percolation.',
  },
  {
    id: 'soybean',
    name: 'Soybean',
    family: 'legume',
    lifecycle: 'warm-season annual',
    gddBase: 10,
    gddMaturity: 2400,
    kcMid: 1.15,
    seasonDays: 125,
    waterReqMm: [450, 550],
    tempRange: [15, 32],
    heatLimit: 35,
    frostSensitive: true,
    phRange: [6.0, 7.0],
    drainage: 'well',
    rootDepthCm: 120,
    nFixer: true,
    nCreditKgHa: 60,
    residue: 'medium',
    note: 'The classic rotation partner for maize: fixes nitrogen and breaks cereal disease cycles.',
  },
  {
    id: 'chickpea',
    name: 'Chickpea',
    family: 'legume',
    lifecycle: 'cool-season annual',
    gddBase: 5,
    gddMaturity: 1900,
    kcMid: 1.05,
    seasonDays: 110,
    waterReqMm: [300, 400],
    tempRange: [10, 28],
    heatLimit: 32,
    frostSensitive: true,
    phRange: [6.0, 8.5],
    drainage: 'well',
    rootDepthCm: 100,
    nFixer: true,
    nCreditKgHa: 40,
    residue: 'low',
    note: 'Dryland legume that leaves residual nitrogen ahead of a cereal.',
  },
  {
    id: 'lentil',
    name: 'Lentil',
    family: 'legume',
    lifecycle: 'cool-season annual',
    gddBase: 5,
    gddMaturity: 1700,
    kcMid: 1.1,
    seasonDays: 100,
    waterReqMm: [280, 380],
    tempRange: [8, 26],
    heatLimit: 30,
    frostSensitive: true,
    phRange: [6.0, 8.0],
    drainage: 'well',
    rootDepthCm: 80,
    nFixer: true,
    nCreditKgHa: 35,
    residue: 'low',
    note: 'Low-water legume; poor competitiveness against weeds in wet seasons.',
  },
  {
    id: 'field-pea',
    name: 'Field pea',
    family: 'legume',
    lifecycle: 'cool-season annual',
    gddBase: 4,
    gddMaturity: 1600,
    kcMid: 1.15,
    seasonDays: 100,
    waterReqMm: [300, 400],
    tempRange: [8, 25],
    heatLimit: 29,
    frostSensitive: true,
    phRange: [6.0, 7.5],
    drainage: 'well',
    rootDepthCm: 90,
    nFixer: true,
    nCreditKgHa: 45,
    residue: 'low',
    note: 'Fast legume break crop; sensitive to heat at flowering.',
  },
  {
    id: 'sunflower',
    name: 'Sunflower',
    family: 'oilseed',
    lifecycle: 'warm-season annual',
    gddBase: 6,
    gddMaturity: 2000,
    kcMid: 1.15,
    seasonDays: 115,
    waterReqMm: [450, 600],
    tempRange: [12, 32],
    heatLimit: 36,
    frostSensitive: true,
    phRange: [6.0, 7.8],
    drainage: 'well',
    rootDepthCm: 150,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'medium',
    note: 'Deep-rooted oilseed that can use subsoil water; breaks cereal cycles.',
  },
  {
    id: 'canola',
    name: 'Canola (rapeseed)',
    family: 'oilseed',
    lifecycle: 'cool-season annual',
    gddBase: 5,
    gddMaturity: 1600,
    kcMid: 1.15,
    seasonDays: 110,
    waterReqMm: [350, 450],
    tempRange: [8, 26],
    heatLimit: 30,
    frostSensitive: true,
    phRange: [5.8, 7.5],
    drainage: 'well',
    rootDepthCm: 120,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'medium',
    note: 'High-residue break crop; good cereal disease break but nitrogen hungry.',
  },
  {
    id: 'potato',
    name: 'Potato',
    family: 'root',
    lifecycle: 'cool-season annual',
    gddBase: 5,
    gddMaturity: 1500,
    kcMid: 1.15,
    seasonDays: 110,
    waterReqMm: [450, 600],
    tempRange: [10, 25],
    heatLimit: 30,
    frostSensitive: true,
    phRange: [5.0, 6.5],
    drainage: 'well',
    rootDepthCm: 60,
    nFixer: false,
    nCreditKgHa: 0,
    residue: 'low',
    note: 'Shallow-rooted and irrigation-critical; not a soil-improving rotation crop.',
  },
  {
    id: 'alfalfa',
    name: 'Alfalfa (lucerne)',
    family: 'forage',
    lifecycle: 'perennial',
    gddBase: 5,
    gddMaturity: 2200,
    kcMid: 1.1,
    seasonDays: 200,
    waterReqMm: [700, 900],
    tempRange: [8, 30],
    heatLimit: 35,
    frostSensitive: false,
    phRange: [6.2, 7.8],
    drainage: 'well',
    rootDepthCm: 200,
    nFixer: true,
    nCreditKgHa: 80,
    residue: 'high',
    note: 'Multi-year forage legume: strong soil-structure and nitrogen benefit, high water use.',
  },
]

export const cropById = (id: string | null | undefined) =>
  CROPS.find((crop) => crop.id === id) ?? null

export const cropName = (id: string | null | undefined) =>
  cropById(id)?.name ?? 'Not specified'

export const familyGroup = (crop: CropProfile): CropFamily => crop.family
