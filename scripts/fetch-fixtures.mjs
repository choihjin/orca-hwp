#!/usr/bin/env node
// Downloads the public samples listed in scripts/fixtures.json into fixtures/ (git-ignored),
// checks each file's size and sha256, and makes the derived samples (a truncated HWP).
// Exit code 1 when a download fails or a file does not match its pin.
//
//   node scripts/fetch-fixtures.mjs                    download and verify
//   node scripts/fetch-fixtures.mjs --update-expected  also recompute the PDF expectations
//
// --update-expected needs poppler's pdfinfo and pdftotext (see scripts/README.md). The
// acceptance check itself never runs them: it only reads the values stored in fixtures.json.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const configUrl = new URL('./fixtures.json', import.meta.url)
const fixturesUrl = new URL('../fixtures/', import.meta.url)
const config = JSON.parse(readFileSync(configUrl, 'utf8'))

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** @param {string} name */
const localPath = (name) => fileURLToPath(new URL(encodeURIComponent(name), fixturesUrl))

/**
 * @param {string} name
 * @param {{ path: string, size: number, sha256: string, rawBase?: string }} pin
 * @returns {Promise<string | null>} an error message, or null when the file is in place
 */
async function ensure(name, pin) {
  const target = localPath(name)
  if (existsSync(target)) {
    const bytes = readFileSync(target)
    if (bytes.length === pin.size && sha256(bytes) === pin.sha256) {
      console.log(`ok       ${name}`)
      return null
    }
    console.log(`refetch  ${name} (local copy does not match its pin)`)
  }
  const url = (pin.rawBase ?? config.source.rawBase) + pin.path.split('/').map(encodeURIComponent).join('/')
  let bytes
  try {
    const response = await fetch(url)
    if (!response.ok) return `${name}: HTTP ${response.status} from ${url}`
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    return `${name}: ${error instanceof Error ? error.message : error} (${url})`
  }
  const actual = sha256(bytes)
  if (bytes.length !== pin.size || actual !== pin.sha256) {
    return `${name}: got ${bytes.length} B sha256 ${actual}, expected ${pin.size} B sha256 ${pin.sha256}`
  }
  writeFileSync(`${target}.part`, bytes)
  renameSync(`${target}.part`, target)
  console.log(`fetched  ${name} (${bytes.length} B)`)
  return null
}

/**
 * @param {string} name
 * @param {{ from: string, take: string }} spec
 */
function derive(name, spec) {
  if (spec.take !== 'first-half') throw new Error(`unknown derivation ${spec.take} for ${name}`)
  const source = readFileSync(localPath(spec.from))
  writeFileSync(localPath(name), source.subarray(0, source.length >> 1))
  console.log(`derived  ${name} (first ${source.length >> 1} of ${source.length} B of ${spec.from})`)
}

/**
 * Lines of one PDF page as `pdftotext -layout` lays them out: each non-blank line's first and last
 * character after trimming. Characters are code points, so a surrogate pair counts as one.
 * Known limits of -layout rows (see scripts/README.md): a word on the same baseline can be put on a
 * row of its own, and a vertically centred table cell joins a neighbouring row.
 * @param {string} pdf
 * @param {number} page 1-based
 * @returns {[string, string][]}
 */
function pdfLines(pdf, page) {
  const text = execFileSync('pdftotext', ['-layout', '-f', String(page), '-l', String(page), pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  /** @type {[string, string][]} */
  const lines = []
  for (const raw of text.split(/[\n\f]/)) {
    const chars = [...raw.trim()]
    if (chars.length > 0) lines.push([chars[0], chars[chars.length - 1]])
  }
  return lines
}

/** @param {string} pdf */
function pdfPageCount(pdf) {
  const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })
  const match = /^Pages:\s+(\d+)/m.exec(info)
  if (!match) throw new Error(`pdfinfo gave no page count for ${pdf}`)
  return Number(match[1])
}

/**
 * JSON with arrays of plain values on one line, so expectations stay readable in review.
 * @param {unknown} value
 * @param {string} indent
 * @returns {string}
 */
function format(value, indent = '') {
  const inner = `${indent}  `
  /** @param {unknown[]} a */
  const flat = (a) => a.every((v) => v === null || typeof v !== 'object')
  /** @param {unknown[]} a */
  const oneLine = (a) => `[${a.map((v) => JSON.stringify(v)).join(', ')}]`
  if (Array.isArray(value)) {
    if (flat(value)) return oneLine(value)
    if (value.every((v) => Array.isArray(v) && flat(v))) {
      return `[\n${value.map((v) => inner + oneLine(v)).join(',\n')}\n${indent}]`
    }
    return `[\n${value.map((v) => inner + format(v, inner)).join(',\n')}\n${indent}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`)
    return `{\n${entries.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

function updateExpected() {
  const probe = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' })
  const version = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.split('\n')[0].trim()
  for (const sample of config.samples) {
    if (!sample.pdf) continue
    const pdf = localPath(sample.pdf)
    sample.pageCount = pdfPageCount(pdf)
    sample.checks = sample.checkPages.map((/** @type {number} */ page) => ({ page, lines: pdfLines(pdf, page) }))
    const lineCount = sample.checks.reduce((n, /** @type {{ lines: unknown[] }} */ c) => n + c.lines.length, 0)
    console.log(`expected ${sample.file}: ${sample.pageCount} pages, ${lineCount} lines on pages ${sample.checkPages.join(', ')}`)
  }
  config.expectedBy = `pdfinfo (Pages) and pdftotext -layout, ${version || 'version unknown'}`
  writeFileSync(configUrl, `${format(config)}\n`)
}

mkdirSync(fixturesUrl, { recursive: true })
const errors = []
for (const [name, pin] of Object.entries(config.files)) {
  const error = await ensure(name, pin)
  if (error) errors.push(error)
}
if (errors.length === 0) {
  for (const [name, spec] of Object.entries(config.derived ?? {})) derive(name, spec)
  if (process.argv.includes('--update-expected')) updateExpected()
}
if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL     ${error}`)
  process.exit(1)
}
