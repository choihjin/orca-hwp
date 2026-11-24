import { existsSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { HwpDocument } from '../vendor/rhwp/rhwp.js' // only to stand in for engine methods below
import { ENGINE_INFO, EngineError, initEngine, openDocument } from './rhwp-adapter.js'

const wasmBytes = new Uint8Array(readFileSync(new URL('../vendor/rhwp/rhwp_bg.wasm', import.meta.url)))
const sampleUrl = new URL('../../fixtures/21868765_별표2_보건소_분장사무.hwp', import.meta.url)

/** A ZIP holding one stored file named `mimetype` with the text `x`: a ZIP, but not HWPX. */
function minimalZip() {
  const name = new TextEncoder().encode('mimetype')
  const data = new TextEncoder().encode('x')
  const crc = 0x8cdc1683 // CRC-32 of "x"
  const local = new Uint8Array(30 + name.length + data.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)
  lv.setUint16(4, 10, true)
  lv.setUint32(14, crc, true)
  lv.setUint32(18, data.length, true)
  lv.setUint32(22, data.length, true)
  lv.setUint16(26, name.length, true)
  local.set(name, 30)
  local.set(data, 30 + name.length)
  const central = new Uint8Array(46 + name.length)
  const cv = new DataView(central.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint16(4, 20, true)
  cv.setUint16(6, 10, true)
  cv.setUint32(16, crc, true)
  cv.setUint32(20, data.length, true)
  cv.setUint32(24, data.length, true)
  cv.setUint16(28, name.length, true)
  central.set(name, 46)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, 1, true)
  ev.setUint16(10, 1, true)
  ev.setUint32(12, central.length, true)
  ev.setUint32(16, local.length, true)
  const zip = new Uint8Array(local.length + central.length + end.length)
  zip.set(local, 0)
  zip.set(central, local.length)
  zip.set(end, local.length + central.length)
  return zip
}

/** @param {() => unknown} fn */
function codeOf(fn) {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof EngineError, `expected EngineError, got ${error}`)
    return error.code
  }
  throw new Error('expected openDocument to throw')
}

test('initEngine twice initialises once and opens nothing yet', async () => {
  await initEngine(wasmBytes)
  await initEngine(wasmBytes)
  assert.equal(ENGINE_INFO.name, 'rhwp')
  assert.equal(ENGINE_INFO.version, '0.8.7-p1')
})

test('bytes that are not a Hangul document are not-hangul', async () => {
  await initEngine(wasmBytes)
  assert.equal(codeOf(() => openDocument(new Uint8Array([1, 2, 3]))), 'not-hangul')
  assert.equal(codeOf(() => openDocument(new Uint8Array(0))), 'not-hangul')
})

test('a ZIP that is not HWPX is unsupported or corrupt', async () => {
  await initEngine(wasmBytes)
  assert.ok(['unsupported', 'corrupt'].includes(codeOf(() => openDocument(minimalZip()))))
})

test('a header-only OLE file is corrupt', async () => {
  await initEngine(wasmBytes)
  const ole = new Uint8Array(512)
  ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  assert.equal(codeOf(() => openDocument(ole)), 'corrupt')
})

test('a truncated HWP is corrupt and keeps the engine usable', async () => {
  if (!existsSync(sampleUrl)) return // fixtures/ is fetched by scripts/fetch-fixtures.mjs
  await initEngine(wasmBytes)
  const full = new Uint8Array(readFileSync(sampleUrl))
  assert.equal(codeOf(() => openDocument(full.slice(0, full.length >> 1))), 'corrupt')
  const doc = openDocument(full)
  assert.equal(doc.pageCount, 4)
  doc.dispose()
})

// Synthetic documents fetched into fixtures/ (scripts/testdata/README.md): inline tables and text boxes in
// one paragraph whose stored line ladder resets vpos once. npm 0.8.7 opened a page per line
// (27 and 19 pages); the 0.8.7-p1 patch follows the stored ladder (2 pages each).
for (const [file, pages] of [
  ['synthetic-tac-sibling-reset.hwp', 2],
  ['synthetic-tac-sibling-reset-shapes.hwp', 2],
]) {
  test(`${file}: inline tables after a stored page reset fill ${pages} pages, not one per line`, async () => {
    const url = new URL(`../../fixtures/${file}`, import.meta.url)
    if (!existsSync(url)) return
    await initEngine(wasmBytes)
    const doc = openDocument(new Uint8Array(readFileSync(url)))
    assert.equal(doc.pageCount, pages)
    doc.dispose()
  })
}

