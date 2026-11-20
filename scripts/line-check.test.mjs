import { assert, test } from 'orca/testing'
import { badEntries, judgePage, lineDiff } from './line-check.mjs'

/** @param {string} s two-character line keys like "AA" */
const pdf = (...s) => s.map((x) => /** @type {[string, string]} */ ([x[0], x[1]]))

/**
 * @param {import('./line-check.mjs').DiffItem[]} lines
 * @returns {import('./line-check.mjs').KnownDifference}
 */
const entry = (lines) => ({ page: 1, kind: 'comparison', reason: 'r', evidence: 'e', lines })

test('lineDiff records each unmatched line with its side, position and characters', () => {
  const r = lineDiff(pdf('AA', 'BB', 'CC'), ['AxA', 'XyX', 'CzC'])
  assert.equal(r.matched, 2)
  assert.equal(r.engineLines, 3)
  assert.deepEqual(r.diff, [
    ['engine', 2, 'X', 'X'],
    ['pdf', 2, 'B', 'B']
  ])
})

test('a known difference that moves to another line fails even with the same counts', () => {
  const expected = pdf('AA', 'BB', 'CC')
  const known = lineDiff(expected, ['AA', 'XX', 'CC']) // stored when confirmed
  const now = lineDiff(expected, ['AA', 'BB', 'YY'])
  assert.equal(known.matched, now.matched) // 2/3 both times
  assert.equal(known.engineLines, now.engineLines)
  const verdict = judgePage(now.diff, [entry(known.diff)])
  assert.equal(verdict.status, 'fail')
  assert.deepEqual(verdict.unexpected, [
    ['engine', 3, 'Y', 'Y'],
    ['pdf', 3, 'C', 'C']
  ])
})

test('a different character at the same position also fails', () => {
  const expected = pdf('AA', 'BB', 'CC')
  const known = lineDiff(expected, ['AA', 'XX', 'CC'])
  assert.equal(judgePage(lineDiff(expected, ['AA', 'XZ', 'CC']).diff, [entry(known.diff)]).status, 'fail')
})

test('the same difference is known; fewer is improved; none is resolved; unlisted fails', () => {
  const expected = pdf('AA', 'BB', 'CC', 'DD')
  const known = lineDiff(expected, ['AA', 'XX', 'CC', 'YY'])
  assert.equal(judgePage(lineDiff(expected, ['AA', 'XX', 'CC', 'YY']).diff, [entry(known.diff)]).status, 'known')
  const improved = judgePage(lineDiff(expected, ['AA', 'XX', 'CC', 'DD']).diff, [entry(known.diff)])
  assert.equal(improved.status, 'improved')
  assert.deepEqual(improved.gone, [
    ['engine', 4, 'Y', 'Y'],
    ['pdf', 4, 'D', 'D']
  ])
  assert.equal(judgePage([], [entry(known.diff)]).status, 'resolved')
  assert.equal(judgePage([], []).status, 'match')
  assert.equal(judgePage(known.diff, []).status, 'fail')
})

test('entries of one page are pooled, so two causes can share a page', () => {
  const expected = pdf('AA', 'BB', 'CC', 'DD')
  const { diff } = lineDiff(expected, ['XX', 'BB', 'CC', 'YY'])
  const first = diff.filter((item) => item[1] === 1)
  const rest = diff.filter((item) => item[1] !== 1)
  assert.equal(judgePage(diff, [entry(first), { ...entry(rest), kind: 'engine' }]).status, 'known')
  assert.equal(judgePage(diff, [entry(first)]).status, 'fail')
})

test('badEntries refuses entries without lines or with malformed items', () => {
  const good = { page: 2, kind: 'engine', reason: 'r', evidence: 'e', lines: [['pdf', 1, 'a', 'b']] }
  assert.deepEqual(badEntries([good], [2]), [])
  assert.equal(badEntries([{ ...good, page: 3 }], [2]).length, 1)
  assert.equal(badEntries([{ ...good, lines: [] }], [2]).length, 1)
  assert.equal(badEntries([{ ...good, lines: [['pdf', '1', 'a', 'b']] }], [2]).length, 1)
  assert.equal(badEntries([{ ...good, minMatched: 1, lines: undefined }], [2]).length, 1)
})
