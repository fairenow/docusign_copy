import { createContext, useContext } from 'react'

/**
 * In-app replacements for the browser's alert/confirm/prompt (see FeedbackProvider):
 *   const { confirm, ask, notify } = useFeedback()
 *   if (await confirm({ title, message, confirmLabel, danger })) …      // true / false
 *   const reason = await ask({ title, message, label, confirmLabel })    // text, or null if cancelled
 *   notify('Draft deleted', { action: { label: 'Undo', onClick } })     // short message in the corner
 */
export const FeedbackContext = createContext(null)

export function useFeedback() {
  const context = useContext(FeedbackContext)
  if (!context) throw new Error('useFeedback must be used inside <FeedbackProvider>')
  return context
}
