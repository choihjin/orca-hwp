// Opens documents and decides what the view shows. No DOM here, so node tests can drive it.
import { EngineError } from '../engine/rhwp-adapter.js'
import type { EngineDocument, EngineErrorCode } from '../engine/rhwp-adapter.js'
import { locateThreads } from '../engine/memo-locate.js'
import type { MemoReport, MemoThread } from '../engine/memo-threads.js'
import { documentKey, loadView, saveView } from '../state/view-memory'

export type ErrorCode = EngineErrorCode | 'empty'

/** The memos of a document; `report` is null when they could not be read. */
export type MemoState = { report: MemoReport | null; failed: boolean; open: boolean }

/**
 * What the controller asks of the screen. `zoom` is a multiplier on the fit-to-width scale
 * (1 = page width fits the window); leaving it out keeps the view's current zoom.
 */
export type ViewPort = {
  /** Always right before `showDocument`: whether there is a list decides the size of the pages. */
  prepareMemos(state: MemoState): void
  /** More of the threads given to `prepareMemos` have their page now. */
  refreshMemos(): void
  showDocument(doc: EngineDocument, startPage: number, zoom?: number): void
  showError(code: ErrorCode, detail?: string): void
  clear(): void
}

export type ViewState = { page: number; zoom: number }

export type Controller = {
  load(bytes: Uint8Array): Promise<void>
  /** The page in the middle of the screen or the zoom changed; saved after a short pause. */
  remember(view: ViewState): void
  /** The reader opened or closed the memo list; saved at once. */
  rememberMemos(open: boolean): void
  /** The thread with this number in the open document. */
  memo(number: number): MemoThread | null
  dispose(): void
}

/** Threads whose page is looked up at a time: about 2 to 5 ms each. */
const MEMO_BATCH = 50
/** How long one batch may take, ms: a long paragraph makes each caret slow. The first batch runs
 *  before the first paint, so it is short enough for the paint to wait for it. */
const MEMO_BUDGET = 100
/** Between the batches, ms: lets the first paint and scrolling happen. */
const MEMO_PAUSE = 16

/** Elements that put ink on the page. Only the engine's paper (see `isPaper`) is not ink. */
const INK = /<(image|path|line|polyline|polygon|circle|ellipse|use|rect)\b([^>]*)>/g

function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(tag)?.[1] ?? null
}

function isPaper(tagAttrs: string, width: number, height: number): boolean {
  const num = (name: string, fallback: number) => {
    const v = attr(tagAttrs, name)
    return v === null ? fallback : parseFloat(v)
  }
  const fill = (attr(tagAttrs, 'fill') ?? '').trim().toLowerCase()
  const stroke = (attr(tagAttrs, 'stroke') ?? 'none').trim().toLowerCase()
  return (
    stroke === 'none' &&
    attr(tagAttrs, 'transform') === null &&
    Math.abs(num('x', 0)) < 0.5 &&
    Math.abs(num('y', 0)) < 0.5 &&
    Math.abs(num('width', -1) - width) < 0.5 &&
    Math.abs(num('height', -1) - height) < 0.5 &&
    ['#fff', '#ffffff', 'white'].includes(fill)
  )
}

