import { Redo2, Sparkles, Undo2 } from 'lucide-react'
import PageControls from '../PageControls'

/** Page and zoom controls; while editing also undo/redo and Suggest fields. */
export default function EditorToolbar({ pages, editing, history, suggest }) {
  const historyButtons = [
    { label: 'Undo', title: 'Undo (Ctrl+Z)', icon: Undo2, onClick: history.undo, enabled: history.canUndo },
    { label: 'Redo', title: 'Redo (Ctrl+Shift+Z)', icon: Redo2, onClick: history.redo, enabled: history.canRedo }
  ]
  return (
    <div className="h-11 px-2 sm:px-4 bg-white border-b border-gray-200 flex items-center gap-3 flex-shrink-0 overflow-x-auto">
      <PageControls {...pages} />
      {editing && (
        <>
          <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label="History">
            {historyButtons.map(({ label, title, icon: Icon, onClick, enabled }) => (
              <button
                key={label}
                onClick={onClick}
                disabled={!enabled}
                className="p-1.5 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
                title={title}
                aria-label={label}
              >
                <Icon size={17} />
              </button>
            ))}
          </div>
          <button
            onClick={suggest.run}
            disabled={!suggest.ready || suggest.busy}
            title="Find the blank lines and placeholders and suggest fields for them"
            className="ml-auto btn-secondary px-3 py-1.5 rounded-md text-sm flex items-center gap-2 whitespace-nowrap flex-shrink-0"
          >
            <Sparkles size={15} className="text-violet-600" />
            <span className="hidden sm:inline">{suggest.busy ? 'Reading the document…' : 'Suggest fields'}</span>
            <span className="sm:hidden">{suggest.busy ? 'Reading…' : 'Suggest'}</span>
          </button>
        </>
      )}
    </div>
  )
}
