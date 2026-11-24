import { download, downloadPackage, pins, verify, writeFiles } from './vendor-data.mjs'

const { resvg, woff2 } = pins

/** The only match of `pattern`, so an upstream change fails here instead of shipping half-patched. */
function replaceOnce(text, pattern, replacement) {
  if (text.split(pattern).length !== 2) throw new Error(`decompress.js: expected one ${pattern.slice(0, 60)}`)
  return text.replace(pattern, () => replacement)
}

/**
 * woff2-encoder ships its WASM as a 279 kB base64 string inside the JS. Keep it as a plain .wasm
 * file that anyone can inspect (Orca's plugin directory holds packed-looking code for review).
 */
function splitEmbeddedWasm(bytes) {
  const source = bytes.toString('utf8')
  const embedded = /"data:application\/octet-stream;base64,([A-Za-z0-9+/]+={0,2})"/.exec(source)
  if (!embedded) throw new Error('decompress.js: no embedded WASM')
  const wasm = verify(Buffer.from(embedded[1], 'base64'), woff2.wasm, 'agent/vendor/woff2/decompress.wasm')
  let js = replaceOnce(source, embedded[0], '"decompress.wasm"')
  js = replaceOnce(js, 'I({onRuntimeInitialized(){A(this)}})', 'I({wasmBinary,onRuntimeInitialized(){A(this)}})')
  const header = `// Modified from woff2-encoder ${woff2.version} dist/decompress.js by build/vendor-resvg.mjs:
// the base64-embedded WASM is decompress.wasm next to this file.
import { readFileSync } from 'node:fs'
const wasmBinary = readFileSync(new URL('./decompress.wasm', import.meta.url))
`
  return { 'decompress.js': header + js, 'decompress.wasm': wasm }
}
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
  ...splitEmbeddedWasm(decoderFiles['package/dist/decompress.js']),
  LICENSE: decoderFiles['package/LICENSE'],
  ...Object.fromEntries(decoderLicenses),
})
console.log(`Vendored @resvg/resvg-wasm@${resvg.version} and the woff2-encoder@${woff2.version} WASM decoder`)
