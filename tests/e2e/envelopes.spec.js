import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { ALICE, STORAGE_KEY, createMockDb, fakeSession, installMockSupabase, seedEnvelope } from './mockSupabase'
import { makePdf, pdfFile } from './fixtures'

let db

async function signIn(page) {
  await page.addInitScript(([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session))
  }, [STORAGE_KEY, fakeSession()])
}

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
})

test.describe('sign-in', () => {
  test('redirects to login and emails a sign-in link that returns to the requested page', async ({ page }) => {
    await page.goto('/envelopes/abc')
    await expect(page).toHaveURL(/\/login\?next=%2Fenvelopes%2Fabc$/)

    await page.getByLabel('Work email').fill('Alice@flmlnk.com ')
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
    await expect(page.getByRole('status')).toContainText('We sent a sign-in link to alice@flmlnk.com')

    const otp = db.calls.find(c => c.type === 'auth' && c.path.endsWith('/otp'))
    expect(otp.body.email).toBe('alice@flmlnk.com')
    expect(otp.body.code_challenge).toBeTruthy() // PKCE
    const redirect = new URL(new URL(otp.url).searchParams.get('redirect_to'))
    expect(redirect.pathname).toBe('/login')
    expect(redirect.searchParams.get('next')).toBe('/envelopes/abc')
  })

  test('only accepts addresses on the allowed domain', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Work email').fill('someone@gmail.com')
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
    await expect(page.getByRole('alert')).toHaveText('Only @flmlnk.com email addresses can sign in.')
    expect(db.calls.some(c => c.type === 'auth' && c.path.endsWith('/otp'))).toBe(false)
  })

  test('explains a rejected sign-up and an expired link', async ({ page }) => {
    await page.goto('/login?error=server_error&error_description=Database+error+saving+new+user')
    await expect(page.getByRole('alert')).toHaveText('Only @flmlnk.com email addresses can sign in.')
    await page.goto('/login#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')
    await expect(page.getByRole('alert')).toHaveText('Email link is invalid or has expired')
  })

  for (const next of ['//evil.example.com', '/%5Cevil.example.com', 'https://evil.example.com', '/%09/evil.example.com', '/%0A/evil.example.com', '/%20//evil.example.com']) {
    test(`ignores off-site next parameter ${next}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`/login?next=${next}`)
      await expect(page).toHaveURL('http://localhost:4173/')
      await expect(page.getByRole('heading', { name: 'Envelopes' })).toBeVisible()
    })
  }
})

test.describe('envelopes', () => {
  test.beforeEach(async ({ page }) => signIn(page))

  test('create, prepare, save and reload a draft', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('No envelopes yet.')).toBeVisible()
    await expect(page.getByText(ALICE.name)).toBeVisible()

    await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
    await expect(page).toHaveURL(/\/envelopes\/[0-9a-f-]{36}$/)
    const envelopeId = page.url().split('/').pop()

    // Row created with page count, PDF uploaded, path recorded
    expect(db.envelopes[0]).toMatchObject({ id: envelopeId, title: 'Mutual NDA', page_count: 2, original_path: `${envelopeId}/original.pdf` })
    expect(db.files.has(`documents/${envelopeId}/original.pdf`)).toBe(true)

    await expect(page.getByTestId('document-page').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Signature', exact: true })).toBeDisabled() // no signer yet
    await expect(page.getByTestId('send-problems')).toContainText('Add at least one signer.')

    // Add a signer and place their fields
    await page.getByRole('button', { name: 'Add recipient' }).click()
    await page.getByLabel('Recipient name').fill('Bob Signer')
    await page.getByLabel('Recipient email').fill('bob@flmlnk.com')
    await expect(page.getByText('Adding to the current page for')).toContainText('Bob Signer')
    await page.getByRole('button', { name: 'Signature', exact: true }).click()
    await page.getByRole('button', { name: 'Date signed', exact: true }).click()
    await expect(page.getByTestId('field')).toHaveCount(2)
    await expect(page.getByTestId('field').first()).toContainText('Signature *')
    // Clicking a field opens its settings; recipients are one tab away
    await page.getByTestId('field').first().click()
    await expect(page.getByTestId('field-properties')).toBeVisible()
    await page.getByRole('tab', { name: 'Recipients' }).click()

    // Fields on page 2 (rotated) too: the page buttons scroll to it and new fields go there
    await page.getByTitle('Next page').click()
    await expect(page.getByTestId('page-indicator')).toHaveText('Page 2 of 2')
    await page.getByRole('button', { name: 'Initials', exact: true }).click()
    await expect(page.locator('[data-page="2"] [data-testid="field"]')).toHaveCount(1)
    await expect(page.getByTestId('field')).toHaveCount(3)

    await expect(page.getByText('Everything is in place.')).toBeVisible()
    await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved')

    const save = db.calls.filter(c => c.table === 'rpc/save_envelope_draft').pop().body
    expect(save.p_allow_signer_adjustments).toBe(false)
    expect(save.p_recipients).toEqual([expect.objectContaining({ name: 'Bob Signer', email: 'bob@flmlnk.com', role: 'signer', routing_order: 1 })])
    expect(save.p_fields.map(f => [f.type, f.page, f.required])).toEqual([['signature', 1, true], ['date', 1, true], ['initials', 2, true]])
    for (const f of save.p_fields) {
      expect(f.recipient_id).toBe(save.p_recipients[0].id)
      expect(f.x + f.w).toBeLessThanOrEqual(1)
      expect(f.y + f.h).toBeLessThanOrEqual(1)
    }

    // Reload: everything comes back from the backend
    await page.reload()
    await expect(page.getByLabel('Recipient name')).toHaveValue('Bob Signer')
    await expect(page.getByTestId('field')).toHaveCount(3)
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved')

    // Dashboard lists it as a draft
    await page.getByTitle('Back to envelopes').click()
    await page.getByRole('tab', { name: /Drafts/ }).click()
    await expect(page.getByTestId('envelope-row')).toContainText('Mutual NDA')
    await expect(page.getByTestId('envelope-row')).toContainText('Bob Signer')
  })

  test('moving and resizing a field keeps it on the page', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
    await expect(page.getByTestId('document-page').first()).toBeVisible()
    await page.getByRole('button', { name: 'Add recipient' }).click()
    await page.getByLabel('Recipient name').fill('Bob')
    await page.getByLabel('Recipient email').fill('bob@flmlnk.com')
    await page.getByRole('button', { name: 'Signature', exact: true }).click()

    const field = page.getByTestId('field')
    const box = await field.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 5000, box.y + 5000, { steps: 5 }) // far off the page
    await page.mouse.up()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved')

    const [f] = db.calls.filter(c => c.table === 'rpc/save_envelope_draft').pop().body.p_fields
    expect(f.x + f.w).toBeCloseTo(1, 5)
    expect(f.y + f.h).toBeCloseTo(1, 5)
  })

  test('validates before saving and explains duplicate emails', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
    await page.getByRole('button', { name: 'Add recipient' }).click()

    // A blank recipient can be saved while drafting, but not sent
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved')
    expect(db.recipients[0]).toMatchObject({ name: '', email: null })
    await expect(page.getByText('Recipient 1 needs a name.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()

    // A name typed into the email box is caught on save
    await page.getByLabel('Recipient email').fill('Bob Signer')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Recipient 1: "Bob Signer" is not an email address.')

    await page.getByLabel('Recipient name').fill('Bob')
    await page.getByLabel('Recipient email').fill('bob@flmlnk.com')
    await page.getByRole('button', { name: 'Add recipient' }).click()
    await page.getByLabel('Recipient name').nth(1).fill('Robert')
    await page.getByLabel('Recipient email').nth(1).fill('BOB@flmlnk.com')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Robert has the same email as Bob.')
  })

  test('warns before leaving with unsaved changes', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
    await page.getByLabel('Envelope title').fill('Changed title')

    page.once('dialog', d => d.dismiss())
    await page.getByTitle('Back to envelopes').click()
    await expect(page.getByLabel('Envelope title')).toHaveValue('Changed title')

    page.once('dialog', d => d.accept())
    await page.getByTitle('Back to envelopes').click()
    await expect(page.getByRole('heading', { name: 'Envelopes' })).toBeVisible()
  })

  test('removing a signer removes their fields; switching to CC too', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
    await page.getByRole('button', { name: 'Add recipient' }).click()
    await page.getByLabel('Recipient name').fill('Bob')
    await page.getByLabel('Recipient email').fill('bob@flmlnk.com')
    await page.getByRole('button', { name: 'Signature', exact: true }).click()
    await expect(page.getByTestId('field')).toHaveCount(1)

    await page.getByLabel('Recipient role').selectOption('cc')
    await expect(page.getByTestId('field')).toHaveCount(0)
    await expect(page.getByTestId('send-problems')).toContainText('Add at least one signer.')

    await page.getByLabel('Recipient role').selectOption('signer')
    await page.getByLabel('Select Bob').click()
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    page.once('dialog', d => d.accept())
    await page.getByTitle('Remove recipient').click()
    await expect(page.getByTestId('recipient')).toHaveCount(0)
    await expect(page.getByTestId('field')).toHaveCount(0)
  })

  test('deletes a draft and its stored document', async ({ page }) => {
    const pdf = await makePdf()
    const id = seedEnvelope(db, { pdf, status: 'draft', title: 'Old draft' })
    await page.goto('/')
    page.once('dialog', d => d.accept())
    await page.getByTitle('Delete draft').click()
    await expect(page.getByText('No envelopes yet.')).toBeVisible()
    expect(db.envelopes).toHaveLength(0)
    expect(db.files.has(`documents/${id}/original.pdf`)).toBe(false)
  })

  test('sent envelopes open read-only, show in action required, and can be voided', async ({ page }) => {
    const pdf = await makePdf()
    const id = seedEnvelope(db, {
      pdf,
      title: 'Offer letter',
      recipients: [{ name: 'Alice Owner', email: 'alice@flmlnk.com', routing_order: 1, status: 'sent' }],
      fields: []
    })
    db.fields.push({ id: crypto.randomUUID(), envelope_id: id, recipient_id: db.recipients[0].id, page: 1, type: 'signature', x: 0.1, y: 0.1, w: 0.2, h: 0.05, required: true, label: null, font_size: 12 })

    await page.goto('/')
    await page.getByRole('tab', { name: /Action required/ }).click()
    await expect(page.getByTestId('envelope-row')).toContainText('Offer letter')

    // It's Alice's turn, so the row opens the signing page
    await page.getByText('Offer letter').click()
    await expect(page).toHaveURL(new RegExp(`/envelopes/${id}/sign$`))

    await page.goto(`/envelopes/${id}`)
    await expect(page.getByTestId('envelope-status')).toHaveText('Out for signature')
    await expect(page.getByRole('link', { name: 'Sign now' })).toBeVisible() // Alice is the current signer
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Recipient name')).toHaveCount(0)
    await expect(page.getByTestId('field')).toHaveCount(1)

    await page.getByTitle('Back to envelopes').click()
    page.once('dialog', d => d.accept('Wrong salary'))
    await page.getByTitle('Void envelope').click()
    await page.getByRole('tab', { name: /^All/ }).click()
    await expect(page.getByTestId('envelope-row')).toContainText('Voided')
    expect(db.envelopes[0]).toMatchObject({ status: 'voided', void_reason: 'Wrong salary' })
  })
})

test('quick sign still fills and downloads a PDF without an account', async ({ page }) => {
  await page.goto('/quick-sign')
  await page.getByTestId('file-input').setInputFiles(await pdfFile('contract.pdf'))
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await page.getByRole('button', { name: 'Text Field' }).click()
  await page.getByRole('button', { name: 'Add Text Field' }).click()
  await page.locator('.overlay-element input').fill('Jane Doe')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('contract_signed.pdf')
  const out = await PDFDocument.load(await (await import('node:fs/promises')).readFile(await file.path()))
  expect(out.getPageCount()).toBe(2)
})

test('Word documents are converted on the server, exactly as LibreOffice lays them out', async ({ page }) => {
  await signIn(page)
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles('tests/e2e/fixtures/consent.docx')
  await expect(page).toHaveURL(/\/envelopes\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('document-page')).toHaveCount(4)
  await expect(page.getByTestId('page-indicator')).toHaveText('Page 1 of 4')

  const convert = db.calls.find(c => c.action === 'convert')
  expect(convert).toMatchObject({ name: 'consent.docx', user: ALICE.email })
  expect(convert.bytes).toBeGreaterThan(1000)
  // The uploaded document is the converter's PDF, byte for byte (the upload wraps it in form data)
  const stored = db.files.get(`documents/${db.envelopes[0].id}/original.pdf`)
  const expected = await (await import('node:fs/promises')).readFile('tests/e2e/fixtures/consent.libreoffice.pdf')
  expect(stored.indexOf(expected)).toBeGreaterThanOrEqual(0)
  expect(db.envelopes[0]).toMatchObject({ title: 'consent', page_count: 4 })
})

test('Quick sign asks you to sign in before converting a Word document', async ({ page }) => {
  await page.goto('/quick-sign')
  page.once('dialog', d => {
    expect(d.message()).toContain('Sign in to upload Word documents, or upload a PDF instead.')
    d.accept()
  })
  await page.getByTestId('file-input').setInputFiles('tests/e2e/fixtures/consent.docx')
  await expect.poll(() => db.calls.some(c => c.action === 'convert')).toBe(false)
  await expect(page.getByTestId('document-page')).toHaveCount(0)
})

test('Quick sign opens the signature pad over the page, where you are', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.goto('/quick-sign')
  await page.getByTestId('file-input').setInputFiles(await pdfFile('contract.pdf'))
  // The detector finds "Signature: ____" near the bottom of page 1
  await page.getByTitle('Place this field').first().click()
  const placeholder = page.locator('[data-field-type="signature"]').first()
  await placeholder.scrollIntoViewIfNeeded()
  await placeholder.click()

  const dialog = page.getByRole('dialog', { name: 'Adopt your signature' })
  await expect(dialog).toBeInViewport()
  await dialog.getByRole('button', { name: 'Draw' }).click()
  const pad = dialog.locator('canvas')
  const box = await pad.boundingBox()
  await page.mouse.move(box.x + 20, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 160, box.y + 60, { steps: 5 })
  await page.mouse.up()
  await dialog.getByRole('button', { name: 'Adopt and sign' }).click()

  await expect(dialog).toHaveCount(0)
  await expect(placeholder.locator('img')).toBeInViewport()
})
