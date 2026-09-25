import { test, expect } from '@playwright/test'
import { createMockDb, installMockSupabase, seedEnvelope, signInAs } from './mockSupabase'
import { makePdf, pdfFile } from './fixtures'

// A typical phone
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

let db

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
  await signInAs(page)
})

const noSidewaysScroll = (page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

test('on a phone the envelope list fits the screen, titles show, pages are tabs at the bottom', async ({ page }) => {
  const pdf = await makePdf()
  seedEnvelope(db, { pdf, title: 'Mutual NDA – Acme Holdings', status: 'completed', final_path: 'x/signed.pdf', recipients: [{ name: 'Carol Client', email: 'carol@client.com', status: 'signed' }] })
  seedEnvelope(db, { pdf, title: 'Offer letter for Jordan Smith', recipients: [{ name: 'Dan Next', email: 'dan@x.com' }] })
  await page.goto('/')

  const rows = page.getByTestId('envelope-row')
  await expect(rows).toHaveCount(2)
  for (const title of ['Mutual NDA – Acme Holdings', 'Offer letter for Jordan Smith']) {
    const text = rows.getByText(title)
    await expect(text).toBeVisible()
    // Not squeezed: the title has most of the row's width
    const [row, box] = [await rows.filter({ hasText: title }).boundingBox(), await text.boundingBox()]
    expect(box.width).toBeGreaterThan(row.width * 0.5)
  }
  await expect(page.getByRole('button', { name: 'New envelope' })).toBeInViewport()
  await noSidewaysScroll(page)

  const tabs = page.getByRole('navigation', { name: 'Pages' })
  await expect(tabs).toBeVisible()
  await tabs.getByRole('link', { name: 'Templates' }).click()
  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible()
  await noSidewaysScroll(page)
})

test('on a phone the envelope screen switches between the document and its settings', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
  const documentPage = page.getByTestId('document-page').first()
  await expect(documentPage).toBeVisible()
  // The page is fitted to the screen beside the field toolbar
  expect((await documentPage.boundingBox()).width).toBeLessThanOrEqual(390 - 76)
  await noSidewaysScroll(page)

  await page.getByRole('button', { name: 'Recipients & settings' }).click()
  await expect(documentPage).toBeHidden()
  await page.getByRole('button', { name: 'Add recipient' }).click()
  await page.getByLabel('Recipient name').fill('Carol Client')
  await page.getByLabel('Recipient email').fill('carol@client.com')

  await page.getByRole('button', { name: 'Document', exact: true }).click()
  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  await expect(page.getByTestId('field')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
})

test('on a phone Quick sign switches between the document and the field tools', async ({ page }) => {
  await page.goto('/quick-sign')
  await expect(page.getByRole('link', { name: '← Envelopes' })).toBeVisible()
  await page.locator('input[type=file]').first().setInputFiles(await pdfFile())
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await noSidewaysScroll(page)

  await page.getByRole('button', { name: 'Add fields' }).click()
  await page.getByRole('button', { name: 'Checkbox' }).click()
  // Adding a field goes back to the document, where it is
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await expect(page.locator('[data-field-type="checkbox"]')).toHaveCount(1)
})
