import { EXPIRY_OPTIONS, REMINDER_OPTIONS, reminderSummary } from '../../lib/envelopeModel'
import { formatDateTime } from '../../lib/format'

const selectClass = 'w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500'

/**
 * How often waiting signers are reminded and how long the envelope stays open.
 * Read-only once sent: shows the settings and the deadline.
 */
export default function ReminderSettings({ remindEveryDays, expireAfterDays, expiresAt, readOnly, onChange }) {
  if (readOnly) {
    return (
      <section>
        <h2 className="section-heading mb-2">Reminders and expiration</h2>
        <p className="text-sm text-gray-600">{reminderSummary(remindEveryDays)}</p>
        {expiresAt && <p className="text-sm text-gray-600" data-testid="expires-at">Expires {formatDateTime(expiresAt)}</p>}
      </section>
    )
  }
  // Values set elsewhere (e.g. directly in the database) stay selectable
  return (
    <section>
      <h2 className="section-heading mb-2">Reminders and expiration</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-500">
          Remind signers
          <select
            value={remindEveryDays ?? ''}
            onChange={(e) => onChange({ remindEveryDays: e.target.value ? Number(e.target.value) : null })}
            className={`${selectClass} mt-1`}
          >
            {!REMINDER_OPTIONS.some(o => o.value === remindEveryDays) && <option value={remindEveryDays}>{reminderSummary(remindEveryDays)}</option>}
            {REMINDER_OPTIONS.map(o => <option key={o.label} value={o.value ?? ''}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Expires after
          <select
            value={expireAfterDays}
            onChange={(e) => onChange({ expireAfterDays: Number(e.target.value) })}
            className={`${selectClass} mt-1`}
          >
            {!EXPIRY_OPTIONS.some(o => o.value === expireAfterDays) && <option value={expireAfterDays}>{expireAfterDays} days</option>}
            {EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-gray-500 mt-2">Signers whose turn it is get a reminder email until they sign. Unsigned envelopes close when they expire.</p>
    </section>
  )
}
