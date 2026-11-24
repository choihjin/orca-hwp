import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { brotliCompressSync, constants } from 'node:zlib'
import { assert, test } from 'orca/testing'
import { decodeWoff2 } from './woff2.js'

// The digests below, for bundled and synthetic fonts alike, are those of the
// decoder in v0.1.3 (woff2-encoder 2.0.0, a build of google/woff2).
const bundled = {
  'D2Coding-Bold.woff2': 'a03503ebbbd197aa9af45f74e9eec8726a7c7ff1dce707156bfe2652aea63572',
  'D2Coding-Regular.woff2': '62252daa24827d00184d70932a8a9dfa0b0df489964f200f61ca118a2e3d124b',
  'NanumMyeongjo-Bold.woff2': 'c6da61d682aef15fb6dee6233dfdca2f286a7193f3216dae0c09bf1e523ffad9',
  'NanumMyeongjo-Regular.woff2': 'bb4112cabe35b52fffbdbe9afaa85e964c459dc52529177de4e7da055d3076db',
  'NotoSansKR-Bold.woff2': 'e08ee4a4fbfd71096dd1e303edc3df2a6e5d0185770b57eaa4391a1bd700a3aa',
  'NotoSansKR-ExtraLight.woff2': '31e6003c9d8c096aa7a02681697a3b09a3db6e5f269bec572a50986cc5b8a4a9',
  'NotoSansKR-Regular.woff2': '39c5925cf712ba90568994b008266fec755f41fd14ba6112b8c9b6d1a08566b1',
  'NotoSerifKR-Bold.woff2': '6bdf40409ec4c749fb2feb0d032d5252bde526ede5c898e3c50a20ade2041ae6',
  'NotoSerifKR-Regular.woff2': '35f7479023ae8fa60fde58eb702070d03fbdb43de9228c4a7f8b1c27ffe80518',
  'Pretendard-Bold.woff2': 'c712626dd612372ba25b0c796d1881edfe1d7c79c8b067f84e4038a2c8c1157c',
  'Pretendard-Regular.woff2': '75f36828366a8771fdb41000e56c1d0824ac3e1d2bf1ed320fbb135016876d6e',
  'RHWPOldHangul-Regular.woff2': 'ae2cc95c4663e5c48f2bdf82569b81a6ae58222d1f386e99458646e66cabf44c',
  'RHWPPublicBatang-Regular.woff2': 'a8a5a7b91e65a5b76c1b98099f416353ee0519c6ce5eab93adfd23cd4062e396'
}

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
/** @param {string} file */
const readFont = (file) => readFileSync(new URL(`../editor/fonts/${file}`, import.meta.url))

/** @param {number[]} values */
const words = (...values) => {
  const bytes = Buffer.alloc(values.length * 2)
  values.forEach((value, i) => bytes.writeUInt16BE(value & 0xffff, i * 2))
  return bytes
}
/** @param {number} value */
const u32 = (value) => words(value >>> 16, value)
/** @param {number} value */
const u255 = (value) => (value < 253 ? Buffer.from([value]) : Buffer.concat([Buffer.from([253]), words(value)]))
/** @param {number} value */
const base128 = (value) => {
  const groups = [value % 128]
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) groups.unshift(0x80 | rest % 128)
  return Buffer.from(groups)
}
const range = (/** @type {number} */ count) => [...Array(count).keys()]

// Known-tag indexes of the tables in the synthetic font.
const tags = { head: 1, hhea: 2, hmtx: 3, maxp: 4, glyf: 10, loca: 11 }

/**
 * A font with every glyph kind: 0 empty, 1 and 2 simple, 3 and 4 composite.
 * @returns {TestTable[]}
 */
