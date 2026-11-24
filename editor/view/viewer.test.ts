// Viewer tests in Node with a small stand-in DOM, kept inside this file. The stand-in scroll
// container caps scrollTop the way a browser does (0 … content height − client height) and fires
// `scroll` in a later task, only when the value changed.
import { assert, test } from 'orca/testing'
import type { AnchorRun } from '../engine/memo-marks.js'
import type { MemoProblem, MemoThread } from '../engine/memo-threads.js'
import type { EngineDocument } from '../engine/rhwp-adapter.js'
import type { ViewState } from './controller'
import { statusText } from './status-bar'
import type { StatusBar, StatusState } from './status-bar'
import { createViewer } from './viewer'

class FakeNode {
  children: FakeNode[] = []
  style: Record<string, string> = {}
  dataset: Record<string, string> = {}
  className = ''
  id = ''
  textContent = ''
  attrs = new Map<string, string>()
  parent: FakeNode | null = null
  private clicks: (() => void)[] = []
  constructor(public localName: string, public namespaceURI: string | null = null) {}
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) node.parent = this
    this.children.push(...nodes)
  }
  replaceChildren(...nodes: FakeNode[]): void {
    for (const child of this.children) child.parent = null
    this.children = []
    this.append(...nodes)
  }
  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this)
      this.parent = null
    }
  }
  click(): void {
    this.clicks.forEach((fn) => fn())
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === 'click') {
      this.clicks.push(fn)
    }
  }
}

class FakeScroller extends FakeNode {
  clientWidth: number
  clientHeight: number
  scrollLeft = 0
  private top = 0
  private listeners: (() => void)[] = []
  constructor(width: number, height: number) {
    super('main')
    this.clientWidth = width
    this.clientHeight = height
  }
  get scrollHeight(): number {
    const content = this.children[0]
    return content ? parseFloat(content.style.height || '0') : 0
  }
  get scrollTop(): number {
    return this.top
  }
  set scrollTop(value: number) {
    const capped = Math.max(0, Math.min(value, Math.max(0, this.scrollHeight - this.clientHeight)))
    if (capped !== this.top) {
      this.top = capped
      setTimeout(() => this.listeners.forEach((fn) => fn()), 0)
    }
  }
  override addEventListener(type: string, fn: () => void): void {
    if (type === 'scroll') {
      this.listeners.push(fn)
    }
  }
}

/** Parses only the root tag of the sanitized SVG: enough for the viewer's checks. */
class FakeParser {
  parseFromString(text: string) {
    const svg = new FakeNode('svg', 'http://www.w3.org/2000/svg')
    const rootTag = /<svg\b[^>]*>/.exec(text)?.[0] ?? ''
    for (const m of rootTag.matchAll(/\s([\w:-]+)="([^"]*)"/g)) {
      svg.setAttribute(m[1], m[2])
    }
    return { documentElement: svg, getElementsByTagName: () => [] }
  }
}

function installDom(): () => void {
  const g = globalThis as Record<string, unknown>
  const saved = { document: g.document, DOMParser: g.DOMParser }
  const head = new FakeNode('head')
  g.document = {
    documentElement: new FakeNode('html'),
    head,
    createElement: (name: string) => new FakeNode(name),
    createElementNS: (ns: string, name: string) => new FakeNode(name, ns),
    createTextNode: (text: string) => Object.assign(new FakeNode('#text'), { textContent: text }),
    importNode: (node: FakeNode) => node
  }
  g.DOMParser = FakeParser
  return () => {
    g.document = saved.document
    g.DOMParser = saved.DOMParser
  }
}

