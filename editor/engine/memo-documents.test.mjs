// Memos in whole documents, from the file through the real engine to the highlight. The HWPX
// documents are made here from XML text (scripts/testdata/hwpx-text.mjs).
import { existsSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import {
  endnote, filetime, footnote, groupedBoxes, hwpxFromText, memo, memoEnd, memoHwpx, memoParts, memoStart, pageEdge,
  para, table, text, textBox
} from '../../scripts/testdata/hwpx-text.mjs'
import { locateThreads } from './memo-locate.js'
import { memoMarks } from './memo-marks.js'
import { initEngine, openDocument } from './rhwp-adapter.js'

/** @typedef {import('./memo-threads.js').MemoThread} MemoThread */

const wasmBytes = new Uint8Array(readFileSync(new URL('../vendor/rhwp/rhwp_bg.wasm', import.meta.url)))

/**
 * What a page shows under a thread's highlight: the text in each rectangle, read from where the
 * glyphs are and not from the positions the highlight was made with. `before` is the text left of
 * the first rectangle on its line.
 * @typedef {{ page: number, lines: string[], before: string, badge: { x: number, y: number } }} Shown
 */

/**
 * @param {import('./rhwp-adapter.js').EngineDocument} doc
 * @param {MemoThread} thread
 * @returns {Shown[]} one for each page with a mark
 */
function shown(doc, thread) {
  return Array.from({ length: doc.pageCount }, (_, i) => i).flatMap((i) => {
    const runs = doc.pageAnchorRuns(i)
    const glyphs = runs.flatMap((run) =>
      Array.from(run.text).map((char, at) => ({
        char,
        x: run.x + (run.charX[at] + run.charX[at + 1]) / 2,
        y: run.y + run.h / 2
      }))
    )
    return memoMarks([thread], runs, i).map(({ number, rects, badge }) => {
      assert.equal(number, thread.number)
      /** @param {{ x: number, y: number, w: number, h: number }} area */
      const textIn = ({ x, y, w, h }) =>
        glyphs
          .filter((glyph) => glyph.x > x && glyph.x < x + w && glyph.y > y && glyph.y < y + h)
          .map((glyph) => glyph.char)
          .join('')
      const first = rects[0]
      return {
        page: i + 1,
        lines: rects.map(textIn),
        before: first ? textIn({ ...first, x: 0, w: first.x }) : '',
        badge
      }
    })
  })
}

/**
 * @param {Uint8Array} bytes
 */
async function open(bytes) {
  await initEngine(wasmBytes)
  const doc = openDocument(bytes)
  const { threads, problems } = doc.memos()
  locateThreads(doc, threads, { verify: true })
  return { doc, threads, problems, pages: doc.pageCount, shown: threads.map((thread) => shown(doc, thread)) }
}

/**
 * A document with one section.
 * @param {string[]} paras
 */
const openParas = (...paras) => open(memoHwpx({ sections: [paras] }))

/** @param {MemoThread} thread */
const summary = ({ number, place, page, located, anchorText, memos }) => ({
  number,
  place,
  page,
  located,
  anchorText,
  memos: memos.map((memo) => [memo.author, memo.text])
})

/**
 * The only thread, highlighted: the text under the highlight is the memo's text.
 * @param {Awaited<ReturnType<typeof open>>} opened
 * @param {{ place?: string, page?: number, anchorText: string, before?: string, lines?: string[] }} expected
 */
function assertMarked({ threads, problems, shown }, { place = 'body', page = 1, anchorText, before = '', lines = [anchorText] }) {
  assert.deepEqual(problems, [])
  assert.deepEqual(threads.map(summary), [
    { number: 1, place, page, located: true, anchorText, memos: [['검토자', '메모 1']] }
  ])
  assert.deepEqual(
    shown[0].map(({ badge, ...rest }) => rest),
    [{ page, lines, before }]
  )
}

/**
 * The only thread, in a place the engine has no coordinates for: listed, never highlighted.
 * @param {Awaited<ReturnType<typeof open>>} opened
 * @param {{ place: string, page: number | null, anchorText: string }} expected
 */
function assertListed({ threads, problems, shown }, { place, page, anchorText }) {
  assert.deepEqual(problems, [])
  assert.deepEqual(threads.map(summary), [
    { number: 1, place, page, located: false, anchorText, memos: [['검토자', '메모 1']] }
  ])
  assert.deepEqual(shown, [[]])
}

const filler = (/** @type {number} */ count) => Array.from({ length: count }, () => para(text('채움')))

test('hwpxFromText stores the parts as they are, mimetype first, the same bytes every time', () => {
  const parts = { 'a/가.xml': '<a>글</a>', 'b.txt': '' }
  const zip = Buffer.from(hwpxFromText(parts))
  assert.equal(zip.toString('latin1', 0, 4), 'PK\x03\x04')
  assert.equal(zip.readUInt16LE(8), 0) // stored
  assert.equal(zip.toString('utf8', 30, 57), 'mimetypeapplication/hwp+zip')
  assert.ok(zip.includes('a/가.xml<a>글</a>'))
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50)
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 3)
  assert.equal(zip.readUInt32LE(zip.length - 22 + 16) + zip.readUInt32LE(zip.length - 22 + 12), zip.length - 22)
  assert.deepEqual(Buffer.from(hwpxFromText(parts)), zip)
})

