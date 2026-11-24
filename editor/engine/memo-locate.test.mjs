import { assert, test } from 'orca/testing'
import { locateThreads } from './memo-locate.js'

/** @typedef {import('./memo-threads.js').MemoThread} MemoThread */
/** @typedef {import('./memo-marks.js').AnchorRun} AnchorRun */

/**
 * @param {Partial<Omit<MemoThread, 'anchor'>> & { anchor?: Partial<NonNullable<MemoThread['anchor']>> }} [over]
 * @returns {MemoThread}
 */
function thread(over = {}) {
  const { anchor, ...rest } = over
  return {
    number: 1,
    page: null,
    located: false,
    place: 'body',
    anchorText: '예산',
    paragraphText: '예산 낱말',
    multiParagraph: false,
    memos: [],
    anchor: {
      sectionIndex: 0,
      ownerParaIndex: 3,
      paraIndex: 3,
      path: null,
      startCharIdx: 0,
      endCharIdx: 2,
      text: rest.anchorText ?? '예산',
      ...anchor
    },
    caret: null,
    ...rest
  }
}

/**
 * @param {string} text
 * @param {Partial<AnchorRun>} [over]
 * @returns {AnchorRun}
 */
function run(text, over = {}) {
  const chars = Array.from(text)
  return { text, x: 0, y: 0, w: 0, h: 10, charX: [...chars, ''].map((_, i) => i * 10), secIdx: 0, paraIdx: 3, charStart: 0, ...over }
}

/**
 * A document whose `pages` are layout runs, answering `candidate` for every thread.
 * @param {number | null} candidate
 * @param {(AnchorRun[] | undefined)[]} pages undefined for a page whose layout cannot be read
 */
function fakeDoc(candidate, pages) {
  /** @type {number[]} */
  const read = []
  return {
    read,
    pageCount: pages.length,
    memoCaret: () => (candidate === null ? null : { page: candidate, x: 0, y: 0 }),
    /** @param {number} i */
    pageAnchorRuns(i) {
      read.push(i)
      const runs = pages[i]
      if (runs === undefined) throw new Error(`no page ${i}`)
      return runs
    }
  }
}

/**
 * `[page, located]` after locating one thread.
 * @param {ReturnType<typeof fakeDoc>} doc
 * @param {MemoThread} one
 */
function locate(doc, one, options = { verify: true }) {
  locateThreads(doc, [one], options)
  return [one.page, one.located]
}

const here = [run('예산 낱말')]

test('text on the candidate page is located there', () => {
  const doc = fakeDoc(1, [[], here, []])
  assert.deepEqual(locate(doc, thread()), [2, true])
  assert.deepEqual(doc.read, [1])
})

test('text on the page before or after corrects the page', () => {
  assert.deepEqual(locate(fakeDoc(1, [here, [], []]), thread()), [1, true])
  assert.deepEqual(locate(fakeDoc(1, [[], [], here]), thread()), [3, true])
})

test('pages outside the document are never asked for', () => {
  const doc = fakeDoc(0, [[]])
  assert.deepEqual(locate(doc, thread()), [1, false])
  assert.deepEqual(doc.read, [0])
})

test('text on none of the three pages keeps the candidate, not located', () => {
  assert.deepEqual(locate(fakeDoc(2, [here, [], [], [], here]), thread()), [3, false])
})

test('the page is the one with the first character, not the one the rest runs into', () => {
  const long = () => thread({ anchorText: '예산 낱말', anchor: { endCharIdx: 5 } })
  const head = [run('예산')]
  const tail = [run(' 낱말', { charStart: 2 })]
  assert.deepEqual(locate(fakeDoc(1, [head, tail]), long()), [1, true])
  assert.deepEqual(locate(fakeDoc(0, [head, tail]), long()), [1, true])
})

test('a first character on both neighbours keeps the candidate, not located', () => {
  assert.deepEqual(locate(fakeDoc(1, [here, [], here]), thread()), [2, false])
  // two copies on one neighbour are there as well, even if neither could be chosen
  const copies = [run('예산 낱말'), run('예산 낱말', { x: 500 })]
  assert.deepEqual(locate(fakeDoc(1, [here, [], copies]), thread()), [2, false])
})

