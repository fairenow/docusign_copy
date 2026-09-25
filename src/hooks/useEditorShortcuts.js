import { useEffect, useRef } from 'react'

const isTyping = (target) => target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/**
 * Keyboard shortcuts of the envelope editor, while `enabled`:
 *   Ctrl/Cmd+S saves; Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes (in a text box the
 *   browser's own undo of the typing applies instead); Esc calls `onEscape` when given.
 */
export function useEditorShortcuts({ enabled, onSave, onUndo, onRedo, onEscape }) {
  // Always call the latest handlers without re-adding the listener on every render
  const handlers = useRef({ onSave, onUndo, onRedo, onEscape })
  useEffect(() => { handlers.current = { onSave, onUndo, onRedo, onEscape } })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e) => {
      const { onSave, onUndo, onRedo, onEscape } = handlers.current
      if (e.key === 'Escape') {
        onEscape?.()
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        onSave()
      } else if ((key === 'z' || key === 'y') && !isTyping(e.target)) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) onRedo()
        else onUndo()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
