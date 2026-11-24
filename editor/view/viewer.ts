// The page view: continuous scroll, fit-to-width zoom, pages drawn as sanitized inline SVG only
// near the screen. Pages far away keep a sized placeholder so the scroll height stays right.
import { locateThreads } from '../engine/memo-locate.js'
import { memoMarks } from '../engine/memo-marks.js'
import type { AnchorRun, MemoMark } from '../engine/memo-marks.js'
import type { MemoThread } from '../engine/memo-threads.js'
import type { EngineDocument } from '../engine/rhwp-adapter.js'
import { sanitizeSvg } from '../render/sanitize.js'
import type { ErrorCode, ViewPort, ViewState } from './controller'
import { renderError } from './errors'
import type { MemoList } from './memo-list'
import { pageLayout, pagesToRender } from './page-window'
import type { StatusBar } from './status-bar'

/** Space between pages and around them, in CSS px. pageLayout starts the first page at 0, so
 *  the content is offset by one GAP at the top and padded by one at the bottom. */
const GAP = 16
/** Extra height drawn above and below the screen, in screens (pagesToRender takes pixels). */
const OVERSCAN_SCREENS = 1
/** Drawn pages this far outside the drawn range are dropped from the DOM. */
const KEEP = 2
/** Pages drawn per task while filling the screen, so scrolling stays responsive. */
const PAGES_PER_TICK = 2
/** Zoom steps as multipliers on fit-to-width. */
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
const SVG_NS = 'http://www.w3.org/2000/svg'
/** The number beside a highlight, in page px: a pill this high, and how far it reaches below the
 *  top of the line. The rest is above it, between the lines. */
const BADGE_HEIGHT = 12
const BADGE_OVERLAP = 3
const BADGE_DIGIT = 6

type Layout = ReturnType<typeof pageLayout>

