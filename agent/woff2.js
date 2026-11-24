import { brotliDecompressSync } from 'node:zlib'

const headerSize = 48
const sfntHeaderSize = 12
const sfntRecordSize = 16
const glyfHeaderSize = 36
const maxDecodedBytes = 64 * 1024 * 1024
const collectionFlavor = 0x74746366 // ttcf

// Table tags by the index used in a WOFF2 table directory entry (section 4.1).
const knownTags = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt',
  'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'
]

// The 128 ways a point's delta is packed into the glyph stream (section 5.2,
// triplet encoding): x and y have xBits and yBits stored bits, to which a base
// is added before the sign is applied.
const tripletBytes = new Uint8Array(128)
const tripletYBits = new Uint8Array(128)
const tripletXBase = new Int32Array(128)
const tripletYBase = new Int32Array(128)
const tripletXSign = new Int32Array(128)
const tripletYSign = new Int32Array(128)
for (let i = 0; i < 128; i++) {
  let xBits = 0
  let yBits = 0
  tripletXSign[i] = i & 1 ? 1 : -1
  tripletYSign[i] = i & 2 ? 1 : -1
  if (i < 10) {
    yBits = 8
    tripletYBase[i] = (i >> 1) * 256
    tripletYSign[i] = tripletXSign[i]
  } else if (i < 20) {
    xBits = 8
    tripletXBase[i] = ((i - 10) >> 1) * 256
  } else if (i < 84) {
    xBits = yBits = 4
    tripletXBase[i] = 1 + ((i - 20) >> 4) * 16
    tripletYBase[i] = 1 + (((i - 20) >> 2) & 3) * 16
  } else if (i < 120) {
    xBits = yBits = 8
    tripletXBase[i] = 1 + Math.floor((i - 84) / 12) * 256
    tripletYBase[i] = 1 + (((i - 84) % 12) >> 2) * 256
  } else {
    xBits = yBits = i < 124 ? 12 : 16
  }
  tripletBytes[i] = (xBits + yBits) / 8
  tripletYBits[i] = yBits
}

/** @param {string} reason */
const invalid = (reason) => new Error(`Invalid WOFF2 font: ${reason}`)

/** @param {number} size */
const pad4 = (size) => Math.ceil(size / 4) * 4

/** @param {string} tag */
const tagNumber = (tag) =>
  ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0

/** Reads big-endian values from bytes[pos, end) and refuses to leave that range. */
class Reader {
  /** @param {Uint8Array} bytes @param {number} [pos] @param {number} [end] */
  constructor(bytes, pos = 0, end = bytes.length) {
    if (pos > end || end > bytes.length) throw invalid('data is outside its container')
    this.bytes = bytes
    this.pos = pos
    this.end = end
  }

  /** Start of the next `size` bytes. @param {number} size */
  skip(size) {
    const start = this.pos
    if (size > this.end - start) throw invalid('unexpected end of data')
    this.pos = start + size
    return start
  }

  /** @param {number} size */
  take(size) {
    const start = this.skip(size)
    return this.bytes.subarray(start, start + size)
  }

  u8() {
    return this.bytes[this.skip(1)]
  }

  u16() {
    const at = this.skip(2)
    return (this.bytes[at] << 8) | this.bytes[at + 1]
  }

  u32() {
    const at = this.skip(4)
    const { bytes } = this
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
  }

  /** 255UInt16: one byte up to 252, and three prefixes for larger values. */
  u255() {
    const code = this.u8()
    if (code === 253) return this.u16()
    if (code === 254) return this.u8() + 506
    if (code === 255) return this.u8() + 253
    return code
  }

  /** UIntBase128: at most five groups of seven bits that fit in 32 bits, without leading zeros. */
  base128() {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const byte = this.u8()
      if (i === 0 && byte === 0x80) throw invalid('UIntBase128 has a leading zero')
      value = value * 128 + (byte & 0x7f)
      if (value > 0xffffffff) throw invalid('UIntBase128 exceeds 32 bits')
      if (byte < 0x80) return value
    }
    throw invalid('UIntBase128 is longer than five bytes')
  }
}