/** The 보건소 sample's page size (4 pages, 793.7 × 1122.5 px). */
function bogeonso(): EngineDocument {
  return {
    pageCount: 4,
    pageSize: () => ({ width: 793.7, height: 1122.5 }),
    renderPageSvg: (i) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="793.7" height="1122.5" viewBox="0 0 793.7 1122.5">` +
      `<rect x="0" y="0" width="793.7" height="1122.5" fill="#ffffff"/><text x="60" y="80">${i + 1}</text></svg>`,
    pageTextRuns: () => [],
    memos: () => ({ threads: [], problems: [] }),
    memoCaret: () => null,
    pageAnchorRuns: () => [],
    dispose() {}
  }
}

function fakeStatus(): StatusBar & { last: Partial<StatusState> } {
  const state: StatusState = {
    format: 'HWP', page: 0, pageCount: 0, zoomPercent: 100, engine: 'rhwp', errorPages: 0, typed: '', message: '',
    memosFailed: false
  }
  return {
    last: state,
    update(patch: Partial<StatusState>) {
      Object.assign(state, patch)
    },
    get state() {
      return state
    }
  }
}

function svgCounts(container: FakeScroller): number[] {
  const pages = container.children[0]?.children ?? []
  return pages.map((slot) => slot.children.filter((c) => c.localName === 'svg').length)
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const key = (k: string) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false }) as KeyboardEvent

test('End은 스크롤 상한에서도 마지막 쪽을 현재 쪽으로 기억한다 (리뷰 재현)', async () => {
  const restore = installDom()
  try {
    const container = new FakeScroller(1000, 1400)
    const status = fakeStatus()
    const remembered: ViewState[] = []
    const viewer = createViewer({
      container: container as unknown as HTMLElement,
      status,
      onViewChange: (v) => remembered.push(v)
    })
    viewer.showDocument(bogeonso(), 0, 0.5)
    await settle()
    assert.ok(viewer.handleKey(key('End')))
    await settle() // the capped scroll fires `scroll` here
    assert.equal(status.state.page, 3, 'status shows 4/4 after End')
    assert.deepEqual(remembered.map((v) => v.page), [3], 'only the last page is remembered')
    // The cap really applied: page 4 is not at the top of the screen.
    assert.ok(container.scrollTop < 3 * 700, `scrollTop ${container.scrollTop} is capped`)
  } finally {
    restore()
  }
})

test('마지막 쪽으로 다시 열면 첫 칠에 화면의 쪽을 모두 그린다 (리뷰 재현)', async () => {
  const restore = installDom()
  try {
    const container = new FakeScroller(1000, 1400)
    const status = fakeStatus()
    const viewer = createViewer({ container: container as unknown as HTMLElement, status, onViewChange() {} })
    viewer.showDocument(bogeonso(), 3, 0.5)
    // Synchronously, before any timer: every page the capped screen shows has its SVG.
    const counts = svgCounts(container)
    const pages = container.children[0].children
    const top = container.scrollTop
    for (let i = 0; i < pages.length; i++) {
      const y = parseFloat(pages[i].style.top)
      const h = parseFloat(pages[i].style.height)
      const onScreen = y + h > top && y < top + container.clientHeight
      assert.equal(counts[i], onScreen ? 1 : 0, `page ${i + 1} (on screen: ${onScreen}) counts ${JSON.stringify(counts)}`)
    }
    assert.equal(counts[3], 1)
    assert.ok(counts[2] === 1, 'page 3 fills the top of the screen above the capped page 4')
    assert.equal(status.state.page, 3)
    await settle()
    assert.equal(status.state.page, 3, 'the scroll event from opening keeps page 4 current')
  } finally {
    restore()
  }
})

test('사용자가 스크롤하면 고정한 쪽을 놓고 화면 위치로 현재 쪽을 정한다', async () => {
  const restore = installDom()
  try {
    const container = new FakeScroller(1000, 1400)
    const status = fakeStatus()
    const remembered: ViewState[] = []
    const viewer = createViewer({
      container: container as unknown as HTMLElement,
      status,
      onViewChange: (v) => remembered.push(v)
    })
    viewer.showDocument(bogeonso(), 3, 0.5)
    await settle()
    container.scrollTop = 0
    await settle()
    assert.equal(status.state.page, 0)
    assert.deepEqual(remembered.map((v) => v.page), [0])
  } finally {
    restore()
  }
})

/** Pages whose box overlaps the screen at the current scroll top, from the slot styles. */
function visiblePages(container: FakeScroller): number[] {
  const pages = container.children[0]?.children ?? []
  const top = container.scrollTop
  const out: number[] = []
  pages.forEach((slot, i) => {
    const y = parseFloat(slot.style.top)
    const h = parseFloat(slot.style.height)
    if (y + h > top && y < top + container.clientHeight) out.push(i)
  })
  return out
}

test('End으로 고정한 뒤 확대해도 상태 쪽이 화면에 보인다 (재리뷰 재현)', async () => {
  const restore = installDom()
  try {
    const container = new FakeScroller(1000, 1400)
    const status = fakeStatus()
    const remembered: ViewState[] = []
    const viewer = createViewer({
      container: container as unknown as HTMLElement,
      status,
      onViewChange: (v) => remembered.push(v)
    })
    viewer.showDocument(bogeonso(), 0, 0.5)
    await settle()
    viewer.handleKey(key('End'))
    await settle()
    for (let n = 0; n < 5; n++) {
      viewer.handleKey(key('+'))
      await settle()
    }
    const visible = visiblePages(container)
    assert.ok(
      visible.includes(status.state.page),
      `status page ${status.state.page} is on screen ${JSON.stringify(visible)}`
    )
    assert.ok(visible.includes(3), `the chosen last page stays on screen ${JSON.stringify(visible)}`)
    assert.equal(status.state.page, 3)
    assert.equal(remembered[remembered.length - 1].page, 3)
    assert.equal(remembered[remembered.length - 1].zoom, 1.1)
  } finally {
    restore()
  }
})

test('확대로 고정한 쪽이 화면에서 벗어나면 고정을 풀고 보이는 쪽으로 상태를 바꾼다', async () => {
  const restore = installDom()
  try {
    const container = new FakeScroller(1000, 1400)
    const status = fakeStatus()
    const viewer = createViewer({ container: container as unknown as HTMLElement, status, onViewChange() {} })
    // Page 2 chosen at zoom 1, then zoomed far out: everything fits, so nothing is capped and
    // page 2 stays visible; the status must always name a page that is on screen.
    viewer.showDocument(bogeonso(), 1, 1)
    await settle()
    for (let n = 0; n < 6; n++) {
      viewer.handleKey(key('-'))
      await settle()
    }
    assert.ok(visiblePages(container).includes(status.state.page))
  } finally {
    restore()
  }
})

test('짧은 화면에서도 첫 칠에 시작 쪽과 다음 쪽을 그린다 (재리뷰 재현)', () => {
  const restore = installDom()
  try {
    const container = new FakeScroller(1000, 800)
    const viewer = createViewer({ container: container as unknown as HTMLElement, status: fakeStatus(), onViewChange() {} })
    viewer.showDocument(bogeonso(), 0, 1)
    assert.deepEqual(svgCounts(container), [1, 1, 0, 0])
  } finally {
    restore()
  }
})

/** A memo on characters 3 to 5 (`예산`) of the only run of paragraph `number`. */
function memoThread(number: number, page: number | null, over: Partial<MemoThread> = {}): MemoThread {
  return {
    number,
    page: page === null ? null : page + 1,
    located: false,
    place: 'body',
    anchorText: '예산',
    paragraphText: '셋째 예산 낱말',
    multiParagraph: false,
    memos: [],
    anchor: {
      sectionIndex: 0, ownerParaIndex: number, paraIndex: number, path: null,
      startCharIdx: 3, endCharIdx: 5, text: '예산', start: 3
    },
    caret: page === null ? null : { page, x: 130, y: 200 },
    ...over
  }
}

function memoRun(paragraph: number, y = 200): AnchorRun {
  return {
    text: '셋째 예산 낱말', x: 100, y, w: 80, h: 16,
    charX: [0, 10, 20, 30, 40, 50, 60, 70, 80], secIdx: 0, paraIdx: paragraph, charStart: 0
  }
}

/** The 4 pages with these layout runs on them; `asked` lists the pages whose layout was read. */
function memoDocument(runs: Record<number, AnchorRun[]>): EngineDocument & { asked: number[] } {
  const asked: number[] = []
  return {
    ...bogeonso(),
    asked,
    pageAnchorRuns(i) {
      asked.push(i)
      return runs[i] ?? []
    }
  }
}

function memoViewer(height = 1400) {
  const container = new FakeScroller(1000, height)
  const status = fakeStatus()
  const remembered: ViewState[] = []
  const picked: number[] = []
  const listed: string[] = []
  const viewer = createViewer({
    container: container as unknown as HTMLElement,
    status,
    onViewChange: (v) => remembered.push(v),
    onMemoPick: (n) => picked.push(n),
    memoList: {
      show: (report, open) => listed.push(`show ${report.threads.length} ${open}`),
      refresh: () => listed.push('refresh'),
      fail: () => listed.push('fail'),
      clear: () => listed.push('clear')
    }
  })
  const open = (doc: EngineDocument, threads: MemoThread[], page = 0, zoom = 1, problems: MemoProblem[] = []) => {
    viewer.prepareMemos({ report: { threads, problems }, failed: false, open: true })
    viewer.showDocument(doc, page, zoom)
  }
  return { container, status, remembered, picked, listed, viewer, open }
}

const slotsOf = (container: FakeScroller) => container.children[0].children
const overlayOf = (container: FakeScroller, i: number) =>
  slotsOf(container)[i].children.find((c) => c.getAttribute('class') === 'memo-marks')
const marksOf = (container: FakeScroller, i: number) =>
  (overlayOf(container, i)?.children ?? []).map((g) => Number(g.getAttribute('data-number')))

test('메모: 그린 쪽 위에 같은 viewBox의 덧그림을 동기로 더한다', async () => {
  const restore = installDom()
  try {
    const { container, open, listed } = memoViewer()
    const t = memoThread(3, 0)
    open(memoDocument({ 0: [memoRun(3)] }), [t])
    const overlay = overlayOf(container, 0)
    assert.ok(overlay)
    assert.equal(overlay.namespaceURI, 'http://www.w3.org/2000/svg')
    assert.equal(overlay.getAttribute('viewBox'), slotsOf(container)[0].children[0].getAttribute('viewBox'))
    assert.equal(slotsOf(container)[0].children[1], overlay)
    const [rect] = overlay.children[0].children
    assert.deepEqual(
      ['x', 'y', 'width', 'height'].map((name) => rect.getAttribute(name)),
      ['130', '200', '20', '16']
    )
    assert.ok(overlay.children[0].children.some((c) => c.localName === 'text' && c.textContent === '3'))
    // Found on the layout: the list hears of it before the first paint.
    assert.equal(t.located, true)
    assert.deepEqual(listed, ['show 1 true', 'refresh'])
    await settle()
  } finally {
    restore()
  }
})

test('메모: 없는 문서의 슬롯에는 덧그림이 없고 글자 배치도 읽지 않는다', async () => {
  const restore = installDom()
  try {
    const { container, open } = memoViewer()
    const doc = memoDocument({})
    open(doc, [])
    await settle()
    assert.ok(slotsOf(container).every((slot) => slot.children.length <= 1))
    assert.ok(slotsOf(container).some((slot) => slot.children.length === 1))
    assert.deepEqual(doc.asked, [])
  } finally {
    restore()
  }
})

test('메모: 강조가 없는 쪽에는 덧그림이 없고, 글자가 다르면 강조하지 않는다', async () => {
  const restore = installDom()
  try {
    const { container, open } = memoViewer()
    const t = memoThread(3, 0)
    open(memoDocument({ 0: [{ ...memoRun(3), text: '셋째 결산 낱말' }] }), [t, memoThread(4, null, { place: 'header' })])
    assert.equal(overlayOf(container, 0), undefined)
    assert.equal(t.located, false)
    assert.equal(t.page, 1)
    await settle()
  } finally {
    restore()
  }
})

test('메모: 덧그림은 쪽을 버릴 때 함께 사라지고 다시 그리면 다시 생긴다', async () => {
  const restore = installDom()
  try {
    const { container, open, viewer } = memoViewer(300)
    const t = memoThread(3, 0)
    const many: EngineDocument = { ...memoDocument({ 0: [memoRun(3)] }), pageCount: 12 }
    open(many, [t])
    await settle()
    assert.deepEqual(marksOf(container, 0), [3])
    viewer.handleKey(key('End'))
    await settle()
    assert.equal(slotsOf(container)[0].children.length, 0)
    assert.equal(t.located, true)
    viewer.handleKey(key('Home'))
    await settle()
    assert.deepEqual(marksOf(container, 0), [3])
    assert.equal(slotsOf(container)[0].children.length, 2)
  } finally {
    restore()
  }
})

test('메모: 시작 글자가 다음 쪽에 있으면 그 쪽으로 고치고 거기에 강조한다', async () => {
  const restore = installDom()
  try {
    for (const [from, to] of [[0, 1], [1, 0]]) {
      const { container, open, listed } = memoViewer()
      const t = memoThread(3, from)
      open(memoDocument({ [to]: [memoRun(3)] }), [t])
      assert.equal(t.page, to + 1)
      assert.equal(t.located, true)
      assert.deepEqual(marksOf(container, to), [3])
      assert.deepEqual(marksOf(container, from), [])
      assert.ok(listed.includes('refresh'))
    }
    await settle()
  } finally {
    restore()
  }
})

test('메모: 나중에 쪽을 찾은 묶음은 refreshMemos 때 그려 둔 쪽에 나타난다', async () => {
  const restore = installDom()
  try {
    const { container, open, viewer, listed } = memoViewer()
    const t = memoThread(3, 0)
    const late = memoThread(4, null)
    open(memoDocument({ 0: [memoRun(3), memoRun(4, 400)] }), [t, late])
    assert.deepEqual(marksOf(container, 0), [3])
    Object.assign(late, { page: 1, caret: { page: 0, x: 130, y: 400 } })
    listed.length = 0
    viewer.refreshMemos()
    assert.deepEqual(marksOf(container, 0), [3, 4])
    assert.equal(slotsOf(container)[0].children.length, 2)
    assert.equal(late.located, true)
    assert.ok(listed.includes('refresh'))
    await settle()
  } finally {
    restore()
  }
})

test('메모: 강조나 번호를 누르면 onMemoPick을 부르고 그 강조만 선택된다', async () => {
  const restore = installDom()
  try {
    const { container, open, picked } = memoViewer()
    open(memoDocument({ 0: [memoRun(3), memoRun(4, 400)] }), [memoThread(3, 0), memoThread(4, 0, { caret: { page: 0, x: 130, y: 400 } })])
    const [three, four] = overlayOf(container, 0)?.children ?? []
    four.click()
    assert.deepEqual(picked, [4])
    assert.equal(four.getAttribute('class'), 'memo-mark selected')
    assert.equal(three.getAttribute('class'), 'memo-mark')
    three.click()
    assert.equal(four.getAttribute('class'), 'memo-mark')
    assert.equal(three.getAttribute('class'), 'memo-mark selected')
    await settle()
  } finally {
    restore()
  }
})

test('메모: showMemo는 그 쪽으로 가서 글을 화면에 보이고 선택한다', async () => {
  const restore = installDom()
  try {
    const { container, open, viewer, status, remembered, picked } = memoViewer(600)
    const t = memoThread(3, 2, { caret: { page: 2, x: 130, y: 900 } })
    open(memoDocument({ 2: [memoRun(3, 900)] }), [memoThread(1, 0), t])
    await settle()
    viewer.showMemo(t)
    await settle()
    assert.equal(status.state.page, 2)
    assert.deepEqual(remembered[remembered.length - 1], { page: 2, zoom: 1 })
    assert.equal(overlayOf(container, 2)?.children[0].getAttribute('class'), 'memo-mark selected')
    const scale = status.state.zoomPercent / 100
    const y = parseFloat(slotsOf(container)[2].style.top) + 900 * scale - container.scrollTop
    assert.ok(y > 0 && y + 16 * scale < 600, `the text is on screen at ${y}`)
    assert.deepEqual(picked, [], 'the list asked for it')
    // Zooming keeps the place; only a scroll by the reader lets go of it.
    viewer.handleKey(key('+'))
    await settle()
    assert.equal(status.state.page, 2)
    assert.ok(container.scrollTop > parseFloat(slotsOf(container)[2].style.top))
  } finally {
    restore()
  }
})

test('메모: showMemo는 확대해서 옆으로 벗어난 글도 화면에 보인다', async () => {
  const restore = installDom()
  try {
    const { container, open, viewer, status } = memoViewer(600)
    const t = memoThread(3, 0, { caret: { page: 0, x: 730, y: 100 } })
    open(memoDocument({ 0: [{ ...memoRun(3, 100), x: 700 }] }), [t], 0, 4)
    viewer.showMemo(t)
    await settle()
    const scale = status.state.zoomPercent / 100
    const x = parseFloat(slotsOf(container)[0].style.left) + 730 * scale - container.scrollLeft
    assert.ok(x > 0 && x < 1000, `the text is on screen at ${x}`)
  } finally {
    restore()
  }
})

test('메모: 그려지지 않은 쪽의 묶음도 showMemo가 앞뒤 쪽까지 확인해 간다', async () => {
  const restore = installDom()
  try {
    const { open, viewer, status, container } = memoViewer(300)
    const t = memoThread(3, 2)
    open(memoDocument({ 3: [memoRun(3)] }), [t])
    viewer.showMemo(t)
    await settle()
    assert.equal(t.page, 4)
    assert.equal(status.state.page, 3)
    assert.deepEqual(marksOf(container, 3), [3])
  } finally {
    restore()
  }
})

test('메모: 쪽이 없는 묶음의 showMemo는 아무 일도 하지 않는다', async () => {
  const restore = installDom()
  try {
    const { container, open, viewer, remembered } = memoViewer(600)
    const t = memoThread(3, 0)
    open(memoDocument({ 0: [memoRun(3)] }), [t, memoThread(4, null)])
    await settle()
    viewer.showMemo(t)
    remembered.length = 0
    const top = container.scrollTop
    viewer.showMemo(memoThread(4, null))
    await settle()
    assert.equal(container.scrollTop, top)
    assert.deepEqual(remembered, [])
    assert.equal(overlayOf(container, 0)?.children[0].getAttribute('class'), 'memo-mark selected')
  } finally {
    restore()
  }
})

test('메모: 번호는 쪽 밖으로 나가지 않는다', async () => {
  const restore = installDom()
  try {
    const { container, open } = memoViewer()
    open(memoDocument({ 0: [{ ...memoRun(300, 1), x: 740, charX: [0, 5, 10, 15, 30, 53, 53, 53, 53] }] }), [memoThread(300, 0)])
    const badge = overlayOf(container, 0)?.children[0].children.find((c) => c.getAttribute('class') === 'memo-badge')
    assert.ok(badge)
    const [x, y, w] = ['x', 'y', 'width'].map((name) => Number(badge.getAttribute(name)))
    assert.ok(x >= 0 && x + w <= 793.7, `${x} + ${w}`)
    assert.ok(y >= 0, `${y}`)
    await settle()
  } finally {
    restore()
  }
})

test('메모: 같은 자리에서 끝나는 두 강조의 번호는 겹치지 않는다', async () => {
  const restore = installDom()
  try {
    const { container, open } = memoViewer()
    const whole = memoThread(3, 0, { number: 1, anchorText: '셋째 예산' })
    Object.assign(whole.anchor ?? {}, { startCharIdx: 0, start: 0, text: '셋째 예산' })
    Object.assign(whole, { caret: { page: 0, x: 100, y: 200 } })
    open(memoDocument({ 0: [memoRun(3)] }), [whole, memoThread(3, 0, { number: 2 })])
    const boxes = (overlayOf(container, 0)?.children ?? [])
      .flatMap((g) => g.children.filter((c) => c.getAttribute('class') === 'memo-badge'))
      .map((b) => [Number(b.getAttribute('x')), Number(b.getAttribute('width'))])
    assert.equal(boxes.length, 2)
    assert.ok(boxes[0][0] + boxes[0][1] <= boxes[1][0], JSON.stringify(boxes))
    await settle()
  } finally {
    restore()
  }
})

test('메모: 그리지 못한 쪽의 묶음은 강조된 것으로 치지 않는다', async () => {
  const restore = installDom()
  try {
    const { open } = memoViewer()
    const doc = memoDocument({ 0: [memoRun(3)] })
    doc.renderPageSvg = () => {
      throw new Error('svg')
    }
    const t = memoThread(3, 0)
    open(doc, [t])
    assert.equal(t.located, false)
    await settle()
  } finally {
    restore()
  }
})

test('메모: 글자 배치를 못 읽거나 쪽을 못 그려도 쪽은 그대로다', async () => {
  const restore = installDom()
  try {
    const { container, open, status } = memoViewer()
    const doc = memoDocument({})
    doc.pageAnchorRuns = () => {
      throw new Error('layout')
    }
    open(doc, [memoThread(3, 0)])
    assert.equal(svgCounts(container)[0], 1)
    assert.equal(status.state.errorPages, 0)

    const broken = memoDocument({ 0: [memoRun(3)] })
    broken.renderPageSvg = () => {
      throw new Error('svg')
    }
    open(broken, [memoThread(3, 0)])
    assert.equal(overlayOf(container, 0), undefined)
    assert.equal(slotsOf(container)[0].children[0].className, 'page-error')
    await settle()
  } finally {
    restore()
  }
})

test('메모: 새 문서를 열면 이전 강조와 선택이 남지 않는다', async () => {
  const restore = installDom()
  try {
    const { container, open, viewer, listed } = memoViewer()
    const t = memoThread(3, 0)
    open(memoDocument({ 0: [memoRun(3)] }), [t])
    viewer.showMemo(t)
    viewer.clear()
    assert.equal(listed[listed.length - 1], 'clear')
    open(memoDocument({ 0: [memoRun(3)] }), [memoThread(3, 0)])
    assert.equal(overlayOf(container, 0)?.children[0].getAttribute('class'), 'memo-mark')
    viewer.clear()
    viewer.showDocument(bogeonso(), 0, 1)
    assert.equal(overlayOf(container, 0), undefined)
    await settle()
  } finally {
    restore()
  }
})

test('메모: 읽지 못하면 상태 줄에 알리고, 오류 화면과 비우기는 목록을 비운다', async () => {
  const restore = installDom()
  try {
    const { viewer, status, listed } = memoViewer()
    viewer.prepareMemos({ report: null, failed: true, open: true })
    viewer.showDocument(bogeonso(), 0, 1)
    assert.deepEqual(listed, ['fail'])
    assert.equal(status.state.memosFailed, true)
    viewer.showError('corrupt')
    assert.equal(status.state.memosFailed, false)
    assert.deepEqual(listed, ['fail', 'clear'])
    viewer.prepareMemos({ report: null, failed: true, open: true })
    viewer.clear()
    assert.equal(status.state.memosFailed, false)
    await settle()
  } finally {
    restore()
  }
})

test('상태 줄: 메모를 읽지 못함', () => {
  const { state } = fakeStatus()
  assert.equal(statusText(state).problem, '')
  assert.equal(statusText({ ...state, memosFailed: true }).problem, '메모를 읽지 못함')
  assert.equal(statusText({ ...state, errorPages: 2, memosFailed: true }).problem, '렌더 오류 2쪽 · 메모를 읽지 못함')
})

test('메모: 목록을 여닫아 너비가 바뀌면 ResizeObserver 경로로 다시 배치된다', async () => {
  const restore = installDom()
  const g = globalThis as Record<string, unknown>
  const saved = g.ResizeObserver
  let resized = () => {}
  g.ResizeObserver = class {
    constructor(fn: () => void) {
      resized = fn
    }
    observe() {}
  }
  try {
    const { container, open, viewer, status } = memoViewer(600)
    const t = memoThread(3, 2, { caret: { page: 2, x: 130, y: 900 } })
    open(memoDocument({ 2: [memoRun(3, 900)] }), [t])
    viewer.showMemo(t)
    await settle()
    assert.equal(status.state.zoomPercent, 122)
    container.clientWidth = 720
    resized()
    await settle()
    assert.equal(status.state.zoomPercent, 87)
    assert.equal(status.state.page, 2)
    assert.ok(visiblePages(container).includes(2))
  } finally {
    g.ResizeObserver = saved
    restore()
  }
})

/** The number's box of each mark on a page: x, y, width. */
function badgesOf(container: FakeScroller, i: number): number[][] {
  return (overlayOf(container, i)?.children ?? [])
    .flatMap((g) => g.children.filter((c) => c.getAttribute('class') === 'memo-badge'))
    .map((b) => ['x', 'y', 'width'].map((name) => Number(b.getAttribute(name))))
}

test('메모: 번호는 글줄을 가리지 않게 글 위에 띄운다', async () => {
  const restore = installDom()
  try {
    const { container, open } = memoViewer()
    open(memoDocument({ 0: [memoRun(3)] }), [memoThread(3, 0)])
    const [[x, y]] = badgesOf(container, 0)
    assert.equal(x, 150)
    assert.ok(y + 12 <= 199 && y + 12 >= 198, `bottom at ${y + 12}`)
    await settle()
  } finally {
    restore()
  }
})

test('메모: 위 줄과 겹치는 번호는 여백에 둔다', async () => {
  const restore = installDom()
  try {
    const above: AnchorRun = { ...memoRun(2, 180), charX: [0, 60, 120, 180, 240, 300, 360, 420, 480], w: 480 }
    const at = (runs: AnchorRun[]) => {
      const { container, open } = memoViewer()
      open(memoDocument({ 0: runs }), [memoThread(3, 0)])
      return badgesOf(container, 0)[0]
    }
    const [x, y, width] = at([above, memoRun(3)])
    assert.ok(x >= 580 && x + width <= 793.7, `right of all text, at ${x}`)
    assert.ok(y >= 200 && y + 12 <= 216, `beside its line, at ${y}`)
    // Blank text is not in the way.
    assert.equal(at([{ ...above, text: ' '.repeat(8) }, memoRun(3)])[0], 150)
    // No room on the right: the left margin.
    const wide = { ...above, charX: above.charX.map((c) => c * 1.4), w: 690 }
    const [left, , w] = at([wide, memoRun(3)])
    assert.ok(left >= 0 && left + w <= 100, `left of all text, at ${left}`)
    await settle()
  } finally {
    restore()
  }
})

test('메모: 여백에 둔 같은 줄의 번호들도 겹치지 않는다', async () => {
  const restore = installDom()
  try {
    const { container, open } = memoViewer()
    const above: AnchorRun = { ...memoRun(2, 180), charX: [0, 60, 120, 180, 240, 300, 360, 420, 480], w: 480 }
    open(memoDocument({ 0: [above, memoRun(3)] }), [1, 2, 3].map((number) => memoThread(3, 0, { number })))
    const boxes = badgesOf(container, 0).sort((a, b) => a[0] - b[0])
    assert.equal(boxes.length, 3)
    assert.ok(boxes.every(([x], i) => i === 0 || boxes[i - 1][0] + boxes[i - 1][2] <= x), JSON.stringify(boxes))
    await settle()
  } finally {
    restore()
  }
})

test('메모: 강조마다 아래쪽에 선이 있다', async () => {
  const restore = installDom()
  try {
    const { container, open } = memoViewer()
    open(memoDocument({ 0: [memoRun(3)] }), [memoThread(3, 0)])
    const lines = overlayOf(container, 0)?.children[0].children.filter((c) => c.getAttribute('class') === 'memo-underline') ?? []
    assert.deepEqual(
      lines.map((l) => ['x1', 'y1', 'x2', 'y2'].map((name) => Number(l.getAttribute(name)))),
      [[130, 216, 150, 216]]
    )
    await settle()
  } finally {
    restore()
  }
})

/** A memo on characters `start` to `end` of the run of `paragraph`. */
function memoOn(number: number, paragraph: number, start: number, end: number, run: AnchorRun): MemoThread {
  const t = memoThread(paragraph, 0, { number })
  const text = Array.from(run.text).slice(start, end).join('')
  Object.assign(t, { anchorText: text, caret: { page: 0, x: run.x + run.charX[start], y: run.y } })
  Object.assign(t.anchor ?? {}, { startCharIdx: start, endCharIdx: end, start, text })
  return t
}

test('메모: 같은 곳에서 끝나는 번호는 번호 순으로 나란하고, 쪽 오른쪽 끝에서는 왼쪽으로 물러난다', async () => {
  const restore = installDom()
  try {
    for (const x of [100, 705]) {
      const { container, open, picked } = memoViewer()
      const run = { ...memoRun(3), x }
      open(memoDocument({ 0: [run] }), [1, 2, 12].map((number, i) => memoOn(number, 3, i, 8, run)))
      const groups = [...(overlayOf(container, 0)?.children ?? [])]
      const boxes = groups
        .map((g) => {
          const b = g.children.find((c) => c.getAttribute('class') === 'memo-badge')
          return { number: Number(g.getAttribute('data-number')), x: Number(b?.getAttribute('x')), w: Number(b?.getAttribute('width')) }
        })
        .sort((a, b) => a.x - b.x)
      assert.deepEqual(boxes.map((b) => b.number), [1, 2, 12], `at ${x}`)
      boxes.forEach((b, i) => {
        assert.ok(i === 0 || boxes[i - 1].x + boxes[i - 1].w <= b.x, JSON.stringify(boxes))
        assert.ok(b.x >= 0 && b.x + b.w <= 793.7, JSON.stringify(boxes))
      })
      groups.forEach((g) => g.click())
      assert.deepEqual([...picked].sort((a, b) => a - b), [1, 2, 12])
    }
    await settle()
  } finally {
    restore()
  }
})

test('메모: 겹친 강조는 안쪽 글이 위에 있어 먼저 눌린다', async () => {
  const restore = installDom()
  try {
    for (const [outer, inner] of [[1, 2], [2, 1]]) {
      const { container, open } = memoViewer()
      const run = memoRun(3)
      const threads = [memoOn(outer, 3, 0, 8, run), memoOn(inner, 3, 3, 5, run)].sort((a, b) => a.number - b.number)
      open(memoDocument({ 0: [run] }), threads)
      assert.deepEqual(marksOf(container, 0), [outer, inner])
    }
    await settle()
  } finally {
    restore()
  }
})
