import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, test } from 'orca/testing'

const script = fileURLToPath(new URL('./agent-view.mjs', import.meta.url))
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url))
const sample = join(fixtures, '21868765_별표2_보건소_분장사무.hwp')

function run(args, cwd = fixtures) {
  return spawnSync('node', [script, ...args, '--json', '--bundled-fonts-only'], {
    cwd,
    encoding: 'utf8',
    timeout: 30000
  })
}

function withOutputDir(fn) {
  mkdirSync(fixtures, { recursive: true })
  const dir = mkdtempSync(join(fixtures, 'agent-view-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function assertError(result, code) {
  assert.equal(result.status, 1, result.stderr)
  assert.equal(JSON.parse(result.stdout).error.code, code)
}

test('the CLI reports the first page, a PNG, and table text', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const result = run([sample, '--page', '1', '--text', '--out', 'page.png'], dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const page = JSON.parse(result.stdout)
    assert.equal(page.pageCount, 4)
    assert.equal(page.page, 1)
    assert.equal(page.png, join(dir, 'page.png'))
    assert.ok(page.text.some((line) => line.includes('보건정책과')))
    const png = readFileSync(page.png)
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), Math.round(page.pageSize.width * 1.5))
    assert.equal(png.readUInt32BE(20), Math.round(page.pageSize.height * 1.5))
  })
})

test('a cropped PNG has the scaled region dimensions and page-level text', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const result = run([sample, '--region', '80,200,120,30', '--scale', '2', '--text', '--out', 'crop.png'], dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const page = JSON.parse(result.stdout)
    const png = readFileSync(page.png)
    assert.equal(png.readUInt32BE(16), 240)
    assert.equal(png.readUInt32BE(20), 60)
    assert.ok(page.text.some((line) => line.includes('보건소의 부서별 분장사무')))
  })
})

test('the CLI rejects a page past the end of the document', () => {
  if (!existsSync(sample)) return
  assertError(run([sample, '--page', '9']), 'page-out-of-range')
})

test('the CLI gives a structured error for a file that is not a Hangul document', () => {
  withOutputDir((dir) => {
    const file = join(dir, 'plain.hwp')
    writeFileSync(file, 'plain text')
    assertError(run([file], dir), 'not-hangul')
  })
})

test('the CLI rejects a malformed region', () => {
  withOutputDir((dir) => {
    assertError(run(['unused.hwp', '--region', '0,,100,100'], dir), 'invalid-argument')
  })
})
