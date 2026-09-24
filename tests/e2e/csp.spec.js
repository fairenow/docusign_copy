import { test, expect } from '@playwright/test'
import { STORAGE_KEY, createMockDb, fakeSession, installMockSupabase } from './mockSupabase'
import { pdfFile } from './fixtures'

// The preview server sends the production security headers (see vite.config.js)
test('security headers are sent and the app works under the content security policy', async ({ page }) => {
  const violations = []
  page.on('console', msg => { if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text()) })
  await installMockSupabase(page, createMockDb())
  await page.addInitScript(([key, session]) => { window.localStorage.setItem(key, JSON.stringify(session)) }, [STORAGE_KEY, fakeSession()])

  const response = await page.goto('/')
  const headers = response.headers()
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('no-referrer')
  expect(headers['x-content-type-options']).toBe('nosniff')

  // Render a PDF (pdf.js worker, canvas, fonts) and sign with a typed signature (bundled font)
  await page.goto('/quick-sign')
  await page.getByTestId('file-input').setInputFiles(await pdfFile())
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  await page.getByRole('button', { name: 'Type', exact: true }).click()
  await page.getByPlaceholder('Your Name').fill('Alice Owner')
  await page.getByRole('button', { name: 'Add to Doc' }).click()
  await expect(page.locator('[data-field-type="signature"] img')).toBeVisible()
  expect(violations).toEqual([])
})
