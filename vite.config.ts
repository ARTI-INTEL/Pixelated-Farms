import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // MapLibre ships its own worker bundle; pre-bundling breaks the worker URL in dev.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
