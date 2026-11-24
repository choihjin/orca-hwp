// Memo list tests in Node with a small stand-in DOM, kept inside this file. It has no innerHTML:
// setting it throws, so document text can only arrive as text. The children of a scroller are
// stacked by their `height`; one that was never laid out counts as `guess` high, as with
// `content-visibility: auto`.
import { assert, test } from 'orca/testing'
import type { Memo, MemoProblem, MemoReport, MemoThread } from '../engine/memo-threads.js'
import { createMemoList, isMemoKey } from './memo-list'

class FakeElement {
  childNodes: (FakeElement | string)[] = []
  parent: FakeElement | null = null
  dataset: Record<string, string> = {}
  className = ''
  id = ''
  title = ''
  type = ''
  hidden = false
  scrollTop = 0
  scrolledIntoView = 0
  style: Record<string, string> = {}
  height = 20
  guess: number | null = null
  private attrs = new Map<string, string>()
  private listeners: [string, () => void][] = []
  constructor(readonly localName: string, private dom: FakeDom) {}
  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement)
  }
  get textContent(): string {
    return this.childNodes.map((c) => (typeof c === 'string' ? c : c.textContent)).join('')
  }
  set textContent(text: string) {
    this.replaceChildren(text)
  }
  set innerHTML(_: string) {
    throw new Error('innerHTML must not be used')
  }
  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (node instanceof FakeElement) {
        node.remove()
        node.parent = this
      }
      this.childNodes.push(node)
    }
  }
  remove(): void {
    if (this.parent) {
      if (this.contains(this.dom.activeElement)) this.dom.activeElement = this.dom.body
      this.parent.childNodes = this.parent.childNodes.filter((c) => c !== this)
      this.parent = null
    }
  }
  replaceChildren(...nodes: (FakeElement | string)[]): void {
    for (const child of this.children) child.remove()
    this.childNodes = []
    this.scrollTop = 0 // an emptied scroller is back at its top
    this.append(...nodes)
  }
  insertBefore(node: FakeElement, before: FakeElement | null): void {
    if (node === before) return
    node.remove()
    node.parent = this
    const at = before ? this.childNodes.indexOf(before) : this.childNodes.length
    this.childNodes.splice(at, 0, node)
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null
  }
  get nextElementSibling(): FakeElement | null {
    const all = this.parent?.children ?? []
    return all[all.indexOf(this) + 1] ?? null
  }
  get laidOut(): boolean {
    return this.guess === null || this.style.contentVisibility === 'visible'
  }
  get shownHeight(): number {
    const anchorLine = this.children.some((c) => c.className.startsWith('memo-anchor') && !c.hidden) ? 10 : 0
    return this.laidOut || this.guess === null ? this.height + anchorLine : this.guess
  }
  checkVisibility(): boolean {
    return this.parent?.laidOut ?? true
  }
  getBoundingClientRect(): { top: number; bottom: number; height: number } {
    if (this.hidden || this.parent?.hidden) return { top: 0, bottom: 0, height: 0 }
    let top = 0
    if (this.parent) {
      const all = this.parent.children
      top = all.slice(0, all.indexOf(this)).reduce((sum, c) => sum + c.shownHeight, 0) - this.parent.scrollTop
    }
    return { top, bottom: top + this.shownHeight, height: this.shownHeight }
  }
  contains(other: FakeElement | null): boolean {
    for (let at = other; at; at = at.parent) if (at === this) return true
    return false
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners.push([type, fn])
  }
  click(): void {
    for (const [type, fn] of this.listeners) if (type === 'click') fn()
  }
  focus(): void {
    this.dom.activeElement = this
  }
  /** As the browser does for a Tab key: focus, then the bubbling event. */
  focusByKey(): void {
    this.focus()
    this.parent?.fire('focusin', this)
  }
  matches(selector: string): boolean {
    return selector === ':focus-visible' && this.dom.keyboard
  }
  fire(type: string, target: FakeElement): void {
    for (const [name, fn] of this.listeners) if (name === type) (fn as (e: unknown) => void)({ target })
  }
  scrollIntoView({ block }: { block?: string } = {}): void {
    this.scrolledIntoView++
    if (!this.parent) return
    const { top, bottom } = this.getBoundingClientRect()
    const below = bottom - this.parent.height
    const tall = bottom - top > this.parent.height
    if (block === 'start') this.parent.scrollTop += top
    else if (top < 0 && below < 0) this.parent.scrollTop += tall ? below : top
    else if (top > 0 && below > 0) this.parent.scrollTop += tall ? top : below
  }
  all(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.all()])
  }
  byClass(name: string): FakeElement[] {
    return this.all().filter((e) => e.className.split(' ').includes(name))
  }
}

