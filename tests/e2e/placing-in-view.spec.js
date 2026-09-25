import { test, expect } from '@playwright/test'
import { ALICE, createMockDb, installMockSupabase, seedEnvelope, signInAs } from './mockSupabase'
import { makeLongPdf } from './fixtures'

let db

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
  await signInAs(page, ALICE)
})

// Scroll the document so the bottom of `pageNumber` is on screen, as when about to sign there
async function scrollToBottomOf(page, pageNumber) {
  const target = page.locator(`[data-page="${pageNumber}"]`)
  await expect(target).toBeVisible()
  await target.evaluate(el => el.scrollIntoView({ block: 'end' }))
  await page.waitForTimeout(300)
}

// The field is fully inside the scrolling document area (not under a toolbar or off screen)
async function expectFullyInView(page, field) {
  const box = await field.boundingBox()
  const view = await page.getByTestId('document-page').first().evaluate(el => {
    const r = el.parentElement.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  })
  expect(box.y).toBeGreaterThanOrEqual(view.top)
  expect(box.y + box.height).toBeLessThanOrEqual(view.bottom)
  expect(box.x).toBeGreaterThanOrEqual(view.left)
  expect(box.x + box.width).toBeLessThanOrEqual(view.right)
}

const longDraft = async (recipients = []) => seedEnvelope(db, {
  pdf: await makeLongPdf(), title: 'Services agreement', status: 'draft', page_count: 24, recipients
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a field tapped at the bottom of page 24 appears right there, selected', async ({ page }) => {
    const id = await longDraft([{ name: 'Carol Client', email: 'carol@client.com', status: 'pending' }])
    await page.goto(`/envelopes/${id}`)
    await scrollToBottomOf(page, 24)
    await page.getByRole('button', { name: 'Date signed', exact: true }).tap()

    const field = page.locator('[data-page="24"] [data-testid="field"]')
    await expect(field).toHaveCount(1)
    await expect(field).toHaveClass(/selected/)
    await expectFullyInView(page, field)
    // A second one lands next to it, not on top of it
    await page.getByRole('button', { name: 'Signature', exact: true }).tap()
    const fields = page.locator('[data-page="24"] [data-testid="field"]')
    await expect(fields).toHaveCount(2)
    const [a, b] = await Promise.all([fields.nth(0).boundingBox(), fields.nth(1).boundingBox()])
    expect(a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    await expectFullyInView(page, fields.nth(1))
  })

  test('signing it yourself: the date stamp from the Sign menu appears where you are', async ({ page }) => {
    const id = await longDraft()
    await page.goto(`/envelopes/${id}`)
    await page.getByRole('button', { name: /^Recipients/ }).tap()
    await page.getByLabel('I need to sign this document').check()
    await page.getByRole('button', { name: 'Document', exact: true }).tap()
    await scrollToBottomOf(page, 24)
    await page.getByRole('button', { name: 'Signature', exact: true }).tap()
    const today = await page.evaluate(() => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
    await page.getByRole('menu', { name: 'Sign' }).getByRole('menuitem', { name: today }).tap()

    const date = page.locator('[data-page="24"] [data-field-type="date"]')
    await expect(date.locator('input')).toHaveValue(today)
    await expectFullyInView(page, date)
  })

  test('Quick sign: a field added from the tools lands where you were reading', async ({ page }) => {
    await page.goto('/quick-sign')
    await page.locator('input[type=file]').first().setInputFiles({ name: 'contract.pdf', mimeType: 'application/pdf', buffer: await makeLongPdf() })
    await scrollToBottomOf(page, 24)
    await page.getByRole('button', { name: 'Add fields' }).tap()
    await page.getByRole('button', { name: "Today's date" }).tap()
    const date = page.locator('[data-page="24"] [data-field-type="date"]')
    await expect(date).toHaveCount(1)
    await expect(date).toHaveClass(/selected/)
    await expectFullyInView(page, date)
  })
})

test('with a mouse, a picked-up stamp shows at once in the middle of what you see', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const id = await longDraft([{ name: 'Carol Client', email: 'carol@client.com', status: 'pending' }])
  await page.goto(`/envelopes/${id}`)
  await scrollToBottomOf(page, 24)
  await page.getByRole('button', { name: 'Date signed', exact: true }).click()
  const preview = page.locator('[data-page="24"] [data-testid="placement-preview"]')
  await expect(preview).toBeVisible()
  await expectFullyInView(page, preview)
})
