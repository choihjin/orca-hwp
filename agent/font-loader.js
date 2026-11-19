import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const fontsDir = new URL('../editor/fonts/', import.meta.url)
const decoderUrl = new URL('./vendor/woff2/decode.mjs', import.meta.url)
const fallbackFamilies = new Set(['noto serif kr', 'noto sans kr'])
const familyAliases = new Map([
  ['nanum myeongjo', 'NanumMyeongjo'],
  ['나눔명조', 'NanumMyeongjo'],
  ['source han serif k old hangul', 'RHWP Old Hangul']
])
const xmlEntities = { apos: "'", quot: '"', amp: '&', lt: '<', gt: '>' }

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
 */
function loadLocalFonts(dir, fontBuffers, warnings) {
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
      loadLocalFonts(path, fontBuffers, warnings)
    } else if (/\.(?:ttf|otf|ttc|otc)$/i.test(entry.name)) {
      try {
        fontBuffers.push(readFileSync(path))
      } catch (error) {
        warnings.push(`Could not load local font ${path}: ${String(error)}`)
      }
    }
  }
}

/**
 * @param {string} svg
 * @param {boolean} bundledFontsOnly
 * @param {string[]} warnings
 * @returns {Promise<{ svg: string, fontBuffers: Uint8Array[] }>}
 */
export async function prepareFonts(svg, bundledFontsOnly, warnings) {
  /** @type {Uint8Array[]} */
  const fontBuffers = []
  if (!bundledFontsOnly && process.platform === 'darwin') {
    loadLocalFonts(join(homedir(), 'Library', 'Fonts'), fontBuffers, warnings)
    loadLocalFonts('/Library/Fonts', fontBuffers, warnings)
  }

  /** @type {{ file: string, families: string[], weight: number }[]} */
  let manifest
  try {
    manifest = JSON.parse(readFileSync(new URL('manifest.json', fontsDir), 'utf8'))
  } catch (error) {
    if ((/** @type {NodeJS.ErrnoException} */ (error)).code !== 'ENOENT') throw error
    warnings.push('Bundled font manifest is missing. PNG text may be incomplete.')
    return { svg, fontBuffers }
  }

  const resolved = resolvePageFamilies(svg)
  const selected = manifest.filter(({ families: names, weight }) =>
    names.some((name) => {
      const family = name.toLowerCase()
      return resolved.families.has(family) || (weight === 400 && fallbackFamilies.has(family))
    })
  )

  const hasDecoder = existsSync(decoderUrl)
  let missingDecoder = false
  for (const { file } of selected) {
    const bytes = readFileSync(new URL(file, fontsDir))
    if (bytes.toString('ascii', 0, 4) !== 'wOF2') {
      fontBuffers.push(bytes)
    } else if (hasDecoder) {
      const { decodeWoff2 } = await import(decoderUrl.href)
      fontBuffers.push(await decodeWoff2(bytes))
    } else {
      missingDecoder = true
    }
  }
  if (missingDecoder) warnings.push('WOFF2 decoder is missing. PNG text may be incomplete.')
  return { svg: resolved.svg, fontBuffers }
}
