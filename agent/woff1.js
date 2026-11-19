import { inflateSync } from 'node:zlib'

const headerSize = 44
const woffRecordSize = 20
const sfntHeaderSize = 12
const sfntRecordSize = 16
const maxDecodedBytes = 64 * 1024 * 1024

/** @param {number} size */
const pad4 = (size) => Math.ceil(size / 4) * 4

/**
 * Restore an sfnt font from WOFF 1 table data. Optional WOFF metadata and
 * private data are separate from the font used by resvg.
 * @see https://www.w3.org/TR/WOFF/
 * @param {Buffer} bytes
 */
export function decodeWoff1(bytes) {
  if (bytes.length < headerSize || bytes.toString('ascii', 0, 4) !== 'wOFF' ||
      bytes.readUInt32BE(8) !== bytes.length || bytes.readUInt16BE(14) !== 0) {
    throw new Error('Invalid WOFF1 header')
  }
  const count = bytes.readUInt16BE(12)
  const expectedSize = bytes.readUInt32BE(16)
  const dataStart = headerSize + count * woffRecordSize
  if (count === 0 || count >= 4096 || dataStart > bytes.length || expectedSize > maxDecodedBytes) {
    throw new Error('Invalid or oversized WOFF1 table directory')
  }

  const tables = []
  const sfntDataStart = sfntHeaderSize + count * sfntRecordSize
  let decodedSize = sfntDataStart
  let previousTag = -1
  for (let i = 0; i < count; i++) {
    const entry = headerSize + i * woffRecordSize
    const tag = bytes.readUInt32BE(entry)
    const offset = bytes.readUInt32BE(entry + 4)
    const compressed = bytes.readUInt32BE(entry + 8)
    const original = bytes.readUInt32BE(entry + 12)
    const checksum = bytes.readUInt32BE(entry + 16)
    if (tag <= previousTag || offset % 4 !== 0 || offset < dataStart ||
        offset + pad4(compressed) > bytes.length || compressed > original) {
      throw new Error('Invalid WOFF1 table entry')
    }
    previousTag = tag
    decodedSize += pad4(original)
    tables.push({ tag, offset, compressed, original, checksum, index: i })
  }
  if (decodedSize !== expectedSize) throw new Error('Invalid decoded WOFF1 size')

  const sfnt = Buffer.alloc(decodedSize)
  const entrySelector = Math.floor(Math.log2(count))
  const searchRange = (2 ** entrySelector) * sfntRecordSize
  bytes.copy(sfnt, 0, 4, 8) // sfnt flavor
  sfnt.writeUInt16BE(count, 4)
  sfnt.writeUInt16BE(searchRange, 6)
  sfnt.writeUInt16BE(entrySelector, 8)
  sfnt.writeUInt16BE(count * sfntRecordSize - searchRange, 10)

  let outputOffset = sfntDataStart
  let inputEnd = dataStart
  // Keep the original table data order, while writing each directory record
  // at its sorted tag index.
  for (const { tag, offset, compressed, original, checksum, index } of tables.sort((a, b) => a.offset - b.offset)) {
    if (offset < inputEnd) throw new Error('Overlapping WOFF1 tables')
    inputEnd = offset + pad4(compressed)
    const stored = bytes.subarray(offset, offset + compressed)
    const table = compressed === original ? stored : inflateSync(stored, { maxOutputLength: original })
    if (table.length !== original) throw new Error('Incorrect WOFF1 table length')

    const record = sfntHeaderSize + index * sfntRecordSize
    sfnt.writeUInt32BE(tag, record)
    sfnt.writeUInt32BE(checksum, record + 4)
    sfnt.writeUInt32BE(outputOffset, record + 8)
    sfnt.writeUInt32BE(original, record + 12)
    table.copy(sfnt, outputOffset)
    outputOffset += pad4(original)
  }
  return sfnt
}
