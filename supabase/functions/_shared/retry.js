/**
 * Supabase sometimes rejects a brand-new token with "JWT issued at future" (PGRST303): the
 * server that issued it runs a moment ahead of the one checking it. Waiting briefly and
 * sending the same request again succeeds, so wrap fetch to do exactly that, once.
 * Shared by the app and the Edge Functions (no dependencies).
 */
export function retryWhenTokenIsTooNew(fetchImpl, { delayMs = 1500 } = {}) {
  return async (input, init) => {
    const response = await fetchImpl(input, init)
    if (response.status !== 401) return response
    const body = await response.clone().text().catch(() => '')
    if (!/PGRST303|issued at future/i.test(body)) return response
    await new Promise(resolve => setTimeout(resolve, delayMs))
    return fetchImpl(input, init)
  }
}
