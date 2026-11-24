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
  toggle(): void
  isOpen(): boolean
}

type Item = { thread: MemoThread; button: HTMLButtonElement; anchor: HTMLElement }

/** `m` without a modifier, not held down. With a Hangul layout the same key gives `ㅡ`. */
export function isMemoKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) {
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
    date.title = fullDate(memo)
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

  /** The items by page, those without a page last, then what could not be read. */
  function place(): void {
    const pages = [...new Set(items.map(({ thread }) => thread.page))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity))
    const order = items.map(({ thread }) => thread.page).join()
    for (const { thread, anchor } of items) {
      anchor.hidden = thread.located || anchor.textContent === ''
    }
    if (order === placed) {
      return
    }
    placed = order
    const focused = document.activeElement
    const { scrollTop } = panel
    panel.replaceChildren(
      ...pages.flatMap((page) => [
        element('h2', 'memo-page', page === null ? '위치 미상' : `${page}쪽`),
        ...items.filter(({ thread }) => thread.page === page).map((item) => item.button)
      ]),
      ...problems
    )
    panel.scrollTop = scrollTop
    items.find((item) => item.button === focused)?.button.focus({ preventScroll: true })
  }

  function setOpen(next: boolean): void {
    open = next
    if (!open && panel.contains(document.activeElement)) {
      button.focus()
    }
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }

  function toggle(): void {
    if (!button.hidden) {
      setOpen(!open)
      onToggle(open)
    }
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
    chosen.button.scrollIntoView({ block: 'nearest' })
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
