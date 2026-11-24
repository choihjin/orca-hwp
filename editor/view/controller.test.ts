import { assert, test } from 'orca/testing'
import { EngineError } from '../engine/rhwp-adapter.js'
import type { EngineDocument } from '../engine/rhwp-adapter.js'
import { documentKey, loadView, saveView } from '../state/view-memory'
import { existsSync, readFileSync } from 'node:fs'
import { initEngine, openDocument } from '../engine/rhwp-adapter.js'
import { createController, isBlankPage } from './controller'
import type { MemoThread } from '../engine/memo-threads.js'
import type { ErrorCode, MemoState, ViewPort } from './controller'

type FakeDoc = EngineDocument & { disposed: number; name: string }

function fakeDoc(name: string, pageCount: number): FakeDoc {
  const doc: FakeDoc = {
    name,
    disposed: 0,
    pageCount,
    pageSize: () => ({ width: 794, height: 1123 }),
    renderPageSvg: (i) => `<svg xmlns="http://www.w3.org/2000/svg" data-page="${i}"/>`,
    pageTextRuns: () => [],
    memos: () => ({ threads: [], problems: [] }),
    memoCaret: () => null,
    pageAnchorRuns: () => [],
    dispose() {
      doc.disposed++
    }
  }
  return doc
}

type Call =
  | { kind: 'show'; doc: EngineDocument; page: number; zoom: number | undefined }
  | { kind: 'error'; code: ErrorCode; detail: string | undefined }
  | { kind: 'clear' }
  | { kind: 'memos'; state: MemoState }
  | { kind: 'refresh' }

function fakeView(): ViewPort & { calls: Call[]; last(): Call | undefined } {
  const calls: Call[] = []
  return {
    calls,
    last: () => calls[calls.length - 1],
    showDocument(doc, page, zoom) {
      calls.push({ kind: 'show', doc, page, zoom })
    },
    showError(code, detail) {
      calls.push({ kind: 'error', code, detail })
    },
    clear() {
      calls.push({ kind: 'clear' })
    },
    prepareMemos(state) {
      calls.push({ kind: 'memos', state })
    },
    refreshMemos() {
      calls.push({ kind: 'refresh' })
    }
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k)
    },
    setItem: (k, v) => {
      map.set(k, String(v))
    }
  }
}

const bytesA = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1])
const bytesB = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 2])

function engineOf(...docs: FakeDoc[]) {
  let i = 0
  return { open: () => docs[i++] }
}

test('기억한 쪽에서 연다', async () => {
  const storage = memoryStorage()
  saveView(storage, documentKey(bytesA), { page: 3, zoom: 1.5 })
  const doc = fakeDoc('a', 10)
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage })
  await c.load(bytesA)
  const last = view.last()
  assert.equal(last?.kind, 'show')
  assert.equal(last?.kind === 'show' && last.page, 3)
  assert.equal(last?.kind === 'show' && last.zoom, 1.5)
  assert.equal(last?.kind === 'show' && last.doc, doc)
  c.dispose()
})

test('첫 showDocument 호출부터 기억한 쪽', () => {
  const storage = memoryStorage()
  saveView(storage, documentKey(bytesA), { page: 5, zoom: 1.25 })
  const doc = fakeDoc('a', 10)
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage })
  void c.load(bytesA)
  // Nothing awaited: the first and only draw is already the remembered page (design 5.3).
  const shows = view.calls.filter((call) => call.kind === 'show')
  assert.equal(shows.length, 1)
  assert.equal(shows[0].kind === 'show' && shows[0].page, 5)
  assert.equal(shows[0].kind === 'show' && shows[0].zoom, 1.25)
  c.dispose()
})

test('기억이 없으면 첫 칠에 0쪽을 동기로 보낸다', () => {
  const doc = fakeDoc('a', 10)
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: memoryStorage() })
  void c.load(bytesA)
  assert.ok(view.calls.some((call) => call.kind === 'show' && call.doc === doc && call.page === 0))
  c.dispose()
})

