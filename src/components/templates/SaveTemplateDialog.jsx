import { useState } from 'react'
import { defaultTemplateRoles, validateTemplateRoles } from '../../lib/templateModel'
import Modal from '../Modal'
import ErrorBanner from '../ErrorBanner'

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500'

/**
 * Name a template and its roles. Each recipient becomes a role ("Signer 1", "Client"…) that is
 * filled in with a real person each time the template is used, unless it always goes to them.
 * onSave(name, roles) may throw; its message is shown.
 */
export default function SaveTemplateDialog({ title, recipients, myEmail, onSave, onClose }) {
  const [name, setName] = useState(title)
  const [roles, setRoles] = useState(() => defaultTemplateRoles(recipients, myEmail))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const changeRole = (recipientId, patch) => setRoles(rs => rs.map(r => (r.recipientId === recipientId ? { ...r, ...patch } : r)))

  const submit = async (e) => {
    e.preventDefault()
    const problems = validateTemplateRoles(name, roles)
    if (problems.length) return setError(problems[0])
    setBusy(true)
    setError(null)
    try {
      await onSave(name, roles)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Save as template" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-xs text-gray-500">
          Template name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={`${inputClass} mt-1`} autoFocus />
        </label>

        <section>
          <h3 className="section-heading mb-1">Roles</h3>
          <p className="text-xs text-gray-500 mb-2">Each time you use the template you enter who fills each role.</p>
          <ul className="space-y-3">
            {roles.map((role, i) => (
              <li key={role.recipientId} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
                  <input
                    value={role.name}
                    onChange={(e) => changeRole(role.recipientId, { name: e.target.value })}
                    maxLength={100}
                    aria-label={`Role ${i + 1} name`}
                    className={inputClass}
                  />
                  <span className="text-xs text-gray-500 whitespace-nowrap">{role.role === 'cc' ? 'Gets a copy' : 'Signs'}</span>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={role.keepRecipient}
                    onChange={(e) => changeRole(role.recipientId, { keepRecipient: e.target.checked })}
                  />
                  Always send to {role.person}
                </label>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-xs text-gray-500">
          The document, fields, signing order, message and reminder settings are saved. Templates are shared with your team.
        </p>
        <ErrorBanner>{error}</ErrorBanner>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 rounded-md text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary px-4 py-2 rounded-md text-sm">
            {busy ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