/**
 * True when page `i` shows nothing: no text run with visible characters and, outside `<defs>`,
 * no text content and no drawing element other than the paper. The paper is the engine's first
 * element: a top-level, page-sized white `<rect>` at 0,0 with no stroke and no transform. Any
 * other rect (a page-sized frame with a border, a second white sheet) is content. Design: a
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
    let body = svg.slice(svg.indexOf(rootTag) + rootTag.length)
    const height = parseFloat(attr(rootTag, 'height') ?? 'NaN')
    const first = /^\s*<rect\b([^>]*)>/.exec(body)
    if (first && isPaper(first[1], width, height)) {
      body = body.slice(first[0].length)
    }
    if (body.search(INK) !== -1) {
      return false
    }
    // Character data left once tags are gone is text drawn on the page.
    return body.replace(/<[^>]*>/g, '').trim() === ''
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
}): Controller {
  const { engine, view, storage } = deps
  let current: EngineDocument | null = null
  let key: string | null = null
  let threads: MemoThread[] = []
  let shown: ViewState = { page: 0, zoom: 1 }
  let memosOpen = true
  /** How the list was first restored or the reader left it since; holds when the open file changes. */
  let chosenOpen: boolean | null = null

  function release(): void {
    key = null
    threads = []
    if (current) {
      const doc = current
      current = null
      doc.dispose()
    }
  }

  function save(): void {
    if (current && key) {
      saveView(storage, key, memosOpen ? shown : { ...shown, memosClosed: true })
    }
  }

  function readMemos(doc: EngineDocument): MemoReport | null {
    try {
      return doc.memos()
    } catch (error) {
      console.error(`[hwp-viewer] memos: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /** Finds the pages of the next memos, within the time limit; returns the ones left. */
  function locate(doc: EngineDocument, rest: MemoThread[]): MemoThread[] {
    const some = rest.slice(0, MEMO_BATCH)
    try {
      const done = locateThreads(doc, some, { verify: false, deadline: performance.now() + MEMO_BUDGET })
      return rest.slice(done)
    } catch (error) {
      // The memos are still listed, without a page.
      console.warn(`[hwp-viewer] memo pages: ${String(error)}`)
      return rest.slice(some.length)
    }
  }

  function locateLater(doc: EngineDocument, rest: MemoThread[]): void {
    if (rest.length === 0) {
      return
    }
    setTimeout(() => {
      if (current !== doc) {
        return
      }
      const left = locate(doc, rest)
      view.refreshMemos()
      locateLater(doc, left)
    }, MEMO_PAUSE)
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
      const report = readMemos(doc)
      const noMemos = report !== null && report.threads.length === 0 && report.problems.length === 0
      // The notice about an empty document must not hide memos.
      if (doc.pageCount <= 0 || (doc.pageCount === 1 && noMemos && isBlankPage(doc, 0))) {
        doc.dispose()
        view.showError('empty')
        return
      }
      current = doc
      // Everything up to the first draw is synchronous: an `orca plugin shot` taken on the first
      // paint after the document arrives must already see the remembered page (design 5.3).
      let page = 0
      let zoom: number | undefined
      let closed = false
      try {
        key = documentKey(bytes)
        const saved = loadView(storage, key)
        if (saved) {
          page = Number.isInteger(saved.page) && saved.page >= 0 && saved.page < doc.pageCount ? saved.page : 0
          zoom = Number.isFinite(saved.zoom) && saved.zoom > 0 ? saved.zoom : undefined
          closed = saved.memosClosed === true
        }
      } catch (error) {
        console.warn(`[hwp-viewer] remembered view unavailable: ${String(error)}`)
      }
      shown = { page, zoom: zoom ?? 1 }
      memosOpen = chosenOpen ?? !closed
      if (closed || (report !== null && !noMemos)) {
        chosenOpen = memosOpen
      }
      threads = report?.threads ?? []
      const left = locate(doc, threads)
      view.prepareMemos({ report, failed: report === null, open: memosOpen })
      view.showDocument(doc, page, zoom ?? 1)
      locateLater(doc, left)
    },
    remember(state) {
      // Written at once: onViewChange fires only when the page or zoom changes, and an
      // `orca plugin shot` closes the editor right after it paints, with no pagehide guaranteed.
      shown = { page: state.page, zoom: state.zoom }
      save()
    },
    rememberMemos(open) {
      chosenOpen = open
      memosOpen = open
      save()
    },
    memo(number) {
      return threads.find((thread) => thread.number === number) ?? null
    },
    dispose() {
      release()
      view.clear()
    }
  }
}
