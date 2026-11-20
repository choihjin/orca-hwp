// 본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
// "한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 플러그인은 한글과컴퓨터와 관계없는 독립 프로젝트입니다.
//
// Entry of the custom editor (loaded by editor/index.html). Order matters for `orca plugin shot`,
// which captures right after the editor asks for its document and paints (design 5.3):
//   1. initialise the WASM and load the core fonts, before subscribing to the document;
//   2. subscribe;
//   3. in the document callback, open and draw the first pages synchronously.
import { ENGINE_INFO, initEngine, openDocument } from './engine/rhwp-adapter.js'
import { detectKind } from './format.js'
import { setupAbout } from './view/about'
import { createController } from './view/controller'
import { createStatusBar } from './view/status-bar'
import { createViewer } from './view/viewer'

// Noto Serif/Sans KR per design 5.3. Nanum Myeongjo too: rhwp's serif fallback lists put it
// ahead of AppleMyungjo and Noto Serif KR, so on a Mac without Batang it is what body text uses;
// loaded here, it is ready before the first paint instead of arriving after it.
const CORE_FONTS = [
  '400 16px "Noto Serif KR"',
  '700 16px "Noto Serif KR"',
  '400 16px "Noto Sans KR"',
  '700 16px "Noto Sans KR"',
  '400 16px "Nanum Myeongjo"',
  '700 16px "Nanum Myeongjo"'
]

function element(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`editor/index.html is missing #${id}`)
  }
  return el
}

function frameStorage(): Storage | null {
  try {
    const storage = window.localStorage
    void storage.length
    return storage
  } catch {
    return null
  }
}

const view = element('view')
const status = createStatusBar(element('status-text'), `${ENGINE_INFO.name} ${ENGINE_INFO.version}`)
const viewer = createViewer({ container: view, status, onViewChange: (v) => controller.remember(v) })
const controller = createController({ engine: { open: openDocument }, view: viewer, storage: frameStorage() })
const about = setupAbout(element('about'), element('about-button'), () => view.focus({ preventScroll: true }))

window.addEventListener('keydown', (event) => {
  if (about.isOpen()) {
    if (event.key === 'Escape') {
      about.close()
      event.preventDefault()
    }
    return
  }
  if (viewer.handleKey(event)) {
    event.preventDefault()
  }
})
window.addEventListener('pagehide', () => controller.dispose())
window.addEventListener('error', (event) => console.error(`[hwp-viewer] ${String(event.error ?? event.message)}`))
window.addEventListener('unhandledrejection', (event) => console.error(`[hwp-viewer] ${String(event.reason)}`))

function formatLabel(bytes: Uint8Array, fileType: string | undefined): string {
  const kind = detectKind(bytes)
  if (kind === 'hwpx') {
    return 'HWPX'
  }
  if (kind === 'hwp') {
    return 'HWP'
  }
  return fileType ? fileType.replace(/^\./, '').toUpperCase() : '?'
}

async function boot(): Promise<void> {
  await Promise.all([
    initEngine(new URL('./vendor/rhwp/rhwp_bg.wasm', import.meta.url)),
    // A missing font must not stop the viewer: the SVG falls back to other families.
    ...CORE_FONTS.map((font) => document.fonts.load(font, '가A').catch(() => []))
  ])
}

const editor = orca.document
if (!editor) {
  viewer.showError('engine', 'This page runs only as an Orca custom editor.')
} else {
  boot().then(
    () => {
      status.update({ message: '' })
      let version = -1
      editor.onDidChange((doc) => {
        if (doc.version === version) {
          return
        }
        version = doc.version
        if (doc.content.kind !== 'bytes') {
          viewer.showError('unsupported', `expected bytes content, got ${doc.content.kind}`)
          return
        }
        const bytes = new Uint8Array(doc.content.bytes)
        status.update({ format: formatLabel(bytes, doc.fileType) })
        // Synchronous up to the first draw, remembered page included (design 5.3).
        controller.load(bytes).catch((error: unknown) => viewer.showError('engine', String(error)))
      })
    },
    (error: unknown) => viewer.showError('engine', `rhwp 엔진을 시작하지 못했습니다: ${String(error)}`)
  )
}
