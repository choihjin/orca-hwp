// Makes synthetic-memos.hwp, an HWP document with memos, with rhwp 0.9.1 (npm). The document is not
// committed (README.md here); editor/engine/memo-documents.test.mjs reads a copy in fixtures/.
//
//   node scripts/testdata/synthetic-memos.generator.mjs [output.hwp]
//
// Downloads the package into a new temporary folder and checks it against the pin below. Without an
// output path the document is written into that folder too. The same run twice gives the same bytes:
// the clock rhwp reads is fixed.
//
// What the document says about people and machines: rhwp starts from its own blank document, which
// has a name, dates and an application in its summary information, a path in DocOptions/_LinkDoc and
// a preview picture. They are overwritten here, then every stream (decompressed where it is
// compressed) is searched for that name, for this computer's user, host and folder names, and for
// anything that looks like a user folder. A hit stops the run before anything is written. To look
// for yourself, `--streams file.hwp` lists the streams and the summary strings of any HWP file.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const PACKAGE = {
  url: 'https://registry.npmjs.org/@rhwp/core/-/core-0.9.1.tgz',
  // `dist.integrity` of https://registry.npmjs.org/@rhwp/core/0.9.1
  integrity: 'sha512-jMLOubFHp5MocnbyYNoPwcUDAIqzF47hBv420i0prnN4+hk0iX/f4RPv0NotDOtQcANaFjJe8/mo64aQsZ73XA==',
  size: 11_868_872
}

/** The time of every memo. rhwp gives the command the UTC FILETIME and the memo a local time. */
const NOW = Date.UTC(2026, 10, 20, 8, 24, 4)

// --- HWP files (compound files) -------------------------------------------------------------

const END_OF_CHAIN = 0xfffffffa // and the other special sector numbers above it

/**
 * The streams of a compound file with the places of their bytes in it, so they can be overwritten.
 * @param {Buffer} file
 */
function streamsOf(file) {
  const sector = 1 << file.readUInt16LE(30)
  const miniSector = 1 << file.readUInt16LE(32)
  const miniLimit = file.readUInt32LE(56)
  const offsetOf = (/** @type {number} */ i) => (i + 1) * sector
  const numbersIn = (/** @type {number[]} */ sectors) =>
    sectors.flatMap((i) => Array.from({ length: sector / 4 }, (_, k) => file.readUInt32LE(offsetOf(i) + k * 4)))
  if (file.readUInt32LE(72) > 0) throw new Error('more FAT sectors than the header lists')
  const fat = numbersIn(Array.from({ length: file.readUInt32LE(44) }, (_, k) => file.readUInt32LE(76 + k * 4)))
  const chain = (/** @type {number} */ first, table = fat) => {
    const sectors = []
    for (let i = first; i < END_OF_CHAIN; i = table[i]) {
      if (sectors.length > table.length) throw new Error('a sector chain without an end')
      sectors.push(i)
    }
    return sectors
  }
  const miniFat = numbersIn(chain(file.readUInt32LE(60)))
  const entries = chain(file.readUInt32LE(48)).flatMap((i) =>
    Array.from({ length: sector / 128 }, (_, k) => file.subarray(offsetOf(i) + k * 128, offsetOf(i) + (k + 1) * 128))
  )
  const root = chain(entries[0].readUInt32LE(116))
  return entries
    .filter((entry) => entry[66] === 2)
    .map((entry) => {
      const size = Number(entry.readBigUInt64LE(120))
      const mini = size < miniLimit
      const unit = mini ? miniSector : sector
      const offsets = chain(entry.readUInt32LE(116), mini ? miniFat : fat).map((i) =>
        mini ? offsetOf(root[Math.floor((i * miniSector) / sector)]) + ((i * miniSector) % sector) : offsetOf(i)
      )
      /** @type {[number, number][]} offset in the file, length */
      const places = offsets.map((offset, i) => [offset, Math.min(unit, size - i * unit)])
      const name = entry.toString('utf16le', 0, entry.readUInt16LE(64) - 2)
      return {
        name,
        read: () => Buffer.concat(places.map(([offset, length]) => file.subarray(offset, offset + length))),
        /** @param {Buffer} bytes as many as there are */
        write(bytes) {
          let done = 0
          for (const [offset, length] of places) done += bytes.copy(file, offset, done, done + length)
          if (done !== bytes.length || done !== size) throw new Error(`${name}: wrote ${done} of ${bytes.length} bytes`)
        }
      }
    })
}

