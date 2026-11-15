import type { FarmInput } from './types'

/**
 * Demo fields for the walkthrough. Boundaries are approximate rectangles drawn
 * around real farming districts — they are NOT surveyed field boundaries, and
 * the app labels them as demo geometry.
 */
export type DemoFarm = FarmInput & { id: string; blurb: string; centre: [number, number] }

const box = (lng: number, lat: number, widthDeg: number, heightDeg: number) => [
  [lng - widthDeg / 2, lat - heightDeg / 2] as [number, number],
  [lng + widthDeg / 2, lat - heightDeg / 2] as [number, number],
  [lng + widthDeg / 2, lat + heightDeg / 2] as [number, number],
  [lng - widthDeg / 2, lat + heightDeg / 2] as [number, number],
]

export const DEMO_FARMS: DemoFarm[] = [
  {
    id: 'iowa',
    name: 'Story County, Iowa',
    blurb: 'Rainfed maize–soybean belt, ~50 km POWER cell in central Iowa.',
    centre: [-93.55, 42.05],
    boundary: box(-93.55, 42.05, 0.022, 0.012),
    previousCrop: 'maize',
    irrigation: 'rainfed',
    country: 'United States',
  },
  {
    id: 'punjab',
    name: 'Ludhiana, Punjab',
    blurb: 'Irrigated wheat–rice system in the Indo-Gangetic plain.',
    centre: [75.85, 30.9],
    boundary: box(75.85, 30.9, 0.02, 0.012),
    previousCrop: 'rice',
    irrigation: 'irrigated',
    country: 'India',
  },
  {
    id: 'kenya',
    name: 'Nakuru County, Kenya',
    blurb: 'Smallholder rainfed maize–bean system in the Rift Valley.',
    centre: [36.07, -0.3],
    boundary: box(36.07, -0.3, 0.009, 0.009),
    previousCrop: 'maize',
    irrigation: 'rainfed',
    country: 'Kenya',
  },
  {
    id: 'matogrosso',
    name: 'Sorriso, Mato Grosso',
    blurb: 'Tropical soybean–second-crop maize rotation, rainfed.',
    centre: [-55.42, -12.65],
    boundary: box(-55.42, -12.65, 0.022, 0.014),
    previousCrop: 'soybean',
    irrigation: 'rainfed',
    country: 'Brazil',
  },
]
