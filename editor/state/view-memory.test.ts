import { assert, test } from 'orca/testing'
import { documentKey, loadView, saveView } from './view-memory.ts'

/** In-memory `Storage` for tests. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  keys(): string[] {
    return [...this.map.keys()]
  }
}

/** A `Storage` whose every method throws, like a frame with storage blocked. */
const throwingStorage = new Proxy({} as Storage, {
  get() {
    throw new Error('storage blocked')
  }
})

test('documentKey is a synchronous 128-bit hex string that depends on the bytes', () => {
  const a = new Uint8Array(200_000).map((_, i) => i % 251)
  const key = documentKey(a)
  assert.equal(typeof key, 'string')
  assert.match(key, /^[0-9a-f]{32}$/)
  assert.equal(documentKey(a.slice()), key)
  const head = a.slice()
  head[0] ^= 1
  const tail = a.slice()
  tail[tail.length - 1] ^= 1
  const middleOfTail = a.slice()
  middleOfTail[a.length - 40_000] ^= 0x80
  assert.notEqual(documentKey(head), key)
  assert.notEqual(documentKey(tail), key)
  assert.notEqual(documentKey(middleOfTail), key)
  assert.notEqual(documentKey(a.slice(0, a.length - 1)), key)
})

test('documentKey matches FNV-1a 64 and separates small files', () => {
  // FNV-1a 64 of the 8-byte little-endian length 0 is the forward lane of the empty file's key
  const zeros = new Uint8Array(8)
  let h = 0xcbf29ce484222325n
  for (const b of zeros) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn
  assert.equal(documentKey(new Uint8Array(0)).slice(0, 16), h.toString(16).padStart(16, '0'))
  assert.notEqual(documentKey(new Uint8Array([1, 2, 3])), documentKey(new Uint8Array([1, 2, 4])))
  assert.notEqual(documentKey(new Uint8Array([1, 2, 3])), documentKey(new Uint8Array([3, 2, 1])))
})

test('saveView and loadView round-trip under the hwp-viewer:view: prefix', () => {
  const storage = new MemoryStorage()
  assert.equal(loadView(storage, 'k1'), null)
  saveView(storage, 'k1', { page: 3, zoom: 1.25 })
  assert.deepEqual(loadView(storage, 'k1'), { page: 3, zoom: 1.25 })
  assert.ok(storage.keys().every((k) => k.startsWith('hwp-viewer:view:')))
  saveView(storage, 'k1', { page: 4, zoom: 1 })
  assert.deepEqual(loadView(storage, 'k1'), { page: 4, zoom: 1 })
  assert.equal(storage.length, 1)
})

test('the 201st document removes the oldest; saving again makes an entry new', () => {
  const storage = new MemoryStorage()
  storage.setItem('other-plugin-key', 'keep me')
  for (let i = 0; i < 200; i++) saveView(storage, `k${i}`, { page: i, zoom: 1 })
  saveView(storage, 'k0', { page: 0, zoom: 2 }) // k0 is now the newest, k1 the oldest
  saveView(storage, 'k200', { page: 200, zoom: 1 })
  assert.equal(loadView(storage, 'k1'), null)
  assert.deepEqual(loadView(storage, 'k0'), { page: 0, zoom: 2 })
  assert.deepEqual(loadView(storage, 'k200'), { page: 200, zoom: 1 })
  assert.equal(storage.keys().filter((k) => k.startsWith('hwp-viewer:view:')).length, 200)
  assert.equal(storage.getItem('other-plugin-key'), 'keep me')
})

test('missing or throwing storage is ignored quietly', () => {
  assert.equal(loadView(null, 'k'), null)
  saveView(null, 'k', { page: 1, zoom: 1 })
  assert.equal(loadView(throwingStorage, 'k'), null)
  saveView(throwingStorage, 'k', { page: 1, zoom: 1 })
})

test('damaged or invalid entries load as null', () => {
  const storage = new MemoryStorage()
  for (const raw of ['not json', '{"page":-1,"zoom":1}', '{"page":1.5,"zoom":1}', '{"page":1,"zoom":0}', '{"page":1}', 'null']) {
    storage.setItem('hwp-viewer:view:k', raw)
    assert.equal(loadView(storage, 'k'), null, raw)
  }
  saveView(storage, 'bad', { page: Number.NaN, zoom: 1 })
  assert.equal(loadView(storage, 'bad'), null)
})
