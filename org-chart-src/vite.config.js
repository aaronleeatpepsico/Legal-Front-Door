import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
    global: 'globalThis',
  },
  plugins: [react(), cssInjectedByJs()],
  build: {
    lib: {
      entry: 'src/main.jsx',
      name: 'OrgChart',
      formats: ['iife'],
      fileName: () => 'org-chart-widget-core.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  }
})
