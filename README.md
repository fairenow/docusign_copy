# DocSign - Document Signer

A free, privacy-focused document signing application built with React. Upload PDFs or DOCX files and add signatures, text fields, dates, initials, and checkboxes.

![DocSign Screenshot](https://via.placeholder.com/800x450?text=DocSign+Preview)

## Features

- 📄 **PDF & DOCX Support** - Upload and view both file types
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
| `templates`, `template_roles`, `template_fields` | Reusable documents |

Access rules (row level security):

- Sign-ups are limited to the domains in `private.allowed_email_domains` (seeded with
  `flmlnk.com`). The first user to sign up becomes an admin.
- Owners edit envelopes only while they are drafts. Sending, signing and completing
  happen in Edge Functions with the service role; voiding uses the `void_envelope` RPC.
- Team members listed as recipients can see an envelope once it has been sent.
- External signers never get a database session; they use a tokenized signing link.
- Files are stored in the private `documents` bucket as `<envelope_id>/original.pdf`
  and `<envelope_id>/signed.pdf`.

### Configuration

Copy `.env.example` to `.env.local` and fill in the publishable key from
Project Settings → API. Never put the service-role key in a `VITE_` variable.
