// Where a memo's text is on a page: threads and the page's layout runs in, rectangles in page px
// out. The frame viewer and agent/memo-overlay.js both draw them. Plain ESM, no DOM, no engine.

/** @typedef {import('./memo-threads.js').MemoThread} MemoThread */
/** @typedef {import('./memo-threads.js').CellStep} CellStep */

/**
 * A layout run with its place in the document. Characters are code points: `charX` has one boundary
 * more than `text` has characters, relative to `x`. Inside a table cell or text box `paraIdx` counts
 * in there and `parentParaIdx` is the paragraph directly in the section.
 * @typedef {{
 *   text: string, x: number, y: number, w: number, h: number,
 *   charX: number[], secIdx: number, paraIdx: number, charStart: number,
 *   parentParaIdx?: number, cellPath?: CellStep[]
 * }} AnchorRun
 */

/** @typedef {{ x: number, y: number, w: number, h: number }} MarkRect */

/** @typedef {{ number: number, rects: MarkRect[], badge: { x: number, y: number } }} MemoMark */

// The engine rounds positions to 0.1 px, so runs that touch can end up this far apart.
const TOUCHING = 0.2

/**
 * @param {CellStep[]} a
 * @param {CellStep[]} b
 */
function samePath(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (step, i) =>
        step.controlIndex === b[i].controlIndex &&
        step.cellIndex === b[i].cellIndex &&
        step.cellParaIndex === b[i].cellParaIndex
    )
  )
}

/**
 * The runs of the paragraph the memo starts in, in text order.
 * @param {MemoThread} thread
 * @param {AnchorRun[]} runs
 * @returns {{ run: AnchorRun, chars: string[] }[]}
 */
function paragraphRuns(thread, runs) {
  const { anchor } = thread
  if (!anchor) return []
  const path = anchor.path ?? []
  return runs
    .filter((run) => {
      if (run.secIdx !== anchor.sectionIndex) return false
      if (path.length === 0) return run.cellPath === undefined && run.paraIdx === anchor.ownerParaIndex
      return run.cellPath !== undefined && run.parentParaIdx === anchor.ownerParaIndex && samePath(run.cellPath, path)
    })
    .map((run) => ({ run, chars: Array.from(run.text) }))
    .filter(({ run, chars }) => run.charX.length === chars.length + 1)
    .sort((a, b) => a.run.charStart - b.run.charStart)
}

/**
 * The thread's mark on the page with these runs, or null when its text is not there. `hasStart`
 * says whether the memo begins on this page.
 * @param {MemoThread} thread
 * @param {AnchorRun[]} runs
 * @returns {{ mark: MemoMark, hasStart: boolean } | null}
 */
export function markThread(thread, runs) {
  const { anchor, multiParagraph } = thread
  const start = anchor?.startCharIdx ?? null
  const end = multiParagraph ? Infinity : (anchor?.endCharIdx ?? null)
  if (start === null || end === null) return null
  const own = paragraphRuns(thread, runs)
  const parts = own
    .map(({ run, chars }) => {
      const from = Math.max(start - run.charStart, 0)
      const to = Math.min(end - run.charStart, chars.length)
      return { run, from, to, text: chars.slice(from, Math.max(from, to)).join('') }
    })
    .filter((part) => part.from < part.to)
  const paragraph = Array.from(thread.paragraphText)
  if (parts.length === 0) {
    // Nothing to highlight, so only a number. It belongs where a character begins; behind the last
    // character only when no character follows it there, or the next line would show it as well.
    if (multiParagraph ? start < paragraph.length : start !== end) return null
    const lineEnds = paragraph[start] === undefined || paragraph[start] === '\n'
    const at =
      own.find(({ run, chars }) => run.charStart <= start && start < run.charStart + chars.length) ??
      own.filter(({ run, chars }) => lineEnds && start === run.charStart + chars.length).at(-1)
    if (!at) return null
    const badge = { x: at.run.x + at.run.charX[start - at.run.charStart], y: at.run.y }
    return { mark: { number: thread.number, rects: [], badge }, hasStart: true }
  }

  // Never highlight text the memo is not about. Positions are compared first because the layout has
  // no glyph for a line break; the joined text covers a memo text that lost control characters.
  const wanted = thread.anchorText === '' && multiParagraph ? paragraph.slice(start) : Array.from(thread.anchorText)
  const inPlace = parts.every(({ run, from, text }) => {
    const at = run.charStart + from - start
    return wanted.slice(at, at + Array.from(text).length).join('') === text
  })
  if (!inPlace && !wanted.join('').includes(parts.map((part) => part.text).join(''))) return null

  /** @type {{ x: number, y: number, right: number, h: number }[]} */
  const boxes = []
  for (const { run, from, to } of parts) {
    const box = { x: run.x + run.charX[from], y: run.y, right: run.x + run.charX[to], h: run.h }
    const last = boxes.at(-1)
    if (last && last.y === box.y && last.h === box.h && Math.abs(box.x - last.right) <= TOUCHING) last.right = box.right
    else boxes.push(box)
  }
  const lastBox = boxes[boxes.length - 1]
  return {
    mark: {
      number: thread.number,
      rects: boxes.map(({ x, y, right, h }) => ({ x, y, w: right - x, h })),
      badge: { x: lastBox.right, y: lastBox.y }
    },
    hasStart: parts.some(({ run, from }) => run.charStart + from === start)
  }
}

/**
 * @param {MemoThread[]} threads
 * @param {AnchorRun[]} runs of one page
 * @returns {MemoMark[]} in page px; threads without text on the page are left out
 */
export function memoMarks(threads, runs) {
  return threads.flatMap((thread) => markThread(thread, runs)?.mark ?? [])
}
