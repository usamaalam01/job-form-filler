import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@bg': resolve(__dirname, 'src/background'),
      '@panel': resolve(__dirname, 'src/panel'),
      '@content': resolve(__dirname, 'src/content'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },
})
