// The information screen behind the status bar's ⓘ button: notices required by Hancom's
// public-spec terms and the trademark notice, word for word.
import { ENGINE_INFO } from '../engine/rhwp-adapter.js'

export const HANCOM_NOTICE = '본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.'
export const TRADEMARK_NOTICE =
  '"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 플러그인은 한글과컴퓨터와 관계없는 독립 프로젝트입니다.'
export const RENDER_NOTICE = 'rhwp 엔진이 그린 화면이며 한글 프로그램과 다를 수 있습니다.'

function section(title: string, ...lines: string[]): DocumentFragment {
  const frag = document.createDocumentFragment()
  const h = document.createElement('h3')
  h.textContent = title
  frag.append(h)
  for (const line of lines) {
    const p = document.createElement('p')
    p.textContent = line
    frag.append(p)
  }
  return frag
}

export function setupAbout(panel: HTMLElement, button: HTMLElement, onClose: () => void): {
  open(): void
  close(): void
  isOpen(): boolean
} {
  const body = document.createElement('div')
  body.className = 'about-body'
  const h = document.createElement('h2')
  h.textContent = 'HWP Viewer 정보'
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.textContent = '닫기'
  body.append(
    h,
    section('안내', RENDER_NOTICE),
    section('공개 문서 고지', HANCOM_NOTICE),
    section('상표', TRADEMARK_NOTICE),
    section(
      '엔진',
      `${ENGINE_INFO.name} ${ENGINE_INFO.version} (MIT 라이선스, Edward Kim). 출처: ${ENGINE_INFO.source}`
    ),
    section(
      '글꼴',
      '쪽에 쓰는 글꼴은 SIL Open Font License 1.1 글꼴(Noto Serif KR, Noto Sans KR, Pretendard, 나눔명조, D2Coding, RHWP Public Batang, RHWP Old Hangul)입니다. 컴퓨터에 문서의 원래 글꼴이 있으면 그것이 먼저 쓰입니다.'
    ),
    section(
      '서드파티 라이선스',
      '엔진과 그 의존 라이브러리, 글꼴의 라이선스 전문은 플러그인 폴더의 THIRD_PARTY_NOTICES.txt에 있습니다.'
    ),
    closeButton
  )
  panel.replaceChildren(body)

  const api = {
    open() {
      panel.hidden = false
      closeButton.focus()
    },
    close() {
      if (!panel.hidden) {
        panel.hidden = true
        onClose()
      }
    },
    isOpen: () => !panel.hidden
  }
  button.addEventListener('click', () => (panel.hidden ? api.open() : api.close()))
  closeButton.addEventListener('click', () => api.close())
  return api
}
