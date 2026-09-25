import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Download, LayoutTemplate, PenLine, RotateCw, Save, Send } from 'lucide-react'
import { STATUS_LABELS, senderName } from '../../lib/envelopeModel'

/**
 * Title bar of the envelope editor: back link, title, save status, and the actions for the
 * mode the page is in (preparing a draft, editing a template, or viewing a sent envelope).
 */
export default function EditorHeader({
  envelope, draft, editable, editingTemplate, ownsEnvelope, dirty, saveStatus, saving, busy,
  sendProblems, mySigningTurn, awaitingFinalize,
  onTitleChange, onSave, onSend, onSaveAsTemplate, onFinishTemplate, onCancelTemplate, onRetryFinalize, onDownloadSigned
}) {
  return (
    <header className="h-16 px-4 bg-white border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
      <Link
        to={editingTemplate ? '/templates' : '/'}
        className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        title={editingTemplate ? 'Back to templates (your changes are kept until you save or cancel)' : 'Back to envelopes'}
      >
        <ArrowLeft size={18} />
      </Link>
      <div className="flex-1 min-w-0">
        {editable ? (
          <input
            value={draft.title}
            onChange={(e) => onTitleChange(e.target.value)}
            maxLength={200}
            className="w-full max-w-xl bg-transparent text-base text-gray-900 font-semibold outline-none rounded px-1 -mx-1 hover:bg-gray-50 focus:bg-gray-50"
            aria-label={editingTemplate ? 'Template name' : 'Envelope title'}
          />
        ) : (
          <h1 className="text-base text-gray-900 font-semibold truncate">{draft.title}</h1>
        )}
        <p className="text-xs text-gray-500 truncate">
          {editingTemplate && <span className="font-medium text-violet-700">Editing template · </span>}
          {editable
            ? <span className={dirty ? 'text-amber-700' : undefined} data-testid="save-status">{saveStatus}</span>
            : <span data-testid="envelope-status">{STATUS_LABELS[envelope.status]}</span>}
          {!ownsEnvelope && <> · Sent by {senderName(envelope)}</>}
          {envelope.original_filename && <> · {envelope.original_filename}</>}
        </p>
      </div>

      {ownsEnvelope && !editingTemplate && (
        <button
          onClick={onSaveAsTemplate}
          disabled={!draft.recipients.length}
          title={draft.recipients.length ? 'Reuse this document and its fields' : 'Add recipients and fields first'}
          aria-label="Save as template"
          className="btn-secondary px-3 py-2 rounded-md text-sm flex items-center gap-2"
        >
          <LayoutTemplate size={16} /> <span className="hidden lg:inline">Save as template</span>
        </button>
      )}

      {editingTemplate ? (
        <>
          <button onClick={onCancelTemplate} disabled={busy === 'template'} className="btn-secondary px-4 py-2 rounded-md text-sm">
            Cancel
          </button>
          <button
            onClick={onFinishTemplate}
            disabled={busy === 'template'}
            title="Update the template. Envelopes already created from it do not change."
            className="btn-primary px-5 py-2 rounded-md text-sm flex items-center gap-2"
          >
            <Check size={16} /> {busy === 'template' ? 'Saving…' : 'Save template'}
          </button>
        </>
      ) : editable ? (
        <>
          <button
            onClick={onSave}
            aria-label="Save"
            disabled={!dirty || saving}
            className="btn-secondary px-4 py-2 rounded-md text-sm flex items-center gap-2"
          >
            <Save size={16} /> <span className="hidden sm:inline">Save</span>
          </button>
          <button
            onClick={onSend}
            disabled={sendProblems.length > 0 || busy === 'send'}
            title={sendProblems.length ? 'Fix the items under "Ready to send?" first' : 'Email signing links'}
            className="btn-primary px-5 py-2 rounded-md text-sm flex items-center gap-2"
          >
            <Send size={16} /> {busy === 'send' ? 'Sending…' : 'Send'}
          </button>
        </>
      ) : (
        <>
          {mySigningTurn && (
            <Link to={`/envelopes/${envelope.id}/sign`} className="btn-primary px-5 py-2 rounded-md text-sm flex items-center gap-2">
              <PenLine size={16} /> Sign now
            </Link>
          )}
          {awaitingFinalize && (
            <button
              onClick={onRetryFinalize}
              disabled={busy === 'finalize'}
              className="btn-secondary px-4 py-2 rounded-md text-sm flex items-center gap-2"
              title="Everyone has signed; build the final PDF and email copies"
            >
              <RotateCw size={16} className={busy === 'finalize' ? 'animate-spin' : ''} /> Finish document
            </button>
          )}
          {envelope.status === 'completed' && envelope.final_path && (
            <button onClick={onDownloadSigned} className="btn-primary px-5 py-2 rounded-md text-sm flex items-center gap-2">
              <Download size={16} /> Download signed PDF
            </button>
          )}
        </>
      )}
    </header>
  )
}