class FakeDom {
  keyboard = true
  body: FakeElement = new FakeElement('body', this)
  activeElement: FakeElement = this.body
  createElement = (name: string) => new FakeElement(name, this)
}

const NOW = new Date('2026-11-24T03:00:00Z')

function memo(over: Partial<Memo> = {}): Memo {
  return { author: '검토자 가', date: '2026-11-20T08:24:04Z', dateText: null, text: '내용', ...over }
}

function thread(number: number, over: Partial<MemoThread> = {}): MemoThread {
  return {
    number,
    page: 1,
    located: true,
    place: 'body',
    anchorText: '예산',
    paragraphText: '예산 낱말',
    multiParagraph: false,
    memos: [memo()],
    anchor: null,
    caret: null,
    ...over
  }
}

function report(threads: MemoThread[], problems: MemoProblem[] = []): MemoReport {
  return { threads, problems }
}

function setup() {
  const dom = new FakeDom()
  const g = globalThis as Record<string, unknown>
  g.document = dom
  const panel = new FakeElement('aside', dom)
  const button = new FakeElement('button', dom)
  panel.hidden = true
  panel.height = 100
  button.hidden = true
  const picked: number[] = []
  const toggled: boolean[] = []
  const list = createMemoList({
    panel: panel as unknown as HTMLElement,
    button: button as unknown as HTMLElement,
    now: () => NOW,
    onPick: (n) => picked.push(n),
    onToggle: (open) => toggled.push(open)
  })
  return { dom, panel, button, list, picked, toggled }
}

/** The list as lines: page titles, and the numbers of the memos under them. */
function outline(panel: FakeElement): string[] {
  return panel.children.flatMap((el) =>
    el.className === 'memo-page' ? [el.textContent] : el.localName === 'button' ? [`#${el.dataset.number}`] : []
  )
}

const item = (panel: FakeElement, number: number) =>
  panel.children.find((el) => el.dataset.number === String(number)) as FakeElement

test('쪽별로 묶고 쪽 없는 묶음은 맨 끝 위치 미상에 둔다', () => {
  const { panel, list } = setup()
  list.show(
    report([
      thread(1, { page: 2 }),
      thread(2, { page: null, located: false }),
      thread(3, { page: 1 }),
      thread(4, { page: 2 }),
      thread(5, { page: 12 })
    ]),
    true
  )
  assert.deepEqual(outline(panel), ['1쪽', '#3', '2쪽', '#1', '#4', '12쪽', '#5', '위치 미상', '#2'])
})

test('항목은 버튼이고 번호 · 작성자 · 날짜와 본문, 같은 글의 다른 메모까지 담는다', () => {
  const { panel, list } = setup()
  list.show(
    report([
      thread(1, {
        memos: [memo({ text: '첫 줄\n둘째 줄' }), memo({ author: '작성자 나', date: '2025-01-02T03:00:00Z', text: '답' })]
      })
    ]),
    true
  )
  const el = item(panel, 1)
  assert.equal(el.localName, 'button')
  assert.equal(el.type, 'button')
  assert.deepEqual(el.byClass('memo-meta').map((m) => m.textContent), ['1 · 검토자 가 · 11.20', '작성자 나 · 2025.01.02'])
  assert.deepEqual(el.byClass('memo-text').map((m) => m.textContent), ['첫 줄\n둘째 줄', '답'])
})

