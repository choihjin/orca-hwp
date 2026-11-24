import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg, initWasm } from '../agent/vendor/resvg/index.mjs'
import { decodeWoff2 } from '../agent/woff2.js'

const fontDir = new URL('../editor/fonts/', import.meta.url)
const fonts = JSON.parse(readFileSync(new URL('manifest.json', fontDir), 'utf8'))
const referenceDir = process.argv[2]
const internalFamilies = {
  'NotoSerifKR-Regular.woff2': 'Noto Serif KR ExtraLight',
  'NotoSerifKR-Bold.woff2': 'Noto Serif KR ExtraLight',
  'NotoSansKR-Bold.woff2': 'Noto Sans KR Thin',
}
await initWasm(readFileSync(new URL('../agent/vendor/resvg/index_bg.wasm', import.meta.url)))

function render(svg, fontBuffers) {
  const renderer = new Resvg(svg, { background: 'white', font: { fontBuffers, loadSystemFonts: false } })
  try {
    const image = renderer.render()
    try {
      const { pixels } = image
      let dark = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 128) dark++
      }
      return { dark, png: Buffer.from(image.asPng()) }
    } finally {
      image.free()
    }
  } finally {
    renderer.free()
  }
}

let total = 0
for (const { file, families, weight } of fonts) {
  const source = readFileSync(new URL(file, fontDir))
  const start = performance.now()
  const sfnt = await decodeWoff2(source)
  const elapsed = performance.now() - start
  total += elapsed

  const tag = Buffer.from(sfnt.subarray(0, 4)).toString('hex')
  assert.ok(['00010000', '4f54544f'].includes(tag), `${file}: expected TTF or OTF`)
  const family = internalFamilies[file] ?? families[0]
  const text = family === 'RHWP Old Hangul' ? 'ᄒᆞᆫ글' : '한글'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="96">
    <text x="8" y="72" font-family="${family}" font-weight="${weight}" font-size="56">${text}</text>
  </svg>`
  assert.equal(render(svg, []).dark, 0, `${file}: expected a blank control`)
  const image = render(svg, [sfnt])
  assert.ok(image.dark > 0, `${file}: expected dark pixels`)

  if (referenceDir) {
    const ext = tag === '4f54544f' ? '.otf' : '.ttf'
    const reference = readFileSync(join(referenceDir, file.replace(/\.woff2$/, ext)))
    assert.ok(image.png.equals(render(svg, [reference]).png), `${file}: PNG differs from the fontTools reference`)
  }
  console.log(`${file}\t${elapsed.toFixed(2)} ms\t${image.dark} dark pixels`)
}
console.log(`Total: ${total.toFixed(2)} ms across ${fonts.length} fonts${referenceDir ? ' (PNG bytes match fontTools references)' : ''}`)
