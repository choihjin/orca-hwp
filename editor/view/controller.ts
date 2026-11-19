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

/** Elements that put ink on the page. A page-sized white `<rect>` is the paper, not ink. */
const INK = /<(image|path|line|polyline|polygon|circle|ellipse|use|rect)\b([^>]*)>/g

function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(tag)?.[1] ?? null
}

function isPaper(tagAttrs: string, width: number, height: number): boolean {
  const num = (name: string, fallback: number) => {
    const v = attr(tagAttrs, name)
    return v === null ? fallback : parseFloat(v)
  }
  const fill = (attr(tagAttrs, 'fill') ?? '#ffffff').trim().toLowerCase()
  return (
    Math.abs(num('x', 0)) < 0.5 &&
    Math.abs(num('y', 0)) < 0.5 &&
    Math.abs(num('width', -1) - width) < 0.5 &&
    Math.abs(num('height', -1) - height) < 0.5 &&
    ['#fff', '#ffffff', 'white', 'none'].includes(fill)
  )
}

/**
 * True when page `i` shows nothing: no text run with visible characters and, outside `<defs>`,
 * no text content and no drawing element other than the white page background. Design: a
 * document with no pages or only an empty body gets a notice, not a blank sheet.
 */
export function isBlankPage(doc: EngineDocument, i: number): boolean {
  try {
    if (doc.pageTextRuns(i).some((run) => run.text.trim() !== '')) {
      return false
    }
    const svg = doc.renderPageSvg(i).replace(/<defs\b[\s\S]*?<\/defs>/g, '')
    const rootTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
    const width = parseFloat(attr(rootTag, 'width') ?? 'NaN')
    const height = parseFloat(attr(rootTag, 'height') ?? 'NaN')
    for (const m of svg.matchAll(INK)) {
      if (!(m[1] === 'rect' && isPaper(m[2], width, height))) {
        return false
      }
    }
    // Character data left once tags are gone is text drawn on the page.
    return svg.replace(/<[^>]*>/g, '').trim() === ''
  } catch {
    // Let the view try and report the page itself.
    return false
  }
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
    // Synchronous inside; the Promise is the interface the plan fixed.
    async load(bytes) {
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
      if (doc.pageCount <= 0 || (doc.pageCount === 1 && isBlankPage(doc, 0))) {
        doc.dispose()
        view.showError('empty')
        return
      }
      current = doc
      // Everything up to the first draw is synchronous: an `orca plugin shot` taken on the first
      // paint after the document arrives must already see the remembered page (design 5.3).
      let page = 0
      let zoom: number | undefined
      try {
        key = documentKey(bytes)
        const saved = loadView(storage, key)
        if (saved) {
          page = Number.isInteger(saved.page) && saved.page >= 0 && saved.page < doc.pageCount ? saved.page : 0
          zoom = Number.isFinite(saved.zoom) && saved.zoom > 0 ? saved.zoom : undefined
        }
      } catch (error) {
        console.warn(`[hwp-viewer] remembered view unavailable: ${String(error)}`)
      }
      view.showDocument(doc, page, zoom ?? 1)
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
      release()
      view.clear()
    }
  }
}