function syntheticTables({ indexFormat = 0, overlap = false, hmtxFlags = 3, shortBy = 0 } = {}) {
  const glyphCount = 5
  // Glyph 1 uses each of the 128 point encodings on and off the curve.
  const codes = range(256).map((i) => i ^ 0x80)
  const coordinateSize = 2 * (84 * 1 + 36 * 2 + 4 * 3 + 4 * 4)
  const coordinates = Buffer.from(range(coordinateSize).map((i) => (i * 37 + 11) & 0xff))
  // Glyph 2 repeats one point more often than a flag's repeat count can hold.
  const repeated = 700
  const contours = words(0, 2, 1, -1, -1)
  const points = Buffer.concat([u255(6), u255(250), u255(repeated)])
  const flags = Buffer.concat([Buffer.from(codes), Buffer.alloc(repeated, 21)])
  const glyphs = Buffer.concat([coordinates, u255(3), Buffer.alloc(repeated, 0x12), u255(0), u255(300)])
  const composites = Buffer.concat([
    words(0x0001 | 0x0008 | 0x0020, 1, 300, -300, 0x4000),
    words(0x0040 | 0x0020, 2, 0x0102, 0x2000, 0x3000),
    words(0x0080 | 0x0100 | 0x0020, 1, 0x0304, 1, 2, 3, 4),
    words(0x0002, 2, 0x0506),
    words(0x0003, 1, -7, 8)
  ])
  const boxes = Buffer.concat([Buffer.from([0b00111000, 0, 0, 0]), words(-5, -6, 7, 8), words(-9, -10, 11, 12), words(13, 14, 15, 16)])
  const instructions = Buffer.from(range(303).map((i) => i & 0xff))
  const streams = [contours, points, flags, glyphs.subarray(0, glyphs.length - shortBy), composites, boxes, instructions]
  const glyf = Buffer.concat([
    words(0, overlap ? 1 : 0, glyphCount, indexFormat), ...streams.map((stream) => u32(stream.length)), ...streams,
    ...(overlap ? [Buffer.from([0b01100000])] : [])
  ])
  const metrics = 3
  const hmtx = Buffer.concat([
    Buffer.from([hmtxFlags]), words(...range(metrics).map((i) => 500 + i)),
    ...(hmtxFlags & 1 ? [] : [words(...range(metrics).map((i) => 20 + i))]),
    ...(hmtxFlags & 2 ? [] : [words(...range(glyphCount - metrics).map((i) => 40 + i))])
  ])
  const head = Buffer.alloc(54, 1)
  head.writeUInt16BE(indexFormat, 50)
  const hhea = Buffer.alloc(36)
  hhea.writeUInt16BE(metrics, 34)
  return [
    { tag: tags.glyf, data: glyf, length: 4000, transform: true },
    { tag: tags.loca, data: Buffer.alloc(0), length: (glyphCount + 1) * (indexFormat ? 4 : 2), transform: true },
    { tag: tags.head, data: head },
    { tag: tags.hhea, data: hhea },
    { tag: tags.hmtx, data: hmtx, length: (metrics + glyphCount) * 2, transform: true, version: 1 },
    { tag: tags.maxp, data: words(0, 0x5000, glyphCount) },
    { tag: 'zzzz', data: Buffer.from('odd') }
  ]
}

/**
 * @typedef {{ tag: number | string, data: Buffer, length?: number, version?: number, transform?: boolean, sizes?: Buffer }} TestTable
 * @param {TestTable[]} tables
 * @param {{ sfntSize?: number, collection?: { version: number, fonts: number[][] }, stream?: Buffer }} [options]
 */
function encode(tables, { sfntSize = 0, collection, stream } = {}) {
  const directory = tables.flatMap(({ tag, data, length = data.length, version = 0, transform = false, sizes }) => [
    Buffer.from([(typeof tag === 'number' ? tag : 63) | (version << 6)]),
    ...(typeof tag === 'string' ? [Buffer.from(tag, 'latin1')] : []),
    sizes ?? Buffer.concat([base128(length), ...(transform ? [base128(data.length)] : [])])
  ])
  if (collection) {
    directory.push(u32(collection.version), u255(collection.fonts.length))
    for (const indexes of collection.fonts) directory.push(u255(indexes.length), u32(0x00010000), ...indexes.map(u255))
  }
  const compressed = brotliCompressSync(stream ?? Buffer.concat(tables.map(({ data }) => data)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 4 }
  })
  const header = Buffer.alloc(48)
  header.write('wOF2')
  header.writeUInt32BE(collection ? 0x74746366 : 0x00010000, 4)
  header.writeUInt16BE(tables.length, 12)
  header.writeUInt32BE(sfntSize, 16)
  header.writeUInt32BE(compressed.length, 20)
  const unpadded = Buffer.concat([header, ...directory, compressed])
  return withLength(Buffer.concat([unpadded, Buffer.alloc(-unpadded.length & 3)]))
}