test('a sample HWP gives page count, size, SVG and text runs', async () => {
  if (!existsSync(sampleUrl)) return
  await initEngine(wasmBytes)
  const doc = openDocument(new Uint8Array(readFileSync(sampleUrl)))
  assert.equal(doc.pageCount, 4)
  assert.equal(Math.round(doc.pageSize(0).width), 794)
  assert.equal(Math.round(doc.pageSize(0).height), 1123)
  assert.ok(doc.renderPageSvg(0).startsWith('<svg'))
  const runs = doc.pageTextRuns(0)
  assert.ok(runs.some((run) => run.text.includes('보건정책과')))
  assert.deepEqual(Object.keys(runs[0]).sort(), ['bold', 'fontFamily', 'fontSize', 'h', 'text', 'w', 'x', 'y'])
  doc.dispose()
})

test('a ZIP cut short (no complete end record) is corrupt, not unsupported', async () => {
  await initEngine(wasmBytes)
  const zip = minimalZip()
  for (const cut of [1, 2, 21, 22, 40]) {
    assert.equal(codeOf(() => openDocument(zip.slice(0, zip.length - cut))), 'corrupt', `cut ${cut}`)
  }
  // a complete ZIP that is not HWPX keeps its earlier classification
  assert.ok(['unsupported', 'corrupt'].includes(codeOf(() => openDocument(zip))))
})

const hwpxUrl = new URL('../../fixtures/2025년 기부·답례품 실적 지자체 보고서_양식.hwpx', import.meta.url)

test('a truncated HWPX sample is corrupt', async () => {
  if (!existsSync(hwpxUrl)) return
  await initEngine(wasmBytes)
  const full = new Uint8Array(readFileSync(hwpxUrl))
  for (const cut of [2, 1000, full.length >> 1]) {
    assert.equal(codeOf(() => openDocument(full.slice(0, full.length - cut))), 'corrupt', `cut ${cut}`)
  }
  const doc = openDocument(full)
  assert.equal(doc.pageCount, 30)
  doc.dispose()
})

/**
 * Runs `fn` with engine methods replaced, so memo reading is tested apart from the engine build.
 * @param {Record<string, unknown>} methods
 * @param {() => void} fn
 */
function withEngine(methods, fn) {
  const before = Object.getOwnPropertyDescriptors(HwpDocument.prototype)
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(HwpDocument.prototype, name, { value, configurable: true, writable: true })
  }
  try {
    fn()
  } finally {
    for (const name of Object.keys(methods)) {
      if (before[name]) Object.defineProperty(HwpDocument.prototype, name, before[name])
      else Reflect.deleteProperty(HwpDocument.prototype, name)
    }
  }
}

const memoEntry = {
  number: 1,
  author: '검토자 가',
  text: '본문',
  date: null,
  dateText: null,
  place: 'body',
  anchorText: '보건정책과',
  paragraphText: '보건정책과',
  multiParagraph: false,
  anchorKey: 'a',
  sectionIndex: 0,
  ownerParaIndex: 2,
  paraIndex: 2,
  path: null,
  startCharIdx: 1,
  endCharIdx: 3
}

const planUrl = new URL('../../fixtures/2022년 국립국어원 업무계획.hwp', import.meta.url)

async function openSample(url = sampleUrl) {
  await initEngine(wasmBytes)
  return openDocument(new Uint8Array(readFileSync(url)))
}

test('a document without memos gives an empty report', async () => {
  if (!existsSync(sampleUrl)) return
  const doc = await openSample()
  // an engine built before 0.8.7-p2 has no getMemos: stand in for it, use the real one otherwise
  const missing = !('getMemos' in HwpDocument.prototype)
  withEngine(missing ? { getMemos: () => '{"memos":[],"problems":[]}' } : {}, () => {
    assert.deepEqual(doc.memos(), { threads: [], problems: [] })
  })
  doc.dispose()
})

