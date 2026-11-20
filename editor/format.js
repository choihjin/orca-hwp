// Shared by the frame and Node (agent/agent-view.mjs), so it is plain ESM with JSDoc types.

/** @typedef {'hwpx' | 'hwp' | 'unknown'} HwpKind */

const ZIP = [0x50, 0x4b, 0x03, 0x04]
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/**
 * .hwpx is a ZIP package (starts "PK\x03\x04"); .hwp 5.x is an OLE compound file (D0 CF 11 E0 A1 B1 1A E1).
 * @param {Uint8Array} bytes
 * @returns {HwpKind}
 */
export function detectKind(bytes) {
  if (ZIP.every((b, i) => bytes[i] === b)) {
    return 'hwpx'
  }
  if (OLE.every((b, i) => bytes[i] === b)) {
    return 'hwp'
  }
  return 'unknown'
}

/**
 * @param {number} byteLength
 * @returns {string}
 */
export function formatSize(byteLength) {
  if (byteLength < 1024) {
    return `${byteLength} B`
  }
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`
  }
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}
