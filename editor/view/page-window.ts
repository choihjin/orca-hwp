// Page placement and the lazy-render window. Each page keeps its own size, so documents that mix
// portrait and landscape sections scroll and render by their real heights.

export type PageSize = { width: number; height: number }
export type PageLayout = { tops: number[]; heights: number[]; total: number }
export type PageRange = { first: number; last: number }

/**
 * Stacks pages top to bottom in screen px. Heights scale with `zoom`; `gap` (between pages) does
 * not. The first page starts at 0 and `total` ends at the last page's bottom edge.
 */
export function pageLayout(sizes: PageSize[], zoom: number, gap: number): PageLayout {
  const tops: number[] = []
  const heights: number[] = []
  let y = 0
  for (let i = 0; i < sizes.length; i++) {
    if (i > 0) y += gap
    const height = sizes[i].height * zoom
    tops.push(y)
    heights.push(height)
    y += height
  }
  return { tops, heights, total: y }
}

/** First index whose value satisfies `pred`, for `pred` false then true along the array. */
function firstIndex(length: number, pred: (i: number) => boolean): number {
  let lo = 0
  let hi = length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pred(mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

/**
 * Pages to render for a viewport. `overscan` is in pixels (screen px, like the layout): the
 * viewport is widened by that many pixels above and below before looking for pages. Pages that
 * only touch the widened edge are outside it. A viewport in a gap, of zero height or past either
 * end still gets the nearest page, so there is always something to draw.
 * No pages: `{ first: 0, last: -1 }`.
 */
export function pagesToRender(
  layout: PageLayout,
  viewportTop: number,
  viewportHeight: number,
  overscan: number
): PageRange {
  const count = layout.tops.length
  if (count === 0) return { first: 0, last: -1 }
  const extra = Math.max(0, overscan)
  const top = viewportTop - extra
  const bottom = viewportTop + Math.max(0, viewportHeight) + extra
  // first page whose bottom is below the top edge
  const first = Math.min(count - 1, firstIndex(count, (i) => layout.tops[i] + layout.heights[i] > top))
  // last page whose top is above the bottom edge
  const last = firstIndex(count, (i) => layout.tops[i] >= bottom) - 1
  return { first, last: Math.max(first, last) }
}
