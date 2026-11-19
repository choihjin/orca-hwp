import { detectKind, formatSize } from './format'

// Scaffold only: shows what kind of file this is. Rendering the document goes here.
const root = document.createElement('div')
root.style.cssText =
  'box-sizing:border-box;min-height:100vh;margin:0;padding:24px;' +
  'font:13px system-ui,sans-serif;color:var(--orca-foreground);background:var(--orca-background)'
document.body.style.margin = '0'
document.body.append(root)

function show(bytes: Uint8Array): void {
  const kind = detectKind(bytes)
  const label =
    kind === 'hwpx' ? 'HWPX (ZIP + XML)' : kind === 'hwp' ? 'HWP 5.x (binary)' : 'Not a Hangul document'
  root.textContent = `${label} · ${formatSize(bytes.byteLength)} · rendering is not implemented yet`
}

const editor = orca.document
if (!editor) {
  throw new Error('this file runs as a custom editor')
}
editor.onDidChange((doc) => {
  if (doc.content.kind === 'bytes') {
    show(new Uint8Array(doc.content.bytes))
  } else {
    root.textContent = 'Expected a binary document'
  }
})
