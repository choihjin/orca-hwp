import { readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { archiveFile, download, pins, verify } from './vendor-data.mjs'

const root = new URL('../', import.meta.url)
const reviews = new URL('licenses/', import.meta.url)
const inventory = JSON.parse(await readFile(new URL('crates.json', reviews), 'utf8'))
const normalize = text => text.toString().replace(/\r\n?/g, '\n')
const fromPlugin = path => readFile(new URL(path, root))
const section = (title, source, text) => [title, source, '', text].join('\n')
const separator = '\n\n' + '='.repeat(78) + '\n\n'

async function reviewed(file, original) {
  const text = normalize(original)
  const expected = normalize(await readFile(new URL(file, reviews)))
  if (text !== expected) throw new Error(`Original license differs from build/licenses/${file}. Review it before updating the copy.`)
  return text
}

const [cargoLock, upstreamLicenses, engineLicense, fontIndex] = await Promise.all([
  download(pins.rhwp.cargoLock),
  download(pins.rhwp.thirdPartyLicenses),
  fromPlugin('editor/vendor/rhwp/LICENSE'),
  fromPlugin('editor/fonts/licenses/font-notices.json'),
])
if (inventory.lockSha256 !== pins.rhwp.cargoLock.sha256) {
  throw new Error('build/licenses/crates.json does not correspond to the pinned Cargo.lock')
}

const cache = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'registry', 'cache')
const cacheEntries = await readdir(cache, { withFileTypes: true }).catch(error => {
  if (error.code === 'ENOENT') return []
  throw error
})
const registries = cacheEntries.filter(entry => entry.isDirectory())
const lockText = normalize(cargoLock)

async function crateArchive(stem, pin) {
  for (const dir of registries) {
    const path = join(cache, dir.name, stem + '.crate')
    const bytes = await readFile(path).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    if (bytes) return verify(bytes, pin, path)
  }
  return download(pin)
}

const engineText = await reviewed('rhwp-MIT.txt', engineLicense)
const upstreamText = await reviewed('rhwp-THIRD_PARTY_LICENSES.txt', upstreamLicenses)
const workspaceSource = `https://github.com/edwardkim/rhwp/tree/${pins.rhwp.upstreamCommit}`
const sections = [
  '본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.\n\n' +
    '"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 플러그인은 한글과컴퓨터와 관계없는 독립 프로젝트입니다.',
  section(
    pins.rhwp.patched
      ? `rhwp@${pins.rhwp.version} (MIT), modified by this plugin as ${pins.rhwp.patched.label}: ${pins.rhwp.patched.patch.path}`
      : `rhwp@${pins.rhwp.version} (MIT)`,
    pins.rhwp.tarball.url,
    engineText,
  ),
  section('rhwp upstream THIRD_PARTY_LICENSES.md', pins.rhwp.thirdPartyLicenses.url, upstreamText),
]

async function crateSection({ name, version, license, workspace, archive, files }) {
  const title = `${name}@${version} (${license})`
  if (workspace) {
    return section(title, `${workspaceSource}/${workspace} (rhwp workspace LICENSE)`, engineText)
  }

  const stem = `${name}-${version}`
  const entry = `name = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${archive.sha256}"`
  if (!lockText.includes(entry)) throw new Error(`${stem} differs from Cargo.lock`)
  const bytes = await crateArchive(stem, archive)
  const licenses = files.map(file => `--- ${file} ---\n${normalize(archiveFile(bytes, `${stem}/${file}`))}`)
  return section(title, archive.url, await reviewed(`${name}@${version}.txt`, licenses.join('\n\n')))
}

const dependencies = inventory.crates.filter(crate => crate.workspace !== '.')
for (let offset = 0; offset < dependencies.length; offset += 8) {
  sections.push(...await Promise.all(dependencies.slice(offset, offset + 8).map(crateSection)))
}

const fontNotices = new Map(JSON.parse(verify(
  fontIndex, pins.fonts.licenses['font-notices.json'], 'font-notices.json'
)).fonts.map(font => [font.file, font]))
for (const font of pins.fonts.files) {
  const notice = fontNotices.get(font.file)
  if (notice?.sha256 !== font.sha256) throw new Error(`Font notice differs from pins.json: ${font.file}`)

  const licenses = await Promise.all(notice.licenseFiles.map(async file => {
    const text = await reviewed(file, await fromPlugin(`editor/fonts/licenses/${file}`))
    return `--- ${file} ---\n${text}`
  }))
  sections.push(section(
    `${font.file} (${notice.license})`,
    font.url,
    [...notice.copyrightNotices, '', ...licenses].join('\n')
  ))
}

const resvgText = await reviewed('resvg-wasm-MPL-2.0.txt', await fromPlugin('agent/vendor/resvg/LICENSE'))
sections.push(section(
  `@resvg/resvg-wasm@${pins.resvg.version} (MPL-2.0)`,
  [
    pins.resvg.tarball.url,
    `https://github.com/thx/resvg-js/tree/${pins.resvg.upstreamCommit}`,
    pins.resvg.license.url,
  ].join('\n'),
  resvgText
))

const decoderText = await reviewed('woff2-encoder-MIT.txt', await fromPlugin('agent/vendor/woff2/LICENSE'))
sections.push(section(
  `woff2-encoder@${pins.woff2.version} (MIT)`,
  `https://github.com/itskyedo/woff2-encoder/tree/${pins.woff2.upstreamCommit}\n${pins.woff2.tarball.url}`,
  decoderText
))
for (const [file, name, review] of [
  ['LICENSE-WOFF2', 'Google WOFF2 (MIT)', 'google-woff2-MIT.txt'],
  ['LICENSE-Brotli', 'Google Brotli (MIT)', 'google-brotli-MIT.txt'],
  ['LICENSE-Emscripten', 'Emscripten (MIT OR NCSA)', 'emscripten-MIT-NCSA.txt'],
]) {
  const text = await reviewed(review, await fromPlugin(`agent/vendor/woff2/${file}`))
  sections.push(section(name, pins.woff2.licenses[file].url, text))
}

const notices = sections.join(separator) + '\n'
await writeFile(new URL('THIRD_PARTY_NOTICES.txt', root), notices)
console.log(`THIRD_PARTY_NOTICES.txt: ${inventory.crates.length} Cargo packages including rhwp, ${Buffer.byteLength(notices)} B`)
