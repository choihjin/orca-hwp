import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadPackage, pins, writeFiles } from './vendor-data.mjs'

const { version, upstreamCommit, tarball } = pins.rhwp
const out = new URL('../editor/vendor/rhwp/', import.meta.url)
const files = await downloadPackage(tarball)
const js = tarball.files['package/rhwp.js'].sha256
const wasm = tarball.files['package/rhwp_bg.wasm'].sha256
const info = {
  name: 'rhwp',
  version,
  source: `${tarball.url} (upstream github.com/edwardkim/rhwp @ ${upstreamCommit})`,
  sha256: { js, wasm },
}
const engineInfo = '// Written by build/vendor-rhwp.mjs. Do not edit.\n' +
  `export const ENGINE_INFO = Object.freeze(${JSON.stringify(info, null, 2)})\n`

await writeFiles(out, {
  ...Object.fromEntries(Object.entries(files).map(([path, bytes]) => [basename(path), bytes])),
  'engine-info.js': engineInfo,
})
console.log(`rhwp.js ${js}`)
console.log(`rhwp_bg.wasm ${wasm}`)
console.log(`vendored @rhwp/core ${version} into ${fileURLToPath(out)}`)
