import { spawnSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, test } from 'orca/testing'

const script = fileURLToPath(new URL('./agent-view.mjs', import.meta.url))
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url))
const sample = join(fixtures, '21868765_별표2_보건소_분장사무.hwp')
const planningSample = join(fixtures, '2022년 국립국어원 업무계획.hwp')
const referenceSamples = JSON.parse(readFileSync(new URL('../scripts/fixtures.json', import.meta.url), 'utf8'))
  .samples.filter(({ pdf }) => pdf)
const pngSignature = '89504e470d0a1a0a'

function run(args, cwd = fixtures, nodeArgs = []) {
  return spawnSync('node', [...nodeArgs, script, ...args, '--json', '--bundled-fonts-only'], {
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
    assert.equal(png.subarray(0, 8).toString('hex'), pngSignature)
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

test('a crop crossing the right edge on page 3 of the NIKL plan renders at the requested size', () => {
  if (!existsSync(planningSample)) return
  withOutputDir((dir) => {
    const result = run([planningSample, '--page', '3', '--region', '100,410,820,120', '--out', 'crop.png'], dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const png = readFileSync(JSON.parse(result.stdout).png)
    assert.equal(png.subarray(0, 8).toString('hex'), pngSignature)
    assert.equal(png.readUInt32BE(16), 1230)
    assert.equal(png.readUInt32BE(20), 180)
  })
})

for (const { file, pageCount } of referenceSamples) {
  test(`center crops render on the first five available pages of ${file}`, () => {
    const input = join(fixtures, file)
    if (!existsSync(input)) return
    withOutputDir((dir) => {
      for (let page = 1; page <= Math.min(pageCount, 5); page++) {
        const result = run([input, '--page', String(page), '--region', '100,300,500,200', '--out', 'center.png'], dir)
        assert.equal(result.status, 0, `Page ${page}: ${result.stderr || result.stdout}`)
        const png = readFileSync(JSON.parse(result.stdout).png)
        assert.equal(png.subarray(0, 8).toString('hex'), pngSignature, `Page ${page}`)
      }
    })
  })
}

test('a resvg trap is reported without freeing the borrowed renderer', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const stub = 'data:text/javascript,' + encodeURIComponent(`
      export async function initWasm() {}
      export class Resvg {
        render() { throw new WebAssembly.RuntimeError('unreachable') }
        free() { console.error('free called after trap'); throw new Error('recursive use') }
      }
    `)
    writeFileSync(join(dir, 'resvg-hook.mjs'), `
      export function resolve(specifier, context, nextResolve) {
        if (specifier === './vendor/resvg/index.mjs') {
          return { url: ${JSON.stringify(stub)}, shortCircuit: true }
        }
        return nextResolve(specifier, context)
      }
    `)
    const preload = join(dir, 'register.mjs')
    writeFileSync(preload, "import { register } from 'node:module'; register('./resvg-hook.mjs', import.meta.url)")
    const result = run([sample], dir, ['--import', preload])
    assertError(result, 'render-failed')
    assert.equal(JSON.parse(result.stdout).error.message, 'unreachable')
    assert.ok(!result.stderr.includes('free called after trap'))
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

test('the CLI preserves the input and rejects direct, symlink, and hard link output paths', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const original = readFileSync(sample)
    const input = join(dir, 'input.hwp')
    writeFileSync(input, original)
    const symbolic = join(dir, 'symbolic.png')
    const hard = join(dir, 'hard.png')
    symlinkSync(input, symbolic)
    linkSync(input, hard)
    for (const out of [input, symbolic, hard]) {
      assertError(run([input, '--out', out], dir), 'invalid-argument')
      assert.deepEqual(readFileSync(out), original)
      assert.deepEqual(readFileSync(input), original)
    }
  })
})

test('the CLI accepts a tiny region but rejects disjoint regions and oversized bitmaps', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const result = run([sample, '--region', '0,0,10,10', '--out', 'tiny.png'], dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const png = readFileSync(JSON.parse(result.stdout).png)
    assert.equal(png.subarray(0, 8).toString('hex'), pngSignature)
    assert.equal(png.readUInt32BE(16), 15)
    assert.equal(png.readUInt32BE(20), 15)
    assertError(run([sample, '--region', '1000,0,250,250', '--out', 'disjoint.png'], dir), 'region-out-of-page')
    assertError(run([sample, '--region', '0,0,10,10', '--scale', '10', '--out', 'oversized-page.png'], dir), 'invalid-argument')
    assertError(run([sample, '--region', '0,0,5000,5000', '--out', 'oversized-crop.png'], dir), 'invalid-argument')
    for (const output of ['disjoint.png', 'oversized-page.png', 'oversized-crop.png']) {
      assert.ok(!existsSync(join(dir, output)))
    }
  })
})
