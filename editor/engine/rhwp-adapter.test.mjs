import { existsSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
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
