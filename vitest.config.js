import { defineConfig } from 'vitest/config'

// Unit tests cover pure logic in src/lib; browser flows are covered by Playwright (tests/e2e)
export default defineConfig({
  test: {
    include: ['src/**/*.test.js', 'supabase/functions/_shared/*.test.js'],
    environment: 'node'
  }
})
