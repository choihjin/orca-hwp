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

function clamp(value, low, high) {
  return Math.max(low, Math.min(value, high))
}

/** Find the first gap to either side of the anchor on this row. */
function badgeInRow({ x, y, w, h }, viewport, obstacles) {
  const left = viewport.x
  const right = viewport.x + viewport.w
  const start = clamp(x, left, right - w)
  const row = obstacles.filter((box) => box.y < y + h && box.y + box.h > y)
    .sort((a, b) => a.x - b.x)

  let next = start
  for (const box of row) {
    if (next + w <= box.x) break
    next = Math.max(next, box.x + box.w + 1)
  }
  if (next + w <= right) return { x: next, y, w, h }

  next = start
  for (const box of row.reverse()) {
    if (next >= box.x + box.w) continue
    next = Math.min(next, box.x - w - 1)
  }
  return next >= left ? { x: next, y, w, h } : null
}

function placeBadge(anchor, w, h, viewport, occupied, text, cropped) {
  const top = viewport.y
  const bottom = viewport.y + viewport.h - h
  const y = clamp(anchor.y - h - 2, top, bottom)
  const box = { x: anchor.x, y, w, h }
  const obstacles = [...text, ...occupied]
  const beside = badgeInRow(box, viewport, obstacles)
  if (beside) return beside
  const margins = [top, bottom].sort((a, b) => Math.abs(a - y) - Math.abs(b - y))
  for (const margin of margins) {
    const placed = badgeInRow({ ...box, y: margin }, viewport, obstacles)
    if (placed) return placed
  }
  // A tight crop can contain only text. Keep its number in view if there is room.
  return cropped ? badgeInRow(box, viewport, occupied) : null
}

/**
 * @param {import('../editor/engine/memo-marks.js').MemoMark[]} marks
 * @param {{ width: number, height: number }} pageSize
 * @param {{ x: number, y: number, width: number, height: number }} [region]
 * @param {Rect[]} [textRuns]
 */
export function memoOverlay(marks, pageSize, region, textRuns = []) {
  if (!marks.length) return ''
  const { width, height } = pageSize
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return ''
  const viewport = region
    ? { x: region.x, y: region.y, w: Math.min(region.width, width - region.x), h: Math.min(region.height, height - region.y) }
    : { x: 0, y: 0, w: width, h: height }
  const rects = []
  const badges = []
  const occupied = []
  const text = textRuns.filter((box) => visible(box, viewport))
  // This markup is appended after sanitization. Only validated numbers go in it.
  for (const { number, rects: boxes, badge } of marks) {
    if (!Number.isSafeInteger(number) || number < 1) continue
    const inView = boxes.filter((box) => visible(box, viewport))
    for (const box of inView) {
      const { x, y, w, h } = box
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffbd26" fill-opacity="0.35"/>`)
    }
    if (![badge.x, badge.y].every(Number.isFinite)) continue
    if (boxes.length ? !inView.length : (
      badge.x < viewport.x || badge.x >= viewport.x + viewport.w ||
      badge.y < viewport.y || badge.y >= viewport.y + viewport.h
    )) continue
    const baseWidth = Math.max(13, String(number).length * 6 + 5)
    const scale = Math.min(1, viewport.w / baseWidth, viewport.h / 11)
    const placed = placeBadge(badge, baseWidth * scale, 11 * scale, viewport, occupied, text, Boolean(region))
    if (!placed || !visible(placed, viewport)) continue
    const { x, y, w, h } = placed
    occupied.push(placed)
    badges.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#754000"/>` +
      `<text x="${x + w / 2}" y="${y + 9 * scale}" text-anchor="middle" font-family="Noto Sans KR" font-size="${9 * scale}" font-weight="700" fill="#fff">${number}</text>`
    )
  }
  return rects.length || badges.length ? `<g>${rects.join('')}${badges.join('')}</g>` : ''
}
