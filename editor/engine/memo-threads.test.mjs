import { assert, test } from 'orca/testing'
import {
  buildMemoReport,
  fullDate,
  placeLabel,
  problemText,
  publicThread,
  shortDate,
  shownAnchorText
} from './memo-threads.js'

/** One entry of the engine's getMemos() JSON, as the 0.8.7-p2 contract describes it. */
function entry(over = {}) {
  return {
    number: 1,
    author: '검토자 가',
    text: '본문',
    date: '2026-11-20T08:24:04Z',
    dateText: null,
    place: 'body',
    anchorText: '예산',
    paragraphText: '셋째 문단의 "예산" 낱말',
    multiParagraph: false,
    anchorKey: '0/3/8-10',
    sectionIndex: 0,
    ownerParaIndex: 3,
    paraIndex: 3,
    path: null,
    startCharIdx: 8,
    endCharIdx: 10,
    ...over
  }
}

const unlinked = (over = {}) =>
  entry({
    place: 'unlinked',
    anchorText: '',
    paragraphText: '',
    anchorKey: 'u',
    sectionIndex: null,
    ownerParaIndex: null,
    paraIndex: null,
    startCharIdx: null,
    endCharIdx: null,
    ...over
  })

/**
 * @param {unknown[]} memos
 * @param {unknown[]} [problems]
 */
const build = (memos, problems = []) => buildMemoReport(JSON.stringify({ memos, problems }))

/**
 * Runs `fn` with the process time zone set to `zone`, restoring it afterwards.
 * @param {string} zone
 * @param {() => void} fn
 */