test('memos are read from the engine once, every call gives its own copy', async () => {
  if (!existsSync(sampleUrl)) return
  const doc = await openSample()
  let calls = 0
  const getMemos = () => {
    calls++
    return JSON.stringify({ memos: [memoEntry], problems: [{ code: 'bad-record', count: 1 }] })
  }
  withEngine({ getMemos }, () => {
    const report = doc.memos()
    assert.equal(report.threads[0].memos[0].text, '본문')
    assert.deepEqual(report.problems, [{ code: 'bad-record', count: 1 }])
    report.threads[0].memos[0].text = '바뀜'
    report.threads[0].page = 9
    report.problems.length = 0
    const again = doc.memos()
    assert.deepEqual([again.threads[0].memos[0].text, again.threads[0].page, again.problems.length], ['본문', null, 1])
    assert.equal(calls, 1)
    doc.dispose()
    assert.equal(codeOf(() => doc.memos()), 'engine')
  })
})

test('an engine that cannot give memos is an engine error, not a document without memos', async () => {
  if (!existsSync(sampleUrl)) return
  const doc = await openSample()
  const broken = [
    undefined,
    () => '{"memos":',
    () => '{}',
    () => {
      throw '렌더링 오류: 메모'
    }
  ]
  for (const getMemos of broken) {
    withEngine({ getMemos }, () => assert.equal(codeOf(() => doc.memos()), 'engine'))
  }
  // a failure is not kept as the answer
  withEngine({ getMemos: () => '{"memos":[],"problems":[]}' }, () => assert.equal(doc.memos().threads.length, 0))
  doc.dispose()
})

test('pageAnchorRuns gives every run its place, and only runs that have one', async () => {
  if (!existsSync(sampleUrl)) return
  const doc = await openSample()
  const runs = doc.pageAnchorRuns(0)
  assert.equal(runs[0].charX.length, Array.from(runs[0].text).length + 1)
  assert.equal(typeof runs[0].paraIdx, 'number')
  const inCell = runs.find((run) => run.cellPath)
  assert.equal(typeof inCell?.parentParaIdx, 'number')
  assert.deepEqual(Object.keys(inCell?.cellPath?.[0] ?? {}).sort(), ['cellIndex', 'cellParaIndex', 'controlIndex'])
  // the keys agents already get stay as they are
  assert.deepEqual(Object.keys(doc.pageTextRuns(0)[0]).sort(), ['bold', 'fontFamily', 'fontSize', 'h', 'text', 'w', 'x', 'y'])
  // page numbers and list marks have no place in the document text
  const layout = { runs: [{ text: '- 1 -', x: 0, y: 0, w: 1, h: 1, charX: [0, 1, 2, 3, 4, 5] }, { text: 'a', x: 1, y: 2, w: 3, h: 4, charX: [0, 3], secIdx: 0, paraIdx: 5, charStart: 6, bold: true }] }
  withEngine({ getPageTextLayout: () => JSON.stringify(layout) }, () => {
    assert.deepEqual(doc.pageAnchorRuns(0), [{ text: 'a', x: 1, y: 2, w: 3, h: 4, charX: [0, 3], secIdx: 0, paraIdx: 5, charStart: 6 }])
  })
  doc.dispose()
})

/** @param {Record<string, unknown>} over */
function threadAt(over = {}) {
  const { anchor, ...rest } = /** @type {any} */ (over)
  return /** @type {any} */ ({
    place: 'body',
    anchor: { sectionIndex: 0, ownerParaIndex: 2, paraIndex: 2, path: null, startCharIdx: 1, endCharIdx: 3, ...anchor },
    ...rest
  })
}