/** @param {Buffer} font */
function withLength(font) {
  font.writeUInt32BE(font.length, 8)
  return font
}

for (const [file, digest] of Object.entries(bundled)) {
  test(`${file} decodes to the same bytes as before`, () => {
    assert.equal(sha256(decodeWoff2(readFont(file))), digest)
  })
}

test('every glyph kind, side bearing transform and collection decodes to the same bytes as before', () => {
  const plain = syntheticTables()
  /** @type {Record<string, [Buffer, string]>} */
  const cases = {
    'short loca': [encode(plain), '3cfd6f0beed5f730553b30fe0abf43ce420ba8102ecea0e5d3db2362cb86350a'],
    'long loca, overlap bits': [encode(syntheticTables({ indexFormat: 1, overlap: true })), '4ddf41377d4d7f664b06a021afb98ba853b809efc4da712210d1914047d02108'],
    'proportional bearings left out': [encode(syntheticTables({ hmtxFlags: 1 })), '1c76199bafa8ab64624641a19db4e7b7e4cee6042abb10e28a9b633be65304ad'],
    'monospaced bearings left out': [encode(syntheticTables({ hmtxFlags: 2 })), 'ebd6cfc90022401626c13142ed9135a3637a2fd6813afd0f828306bea6eebb2c'],
    'untransformed glyf': [encode([
      { tag: tags.glyf, data: Buffer.alloc(16, 3), version: 3 }, { tag: tags.loca, data: words(0, 8), version: 3 },
      { tag: tags.head, data: Buffer.alloc(54) }
    ]), '70f7b80d9002646168093b949782513436fda81bfd319695abc09595daf53ae5'],
    'declared size': [encode(plain, { sfntSize: 5000 }), '814ae491dd2bcaddec659506fd5864e73f935b0a156dc2f4aea4804d1287930d'],
    'collection 1': [encode(plain, { collection: { version: 0x00010000, fonts: [range(7), range(6)] } }), 'ee220d714d0279d4c718dec7c3f34d201f97ac17d9852e00b51a5d6ed98c7d6b'],
    'collection 2': [encode(plain, { collection: { version: 0x00020000, fonts: [range(6), range(7)] } }), '2cc154ccf8c87e83a19ff58b47f56a1b03b09e80bc8bce510c976685be93b698']
  }
  for (const [name, [font, digest]] of Object.entries(cases)) assert.equal(sha256(decodeWoff2(font)), digest, name)
})

test('a Uint8Array that starts inside its buffer decodes the same', () => {
  const font = encode(syntheticTables())
  const shifted = new Uint8Array(font.length + 7)
  shifted.set(font, 5)
  assert.deepEqual(decodeWoff2(shifted.subarray(5, 5 + font.length)), decodeWoff2(font))
})

test('the rebuilt directory has valid checksums', () => {
  const font = Buffer.from(decodeWoff2(readFont('RHWPOldHangul-Regular.woff2')))
  const sum = (/** @type {Buffer} */ bytes) => {
    let total = 0
    for (let i = 0; i < bytes.length; i += 4) total = (total + bytes.readUInt32BE(i)) >>> 0
    return total
  }
  assert.equal(sum(font), 0xb1b0afba)
  for (let record = 12; record < 12 + font.readUInt16BE(4) * 16; record += 16) {
    if (font.toString('latin1', record, record + 4) === 'head') continue
    const start = font.readUInt32BE(record + 8)
    const end = start + Math.ceil(font.readUInt32BE(record + 12) / 4) * 4
    assert.equal(sum(font.subarray(start, end)), font.readUInt32BE(record + 4))
  }
})