/**
 * @typedef {object} Table
 * @property {number} tag
 * @property {number} origLength
 * @property {boolean} transformed
 * @property {number} length Size in the decompressed stream.
 * @property {Uint8Array} data Stream bytes, then the reconstructed table.
 * @property {number} offset Position in the sfnt, or -1 when not written yet.
 * @property {number} checksum
 * @property {Int16Array} [xMins] The glyphs' left edges, once a glyf table is reconstructed.
 * @property {boolean} [rebuilt]
 */

/** @typedef {{ flavor: number, tables: Table[], byTag: Map<number, Table> }} Font */

const glyfTag = tagNumber('glyf')
const locaTag = tagNumber('loca')
const hmtxTag = tagNumber('hmtx')
const hheaTag = tagNumber('hhea')
const headTag = tagNumber('head')

/** @param {Reader} reader @returns {Table} */
function readTableEntry(reader) {
  const flags = reader.u8()
  const index = flags & 0x3f
  const version = flags >> 6
  const tag = index === 63 ? reader.u32() : tagNumber(knownTags[index])
  const origLength = reader.base128()
  // glyf and loca are transformed by version 0 and stored as they are by 3;
  // for every other table version 0 is the untransformed one.
  const transformed = tag === glyfTag || tag === locaTag ? version !== 3 : version !== 0
  if (transformed && version !== (tag === hmtxTag ? 1 : 0)) throw invalid('unknown table transform')
  const length = transformed ? reader.base128() : origLength
  if (tag === locaTag && transformed && length !== 0) throw invalid('a transformed loca table has data')
  if (origLength > maxDecodedBytes || length > maxDecodedBytes) throw invalid('a table exceeds the size limit')
  return { tag, origLength, transformed, length, data: new Uint8Array(0), offset: -1, checksum: 0 }
}

/** @param {number} flavor @param {Table[]} tables @returns {Font} */
function makeFont(flavor, tables) {
  if (tables.length === 0) throw invalid('a font has no tables')
  const byTag = new Map(tables.map((table) => [table.tag, table]))
  if (byTag.size !== tables.length) throw invalid('a table tag is repeated')
  return { flavor, tables, byTag }
}

/** @param {Reader} reader @param {Table[]} tables */
function readCollection(reader, tables) {
  const version = reader.u32()
  if (version !== 0x00010000 && version !== 0x00020000) throw invalid('unknown collection version')
  const count = reader.u255()
  if (count === 0) throw invalid('a collection has no fonts')
  const fonts = []
  let recordCount = 0
  for (let i = 0; i < count; i++) {
    const tableCount = reader.u255()
    recordCount += tableCount
    if (recordCount * sfntRecordSize > maxDecodedBytes) throw invalid('the collection exceeds the size limit')
    const flavor = reader.u32()
    const selected = []
    for (let j = 0; j < tableCount; j++) {
      const index = reader.u255()
      if (index >= tables.length) throw invalid('a collection refers to a missing table')
      const table = tables[index]
      const previous = selected.at(-1)
      if (table.tag === locaTag && (previous?.tag !== glyfTag || previous !== tables[index - 1])) {
        throw invalid('loca does not follow its glyf table')
      }
      selected.push(table)
    }
    fonts.push(makeFont(flavor, selected))
  }
  return { version, fonts }
}

/** @param {Uint8Array} bytes */
function readContainer(bytes) {
  const reader = new Reader(bytes)
  if (bytes.length < headerSize || reader.u32() !== 0x774f4632) throw invalid('no wOF2 header')
  const flavor = reader.u32()
  const length = reader.u32()
  const tableCount = reader.u16()
  reader.skip(2) // reserved
  const sfntSize = reader.u32()
  const compressedSize = reader.u32()
  reader.skip(4) // font version
  const meta = [reader.u32(), reader.u32()]
  reader.skip(4) // uncompressed metadata size
  const priv = [reader.u32(), reader.u32()]
  if (length !== bytes.length) throw invalid('wrong file length')
  if (tableCount === 0) throw invalid('no tables')
  // sfntSize is only a hint, so no buffer is sized from it alone.
  if (sfntSize > maxDecodedBytes) throw invalid('the font exceeds the size limit')
  for (const [offset, size] of [meta, priv]) {
    if (offset !== 0 && offset + size > bytes.length) throw invalid('metadata is outside the file')
  }

  const tables = []
  let streamSize = 0
  for (let i = 0; i < tableCount; i++) {
    const table = readTableEntry(reader)
    tables.push(table)
    streamSize += table.length
  }
  if (streamSize === 0 || streamSize > maxDecodedBytes) throw invalid('the table data is empty or exceeds the size limit')
  const collection = flavor === collectionFlavor ? readCollection(reader, tables) : null
  const fonts = collection ? collection.fonts : [makeFont(flavor, tables)]

  // All tables share one Brotli stream, directly after the directories.
  const stream = brotliDecompressSync(reader.take(compressedSize), { maxOutputLength: streamSize, chunkSize: 1 << 18 })
  if (stream.length !== streamSize) throw invalid('wrong decompressed size')
  const data = new Reader(stream)
  for (const table of tables) table.data = data.take(table.length)
  return { fonts, collectionVersion: collection ? collection.version : 0, sfntSize }
}

