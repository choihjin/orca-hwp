import decompress from './decompress.js'

/**
 * Expand a WOFF2 font into an OpenType buffer for resvg.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function decodeWoff2(bytes) {
  return decompress(bytes)
}
