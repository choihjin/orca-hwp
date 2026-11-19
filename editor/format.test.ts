import { assert, test } from 'orca/testing'
import { detectKind, formatSize } from './format.js'

test('detects a ZIP package as hwpx', () => {
  assert.equal(detectKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])), 'hwpx')
})

test('detects an OLE compound file as hwp', () => {
  assert.equal(detectKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), 'hwp')
})

test('reports other bytes as unknown', () => {
  assert.equal(detectKind(new Uint8Array([1, 2, 3])), 'unknown')
  assert.equal(detectKind(new Uint8Array([])), 'unknown')
})

test('formats sizes', () => {
  assert.equal(formatSize(512), '512 B')
  assert.equal(formatSize(2048), '2.0 KB')
  assert.equal(formatSize(3 * 1024 * 1024), '3.0 MB')
})
