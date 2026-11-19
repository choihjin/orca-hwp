/** @typedef {import('../editor/engine/rhwp-adapter.js').TextRun} TextRun */

/**
 * Groups runs top to bottom by their y distance from the first run on each line.
 * @param {TextRun[]} runs
 * @param {number} [tolerance] Maximum y difference in px. Defaults to half the current run's height.
 * @returns {string[]}
 */
export function textLines(runs, tolerance) {
  const sorted = runs.filter((run) => run.text !== '').sort((a, b) => a.y - b.y)
  /** @type {{ y: number, runs: TextRun[] }[]} */
  const lines = []
  for (const run of sorted) {
    const line = lines.at(-1)
    if (line && run.y - line.y <= (tolerance ?? run.h * 0.5)) {
      line.runs.push(run)
    } else {
      lines.push({ y: run.y, runs: [run] })
    }
  }

  return lines.map((line) => {
    line.runs.sort((a, b) => a.x - b.x)
    let text = ''
    let right = -Infinity
    for (const run of line.runs) {
      // The engine already includes inter-word spaces. Add one for gaps such as table columns.
      if (text && run.x - right > run.h * 0.25 && !/\s$/.test(text) && !/^\s/.test(run.text)) {
        text += ' '
      }
      text += run.text
      right = Math.max(right, run.x + run.w)
    }
    return text.trim()
  }).filter(Boolean)
}
