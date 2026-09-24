# DocSign - Document Signer

A free, privacy-focused document signing application built with React. Upload PDFs or DOCX files and add signatures, text fields, dates, initials, and checkboxes.

![DocSign Screenshot](https://via.placeholder.com/800x450?text=DocSign+Preview)

## Features

- 📄 **PDF & DOCX Support** - Upload and view both file types
- 🧩 **Templates** - Reuse a prepared document with roles instead of people
- ⏰ **Reminders & expiration** - Automatic reminder emails; envelopes close at their deadline
- 📱 **Phone-friendly signing** - Pages fit the screen, big buttons within thumb reach
- ✍️ **Signature Drawing** - Draw signatures with mouse or touch
- ⌨️ **Typed Signatures** - Type your name in a cursive style
- 📝 **Text Fields** - Add custom text with configurable size and color
- 📅 **Date Fields** - Auto-filled with current date
- 🔤 **Initials** - Quick initial placement
- ☑️ **Checkboxes** - Toggleable checkboxes
- 📑 **Multi-page PDF** - Navigate through PDF pages
- 🔍 **Zoom Controls** - Zoom in/out for precision
- ⬇️ **PDF Export** - Download signed document as PDF

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/docsign-react.git
cd docsign-react

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Building for Production

```bash
npm run build
```

## Deployment to Vercel

### Option 1: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/docsign-react)

### Option 2: CLI Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Option 3: Git Integration

1. Push your code to GitHub/GitLab/Bitbucket
2. Import the project in [Vercel Dashboard](https://vercel.com/new)
3. Vercel will auto-detect Vite and deploy

## Tech Stack

- **React 18** + **Vite** + **Tailwind CSS**
- **PDF.js 4** - rendering (worker is self-hosted, no CDN)
- **pdf-lib** - writes fields into the original PDF (text stays searchable)
- **Mammoth.js** + **jsPDF** - DOCX is converted to PDF on upload
- **Supabase** - auth, Postgres, storage, Edge Functions (see below)
- **Resend** - signing request and completion emails
- **Lucide React** - icons

## Backend (Supabase)

The database schema lives in `supabase/migrations/` and is applied to the project
`tdgwdniwwkqqyfuoxnwx`.

| Table | Purpose |
|---|---|
| `profiles` | Team members, one per auth user (`admin` / `member`) |
| `envelopes` | A document out for signature (`draft → sent → completed / declined / voided`) |
| `recipients` | Signers and CCs, with routing order and signing status |
| `recipient_tokens` | SHA-256 hashes of signing-link tokens (service role only) |
| `fields` | Fields assigned to recipients; positions are page fractions (0–1) |
| `audit_events` | Append-only audit trail for the certificate of completion |
| `templates`, `template_roles`, `template_fields` | Reusable documents whose fields belong to roles ("Client") instead of people; shared with the team unless made private |
| `saved_signatures` | A team member's saved signatures and initials (only they can see them; up to 5 of each) |

Access rules (row level security):

- Sign-ups are limited to the domains in `private.allowed_email_domains` (seeded with
  `flmlnk.com`). The first user to sign up becomes an admin.
- Owners edit envelopes only while they are drafts. Sending, signing and completing
  happen in Edge Functions with the service role; voiding uses the `void_envelope` RPC.
- Team members listed as recipients can see an envelope once it has been sent.
- External signers never get a database session; they use a tokenized signing link.
- Files are stored in the private `documents` bucket as `<envelope_id>/original.pdf`
  and `<envelope_id>/signed.pdf`.

### Signing workflow (Edge Function `signing-api`)

Sending and signing run in one Edge Function (`supabase/functions/signing-api`, shared code in
`supabase/functions/_shared`), which calls service-role-only database functions (`svc_*`):

1. **Send** — the owner sends a draft; the document's SHA-256 is recorded and the first signers
   (or all, for parallel envelopes) are emailed a personal link `/sign/<token>`. Only the token's
   hash is stored.
2. **Sign** — the signer agrees to use electronic signatures, fills in their fields (guided), adopts
   a drawn or typed signature and finishes, or declines with a reason. Team members can also sign
   from the dashboard without the link. "Date signed" is set by the server.
3. **Complete** — when the last signer finishes, every field is stamped into the original PDF, a
   certificate of completion (signers, times, IP addresses, browsers, activity, fingerprints) is
   appended, the result is stored as `signed.pdf` with its SHA-256, and everyone is emailed a copy.

Email failures and a failed final step are written to the audit trail; the owner can resend a
signer's link or retry the final step from the envelope page.

### Reminders and expiration

Each envelope has a reminder interval (default every 3 days, or off) and a lifetime (default 30
days), chosen while preparing it. An hourly `pg_cron` job (`signing-reminders`) calls
`signing-api/reminders` with a random secret that lives only in Vault
(`signing_reminders_secret`); `svc_run_reminders` checks it, then:

- marks envelopes whose deadline passed before everyone signed as **expired**, removes their
  links and emails the sender;
- emails signers whose turn it is and who have not heard from us within the interval. Each
  reminder carries a new link; links in earlier emails keep working until the signer finishes
  or the envelope closes.

The job reads its target URL from the Vault secret `signing_reminders_url`; point it at another
project's `signing-api/reminders` when setting up a new environment.

### Templates

**Save as template** in the editor copies the document, fields, signing order, message and
reminder settings. Each recipient becomes a role; a role can keep its person (e.g. the sender who
always countersigns). **Templates → Use** asks for each role's name and email and opens a new
draft to review and send. `create_template_from_envelope` and `create_envelope_from_template`
run as the caller, so row level security decides what can be saved and used.

Edge Function secrets (Supabase dashboard → Edge Functions → Secrets):

| Secret | Example |
|---|---|
| `APP_URL` | `https://docsign.vercel.app` (links in emails point here) |
| `EMAIL_FROM` | `DocSign <sign@yourdomain.com>` (a domain verified in Resend) |
| `RESEND_API_KEY` | `re_...` |

### Word documents (LibreOffice converter)

PDFs are used exactly as uploaded. Word (`.docx`, `.doc`), OpenDocument (`.odt`) and RTF files
are converted to PDF on the server by LibreOffice, so their layout matches the original; nothing is
re-rendered in the browser. The browser sends the file to the `convert-document` Edge Function
(signed-in team members only), which forwards it to a private
[Gotenberg](https://github.com/gotenberg/gotenberg) container (LibreOffice behind basic auth). The
image ships fonts metric-compatible with Calibri, Cambria, Arial, Times New Roman and Courier, so
line breaks and page breaks match Word; fonts embedded in the document are used as-is.

Converter on Railway (one-time):

1. New project → **Deploy a Docker image** → `gotenberg/gotenberg:8`.
2. Variables: `API_ENABLE_BASIC_AUTH=true`, `GOTENBERG_API_BASIC_AUTH_USERNAME=docsign`,
   `GOTENBERG_API_BASIC_AUTH_PASSWORD=<long random password>`, `API_TIMEOUT=120s`.
3. Settings → Networking → **Generate domain** on port `3000`.
4. Supabase → Edge Functions → Secrets: `CONVERTER_URL=https://<railway domain>`,
   `CONVERTER_USERNAME=docsign`, `CONVERTER_PASSWORD=<same password>`.

Until those secrets are set, Word uploads show a clear message asking for a PDF instead.

### Sign-in

Team members sign in with an emailed one-time link (Supabase Auth, PKCE, so the link must be
opened in the same browser). Supabase Auth settings:

- **URL Configuration:** Site URL = the app URL; add `<app URL>/**` to Redirect URLs.
- **SMTP Settings:** use Resend (host `smtp.resend.com`, port `465`, user `resend`, password = a
  Resend API key, sender on a verified domain). The built-in mailer only sends a few emails an hour.
- **Rate Limits:** raise "emails sent per hour" once custom SMTP is on.

### Configuration

Copy `.env.example` to `.env.local` and fill in the publishable key from
Project Settings → API. Never put the service-role key in a `VITE_` variable.

## Tests

```bash
npm test          # unit tests (field geometry, envelope rules, PDF stamping, certificate, emails)
npm run test:e2e  # Playwright against an in-memory Supabase + signing-api mock
```
