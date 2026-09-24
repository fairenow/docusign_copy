import { test, expect } from '@playwright/test'
import { ALICE, STORAGE_KEY, createMockDb, fakeSession, installMockSupabase } from './mockSupabase'
import { pdfFile } from './fixtures'
import { addField } from './placeField'

let db

test.beforeEach(async ({ page }) => {
  db = createMockDb()
  await installMockSupabase(page, db)
  page.on('pageerror', err => { throw err })
  await page.addInitScript(([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session))
  }, [STORAGE_KEY, fakeSession(ALICE)])
})

test('the sender fills in the other company\'s name; signers see it but cannot change it', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-envelope-input').setInputFiles(await pdfFile())
  await expect(page.getByTestId('document-page').first()).toBeVisible()

  // Works before any signer is added
  await addField(page, 'Fill in now')
  const box = page.locator('[data-field-type="prefill"] input')
  await expect(box).toBeVisible()
  await page.getByLabel('What is it? (e.g. Company name)').fill('Company name')

  await page.getByRole('tab', { name: 'Recipients' }).click()
  await page.getByRole('button', { name: 'Add recipient' }).click()
  await page.getByLabel('Recipient name').fill('Carol Client')
  await page.getByLabel('Recipient email').fill('carol@client.com')
  await addField(page, 'Signature')

  // Sending waits for the text
  await expect(page.getByText('Fill in "Company name" before sending.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
  await box.fill('Acme Holdings LLC')
  await expect(page.getByText('Everything is in place.')).toBeVisible()

  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('envelope-status')).toHaveText('Out for signature')

  const save = db.calls.filter(c => c.table === 'rpc/save_envelope_draft').pop().body
  const prefill = save.p_fields.find(f => f.type === 'prefill')
  expect(prefill).toMatchObject({ recipient_id: null, label: 'Company name', prefill: 'Acme Holdings LLC' })
  // The sender's own view shows the text, no longer editable
  await expect(page.locator('[data-field-type="prefill"]')).toContainText('Acme Holdings LLC')
  await expect(page.locator('[data-field-type="prefill"] input')).toHaveCount(0)

  // The signer sees it as part of the document
  const { link } = db.emails.find(e => e.to === 'carol@client.com')
  const signer = page
  await signer.goto(link)
  await signer.getByLabel('I agree to use electronic records and signatures.').check()
  await signer.getByRole('button', { name: 'Continue' }).click()
  const shown = signer.locator('[data-field-type="prefill"]')
  await expect(shown).toHaveText('Acme Holdings LLC')
  await expect(shown.locator('input')).toHaveCount(0)
  await expect(signer.getByTestId('remaining')).toHaveText('1 required field left')
})
