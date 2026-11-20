import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadPackage, pins, verify, writeFiles } from './vendor-data.mjs'

const { version, upstreamCommit, tarball, patched } = pins.rhwp
const root = new URL('../', import.meta.url)
const out = new URL('../editor/vendor/rhwp/', import.meta.url)
const files = await downloadPackage(tarball)
const vendored = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [basename(path), bytes]))
const js = tarball.files['package/rhwp.js'].sha256
let wasm = tarball.files['package/rhwp_bg.wasm'].sha256
let label = version
let source = `${tarball.url} (upstream github.com/edwardkim/rhwp @ ${upstreamCommit})`

if (patched) {
  // The engine carries a fix rhwp has not released yet. npm's JS glue and typings stay; the WASM
  // is the one build/build-rhwp-patched.sh builds from patched.base + patched.patch, and it must
  // already be in place. Everything is checked before anything is written.
  verify(await readFile(new URL(patched.patch.path, root)), patched.patch, patched.patch.path)
  const built = await readFile(new URL('rhwp_bg.wasm', out)).catch(() => Buffer.alloc(0))
  try {
    verify(built, patched.wasm, 'editor/vendor/rhwp/rhwp_bg.wasm')
  } catch (error) {
    throw new Error(`${error.message}\nRebuild the patched engine with build/build-rhwp-patched.sh --install`)
  }
  delete vendored['rhwp_bg.wasm']
  wasm = patched.wasm.sha256
  label = patched.label
  source += ` + ${patched.patch.path}`
}

const info = {
  name: 'rhwp',
  version: label,
  source,
  sha256: { js, wasm },
}
const engineInfo = '// Written by build/vendor-rhwp.mjs. Do not edit.\n' +
  `export const ENGINE_INFO = Object.freeze(${JSON.stringify(info, null, 2)})\n`

await writeFiles(out, {
  ...vendored,
  'engine-info.js': engineInfo,
})
console.log(`rhwp.js ${js}`)
console.log(`rhwp_bg.wasm ${wasm}${patched ? ` (patched: ${patched.label})` : ''}`)
console.log(`vendored @rhwp/core ${label} into ${fileURLToPath(out)}`)
