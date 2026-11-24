import {
  closeSync, constants, fstatSync, ftruncateSync, mkdtempSync, openSync,
  readFileSync, realpathSync, statSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { locateThreads } from '../editor/engine/memo-locate.js'
import { memoMarks } from '../editor/engine/memo-marks.js'
import { fullDate, problemText, publicThread } from '../editor/engine/memo-threads.js'
import { ENGINE_INFO, initEngine, openDocument } from '../editor/engine/rhwp-adapter.js'
import { sanitizeSvg } from '../editor/render/sanitize.js'
import { cropPng } from './crop-png.mjs'
import { prepareFonts } from './font-loader.js'
import { memoOverlay } from './memo-overlay.js'
import { textLines } from './text-lines.js'

const engineWasm = new URL('../editor/vendor/rhwp/rhwp_bg.wasm', import.meta.url)
const resvgWasm = new URL('./vendor/resvg/index_bg.wasm', import.meta.url)
const maxPixels = 16 * 1024 * 1024 // 64 MiB of RGBA pixels per bitmap.
const usage = 'Usage: node agent-view.mjs <file> [--page N] [--region x,y,w,h] [--scale S] [--out PATH] [--text] [--memos] [--json] [--bundled-fonts-only]'

class CliError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function readOptions(args) {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        page: { type: 'string', default: '1' },
        region: { type: 'string' },
        scale: { type: 'string', default: '1.5' },
        out: { type: 'string' },
        text: { type: 'boolean' },
        memos: { type: 'boolean' },
        json: { type: 'boolean' },
        'bundled-fonts-only': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
      }
    })
  } catch (error) {
    throw new CliError('invalid-argument', error.message)
  }
  const { positionals, values } = parsed
  if (values.help) return { help: true }
  if (positionals.length !== 1 || !positionals[0] || values.out === '') {
    throw new CliError('invalid-argument', usage)
  }

  const page = Number(values.page)
  if (!/^\d+$/.test(values.page) || !Number.isSafeInteger(page)) {
    throw new CliError('invalid-argument', '--page must be an integer')
  }
  const scale = Number(values.scale)
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new CliError('invalid-argument', '--scale must be a positive number')
  }

  let region
  if (values.region !== undefined) {
    const parts = values.region.split(',').map((part) => part.trim())
    const [x, y, width, height] = parts.map(Number)
    if (parts.length !== 4 || parts.some((part) => !part) ||
        ![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new CliError('invalid-argument', '--region must be x,y,w,h with nonnegative x,y and positive w,h')
    }
    region = { x, y, width, height }
  }

  return {
    file: resolve(positionals[0]),
    page,
    scale,
    region,
    out: values.out,
    text: values.text,
    memos: values.memos,
    json: values.json,
    bundledFontsOnly: values['bundled-fonts-only']
  }
}

function scaledDimensions({ width, height }, scale) {
  const pixelWidth = Math.max(1, Math.round(width * scale))
  const pixelHeight = Math.max(1, Math.round(height * scale))
  const pixels = pixelWidth * pixelHeight
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    throw new CliError('invalid-argument', `Scaled bitmap exceeds the ${maxPixels}-pixel limit`)
  }
  return { width: pixelWidth, height: pixelHeight }
}

function rejectInputAsOutput(input, output) {
  if (output && input.dev === output.dev && input.ino === output.ino) {
    throw new CliError('invalid-argument', '--out refers to the input document')
  }
}

function readInput(file, out) {
  const fd = openSync(file, 'r')
  try {
    const stat = fstatSync(fd, { bigint: true })
    if (out) {
      const output = statSync(out, { bigint: true, throwIfNoEntry: false })
      if (output && realpathSync(out) === realpathSync(file)) {
        throw new CliError('invalid-argument', '--out refers to the input document')
      }
      rejectInputAsOutput(stat, output)
    }
    return { bytes: readFileSync(fd), stat }
  } finally {
    closeSync(fd)
  }
}