/** @param {Uint8Array} font @param {RegExp} [reason] */
function rejects(font, reason = /Invalid WOFF2/) {
  assert.throws(() => decodeWoff2(font), reason)
}

test('input that is not a complete WOFF2 file is refused', () => {
  const real = readFont('RHWPOldHangul-Regular.woff2')
  rejects(Buffer.alloc(0), /no wOF2 header/)
  rejects(Buffer.from('wOF2'), /no wOF2 header/)
  const woff1 = Buffer.from(real)
  woff1.write('wOFF')
  rejects(woff1, /no wOF2 header/)
  rejects(withLength(Buffer.from(real.subarray(0, 48))), /unexpected end of data/)
  const noTables = withLength(Buffer.from(real.subarray(0, 48)))
  noTables.writeUInt16BE(0, 12)
  rejects(noTables, /no tables/)
  rejects(real.subarray(0, -4), /wrong file length/)
  rejects(Buffer.concat([real, Buffer.alloc(4)]), /wrong file length/)
})

test('a truncated or wrong Brotli stream is refused', () => {
  const real = readFont('RHWPOldHangul-Regular.woff2')
  // The header still claims the whole stream, then only what is left of it.
  const cut = withLength(Buffer.from(real.subarray(0, 100_000)))
  rejects(cut, /unexpected end of data/)
  cut.writeUInt32BE(90_000, 20)
  assert.throws(() => decodeWoff2(cut))
  const garbage = Buffer.from(real)
  garbage.fill(0xff, 1000, 2000)
  assert.throws(() => decodeWoff2(garbage))
})

test('table lengths that disagree with the data are refused', () => {
  const tables = syntheticTables()
  const last = tables.length - 1
  for (const length of [2, 4, 1000]) {
    assert.throws(() => decodeWoff2(encode(tables.with(last, { ...tables[last], length }))))
  }
  rejects(encode(tables.with(1, { ...tables[1], length: 14 })), /wrong loca length/)
  rejects(encode(tables.with(1, { ...tables[1], data: Buffer.alloc(1) })), /transformed loca/)
  rejects(encode(tables.with(4, { ...tables[4], length: 18 })), /wrong hmtx length/)
})

test('malformed UIntBase128 values are refused', () => {
  const sizes = [
    [[0x80, 0x03], /leading zero/],
    [[0x90, 0x80, 0x80, 0x80, 0x00], /exceeds 32 bits/],
    [[0x8f, 0xff, 0xff, 0xff, 0xff, 0x7f], /longer than five bytes/],
    [Array(19).fill(0xff), /exceeds 32 bits/], // 133 bits
    [[...Array(18).fill(0x81), 0x01], /longer than five bytes/]
  ]
  for (const [bytes, reason] of sizes) {
    const data = Buffer.from('odd')
    rejects(encode([{ tag: 'zzzz', data, sizes: Buffer.from(/** @type {number[]} */ (bytes)) }]), /** @type {RegExp} */ (reason))
  }
})

test('glyph streams that end early or contradict each other are refused', () => {
  rejects(encode(syntheticTables({ shortBy: 1 })), /unexpected end of data/)
  rejects(encode(syntheticTables({ shortBy: 500 })), /unexpected end of glyph coordinates/)
  const tables = syntheticTables()
  const glyf = tables[0].data
  /** @param {number} at @param {number} value @param {RegExp} reason */
  const change = (at, value, reason) => {
    const data = Buffer.from(glyf)
    data.writeUInt16BE(value, at)
    rejects(encode(tables.with(0, { ...tables[0], data })), reason)
  }
  change(4, 0xffff, /unexpected end of data/) // glyph count
  change(6, 2, /unknown loca format/)
  change(8, 0x1000, /outside its container/) // contour stream size
  change(36, 0xfffe, /unknown glyph type/)
  change(36, 0xffff, /no bounding box/)
  change(36 + 4, 0, /an empty glyph has a bounding box/)
  change(36 + 2, 0x7fff, /unexpected end of data|too many points/)
  rejects(encode(tables.with(0, { ...tables[0], data: glyf.subarray(0, 35) })))
})

