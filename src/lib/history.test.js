import { describe, it, expect } from 'vitest'
import { historyReducer, initialHistory, HISTORY_LIMIT } from './history'

const run = (actions, start = 0) => actions.reduce(historyReducer, initialHistory(start))
const set = (value, at = 0, coalesce) => ({ type: 'set', value, at, coalesce })

describe('undo history', () => {
  it('undoes and redoes each change', () => {
    let s = run([set(1), set(2), set(3)])
    s = historyReducer(s, { type: 'undo' })
    expect(s.present).toBe(2)
    s = historyReducer(s, { type: 'undo' })
    expect(s.present).toBe(1)
    s = historyReducer(s, { type: 'redo' })
    expect(s.present).toBe(2)
    // A new change after undoing drops what could be redone
    s = historyReducer(s, set(9))
    expect([s.present, s.future]).toEqual([9, []])
    expect(historyReducer(s, { type: 'redo' })).toBe(s)
  })

  it('treats quick changes with the same key as one step', () => {
    let s = run([set('a', 0, 'title'), set('ab', 300, 'title'), set('abc', 600, 'title')], '')
    expect(s.past).toEqual([''])
    // Later, or with another key, is a new step
    s = historyReducer(s, set('abcd', 5000, 'title'))
    s = historyReducer(s, set('x', 5100, 'message'))
    expect(s.past).toEqual(['', 'abc', 'abcd'])
    // Changes without a key never merge
    s = run([set(1, 0), set(2, 10)])
    expect(s.past).toEqual([0, 1])
  })

  it('does not merge across an undo', () => {
    let s = run([set('a', 0, 'k'), set('b', 1500, 'k')], '')
    s = historyReducer(s, { type: 'undo' })
    s = historyReducer(s, set('c', 1600, 'k'))
    expect(s.past).toEqual(['', 'a'])
  })

  it('ignores changes that change nothing, keeps a bounded history, and resets', () => {
    const s = run([set(1)])
    expect(historyReducer(s, set(v => v))).toBe(s)
    const long = run(Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => set(i + 1)))
    expect(long.past).toHaveLength(HISTORY_LIMIT)
    expect(historyReducer(long, { type: 'reset', value: 7 })).toEqual(initialHistory(7))
  })
})
