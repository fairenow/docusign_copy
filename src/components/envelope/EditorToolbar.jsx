import { Redo2, Sparkles, Undo2 } from 'lucide-react'
import PageControls from '../PageControls'

/** Page and zoom controls; while editing also undo/redo and Suggest fields. */
export default function EditorToolbar({ pages, editing, history, suggest }) {
  const historyButtons = [
    { label: 'Undo', title: 'Undo (Ctrl+Z)', icon: Undo2, onClick: history.undo, enabled: history.canUndo },
    { label: 'Redo', title: 'Redo (Ctrl+Shift+Z)', icon: Redo2, onClick: history.redo, enabled: history.canRedo }
  ]
  return (
    <div className="h-12 px-2 sm:px-4 bg-white/90 backdrop-blur border-b border-gray-200/80 flex items-center gap-3 flex-shrink-0 overflow-x-auto [scrollbar-width:none]">
      <PageControls {...pages} />
      {editing && (
        <>
          <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label="History">
            {historyButtons.map(({ label, title, icon: Icon, onClick, enabled }) => (
              <button
                key={label}
                onClick={onClick}
                disabled={!enabled}
                className="icon-btn w-8 h-8"
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
            className="ml-auto btn-secondary px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 whitespace-nowrap flex-shrink-0"
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
