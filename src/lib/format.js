/** "Sep 24, 2026, 1:05 AM" in the viewer's locale and time zone. */
export function formatDateTime(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
