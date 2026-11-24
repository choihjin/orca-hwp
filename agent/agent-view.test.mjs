import { spawnSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
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


// The checkout can run these tests with either engine version.
function mockGetMemos(dir, body) {
  const preload = join(dir, 'memo-preload.mjs')
  const rhwp = new URL('../editor/vendor/rhwp/rhwp.js', import.meta.url)
  writeFileSync(preload, `
    import { HwpDocument } from ${JSON.stringify(rhwp.href)}
    HwpDocument.prototype.getMemos = function () { ${body} }
  `)
  return ['--import', preload]
}

test('--memos on a memo-free public sample adds only an empty list', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const nodeArgs = mockGetMemos(dir, 'return \'{"memos":[],"problems":[]}\'')
    const args = [sample, '--out', 'page.png']
    const baseline = run(args, dir, nodeArgs)
    assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout)
    const page = JSON.parse(baseline.stdout)
    assert.ok(!Object.hasOwn(page, 'memos'))
    const png = readFileSync(page.png)
    const withMemos = run([...args, '--memos'], dir, nodeArgs)
    assert.equal(withMemos.status, 0, withMemos.stderr || withMemos.stdout)
    assert.deepEqual(JSON.parse(withMemos.stdout), { ...page, memos: [] })
    assert.deepEqual(readFileSync(page.png), png)
  })
})

test('a memo read failure leaves the PNG available and warns', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const reason = 'memo read failed ' + 'x'.repeat(200)
    const nodeArgs = mockGetMemos(dir, 'throw new Error(' + JSON.stringify(reason) + ')')
    const result = run([sample, '--memos', '--out', 'page.png'], dir, nodeArgs)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const page = JSON.parse(result.stdout)
    assert.ok(!Object.hasOwn(page, 'memos'))
    assert.ok(page.warnings.includes('메모를 읽지 못함: ' + reason.slice(0, 200)))
    assert.ok(existsSync(page.png))
  })
})

test('a memo WASM trap preserves PNG and text, and only then tolerates a free failure', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const args = [sample, '--text', '--out', 'page.png']
    const baseline = run(args, dir)
    assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout)
    const page = JSON.parse(baseline.stdout)
    const png = readFileSync(page.png)
    const nodeArgs = mockGetMemos(dir, 'this.trapped = true; throw new WebAssembly.RuntimeError("unreachable")')
    const preload = nodeArgs[1]
    writeFileSync(preload, readFileSync(preload, 'utf8') + '\n' + [
      'const { free, renderPageSvg, getPageTextLayout } = HwpDocument.prototype',
      'for (const [method, original] of Object.entries({ renderPageSvg, getPageTextLayout })) {',
      '  HwpDocument.prototype[method] = function (...args) {',
      '    if (this.trapped) throw new Error("still borrowed")',
      '    return original.apply(this, args)',
      '  }',
      '}',
      'HwpDocument.prototype.free = function () {',
      '  free.call(this)',
      '  throw new Error("free failed")',
      '}'
    ].join('\n'))
    const result = run([...args, '--memos'], dir, nodeArgs)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.deepEqual(JSON.parse(result.stdout), { ...page, warnings: [...page.warnings, '메모를 읽지 못함: unreachable'] })
    assert.deepEqual(readFileSync(page.png), png)
    const noMemos = run(args, dir, nodeArgs)
    assertError(noMemos, 'render-failed')
    assert.equal(JSON.parse(noMemos.stdout).error.message, 'free failed')
  })
})

function mockMemoPage(dir, entry = {}) {
  const preload = join(dir, 'memo-page.mjs')
  const rhwp = new URL('../editor/vendor/rhwp/rhwp.js', import.meta.url)
  const memos = [{
    number: 1, author: '검토자\u0000\n가', text: '<img onerror=1>\n본문',
    date: null, dateText: '11.20', place: 'body', anchorText: '예산', paragraphText: '예산',
    multiParagraph: false, anchorKey: 'memo', sectionIndex: 0, ownerParaIndex: 0,
    paraIndex: 0, path: null, startCharIdx: 0, endCharIdx: 2, ...entry
  }]
  writeFileSync(preload, `
    import { HwpDocument } from ${JSON.stringify(rhwp.href)}
    Object.assign(HwpDocument.prototype, {
      getMemos: () => ${JSON.stringify(JSON.stringify({ memos, problems: [{ code: 'bad-record' }] }))},
      getPageInfo: () => '{"width":100,"height":100}',
      getCursorRect: () => '{"pageIndex":0,"x":65,"y":20,"height":12}',
      getPageTextLayout: () => '{"runs":[{"text":"예산","x":65,"y":20,"w":20,"h":12,"charX":[0,10,20],"secIdx":0,"paraIdx":0,"charStart":0}]}',
      renderPageSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>'
    })
  `)
  return ['--import', preload]
}

