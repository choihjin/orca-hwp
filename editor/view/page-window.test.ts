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

test('pagesToRender widens the viewport by overscan pixels and clamps to the document', () => {
  // viewport [1200, 1300) is inside page 1
  assert.deepEqual(pagesToRender(mixed, 1200, 100, 0), { first: 1, last: 1 })
  assert.deepEqual(pagesToRender(mixed, 1200, 100, 76), { first: 1, last: 1 }) // [1124, 1376): page 0 ends at 1123
  assert.deepEqual(pagesToRender(mixed, 1200, 100, 78), { first: 0, last: 1 }) // [1122, 1378)
  assert.deepEqual(pagesToRender(mixed, 1200, 100, 637), { first: 0, last: 1 }) // bottom 1937 touches page 2
  assert.deepEqual(pagesToRender(mixed, 1200, 100, 638), { first: 0, last: 2 })
  assert.deepEqual(pagesToRender(mixed, 1200, 100, 100_000), { first: 0, last: 3 })
  assert.deepEqual(pagesToRender(mixed, 0, 100, -50), { first: 0, last: 0 })
})

test('pagesToRender follows zoom', () => {
  const zoomed = pageLayout([portrait, portrait, portrait], 2, 10) // tops [0, 2256, 4512]
  assert.deepEqual(pagesToRender(zoomed, 2000, 300, 0), { first: 0, last: 1 })
  assert.deepEqual(pagesToRender(zoomed, 2300, 300, 0), { first: 1, last: 1 })
})

test('pagesToRender agrees with a linear scan on a thousand mixed pages', () => {
  const big = pageLayout(Array.from({ length: 1000 }, (_, i) => (i % 7 === 0 ? landscape : portrait)), 1.3, 12)
  let seed = 7
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let k = 0; k < 500; k++) {
    const top = random() * big.total * 1.1 - big.total * 0.05
    const height = random() * 3000
    const overscan = random() * 2000
    const lo = top - overscan
    const hi = top + height + overscan
    const hit = big.tops.map((t, i) => i).filter((i) => big.tops[i] + big.heights[i] > lo && big.tops[i] < hi)
    const range = pagesToRender(big, top, height, overscan)
    if (hit.length > 0) {
      assert.deepEqual(range, { first: hit[0], last: hit[hit.length - 1] }, `top ${top} height ${height}`)
    } else {
      assert.equal(range.first, range.last)
    }
  }
})