const SUMMARY = '\u0005HwpSummaryInformation'
const VT_LPWSTR = 0x1f
const VT_FILETIME = 0x40

/**
 * The strings and times of a property set, as places in its bytes.
 * @param {Buffer} bytes
 */
function properties(bytes) {
  const set = bytes.readUInt32LE(44)
  return Array.from({ length: bytes.readUInt32LE(set + 4) }, (_, i) => {
    const id = bytes.readUInt32LE(set + 8 + i * 8)
    const at = set + bytes.readUInt32LE(set + 12 + i * 8)
    const type = bytes.readUInt32LE(at)
    if (type === VT_LPWSTR) return { id, type, from: at + 8, to: at + 8 + bytes.readUInt32LE(at + 4) * 2 }
    return { id, type, from: at + 4, to: at + 4 + (type === VT_FILETIME ? 8 : 4) }
  })
}

/** @param {Buffer} bytes */
const summaryStrings = (bytes) =>
  properties(bytes)
    .filter(({ type }) => type === VT_LPWSTR)
    .map(({ id, from, to }) => ({ id, text: bytes.toString('utf16le', from, to).replace(/\0+$/, '') }))

/** @param {Buffer} bytes */
function plain(bytes) {
  try {
    return inflateRawSync(bytes)
  } catch {
    return bytes // not a compressed stream
  }
}

/**
 * Overwrites what the blank document says about who made it, and checks that nothing is left.
 * @param {Uint8Array} made
 */
function anonymous(made) {
  const file = Buffer.from(made)
  const streams = streamsOf(file)
  const summary = streams.find(({ name }) => name === SUMMARY)
  if (!summary) throw new Error('no summary information')
  const bytes = summary.read()
  const before = summaryStrings(bytes).map(({ text }) => text).filter((text) => text !== '')
  for (const { type, from, to } of properties(bytes)) if (type === VT_LPWSTR || type === VT_FILETIME) bytes.fill(0, from, to)
  summary.write(bytes)
  for (const { name, read, write } of streams) if (name === '_LinkDoc' || name === 'PrvImage') write(Buffer.alloc(read().length))

  // Short words would be found by chance.
  const words = [...before, userInfo().username, hostname(), hostname().split('.')[0], homedir(), process.cwd(), '\\Users\\', '/Users/', '/home/', 'AppData'].filter((word) => word.length > 2)
  for (const { name, read } of streamsOf(file)) {
    const raw = read()
    for (const content of [raw, plain(raw)]) {
      const found = words.find((word) => content.includes(Buffer.from(word, 'utf16le')) || content.includes(Buffer.from(word, 'utf8')))
      if (found !== undefined) throw new Error(`stream ${name} has ${JSON.stringify(found)}`)
    }
  }
  return { file, overwritten: before }
}

// --- The document -----------------------------------------------------------------------------

/**
 * @param {any} rhwp the module
 * @returns {Uint8Array}
 */
