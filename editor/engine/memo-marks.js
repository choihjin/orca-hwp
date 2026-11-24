// Where a memo's text is on a page: threads and the page's layout runs in, rectangles in page px
// out. The frame viewer and agent/memo-overlay.js both draw them. Plain ESM, no DOM, no engine.

/** @typedef {import('./memo-threads.js').MemoThread} MemoThread */
/** @typedef {import('./memo-threads.js').MemoCaret} MemoCaret */
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

// How far a caret may be from the character boundary it belongs to. Measured on the six public
// samples and the synthetic ones, at 25,170 positions drawn once: 98.8 % are within 0.2 px in x
// (98.9 % within 0.5), the others off by a shifted or differently spaced caret. In y the run starts
// up to 0.32 of its height above the caret, then nothing until lines made taller by an inline object
// (13 positions, more than 0.5). Copies of a paragraph are never that close to each other.
const CARET_X = 0.5
const CARET_Y_OF_HEIGHT = 0.5

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

/** @typedef {{ run: AnchorRun, chars: string[] }} Piece */

/** @param {Piece} piece */
const endOf = ({ run, chars }) => run.charStart + chars.length

/**
 * The pieces of the paragraph the memo starts in, as copies: a page can draw one paragraph more
 * than once (a heading row repeated in the next column) and the engine can give several paragraphs
 * one path (text boxes of one drawing object). A copy ends where the positions go back.
 * @param {MemoThread} thread
 * @param {AnchorRun[]} runs
 * @returns {Piece[][]}
 */
function paragraphCopies({ anchor }, runs) {
  if (!anchor) return []
  const path = anchor.path ?? []
  const pieces = runs
    .filter((run) => {
      if (run.secIdx !== anchor.sectionIndex) return false
      if (path.length === 0) return run.cellPath === undefined && run.paraIdx === anchor.ownerParaIndex
      return run.cellPath !== undefined && run.parentParaIdx === anchor.ownerParaIndex && samePath(run.cellPath, path)
    })
    .map((run) => ({ run, chars: Array.from(run.text) }))
    .filter(({ run, chars }) => run.charX.length === chars.length + 1)
  // Empty runs (field markers, line ends) count only in a paragraph without text.
  const filled = pieces.filter(({ chars }) => chars.length > 0)
  if (filled.length === 0) {
    return pieces
      .filter(({ run }, i) => pieces.findIndex((other) => other.run.x === run.x && other.run.y === run.y) === i)
      .map((piece) => [piece])
  }
  /** @type {Piece[][]} */
  const copies = []
  for (const piece of filled) {
    const copy = copies.at(-1)
    const before = copy?.at(-1)
    if (copy && before && piece.run.charStart >= endOf(before)) copy.push(piece)
    else copies.push([piece])
  }
  return copies
}

/** @typedef {{ run: AnchorRun, from: number, to: number, text: string }} Part */

/**
 * What a copy has of the memo: its characters, or only a place for the number.
 * @typedef {{ pieces: Piece[], parts: Part[], spot: { x: number, y: number } | null }} Find
 */

/**
 * @param {MemoThread} thread
 * @param {Piece[]} pieces one copy
 * @param {number} start
 * @param {number} end
 * @returns {Find | null}
 */
function findIn(thread, pieces, start, end) {
  const parts = pieces
    .map(({ run, chars }) => {
      const from = Math.max(start - run.charStart, 0)
      const to = Math.min(end - run.charStart, chars.length)
      return { run, from, to, text: chars.slice(from, Math.max(from, to)).join('') }
    })
    .filter((part) => part.from < part.to)
    .sort((a, b) => a.run.charStart - b.run.charStart)
  if (parts.length > 0) return { pieces, parts, spot: null }
  // Nothing to highlight, so only a number. It belongs where a character begins; behind the last
  // character only when no character follows it there, or the next line would show it as well.
  const paragraph = Array.from(thread.paragraphText)
  if (thread.multiParagraph ? start < paragraph.length : start !== end) return null
  const lineEnds = paragraph[start] === undefined || paragraph[start] === '\n'
  const at =
    pieces.find((piece) => piece.run.charStart <= start && start < endOf(piece)) ??
    pieces.filter((piece) => lineEnds && start === endOf(piece)).at(-1)
  return at ? { pieces, parts, spot: { x: at.run.x + at.run.charX[start - at.run.charStart], y: at.run.y } } : null
}

/**
 * Whether two finds have a character (or the place of the number) in common.
 * @param {Find} a
 * @param {Find} b
 */
