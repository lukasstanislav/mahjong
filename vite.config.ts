import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // GitHub Pages serves the project from /<repo>/; the deploy workflow sets BASE_PATH.
  // Local dev and other hosts default to '/'. All runtime asset URLs use import.meta.env.BASE_URL.
  base: process.env.BASE_PATH || '/',
  // the lazily loaded three.js board chunk is ~555 kB (140 kB gz) by design
  build: { chunkSizeWarningLimit: 700 },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
})
