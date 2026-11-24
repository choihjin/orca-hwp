import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { assert, test } from 'orca/testing'
import { sanitizeSvg } from '../editor/render/sanitize.js'
import { prepareFonts } from './font-loader.js'
import { hasRequestedFamily } from './sfnt.js'
import { initWasm, Resvg } from './vendor/resvg/index.mjs'
import { decodeWoff2 } from './woff2.js'

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

// Build WOFF1 from a real font so both the compressed and uncompressed tables
// in the result describe a valid face.
function wrapWoff1(font) {
  const count = font.readUInt16BE(4)
  const header = Buffer.alloc(44 + count * 20)
  header.write('wOFF')
  font.copy(header, 4, 0, 4)
  header.writeUInt16BE(count, 12)
  const tables = []
  let offset = header.length
  let decodedSize = 12 + count * 16
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    const start = font.readUInt32BE(record + 8)
    const length = font.readUInt32BE(record + 12)
    const data = font.subarray(start, start + length)
    const compressed = deflateSync(data)
    const stored = compressed.length < length ? compressed : data
    const padded = Buffer.alloc(Math.ceil(stored.length / 4) * 4)
    stored.copy(padded)
    const entry = 44 + i * 20
    font.copy(header, entry, record, record + 4)
    header.writeUInt32BE(offset, entry + 4)
    header.writeUInt32BE(stored.length, entry + 8)
    header.writeUInt32BE(length, entry + 12)
    font.copy(header, entry + 16, record + 4, record + 8)
    tables.push(padded)
    decodedSize += Math.ceil(length / 4) * 4
    offset += padded.length
  }
  header.writeUInt32BE(offset, 8)
  header.writeUInt32BE(decodedSize, 16)
  return Buffer.concat([header, ...tables])
}

test('a sanitized embedded WOFF1 renders the same pixels as the original face', async () => {
  const bold = await decodeWoff2(readFileSync(new URL('../editor/fonts/NotoSansKR-Bold.woff2', import.meta.url)))
  const woff = wrapWoff1(Buffer.from(bold)).toString('base64')
  const css = `<style>@font-face{font-family:'Document Face';font-weight:700;src:url(data:font/woff;base64,${woff}) format('woff')}</style>`
  const sanitized = sanitizeSvg(textSvg('Document Face', 700, css), 'woff-')
  const warnings = []
  const embedded = await prepareFonts(sanitized.svg, true, warnings, sanitized.fontFaces)
  const bundled = await prepareFonts(textSvg('Noto Sans KR', 700), true, warnings)
  assert.deepEqual(warnings, [])
  assert.deepEqual(alphaPixels(embedded.svg, embedded.fontBuffers), alphaPixels(bundled.svg, bundled.fontBuffers))
})

test('an embedded font limited to U+0041 never draws Hangul', async () => {
  const bold = readFileSync(new URL('../editor/fonts/NotoSansKR-Bold.woff2', import.meta.url)).toString('base64')
  const css = `<style>@font-face{font-family:'Restricted';font-weight:700;unicode-range:U+0041;src:url(data:font/woff2;base64,${bold})}</style>`
  const sanitized = sanitizeSvg(textSvg('Restricted,Noto Serif KR', 700, css), 'range-')
  const warnings = []
  const limited = await prepareFonts(sanitized.svg, true, warnings, sanitized.fontFaces)
  const fallback = await prepareFonts(sanitized.svg, true, [])
  assert.ok(warnings.some((warning) => warning.includes('unicode-range')))
  assert.deepEqual(alphaPixels(limited.svg, limited.fontBuffers), alphaPixels(fallback.svg, fallback.fontBuffers))
})

test('truncated TTC offsets and an out-of-file name table report malformed fonts', () => {
  const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url))
  mkdirSync(fixtures, { recursive: true })
  const dir = mkdtempSync(join(fixtures, 'agent-fonts-'))
  try {
    const ttcPath = join(dir, 'truncated.ttc')
    const ttc = Buffer.alloc(12)
    ttc.write('ttcf')
    ttc.writeUInt32BE(0x00010000, 4)
    ttc.writeUInt32BE(1024, 8)
    writeFileSync(ttcPath, ttc)
    assert.throws(() => hasRequestedFamily(ttcPath, new Set(['example'])), /outside the font file/)

    const ttfPath = join(dir, 'truncated.ttf')
    const ttf = Buffer.alloc(28)
    ttf.writeUInt32BE(0x00010000)
    ttf.writeUInt16BE(1, 4)
    ttf.write('name', 12)
    ttf.writeUInt32BE(28, 20)
    ttf.writeUInt32BE(65536, 24)
    writeFileSync(ttfPath, ttf)
    assert.throws(() => hasRequestedFamily(ttfPath, new Set(['example'])), /outside the font file/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
