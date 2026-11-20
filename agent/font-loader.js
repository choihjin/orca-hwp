import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hasRequestedFamily, matchFontFace } from './sfnt.js'
import { decodeWoff1 } from './woff1.js'

const fontsDir = new URL('../editor/fonts/', import.meta.url)
const decoderUrl = new URL('./vendor/woff2/decode.mjs', import.meta.url)
const fallbackFamilies = new Set(['noto serif kr', 'noto sans kr'])
const familyAliases = new Map([
  ['nanum myeongjo', 'NanumMyeongjo'],
  ['나눔명조', 'NanumMyeongjo'],
  ['source han serif k old hangul', 'RHWP Old Hangul']
])
const xmlEntities = { apos: "'", quot: '"', amp: '&', lt: '<', gt: '>' }
const woff2Decoder = existsSync(decoderUrl) ? () => import(decoderUrl.href) : null

/**
 * resvg uses font files' internal family names. Keep the requested family first
 * so that an installed face can still win, then add the bundled alias.
 * @param {string} svg
 */
function resolvePageFamilies(svg) {
  /** @type {Set<string>} */
  const families = new Set()
  /** @type {Map<string, string>} */
  const lists = new Map()
  /** @param {string} value */
  function rewriteFamilyList(value) {
    const cached = lists.get(value)
    if (cached !== undefined) return cached
    const decoded = value.slice(1, -1).replace(/&(apos|quot|amp|lt|gt);/g, (_, entity) =>
      xmlEntities[/** @type {keyof typeof xmlEntities} */ (entity)]
    )
    const names = []
    let addedAlias = false
    for (const [, token] of decoded.matchAll(/(?:^|,)\s*("[^"]*"|'[^']*'|[^,]+)/g)) {
      const name = token.trim()
      const family = name.replace(/^(['"])(.*)\1$/, '$2').toLowerCase()
      families.add(family)
      names.push(name)
      const alias = familyAliases.get(family)
      if (alias) {
        names.push(`'${alias}'`)
        addedAlias = true
      }
    }
    const rewritten = addedAlias
      ? `"${names.join(',').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`
      : value
    lists.set(value, rewritten)
    return rewritten
  }

  const rewrittenSvg = svg.replace(/<[A-Za-z][\w:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/g, (tag) => {
    if (!tag.includes('font-family')) return tag
    return tag.replace(/(\s+([\w:-]+)\s*=\s*)("[^"]*"|'[^']*')/g, (attr, prefix, name, value) =>
      name === 'font-family' ? prefix + rewriteFamilyList(value) : attr
    )
  })
  return { svg: rewrittenSvg, families }
}

/**
 * @param {string} dir
 * @param {Uint8Array[]} fontBuffers
 * @param {string[]} warnings
 * @param {Set<string>} [requested]
 */
function loadLocalFonts(dir, fontBuffers, warnings, requested) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if ((/** @type {NodeJS.ErrnoException} */ (error)).code === 'ENOENT') return
    warnings.push(`Could not list local fonts in ${dir}: ${String(error)}`)
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      loadLocalFonts(path, fontBuffers, warnings, requested)
    } else if (/\.(?:ttf|otf|ttc|otc)$/i.test(entry.name)) {
      try {
        if (!requested || hasRequestedFamily(path, requested)) fontBuffers.push(readFileSync(path))
      } catch (error) {
        warnings.push(`Could not load local font ${path}: ${String(error)}`)
      }
    }
  }
}

/** @param {Buffer} bytes */
async function decodeFont(bytes) {
  const format = bytes.toString('ascii', 0, 4)
  if (format === 'wOFF') return decodeWoff1(bytes)
  if (format !== 'wOF2') return bytes
  if (!woff2Decoder) throw new Error('WOFF2 decoder is missing')
  const { decodeWoff2 } = await woff2Decoder()
  return decodeWoff2(bytes)
}

/** @param {string} face @param {string[]} warnings */
async function loadEmbeddedFace(face, warnings) {
  const declarations = new Map(
    [...face.matchAll(/(?:[{;])\s*([a-z-]+)\s*:\s*((?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;{}"'])*)/gi)]
      .map(([, name, value]) => [name.toLowerCase(), value.trim()])
  )
  const family = declarations.get('font-family')?.replace(/^(['"])(.*)\1$/, '$2')
  if (declarations.has('unicode-range')) {
    warnings.push(`Skipped embedded SVG font${family ? ` "${family}"` : ''}: resvg cannot apply unicode-range`)
    return null
  }
  const rawWeight = declarations.get('font-weight')?.toLowerCase()
  const weight = rawWeight === 'bold' ? 700 : Number(rawWeight)
  const targetWeight = Number.isInteger(weight) && weight >= 1 && weight <= 1000 ? weight : 400
  const src = declarations.get('src') ?? ''
  for (const [, quoted, singleQuoted, bare] of src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const url = (quoted ?? singleQuoted ?? bare).trim()
    const data = /^data:([^,]*),([\s\S]*)$/i.exec(url)
    if (!data) continue
    const payload = data[2].replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    try {
      const bytes = await decodeFont(Buffer.from(payload, /;base64$/i.test(data[1]) ? 'base64' : 'latin1'))
      if (family) return matchFontFace(bytes, family, targetWeight)
    } catch {
      // A source list can offer another format for the same face.
    }
  }
  warnings.push(`Could not load embedded SVG font${family ? ` "${family}"` : ''}`)
  return null
}

/**
 * @param {string} svg
 * @param {boolean} bundledFontsOnly
 * @param {string[]} warnings
 * @param {string[]} [fontFaces] Sanitized CSS @font-face rules.
 * @returns {Promise<{ svg: string, fontBuffers: Uint8Array[] }>}
 */
export async function prepareFonts(svg, bundledFontsOnly, warnings, fontFaces = []) {
  const resolved = resolvePageFamilies(svg)
  /** @type {Uint8Array[]} */
  const fontBuffers = []
  for (const face of fontFaces) {
    const bytes = await loadEmbeddedFace(face, warnings)
    if (bytes) fontBuffers.push(bytes)
  }
  if (!bundledFontsOnly && process.platform === 'darwin') {
    loadLocalFonts(join(homedir(), 'Library', 'Fonts'), fontBuffers, warnings)
    loadLocalFonts('/Library/Fonts', fontBuffers, warnings)
    // The system directory contains hundreds of MiB of fonts. Read only name
    // tables first and load the page's matching families, including Supplemental.
    if (resolved.families.size) {
      loadLocalFonts('/System/Library/Fonts', fontBuffers, warnings, resolved.families)
    }
  }

  /** @type {{ file: string, families: string[], weight: number }[]} */
  let manifest
  try {
    manifest = JSON.parse(readFileSync(new URL('manifest.json', fontsDir), 'utf8'))
  } catch (error) {
    if ((/** @type {NodeJS.ErrnoException} */ (error)).code !== 'ENOENT') throw error
    warnings.push('Bundled font manifest is missing. PNG text may be incomplete.')
    return { svg: resolved.svg, fontBuffers }
  }

  const selected = manifest.filter(({ families: names }) =>
    names.some((name) => {
      const family = name.toLowerCase()
      return resolved.families.has(family) || fallbackFamilies.has(family)
    })
  )

  for (const { file, families, weight } of selected) {
    const bytes = readFileSync(new URL(file, fontsDir))
    try {
      fontBuffers.push(matchFontFace(await decodeFont(bytes), families[0], weight))
    } catch (error) {
      warnings.push(`Could not load bundled font ${file}: ${String(error)}`)
    }
  }
  return { svg: resolved.svg, fontBuffers }
}
