// Remembers the last page and zoom per document in the frame's localStorage (design 5.7 P1), so
// a reopened document, and an agent reopening it, lands where the last reader left it.

/** `memosClosed` is there only when the reader has closed the memo list of this document. */
export type View = { page: number; zoom: number; memosClosed?: boolean }

const PREFIX = 'hwp-viewer:view:'
const MAX_ENTRIES = 200
const SAMPLE = 64 * 1024

type Entry = View & { seq: number }

/**
 * FNV-1a 64-bit over `bytes`, read forwards or backwards, with the 64-bit multiply done in two
 * 32-bit halves (prime 2^40 + 0x1b3) so it needs no BigInt.
 */
function fnv1a64(bytes: Uint8Array, hi: number, lo: number, backwards: boolean): string {
  const n = bytes.length
  for (let k = 0; k < n; k++) {
    lo = (lo ^ bytes[backwards ? n - 1 - k : k]) >>> 0
    const p = lo * 0x1b3 // < 2^41, exact
    const carry = Math.floor(p / 0x100000000)
    hi = (hi * 0x1b3 + carry + ((lo << 8) >>> 0)) >>> 0
    lo = p >>> 0
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0')
}

/**
 * A 128-bit hex key from the length plus the first and last 64 KiB: two FNV-1a 64 lanes, one
 * read forwards and one backwards. Synchronous on purpose, so the viewer can find the
 * remembered page inside the document callback and draw that page first. Not cryptographic;
 * two different documents with the same length, head and tail are not expected.
 */
export function documentKey(bytes: Uint8Array): string {
  const head = bytes.subarray(0, Math.min(SAMPLE, bytes.length))
  const tail = bytes.subarray(Math.max(0, bytes.length - SAMPLE))
  const input = new Uint8Array(8 + head.length + tail.length)
  new DataView(input.buffer).setBigUint64(0, BigInt(bytes.length), true)
  input.set(head, 8)
  input.set(tail, 8 + head.length)
  // FNV-1a 64 offset basis 0xcbf29ce484222325; the second lane uses a different basis.
  return fnv1a64(input, 0xcbf29ce4, 0x84222325, false) + fnv1a64(input, 0x6c62272e, 0x07bb0142, true)
}

function isView(value: unknown): value is View {
  if (typeof value !== 'object' || value === null) return false
  const { page, zoom } = value as Record<string, unknown>
  return (
    typeof page === 'number' &&
    Number.isInteger(page) &&
    page >= 0 &&
    typeof zoom === 'number' &&
    Number.isFinite(zoom) &&
    zoom > 0
  )
}

function readEntry(storage: Storage, storageKey: string): Entry | null {
  const raw = storage.getItem(storageKey)
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isView(value)) return null
    const seq = (value as { seq?: unknown }).seq
    return { ...viewOf(value), seq: typeof seq === 'number' ? seq : 0 }
  } catch {
    return null
  }
}

/** The view's own fields, without a `memosClosed` that is not a boolean. */
function viewOf({ page, zoom, memosClosed }: View): View {
  return typeof memosClosed === 'boolean' ? { page, zoom, memosClosed } : { page, zoom }
}

/** `page` counts from 0, like the engine. Returns null when nothing valid is stored. */
export function loadView(storage: Storage | null, key: string): View | null {
  if (!storage) return null
  try {
    const entry = readEntry(storage, PREFIX + key)
    return entry ? viewOf(entry) : null
  } catch {
    return null
  }
}

/**
 * Saves the view as the newest entry and keeps at most 200 documents, dropping the ones saved
 * longest ago. A missing or failing storage (blocked, full) is ignored.
 */
export function saveView(storage: Storage | null, key: string, view: View): void {
  if (!storage || !isView(view)) return
  try {
    const entries: { storageKey: string; seq: number }[] = []
    for (let i = 0; i < storage.length; i++) {
      const storageKey = storage.key(i)
      if (storageKey === null || !storageKey.startsWith(PREFIX) || storageKey === PREFIX + key) continue
      entries.push({ storageKey, seq: readEntry(storage, storageKey)?.seq ?? 0 })
    }
    const seq = entries.reduce((max, e) => Math.max(max, e.seq), 0) + 1
    const entry: Entry = { ...viewOf(view), seq }
    storage.setItem(PREFIX + key, JSON.stringify(entry))
    entries.sort((a, b) => a.seq - b.seq)
    for (const old of entries.slice(0, Math.max(0, entries.length + 1 - MAX_ENTRIES))) {
      storage.removeItem(old.storageKey)
    }
  } catch {
    // storage blocked or full: remembering the view is best effort
  }
}
