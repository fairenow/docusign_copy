import { test, expect } from '@playwright/test'
import { answerDialog } from './dialogs'
import { STORAGE_KEY, createMockDb, fakeSession, installMockSupabase, seedEnvelope } from './mockSupabase'
import { makePdf, pdfFile } from './fixtures'
import { addField } from './placeField'

let db

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
  await page.addInitScript(([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session))
  }, [STORAGE_KEY, fakeSession()])
})

test('save a prepared envelope as a template, then start a new envelope from it', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  const firstEnvelope = page.url().split('/').pop()

  await page.getByRole('button', { name: 'Add recipient' }).click()
  await page.getByLabel('Recipient name').fill('Bob Signer')
  await page.getByLabel('Recipient email').fill('bob@example.com')
  await addField(page, 'Signature')
  await addField(page, 'Text')
  await page.getByLabel('Remind signers').selectOption({ label: 'Every week' })
  await page.getByLabel('Expires after').selectOption({ label: '14 days' })
  await page.getByLabel('Let signers adjust their fields').check()

  // Unsaved changes are saved first, then the template is made from them
  await page.getByRole('button', { name: 'Save as template' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as template' })
  await expect(dialog.getByLabel('Template name')).toHaveValue('Mutual NDA')
  await expect(dialog.getByLabel('Role 1 name')).toHaveValue('Signer 1')
  await dialog.getByLabel('Template name').fill('NDA template')
  await dialog.getByLabel('Role 1 name').fill('Client')
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await expect(page.getByRole('status')).toContainText('Saved as a template')

  const save = db.calls.filter(c => c.table === 'rpc/save_envelope_draft').pop().body
  expect(save).toMatchObject({ p_remind_every_days: 7, p_expire_after_days: 14, p_allow_signer_adjustments: true })
  const [template] = db.templates
  expect(template).toMatchObject({ name: 'NDA template', remind_every_days: 7, expire_after_days: 14, allow_signer_adjustments: true })
  expect(db.templateRoles).toEqual([expect.objectContaining({ name: 'Client', role: 'signer', default_email: null })])
  expect(db.templateFields.map(f => f.type)).toEqual(['signature', 'text'])
  expect(db.files.has(`templates/${template.id}/original.pdf`)).toBe(true)

  // Use it from the Templates page
  await page.getByRole('link', { name: 'Templates' }).click()
  await expect(page.getByTestId('template-row')).toContainText('NDA template')
  await expect(page.getByTestId('template-row')).toContainText('Client · 2 pages')
  await page.getByRole('button', { name: 'Use' }).click()
  const use = page.getByRole('dialog', { name: 'Use "NDA template"' })
  await use.getByLabel('Envelope title').fill('NDA for Acme')
  await use.getByRole('button', { name: 'Create envelope' }).click()
  await expect(use.getByRole('alert')).toHaveText('Enter a name for Client.')
  await use.getByLabel('Client name').fill('Acme Co')
  await use.getByLabel('Client email').fill('legal@acme.example')
  await use.getByRole('button', { name: 'Create envelope' }).click()

  // A new draft with the person, fields, settings and document in place, ready to review
  await expect(page).toHaveURL(/\/envelopes\/[0-9a-f-]{36}$/)
  const created = page.url().split('/').pop()
  expect(created).not.toBe(firstEnvelope)
  await expect(page.getByLabel('Envelope title')).toHaveValue('NDA for Acme')
  await expect(page.getByLabel('Recipient name')).toHaveValue('Acme Co')
  await expect(page.getByTestId('field')).toHaveCount(2)
  await expect(page.getByLabel('Remind signers')).toHaveValue('7')
  await expect(page.getByLabel('Expires after')).toHaveValue('14')
  await expect(page.getByLabel('Let signers adjust their fields')).toBeChecked()
  await expect(page.getByText('Everything is in place.')).toBeVisible()
  expect(db.files.has(`documents/${created}/original.pdf`)).toBe(true)
  expect(db.envelopes.find(e => e.id === created).original_path).toBe(`${created}/original.pdf`)

  // Delete the template
  await page.goto('/templates')
  await page.getByTitle('Delete template').click()
  await answerDialog(page)
  await expect(page.getByText('No templates yet.')).toBeVisible()
  expect(db.files.has(`templates/${template.id}/original.pdf`)).toBe(false)
})

test('a template can be saved before the people are known', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await page.getByRole('button', { name: 'Add recipient' }).click()
  await addField(page, 'Signature')

  await page.getByRole('button', { name: 'Save as template' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as template' })
  await dialog.getByLabel('Role 1 name').fill('Client')
  await expect(dialog.getByText(/Always send to/)).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await expect(page.getByRole('status')).toContainText('Saved as a template')
  expect(db.templateRoles).toEqual([expect.objectContaining({ name: 'Client', default_name: null, default_email: null })])
  expect(db.templateFields.map(f => f.type)).toEqual(['signature'])
})

test('the sender can stay a fixed person on the template', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
  await expect(page.getByTestId('document-page').first()).toBeVisible()
  await page.getByLabel('I need to sign this document').check()
  await addField(page, 'Signature')
  await page.getByRole('button', { name: 'Save as template' }).click()

  const dialog = page.getByRole('dialog', { name: 'Save as template' })
  await expect(dialog.getByLabel('Role 1 name')).toHaveValue('Sender')
  await expect(dialog.getByLabel('Always send to Alice Owner')).toBeChecked()
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await expect(page.getByRole('status')).toContainText('Saved as a template')
  expect(db.templateRoles[0]).toMatchObject({ name: 'Sender', default_email: 'alice@flmlnk.com' })

  // Using it needs nothing typed in: the sender is filled in already
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Use' }).click()
  const use = page.getByRole('dialog')
  await expect(use.getByLabel('Sender email')).toHaveValue('alice@flmlnk.com')
  await use.getByRole('button', { name: 'Create envelope' }).click()
  await expect(page.getByLabel('Recipient email')).toHaveValue('alice@flmlnk.com')
})

test('a sent envelope shows its reminder schedule and deadline', async ({ page }) => {
  const id = seedEnvelope(db, {
    pdf: await makePdf(),
    title: 'Offer letter',
    remind_every_days: 3,
    expires_at: '2026-10-24T06:00:00Z',
    recipients: [{ name: 'Carol', email: 'carol@client.com', status: 'sent' }]
  })
  await page.goto(`/envelopes/${id}`)
  await expect(page.getByText('Reminders every 3 days')).toBeVisible()
  await expect(page.getByTestId('expires-at')).toContainText('Expires')
  await expect(page.getByLabel('Remind signers')).toHaveCount(0)
  await expect(page.getByTestId('signer-adjustments')).toHaveText('Signers cannot move fields')
})

/** A template with one Client role (a signature) and a fixed Alice role (a date). */
async function seedTemplate() {
  const id = '11111111-1111-4111-8111-111111111111'
  db.templates.push({
    id, owner_id: fakeSession().user.id, name: 'NDA template', original_filename: 'nda.pdf', page_count: 2, signing_order: 'sequential',
    message: null, remind_every_days: 3, expire_after_days: 30, allow_signer_adjustments: false, shared: true, created_at: new Date().toISOString()
  })
  db.templateRoles.push(
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', template_id: id, name: 'Client', role: 'signer', routing_order: 1, color: '#2563eb', default_name: null, default_email: null },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', template_id: id, name: 'FLMLNK', role: 'signer', routing_order: 2, color: '#16a34a', default_name: 'Alice Owner', default_email: 'alice@flmlnk.com' }
  )
  db.templateFields.push(
    { template_id: id, role_id: 'aaaaaaaa-0000-4000-8000-000000000001', page: 1, type: 'signature', x: 0.1, y: 0.1, w: 0.3, h: 0.06, required: true, label: null, font_size: 12 },
    { template_id: id, role_id: 'aaaaaaaa-0000-4000-8000-000000000002', page: 1, type: 'date', x: 0.5, y: 0.5, w: 0.2, h: 0.03, required: true, label: null, font_size: 12 }
  )
  db.files.set(`templates/${id}/original.pdf`, Buffer.from(await makePdf()))
  return id
}

test('edit a template: change its fields and roles, then save it back', async ({ page }) => {
  const id = await seedTemplate()
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Edit NDA template' }).click()

  // The template opens in the editor, with its roles as recipients
  await expect(page).toHaveURL(/\/envelopes\/[0-9a-f-]{36}$/)
  await expect(page.getByText('Editing template ·')).toBeVisible()
  await expect(page.getByTestId('field')).toHaveCount(2)
  await expect(page.getByLabel('Recipient name').first()).toHaveValue('Client')
  await expect(page.getByLabel('Recipient email').first()).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save as template' })).toHaveCount(0)

  await page.getByLabel('Template name').fill('NDA template v2')
  await page.getByLabel('Recipient name').first().fill('Customer')
  await addField(page, 'Text')
  await page.getByRole('button', { name: 'Save template' }).click()

  // Back on Templates with the changes; the working copy is gone and never showed as an envelope
  await expect(page).toHaveURL(/\/templates$/)
  await expect(page.getByTestId('template-row')).toContainText('NDA template v2')
  await expect(page.getByTestId('template-row')).toContainText('Customer · FLMLNK')
  expect(db.templates[0]).toMatchObject({ id, name: 'NDA template v2' })
  expect(db.templateRoles.map(r => [r.name, r.default_email])).toEqual([['Customer', null], ['FLMLNK', 'alice@flmlnk.com']])
  expect(db.templateFields.map(f => f.type).sort()).toEqual(['date', 'signature', 'text'])
  expect(db.envelopes).toHaveLength(0)
  // The dashboard asks only for real envelopes
  await page.getByRole('link', { name: 'Envelopes' }).first().click()
  await expect.poll(() => db.calls.some(c => c.table === 'envelopes' && c.params.editing_template_id === 'is.null')).toBe(true)
})

test('cancelling a template edit leaves the template as it was', async ({ page }) => {
  await seedTemplate()
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Edit NDA template' }).click()
  await expect(page.getByTestId('field')).toHaveCount(2)
  await page.getByLabel('Template name').fill('Changed')
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await answerDialog(page)
  await expect(page).toHaveURL(/\/templates$/)
  await expect(page.getByTestId('template-row')).toContainText('NDA template')
  expect(db.templates[0].name).toBe('NDA template')
  expect(db.templateFields).toHaveLength(2)
  expect(db.envelopes).toHaveLength(0)
})
