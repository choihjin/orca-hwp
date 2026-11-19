#!/usr/bin/env node
// Acceptance check for the renderer (design 5.9) on the public samples in fixtures/.
// Run `npm run fixtures` first. Uses only the expectations stored in scripts/fixtures.json;
// it never runs pdfinfo or pdftotext. Exit code 0 when every sample passes, 1 otherwise.
//
// Per sample:
//   - opens with the same adapter as the viewer (editor/engine/rhwp-adapter.js)
//   - page count equals the reference PDF's (when there is one)
//   - on the check pages, the engine's lines (text runs grouped by baseline, see engineLines)
//     have the same first and last character as the PDF's lines, in the same order
//   - every page goes through renderPageSvg + sanitizeSvg without an exception
//   - the time to the first page (open + render + sanitize page 1) is printed, not judged
//   - a sample marked expectError must fail to open with an EngineError
import { existsSync, readFileSync } from 'node:fs'
import { EngineError, initEngine, openDocument } from '../editor/engine/rhwp-adapter.js'
import { sanitizeSvg } from '../editor/render/sanitize.js'

const config = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'))
const fixturesUrl = new URL('../fixtures/', import.meta.url)
const verbose = process.argv.includes('--verbose')

/** @typedef {import('../editor/engine/rhwp-adapter.js').TextRun} TextRun */

/**
 * Groups a page's text runs into lines by estimated baseline, left to right within a line.
 * A run's `y` is the top of its box; rhwp puts the SVG baseline at about y + 0.85 h. Runs whose
 * baselines are within 3 px of the line's first run share the line.
 *
 * Interim: Task 8's `textLines` (editor/render/text-lines.js) is meant to replace this once it is
 * merged, so the agent path and this check group lines the same way.
 * @param {TextRun[]} runs
 * @returns {string[]} each line's text, trimmed, blank lines dropped
 */
function engineLines(runs) {
  const placed = runs
    .filter((run) => run.text.trim() !== '')
    .map((run) => ({ run, baseline: run.y + run.h * 0.85 }))
    .sort((a, b) => a.baseline - b.baseline || a.run.x - b.run.x)
  /** @type {{ baseline: number, runs: TextRun[] }[]} */
  const lines = []
  for (const { run, baseline } of placed) {
    const line = lines[lines.length - 1]
    if (line && baseline - line.baseline <= 3) line.runs.push(run)
    else lines.push({ baseline, runs: [run] })
  }
  return lines.map((line) =>
    line.runs
      .sort((a, b) => a.x - b.x)
      .map((run) => run.text)
      .join('')
      .trim()
  )
}

/** @param {string} line */
function ends(line) {
  const chars = [...line]
  return `${chars[0]}${chars[chars.length - 1]}`
}

/**
 * Longest common subsequence of line keys, returned as an alignment for the report.
 * @param {string[]} expected
 * @param {string[]} actual
 * @returns {{ matched: number, ops: ({ kind: '=', e: number, a: number } | { kind: '-', e: number } | { kind: '+', a: number })[] }}
 */
function align(expected, actual) {
  const n = expected.length
  const m = actual.length
  const table = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = expected[i] === actual[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  /** @type {any[]} */
  const ops = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && expected[i] === actual[j]) ops.push({ kind: '=', e: i++, a: j++ })
    else if (j < m && (i >= n || table[i][j + 1] >= table[i + 1][j])) ops.push({ kind: '+', a: j++ })
    else ops.push({ kind: '-', e: i++ })
  }
  return { matched: table[0][0], ops }
}

/** @param {string} s @param {number} max */
const clip = (s, max) => ([...s].length > max ? `${[...s].slice(0, max).join('')}…` : s)

/** @param {number} ms */
const msText = (ms) => `${Math.round(ms)} ms`

await initEngine(new Uint8Array(readFileSync(new URL('../editor/vendor/rhwp/rhwp_bg.wasm', import.meta.url))))

/** @type {{ name: string, pages: string, lines: string, render: string, first: string, ok: boolean }[]} */
const rows = []
/** @type {string[]} */
const details = []