/** A byte buffer that grows as data arrives, up to the size limit. */
class Writer {
  constructor() {
    this.bytes = new Uint8Array(1 << 16)
    this.pos = 0
  }

  /** Make room for `size` more bytes. @param {number} size */
  reserve(size) {
    const needed = this.pos + size
    if (needed <= this.bytes.length) return
    if (needed > maxDecodedBytes) throw invalid('the font exceeds the size limit')
    const grown = new Uint8Array(Math.min(maxDecodedBytes, Math.max(needed, this.bytes.length * 2)))
    grown.set(this.bytes.subarray(0, this.pos))
    this.bytes = grown
  }

  /** @param {number} value */
  u16(value) {
    this.bytes[this.pos++] = value >> 8
    this.bytes[this.pos++] = value
  }

  /** @param {Uint8Array} data */
  copy(data) {
    this.bytes.set(data, this.pos)
    this.pos += data.length
  }
}

// Simple glyph flags and composite component flags of the glyf table.
const onCurve = 0x01
const xShort = 0x02
const yShort = 0x04
const repeat = 0x08
const xSameOrPositive = 0x10
const ySameOrPositive = 0x20
const overlapSimple = 0x40
const argsAreWords = 0x0001
const haveScale = 0x0008
const moreComponents = 0x0020
const haveXYScale = 0x0040
const haveTwoByTwo = 0x0080
const haveInstructions = 0x0100

/** Rebuilds glyf and loca from a transformed glyf table (section 5.1). */
class GlyfDecoder {
  /** @param {Uint8Array} data The transformed glyf table. */
  constructor(data) {
    const header = new Reader(data)
    header.skip(2) // reserved
    this.options = header.u16()
    this.glyphCount = header.u16()
    this.indexFormat = header.u16()
    if (this.indexFormat > 1) throw invalid('unknown loca format')
    const sizes = Array.from({ length: 7 }, () => header.u32())
    let start = glyfHeaderSize
    const [contours, points, flags, glyphs, composites, boxes, instructions] = sizes.map((size) => {
      const stream = new Reader(data, start, start + size)
      start += size
      return stream
    })
    this.contours = contours
    this.points = points
    this.flags = flags
    this.glyphs = glyphs
    this.composites = composites
    this.boxes = boxes
    this.instructions = instructions
    this.boxBitmap = boxes.take(((this.glyphCount + 31) >> 5) * 4)
    this.overlapBitmap = this.options & 1 ? new Reader(data, start).take((this.glyphCount + 7) >> 3) : null
    this.out = new Writer()
    this.xMins = new Int16Array(this.glyphCount)
    this.dx = new Int32Array(256)
    this.dy = new Int32Array(256)
  }

  /** @returns {{ glyf: Uint8Array, loca: Uint8Array, xMins: Int16Array }} */
  decode() {
    const { out, glyphCount, indexFormat } = this
    const entrySize = indexFormat ? 4 : 2
    const loca = new DataView(new ArrayBuffer((glyphCount + 1) * entrySize))
    for (let glyph = 0; glyph <= glyphCount; glyph++) {
      if (indexFormat) loca.setUint32(glyph * 4, out.pos)
      else if (out.pos > 0x1fffe) throw invalid('glyf is too large for a short loca table')
      else loca.setUint16(glyph * 2, out.pos >> 1)
      if (glyph < glyphCount) this.glyph(glyph)
    }
    return { glyf: out.bytes.subarray(0, out.pos), loca: new Uint8Array(loca.buffer), xMins: this.xMins }
  }