test('a document without memos gives no thread and no problem', async () => {
  const { threads, problems, pages } = await openParas(para(text('메모 없는 문서')), para(table([[para(text('칸'))]])))
  assert.deepEqual([threads, problems, pages], [[], [], 1])
})

test('a memo on a whole paragraph', async () => {
  assertMarked(await openParas(para(text('첫 문단')), para(memo(1, text('문단 전체에 단 메모'))), para(text('끝'))), {
    anchorText: '문단 전체에 단 메모'
  })
  // The first paragraph also has the section definition in front of its text.
  assertMarked(await openParas(para(memo(1, text('첫 문단 전체')))), { anchorText: '첫 문단 전체' })
})

test('a memo on one word of a paragraph, also when the paragraph has the word again', async () => {
  assertMarked(await openParas(para(text('첫')), para(text('셋째 문단의 "') + memo(1, text('예산')) + text('" 낱말'))), {
    anchorText: '예산',
    before: '셋째 문단의 "'
  })
  assertMarked(await openParas(para(text('예산 ') + memo(1, text('예산')) + text(' 예산'))), { anchorText: '예산', before: '예산 ' })
  assertMarked(await openParas(para(text('😀예산 ') + memo(1, text('👍낱말')) + text(' 뒤'))), {
    anchorText: '👍낱말',
    before: '😀예산 '
  })
})

test('a memo on the second page and in the second section', async () => {
  assertMarked(await openParas(para(text('첫')), para(memo(1, text('둘째 쪽 글')), { pageBreak: true })), {
    page: 2,
    anchorText: '둘째 쪽 글'
  })
  assertMarked(await open(memoHwpx({ sections: [[para(text('첫 구역'))], [para(text('둘째 ') + memo(1, text('구역')))]] })), {
    page: 2,
    anchorText: '구역',
    before: '둘째 '
  })
})

test('a memo in a table cell', async () => {
  const rows = [
    [para(text('항목')), para(text('금액'))],
    [para(text('인건비')), para(text('총 ') + memo(1, text('1,200만 원')))]
  ]
  assertMarked(await openParas(para(text('첫')), para(table(rows))), {
    place: 'tableCell',
    anchorText: '1,200만 원',
    before: '인건비총 '
  })
})

test('a memo in a table cell on the second page; the first row is repeated there', async () => {
  const rows = Array.from({ length: 61 }, (_, i) => [para(i === 0 ? memo(1, text('머리')) : i === 51 ? memo(2, text('아래 칸')) : text(`행 ${i}`))])
  const { threads, problems, shown, pages } = await openParas(para(table(rows, { inline: false, headerRow: true })))
  assert.deepEqual([pages, problems], [2, []])
  assert.deepEqual(
    threads.map((thread) => [thread.place, thread.page, thread.located, thread.anchorText]),
    [['tableCell', 1, true, '머리'], ['tableCell', 2, true, '아래 칸']]
  )
  assert.deepEqual(shown.map((pages) => pages.map(({ page, lines }) => [page, lines])), [[[1, ['머리']]], [[2, ['아래 칸']]]])
})

test('a memo in a text box', async () => {
  assertMarked(await openParas(para(text('첫')), para(textBox(para(text('상자 ') + memo(1, text('글')) + text(' 끝'))))), {
    place: 'textBox',
    anchorText: '글',
    before: '상자 '
  })
})