test('the caret is kept, and moves with a corrected page', () => {
  const stays = thread()
  locate(fakeDoc(1, [here, here, []]), stays)
  assert.deepEqual(stays.caret, { page: 1, x: 0, y: 0 })
  const moves = thread()
  locate(fakeDoc(1, [[], [], here]), moves)
  assert.deepEqual(moves.caret, { page: 2, x: null, y: null })
  const unverified = thread()
  locate(fakeDoc(1, [[], [], here]), unverified, { verify: false })
  assert.deepEqual(unverified.caret, { page: 1, x: 0, y: 0 })
  const none = thread({ caret: { page: 1, x: 0, y: 0 } })
  locate(fakeDoc(null, [here]), none)
  assert.equal(none.caret, null)
})

test('copies that the caret cannot tell apart are on the page but not located', () => {
  const copies = [run('예산 낱말', { x: 300 }), run('예산 낱말', { x: 500 })]
  assert.deepEqual(locate(fakeDoc(1, [here, copies, []]), thread()), [2, false])
  // corrected to a page where no caret position is known
  assert.deepEqual(locate(fakeDoc(1, [[], [], copies]), thread()), [3, false])
  const chosen = [run('예산 낱말'), run('예산 낱말', { x: 500 })]
  assert.deepEqual(locate(fakeDoc(1, [[], chosen, []]), thread()), [2, true])
})

test('text that only runs on keeps the candidate, not located', () => {
  const long = () => thread({ anchorText: '예산 낱말', anchor: { endCharIdx: 5 } })
  const tail = [run(' 낱말', { charStart: 2 })]
  assert.deepEqual(locate(fakeDoc(1, [[], tail, []]), long()), [2, false])
  assert.deepEqual(locate(fakeDoc(1, [[], [], tail]), long()), [2, false])
})

test('blanks without a glyph before the first run do not hide the start', () => {
  const broken = () => thread({ anchorText: '\n예산', paragraphText: '\n예산', anchor: { endCharIdx: 3 } })
  assert.deepEqual(locate(fakeDoc(1, [[], [run('예산', { charStart: 1 })], []]), broken()), [2, true])
})

test('a repeated call drops a place that no longer holds', () => {
  const one = thread({ page: 1, located: true })
  assert.deepEqual(locate(fakeDoc(1, [[], [], []]), one), [2, false])
})

test('no candidate means no page', () => {
  assert.deepEqual(locate(fakeDoc(null, [here]), thread()), [null, false])
  assert.deepEqual(locate(fakeDoc(null, [here]), thread(), { verify: false }), [null, false])
})

test('headers, footers, master pages and unlinked memos have no page', () => {
  for (const place of /** @type {const} */ (['header', 'footer', 'masterPage', 'unlinked'])) {
    const doc = fakeDoc(0, [here])
    assert.deepEqual(locate(doc, thread({ place })), [null, false], place)
    assert.deepEqual(doc.read, [], place)
  }
})

test('notes and captions take the page of the paragraph that owns them, never located', () => {
  for (const place of /** @type {const} */ (['footnote', 'endnote', 'caption'])) {
    const doc = fakeDoc(1, [here, here])
    assert.deepEqual(locate(doc, thread({ place })), [2, false], place)
    assert.deepEqual(doc.read, [], place)
  }
})

test('without verifying, no layout is read and the candidate is taken as it is', () => {
  const doc = fakeDoc(1, [here, []])
  assert.deepEqual(locate(doc, thread(), { verify: false }), [2, false])
  assert.deepEqual(doc.read, [])
})

test('without verifying, a place already found stays', () => {
  const one = thread({ page: 1, located: true })
  assert.deepEqual(locate(fakeDoc(1, [here, []]), one, { verify: false }), [1, true])
})

test('the layout of a page is read once for all threads', () => {
  const doc = fakeDoc(1, [[], here, []])
  locateThreads(doc, [thread(), thread({ number: 2 }), thread({ number: 3, anchorText: '없음' })], { verify: true })
  assert.deepEqual([...doc.read].sort(), [0, 1, 2])
})

test('a page whose layout cannot be read leaves the other threads alone', () => {
  const doc = fakeDoc(0, [undefined, here])
  const threads = [thread(), thread({ number: 2, anchorText: '없음' })]
  locateThreads(doc, threads, { verify: true })
  assert.deepEqual(threads.map((one) => [one.page, one.located]), [[2, true], [1, false]])
})