function writePng(path, bytes, inputStat) {
  // Opening without O_TRUNC lets us check the actual target even if a link
  // changed between the initial check and this write.
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT)
  try {
    const output = fstatSync(fd, { bigint: true })
    rejectInputAsOutput(inputStat, output)
    if (output.isFile()) ftruncateSync(fd, 0)
    writeFileSync(fd, bytes)
  } finally {
    closeSync(fd)
  }
}

function prepareSvg(svg, { width, height }, viewBox) {
  const root = /<svg(?=\s|>)(?:[^"'<>]|"[^"]*"|'[^']*')*>/.exec(svg)
  if (!root) throw new CliError('render-failed', 'The page SVG has no root element')
  const attributes = root[0].slice(4, -1).replace(
    /\s+([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/g,
    (attribute, name) => {
      if (name === 'width' || name === 'height' || name === 'preserveAspectRatio' ||
          (viewBox && name === 'viewBox')) return ''
      return attribute
    }
  )
  const viewport = `width="${width}" height="${height}" preserveAspectRatio="none"`
  const box = viewBox ? ` viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"` : ''
  return svg.replace(root[0], `<svg${attributes} ${viewport}${box}>`)
}

function prepareRegion(svg, region, pageSize, pixels) {
  const visible = {
    ...region,
    width: Math.min(region.width, pageSize.width - region.x),
    height: Math.min(region.height, pageSize.height - region.y)
  }
  const dimensions = {
    width: Math.max(1, Math.round(pixels.width * (visible.width / region.width))),
    height: Math.max(1, Math.round(pixels.height * (visible.height / region.height)))
  }
  const pad = dimensions.width < pixels.width || dimensions.height < pixels.height
    ? { x: 0, y: 0, ...pixels }
    : undefined

  // resvg 0.34 traps when an isolated layer lies beyond its internal render
  // bounds. Skip rhwp's offscreen rectangle clips (including image viewports)
  // and use the output viewport itself when it is wholly inside a clip.
  const rectClips = new Map([...svg.matchAll(/<clipPath id="([^"]+)"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"\/><\/clipPath>/g)]
    .map(([, id, ...bounds]) => [id, bounds.map(Number)]))
  const right = visible.x + visible.width
  const bottom = visible.y + visible.height
  const disjoint = ([x, y, w, h]) =>
    x >= right || y >= bottom || x + w <= visible.x || y + h <= visible.y
  const anchor = `<rect x="${visible.x}" y="${visible.y}" width="${visible.width}" height="${visible.height}" fill="#000" fill-opacity="0"/>`
  const cropped = svg.replace(/<g clip-path="url\(#([^"]+)\)">/g, (tag, id) => {
    const bounds = rectClips.get(id)
    if (!bounds) return tag
    if (disjoint(bounds)) return '<g display="none">'
    const [x, y, w, h] = bounds
    if (x <= visible.x && y <= visible.y && x + w >= right && y + h >= bottom) return '<g>'
    // Preserve partially visible clips and give their layers transparent
    // content in the crop so the layer bounds intersect the viewport.
    return tag + anchor
  }).replace(
    /<svg x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" viewBox="[^"]+" preserveAspectRatio="none">/g,
    (tag, x, y, w, h) => disjoint([x, y, w, h].map(Number)) ? tag.slice(0, -1) + ' display="none">' : tag
  )
  return { svg: prepareSvg(cropped, dimensions, visible), pad }
}

async function renderPng(svg, fontBuffers, pad) {
  const { initWasm, Resvg } = await import('./vendor/resvg/index.mjs')
  await initWasm(readFileSync(resvgWasm))
  const renderer = new Resvg(svg, {
    background: 'white',
    font: {
      fontBuffers,
      defaultFontFamily: 'Noto Serif KR',
      serifFamily: 'Noto Serif KR',
      sansSerifFamily: 'Noto Sans KR',
      monospaceFamily: 'D2Coding'
    }
  })
  // A WASM trap can leave the renderer borrowed. Freeing it after a trap masks the
  // original error, so release the objects only after the WASM calls succeed.
  const image = renderer.render()
  const rendered = pad
    ? { pixels: image.pixels, width: image.width, height: image.height }
    : image.asPng()
  try {
    return pad ? cropPng(rendered, pad) : rendered
  } finally {
    image.free()
    renderer.free()
  }
}