test('a memo in a table inside a text box and in a table inside a cell', async () => {
  const inner = table([[para(text('왼')), para(text('안 ') + memo(1, text('안쪽 칸')))]])
  assertMarked(await openParas(para(textBox(para(inner)))), { place: 'tableCell', anchorText: '안쪽 칸', before: '왼안 ' })
  assertMarked(await openParas(para(table([[para(text('가')), para(text('나'))], [para(text('다')), para(inner)]]))), {
    place: 'tableCell',
    anchorText: '안쪽 칸',
    before: '다왼안 '
  })
})

test('a memo in a table that is all a one-cell table has keeps its page only', async () => {
  const inner = table([[para(text('왼')), para(memo(1, text('감싼 칸')))]])
  assertListed(await openParas(para(text('첫')), para(table([[para(inner)]]), { pageBreak: true })), {
    place: 'tableCell',
    page: 2,
    anchorText: '감싼 칸'
  })
})

test('a memo in grouped text boxes has the page only', async () => {
  const boxes = groupedBoxes([para(text('왼쪽 글')), para(memo(1, text('오른쪽 글')))])
  assertListed(await openParas(para(text('첫')), para(boxes, { pageBreak: true })), {
    place: 'textBox',
    page: 2,
    anchorText: '오른쪽 글'
  })
})

test('a memo in a header, a footer or a master page has no page', async () => {
  for (const kind of /** @type {const} */ (['header', 'footer'])) {
    const edge = pageEdge(kind, para(text('앞 ') + memo(1, text('둘레 글'))))
    assertListed(await openParas(para(edge + text('본문')), para(text('둘째 쪽'), { pageBreak: true })), {
      place: kind,
      page: null,
      anchorText: '둘레 글'
    })
  }
  assertListed(await open(memoHwpx({ sections: [[para(text('본문'))]], masterPage: para(memo(1, text('바탕쪽 글'))) })), {
    place: 'masterPage',
    page: null,
    anchorText: '바탕쪽 글'
  })
})

test('a memo in a note or a caption is on the page of the paragraph that has it', async () => {
  const notes = /** @type {const} */ ([['footnote', footnote], ['endnote', endnote]])
  for (const [place, note] of notes) {
    const owner = para(text('본문') + note(para(text('주 ') + memo(1, text('글')))) + text(' 뒤'), { pageBreak: true })
    assertListed(await openParas(para(text('첫')), owner), { place, page: 2, anchorText: '글' })
  }
  const captioned = table([[para(text('칸'))]], { captionParas: para(memo(1, text('캡션 글'))) })
  assertListed(await openParas(para(text('첫')), para(captioned, { pageBreak: true })), {
    place: 'caption',
    page: 2,
    anchorText: '캡션 글'
  })
})

test('a memo in a footnote of a table cell', async () => {
  const cell = para(text('칸') + footnote(para(memo(1, text('칸 각주')))))
  assertListed(await openParas(para(text('첫')), para(table([[para(text('가'))], [cell]]), { pageBreak: true })), {
    place: 'footnote',
    page: 2,
    anchorText: '칸 각주'
  })
})

test('a memo over several paragraphs is highlighted to the end of the first', async () => {
  const { threads, problems, shown } = await openParas(
    ...filler(40),
    para(text('앞 ') + memoStart(1) + text('시작 문단')),
    para(text('둘째 쪽 문단')),
    para(text('끝 문단') + memoEnd(1) + text(' 뒤'))
  )
  assert.deepEqual(problems, [])
  assert.deepEqual(threads.map(summary), [
    { number: 1, place: 'body', page: 1, located: true, anchorText: '시작 문단', memos: [['검토자', '메모 1']] }
  ])
  assert.equal(threads[0].multiParagraph, true)
  assert.deepEqual(shown[0].map(({ page, lines, before }) => [page, lines, before]), [[1, ['시작 문단'], '앞 ']])
})

test('memos over several paragraphs are not one thread, even from the same start', async () => {
  const { threads } = await openParas(
    para(memoStart(1) + memoStart(2) + text('첫')),
    para(text('둘째') + memoEnd(2)),
    para(text('셋째') + memoEnd(1))
  )
  assert.deepEqual(threads.map(({ multiParagraph, memos }) => [multiParagraph, memos.length]), [[true, 1], [true, 1]])
})

