import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LayoutTemplate, Lock, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { deleteTemplate, listTemplates, startTemplateEdit } from '../lib/api'
import { sortedRoles } from '../lib/templateModel'
import { formatDateTime } from '../lib/format'
import UseTemplateDialog from '../components/templates/UseTemplateDialog'
import ErrorBanner from '../components/ErrorBanner'
import { SkeletonRows } from '../components/Skeleton'
import { useFeedback } from '../components/feedback/useFeedback'

/** Reusable documents: start an envelope with the fields already placed. */
export default function TemplatesPage() {
  const { user, profile } = useAuth()
  const [templates, setTemplates] = useState(null)
  const [error, setError] = useState(null)
  const [using, setUsing] = useState(null)
  const [opening, setOpening] = useState(null)
  const navigate = useNavigate()
  const { confirm, notify } = useFeedback()

  useEffect(() => {
    listTemplates().then(setTemplates, err => setError(err.message))
  }, [])

  // The owner or an admin may change or delete a template
  const canManage = (t) => t.owner_id === user?.id || profile?.role === 'admin'

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
    <div className="max-w-4xl w-full mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Start an envelope with the document and fields already in place. To make one, prepare an envelope and choose
        <span className="font-medium text-gray-700"> Save as template</span>.
      </p>
      <ErrorBanner className="mb-4">{error}</ErrorBanner>

      {templates === null && !error ? (
        <SkeletonRows count={3} />
      ) : templates?.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <LayoutTemplate className="mx-auto text-gray-400 mb-3" size={28} />
          <p className="text-sm text-gray-600 mb-1">No templates yet.</p>
          <p className="text-sm text-gray-500">
            Open an <Link to="/" className="text-blue-600 hover:underline">envelope</Link>, place its fields, then choose Save as template.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-xl overflow-hidden">
          {templates?.map(t => (
            <li key={t.id} className="flex items-center gap-4 px-4 py-3" data-testid="template-row">
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 font-medium truncate flex items-center gap-1.5">
                  {t.name}
                  {!t.shared && <Lock size={12} className="text-gray-400" aria-label="Only you can see this template" />}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {sortedRoles(t).map(r => r.name).join(' · ')}
                  {t.page_count ? ` · ${t.page_count} page${t.page_count > 1 ? 's' : ''}` : ''}
                  {` · ${t.owner_id === user?.id ? 'You' : t.owner?.full_name || t.owner?.email || 'A teammate'}, ${formatDateTime(t.created_at)}`}
                </p>
              </div>
              <button onClick={() => setUsing(t)} className="btn-primary px-4 py-1.5 rounded-md text-sm">Use</button>
              {canManage(t) && (
                <>
                  <button
                    onClick={() => handleEdit(t)}
                    disabled={opening !== null}
                    className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-50"
                    title="Edit template"
                    aria-label={`Edit ${t.name}`}
                  >
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleDelete(t)} className="p-1.5 rounded text-gray-500 hover:text-red-600 hover:bg-gray-100" title="Delete template">
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
