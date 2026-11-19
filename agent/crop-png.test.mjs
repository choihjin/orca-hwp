import { inflateSync } from 'node:zlib'
import { assert, test } from 'orca/testing'
import { cropPng } from './crop-png.mjs'

test('the PNG crop copies the selected pixels and pads past the page edges with white', () => {
  const black = [0, 0, 0, 255]
  const red = [255, 0, 0, 255]
  const green = [0, 255, 0, 255]
  const blue = [0, 0, 255, 255]
  const white = [255, 255, 255, 255]
  const image = { width: 2, height: 2, pixels: Uint8Array.from([...black, ...red, ...green, ...blue]) }
  const png = cropPng(image, { x: 1, y: 0, width: 2, height: 3 })

  assert.equal(png.readUInt32BE(16), 2)
  assert.equal(png.readUInt32BE(20), 3)
  const idatLength = png.readUInt32BE(33)
  assert.equal(png.toString('ascii', 37, 41), 'IDAT')
  assert.deepEqual(inflateSync(png.subarray(41, 41 + idatLength)), Buffer.from([
    0, ...red, ...white,
    0, ...blue, ...white,
    0, ...white, ...white
  ]))
})