  /** @param {number} glyph */
  glyph(glyph) {
    const { out } = this
    const contourCount = this.contours.u16()
    const bit = 0x80 >> (glyph & 7)
    const hasBox = (this.boxBitmap[glyph >> 3] & bit) !== 0
    if (contourCount === 0) {
      if (hasBox) throw invalid('an empty glyph has a bounding box')
      return
    }
    if (contourCount === 0xffff) {
      if (!hasBox) throw invalid('a composite glyph has no bounding box')
      this.composite(glyph)
    } else {
      if (contourCount > 0x7fff) throw invalid('unknown glyph type')
      const overlap = this.overlapBitmap !== null && (this.overlapBitmap[glyph >> 3] & bit) !== 0
      this.simple(glyph, contourCount, hasBox, overlap)
    }
    out.reserve(3)
    while (out.pos % 4 !== 0) out.bytes[out.pos++] = 0
  }

  /** @param {number} glyph */
  box(glyph) {
    const box = this.boxes.take(8)
    this.xMins[glyph] = (box[0] << 8) | box[1]
    this.out.copy(box)
  }

  /** @param {number} glyph */
  composite(glyph) {
    const { composites, out } = this
    const start = composites.pos
    let instructed = false
    let flags
    do {
      flags = composites.u16()
      composites.skip(flags & argsAreWords ? 6 : 4) // glyph index and arguments
      if (flags & haveScale) composites.skip(2)
      else if (flags & haveXYScale) composites.skip(4)
      else if (flags & haveTwoByTwo) composites.skip(8)
      if (flags & haveInstructions) instructed = true
    } while (flags & moreComponents)
    const components = composites.bytes.subarray(start, composites.pos)
    const program = instructed ? this.instructions.take(this.glyphs.u255()) : null

    out.reserve(12 + components.length + (program ? program.length : 0))
    out.u16(0xffff)
    this.box(glyph)
    out.copy(components)
    if (program) {
      out.u16(program.length)
      out.copy(program)
    }
  }

  /** @param {number} glyph @param {number} contourCount @param {boolean} hasBox @param {boolean} overlap */
  simple(glyph, contourCount, hasBox, overlap) {
    const { out, points } = this
    out.reserve(10 + contourCount * 2)
    const header = out.pos
    out.u16(contourCount)
    if (hasBox) this.box(glyph)
    else out.pos += 8
    let pointCount = 0
    for (let i = 0; i < contourCount; i++) {
      pointCount += points.u255()
      if (pointCount > 0x10000) throw invalid('a glyph has too many points')
      out.u16(pointCount - 1)
    }
    const flags = this.flags.take(pointCount)
    this.coordinates(flags, hasBox ? -1 : header + 2, glyph)
    const program = this.instructions.take(this.glyphs.u255())
    // A point takes at most one flag byte and two bytes per coordinate.
    out.reserve(2 + program.length + pointCount * 5)
    out.u16(program.length)
    out.copy(program)
    this.writePoints(flags, overlap)
  }