test('missing, repeated and unknown tables are refused', () => {
  const tables = syntheticTables()
  rejects(encode(tables.filter(({ tag }) => tag !== tags.loca)), /do not come together/)
  rejects(encode(tables.filter(({ tag }) => tag !== tags.hhea)), /needs hhea/)
  rejects(encode(tables.filter(({ tag }) => tag !== tags.glyf && tag !== tags.loca)), /needs hhea/)
  rejects(encode([...tables, tables[2]]), /repeated/)
  rejects(encode(tables.with(2, { ...tables[2], version: 1, transform: true })), /unknown table transform/)
  rejects(encode(tables.with(0, { ...tables[0], version: 1 })), /unknown table transform/)
  rejects(encode(tables.with(2, { ...tables[2], data: Buffer.alloc(11) })), /head is too short/)
  rejects(encode(tables, { collection: { version: 0x00010000, fonts: [[2, 7]] } }), /missing table/)
  rejects(encode(tables, { collection: { version: 0x00010000, fonts: [[2], []] } }), /no tables/)
  rejects(encode(tables, { collection: { version: 0x00010000, fonts: [] } }), /no fonts/)
  rejects(encode(tables, { collection: { version: 3, fonts: [[2]] } }), /collection version/)
  rejects(encode(tables, { collection: { version: 0x00010000, fonts: [[0, 2, 1]] } }), /does not follow/)
})

test('sizes above 64 MiB are refused before the data is decompressed', () => {
  const limit = 64 * 1024 * 1024
  const data = Buffer.from('odd')
  rejects(encode([{ tag: 'zzzz', data }], { sfntSize: limit + 1 }), /size limit/)
  rejects(encode([{ tag: 'zzzz', data, length: limit + 1 }]), /size limit/)
  rejects(encode([{ tag: 'zzzz', data, length: 0xffffffff }]), /size limit/)
  rejects(encode([{ tag: 'zzzz', data, length: limit / 2 }, { tag: 'zzzy', data, length: limit / 2 + 1 }]), /size limit/)
  // A small declaration does not let a larger stream through.
  assert.throws(() => decodeWoff2(encode([{ tag: 'zzzz', data }], { stream: Buffer.alloc(limit) })))
  // An allowed but wrong sfnt size is only a hint.
  assert.ok(decodeWoff2(encode([{ tag: 'zzzz', data }], { sfntSize: limit })).length < 100)
})

test('300 randomly damaged fonts end with a font or an Error within two seconds', () => {
  let seed = 20261124
  /** @param {number} limit */
  const random = (limit) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor((seed / 2 ** 32) * limit)
  }
  const real = readFont('RHWPOldHangul-Regular.woff2')
  const synthetic = syntheticTables({ overlap: true })
  let decoded = 0
  let elapsed = 0
  for (let i = 0; i < 300; i++) {
    let font
    if (i % 3 === 0) {
      // Damage the file itself, half of the time near its directory.
      font = Buffer.from(real)
      for (let n = 0; n <= random(4); n++) font[random(i % 2 ? font.length : 120)] = random(256)
    } else {
      // Damage a table, so that the change survives Brotli.
      const index = [0, 0, 0, 2, 3, 4][random(6)]
      const data = Buffer.from(synthetic[index].data)
      for (let n = 0; n <= random(4); n++) data[random(data.length)] = random(256)
      font = encode(synthetic.with(index, { ...synthetic[index], data }))
    }
    const start = performance.now()
    try {
      decodeWoff2(font)
      decoded++
    } catch (error) {
      assert.ok(error instanceof Error)
    }
    elapsed += performance.now() - start
  }
  assert.ok(decoded > 0 && decoded < 300, `${decoded} of 300 decoded`)
  assert.ok(elapsed < 2000, `${elapsed} ms`)
})
