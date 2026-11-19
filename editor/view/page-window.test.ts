import { assert, test } from 'orca/testing'
import { pageLayout, pagesToRender } from './page-window.ts'

const portrait = { width: 794, height: 1123 }
const landscape = { width: 1123, height: 794 }

test('pageLayout stacks pages of mixed size with a gap', () => {
  const layout = pageLayout([portrait, landscape, landscape, portrait], 1, 10)
  assert.deepEqual(layout.heights, [1123, 794, 794, 1123])
  assert.deepEqual(layout.tops, [0, 1133, 1937, 2741])
  assert.equal(layout.total, 2741 + 1123)
})

test('pageLayout scales heights by zoom but not the gap', () => {
  const layout = pageLayout([portrait, landscape], 0.5, 16)
  assert.deepEqual(layout.heights, [561.5, 397])
  assert.deepEqual(layout.tops, [0, 577.5])
  assert.equal(layout.total, 974.5)
})

test('pageLayout of no pages is empty', () => {
  assert.deepEqual(pageLayout([], 1, 10), { tops: [], heights: [], total: 0 })
})

test('pagesToRender of no pages is first 0, last -1', () => {
  assert.deepEqual(pagesToRender(pageLayout([], 1, 10), 0, 800, 2), { first: 0, last: -1 })
})

// tops [0, 1133, 1937, 2741], bottoms [1123, 1927, 2731, 3864]
const mixed = pageLayout([portrait, landscape, landscape, portrait], 1, 10)

test('pagesToRender finds the pages the viewport touches', () => {
  assert.deepEqual(pagesToRender(mixed, 0, 800, 0), { first: 0, last: 0 })
  assert.deepEqual(pagesToRender(mixed, 1000, 1000, 0), { first: 0, last: 2 })
  assert.deepEqual(pagesToRender(mixed, 1200, 1000, 0), { first: 1, last: 2 })
  assert.deepEqual(pagesToRender(mixed, 0, 10_000, 0), { first: 0, last: 3 })
})

test('pagesToRender treats touching edges as outside', () => {
  // viewport ends exactly where page 1 starts, and starts exactly where page 0 ends
  assert.deepEqual(pagesToRender(mixed, 333, 800, 0), { first: 0, last: 0 })
  assert.deepEqual(pagesToRender(mixed, 1123, 10, 0), { first: 1, last: 1 })
})

test('pagesToRender inside a gap or past the ends still gives the nearest page', () => {
  assert.deepEqual(pagesToRender(mixed, 1124, 5, 0), { first: 1, last: 1 })
  assert.deepEqual(pagesToRender(mixed, -500, 100, 0), { first: 0, last: 0 })
  assert.deepEqual(pagesToRender(mixed, 5000, 800, 0), { first: 3, last: 3 })
  assert.deepEqual(pagesToRender(mixed, 2000, 0, 0), { first: 2, last: 2 })
})

test('pagesToRender widens by overscan pages and clamps to the document', () => {
  assert.deepEqual(pagesToRender(mixed, 1200, 100, 1), { first: 0, last: 2 })
  assert.deepEqual(pagesToRender(mixed, 1200, 100, 5), { first: 0, last: 3 })
  assert.deepEqual(pagesToRender(mixed, 0, 100, 2), { first: 0, last: 2 })
})

test('pagesToRender follows zoom', () => {
  const zoomed = pageLayout([portrait, portrait, portrait], 2, 10) // tops [0, 2256, 4512]
  assert.deepEqual(pagesToRender(zoomed, 2000, 300, 0), { first: 0, last: 1 })
  assert.deepEqual(pagesToRender(zoomed, 2300, 300, 0), { first: 1, last: 1 })
})

test('pagesToRender stays fast on a thousand pages', () => {
  const big = pageLayout(Array.from({ length: 1000 }, (_, i) => (i % 7 === 0 ? landscape : portrait)), 1, 10)
  const range = pagesToRender(big, big.tops[500] + 1, 400, 1)
  assert.deepEqual(range, { first: 499, last: 501 })
})
