// Memo list tests in Node with a small stand-in DOM, kept inside this file. It has no innerHTML:
// setting it throws, so document text can only arrive as text.
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
  scrollIntoView(): void {
    this.scrolledIntoView++
  }
  all(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.all()])
  }
  byClass(name: string): FakeElement[] {
    return this.all().filter((e) => e.className.split(' ').includes(name))
  }
}

class FakeDom {
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
