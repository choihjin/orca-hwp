import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadPackage, pins, verify, writeFiles } from './vendor-data.mjs'

const { version, upstreamCommit, tarball, patched } = pins.rhwp
const root = new URL('../', import.meta.url)
const out = new URL('../editor/vendor/rhwp/', import.meta.url)
const files = await downloadPackage(tarball)
const vendored = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [basename(path), bytes]))
let js = tarball.files['package/rhwp.js'].sha256
let wasm = tarball.files['package/rhwp_bg.wasm'].sha256
let label = version
let source = `${tarball.url} (upstream github.com/edwardkim/rhwp @ ${upstreamCommit})`

if (patched) {
  for (const patch of patched.patches) {
    verify(await readFile(new URL(patch.path, root)), patch, patch.path)
  }
  for (const [file, pin] of Object.entries(patched.files)) {
    const built = await readFile(new URL(file, out)).catch(error => {
      if (error.code === 'ENOENT') return Buffer.alloc(0)
      throw error
    })
    try {
      verify(built, pin, `editor/vendor/rhwp/${file}`)
    } catch (error) {
      throw new Error(`${error.message}\nRebuild the patched engine with build/build-rhwp-patched.sh --install`)
    }
    delete vendored[file]
  }
  js = patched.files['rhwp.js'].sha256
  wasm = patched.files['rhwp_bg.wasm'].sha256
  label = patched.label
  source += ' + ' + patched.patches.map(patch => patch.path).join(' + ')
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
