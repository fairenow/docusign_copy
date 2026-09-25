import { test, expect } from '@playwright/test'
import { ALICE, BOB, createMockDb, installMockSupabase, seedEnvelope, signInAs } from './mockSupabase'
import { makeLongPdf } from './fixtures'
import { placePickedField } from './placeField'

// What you line up is the box, so a field's text must sit inside it, centred as it is printed
// (pdfStamp centres the text in the box). At a phone's small zoom it used to drop below the box.
async function expectTextCentredInBox(field) {
  const box = await field.boundingBox()
  const text = await field.locator('input').boundingBox()
  expect(text.y).toBeGreaterThanOrEqual(box.y - 0.5)
  expect(text.y + text.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
  expect(Math.abs((text.y + text.height / 2) - (box.y + box.height / 2))).toBeLessThan(1.5)
  expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
}

let db
test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the date and text you place sit inside their boxes', async ({ page }) => {
    await signInAs(page, ALICE)
    const id = seedEnvelope(db, { pdf: await makeLongPdf(2), title: 'Agreement', status: 'draft', page_count: 2, recipients: [] })
    await page.goto(`/envelopes/${id}`)
    await page.getByRole('button', { name: /^Recipients/ }).tap()
    await page.getByLabel('I need to sign this document').check()
    await page.getByRole('button', { name: 'Document', exact: true }).tap()
    await expect(page.getByTestId('document-page').first()).toBeVisible()
    await page.getByRole('button', { name: 'Date signed', exact: true }).tap()
    await page.getByRole('button', { name: 'Text', exact: true }).tap()
    await page.locator('[data-field-type="text"] input').fill('Co-Founder')
    await expectTextCentredInBox(page.locator('[data-field-type="date"]'))
    await expectTextCentredInBox(page.locator('[data-field-type="text"]'))
  })

  test('a signer\'s date and text sit inside their boxes too', async ({ page }) => {
    await signInAs(page, BOB)
    const id = seedEnvelope(db, { pdf: await makeLongPdf(1), title: 'Agreement', status: 'sent', signing_order: 'parallel', recipients: [{ name: BOB.name, email: BOB.email, status: 'sent' }] })
    const r = db.recipients.find(x => x.envelope_id === id)
    db.fields.push(
      { id: crypto.randomUUID(), envelope_id: id, recipient_id: r.id, page: 1, type: 'date', x: 0.1, y: 0.8, w: 0.18, h: 0.028, required: true, label: null, font_size: 12 },
      { id: crypto.randomUUID(), envelope_id: id, recipient_id: r.id, page: 1, type: 'text', x: 0.4, y: 0.8, w: 0.26, h: 0.028, required: true, label: 'Title', font_size: 12 },
      { id: crypto.randomUUID(), envelope_id: id, recipient_id: r.id, page: 1, type: 'signature', x: 0.1, y: 0.7, w: 0.3, h: 0.06, required: true, label: null, font_size: 12 }
    )
    await page.goto(`/envelopes/${id}/sign`)
    await page.getByLabel('I agree to use electronic records and signatures.').check()
    await page.getByRole('button', { name: 'Continue' }).tap()
    await page.locator('[data-field-type="text"] input').fill('Co-Founder')
    await expectTextCentredInBox(page.locator('[data-field-type="date"]'))
    await expectTextCentredInBox(page.locator('[data-field-type="text"]'))
  })
})

test('Quick sign: the date and text sit centred in their boxes, as they are printed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/quick-sign')
  await page.getByTestId('file-input').setInputFiles({ name: 'c.pdf', mimeType: 'application/pdf', buffer: await makeLongPdf(1) })
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await page.getByRole('button', { name: "Today's date" }).click()
  await placePickedField(page)
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  await expect(page.locator('[data-field-type="date"] input')).toHaveValue(today) // same format as envelopes
  await expectTextCentredInBox(page.locator('[data-field-type="date"]'))
})
