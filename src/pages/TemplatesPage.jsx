import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LayoutTemplate, Lock, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { deleteTemplate, listTemplates, startTemplateEdit } from '../lib/api'
import { sortedRoles } from '../lib/templateModel'
import { canManageTemplate, isOwner, senderName } from '../lib/envelopeModel'
import { formatDateTime } from '../lib/format'
import UseTemplateDialog from '../components/templates/UseTemplateDialog'
import ErrorBanner from '../components/ErrorBanner'
import { SkeletonRows } from '../components/Skeleton'
import { useFeedback } from '../components/feedback/useFeedback'

/** Reusable documents: start an envelope with the fields already placed. */
export default function TemplatesPage() {
  const { user, profile, isAdmin } = useAuth()
  const [templates, setTemplates] = useState(null)
  const [error, setError] = useState(null)
  const [using, setUsing] = useState(null)
  const [opening, setOpening] = useState(null)
  const navigate = useNavigate()
  const { confirm, notify } = useFeedback()

  useEffect(() => {
    listTemplates().then(setTemplates, err => setError(err.message))
  }, [])

  const canManage = (t) => canManageTemplate(t, user, isAdmin)

  const handleEdit = async (template) => {
    setError(null)
    setOpening(template.id)
    try {
      navigate(`/envelopes/${await startTemplateEdit(template)}`)
    } catch (err) {
      setError(err.message)
      setOpening(null)
    }
  }

  const handleDelete = async (template) => {
    const sure = await confirm({
      title: `Delete "${template.name}"?`,
      message: 'The template is removed for everyone. Envelopes already created from it are not affected.',
      confirmLabel: 'Delete template',
      danger: true
    })
    if (!sure) return
    setError(null)
    try {
      await deleteTemplate(template)
      setTemplates(list => list.filter(t => t.id !== template.id))
      notify(`Deleted the template "${template.name}".`)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="max-w-4xl w-full mx-auto px-4 sm:px-8 pt-6 pb-8 sm:pt-10">
      <h1 className="page-title text-[2.5rem] sm:text-5xl">Templates</h1>
      <p className="text-sm text-gray-500 mt-2 mb-6 sm:mb-8">
        Start an envelope with the document and fields already in place. To make one, prepare an envelope and choose
        <span className="font-medium text-gray-700"> Save as template</span>.
      </p>
      <ErrorBanner className="mb-4">{error}</ErrorBanner>

      {templates === null && !error ? (
        <SkeletonRows count={3} />
      ) : templates?.length === 0 ? (
        <div className="card p-10 text-center">
          <span className="mx-auto mb-4 w-12 h-12 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center" aria-hidden="true"><LayoutTemplate size={22} /></span>
          <p className="text-sm text-gray-600 mb-1">No templates yet.</p>
          <p className="text-sm text-gray-500">
            Open an <Link to="/" className="font-medium text-blue-700 hover:underline">envelope</Link>, place its fields, then choose Save as template.
          </p>
        </div>
      ) : (
        <ul className="card divide-y divide-gray-100 overflow-hidden">
          {templates?.map(t => (
            <li key={t.id} className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 hover:bg-gray-50/80 transition-colors" data-testid="template-row">
              <span className="hidden sm:flex w-10 h-10 flex-shrink-0 rounded-lg bg-violet-50 text-violet-600 items-center justify-center" aria-hidden="true"><LayoutTemplate size={18} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 font-semibold truncate flex items-center gap-1.5">
                  {t.name}
                  {!t.shared && <Lock size={12} className="text-gray-400" aria-label="Only you can see this template" />}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {sortedRoles(t).map(r => r.name).join(' · ')}
                  {t.page_count ? ` · ${t.page_count} page${t.page_count > 1 ? 's' : ''}` : ''}
                  {` · ${isOwner(t, user) ? 'You' : senderName(t)}, ${formatDateTime(t.created_at)}`}
                </p>
              </div>
              <button onClick={() => setUsing(t)} className="btn-primary px-4 py-2 rounded-lg text-sm">Use</button>
              {canManage(t) && (
                <>
                  <button
                    onClick={() => handleEdit(t)}
                    disabled={opening !== null}
                    className="icon-btn w-8 h-8"
                    title="Edit template"
                    aria-label={`Edit ${t.name}`}
                  >
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleDelete(t)} className="icon-btn w-8 h-8 hover:text-red-600 hover:bg-red-50" title="Delete template">
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {using && (
        <UseTemplateDialog
          template={using}
          me={{ name: profile?.full_name || user?.email?.split('@')[0] || '', email: user?.email ?? '' }}
          onClose={() => setUsing(null)}
        />
      )}
    </div>
  )
}
