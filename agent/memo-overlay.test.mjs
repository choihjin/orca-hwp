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
