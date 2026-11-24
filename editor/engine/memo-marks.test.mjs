import { assert, test } from 'orca/testing'
import { memoMarks } from './memo-marks.js'

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
    anchor: { sectionIndex: 0, ownerParaIndex: 3, paraIndex: 3, path: null, startCharIdx: 8, endCharIdx: 10, ...anchor },
    ...rest
  }
}

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

test('a range that runs into the next page marks the part on each page', () => {
  const long = thread({ anchorText: '나다라마', paragraphText: '가나다라마바', anchor: { startCharIdx: 1, endCharIdx: 5 } })
  assert.deepEqual(memoMarks([long], [run({ text: '가나다' })])[0].rects, [{ x: 110, y: 50, w: 20, h: 13 }])
  assert.deepEqual(memoMarks([long], [run({ text: '라마바', charStart: 3 })])[0].rects, [{ x: 100, y: 50, w: 20, h: 13 }])
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

test('a memo text that lost a control character still matches its runs', () => {
  const marks = memoMarks(
    [thread({ anchorText: '나다', anchor: { startCharIdx: 1, endCharIdx: 4 } })],
    [run({ text: '가나' }), run({ text: '다', charStart: 3, y: 80 })]
  )
  assert.equal(marks[0].rects.length, 2)
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
  assert.deepEqual(memoMarks([{ ...multi, anchorText: '' }], runs)[0].rects, [{ x: 220, y: 50, w: 20, h: 13 }])
  assert.deepEqual(memoMarks([{ ...multi, anchorText: '', paragraphText: '다른 문단' }], runs), [])
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
    [run({ text: '', charX: [0] })]
  )
  assert.deepEqual(marks, [{ number: 1, rects: [], badge: { x: 100, y: 50 } }])
})

test('a memo without a text position is not marked', () => {
  assert.deepEqual(memoMarks([{ ...thread({ place: 'unlinked', anchorText: '' }), anchor: null }], [run()]), [])
  const outside = { paraIndex: null, path: null, startCharIdx: null, endCharIdx: null }
  assert.deepEqual(memoMarks([thread({ place: 'footnote', anchor: outside })], [run()]), [])
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
