// Opens documents and decides what the view shows. No DOM here, so node tests can drive it.
import { EngineError } from '../engine/rhwp-adapter.js'
import type { EngineDocument, EngineErrorCode } from '../engine/rhwp-adapter.js'
import { documentKey, loadView, saveView } from '../state/view-memory'

export type ErrorCode = EngineErrorCode | 'empty'

/**
 * What the controller asks of the screen. `zoom` is a multiplier on the fit-to-width scale
 * (1 = page width fits the window); leaving it out keeps the view's current zoom.
 */
export type ViewPort = {
  showDocument(doc: EngineDocument, startPage: number, zoom?: number): void
  showError(code: ErrorCode, detail?: string): void
  clear(): void
}

export type ViewState = { page: number; zoom: number }

export type Controller = {
  load(bytes: Uint8Array): Promise<void>
  /** The page in the middle of the screen or the zoom changed; saved after a short pause. */
  remember(view: ViewState): void
  dispose(): void
}

const ENGINE_CODES: readonly string[] = ['not-hangul', 'encrypted', 'corrupt', 'unsupported', 'engine']

export function createController(deps: {
  engine: { open(bytes: Uint8Array): EngineDocument }
  view: ViewPort
  storage: Storage | null
  /** Wait after the last `remember` before writing it; default 500 ms. */
  saveDelayMs?: number
}): Controller {
  const { engine, view, storage } = deps
  const saveDelayMs = deps.saveDelayMs ?? 500
  let generation = 0
  let current: EngineDocument | null = null
  let key: string | null = null
  let pending: ViewState | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending && key) {
      saveView(storage, key, pending)
    }
    pending = null
  }

  function release(): void {
    flush()
    key = null
    if (current) {
      const doc = current
      current = null
      doc.dispose()
    }
  }

  return {
    async load(bytes) {
      const mine = ++generation
      if (current) {
        // Drop the view's hold on the old document before it is freed.
        view.clear()
      }
      release()
      let doc: EngineDocument
      try {
        doc = engine.open(bytes)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code =
          error instanceof EngineError && ENGINE_CODES.includes(error.code) ? error.code : 'engine'
        view.showError(code, message)
        return
      }
      if (doc.pageCount <= 0) {
        doc.dispose()
        view.showError('empty')
        return
      }
      current = doc
      // Shown before anything is awaited: an `orca plugin shot` taken on the first paint after
      // the document arrives must already see a page (design 5.3). The remembered page needs an
      // async hash, so it follows as a second call.
      view.showDocument(doc, 0)

      let docKey: string
      try {
        docKey = await documentKey(bytes)
      } catch {
        return
      }
      if (mine !== generation) {
        return
      }
      key = docKey
      const saved = loadView(storage, docKey)
      if (!saved) {
        return
      }
      const page =
        Number.isInteger(saved.page) && saved.page >= 0 && saved.page < doc.pageCount ? saved.page : 0
      const zoom = Number.isFinite(saved.zoom) && saved.zoom > 0 ? saved.zoom : 1
      if (page !== 0 || zoom !== 1) {
        view.showDocument(doc, page, zoom)
      }
    },
    remember(state) {
      if (!current) {
        return
      }
      pending = { page: state.page, zoom: state.zoom }
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(flush, saveDelayMs)
    },
    dispose() {
      generation++
      release()
      view.clear()
    }
  }
}
