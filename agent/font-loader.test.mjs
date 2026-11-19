import { existsSync, readFileSync, statSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { sanitizeSvg } from '../editor/render/sanitize.js'
import { prepareFonts } from './font-loader.js'
import { initWasm, Resvg } from './vendor/resvg/index.mjs'

await initWasm(readFileSync(new URL('./vendor/resvg/index_bg.wasm', import.meta.url)))

function textSvg(family, weight, css = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="50">${css}<text x="1" y="35" font-family="${family}" font-size="30" font-weight="${weight}">한글 여섯글자</text></svg>`
}

function alphaPixels(svg, fontBuffers) {
  const renderer = new Resvg(svg, { font: { fontBuffers } })
  const image = renderer.render()
  const pixels = image.pixels.filter((_, i) => i % 4 === 3)
  image.free()
  renderer.free()
  return pixels
}

test('bundled Noto Sans KR selects the right weight with regular and bold loaded together', async () => {
  const warnings = []
  const regular = textSvg('Noto Sans KR', 400)
  const { svg, fontBuffers } = await prepareFonts(regular, true, warnings)
  assert.deepEqual(warnings, [])
  assert.ok(fontBuffers.length > 2)
  const normalPixels = alphaPixels(svg, fontBuffers)
  const boldPixels = alphaPixels(textSvg('Noto Sans KR', 700), fontBuffers)
  assert.ok(normalPixels.some((value) => value > 0))
  assert.notDeepEqual(normalPixels, boldPixels)
  assert.ok(boldPixels.reduce((sum, value) => sum + value, 0) > normalPixels.reduce((sum, value) => sum + value, 0))
})

test('macOS resolves requested families in both system font directories by default', async () => {
  const gothic = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
  const arial = '/System/Library/Fonts/Supplemental/Arial.ttf'
  if (process.platform !== 'darwin' || !existsSync(gothic) || !existsSync(arial)) return
  const svg = textSvg('Apple SD Gothic Neo, Arial, Noto Sans KR', 400)
  const warnings = []
  const system = await prepareFonts(svg, false, warnings)
  const bundled = await prepareFonts(svg, true, warnings)
  for (const path of [gothic, arial]) {
    const { size } = statSync(path)
    const original = readFileSync(path)
    assert.ok(system.fontBuffers.some((font) => font.length === size && original.equals(font)), path)
    assert.ok(!bundled.fontBuffers.some((font) => font.length === size && original.equals(font)), path)
  }
  const systemPixels = alphaPixels(system.svg, system.fontBuffers)
  assert.ok(systemPixels.some((value) => value > 0))
  assert.notDeepEqual(systemPixels, alphaPixels(bundled.svg, bundled.fontBuffers))
})

test('a sanitized embedded WOFF2 is rendered under its declared family and weight', async () => {
  const bold = readFileSync(new URL('../editor/fonts/NotoSansKR-Bold.woff2', import.meta.url)).toString('base64')
  const css = `<style>@font-face{font-family:'Document Face';font-weight:bold;src:url('data:font/woff2;base64,${bold}') format('woff2')}</style>`
  const sanitized = sanitizeSvg(textSvg('Document Face', 700, css), 'embedded-')
  assert.equal(sanitized.fontFaces.length, 1)
  const warnings = []
  const embedded = await prepareFonts(sanitized.svg, true, warnings, sanitized.fontFaces)
  const withoutEmbedded = await prepareFonts(sanitized.svg, true, warnings)
  const bundled = await prepareFonts(textSvg('Noto Sans KR', 700), true, warnings)
  assert.deepEqual(warnings, [])
  const pixels = alphaPixels(embedded.svg, embedded.fontBuffers)
  assert.notDeepEqual(pixels, alphaPixels(withoutEmbedded.svg, withoutEmbedded.fontBuffers))
  assert.deepEqual(pixels, alphaPixels(bundled.svg, bundled.fontBuffers))
})
