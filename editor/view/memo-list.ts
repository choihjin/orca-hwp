// The memo list beside the pages, and the status bar button that opens and closes it. Everything
// that comes from the document is set as text, never as markup.
import { fullDate, placeLabel, problemText, shortDate, shownAnchorText } from '../engine/memo-threads.js'
import type { Memo, MemoReport, MemoThread } from '../engine/memo-threads.js'

export type MemoList = {
  show(report: MemoReport, open: boolean): void
  /** Marks the memo as chosen and brings it into view, opening a closed list. */
  select(number: number): void
  /** The pages or the highlights of the threads have changed. */
  refresh(): void
  /** The memos could not be read: no button and no list. The status bar says so. */
  fail(): void
  clear(): void
  /** False when there is no list to open or close. */
  toggle(): boolean
  isOpen(): boolean
}

type Item = { thread: MemoThread; button: HTMLButtonElement; anchor: HTMLElement }

/** Height of the page title that sticks to the top, CSS px (`scroll-margin-top` in the style sheet). */
const PAGE_TITLE = 28
/** Length of the date tooltip, in code points. */
const TOOLTIP_LIMIT = 128

/**
 * `m` without a modifier, not held down and not typed into anything. With a Hangul layout the same
 * key gives `ㅡ`.
 */
export function isMemoKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat || event.isComposing) {
    return false
  }
  const target = event.target as Partial<HTMLElement> | null | undefined
  if (target?.isContentEditable || ['input', 'textarea', 'select'].includes(target?.localName ?? '')) {
    return false
  }
  return event.key.toLowerCase() === 'm' || (event.code === 'KeyM' && event.key === 'ㅡ')
}

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className: string,
  ...content: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(name)
  el.className = className
  el.append(...content)
  return el
}

/** One line of plain text: without control characters and the ones that change text direction. */
function tooltip(text: string): string {
  const line = text
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  return Array.from(line).slice(0, TOOLTIP_LIMIT).join('')
}

