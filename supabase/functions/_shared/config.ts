import { HttpError } from './http.ts'

/**
 * Required secrets (Supabase dashboard → Edge Functions → Secrets):
 *   APP_URL         e.g. https://docsign.example.com — base URL for links in emails
 *   EMAIL_FROM      e.g. "DocSign <sign@yourdomain.com>" (a Resend-verified domain)
 *   RESEND_API_KEY  Resend API key
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 */
export function emailConfig() {
  const appUrl = Deno.env.get('APP_URL')?.replace(/\/+$/, '')
  const from = Deno.env.get('EMAIL_FROM')
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!appUrl || !from || !apiKey) {
    throw new HttpError(503, 'Sending is not configured yet: set APP_URL, EMAIL_FROM and RESEND_API_KEY for the Edge Functions.')
  }
  if (!/^https?:\/\//.test(appUrl)) throw new HttpError(503, 'APP_URL must start with https://')
  return { appUrl, from, apiKey }
}

/**
 * Word-to-PDF converter (Gotenberg, i.e. LibreOffice, on a server we control):
 *   CONVERTER_URL       e.g. https://docsign-converter.up.railway.app
 *   CONVERTER_USERNAME  basic-auth username set on the converter
 *   CONVERTER_PASSWORD  basic-auth password set on the converter
 */
export function converterConfig() {
  // Trimmed: stray spaces are easy to paste into the dashboard
  const url = Deno.env.get('CONVERTER_URL')?.trim().replace(/\/+$/, '')
  const username = Deno.env.get('CONVERTER_USERNAME')?.trim()
  const password = Deno.env.get('CONVERTER_PASSWORD')?.trim()
  if (!url || !username || !password) {
    // Name what is missing (never values) so an admin can fix it from the message alone
    const missing = Object.entries({ CONVERTER_URL: url, CONVERTER_USERNAME: username, CONVERTER_PASSWORD: password })
      .filter(([, value]) => !value).map(([name]) => name)
    throw new HttpError(503, `Word conversion is not set up yet (missing Edge Function secret${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}). Upload a PDF instead, or ask an admin to connect the converter.`)
  }
  if (!/^https:\/\//.test(url)) throw new HttpError(503, 'CONVERTER_URL must start with https://')
  return { url, username, password }
}

