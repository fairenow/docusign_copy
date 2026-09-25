import { test, expect } from '@playwright/test'
import { ALICE, STORAGE_KEY, createMockDb, fakeSession, installMockSupabase, seedEnvelope } from './mockSupabase'
import { makePdf } from './fixtures'

let db
const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600_000).toISOString()

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
  await page.addInitScript(([key, session]) => window.localStorage.setItem(key, JSON.stringify(session)), [STORAGE_KEY, fakeSession()])
})

test('each envelope says who it is waiting on, and the signer can be reminded from the list', async ({ page }) => {
  const pdf = Buffer.from(await makePdf())
  seedEnvelope(db, {
    pdf, title: 'Mutual NDA', owner_id: ALICE.id, sent_at: daysAgo(3), expires_at: daysAgo(-20),
    recipients: [
      { name: 'Carol Client', email: 'carol@example.com', status: 'signed', sent_at: daysAgo(3), signed_at: daysAgo(2) },
      { name: 'Dan Director', email: 'dan@example.com', routing_order: 2, sent_at: daysAgo(2), viewed_at: daysAgo(1.2) }
    ]
  })
  seedEnvelope(db, { pdf, title: 'Offer letter', owner_id: ALICE.id, status: 'completed', completed_at: daysAgo(4), recipients: [] })

  await page.goto('/')
  const nda = page.getByTestId('envelope-row').filter({ hasText: 'Mutual NDA' })
  await expect(nda.getByTestId('envelope-progress')).toHaveText('1 of 2 signed · Waiting on Dan Director · sent 2 days ago · opened yesterday')
  await expect(page.getByTestId('envelope-row').filter({ hasText: 'Offer letter' }).getByTestId('envelope-progress')).toHaveText('Completed 4 days ago')

  await nda.getByRole('button', { name: 'Remind' }).click()
  await expect(page.getByTestId('toast')).toHaveText(/Reminded Dan Director\./)
  expect(db.emails.map(e => e.to)).toEqual(['dan@example.com'])
  await expect(nda.getByTestId('envelope-progress')).toContainText('reminded just now')
  // Once every 10 minutes at most
  await expect(nda.getByRole('button', { name: 'Remind' })).toBeDisabled()
  await expect(nda.getByRole('button', { name: 'Remind' })).toHaveAttribute('title', /remind again in 10 min/)
})
