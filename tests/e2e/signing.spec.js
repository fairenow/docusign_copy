import { test, expect } from '@playwright/test'
import { ALICE, BOB, STORAGE_KEY, createMockDb, fakeSession, installMockSupabase, seedEnvelope } from './mockSupabase'
import { makePdf, pdfFile } from './fixtures'
import { addField } from './placeField'

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
async function seedSent({ signers, signingOrder = 'sequential', status = 'sent', allowAdjustments = false }) {
  const id = seedEnvelope(db, {
    pdf: await makePdf(),
    title: 'Offer letter',
    message: 'Please sign by Friday.',
    status,
    signing_order: signingOrder,
    allow_signer_adjustments: allowAdjustments,
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
    await addField(page, 'Signature')
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

test('"I need to sign this document" adds you as the first signer', async ({ page }) => {
  await signInAs(page, ALICE)
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await page.getByRole('button', { name: 'Add recipient' }).click()
  await page.getByLabel('Recipient name').fill('Carol Client')
  await page.getByLabel('Recipient email').fill('carol@client.com')

  await page.getByLabel('I need to sign this document').check()
  await expect(page.getByLabel('Recipient name').first()).toHaveValue(ALICE.name)
  await expect(page.getByLabel('Recipient email').first()).toHaveValue(ALICE.email)
  await expect(page.getByText('Adding to the current page for')).toContainText(ALICE.name)
  await addField(page, 'Signature')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved')
  const save = db.calls.filter(c => c.table === 'rpc/save_envelope_draft').pop().body
  expect(save.p_recipients.map(r => [r.email, r.role, r.routing_order])).toEqual([[ALICE.email, 'signer', 1], ['carol@client.com', 'signer', 2]])
  expect(save.p_fields[0].recipient_id).toBe(save.p_recipients[0].id)

  // Unchecking removes you (and your fields)
  page.once('dialog', d => d.accept())
  await page.getByLabel('I need to sign this document').uncheck()
  await expect(page.getByTestId('recipient')).toHaveCount(1)
  await expect(page.getByTestId('field')).toHaveCount(0)
})

test('team members save a signature once and reuse it; manage it on My signatures', async ({ page }) => {
  const first = await seedSent({ signers: [{ name: BOB.name, email: BOB.email }], signingOrder: 'parallel' })
  await signInAs(page, BOB)
  await page.goto(`/envelopes/${first.id}/sign`)
  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('[data-field-type="signature"]').click()
  const dialog = page.getByRole('dialog', { name: 'Adopt your signature' })
  await expect(dialog.getByLabel('Save to my signatures for next time')).toBeChecked()
  await dialog.getByRole('button', { name: 'Adopt and sign' }).click()
  await expect.poll(() => db.savedSignatures.length).toBe(1)
  expect(db.savedSignatures[0]).toMatchObject({ kind: 'signature', image: expect.stringMatching(/^data:image\/png;base64,/) })

  // Next document: the saved signature is one click away
  const second = await seedSent({ signers: [{ name: BOB.name, email: BOB.email }], signingOrder: 'parallel' })
  await page.goto(`/envelopes/${second.id}/sign`)
  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('[data-field-type="signature"]').click()
  await page.getByRole('button', { name: 'Use saved signature 1' }).click()
  await expect(page.locator('[data-field-type="signature"] img')).toHaveAttribute('src', db.savedSignatures[0].image)
  expect(db.savedSignatures).toHaveLength(1) // reusing does not save a copy

  // My signatures lists it and can delete it
  await page.goto('/signatures')
  await expect(page.getByRole('img', { name: 'Saved signature 1' })).toBeVisible()
  page.once('dialog', d => d.accept())
  await page.getByTitle('Delete signature').click()
  await expect(page.getByTestId('saved-signature')).toContainText('No saved signature yet')
  expect(db.savedSignatures).toHaveLength(0)
})

test('signers with only a link are not offered saving', async ({ page }) => {
  const { token } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }] })
  await page.goto(`/sign/${token}`)
  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('[data-field-type="signature"]').click()
  await expect(page.getByRole('dialog').getByLabel('Save to my signatures for next time')).toHaveCount(0)
  expect(db.calls.some(c => c.table === 'saved_signatures')).toBe(false)
})

test('signers can change or remove a signature they already placed', async ({ page }) => {
  const { token } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }] })
  await page.goto(`/sign/${token}`)
  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  const field = page.locator('[data-field-type="signature"]')
  await field.click()
  await page.getByRole('dialog', { name: 'Adopt your signature' }).getByRole('button', { name: 'Adopt and sign' }).click()
  const first = await field.locator('img').getAttribute('src')
  await expect(page.getByTestId('remaining')).toHaveText('1 required field left')

  // Clicking the signed field offers to change it; a new one replaces the old
  await field.click()
  const change = page.getByRole('dialog', { name: 'Change your signature' })
  await change.getByRole('button', { name: 'Type' }).click()
  await change.getByRole('textbox').fill('C. Client')
  await change.getByRole('button', { name: 'Adopt and sign' }).click()
  await expect(field.locator('img')).not.toHaveAttribute('src', first)

  // ...or removes it from the field
  await field.click()
  await page.getByRole('dialog', { name: 'Change your signature' }).getByRole('button', { name: 'Remove from this field' }).click()
  await expect(field.locator('img')).toHaveCount(0)
  await expect(page.getByTestId('remaining')).toHaveText('2 required fields left')
})