test('날짜를 모르면 원문을, 그것도 없으면 아무것도 적지 않는다', () => {
  const { panel, list } = setup()
  list.show(
    report([
      thread(1, { memos: [memo({ date: null, dateText: '어느 날' })] }),
      thread(2, { memos: [memo({ date: null, dateText: null })] })
    ]),
    true
  )
  assert.equal(item(panel, 1).byClass('memo-meta')[0].textContent, '1 · 검토자 가 · 어느 날')
  assert.equal(item(panel, 2).byClass('memo-meta')[0].textContent, '2 · 검토자 가')
})

test('본문이 아닌 곳은 그 이름을 적는다', () => {
  const { panel, list } = setup()
  list.show(report([thread(1, { place: 'tableCell' }), thread(2, { place: 'footnote' }), thread(3)]), true)
  assert.deepEqual(
    [1, 2, 3].map((n) => item(panel, n).byClass('memo-meta')[0].textContent),
    ['1 · 검토자 가 · 11.20 · 표 칸', '2 · 검토자 가 · 11.20 · 각주', '3 · 검토자 가 · 11.20']
  )
})

test('강조하지 못한 묶음은 기준 글을 글로 적고, 찾으면 감춘다', () => {
  const { panel, list } = setup()
  const t = thread(1, { located: false, anchorText: '바탕 글' })
  const empty = thread(2, { located: false, anchorText: '' })
  list.show(report([t, empty]), true)
  const shown = (n: number) => item(panel, n).byClass('memo-anchor').filter((a) => !a.hidden).map((a) => a.textContent)
  assert.deepEqual(shown(1), ['바탕 글'])
  assert.deepEqual(shown(2), [])
  t.located = true
  list.refresh()
  assert.deepEqual(shown(1), [])
})

test('잘린 기준 글은 …으로 끝난다', () => {
  const { panel, list } = setup()
  const anchor = {
    sectionIndex: 0, ownerParaIndex: 0, paraIndex: 0, path: null, startCharIdx: 0, endCharIdx: 9, text: '잘린', start: 0
  }
  list.show(report([thread(1, { located: false, anchorText: '잘린', anchor })]), true)
  assert.equal(item(panel, 1).byClass('memo-anchor')[0].textContent, '잘린…')
})

test('작성자가 없으면 (작성자 없음), 본문이 없거나 비면 (내용 없음)', () => {
  const { panel, list } = setup()
  list.show(
    report([
      thread(1, { memos: [memo({ author: '', text: null })] }),
      thread(2, { memos: [memo({ author: ' ', text: '' }), memo({ text: ' \n' })] })
    ]),
    true
  )
  assert.equal(item(panel, 1).byClass('memo-meta')[0].textContent, '1 · (작성자 없음) · 11.20')
  assert.deepEqual(item(panel, 1).byClass('memo-text').map((m) => m.textContent), ['(내용 없음)'])
  assert.equal(item(panel, 2).byClass('memo-meta')[0].textContent, '2 · (작성자 없음) · 11.20')
  assert.deepEqual(item(panel, 2).byClass('memo-text').map((m) => m.textContent), ['(내용 없음)', '(내용 없음)'])
})

test('작성자·본문·기준 글·날짜의 마크업은 글자 그대로다', () => {
  const { panel, list } = setup()
  const evil = '<img src=x onerror=1>'
  list.show(
    report([thread(1, { located: false, anchorText: evil, memos: [memo({ author: evil, text: evil, date: null, dateText: evil })] })]),
    true
  )
  const el = item(panel, 1)
  assert.equal(el.byClass('memo-author')[0].textContent, evil)
  assert.equal(el.byClass('memo-text')[0].textContent, evil)
  assert.equal(el.byClass('memo-anchor')[0].textContent, evil)
  assert.equal(el.byClass('memo-date')[0].textContent, evil)
  assert.ok(el.all().every((e) => e.localName !== 'img'))
})

test('버튼 글은 묶음 수이고, 열림 상태를 알린다', () => {
  const { panel, button, list } = setup()
  list.show(report([thread(1, { memos: [memo(), memo()] }), thread(2)]), true)
  assert.equal(button.textContent, '메모 2')
  assert.equal(button.hidden, false)
  assert.equal(panel.hidden, false)
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.equal(list.isOpen(), true)
})

