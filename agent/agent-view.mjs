import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ENGINE_INFO, initEngine, openDocument } from '../editor/engine/rhwp-adapter.js'
import { sanitizeSvg } from '../editor/render/sanitize.js'
import { cropPng } from './crop-png.mjs'
import { prepareFonts } from './font-loader.js'
import { textLines } from './text-lines.js'

const engineWasm = new URL('../editor/vendor/rhwp/rhwp_bg.wasm', import.meta.url)
const resvgWasm = new URL('./vendor/resvg/index_bg.wasm', import.meta.url)
const usage = 'Usage: node agent-view.mjs <file> [--page N] [--region x,y,w,h] [--scale S] [--out PATH] [--text] [--json] [--bundled-fonts-only]'

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
    json: values.json,
    bundledFontsOnly: values['bundled-fonts-only']
  }
}

function scaledDimensions({ width, height }, scale) {
  const pixelWidth = Math.max(1, Math.round(width * scale))
  const pixelHeight = Math.max(1, Math.round(height * scale))
  if (![pixelWidth, pixelHeight].every(Number.isSafeInteger)) {
    throw new CliError('invalid-argument', 'Scaled PNG dimensions are too large')
  }
  return { width: pixelWidth, height: pixelHeight }
}

function prepareSvg(svg, { width, height }) {
  const root = /<svg(?=\s|>)(?:[^"'<>]|"[^"]*"|'[^']*')*>/.exec(svg)
  if (!root) throw new CliError('render-failed', 'The page SVG has no root element')
  const attributes = root[0].slice(4, -1).replace(
    /\s+([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/g,
    (attribute, name) => {
      if (name === 'width' || name === 'height' || name === 'preserveAspectRatio') return ''
      return attribute
    }
  )
  const viewport = `width="${width}" height="${height}" preserveAspectRatio="none"`
  return svg.replace(root[0], `<svg${attributes} ${viewport}>`)
}

async function renderPng(svg, fontBuffers, crop) {
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
  const rendered = crop
    ? { pixels: image.pixels, width: image.width, height: image.height }
    : image.asPng()
  try {
    return crop ? cropPng(rendered, crop) : rendered
  } finally {
    image.free()
    renderer.free()
  }
}

async function renderPage(options) {
  const { file, page, region, scale, bundledFontsOnly } = options
  const bytes = readFileSync(file)
  await initEngine(readFileSync(engineWasm))
  const doc = openDocument(bytes)
  try {
    if (page < 1 || page > doc.pageCount) {
      throw new CliError('page-out-of-range', `Page ${page} is outside the document (${doc.pageCount} pages)`)
    }
    const index = page - 1
    const pageSize = doc.pageSize(index)
    const result = sanitizeSvg(doc.renderPageSvg(index), `p${index}-`)
    const warnings = [...result.warnings]
    const crop = region && {
      x: Math.round(region.x * scale),
      y: Math.round(region.y * scale),
      ...scaledDimensions(region, scale)
    }
    // Moving the SVG viewBox can trap inside resvg. Use the same viewport as a
    // whole-page render and crop its pixels afterwards.
    const svg = prepareSvg(result.svg, scaledDimensions(pageSize, scale))
    const fonts = await prepareFonts(svg, bundledFontsOnly, warnings)
    const text = options.text ? textLines(doc.pageTextRuns(index)) : undefined
    const pngBytes = await renderPng(fonts.svg, fonts.fontBuffers, crop)
    const png = options.out
      ? resolve(options.out)
      : join(mkdtempSync(join(tmpdir(), 'hwp-agent-view-')), `page-${page}.png`)
    writeFileSync(png, pngBytes)
    return { file, pageCount: doc.pageCount, page, pageSize, png, text, engine: ENGINE_INFO, warnings }
  } finally {
    doc.dispose()
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