function makeDocument(rhwp) {
  const doc = rhwp.HwpDocument.createEmpty()
  /**
   * @param {string} step
   * @param {string} json
   */
  const ok = (step, json) => {
    const result = JSON.parse(json)
    if (result.ok === false) throw new Error(`${step}: ${json}`)
    return result
  }
  ok('blank', doc.createBlankDocument())

  /**
   * @param {string} author
   * @param {string} text
   */
  const body = (author, text) => JSON.stringify({ author, text })
  /**
   * A memo on a part of a paragraph.
   * @param {number} para
   * @param {string} text the paragraph's
   * @param {string} part
   * @param {string} json
   */
  const memoOn = (para, text, part, json) => {
    const start = text.indexOf(part)
    return ok(`memo on ${part}`, doc.insertMemo(0, para, start, start + part.length, json))
  }
  /**
   * A text box with a memo on its text.
   * @param {number} para
   * @param {string} text
   * @param {Record<string, unknown>} place
   */
  const boxIn = (para, text, place) => {
    const box = ok('text box', doc.createShapeControl(JSON.stringify({ sectionIdx: 0, paraIdx: para, width: 14000, height: 3000, shapeType: 'textbox', ...place })))
    const path = JSON.stringify([{ controlIndex: box.controlIdx, cellIndex: 0, cellParaIndex: 0 }])
    ok('text in the box', doc.insertTextInCell(0, box.paraIdx, box.controlIdx, 0, 0, 0, text))
    ok('memo in the box', doc.insertMemoByPath(0, box.paraIdx, path, 0, text.length, body('검토자 가', `${text}에 단 메모입니다.`)))
  }

  /** @type {{ text: string, newPage?: boolean, fill?: (para: number, text: string) => void }[]} */
  const paras = [
    {
      text: '합성 메모 시험 문서',
      fill(para, text) {
        const parent = memoOn(para, text, text, body('검토자 가', '제목에 연도를 넣을지 정해 주세요.'))
        const reply = ok('reply', doc.insertMemoReply(parent.id, body('작성자 나', '연도는 넣지 않기로 했습니다.')))
        ok('reply to the reply', doc.insertMemoReply(reply.id, body('검토자 가', '확인했습니다.')))
      }
    },
    { text: '이 문서는 메모 표시를 시험하려고 rhwp 0.9.1로 만든 합성 문서입니다. 이 문단에는 메모가 없습니다.' },
    {
      text: '셋째 문단의 "예산" 낱말과 "일정" 낱말에 메모가 있습니다. 예산은 확정 전입니다.',
      fill(para, text) {
        memoOn(para, text, '예산', body('재무 담당', '예산 숫자는 다음 주에 확정됩니다.\n둘째 줄이 있는 메모입니다.'))
        memoOn(para, text, '일정', body('일정 담당', '일정은 그대로입니다.'))
      }
    },
    {
      text: '앞에 각주가 있는 문단입니다. 기준 글에 메모가 있습니다.',
      fill(para, text) {
        const note = ok('footnote', doc.insertFootnote(0, para, 5))
        ok('text in the footnote', doc.insertTextInFootnote(0, para, note.controlIdx, 0, 2, '각주 글'))
        memoOn(para, text, '기준 글', body('검토자 가', '각주 뒤의 메모입니다.'))
      }
    },
    {
      text: '길이가 없는 메모가 이 앞에 있습니다.',
      fill: (para) => ok('memo of no length', doc.insertMemo(0, para, 4, 4, body('검토자 가', '길이 0 메모입니다.')))
    },
    {
      text: '앞에 표가 있는 문단입니다. 표 뒤 글에 메모가 있습니다.',
      fill(para, text) {
        const options = { sectionIdx: 0, paraIdx: para, charOffset: 4, rowCount: 1, colCount: 1, treatAsChar: true, colWidths: [6000] }
        ok('inline table', doc.createTableEx(JSON.stringify(options)))
        memoOn(para, text, '표 뒤 글', body('검토자 가', '표 뒤의 메모입니다.'))
      }
    },
    {
      text: '',
      fill(para) {
        const table = ok('table', doc.createTable(0, para, 0, 2, 2))
        const cells = ['항목', '금액', '인건비', '1,200만 원']
        cells.forEach((text, i) => ok('cell', doc.insertTextInCell(0, table.paraIdx, table.controlIdx, i, 0, 0, text)))
        const path = JSON.stringify([{ controlIndex: table.controlIdx, cellIndex: 3, cellParaIndex: 0 }])
        ok('memo in a cell', doc.insertMemoByPath(0, table.paraIdx, path, 0, cells[3].length, body('재무 담당', '표 칸 안의 메모입니다.')))
      }
    },
    {
      text: '이 문단의 끝에 글상자가 있습니다. ',
      fill: (para, text) => boxIn(para, '글상자 글', { charOffset: text.length, treatAsChar: true })
    },
    {
      text: '둘째 쪽 첫 문단입니다. 이 문장 전체에 메모가 있습니다.',
      newPage: true,
      fill: (para, text) => memoOn(para, text, text, body('검토자 가', '둘째 쪽 메모입니다.'))
    },
    {
      text: '범위가 공백으로 시작하는   메모입니다.',
      fill: (para, text) => memoOn(para, text, '   메모', body('검토자 가', '앞 공백이 든 메모입니다.'))
    },
    {
      text: '이 문단에 묶인 글상자가 있습니다.',
      fill(para) {
        const floating = { charOffset: 0, treatAsChar: false, textWrap: 'TopAndBottom', vertOffset: 40000 }
        boxIn(para, '묶인 왼쪽 글', { ...floating, horzOffset: 9000 })
        boxIn(para, '묶인 오른쪽 글', { ...floating, horzOffset: 27000 })
        const targets = [0, 1].map((controlIdx) => ({ paraIdx: para, controlIdx }))
        ok('group', doc.groupShapes(JSON.stringify({ sectionIdx: 0, targets })))
      }
    }
  ]
  // All the text first: a paragraph with objects in it cannot be split at its length. Then from the
  // end, because a table can add paragraphs behind its own.
  const places = paras.map(({ text, newPage }, i) => {
    let at = i === 0 ? 0 : doc.getParagraphCount(0) - 1
    const length = doc.getParagraphLength(0, at)
    if (newPage) ok('page break', doc.insertPageBreak(0, at, length))
    else if (i > 0) ok('split', doc.splitParagraph(0, at, length))
    at = doc.getParagraphCount(0) - 1
    if (text !== '') ok('text', doc.insertText(0, at, 0, text))
    return at
  })
  for (let i = paras.length - 1; i >= 0; i--) paras[i].fill?.(places[i], paras[i].text)

  const listed = JSON.parse(doc.getMemoList())
  console.log(`rhwp 0.9.1: ${doc.pageCount()} pages, ${listed.length} memos`)
  const bytes = doc.exportHwp()
  doc.free()
  const again = new rhwp.HwpDocument(bytes)
  console.log(`rhwp 0.9.1, read again: ${again.pageCount()} pages, ${JSON.parse(again.getMemoList()).length} memos`)
  again.free()
  return bytes
}

