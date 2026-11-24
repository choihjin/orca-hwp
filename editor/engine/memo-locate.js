// Which page a memo is on. The engine's caret gives a candidate page; the page layout confirms it.
// Plain ESM, no DOM, no engine: the document is passed in.
import { markThread } from './memo-marks.js'

/** @typedef {import('./memo-threads.js').MemoThread} MemoThread */
/** @typedef {import('./memo-marks.js').AnchorRun} AnchorRun */

/**
 * What locating needs from an `EngineDocument`. Pages are numbered from 0.
 * @typedef {{
 *   pageCount: number,
 *   memoCandidatePage(thread: MemoThread): number | null,
 *   pageAnchorRuns(i: number): AnchorRun[]
 * }} MemoPages
 */

/** Repeated on many pages, or on none: there is no page to go to. */
const NO_PAGE = new Set(['header', 'footer', 'masterPage', 'unlinked'])

/** Only these have a text position that the page layout can confirm. */
const IN_LAYOUT = new Set(['body', 'tableCell', 'textBox'])

/**
 * Sets `page` (from 1) and, when `verify` is set, `located` of each thread. Without `verify` no
 * layout is read, and a thread that is already located keeps its page.
 * @param {MemoPages} doc
 * @param {MemoThread[]} threads
 * @param {{ verify: boolean }} options
 */
export function locateThreads(doc, threads, { verify }) {
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

  for (const thread of threads) {
    if (thread.located && !verify) continue
    const candidate = NO_PAGE.has(thread.place) ? null : doc.memoCandidatePage(thread)
    thread.page = candidate === null ? null : candidate + 1
    thread.located = false
    if (candidate === null || !verify || !IN_LAYOUT.has(thread.place)) continue
    /** @type {number | null} */
    let partly = null
    for (const page of [candidate, candidate - 1, candidate + 1]) {
      if (page < 0 || page >= doc.pageCount) continue
      const found = markThread(thread, runsOf(page))
      if (found?.hasStart) {
        thread.page = page + 1
        thread.located = true
        break
      }
      if (found) partly = partly === null ? page : Math.min(partly, page)
    }
    if (!thread.located && partly !== null) {
      thread.page = partly + 1
      thread.located = true
    }
  }
}
