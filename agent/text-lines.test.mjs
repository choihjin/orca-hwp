import { assert, test } from 'orca/testing'
import { textLines } from './text-lines.js'

function run(text, x, y, w = 10, h = 12) {
  return { text, x, y, w, h, fontFamily: 'serif', fontSize: h, bold: false }
}

test('text runs on the same line are sorted by x and keep adjacent text together', () => {
  assert.deepEqual(textLines([run('정책과', 20, 10), run('보건', 10, 10)]), ['보건정책과'])
})

test('line tolerance defaults to half the run height and can be overridden', () => {
  const runs = [run('second', 10, 17), run('first', 0, 10)]
  assert.deepEqual(textLines(runs), ['first', 'second'])
  assert.deepEqual(textLines(runs, 7), ['firstsecond'])
})

test('three aligned table cells are read left to right on one line', () => {
  assert.deepEqual(
    textLines([run('합계', 120, 10), run('이름', 0, 10), run('수량', 60, 12)]),
    ['이름 수량 합계']
  )
})
