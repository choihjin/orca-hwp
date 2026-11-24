import { existsSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { memoMarks as marksOnPage } from './memo-marks.js'
import { locateThreads } from './memo-locate.js'
import { initEngine, openDocument } from './rhwp-adapter.js'

/** @typedef {import('./memo-threads.js').MemoThread} MemoThread */
/** @typedef {import('./memo-marks.js').AnchorRun} AnchorRun */

/**
 * A layout run whose characters are 10 px wide, unless `charX` says otherwise.
 * @param {Partial<AnchorRun>} [over]
 * @returns {AnchorRun}
 */
function run(over = {}) {
  const text = over.text ?? '셋째 문단의 "예산" 낱말'
  return {
    text,
    x: 100,
    y: 50,
    w: 10 * Array.from(text).length,
    h: 13,
    charX: Array.from({ length: Array.from(text).length + 1 }, (_, i) => i * 10),
    secIdx: 0,
    paraIdx: 3,
    charStart: 0,
    ...over
  }
}

/**
 * @param {Partial<Omit<MemoThread, 'anchor'>> & { anchor?: Partial<NonNullable<MemoThread['anchor']>> }} [over]
 * @returns {MemoThread}
 */
function thread(over = {}) {
  const { anchor, ...rest } = over
  return {
    number: 1,
    page: 1,
    located: false,
    place: 'body',
    anchorText: '예산',
    paragraphText: '셋째 문단의 "예산" 낱말',
    multiParagraph: false,
    memos: [],
    anchor: {
      sectionIndex: 0,
      ownerParaIndex: 3,
      paraIndex: 3,
      path: null,
      startCharIdx: 8,
      endCharIdx: 10,
      text: rest.anchorText ?? '예산',
      ...anchor,
      start: anchor?.start ?? (anchor?.startCharIdx === undefined ? 8 : anchor.startCharIdx)
    },
    caret: { page: 0, x: null, y: null },
    ...rest
  }
}

/**
 * The marks on the page the caret is on, unless `page` says another.
 * @param {MemoThread[]} threads
 * @param {AnchorRun[]} runs
 */
const memoMarks = (threads, runs, page = 0) => marksOnPage(threads, runs, page)

const cell = (/** @type {number} */ cellIndex, cellParaIndex = 0) => [{ controlIndex: 0, cellIndex, cellParaIndex }]

test('a word in a body run gets one rectangle over exactly that word', () => {
  const charX = [0, 12.9, 25.9, 32.5, 45.5, 58.4, 71.3, 78, 82.3, 95.2, 108.1, 112.4, 119.1, 132, 144.9]
  const source = run({ charX, w: 144.9 })
  assert.deepEqual(memoMarks([thread()], [source]), [
    {
      number: 1,
      rects: [{ x: 100 + charX[8], y: 50, w: 100 + charX[10] - (100 + charX[8]), h: 13 }],
      badge: { x: 100 + charX[10], y: 50 }
    }
  ])
})

test('a range over two lines gets a rectangle per line and its number after the last', () => {
  const marks = memoMarks(
    [thread({ anchorText: '나다라마', paragraphText: '가나다라마바', anchor: { startCharIdx: 1, endCharIdx: 5 } })],
    [run({ text: '가나다', y: 50 }), run({ text: '라마바', y: 80, charStart: 3 })]
  )
  assert.deepEqual(marks, [
    { number: 1, rects: [{ x: 110, y: 50, w: 20, h: 13 }, { x: 100, y: 80, w: 20, h: 13 }], badge: { x: 120, y: 80 } }
  ])
})

test('runs that touch on one line make one rectangle', () => {
  const marks = memoMarks(
    [thread({ anchorText: '1,200만 원', paragraphText: '1,200만 원', anchor: { startCharIdx: 0, endCharIdx: 8 } })],
    [run({ text: '1,200' }), run({ text: '만 원', charStart: 5, x: 150.1 })]
  )
  assert.equal(marks[0].rects.length, 1)
  assert.equal(marks[0].rects[0].x, 100)
  assert.equal(Math.round(marks[0].rects[0].w), 80)
})

test('runs that a footnote mark keeps apart on one line stay two rectangles', () => {
  const marks = memoMarks(
    [thread({ anchorText: '가나다라', paragraphText: '가나다라', anchor: { startCharIdx: 0, endCharIdx: 4 } })],
    [run({ text: '가나' }), run({ text: '다라', charStart: 2, x: 126 })]
  )
  assert.deepEqual(marks[0].rects.map((rect) => [rect.x, rect.w]), [[100, 20], [126, 20]])
})

test('a range that runs into the next page is marked on its first page only', () => {
  const long = thread({ anchorText: '나다라마', paragraphText: '가나다라마바', anchor: { startCharIdx: 1, endCharIdx: 5 } })
  assert.deepEqual(memoMarks([long], [run({ text: '가나다' })])[0].rects, [{ x: 110, y: 50, w: 20, h: 13 }])
  assert.deepEqual(memoMarks([long], [run({ text: '라마바', charStart: 3 })], 1), [])
})

test('text that is not the memo text is never marked', () => {
  assert.deepEqual(memoMarks([thread({ anchorText: '결산' })], [run()]), [])
  assert.deepEqual(memoMarks([thread({ anchorText: '예산서' })], [run({ text: '셋째 문단의 "결산" 낱말' })]), [])
  // a part of the memo text in the wrong order is not the memo text either
  assert.deepEqual(
    memoMarks([thread({ anchorText: '나다라마', anchor: { startCharIdx: 1, endCharIdx: 5 } })], [run({ text: '가다나' })]),
    []
  )
})

test('a line break inside the range has no glyph and still matches', () => {
  const marks = memoMarks(
    [thread({ anchorText: '끝\n새', paragraphText: '가끝\n새 줄', anchor: { startCharIdx: 1, endCharIdx: 4 } })],
    [run({ text: '가끝' }), run({ text: '새 줄', charStart: 3, y: 80 })]
  )
  assert.deepEqual(marks[0].rects, [{ x: 110, y: 50, w: 10, h: 13 }, { x: 100, y: 80, w: 10, h: 13 }])
})

test('a memo text with a control character is compared as the file has it', () => {
  const memo = thread({ anchorText: '나다', anchor: { startCharIdx: 1, endCharIdx: 4, text: '나\u0001다' } })
  assert.deepEqual(memoMarks([memo], [run({ text: '가나\u0001다' })])[0].rects, [{ x: 110, y: 50, w: 30, h: 13 }])
  assert.deepEqual(memoMarks([memo], [run({ text: '가나다' })]), [])
})

test('a glyph that is part of the memo text at another position is not marked', () => {
  // the engine lists only the second line, as if it stood at the memo's first character
  const marks = memoMarks(
    [thread({ anchorText: '갑\n을', paragraphText: '갑\n을', anchor: { startCharIdx: 0, endCharIdx: 3 } })],
    [run({ text: '을' })]
  )
  assert.deepEqual(marks, [])
})

test('one wrong run drops the whole copy of the paragraph', () => {
  const part = thread({ anchorText: '항목 1', paragraphText: '항목 1', anchor: { startCharIdx: 0, endCharIdx: 4 } })
  assert.deepEqual(memoMarks([part], [run({ text: '항목 ' }), run({ text: '2', charStart: 3, x: 130 })]), [])
})

test('of two copies of a paragraph only the one at the caret is marked', () => {
  const twice = [run({ x: 100, y: 50 }), run({ x: 500, y: 20 })]
  const at = (/** @type {MemoThread['caret']} */ caret) => memoMarks([thread({ caret })], twice).map((mark) => mark.rects[0].x)
  // the memo starts at character 8, 80 px into the run
  assert.deepEqual(at({ page: 0, x: 180, y: 50 }), [180])
  assert.deepEqual(at({ page: 0, x: 580, y: 20 }), [580])
  // the caret sits a little lower than the run when the line has several font sizes
  assert.deepEqual(at({ page: 0, x: 180.1, y: 54 }), [180])
})

test('two copies and no caret, or a caret at neither, mark nothing', () => {
  const twice = [run({ x: 100, y: 50 }), run({ x: 500, y: 20 })]
  for (const caret of [
    null,
    { page: 0, x: null, y: null },
    { page: 0, x: 300, y: 50 },
    { page: 0, x: 180, y: 20 },
    { page: 0, x: 180, y: 70 }
  ]) {
    assert.deepEqual(memoMarks([thread({ caret })], twice), [], JSON.stringify(caret))
  }
  // two copies in the same place: the caret fits both
  assert.deepEqual(memoMarks([thread({ caret: { page: 0, x: 180, y: 50 } })], [run(), run({ y: 51 })]), [])
})

test('the caret may be at the end of the line before', () => {
  const copy = (/** @type {number} */ x) => [run({ text: '가나다', x }), run({ text: '라마바', x, y: 80, charStart: 3 })]
  const second = thread({
    anchorText: '라마',
    paragraphText: '가나다라마바',
    anchor: { startCharIdx: 3, endCharIdx: 5 },
    caret: { page: 0, x: 530, y: 50 }
  })
  assert.deepEqual(memoMarks([second], [...copy(100), ...copy(500)])[0].rects, [{ x: 500, y: 80, w: 20, h: 13 }])
})

test('a copy with other text at the caret is not marked, nor another one in its place', () => {
  const boxes = [run({ text: '다른 글상자의 다른 글' }), run({ x: 500 })]
  assert.deepEqual(memoMarks([thread({ caret: { page: 0, x: 180, y: 50 } })], boxes), [])
})

test('lines of one paragraph in any layout order are one copy', () => {
  const marks = memoMarks(
    [thread({ anchorText: '나다라마', paragraphText: '가나다라마바', anchor: { startCharIdx: 1, endCharIdx: 5 } })],
    [run({ text: '라마바', y: 80, charStart: 3 }), run({ text: '가나다', y: 50 })]
  )
  assert.deepEqual(marks[0].rects.map((rect) => rect.y), [50, 80])
})

test('a first character on another page than the caret is a repeated heading row', () => {
  assert.deepEqual(memoMarks([thread()], [run()], 1), [])
  assert.deepEqual(memoMarks([thread({ caret: { page: 2, x: null, y: null } })], [run()], 1), [])
})

test('without a caret nothing is marked', () => {
  assert.deepEqual(memoMarks([thread({ caret: null })], [run()]), [])
})

test('text without its first character is never marked, on the caret page neither', () => {
  const long = thread({ anchorText: 'ABC', paragraphText: 'ABC', anchor: { startCharIdx: 0, endCharIdx: 3 } })
  const tail = [run({ text: 'BC', charStart: 1 })]
  assert.equal(memoMarks([long], [run({ text: 'ABC' })], 0).length, 1)
  for (const page of [0, 1, 2]) assert.deepEqual(memoMarks([long], tail, page), [], `page ${page}`)
})

test('a memo that begins with blanks is marked from its first other character', () => {
  const blank = thread({ anchorText: '\n \t가', paragraphText: '\n \t가', anchor: { startCharIdx: 0, endCharIdx: 4, start: 3 } })
  const rest = [run({ text: '가', charStart: 3 })]
  assert.deepEqual(memoMarks([blank], rest, 0)[0].rects, [{ x: 100, y: 50, w: 10, h: 13 }])
  assert.deepEqual(memoMarks([blank], rest, 1), [])
  // ' 갑': the blank is drawn, or ends another page
  const gap = thread({ anchorText: ' 갑', paragraphText: ' 갑', anchor: { startCharIdx: 0, endCharIdx: 2, start: 1 } })
  assert.deepEqual(memoMarks([gap], [run({ text: ' 갑' })])[0].rects, [{ x: 110, y: 50, w: 10, h: 13 }])
  assert.deepEqual(memoMarks([gap], [run({ text: ' ' })]), [])
})

test('of copies that are not all alike, two with the memo text cannot be told apart', () => {
  const twice = [run({ x: 100, y: 50 }), run({ x: 500, y: 20 })]
  const caret = { page: 0, x: 180, y: 50 }
  assert.equal(memoMarks([thread({ caret })], twice).length, 1)
  // another text on the same path: not a heading row that repeats
  assert.deepEqual(memoMarks([thread({ caret })], [...twice, run({ text: '셋째 문단의 "결산" 낱말', x: 800 })]), [])
  // alike in the memo text, not in the rest of the paragraph
  assert.deepEqual(memoMarks([thread({ caret })], [twice[0], run({ text: '셋째 문단의 "예산" 문장', x: 500, y: 20 })]), [])
  assert.deepEqual(memoMarks([thread({ caret })], [...twice, run({ text: '짧은 글', x: 800 })]), [])
  // a single copy with the memo text, at the caret
  assert.equal(memoMarks([thread({ caret })], [twice[0], run({ text: '셋째 문단의 "결산" 낱말', x: 500 })]).length, 1)
})

test('a text box that shares its place with another is never marked', () => {
  const box = (/** @type {Partial<AnchorRun>} */ over) =>
    run({ text: '금액', paraIdx: 0, parentParaIdx: 7, cellPath: cell(0), ...over })
  const memo = thread({
    place: 'textBox',
    anchorText: '금액',
    paragraphText: '금액',
    anchor: { ownerParaIndex: 7, path: cell(0), startCharIdx: 0, endCharIdx: 2 },
    caret: { page: 0, x: 100, y: 50 }
  })
  assert.equal(memoMarks([memo], [box({})]).length, 1)
  assert.deepEqual(memoMarks([memo], [box({}), box({ x: 500 })]), [])
  assert.deepEqual(memoMarks([memo], [box({}), box({ text: '항목', x: 500 })]), [])
  // the other box does not even reach the memo's characters
  const late = { ...memo, anchorText: '액', anchor: memo.anchor && { ...memo.anchor, startCharIdx: 1, start: 1, text: '액' } }
  assert.deepEqual(memoMarks([late], [box({}), box({ text: '항', x: 500 })]), [])
})

test('pieces that do not follow each other are not joined', () => {
  const memo = (/** @type {string} */ text) =>
    thread({ anchorText: text, paragraphText: text, anchor: { startCharIdx: 0, endCharIdx: Array.from(text).length } })
  // out of order in the layout, and not below or to the right on the page either
  assert.deepEqual(memoMarks([memo('가나다라')], [run({ text: '다라', charStart: 2, y: 20 }), run({ text: '가나' })]), [])
  // in order, but the second begins above the first: another text with the same path
  assert.deepEqual(memoMarks([memo('가나다라')], [run({ text: '가나' }), run({ text: '다라', charStart: 2, y: 20 })]), [])
  // on one line the next piece is to the right
  assert.deepEqual(memoMarks([memo('가나다라')], [run({ text: '가나' }), run({ text: '다라', charStart: 2, x: 60 })]), [])
  assert.equal(memoMarks([memo('가나다라')], [run({ text: '가나' }), run({ text: '다라', charStart: 2, x: 300 })]).length, 1)
  // characters in between are missing
  assert.deepEqual(memoMarks([memo('가나다라')], [run({ text: '가' }), run({ text: '라', charStart: 3, x: 130 })]), [])
  // only blanks and line breaks may have no glyph
  assert.equal(memoMarks([memo('가 \n라')], [run({ text: '가' }), run({ text: '라', charStart: 3, y: 80 })]).length, 1)
  // font sizes on one line start at different heights
  assert.equal(memoMarks([memo('가나다라')], [run({ text: '가나' }), run({ text: '다라', charStart: 2, x: 120, y: 45, h: 20 })]).length, 1)
})

test('a memo that only touches one column is marked, one over the column break is not', () => {
  const columns = [run({ text: '가나다', y: 900 }), run({ text: '라마바', charStart: 3, x: 500, y: 50 })]
  const over = (/** @type {number} */ startCharIdx, /** @type {number} */ endCharIdx) =>
    memoMarks([thread({ anchorText: '가나다라마바'.slice(startCharIdx, endCharIdx), paragraphText: '가나다라마바', anchor: { startCharIdx, endCharIdx } })], columns)
  assert.equal(over(3, 5).length, 1)
  assert.equal(over(0, 3).length, 1)
  assert.deepEqual(over(1, 5), [])
})

test('a table cell matches by owner paragraph and the whole cell path', () => {
  const inCell = thread({
    place: 'tableCell',
    anchorText: '금액',
    paragraphText: '금액',
    anchor: { ownerParaIndex: 7, paraIndex: 0, path: cell(1), startCharIdx: 0, endCharIdx: 2 }
  })
  const hit = run({ text: '금액', paraIdx: 0, parentParaIdx: 7, cellPath: cell(1), x: 300 })
  const others = [
    run({ text: '금액', paraIdx: 0, parentParaIdx: 7, cellPath: cell(0) }),
    run({ text: '금액', paraIdx: 1, parentParaIdx: 7, cellPath: cell(1, 1) }),
    run({ text: '금액', paraIdx: 0, parentParaIdx: 8, cellPath: cell(1) }),
    run({ text: '금액', paraIdx: 0, parentParaIdx: 7, secIdx: 1, cellPath: cell(1) }),
    run({ text: '금액', paraIdx: 0, parentParaIdx: 7, cellPath: [...cell(1), ...cell(1)] }),
    run({ text: '금액', paraIdx: 0 }),
    run({ text: '금액', paraIdx: 7 })
  ]
  assert.deepEqual(memoMarks([inCell], others), [])
  assert.deepEqual(memoMarks([inCell], [...others, hit])[0].rects, [{ x: 300, y: 50, w: 20, h: 13 }])
})

test('body text does not match a cell, another paragraph or another section', () => {
  const body = thread({ anchor: { path: [] } })
  const others = [run({ parentParaIdx: 3, cellPath: cell(0) }), run({ paraIdx: 4 }), run({ secIdx: 1 })]
  assert.deepEqual(memoMarks([body], others), [])
  assert.equal(memoMarks([body], [...others, run()]).length, 1)
})

test('positions count code points, not UTF-16 units', () => {
  const marks = memoMarks(
    [thread({ paragraphText: '😀예산', anchor: { startCharIdx: 1, endCharIdx: 3 } })],
    [run({ text: '😀예산', charX: [0, 19.5, 32.4, 45.3] })]
  )
  assert.equal(marks[0].rects[0].x, 119.5)
  assert.equal(marks[0].badge.x, 145.3)
})

test('a memo text the engine cut short is compared and marked as far as it goes', () => {
  const memo = thread({ anchorText: '나다', paragraphText: '가나', anchor: { startCharIdx: 1, endCharIdx: 5 } })
  assert.deepEqual(memoMarks([memo], [run({ text: '가나다라마바' })])[0].rects, [{ x: 110, y: 50, w: 20, h: 13 }])
  assert.deepEqual(memoMarks([memo], [run({ text: '가나라다마바' })]), [])
  const multi = { ...memo, multiParagraph: true, anchor: memo.anchor && { ...memo.anchor, endCharIdx: null } }
  assert.equal(memoMarks([multi], [run({ text: '가나다라마바' })])[0].rects[0].w, 20)
  // no text at all says nothing about the characters in the range
  assert.deepEqual(memoMarks([thread({ anchorText: '', anchor: { startCharIdx: 1, endCharIdx: 5 } })], [run()]), [])
})

test('a memo over several paragraphs marks from its start to the end of the first', () => {
  const multi = thread({
    multiParagraph: true,
    anchorText: '낱말\n다음 문단',
    paragraphText: '셋째 문단의 "예산" 낱말',
    anchor: { startCharIdx: 12, endCharIdx: null }
  })
  const runs = [run(), run({ text: '다음 문단', paraIdx: 4, y: 80 })]
  assert.deepEqual(memoMarks([multi], runs)[0].rects, [{ x: 220, y: 50, w: 20, h: 13 }])
  // without a memo text the paragraph says what must be there
  const textless = thread({ ...multi, anchorText: '', anchor: { startCharIdx: 12, endCharIdx: null } })
  assert.deepEqual(memoMarks([textless], runs)[0].rects, [{ x: 220, y: 50, w: 20, h: 13 }])
  assert.deepEqual(memoMarks([{ ...textless, paragraphText: '다른 문단' }], runs), [])
})

test('a memo of no length has only a number, at its position', () => {
  const empty = thread({ anchorText: '', anchor: { startCharIdx: 8, endCharIdx: 8 } })
  assert.deepEqual(memoMarks([empty], [run()]), [{ number: 1, rects: [], badge: { x: 180, y: 50 } }])
  assert.deepEqual(memoMarks([empty], [run({ paraIdx: 9 })]), [])
})

test('a memo of no length at a line end shows its number once', () => {
  const runs = [run({ text: '가나다' }), run({ text: '라마바', charStart: 3, y: 80 })]
  const at = (/** @type {number} */ startCharIdx) =>
    memoMarks([thread({ anchorText: '', paragraphText: '가나다라마바', anchor: { startCharIdx, endCharIdx: startCharIdx } })], runs)
  assert.deepEqual(at(3), [{ number: 1, rects: [], badge: { x: 100, y: 80 } }])
  assert.deepEqual(at(6), [{ number: 1, rects: [], badge: { x: 130, y: 80 } }])
  // the next line is on the next page
  assert.deepEqual(
    memoMarks([thread({ anchorText: '', paragraphText: '가나다라', anchor: { startCharIdx: 3, endCharIdx: 3 } })], [runs[0]]),
    []
  )
})

test('a memo in an empty paragraph has its number there', () => {
  const marks = memoMarks(
    [thread({ anchorText: '', paragraphText: '', anchor: { startCharIdx: 0, endCharIdx: 0 } })],
    // a field marker can repeat the empty run in the same place
    [run({ text: '', charX: [0] }), run({ text: '', charX: [0] })]
  )
  assert.deepEqual(marks, [{ number: 1, rects: [], badge: { x: 100, y: 50 } }])
})

test('a memo of no length in two copies of a paragraph has its number at the caret', () => {
  const empty = thread({ anchorText: '', anchor: { startCharIdx: 8, endCharIdx: 8 }, caret: { page: 0, x: 580, y: 20 } })
  const twice = [run({ x: 100, y: 50 }), run({ x: 500, y: 20 })]
  assert.deepEqual(memoMarks([empty], twice), [{ number: 1, rects: [], badge: { x: 580, y: 20 } }])
  assert.deepEqual(memoMarks([{ ...empty, caret: { page: 0, x: null, y: null } }], twice), [])
  assert.deepEqual(memoMarks([empty], twice, 1), [])
})

test('a memo without a text position is not marked', () => {
  assert.deepEqual(memoMarks([{ ...thread({ place: 'unlinked', anchorText: '' }), anchor: null }], [run()]), [])
  const outside = { paraIndex: null, path: null, startCharIdx: null, endCharIdx: null }
  const nested = { ...outside, start: null }
  for (const place of /** @type {const} */ (['footnote', 'header'])) {
    assert.deepEqual(memoMarks([thread({ place, anchor: nested })], [run()]), [])
  }
})

test('every thread on the page gets its own mark', () => {
  const marks = memoMarks(
    [thread(), thread({ number: 2, anchorText: '낱말', anchor: { startCharIdx: 12, endCharIdx: 14 } })],
    [run()]
  )
  assert.deepEqual(marks.map((mark) => mark.number), [1, 2])
})

test('a run whose boundaries do not fit its text is left out', () => {
  assert.deepEqual(memoMarks([thread()], [run({ charX: [0, 10] })]), [])
})

/**
 * A document from fixtures/ (scripts/fetch-fixtures.mjs), or null when it is not there.
 * @param {string} name
 */
async function openFixture(name) {
  const url = new URL(`../../fixtures/${name}`, import.meta.url)
  if (!existsSync(url)) return null
  await initEngine(new Uint8Array(readFileSync(new URL('../vendor/rhwp/rhwp_bg.wasm', import.meta.url))))
  return openDocument(new Uint8Array(readFileSync(url)))
}

/**
 * A memo on the whole of `target`, as if the document had one there.
 * @param {AnchorRun} target
 */
function memoOn(target) {
  return thread({
    place: target.cellPath ? 'tableCell' : 'body',
    page: null,
    caret: null,
    anchorText: target.text,
    paragraphText: target.text,
    anchor: {
      sectionIndex: target.secIdx,
      ownerParaIndex: target.parentParaIdx ?? target.paraIdx,
      path: target.cellPath ?? null,
      startCharIdx: target.charStart,
      endCharIdx: target.charStart + Array.from(target.text).length
    }
  })
}

test('보건소: a heading row repeated on every page is marked on its first page only', async () => {
  const doc = await openFixture('21868765_별표2_보건소_분장사무.hwp')
  if (!doc) return
  const target = doc.pageAnchorRuns(1).find((each) => each.text === '부 서 명')
  assert.ok(target)
  const memo = memoOn(target)
  locateThreads(doc, [memo], { verify: true })
  assert.deepEqual([memo.page, memo.located], [1, true])
  const marked = [0, 1, 2, 3].filter((page) => marksOnPage([memo], doc.pageAnchorRuns(page), page).length > 0)
  assert.deepEqual(marked, [0])
  doc.dispose()
})

test('편람: a heading row repeated in the second column is marked once, boxes sharing a path never as another', async () => {
  const doc = await openFixture('2025 행정업무운영 편람(최종).hwpx')
  if (!doc) return
  const columns = doc.pageAnchorRuns(371)
  const copies = columns.filter((each) => each.text === '구분' && each.secIdx === 12 && each.parentParaIdx === 16)
  assert.equal(copies.length, 2)
  const heading = memoOn(copies[1])
  locateThreads(doc, [heading], { verify: true })
  assert.equal(heading.located, true)
  const [mark, ...others] = marksOnPage([heading], columns, 371)
  assert.deepEqual(others, [])
  assert.deepEqual(mark.rects.map(({ x, y }) => [x, y]), [[copies[0].x, copies[0].y]])

  // page 205: text boxes of one drawing object and a table share the path [0, 0, 0], and the engine
  // has a caret for it. Give the one at the caret the text of another: none may be marked.
  const chart = doc.pageAnchorRuns(204)
  const shared = chart.filter((each) => each.secIdx === 7 && each.parentParaIdx === 112 && each.cellPath?.length === 1 &&
    Object.values(each.cellPath[0]).every((index) => index === 0))
  assert.ok(shared.length > 20)
  for (const box of shared) {
    const memo = { ...memoOn(box), place: /** @type {const} */ ('textBox') }
    locateThreads(doc, [memo], { verify: true })
    assert.deepEqual([memo.page, memo.located], [205, false])
    const caret = memo.caret
    assert.ok(caret)
    const changed = chart.map((each) =>
      shared.includes(each) && each.x === caret.x && each.y === caret.y ? { ...box, x: each.x, y: each.y } : each
    )
    assert.deepEqual(marksOnPage([memo], changed, 204), [])
    if (box.x !== caret.x) assert.deepEqual(marksOnPage([{ ...memo, place: 'tableCell' }], changed, 204), [])
  }

  // page 161: text boxes of one drawing object all have the path [0, 0, n]
  const page = doc.pageAnchorRuns(160)
  const boxes = page.filter((each) => each.secIdx === 4 && each.parentParaIdx === 64 && each.text.trim() !== '')
  assert.ok(boxes.length > 40)
  for (const box of boxes) {
    const memo = memoOn(box)
    locateThreads(doc, [memo], { verify: true })
    const wrong = [memo.caret, { page: 160, x: null, y: null }, { page: 160, x: box.x, y: box.y }].flatMap((caret) =>
      marksOnPage([{ ...memo, caret }], page, 160).flatMap((each) => each.rects.filter((rect) => {
        const under = page.filter((other) => other.x === rect.x && other.y === rect.y).map((other) => other.text)
        return !under.some((text) => text.startsWith(box.text))
      }))
    )
    assert.deepEqual(wrong, [], box.text)
  }
  doc.dispose()
})