function inZone(zone, fn) {
  const before = process.env.TZ
  process.env.TZ = zone
  try {
    fn()
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
}

test('memos on the same anchor form one thread, ordered by number', () => {
  const { threads } = build([
    entry({ number: 3, text: '셋' }),
    entry({ number: 1, text: '하나' }),
    entry({ number: 2, text: '둘' })
  ])
  assert.equal(threads.length, 1)
  assert.deepEqual(threads[0].memos.map((memo) => memo.text), ['하나', '둘', '셋'])
})

test('a thread carries its anchor and has no page until it is located', () => {
  const path = [{ controlIndex: 0, cellIndex: 3, cellParaIndex: 1 }]
  const { threads } = build([entry({ place: 'tableCell', path, ownerParaIndex: 7, paraIndex: 1, startCharIdx: 0, endCharIdx: 2 })])
  assert.deepEqual(threads[0], {
    number: 1,
    page: null,
    located: false,
    place: 'tableCell',
    anchorText: '예산',
    paragraphText: '셋째 문단의 "예산" 낱말',
    multiParagraph: false,
    memos: [{ author: '검토자 가', date: '2026-11-20T08:24:04Z', dateText: null, text: '본문' }],
    anchor: { sectionIndex: 0, ownerParaIndex: 7, paraIndex: 1, path, startCharIdx: 0, endCharIdx: 2, text: '예산', start: 0 },
    caret: null
  })
})

test('threads are numbered from 1 by first appearance, unlinked ones last', () => {
  const { threads } = build([
    unlinked({ number: 9, text: '짝 없음' }),
    entry({ number: 5, anchorKey: 'b', text: '먼저' }),
    entry({ number: 2, anchorKey: 'a', text: '나중' }),
    entry({ number: 6, anchorKey: 'b', text: '먼저의 둘째' })
  ])
  assert.deepEqual(
    threads.map((thread) => [thread.number, thread.memos[0].text]),
    [[1, '먼저'], [2, '나중'], [3, '짝 없음']]
  )
  assert.equal(threads[2].anchor, null)
})

test('unlinked bodies share no text, so they never join one thread', () => {
  assert.equal(build([unlinked({ anchorKey: '' }), unlinked({ anchorKey: '' })]).threads.length, 2)
  assert.equal(build([unlinked({ anchorKey: null })]).threads.length, 1)
})

test('two memos over several paragraphs stay apart when their end is unknown', () => {
  const multi = { multiParagraph: true, endCharIdx: null }
  assert.equal(build([entry({ ...multi, anchorKey: 'x1' }), entry({ ...multi, anchorKey: 'x2' })]).threads.length, 2)
  // the engine gives each its own key; even a repeated key must not merge them
  assert.equal(build([entry({ ...multi, anchorKey: 'x' }), entry({ ...multi, anchorKey: 'x' })]).threads.length, 2)
})

test('a memo outside body text keeps the paragraph that owns it', () => {
  const outside = { paraIndex: null, path: null, startCharIdx: null, endCharIdx: null }
  const { threads } = build([
    entry({ ...outside, place: 'footnote', anchorKey: 'f', ownerParaIndex: 4 }),
    entry({ ...outside, place: 'masterPage', anchorKey: 'm', ownerParaIndex: null })
  ])
  assert.deepEqual(threads[0].anchor, {
    sectionIndex: 0,
    ownerParaIndex: 4,
    paraIndex: null,
    path: null,
    startCharIdx: null,
    endCharIdx: null,
    text: '예산',
    start: null
  })
  assert.equal(threads[1].anchor, null)
})

test('a memo starts for the engine at its first character that is not blank', () => {
  const startOf = (/** @type {object} */ over) => build([entry({ startCharIdx: 8, endCharIdx: 20, ...over })]).threads[0].anchor?.start
  assert.equal(startOf({ anchorText: ' 갑' }), 9)
  assert.equal(startOf({ anchorText: '\n \t😀' }), 11)
  assert.equal(startOf({ anchorText: '갑 을' }), 8)
  assert.equal(startOf({ anchorText: ' \n' }), 8)
  assert.equal(startOf({ anchorText: '', endCharIdx: 8 }), 8)
  assert.equal(startOf({ startCharIdx: null, endCharIdx: null, place: 'footnote' }), null)
  // what people and agents read keeps its blanks
  assert.equal(build([entry({ anchorText: ' 갑' })]).threads[0].anchorText, ' 갑')
})

test('a memo over several paragraphs does not start past the end of its first', () => {
  const multi = { multiParagraph: true, endCharIdx: null, paragraphText: '가나다 ', startCharIdx: 3 }
  const startOf = (/** @type {object} */ over) => build([entry({ ...multi, ...over })]).threads[0].anchor?.start
  assert.equal(startOf({ anchorText: ' \n다음 문단' }), 3)
  assert.equal(startOf({ startCharIdx: 4, anchorText: '\n다음 문단' }), 4)
  assert.equal(startOf({ paragraphText: '가나다 라', anchorText: ' 라\n다음 문단' }), 4)
})

test('control characters are removed, line breaks, tabs and markup stay as written', () => {
  const { threads } = build([
    entry({
      author: '가\u0000나\u0007',
      text: '첫 줄\r\n둘째\t줄\u007f <img src=x onerror=1>',
      dateText: '2026\u001b년',
      anchorText: '예\u0001산',
      paragraphText: '문\u0002단'
    })
  ])
  assert.equal(threads[0].memos[0].author, '가나')
  assert.equal(threads[0].memos[0].text, '첫 줄\n둘째\t줄 <img src=x onerror=1>')
  assert.equal(threads[0].memos[0].dateText, '2026년')
  assert.equal(threads[0].anchorText, '예산')
  assert.equal(threads[0].paragraphText, '문단')
  // positions count every character, so the highlight compares with the text as the file has it
  assert.equal(threads[0].anchor?.text, '예\u0001산')
})

test('a missing body stays null, an empty body stays empty', () => {
  const { threads } = build([entry({ text: null, author: '' }), entry({ anchorKey: 'b', text: '' })])
  assert.equal(threads[0].memos[0].text, null)
  assert.equal(threads[0].memos[0].author, '')
  assert.equal(threads[1].memos[0].text, '')
})

test('problems are passed on, also when there is no memo', () => {
  const problems = [{ code: 'bad-record' }, { code: 'section-unreadable', sectionIndex: 1 }]
  assert.deepEqual(build([], problems), { threads: [], problems })
  assert.deepEqual(build([]), { threads: [], problems: [] })
})

test('a problem this version does not know never hides the memos', () => {
  const report = build([entry()], [{ code: 'missing-memo', count: 2 }, { code: 'future-code', number: 'x', count: -1 }])
  assert.equal(report.threads.length, 1)
  assert.deepEqual(report.problems, [{ code: 'missing-memo', count: 2 }, { code: 'future-code' }])
  assert.throws(() => build([], [{ code: 'missing-memo', count: '2' }]), (error) => error instanceof Error)
})

test('anchorKey is compared as it is, whatever it holds', () => {
  const keys = ['0/3/8-8#1', '0/3/8-8#2', '0/3/8-8#1']
  assert.deepEqual(build(keys.map((anchorKey, i) => entry({ anchorKey, number: i }))).threads.map((one) => one.memos.length), [2, 1])
})

test('text the engine cut short is shown with an ellipsis, and given to agents as it is', () => {
  const shown = (/** @type {object} */ over) => {
    const [one] = build([entry(over)]).threads
    assert.equal(publicThread(one).anchorText, one.anchorText)
    return shownAnchorText(one)
  }
  const cut = '가'.repeat(2000)
  assert.equal(shown({}), '예산')
  assert.equal(shown({ anchorText: cut, startCharIdx: 8, endCharIdx: 2108 }), `${cut}…`)
  assert.equal(shown({ anchorText: cut, startCharIdx: 8, endCharIdx: 2008 }), cut)
  // control characters and surrogate pairs do not make a text look cut
  assert.equal(shown({ anchorText: '예\u0001산😀', startCharIdx: 8, endCharIdx: 12 }), '예산😀')
  // a range without text of its own has nothing to cut
  assert.equal(shown({ anchorText: '', startCharIdx: 8, endCharIdx: 9 }), '')
  // without both ends, only the engine's limit tells
  const outside = { place: 'header', paraIndex: null, startCharIdx: null, endCharIdx: null }
  assert.equal(shown({ ...outside, anchorText: cut }), `${cut}…`)
  assert.equal(shown({ ...outside, anchorText: '머리말' }), '머리말')
  assert.equal(shown({ multiParagraph: true, endCharIdx: null, anchorText: cut }), `${cut}…`)
  assert.equal(shown({ ...outside, place: 'masterPage', ownerParaIndex: null, anchorText: cut }), `${cut}…`)
})

test('JSON of another shape is an error, never an empty list', () => {
  for (const json of ['{}', '[]', '"x"', 'null', '', 'not json', '{"memos":[]}', '{"memos":{},"problems":[]}']) {
    assert.throws(() => buildMemoReport(json), (error) => error instanceof Error)
  }
  const { author, ...noAuthor } = entry()
  assert.equal(author, '검토자 가')
  for (const bad of [null, 'x', {}, noAuthor, entry({ number: '1' }), entry({ place: 'margin' }), entry({ text: 3 }),
    entry({ anchorKey: undefined }), entry({ path: [{ controlIndex: 0 }] }), entry({ startCharIdx: '8' })]) {
    assert.throws(() => build([bad]), (error) => error instanceof Error)
  }
  for (const bad of [null, 'bad-record', {}]) assert.throws(() => build([], [bad]), (error) => error instanceof Error)
})

test('shortDate drops the year of the current year and uses local time', () => {
  inZone('Asia/Seoul', () => {
    const now = new Date('2026-11-24T00:00:00Z')
    assert.equal(shortDate({ date: '2026-11-20T08:24:04Z', dateText: null }, now), '11.20')
    assert.equal(shortDate({ date: '2025-11-20T08:24:04Z', dateText: null }, now), '2025.11.20')
    // 2025-12-31 in UTC is already 2026-01-01 in Seoul
    assert.equal(shortDate({ date: '2025-12-31T15:00:00Z', dateText: null }, now), '01.01')
  })
})

test('a memo without FILETIME shows its original date text, or nothing', () => {
  const now = new Date('2026-11-24T00:00:00Z')
  assert.equal(shortDate({ date: null, dateText: '2026-11-20 오후' }, now), '2026-11-20 오후')
  assert.equal(shortDate({ date: null, dateText: null }, now), '')
  assert.equal(fullDate({ date: null, dateText: '2026-11-20 오후' }), '2026-11-20 오후')
  assert.equal(fullDate({ date: null, dateText: null }), '')
  // a date that is not one must not read as NaN
  assert.equal(shortDate({ date: 'x', dateText: null }, now), '')
  assert.equal(fullDate({ date: 'x', dateText: '원문' }), '원문')
})

test('fullDate is the local date and minute', () => {
  inZone('Asia/Seoul', () => {
    assert.equal(fullDate({ date: '2026-11-20T08:24:04Z', dateText: null }), '2026-11-20 17:24')
    assert.equal(fullDate({ date: '2026-01-04T15:03:00Z', dateText: null }), '2026-01-05 00:03')
  })
})

test('publicThread leaves out the engine position and does not touch the thread', () => {
  const { threads } = build([entry()])
  threads[0].caret = { page: 0, x: 1, y: 2 }
  const shared = publicThread(threads[0])
  assert.deepEqual(Object.keys(shared), ['number', 'page', 'place', 'anchorText', 'paragraphText', 'multiParagraph', 'located', 'memos'])
  shared.memos[0].text = '바뀜'
  assert.equal(threads[0].memos[0].text, '본문')
  assert.ok(threads[0].anchor)
})

test('placeLabel names every place', () => {
  const expected = {
    body: '',
    tableCell: '표 칸',
    textBox: '글상자',
    caption: '캡션',
    header: '머리말',
    footer: '꼬리말',
    footnote: '각주',
    endnote: '미주',
    masterPage: '바탕쪽',
    unlinked: '글과 연결되지 않음'
  }
  for (const [place, label] of Object.entries(expected)) {
    assert.equal(placeLabel(/** @type {keyof typeof expected} */ (place)), label)
  }
})

test('problemText says in one line what could not be read', () => {
  assert.match(problemText({ code: 'no-body', number: 7 }), /7.*본문/)
  assert.match(problemText({ code: 'unlinked-body', number: 8 }), /8.*연결/)
  assert.match(problemText({ code: 'bad-record' }), /메모/)
  assert.match(problemText({ code: 'section-unreadable', sectionIndex: 0 }), /1구역/)
  assert.equal(problemText({ code: 'missing-memo', count: 3 }), '메모 3개를 읽지 못함')
  assert.equal(problemText({ code: 'future-code' }), '알 수 없는 문제로 일부 메모를 읽지 못함')
  for (const problem of [{ code: 'no-body', number: 7 }, { code: 'bad-record' }, { code: 'future-code' }]) {
    assert.equal(/\n|undefined/.test(problemText(problem)), false)
  }
})
