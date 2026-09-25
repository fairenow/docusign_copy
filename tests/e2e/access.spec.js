import { test, expect } from '@playwright/test'
import { ALICE, BOB, STORAGE_KEY, createMockDb, fakeSession, installMockSupabase, seedEnvelope } from './mockSupabase'
import { makePdf } from './fixtures'

// Alice is an admin, Bob a member (see createMockDb)
let db

async function signInAs(page, user) {
  await page.addInitScript(([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session))
  }, [STORAGE_KEY, fakeSession(user)])
}

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
  const pdf = Buffer.from(await makePdf())
  seedEnvelope(db, { pdf, title: 'Alice lease', status: 'draft', owner_id: ALICE.id })
  seedEnvelope(db, { pdf, title: 'Bob NDA', owner_id: BOB.id, recipients: [{ name: 'Carol Client', email: 'carol@example.com' }] })
  seedEnvelope(db, { pdf, title: 'Bob draft', status: 'draft', owner_id: BOB.id })
  seedEnvelope(db, { pdf, title: 'Offer for Bob', owner_id: ALICE.id, recipients: [{ name: 'Bob Teammate', email: BOB.email }] })
})

const rows = (page) => page.getByTestId('envelope-row')

test('an admin sees their own envelopes, or everyone\'s, and can manage a teammate\'s', async ({ page }) => {
  await signInAs(page, ALICE)
  await page.goto('/')

  // Mine: only what Alice sent
  await expect(rows(page)).toHaveCount(2)
  await expect(page.getByText('Bob NDA')).toHaveCount(0)

  await page.getByRole('button', { name: 'Everyone' }).click()
  await expect(rows(page)).toHaveCount(4)
  const bobNda = rows(page).filter({ hasText: 'Bob NDA' })
  await expect(bobNda).toContainText('Sent by Bob Teammate')
  await expect(bobNda.getByTitle('Void envelope')).toBeVisible()

  // Search covers the sender and recipients
  await page.getByLabel('Search envelopes').fill('carol')
  await expect(rows(page)).toHaveCount(1)
  await page.getByLabel('Search envelopes').fill('bob teammate')
  await expect(rows(page)).toHaveCount(3)
  await page.getByLabel('Search envelopes').fill('')

  // Deleting a teammate's draft says whose it is
  page.once('dialog', d => {
    expect(d.message()).toContain('"Bob draft" by Bob Teammate')
    d.accept()
  })
  await rows(page).filter({ hasText: 'Bob draft' }).getByTitle('Delete draft').click()
  await expect(rows(page)).toHaveCount(3)
  expect(db.envelopes.some(e => e.title === 'Bob draft')).toBe(false)

  // Opening it: read-only, shows the sender, and a signer can be sent a new link
  await bobNda.getByRole('link').click()
  await expect(page.getByText('Sent by Bob Teammate')).toBeVisible()
  await expect(page.getByLabel('Envelope title')).toHaveCount(0)
  await page.getByTitle('Email Carol Client a new signing link').click()
  await expect(page.getByTestId('activity')).toContainText('by Alice Owner')
})

test('a member sees only what they sent and what was sent to them', async ({ page }) => {
  await signInAs(page, BOB)
  await page.goto('/')
  await expect(rows(page)).toHaveCount(3)
  await expect(page.getByText('Alice lease')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Everyone' })).toHaveCount(0)
  await expect(rows(page).filter({ hasText: 'Offer for Bob' })).toContainText('Sent by Alice Owner')
  // Nothing to manage on someone else's envelope
  await expect(rows(page).filter({ hasText: 'Offer for Bob' }).getByTitle('Void envelope')).toHaveCount(0)
})
