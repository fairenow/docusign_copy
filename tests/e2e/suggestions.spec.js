import { test, expect } from '@playwright/test'
import { createMockDb, installMockSupabase, signInAs } from './mockSupabase'
import { makeSignaturePagePdf, SIGNATURE_PAGE_LINES } from './fixtures'
import { addField } from './placeField'

let db

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
  await signInAs(page)
})

async function openSignaturePage(page) {
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles({ name: 'NDA.pdf', mimeType: 'application/pdf', buffer: await makeSignaturePagePdf() })
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await page.getByLabel('I need to sign this document').check()
  await page.getByRole('button', { name: 'Add recipient' }).click()
  await page.getByLabel('Recipient name').nth(1).fill('Carol Client')
  await page.getByLabel('Recipient email').nth(1).fill('carol@client.com')
}

const lastSave = () => db.calls.filter(c => c.table === 'rpc/save_envelope_draft').pop().body
const bottomPt = (f) => (f.y + f.h) * 792

test('Suggest fields finds the blank lines and who fills each one in', async ({ page }) => {
  await openSignaturePage(page)
  await page.getByRole('button', { name: 'Suggest fields' }).click()

  const panel = page.getByTestId('suggestions')
  await expect(panel).toContainText('Suggested fields (7)')
  await expect(page.getByTestId('suggested-field')).toHaveCount(7)
  // Everything has an owner: FLMLNK's block is the sender's, the other block is Carol's
  await expect(panel.getByText(/highlighted/)).toHaveCount(0)
  const who = await panel.getByTestId('suggestion').evaluateAll(rows => rows.map(r => {
    const select = r.querySelector('select')
    return `${r.querySelector('span').textContent.trim()} → ${select.options[select.selectedIndex].text}`
  }))
  expect(who).toEqual([
    'Company name · p.1 → Me, now',
    'Signature · p.1 → Alice Owner',
    'Signature · p.1 → Carol Client',
    'Name · p.1 → Carol Client',
    'Title · p.1 → Carol Client',
    'Date signed · p.1 → Alice Owner',
    'Date signed · p.1 → Carol Client'
  ])

  // Drop one that is not wanted, then add the rest
  await panel.getByTestId('suggestion').filter({ hasText: 'Title' }).getByTitle("Don't add this field").click()
  await panel.getByRole('button', { name: 'Add 6 fields' }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByTestId('field')).toHaveCount(6)
  await page.locator('[data-field-type="prefill"] input').fill('Acme Holdings LLC')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved')
  const { p_fields: fields, p_recipients: recipients } = lastSave()
  const alice = recipients.find(r => r.email === 'alice@flmlnk.com').id
  const carol = recipients.find(r => r.email === 'carol@client.com').id
  const { by, name, date } = SIGNATURE_PAGE_LINES
  const on = (type, recipient) => fields.find(f => f.type === type && f.recipient_id === recipient)

  // Each field sits on its line, in the right column
  expect(bottomPt(on('signature', alice))).toBeCloseTo(by - 1, 0)
  expect(on('signature', alice).x * 612).toBeLessThan(300)
  expect(bottomPt(on('signature', carol))).toBeCloseTo(by - 1, 0)
  expect(on('signature', carol).x * 612).toBeGreaterThan(300)
  expect(bottomPt(on('text', carol))).toBeCloseTo(name - 1, 0)
  expect(on('text', carol).label).toBe('Name')
  const dates = fields.filter(f => f.type === 'date')
  expect(dates.map(f => f.recipient_id).sort()).toEqual([alice, carol].sort())
  // The typed-underscores line is read too (within a point of its baseline)
  for (const d of dates) expect(Math.abs(bottomPt(d) - (date - 1))).toBeLessThan(2.5)
  expect(fields.find(f => f.type === 'prefill')).toMatchObject({ recipient_id: null, label: 'Company name', prefill: 'Acme Holdings LLC' })
  await expect(page.getByText('Everything is in place.')).toBeVisible()
})

test('a dragged field lands exactly where it is dropped, and arrow keys nudge it by a point', async ({ page }) => {
  await openSignaturePage(page)
  await addField(page, 'Date signed')
  const field = page.locator('[data-field-type="date"]')
  const documentPage = page.getByTestId('document-page').first()
  const { date } = SIGNATURE_PAGE_LINES
  // The field's left and bottom edges in points from the page's top-left (measured fresh: the view scrolls)
  const edges = async () => {
    const [pageBox, box] = [await documentPage.boundingBox(), await field.boundingBox()]
    const scale = pageBox.width / 612
    return { left: (box.x - pageBox.x) / scale, bottom: (box.y + box.height - pageBox.y) / scale }
  }

  // Drag it by its grip so its bottom-left corner is at (400, 7 pt above Carol's date line)
  const grip = field.getByTitle(/Drag to move/)
  await field.scrollIntoViewIfNeeded()
  await field.hover()
  const g = await grip.boundingBox()
  const box = await field.boundingBox()
  const pageBox = await documentPage.boundingBox()
  const scale = pageBox.width / 612
  const dx = pageBox.x + 400 * scale - box.x
  const dy = pageBox.y + (date - 7) * scale - (box.y + box.height)
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2 + dy, { steps: 12 })
  await page.mouse.up()

  // No snapping onto the line below: it stays exactly where it was dropped
  const dropped = await edges()
  expect(Math.abs(dropped.left - 400)).toBeLessThan(0.75)
  expect(Math.abs(dropped.bottom - (date - 7))).toBeLessThan(0.75)

  // Arrow keys: 1 pt, with Shift 10 pt
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => Math.round((await edges()).bottom * 10) / 10).toBeCloseTo(dropped.bottom + 1, 0)
  expect((await edges()).left).toBeCloseTo(dropped.left + 10, 0)
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved')
  const saved = lastSave().p_fields.find(f => f.type === 'date')
  expect(Math.abs(bottomPt(saved) - (date - 6))).toBeLessThan(0.75)
})

test('a picked-up field follows the pointer exactly and is placed with a click', async ({ page }) => {
  await openSignaturePage(page)
  const documentPage = page.getByTestId('document-page').first()
  const { date } = SIGNATURE_PAGE_LINES
  const layer = documentPage.getByTestId('placement-layer')
  const pointAt = async (x, y) => {
    const scale = (await documentPage.boundingBox()).width / 612
    return { position: { x: x * scale, y: y * scale } }
  }
  const inPoints = async (locator) => {
    const [p, b] = [await locator.boundingBox(), await documentPage.boundingBox()]
    const scale = b.width / 612
    return { left: Math.round((p.x - b.x) / scale), bottom: Math.round((p.y + p.height - b.y) / scale) }
  }

  // Esc puts it back
  await page.getByRole('button', { name: 'Date signed', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Click where the date signed field should start' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('placement-layer')).toHaveCount(0)

  await page.getByRole('button', { name: 'Date signed', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Date signed', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // The preview's bottom-left corner is at the pointer, a few points above the line: nothing snaps
  await layer.hover(await pointAt(400, date - 30))
  await layer.hover(await pointAt(400, date - 6))
  const preview = page.getByTestId('placement-preview')
  await expect(preview).toBeVisible()
  await expect.poll(() => inPoints(preview)).toEqual({ left: 400, bottom: date - 6 })

  await layer.click(await pointAt(400, date - 6))
  await expect(page.getByTestId('placement-layer')).toHaveCount(0)
  const field = page.locator('[data-field-type="date"]')
  await expect(field).toHaveCount(1)
  expect(await inPoints(field)).toEqual({ left: 400, bottom: date - 6 })
})
