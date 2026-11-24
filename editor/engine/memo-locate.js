// Which page a memo is on. The engine's caret gives a candidate page; the page layout confirms it.
// Plain ESM, no DOM, no engine: the document is passed in.
import { markThread } from './memo-marks.js'

/** @typedef {import('./memo-threads.js').MemoCaret} MemoCaret */
/** @typedef {import('./memo-threads.js').MemoThread} MemoThread */
/** @typedef {import('./memo-marks.js').AnchorRun} AnchorRun */

/**
 * What locating needs from an `EngineDocument`. Pages are numbered from 0.
 * @typedef {{
 *   pageCount: number,
 *   memoCaret(thread: MemoThread): MemoCaret | null,
 *   pageAnchorRuns(i: number): AnchorRun[]
 * }} MemoPages
 */

/** Repeated on many pages, or on none: there is no page to go to. */
const NO_PAGE = new Set(['header', 'footer', 'masterPage', 'unlinked'])

/** Only these have a text position that the page layout can confirm. */
const IN_LAYOUT = new Set(['body', 'tableCell', 'textBox'])

/**
 * The thread as the caret is asked for: at the first character that is not blank, counted as the
 * engine counts it.
 * @param {MemoThread} thread
 * @returns {MemoThread}
 */
function atStart(thread) {
  const { anchor } = thread
  if (!anchor || anchor.start === null) return thread
  return { ...thread, anchor: { ...anchor, startCharIdx: anchor.start + (anchor.inlineBefore ?? 0) } }
}

/**
 * Sets `caret`, `page` (from 1) and, when `verify` is set, `located` of each thread. Without `verify`
 * no layout is read, and a thread that is already located stays as it is. Located means the page
 * shows the memo's highlight. A `deadline` (ms, `performance.now()`) stops the work early: the threads
 * from the returned index on are untouched. At least one is done, so repeated calls make progress.
 * @param {MemoPages} doc
 * @param {MemoThread[]} threads
 * @param {{ verify: boolean, deadline?: number }} options
 * @returns {number} how many threads were looked at
 */
export function locateThreads(doc, threads, { verify, deadline }) {
  /** @type {Map<number, AnchorRun[]>} */
  const layouts = new Map()
  /** @param {number} page */
  const runsOf = (page) => {
    let runs = layouts.get(page)
    if (!runs) {
      try {
        runs = doc.pageAnchorRuns(page)
      } catch {
        runs = [] // the memo is then "not located" on this page
      }
      layouts.set(page, runs)
    }
    return runs
  }

  for (const [i, thread] of threads.entries()) {
    if (i > 0 && deadline !== undefined && performance.now() >= deadline) return i
    if (thread.located && !verify) continue
    const caret = NO_PAGE.has(thread.place) ? null : doc.memoCaret(atStart(thread))
    thread.caret = caret
    thread.page = caret && caret.page + 1
    thread.located = false
    if (!caret || !verify || !IN_LAYOUT.has(thread.place)) continue
    const found = markThread(thread, runsOf(caret.page), caret.page)
    if (found.hasStart) {
      thread.located = found.mark !== null
      continue
    }
    // Behind an inline object only a caret on the page confirms the place, and there is none near.
    if ((thread.anchor?.inlineBefore ?? 0) > 0) continue
    const near = [caret.page - 1, caret.page + 1].filter(
      (page) => page >= 0 && page < doc.pageCount && markThread(thread, runsOf(page), page).hasStart
    )
    if (near.length !== 1) continue // nowhere near, or two heading rows with no telling which
    thread.caret = { page: near[0], x: null, y: null }
    thread.page = near[0] + 1
    thread.located = markThread(thread, runsOf(near[0]), near[0]).mark !== null
  }
  return threads.length
}