  /**
   * Unpack the points' deltas into dx and dy, and write their bounds at boxAt.
   * @param {Uint8Array} flags @param {number} boxAt @param {number} glyph
   */
  coordinates(flags, boxAt, glyph) {
    const { glyphs, out } = this
    const count = flags.length
    if (count > this.dx.length) {
      this.dx = new Int32Array(Math.max(count, this.dx.length * 2))
      this.dy = new Int32Array(this.dx.length)
    }
    const { dx, dy } = this
    const { bytes, end } = glyphs
    let { pos } = glyphs
    let x = 0
    let y = 0
    let xMin = Infinity
    let yMin = Infinity
    let xMax = -Infinity
    let yMax = -Infinity
    for (let i = 0; i < count; i++) {
      const code = flags[i] & 0x7f
      const next = pos + tripletBytes[code]
      if (next > end) throw invalid('unexpected end of glyph coordinates')
      let packed = 0
      while (pos < next) packed = (packed << 8) | bytes[pos++]
      const yBits = tripletYBits[code]
      dx[i] = tripletXSign[code] * ((packed >>> yBits) + tripletXBase[code])
      dy[i] = tripletYSign[code] * ((packed & ((1 << yBits) - 1)) + tripletYBase[code])
      x += dx[i]
      y += dy[i]
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
    glyphs.pos = pos
    if (boxAt < 0) return
    const box = count ? [xMin, yMin, xMax, yMax] : [0, 0, 0, 0]
    this.xMins[glyph] = box[0]
    for (let i = 0; i < 4; i++) {
      out.bytes[boxAt + i * 2] = box[i] >> 8
      out.bytes[boxAt + i * 2 + 1] = box[i]
    }
  }

  /** @param {Uint8Array} pointFlags @param {boolean} overlap */
  writePoints(pointFlags, overlap) {
    const { out, dx, dy } = this
    const { bytes } = out
    const count = pointFlags.length
    let { pos } = out
    let previous = -1
    let repeats = 0
    let xSize = 0
    for (let i = 0; i < count; i++) {
      const x = dx[i]
      const y = dy[i]
      let flag = pointFlags[i] & 0x80 ? 0 : onCurve
      if (i === 0 && overlap) flag |= overlapSimple
      if (x === 0) flag |= xSameOrPositive
      else if (x > -256 && x < 256) {
        flag |= x > 0 ? xShort | xSameOrPositive : xShort
        xSize += 1
      } else xSize += 2
      if (y === 0) flag |= ySameOrPositive
      else if (y > -256 && y < 256) flag |= y > 0 ? yShort | ySameOrPositive : yShort

      if (flag === previous && repeats < 255) {
        // A repeated flag is stored once, with a count in the next byte.
        if (repeats === 0) bytes[pos++ - 1] |= repeat
        bytes[pos - 1] = ++repeats
      } else {
        bytes[pos++] = flag
        previous = flag
        repeats = 0
      }
    }
    let xPos = pos
    let yPos = pos + xSize
    for (let i = 0; i < count; i++) {
      const x = dx[i]
      const y = dy[i]
      if (x <= -256 || x >= 256) {
        bytes[xPos++] = x >> 8
        bytes[xPos++] = x
      } else if (x !== 0) bytes[xPos++] = x < 0 ? -x : x
      if (y <= -256 || y >= 256) {
        bytes[yPos++] = y >> 8
        bytes[yPos++] = y
      } else if (y !== 0) bytes[yPos++] = y < 0 ? -y : y
    }
    out.pos = yPos
  }
}

/** @param {Font} font */
function rebuildGlyf({ byTag }) {
  const glyf = byTag.get(glyfTag)
  const loca = byTag.get(locaTag)
  if (!glyf !== !loca) throw invalid('glyf and loca do not come together')
  if (!glyf || !loca || glyf.rebuilt) return
  if (glyf.transformed !== loca.transformed) throw invalid('only one of glyf and loca is transformed')
  if (!glyf.transformed) return
  const result = new GlyfDecoder(glyf.data).decode()
  if (result.loca.length !== loca.origLength) throw invalid('wrong loca length')
  glyf.data = result.glyf
  glyf.xMins = result.xMins
  loca.data = result.loca
  glyf.rebuilt = true
}

/** @param {Font} font */
function rebuildHmtx({ byTag }) {
  const hmtx = byTag.get(hmtxTag)
  if (!hmtx || !hmtx.transformed || hmtx.rebuilt) return
  const hhea = byTag.get(hheaTag)
  const xMins = byTag.get(glyfTag)?.xMins
  if (!hhea || !xMins) throw invalid('a transformed hmtx table needs hhea and a transformed glyf table')
  const metricCount = new Reader(hhea.data, 34).u16()
  const glyphCount = xMins.length
  if (metricCount === 0 || metricCount > glyphCount) throw invalid('wrong number of horizontal metrics')

  const reader = new Reader(hmtx.data)
  const flags = reader.u8()
  // The two bits tell which side bearings are left out because they equal xMin.
  if (flags === 0 || flags > 3) throw invalid('unknown hmtx transform flags')
  const advances = reader.take(metricCount * 2)
  const bearings = flags & 1 ? null : reader.take(metricCount * 2)
  const extra = flags & 2 ? null : reader.take((glyphCount - metricCount) * 2)
  const out = new DataView(new ArrayBuffer((metricCount + glyphCount) * 2))
  if (out.byteLength !== hmtx.origLength) throw invalid('wrong hmtx length')
  for (let i = 0; i < metricCount; i++) {
    out.setUint16(i * 4, (advances[i * 2] << 8) | advances[i * 2 + 1])
    out.setInt16(i * 4 + 2, bearings ? (bearings[i * 2] << 8) | bearings[i * 2 + 1] : xMins[i])
  }
  for (let i = metricCount; i < glyphCount; i++) {
    const at = (i - metricCount) * 2
    out.setInt16((metricCount + i) * 2, extra ? (extra[at] << 8) | extra[at + 1] : xMins[i])
  }
  hmtx.data = new Uint8Array(out.buffer)
  hmtx.rebuilt = true
}

/** @param {Uint8Array} bytes @param {number} start @param {number} end Both multiples of four. */
function checksum(bytes, start, end) {
  let sum = 0
  for (let i = start; i < end; i += 4) {
    sum = (sum + ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])) | 0
  }
  return sum >>> 0
}