test('fields stay where the sender put them unless the sender allowed adjusting', async ({ page }) => {
  const { token, recipients } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }] })
  await page.goto(`/sign/${token}`)
  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  const field = page.locator('[data-field-type="signature"]')
  await expect(field).toBeVisible()
  await expect(page.getByText('Drag a field to move it')).toHaveCount(0)
  await expect(page.getByTitle('Drag to move')).toHaveCount(0)
  await expect(page.getByTitle('Drag to resize')).toHaveCount(0)

  // Dragging does nothing
  const box = await field.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 5 })
  await page.mouse.up()
  expect((await field.boundingBox()).x).toBeCloseTo(box.x, 0)

  await field.click()
  await page.getByRole('dialog', { name: 'Adopt your signature' }).getByRole('button', { name: 'Adopt and sign' }).click()
  await page.locator('[data-field-type="text"] input').fill('Head of Sales')
  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you, you are done' })).toBeVisible()
  expect(db.calls.find(c => c.action === 'submit').body.positions).toEqual({})
  const sig = db.fields.find(f => f.recipient_id === recipients[0].id && f.type === 'signature')
  expect(sig).toMatchObject({ x: 0.1, y: 0.7 })
})

test('signers can move and resize their own fields, and the new positions are saved', async ({ page }) => {
  const { token, recipients } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }], allowAdjustments: true })
  await page.goto(`/sign/${token}`)
  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  const field = page.locator('[data-field-type="signature"]')
  await expect(field).toBeVisible()
  // Signers cannot delete fields
  await field.hover()
  await expect(field.getByTitle('Remove field')).toHaveCount(0)

  // Drag the signature box down and to the right, then sign it
  const box = await field.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 5 })
  await page.mouse.up()
  const moved = await field.boundingBox()
  expect(moved.x).toBeGreaterThan(box.x + 100)
  await field.click()
  await page.getByRole('dialog', { name: 'Adopt your signature' }).getByRole('button', { name: 'Adopt and sign' }).click()
  await page.locator('[data-field-type="text"] input').fill('Head of Sales')
  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you, you are done' })).toBeVisible()

  const sig = db.fields.find(f => f.recipient_id === recipients[0].id && f.type === 'signature')
  const submit = db.calls.find(c => c.action === 'submit').body
  expect(Object.keys(submit.positions)).toEqual([sig.id])
  expect(sig.x).toBeGreaterThan(0.1)
  expect(sig.y).toBeGreaterThan(0.7)
  expect(sig.x + sig.w).toBeLessThanOrEqual(1)
  expect(db.audit.some(a => a.action === 'fields_adjusted')).toBe(true)

  // "Date signed" never moves
  await expect(page.locator('[data-field-type="date"]').getByTitle('Drag to move')).toHaveCount(0)
  const date = db.fields.find(f => f.recipient_id === recipients[0].id && f.type === 'date')
  expect(date).toMatchObject({ x: 0.1, y: 0.8 })
})

test('a signer cannot drag a field far away or stretch it over the page', async ({ page }) => {
  const { token, recipients } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }], allowAdjustments: true })
  await page.goto(`/sign/${token}`)
  await page.getByLabel('I agree to use electronic records and signatures.').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  const field = page.locator('[data-field-type="signature"]')
  await expect(field).toBeVisible()

  // The page scrolls to the first field when it opens; wait until it has settled
  let box = null
  await expect.poll(async () => {
    const previous = box
    box = await field.boundingBox()
    return previous && previous.x === box.x && previous.y === box.y
  }).toBe(true)

  // Drag far up and left (the drag selects the field), then pull its resize corner far out
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(2, 2, { steps: 10 })
  await page.mouse.up()
  const handle = await field.getByTitle('Drag to resize').boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  const view = page.viewportSize()
  await page.mouse.move(view.width - 2, view.height - 2, { steps: 10 })
  await page.mouse.up()

  await field.click()
  await page.getByRole('dialog', { name: 'Adopt your signature' }).getByRole('button', { name: 'Adopt and sign' }).click()
  await page.locator('[data-field-type="text"] input').fill('Head of Sales')
  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you, you are done' })).toBeVisible()

  // Seeded at x 0.1, y 0.7, 0.3 x 0.06: it moved and grew, but at most 0.15 / 0.10 away and
  // to twice the size (the pointer went much further)
  const sig = db.fields.find(f => f.recipient_id === recipients[0].id && f.type === 'signature')
  expect(sig.x).toBeCloseTo(0, 5)
  expect(sig.y).toBeCloseTo(0.6, 5)
  expect(sig.w).toBeGreaterThan(0.3)
  expect(sig.w).toBeLessThanOrEqual(0.6 + 1e-6)
  expect(sig.h).toBeLessThanOrEqual(0.12 + 1e-6)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('pages fit the screen and the bottom bar guides the signer to finish', async ({ page }) => {
    const { token } = await seedSent({ signers: [{ name: 'Carol Client', email: 'carol@client.com' }] })
    await page.goto(`/sign/${token}`)
    await page.getByLabel('I agree to use electronic records and signatures.').check()
    await page.getByRole('button', { name: 'Continue' }).tap()

    // Whole pages, no sideways scrolling; zoom buttons give way to the bottom bar
    const pageBox = await page.getByTestId('document-page').first().boundingBox()
    expect(pageBox.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.getByTitle('Zoom in')).toBeHidden()
    const bar = await page.getByTestId('remaining').boundingBox()
    expect(bar.y).toBeGreaterThan(700)

    // The first field is selected; a big button signs it
    await page.getByRole('button', { name: 'Sign here' }).tap()
    await page.getByRole('dialog', { name: 'Adopt your signature' }).getByRole('button', { name: 'Adopt and sign' }).tap()
    await expect(page.locator('[data-field-type="signature"] img')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign here' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Next', exact: true }).tap()
    await page.locator('[data-field-type="text"] input').fill('Head of Sales')
    await page.getByRole('button', { name: 'Finish' }).tap()
    await expect(page.getByRole('heading', { name: 'Thank you, you are done' })).toBeVisible()
  })
})
