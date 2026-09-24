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