function readPageMemos(doc, index, pageSize, region, warnings) {
  try {
    const { threads, problems } = doc.memos()
    for (const problem of problems) warnings.push(problemText(problem))
    locateThreads(doc, threads, { verify: true })
    const selected = threads.filter((thread) => thread.page === index + 1 && thread.located)
    const overlay = selected.length
      ? memoOverlay(memoMarks(selected, doc.pageAnchorRuns(index), index), pageSize, region)
      : ''
    return { memos: threads.map(publicThread), overlay }
  } catch {
    warnings.push('메모를 읽지 못함')
    return { overlay: '' }
  }
}

async function renderPage(options) {
  const { file, page, region, scale, bundledFontsOnly } = options
  const outputPath = options.out && resolve(options.out)
  const { bytes, stat } = readInput(file, outputPath)
  await initEngine(readFileSync(engineWasm))
  const doc = openDocument(bytes)
  try {
    if (page < 1 || page > doc.pageCount) {
      throw new CliError('page-out-of-range', `Page ${page} is outside the document (${doc.pageCount} pages)`)
    }
    const index = page - 1
    const pageSize = doc.pageSize(index)
    if (region && (region.x >= pageSize.width || region.y >= pageSize.height)) {
      throw new CliError('region-out-of-page', '--region does not overlap the page')
    }
    const dimensions = scaledDimensions(region ?? pageSize, scale)
    const result = sanitizeSvg(doc.renderPageSvg(index), `p${index}-`)
    const warnings = [...result.warnings]
    const { memos, overlay } = options.memos
      ? readPageMemos(doc, index, pageSize, region, warnings)
      : { overlay: '' }
    const end = overlay ? result.svg.lastIndexOf('</svg>') : -1
    const svg = end < 0 ? result.svg : result.svg.slice(0, end) + overlay + result.svg.slice(end)
    const viewport = region
      ? prepareRegion(svg, region, pageSize, dimensions)
      : { svg: prepareSvg(svg, dimensions) }
    const fonts = await prepareFonts(viewport.svg, bundledFontsOnly, warnings, result.fontFaces)
    const text = options.text ? textLines(doc.pageTextRuns(index)) : undefined
    const pngBytes = await renderPng(fonts.svg, fonts.fontBuffers, viewport.pad)
    const png = outputPath ?? join(mkdtempSync(join(tmpdir(), 'hwp-agent-view-')), `page-${page}.png`)
    writePng(png, pngBytes, stat)
    return { file, pageCount: doc.pageCount, page, pageSize, png, text, engine: ENGINE_INFO, warnings, memos }
  } finally {
    doc.dispose()
  }
}

function printMemos(threads) {
  for (const { number, page, anchorText, memos } of threads) {
    const location = page === null ? '위치 미상' : `${page}쪽`
    for (const memo of memos) {
      const line = `${number} · ${location} · ${memo.author} · ${fullDate(memo)} · "${anchorText}" → ${memo.text ?? ''}`
      console.log(line.replace(/[\r\n\u2028\u2029]+/g, ' '))
    }
  }
}

const args = process.argv.slice(2)
let json = args.slice(0, args.includes('--') ? args.indexOf('--') : args.length).includes('--json')
try {
  const options = readOptions(args)
  if (options.help) {
    console.log(usage)
  } else {
    json = options.json
    const result = await renderPage(options)
    if (json) {
      console.log(JSON.stringify(result))
    } else {
      console.log(result.png)
      printMemos(result.memos ?? [])
      for (const line of result.text ?? []) console.log(line)
      for (const warning of result.warnings) console.error(warning)
    }
  }
} catch (error) {
  const code = error?.code ?? 'render-failed'
  const message = error instanceof Error ? error.message : String(error)
  if (json) {
    console.log(JSON.stringify({ error: { code, message } }))
  } else {
    console.error(`${code}: ${message}`)
  }
  process.exitCode = 1
}
