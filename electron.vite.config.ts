import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { externalizeDeps: true }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()]
  }
})
