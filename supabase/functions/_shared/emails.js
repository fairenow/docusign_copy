/**
 * Email content for the signing workflow. Everything user-supplied (names, titles,
 * messages) is HTML-escaped: these emails come from our domain, so they must not be
 * usable to inject links or markup.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function layout({ heading, paragraphs, button, footer }) {
  const body = paragraphs.map(p => `<p style="margin:0 0 16px;line-height:1.5">${p}</p>`).join('')
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="background:#2563eb;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">${heading}</h1>${body}${cta}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.5">${footer}</p>
</div></body></html>`
}

const quote = (message) => `<span style="display:block;border-left:3px solid #d1d5db;padding-left:12px;color:#374151;white-space:pre-wrap">${escapeHtml(message)}</span>`

export function signingRequestEmail({ recipientName, senderName, title, message, link }) {
  const paragraphs = [
    `Hi ${escapeHtml(recipientName)},`,
    `${escapeHtml(senderName)} sent you <strong>${escapeHtml(title)}</strong> to review and sign.`
  ]
  if (message) paragraphs.push(quote(message))
  return {
    subject: `Please sign: ${title}`,
    html: layout({
      heading: 'You have a document to sign',
      paragraphs,
      button: { href: link, label: 'Review and sign' },
      footer: 'This link is personal to you. Do not forward this email. If you were not expecting it, you can ignore it.'
    }),
    text: `Hi ${recipientName},\n\n${senderName} sent you "${title}" to review and sign.\n${message ? `\n${message}\n` : ''}\nReview and sign: ${link}\n\nThis link is personal to you. Do not forward this email.`
  }
}

/** Deadline for the email text, e.g. "October 24, 2026" (UTC, so every recipient sees the same date). */
export function formatDeadline(value) {
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export function reminderEmail({ recipientName, senderName, title, link, expiresAt }) {
  const deadline = expiresAt ? formatDeadline(expiresAt) : null
  const paragraphs = [
    `Hi ${escapeHtml(recipientName)},`,
    `This is a reminder that ${escapeHtml(senderName)} is waiting for you to sign <strong>${escapeHtml(title)}</strong>.`
  ]
  if (deadline) paragraphs.push(`Please sign by <strong>${escapeHtml(deadline)}</strong>, when the request expires.`)
  return {
    subject: `Reminder: please sign ${title}`,
    html: layout({
      heading: 'A document is waiting for your signature',
      paragraphs,
      button: { href: link, label: 'Review and sign' },
      footer: 'This link is personal to you. Do not forward this email. Links in earlier emails still work.'
    }),
    text: `Hi ${recipientName},\n\nThis is a reminder that ${senderName} is waiting for you to sign "${title}".${deadline ? ` Please sign by ${deadline}, when the request expires.` : ''}\n\nReview and sign: ${link}\n\nThis link is personal to you. Do not forward this email.`
  }
}

export function expiredEmail({ ownerName, title, link }) {
  const paragraphs = [
    `Hi ${escapeHtml(ownerName)},`,
    `<strong>${escapeHtml(title)}</strong> expired before everyone signed. Its signing links no longer work.`,
    'To try again, use the document as a template or upload it in a new envelope.'
  ]
  return {
    subject: `Expired: ${title}`,
    html: layout({
      heading: 'An envelope expired',
      paragraphs,
      button: { href: link, label: 'View envelope' },
      footer: 'You set how long envelopes stay open when you prepare them.'
    }),
    text: `Hi ${ownerName},\n\n"${title}" expired before everyone signed. Its signing links no longer work.\n\nView envelope: ${link}`
  }
}

export function completedEmail({ recipientName, title, link }) {
  const paragraphs = [
    `Hi ${escapeHtml(recipientName)},`,
    `Everyone has signed <strong>${escapeHtml(title)}</strong>. The completed document, including its certificate of completion, is attached.`
  ]
  return {
    subject: `Completed: ${title}`,
    html: layout({
      heading: 'Document completed',
      paragraphs,
      button: link ? { href: link, label: 'Open in DocSign' } : null,
      footer: 'Keep this email for your records.'
    }),
    text: `Hi ${recipientName},\n\nEveryone has signed "${title}". The completed document is attached.${link ? `\n\nOpen in DocSign: ${link}` : ''}`
  }
}

export function declinedEmail({ ownerName, recipientName, title, reason, link }) {
  const paragraphs = [
    `Hi ${escapeHtml(ownerName)},`,
    `${escapeHtml(recipientName)} declined to sign <strong>${escapeHtml(title)}</strong>. The envelope is closed and the remaining signing links no longer work.`
  ]
  if (reason) paragraphs.push(quote(reason))
  return {
    subject: `Declined: ${title}`,
    html: layout({
      heading: 'A recipient declined to sign',
      paragraphs,
      button: { href: link, label: 'View envelope' },
      footer: 'You can correct the document and send a new envelope.'
    }),
    text: `Hi ${ownerName},\n\n${recipientName} declined to sign "${title}".${reason ? `\n\nReason: ${reason}` : ''}\n\nView envelope: ${link}`
  }
}