test('문서가 바뀌면 이전 문서를 dispose하고 다시 연다', async () => {
  const a = fakeDoc('a', 4)
  const b = fakeDoc('b', 5)
  const view = fakeView()
  const c = createController({ engine: engineOf(a, b), view, storage: memoryStorage() })
  await c.load(bytesA)
  await c.load(bytesB)
  assert.equal(a.disposed, 1)
  assert.equal(b.disposed, 0)
  const last = view.last()
  assert.equal(last?.kind === 'show' && last.doc, b)
  c.dispose()
  assert.equal(b.disposed, 1)
})

test('문서를 연달아 열면 마지막 문서만 남는다', async () => {
  const storage = memoryStorage()
  saveView(storage, documentKey(bytesA), { page: 2, zoom: 1 })
  const a = fakeDoc('a', 4)
  const b = fakeDoc('b', 5)
  const view = fakeView()
  const c = createController({ engine: engineOf(a, b), view, storage })
  const first = c.load(bytesA)
  const second = c.load(bytesB)
  await Promise.all([first, second])
  assert.equal(a.disposed, 1)
  const last = view.last()
  assert.equal(last?.kind === 'show' && last.doc, b)
  assert.equal(last?.kind === 'show' && last.page, 0)
  c.dispose()
})

test('쪽이 0개면 empty 오류', async () => {
  const doc = fakeDoc('a', 0)
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: null })
  await c.load(bytesA)
  const last = view.last()
  assert.equal(last?.kind === 'error' && last.code, 'empty')
  assert.equal(doc.disposed, 1)
  assert.ok(!view.calls.some((call) => call.kind === 'show'))
})

test('EngineError는 code 그대로 오류 화면', async () => {
  const view = fakeView()
  const engine = {
    open(): EngineDocument {
      throw new EngineError('encrypted', '암호가 걸린 문서')
    }
  }
  const c = createController({ engine, view, storage: null })
  await c.load(bytesA)
  const last = view.last()
  assert.equal(last?.kind === 'error' && last.code, 'encrypted')
  assert.equal(last?.kind === 'error' && last.detail, '암호가 걸린 문서')
})

test('EngineError가 아닌 예외는 engine 오류', async () => {
  const view = fakeView()
  const engine = {
    open(): EngineDocument {
      throw new TypeError('boom')
    }
  }
  const c = createController({ engine, view, storage: null })
  await c.load(bytesA)
  const last = view.last()
  assert.equal(last?.kind === 'error' && last.code, 'engine')
})

test('기억한 쪽이 범위 밖이면 0쪽', async () => {
  const storage = memoryStorage()
  saveView(storage, documentKey(bytesA), { page: 99, zoom: 1 })
  const doc = fakeDoc('a', 4)
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage })
  await c.load(bytesA)
  const shows = view.calls.filter((call) => call.kind === 'show')
  assert.ok(shows.length >= 1)
  assert.ok(shows.every((call) => call.kind === 'show' && call.page === 0))
  c.dispose()
})

test('보던 쪽을 잠시 뒤 기억한다', async () => {
  const storage = memoryStorage()
  const doc = fakeDoc('a', 10)
  const c = createController({ engine: engineOf(doc), view: fakeView(), storage })
  await c.load(bytesA)
  c.remember({ page: 6, zoom: 1.25 })
  c.remember({ page: 7, zoom: 1.25 })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(loadView(storage, documentKey(bytesA)), { page: 7, zoom: 1.25 })
  c.dispose()
})

test('쪽을 옮기면 바로 기억한다: 곧 닫혀도 남는다 (Orca 캡처 재현)', async () => {
  // plugin shot closes the editor right after it paints; pagehide is not guaranteed then.
  const storage = memoryStorage()
  const c = createController({ engine: engineOf(fakeDoc('a', 10)), view: fakeView(), storage })
  await c.load(bytesA)
  c.remember({ page: 3, zoom: 1 })
  assert.deepEqual(loadView(storage, documentKey(bytesA)), { page: 3, zoom: 1 })
})

