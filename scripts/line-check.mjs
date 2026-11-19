// Line comparison and the known-difference rule for scripts/acceptance.mjs, kept apart so the
// rule has unit tests (scripts/line-check.test.mjs).

/**
 * One line that did not match, by side and position: `["pdf", n, first, last]` is the PDF's n-th
 * line (1-based) with no engine counterpart, `["engine", n, first, last]` the engine's n-th line
 * with no PDF counterpart. Positions come from the alignment below, so a difference that moves
 * to another line is a different item.
 * @typedef {['pdf' | 'engine', number, string, string]} DiffItem
 */

/**
 * @typedef {{ page: number, kind: 'engine' | 'comparison', reason: string, evidence: string,
 *   lines: DiffItem[] }} KnownDifference
 */

/** @param {string} line @returns {[string, string]} first and last character (code points) */
export function ends(line) {
  const chars = [...line]
  return [chars[0] ?? '', chars[chars.length - 1] ?? '']
}

/**
 * Longest common subsequence of line keys, as an alignment. Deterministic: on ties an engine-only
 * line is taken before a PDF-only one.
 * @param {string[]} expected
 * @param {string[]} actual
 * @returns {{ matched: number, ops: ({ kind: '=', e: number, a: number } | { kind: '-', e: number } | { kind: '+', a: number })[] }}
 */
export function align(expected, actual) {
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

/**
 * @param {[string, string][]} expected the PDF's lines as [first, last]
 * @param {string[]} actualLines the engine's line texts
 * @returns {{ matched: number, engineLines: number, diff: DiffItem[] }}
 */
export function lineDiff(expected, actualLines) {
  const actual = actualLines.map(ends)
  const { matched, ops } = align(
    expected.map((pair) => pair.join('\u0000')),
    actual.map((pair) => pair.join('\u0000'))
  )
  /** @type {DiffItem[]} */
  const diff = []
  for (const op of ops) {
    if (op.kind === '-') diff.push(['pdf', op.e + 1, expected[op.e][0], expected[op.e][1]])
    else if (op.kind === '+') diff.push(['engine', op.a + 1, actual[op.a][0], actual[op.a][1]])
  }
  return { matched, engineLines: actual.length, diff }
}

/** @param {DiffItem} item */
export const itemKey = (item) => JSON.stringify(item)

/** @param {DiffItem} item */
export const itemText = ([side, n, first, last]) => `${side === 'pdf' ? 'PDF' : '엔진'} ${n}줄 "${first}…${last}"`

/**
 * Judges one check page against its known differences.
 *   match     no difference and nothing listed
 *   resolved  no difference, but entries are listed (warning: remove them)
 *   fail      a difference not listed, on an unlisted page or at a new position/character
 *   known     exactly the listed lines differ
 *   improved  only some of the listed lines still differ (warning: shrink the list)
 * @param {DiffItem[]} diff
 * @param {KnownDifference[]} entries the page's entries
 * @returns {{ status: 'match' | 'resolved' | 'fail' | 'known' | 'improved', unexpected: DiffItem[], gone: DiffItem[] }}
 */
export function judgePage(diff, entries) {
  const listed = entries.flatMap((entry) => entry.lines)
  const listedKeys = new Set(listed.map(itemKey))
  const diffKeys = new Set(diff.map(itemKey))
  const unexpected = diff.filter((item) => !listedKeys.has(itemKey(item)))
  const gone = listed.filter((item) => !diffKeys.has(itemKey(item)))
  if (diff.length === 0) return { status: entries.length > 0 ? 'resolved' : 'match', unexpected, gone }
  if (unexpected.length > 0) return { status: 'fail', unexpected, gone }
  return { status: gone.length > 0 ? 'improved' : 'known', unexpected, gone }
}

/**
 * Checks the shape of a sample's knownDifferences; returns a message per bad entry.
 * @param {unknown[]} entries
 * @param {number[]} checkPages
 * @returns {string[]}
 */
export function badEntries(entries, checkPages) {
  /** @type {string[]} */
  const problems = []
  for (const entry of entries) {
    const e = /** @type {Partial<KnownDifference>} */ (entry)
    const lines = Array.isArray(e.lines) ? e.lines : null
    const linesOk =
      lines !== null &&
      lines.length > 0 &&
      lines.every(
        (item) =>
          Array.isArray(item) &&
          item.length === 4 &&
          (item[0] === 'pdf' || item[0] === 'engine') &&
          Number.isInteger(item[1]) &&
          typeof item[2] === 'string' &&
          typeof item[3] === 'string'
      )
    if (
      typeof e.page !== 'number' ||
      !checkPages.includes(e.page) ||
      (e.kind !== 'engine' && e.kind !== 'comparison') ||
      !e.reason ||
      !e.evidence ||
      !linesOk
    ) {
      problems.push(JSON.stringify(entry).slice(0, 160))
    }
  }
  return problems
}