/** @param {{ fonts: Font[], collectionVersion: number, sfntSize: number }} container */
function buildSfnt({ fonts, collectionVersion, sfntSize }) {
  let size = 0
  if (collectionVersion) size += 12 + fonts.length * 4 + (collectionVersion === 0x00020000 ? 12 : 0)
  const directories = fonts.map(({ tables }) => {
    const start = size
    size += sfntHeaderSize + tables.length * sfntRecordSize
    return start
  })
  /** @param {Table | undefined} table */
  const place = (table) => {
    if (!table || table.offset >= 0) return
    table.offset = size
    size += pad4(table.data.length)
    if (size > maxDecodedBytes) throw invalid('the font exceeds the size limit')
  }
  for (const { tables, byTag } of fonts) {
    for (const table of tables) {
      // A rebuilt loca goes right after the glyf it was rebuilt with.
      if (table.tag === locaTag && table.transformed) continue
      place(table)
      if (table.tag === glyfTag && table.transformed) place(byTag.get(locaTag))
    }
  }
  // A rebuilt glyf can be smaller than the original. Fill the difference with
  // zeros, as common decoders do, unless the declared size is implausible.
  if (sfntSize > size && sfntSize <= size * 2) size = sfntSize

  const sfnt = new Uint8Array(size)
  const view = new DataView(sfnt.buffer)
  if (collectionVersion) {
    view.setUint32(0, collectionFlavor)
    view.setUint32(4, collectionVersion)
    view.setUint32(8, fonts.length)
    directories.forEach((start, i) => view.setUint32(12 + i * 4, start))
  }
  const written = new Set()
  fonts.forEach(({ flavor, tables, byTag }, i) => {
    const start = directories[i]
    const count = tables.length
    const entrySelector = 31 - Math.clz32(count)
    const searchRange = (1 << entrySelector) * sfntRecordSize
    view.setUint32(start, flavor)
    view.setUint16(start + 4, count)
    view.setUint16(start + 6, searchRange)
    view.setUint16(start + 8, entrySelector)
    view.setUint16(start + 10, count * sfntRecordSize - searchRange)
    const head = byTag.get(headTag)
    if (head && head.data.length < 12) throw invalid('head is too short')

    let sum = 0
    let record = start + sfntHeaderSize
    for (const table of [...tables].sort((a, b) => a.tag - b.tag)) {
      const { tag, data, offset } = table
      if (!written.has(table)) {
        written.add(table)
        sfnt.set(data, offset)
        // head.checkSumAdjustment counts as zero in every checksum.
        if (tag === headTag) view.setUint32(offset + 8, 0)
        table.checksum = checksum(sfnt, offset, offset + pad4(data.length))
      }
      view.setUint32(record, tag)
      view.setUint32(record + 4, table.checksum)
      view.setUint32(record + 8, offset)
      view.setUint32(record + 12, data.length)
      record += sfntRecordSize
      sum += table.checksum
    }
    if (head) view.setUint32(head.offset + 8, 0xb1b0afba - sum - checksum(sfnt, start, record))
  })
  return sfnt
}

/**
 * Restore an sfnt font or collection from a WOFF2 file. Documents can carry
 * such fonts, so nothing in the file is trusted: every read is bounded, and
 * the decompressed data and the result are limited to 64 MiB.
 * @see https://www.w3.org/TR/WOFF2/
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function decodeWoff2(bytes) {
  const container = readContainer(bytes)
  for (const font of container.fonts) {
    rebuildGlyf(font)
    rebuildHmtx(font)
  }
  return buildSfnt(container)
}
