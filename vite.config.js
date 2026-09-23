import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // pdf.js 4 ships modern syntax (top-level await, private fields)
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' }
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          react: ['react', 'react-dom']
        }
      }
    }
  }
})
