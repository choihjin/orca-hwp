// The one-line status bar: `HWP · 3/35쪽 · 100% · rhwp 0.8.7-p1`, plus pages that failed
// to render and memos that could not be read.

export type StatusState = {
  format: string
  page: number
  pageCount: number
  zoomPercent: number
  engine: string
  errorPages: number
  typed: string
  message: string
  memosFailed: boolean
}

export function statusText(s: StatusState): { text: string; problem: string } {
  if (s.message) {
    return { text: s.message, problem: '' }
  }
  const parts = [s.format]
  if (s.pageCount > 0) {
    parts.push(`${s.page + 1}/${s.pageCount}쪽`, `${s.zoomPercent}%`)
  }
  parts.push(s.engine)
  if (s.typed) {
    parts.push(`쪽 이동: ${s.typed}_`)
  }
  const problems: string[] = []
  if (s.errorPages > 0) {
    problems.push(`렌더 오류 ${s.errorPages}쪽`)
  }
  if (s.memosFailed) {
    problems.push('메모를 읽지 못함')
  }
  return { text: parts.join(' · '), problem: problems.join(' · ') }
}

export function createStatusBar(el: HTMLElement, engine: string) {
  const state: StatusState = {
    format: 'HWP',
    page: 0,
    pageCount: 0,
    zoomPercent: 100,
    engine,
    errorPages: 0,
    typed: '',
    message: '',
    memosFailed: false
  }
  const problem = document.createElement('span')
  problem.className = 'status-problem'
  let last = ''
  function paint(): void {
    const { text, problem: p } = statusText(state)
    const key = `${text}\u0000${p}`
    if (key === last) {
      return
    }
    last = key
    if (p) {
      problem.textContent = p
      el.replaceChildren(`${text} · `, problem)
    } else {
      el.replaceChildren(text)
    }
  }
  return {
    update(patch: Partial<StatusState>): void {
      Object.assign(state, patch)
      paint()
    },
    get state(): Readonly<StatusState> {
      return state
    }
  }
}

export type StatusBar = ReturnType<typeof createStatusBar>
