import { test, expect } from '@playwright/test'
import { ALICE, BOB, STORAGE_KEY, createMockDb, fakeSession, installMockSupabase, seedEnvelope } from './mockSupabase'
import { makePdf, pdfFile } from './fixtures'

let db

const signInAs = (page, user) => page.addInitScript(([key, session]) => {
  window.localStorage.setItem(key, JSON.stringify(session))
}, [STORAGE_KEY, fakeSession(user)])

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
})

/** A sent envelope with one field set per signer; returns ids and a link token for the first signer. */
async function seedSent({ signers, signingOrder = 'sequential', status = 'sent' }) {
  const id = seedEnvelope(db, {
    pdf: await makePdf(),
    title: 'Offer letter',
    message: 'Please sign by Friday.',
    status,
    signing_order: signingOrder,
    recipients: signers.map((s, i) => ({ name: s.name, email: s.email, routing_order: i + 1, status: i === 0 || signingOrder === 'parallel' ? 'sent' : 'pending' }))
  })
  const recipients = db.recipients.filter(r => r.envelope_id === id)
  for (const r of recipients) {
    db.fields.push(
      { id: crypto.randomUUID(), envelope_id: id, recipient_id: r.id, page: 1, type: 'signature', x: 0.1, y: 0.7, w: 0.3, h: 0.06, required: true, label: null, font_size: 12 },
      { id: crypto.randomUUID(), envelope_id: id, recipient_id: r.id, page: 1, type: 'text', x: 0.5, y: 0.7, w: 0.3, h: 0.04, required: true, label: 'Job title', font_size: 12 },
      { id: crypto.randomUUID(), envelope_id: id, recipient_id: r.id, page: 1, type: 'date', x: 0.1, y: 0.8, w: 0.2, h: 0.03, required: true, label: null, font_size: 12 },
      { id: crypto.randomUUID(), envelope_id: id, recipient_id: r.id, page: 2, type: 'checkbox', x: 0.1, y: 0.1, w: 0.03, h: 0.03, required: false, label: null, font_size: 12 }
    )
  }
  const token = 'tok' + crypto.randomUUID().replace(/-/g, '') + 'abcdefgh'
  db.tokens.set(token, recipients[0].id)
  return { id, recipients, token }
}

test('owner sends an envelope; only the first signer is emailed in sequential order', async ({ page }) => {
  await signInAs(page, ALICE)
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
  await expect(page.getByTestId('document-page').first()).toBeVisible()

  for (const [i, [name, email]] of [['Bob Teammate', BOB.email], ['Carol Client', 'carol@client.com']].entries()) {
    await page.getByRole('button', { name: 'Add recipient' }).click()
    await page.getByLabel('Recipient name').nth(i).fill(name)
    await page.getByLabel('Recipient email').nth(i).fill(email)
    await page.getByRole('button', { name: 'Signature', exact: true }).click()
  }
  await expect(page.getByText('Everything is in place.')).toBeVisible()

  page.once('dialog', d => {
    expect(d.message()).toContain('Bob Teammate will be emailed a signing link first')
    d.accept()
  })
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByTestId('envelope-status')).toHaveText('Out for signature')
  // Unsaved edits were saved before sending
  expect(db.calls.map(c => c.table ?? c.action).filter(Boolean)).toEqual(expect.arrayContaining(['rpc/save_envelope_draft', 'send']))
  expect(db.emails.map(e => e.to)).toEqual([BOB.email])
  await expect(page.getByTestId('signer-status').first()).toContainText('Sent')
  await expect(page.getByTestId('activity')).toContainText('Sent for signature')
  // Bob is signed in? No: Alice is not a signer, so no "Sign now"
  await expect(page.getByRole('link', { name: 'Sign now' })).toHaveCount(0)
})

