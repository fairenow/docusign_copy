/** "Sep 24, 2026, 1:05 AM" in the viewer's locale and time zone. */
export function formatDateTime(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", else "on Sep 3". */
export function timeAgo(value, now = Date.now()) {
  const elapsed = now - new Date(value).getTime()
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  }
  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return `on ${new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/** Whole days until `value` (rounded up), or null if it has passed. */
export function daysUntil(value, now = Date.now()) {
  const left = new Date(value).getTime() - now
  return left > 0 ? Math.ceil(left / DAY) : null
}