test('메모도 문제도 없으면 버튼과 목록이 숨고 여닫기도 없다', () => {
  const { panel, button, list, toggled } = setup()
  list.show(report([]), true)
  assert.equal(button.hidden, true)
  assert.equal(panel.hidden, true)
  assert.equal(panel.childNodes.length, 0)
  assert.equal(list.isOpen(), false)
  list.toggle()
  assert.equal(panel.hidden, true)
  assert.deepEqual(toggled, [])
})

test('문제가 있으면 메모가 없어도 버튼을 보이고 목록 끝에 적는다', () => {
  const { panel, button, list } = setup()
  list.show(report([], [{ code: 'bad-record' }, { code: 'missing-memo', count: 3 }]), true)
  assert.equal(button.hidden, false)
  assert.equal(button.textContent, '메모 0')
  assert.deepEqual(panel.byClass('memo-problem').map((p) => p.textContent), ['읽지 못한 메모 기록이 있음', '메모 3개를 읽지 못함'])
  list.show(report([thread(1, { page: null })], [{ code: 'bad-record' }]), true)
  assert.deepEqual(panel.byClass('memo-problem').map((p) => p.textContent), ['읽지 못한 메모 기록이 있음'])
  assert.equal(panel.children[panel.children.length - 1].className, 'memo-problem')
})

test('닫힌 채 시작하고, 버튼과 toggle이 여닫으며 알린다', () => {
  const { panel, button, list, toggled } = setup()
  list.show(report([thread(1)]), false)
  assert.equal(panel.hidden, true)
  assert.equal(button.hidden, false)
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  button.click()
  assert.equal(panel.hidden, false)
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  list.toggle()
  assert.equal(panel.hidden, true)
  assert.deepEqual(toggled, [true, false])
})

test('초점이 목록 안에 있을 때 닫으면 초점은 버튼으로 간다', () => {
  const { dom, panel, button, list } = setup()
  list.show(report([thread(1)]), true)
  item(panel, 1).focus()
  list.toggle()
  assert.equal(dom.activeElement, button)
  list.toggle()
  dom.body.focus()
  list.toggle()
  assert.equal(dom.activeElement, dom.body)
})

test('항목을 누르면 선택되고 번호를 알린다', () => {
  const { panel, list, picked } = setup()
  list.show(report([thread(1), thread(2)]), true)
  item(panel, 2).click()
  item(panel, 1).click()
  assert.deepEqual(picked, [2, 1])
  assert.equal(item(panel, 1).getAttribute('aria-current'), 'true')
  assert.equal(item(panel, 2).getAttribute('aria-current'), null)
})

test('select는 알리지 않고 그 항목을 보이게 스크롤하며, 닫힌 목록은 연다', () => {
  const { panel, list, picked, toggled } = setup()
  list.show(report([thread(1), thread(2)]), true)
  list.select(2)
  assert.equal(item(panel, 2).getAttribute('aria-current'), 'true')
  assert.equal(item(panel, 2).scrolledIntoView, 1)
  assert.deepEqual(picked, [])
  list.select(99)
  assert.equal(item(panel, 2).getAttribute('aria-current'), 'true')
  list.toggle()
  list.select(1)
  assert.equal(panel.hidden, false)
  assert.deepEqual(toggled, [false, true])
  assert.equal(item(panel, 1).scrolledIntoView, 1)
})

test('refresh는 바뀐 쪽으로 옮기되 선택·초점·스크롤을 지킨다', () => {
  const { dom, panel, list } = setup()
  const t = thread(1, { page: null })
  list.show(report([t, thread(2)]), true)
  list.select(1)
  item(panel, 1).focus()
  panel.scrollTop = 120
  t.page = 3
  list.refresh()
  assert.deepEqual(outline(panel), ['1쪽', '#2', '3쪽', '#1'])
  assert.equal(item(panel, 1).getAttribute('aria-current'), 'true')
  assert.equal(dom.activeElement, item(panel, 1))
  assert.equal(panel.scrollTop, 120)
})

test('refresh는 쪽이 그대로면 항목을 다시 놓지 않는다', () => {
  const { panel, list } = setup()
  const t = thread(1, { located: false })
  list.show(report([t]), true)
  const before = panel.childNodes
  t.located = true
  list.refresh()
  assert.equal(panel.childNodes, before)
})

