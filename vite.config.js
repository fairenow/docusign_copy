import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `vite preview` (used by the Playwright tests) sends the production security headers from
// vercel.json, pointed at whichever Supabase the build uses, so a policy that breaks the app
// fails the tests instead of production.
function productionHeaders() {
  const [{ headers }] = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers
  const supabase = process.env.VITE_SUPABASE_URL
  return Object.fromEntries(headers.map(({ key, value }) => [
    key,
    supabase ? value.replaceAll('https://tdgwdniwwkqqyfuoxnwx.supabase.co', supabase).replaceAll('wss://tdgwdniwwkqqyfuoxnwx.supabase.co', supabase.replace(/^https/, 'wss')) : value
  ]))
}

export default defineConfig({
  plugins: [react()],
  preview: { headers: productionHeaders() },
  // pdf.js 4 ships modern syntax (top-level await, private fields)
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' }
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  }
})
