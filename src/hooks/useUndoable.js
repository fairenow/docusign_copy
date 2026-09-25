import { useCallback, useMemo, useReducer } from 'react'
import { historyReducer, initialHistory } from '../lib/history'

/**
 * State with undo and redo. `set(valueOrUpdater, { coalesce })` records a step (see
 * lib/history.js); `reset(value)` replaces the value and forgets the history.
 */
export function useUndoable(initial) {
  const [state, dispatch] = useReducer(historyReducer, initial, initialHistory)
  const set = useCallback((value, { coalesce } = {}) => dispatch({ type: 'set', value, coalesce, at: Date.now() }), [])
  const controls = useMemo(() => ({
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    reset: (value) => dispatch({ type: 'reset', value })
  }), [])
  return [state.present, set, { ...controls, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }]
}