test('memo JSON exposes the whole report and plain output flattens each memo to a line', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const nodeArgs = mockMemoPage(dir)
    const args = [sample, '--memos', '--out', 'page.png']
    const result = run(args, dir, nodeArgs)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const page = JSON.parse(result.stdout)
    assert.deepEqual(page.memos, [{
      number: 1, page: 1, place: 'body', anchorText: '예산', paragraphText: '예산',
      multiParagraph: false, located: true,
      memos: [{ author: '검토자\n가', date: null, dateText: '11.20', text: '<img onerror=1>\n본문' }]
    }])
    assert.ok(page.warnings.includes('읽지 못한 메모 기록이 있음'))

    const plain = spawnSync('node', [...nodeArgs, script, ...args, '--bundled-fonts-only'], {
      cwd: dir, encoding: 'utf8', timeout: 30000
    })
    assert.equal(plain.status, 0, plain.stderr)
    assert.deepEqual(plain.stdout.trimEnd().split('\n'), [
      join(dir, 'page.png'), '1 · 1쪽 · 검토자 가 · 11.20 · "예산" → <img onerror=1> 본문'
    ])
  })
})

test('memo highlights survive a region edge and padding and leave disjoint regions unchanged', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const nodeArgs = mockMemoPage(dir)
    for (const region of ['70,15,15,20', '70,15,40,20', '0,0,20,20']) {
      const args = [sample, '--region', region, '--scale', '1', '--out', 'region.png']
      const baseline = run(args, dir, nodeArgs)
      assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout)
      const png = readFileSync(join(dir, 'region.png'))
      const result = run([...args, '--memos'], dir, nodeArgs)
      assert.equal(result.status, 0, result.stderr || result.stdout)
      const overlay = readFileSync(join(dir, 'region.png'))
      assert.equal(overlay.equals(png), region === '0,0,20,20', region)
      if (region === '70,15,40,20') {
        const width = 40
        assert.equal(overlay.readUInt32BE(16), width)
        const data = inflateSync(overlay.subarray(41, 41 + overlay.readUInt32BE(33)))
        const pixel = (x, y) => {
          const start = y * (width * 4 + 1) + 1 + x * 4
          return [...data.subarray(start, start + 4)]
        }
        assert.ok(pixel(1, 8).some((channel) => channel < 255), 'highlight in page coordinates')
        assert.deepEqual(pixel(1, 18), [255, 255, 255, 255])
        assert.deepEqual(pixel(35, 8), [255, 255, 255, 255], 'right padding stays white')
      }
    }
  })
})

test('plain memo output strips terminal controls and indicates a truncated anchor', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const nodeArgs = mockMemoPage(dir, {
      author: '검\u0085토\u200E자', text: '본문\t\u009b\u009f\u200f\u202e\u2069\n계속',
      dateText: '11\u2066.20', endCharIdx: 100
    })
    const plain = spawnSync('node', [...nodeArgs, script, sample, '--memos', '--out', 'page.png', '--bundled-fonts-only'], {
      cwd: dir, encoding: 'utf8', timeout: 30000
    })
    assert.equal(plain.status, 0, plain.stderr)
    assert.deepEqual(plain.stdout.trimEnd().split('\n'), [
      join(dir, 'page.png'), '1 · 1쪽 · 검토자 · 11.20 · "예산…" → 본문 계속'
    ])
  })
})

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

test('a high-scale region is limited by its own bitmap size', () => {
  if (!existsSync(sample)) return
  withOutputDir((dir) => {
    const result = run([sample, '--region', '100,250,100,30', '--scale', '5', '--out', 'detail.png'], dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const png = readFileSync(JSON.parse(result.stdout).png)
    assert.equal(png.subarray(0, 8).toString('hex'), pngSignature)
    assert.equal(png.readUInt32BE(16), 500)
    assert.equal(png.readUInt32BE(20), 150)
    if (process.platform !== 'win32') {
      const discard = run([sample, '--region', '100,250,100,30', '--scale', '5', '--out', '/dev/null'], dir)
      assert.equal(discard.status, 0, discard.stderr || discard.stdout)
    }
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
    assertError(run([sample, '--scale', '10', '--out', 'oversized-page.png'], dir), 'invalid-argument')
    assertError(run([sample, '--region', '0,0,5000,5000', '--out', 'oversized-crop.png'], dir), 'invalid-argument')
    for (const output of ['disjoint.png', 'oversized-page.png', 'oversized-crop.png']) {
      assert.ok(!existsSync(join(dir, output)))
    }
  })
})
