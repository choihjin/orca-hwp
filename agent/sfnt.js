// Read only the name tables during system font discovery. Bundled and document
// faces can be given the family and weight declared by their stylesheet.
import { closeSync, openSync, readSync } from 'node:fs'

const opentypeTags = new Set([0x00010000, 0x4f54544f, 0x74727565, 0x74797031])
const utf16be = new TextDecoder('utf-16be')

/** @typedef {(offset: number, length: number) => Buffer} FontReader */

/** @param {FontReader} read @param {number} [offset] */
function tablesAt(read, offset = 0) {
  const header = read(offset, 12)
  if (header.length < 12 || !opentypeTags.has(header.readUInt32BE(0))) return new Map()
  const directory = read(offset + 12, header.readUInt16BE(4) * 16)
  /** @type {Map<string, { record: number, offset: number, size: number }>} */
  const tables = new Map()
  for (let entry = 0; entry + 16 <= directory.length; entry += 16) {
    tables.set(directory.toString('ascii', entry, entry + 4), {
      record: offset + 12 + entry,
      offset: directory.readUInt32BE(entry + 8),
      size: directory.readUInt32BE(entry + 12)
    })
  }
  return tables
}

/** @param {Buffer} table */
function nameRecords(table) {
  if (table.length < 6) return []
  const records = []
  for (let i = 0; i < table.readUInt16BE(2); i++) {
    const offset = 6 + 12 * i
    if (offset + 12 > table.length) break
    records.push(table.subarray(offset, offset + 12))
  }
  return records
}

/** @param {Buffer} table @param {number[]} [ids] */
function familyNames(table, ids = [1, 16]) {
  return nameRecords(table).flatMap((record) => {
    const platform = record.readUInt16BE(0)
    const nameId = record.readUInt16BE(6)
    if (!ids.includes(nameId) || (platform !== 0 && platform !== 3)) return []
    const start = table.readUInt16BE(4) + record.readUInt16BE(10)
    const bytes = table.subarray(start, start + record.readUInt16BE(8))
    return [utf16be.decode(bytes)]
  })
}

/** @param {string} path @param {Set<string>} requested */
export function hasRequestedFamily(path, requested) {
  const fd = openSync(path, 'r')
  try {
    /** @type {FontReader} */
    const read = (offset, length) => {
      const bytes = Buffer.alloc(length)
      return bytes.subarray(0, readSync(fd, bytes, 0, length, offset))
    }
    const header = read(0, 12)
    if (header.length < 12) return false
    const collection = header.toString('ascii', 0, 4) === 'ttcf'
    const offsets = collection ? read(12, header.readUInt32BE(8) * 4) : Buffer.alloc(4)
    for (let i = 0; i + 4 <= offsets.length; i += 4) {
      const table = tablesAt(read, offsets.readUInt32BE(i)).get('name')
      if (table && familyNames(read(table.offset, table.size)).some((name) => requested.has(name.toLowerCase()))) {
        return true
      }
    }
    return false
  } finally {
    closeSync(fd)
  }
}

/** @param {Buffer} bytes */
function checksum(bytes) {
  let sum = 0
  for (let i = 0; i < bytes.length; i += 4) {
    // The last word of an unpadded table has implicit zero bytes.
    for (let j = 0; j < 4 && i + j < bytes.length; j++) {
      sum = (sum + (bytes[i + j] << (24 - 8 * j))) >>> 0
    }
  }
  return sum
}

/** @param {Buffer} table @param {string} family */
function renamedTable(table, family) {
  const records = nameRecords(table)
  const previousRecordEnd = 6 + records.length * 12
  const storage = table.readUInt16BE(4)
  if (storage < previousRecordEnd || storage > table.length) throw new Error('Invalid font name table')
  // Keep the other name records, including license and language records. All
  // offsets into the old string storage remain valid.
  const kept = records.filter((record) => ![1, 16].includes(record.readUInt16BE(6)))
  const familyBytes = Buffer.from(family, 'utf16le').swap16()
  const stringOffset = table.length - storage
  for (const nameId of [1, 16]) {
    const record = Buffer.alloc(12)
    const fields = [3, 1, 0x0409, nameId, familyBytes.length, stringOffset]
    fields.forEach((value, index) => {
      record.writeUInt16BE(value, index * 2)
    })
    kept.push(record)
  }
  const header = Buffer.from(table.subarray(0, 6))
  header.writeUInt16BE(kept.length, 2)
  header.writeUInt16BE(storage + (kept.length - records.length) * 12, 4)
  return Buffer.concat([header, ...kept, table.subarray(previousRecordEnd), familyBytes])
}

/**
 * Align a decoded single-face OpenType buffer with the declared CSS face. Other
 * than the family names and OS/2 weight, the font's tables are preserved.
 * @param {Uint8Array} bytes @param {string} family @param {number} weight
 */
export function matchFontFace(bytes, family, weight) {
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = tablesAt((offset, length) => source.subarray(offset, offset + length))
  const name = tables.get('name')
  const head = tables.get('head')
  const os2 = tables.get('OS/2')
  if (!name || !head || !os2 || name.size < 6 || head.size < 12 || os2.size < 6 ||
      [name, head, os2].some(({ offset, size }) => offset + size > source.length)) {
    throw new Error('Expected a single-face TrueType or OpenType font')
  }

  const oldName = source.subarray(name.offset, name.offset + name.size)
  const typographicNames = familyNames(oldName, [16])
  const actualFamilies = typographicNames.length ? typographicNames : familyNames(oldName, [1])
  const newName = actualFamilies.includes(family) ? null : renamedTable(oldName, family)
  const changeWeight = source.readUInt16BE(os2.offset + 4) !== weight
  if (!newName && !changeWeight) return bytes

  const nameOffset = Math.ceil(source.length / 4) * 4
  const result = Buffer.alloc(nameOffset + (newName ? Math.ceil(newName.length / 4) * 4 : 0))
  source.copy(result)
  if (newName) {
    result.fill(0, name.offset, name.offset + name.size)
    newName.copy(result, nameOffset)
    result.writeUInt32BE(checksum(newName), name.record + 4)
    result.writeUInt32BE(nameOffset, name.record + 8)
    result.writeUInt32BE(newName.length, name.record + 12)
  }
  if (changeWeight) {
    result.writeUInt16BE(weight, os2.offset + 4)
    result.writeUInt32BE(checksum(result.subarray(os2.offset, os2.offset + os2.size)), os2.record + 4)
  }
  result.writeUInt32BE(0, head.offset + 8)
  result.writeUInt32BE((0xb1b0afba - checksum(result)) >>> 0, head.offset + 8)
  return result
}
