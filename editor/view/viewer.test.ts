// Viewer tests in Node with a small stand-in DOM, kept inside this file. The stand-in scroll
// container caps scrollTop the way a browser does (0 … content height − client height) and fires
// `scroll` in a later task, only when the value changed.
import { assert, test } from 'orca/testing'
import type { EngineDocument } from '../engine/rhwp-adapter.js'
import type { ViewState } from './controller'
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
  constructor(public localName: string, public namespaceURI: string | null = null) {}
  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes)
  }
  replaceChildren(...nodes: FakeNode[]): void {
    this.children = [...nodes]
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
  addEventListener(_type?: string, _fn?: () => void): void {}
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
    dispose() {}
  }
}

function fakeStatus(): StatusBar & { last: Partial<StatusState> } {
  const state: StatusState = {
    format: 'HWP', page: 0, pageCount: 0, zoomPercent: 100, engine: 'rhwp', errorPages: 0, typed: '', message: ''
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
