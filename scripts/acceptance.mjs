#!/usr/bin/env node
// Acceptance check for the renderer (design 5.9) on the public samples in fixtures/.
// Run `npm run fixtures` first. Uses only the expectations stored in scripts/fixtures.json;
// it never runs pdfinfo or pdftotext. Exit code 0 when every sample passes, 1 otherwise.
//
// Per sample:
//   - opens with the same adapter as the viewer (editor/engine/rhwp-adapter.js)
//   - page count equals the reference PDF's (when there is one)
//   - on the check pages, the engine's lines (text runs grouped by agent/text-lines.js textLines)
//     have the same first and last character as the PDF's lines, in the same order
//   - every page goes through renderPageSvg + sanitizeSvg without an exception
//   - the time to the first page (open + render + sanitize page 1) is printed, not judged
//   - a sample marked expectError must fail to open with an EngineError
//
// Known differences: a sample's `knownDifferences` in fixtures.json lists check pages whose line
// differences were confirmed by hand, each { page, kind: 'engine' | 'comparison', reason, evidence }.
// 'engine' is a real rendering difference of rhwp; 'comparison' is how pdftotext -layout splits
// rows. A listed page that still differs is reported as a known difference and does not fail; an
// unlisted difference fails; a listed page that now matches gets a '해결됨' warning (not a failure).
// Known engine differences are summarised again at the very end so they cannot be overlooked.
import { existsSync, readFileSync } from 'node:fs'
import { ENGINE_INFO, EngineError, initEngine, openDocument } from '../editor/engine/rhwp-adapter.js'
import { sanitizeSvg } from '../editor/render/sanitize.js'
import { textLines } from '../agent/text-lines.js'

const config = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'))
const fixturesUrl = new URL('../fixtures/', import.meta.url)
const verbose = process.argv.includes('--verbose')

/** @typedef {{ page: number, kind: 'engine' | 'comparison', reason: string, evidence: string }} KnownDifference */

/** @typedef {import('../editor/engine/rhwp-adapter.js').TextRun} TextRun */

/**
 * A page's lines, grouped by the same rule as the agent path (agent/text-lines.js), so this check
 * and `agent-view.mjs --text` split lines alike.
 * @param {TextRun[]} runs
 * @returns {string[]}
 */
const engineLines = (runs) => textLines(runs)

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

/** @type {{ name: string, pages: string, lines: string, render: string, first: string, ok: boolean, known: number }[]} */
const rows = []
/** @type {string[]} */
const details = []
/** @type {string[]} */
const warnings = []
/** @type {{ sample: string, page: number, reason: string, matched: number, expected: number, engine: number }[]} */
const engineDifferences = []

for (const sample of config.samples) {
  const url = new URL(encodeURIComponent(sample.file), fixturesUrl)
  const row = { name: sample.name, pages: '-', lines: '-', render: '-', first: '-', ok: false, known: 0 }
  rows.push(row)
  /** @type {KnownDifference[]} */
  const known = Array.isArray(sample.knownDifferences) ? sample.knownDifferences : []
  const checkPages = Array.isArray(sample.checks) ? sample.checks.map((/** @type {{ page: number }} */ c) => c.page) : []
  const badEntries = known.filter(
    (k) => !checkPages.includes(k.page) || !['engine', 'comparison'].includes(k.kind) || !k.reason || !k.evidence
  )
  if (badEntries.length > 0) {
    row.pages = 'knownDifferences 오류'
    details.push(`${sample.name}: knownDifferences needs { page (a check page), kind 'engine'|'comparison', reason, evidence }: ${JSON.stringify(badEntries)}`)
    continue
  }
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
        const listed = known.filter((k) => k.page === check.page)
        const kinds = [...new Set(listed.map((k) => k.kind))].join('+')
        const count = `${matched}/${expected.length}${actual.length !== expected.length ? `(엔진 ${actual.length})` : ''}`
        if (exact && listed.length > 0) {
          parts.push(`p${check.page} ${count} 해결됨`)
          warnings.push(`경고: ${sample.name} page ${check.page} now matches; remove its knownDifferences (${kinds}) if this holds`)
        } else if (!exact && listed.length > 0) {
          parts.push(`p${check.page} ${count} 알려진 차이(${kinds})`)
          row.known++
          for (const k of listed) {
            details.push(`${sample.name} page ${check.page}: 알려진 차이(${k.kind}) ${k.reason}`)
            if (k.kind === 'engine') {
              engineDifferences.push({ sample: sample.name, page: check.page, reason: k.reason, matched, expected: expected.length, engine: actual.length })
            }
          }
        } else {
          parts.push(`p${check.page} ${count}`)
        }
        if (!exact && (listed.length === 0 || verbose)) {
          if (listed.length === 0) ok = false
          const misses = ops.filter((op) => op.kind !== '=')
          const shown = verbose ? misses : misses.slice(0, 6)
          details.push(
            `${sample.name} page ${check.page}: ${listed.length === 0 ? '목록에 없는 차이, ' : ''}${matched} of ${expected.length} PDF lines matched, engine has ${actual.length} lines` +
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
const table = [header, ...rows.map((r) => ({ ...r, ok: r.ok ? (r.known > 0 ? `합격(알려진 차이 ${r.known}쪽)` : '합격') : '불합격' }))]
/** @type {(keyof typeof header)[]} */
const columns = ['name', 'pages', 'lines', 'render', 'first', 'ok']
const widths = columns.map((c) => Math.max(...table.map((r) => width(String(r[c])))))
for (const r of table) console.log(columns.map((c, k) => pad(String(r[c]), widths[k])).join(' | '))
if (details.length > 0) console.log(`\n${details.join('\n')}`)
if (warnings.length > 0) console.log(`\n${warnings.join('\n')}`)
const failed = rows.filter((r) => !r.ok).length
console.log(`\n${rows.length - failed}/${rows.length} 합격`)
console.log(`\n알려진 엔진 차이 (rhwp ${ENGINE_INFO.version}, 합격으로 세지만 렌더가 기준 PDF와 다름): ${engineDifferences.length}건`)
for (const d of engineDifferences) {
  console.log(`  - ${d.sample} ${d.page}쪽 (줄 ${d.matched}/${d.expected}, 엔진 ${d.engine}줄): ${d.reason}`)
}
process.exit(failed === 0 ? 0 : 1)
