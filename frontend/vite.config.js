import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env.CQA_BACKEND_URL || 'http://127.0.0.1:3000' },
  },
  test: { environment: 'jsdom' },
})