test('a memo of no length shows its number where it is', async () => {
  const { doc, threads, problems, shown } = await openParas(
    para(text('앞뒤') + memo(1, '') + text('사이')),
    para(memo(2, '')),
    para(text('끝에') + memo(3, ''))
  )
  assert.deepEqual(problems, [])
  assert.deepEqual(threads.map(summary), [1, 2, 3].map((number) => (
    { number, place: 'body', page: 1, located: true, anchorText: '', memos: [['검토자', `메모 ${number}`]] }
  )))
  assert.deepEqual(threads.map((thread) => thread.multiParagraph), [false, false, false])
  assert.deepEqual(shown.map((pages) => pages.map(({ page, lines }) => [page, lines])), [[[1, []]], [[1, []]], [[1, []]]])
  const run = doc.pageAnchorRuns(0)[0]
  assert.deepEqual(shown[0][0].badge, { x: run.x + run.charX[2], y: run.y })
  assert.equal(shown[1][0].badge.x, run.x)
  assert.ok(shown[2][0].badge.x > run.x)
})

test('a memo with an empty body and one without a body stay in the list', async () => {
  const { threads, problems } = await openParas(
    para(memo(1, text('빈 본문'), { body: '' })),
    para(memo(2, text('본문 없음'), { body: null }))
  )
  assert.deepEqual(threads.map(({ anchorText, located, memos }) => [anchorText, located, memos[0].text]), [
    ['빈 본문', true, ''],
    ['본문 없음', true, null]
  ])
  assert.deepEqual(problems, [{ code: 'no-body', count: 1, number: 2 }])
})

test('three memos on the same text are one thread, in number order', async () => {
  for (const ends of [[3, 1, 2], [2, 1, 3]]) {
    const { threads, problems, shown } = await openParas(
      para(
        text('앞 ') + memoStart(3, { author: '셋', body: '마지막' }) + memoStart(1, { author: '하나', body: '처음' }) +
          memoStart(2, { author: '둘', body: '두 줄\n본문' }) + text('같은 글') + ends.map(memoEnd).join('') + text(' 뒤')
      )
    )
    assert.deepEqual(problems, [])
    assert.deepEqual(threads.map(summary), [
      {
        number: 1, place: 'body', page: 1, located: true, anchorText: '같은 글',
        memos: [['하나', '처음'], ['둘', '두 줄\n본문'], ['셋', '마지막']]
      }
    ])
    assert.deepEqual(shown[0].map(({ lines, before }) => [lines, before]), [[['같은 글'], '앞 ']])
  }
})

test('memos on different words of a paragraph, also one inside the other, are threads of their own', async () => {
  const { threads, shown } = await openParas(
    para(memo(1, text('예산')) + text('과 ') + memo(2, text('일정'))),
    para(memoStart(3) + text('가나') + memo(4, text('다라')) + text('마바') + memoEnd(3) + text('뒤'))
  )
  assert.deepEqual(threads.map(({ number, located, anchorText, memos }) => [number, located, anchorText, memos.map((memo) => memo.text)]), [
    [1, true, '예산', ['메모 1']],
    [2, true, '일정', ['메모 2']],
    [3, true, '가나다라마바', ['메모 3']],
    [4, true, '다라', ['메모 4']]
  ])
  assert.deepEqual(shown.map((pages) => pages.map(({ lines, before }) => [lines, before])), [
    [[['예산'], '']],
    [[['일정'], '예산과 ']],
    [[['가나다라마바'], '']],
    [[['다라'], '가나']]
  ])
})

test('a memo in a paragraph behind a footnote or a table', async () => {
  const note = footnote(para(text('각주 글')))
  const inline = table([[para(text('칸'))]])
  assertMarked(await openParas(para(text('앞') + note + text(' 가운데 ') + memo(1, text('기준 글')) + text(' 뒤'))), {
    anchorText: '기준 글',
    before: '앞 가운데 '
  })
  assertMarked(await openParas(para(text('앞') + inline + text(' 가운데 ') + memo(1, text('기준 글')) + text(' 뒤'))), {
    anchorText: '기준 글',
    before: '앞칸 가운데 '
  })
  const both = await openParas(para(text('앞') + note + inline + text(' 하') + memo(1, text('하')) + text('하')))
  assertMarked(both, { anchorText: '하', before: '앞칸 하' })
  // A note in the memo's own text splits the highlight.
  assertMarked(await openParas(para(text('앞 ') + memo(1, text('본') + note + text('문')) + text(' 뒤'))), {
    anchorText: '본문',
    before: '앞 ',
    lines: ['본', '문']
  })
})

