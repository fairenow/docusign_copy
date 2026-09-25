import { test, expect } from '@playwright/test'
import { ALICE, BOB, CARA, createMockDb, installMockSupabase, seedEnvelope, signInAs } from './mockSupabase'
import { makePdf } from './fixtures'
import { placePickedField } from './placeField'

let db

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
})

const draft = async () => seedEnvelope(db, { pdf: await makePdf(), title: 'Andromedia agreement', status: 'draft', recipients: [] })

test('share with a teammate, @mention them, pin a comment, and they reply and resolve it', async ({ page }) => {
  const id = await draft()
  await signInAs(page, ALICE)
  await page.goto(`/envelopes/${id}`)
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await page.getByRole('tab', { name: 'Comments' }).click()

  // Share: Bob can now view and comment, and is emailed
  await page.getByLabel('Teammate to share with').selectOption({ label: BOB.name })
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByTestId('shared-with')).toContainText(BOB.name)
  await expect.poll(() => db.emails.filter(e => e.kind === 'shared').map(e => e.to)).toEqual([BOB.email])

  // A comment pinned to the page, mentioning Bob
  await page.getByRole('button', { name: 'Pin to page' }).click()
  await placePickedField(page)
  await expect(page.getByText('Pinned to page 1')).toBeVisible()
  const box = page.getByLabel('New comment')
  await box.fill('Can you check the fee here? @Bo')
  await page.getByRole('listbox', { name: 'Mention a teammate' }).getByRole('option', { name: new RegExp(BOB.name) }).click()
  await expect(box).toHaveValue(`Can you check the fee here? @${BOB.name} `)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()

  await expect(page.getByTestId('comment-thread')).toHaveCount(1)
  await expect(page.getByTestId('comment-pin')).toHaveText('1')
  expect(db.comments[0]).toMatchObject({ body: `Can you check the fee here? @${BOB.name}`, mentions: [BOB.id], page: 1 })
  await expect.poll(() => db.emails.filter(e => e.kind === 'mention').map(e => e.to)).toEqual([BOB.email])
  expect(db.emails.find(e => e.kind === 'mention').link).toBe(`/envelopes/${id}?comment=${db.comments[0].id}`)

  // Bob: sees it shared on the dashboard, opens the emailed link, replies and resolves
  await page.context().clearCookies()
  await page.evaluate(() => window.localStorage.clear())
  await signInAs(page, BOB)
  await page.goto('/')
  await expect(page.getByTestId('envelope-row')).toContainText('Shared with you')
  await page.goto(db.emails.find(e => e.kind === 'mention').link)
  await expect(page.getByTestId('comments-panel')).toBeVisible()
  await expect(page.getByRole('button', { name: /Send|Sign and finish/ })).toHaveCount(0) // view and comment only
  await page.getByRole('button', { name: 'Reply' }).click()
  await page.getByLabel('Reply').fill('Fee is right.')
  await page.getByRole('button', { name: 'Reply', exact: true }).last().click()
  await expect(page.getByTestId('comment-thread')).toContainText('Fee is right.')
  await expect.poll(() => db.emails.filter(e => e.kind === 'reply').map(e => e.to)).toEqual([ALICE.email])
  await page.getByRole('button', { name: 'Resolve' }).click()
  await expect(page.getByTestId('comment-thread')).toHaveCount(0)
  await expect(page.getByTestId('comment-pin')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show resolved (1)' }).click()
  await expect(page.getByTestId('comment-thread')).toContainText(`Resolved by ${BOB.name}`)
})

test('mentioning a teammate without access shares it with them; others cannot open it', async ({ page }) => {
  const id = await draft()
  await signInAs(page, ALICE)
  await page.goto(`/envelopes/${id}?comment=none`)
  await expect(page.getByTestId('comments-panel')).toBeVisible()
  await page.getByLabel('New comment').fill('@Car')
  const suggestion = page.getByRole('listbox', { name: 'Mention a teammate' }).getByRole('option', { name: new RegExp(CARA.name) })
  await expect(suggestion).toContainText('will get access')
  await suggestion.click()
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByTestId('shared-with')).toContainText(CARA.name)
  expect(db.shares.map(s => s.user_id)).toEqual([CARA.id])
  await expect.poll(() => db.emails.filter(e => e.kind === 'mention').map(e => e.to)).toEqual([CARA.email])

  // Bob has no access to this draft
  await page.evaluate(() => window.localStorage.clear())
  await signInAs(page, BOB)
  await page.goto(`/envelopes/${id}`)
  await expect(page.getByText('Envelope not found, or you do not have access to it.')).toBeVisible()
})

test('comments work on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const id = await draft()
  await signInAs(page, ALICE)
  await page.goto(`/envelopes/${id}?comment=none`)
  await expect(page.getByTestId('comments-panel')).toBeVisible()
  await page.getByLabel('New comment').fill('Looks good to me')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByTestId('comment-thread')).toContainText('Looks good to me')
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(390)
})