test('연달아 옮기면 매번 바로 기억한다: 곧 닫혀도 마지막 쪽이 남는다 (Orca 캡처 재현)', async () => {
  // PageDown twice and the shot closes at once: the last page, not the first move, must stay.
  const storage = memoryStorage()
  const c = createController({ engine: engineOf(fakeDoc('a', 10)), view: fakeView(), storage })
  await c.load(bytesA)
  c.remember({ page: 1, zoom: 1 })
  c.remember({ page: 2, zoom: 1 })
  c.remember({ page: 5, zoom: 1 })
  assert.deepEqual(loadView(storage, documentKey(bytesA)), { page: 5, zoom: 1 })
})

test('dispose는 남은 기억을 바로 저장하고 화면을 비운다', async () => {
  const storage = memoryStorage()
  const view = fakeView()
  const c = createController({ engine: engineOf(fakeDoc('a', 10)), view, storage })
  await c.load(bytesA)
  c.remember({ page: 4, zoom: 1 })
  c.dispose()
  assert.deepEqual(loadView(storage, documentKey(bytesA)), { page: 4, zoom: 1 })
  assert.equal(view.last()?.kind, 'clear')
})

const PAPER = '<rect x="0" y="0" width="793.7" height="1122.5" fill="#ffffff"/>'
function onePage(body: string, texts: string[]): FakeDoc {
  const doc = fakeDoc('one', 1)
  doc.renderPageSvg = () =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="793.7" height="1122.5" viewBox="0 0 793.7 1122.5">\n` +
    `<defs>\n<clipPath id="body-clip-0"><rect x="56" y="56" width="680" height="1000"/></clipPath>\n</defs>\n` +
    `${PAPER}\n${body}\n</svg>\n`
  doc.pageTextRuns = () =>
    texts.map((text) => ({ text, x: 56, y: 56, w: 680, h: 13, fontFamily: 'Batang', fontSize: 13, bold: false }))
  return doc
}

test('내용 없는 한 쪽 문서는 empty 안내 (리뷰 재현)', async () => {
  // pageCount 1, text runs all empty strings, SVG = white background + an empty group.
  const doc = onePage('<g clip-path="url(#body-clip-0)"></g>', ['', ''])
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: null })
  await c.load(bytesA)
  const last = view.last()
  assert.equal(last?.kind === 'error' && last.code, 'empty')
  assert.ok(!view.calls.some((call) => call.kind === 'show'))
  assert.equal(doc.disposed, 1)
})

test('도형만 있는 한 쪽 문서는 그대로 보인다', async () => {
  const doc = onePage('<g><path d="M100 100 L400 400" stroke="#000"/><rect x="80" y="80" width="200" height="120" fill="none" stroke="#00f"/></g>', [])
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: null })
  await c.load(bytesA)
  assert.equal(view.last()?.kind, 'show')
  c.dispose()
})

test('그림만 있는 한 쪽 문서는 그대로 보인다', async () => {
  const doc = onePage('<image x="10" y="10" width="700" height="980" href="data:image/png;base64,AAAA"/>', [''])
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: null })
  await c.load(bytesA)
  assert.equal(view.last()?.kind, 'show')
  c.dispose()
})

test('글자가 있는 한 쪽 문서는 그대로 보인다', async () => {
  const doc = onePage('<text x="60" y="80" font-size="13">안내</text>', ['안내'])
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: null })
  await c.load(bytesA)
  assert.equal(view.last()?.kind, 'show')
  c.dispose()
})

test('쪽 크기 테두리 사각형 하나만 있는 문서는 그대로 보인다 (재리뷰 재현)', async () => {
  // Engine output for a page-sized rectangle with white fill and a black solid line: the paper
  // first, then a second page-sized rect that carries the stroke.
  const doc = onePage(
    '<rect x="0" y="0" width="793.7" height="1122.5" fill="#ffffff" stroke="#000000" stroke-width="5.333333333333333"/>',
    []
  )
  assert.equal(isBlankPage(doc, 0), false)
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: null })
  await c.load(bytesA)
  assert.equal(view.last()?.kind, 'show')
  c.dispose()
})

test('맨 앞 무테 흰 종이 말고는 쪽 크기 흰 사각형도 내용이다', () => {
  assert.equal(isBlankPage(onePage(PAPER, []), 0), false)
  assert.equal(isBlankPage(onePage('<g transform="translate(1 1)"><rect x="0" y="0" width="793.7" height="1122.5" fill="#ffffff"/></g>', []), 0), false)
})

test('색 있는 쪽 크기 배경은 빈 쪽이 아니다', () => {
  const doc = onePage('<rect x="0" y="0" width="793.7" height="1122.5" fill="#203040"/>', [])
  assert.equal(isBlankPage(doc, 0), false)
})

const handbook = new URL('../../fixtures/2025 행정업무운영 편람(최종).hwpx', import.meta.url)
test('실제 엔진: 편람의 빈 2쪽은 빈 쪽, 그림 표지·글자 쪽은 아님', async () => {
  if (!existsSync(handbook)) {
    console.log('# skip: fixtures/2025 행정업무운영 편람(최종).hwpx missing (npm run fixtures)')
    return
  }
  await initEngine(new Uint8Array(readFileSync(new URL('../vendor/rhwp/rhwp_bg.wasm', import.meta.url))))
  const doc = openDocument(new Uint8Array(readFileSync(handbook)))
  try {
    assert.equal(isBlankPage(doc, 1), true)
    assert.equal(isBlankPage(doc, 0), false)
    assert.equal(isBlankPage(doc, 2), false)
  } finally {
    doc.dispose()
  }
})

function memoThread(number: number): MemoThread {
  return {
    number,
    page: null,
    located: false,
    place: 'body',
    anchorText: '예산',
    paragraphText: '예산',
    multiParagraph: false,
    memos: [{ author: '가', date: null, dateText: null, text: '내용' }],
    anchor: {
      sectionIndex: 0, ownerParaIndex: number, paraIndex: number, path: null,
      startCharIdx: 0, endCharIdx: 2, text: '예산', start: 0
    },
    caret: null
  }
}

/** A document with `count` threads, all on its third page; `log` hears what is asked of it. */
function memoDoc(count: number, log: string[] = []): FakeDoc {
  const doc = fakeDoc('memos', 10)
  doc.memos = () => {
    log.push('memos')
    return { threads: Array.from({ length: count }, (_, i) => memoThread(i + 1)), problems: [] }
  }
  doc.memoCaret = (thread) => {
    log.push(`caret ${thread.number}`)
    return { page: 2, x: 1, y: 2 }
  }
  doc.pageAnchorRuns = (i) => {
    log.push(`layout ${i}`)
    return []
  }
  return doc
}

const states = (view: { calls: Call[] }) => view.calls.flatMap((call) => (call.kind === 'memos' ? [call.state] : []))
const refreshes = (view: { calls: Call[] }) => view.calls.filter((call) => call.kind === 'refresh').length
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(done: () => boolean): Promise<void> {
  for (let n = 0; n < 200 && !done(); n++) await pause(5)
  assert.ok(done())
}

test('메모: memos → 앞 50개의 쪽 → prepareMemos → showDocument를 동기로 부른다', () => {
  const log: string[] = []
  const view = fakeView()
  const { prepareMemos, showDocument } = view
  view.prepareMemos = (state) => {
    log.push('prepare')
    prepareMemos(state)
  }
  view.showDocument = (...args) => {
    log.push('show')
    showDocument(...args)
  }
  const c = createController({ engine: engineOf(memoDoc(120, log)), view, storage: null })
  void c.load(bytesA)
  assert.deepEqual(log, ['memos', ...Array.from({ length: 50 }, (_, i) => `caret ${i + 1}`), 'prepare', 'show'])
  const [state] = states(view)
  assert.equal(state.failed, false)
  assert.equal(state.open, true)
  assert.deepEqual(state.report?.threads.map((t) => t.page), Array.from({ length: 120 }, (_, i) => (i < 50 ? 3 : null)))
  c.dispose()
})

test('메모: 나머지 묶음은 첫 칠 뒤 50개씩 찾고 그때마다 refreshMemos', async () => {
  const log: string[] = []
  const view = fakeView()
  const c = createController({ engine: engineOf(memoDoc(120, log)), view, storage: null })
  await c.load(bytesA)
  assert.equal(refreshes(view), 0)
  const found = () => states(view)[0].report?.threads.filter((t) => t.page === 3).length
  await until(() => refreshes(view) === 1)
  assert.equal(found(), 100)
  await until(() => refreshes(view) === 2)
  assert.equal(found(), 120)
  await pause(60)
  assert.equal(refreshes(view), 2)
  assert.equal(log.filter((line) => line.startsWith('caret')).length, 120)
  assert.ok(!log.some((line) => line.startsWith('layout')))
  c.dispose()
})

test('메모: 한 묶음이 오래 걸리면 시간 안에 끝난 만큼만 찾고 나머지를 이어서 찾는다', async () => {
  const clock = performance.now
  let now = 0
  performance.now = () => now
  try {
    const log: string[] = []
    const view = fakeView()
    const doc = memoDoc(30, log)
    const { memoCaret } = doc
    doc.memoCaret = (thread) => {
      now += 40 // 100 ms fits three
      return memoCaret(thread)
    }
    const c = createController({ engine: engineOf(doc), view, storage: null })
    void c.load(bytesA)
    assert.equal(log.filter((line) => line.startsWith('caret')).length, 3)
    await until(() => states(view)[0].report?.threads.every((t) => t.page === 3) === true)
    c.dispose()
  } finally {
    performance.now = clock
  }
})

test('메모: 50개 이하면 더 찾지 않는다', async () => {
  const view = fakeView()
  const c = createController({ engine: engineOf(memoDoc(50)), view, storage: null })
  await c.load(bytesA)
  await pause(60)
  assert.equal(refreshes(view), 0)
  c.dispose()
})

test('메모: 찾는 사이 문서가 바뀌거나 닫히면 멈춘다', async () => {
  for (const end of ['load', 'dispose'] as const) {
    const log: string[] = []
    const view = fakeView()
    const c = createController({ engine: engineOf(memoDoc(120, log), fakeDoc('b', 3)), view, storage: null })
    await c.load(bytesA)
    if (end === 'load') await c.load(bytesB)
    else c.dispose()
    await pause(80)
    assert.equal(refreshes(view), 0, end)
    assert.equal(log.filter((line) => line.startsWith('caret')).length, 50, end)
    c.dispose()
  }
})

test('메모: memos()가 던지면 failed로 알리고 문서는 열린다', async () => {
  const doc = fakeDoc('a', 4)
  doc.memos = () => {
    throw new EngineError('engine', 'getMemos')
  }
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: null })
  await c.load(bytesA)
  assert.deepEqual(states(view), [{ report: null, failed: true, open: true }])
  assert.equal(view.last()?.kind, 'show')
  c.dispose()
})

test('메모: 쪽을 찾다 던져도 메모는 남는다', async () => {
  const doc = memoDoc(60)
  doc.memoCaret = () => {
    throw new Error('unreachable')
  }
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: null })
  await c.load(bytesA)
  assert.equal(states(view)[0].report?.threads.length, 60)
  assert.equal(states(view)[0].failed, false)
  assert.equal(view.last()?.kind, 'show')
  await pause(60)
  c.dispose()
})

test('메모: 저장된 memosClosed면 닫힌 채 연다', async () => {
  const storage = memoryStorage()
  saveView(storage, documentKey(bytesA), { page: 3, zoom: 1.5, memosClosed: true })
  const view = fakeView()
  const c = createController({ engine: engineOf(memoDoc(1)), view, storage })
  await c.load(bytesA)
  assert.equal(states(view)[0].open, false)
  // The page moves on; the list stays closed for the next time.
  c.remember({ page: 4, zoom: 1.5 })
  assert.deepEqual(loadView(storage, documentKey(bytesA)), { page: 4, zoom: 1.5, memosClosed: true })
  c.dispose()
})

test('메모: 여닫으면 보던 쪽과 함께 바로 저장한다', async () => {
  const storage = memoryStorage()
  saveView(storage, documentKey(bytesA), { page: 3, zoom: 1.5 })
  const c = createController({ engine: engineOf(memoDoc(1)), view: fakeView(), storage })
  await c.load(bytesA)
  c.rememberMemos(false)
  assert.deepEqual(loadView(storage, documentKey(bytesA)), { page: 3, zoom: 1.5, memosClosed: true })
  c.remember({ page: 6, zoom: 2 })
  c.rememberMemos(true)
  assert.deepEqual(loadView(storage, documentKey(bytesA)), { page: 6, zoom: 2 })
  c.dispose()
})

test('메모: 파일이 바뀌면 새 메모만 남고, 이번에 닫았으면 닫힌 채다', async () => {
  const storage = memoryStorage()
  const view = fakeView()
  const c = createController({ engine: engineOf(memoDoc(2), memoDoc(3), memoDoc(1)), view, storage })
  await c.load(bytesA)
  assert.equal(c.memo(2)?.number, 2)
  c.rememberMemos(false)
  await c.load(bytesB)
  assert.deepEqual(states(view).map((s) => [s.report?.threads.length, s.open]), [[2, true], [3, false]])
  assert.equal(c.memo(3), states(view)[1].report?.threads[2])
  c.rememberMemos(true)
  saveView(storage, documentKey(bytesA), { page: 0, zoom: 1, memosClosed: true })
  await c.load(bytesA)
  assert.equal(states(view)[2].open, true)
  assert.equal(c.memo(2), null)
  c.dispose()
  assert.equal(c.memo(1), null)
})

test('메모: 빈 한 쪽 문서라도 메모가 있거나 읽지 못했으면 안내로 가리지 않는다', async () => {
  const blank = () => onePage('<g clip-path="url(#body-clip-0)"></g>', [''])
  const withMemo = blank()
  withMemo.memos = () => ({ threads: [memoThread(1)], problems: [] })
  const withProblem = blank()
  withProblem.memos = () => ({ threads: [], problems: [{ code: 'bad-record', count: 1 }] })
  const unread = blank()
  unread.memos = () => {
    throw new EngineError('engine', 'getMemos')
  }
  for (const doc of [withMemo, withProblem, unread]) {
    const view = fakeView()
    const c = createController({ engine: engineOf(doc), view, storage: null })
    await c.load(bytesA)
    assert.equal(view.last()?.kind, 'show')
    c.dispose()
  }
})

test('메모: 저장된 닫힘으로 연 문서는 파일이 바뀌어도 닫힌 채다', async () => {
  const storage = memoryStorage()
  saveView(storage, documentKey(bytesA), { page: 0, zoom: 1, memosClosed: true })
  const view = fakeView()
  const c = createController({ engine: engineOf(memoDoc(2), memoDoc(3)), view, storage })
  await c.load(bytesA)
  await c.load(bytesB)
  assert.deepEqual(states(view).map((s) => s.open), [false, false])
  c.remember({ page: 1, zoom: 1 })
  assert.equal(loadView(storage, documentKey(bytesB))?.memosClosed, true)
  c.dispose()
})

test('메모: 열린 채 시작한 목록은 파일이 바뀌어도 열린 채고, 목록 없던 문서는 다음 문서의 기억을 막지 않는다', async () => {
  const storage = memoryStorage()
  saveView(storage, documentKey(bytesB), { page: 0, zoom: 1, memosClosed: true })
  const open = fakeView()
  const c = createController({ engine: engineOf(memoDoc(2), memoDoc(3)), view: open, storage })
  await c.load(bytesA)
  await c.load(bytesB)
  assert.deepEqual(states(open).map((s) => s.open), [true, true])
  c.dispose()
  const none = fakeView()
  const d = createController({ engine: engineOf(fakeDoc('none', 3), memoDoc(3)), view: none, storage })
  await d.load(bytesA)
  await d.load(bytesB)
  assert.deepEqual(states(none).map((s) => s.open), [true, false])
  d.dispose()
})
