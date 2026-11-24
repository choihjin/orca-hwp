/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

/**
 * @param {Rect} rect
 * @param {Rect} viewport
 */
function visible({ x, y, w, h }, viewport) {
  return [x, y, w, h, x + w, y + h].every(Number.isFinite) && w > 0 && h > 0 &&
    x < viewport.x + viewport.w && y < viewport.y + viewport.h &&
    x + w > viewport.x && y + h > viewport.y
}

/**
 * @param {import('../editor/engine/memo-marks.js').MemoMark[]} marks
 * @param {{ width: number, height: number }} pageSize
 * @param {{ x: number, y: number, width: number, height: number }} [region]
 */
export function memoOverlay(marks, pageSize, region) {
  if (!marks.length) return ''
  const { width, height } = pageSize
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return ''
  const viewport = region
    ? { x: region.x, y: region.y, w: Math.min(region.width, width - region.x), h: Math.min(region.height, height - region.y) }
    : { x: 0, y: 0, w: width, h: height }
  const rects = []
  const badges = []
  // This markup is appended after sanitization. Only validated numbers go in it.
  for (const { number, rects: boxes, badge } of marks) {
    if (!Number.isSafeInteger(number) || number < 1) continue
    for (const box of boxes) {
      if (!visible(box, viewport)) continue
      const { x, y, w, h } = box
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffbd26" fill-opacity="0.35"/>`)
    }
    if (![badge.x, badge.y].every(Number.isFinite)) continue
    const w = Math.max(13, String(number).length * 6 + 5)
    const h = 11
    const x = Math.max(0, Math.min(badge.x, width - w))
    const y = Math.max(0, Math.min(badge.y - h, height - h))
    if (!visible({ x, y, w, h }, viewport)) continue
    badges.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#754000"/>` +
      `<text x="${x + w / 2}" y="${y + 9}" text-anchor="middle" font-family="Noto Sans KR" font-size="9" font-weight="700" fill="#fff">${number}</text>`
    )
  }
  return rects.length || badges.length ? `<g>${rects.join('')}${badges.join('')}</g>` : ''
}
