import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createEnvelopeFromTemplate } from '../../lib/api'
import { initialPeople, sortedRoles, validatePeople } from '../../lib/templateModel'
import Modal from '../Modal'
import ErrorBanner from '../ErrorBanner'

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500'

/**
 * Fill in who takes each role, then create a draft envelope and open it for a final check.
 * me: { name, email } of the signed-in user, offered as a one-click choice.
 */
export default function UseTemplateDialog({ template, me, onClose }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(template.name)
  const [people, setPeople] = useState(() => initialPeople(template))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const setPerson = (roleId, patch) => setPeople(p => ({ ...p, [roleId]: { ...p[roleId], ...patch } }))

  const submit = async (e) => {
    e.preventDefault()
    const problems = validatePeople(template, people)
    if (problems.length) return setError(problems[0])
    setBusy(true)
    setError(null)
    try {
      const id = await createEnvelopeFromTemplate(template, title, people)
      navigate(`/envelopes/${id}`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Use "${template.name}"`} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-xs text-gray-500">
          Envelope title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={`${inputClass} mt-1`} />
        </label>

        <ul className="space-y-3">
          {sortedRoles(template).map(role => (
            <li key={role.id} className="border border-gray-200 rounded-lg p-3" data-testid="template-role">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
                <span className="flex-1 text-sm font-medium text-gray-900">{role.name}</span>
                <span className="text-xs text-gray-500">{role.role === 'cc' ? 'Gets a copy' : 'Signs'}</span>
                {me?.email && (
                  <button type="button" onClick={() => setPerson(role.id, me)} className="text-xs text-blue-600 hover:underline">
                    Me
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={people[role.id].name}
                  onChange={(e) => setPerson(role.id, { name: e.target.value })}
                  placeholder="Full name"
                  aria-label={`${role.name} name`}
                  maxLength={200}
                  className={inputClass}
                />
                <input
                  type="email"
                  value={people[role.id].email}
                  onChange={(e) => setPerson(role.id, { email: e.target.value })}
                  placeholder="Email"
                  aria-label={`${role.name} email`}
                  maxLength={320}
                  className={inputClass}
                />
              </div>
            </li>
          ))}
        </ul>

        <ErrorBanner>{error}</ErrorBanner>
        <div className="flex items-center justify-end gap-2">
          <p className="flex-1 text-xs text-gray-500">You can review everything before sending.</p>
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 rounded-md text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary px-4 py-2 rounded-md text-sm">
            {busy ? 'Creating…' : 'Create envelope'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
