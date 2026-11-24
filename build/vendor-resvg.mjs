import { download, downloadPackage, pins, writeFiles } from './vendor-data.mjs'

const { resvg } = pins
const [resvgFiles, resvgLicense] = await Promise.all([
  downloadPackage(resvg.tarball),
  download(resvg.license),
])

await writeFiles(new URL('../agent/vendor/resvg/', import.meta.url), {
  'index.mjs': resvgFiles['package/index.mjs'],
  'index_bg.wasm': resvgFiles['package/index_bg.wasm'],
  LICENSE: resvgLicense,
})
console.log(`Vendored @resvg/resvg-wasm@${resvg.version}`)
