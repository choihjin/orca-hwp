import { assert, test } from 'orca/testing'
import { EngineError } from '../engine/rhwp-adapter.js'
import type { EngineDocument } from '../engine/rhwp-adapter.js'
import { documentKey, loadView, saveView } from '../state/view-memory'
import { existsSync, readFileSync } from 'node:fs'
import { initEngine, openDocument } from '../engine/rhwp-adapter.js'
import { createController, isBlankPage } from './controller'
import type { ErrorCode, ViewPort } from './controller'

type FakeDoc = EngineDocument & { disposed: number; name: string }

function fakeDoc(name: string, pageCount: number): FakeDoc {
  const doc: FakeDoc = {
    name,
    disposed: 0,
    pageCount,
    pageSize: () => ({ width: 794, height: 1123 }),
    renderPageSvg: (i) => `<svg xmlns="http://www.w3.org/2000/svg" data-page="${i}"/>`,
    pageTextRuns: () => [],
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
  const c = createController({ engine: engineOf(doc), view: fakeView(), storage, saveDelayMs: 5 })
  await c.load(bytesA)
  c.remember({ page: 6, zoom: 1.25 })
  c.remember({ page: 7, zoom: 1.25 })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(loadView(storage, documentKey(bytesA)), { page: 7, zoom: 1.25 })
  c.dispose()
})

test('dispose는 남은 기억을 바로 저장하고 화면을 비운다', async () => {
  const storage = memoryStorage()
  const view = fakeView()
  const c = createController({ engine: engineOf(fakeDoc('a', 10)), view, storage, saveDelayMs: 10_000 })
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