test('memoCaret asks the engine for the memo position, by path inside cells', async () => {
  if (!existsSync(sampleUrl)) return
  const doc = await openSample()
  /** @type {unknown[][]} */
  const asked = []
  const answer = (/** @type {string} */ name) => (/** @type {unknown[]} */ ...args) => {
    asked.push([name, ...args])
    return '{"pageIndex":2,"x":1,"y":2,"height":3}'
  }
  withEngine({ getCursorRect: answer('rect'), getCursorRectByPath: answer('path') }, () => {
    const path = [{ controlIndex: 0, cellIndex: 3, cellParaIndex: 1 }]
    const caret = { page: 2, x: 1, y: 2 }
    assert.deepEqual(doc.memoCaret(threadAt()), caret)
    assert.deepEqual(doc.memoCaret(threadAt({ anchor: { path: [] } })), caret)
    assert.deepEqual(doc.memoCaret(threadAt({ place: 'tableCell', anchor: { ownerParaIndex: 7, paraIndex: 1, path } })), caret)
    // a note or caption has no position of its own: the paragraph that owns it gives the page
    const outside = { paraIndex: null, path: null, startCharIdx: null, endCharIdx: null }
    assert.deepEqual(doc.memoCaret(threadAt({ place: 'footnote', anchor: { ...outside, ownerParaIndex: 4 } })), { page: 2, x: null, y: null })
    assert.deepEqual(asked, [['rect', 0, 2, 1], ['rect', 0, 2, 1], ['path', 0, 7, JSON.stringify(path), 1], ['rect', 0, 4, 0]])
    assert.equal(doc.memoCaret({ ...threadAt(), place: 'unlinked', anchor: null }), null)
  })
  doc.dispose()
})

const noCaret = () => {
  throw '렌더링 오류: 문단 (sec=0, para=99)이 페이지에 없습니다'
}
/** Answers that give no caret; the sample has 4 pages. */
const badCarets = [noCaret, () => '{}', () => '{"pageIndex":4,"x":1,"y":2}', () => '{"pageIndex":-1,"x":1,"y":2}', () => 'x']

test('memoCaret takes the page of the paragraph start when the position has none', async () => {
  if (!existsSync(sampleUrl)) return
  const doc = await openSample()
  const path = [{ controlIndex: 0, cellIndex: 3, cellParaIndex: 1 }]
  for (const bad of badCarets) {
    const getCursorRect = (/** @type {number} */ sec, /** @type {number} */ para, /** @type {number} */ char) =>
      char === 0 ? '{"pageIndex":1,"x":5,"y":6}' : bad()
    const getCursorRectByPath = (/** @type {number} */ sec, /** @type {number} */ para, /** @type {string} */ steps, /** @type {number} */ char) =>
      char === 0 ? '{"pageIndex":3,"x":5,"y":6}' : bad()
    withEngine({ getCursorRect, getCursorRectByPath }, () => {
      assert.deepEqual(doc.memoCaret(threadAt()), { page: 1, x: null, y: null })
      assert.deepEqual(doc.memoCaret(threadAt({ anchor: { path } })), { page: 3, x: null, y: null })
    })
  }
  withEngine({ getCursorRect: () => '{"pageIndex":1}' }, () => {
    assert.deepEqual(doc.memoCaret(threadAt()), { page: 1, x: null, y: null })
  })
  doc.dispose()
})

test('memoCaret is null when the engine has no position in the paragraph', async () => {
  if (!existsSync(sampleUrl)) return
  const doc = await openSample()
  for (const getCursorRect of badCarets) {
    withEngine({ getCursorRect }, () => assert.equal(doc.memoCaret(threadAt()), null))
  }
  doc.dispose()
})

// 35 pages of body text and tables, none of them with a heading row repeated on later pages.
test('memoCaret follows text to the page it is drawn on; boundaries count code points', async () => {
  if (!existsSync(planUrl)) return
  const doc = await openSample(planUrl)
  let seen = 0
  let surrogates = 0
  for (let page = 0; page < doc.pageCount; page++) {
    for (const run of doc.pageAnchorRuns(page)) {
      const length = Array.from(run.text).length
      assert.equal(run.charX.length, length + 1)
      if (length !== run.text.length) surrogates++
      if (run.text === '' || run.paraIdx > 0xffff || seen++ % 7 !== 0) continue
      const anchor = {
        sectionIndex: run.secIdx,
        ownerParaIndex: run.parentParaIdx ?? run.paraIdx,
        paraIndex: run.paraIdx,
        path: run.cellPath ?? null,
        startCharIdx: run.charStart
      }
      assert.equal(doc.memoCaret(threadAt({ anchor }))?.page, page, run.text)
    }
  }
  assert.ok(seen > 4000)
  assert.ok(surrogates > 0)
  doc.dispose()
})
