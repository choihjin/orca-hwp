import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, test } from 'orca/testing'
import { pins } from './vendor-data.mjs'

const scratch = fileURLToPath(new URL('../.orca/', import.meta.url))
const source = new URL('../editor/vendor/rhwp/', import.meta.url)
const mockFetch = 'data:text/javascript,' + encodeURIComponent(`
  import { readFileSync } from 'node:fs'
  globalThis.fetch = async () => new Response(readFileSync('core.tgz'))
`)

function assertRejected({ changedMember, updateTarballHash }) {
  const { rhwp } = structuredClone(pins)
  const { tarball } = rhwp
  mkdirSync(scratch, { recursive: true })
  const dir = mkdtempSync(join(scratch, 'vendor-rhwp-test-'))
  try {
    const build = join(dir, 'build')
    const output = join(dir, 'editor/vendor/rhwp')
    mkdirSync(build)
    mkdirSync(output, { recursive: true })
    mkdirSync(join(dir, 'package'))
    for (const script of ['vendor-rhwp.mjs', 'vendor-data.mjs']) {
      copyFileSync(new URL(script, import.meta.url), join(build, script))
    }

    const existing = readFileSync(new URL('rhwp.d.ts', source))
    writeFileSync(join(output, 'rhwp.d.ts'), existing)
    for (const member of Object.keys(tarball.files)) {
      const bytes = readFileSync(new URL(member.slice('package/'.length), source))
      if (member === changedMember) bytes[0] ^= 1
      writeFileSync(join(dir, member), bytes)
    }

    execFileSync('tar', ['-czf', 'core.tgz', 'package'], { cwd: dir })
    const archive = readFileSync(join(dir, 'core.tgz'))
    // Sizes match both pins so these cases exercise SHA-256 checks.
    tarball.size = archive.length
    if (updateTarballHash) tarball.sha256 = createHash('sha256').update(archive).digest('hex')
    writeFileSync(join(build, 'pins.json'), JSON.stringify({ rhwp }))

    const result = spawnSync(process.execPath, ['--import', mockFetch, 'build/vendor-rhwp.mjs'], {
      cwd: dir,
      env: { ...process.env, TMPDIR: dir },
      encoding: 'utf8',
      timeout: 30_000,
    })
    const failingPin = updateTarballHash ? `${tarball.url} / ${changedMember}` : tarball.url
    assert.equal(result.status, 1, result.error?.message ?? (result.stderr || result.stdout))
    assert.ok(result.stderr.includes(`Error: ${failingPin}: expected`), result.stderr)
    assert.deepEqual(readdirSync(output), ['rhwp.d.ts'])
    assert.deepEqual(readFileSync(join(output, 'rhwp.d.ts')), existing)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('rejects a repacked rhwp tarball even when all member files match', () => {
  assertRejected({ updateTarballHash: false })
})

for (const file of ['rhwp.d.ts', 'rhwp_bg.wasm.d.ts', 'LICENSE']) {
  test(`rejects a changed ${file} member even when the tarball matches its pin`, () => {
    assertRejected({ changedMember: `package/${file}`, updateTarballHash: true })
  })
}
