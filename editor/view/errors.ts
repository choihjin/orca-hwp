// The error screen: one Korean line per code, the engine's own message below it.
import type { ErrorCode } from './controller'

export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  'not-hangul': '한글 문서(.hwp, .hwpx)가 아니어서 열 수 없습니다.',
  encrypted: '암호가 걸린 문서는 이 뷰어에서 열 수 없습니다.',
  corrupt: '파일이 손상되었거나 잘려서 열 수 없습니다.',
  unsupported: '이 뷰어가 지원하지 않는 문서 형식입니다.',
  engine: '문서를 읽는 중 rhwp 엔진 오류가 났습니다.',
  empty: '이 문서에는 표시할 쪽이 없습니다.'
}

export function renderError(container: HTMLElement, code: ErrorCode, detail?: string): void {
  const box = document.createElement('div')
  box.className = 'message'
  box.setAttribute('role', 'alert')
  const title = document.createElement('p')
  title.className = 'message-title'
  title.textContent = ERROR_MESSAGES[code]
  box.append(title)
  if (detail) {
    const more = document.createElement('p')
    more.className = 'message-detail'
    more.textContent = detail
    box.append(more)
  }
  container.replaceChildren(box)
  console.error(`[hwp-viewer] ${code}: ${ERROR_MESSAGES[code]}${detail ? ` (${detail})` : ''}`)
}
