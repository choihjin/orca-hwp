import { download, downloadPackage, pins, writeFiles } from './vendor-data.mjs'

const { resvg, woff2 } = pins
const [resvgFiles, resvgLicense, decoderFiles, decoderLicenses] = await Promise.all([
  downloadPackage(resvg.tarball),
  download(resvg.license),
  downloadPackage(woff2.tarball),
  Promise.all(Object.entries(woff2.licenses).map(async ([file, pin]) => [file, await download(pin)])),
])

await writeFiles(new URL('../agent/vendor/resvg/', import.meta.url), {
  'index.mjs': resvgFiles['package/index.mjs'],
  'index_bg.wasm': resvgFiles['package/index_bg.wasm'],
  LICENSE: resvgLicense,
})
await writeFiles(new URL('../agent/vendor/woff2/', import.meta.url), {
  'decompress.js': decoderFiles['package/dist/decompress.js'],
  LICENSE: decoderFiles['package/LICENSE'],
  ...Object.fromEntries(decoderLicenses),
})
console.log(`Vendored @resvg/resvg-wasm@${resvg.version} and the woff2-encoder@${woff2.version} WASM decoder`)
