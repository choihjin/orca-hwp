import { assert, test } from 'orca/testing'
import { memoOverlay } from './memo-overlay.js'

const page = { width: 100, height: 100 }
const mark = {
  number: 7,
  rects: [{ x: 10, y: 20, w: 30, h: 12 }],
  badge: { x: 40, y: 20 },
  text: '<img src=x onerror=1>'
}

test('an empty overlay adds nothing to the SVG', () => {
  assert.equal(memoOverlay([], page), '')
})

test('an overlay contains a translucent rectangle and a numeric badge', () => {
  const svg = memoOverlay([mark], page)
  assert.ok(/^<g>[\s\S]*<\/g>$/.test(svg))
  assert.ok(/<rect x="10" y="20" width="30" height="12"[^>]*fill-opacity=/.test(svg))
  assert.ok(/<text [^>]*font-family="Noto Sans KR"[^>]*>7<\/text>/.test(svg))
  assert.ok(!svg.includes('onerror'))
})

test('only finite coordinates and positive integer badge numbers enter the overlay', () => {
  assert.equal(memoOverlay([{ ...mark, number: '7</text>' }], page), '')
  assert.equal(memoOverlay([{ ...mark, number: Infinity }], page), '')
  const svg = memoOverlay([{
    ...mark,
    rects: [{ x: Infinity, y: 20, w: 20, h: 10 }, ...mark.rects],
    badge: { x: NaN, y: 20 }
  }], page)
  assert.ok(svg.includes('<rect'))
  assert.ok(!svg.includes('<text'))
  assert.ok(!/Infinity|NaN/.test(svg))
})

function badgeBoxes(svg) {
  return [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx=/g)]
    .map(([, x, y, w, h]) => ({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) }))
}

test('memo badges with the same anchor line up to the right, or to the left at the page edge', () => {
  for (const x of [40, 99]) {
    const marks = [7, 8, 9].map((number) => ({ ...mark, number, badge: { x, y: 20 } }))
    const boxes = badgeBoxes(memoOverlay(marks, page))
    assert.equal(boxes.length, 3)
    const sorted = boxes.toSorted((a, b) => a.x - b.x)
    assert.ok(sorted.every((box, i) => i === 0 || box.x >= sorted[i - 1].x + sorted[i - 1].w))
    assert.ok(boxes.every((box) => box.x >= 0 && box.x + box.w <= page.width))
    assert.ok(boxes.every((box) => [1, 2].includes(20 - box.y - box.h)))
    assert.ok(x === 40 ? boxes[1].x > boxes[0].x : boxes[1].x < boxes[0].x)
  }
})

test('memo badges move into whitespace when the previous line crosses their anchor', () => {
  const previousLine = { x: 10, y: 1, w: 74, h: 16 }
  const [box] = badgeBoxes(memoOverlay([mark], page, undefined, [previousLine]))
  assert.ok(box.x + box.w <= 10 || box.x >= 84 || box.y >= 17)
})

test('memo badges stay inside the crop when only the highlight intersects it', () => {
  const crop = { x: 15, y: 4, width: 20, height: 22 }
  const [box] = badgeBoxes(memoOverlay([mark], page, crop))
  assert.ok(box.x >= 15 && box.x + box.w <= 35)
  assert.ok(box.y >= 4 && box.y + box.h <= 26)
  assert.equal(memoOverlay([mark], page, { x: 40, y: 0, width: 50, height: 100 }), '')
})