test('새 문서를 보이면 이전 메모와 선택과 스크롤이 사라진다', () => {
  const { panel, button, list } = setup()
  list.show(report([thread(1), thread(2)]), true)
  list.select(2)
  panel.scrollTop = 50
  list.show(report([thread(1), thread(2), thread(3)]), true)
  assert.equal(button.textContent, '메모 3')
  assert.ok(panel.children.every((el) => el.getAttribute('aria-current') === null))
  assert.equal(panel.scrollTop, 0)
})

test('fail과 clear는 버튼과 목록을 숨기고 비운다', () => {
  for (const end of ['fail', 'clear'] as const) {
    const { panel, button, list } = setup()
    list.show(report([thread(1)]), true)
    list[end]()
    assert.equal(button.hidden, true)
    assert.equal(panel.hidden, true)
    assert.equal(panel.childNodes.length, 0)
    assert.equal(list.isOpen(), false)
    list.refresh()
    list.toggle()
    assert.equal(panel.hidden, true)
  }
})

test('m 키: 수식 키가 없을 때, 한글 자판에서도', () => {
  const key = (over: Partial<KeyboardEvent>) =>
    ({ key: 'm', code: 'KeyM', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent
  assert.equal(isMemoKey(key({})), true)
  assert.equal(isMemoKey(key({ key: 'ㅡ' })), true)
  assert.equal(isMemoKey(key({ key: ',' })), false)
  assert.equal(isMemoKey(key({ key: 'n', code: 'KeyN' })), false)
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat'] as const) {
    assert.equal(isMemoKey(key({ [modifier]: true })), false)
  }
})

/** Ten memos on page 1 and, until `find()`, five more without a page. */
function longList(open = true) {
  const all = setup()
  const threads = Array.from({ length: 15 }, (_, i) => thread(i + 1, { page: i < 10 ? i + 2 : null }))
  all.list.show(report(threads), open)
  const find = () => {
    for (const t of threads.slice(10)) t.page = 1
    all.list.refresh()
  }
  const top = (n: number) => item(all.panel, n).getBoundingClientRect().top
  return { ...all, threads, find, top }
}

test('refresh 뒤에도 보이던 포커스 항목은 그 자리에 보인다', () => {
  const { panel, find, top } = longList()
  panel.scrollTop = 440
  item(panel, 12).focus()
  const before = top(12)
  assert.ok(before >= 0 && before < 100)
  find()
  // Moved to the very top: the list cannot scroll further up than 0.
  assert.ok(top(12) >= 0 && top(12) < 100, `at ${top(12)}`)
})

test('refresh 뒤에도 보이던 선택 항목은 같은 높이에 있다', () => {
  const { dom, panel, list, find, top } = longList()
  list.select(8)
  dom.body.focus()
  panel.scrollTop = 270
  const before = top(8)
  assert.ok(before >= 0 && before < 100)
  find()
  assert.equal(top(8), before)
})

test('refresh는 화면 밖의 포커스·선택을 쫓지 않고 읽던 자리를 지킨다', () => {
  const { panel, list, find, top } = longList()
  list.select(15)
  item(panel, 15).focus()
  panel.scrollTop = 65
  const reading = [1, 2, 3, 4, 5].find((n) => top(n) >= 0) ?? 0
  const before = top(reading)
  find()
  assert.equal(top(reading), before)
})

test('refresh는 맨 위에 있던 목록을 맨 위에 둔다', () => {
  const { panel, find } = longList()
  find()
  assert.equal(panel.scrollTop, 0)
})

test('닫힌 목록의 refresh는 스크롤을 건드리지 않는다', () => {
  const { panel, find } = longList(false)
  panel.scrollTop = 30
  find()
  assert.equal(panel.scrollTop, 30)
})

test('높이를 짐작만 한 항목들 사이에서도 고른 항목이 보인다', () => {
  for (const real of [300, 12]) {
    const { panel, list } = longList()
    for (const el of panel.children) if (el.localName === 'button') Object.assign(el, { height: real, guess: 30 })
    list.select(15)
    const inView = panel.children.filter((el) => {
      const r = el.getBoundingClientRect()
      return el.localName === 'button' && r.bottom > 0 && r.top < 100
    })
    assert.ok(inView.includes(item(panel, 15)), `height ${real}`)
    assert.ok(inView.every((el) => el.laidOut), 'nothing in view can still change its height')
    assert.ok(panel.children.some((el) => !el.laidOut), 'the others still wait')
  }
})

test('키보드로 옮긴 포커스도 높이를 짐작만 한 항목들에 밀려나지 않고, 마우스로 누를 때는 스크롤하지 않는다', () => {
  const { dom, panel } = longList()
  for (const el of panel.children) if (el.localName === 'button') Object.assign(el, { height: 300, guess: 30 })
  dom.keyboard = false
  item(panel, 15).focusByKey()
  assert.equal(panel.scrollTop, 0)
  dom.keyboard = true
  item(panel, 15).focusByKey()
  const r = item(panel, 15).getBoundingClientRect()
  assert.ok(r.bottom > 0 && r.top < 100)
  assert.ok(item(panel, 15).laidOut)
})

test('화면 밖에 있던 긴 항목은 앞부분이 보이고, 보고 있던 긴 항목은 그대로다', () => {
  const { panel, list, top } = longList()
  item(panel, 2).height = 400
  panel.scrollTop = 700
  list.select(2)
  assert.equal(top(2), 0)
  panel.scrollTop += 150
  item(panel, 2).click()
  assert.equal(top(2), -150)
})

test('붙어 있는 쪽 제목 뒤로 끝만 남은 긴 항목도 앞부분이 보인다', () => {
  const { panel, list, top } = longList()
  item(panel, 2).height = 400
  panel.scrollTop = 60 + 400 - 15
  assert.equal(top(2), -385)
  list.select(2)
  assert.equal(top(2), 0)
})

test('refresh로 위 항목의 높이가 바뀌어도 보던 항목은 그 자리다', () => {
  const { panel, list, threads } = longList()
  for (const t of threads) t.located = false
  list.refresh()
  panel.scrollTop = 230
  const seen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => item(panel, n).getBoundingClientRect().top >= 0)[0]
  item(panel, seen).focus()
  const before = item(panel, seen).getBoundingClientRect().top
  threads[0].located = true
  threads[1].located = true
  list.refresh()
  assert.equal(item(panel, seen).getBoundingClientRect().top, before)
})

