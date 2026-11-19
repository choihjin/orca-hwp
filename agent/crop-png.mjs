import { deflateSync } from 'node:zlib'

const signature = Buffer.from('89504e470d0a1a0a', 'hex')
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return crc
})

function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12)
  bytes.writeUInt32BE(data.length)
  bytes.write(type, 4, 'ascii')
  data.copy(bytes, 8)
  let crc = 0xffffffff
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  }
  bytes.writeUInt32BE((~crc) >>> 0, bytes.length - 4)
  return bytes
}

/**
 * Encode a region of the rendered page's RGBA pixels. Pixels outside the page
 * keep the white page background. Both rectangles use scaled pixel coordinates.
 */
export function cropPng(image, { x, y, width, height }) {
  const source = Buffer.from(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength)
  const rowSize = width * 4 + 1
  const scanlines = Buffer.alloc(rowSize * height, 255)
  const copyWidth = Math.max(0, Math.min(width, image.width - x))
  const copyHeight = Math.max(0, Math.min(height, image.height - y))

  for (let row = 0; row < height; row++) {
    const targetOffset = row * rowSize
    scanlines[targetOffset] = 0 // PNG filter type None.
    if (row < copyHeight && copyWidth > 0) {
      const start = ((y + row) * image.width + x) * 4
      source.copy(scanlines, targetOffset + 1, start, start + copyWidth * 4)
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // Bits per channel.
  header[9] = 6 // RGBA.
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND')
  ])
}
