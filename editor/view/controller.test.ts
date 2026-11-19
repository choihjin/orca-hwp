import { assert, test } from 'orca/testing'
import { EngineError } from '../engine/rhwp-adapter.js'
import type { EngineDocument } from '../engine/rhwp-adapter.js'
import { documentKey, loadView, saveView } from '../state/view-memory'
import { createController } from './controller'
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
  saveView(storage, await documentKey(bytesA), { page: 3, zoom: 1.5 })
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

test('첫 쪽은 기억을 찾기 전에 동기로 보낸다', () => {
  const doc = fakeDoc('a', 10)
  const view = fakeView()
  const c = createController({ engine: engineOf(doc), view, storage: memoryStorage() })
  void c.load(bytesA)
  // Nothing awaited yet: the view must already have the document (capture timing, design 5.3).
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

test('앞 문서의 늦은 기억이 새 문서를 덮지 않는다', async () => {
  const storage = memoryStorage()
  saveView(storage, await documentKey(bytesA), { page: 2, zoom: 1 })
  const a = fakeDoc('a', 4)
  const b = fakeDoc('b', 5)
  const view = fakeView()
  const c = createController({ engine: engineOf(a, b), view, storage })
  const first = c.load(bytesA)
  const second = c.load(bytesB)
  await Promise.all([first, second])
  assert.ok(!view.calls.some((call) => call.kind === 'show' && call.doc === a && call.page === 2))
  const last = view.last()
  assert.equal(last?.kind === 'show' && last.doc, b)
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
  saveView(storage, await documentKey(bytesA), { page: 99, zoom: 1 })
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
  assert.deepEqual(loadView(storage, await documentKey(bytesA)), { page: 7, zoom: 1.25 })
  c.dispose()
})

test('dispose는 남은 기억을 바로 저장하고 화면을 비운다', async () => {
  const storage = memoryStorage()
  const view = fakeView()
  const c = createController({ engine: engineOf(fakeDoc('a', 10)), view, storage, saveDelayMs: 10_000 })
  await c.load(bytesA)
  c.remember({ page: 4, zoom: 1 })
  c.dispose()
  assert.deepEqual(loadView(storage, await documentKey(bytesA)), { page: 4, zoom: 1 })
  assert.equal(view.last()?.kind, 'clear')
})