test('toggle은 여닫을 목록이 있을 때만 true다', () => {
  const { list } = setup()
  assert.equal(list.toggle(), false)
  list.show(report([]), true)
  assert.equal(list.toggle(), false)
  list.show(report([thread(1)]), true)
  assert.equal(list.toggle(), true)
  list.fail()
  assert.equal(list.toggle(), false)
})

test('m 키: 글자 조합 중이거나 글을 넣는 곳에서는 무시한다', () => {
  const key = (over: object) =>
    ({ key: 'm', code: 'KeyM', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over }) as unknown as KeyboardEvent
  assert.equal(isMemoKey(key({ isComposing: true })), false)
  assert.equal(isMemoKey(key({ key: 'ㅡ', isComposing: true })), false)
  for (const localName of ['input', 'textarea', 'select']) {
    assert.equal(isMemoKey(key({ target: { localName } })), false, localName)
  }
  assert.equal(isMemoKey(key({ target: { localName: 'div', isContentEditable: true } })), false)
  assert.equal(isMemoKey(key({ target: { localName: 'button', isContentEditable: false } })), true)
})

test('날짜 툴팁은 제어 문자 없는 한 줄, 128자까지다', () => {
  const { panel, list } = setup()
  const tip = (dateText: string | null, date: string | null = null) => {
    list.show(report([thread(1, { memos: [memo({ date, dateText })] })]), true)
    return item(panel, 1).byClass('memo-date')[0]?.title ?? ''
  }
  assert.equal(tip('2026년\n11월\t20일'), '2026년 11월 20일')
  assert.equal(tip('가\u202e나\u2066다\u200f라\u061c마\u0085바\u2028사'), '가나다라마바 사')
  assert.equal(Array.from(tip('😀'.repeat(300))).length, 128)
  assert.equal(tip(null, '2026-11-20T03:00:00Z').length, '2026-11-20 12:00'.length)
})