test('a memo that begins with blanks is highlighted from its first character', async () => {
  assertMarked(await openParas(para(text('앞') + memo(1, text('  공백 글')) + text(' 뒤'))), {
    anchorText: '  공백 글',
    before: '앞  ',
    lines: ['공백 글']
  })
  // Forty lines and one more fill the page; the blanks end its last line, the text is on the next page.
  assertMarked(await openParas(...filler(40), para(text('가'.repeat(41)) + memo(1, text('    다음 쪽 글')) + text(' 뒤'))), {
    page: 2,
    anchorText: '    다음 쪽 글',
    lines: ['다음 쪽 글']
  })
})

test('a memo that goes on over lines and pages is highlighted on the page it begins on', async () => {
  const long = Array.from({ length: 60 }, (_, i) => `${i + 1}번째 줄을 채우는 긴 글이 여기에 이어진다.`).join(' ')
  for (const paras of [
    [...filler(30), para(text('앞 ') + memo(1, text(long)) + text(' 뒤'))],
    [...filler(30), para(table([[para(text('앞 ') + memo(1, text(long)) + text(' 뒤'))]], { inline: false }))]
  ]) {
    const { threads, problems, shown, pages } = await openParas(...paras)
    assert.ok(pages > 1)
    assert.deepEqual([problems, threads.length], [[], 1])
    assert.deepEqual([threads[0].page, threads[0].located, threads[0].anchorText], [1, true, long])
    assert.deepEqual(shown[0].map(({ page, before }) => [page, before]), [[1, '앞 ']])
    const { lines } = shown[0][0]
    assert.ok(lines.length >= 5 && lines.every((line) => line !== ''))
    assert.ok(long.startsWith(lines.join('')), lines.join('|'))
    assert.ok(lines.join('').length < long.length)
  }
})

test('author and body are plain text; control characters are gone', async () => {
  const author = '<img onerror=1>\u0007나</svg>\u001b'
  const { threads, problems } = await openParas(
    para(memo(1, text('가'), { author, body: '<img src=x onerror=1>\n</svg>\u0007&amp;' })),
    para(memo(2, text('나'), { author, authorParam: false })), // the name is in the command only
    para(memo(3, text('<b>다</b>'), { author: '' }))
  )
  assert.deepEqual(problems, [])
  assert.deepEqual(threads.map(summary), [
    { number: 1, place: 'body', page: 1, located: true, anchorText: '가', memos: [['<img onerror=1>나</svg>', '<img src=x onerror=1>\n</svg>&amp;']] },
    { number: 2, place: 'body', page: 1, located: true, anchorText: '나', memos: [['<img onerror=1>나</svg>', '메모 2']] },
    { number: 3, place: 'body', page: 1, located: true, anchorText: '<b>다</b>', memos: [['', '메모 3']] }
  ])
})

test('the date is the FILETIME of the command, else the CreateDateTime text as it is', async () => {
  const time = filetime('2026-11-20T08:24:04Z')
  const { threads } = await openParas(
    para(memo(1, text('가'), { time: '2169694768/31291592' })),
    para(memo(2, text('나'), { time, created: '2026-11-20T17:24:04Z' })),
    para(memo(3, text('다'), { created: '2026-11-20T17:24:04Z' })), // no FILETIME: 0/0
    para(memo(4, text('라'), { command: false, created: '2026년 11월 20일' })),
    para(memo(5, text('마')))
  )
  assert.deepEqual(threads.map(({ memos: [memo] }) => [memo.date, memo.dateText]), [
    ['2026-11-20T08:24:04Z', null],
    ['2026-11-20T08:24:04Z', null],
    [null, '2026-11-20T17:24:04Z'],
    [null, '2026년 11월 20일'],
    [null, null]
  ])
})

