/**
 * Undo/redo history for a value, as a reducer. Changes in quick succession that share a
 * `coalesce` key (typing in one box, dragging one field) are one step; everything else is a
 * step of its own. `reset` starts a new history (e.g. after loading).
 */
export const HISTORY_LIMIT = 100
export const COALESCE_MS = 1000

export const initialHistory = (value) => ({ present: value, past: [], future: [], lastKey: null, lastAt: 0 })

export function historyReducer(state, action) {
  switch (action.type) {
    case 'set': {
      const next = typeof action.value === 'function' ? action.value(state.present) : action.value
      if (next === state.present) return state
      const key = action.coalesce ?? null
      const merge = key !== null && key === state.lastKey && action.at - state.lastAt < COALESCE_MS
      return {
        present: next,
        past: merge ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT),
        future: [],
        lastKey: key,
        lastAt: action.at
      }
    }
    case 'undo': {
      if (!state.past.length) return state
      return {
        present: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future],
        lastKey: null,
        lastAt: 0
      }
    }
    case 'redo': {
      if (!state.future.length) return state
      return {
        present: state.future[0],
        past: [...state.past, state.present],
        future: state.future.slice(1),
        lastKey: null,
        lastAt: 0
      }
    }
    case 'reset':
      return initialHistory(action.value)
    default:
      return state
  }
}