// --- Run ----------------------------------------------------------------------------------------

/** @param {string} path */
async function listStreams(path) {
  for (const { name, read } of streamsOf(await readFile(path))) {
    console.log(JSON.stringify(name), `${read().length} B`)
    if (name === SUMMARY) for (const { id, text } of summaryStrings(read())) console.log(`  ${id}: ${JSON.stringify(text)}`)
  }
}

/** @param {string | undefined} outPath */
async function generate(outPath) {
  const dir = await mkdtemp(join(tmpdir(), 'synthetic-memos-'))
  const response = await fetch(PACKAGE.url)
  if (!response.ok) throw new Error(`${PACKAGE.url}: HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`
  if (archive.length !== PACKAGE.size || integrity !== PACKAGE.integrity) {
    throw new Error(`${PACKAGE.url}: expected ${PACKAGE.size} B / ${PACKAGE.integrity}, got ${archive.length} B / ${integrity}`)
  }
  for (const name of ['package.json', 'rhwp.js', 'rhwp_bg.wasm']) {
    await writeFile(join(dir, name), execFileSync('tar', ['-xOzf', '-', `package/${name}`], { input: archive, maxBuffer: 64 * 1024 * 1024 }))
  }

  process.env.TZ = 'Asia/Seoul'
  const RealDate = Date
  globalThis.Date = /** @type {DateConstructor} */ (
    class extends RealDate {
      /** @param {any[]} args */
      constructor(...args) {
        // @ts-expect-error the arguments of any of its constructors
        super(...(args.length === 0 ? [NOW] : args))
      }
      static now() {
        return NOW
      }
    }
  )
  const rhwp = await import(pathToFileURL(join(dir, 'rhwp.js')).href)
  rhwp.initSync({ module: await readFile(join(dir, 'rhwp_bg.wasm')) })
  const { file, overwritten } = anonymous(makeDocument(rhwp))
  console.log(`overwritten summary strings: ${JSON.stringify(overwritten)}`)
  const path = outPath === undefined ? join(dir, 'synthetic-memos.hwp') : resolve(outPath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, file)
  console.log(`${path}\n${file.length} B, sha256 ${createHash('sha256').update(file).digest('hex')}`)
}

const [first, second] = process.argv.slice(2)
await (first === '--streams' ? listStreams(second) : generate(first))