test('signer uses the emailed link: consent, guided fields, adopt signature, finish', async ({ page }) => {
  const { token, recipients } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }, { name: 'Dan Next', email: 'dan@client.com' }] })
  await page.goto(`/sign/${token}`)

  await expect(page.getByRole('heading', { name: 'Offer letter' })).toBeVisible()
  await expect(page.getByText('Please sign by Friday.')).toBeVisible()
  const cont = page.getByRole('button', { name: 'Continue' })
  await expect(cont).toBeDisabled()
  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await cont.click()

  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await expect(page.getByTestId('remaining')).toHaveText('2 required fields left')
  await expect(page.getByRole('button', { name: 'Finish' })).toBeDisabled()
  // "Date signed" shows today's date and cannot be edited
  const date = page.locator('[data-field-type="date"] input')
  await expect(date).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/)
  await expect(date).toHaveAttribute('readonly', '')

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.locator('[data-field-type="signature"]').click()
  const dialog = page.getByRole('dialog', { name: 'Adopt your signature' })
  await expect(dialog.getByPlaceholder('Your Name')).toHaveValue('Carol Client')
  await dialog.getByRole('button', { name: 'Adopt and sign' }).click()
  await expect(page.locator('[data-field-type="signature"] img')).toBeVisible()
  await expect(page.getByTestId('remaining')).toHaveText('1 required field left')

  await page.locator('[data-field-type="text"] input').fill('Head of Sales')
  await page.getByTitle('Next page').click()
  await page.locator('[data-field-type="checkbox"]').click()

  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you, you are done' })).toBeVisible()

  const submit = db.calls.find(c => c.action === 'submit').body
  expect(submit.token).toBe(token)
  expect(submit.consent).toBe(true)
  const mine = db.fields.filter(f => f.recipient_id === recipients[0].id)
  const byType = Object.fromEntries(mine.map(f => [f.type, submit.values[f.id]]))
  expect(byType.signature).toMatch(/^data:image\/png;base64,/)
  expect(byType.text).toBe('Head of Sales')
  expect(byType.checkbox).toBe('true')
  expect(byType.date).toBeUndefined() // the server sets "Date signed"

  // The next signer is emailed; the link cannot be reused
  expect(db.emails.map(e => e.to)).toEqual(['dan@client.com'])
  await page.goto(`/sign/${token}`)
  await expect(page.getByRole('heading', { name: 'This link cannot be used' })).toBeVisible()
})

test('shows why a link cannot be used: waiting for an earlier signer, invalid', async ({ page }) => {
  const { recipients } = await seedSent({ signers: [{ name: 'First', email: 'first@x.com' }, { name: 'Second', email: 'second@x.com' }] })
  db.tokens.set('waiting-token-0000000000000000000000000', recipients[1].id)
  await page.goto('/sign/waiting-token-0000000000000000000000000')
  await expect(page.getByRole('heading', { name: 'It is not your turn yet' })).toBeVisible()

  await page.goto('/sign/not-a-real-token-at-all-000000000000000')
  await expect(page.getByRole('heading', { name: 'This link cannot be used' })).toBeVisible()
  await expect(page.getByText('This signing link is invalid or has expired')).toBeVisible()
})

test('signer can decline with a reason', async ({ page }) => {
  const { id, token } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }] })
  await page.goto(`/sign/${token}`)
  page.once('dialog', d => d.accept('Salary is wrong'))
  await page.getByRole('button', { name: 'Decline to sign' }).click()
  await expect(page.getByRole('heading', { name: 'You declined to sign' })).toBeVisible()
  expect(db.envelopes.find(e => e.id === id).status).toBe('declined')
  expect(db.recipients.find(r => r.envelope_id === id).decline_reason).toBe('Salary is wrong')
})

test('team member signs from the dashboard without a link, then everyone gets the finished PDF', async ({ page }) => {
  const { id } = await seedSent({ signers: [{ name: BOB.name, email: BOB.email }], signingOrder: 'parallel' })
  await signInAs(page, BOB)
  await page.goto('/')
  await page.getByRole('tab', { name: /Action required/ }).click()
  await page.getByText('Offer letter').click()
  await expect(page).toHaveURL(new RegExp(`/envelopes/${id}/sign$`))

  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('[data-field-type="signature"]').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Adopt and sign' }).click()
  await page.locator('[data-field-type="text"] input').fill('Engineer')
  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you, you are done' })).toBeVisible()

  const submit = db.calls.find(c => c.action === 'submit').body
  expect(submit).toMatchObject({ envelopeId: id, consent: true })
  expect(submit.token).toBeUndefined()
  expect(db.envelopes.find(e => e.id === id).status).toBe('completed')
})

test('owner sees progress, resends a link, and downloads the signed PDF when complete', async ({ page }) => {
  const { id, recipients } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }] })
  await signInAs(page, ALICE)
  await page.goto(`/envelopes/${id}`)
  await expect(page.getByTestId('envelope-status')).toHaveText('Out for signature')
  await page.getByTitle('Email Carol Client a new signing link').click()
  await expect(page.getByTestId('activity')).toContainText('Signing link re-sent')
  expect(db.emails.map(e => e.to)).toEqual(['carol@client.com'])

  // Everyone signed but the final step did not run: the owner can finish it
  recipients[0].status = 'signed'
  await page.reload()
  await page.getByRole('button', { name: 'Finish document' }).click()
  await expect(page.getByTestId('envelope-status')).toHaveText('Completed')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download signed PDF' }).click()
  expect((await download).suggestedFilename()).toBe('Offer letter_signed.pdf')
})
