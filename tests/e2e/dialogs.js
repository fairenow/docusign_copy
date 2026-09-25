import { expect } from '@playwright/test'

/**
 * Answer the app's own confirm/ask dialog (FeedbackProvider): optionally check its text, type
 * an answer, then press its main button (or Cancel).
 */
export async function answerDialog(page, { accept = true, text, contains } = {}) {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('feedback-dialog')).toBeVisible()
  if (contains) await expect(dialog).toContainText(contains)
  if (text !== undefined) await dialog.getByRole('textbox').fill(text)
  if (accept) await dialog.locator('button[type=submit]').click()
  else await dialog.getByRole('button', { name: /Cancel|Stay|Keep editing/ }).click()
  await expect(dialog).toHaveCount(0)
}