test('a damaged section is a problem; the memos of the others, and what was read of it, stay', async () => {
  const sections = ['첫', '둘', '셋'].map((word, i) => [para(memo(i + 1, text(word)))])
  const parts = memoParts({ sections })
  const name = 'Contents/section1.xml'
  const section = parts[name]
  const unreadable = [
    { code: 'missing-memo', count: 1 },
    { code: 'section-unreadable', count: 1, sectionIndex: 1 }
  ]
  const incomplete = [{ code: 'bad-record', count: 1 }]
  /** @type {[string, typeof incomplete, (string | null)[]][]} */
  const damaged = [
    [section.replace('</hp:p>', '</hp:q>'), unreadable, ['메모 1', '메모 3']],
    [section.slice(0, -20), unreadable, ['메모 1', '메모 3']], // ends inside a tag
    [section.slice(0, section.indexOf('둘') + 1), incomplete, ['메모 1', '메모 2', '메모 3']],
    [section.slice(0, section.indexOf('메모 2') + 2), incomplete, ['메모 1', '메모', '메모 3']],
    [section.slice(0, section.indexOf('<hp:subList')), [...incomplete, { code: 'no-body', count: 1 }], ['메모 1', null, '메모 3']],
    ['', incomplete, ['메모 1', '메모 3']]
  ]
  for (const [xml, expected, bodies] of damaged) {
    const { threads, problems } = await open(hwpxFromText({ ...parts, [name]: xml }))
    assert.deepEqual(threads.map(({ memos: [memo] }) => memo.text), bodies)
    assert.deepEqual(problems.map(({ number, ...rest }) => rest), expected)
  }
})

// The HWP document the generator makes (scripts/testdata/synthetic-memos.generator.mjs). It is not
// committed: without it in fixtures/ there is nothing to test.
const hwpUrl = new URL('../../fixtures/synthetic-memos.hwp', import.meta.url)

test('an HWP document gives the same: threads, places, pages and highlights', async () => {
  if (!existsSync(hwpUrl)) return
  const { threads, problems, shown, pages } = await open(new Uint8Array(readFileSync(hwpUrl)))
  assert.deepEqual([pages, problems], [2, []])
  const whole = '둘째 쪽 첫 문단입니다. 이 문장 전체에 메모가 있습니다.'
  /** @type {[string, number, string, string[] | null][]} place, page, text, what is highlighted */
  const expected = [
    ['body', 1, '합성 메모 시험 문서', ['합성 메모 시험 문서']],
    ['body', 1, '예산', ['예산']],
    ['body', 1, '일정', ['일정']],
    ['body', 1, '기준 글', ['기준 글']], // behind a footnote
    ['body', 1, '', []], // no length
    ['body', 1, '표 뒤 글', ['표 뒤 글']], // behind an inline table
    ['tableCell', 1, '1,200만 원', ['1,200만 원']],
    ['textBox', 1, '글상자 글', ['글상자 글']],
    ['body', 2, whole, [whole]],
    ['body', 2, '   메모', ['메모']], // begins with blanks
    ['textBox', 2, '묶인 왼쪽 글', null], // grouped
    ['textBox', 2, '묶인 오른쪽 글', null]
  ]
  assert.deepEqual(
    threads.map(({ number, place, page, located, anchorText, multiParagraph }) => [number, place, page, located, anchorText, multiParagraph]),
    expected.map(([place, page, anchorText, marked], i) => [i + 1, place, page, marked !== null, anchorText, false])
  )
  assert.deepEqual(
    shown.map((marks) => marks.map(({ page, lines }) => [page, lines])),
    expected.map(([, page, , marked]) => (marked === null ? [] : [[page, marked]]))
  )
  assert.deepEqual(threads[0].memos.map((memo) => [memo.author, memo.text]), [
    ['검토자 가', '제목에 연도를 넣을지 정해 주세요.'],
    ['작성자 나', '연도는 넣지 않기로 했습니다.'],
    ['검토자 가', '확인했습니다.']
  ])
  assert.deepEqual(threads.map(({ memos }) => memos.length), [3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
  assert.equal(threads[1].memos[0].text, '예산 숫자는 다음 주에 확정됩니다.\n둘째 줄이 있는 메모입니다.')
  assert.equal(threads[1].memos[0].author, '재무 담당')
  for (const { memos } of threads) for (const { date } of memos) assert.equal(date, '2026-11-20T08:24:04Z')
})
