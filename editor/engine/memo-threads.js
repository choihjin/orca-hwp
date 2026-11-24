// The engine's getMemos() JSON as threads: memos on exactly the same text, in number order. The
// grouping is a guess from that shared text, not a reply relation read from the file. Shared by the
// frame and Node (agent/agent-view.mjs), so it is plain ESM with JSDoc types; no DOM, no engine.

/**
 * @typedef {'body' | 'tableCell' | 'textBox' | 'caption' | 'header' | 'footer' | 'footnote'
 *   | 'endnote' | 'masterPage' | 'unlinked'} MemoPlace
 */

/** @typedef {{ controlIndex: number, cellIndex: number, cellParaIndex: number }} CellStep */

/**
 * `date` is UTC (`YYYY-MM-DDTHH:MM:SSZ`); `dateText` is the file's own text, only when there is no
 * `date`. `text` is null when the file has no body for the memo.
 * @typedef {{ author: string, date: string | null, dateText: string | null, text: string | null }} Memo
 */

/**
 * Where the memo's text is. `ownerParaIndex` is the paragraph directly in the section; `path` leads
 * from it into table cells and text boxes. Character positions count code points. All but the first
 * two are null outside body text, table cells and text boxes. `text` is the memo's text exactly as
 * the file has it: positions count its control characters too. `start` is `startCharIdx` past the
 * blanks `text` begins with, which may have no glyph or end another page than the text.
 * @typedef {{
 *   sectionIndex: number,
 *   ownerParaIndex: number,
 *   paraIndex: number | null,
 *   path: CellStep[] | null,
 *   startCharIdx: number | null,
 *   endCharIdx: number | null,
 *   text: string,
 *   start: number | null
 * }} MemoAnchor
 */

/**
 * Where the engine puts a caret at the memo's first character: `page` counts from 0, `x` and `y`
 * are page px and null when only the page is known.
 * @typedef {{ page: number, x: number | null, y: number | null }} MemoCaret
 */

/**
 * `number` and `page` count from 1; `page` is null when unknown. `located` says the highlight was
 * found on that page. `page`, `located` and `caret` are set by memo-locate.js.
 * @typedef {{
 *   number: number,
 *   page: number | null,
 *   located: boolean,
 *   place: MemoPlace,
 *   anchorText: string,
 *   paragraphText: string,
 *   multiParagraph: boolean,
 *   memos: Memo[],
 *   anchor: MemoAnchor | null,
 *   caret: MemoCaret | null
 * }} MemoThread
 */

/**
 * One for each code: `count` says how often, `number` and `sectionIndex` are the first one's. Codes
 * this version does not know are together `unknown`.
 * @typedef {{ code: string, count: number, number?: number, sectionIndex?: number }} MemoProblem
 */

/** @typedef {{ threads: MemoThread[], problems: MemoProblem[] }} MemoReport */

/** @type {Record<MemoPlace, string>} */
const PLACE_LABELS = {
  body: '',
  tableCell: '표 칸',
  textBox: '글상자',
  caption: '캡션',
  header: '머리말',
  footer: '꼬리말',
  footnote: '각주',
  endnote: '미주',
  masterPage: '바탕쪽',
  unlinked: '글과 연결되지 않음'
}

/**
 * What the engine says about each problem besides how often it occurs.
 * @type {Map<string, 'number' | 'sectionIndex' | null>}
 */
const PROBLEM_DETAILS = new Map([
  ['bad-record', null],
  ['missing-memo', null],
  ['no-body', 'number'],
  ['unlinked-body', 'number'],
  ['section-unreadable', 'sectionIndex']
])

/** The engine gives the first 2,000 code points of `anchorText` and `paragraphText`. */
const TEXT_LIMIT = 2000

/**
 * Removes C0 controls (but not line feed and tab) and DEL.
 * @param {string} text
 */
function clean(text) {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Record<string, unknown>}
 */
function object(value, what) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`memo JSON: ${what} is not an object`)
  }
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @returns {unknown[]}
 */