export type Viewer = ViewPort & {
  goTo(page: number): void
  /** Goes to the memo's page and marks its text as chosen; does nothing without a page. */
  showMemo(thread: MemoThread): void
  zoomStep(direction: 1 | -1): void
  zoomReset(): void
  /** Handles a viewer key; returns true when it used it. */
  handleKey(event: KeyboardEvent): boolean
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}:${text.length}`
}

function svgElement(name: string, attributes: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, name) as SVGElement
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, String(value))
  }
  return el
}

const markClass = (selected: boolean) => (selected ? 'memo-mark selected' : 'memo-mark')

/**
 * The highlights of a page, to lie over its SVG with the same `viewBox`. The list says the same to
 * the keyboard and to screen readers.
 */
function markOverlay(
  page: { viewBox: string; width: number },
  marks: MemoMark[],
  selected: number | null,
  onPick: (number: number) => void
): SVGElement {
  const overlay = svgElement('svg', { class: 'memo-marks', viewBox: page.viewBox, 'aria-hidden': 'true' })
  const badges: { x: number; y: number; right: number }[] = []
  for (const { number, rects, badge } of marks) {
    const group = svgElement('g', { class: markClass(number === selected), 'data-number': number })
    const width = BADGE_HEIGHT + BADGE_DIGIT * (String(number).length - 1)
    const y = Math.max(0, badge.y + BADGE_OVERLAP - BADGE_HEIGHT)
    let x = badge.x
    // Beside the numbers that are already there: two memos can end at one place.
    for (const other of badges) {
      if (Math.abs(other.y - y) < BADGE_HEIGHT && other.x < x + width && x < other.right) {
        x = other.right + 1
      }
    }
    x = Math.max(0, Math.min(x, page.width - width))
    badges.push({ x, y, right: x + width })
    const label = svgElement('text', { class: 'memo-badge-number', x: x + width / 2, y: y + BADGE_HEIGHT / 2 })
    label.textContent = String(number)
    group.append(
      ...rects.map((r) => svgElement('rect', { class: 'memo-rect', x: r.x, y: r.y, width: r.w, height: r.h })),
      svgElement('rect', { class: 'memo-badge', x, y, width, height: BADGE_HEIGHT, rx: BADGE_HEIGHT / 2 }),
      label
    )
    group.addEventListener('click', () => onPick(number))
    overlay.append(group)
  }
  return overlay
}

export function createViewer(options: {
  container: HTMLElement
  status: StatusBar
  onViewChange(view: ViewState): void
  /** The reader clicked the highlight or the number of this memo. */
  onMemoPick?(number: number): void
  memoList?: Pick<MemoList, 'show' | 'refresh' | 'fail' | 'clear'>
}): Viewer {
  const { container, status, onViewChange, onMemoPick, memoList } = options
  const root = document.documentElement
  const parser = new DOMParser()
  const fontStyle = document.createElement('style')
  fontStyle.id = 'page-fonts'
  document.head.append(fontStyle)
  const fontKeys = new Set<string>()

  let doc: EngineDocument | null = null
  let sizes: { width: number; height: number }[] = []
  let maxWidth = 0
  let zoom = 1
  let scale = 1
  let layout: Layout = { tops: [], heights: [], total: 0 }
  let slots: HTMLDivElement[] = []
  let pagesEl: HTMLDivElement | null = null
  const drawn = new Set<number>()
  const failed = new Set<number>()
  let current = 0
  let typed = ''
  /**
   * A page chosen explicitly (opening, End, a typed number) stays current while the scroll
   * position is the one we set. Near the end the scroll top is capped, so the chosen page may
   * not reach the top of the screen and the line test in `pageAtScroll` would pick an earlier
   * page; only a real scroll away from `pinTop` hands control back to it. `fraction` is how far
   * into the page it was shown: more than 0 only for a memo further down.
   */
  let pin: { page: number; top: number; fraction: number } | null = null
  let tickTimer: ReturnType<typeof setTimeout> | null = null

  let threads: MemoThread[] = []
  /** Threads that were looked for on the layout of their page. */
  const confirmed = new Set<MemoThread>()
  let selected: number | null = null
  const overlays = new Map<number, SVGElement>()
  const anchorRuns = new Map<number, AnchorRun[]>()

  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(() => schedule(), { root: container, rootMargin: '50% 0px' })
      : null

  function setRenderState(state: 'loading' | 'done' | 'error' | 'empty'): void {
    root.dataset.renderState = state
  }

  function paintStatus(): void {
    status.update({
      page: current,
      pageCount: doc ? doc.pageCount : 0,
      zoomPercent: Math.round(scale * 100),
      errorPages: failed.size,
      typed,
      message: ''
    })
  }

  function addFontFaces(faces: string[]): void {
    for (const css of faces) {
      const key = fnv1a(css)
      if (!fontKeys.has(key)) {
        fontKeys.add(key)
        fontStyle.append(document.createTextNode(`${css}\n`))
      }
    }
  }

  function showPageError(i: number, error: unknown): void {
    const slot = slots[i]
    const box = document.createElement('div')
    box.className = 'page-error'
    box.textContent = `${i + 1}쪽을 그리지 못했습니다.`
    slot.replaceChildren(box)
    failed.add(i)
    console.error(`[hwp-viewer] page ${i + 1}: ${error instanceof Error ? error.message : String(error)}`)
  }

  function runsOf(i: number): AnchorRun[] {
    let runs = anchorRuns.get(i)
    if (!runs) {
      try {
        runs = doc ? doc.pageAnchorRuns(i) : []
      } catch (error) {
        console.warn(`[hwp-viewer] page ${i + 1} text layout: ${String(error)}`)
        runs = []
      }
      anchorRuns.set(i, runs)
    }
    return runs
  }

  /**
   * Looks for the threads of these pages on the layout, once each. Returns the pages whose marks
   * that can change: a thread may turn out to start one page before or after.
   */
  function confirmOn(pages: Iterable<number>): Set<number> {
    const changed = new Set(pages)
    const fresh = threads.filter((t) => t.caret && changed.has(t.caret.page) && !confirmed.has(t))
    if (!doc || fresh.length === 0) {
      return changed
    }
    locateThreads({ pageCount: doc.pageCount, memoCaret: (t) => t.caret, pageAnchorRuns: runsOf }, fresh, { verify: true })
    for (const thread of fresh) {
      confirmed.add(thread)
      if (thread.caret) {
        changed.add(thread.caret.page)
      }
    }
    memoList?.refresh()
    return changed
  }

  /** What to highlight on a page; the layout is read only when a memo starts there. */
  function marksOn(i: number): MemoMark[] {
    const here = threads.filter((t) => t.caret?.page === i)
    return here.length > 0 ? memoMarks(here, runsOf(i), i) : []
  }

  /** Puts the highlights over these pages, as far as they are drawn. */
  function paintMarks(pages: Iterable<number>): void {
    for (const i of pages) {
      overlays.get(i)?.remove()
      overlays.delete(i)
      const marks = drawn.has(i) && !failed.has(i) ? marksOn(i) : []
      if (marks.length > 0) {
        const viewBox = slots[i].children[0].getAttribute('viewBox') ?? ''
        const overlay = markOverlay({ viewBox, width: sizes[i].width }, marks, selected, pickMemo)
        slots[i].append(overlay)
        overlays.set(i, overlay)
      }
    }
  }

  /** The pages stay readable whatever goes wrong with their highlights. */
  function showMarks(pages: Iterable<number>): void {
    try {
      paintMarks(confirmOn(pages))
    } catch (error) {
      console.warn(`[hwp-viewer] memo highlights: ${String(error)}`)
    }
  }

  function selectMemo(number: number): void {
    selected = number
    for (const overlay of overlays.values()) {
      for (const group of Array.from(overlay.children)) {
        group.setAttribute('class', markClass(group.getAttribute('data-number') === String(number)))
      }
    }
  }

  function pickMemo(number: number): void {
    selectMemo(number)
    onMemoPick?.(number)
  }

  function setThreads(next: MemoThread[], unread: boolean): void {
    threads = next
    confirmed.clear()
    selected = null
    status.update({ memosFailed: unread })
  }

  function clearMemos(): void {
    setThreads([], false)
    memoList?.clear()
  }

  function drawPage(i: number): void {
    if (!doc || drawn.has(i)) {
      return
    }
    drawn.add(i)
    try {
      const result = sanitizeSvg(doc.renderPageSvg(i), `p${i}-`)
      addFontFaces(result.fontFaces)
      for (const warning of result.warnings) {
        console.warn(`[hwp-viewer] page ${i + 1}: ${warning}`)
      }
      const parsed = parser.parseFromString(result.svg, 'image/svg+xml')
      const svg = parsed.documentElement
      if (svg.namespaceURI !== SVG_NS || svg.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length) {
        throw new Error('the sanitized SVG did not parse')
      }
      if (!svg.hasAttribute('viewBox')) {
        const w = parseFloat(svg.getAttribute('width') ?? '') || sizes[i].width
        const h = parseFloat(svg.getAttribute('height') ?? '') || sizes[i].height
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      }
      slots[i].replaceChildren(document.importNode(svg, true))
      failed.delete(i)
    } catch (error) {
      showPageError(i, error)
      return
    }
    showMarks([i])
  }

  function dropPage(i: number): void {
    drawn.delete(i)
    overlays.delete(i)
    slots[i].replaceChildren()
  }

  function viewportWidth(): number {
    return container.clientWidth || window.innerWidth || 800
  }

  /** Recomputes sizes and positions; keeps `anchor` (page, fraction into it) at the top. */
  function relayout(anchor?: { page: number; fraction: number }): void {
    if (!doc || !pagesEl) {
      return
    }
    const fit = maxWidth > 0 ? Math.max(0.05, (viewportWidth() - 2 * GAP) / maxWidth) : 1
    scale = fit * zoom
    layout = pageLayout(sizes, scale, GAP)
    const contentWidth = Math.max(viewportWidth(), maxWidth * scale + 2 * GAP)
    pagesEl.style.width = `${contentWidth}px`
    pagesEl.style.height = `${layout.total + 2 * GAP}px`
    for (let i = 0; i < slots.length; i++) {
      const w = sizes[i].width * scale
      const s = slots[i].style
      s.top = `${layout.tops[i] + GAP}px`
      s.height = `${layout.heights[i]}px`
      s.width = `${w}px`
      s.left = `${(contentWidth - w) / 2}px`
    }
    if (anchor) {
      const p = Math.min(Math.max(anchor.page, 0), slots.length - 1)
      container.scrollTop = Math.max(0, layout.tops[p] + anchor.fraction * layout.heights[p])
      container.scrollLeft = Math.max(0, (contentWidth - viewportWidth()) / 2)
      if (pin) {
        // Read back: the browser caps scrollTop at the bottom of the content.
        pin.top = container.scrollTop
      }
    }
  }

  /**
   * Pins `page` as current and scrolls it (or the place `fraction` into it) to the top of the
   * screen, as far as scrolling allows.
   */
  function showPageAtTop(page: number, fraction = 0): void {
    pin = { page, top: 0, fraction }
    current = page
    relayout({ page, fraction })
    drawVisible()
    // Design 5.3: the start page and the one after it, even when a short screen shows one.
    if (doc && page + 1 < doc.pageCount) {
      drawPage(page + 1)
    }
  }

  function isOnScreen(page: number): boolean {
    const y = layout.tops[page] + GAP
    const top = container.scrollTop
    return y + layout.heights[page] > top && y < top + container.clientHeight
  }

  /**
   * After a zoom or resize: a pinned page must still be on screen. If the new layout and the
   * scroll cap moved it off, the pin goes and the page actually on screen becomes current.
   * Returns true when `current` changed.
   */
  function reconcilePin(): boolean {
    if (!pin) {
      return false
    }
    if (isOnScreen(pin.page)) {
      pin.top = container.scrollTop
      return false
    }
    pin = null
    const page = pageAtScroll()
    if (page === current) {
      return false
    }
    current = page
    return true
  }

  /** Draws, in this task, every page the screen shows at the actual (capped) scroll top. */
  function drawVisible(): void {
    drawPage(current)
    const { first, last } = pagesToRender(layout, container.scrollTop - GAP, container.clientHeight, 0)
    for (let i = first; i <= last; i++) {
      drawPage(i)
    }
  }

  function currentAnchor(): { page: number; fraction: number } {
    if (!layout.tops.length) {
      return { page: 0, fraction: 0 }
    }
    if (pin) {
      // A pinned page is meant to sit at the top. Near the end the scroll cap keeps it lower,
      // and the fraction measured there is negative and grows with the zoom, which would push
      // the page off screen; anchor the place asked for and let the cap apply again.
      return { page: pin.page, fraction: pin.fraction }
    }
    const h = layout.heights[current] || 1
    return { page: current, fraction: (container.scrollTop - layout.tops[current]) / h }
  }

  /** The page under the line a third of the way down the screen. */
  function pageAtScroll(): number {
    const { tops } = layout
    if (!tops.length) {
      return 0
    }
    const line = container.scrollTop - GAP + container.clientHeight / 3
    let lo = 0
    let hi = tops.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (tops[mid] <= line) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return lo
  }

  function schedule(): void {
    if (tickTimer === null && doc) {
      // setTimeout, not requestAnimationFrame: Orca captures editors from a hidden window too.
      tickTimer = setTimeout(tick, 0)
    }
  }

  function tick(): void {
    tickTimer = null
    if (!doc) {
      return
    }
    const height = container.clientHeight
    const { first, last } = pagesToRender(layout, container.scrollTop - GAP, height, height * OVERSCAN_SCREENS)
    const order: number[] = []
    for (let i = first; i <= last; i++) {
      if (!drawn.has(i)) {
        order.push(i)
      }
    }
    // Nearest to the current page first.
    order.sort((a, b) => Math.abs(a - current) - Math.abs(b - current))
    for (const i of order.slice(0, PAGES_PER_TICK)) {
      drawPage(i)
    }
    const missing = order.length > PAGES_PER_TICK
    for (const i of [...drawn]) {
      if (i < first - KEEP || i > last + KEEP) {
        dropPage(i)
      }
    }
    for (const i of [...anchorRuns.keys()]) {
      if (!drawn.has(i)) {
        anchorRuns.delete(i)
      }
    }
    paintStatus()
    if (missing) {
      schedule()
    } else if (root.dataset.renderState === 'loading') {
      setRenderState('done')
    }
  }

  function onScroll(): void {
    if (!doc) {
      return
    }
    if (pin) {
      if (Math.abs(container.scrollTop - pin.top) < 1) {
        // Our own scroll (or none): the chosen page stays current.
        schedule()
        return
      }
      pin = null
    }
    const page = pageAtScroll()
    if (page !== current) {
      current = page
      paintStatus()
      onViewChange({ page: current, zoom })
    }
    schedule()
  }

  container.addEventListener('scroll', onScroll, { passive: true })
  if (typeof ResizeObserver === 'function') {
    let lastWidth = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    // Relayout outside the observer callback: changing the page sizes inside it can resize the
    // container again (scroll bars) and trips Chromium's "ResizeObserver loop" error.
    new ResizeObserver(() => {
      if (resizeTimer !== null) {
        return
      }
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        const w = viewportWidth()
        if (doc && w !== lastWidth) {
          lastWidth = w
          relayout(currentAnchor())
          if (reconcilePin()) {
            onViewChange({ page: current, zoom })
          }
          paintStatus()
        }
        schedule()
      }, 0)
    }).observe(container)
  }

  function reset(): void {
    if (tickTimer !== null) {
      clearTimeout(tickTimer)
      tickTimer = null
    }
    observer?.disconnect()
    doc = null
    sizes = []
    maxWidth = 0
    slots = []
    pagesEl = null
    drawn.clear()
    failed.clear()
    overlays.clear()
    anchorRuns.clear()
    current = 0
    pin = null
    zoom = 1
    typed = ''
    layout = { tops: [], heights: [], total: 0 }
    fontKeys.clear()
    fontStyle.replaceChildren()
    container.replaceChildren()
    container.scrollTop = 0
  }

  function goTo(page: number): void {
    if (!doc) {
      return
    }
    const p = Math.min(Math.max(page, 0), doc.pageCount - 1)
    showPageAtTop(p)
    paintStatus()
    onViewChange({ page: current, zoom })
    schedule()
  }

  function showMemo(thread: MemoThread): void {
    if (!doc || thread.page === null) {
      return
    }
    selectMemo(thread.number)
    // Before going there: the layout may show that the memo starts one page before or after.
    showMarks([thread.page - 1])
    const page = Math.min(Math.max(thread.page - 1, 0), doc.pageCount - 1)
    const mark = marksOn(page).find((m) => m.number === thread.number)
    const spot = mark?.rects[0] ?? mark?.badge ?? thread.caret
    const y = GAP + (spot?.y ?? 0) * scale
    // A third of the way down the screen, or the top of the page when the text is near it.
    showPageAtTop(page, Math.max(0, (y - container.clientHeight / 3) / (layout.heights[page] || 1)))
    const x = parseFloat(slots[page].style.left) + (spot?.x ?? 0) * scale
    if (spot && spot.x !== null && (x < container.scrollLeft || x > container.scrollLeft + container.clientWidth * 0.9)) {
      container.scrollLeft = Math.max(0, x - container.clientWidth / 3)
    }
    paintStatus()
    onViewChange({ page: current, zoom })
    schedule()
  }

  function setZoom(next: number): void {
    if (!doc) {
      return
    }
    const z = Math.min(Math.max(next, ZOOM_STEPS[0]), ZOOM_STEPS[ZOOM_STEPS.length - 1])
    if (z === zoom) {
      return
    }
    const anchor = currentAnchor()
    zoom = z
    relayout(anchor)
    reconcilePin()
    drawVisible()
    paintStatus()
    onViewChange({ page: current, zoom })
    schedule()
  }

  const viewer: Viewer = {
    prepareMemos({ report, failed: unread, open }) {
      setThreads(report?.threads ?? [], unread)
      if (report) {
        memoList?.show(report, open)
      } else {
        memoList?.fail()
      }
    },
    refreshMemos() {
      showMarks([...drawn].filter((i) => !failed.has(i)))
      memoList?.refresh()
    },
    showDocument(next, startPage, nextZoom) {
      if (next !== doc) {
        reset()
        doc = next
        sizes = []
        for (let i = 0; i < next.pageCount; i++) {
          let size = { width: 794, height: 1123 }
          try {
            const s = next.pageSize(i)
            if (s.width > 0 && s.height > 0) {
              size = s
            }
          } catch (error) {
            console.warn(`[hwp-viewer] page ${i + 1} size: ${String(error)}`)
          }
          sizes.push(size)
          maxWidth = Math.max(maxWidth, size.width)
        }
        pagesEl = document.createElement('div')
        pagesEl.className = 'pages'
        slots = sizes.map((_, i) => {
          const slot = document.createElement('div')
          slot.className = 'page'
          slot.dataset.page = String(i)
          pagesEl?.append(slot)
          observer?.observe(slot)
          return slot
        })
        container.replaceChildren(pagesEl)
      }
      if (nextZoom !== undefined && Number.isFinite(nextZoom) && nextZoom > 0) {
        zoom = Math.min(Math.max(nextZoom, ZOOM_STEPS[0]), ZOOM_STEPS[ZOOM_STEPS.length - 1])
      }
      const start = Math.min(Math.max(startPage, 0), next.pageCount - 1)
      setRenderState('loading')
      // Drawn in this task, so the first paint after the document arrives shows every page on
      // screen, the start page included even when the scroll cap keeps it low (design 5.3).
      showPageAtTop(start)
      paintStatus()
      schedule()
    },
    showError(code: ErrorCode, detail?: string) {
      reset()
      clearMemos()
      status.update({ page: 0, pageCount: 0, errorPages: 0, typed: '', message: '' })
      renderError(container, code, detail)
      setRenderState(code === 'empty' ? 'empty' : 'error')
    },
    clear() {
      reset()
      clearMemos()
      status.update({ page: 0, pageCount: 0, errorPages: 0, typed: '' })
    },
    goTo,
    showMemo,
    zoomStep(direction) {
      const i = ZOOM_STEPS.findIndex((z) => z >= zoom - 1e-9)
      const at = i === -1 ? ZOOM_STEPS.length - 1 : i
      const exact = Math.abs(ZOOM_STEPS[at] - zoom) < 1e-9
      const target = direction > 0 ? (exact ? at + 1 : at) : at - 1
      setZoom(ZOOM_STEPS[Math.min(Math.max(target, 0), ZOOM_STEPS.length - 1)])
    },
    zoomReset() {
      setZoom(1)
    },
    handleKey(event) {
      if (!doc || event.metaKey || event.ctrlKey || event.altKey) {
        return false
      }
      const k = event.key
      if (/^[0-9]$/.test(k) && (typed || k !== '0')) {
        typed = (typed + k).slice(0, 6)
        paintStatus()
      } else if (k === 'Enter' && typed) {
        const page = parseInt(typed, 10) - 1
        typed = ''
        goTo(page)
      } else if (k === 'Backspace' && typed) {
        typed = typed.slice(0, -1)
        paintStatus()
      } else if (k === 'Escape' && typed) {
        typed = ''
        paintStatus()
      } else if (k === 'PageDown') {
        goTo(current + 1)
      } else if (k === 'PageUp') {
        goTo(current - 1)
      } else if (k === 'Home') {
        goTo(0)
      } else if (k === 'End') {
        goTo(doc.pageCount - 1)
      } else if (k === '+' || k === '=') {
        viewer.zoomStep(1)
      } else if (k === '-' || k === '_') {
        viewer.zoomStep(-1)
      } else if (k === '0') {
        viewer.zoomReset()
      } else {
        return false
      }
      return true
    }
  }
  return viewer
}