function overlap(a, b) {
  if (a.spot || b.spot) return true
  return a.parts.some((p) =>
    b.parts.some((q) => p.run.charStart + p.from < q.run.charStart + q.to && q.run.charStart + q.from < p.run.charStart + p.to)
  )
}

/**
 * Whether the caret is at character `start` of this copy. At a line start the engine may put it
 * behind the line before, which is the same boundary.
 * @param {Find} find
 * @param {number} start
 * @param {MemoCaret} caret
 */
function atCaret({ pieces }, start, { x, y }) {
  if (x === null || y === null) return false
  return pieces.some(
    (piece) =>
      piece.run.charStart <= start &&
      start <= endOf(piece) &&
      Math.abs(piece.run.x + piece.run.charX[start - piece.run.charStart] - x) <= CARET_X &&
      Math.abs(piece.run.y - y) <= piece.run.h * CARET_Y_OF_HEIGHT
  )
}

/**
 * Whether every character is the memo's character at that position. One wrong run means the copy is
 * of another text, so none of it counts.
 * @param {Find} find
 * @param {string[]} wanted the memo's characters
 * @param {number} start
 */
function sameText({ parts }, wanted, start) {
  return parts.every(({ run, from, text }) => {
    const at = run.charStart + from - start
    return wanted.slice(at, at + Array.from(text).length).join('') === text
  })
}

/**
 * Whether the memo begins here. Blanks and line breaks before the first run may have no glyph.
 * @param {Find} find
 * @param {string[]} wanted
 * @param {number} start
 */
function hasFirst({ parts, spot }, wanted, start) {
  if (spot) return true
  const first = parts[0].run.charStart + parts[0].from
  return wanted.slice(0, first - start).every((char) => /\s/.test(char))
}

/**
 * @param {number} number
 * @param {Find} find
 * @returns {MemoMark}
 */
function toMark(number, { parts, spot }) {
  if (spot) return { number, rects: [], badge: spot }
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
    number,
    rects: boxes.map(({ x, y, right, h }) => ({ x, y, w: right - x, h })),
    badge: { x: lastBox.right, y: lastBox.y }
  }
}

/**
 * The thread on one page. `hasStart` says the memo's first character is there, whatever page the
 * caret is on; `mark` is what may be highlighted. Text the memo is not about is never highlighted:
 * when in doubt there is no mark.
 * @param {MemoThread} thread
 * @param {AnchorRun[]} runs of the page
 * @param {number} pageIndex from 0
 * @returns {{ hasStart: boolean, mark: MemoMark | null }}
 */
export function markThread(thread, runs, pageIndex) {
  const { anchor, caret, multiParagraph } = thread
  const start = anchor?.startCharIdx ?? null
  const end = multiParagraph ? Infinity : (anchor?.endCharIdx ?? null)
  if (!anchor || start === null || end === null) return { hasStart: false, mark: null }
  const wanted =
    anchor.text === '' && multiParagraph ? Array.from(thread.paragraphText).slice(start) : Array.from(anchor.text)

  const copies = paragraphCopies(thread, runs)
  let finds = copies.flatMap((pieces) => findIn(thread, pieces, start, end) ?? [])
  const repeated = finds.some((find, i) => finds.slice(i + 1).some((other) => overlap(find, other)))
  // Without a position in common they are one text that the layout lists out of order.
  if (!repeated && finds.length > 1) finds = [findIn(thread, finds.flatMap((find) => find.pieces), start, end) ?? finds[0]]
  const hasStart = finds.some((find) => sameText(find, wanted, start) && hasFirst(find, wanted, start))

  if (!caret) return { hasStart, mark: null }
  const chosen = repeated ? finds.filter((find) => pageIndex === caret.page && atCaret(find, start, caret)) : finds
  if (chosen.length !== 1 || !sameText(chosen[0], wanted, start)) return { hasStart, mark: null }
  // The first character on another page is a heading row repeated there; the rest may run on.
  const allowed = hasFirst(chosen[0], wanted, start) ? pageIndex === caret.page : pageIndex >= caret.page
  return { hasStart, mark: allowed ? toMark(thread.number, chosen[0]) : null }
}

/**
 * @param {MemoThread[]} threads located by memo-locate.js; without a caret there is no mark
 * @param {AnchorRun[]} runs of one page
 * @param {number} pageIndex from 0
 * @returns {MemoMark[]} in page px; threads without text on the page are left out
 */
export function memoMarks(threads, runs, pageIndex) {
  return threads.flatMap((thread) => markThread(thread, runs, pageIndex).mark ?? [])
}