function list(source, key) {
  const value = source[key]
  if (!Array.isArray(value)) throw new Error(`memo JSON: ${key} is not a list`)
  return value
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @returns {string}
 */
function string(source, key) {
  const value = source[key]
  if (typeof value !== 'string') throw new Error(`memo JSON: ${key} is not a string`)
  return value
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @returns {string | null}
 */
function stringOrNull(source, key) {
  return source[key] === null ? null : string(source, key)
}

/**
 * A count or an index: rhwp gives unsigned integers.
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @returns {number}
 */
function index(source, key) {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`memo JSON: ${key} is not an index`)
  }
  return value
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @returns {number | null}
 */
function indexOrNull(source, key) {
  return source[key] === null ? null : index(source, key)
}

/**
 * @param {Record<string, unknown>} source
 * @returns {CellStep[] | null}
 */
function cellPath(source) {
  if (source.path === null) return null
  return list(source, 'path').map((value) => {
    const step = object(value, 'path step')
    return {
      controlIndex: index(step, 'controlIndex'),
      cellIndex: index(step, 'cellIndex'),
      cellParaIndex: index(step, 'cellParaIndex')
    }
  })
}

/**
 * @param {number | null} startCharIdx
 * @param {string} text the memo's text
 * @param {string | null} paragraph the text of the paragraph it begins in, when it runs on into others
 * @returns {number | null} the first character that is not blank, if the memo has one there
 */
function startOf(startCharIdx, text, paragraph) {
  if (startCharIdx === null) return null
  const blanks = Array.from(text).findIndex((char) => /\S/.test(char))
  const start = startCharIdx + Math.max(blanks, 0)
  return paragraph !== null && start >= Array.from(paragraph).length ? startCharIdx : start
}

/**
 * @param {unknown} value
 * @returns {{ order: number, key: string | null, thread: MemoThread, memo: Memo }} `key` is null
 *   for a memo that never shares a thread
 */
function readEntry(value) {
  const source = object(value, 'memo')
  const place = string(source, 'place')
  if (!Object.hasOwn(PLACE_LABELS, place)) throw new Error(`memo JSON: unknown place ${place}`)
  if (typeof source.multiParagraph !== 'boolean') throw new Error('memo JSON: multiParagraph is not a boolean')
  const anchorKey = place === 'unlinked' ? null : string(source, 'anchorKey')
  const sectionIndex = indexOrNull(source, 'sectionIndex')
  const ownerParaIndex = indexOrNull(source, 'ownerParaIndex')
  const anchorText = string(source, 'anchorText')
  const paragraphText = string(source, 'paragraphText')
  const startCharIdx = indexOrNull(source, 'startCharIdx')
  const spot = {
    paraIndex: indexOrNull(source, 'paraIndex'),
    path: cellPath(source),
    startCharIdx,
    endCharIdx: indexOrNull(source, 'endCharIdx'),
    text: anchorText,
    start: startOf(startCharIdx, anchorText, source.multiParagraph ? paragraphText : null)
  }
  const dateText = stringOrNull(source, 'dateText')
  const text = stringOrNull(source, 'text')
  return {
    order: index(source, 'number'),
    // Over several paragraphs "the same text" needs the same end too.
    key: source.multiParagraph && spot.endCharIdx === null ? null : anchorKey,
    memo: {
      author: clean(string(source, 'author')),
      date: stringOrNull(source, 'date'),
      dateText: dateText === null ? null : clean(dateText),
      text: text === null ? null : clean(text)
    },
    thread: {
      number: 0,
      page: null,
      located: false,
      place: /** @type {MemoPlace} */ (place),
      anchorText: clean(anchorText),
      paragraphText: clean(paragraphText),
      multiParagraph: source.multiParagraph,
      memos: [],
      anchor: sectionIndex === null || ownerParaIndex === null ? null : { sectionIndex, ownerParaIndex, ...spot },
      caret: null
    }
  }
}

/**
 * @param {unknown} value
 * @returns {MemoProblem}
 */
function readProblem(value) {
  const source = object(value, 'problem')
  const code = string(source, 'code')
  const detail = PROBLEM_DETAILS.get(code)
  if (detail === undefined) {
    // Nothing is known of its shape, and it must not hide the memos.
    const { count } = source
    return { code: 'unknown', count: typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 1 }
  }
  const count = source.count === undefined ? 1 : index(source, 'count')
  if (count === 0) throw new Error('memo JSON: count is 0')
  return detail === null ? { code, count } : { code, count, [detail]: index(source, detail) }
}

/**
 * @param {unknown[]} values
 * @returns {MemoProblem[]} one for each code, in the order they first came
 */
function readProblems(values) {
  /** @type {Map<string, MemoProblem>} */
  const byCode = new Map()
  for (const value of values) {
    const problem = readProblem(value)
    const first = byCode.get(problem.code)
    if (first) first.count += problem.count
    else byCode.set(problem.code, problem)
  }
  return [...byCode.values()]
}

/**
 * @param {string} json the engine's getMemos() result
 * @returns {MemoReport}
 * @throws {Error} when the JSON has another shape: a memo must never go missing without a word
 */
export function buildMemoReport(json) {
  const source = object(JSON.parse(json), 'result')
  const problems = readProblems(list(source, 'problems'))
  /** @type {{ thread: MemoThread, entries: { order: number, memo: Memo }[] }[]} */
  const groups = []
  /** @type {Map<string, (typeof groups)[number]>} */
  const byKey = new Map()
  for (const value of list(source, 'memos')) {
    const { order, key, thread, memo } = readEntry(value)
    let group = key === null ? undefined : byKey.get(key)
    if (!group) {
      group = { thread, entries: [] }
      groups.push(group)
      if (key !== null) byKey.set(key, group)
    }
    group.entries.push({ order, memo })
  }
  const linked = groups.filter((group) => group.thread.place !== 'unlinked')
  const unlinked = groups.filter((group) => group.thread.place === 'unlinked')
  const threads = [...linked, ...unlinked].map(({ thread, entries }, at) => ({
    ...thread,
    number: at + 1,
    memos: entries.sort((a, b) => a.order - b.order).map((entry) => entry.memo)
  }))
  return { threads, problems }
}

/** @param {number} value */
const two = (value) => String(value).padStart(2, '0')

/**
 * @param {Pick<Memo, 'date'>} memo
 * @returns {Date | null}
 */
function dateOf(memo) {
  const date = memo.date === null ? null : new Date(memo.date)
  return date && !Number.isNaN(date.getTime()) ? date : null
}

/**
 * `11.20`, or `2025.11.20` in another year, in local time; the file's own text when there is no date.
 * @param {Pick<Memo, 'date' | 'dateText'>} memo
 * @param {Date} now
 * @returns {string}
 */
export function shortDate(memo, now) {
  const date = dateOf(memo)
  if (!date) return memo.dateText ?? ''
  const day = `${two(date.getMonth() + 1)}.${two(date.getDate())}`
  return date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}.${day}`
}

/**
 * `2026-11-20 17:24` in local time; the file's own text when there is no date.
 * @param {Pick<Memo, 'date' | 'dateText'>} memo
 * @returns {string}
 */
export function fullDate(memo) {
  const date = dateOf(memo)
  if (!date) return memo.dateText ?? ''
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/**
 * The memo's text for people to read, with `…` when the engine cut it short.
 * @param {MemoThread} thread
 * @returns {string}
 */
export function shownAnchorText({ anchorText, anchor }) {
  const length = Array.from(anchor?.text ?? anchorText).length
  const known = anchor !== null && anchor.startCharIdx !== null && anchor.endCharIdx !== null
  const cut = known ? length < Number(anchor.endCharIdx) - Number(anchor.startCharIdx) : length >= TEXT_LIMIT
  return cut && anchorText !== '' ? `${anchorText}…` : anchorText
}

/**
 * The thread as agents get it: a copy without the engine position.
 * @param {MemoThread} thread
 * @returns {Omit<MemoThread, 'anchor' | 'caret'>}
 */
export function publicThread(thread) {
  return {
    number: thread.number,
    page: thread.page,
    place: thread.place,
    anchorText: thread.anchorText,
    paragraphText: thread.paragraphText,
    multiParagraph: thread.multiParagraph,
    located: thread.located,
    memos: thread.memos.map((memo) => ({ ...memo }))
  }
}

/**
 * @param {MemoProblem} problem
 * @returns {string}
 */
export function problemText({ code, count }) {
  switch (code) {
    case 'bad-record':
      return `읽지 못한 메모 기록 ${count}개`
    case 'missing-memo':
      return `메모 ${count}개를 읽지 못함`
    case 'no-body':
      return `본문이 없는 메모 ${count}개`
    case 'unlinked-body':
      return `글과 연결되지 않은 메모 본문 ${count}개`
    case 'section-unreadable':
      return `읽지 못한 구역 ${count}개`
    default:
      return '알 수 없는 문제로 일부 메모를 읽지 못함'
  }
}

/**
 * @param {MemoPlace} place
 * @returns {string} empty for body text
 */
export function placeLabel(place) {
  return PLACE_LABELS[place]
}
