// Pins @rhwp/core 0.8.7 into editor/vendor/rhwp/: downloads the npm tarball, checks the
// sha256 of rhwp.js and rhwp_bg.wasm, copies them with their typings and LICENSE, and writes
// engine-info.js. Exits 1 when a hash differs, so nothing unverified lands in the plugin.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '0.8.7'
const TARBALL = `https://registry.npmjs.org/@rhwp/core/-/core-${VERSION}.tgz`
const UPSTREAM_COMMIT = '1a76570e833917d15817415a53c09ad61ab3203f'
const PINNED = {
  'rhwp.js': '70cde06a369fa7fd4fc8bc8f3d6acaee158596ba1a116a2c72159002b0b5654e',
  'rhwp_bg.wasm': '54cf95014312e605c51b98eb9021247ea79ef2bbd0a7080e11c011d0246e3989'
}
const EXTRA = ['rhwp.d.ts', 'rhwp_bg.wasm.d.ts', 'LICENSE']

const out = fileURLToPath(new URL('../editor/vendor/rhwp/', import.meta.url))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const work = mkdtempSync(join(tmpdir(), 'rhwp-vendor-'))
try {
  const response = await fetch(TARBALL)
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${TARBALL}`)
  }
  const tgz = join(work, 'core.tgz')
  writeFileSync(tgz, new Uint8Array(await response.arrayBuffer()))
  execFileSync('tar', ['-xzf', tgz, '-C', work])
  const pkg = join(work, 'package')

  const hashes = {}
  for (const [name, expected] of Object.entries(PINNED)) {
    const actual = sha256(readFileSync(join(pkg, name)))
    if (actual !== expected) {
      console.error(`sha256 mismatch for ${name}: expected ${expected}, got ${actual}`)
      process.exit(1)
    }
    hashes[name] = actual
  }

  mkdirSync(out, { recursive: true })
  for (const name of [...Object.keys(PINNED), ...EXTRA]) {
    copyFileSync(join(pkg, name), join(out, name))
  }

  const info = {
    name: 'rhwp',
    version: VERSION,
    source: `${TARBALL} (upstream github.com/edwardkim/rhwp @ ${UPSTREAM_COMMIT})`,
    sha256: { js: hashes['rhwp.js'], wasm: hashes['rhwp_bg.wasm'] }
  }
  writeFileSync(
    join(out, 'engine-info.js'),
    '// Written by build/vendor-rhwp.mjs. Do not edit.\n' +
      `export const ENGINE_INFO = Object.freeze(${JSON.stringify(info, null, 2)})\n`
  )
  for (const [name, hash] of Object.entries(hashes)) {
    console.log(`${name} ${hash}`)
  }
  console.log(`vendored @rhwp/core ${VERSION} into ${out}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