for (const sample of config.samples) {
  const url = new URL(encodeURIComponent(sample.file), fixturesUrl)
  const row = { name: sample.name, pages: '-', lines: '-', render: '-', first: '-', ok: false }
  rows.push(row)
  if (!existsSync(url)) {
    row.pages = '파일 없음'
    details.push(`${sample.name}: fixtures/${sample.file} is missing; run npm run fixtures`)
    continue
  }
  const bytes = new Uint8Array(readFileSync(url))

  if (sample.expectError) {
    try {
      openDocument(bytes).dispose()
      row.pages = '열림(오류 기대)'
      details.push(`${sample.name}: opened, but an EngineError was expected`)
    } catch (error) {
      row.ok = error instanceof EngineError
      row.pages = error instanceof EngineError ? `EngineError ${error.code}` : `다른 오류: ${error}`
    }
    continue
  }

  const started = performance.now()
  let doc
  try {
    doc = openDocument(bytes)
  } catch (error) {
    row.pages = error instanceof EngineError ? `열기 실패 ${error.code}` : '열기 실패'
    details.push(`${sample.name}: ${error instanceof Error ? error.message : error}`)
    continue
  }
  try {
    let ok = true
    const pageCount = doc.pageCount
    if (typeof sample.pageCount === 'number') {
      row.pages = `${pageCount}/${sample.pageCount}`
      if (pageCount !== sample.pageCount) ok = false
    } else {
      row.pages = `${pageCount}`
      if (pageCount < 1) ok = false
    }

    // Every page through render + sanitize; page 1 timed as the first view.
    let failures = 0
    let renderMs = 0
    for (let i = 0; i < pageCount; i++) {
      const t = performance.now()
      try {
        sanitizeSvg(doc.renderPageSvg(i), `p${i}-`)
      } catch (error) {
        failures++
        if (failures <= 3) details.push(`${sample.name} page ${i + 1}: ${error instanceof Error ? error.message : error}`)
      }
      const now = performance.now()
      renderMs += now - t
      if (i === 0) row.first = msText(now - started)
    }
    row.render = `${pageCount - failures}/${pageCount} (${msText(renderMs)})`
    if (failures > 0) ok = false

    if (Array.isArray(sample.checks)) {
      const parts = []
      for (const check of sample.checks) {
        if (check.page > pageCount) {
          parts.push(`p${check.page} 없음`)
          ok = false
          continue
        }
        const lines = engineLines(doc.pageTextRuns(check.page - 1))
        const expected = check.lines.map((/** @type {[string, string]} */ pair) => pair.join(''))
        const actual = lines.map(ends)
        const { matched, ops } = align(expected, actual)
        const exact = matched === expected.length && actual.length === expected.length
        parts.push(`p${check.page} ${matched}/${expected.length}${actual.length !== expected.length ? `(엔진 ${actual.length})` : ''}`)
        if (!exact) {
          ok = false
          const misses = ops.filter((op) => op.kind !== '=')
          const shown = verbose ? misses : misses.slice(0, 6)
          details.push(
            `${sample.name} page ${check.page}: ${matched} of ${expected.length} PDF lines matched, engine has ${actual.length} lines` +
              shown
                .map((op) =>
                  op.kind === '-'
                    ? `\n    PDF only    line ${op.e + 1}: first "${check.lines[op.e][0]}" last "${check.lines[op.e][1]}"`
                    : `\n    engine only line ${op.a + 1}: ${clip(lines[op.a], 40)}`
                )
                .join('') +
              (shown.length < misses.length ? `\n    … ${misses.length - shown.length} more (--verbose)` : '')
          )
        }
      }
      row.lines = parts.join(', ')
    }
    row.ok = ok
  } finally {
    doc.dispose()
  }
}

const header = { name: '표본', pages: '쪽(엔진/기대)', lines: '줄 첫·끝 글자(일치/기대)', render: '렌더+정화', first: '첫 쪽', ok: '판정' }
/** @param {string} s */
const width = (s) => [...s].reduce((w, c) => w + (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(c) ? 2 : 1), 0)
/** @param {string} s @param {number} w */
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)))
const table = [header, ...rows.map((r) => ({ ...r, ok: r.ok ? '합격' : '불합격' }))]
/** @type {(keyof typeof header)[]} */
const columns = ['name', 'pages', 'lines', 'render', 'first', 'ok']
const widths = columns.map((c) => Math.max(...table.map((r) => width(String(r[c])))))
for (const r of table) console.log(columns.map((c, k) => pad(String(r[c]), widths[k])).join(' | '))
if (details.length > 0) console.log(`\n${details.join('\n')}`)
const failed = rows.filter((r) => !r.ok).length
console.log(`\n${rows.length - failed}/${rows.length} 합격`)
process.exit(failed === 0 ? 0 : 1)