export function createMemoList(options: {
  panel: HTMLElement
  button: HTMLElement
  now(): Date
  onPick(number: number): void
  onToggle(open: boolean): void
}): MemoList {
  const { panel, button, now, onPick, onToggle } = options
  let items: Item[] = []
  let problems: HTMLElement[] = []
  /** The pages of the items as last placed; the items stay put while it is the same. */
  let placed: string | null = null
  let open = false

  /** `1 · 검토자 가 · 11.20 · 표 칸` */
  function meta(memo: Memo, number: string, place: string): HTMLElement {
    const date = element('time', 'memo-date memo-own', shortDate(memo, now()))
    date.title = tooltip(fullDate(memo))
    const parts = [
      element('span', 'memo-number', number),
      element('span', 'memo-author memo-own', memo.author.trim() === '' ? '(작성자 없음)' : memo.author),
      date,
      element('span', 'memo-place', place)
    ].filter((part) => part.textContent !== '')
    return element('span', 'memo-meta', ...parts.flatMap((part, i) => (i > 0 ? [' · ', part] : [part])))
  }

  function text(memo: Memo): HTMLElement {
    const empty = memo.text === null || memo.text.trim() === ''
    return element('span', 'memo-text memo-own', empty ? '(내용 없음)' : String(memo.text))
  }

  function itemOf(thread: MemoThread): Item {
    const [first, ...rest] = thread.memos
    const anchor = element('span', 'memo-anchor memo-own', shownAnchorText(thread))
    const button = element(
      'button',
      'memo-item',
      meta(first, String(thread.number), placeLabel(thread.place)),
      anchor,
      text(first),
      ...rest.map((memo) => element('span', 'memo-more', meta(memo, '', ''), text(memo)))
    )
    button.type = 'button'
    button.dataset.number = String(thread.number)
    button.addEventListener('click', () => {
      select(thread.number)
      onPick(thread.number)
    })
    return { thread, button, anchor }
  }

  const topOf = (el: HTMLElement) => el.getBoundingClientRect().top - panel.getBoundingClientRect().top

  function isInView(el: HTMLElement, covered = 0): boolean {
    const r = el.getBoundingClientRect()
    const view = panel.getBoundingClientRect()
    return r.height > 0 && r.bottom > view.top + covered && r.top < view.bottom
  }

  /**
   * Scrolls with `scroll`. Items that were never on screen have a guessed height (the style sheet's
   * `content-visibility`); those that are now in view get their own, until none is left that could
   * still push the others away.
   */
  function settle(scroll: () => void): void {
    scroll()
    for (;;) {
      const guessed = items.filter(
        ({ button }) =>
          button.style.contentVisibility !== 'visible' &&
          button.firstElementChild?.checkVisibility({ contentVisibilityAuto: true }) === false &&
          isInView(button)
      )
      if (guessed.length === 0) {
        return
      }
      for (const { button } of guessed) {
        button.style.contentVisibility = 'visible'
      }
      scroll()
    }
  }

  function reveal(el: HTMLElement): void {
    const away = !isInView(el, PAGE_TITLE)
    settle(() => {
      // Of an item longer than the list its beginning, unless the reader is in the middle of it.
      const long = el.getBoundingClientRect().height > panel.getBoundingClientRect().height
      el.scrollIntoView({ block: away && long ? 'start' : 'nearest' })
    })
  }

  /** What stays where it is on screen when the items are placed anew: first what the reader is on. */
  function keeper(): HTMLElement | undefined {
    const buttons = items.map((item) => item.button)
    const on = [
      buttons.find((el) => el === document.activeElement),
      buttons.find((el) => el.getAttribute('aria-current') !== null)
    ].find((el) => el && isInView(el))
    return on ?? (panel.scrollTop > 0 ? buttons.find((el) => topOf(el) >= 0 && isInView(el)) : undefined)
  }

  /** The items by page, those without a page last, then what could not be read. */
  function place(): void {
    const pages = [...new Set(items.map(({ thread }) => thread.page))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity))
    const order = items.map(({ thread }) => thread.page).join()
    const turned = items.filter(({ thread, anchor }) => anchor.hidden !== (thread.located || anchor.textContent === ''))
    if (order === placed && turned.length === 0) {
      return
    }
    const kept = placed !== null && open ? keeper() : undefined
    const keptTop = kept ? topOf(kept) : 0
    for (const { anchor } of turned) {
      anchor.hidden = !anchor.hidden
    }
    if (order !== placed) {
      placed = order
      const focused = items.find((item) => item.button === document.activeElement)
      const next = pages.flatMap((page) => [
        element('h2', 'memo-page', page === null ? '위치 미상' : `${page}쪽`),
        ...items.filter(({ thread }) => thread.page === page).map((item) => item.button)
      ])
      arrange([...next, ...problems])
      if (focused && document.activeElement !== focused.button) {
        focused.button.focus({ preventScroll: true })
      }
    }
    if (kept) {
      settle(() => {
        panel.scrollTop += topOf(kept) - keptTop
      })
    }
  }

  /** Makes these the panel's children, moving only those that are not in their place. */
  function arrange(next: HTMLElement[]): void {
    const stay = new Set<Element>(next)
    for (const child of Array.from(panel.children)) {
      if (!stay.has(child)) {
        child.remove()
      }
    }
    let at = panel.firstElementChild
    for (const el of next) {
      if (el === at) {
        at = at.nextElementSibling
      } else {
        panel.insertBefore(el, at)
      }
    }
  }

  function setOpen(next: boolean): void {
    open = next
    if (!open && panel.contains(document.activeElement)) {
      button.focus()
    }
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }

  function toggle(): boolean {
    if (button.hidden) {
      return false
    }
    setOpen(!open)
    onToggle(open)
    return true
  }

  function select(number: number): void {
    const chosen = items.find(({ thread }) => thread.number === number)
    if (!chosen) {
      return
    }
    if (!open) {
      toggle()
    }
    for (const { button } of items) {
      button.removeAttribute('aria-current')
    }
    chosen.button.setAttribute('aria-current', 'true')
    reveal(chosen.button)
  }

  function clear(): void {
    items = []
    problems = []
    placed = null
    button.hidden = true
    setOpen(false)
    panel.replaceChildren()
  }

  button.addEventListener('click', toggle)
  panel.addEventListener('focusin', ({ target }) => {
    const item = items.find(({ button }) => button === target)
    // Not for a mouse: a scroll between press and release would lose the click.
    if (item?.button.matches(':focus-visible')) {
      reveal(item.button)
    }
  })

  return {
    show(report, startOpen) {
      clear()
      if (report.threads.length === 0 && report.problems.length === 0) {
        return
      }
      items = report.threads.map(itemOf)
      problems = report.problems.map((problem) => element('p', 'memo-problem', problemText(problem)))
      button.textContent = `메모 ${items.length}`
      button.hidden = false
      setOpen(startOpen)
      place()
      panel.scrollTop = 0
    },
    select,
    refresh: place,
    fail: clear,
    clear,
    toggle,
    isOpen: () => open
  }
}
