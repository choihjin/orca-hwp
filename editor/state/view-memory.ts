// Remembers the last page and zoom per document in the frame's localStorage (design 5.7 P1), so
// a reopened document, and an agent reopening it, lands where the last reader left it.

export type View = { page: number; zoom: number }

const PREFIX = 'hwp-viewer:view:'
const MAX_ENTRIES = 200
const SAMPLE = 64 * 1024

type Entry = View & { seq: number }

/**
 * SHA-256 hex of the length plus the first and last 64 KiB. Reading the whole file is not worth
 * it for a key: two different documents with the same length, head and tail are not expected.
 */
export async function documentKey(bytes: Uint8Array): Promise<string> {
  const head = bytes.subarray(0, Math.min(SAMPLE, bytes.length))
  const tail = bytes.subarray(Math.max(0, bytes.length - SAMPLE))
  const input = new Uint8Array(8 + head.length + tail.length)
  new DataView(input.buffer).setBigUint64(0, BigInt(bytes.length), true)
  input.set(head, 8)
  input.set(tail, 8 + head.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
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
    return { page: value.page, zoom: value.zoom, seq: typeof seq === 'number' ? seq : 0 }
  } catch {
    return null
  }
}

/** `page` counts from 0, like the engine. Returns null when nothing valid is stored. */
export function loadView(storage: Storage | null, key: string): View | null {
  if (!storage) return null
  try {
    const entry = readEntry(storage, PREFIX + key)
    return entry ? { page: entry.page, zoom: entry.zoom } : null
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
    const entry: Entry = { page: view.page, zoom: view.zoom, seq }
    storage.setItem(PREFIX + key, JSON.stringify(entry))
    entries.sort((a, b) => a.seq - b.seq)
    for (const old of entries.slice(0, Math.max(0, entries.length + 1 - MAX_ENTRIES))) {
      storage.removeItem(old.storageKey)
    }
  } catch {
    // storage blocked or full: remembering the view is best effort
  }
}
